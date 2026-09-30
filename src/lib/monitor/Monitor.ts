import type {Signal} from '#src/lib/procfs/script.ts'
import type {DataSource, HostInfo, Sample} from '#src/lib/source/base/DataSource.ts'
import type {HistoryView} from './History.ts'
import type {Frame} from './types.ts'

import {DockerError} from '#src/lib/docker/DockerClient.ts'

import {nextSampleTime} from './cadence.ts'
import {deriveFrame} from './derive.ts'
import {History} from './History.ts'
import {ProcessAncestry} from './ProcessAncestry.ts'
import {RecentLoad} from './RecentLoad.ts'

export type MonitorError = {
  hint?: string
  message: string
}

export type MonitorState = {
  collectionDuration?: number
  error?: MonitorError
  /** consecutive failed attempts */
  failures: number
  frame?: Frame
  history?: HistoryView
  info?: HostInfo
  lastSuccessAt?: number
  paused: boolean
  progress?: {
    detail?: string
    message: string
  }
  /** client timestamp of the next automatic retry */
  retryAt?: number
  sampleCount: number
  /** milliseconds the last sample took, a rough latency indicator */
  sampleDuration?: number
  status: MonitorStatus
  version: number
}

export type MonitorEvent = {
  error?: MonitorError
  pid?: number
  signal?: Signal
  type: 'connected' | 'lost' | 'restored' | 'signal-failed' | 'signal-sent'
}

export type MonitorOptions = {
  /** seconds of history kept for graphs */
  historySeconds: number
  /** milliseconds between samples */
  interval: number
}

type MonitorStatus = 'connecting' | 'error' | 'idle' | 'live' | 'reconnecting' | 'warming'

export const toMonitorError = (error: unknown): MonitorError => {
  if (error instanceof DockerError) {
    return {
      message: error.message,
      hint: error.hint,
    }
  }
  if (Error.isError(error)) {
    return {message: error.message}
  }
  return {message: String(error)}
}

/**
 * Polls a data source, derives frames and keeps history. Framework-agnostic, exposed to React through `subscribe`/`getState`.
 */
