import type {ArgvMode} from '#src/lib/argv.ts'
import type {QueryParameters} from '#src/queryParameters.ts'
import type {FunctionComponent, ReactNode} from 'react'

import clsx from 'clsx'
import {useEffect, useId, useRef, useState} from 'react'
import {FiArrowRight, FiCheck, FiCopy, FiEye, FiEyeOff, FiKey, FiPlay, FiRotateCcw, FiTrash2, FiZap} from 'react-icons/fi'
import {Link, useLocation} from 'wouter'

import {Tip} from '#component/Tooltip'
import {getStoredBearer, saveBearer, useStoredBearers} from '#src/lib/bearerStore.ts'
import {resolveTargetAddressSpace} from '#src/lib/docker/addressSpace.ts'
import {DockerClient} from '#src/lib/docker/DockerClient.ts'
import {toMonitorError} from '#src/lib/monitor/Monitor.ts'
import {columnOptions, dateFormats, panelOptions, selectedKeys, toggleSelection} from '#src/lib/preferences.ts'
import {menuSoundHandlers, soundModes} from '#src/lib/sound.ts'
import {useParameters} from '#src/lib/useParameters.ts'
import {buildSearch, defaults, getApiBaseUrl, getEndpointKey, normalizations, sortKeys} from '#src/queryParameters.ts'

import css from './style.module.sass'

type Draft = Record<keyof QueryParameters, string>

type TestState = {
  hint?: string
  message: string
  status: 'error' | 'running' | 'success'
} | undefined

const toDraft = (values: QueryParameters): Draft => ({
  panels: values.panels,
  columns: values.columns,
  dateFormat: values.dateFormat,
  host: values.host ?? '',
  port: String(values.port),
  protocol: values.protocol,
  path: values.path,
  bearer: values.bearer ?? '',
  interval: String(values.interval),
  history: String(values.history),
  image: values.image,
  lifetime: String(values.lifetime),
  argv: values.argv,
  destructive: String(values.destructive),
  sound: values.sound,
  linger: String(values.linger),
  interactive: String(values.interactive),
  filter_button: values.filter_button.join('\n'),
  kernel: String(values.kernel),
  agent: String(values.agent),
  tree: String(values.tree),
  sort: values.sort,
  filter: values.filter,
  reverse: String(values.reverse),
  addressSpace: values.addressSpace,
})
/**
 * Validates the draft field by field, producing typed values and human-readable errors.
 */
const parseDraft = (draft: Draft) => {
  const values: Partial<QueryParameters> = {}
  const errors: Partial<Record<keyof QueryParameters, string>> = {}
  for (const key of Object.keys(draft) as Array<keyof QueryParameters>) {
    const raw = draft[key]
    if (raw.trim() === '' && key !== 'filter_button') {
      continue
    }
    try {
      Object.assign(values, {[key]: normalizations[key](key === 'filter_button' ? raw.split(/\r?\n/) : raw)})
    } catch (error) {
      errors[key] = Error.isError(error) ? error.message : String(error)
    }
  }
  return {
    values,
    errors,
  }
}
const Field: FunctionComponent<{
  children: ReactNode
  description?: ReactNode
  error?: string
  label: string
  name: string
  wide?: boolean
}> = ({children, description, error, label, name, wide}) => <div className={clsx(css.field, wide && css.wide)}>
  <div className={css.labelRow}>
    <span className={css.label}>{label}</span>
    <code className={css.param}>{name}</code>
  </div>
  {children}
  {error ? <div className={css.error} role='alert'>{error}</div> : description && <div className={css.description}>{description}</div>}
