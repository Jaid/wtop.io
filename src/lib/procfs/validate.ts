import type {RawSnapshot} from './types.ts'

const fail = (): never => {
  throw new Error('The collector returned an invalid snapshot.')
}
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail())
const array = (value: unknown): Array<unknown> => (Array.isArray(value) && value.length <= 100_000 ? value : fail())
const numeric = (value: unknown, min = 0) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    fail()
  }
}
const text = (value: unknown) => {
  if (typeof value !== 'string') {
    fail()
  }
}
const fields = (value: unknown, numbers: Array<string>, strings: Array<string> = []) => {
  const row = record(value)
  for (const key of numbers) {
    numeric(row[key])
  }
  for (const key of strings) {
    text(row[key])
  }
  return row
}
const cpu = (value: unknown) => fields(value, ['user', 'nice', 'system', 'idle', 'iowait', 'irq', 'softirq', 'steal', 'guest'])

/** Validate before putting untrusted transport data into rate calculations or React. */
export const validateSnapshot = (value: unknown): RawSnapshot => {
  const snapshot = fields(value, ['clockTicks', 'contextSwitches', 'uptime'])
  if (Number(snapshot.clockTicks) <= 0) {
    fail()
  }
  cpu(snapshot.cpu)
  const cores = array(snapshot.cpus)
  if (!cores.length) {
    fail()
  }
  cores.forEach(cpu)
  fields(snapshot.memory, ['total', 'free', 'available', 'buffers', 'cached', 'shared', 'reclaimable', 'dirty', 'swapTotal', 'swapFree', 'swapCached'])
  fields(snapshot.tasks, ['running', 'total'])
  const load = array(snapshot.load)
  if (load.length !== 3) {
    fail()
  }
  for (const value of load) {
    numeric(value)
  }
  for (const value of array(snapshot.cpuFrequencies)) {
    numeric(value)
  }
  for (const item of array(snapshot.interfaces)) {
    fields(item, ['rxBytes', 'rxErrors', 'rxPackets', 'txBytes', 'txErrors', 'txPackets'], ['name'])
  }
  for (const item of array(snapshot.disks)) {
    const disk = fields(item, ['ioMilliseconds', 'readSectors', 'reads', 'writeSectors', 'writes'], ['name'])
    if (disk.aggregate !== undefined && typeof disk.aggregate !== 'boolean') {
      fail()
    }
  }
  for (const item of array(snapshot.filesystems)) {
    fields(item, ['available', 'free', 'size'], ['mount', 'device', 'type'])
  }
  for (const item of array(snapshot.sensors)) {
    const sensor = fields(item, [], ['chip', 'label'])
    numeric(sensor.celsius, -273.15)
    if (sensor.id !== undefined) {
      text(sensor.id)
    }
  }
  for (const item of array(snapshot.gpus)) {
    const gpu = fields(item, [], ['card'])
    for (const key of ['busy', 'vramUsed', 'vramTotal']) {
      if (gpu[key] !== undefined) {
        numeric(gpu[key])
      }
    }
    for (const key of ['device', 'state']) {
      if (gpu[key] !== undefined) {
        text(gpu[key])
      }
    }
  }
  for (const item of array(snapshot.processes)) {
    const process = fields(item, ['pid', 'ppid', 'ticks', 'startTicks', 'rss', 'threads', 'processor'], ['comm', 'state'])
    for (const key of ['pid', 'ppid', 'startTicks']) {
      if (!Number.isSafeInteger(process[key])) {
        fail()
      }
    }
    numeric(process.nice, -20)
    numeric(process.priority, -100)
    for (const key of ['readBytes', 'writeBytes', 'uid']) {
      if (process[key] !== undefined) {
        numeric(process[key])
      }
    }
    for (const key of ['unit', 'containerId']) {
      if (process[key] !== undefined) {
        text(process[key])
      }
    }
    if (process.isKernelThread !== undefined && typeof process.isKernelThread !== 'boolean') {
      fail()
    }
    array(process.cmdline).forEach(text)
  }
  Object.values(record(snapshot.users)).forEach(text)
  for (const key of ['hostname', 'cpuModel', 'bootId']) {
    if (snapshot[key] !== undefined) {
      text(snapshot[key])
    }
  }
  if (snapshot.fans !== undefined) {
    for (const item of array(snapshot.fans)) {
      fields(item, ['rpm'], ['chip', 'label'])
    }
  }
  if (snapshot.pressure !== undefined) {
    for (const resource of Object.values(record(snapshot.pressure))) {
      for (const entry of Object.values(record(resource))) {
        fields(entry, ['avg10', 'avg60', 'avg300', 'total'])
      }
    }
  }
  return value as RawSnapshot
}
