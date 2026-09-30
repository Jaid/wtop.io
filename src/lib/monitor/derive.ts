import type {CpuTimes, RawProcess, SensorReading} from '#src/lib/procfs/types.ts'
import type {ContainerInfo, Sample} from '#src/lib/source/base/DataSource.ts'
import type {ContainerFrame, CpuBreakdown, DiskRates, Frame, InterfaceRates, ProcessRow} from './types.ts'

import {heartbeatFile} from '#src/lib/procfs/script.ts'

const processKey = (process: Pick<RawProcess, 'pid' | 'startTicks'>) => `${process.pid}:${process.startTicks}`
const clampDelta = (current: number, previous: number | undefined) => {
  if (previous === undefined) {
    return 0
  }
  // counters reset when devices are recreated, so negative deltas mean “unknown”
  return Math.max(0, current - previous)
}
const sumTimes = (times: CpuTimes) => times.user + times.nice + times.system + times.idle + times.iowait + times.irq + times.softirq + times.steal

export const cpuBreakdown = (current: CpuTimes, previous: CpuTimes | undefined): CpuBreakdown => {
  if (!previous) {
    return {
      total: 0,
      user: 0,
      system: 0,
      iowait: 0,
      steal: 0,
    }
  }
  const total = sumTimes(current) - sumTimes(previous)
  if (total <= 0) {
    return {
      total: 0,
      user: 0,
      system: 0,
      iowait: 0,
      steal: 0,
    }
  }
  const delta = (key: keyof CpuTimes) => Math.max(0, current[key] - previous[key]) / total * 100
  const idle = delta('idle')
  const iowait = delta('iowait')
  return {
    total: Math.min(100, Math.max(0, 100 - idle - iowait)),
    user: delta('user') + delta('nice'),
    system: delta('system') + delta('irq') + delta('softirq'),
    iowait,
    steal: delta('steal'),
  }
}

const virtualInterfacePattern = /^(?:br-|cali|cni|docker|dummy|flannel|kube|lo|lxc|podman|tailscale|tap|tun|veth|virbr|vxlan|wg|zt)/

export const isVirtualInterface = (name: string) => virtualInterfacePattern.test(name)

const cpuSensorPriority: Array<[chip: RegExp, label: RegExp]> = [
  [/^k10temp$|^zenpower$/, /^(?:Tctl|Tdie)$/],
  [/^coretemp$/, /^Package id \d+$/],
  [/^(?:cpu-thermal|cpu_thermal|soc_thermal)$/, /./],
  [/^coretemp$|^k10temp$/, /./],
  [/^acpitz$/, /./],
]
const pickSensor = (sensors: Array<SensorReading>, rules: Array<[RegExp, RegExp]>) => {
  for (const [chip, label] of rules) {
    const matches = sensors.filter(sensor => chip.test(sensor.chip) && label.test(sensor.label))
    if (matches.length > 0) {
      return Math.max(...matches.map(sensor => sensor.celsius))
    }
  }
}

/**
 * Finds the processes of wtop’s own agent: by container ID, or by the heartbeat marker in the command line plus all descendants (for agents running in a private cgroup namespace).
 */
export const findAgentPids = (processes: ReadonlyArray<RawProcess>, agentContainerId?: string) => {
  const agent = new Set<number>
  const children = new Map<number, Array<number>>
  for (const process of processes) {
    const list = children.get(process.ppid) ?? []
    list.push(process.pid)
    children.set(process.ppid, list)
  }
  const queue: Array<number> = []
  for (const process of processes) {
    if (agentContainerId && process.containerId === agentContainerId || process.cmdline[0]?.split('/').at(-1) === 'bun' && process.cmdline.some(argument => argument.includes(heartbeatFile))) {
      queue.push(process.pid)
    }
  }
  while (queue.length > 0) {
    const pid = queue.pop()!
    if (agent.has(pid)) {
      continue
    }
    agent.add(pid)
    queue.push(...children.get(pid) ?? [])
  }
  return agent
}

export type DeriveOptions = {
  agentContainerId?: string
}

/**
 * Turns two consecutive samples into rates, percentages and presentable process rows.
 */
