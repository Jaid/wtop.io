import type {Frame} from './types.ts'

export type ProcessHistory = {
  cpu: ReadonlyArray<number>
  /** frame counter of the last sample that contained the process */
  lastSeen: number
  memory: ReadonlyArray<number>
  times: ReadonlyArray<number>
}

/** frames a vanished process keeps its history, so the details of an exited process still show its last graphs */
const processGrace = 60
const append = (array: ReadonlyArray<number>, value: number, capacity: number) => [...array.slice(Math.max(0, array.length + 1 - capacity)), value]

export type HistoryView = {
  get: (name: string) => ReadonlyArray<number>
  processes: ReadonlyMap<string, ProcessHistory>
  times: ReadonlyArray<number>
}

/**
 * Fixed-size time series of the most important frame values, aligned on a shared time axis.
 *
 * Published snapshots never mutate. React Compiler and held graphs can safely retain them.
 */
export class History {
  capacity: number
  frameCount = 0
  processCapacity: number
  readonly processes = new Map<string, ProcessHistory>
  readonly series = new Map<string, Array<number>>
  times: Array<number> = []
  private view?: HistoryView
  constructor(capacity: number, processCapacity = Math.min(capacity, 180)) {
    this.capacity = Math.max(2, capacity)
    this.processCapacity = Math.max(2, processCapacity)
  }
  get(name: string): Array<number> {
    let array = this.series.get(name)
    if (!array) {
      // series that appear later (e.g. a GPU waking up) start with gaps so they stay aligned
      array = Array.from({length: this.times.length}, () => Number.NaN)
      this.series.set(name, array)
      this.view = undefined
    }
    return array
  }
  getSnapshot(): HistoryView {
    if (!this.view) {
      const series = new Map(this.series)
      this.view = {
        times: this.times,
        processes: new Map(this.processes),
        get: name => series.get(name) ?? [],
      }
    }
    return this.view
  }
  pushFrame(frame: Frame) {
    const values: Record<string, number | undefined> = {
      cpu: frame.cpu.total,
      'cpu.user': frame.cpu.user,
      'cpu.system': frame.cpu.system,
      'cpu.iowait': frame.cpu.iowait,
      memory: frame.memory.percent,
      'memory.used': frame.memory.used,
      'memory.cached': frame.memory.cached,
      swap: frame.memory.swapPercent,
      'net.rx': frame.network.rx,
      'net.tx': frame.network.tx,
      'disk.read': frame.disk.read,
      'disk.write': frame.disk.write,
      'disk.busy': frame.disk.busy,
      'temp.cpu': frame.sensors.cpu,
      load: frame.load[0],
      frequency: frame.frequency.average,
    }
    for (const [index, core] of frame.cpu.cores.entries()) {
      values[`core.${index}`] = core.total
    }
    for (const gpu of frame.gpus) {
      values[`gpu.${gpu.card}.busy`] = gpu.busy
      values[`gpu.${gpu.card}.vram`] = gpu.vramPercent
    }
    for (const entry of frame.network.interfaces) {
      values[`if.${entry.name}.rx`] = entry.rx
      values[`if.${entry.name}.tx`] = entry.tx
    }
    for (const container of frame.containers) {
      values[`container.${container.id}.cpu`] = container.cpu
    }
    this.pushValues(frame.receivedAt, values)
    this.frameCount++
    for (const process of frame.processes) {
      const previous = this.processes.get(process.key)
      this.processes.set(process.key, {
        times: append(previous?.times ?? [], frame.receivedAt, this.processCapacity),
        cpu: append(previous?.cpu ?? [], process.cpu, this.processCapacity),
        memory: append(previous?.memory ?? [], process.memory, this.processCapacity),
        lastSeen: this.frameCount,
      })
    }
    for (const [key, history] of this.processes) {
      if (this.frameCount - history.lastSeen > processGrace) {
        this.processes.delete(key)
      }
    }
  }
  pushValues(time: number, values: Record<string, number | undefined>) {
    for (const name of Object.keys(values)) {
      this.get(name)
    }
    this.times = append(this.times, time, this.capacity)
    this.view = undefined
    for (const [name, array] of this.series) {
      const value = values[name]
      this.series.set(name, append(array, value === undefined ? Number.NaN : value, this.capacity))
    }
  }
  resize(capacity: number) {
    this.capacity = Math.max(2, capacity)
    if (this.times.length > this.capacity) {
      const excess = this.times.length - this.capacity
      this.times = this.times.slice(excess)
      this.view = undefined
      for (const [name, array] of this.series) {
        this.series.set(name, array.slice(excess))
      }
    }
  }
}
