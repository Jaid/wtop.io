import type {Frame} from './types.ts'

export type ProcessHistory = {
  cpu: Array<number>
  /** frame counter of the last sample that contained the process */
  lastSeen: number
  memory: Array<number>
  times: Array<number>
}

/** frames a vanished process keeps its history, so the details of an exited process still show its last graphs */
const processGrace = 60
const push = (array: Array<number>, value: number, capacity: number) => {
  array.push(value)
  if (array.length > capacity) {
    array.splice(0, array.length - capacity)
  }
}

/**
 * Fixed-size time series of the most important frame values, aligned on a shared time axis.
 *
 * Arrays are mutated in place so canvas graphs can read them every animation frame without React re-rendering.
 */
export class History {
  capacity: number
  frameCount = 0
  processCapacity: number
  readonly processes = new Map<string, ProcessHistory>
  readonly series = new Map<string, Array<number>>
  readonly times: Array<number> = []
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
    }
    return array
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
      let history = this.processes.get(process.key)
      if (!history) {
        history = {
          times: [],
          cpu: [],
          memory: [],
          lastSeen: this.frameCount,
        }
        this.processes.set(process.key, history)
      }
      history.lastSeen = this.frameCount
      push(history.times, frame.receivedAt, this.processCapacity)
      push(history.cpu, process.cpu, this.processCapacity)
      push(history.memory, process.memory, this.processCapacity)
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
    push(this.times, time, this.capacity)
    for (const [name, array] of this.series) {
      const value = values[name]
      push(array, value === undefined ? Number.NaN : value, this.capacity)
    }
  }
  resize(capacity: number) {
    this.capacity = Math.max(2, capacity)
    if (this.times.length > this.capacity) {
      const excess = this.times.length - this.capacity
      this.times.splice(0, excess)
      for (const array of this.series.values()) {
        array.splice(0, excess)
      }
    }
  }
}
