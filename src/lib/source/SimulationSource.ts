import type {Signal} from '#src/lib/procfs/script.ts'
import type {HostInfo, ProgressListener, Sample} from './base/DataSource.ts'

import {DataSource} from './base/DataSource.ts'
import {SimulatedHost} from './simulation/SimulatedHost.ts'

export type SimulationSourceOptions = {
  /** injectable clock for tests */
  clock?: () => number
  seed?: number
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

/**
 * Feeds the dashboard from a built-in simulation of a busy home server.
 */
export class SimulationSource extends DataSource {
  readonly clock: () => number
  host?: SimulatedHost
  readonly id = 'simulation'
  lastAdvance = 0
  readonly options: SimulationSourceOptions
  /** whether live samples were handed out, after which the past must not change anymore */
  sampled = false
  readonly title = 'Simulation'
  constructor(options: SimulationSourceOptions = {}) {
    super()
    this.options = options
    this.clock = options.clock ?? Date.now
  }
  /**
   * Rewinds the model by `count` intervals and replays them, so the dashboard opens with populated graphs.
   */
  backfill(count: number, intervalMs: number): Array<Sample> {
    if (this.sampled) {
      return []
    }
    // replaying thousands of samples would block the page, a partially filled graph is fine
    count = Math.min(count, 480)
    const now = this.clock()
    const start = now - count * intervalMs
    this.host = new SimulatedHost({
      seed: this.options.seed,
      now: start,
    })
    const samples: Array<Sample> = []
    for (let index = 0; index < count; index++) {
      if (index > 0) {
        this.host.advance(intervalMs / 1000)
      }
      samples.push({
        snapshot: this.host.snapshot(),
        containers: this.host.containerInfos(),
        receivedAt: start + index * intervalMs,
      })
    }
    this.lastAdvance = start + (count - 1) * intervalMs
    return samples
  }
  catchUp() {
    const host = this.getHost()
    const now = this.clock()
    const elapsed = (now - this.lastAdvance) / 1000
    if (elapsed > 0) {
      host.advance(elapsed)
      this.lastAdvance = now
    }
    return host
  }
  async connect(onProgress: ProgressListener): Promise<HostInfo> {
    onProgress('Booting the simulated host', 'atlas')
    const host = this.getHost()
    // a tiny pause makes the connection state visible without slowing anything down
    await wait(120)
    return {
      hostname: 'atlas',
      operatingSystem: 'Ubuntu 24.04.3 LTS',
      kernel: '6.8.0-85-generic',
      architecture: 'x86_64',
      cpuCount: host.cores,
      memoryTotal: host.memory.total,
      dockerVersion: '28.5.1',
    }
  }
  getHost() {
    if (!this.host) {
      this.host = new SimulatedHost({
        seed: this.options.seed,
        now: this.clock(),
      })
      this.lastAdvance = this.clock()
    }
    return this.host
  }
  async sample(): Promise<Sample> {
    const host = this.catchUp()
    this.sampled = true
    return {
      snapshot: host.snapshot(),
      containers: host.containerInfos(),
      receivedAt: this.clock(),
    }
  }
  async signal(pid: number, signal: Signal, startTicks?: number) {
    const host = this.catchUp()
    if (startTicks !== undefined && !host.snapshot().processes.some(process => process.pid === pid && process.startTicks === startTicks)) {
      throw new Error('The selected simulated process has exited.')
    }
    host.signal(pid, signal)
  }
}
