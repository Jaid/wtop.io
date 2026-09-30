import type {Signal} from '#src/lib/procfs/script.ts'
import type {RawSnapshot} from '#src/lib/procfs/types.ts'

export type HostInfo = {
  architecture?: string
  cpuCount?: number
  dockerVersion?: string
  hostname: string
  kernel?: string
  memoryTotal?: number
  operatingSystem?: string
}

export type ContainerInfo = {
  id: string
  image: string
  name: string
  state: string
  status: string
}

export type Sample = {
  containers: Map<string, ContainerInfo>
  /** client timestamp (ms since epoch) at which the sample was taken */
  receivedAt: number
  snapshot: RawSnapshot
}

export type ProgressListener = (message: string, detail?: string) => void

/**
 * Where the dashboard gets its data from.
 */
export abstract class DataSource {
  /** ID of the container that runs the collector itself, so its processes can be hidden */
  agentContainerId?: string
  abstract readonly id: string
  abstract readonly title: string
  /**
   * Returns synthetic past samples to prefill graphs, oldest first. Real hosts have no history, so this defaults to none.
   */
  backfill(_count: number, _intervalMs: number): Array<Sample> {
    return []
  }
  abstract connect(onProgress: ProgressListener): Promise<HostInfo>
  dispose() {}
  abstract sample(): Promise<Sample>
  abstract signal(pid: number, signal: Signal, startTicks?: number): Promise<void>
}
