import type {Signal} from '#src/lib/procfs/script.ts'
import type {CpuTimes, DiskCounters, FilesystemUsage, NetworkInterfaceCounters, RawProcess, RawSnapshot} from '#src/lib/procfs/types.ts'
import type {ContainerInfo} from '../base/DataSource.ts'

import {emptyCpuTimes} from '#src/lib/procfs/types.ts'

import {Random} from './random.ts'

const clockTicks = 100
const gigabyte = 1_000_000_000
const megabyte = 1_000_000

export type SimulatedHostOptions = {
  /** wall clock in ms since epoch, used for the day/night curve */
  now?: number
  seed?: number
}

type Burst = {
  chance: number
  cpu: number
  duration: [number, number]
  gpu?: number
  read?: number
  write?: number
}

type Profile = {
  burst?: Burst
  /** mean number of cores used */
  cpu: number
  /** follows the day/night traffic curve */
  diurnal?: boolean
  memory: number
  memoryJitter?: number
  noise?: number
  read?: number
  write?: number
}

type SimProcess = {
  burstLeft: number
  burstStrength: number
  cmdline: Array<string>
  comm: string
  container?: string
  dieAt?: number
  kernel: boolean
  load: number
  nice: number
  pid: number
  ppid: number
  processor: number
  profile: Profile
  readBytes: number
  /** reacts to SIGHUP by reloading instead of terminating */
  reloadsOnHup?: boolean
  respawn?: () => void
  rss: number
  startTicks: number
  stopped: boolean
  threads: number
  ticks: number
  uid: number
  writeBytes: number
}

type SpawnOptions = {
  cmdline?: Array<string>
  comm: string
  container?: string
  kernel?: boolean
  lifetime?: number
  nice?: number
  ppid: number
  profile?: Partial<Profile>
  reloadsOnHup?: boolean
  respawn?: () => void
  threads?: number
  uid?: number
}

type SimContainer = {
  id: string
  image: string
  key: string
  name: string
  startedAt: number
}

const users: Record<number, string> = {
  0: 'root',
  1: 'daemon',
  33: 'www-data',
  100: 'systemd-network',
  101: 'systemd-resolve',
  102: 'messagebus',
  103: 'systemd-timesync',
  105: 'syslog',
  110: 'tss',
  113: 'node-exporter',
  998: 'ollama',
  1000: 'jaid',
  65_534: 'nobody',
}
const kernelThreadNames = (cores: number) => {
  const names = ['rcu_gp', 'rcu_par_gp', 'slub_flushwq', 'netns', 'mm_percpu_wq', 'rcu_tasks_kthread', 'rcu_preempt', 'kdevtmpfs', 'inet_frag_wq', 'kauditd', 'khungtaskd', 'oom_reaper', 'writeback', 'kcompactd0', 'ksmd', 'khugepaged', 'kintegrityd', 'kblockd', 'blkcg_punt_bio', 'kswapd0', 'ecryptfs-kthread', 'kthrotld', 'nvme-wq', 'nvme-reset-wq', 'nvme-delete-wq', 'jbd2/nvme0n1p2-8', 'ext4-rsv-conver', 'irq/124-amdgpu', 'amdgpu-reset-de', 'ttm', 'card1-crtc0', 'jbd2/sda1-8', 'kworker/u64:3-events_unbound', 'kworker/u65:0-flush-259:0']
  for (let core = 0; core < Math.min(cores, 8); core++) {
    names.push(`ksoftirqd/${core}`, `migration/${core}`, `kworker/${core}:1-events`, `cpuhp/${core}`)
  }
  return names
}

type ContainerStartContext = {
  age: number
  container: ContainerKey
  host: SimulatedHost
  parent: number
  restart: () => void
}

type ContainerDefinition = {
  image: string
  name: string
  start: (context: ContainerStartContext) => void
}

/**
 * A self-contained model of a busy home server that produces the same cumulative counters as the Linux kernel.
 */
