/** cumulative CPU times in clock ticks, as found in /proc/stat */
export type CpuTimes = {
  guest: number
  idle: number
  iowait: number
  irq: number
  nice: number
  softirq: number
  steal: number
  system: number
  user: number
}

export type NetworkInterfaceCounters = {
  name: string
  rxBytes: number
  rxErrors: number
  rxPackets: number
  txBytes: number
  txErrors: number
  txPackets: number
}

export type DiskCounters = {
  aggregate?: boolean
  /** milliseconds spent doing I/O */
  ioMilliseconds: number
  name: string
  reads: number
  readSectors: number
  writes: number
  writeSectors: number
}

export type FilesystemUsage = {
  available: number
  device: string
  free: number
  mount: string
  size: number
  type: string
}

export type SensorReading = {
  celsius: number
  chip: string
  id?: string
  label: string
}

export type ProcessState = string & {} | 'D' | 'I' | 'P' | 'R' | 'S' | 'T' | 't' | 'W' | 'X' | 'Z'

export type RawProcess = {
  cmdline: Array<string>
  comm: string
  containerId?: string
  isKernelThread?: boolean
  nice: number
  pid: number
  ppid: number
  priority: number
  processor: number
  readBytes?: number
  /** resident set size in bytes */
  rss: number
  /** process start time in clock ticks after boot */
  startTicks: number
  state: ProcessState
  threads: number
  /** utime + stime in clock ticks */
  ticks: number
  uid?: number
  unit?: string
  writeBytes?: number
}

/** one sample of the complete host state, all counters cumulative where the kernel provides them cumulative */
export type Pressure = Partial<Record<'cpu' | 'io' | 'memory', Partial<Record<'full' | 'some', {
  avg10: number
  avg60: number
  avg300: number
  total: number
}>>>>

export type FanReading = {
  chip: string
  label: string
  rpm: number
}

export type RawSnapshot = {
  architecture?: string
  bootId?: string
  clockTicks: number
  contextSwitches: number
  cpu: CpuTimes
  cpuFrequencies: Array<number>
  cpuModel?: string
  cpus: Array<CpuTimes>
  disks: Array<DiskCounters>
  fans?: Array<FanReading>
  filesystems: Array<FilesystemUsage>
  gpus: Array<GpuReading>
  hostname?: string
  interfaces: Array<NetworkInterfaceCounters>
  kernel?: string
  load: [number, number, number]
  memory: MemoryInfo
  operatingSystem?: string
  pressure?: Pressure
  processes: Array<RawProcess>
  sensors: Array<SensorReading>
  tasks: {
    running: number
    total: number
  }
  /** seconds since boot, the time base of all rate calculations */
  uptime: number
  users: Record<number, string>
}
/** memory counters in bytes, as found in /proc/meminfo */
type MemoryInfo = {
  available: number
  buffers: number
  cached: number
  dirty: number
  free: number
  reclaimable: number
  shared: number
  swapCached: number
  swapFree: number
  swapTotal: number
  total: number
}

type GpuReading = {
  /** busy percentage 0–100, if the driver exposes it */
  busy?: number
  card: string
  device?: string
  state?: string
  vramTotal?: number
  vramUsed?: number
}

export const emptyCpuTimes = (): CpuTimes => ({
  user: 0,
  nice: 0,
  system: 0,
  idle: 0,
  iowait: 0,
  irq: 0,
  softirq: 0,
  steal: 0,
  guest: 0,
})
