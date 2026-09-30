import type {MonitorEvent, MonitorState} from '#src/lib/monitor/Monitor.ts'
import type {Signal} from '#src/lib/procfs/script.ts'
import type {SortKey} from '#src/queryParameters.ts'
import type {FunctionComponent} from 'react'

import {useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react'
import {FiAlertTriangle, FiLoader, FiRefreshCw, FiSettings} from 'react-icons/fi'
import {Link, useLocation} from 'wouter'

import ContainerPanel from '#component/ContainerPanel'
import CpuPanel from '#component/CpuPanel'
import {GraphInspection} from '#component/GraphInspection'
import Header from '#component/Header'
import MemoryPanel from '#component/MemoryPanel'
import NetworkPanel from '#component/NetworkPanel'
import ProcessPanel from '#component/ProcessPanel'
import SensorsPanel from '#component/SensorsPanel'
import ShortcutsDialog from '#component/ShortcutsDialog'
import StoragePanel from '#component/StoragePanel'
import {useToasts} from '#component/Toasts'
import {getStoredBearer, useStoredBearers} from '#src/lib/bearerStore.ts'
import {resolveTargetAddressSpace} from '#src/lib/docker/addressSpace.ts'
import {formatNumber, formatRetry} from '#src/lib/format.ts'
import {Monitor} from '#src/lib/monitor/Monitor.ts'
import {selectedKeys} from '#src/lib/preferences.ts'
import {playSound} from '#src/lib/sound.ts'
import {DockerSource} from '#src/lib/source/DockerSource.ts'
import {SimulationSource} from '#src/lib/source/SimulationSource.ts'
import {useParameters} from '#src/lib/useParameters.ts'
import {getApiBaseUrl, getEndpointKey} from '#src/queryParameters.ts'

import css from './style.module.sass'

type Props = {
  demo?: boolean
}

const idleState: MonitorState = {
  status: 'idle',
  paused: false,
  failures: 0,
  sampleCount: 0,
  version: 0,
}
const noopSubscribe = () => () => {}
const isTyping = (target: EventTarget | null) => {
  const element = target as HTMLElement | null
  return Boolean(element && (['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) || element.isContentEditable))
}
const useNow = (active: boolean) => {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) {
      return
    }
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [active])
  return now
}
const ConnectionCard: FunctionComponent<{
  demo: boolean
  endpoint: string
  onRetry: () => void
  setupHref: string
  state: MonitorState
}> = ({demo, endpoint, onRetry, setupHref, state}) => {
  const now = useNow(Boolean(state.retryAt))
  const failed = state.status === 'error'
  return <div className={css.connection}>
    <div className={css.connectionCard} data-failed={failed || undefined}>
      <div className={css.connectionIcon}>{failed ? <FiAlertTriangle /> : <FiLoader className={css.spin} />}</div>
      <div className={css.connectionTitle}>{failed ? 'Cannot connect' : state.progress?.message ?? 'Connecting'}</div>
      <div className={css.connectionEndpoint}>{demo ? 'built-in simulation' : endpoint}</div>
      {!failed && state.progress?.detail && <div className={css.connectionDetail}>{state.progress.detail}</div>}
      {failed && state.error && <>
        <div className={css.connectionError}>{state.error.message}</div>
        {state.error.hint && <div className={css.connectionHint}>{state.error.hint}</div>}
        <div className={css.connectionActions}>
          <button className={css.button} type='button' onClick={onRetry}><FiRefreshCw aria-hidden />Retry{state.retryAt ? ` (${formatRetry(state.retryAt - now)})` : ''}</button>
          <Link className={css.button} href={setupHref}><FiSettings aria-hidden />Setup</Link>
        </div>
      </>}
    </div>
  </div>
}
const Dashboard: FunctionComponent<Props> = ({demo = false}) => {
  const {values, setParameter, search} = useParameters()
  const [, navigate] = useLocation()
  const toasts = useToasts()
  useStoredBearers()
  const [helpOpen, setHelpOpen] = useState(false)
  const filterRef = useRef<HTMLInputElement>(null)
  const endpointKey = getEndpointKey(values)
  const baseUrl = getApiBaseUrl(values)
  const bearer = values.bearer ?? getStoredBearer(endpointKey)
  const [monitor, setMonitor] = useState<Monitor>()
  const intervalRef = useRef(values.interval)
  useLayoutEffect(() => {
    intervalRef.current = values.interval
  }, [values.interval])
  const setupHref = `/setup${search ? `?${search}` : ''}`
  const needsSetup = !demo && !baseUrl
  useEffect(() => {
    if (needsSetup) {
      navigate(setupHref, {replace: true})
    }
  }, [needsSetup, navigate, setupHref])
  useEffect(() => {
    if (needsSetup) {
      return
    }
    const source = demo ? new SimulationSource : new DockerSource({
      baseUrl: baseUrl!,
      bearer,
      image: values.image,
      lifetime: values.lifetime,
      argv: values.argv,
      destructive: values.destructive,
      targetAddressSpace: resolveTargetAddressSpace({
        protocol: values.protocol,
        host: values.host,
        addressSpace: values.addressSpace,
      }),
    })
    const created = new Monitor(source, {
      interval: intervalRef.current,
      historySeconds: values.history,
    })
    // Each effect owns a disposable resource, including Strict Mode replay.
    setMonitor(created)
    created.start()
    return () => created.stop()
  }, [demo, baseUrl, bearer, values.image, values.lifetime, values.history, values.argv, values.destructive, values.addressSpace, values.host, values.protocol, needsSetup])
  useEffect(() => {
    monitor?.setInterval(values.interval)
  }, [monitor, values.interval])
  useEffect(() => {
    if (!monitor) {
      return
    }
    const update = () => monitor.setSuspended(document.hidden)
    document.addEventListener('visibilitychange', update)
    update()
    return () => document.removeEventListener('visibilitychange', update)
  }, [monitor])
  const soundRef = useRef(values.sound)
  useLayoutEffect(() => {
    soundRef.current = values.sound
  }, [values.sound])
  useEffect(() => {
    if (!monitor) {
      return
    }
    return monitor.onEvent((event: MonitorEvent) => {
      const sound = soundRef.current
      switch (event.type) {
        case 'connected': {
          if (sound) {
            playSound('connect')
          }
          break
        }
        case 'lost': {
          toasts.push({
            kind: 'warning',
            title: 'Connection lost',
            body: event.error?.message,
            duration: 6000,
          })
          if (sound) {
            playSound('lost')
          }
          break
        }
        case 'restored': {
          toasts.push({
            kind: 'success',
            title: 'Connection restored',
          })
          if (sound) {
            playSound('restored')
          }
          break
        }
        case 'signal-sent': {
          toasts.push({
            kind: 'success',
            title: `Sent SIG${event.signal} to PID ${event.pid}`,
          })
          if (sound) {
            playSound('signal')
          }
          break
        }
        case 'signal-failed': {
          toasts.push({
            kind: 'error',
            title: `Could not send SIG${event.signal} to PID ${event.pid}`,
            body: event.error?.message,
            duration: 8000,
          })
          if (sound) {
            playSound('error')
          }
          break
        }
      }
    })
  }, [monitor, toasts])
  const state = useSyncExternalStore(monitor?.subscribe ?? noopSubscribe, monitor?.getState ?? (() => idleState), () => idleState)
  const frame = state.frame
  useEffect(() => {
    const name = state.info?.hostname ?? (demo ? 'demo' : values.host)
    document.title = frame ? `${formatNumber(frame.cpu.total)}% · ${name} – wtop` : `${name} – wtop`
  }, [frame, state.info?.hostname, demo, values.host])
  const onSignal = async (pid: number, signal: Signal, startTicks: number) => {
    await monitor?.signal(pid, signal, startTicks)
  }
  const togglePause = () => monitor?.setPaused(!monitor.getState().paused)
  const toggle = (setting: 'agent' | 'kernel' | 'tree') => setParameter(setting, !values[setting])
  const setSort = (sort: SortKey) => {
    setParameter('sort', sort)
    setParameter('reverse', false)
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || helpOpen) {
        return
      }
      const key = event.key
      if (key === ' ' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault()
        togglePause()
      } else if (key.toLowerCase() === 'f') {
        event.preventDefault()
        filterRef.current?.focus()
        filterRef.current?.select()
      } else if (key === '?') {
        setHelpOpen(true)
      } else if (key === 't' || key === 'T') {
        toggle('tree')
      } else if (key === 'k' || key === 'K') {
        toggle('kernel')
      } else if (key === 'c' || key === 'C') {
        setSort('cpu')
      } else if (key === 'm' || key === 'M') {
        setSort('memory')
      } else if (key === 'p' || key === 'P') {
        setSort('pid')
      } else if (key === 'n' || key === 'N') {
        setSort('name')
      }
    }
    globalThis.addEventListener('keydown', onKeyDown)
    return () => globalThis.removeEventListener('keydown', onKeyDown)
  })
  if (needsSetup) {
    return null
  }
  const shown = new Set(selectedKeys(values.panels))
  const hasResources = ['cpu', 'memory', 'network', 'storage', 'sensors'].some(key => shown.has(key))
  const endpoint = baseUrl ?? ''
  const panelProps = frame && monitor ? {
    frame,
    history: state.history!,
    interval: values.interval,
    paused: state.paused,
    windowSeconds: values.history,
  } : undefined
  return <GraphInspection><div className={css.dashboard}>
    <Header
      demo={demo}
      endpoint={endpoint}
      interval={values.interval}
      setupHref={setupHref}
      sound={values.sound}
      state={state}
      onHelp={() => setHelpOpen(true)}
      onPause={togglePause}
      onRetry={() => monitor?.retry()}
      onSound={() => {
        if (!values.sound) {
          playSound('click')
        }
        setParameter('sound', !values.sound)
      }}
    />
    {state.status === 'reconnecting' && state.error && <div className={css.banner}>
      <FiAlertTriangle aria-hidden />
      <span className={css.bannerText}><strong>Connection interrupted.</strong> {state.error.message}{state.error.hint ? ` ${state.error.hint}` : ''}</span>
      <button className={css.bannerButton} type='button' onClick={() => monitor?.retry()}>Retry now</button>
    </div>}
    {panelProps && monitor ? <main className={css.grid}>
      {hasResources && <div className={css.resources}>
        {shown.has('cpu') && <CpuPanel {...panelProps} />}
        {shown.has('memory') && <MemoryPanel {...panelProps} />}
        {shown.has('network') && <NetworkPanel {...panelProps} />}
        {shown.has('storage') && <StoragePanel {...panelProps} />}
        {shown.has('sensors') && <SensorsPanel {...panelProps} />}
      </div>}
      {(shown.has('containers') || shown.has('processes')) && <div className={css.dataPanels} data-split={shown.has('containers') && shown.has('processes') || undefined}>
        {shown.has('containers') && <ContainerPanel containers={panelProps.frame.containers} filter={values.filter} history={state.history!} memoryTotal={panelProps.frame.memory.total} onFilter={filter => setParameter('filter', filter)} />}
        {shown.has('processes') && <ProcessPanel
          argvMode={values.argv}
          columns={values.columns}
          dateFormat={values.dateFormat}
          destructive={values.destructive}
          filter={values.filter}
          filterRef={filterRef}
          frame={panelProps.frame}
          history={state.history!}
          reverse={values.reverse}
          sampleCount={state.sampleCount}
          showAgent={values.agent}
          showKernel={values.kernel}
          sort={values.sort}
          tree={values.tree}
          onFilterChange={filter => setParameter('filter', filter)}
          onReverse={() => setParameter('reverse', !values.reverse)}
          onSignal={onSignal}
          onSortChange={setSort}
          onToggle={toggle}
        />}</div>}
      {shown.size === 0 && <div className={css.noPanels}>No panels selected. <Link href={setupHref}>Choose panels in setup</Link>.</div>}
    </main> : <ConnectionCard demo={demo} endpoint={endpoint} setupHref={setupHref} state={state} onRetry={() => monitor?.retry()} />}
    <ShortcutsDialog destructive={values.destructive} open={helpOpen} onClose={() => setHelpOpen(false)} />
  </div></GraphInspection>
}

export default Dashboard
