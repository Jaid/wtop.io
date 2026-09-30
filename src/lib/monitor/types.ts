import type {FanReading, FilesystemUsage, Pressure, ProcessState, SensorReading} from '#src/lib/procfs/types.ts'
import type {ContainerInfo} from '#src/lib/source/base/DataSource.ts'

export type ProcessRow = {
  heavy?: boolean
  /** seconds since the process started */
  age: number
  /** raw argv, before applying the privacy mode */
  argv: Array<string>
  container?: ContainerInfo
  /** percentage of one core, like top */
  cpu: number
  isAgent: boolean
  isKernelThread: boolean
  /** pid plus start time, stable across PID reuse */
  key: string
  memory: number
  memoryPercent: number
  name: string
  nice: number
  pid: number
  ppid: number
  priority: number
  processor: number
  readRate?: number
  startedAt: number
  startTicks: number
  state: ProcessState
  threads: number
  uid?: number
  unit?: string
  user: string
  writeRate?: number
}

export type CpuBreakdown = {
  iowait: number
  steal: number
  system: number
  total: number
  user: number
}

export type InterfaceRates = {
  name: string
  rx: number
  rxTotal: number
  tx: number
  txTotal: number
  virtual: boolean
}

export type DiskRates = {
  busy: number
  name: string
  read: number
  write: number
}

export type GpuState = {
  busy?: number
  card: string
  device?: string
  state?: string
  vramPercent?: number
  vramTotal?: number
  vramUsed?: number
}

export type FilesystemState = FilesystemUsage & {
  percent: number
  used: number
}

export type ContainerFrame = {
  cpu: number
  id: string
  image: string
  memory: number
  name: string
  processes: number
  read: number
  write: number
}

export type Frame = {
  containers: Array<ContainerFrame>
  contextSwitchRate: number
  cpu: CpuBreakdown & {
    cores: Array<CpuBreakdown>
    model?: string
  }
  disk: {
    busy: number
    devices: Array<DiskRates>
    read: number
    write: number
  }
  fans: Array<FanReading>
  filesystems: Array<FilesystemState>
  frequency: {
    average: number
    cores: Array<number>
    max: number
  }
  gpus: Array<GpuState>
  /** seconds of host time between the two samples */
  interval: number
  load: [number, number, number]
  memory: {
    available: number
    buffers: number
    cached: number
    free: number
    percent: number
    shared: number
    swapPercent: number
    swapTotal: number
    swapUsed: number
    total: number
    used: number
  }
  network: {
    interfaces: Array<InterfaceRates>
    rx: number
    tx: number
  }
  pressure: Pressure
  processes: Array<ProcessRow>
  receivedAt: number
  sensors: {
    cpu?: number
    gpu?: number
    list: Array<SensorReading>
    storage?: number
  }
  tasks: {
    running: number
    total: number
  }
  uptime: number
}
