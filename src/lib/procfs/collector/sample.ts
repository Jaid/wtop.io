import type {ArgvMode} from '#src/lib/argv.ts'
import type {CpuTimes, FilesystemUsage, RawProcess, RawSnapshot} from '../types.ts'

import {closeSync, existsSync, lstatSync, openSync, readFileSync, readlinkSync, readSync, readdirSync, realpathSync} from 'node:fs'

import {censorArgv} from '#src/lib/argv.ts'

import {platformSizes, processHandle} from './native.ts'

export const readText = (path: string, required = false): string => {
  try { return readFileSync(path, 'utf8') } catch (error) {
    if (required) { throw error }
    return ''
  }
}
const names = (path: string) => { try { return readdirSync(path) } catch { return [] } }
const lines = (text: string) => text.trim().split('\n').filter(Boolean)
const optionalNumber = (path: string, scale = 1) => {
  const text = readText(path).trim()
  const value = text ? Number(text) / scale : Number.NaN
  return Number.isFinite(value) ? value : undefined
}

/** Resolve every symlink inside the host's root, including absolute NixOS links. */
export const hostPath = (root: string, path: string) => {
  const pending = path.split('/')
  let resolved: Array<string> = []
  let links = 0
  while (pending.length) {
    const part = pending.shift()!
    if (!part || part === '.') { continue }
    if (part === '..') { resolved.pop(); continue }
    const candidate = `${root}/${[...resolved, part].join('/')}`
    let link = false
    try { link = lstatSync(candidate).isSymbolicLink() } catch {}
    if (link) {
      if (++links > 40) { throw new Error('Host symlink loop') }
      const target = readlinkSync(candidate)
      if (target.startsWith('/')) { resolved = [] }
      pending.unshift(...target.split('/'))
    } else { resolved.push(part) }
  }
  return `${root}/${resolved.join('/')}`
}

export const parseProcessStat = (text: string, pageSize: number): RawProcess => {
  const left = text.indexOf('(')
  const right = text.lastIndexOf(')')
  if (left < 1 || right <= left) { throw new Error('Invalid process stat') }
  const fields = text.slice(right + 2).trim().split(/\s+/)
  if (fields.length < 22) { throw new Error('Incomplete process stat') }
  const numeric = (index: number) => Number(fields[index])
  return {
    pid: Number(text.slice(0, left).trim()), comm: text.slice(left + 1, right),
    state: fields[0], ppid: numeric(1), ticks: numeric(11) + numeric(12),
    priority: numeric(15), nice: numeric(16), threads: numeric(17), startTicks: numeric(19),
    rss: Math.max(0, numeric(21)) * pageSize, processor: Number(fields[36] ?? 0),
    isKernelThread: Boolean(numeric(6) & 0x200000), cmdline: [],
  }
}

const argvBuffer = Buffer.allocUnsafe(65_536)
/** No cached argv: exec() can replace it without changing PID or start time. */
export const collectProcesses = (mode: ArgvMode, pageSize: number, proc = '/proc') => {
  const result: Array<RawProcess> = []
  for (const pid of names(proc)) {
    if (!/^\d+$/.test(pid)) { continue }
    const base = `${proc}/${pid}`
    try {
      const row = parseProcessStat(readText(`${base}/stat`, true), pageSize)
      for (const line of lines(readText(`${base}/status`))) {
        if (line.startsWith('Uid:')) { row.uid = Number(line.trim().split(/\s+/)[2]) }
        else if (line.startsWith('VmRSS:')) { row.rss = Number(line.trim().split(/\s+/)[1]) * 1024 }
      }
      if (mode !== 'hidden') {
        let fd: number | undefined
        try {
          fd = openSync(`${base}/cmdline`, 'r')
          const count = readSync(fd, argvBuffer, 0, argvBuffer.length, 0)
          const raw = argvBuffer.toString('utf8', 0, count)
          const args = raw ? (raw.endsWith('\0') ? raw.slice(0, -1) : raw).split('\0') : []
          row.cmdline = mode === 'censored' ? censorArgv(args) : args
        } catch {} finally { if (fd !== undefined) { closeSync(fd) } }
      }
      for (const line of lines(readText(`${base}/io`))) {
        if (line.startsWith('read_bytes:')) { row.readBytes = Number(line.slice(11).trim()) }
        else if (line.startsWith('write_bytes:')) { row.writeBytes = Number(line.slice(12).trim()) }
      }
      const cgroup = readText(`${base}/cgroup`)
      row.containerId = [...cgroup.matchAll(/(?:^|[/:\-])([a-f0-9]{64})(?:\.scope|[/\n]|$)/g)].at(-1)?.[1]
      row.unit = [...cgroup.matchAll(/([^/\n]+\.(?:service|scope))/g)].at(-1)?.[1]
      if (parseProcessStat(readText(`${base}/stat`, true), pageSize).startTicks !== row.startTicks) { continue }
      result.push(row)
    } catch { /* Processes may exit or become inaccessible during the scan. */ }
  }
  return result
}

