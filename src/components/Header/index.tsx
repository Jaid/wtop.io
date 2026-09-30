import type {MonitorState} from '#src/lib/monitor/Monitor.ts'
import type {FunctionComponent, ReactNode} from 'react'

import clsx from 'clsx'
import {FiCommand, FiPause, FiPlay, FiRefreshCw, FiSettings, FiVolume2, FiVolumeX} from 'react-icons/fi'
import {Link} from 'wouter'

import {Tip, TooltipTable} from '#component/Tooltip'
import {formatBytes, formatDuration, formatInterval, formatNumber} from '#src/lib/format.ts'

import css from './style.module.sass'

const icon = '/icon.svg'

type Props = {
  demo: boolean
  endpoint: string
  interval: number
  onHelp: () => void
  onPause: () => void
  onRetry: () => void
  onSound: () => void
  setupHref: string
  sound: boolean
  state: MonitorState
}

const statusLabels: Record<MonitorState['status'], string> = {
  idle: 'idle',
  connecting: 'connecting',
  warming: 'measuring',
  live: 'live',
  reconnecting: 'reconnecting',
  error: 'offline',
}
const IconButton: FunctionComponent<{
  active?: boolean
  children: ReactNode
  label: string
  onClick: () => void
  tooltip: ReactNode
}> = ({active, children, label, onClick, tooltip}) => <Tip content={tooltip}>
  <button className={clsx(css.iconButton, active && css.active)} aria-label={label} aria-pressed={active} type='button' onClick={onClick}>{children}</button>
</Tip>
const Header: FunctionComponent<Props> = ({demo, endpoint, interval, onHelp, onPause, onRetry, onSound, setupHref, sound, state}) => {
  const {info, frame} = state
  const status = state.paused && state.status === 'live' ? 'paused' : state.status
  const hostTooltip = <TooltipTable
    rows={[
      ['endpoint', demo ? 'built-in simulation' : endpoint],
      info?.operatingSystem && ['system', info.operatingSystem],
      info?.kernel && ['kernel', info.kernel],
      info?.architecture && ['architecture', info.architecture],
      info?.cpuCount && ['CPUs', formatNumber(info.cpuCount)],
      info?.memoryTotal && ['memory', formatBytes(info.memoryTotal)],
      info?.dockerVersion && ['Docker', info.dockerVersion],
      frame && ['uptime', formatDuration(frame.uptime)],
    ]} title={info?.hostname ?? 'Host'}
  />
  const statusTooltip = <TooltipTable
    rows={[
      ['status', status],
      ['refresh', `every ${formatInterval(interval)}`],
      state.sampleDuration !== undefined && ['last sample took', formatInterval(Math.round(state.sampleDuration))],
      state.collectionDuration !== undefined && ['collector work', formatInterval(Math.round(state.collectionDuration))],
      ['samples', formatNumber(state.sampleCount)],
      state.error && ['last error', state.error.message],
    ]} title='Connection'
  />
  return <header className={css.header}>
    <Link className={css.brand} href={demo ? '/demo' : '/'}>
      <img className={css.logo} alt='' src={icon} />
      <span className={css.name}>wtop</span>
    </Link>
    <Tip className={css.host} content={hostTooltip}>
      <span className={css.hostname}>{info?.hostname ?? (demo ? 'simulation' : endpoint)}</span>
      {demo && <span className={css.demo}>demo</span>}
      {info?.operatingSystem && <span className={css.os}>{info.operatingSystem}</span>}
      {frame && <span className={css.uptime}>up {formatDuration(frame.uptime)}</span>}
    </Tip>
    <div className={css.spacer} />
    <Tip className={clsx(css.status, css[status])} content={statusTooltip}>
      <span className={css.dot} />
      {status === 'paused' ? 'paused' : statusLabels[state.status]}
      {state.status === 'live' && !state.paused && state.sampleDuration !== undefined && <span className={css.latency}>{formatInterval(Math.round(state.sampleDuration))}</span>}
    </Tip>
    {(state.status === 'reconnecting' || state.status === 'error') && <IconButton label='Retry now' tooltip='Retry now' onClick={onRetry}><FiRefreshCw /></IconButton>}
    <IconButton active={state.paused} label={state.paused ? 'Resume' : 'Pause'} tooltip={<TooltipTable rows={[['shortcut', <kbd key='space'>Space</kbd>]]} title={state.paused ? 'Resume updates' : 'Pause updates'} />} onClick={onPause}>
      {state.paused ? <FiPlay /> : <FiPause />}
    </IconButton>
    <IconButton active={sound} label={sound ? 'Mute sounds' : 'Enable sounds'} tooltip={sound ? 'Sound effects on' : 'Sound effects off'} onClick={onSound}>
      {sound ? <FiVolume2 /> : <FiVolumeX />}
    </IconButton>
    <IconButton label='Keyboard shortcuts' tooltip={<TooltipTable rows={[['shortcut', <kbd key='q'>?</kbd>]]} title='Keyboard shortcuts' />} onClick={onHelp}>
      <FiCommand />
    </IconButton>
    <Tip content='Setup'>
      <Link className={css.iconButton} aria-label='Setup' href={setupHref}><FiSettings /></Link>
    </Tip>
  </header>
}

export default Header
