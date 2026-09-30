import {describe, expect, test} from 'bun:test'

import {censorArgv} from '#src/lib/argv.ts'
import {demuxDockerStream, gunzip, readResponse} from '#src/lib/docker/demux.ts'
import {DockerClient} from '#src/lib/docker/DockerClient.ts'
import {deriveFrame} from '#src/lib/monitor/derive.ts'
import {Monitor} from '#src/lib/monitor/Monitor.ts'
import {validateSnapshot} from '#src/lib/procfs/validate.ts'
import {agentConfig, DockerSource, splitImageReference, validateAgent} from '#src/lib/source/DockerSource.ts'
import {SimulationSource} from '#src/lib/source/SimulationSource.ts'
import {buildSearch, getEndpointKey, readQueryParameters} from '#src/queryParameters.ts'

import {FakeDocker, frameBytes} from '../lib/FakeDocker.ts'

const makeSource = (daemon: FakeDocker, extra = {}) => new DockerSource({
  baseUrl: 'http://fixture:2375',
  image: 'oven/bun:1.4.2-distroless',
  lifetime: 120,
  fetch: daemon.fetch,
  ...extra,
})
describe('collector lifecycle', () => {
  test('concurrent clients safely share a compatible collector', async () => {
    const daemon = new FakeDocker
    const a = makeSource(daemon)
    const b = makeSource(daemon)
    await Promise.all([a.connect(() => {}), b.connect(() => {})])
    expect(daemon.created).toBe(1)
    expect(a.agentContainerId).toBe(b.agentContainerId)
    const sample = await a.sample()
    expect(sample.snapshot.processes.length).toBeGreaterThan(20)
    expect(sample.snapshot.clockTicks).toBeGreaterThan(0)
    a.dispose(); b.dispose()
  })
  test('different lifetime or image configurations do not fight over the same container', async () => {
    const daemon = new FakeDocker
    const a = makeSource(daemon)
    const b = makeSource(daemon, {lifetime: 60})
    const c = makeSource(daemon, {image: 'python:3.14-slim'})
    await Promise.all([a.connect(() => {}), b.connect(() => {}), c.connect(() => {})])
    expect(daemon.created).toBe(3)
    expect(new Set([a.agentContainerId, b.agentContainerId, c.agentContainerId]).size).toBe(3)
    a.dispose(); b.dispose(); c.dispose()
  })
  test('refuses a same-name foreign collector without deleting it', async () => {
    const daemon = new FakeDocker
    const a = makeSource(daemon)
    await a.connect(() => {})
    const container = daemon.containers.get(a.agentContainerId!)!
    container.Config.Cmd = ['unrelated-program']
    const b = makeSource(daemon)
    await expect(b.connect(() => {})).rejects.toThrow('incompatible')
    expect(daemon.requests.some(request => request.method === 'DELETE')).toBe(false)
    expect(daemon.created).toBe(1)
    a.dispose(); b.dispose()
  })
  test('recovers sampling after idle auto-removal', async () => {
    const daemon = new FakeDocker
    const source = makeSource(daemon)
    await source.connect(() => {})
    daemon.expireNextSample = true
    await source.sample()
    expect(daemon.created).toBe(2)
    source.dispose()
  })
  test('does not retry a failed destructive request', async () => {
    const daemon = new FakeDocker
    const source = makeSource(daemon, {destructive: true})
    await source.connect(() => {})
    daemon.failSignals = true
    await expect(source.signal(123, 'TERM', 456)).rejects.toThrow()
    expect(daemon.signalAttempts).toBe(1)
    expect(daemon.created).toBe(1)
    source.dispose()
  })
  test('rejects disabled actions and missing or invalid identities before sending them', async () => {
    const daemon = new FakeDocker
    const source = makeSource(daemon)
    await expect(source.signal(123, 'TERM', 456)).rejects.toThrow('disabled')
    const enabled = makeSource(daemon, {destructive: true})
    await enabled.connect(() => {})
    await expect(enabled.signal(123, 'TERM')).rejects.toThrow('identity')
    await expect(enabled.signal(1, 'KILL', 10)).rejects.toThrow('identity')
    expect(daemon.signalAttempts).toBe(0)
    enabled.dispose(); source.dispose()
  })
  test('passes privacy and process start identity to the collector', async () => {
    const daemon = new FakeDocker
    const source = makeSource(daemon, {
      argv: 'hidden',
      destructive: true,
    })
    await source.connect(() => {})
    await source.sample()
    await source.signal(123, 'STOP', 456)
    const requests = [...daemon.executions.values()].map(exec => exec.request)
    expect(requests).toContainEqual({
      action: 'sample',
      argv: 'hidden',
    })
    expect(requests).toContainEqual({
      action: 'signal',
      pid: 123,
      startTicks: 456,
      signal: 'STOP',
    })
    source.dispose()
  })
  test('disposing a source prevents future provisioning', async () => {
    const daemon = new FakeDocker
    const source = makeSource(daemon)
    source.dispose()
    await expect(source.connect(() => {})).rejects.toThrow()
    expect(daemon.created).toBe(0)
  })
  test('preserves image digest pins and validates container isolation', () => {
    const digest = `sha256:${'a'.repeat(64)}`
    expect(splitImageReference(`registry:5000/python:3.14@${digest}`)).toEqual({
      repository: 'registry:5000/python',
      tag: digest,
    })
    expect(() => validateAgent({}, agentConfig('python', 120), 'test')).toThrow('incompatible')
    const config = agentConfig('python', 120)
    expect(config.HostConfig).toMatchObject({
      ReadonlyRootfs: true,
      NetworkMode: 'none',
      PidMode: 'host',
      AutoRemove: true,
    })
  })
})
describe('transport and data boundaries', () => {
  test('rejects truncated and unknown Docker stream frames', () => {
    const frame = frameBytes((new TextEncoder).encode('data'))
    expect(() => demuxDockerStream(frame.subarray(0, -1))).toThrow('inside a frame')
    frame[0] = 3
    expect(() => demuxDockerStream(frame)).toThrow('header')
  })
  test('decompresses gzip and bounds response sizes', async () => {
    const value = (new TextEncoder).encode('roundtrip')
    expect(await gunzip(Bun.gzipSync(value))).toEqual(value)
    await expect(readResponse(new Response(new Uint8Array(50)), 10)).rejects.toThrow('size limit')
  })
  test('never reflects secret response bodies in API errors', async () => {
    const client = new DockerClient({
      baseUrl: 'http://fixture',
      bearer: 'private-token',
      fetch: async () => new Response('private-token /etc/secret', {status: 500}),
    })
    const error = await client.json('GET', '/info').catch((error: unknown) => error)
    expect(String(error)).not.toContain('private-token')
    expect(String(error)).not.toContain('/etc/secret')
  })
  test('sets safe request policies', async () => {
    let seen: RequestInit | undefined
    const client = new DockerClient({
      baseUrl: 'http://fixture',
      fetch: async (_, init) => {
        seen = init; return new Response('{}')
      },
    })
    await client.json('GET', '/info')
    expect(seen).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    })
  })
  test('validates real-shaped snapshots without leaking rejected input', () => {
    const snapshot = (new FakeDocker).host.snapshot()
    expect(validateSnapshot(snapshot)).toBe(snapshot)
    expect(() => validateSnapshot({
      ...snapshot,
      clockTicks: 0,
    })).toThrow('invalid snapshot')
    expect(() => validateSnapshot({
      ...snapshot,
      processes: [{comm: 'SECRET'}],
    })).toThrow('invalid snapshot')
  })
  test('case-sensitive endpoint paths never share a credential key', () => {
    const base = {
      host: 'NAS',
      protocol: 'https' as const,
      port: 443,
    }
    expect(getEndpointKey({
      ...base,
      path: '/Docker',
    })).not.toBe(getEndpointKey({
      ...base,
      path: '/docker',
    }))
    expect(getEndpointKey({
      ...base,
      path: '/Docker',
    })).toBe('https://nas/Docker')
  })
  test.each(['70000', '12.5', 'NaN', 'Infinity'])('rejects invalid port %s', value => {
    expect(readQueryParameters(`http://fixture/?host=nas&port=${value}`).errors.port).toBeDefined()
  })
  test('rejects host credentials, paths and path traversal', () => {
    for (const host of ['user@nas', 'nas/path', 'nas?query']) {
      expect(readQueryParameters(`http://fixture/?host=${encodeURIComponent(host)}`).errors.host).toBeDefined()
    }
    expect(readQueryParameters(`http://fixture/?host=nas&path=${encodeURIComponent('/../secret')}`).errors.path).toBeDefined()
  })
  test('censors fused short options and everything after the positional delimiter', () => {
    const result = censorArgv(['curl', '-psecret', '--token=secret', '--', '--secret'])
    expect(result.join(' ')).not.toContain('secret')
    expect(result[1]).toBe('-p••••••')
  })
  test('safe generated links omit incoming bearer values too', () => {
    const {values} = readQueryParameters('https://wtop.io/setup?host=nas&bearer=SECRET')
    expect(buildSearch(values)).toBe('?host=nas')
  })
  test('sums container resources and omits stacked disks from host totals', () => {
    const daemon = new FakeDocker
    const previous = {
      snapshot: daemon.host.snapshot(),
      containers: daemon.host.containerInfos(),
      receivedAt: 1000,
    }
    daemon.host.advance(1)
    const snapshot = daemon.host.snapshot()
    snapshot.disks.push({
      ...snapshot.disks[0],
      name: 'dm-0',
      aggregate: false,
    })
    const frame = deriveFrame(previous, {
      snapshot,
      containers: daemon.host.containerInfos(),
      receivedAt: 2000,
    })
    expect(frame.containers.some(container => container.name === 'postgres')).toBe(true)
    expect(frame.containers.every(container => container.processes > 0 && container.memory >= 0)).toBe(true)
  })
  test('host reboot clears incompatible histories and starts a new rate baseline', async () => {
    const source = new SimulationSource({clock: () => 1_790_000_000_000})
    const monitor = new Monitor(source, {
      interval: 1000,
      historySeconds: 30,
    })
    const a = await source.sample()
    a.snapshot.bootId = 'boot-a'
    monitor.ingest(a)
    const b = structuredClone(a)
    b.snapshot.uptime++
    monitor.ingest(b)
    expect(monitor.history.times.length).toBe(1)
    const c = structuredClone(b)
    c.snapshot.bootId = 'boot-b'
    monitor.ingest(c)
    expect(monitor.history.times.length).toBe(0)
    monitor.stop()
  })
})
test('samples use MessagePack and two Docker calls without INFO or VERSION permissions', async () => {
  const fake = new FakeDocker
  const source = new DockerSource({
    baseUrl: 'http://fixture:2375',
    image: 'oven/bun:1.4.2-distroless',
    lifetime: 120,
    fetch: fake.fetch,
  })
  await source.connect(() => {})
  const offset = fake.requests.length
  const sample = await source.sample()
  expect(sample.snapshot.processes.length).toBeGreaterThan(0)
  expect(fake.requests.slice(offset).map(item => item.method)).toEqual(['POST', 'POST'])
  expect(fake.requests.some(item => ['/info', '/version'].includes(item.url.pathname))).toBe(false)
  expect([...fake.executions.values()].every(item => item.command[0] === 'bun' && item.command[3].length < 1000)).toBe(true)
  source.dispose()
})