const cpuKeys = ['user', 'nice', 'system', 'idle', 'iowait', 'irq', 'softirq', 'steal', 'guest'] as const
const collectCpu = () => {
  const counters = new Map<string, CpuTimes>()
  let contextSwitches = 0
  let running = 0
  for (const line of lines(readText('/proc/stat', true))) {
    const fields = line.trim().split(/\s+/)
    if (/^cpu\d*$/.test(fields[0])) {
      counters.set(fields[0], Object.fromEntries(cpuKeys.map((key, index) => [key, Number(fields[index + 1] ?? 0)])) as CpuTimes)
    } else if (fields[0] === 'ctxt') { contextSwitches = Number(fields[1]) }
    else if (fields[0] === 'procs_running') { running = Number(fields[1]) }
  }
  const indices = [...counters.keys()].filter(key => key !== 'cpu').map(key => Number(key.slice(3)))
  const cpus = Array.from({length: Math.max(0, ...indices) + 1}, (_, index) => counters.get(`cpu${index}`) ?? Object.fromEntries(cpuKeys.map(key => [key, 0])) as CpuTimes)
  return {cpu: counters.get('cpu')!, cpus, contextSwitches, running}
}
const memoryKeys = {MemTotal: 'total', MemFree: 'free', MemAvailable: 'available', Buffers: 'buffers', Cached: 'cached', Shmem: 'shared', SReclaimable: 'reclaimable', Dirty: 'dirty', SwapTotal: 'swapTotal', SwapFree: 'swapFree', SwapCached: 'swapCached'} as const
const collectMemory = () => {
  const result = Object.fromEntries(Object.values(memoryKeys).map(key => [key, 0])) as RawSnapshot['memory']
  for (const line of lines(readText('/proc/meminfo', true))) {
    const [key, value] = line.split(':')
    const property = memoryKeys[key as keyof typeof memoryKeys]
    if (property) { result[property] = Number(value.trim().split(/\s+/)[0]) * 1024 }
  }
  return result
}
const collectNetwork = (): RawSnapshot['interfaces'] => lines(readText('/proc/1/net/dev')).flatMap(line => {
  const colon = line.lastIndexOf(':')
  if (colon < 0) { return [] }
  const fields = line.slice(colon + 1).trim().split(/\s+/).map(Number)
  return fields.length < 16 ? [] : [{name: line.slice(0, colon).trim(), rxBytes: fields[0], rxPackets: fields[1], rxErrors: fields[2], txBytes: fields[8], txPackets: fields[9], txErrors: fields[10]}]
})
const collectDisks = (): RawSnapshot['disks'] => lines(readText('/proc/diskstats')).flatMap(line => {
  const fields = line.trim().split(/\s+/)
  const name = fields[2]
  if (fields.length < 14 || /^(?:loop|ram|zram)\d+$/.test(name) || existsSync(`/sys/class/block/${name}/partition`)) { return [] }
  return [{name, reads: Number(fields[3]), readSectors: Number(fields[5]), writes: Number(fields[7]), writeSectors: Number(fields[9]), ioMilliseconds: Number(fields[12]), aggregate: names(`/sys/class/block/${name}/slaves`).length === 0}]
})

