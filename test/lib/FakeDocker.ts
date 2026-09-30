import type {FetchFunction} from '#src/lib/docker/DockerClient.ts'

import {pack} from 'msgpackr/pack'

import {SimulatedHost} from '#src/lib/source/simulation/SimulatedHost.ts'

export const frameBytes = (payload: Uint8Array, stream = 1) => {
  const bytes = new Uint8Array(8 + payload.length)
  bytes[0] = stream
  new DataView(bytes.buffer).setUint32(4, payload.length)
  bytes.set(payload, 8)
  return bytes
}
const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: {'content-type': 'application/json'},
})
type StoredContainer = {
  Config: Record<string, any>
  HostConfig: Record<string, any>
  Id: string
  Name: string
  State: {
    Paused: boolean
    Running: boolean
    Status: string
  }
}

/** Synthetic Docker transport. No host information, credentials or real processes. */
export class FakeDocker {
  readonly containers = new Map<string, StoredContainer>
  created = 0
  readonly executions = new Map<string, {
    command: Array<string>
    request: Record<string, any>
  }>
  expireNextSample = false
  failSignals = false
  fetch: FetchFunction = async (input, init) => {
    init.signal?.throwIfAborted()
    const url = new URL(input)
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' && init.body.trim() ? JSON.parse(init.body) : undefined
    this.requests.push({
      url,
      method,
      body,
      headers: new Headers(init.headers),
    })
    const path = url.pathname.replace(/^\/docker/, '')
    if (path === '/info') {
      return json({
        Name: 'fixture-host',
        NCPU: 24,
        MemTotal: 32e9,
        OSType: 'linux',
        OperatingSystem: 'Fixture Linux',
        ServerVersion: '29.8.0',
      })
    }
    if (path === '/version') {
      return json({
        Version: '29.8.0',
        ApiVersion: '1.56',
        Os: 'linux',
      })
    }
    if (path.startsWith('/images/')) {
      return json({Id: `sha256:${'a'.repeat(64)}`})
    }
    if (path === '/containers/json') {
      const filters = JSON.parse(url.searchParams.get('filters') ?? '{}')
      const matching = filters.name?.[0]?.slice(2, -1)
      return json([...this.containers.values()].filter(item => !matching || item.Name === `/${matching}`).map(item => ({
        Id: item.Id,
        Names: [item.Name],
        State: item.State.Status,
        Status: 'Up',
        Labels: item.Config.Labels,
        Image: item.Config.Image,
      })))
    }
    if (path === '/containers/create') {
      const name = `/${url.searchParams.get('name')}`
      if ([...this.containers.values()].some(item => item.Name === name)) {
        return json({}, 409)
      }
      const Id = this.nextId()
      const {HostConfig, ...Config} = body
      this.containers.set(Id, {
        Id,
        Name: name,
        Config,
        HostConfig,
        State: {
          Running: false,
          Paused: false,
          Status: 'created',
        },
      })
      this.created++
      return json({Id}, 201)
    }
    const containerMatch = /^\/containers\/([^/]+)\/(exec|json|start)$/.exec(path)
    if (containerMatch) {
      const container = this.containers.get(containerMatch[1])
      if (!container) {
        return json({}, 404)
      }
      const operation = containerMatch[2]
      if (operation === 'json') {
        return json(container)
      }
      if (operation === 'start') {
        const status = container.State.Running ? 304 : 204
        container.State = {
          Running: true,
          Paused: false,
          Status: 'running',
        }
        return new Response(null, {status})
      }
      const request = JSON.parse(body.Cmd.at(-1))
      if (request.action === 'sample' && this.expireNextSample) {
        this.expireNextSample = false
        this.containers.delete(container.Id)
        return json({}, 404)
      }
      if (request.action === 'signal') {
        this.signalAttempts++
        if (this.failSignals) {
          return json({}, 404)
        }
      }
      const Id = this.nextId()
      this.executions.set(Id, {
        command: body.Cmd,
        request,
      })
      return json({Id}, 201)
    }
    const execMatch = /^\/exec\/([^/]+)\/(json|start)$/.exec(path)
    if (execMatch) {
      const exec = this.executions.get(execMatch[1])
      if (!exec) {
        return json({}, 404)
      }
      if (execMatch[2] === 'json') {
        return json({
          Running: false,
          ExitCode: 0,
        })
      }
      this.host.advance(1)
      const output = exec.request.action === 'sample' ? {
        ok: true,
        protocol: 3,
        snapshot: {
          ...this.host.snapshot(),
          hostname: 'fixture-host',
        },
      } : {ok: true}
      return new Response(frameBytes(Bun.gzipSync(new Uint8Array(pack(output)))))
    }
    return json({message: 'unknown endpoint'}, 404)
  }
  readonly host = new SimulatedHost({
    seed: 7,
    now: 1_790_000_000_000,
  })
  readonly requests: Array<{
    body: any
    headers: Headers
    method: string
    url: URL
  }> = []
  sequence = 0
  signalAttempts = 0
  private nextId() {
    return (++this.sequence).toString(16).padStart(64, '0')
  }
}