</div>
const Toggle: FunctionComponent<{
  checked: boolean
  label: ReactNode
  name: string
  onChange: (checked: boolean) => void
}> = ({checked, label, name, onChange}) => {
  const id = useId()
  return <label className={css.toggle} htmlFor={id}>
    <input id={id} checked={checked} name={name} role='switch' type='checkbox' onChange={event => onChange(event.target.checked)} />
    <span className={css.switch} aria-hidden />
    <span className={css.toggleText}>{label}</span>
  </label>
}
const Setup: FunctionComponent = () => {
  const {values: initial, errors: initialErrors} = useParameters()
  const [, navigate] = useLocation()
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial))
  const [bearerInput, setBearerInput] = useState('')
  const [showBearer, setShowBearer] = useState(false)
  const [storageError, setStorageError] = useState<string>()
  const [copied, setCopied] = useState(false)
  const [test, setTest] = useState<TestState>()
  const requestRef = useRef<AbortController | undefined>(undefined)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => {
    requestRef.current?.abort()
    clearTimeout(copyTimerRef.current)
  }, [])
  useStoredBearers()
  const {values, errors} = parseDraft(draft)
  const allErrors = errors
  const [initialErrorEntries] = useState(() => Object.entries(initialErrors))
  const merged: QueryParameters = {
    ...defaults,
    ...values,
  }
  const endpointKey = getEndpointKey(merged)
  const baseUrl = getApiBaseUrl(merged)
  const storedBearer = getStoredBearer(endpointKey)
  const hasErrors = Object.keys(errors).length > 0
  const search = buildSearch(values, {includeBearer: true})
  const dashboardPath = `/${buildSearch(values)}`
  const dashboardUrl = typeof location === 'undefined' ? dashboardPath : new URL(dashboardPath, location.origin).href
  const canOpen = Boolean(values.host) && !hasErrors
  useEffect(() => {
    document.title = 'Setup – wtop'
  }, [])
  // keep the address bar in sync so reloading /setup restores the draft
  useEffect(() => {
    const target = `/setup${search}`
    if (`${location.pathname}${location.search}` !== target) {
      history.replaceState(history.state, '', target)
    }
  }, [search])
  const set = (key: keyof QueryParameters) => (value: string) => {
    setDraft(current => ({
      ...current,
      [key]: value,
    }))
    requestRef.current?.abort()
    setTest(undefined)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(dashboardUrl)
      setCopied(true)
      clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 1600)
    } catch {}
  }
  const runTest = async () => {
    if (!baseUrl) {
      return
    }
    requestRef.current?.abort()
    const controller = new AbortController
    requestRef.current = controller
    setTest({
      status: 'running',
      message: `Contacting ${baseUrl}`,
    })
    const client = new DockerClient({
      baseUrl,
      bearer: bearerInput || merged.bearer || storedBearer,
      timeout: 8000,
      signal: controller.signal,
      targetAddressSpace: resolveTargetAddressSpace(merged),
    })
    try {
      const containers = await client.json<Array<{Id: string}>>('GET', '/containers/json')
      setTest({
        status: 'success',
        message: `Docker is reachable (${containers.length} running containers).`,
      })
    } catch (error) {
      if (controller.signal.aborted) {
        return
      }
      const {message, hint} = toMonitorError(error)
      setTest({
        status: 'error',
        message,
        hint,
      })
    }
  }
  useEffect(() => {
    // A credential draft belongs to one endpoint and must never follow an endpoint switch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBearerInput('')
    setStorageError(undefined)
  }, [endpointKey])
  const persistToken = (token: string) => {
    if (!endpointKey) {
      return false
    }
    try {
      saveBearer(endpointKey, normalizations.bearer(token) ?? '')
      setStorageError(undefined)
      return true
    } catch (error) {
      setStorageError(Error.isError(error) ? error.message : 'Token storage failed.')
      return false
    }
  }
  const save = () => {
    if (!endpointKey || !bearerInput.trim()) {
      return
    }
    if (!persistToken(bearerInput.trim())) {
      return
    }
    set('bearer')('')
    setBearerInput('')
    setShowBearer(false)
  }
  const argvDescriptions: Record<ArgvMode, string> = {
    full: 'show complete command lines',
    censored: 'mask argument values like --token=•••••',
    hidden: 'omit command lines entirely',
  }
  return <div className={css.setup} {...menuSoundHandlers(merged.sound)}>
    <header className={css.hero}>
      <img className={css.logo} alt='' src='/icon.svg' />
      <div>
        <h1 className={css.title}>wtop</h1>
        <p className={css.tagline}>A live process monitor for Linux Docker hosts, right in your browser. Wtop starts a short-lived collector container on demand; no separate agent port or host package installation is needed.</p>
      </div>
    </header>
    {initialErrorEntries.length > 0 && <div className={css.warning}>
      Some parameters of the link were invalid and have been reset: {initialErrorEntries.map(([key, message]) => <span key={key}><code>{key}</code> ({message}) </span>)}
    </div>}
    <form
      className={css.form} onSubmit={event => {
        event.preventDefault()
        if (canOpen) {
          navigate(dashboardPath)
        }
      }}
    >
      <section className={css.section}>
        <h2 className={css.sectionTitle}>Docker endpoint</h2>
        <div className={css.fields}>
          <Field error={allErrors.protocol} label='Protocol' name='protocol'>
            <div className={css.segmented} aria-label='Protocol' role='radiogroup'>
              {(['http', 'https'] as const).map(protocol => <button
                key={protocol} className={clsx(merged.protocol === protocol && css.selected)} aria-checked={merged.protocol === protocol} role='radio' type='button' onClick={() => {
                  set('protocol')(protocol)
                  if (draft.port === String(protocol === 'https' ? 2375 : 2376) || draft.port === '') {
                    set('port')(String(protocol === 'https' ? 2376 : 2375))
                  }
                }}
              >{protocol}</button>)}
            </div>
          </Field>
          <Field description='host name or IP address of the Docker daemon or its proxy' error={allErrors.host} label='Host' name='host' wide>
            <input className={css.input} aria-label='host' autoComplete='off' autoFocus={!draft.host} name='host' placeholder='192.168.1.20' spellCheck={false} value={draft.host} onChange={event => set('host')(event.target.value)} />
          </Field>
          <Field error={allErrors.port} label='Port' name='port'>
            <input className={css.input} aria-label='port' inputMode='numeric' max={65_535} min={1} name='port' placeholder={String(defaults.port)} type='number' value={draft.port} onChange={event => set('port')(event.target.value)} />
          </Field>
          <Field description='only needed if a reverse proxy serves the API below a sub path' error={allErrors.path} label='Path prefix' name='path'>
            <input className={css.input} aria-label='path' name='path' placeholder='/docker' spellCheck={false} value={draft.path} onChange={event => set('path')(event.target.value)} />
          </Field>
        </div>
        <div className={css.endpoint}>
          <code className={css.endpointUrl}>{baseUrl ?? 'enter a host to build the endpoint URL'}</code>
          <button className={css.secondary} disabled={!canOpen || test?.status === 'running'} type='button' onClick={runTest}><FiZap aria-hidden />{test?.status === 'running' ? 'Testing…' : 'Test connection'}</button>
        </div>
        {test && test.status !== 'running' && <div className={clsx(css.test, css[test.status])} role='status'>
          <strong>{test.status === 'success' ? 'Connected.' : 'Failed.'}</strong> {test.message}
          {test.hint && <div className={css.testHint}>{test.hint}</div>}
        </div>}
      </section>
      <section className={css.section}>
        <h2 className={css.sectionTitle}>Authentication</h2>
        <Field description={<>Sent as <code>Authorization: Bearer …</code>. The token is saved in this browser’s local storage for <code>{endpointKey ?? 'this endpoint'}</code> and never becomes part of the link.</>} label='Bearer token' name='bearer' wide>
          <div className={css.bearer}>
            <div className={css.bearerInput}>
              <FiKey className={css.bearerIcon} aria-hidden />
              <input
                className={css.input} aria-label='Bearer token' autoComplete='off' disabled={!endpointKey} name='bearer' placeholder={storedBearer ? 'replace the saved token' : 'paste a token'} spellCheck={false} type={showBearer ? 'text' : 'password'} value={bearerInput} onChange={event => {
                  requestRef.current?.abort(); setTest(undefined); setBearerInput(event.target.value)
                }} onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    save()
                  }
                }}
              />
              <button className={css.reveal} aria-label={showBearer ? 'Hide token' : 'Show token'} type='button' onClick={() => setShowBearer(current => !current)}>{showBearer ? <FiEyeOff /> : <FiEye />}</button>
            </div>
            <button className={css.secondary} disabled={!endpointKey || !bearerInput.trim()} type='button' onClick={save}><FiCheck aria-hidden />Save</button>
          </div>
          {storageError && <div className={css.error} role='alert'>{storageError}</div>}
          {storedBearer && endpointKey && <div className={css.saved}>
            <FiKey aria-hidden /> A token ending in <code>…{storedBearer.slice(-4)}</code> is saved for this endpoint.
            <button className={css.link} type='button' onClick={() => persistToken('')}><FiTrash2 aria-hidden />Forget</button>
          </div>}
          {merged.bearer && <div className={css.warning}>
            This link contains a <code>bearer</code> parameter. It works, but anyone with the link gets access to your Docker daemon.
            <button
              className={css.link} type='button' onClick={() => {
                if (endpointKey && merged.bearer) {
                  if (!persistToken(merged.bearer)) {
                    return
                  }
                }
                set('bearer')('')
              }}
            >Move it to local storage</button>
          </div>}
        </Field>
      </section>
      <section className={css.section}>
        <h2 className={css.sectionTitle}>Dashboard</h2>
        <div className={css.fields}>
          <Field description='milliseconds between samples' error={allErrors.interval} label='Refresh interval' name='interval'>
            <input className={css.input} aria-label='interval' min={250} name='interval' placeholder={String(defaults.interval)} step={250} type='number' value={draft.interval} onChange={event => set('interval')(event.target.value)} />
          </Field>
          <Field description='seconds of history in graphs' error={allErrors.history} label='Graph window' name='history'>
            <input className={css.input} aria-label='history' min={10} name='history' placeholder={String(defaults.history)} step={10} type='number' value={draft.history} onChange={event => set('history')(event.target.value)} />
          </Field>
          <Field description='seconds a ghost bar remembers its recent peak; zero disables it' error={allErrors.linger} label='Peak linger' name='linger'>
            <input className={css.input} aria-label='Peak linger' max={3600} min={0} name='linger' step='any' type='number' value={draft.linger} onChange={event => set('linger')(event.target.value)} />
          </Field>
          <Field description='Alerts includes connection and signal feedback. All also plays menu sounds. Browser autoplay policy still applies.' error={allErrors.sound} label='Sounds' name='sound'>
            <select className={css.input} aria-label='Sounds' name='sound' value={merged.sound} onChange={event => set('sound')(event.target.value)}>
              {soundModes.map(mode => <option key={mode} value={mode}>{mode}</option>)}
            </select>
          </Field>
          <Field description={argvDescriptions[merged.argv]} error={allErrors.argv} label='Command lines' name='argv'>
            <div className={css.segmented} aria-label='Command lines' role='radiogroup'>
              {(['full', 'censored', 'hidden'] as const).map(mode => <button key={mode} className={clsx(merged.argv === mode && css.selected)} aria-checked={merged.argv === mode} role='radio' type='button' onClick={() => set('argv')(mode)}>{mode}</button>)}
            </div>
          </Field>
          <Field error={allErrors.sort} label='Sort by' name='sort'>
            <select className={css.input} aria-label='Sort by' name='sort' value={merged.sort} onChange={event => set('sort')(event.target.value)}>
              {sortKeys.map(key => <option key={key} value={key}>{key}</option>)}
            </select>
          </Field>
          <Field description='initial process filter' error={allErrors.filter} label='Filter' name='filter'>
            <input className={css.input} aria-label='filter' name='filter' placeholder='container:postgres' spellCheck={false} value={draft.filter} onChange={event => set('filter')(event.target.value)} />
          </Field>
        </div>
        <div className={css.toggles}>
          <Toggle checked={merged.destructive} label={<><strong>Destructive actions</strong><span className={css.toggleDescription}>allow sending signals like SIGTERM and SIGKILL to processes</span></>} name='destructive' onChange={checked => set('destructive')(String(checked))} />
          <Toggle checked={merged.interactive} label={<><strong>Interactive dashboard</strong><span className={css.toggleDescription}>turn off for a wall display without mouse, touch or keyboard controls</span></>} name='interactive' onChange={checked => set('interactive')(String(checked))} />
          <Toggle checked={merged.reverse} label='Reverse sort order' name='reverse' onChange={checked => set('reverse')(String(checked))} />
          <Toggle checked={merged.tree} label={<><strong>Tree view</strong><span className={css.toggleDescription}>group processes under their parents</span></>} name='tree' onChange={checked => set('tree')(String(checked))} />
          <Toggle checked={merged.kernel} label={<><strong>Kernel threads</strong><span className={css.toggleDescription}>list kworker and friends</span></>} name='kernel' onChange={checked => set('kernel')(String(checked))} />
          <Toggle checked={merged.agent} label={<><strong>wtop agent</strong><span className={css.toggleDescription}>list the processes of the helper container</span></>} name='agent' onChange={checked => set('agent')(String(checked))} />
        </div>
      </section>
      <section className={css.section}>
        <h2 className={css.sectionTitle}>Filter buttons</h2>
        <Field description='One Label:filter expression per line. Repeated filter_button parameters replace the defaults; leave empty for no buttons.' error={allErrors.filter_button} label='Custom filter buttons' name='filter_button' wide>
          <textarea className={css.input} aria-label='Custom filter buttons' name='filter_button' placeholder={'Heavy:tag:heavy\nOrphan:tag:orphan\nDetached:tag:detached'} rows={4} spellCheck={false} value={draft.filter_button} onChange={event => set('filter_button')(event.target.value)} />
        </Field>
      </section>
      <section className={css.section}>
        <h2 className={css.sectionTitle}>Panels</h2>
        <div className={css.checkboxList}>
          {panelOptions.map(option => <label key={option.key}>
            <input checked={selectedKeys(merged.panels).includes(option.key)} name={`panel.${option.key}`} type='checkbox' onChange={event => set('panels')(toggleSelection(merged.panels, option.key, event.target.checked, panelOptions))} />
            {option.label}
          </label>)}
        </div>
      </section>
      <section className={css.section}>
        <h2 className={css.sectionTitle}>Process table columns</h2>
        <div className={css.checkboxList}>
          {columnOptions.map(option => <label key={option.key}>
            <input checked={selectedKeys(merged.columns).includes(option.key)} name={`column.${option.key}`} type='checkbox' onChange={event => set('columns')(toggleSelection(merged.columns, option.key, event.target.checked, columnOptions))} />
            {option.label}
          </label>)}
        </div>
        <p className={css.description}>Selected columns remain available on narrow screens by scrolling the table. Command lines stay hidden when argument privacy is set to hidden.</p>
      </section>
      <section className={css.section}>
        <h2 className={css.sectionTitle}>Date format</h2>
        <select className={css.input} aria-label='Date format' name='dateFormat' value={merged.dateFormat} onChange={event => set('dateFormat')(event.target.value)}>
          {dateFormats.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </section>
      <details className={css.section}>
        <summary className={css.sectionTitle}>Advanced</summary>
        <div className={css.fields}>
          <Field description='must provide Bun 1.4.2 (distroless or slim); no custom image build or published port is required' error={allErrors.image} label='Agent image' name='image' wide>
            <input className={css.input} aria-label='image' name='image' placeholder={defaults.image} spellCheck={false} value={draft.image} onChange={event => set('image')(event.target.value)} />
          </Field>
          <Field description='Auto detects IP literals and local names; override for split-horizon DNS.' label='Network address space' name='addressSpace'>
            <select className={css.input} aria-label='Network address space' name='addressSpace' value={draft.addressSpace} onChange={event => set('addressSpace')(event.target.value)}>
              {['auto', 'local', 'loopback', 'public'].map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </Field>
          <Field description='seconds the agent survives without requests' error={allErrors.lifetime} label='Agent lifetime' name='lifetime'>
            <input className={css.input} aria-label='lifetime' min={10} name='lifetime' placeholder={String(defaults.lifetime)} type='number' value={draft.lifetime} onChange={event => set('lifetime')(event.target.value)} />
          </Field>
        </div>
      </details>
      <section className={clsx(css.section, css.result)}>
        <div className={css.resultLabel}>Dashboard link</div>
        <div className={css.linkRow}>
          <a
            className={clsx(css.url, !canOpen && css.disabled)} data-testid='dashboard-link' href={canOpen ? dashboardUrl : undefined} onClick={event => {
              if (canOpen && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {
                event.preventDefault()
                navigate(dashboardPath)
              }
            }}
          >
            {dashboardUrl.split(/(?=[&?])/).map((part, index) => <span key={index} className={index === 0 ? css.urlBase : css.urlParam}>{part}</span>)}
          </a>
          <Tip content={copied ? 'Copied' : 'Copy link'}>
            <button className={css.iconButton} aria-label='Copy link' disabled={!canOpen} type='button' onClick={copy}>{copied ? <FiCheck /> : <FiCopy />}</button>
          </Tip>
        </div>
        <div className={css.actions}>
          <button className={css.primary} disabled={!canOpen} type='submit'>Open dashboard<FiArrowRight aria-hidden /></button>
          <Link
            className={css.secondary} href={`/demo${buildSearch({
              ...values,
              host: undefined,
              port: undefined,
              protocol: undefined,
              path: undefined,
              bearer: undefined,
            })}`}
          ><FiPlay aria-hidden />Try the demo</Link>
          <button
            className={css.ghost} type='button' onClick={() => {
              setDraft(toDraft({...defaults}))
              setTest(undefined)
            }}
          ><FiRotateCcw aria-hidden />Reset</button>
        </div>
        {!values.host && <div className={css.description}>Enter a host to open the live dashboard.</div>}
        {hasErrors && <div className={css.error}>Fix the highlighted fields first.</div>}
      </section>
      <section className={clsx(css.section, css.help)}>
        <h2 className={css.sectionTitle}>Preparing the host</h2>
        <p>The Docker API grants root-equivalent access. Keep it on a trusted network behind an authenticated proxy. Allow only the exact dashboard origin, not arbitrary websites.</p>
        <p>The collector uses host PID and cgroup namespaces, a read-only container filesystem and no network. It expires after {merged.lifetime} seconds without requests. Compatible dashboards share it automatically.</p>
        <p><a href='https://github.com/Jaid/wtop.io/blob/main/docs/deployment.md' rel='noreferrer' target='_blank'>Deployment guide and authenticated Caddy configuration</a></p>
      </section>
    </form>
  </div>
}

export default Setup
