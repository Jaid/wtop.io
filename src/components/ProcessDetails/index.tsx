import type {ArgvMode} from '#src/lib/argv.ts'
import type {ProcessHistory} from '#src/lib/monitor/History.ts'
import type {ProcessRow} from '#src/lib/monitor/types.ts'
import type {DateFormat} from '#src/lib/preferences.ts'
import type {Signal} from '#src/lib/procfs/script.ts'
import type {FunctionComponent} from 'react'

import clsx from 'clsx'
import {useEffect, useState} from 'react'
import {FiBox, FiCopy, FiCornerLeftUp, FiX, FiZap} from 'react-icons/fi'

import Sparkline from '#component/Sparkline'
import {Tip, TooltipTable} from '#component/Tooltip'
import {presentArgv} from '#src/lib/argv.ts'
import {formatBytes, formatDateTime, formatDuration, formatNumber, formatPercent, formatRate} from '#src/lib/format.ts'
import {stateDescriptions} from '#src/lib/monitor/processes.ts'
import {signalDescriptions, signals} from '#src/lib/procfs/script.ts'

import css from './style.module.sass'

type Props = {
  argvMode: ArgvMode
  childCount: number
  cores: number
  dateFormat?: DateFormat
  destructive: boolean
  gone: boolean
  history?: ProcessHistory
  onClose: () => void
  onFilter: (filter: string) => void
  onSelectPid: (pid: number) => void
  onSignal: (pid: number, signal: Signal, startTicks: number) => Promise<void>
  parent?: ProcessRow
  row: ProcessRow
}

