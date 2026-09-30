import {describe, expect, test} from 'bun:test'

import {censorArgv, joinArgv, presentArgv} from '#src/lib/argv.ts'
import {guessTargetAddressSpace, shouldDeclareAddressSpace} from '#src/lib/docker/addressSpace.ts'
import {demuxDockerStream} from '#src/lib/docker/demux.ts'
import {DockerClient, DockerError} from '#src/lib/docker/DockerClient.ts'
import {formatBytes, formatDuration, formatNumber, formatPercent, formatRate, formatTemperature} from '#src/lib/format.ts'
import {cpuBreakdown, deriveFrame, findAgentPids, isVirtualInterface} from '#src/lib/monitor/derive.ts'
import {History} from '#src/lib/monitor/History.ts'
import {Monitor} from '#src/lib/monitor/Monitor.ts'
import {buildDisplayRows, createMatcher} from '#src/lib/monitor/processes.ts'
import {emptyCpuTimes} from '#src/lib/procfs/types.ts'
import {DockerSource, splitImageReference} from '#src/lib/source/DockerSource.ts'
import {SimulationSource} from '#src/lib/source/SimulationSource.ts'
import {buildSearch, getApiBaseUrl, getEndpointKey, readQueryParameters} from '#src/queryParameters.ts'

const nnbsp = '\u{202F}'
describe('format', () => {
  test('groups thousands only from 10 000', () => {
    expect(formatNumber(4096)).toBe('4096')
    expect(formatNumber(65_536)).toBe(`65${nnbsp}536`)
    expect(formatNumber(49_174.4193, 4)).toBe(`49${nnbsp}174.4193`)
    expect(formatNumber(-12_345)).toBe(`−12${nnbsp}345`)
  })
  test('uses SI byte units with narrow spaces', () => {
    expect(formatBytes(0)).toBe(`0${nnbsp}b`)
    expect(formatBytes(999)).toBe(`999${nnbsp}b`)
    expect(formatBytes(65_535)).toBe(`65.5${nnbsp}kb`)
    expect(formatBytes(1_500_000)).toBe(`1.50${nnbsp}mb`)
    expect(formatBytes(999_999)).toBe(`1.00${nnbsp}mb`)
    expect(formatBytes(33_490_714_624)).toBe(`33.5${nnbsp}gb`)
    expect(formatRate(2048)).toBe(`2.05${nnbsp}kb/s`)
  })
  test('formats percentages, durations and temperatures', () => {
    expect(formatPercent(3.456)).toBe('3.5%')
    expect(formatPercent(42.4)).toBe('42%')
    expect(formatDuration(59)).toBe('59s')
    expect(formatDuration(3 * 86_400 + 4 * 3600 + 5)).toBe('3d 4h')
    expect(formatDuration(3725)).toBe('1h 2m')
    expect(formatTemperature(46.4)).toBe(`46${nnbsp}℃`)
    expect(formatNumber(Number.NaN)).toBe('–')
  })
})
describe('argv', () => {
  test('censors values but keeps flags and the executable', () => {
    expect(censorArgv(['node', '--host=secret', '--port', '8080', '-v'])).toEqual(['node', '--host=••••••', '--port', '••••', '-v'])
  })
  test('applies privacy modes', () => {
    expect(presentArgv(['a', 'b'], 'hidden')).toBeUndefined()
    expect(presentArgv(['a', 'b'], 'full')).toEqual(['a', 'b'])
  })
  test('quotes arguments with whitespace', () => {
    expect(joinArgv(['sh', '-c', 'echo hi', ''])).toBe('sh -c "echo hi" ""')
  })
})
describe('docker helpers', () => {
  test('demultiplexes attach streams', () => {
    const frame = (stream: number, text: string) => {
      const payload = (new TextEncoder).encode(text)
      const header = new Uint8Array(8)
      header[0] = stream
      new DataView(header.buffer).setUint32(4, payload.length)
      return [...header, ...payload]
    }
    const {stdout, stderr} = demuxDockerStream(new Uint8Array([...frame(1, 'out1'), ...frame(2, 'err'), ...frame(1, 'out2')]))
    expect((new TextDecoder).decode(stdout)).toBe('out1out2')
    expect((new TextDecoder).decode(stderr)).toBe('err')
    const raw = (new TextEncoder).encode('plain')
    expect(() => demuxDockerStream(raw)).toThrow('frame')
  })
  test('splits image references', () => {
    expect(splitImageReference('alpine:3.22')).toEqual({
      repository: 'alpine',
      tag: '3.22',
    })
    expect(splitImageReference('registry:5000/busybox')).toEqual({
      repository: 'registry:5000/busybox',
      tag: 'latest',
    })
    expect(splitImageReference('ghcr.io/a/b:1@sha256:abc')).toEqual({
      repository: 'ghcr.io/a/b',
      tag: 'sha256:abc',
    })
  })
  test('guesses local network address spaces', () => {
    expect(guessTargetAddressSpace('localhost')).toBe('loopback')
    expect(guessTargetAddressSpace('127.0.0.1')).toBe('loopback')
    expect(guessTargetAddressSpace('192.168.1.20')).toBe('local')
    expect(guessTargetAddressSpace('172.20.0.1')).toBe('local')
    expect(guessTargetAddressSpace('nas')).toBe('local')
    expect(guessTargetAddressSpace('nas.local')).toBe('local')
    expect(guessTargetAddressSpace('8.8.8.8')).toBeUndefined()
    expect(guessTargetAddressSpace('docker.example.com')).toBeUndefined()
    expect(shouldDeclareAddressSpace('http', 'https:')).toBe(true)
    expect(shouldDeclareAddressSpace('https', 'https:')).toBe(false)
  })
  test('sends the Bearer token and explains failures', async () => {
    const requests: Array<Request> = []
    const client = new DockerClient({
      baseUrl: 'http://host:2375/',
      bearer: 'secret',
      fetch: async (input, init) => {
        requests.push(new Request(input, init))
        return Response.json({message: 'forbidden by proxy'}, {status: 403})
      },
    })
    const error = await client.json('POST', '/containers/create').catch((error_: unknown) => error_) as DockerError
    expect(error).toBeInstanceOf(DockerError)
    expect(error.message).toBe('Docker request failed (HTTP 403).')
    expect(error.hint).toContain('socket proxy')
    expect(requests[0].headers.get('authorization')).toBe('Bearer secret')
    expect(requests[0].url).toBe('http://host:2375/containers/create')
  })
  test('reports unreachable endpoints with a CORS hint', async () => {
    const source = new DockerSource({baseUrl: 'http://host:2375', image: 'alpine', lifetime: 60, fetch: async () => {
      throw new TypeError('Failed to fetch')
    }})
    const error = await source.connect(() => {}).catch((error_: unknown) => error_) as DockerError
    expect(error.hint).toContain('CORS')
  })
})
describe('query parameters', () => {
  test('reads values, falls back on invalid input and reports errors', () => {
    const {values, errors} = readQueryParameters('http://x/?host=10.0.0.2&port=99999&interval=500&argv=censored&destructive=1')
    expect(values.host).toBe('10.0.0.2')
    expect(values.port).toBe(2375)
    expect(errors.port).toBeDefined()
    expect(values.interval).toBe(500)
    expect(values.argv).toBe('censored')
    expect(values.destructive).toBe(true)
  })
  test('builds minimal links without the Bearer token by default', () => {
    expect(buildSearch({
      host: 'nas',
      port: 2375,
      bearer: 'secret',
      sound: 'all',
    })).toBe('?host=nas&sound=all')
    expect(buildSearch({
      host: 'nas',
      bearer: 'secret',
    }, {includeBearer: true})).toBe('?host=nas&bearer=secret')
  })
  test('builds API base URLs', () => {
    expect(getApiBaseUrl({
      host: 'nas',
      port: 2376,
      protocol: 'https',
      path: '/docker',
    })).toBe('https://nas:2376/docker')
    expect(getApiBaseUrl({
      host: 'fd00::1',
      port: 2375,
      protocol: 'http',
      path: '',
    })).toBe('http://[fd00::1]:2375')
    expect(getEndpointKey({
      host: 'NAS',
      port: 2375,
      protocol: 'http',
      path: '',
    })).toBe('http://nas:2375')
    expect(getApiBaseUrl({
      host: undefined,
      port: 2375,
      protocol: 'http',
      path: '',
    })).toBeUndefined()
  })
})
describe('monitor', () => {
  test('computes CPU breakdowns from tick deltas', () => {
    const before = {
      ...emptyCpuTimes(),
      user: 100,
      system: 50,
      idle: 850,
    }
    const after = {
      ...emptyCpuTimes(),
      user: 150,
      system: 75,
      idle: 1025,
      iowait: 0,
    }
    const breakdown = cpuBreakdown(after, before)
    expect(breakdown.total).toBeCloseTo(30)
    expect(breakdown.user).toBeCloseTo(20)
    expect(breakdown.system).toBeCloseTo(10)
  })
  test('classifies virtual interfaces', () => {
    expect(isVirtualInterface('veth1234')).toBe(true)
    expect(isVirtualInterface('docker0')).toBe(true)
    expect(isVirtualInterface('enp5s0')).toBe(false)
  })
  test('finds agent processes by marker and descent', () => {
    const base = {
      comm: 'sh',
      state: 'S',
      ticks: 0,
      startTicks: 0,
      rss: 0,
      threads: 1,
      nice: 0,
      priority: 20,
      processor: 0,
    }
    const pids = findAgentPids([
      {
        ...base,
        pid: 10,
        ppid: 1,
        cmdline: ['bun', '--eval', "const socket = '/tmp/wtop.sock'"],
      },
      {
        ...base,
        pid: 11,
        ppid: 10,
        cmdline: ['cat', 'stat'],
      },
      {
        ...base,
        pid: 12,
        ppid: 1,
        cmdline: ['bash'],
      },
    ])
    expect([...pids].toSorted()).toEqual([10, 11])
  })
  test('derives consistent frames from the simulation', async () => {
    let now = 1_790_000_000_000
    const source = new SimulationSource({
      clock: () => now,
      seed: 1,
    })
    await source.connect(() => {})
    const first = await source.sample()
    now += 1000
    const second = await source.sample()
    const frame = deriveFrame(first, second)
    expect(frame.interval).toBeCloseTo(1, 1)
    expect(frame.cpu.cores).toHaveLength(24)
    expect(frame.cpu.total).toBeGreaterThan(0)
    expect(frame.cpu.total).toBeLessThanOrEqual(100)
    expect(frame.memory.percent).toBeGreaterThan(0)
    expect(frame.processes.length).toBeGreaterThan(50)
    expect(frame.processes.every(process => process.cpu >= 0 && Number.isFinite(process.cpu))).toBe(true)
    expect(frame.processes.some(process => process.container?.name === 'postgres')).toBe(true)
    expect(frame.network.rx).toBeGreaterThan(0)
  })
  test('is deterministic for a given seed and clock', async () => {
    const run = async () => {
      let now = 1_790_000_000_000
      const source = new SimulationSource({
        clock: () => now,
        seed: 3,
      })
      await source.connect(() => {})
      now += 5000
      return (await source.sample()).snapshot.cpu
    }
    expect(await run()).toEqual(await run())
  })
  test('simulates signals and restarts', async () => {
    let now = 1_790_000_000_000
    const source = new SimulationSource({
      clock: () => now,
      seed: 5,
    })
    await source.connect(() => {})
    const before = await source.sample()
    const api = before.snapshot.processes.find(process => process.comm === 'node')!
    await source.signal(api.pid, 'STOP')
    now += 1000
    expect((await source.sample()).snapshot.processes.find(process => process.pid === api.pid)?.state).toBe('T')
    await source.signal(api.pid, 'KILL')
    now += 6000
    const after = await source.sample()
    expect(after.snapshot.processes.some(process => process.pid === api.pid)).toBe(false)
    expect(after.snapshot.processes.some(process => process.comm === 'node')).toBe(true)
    expect(source.signal(999_999, 'TERM')).rejects.toThrow('No such process')
  })
  test('keeps history series aligned', () => {
    const history = new History(3)
    history.pushValues(1, {a: 1})
    history.pushValues(2, {
      a: 2,
      b: 20,
    })
    history.pushValues(3, {
      a: 3,
      b: 30,
    })
    history.pushValues(4, {a: 4})
    expect(history.times).toEqual([2, 3, 4])
    expect(history.get('a')).toEqual([2, 3, 4])
    expect(history.get('b')).toEqual([20, 30, Number.NaN])
  })
  test('backfills demo history and goes live', async () => {
    const monitor = new Monitor(new SimulationSource({seed: 9}), {
      interval: 1000,
      historySeconds: 30,
    })
    const done = new Promise<void>(resolve => {
      monitor.subscribe(() => {
        if (monitor.getState().status === 'live') {
          resolve()
        }
      })
    })
    monitor.start()
    await done
    expect(monitor.history.times.length).toBeGreaterThan(25)
    expect(monitor.getState().frame).toBeDefined()
    monitor.stop()
  })
  test('keeps polling when a retry arrives during a slow sample', async () => {
    const simulation = new SimulationSource({seed: 2})
    let calls = 0
    let release: (() => void) | undefined
    const original = simulation.sample.bind(simulation)
    simulation.sample = async () => {
      calls++
      if (calls === 2) {
        await new Promise<void>(resolve => {
          release = resolve
        })
      }
      return original()
    }
    const monitor = new Monitor(simulation, {
      interval: 250,
      historySeconds: 10,
    })
    monitor.start()
    await new Promise(resolve => setTimeout(resolve, 700))
    expect(release).toBeDefined()
    monitor.retry()
    release?.()
    await new Promise(resolve => setTimeout(resolve, 900))
    expect(calls).toBeGreaterThan(3)
    monitor.stop()
  })
  test('reports connection errors with retry information', async () => {
    const monitor = new Monitor(new DockerSource({
      baseUrl: 'http://host:2375',
      image: 'alpine',
      lifetime: 60,
      fetch: async () => new Response('nope', {status: 401}),
    }), {
      interval: 1000,
      historySeconds: 30,
    })
    const failed = new Promise<void>(resolve => {
      monitor.subscribe(() => {
        if (monitor.getState().status === 'error') {
          resolve()
        }
      })
    })
    monitor.start()
    await failed
    const state = monitor.getState()
    expect(state.error?.hint).toContain('Bearer')
    expect(state.retryAt).toBeGreaterThan(Date.now())
    monitor.stop()
  })
})
describe('process list', () => {
  const row = (pid: number, ppid: number, name: string, cpu: number, extra: Record<string, unknown> = {}) => ({
    key: `${pid}:0`,
    startTicks: 0,
    pid,
    ppid,
    name,
    cpu,
    state: 'S',
    user: 'root',
    uid: 0,
    memory: 0,
    memoryPercent: 0,
    threads: 1,
    nice: 0,
    priority: 20,
    processor: 0,
    age: 1,
    startedAt: 0,
    argv: [name],
    isAgent: false,
    isKernelThread: false,
    ...extra,
  })
  const processes = [row(1, 0, 'init', 0), row(10, 1, 'nginx', 5), row(11, 10, 'worker', 50), row(12, 10, 'worker', 20), row(20, 1, 'sshd', 1), row(3, 2, 'kworker', 0, {
    isKernelThread: true,
    argv: [],
  })]
  const options = {
    sort: 'cpu' as const,
    direction: 'desc' as const,
    filter: '',
    tree: false,
    showKernel: false,
    showAgent: false,
    argvMode: 'full' as const,
  }
  test('sorts flat lists and hides kernel threads', () => {
    expect(buildDisplayRows(processes, options).map(entry => entry.process.pid)).toEqual([11, 12, 10, 20, 1])
  })
  test('builds trees and keeps ancestors of matches', () => {
    const rows = buildDisplayRows(processes, {
      ...options,
      tree: true,
      filter: 'worker',
    })
    expect(rows.map(entry => entry.process.pid)).toEqual([1, 10, 11, 12])
    expect(rows.map(entry => entry.dimmed)).toEqual([true, true, false, false])
    expect(rows[1].branch).toBe('└─')
    expect(rows[2].branch).toBe('  ├─')
    expect(rows[3].branch).toBe('  └─')
  })
  test('collapses branches', () => {
    const rows = buildDisplayRows(processes, {
      ...options,
      tree: true,
      collapsed: new Set(['10:0']),
    })
    expect(rows.map(entry => entry.process.pid)).toEqual([1, 10, 20])
  })
  test('supports field filters', () => {
    const matcher = createMatcher('user:root pid:11')!
    expect(matcher(processes[2], '')).toBe(true)
    expect(matcher(processes[1], '')).toBe(false)
  })
})