export class Monitor {
  readonly eventListeners = new Set<(event: MonitorEvent) => void>
  generation = 0
  getState = () => this.state
  history: History
  readonly historySeconds: number
  inFlight = false
  interval: number
  readonly listeners = new Set<() => void>
  previous?: Sample
  /** a tick was requested while another one was in flight */
  queued = false
  readonly ancestry = new ProcessAncestry
  readonly recentLoad = new RecentLoad
  running = false
  readonly source: DataSource
  state: MonitorState = {
    status: 'idle',
    paused: false,
    failures: 0,
    sampleCount: 0,
    version: 0,
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  suspended = false
  timer?: ReturnType<typeof setTimeout>
  constructor(source: DataSource, options: MonitorOptions) {
    this.source = source
    this.interval = Math.max(100, options.interval)
    this.historySeconds = options.historySeconds
    this.history = new History(Math.ceil(options.historySeconds * 1000 / this.interval) + 2)
  }
  async connect(generation: number) {
    this.setState({
      status: 'connecting',
      progress: {message: 'Connecting'},
      retryAt: undefined,
    })
    try {
      const info = await this.source.connect((message, detail) => {
        if (generation === this.generation) {
          this.setState({progress: {
            message,
            detail,
          }})
        }
      })
      if (generation !== this.generation) {
        return
      }
      for (const sample of this.source.backfill(this.history.capacity, this.interval)) {
        this.ingest(sample, true)
      }
      this.setState({
        info,
        status: this.previous ? 'live' : 'warming',
        progress: {message: 'Taking the first sample'},
        error: undefined,
        failures: 0,
      })
      this.emit({type: 'connected'})
      this.scheduleNext(generation)
    } catch (error) {
      if (generation !== this.generation) {
        return
      }
      const failures = this.state.failures + 1
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures, 5))
      this.setState({
        status: 'error',
        error: toMonitorError(error),
        failures,
        retryAt: Date.now() + delay,
      })
      this.schedule(delay, () => void this.connect(generation))
    }
  }
  emit(event: MonitorEvent) {
    for (const listener of this.eventListeners) {
      listener(event)
    }
  }
  ingest(sample: Sample, silent = false) {
    let previous = this.previous
    if (previous && (sample.snapshot.uptime < previous.snapshot.uptime || sample.snapshot.bootId && previous.snapshot.bootId && sample.snapshot.bootId !== previous.snapshot.bootId)) {
      this.history = new History(this.history.capacity)
      this.ancestry.clear()
      this.recentLoad.clear()
      previous = undefined
    }
    this.previous = sample
    if (!previous) {
      return
    }
    const frame = deriveFrame(previous, sample, {agentContainerId: this.source.agentContainerId})
    frame.processes = this.ancestry.observe(frame.processes, frame.interval)
    this.recentLoad.observe(frame.processes, sample.receivedAt)
    frame.processes = frame.processes.map(row => ({
      ...row,
      heavy: this.recentLoad.isHeavy(row.key, sample.receivedAt),
    }))
    this.history.pushFrame(frame)
    if (!silent) {
      this.setState({
        frame,
        history: this.history.getSnapshot(),
        status: 'live',
        sampleCount: this.state.sampleCount + 1,
        lastSuccessAt: Date.now(),
      })
    } else {
      this.state = {
        ...this.state,
        frame,
        history: this.history.getSnapshot(),
      }
    }
  }
  onEvent(listener: (event: MonitorEvent) => void) {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }
  /** retries immediately instead of waiting for the backoff */
  retry() {
    if (!this.running) {
      return
    }
    this.generation++
    const generation = this.generation
    clearTimeout(this.timer)
    if (this.state.info) {
      this.setState({retryAt: undefined})
      void this.tick(generation)
    } else {
      void this.connect(generation)
    }
  }
  schedule(delay: number, run: () => void) {
    clearTimeout(this.timer)
    this.timer = setTimeout(run, Math.max(0, delay))
  }
  scheduleNext(generation = this.generation, earliest = Date.now()) {
    const at = nextSampleTime(earliest, this.interval)
    this.schedule(at - Date.now(), () => void this.tick(generation))
  }
  setInterval(interval: number) {
    this.interval = Math.max(100, interval)
    this.history.resize(Math.ceil(this.historySeconds * 1000 / this.interval) + 2)
    if (this.running && this.state.info && !this.inFlight && !this.suspended && !this.state.paused) {
      this.scheduleNext()
    }
  }
  setPaused(paused: boolean) {
    this.setState({paused})
    if (paused) {
      clearTimeout(this.timer)
    }
    if (!paused && this.running) {
      this.scheduleNext()
    }
  }
  setState(patch: Partial<MonitorState>) {
    this.state = {
      ...this.state,
      ...patch,
      version: this.state.version + 1,
    }
    for (const listener of this.listeners) {
      listener()
    }
  }
  setSuspended(suspended: boolean) {
    this.suspended = suspended
    if (suspended) {
      clearTimeout(this.timer)
    } else if (this.running) {
      this.scheduleNext()
    }
  }
  async signal(pid: number, signal: Signal, startTicks: number) {
    try {
      const row = this.state.frame?.processes.find(process => process.pid === pid && process.startTicks === startTicks)
      if (!row || row.isAgent || row.isKernelThread || row.pid <= 1) {
        throw new Error('The selected process has exited or is protected. Refresh before sending a signal.')
      }
      await this.source.signal(pid, signal, startTicks)
      this.emit({
        type: 'signal-sent',
        pid,
        signal,
      })
    } catch (error) {
      const monitorError = toMonitorError(error)
      this.emit({
        type: 'signal-failed',
        pid,
        signal,
        error: monitorError,
      })
      throw error
    }
    // show the effect right away instead of waiting for the next regular sample
    if (this.running) {
      if (this.inFlight) {
        this.queued = true
      } else {
        this.scheduleNext()
      }
    }
  }
  start() {
    if (this.running) {
      return
    }
    this.running = true
    this.generation++
    void this.connect(this.generation)
  }
  stop() {
    this.running = false
    this.generation++
    clearTimeout(this.timer)
    this.source.dispose()
  }
  async tick(generation: number) {
    if (generation !== this.generation || !this.running) {
      return
    }
    if (this.inFlight) {
      this.queued = true
      return
    }
    if (this.suspended || this.state.paused && this.state.frame) {
      return
    }
    this.inFlight = true
    const started = performance.now()
    let retryDelay: number | undefined
    let rescheduled = false
    try {
      const sample = await this.source.sample()
      if (generation !== this.generation) {
        return
      }
      const wasFailing = this.state.failures > 0
      const warming = !this.previous
      this.ingest(sample)
      const duration = performance.now() - started
      this.setState({
        sampleDuration: duration,
        collectionDuration: sample.collectionMs,
        failures: 0,
        error: undefined,
        retryAt: undefined,
        status: warming ? 'warming' : 'live',
      })
      if (wasFailing) {
        this.emit({type: 'restored'})
      }
    } catch (error) {
      if (generation !== this.generation) {
        return
      }
      const failures = this.state.failures + 1
      retryDelay = Math.min(30_000, 1000 * 2 ** Math.min(failures - 1, 5))
      const monitorError = toMonitorError(error)
      this.setState({
        status: 'reconnecting',
        error: monitorError,
        failures,
        retryAt: nextSampleTime(Date.now() + retryDelay, this.interval),
      })
      if (failures === 1) {
        this.emit({
          type: 'lost',
          error: monitorError,
        })
      }
    } finally {
      this.inFlight = false
      // a retry or signal asked for a sample while this one was running, possibly in a newer generation
      if (this.queued && this.running) {
        this.queued = false
        rescheduled = true
        this.scheduleNext()
      }
    }
    if (!rescheduled && generation === this.generation && this.running) {
      this.scheduleNext(generation, Date.now() + (retryDelay ?? 0))
    }
  }
}