const SignalButton: FunctionComponent<{
  disabled: boolean
  label: string
  onSend: () => Promise<void>
  signal: Signal
  tone: 'danger' | 'normal'
}> = ({disabled, label, onSend, signal, tone}) => {
  const [armed, setArmed] = useState(false)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (!armed) {
      return
    }
    const timer = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [armed])
  const onClick = async () => {
    if (!armed) {
      setArmed(true)
      return
    }
    setArmed(false)
    setPending(true)
    try {
      await onSend()
    } catch {} finally {
      setPending(false)
    }
  }
  return <Tip content={<TooltipTable rows={[['signal', `SIG${signal}`], ['effect', signalDescriptions[signal]]]} title={label} />}>
    <button className={clsx(css.signalButton, css[tone], armed && css.armed)} disabled={disabled || pending} type='button' onClick={onClick}>
      <FiZap aria-hidden />
      {pending ? 'Sending…' : (armed ? `Confirm ${label.toLowerCase()}` : label)}
    </button>
  </Tip>
}
const ProcessDetails: FunctionComponent<Props> = ({dateFormat = 'technical', argvMode, childCount, cores, destructive, gone, history, onClose, onFilter, onSelectPid, onSignal, parent, row}) => {
  const [otherSignal, setOtherSignal] = useState<Signal>('HUP')
  const [copied, setCopied] = useState(false)
  const argv = presentArgv(row.argv, argvMode)
  const canSignal = destructive && !gone && row.pid > 1 && !row.isKernelThread && !row.isAgent
  const copy = async () => {
    if (!argv) {
      return
    }
    try {
      await navigator.clipboard.writeText(argv.join(' '))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  const send = (signal: Signal) => onSignal(row.pid, signal, row.startTicks)
  return <aside className={clsx(css.details, gone && css.gone)} aria-label={`Details of process ${row.pid}`}>
    <header className={css.header}>
      <div className={css.heading}>
        <div className={css.name}>{row.name}</div>
        <div className={css.meta}>
          PID {row.pid} · {row.user}
          {gone && <span className={css.goneBadge}>exited</span>}
        </div>
      </div>
      <button className={css.close} aria-label='Close details' title='Close (Esc)' type='button' onClick={onClose}><FiX /></button>
    </header>
    <div className={css.scroll}>
      <div className={css.charts}>
        <div className={css.chart}>
          <div className={css.chartLabel}><span>CPU</span><span style={{color: 'var(--cpu)'}}>{formatPercent(row.cpu)}</span></div>
          <Sparkline color='var(--cpu)' format={formatPercent} label='Process CPU' times={history?.times ?? []} values={history?.cpu ?? []} />
        </div>
        <div className={css.chart}>
          <div className={css.chartLabel}><span>Memory</span><span style={{color: 'var(--memory)'}}>{formatBytes(row.memory)}</span></div>
          <Sparkline color='var(--memory)' format={formatBytes} label='Process memory' times={history?.times ?? []} values={history?.memory ?? []} />
        </div>
      </div>
      <dl className={css.facts}>
        <dt>State</dt>
        <dd>{row.state} · {stateDescriptions[row.state] ?? 'unknown'}</dd>
        <dt>CPU</dt>
        <dd>{formatPercent(row.cpu)} of one core · {formatPercent(cores > 0 ? row.cpu / cores : 0)} of all {cores}</dd>
        <dt>Memory</dt>
        <dd>{formatBytes(row.memory)} resident · {formatPercent(row.memoryPercent)}</dd>
        {(row.readRate !== undefined || row.writeRate !== undefined) && <>
          <dt>Disk I/O</dt>
          <dd>{formatRate(row.readRate ?? 0)} read · {formatRate(row.writeRate ?? 0)} written</dd>
        </>}
        <dt>Threads</dt>
        <dd>{formatNumber(row.threads)} · last on CPU {row.processor}</dd>
        <dt>Priority</dt>
        <dd>nice {row.nice} · priority {row.priority}</dd>
        <dt>Started</dt>
        <dd>{formatDateTime(new Date(row.startedAt), dateFormat)} · {formatDuration(row.age)} ago</dd>
        <dt>User</dt>
        <dd>{row.user}{row.uid === undefined ? '' : ` (UID ${row.uid})`}</dd>
        <dt>Parent</dt>
        <dd>
          {parent ? <button className={css.link} type='button' onClick={() => onSelectPid(parent.pid)}><FiCornerLeftUp aria-hidden />{parent.name} ({parent.pid})</button> : (row.ppid === 0 ? 'none' : `PID ${row.ppid}`)}
          {childCount > 0 && <button className={css.link} type='button' onClick={() => onFilter(`ppid:${row.pid}`)}>{childCount} {childCount === 1 ? 'child' : 'children'}</button>}
        </dd>
        {row.orphan && <>
          <dt>Ancestry</dt>
          <dd>orphaned after losing {row.formerParent ? row.formerParent.name + ' (PID ' + row.formerParent.pid + ')' : 'an observed parent'}</dd>
        </>}
        {row.detached && <>
          <dt>Ancestry</dt>
          <dd>detached · observed from birth without a non-init parent</dd>
        </>}
        {row.container && <>
          <dt>Container</dt>
          <dd>
            <button className={css.link} type='button' onClick={() => onFilter(`container:${row.container?.name}`)}><FiBox aria-hidden />{row.container.name}</button>
            {row.container.image && <div className={css.sub}>{row.container.image}</div>}
            {row.container.status && <div className={css.sub}>{row.container.status}</div>}
            <div className={clsx(css.sub, css.mono)}>{row.container.id.slice(0, 12)}</div>
          </dd>
        </>}
      </dl>
      <div className={css.section}>
        <div className={css.sectionTitle}>
          Command
          {argv && argv.length > 0 && <button className={css.copy} type='button' onClick={copy}><FiCopy aria-hidden />{copied ? 'Copied' : 'Copy'}</button>}
        </div>
        {argv === undefined && <div className={css.muted}>hidden by the argv setting</div>}
        {argv?.length === 0 && <div className={css.muted}>{row.isKernelThread ? 'kernel thread without a command line' : 'no command line available'}</div>}
        {argv && argv.length > 0 && <ol className={css.argv}>
          {argv.map((argument, index) => <li key={index}><code>{argument}</code></li>)}
        </ol>}
      </div>
      <div className={css.section}>
        <div className={css.sectionTitle}>Signals</div>
        {destructive ? <>
          <div className={css.signals}>
            <SignalButton disabled={!canSignal} label='Terminate' signal='TERM' tone='normal' onSend={() => send('TERM')} />
            <SignalButton disabled={!canSignal} label='Kill' signal='KILL' tone='danger' onSend={() => send('KILL')} />
          </div>
          <div className={css.otherSignal}>
            <select aria-label='Signal' disabled={!canSignal} value={otherSignal} onChange={event => setOtherSignal(event.target.value as Signal)}>
              {signals.filter(signal => signal !== 'TERM' && signal !== 'KILL').map(signal => <option key={signal} value={signal}>SIG{signal} – {signalDescriptions[signal]}</option>)}
            </select>
            <SignalButton key={otherSignal} disabled={!canSignal} label='Send' signal={otherSignal} tone='normal' onSend={() => send(otherSignal)} />
          </div>
          {!canSignal && !gone && <div className={css.muted}>{row.isKernelThread ? 'Kernel threads cannot be signaled.' : 'PID 1 and the collector are protected.'}</div>}
        </> : <div className={css.muted}>The dashboard is read-only. Enable destructive actions in the setup to send signals.</div>}
      </div>
    </div>
  </aside>
}

export default ProcessDetails