export class SimulatedHost {
  containers = new Map<string, SimContainer>
  contextSwitches = 18_000_000_000
  coreFrequencies: Array<number>
  readonly cores = 24
  cpu: Array<CpuTimes>
  disks: Array<DiskCounters>
  diskState = {
    nvmeRead: 0,
    nvmeWrite: 0,
    sdaRead: 0,
    sdaWrite: 0,
  }
  filesystems: Array<FilesystemUsage>
  gpuBusy = 0
  interfaces: Array<NetworkInterfaceCounters>
  load: [number, number, number] = [3.2, 2.9, 2.6]
  memory = {
    total: 67_108_864 * 1024,
    cache: 21 * gigabyte,
    buffers: 1.3 * gigabyte,
    swapUsed: 310 * megabyte,
  }
  network = {
    backupLeft: 0,
    downloadLeft: 0,
  }
  nextPid = 1
  now: number
  pendingRespawns: Array<{
    at: number
    run: () => void
  }> = []
  processes = new Map<number, SimProcess>
  random: Random
  temperatures = {
    cpu: 46,
    ccd1: 42,
    ccd2: 40,
    nvme: 38,
    gpuEdge: 41,
    gpuJunction: 44,
    gpuMemory: 48,
  }
  uptime: number
  constructor(options: SimulatedHostOptions = {}) {
    this.random = new Random(options.seed ?? 0x77_70_6F_70)
    this.now = options.now ?? Date.now()
    this.uptime = 3 * 86_400 + 4 * 3600 + this.random.int(0, 3600)
    this.cpu = Array.from({length: this.cores}, () => {
      const times = emptyCpuTimes()
      const busy = this.uptime * clockTicks * this.random.range(0.08, 0.16)
      times.user = busy * 0.72
      times.system = busy * 0.22
      times.softirq = busy * 0.04
      times.irq = busy * 0.02
      times.iowait = this.uptime * clockTicks * 0.004
      times.idle = this.uptime * clockTicks - busy - times.iowait
      return times
    })
    this.coreFrequencies = Array.from({length: this.cores}, () => this.random.range(550, 3600))
    this.interfaces = [
      {
        name: 'lo',
        rxBytes: 38 * gigabyte,
        txBytes: 38 * gigabyte,
        rxPackets: 51_000_000,
        txPackets: 51_000_000,
        rxErrors: 0,
        txErrors: 0,
      },
      {
        name: 'enp5s0',
        rxBytes: 912 * gigabyte,
        txBytes: 318 * gigabyte,
        rxPackets: 740_000_000,
        txPackets: 402_000_000,
        rxErrors: 0,
        txErrors: 0,
      },
      {
        name: 'wlp6s0',
        rxBytes: 0,
        txBytes: 0,
        rxPackets: 0,
        txPackets: 0,
        rxErrors: 0,
        txErrors: 0,
      },
      {
        name: 'tailscale0',
        rxBytes: 14 * gigabyte,
        txBytes: 41 * gigabyte,
        rxPackets: 18_000_000,
        txPackets: 29_000_000,
        rxErrors: 0,
        txErrors: 0,
      },
      {
        name: 'docker0',
        rxBytes: 61 * gigabyte,
        txBytes: 240 * gigabyte,
        rxPackets: 88_000_000,
        txPackets: 120_000_000,
        rxErrors: 0,
        txErrors: 0,
      },
      {
        name: 'br-4f2a91c07e13',
        rxBytes: 22 * gigabyte,
        txBytes: 19 * gigabyte,
        rxPackets: 30_000_000,
        txPackets: 27_000_000,
        rxErrors: 0,
        txErrors: 0,
      },
    ]
    this.disks = [
      {
        name: 'nvme0n1',
        reads: 41_000_000,
        readSectors: 2_900_000_000,
        writes: 88_000_000,
        writeSectors: 5_100_000_000,
        ioMilliseconds: 19_000_000,
      },
      {
        name: 'sda',
        reads: 3_100_000,
        readSectors: 900_000_000,
        writes: 2_200_000,
        writeSectors: 1_400_000_000,
        ioMilliseconds: 7_000_000,
      },
    ]
    this.filesystems = [
      {
        mount: '/',
        device: '/dev/nvme0n1p2',
        type: 'ext4',
        size: 1_967_000 * megabyte,
        free: 1_214_000 * megabyte,
        available: 1_114_000 * megabyte,
      },
      {
        mount: '/boot/efi',
        device: '/dev/nvme0n1p1',
        type: 'vfat',
        size: 1071 * megabyte,
        free: 1004 * megabyte,
        available: 1004 * megabyte,
      },
      {
        mount: '/mnt/backup',
        device: '/dev/sda1',
        type: 'ext4',
        size: 7_881_000 * megabyte,
        free: 2_263_000 * megabyte,
        available: 1_869_000 * megabyte,
      },
    ]
    this.boot()
  }
  get ticksNow() {
    return Math.floor(this.uptime * clockTicks)
  }
  accountCpu(dt: number, coreLoads: Array<number>, niceLoads: Array<number>, ioRate: number) {
    const tickBudget = dt * clockTicks
    for (const [index, times] of this.cpu.entries()) {
      const load = Math.min(0.995, coreLoads[index])
      const busy = load * tickBudget
      const nice = Math.min(busy, niceLoads[index] * tickBudget)
      const iowait = Math.min((1 - load) * tickBudget, ioRate / (400 * megabyte) * tickBudget * 0.08 * this.random.range(0, 2))
      times.nice += nice
      times.user += (busy - nice) * 0.74
      times.system += (busy - nice) * 0.21
      times.softirq += (busy - nice) * 0.035
      times.irq += (busy - nice) * 0.015
      times.iowait += iowait
      times.idle += tickBudget - busy - iowait
      const target = load > 0.05 ? 3400 + 2100 * Math.min(1, load * 1.3) : this.random.range(550, 3000)
      this.coreFrequencies[index] += (target - this.coreFrequencies[index]) * Math.min(1, dt * 4) + this.random.gauss() * 25
    }
  }
  accountDisks(dt: number, read: number, write: number) {
    const [nvme, hdd] = this.disks
    const backingUp = this.network.backupLeft > 0
    const nvmeRead = read + 1.5 * megabyte * this.random.range(0, 1)
    const nvmeWrite = write + 3 * megabyte * this.random.range(0.2, 1.4)
    const hddWrite = backingUp ? this.random.range(20, 60) * megabyte : (this.random.chance(0.05) ? 200_000 : 0)
    this.diskState = {
      nvmeRead,
      nvmeWrite,
      sdaRead: 0,
      sdaWrite: hddWrite,
    }
    nvme.readSectors += nvmeRead * dt / 512
    nvme.writeSectors += nvmeWrite * dt / 512
    nvme.reads += nvmeRead * dt / 65_536
    nvme.writes += nvmeWrite * dt / 32_768
    nvme.ioMilliseconds += Math.min(dt * 1000, (nvmeRead + nvmeWrite) / (3 * gigabyte) * dt * 1000 * 6)
    hdd.writeSectors += hddWrite * dt / 512
    hdd.writes += hddWrite * dt / 131_072
    hdd.ioMilliseconds += Math.min(dt * 1000, hddWrite / (200 * megabyte) * dt * 1000)
    const [root, , backup] = this.filesystems
    const rootGrowth = (nvmeWrite * 0.02 - 40_000) * dt
    root.free = Math.max(0, root.free - rootGrowth)
    root.available = Math.max(0, root.available - rootGrowth)
    backup.free = Math.max(0, backup.free - hddWrite * 0.3 * dt)
    backup.available = Math.max(0, backup.available - hddWrite * 0.3 * dt)
  }
  accountMemory(dt: number, readRate: number) {
    const memory = this.memory
    const used = this.usedMemory()
    memory.cache = Math.min(memory.total - used - memory.buffers - 1.5 * gigabyte, memory.cache + readRate * dt * 0.6 - memory.cache * 0.0004 * dt)
    memory.buffers = Math.max(0.6 * gigabyte, memory.buffers + this.random.gauss() * 2 * megabyte * dt)
    memory.swapUsed = Math.max(120 * megabyte, memory.swapUsed + this.random.gauss() * 0.4 * megabyte * dt)
  }
  accountNetwork(dt: number, traffic: number) {
    const random = this.random
    const [lo, ethernet, , tailscale, docker, bridge] = this.interfaces
    const downloading = this.network.downloadLeft > 0
    const backingUp = this.network.backupLeft > 0
    this.network.downloadLeft -= dt
    this.network.backupLeft -= dt
    const rx = 0.9 * megabyte + 5 * megabyte * traffic * random.range(0.5, 1.5) + (downloading ? random.range(55, 95) * megabyte : 0)
    const tx = 0.4 * megabyte + 2.2 * megabyte * traffic * random.range(0.4, 1.6) + (backingUp ? random.range(28, 45) * megabyte : 0)
    const add = (counters: NetworkInterfaceCounters, rxRate: number, txRate: number) => {
      counters.rxBytes += rxRate * dt
      counters.txBytes += txRate * dt
      counters.rxPackets += rxRate * dt / 1100
      counters.txPackets += txRate * dt / 900
    }
    add(ethernet, rx, tx)
    add(lo, 180_000 * random.range(0.5, 1.5), 0)
    lo.txBytes = lo.rxBytes
    lo.txPackets = lo.rxPackets
    add(tailscale, 40_000 * random.range(0.2, 2), 90_000 * random.range(0.2, 2) + (backingUp ? 0 : 0))
    add(docker, tx * 0.35, rx * 0.3)
    add(bridge, 400_000 * traffic * random.range(0.5, 1.5), 350_000 * traffic * random.range(0.5, 1.5))
  }
  accountThermals(dt: number, busy: number, coreLoads: Array<number>) {
    const approach = (current: number, target: number, speed: number) => current + (target - current) * Math.min(1, dt * speed) + this.random.gauss() * 0.15
    const half = this.cores / 2
    const ccd1 = coreLoads.slice(0, half).reduce((sum, value) => sum + Math.min(1, value), 0) / half
    const ccd2 = coreLoads.slice(half).reduce((sum, value) => sum + Math.min(1, value), 0) / half
    const temperatures = this.temperatures
    temperatures.cpu = approach(temperatures.cpu, 41 + 50 * busy ** 0.7, 0.35)
    temperatures.ccd1 = approach(temperatures.ccd1, 38 + 52 * ccd1 ** 0.7, 0.5)
    temperatures.ccd2 = approach(temperatures.ccd2, 37 + 52 * ccd2 ** 0.7, 0.5)
    temperatures.nvme = approach(temperatures.nvme, 36 + 14 * Math.min(1, (this.diskState.nvmeRead + this.diskState.nvmeWrite) / (300 * megabyte)), 0.08)
    temperatures.gpuEdge = approach(temperatures.gpuEdge, 38 + 36 * this.gpuBusy, 0.3)
    temperatures.gpuJunction = approach(temperatures.gpuJunction, 41 + 50 * this.gpuBusy, 0.5)
    temperatures.gpuMemory = approach(temperatures.gpuMemory, 46 + 34 * this.gpuBusy, 0.2)
  }
  /** advances the simulation in small steps for numerical stability */
  advance(seconds: number) {
    let remaining = Math.min(seconds, 3600)
    while (remaining > 0) {
      const dt = Math.min(0.5, remaining)
      this.step(dt)
      remaining -= dt
    }
  }
  /** pretends that a process has been running for a while, so its accumulated counters look plausible */
  age(process: SimProcess, seconds: number) {
    process.startTicks = Math.max(1, Math.floor((this.uptime - seconds) * clockTicks))
    process.ticks = seconds * clockTicks * process.profile.cpu * this.random.range(0.4, 1)
    process.readBytes = seconds * (process.profile.read ?? 0) * this.random.range(0.3, 1)
    process.writeBytes = seconds * (process.profile.write ?? 0) * this.random.range(0.3, 1)
  }
  boot() {
    const bootAge = this.uptime - 1
    const systemd = this.spawn({
      comm: 'systemd',
      cmdline: ['/sbin/init', 'splash'],
      ppid: 0,
      profile: {
        cpu: 0.002,
        memory: 14 * megabyte,
      },
    })
    const kthreadd = this.spawn({
      comm: 'kthreadd',
      ppid: 0,
      kernel: true,
    })
    this.age(systemd, bootAge)
    this.age(kthreadd, bootAge)
    for (const name of kernelThreadNames(this.cores)) {
      const thread = this.spawn({
        comm: name,
        ppid: kthreadd.pid,
        kernel: true,
        profile: {cpu: name.startsWith('kworker') || name.startsWith('ksoftirqd') ? 0.004 : 0.0005},
      })
      this.age(thread, bootAge - this.random.range(0, 5))
    }
    const service = (comm: string, cmdline: Array<string>, profile: Partial<Profile>, extra: Partial<SpawnOptions> = {}) => {
      const start = () => {
        const process = this.spawn({
          comm,
          cmdline,
          ppid: systemd.pid,
          profile,
          respawn: start,
          ...extra,
        })
        return process
      }
      const process = start()
      this.age(process, bootAge - this.random.range(2, 20))
      return process
    }
    service('systemd-journal', ['/usr/lib/systemd/systemd-journald'], {
      cpu: 0.01,
      memory: 42 * megabyte,
      write: 90_000,
    })
    service('systemd-udevd', ['/usr/lib/systemd/systemd-udevd'], {
      cpu: 0.0008,
      memory: 9 * megabyte,
    })
    service('systemd-resolve', ['/usr/lib/systemd/systemd-resolved'], {
      cpu: 0.002,
      memory: 13 * megabyte,
    }, {uid: 101})
    service('systemd-timesyn', ['/usr/lib/systemd/systemd-timesyncd'], {
      cpu: 0.0003,
      memory: 7 * megabyte,
    }, {
      uid: 103,
      threads: 2,
    })
    service('dbus-daemon', ['@dbus-daemon', '--system', '--address=systemd:', '--nofork', '--nopidfile', '--systemd-activation', '--syslog-only'], {
      cpu: 0.001,
      memory: 6 * megabyte,
    }, {
      uid: 102,
      reloadsOnHup: true,
    })
    service('systemd-logind', ['/usr/lib/systemd/systemd-logind'], {
      cpu: 0.0005,
      memory: 8 * megabyte,
    })
    service('rsyslogd', ['/usr/sbin/rsyslogd', '-n', '-iNONE'], {
      cpu: 0.002,
      memory: 5 * megabyte,
      write: 12_000,
    }, {
      uid: 105,
      threads: 4,
      reloadsOnHup: true,
    })
    service('cron', ['/usr/sbin/cron', '-f', '-P'], {
      cpu: 0.0002,
      memory: 3 * megabyte,
    })
    service('smartd', ['/usr/sbin/smartd', '-n', '--quit=never'], {
      cpu: 0.0001,
      memory: 5 * megabyte,
    }, {reloadsOnHup: true})
    service('tailscaled', ['/usr/sbin/tailscaled', '--state=/var/lib/tailscale/tailscaled.state', '--socket=/run/tailscale/tailscaled.sock', '--port=41641'], {
      cpu: 0.02,
      memory: 62 * megabyte,
      diurnal: true,
    }, {threads: 17})
    service('node_exporter', ['/usr/bin/prometheus-node-exporter', '--collector.systemd', '--web.listen-address=:9100'], {
      cpu: 0.006,
      memory: 21 * megabyte,
      burst: {
        chance: 1 / 15,
        cpu: 0.15,
        duration: [0.3, 1],
      },
    }, {
      uid: 113,
      threads: 9,
    })
    service('caddy', ['/usr/bin/caddy', 'run', '--environ', '--config', '/etc/caddy/Caddyfile'], {
      cpu: 0.12,
      memory: 58 * megabyte,
      diurnal: true,
      burst: {
        chance: 1 / 30,
        cpu: 0.6,
        duration: [1, 4],
      },
    }, {
      threads: 19,
      reloadsOnHup: true,
    })
    const sshd = service('sshd', ['sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups'], {
      cpu: 0.0003,
      memory: 8 * megabyte,
    }, {reloadsOnHup: true})
    const privileged = this.spawn({
      comm: 'sshd',
      cmdline: ['sshd: jaid [priv]'],
      ppid: sshd.pid,
      profile: {
        cpu: 0.0002,
        memory: 10 * megabyte,
      },
    })
    this.age(privileged, 5400)
    const session = this.spawn({
      comm: 'sshd',
      cmdline: ['sshd: jaid@pts/0'],
      ppid: privileged.pid,
      uid: 1000,
      profile: {
        cpu: 0.002,
        memory: 7 * megabyte,
      },
    })
    this.age(session, 5400)
    const shell = this.spawn({
      comm: 'zsh',
      cmdline: ['-zsh'],
      ppid: session.pid,
      uid: 1000,
      profile: {
        cpu: 0.0005,
        memory: 9 * megabyte,
      },
    })
    this.age(shell, 5400)
    const tmux = this.spawn({
      comm: 'tmux: server',
      cmdline: ['tmux', 'new-session', '-A', '-s', 'main'],
      ppid: 1,
      uid: 1000,
      profile: {
        cpu: 0.003,
        memory: 6 * megabyte,
      },
    })
    this.age(tmux, 86_000)
    const editor = this.spawn({
      comm: 'nvim',
      cmdline: ['nvim', 'docker-compose.yml'],
      ppid: tmux.pid,
      uid: 1000,
      profile: {
        cpu: 0.004,
        memory: 64 * megabyte,
        burst: {
          chance: 1 / 20,
          cpu: 0.3,
          duration: [0.2, 1],
        },
      },
    })
    this.age(editor, 2400)
    service('containerd', ['/usr/bin/containerd'], {
      cpu: 0.012,
      memory: 58 * megabyte,
    }, {threads: 28})
    service('dockerd', ['/usr/bin/dockerd', '-H', 'fd://', '--containerd=/run/containerd/containerd.sock'], {
      cpu: 0.018,
      memory: 112 * megabyte,
      burst: {
        chance: 1 / 20,
        cpu: 0.25,
        duration: [0.5, 2],
      },
    }, {
      threads: 42,
      reloadsOnHup: true,
    })
    for (const key of containerKeys) {
      this.startContainer(key, true)
    }
  }
  containerInfos() {
    return new Map<string, ContainerInfo>([...this.containers.values()].map(container => [container.id, {
      id: container.id,
      name: container.name,
      image: container.image,
      state: 'running',
      status: `Up ${Math.max(1, Math.round((this.now - container.startedAt) / 60_000))} minutes`,
    }]))
  }
  diurnal() {
    const date = new Date(this.now)
    const hours = date.getHours() + date.getMinutes() / 60
    const day = 0.5 - 0.5 * Math.cos((hours - 4) / 24 * 2 * Math.PI)
    const wave = 0.5 + 0.5 * Math.sin(this.uptime / 97) * Math.sin(this.uptime / 31)
    return 0.35 + 0.45 * day + 0.2 * wave
  }
  removeTree(pid: number) {
    const process = this.processes.get(pid)
    if (!process) {
      return
    }
    for (const child of [...this.processes.values()].filter(candidate => candidate.ppid === pid)) {
      this.removeTree(child.pid)
    }
    this.processes.delete(pid)
  }
  scheduleContainerRestart(key: ContainerKey) {
    this.pendingRespawns.push({
      at: this.uptime + this.random.range(2, 4),
      run: () => this.startContainer(key),
    })
  }
  signal(pid: number, signal: Signal) {
    const process = this.processes.get(pid)
    if (!process) {
      throw new Error(`kill: (${pid}) - No such process`)
    }
    if (process.kernel) {
      // kernel threads ignore signals
      return
    }
    if (signal === 'STOP') {
      process.stopped = true
      return
    }
    if (signal === 'CONT') {
      process.stopped = false
      return
    }
    if (signal === 'USR1' || signal === 'USR2' || signal === 'HUP' && process.reloadsOnHup) {
      process.burstLeft = 0.6
      process.burstStrength = 0.4
      return
    }
    if (process.stopped && signal !== 'KILL') {
      // a stopped process only handles pending signals after SIGCONT
      return
    }
    this.terminate(process)
  }
  snapshot(): RawSnapshot {
    const processes: Array<RawProcess> = [...this.processes.values()].toSorted((a, b) => a.pid - b.pid).map(process => ({
      pid: process.pid,
      ppid: process.ppid,
      comm: process.comm,
      cmdline: process.cmdline,
      state: process.stopped ? 'T' : process.kernel ? 'I' : process.load > 0.5 || this.random.chance(process.load) ? 'R' : 'S',
      uid: process.uid,
      ticks: Math.floor(process.ticks),
      startTicks: process.startTicks,
      rss: process.kernel ? 0 : Math.round(process.rss),
      threads: process.threads,
      nice: process.nice,
      priority: 20 + process.nice,
      processor: process.processor,
      readBytes: Math.round(process.readBytes),
      writeBytes: Math.round(process.writeBytes),
      containerId: process.container ? this.containers.get(process.container)?.id : undefined,
    }))
    const total = this.cpu.reduce((sum, times) => {
      for (const key of Object.keys(times) as Array<keyof CpuTimes>) {
        sum[key] += times[key]
      }
      return sum
    }, emptyCpuTimes())
    const floor = (times: CpuTimes): CpuTimes => Object.fromEntries(Object.entries(times).map(([key, value]) => [key, Math.floor(value)])) as CpuTimes
    const memory = this.memory
    const used = this.usedMemory()
    const free = Math.max(0, memory.total - used - memory.cache - memory.buffers)
    const t = this.temperatures
    const gpuBusy = Math.round(this.gpuBusy * 100)
    return {
      uptime: Math.round(this.uptime * 100) / 100,
      clockTicks,
      cpu: floor(total),
      cpus: this.cpu.map(floor),
      contextSwitches: Math.floor(this.contextSwitches),
      cpuModel: 'AMD Ryzen 9 7900X 12-Core Processor',
      cpuFrequencies: this.coreFrequencies.map(value => Math.round(Math.max(400, Math.min(5650, value)) * 1000) / 1000),
      memory: {
        total: memory.total,
        free,
        available: free + memory.cache * 0.96 + memory.buffers,
        buffers: memory.buffers,
        cached: memory.cache,
        shared: 1.1 * gigabyte,
        reclaimable: 0.9 * gigabyte,
        dirty: 40 * megabyte * this.random.range(0.2, 1.5),
        swapTotal: 8 * gigabyte,
        swapFree: 8 * gigabyte - memory.swapUsed,
        swapCached: 60 * megabyte,
      },
      load: this.load.map(value => Math.round(value * 100) / 100) as [number, number, number],
      tasks: {
        running: processes.filter(process => process.state === 'R').length,
        total: processes.reduce((sum, process) => sum + process.threads, 0),
      },
      interfaces: this.interfaces.map(counters => ({
        ...counters,
        rxBytes: Math.floor(counters.rxBytes),
        txBytes: Math.floor(counters.txBytes),
        rxPackets: Math.floor(counters.rxPackets),
        txPackets: Math.floor(counters.txPackets),
      })),
      disks: this.disks.map(disk => Object.fromEntries(Object.entries(disk).map(([key, value]) => [key, typeof value === 'number' ? Math.floor(value) : value])) as DiskCounters),
      filesystems: this.filesystems.map(filesystem => ({...filesystem})),
      sensors: [
        {
          chip: 'k10temp',
          label: 'Tctl',
          celsius: t.cpu,
        },
        {
          chip: 'k10temp',
          label: 'Tccd1',
          celsius: t.ccd1,
        },
        {
          chip: 'k10temp',
          label: 'Tccd2',
          celsius: t.ccd2,
        },
        {
          chip: 'nvme',
          label: 'Composite',
          celsius: t.nvme,
        },
        {
          chip: 'amdgpu',
          label: 'edge',
          celsius: t.gpuEdge,
        },
        {
          chip: 'amdgpu',
          label: 'junction',
          celsius: t.gpuJunction,
        },
        {
          chip: 'amdgpu',
          label: 'mem',
          celsius: t.gpuMemory,
        },
      ],
      gpus: [{
        card: 'card1',
        busy: gpuBusy,
        vramTotal: 25_753_026_560,
        vramUsed: Math.round(1.1 * gigabyte + (this.containers.has('ollama') && [...this.processes.values()].some(process => process.comm === 'ollama_llama_se') ? 17.8 * gigabyte : 0) + this.gpuBusy * 1.2 * gigabyte),
      }],
      hostname: 'atlas',
      users: {...users},
      processes,
    }
  }
  spawn(options: SpawnOptions) {
    const pid = this.nextPid
    this.nextPid += this.random.int(1, 3)
    const profile: Profile = {
      cpu: 0,
      memory: 0,
      noise: 0.35,
      ...options.profile,
    }
    const process: SimProcess = {
      pid,
      ppid: options.ppid,
      comm: options.comm.slice(0, 15),
      cmdline: options.cmdline ?? (options.kernel ? [] : [options.comm]),
      uid: options.uid ?? 0,
      container: options.container,
      kernel: options.kernel ?? false,
      threads: options.threads ?? 1,
      nice: options.nice ?? (options.kernel && options.comm.startsWith('kworker') ? -20 : 0),
      startTicks: this.ticksNow,
      ticks: 0,
      rss: profile.memory * this.random.range(0.9, 1.1),
      readBytes: 0,
      writeBytes: 0,
      profile,
      load: profile.cpu,
      burstLeft: 0,
      burstStrength: 1,
      stopped: false,
      processor: this.random.int(0, this.cores - 1),
      respawn: options.respawn,
      reloadsOnHup: options.reloadsOnHup,
      dieAt: options.lifetime === undefined ? undefined : this.uptime + options.lifetime,
    }
    this.processes.set(pid, process)
    return process
  }
  spontaneousEvents(dt: number) {
    const random = this.random
    const children = [...this.processes.values()]
    const findByComm = (comm: string) => children.find(process => process.comm === comm)
    // health checks from cron
    if (random.chance(dt / 12)) {
      const cron = findByComm('cron')
      if (cron) {
        const shell = this.spawn({
          comm: 'sh',
          cmdline: ['/bin/sh', '-c', '/usr/local/bin/healthcheck.sh'],
          ppid: cron.pid,
          lifetime: random.range(0.6, 2.5),
          profile: {
            cpu: 0.01,
            memory: 2 * megabyte,
          },
        })
        this.spawn({
          comm: 'curl',
          cmdline: ['curl', '-fsS', '--max-time', '5', 'https://status.example.net/ping/7f3c2a'],
          ppid: shell.pid,
          lifetime: random.range(0.4, 2),
          profile: {
            cpu: 0.05,
            memory: 9 * megabyte,
          },
        })
      }
    }
    // nightly-style backup, but often enough to be seen in a demo
    if (this.network.backupLeft <= 0 && random.chance(dt / 240)) {
      const cron = findByComm('cron')
      if (cron) {
        const duration = random.range(40, 110)
        this.network.backupLeft = duration
        const shell = this.spawn({
          comm: 'sh',
          cmdline: ['/bin/sh', '-c', 'restic backup /srv /etc --tag hourly --exclude-caches'],
          ppid: cron.pid,
          lifetime: duration + 0.5,
          profile: {
            cpu: 0.001,
            memory: 2 * megabyte,
          },
        })
        this.spawn({
          comm: 'restic',
          cmdline: ['restic', 'backup', '/srv', '/etc', '--tag', 'hourly', '--exclude-caches', '--password-file', '/root/.config/restic/password'],
          ppid: shell.pid,
          lifetime: duration,
          threads: 14,
          profile: {
            cpu: 2.6,
            noise: 0.25,
            memory: 780 * megabyte,
            memoryJitter: 40 * megabyte,
            read: 170 * megabyte,
            write: 3 * megabyte,
          },
        })
      }
    }
    // large downloads
    if (this.network.downloadLeft <= 0 && random.chance(dt / 150)) {
      this.network.downloadLeft = random.range(8, 30)
    }
    // video transcodes triggered by the worker
    if (random.chance(dt / 160) && !findByComm('ffmpeg')) {
      const worker = children.find(process => process.comm === 'celery' && process.container === 'worker')
      if (worker) {
        const id = random.hex(8)
        this.spawn({
          comm: 'ffmpeg',
          cmdline: ['ffmpeg', '-hide_banner', '-i', `/data/uploads/${id}.mov`, '-c:v', 'libsvtav1', '-preset', '6', '-crf', '32', '-c:a', 'libopus', '-b:a', '128k', `/data/media/${id}.webm`],
          ppid: worker.pid,
          container: 'worker',
          uid: 1000,
          lifetime: random.range(25, 70),
          threads: 26,
          profile: {
            cpu: 7,
            noise: 0.15,
            memory: 1.4 * gigabyte,
            memoryJitter: 60 * megabyte,
            read: 6 * megabyte,
            write: 2.5 * megabyte,
          },
        })
      }
    }
    for (const respawn of this.pendingRespawns.filter(entry => entry.at <= this.uptime)) {
      respawn.run()
    }
    this.pendingRespawns = this.pendingRespawns.filter(entry => entry.at > this.uptime)
  }
  startContainer(key: ContainerKey, initial = false) {
    const definition = containerDefinitions[key]
    const existing = this.containers.get(key)
    const container: SimContainer = existing ?? {
      key,
      id: this.random.hex(64),
      name: definition.name,
      image: definition.image,
      startedAt: this.now,
    }
    container.startedAt = this.now
    this.containers.set(key, container)
    const shim = this.spawn({
      comm: 'containerd-shim',
      cmdline: ['/usr/bin/containerd-shim-runc-v2', '-namespace', 'moby', '-id', container.id, '-address', '/run/containerd/containerd.sock'],
      ppid: 1,
      profile: {
        cpu: 0.0008,
        memory: 12 * megabyte,
      },
      threads: 12,
    })
    const age = initial ? this.random.range(20_000, 250_000) : 0
    if (initial) {
      this.age(shim, age)
    }
    definition.start({
      host: this,
      container: key,
      parent: shim.pid,
      age,
      restart: () => this.scheduleContainerRestart(key),
    })
  }
  step(dt: number) {
    const random = this.random
    this.uptime += dt
    this.now += dt * 1000
    this.spontaneousEvents(dt)
    const traffic = this.diurnal()
    const coreLoads = Array.from({length: this.cores}, () => random.range(0.002, 0.012))
    const niceLoads = Array.from({length: this.cores}, () => 0)
    let totalRead = 0
    let totalWrite = 0
    let running = 0
    let gpuDemand = 0
    for (const process of this.processes.values()) {
      if (process.dieAt !== undefined && process.dieAt <= this.uptime) {
        this.removeTree(process.pid)
        continue
      }
      const {profile} = process
      if (process.stopped) {
        process.load = 0
        continue
      }
      if (profile.burst && process.burstLeft <= 0 && random.chance(profile.burst.chance * dt)) {
        process.burstLeft = random.range(...profile.burst.duration)
        process.burstStrength = random.range(0.6, 1.1)
      }
      const bursting = process.burstLeft > 0
      process.burstLeft -= dt
      const base = profile.cpu * (profile.diurnal ? traffic * 1.6 : 1)
      const target = Math.max(0, base * (1 + (profile.noise ?? 0.3) * random.gauss()) + (bursting && profile.burst ? profile.burst.cpu * process.burstStrength : 0))
      process.load = Math.min(process.threads, process.load + (target - process.load) * Math.min(1, dt * 2.5))
      process.ticks += process.load * dt * clockTicks
      if (process.load > 0.4 || random.chance(process.load)) {
        running++
      }
      if (random.chance(dt / 8)) {
        process.processor = random.int(0, this.cores - 1)
      }
      // spread multi-threaded load over neighboring cores
      let remaining = process.load
      let core = process.processor
      while (remaining > 0.0001) {
        const share = Math.min(remaining, 0.97 - coreLoads[core] > 0.05 ? 0.97 - coreLoads[core] : Math.min(remaining, 0.25))
        coreLoads[core] += share
        if (process.nice > 0) {
          niceLoads[core] += share
        }
        remaining -= share
        core = (core + random.int(1, 5)) % this.cores
      }
      const read = ((profile.read ?? 0) + (bursting ? profile.burst?.read ?? 0 : 0)) * random.range(0.4, 1.6)
      const write = ((profile.write ?? 0) + (bursting ? profile.burst?.write ?? 0 : 0)) * random.range(0.4, 1.6)
      process.readBytes += read * dt
      process.writeBytes += write * dt
      totalRead += read
      totalWrite += write
      if (bursting && profile.burst?.gpu) {
        gpuDemand = Math.max(gpuDemand, profile.burst.gpu * process.burstStrength)
      }
      if (profile.memory > 0) {
        const jitter = profile.memoryJitter ?? profile.memory * 0.01
        process.rss = Math.min(profile.memory * 2.2, Math.max(profile.memory * 0.4, process.rss + jitter * random.gauss() * Math.sqrt(dt) + (profile.memory - process.rss) * 0.02 * dt))
      }
    }
    this.accountCpu(dt, coreLoads, niceLoads, totalRead + totalWrite)
    this.accountMemory(dt, totalRead)
    this.accountNetwork(dt, traffic)
    this.accountDisks(dt, totalRead, totalWrite)
    const busy = coreLoads.reduce((sum, value) => sum + Math.min(1, value), 0) / this.cores
    this.accountThermals(dt, busy, coreLoads)
    this.gpuBusy += (Math.min(1, gpuDemand + random.range(0, 0.02)) - this.gpuBusy) * Math.min(1, dt * 3)
    this.contextSwitches += (18_000 + 90_000 * busy * this.cores / 4) * dt
    const decay = (period: number) => Math.exp(-dt / period)
    const active = running + busy * this.cores * 0.3
    this.load = [
      this.load[0] * decay(60) + active * (1 - decay(60)),
      this.load[1] * decay(300) + active * (1 - decay(300)),
      this.load[2] * decay(900) + active * (1 - decay(900)),
    ]
  }
  terminate(process: SimProcess): void {
    if (process.comm === 'containerd-shim') {
      const main = [...this.processes.values()].find(candidate => candidate.ppid === process.pid && candidate.container)
      if (main) {
        this.terminate(main)
        return
      }
    }
    const parent = this.processes.get(process.ppid)
    // tini exits together with its only child, which takes the whole container down
    if (parent?.comm === 'tini' && parent.container) {
      this.terminate(parent)
      return
    }
    const containerMain = process.container && this.processes.get(process.ppid)?.comm === 'containerd-shim'
    if (containerMain) {
      const shimPid = process.ppid
      // the container dies with its init process and Docker’s restart policy brings it back
      for (const candidate of this.processes.values()) {
        if (candidate.container === process.container) {
          this.processes.delete(candidate.pid)
        }
      }
      this.processes.delete(shimPid)
      this.scheduleContainerRestart(process.container as ContainerKey)
      return
    }
    this.removeTree(process.pid)
    if (process.respawn) {
      this.pendingRespawns.push({
        at: this.uptime + this.random.range(0.8, 2.5),
        run: process.respawn,
      })
    }
  }
  usedMemory() {
    let rss = 0
    for (const process of this.processes.values()) {
      rss += process.rss
    }
    // shared pages are counted per process, so the real footprint is smaller
    return rss * 0.72 + 2.1 * gigabyte
  }
}