export const unescapeMount = (value: string) => value.replaceAll(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)))
const localFilesystems = new Set(['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'zfs', 'bcachefs', 'vfat', 'exfat', 'ntfs3', 'f2fs', 'erofs'])
export const filesystemEntries = (text: string, root = '/proc/1/root') => {
  const candidates = lines(text).flatMap(line => {
    const [left, right] = line.split(' - ')
    const fields = left.split(' ')
    const fs = right?.split(' ')
    return fields.length < 6 || !fs || !localFilesystems.has(fs[0]) ? [] : [{mount: unescapeMount(fields[4]), device: unescapeMount(fs[1]), type: fs[0], identity: fields[2]}]
  }).sort((a, b) => a.mount.length - b.mount.length || a.mount.localeCompare(b.mount))
  const seen = new Set<string>()
  return candidates.flatMap(({identity, ...entry}) => {
    if (seen.has(identity)) { return [] }
    seen.add(identity)
    try { return [{...entry, path: hostPath(root, entry.mount)}] } catch { return [] }
  })
}

// statfs may block in a filesystem driver. Keep it out of the server's event loop
// and enforce an actual subprocess deadline rather than a non-cancelling Promise race.
const filesystemProgram = `import {statfsSync} from 'node:fs'; const entries=JSON.parse(process.argv.at(-1)); const out=[]; for(const {path,...entry} of entries){try{const s=statfsSync(path);if(s.blocks)out.push({...entry,size:s.blocks*s.bsize,free:s.bfree*s.bsize,available:s.bavail*s.bsize})}catch{}}; console.log(JSON.stringify(out));`
const collectFilesystems = async (): Promise<Array<FilesystemUsage>> => {
  const entries = filesystemEntries(readText('/proc/1/mountinfo'))
  if (!entries.length) { return [] }
  const child = Bun.spawn([process.execPath, '--smol', '--eval', filesystemProgram, JSON.stringify(entries)], {stdout: 'pipe', stderr: 'ignore'})
  const timer = setTimeout(() => child.kill(), 2000)
  try {
    const text = await new Response(child.stdout).text()
    if (await child.exited !== 0) { return [] }
    return JSON.parse(text) as Array<FilesystemUsage>
  } catch { return [] } finally { clearTimeout(timer) }
}

export const collectHardware = (sysroot = '/sys') => {
  const sensors: RawSnapshot['sensors'] = []
  const fans: NonNullable<RawSnapshot['fans']> = []
  const gpus: RawSnapshot['gpus'] = []
  for (const id of names(`${sysroot}/class/hwmon`).sort()) {
    const base = `${sysroot}/class/hwmon/${id}`
    const chip = readText(`${base}/name`).trim() || id
    for (const file of names(base).sort()) {
      if (/^temp\d+_input$/.test(file)) {
        const celsius = optionalNumber(`${base}/${file}`, 1000)
        if (celsius !== undefined && celsius > -40 && celsius < 200) {
          sensors.push({chip, id, label: readText(`${base}/${file.replace('_input', '_label')}`).trim() || file.replace('_input', ''), celsius})
        }
      } else if (/^fan\d+_input$/.test(file)) {
        const rpm = optionalNumber(`${base}/${file}`)
        if (rpm !== undefined && rpm >= 0) { fans.push({chip, label: readText(`${base}/${file.replace('_input', '_label')}`).trim() || file.replace('_input', ''), rpm}) }
      }
    }
  }
  const seen = new Set<string>()
  for (const card of names(`${sysroot}/class/drm`).filter(name => /^card\d+$/.test(name)).sort()) {
    let device: string
    try { device = realpathSync(`${sysroot}/class/drm/${card}/device`) } catch { continue }
    if (seen.has(device)) { continue }
    seen.add(device)
    const state = readText(`${device}/power/runtime_status`).trim() || 'unknown'
    const gpu: RawSnapshot['gpus'][number] = {card, device, state}
    if (state !== 'suspended') {
      for (const [key, file] of [['busy', 'gpu_busy_percent'], ['vramUsed', 'mem_info_vram_used'], ['vramTotal', 'mem_info_vram_total']] as const) {
        const value = optionalNumber(`${device}/${file}`)
        if (value !== undefined && value >= 0) { gpu[key] = value }
      }
    }
    gpus.push(gpu)
  }
  return {sensors, fans, gpus}
}
const collectPressure = (): RawSnapshot['pressure'] => {
  const result: NonNullable<RawSnapshot['pressure']> = {}
  for (const resource of ['cpu', 'memory', 'io'] as const) {
    for (const line of lines(readText(`/proc/pressure/${resource}`))) {
      const [kind, ...parts] = line.split(' ')
      if (kind !== 'some' && kind !== 'full') { continue }
      result[resource] ??= {}
      result[resource][kind] = Object.fromEntries(parts.map(part => { const [key, value] = part.split('='); return [key, Number(value)] })) as {avg10: number, avg60: number, avg300: number, total: number}
    }
  }
  return result
}

/** Only immutable platform constants are retained; every live counter is freshly read. */
export class Sampler {
  readonly sizes = platformSizes()
  async sample(argv: ArgvMode): Promise<RawSnapshot> {
    const filesystems = collectFilesystems()
    const uptime = Number(readText('/proc/uptime', true).split(' ')[0])
    const {cpu, cpus, contextSwitches, running} = collectCpu()
    const load = readText('/proc/loadavg', true).trim().split(/\s+/)
    const users: Record<number, string> = {}
    try {
      for (const line of lines(readText(hostPath('/proc/1/root', '/etc/passwd')))) {
        const fields = line.split(':')
        if (fields.length >= 3 && /^\d+$/.test(fields[2])) { users[Number(fields[2])] ??= fields[0] }
      }
    } catch {}
    let cpuModel: string | undefined
    const cpuFrequencies: Array<number> = []
    for (const line of lines(readText('/proc/cpuinfo'))) {
      const at = line.indexOf(':')
      const key = line.slice(0, at).trim()
      const value = line.slice(at + 1).trim()
      if (!cpuModel && ['model name', 'Model', 'Hardware'].includes(key)) { cpuModel = value }
      if (key === 'cpu MHz' && Number.isFinite(Number(value))) { cpuFrequencies.push(Number(value)) }
    }
    if (!cpuFrequencies.length) {
      for (const core of names('/sys/devices/system/cpu').filter(name => /^cpu\d+$/.test(name)).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))) {
        const value = optionalNumber(`/sys/devices/system/cpu/${core}/cpufreq/scaling_cur_freq`, 1000)
        if (value !== undefined) { cpuFrequencies.push(value) }
      }
    }
    const snapshot: RawSnapshot = {
      clockTicks: this.sizes.clockTicks, bootId: readText('/proc/sys/kernel/random/boot_id').trim(),
      uptime, cpu, cpus, contextSwitches, cpuModel: cpuModel || 'Linux CPU', cpuFrequencies,
      memory: collectMemory(), interfaces: collectNetwork(), disks: collectDisks(),
      ...collectHardware(), pressure: collectPressure(),
      hostname: readText('/proc/sys/kernel/hostname').trim(),
      kernel: readText('/proc/sys/kernel/osrelease').trim(), architecture: process.arch,
      operatingSystem: this.operatingSystem(),
      load: load.slice(0, 3).map(Number) as [number, number, number],
      tasks: {running, total: Number(load[3].split('/')[1])}, users,
      processes: collectProcesses(argv, this.sizes.pageSize), filesystems: await filesystems,
    }
    return snapshot
  }
  private operatingSystem() {
    for (const file of ['/etc/os-release', '/usr/lib/os-release']) {
      try {
        const text = readText(hostPath('/proc/1/root', file))
        const pretty = /^PRETTY_NAME=(.*)$/m.exec(text)?.[1]
        if (pretty) { return pretty.replace(/^["']|["']$/g, '') }
      } catch {}
    }
    return 'Linux'
  }
}

const signalNumbers = {HUP: 1, INT: 2, KILL: 9, USR1: 10, USR2: 12, TERM: 15, CONT: 18, STOP: 19} as const
export const signalProcess = (request: {pid?: unknown, startTicks?: unknown, signal?: unknown}, protectCgroup = true) => {
  const {pid, startTicks, signal} = request
  if (!Number.isSafeInteger(pid) || Number(pid) <= 1 || Number(pid) > 2147483647 || !Number.isSafeInteger(startTicks) || Number(startTicks) < 0 || typeof signal !== 'string' || !Object.hasOwn(signalNumbers, signal)) {
    return {ok: false, error: 'INVALID_ARGUMENT'}
  }
  if (pid === process.pid) { return {ok: false, error: 'PROTECTED_PROCESS'} }
  let handle: ReturnType<typeof processHandle> | undefined
  try {
    handle = processHandle(Number(pid))
    const current = parseProcessStat(readText(`/proc/${pid}/stat`, true), 1)
    if (current.startTicks !== startTicks) { return {ok: false, error: 'STALE_PROCESS'} }
    const own = readText('/proc/self/cgroup')
    if (protectCgroup && own && own === readText(`/proc/${pid}/cgroup`)) { return {ok: false, error: 'PROTECTED_PROCESS'} }
    handle.send(signalNumbers[signal as keyof typeof signalNumbers])
    return {ok: true}
  } catch (error) {
    const code = (error as {code?: string}).code
    const message = error instanceof Error ? error.message : ''
    return {ok: false, error: code === 'ENOENT' ? 'PROCESS_NOT_FOUND' : ['PROCESS_NOT_FOUND', 'PERMISSION_DENIED'].includes(message) ? message : 'SIGNAL_FAILED'}
  } finally { handle?.close() }
}