export const deriveFrame = (previous: Sample | undefined, current: Sample, options: DeriveOptions = {}): Frame => {
  const snapshot = current.snapshot
  const before = previous?.snapshot
  const interval = before ? Math.max(0, snapshot.uptime - before.uptime) : 0
  const perSecond = (delta: number) => (interval > 0 ? delta / interval : 0)
  const cpu = cpuBreakdown(snapshot.cpu, before?.cpu)
  const cores = snapshot.cpus.map((times, index) => cpuBreakdown(times, before?.cpus[index]))
  const memory = snapshot.memory
  const used = Math.max(0, memory.total - (memory.available || memory.free + memory.buffers + memory.cached))
  const swapUsed = Math.max(0, memory.swapTotal - memory.swapFree)
  const previousInterfaces = new Map(before?.interfaces.map(counters => [counters.name, counters]))
  const interfaces: Array<InterfaceRates> = snapshot.interfaces.map(counters => {
    const old = previousInterfaces.get(counters.name)
    return {
      name: counters.name,
      rx: perSecond(clampDelta(counters.rxBytes, old?.rxBytes)),
      tx: perSecond(clampDelta(counters.txBytes, old?.txBytes)),
      rxTotal: counters.rxBytes,
      txTotal: counters.txBytes,
      virtual: isVirtualInterface(counters.name),
    }
  })
  const physical = interfaces.filter(entry => !entry.virtual)
  const previousDisks = new Map(before?.disks.map(disk => [disk.name, disk]))
  const devices: Array<DiskRates> = snapshot.disks.map(disk => {
    const old = previousDisks.get(disk.name)
    return {
      name: disk.name,
      read: perSecond(clampDelta(disk.readSectors, old?.readSectors) * 512),
      write: perSecond(clampDelta(disk.writeSectors, old?.writeSectors) * 512),
      busy: interval > 0 ? Math.min(100, clampDelta(disk.ioMilliseconds, old?.ioMilliseconds) / (interval * 10)) : 0,
    }
  })
  const containers = current.containers
  const previousProcesses = new Map(before?.processes.map(process => [processKey(process), process]))
  const ticksPerSecond = snapshot.clockTicks
  const agentPids = findAgentPids(snapshot.processes, options.agentContainerId)
  const processes: Array<ProcessRow> = snapshot.processes.map(process => {
    const key = processKey(process)
    const old = previousProcesses.get(key)
    let cpuPercent = 0
    let readRate: number | undefined
    let writeRate: number | undefined
    if (interval > 0) {
      if (old) {
        cpuPercent = clampDelta(process.ticks, old.ticks) / (interval * ticksPerSecond) * 100
        if (process.readBytes !== undefined && old.readBytes !== undefined) {
          readRate = perSecond(clampDelta(process.readBytes, old.readBytes))
        }
        if (process.writeBytes !== undefined && old.writeBytes !== undefined) {
          writeRate = perSecond(clampDelta(process.writeBytes, old.writeBytes))
        }
      } else if (before && process.startTicks / ticksPerSecond >= before.uptime) {
        // started after the previous sample, so everything it consumed happened within the interval
        const lived = Math.max(snapshot.uptime - process.startTicks / ticksPerSecond, 0.01)
        cpuPercent = process.ticks / (lived * ticksPerSecond) * 100
        readRate = process.readBytes === undefined ? undefined : process.readBytes / lived
        writeRate = process.writeBytes === undefined ? undefined : process.writeBytes / lived
      }
    }
    const age = Math.max(0, snapshot.uptime - process.startTicks / ticksPerSecond)
    let container: ContainerInfo | undefined
    if (process.containerId) {
      container = containers.get(process.containerId) ?? {
        id: process.containerId,
        name: process.containerId.slice(0, 12),
        image: '',
        state: 'unknown',
        status: '',
      }
    }
    const isKernelThread = process.isKernelThread ?? (process.pid === 2 || process.ppid === 2 && process.cmdline.length === 0)
    return {
      key,
      startTicks: process.startTicks,
      unit: process.unit,
      pid: process.pid,
      ppid: process.ppid,
      name: process.comm,
      state: process.state,
      uid: process.uid,
      user: process.uid === undefined ? '?' : snapshot.users[process.uid] ?? String(process.uid),
      cpu: Math.min(cpuPercent, 100 * Math.max(1, snapshot.cpus.length)),
      memory: process.rss,
      memoryPercent: memory.total > 0 ? process.rss / memory.total * 100 : 0,
      threads: process.threads,
      nice: process.nice,
      priority: process.priority,
      processor: process.processor,
      readRate,
      writeRate,
      age,
      startedAt: current.receivedAt - age * 1000,
      argv: process.cmdline,
      container,
      isAgent: agentPids.has(process.pid),
      isKernelThread,
    }
  })
  const frequencies = snapshot.cpuFrequencies
  const gpuSensor = pickSensor(snapshot.sensors, [[/^amdgpu$/, /^junction$/], [/^amdgpu$|^nouveau$|^radeon$/, /./]])
  const storageSensor = pickSensor(snapshot.sensors, [[/^drivetemp$|^nvme$/, /./]])
  const grouped = new Map<string, ContainerFrame>
  for (const process of processes) {
    if (!process.container || process.isAgent) {
      continue
    }
    const container = process.container
    const total = grouped.get(container.id) ?? {
      id: container.id,
      name: container.name,
      image: container.image,
      composeProject: container.composeProject,
      composeService: container.composeService,
      cpu: 0,
      memory: 0,
      processes: 0,
      read: 0,
      write: 0,
    }
    total.cpu += process.cpu
    total.memory += process.memory
    total.processes++
    total.read += process.readRate ?? 0
    total.write += process.writeRate ?? 0
    grouped.set(container.id, total)
  }
  const aggregateDevices = devices.filter(device => snapshot.disks.find(disk => disk.name === device.name)?.aggregate !== false)
  return {
    containers: [...grouped.values()].toSorted((a, b) => a.name.localeCompare(b.name)),
    fans: snapshot.fans ?? [],
    pressure: snapshot.pressure ?? {},
    receivedAt: current.receivedAt,
    interval,
    uptime: snapshot.uptime,
    cpu: {
      ...cpu,
      cores,
      model: snapshot.cpuModel,
    },
    memory: {
      total: memory.total,
      used,
      available: memory.available,
      free: memory.free,
      cached: memory.cached + memory.reclaimable,
      buffers: memory.buffers,
      shared: memory.shared,
      percent: memory.total > 0 ? used / memory.total * 100 : 0,
      swapTotal: memory.swapTotal,
      swapUsed,
      swapPercent: memory.swapTotal > 0 ? swapUsed / memory.swapTotal * 100 : 0,
    },
    load: snapshot.load,
    tasks: snapshot.tasks,
    network: {
      interfaces,
      rx: physical.reduce((sum, entry) => sum + entry.rx, 0),
      tx: physical.reduce((sum, entry) => sum + entry.tx, 0),
    },
    disk: {
      devices,
      read: aggregateDevices.reduce((sum, device) => sum + device.read, 0),
      write: aggregateDevices.reduce((sum, device) => sum + device.write, 0),
      busy: aggregateDevices.reduce((max, device) => Math.max(max, device.busy), 0),
    },
    filesystems: snapshot.filesystems.map(filesystem => {
      const usedSpace = Math.max(0, filesystem.size - filesystem.free)
      // like df: used / (used + available), because reserved blocks are unavailable to users
      const capacity = usedSpace + filesystem.available
      return {
        ...filesystem,
        used: usedSpace,
        percent: capacity > 0 ? usedSpace / capacity * 100 : 0,
      }
    }),
    sensors: {
      list: snapshot.sensors,
      cpu: pickSensor(snapshot.sensors, cpuSensorPriority),
      gpu: gpuSensor,
      storage: storageSensor,
    },
    frequency: {
      cores: frequencies,
      average: frequencies.length > 0 ? frequencies.reduce((sum, value) => sum + value, 0) / frequencies.length : 0,
      max: frequencies.length > 0 ? Math.max(...frequencies) : 0,
    },
    gpus: snapshot.gpus.map(gpu => ({
      ...gpu,
      vramPercent: gpu.vramTotal && gpu.vramUsed !== undefined ? gpu.vramUsed / gpu.vramTotal * 100 : undefined,
    })),
    contextSwitchRate: perSecond(clampDelta(snapshot.contextSwitches, before?.contextSwitches)),
    processes,
  }
}