const aged = (context: ContainerStartContext, process: SimProcess, spread = 0.05) => {
  if (context.age > 0) {
    context.host.age(process, context.age * (1 - context.host.random.range(0, spread)))
  }
  return process
}
const containerDefinitions = {
  postgres: {
    name: 'postgres',
    image: 'postgres:18-alpine',
    start: context => {
      const {host, container, parent} = context
      const main = aged(context, host.spawn({
        comm: 'postgres',
        cmdline: ['postgres', '-c', 'shared_buffers=4GB', '-c', 'max_connections=200', '-c', 'effective_io_concurrency=200'],
        ppid: parent,
        container,
        uid: 70,
        profile: {
          cpu: 0.004,
          memory: 180 * megabyte,
        },
      }))
      const child = (title: string, profile: Partial<Profile>) => {
        const spawn = () => host.spawn({
          comm: 'postgres',
          cmdline: [`postgres: ${title}`],
          ppid: main.pid,
          container,
          uid: 70,
          profile,
          respawn: spawn,
        })
        return aged(context, spawn(), 0.02)
      }
      child('checkpointer', {
        cpu: 0.001,
        memory: 1.9 * gigabyte,
        write: 180_000,
        burst: {
          chance: 1 / 90,
          cpu: 0.2,
          duration: [3, 8],
          write: 60 * megabyte,
        },
      })
      child('background writer', {
        cpu: 0.001,
        memory: 700 * megabyte,
        write: 40_000,
      })
      child('walwriter', {
        cpu: 0.002,
        memory: 24 * megabyte,
        write: 300_000,
      })
      child('autovacuum launcher', {
        cpu: 0.0005,
        memory: 12 * megabyte,
        burst: {
          chance: 1 / 120,
          cpu: 0.6,
          duration: [4, 15],
          read: 40 * megabyte,
        },
      })
      child('logical replication launcher', {
        cpu: 0.0001,
        memory: 9 * megabyte,
      })
      for (let index = 0; index < 6; index++) {
        child(`app appdb 172.19.0.${host.random.int(3, 9)}(${host.random.int(40_000, 60_000)}) idle`, {
          cpu: 0.03,
          memory: 140 * megabyte,
          diurnal: true,
          burst: {
            chance: 1 / 25,
            cpu: 0.8,
            duration: [0.3, 3],
            read: 25 * megabyte,
          },
        })
      }
    },
  },
  redis: {
    name: 'redis',
    image: 'valkey/valkey:8-alpine',
    start: context => {
      const {host, container, parent} = context
      aged(context, host.spawn({
        comm: 'valkey-server',
        cmdline: ['valkey-server *:6379'],
        ppid: parent,
        container,
        uid: 999,
        threads: 6,
        profile: {
          cpu: 0.03,
          memory: 1.2 * gigabyte,
          memoryJitter: 3 * megabyte,
          diurnal: true,
          write: 20_000,
        },
      }))
    },
  },
  api: {
    name: 'api',
    image: 'ghcr.io/jaid/shop-api:2.14.1',
    start: context => {
      const {host, container, parent} = context
      const init = aged(context, host.spawn({
        comm: 'tini',
        cmdline: ['/sbin/tini', '--', 'node', '--enable-source-maps', 'dist/server.js'],
        ppid: parent,
        container,
        uid: 1000,
        profile: {
          cpu: 0,
          memory: 1 * megabyte,
        },
      }))
      aged(context, host.spawn({
        comm: 'node',
        cmdline: ['node', '--enable-source-maps', '--max-old-space-size=2048', 'dist/server.js', '--port=3000', '--database-url=postgres://app:hunter2@postgres:5432/appdb', '--redis', 'redis://redis:6379/0'],
        ppid: init.pid,
        container,
        uid: 1000,
        threads: 11,
        profile: {
          cpu: 0.45,
          noise: 0.5,
          memory: 420 * megabyte,
          memoryJitter: 6 * megabyte,
          diurnal: true,
          burst: {
            chance: 1 / 18,
            cpu: 0.9,
            duration: [1, 5],
          },
        },
      }))
    },
  },
  worker: {
    name: 'worker',
    image: 'ghcr.io/jaid/shop-worker:2.14.1',
    start: context => {
      const {host, container, parent} = context
      const main = aged(context, host.spawn({
        comm: 'celery',
        cmdline: ['/usr/local/bin/python3', '-m', 'celery', '-A', 'tasks', 'worker', '--concurrency=4', '--loglevel=INFO'],
        ppid: parent,
        container,
        uid: 1000,
        threads: 3,
        profile: {
          cpu: 0.01,
          memory: 190 * megabyte,
        },
      }))
      for (let index = 0; index < 4; index++) {
        const spawn = () => host.spawn({
          comm: 'celery',
          cmdline: ['/usr/local/bin/python3', '-m', 'celery', '-A', 'tasks', 'worker', '--concurrency=4', '--loglevel=INFO'],
          ppid: main.pid,
          container,
          uid: 1000,
          respawn: spawn,
          profile: {
            cpu: 0.008,
            memory: 230 * megabyte,
            memoryJitter: 4 * megabyte,
            burst: {
              chance: 1 / 40,
              cpu: 0.95,
              duration: [2, 10],
              read: 2 * megabyte,
              write: 1 * megabyte,
            },
          },
        })
        aged(context, spawn(), 0.01)
      }
    },
  },
  nginx: {
    name: 'nginx',
    image: 'nginx:1.29-alpine',
    start: context => {
      const {host, container, parent} = context
      const master = aged(context, host.spawn({
        comm: 'nginx',
        cmdline: ['nginx: master process nginx -g daemon off;'],
        ppid: parent,
        container,
        reloadsOnHup: true,
        profile: {
          cpu: 0.0005,
          memory: 11 * megabyte,
        },
      }))
      for (let index = 0; index < 4; index++) {
        const spawn = () => host.spawn({
          comm: 'nginx',
          cmdline: ['nginx: worker process'],
          ppid: master.pid,
          container,
          uid: 101,
          respawn: spawn,
          profile: {
            cpu: 0.06,
            memory: 14 * megabyte,
            diurnal: true,
            write: 30_000,
            burst: {
              chance: 1 / 40,
              cpu: 0.3,
              duration: [0.5, 2],
            },
          },
        })
        aged(context, spawn(), 0.01)
      }
    },
  },
  prometheus: {
    name: 'prometheus',
    image: 'prom/prometheus:v3.6.0',
    start: context => {
      const {host, container, parent} = context
      aged(context, host.spawn({
        comm: 'prometheus',
        cmdline: ['/bin/prometheus', '--config.file=/etc/prometheus/prometheus.yml', '--storage.tsdb.path=/prometheus', '--storage.tsdb.retention.time=90d'],
        ppid: parent,
        container,
        uid: 65_534,
        threads: 21,
        profile: {
          cpu: 0.16,
          memory: 890 * megabyte,
          memoryJitter: 5 * megabyte,
          write: 900_000,
          burst: {
            chance: 1 / 60,
            cpu: 1.4,
            duration: [2, 6],
            read: 80 * megabyte,
            write: 30 * megabyte,
          },
        },
      }))
    },
  },
  grafana: {
    name: 'grafana',
    image: 'grafana/grafana:12.2.0',
    start: context => {
      const {host, container, parent} = context
      aged(context, host.spawn({
        comm: 'grafana',
        cmdline: ['grafana', 'server', '--homepath=/usr/share/grafana', '--config=/etc/grafana/grafana.ini', '--packaging=docker', 'cfg:default.log.mode=console'],
        ppid: parent,
        container,
        uid: 472,
        threads: 23,
        profile: {
          cpu: 0.015,
          memory: 310 * megabyte,
          burst: {
            chance: 1 / 45,
            cpu: 0.7,
            duration: [1, 3],
          },
        },
      }))
    },
  },
  ollama: {
    name: 'ollama',
    image: 'ollama/ollama:0.12.3-rocm',
    start: context => {
      const {host, container, parent} = context
      const serve = aged(context, host.spawn({
        comm: 'ollama',
        cmdline: ['/bin/ollama', 'serve'],
        ppid: parent,
        container,
        uid: 998,
        threads: 30,
        profile: {
          cpu: 0.01,
          memory: 420 * megabyte,
        },
      }))
      aged(context, host.spawn({
        comm: 'ollama_llama_se',
        cmdline: ['/usr/bin/ollama', 'runner', '--model', '/root/.ollama/models/blobs/sha256-6e4c38e1172f42fdbff13edf9a7a017679fb82b0fde415a3e8b3c31c6ed4a4e4', '--ctx-size', '16384', '--batch-size', '512', '--n-gpu-layers', '99', '--threads', '12', '--parallel', '2', '--port', '41239'],
        ppid: serve.pid,
        container,
        uid: 998,
        threads: 38,
        profile: {
          cpu: 0.02,
          memory: 2.3 * gigabyte,
          burst: {
            chance: 1 / 25,
            cpu: 1.1,
            duration: [6, 28],
            gpu: 0.97,
          },
        },
      }), 0.5)
    },
  },
} satisfies Record<string, ContainerDefinition>

type ContainerKey = keyof typeof containerDefinitions

const containerKeys = Object.keys(containerDefinitions) as Array<ContainerKey>
