import type {ArgvMode} from '#src/lib/argv.ts'
import type {TargetAddressSpace} from '#src/lib/docker/addressSpace.ts'
import type {FetchFunction} from '#src/lib/docker/DockerClient.ts'
import type {Signal} from '#src/lib/procfs/script.ts'
import type {ContainerInfo, HostInfo, ProgressListener, Sample} from './base/DataSource.ts'

import {demuxDockerStream, gunzip} from '#src/lib/docker/demux.ts'
import {DockerClient, DockerError} from '#src/lib/docker/DockerClient.ts'
import {collectorRevision} from '#src/lib/procfs/collectorSource.ts'
import {collectorCommand, isSignal} from '#src/lib/procfs/script.ts'
import {validateSnapshot} from '#src/lib/procfs/validate.ts'

import {DataSource} from './base/DataSource.ts'

export type DockerSourceOptions = {
  argv?: ArgvMode
  baseUrl: string
  bearer?: string
  destructive?: boolean
  fetch?: FetchFunction
  image: string
  lifetime: number
  targetAddressSpace?: TargetAddressSpace
}

type ContainerSummary = {
  Id: string
  Image: string
  Labels?: Record<string, string>
  Names?: Array<string>
  State: string
  Status: string
}
type ExecInspect = {
  ExitCode: number | null
  Running: boolean
}
const agentLabel = 'io.wtop.collector'
const agentProtocol = '2'

/** Preserve digest pins when pulling; never silently replace them with a mutable tag. */
export const splitImageReference = (image: string) => {
  const at = image.indexOf('@')
  const reference = at === -1 ? image : image.slice(0, at)
  const colon = reference.lastIndexOf(':')
  const tagged = colon > reference.lastIndexOf('/')
  return {
    repository: tagged ? reference.slice(0, colon) : reference,
    tag: at === -1 ? tagged ? reference.slice(colon + 1) : 'latest' : image.slice(at + 1),
  }
}

export const agentConfig = (image: string, lifetime: number) => ({
  Image: image,
  User: '0:0',
  WorkingDir: '/',
  Entrypoint: [],
  Cmd: collectorCommand({
    action: 'watch',
    lifetime,
  }),
  Labels: {
    [agentLabel]: agentProtocol,
    'io.wtop.revision': collectorRevision,
  },
  Tty: false,
  OpenStdin: false,
  StopTimeout: 2,
  HostConfig: {
    AutoRemove: true,
    Privileged: true,
    PidMode: 'host',
    UTSMode: 'host',
    CgroupnsMode: 'host',
    NetworkMode: 'none',
    ReadonlyRootfs: true,
    Tmpfs: {'/tmp': 'rw,nosuid,nodev,noexec,size=8m'},
    Memory: 256 * 1024 * 1024,
    PidsLimit: 128,
    LogConfig: {
      Type: 'none',
      Config: {},
    },
    RestartPolicy: {Name: 'no'},
  },
})

type AgentConfig = ReturnType<typeof agentConfig>
const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('The collector transport returned malformed JSON.')
  }
}
const object = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {})
const sameArray = (value: unknown, expected: Array<string>) => Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index])

/** Names alone are not proof of ownership. Never remove or execute into foreign containers. */
export const validateAgent = (value: unknown, expected: AgentConfig, name: string): string => {
  const inspection = object(value)
  const config = object(inspection.Config)
  const host = object(inspection.HostConfig)
  const labels = object(config.Labels)
  const valid = typeof inspection.Id === 'string' && /^[0-9a-f]{64}$/.test(inspection.Id) && inspection.Name === `/${name}`
    && config.Image === expected.Image && config.User === expected.User && config.WorkingDir === expected.WorkingDir
    && sameArray(config.Cmd, expected.Cmd) && (config.Entrypoint == null || sameArray(config.Entrypoint, []))
    && config.Tty === false && config.OpenStdin === false
    && Object.entries(expected.Labels).every(([key, val]) => labels[key] === val)
    && Object.entries(expected.HostConfig).every(([key, val]) => typeof val === 'object' || host[key] === val)
    && object(host.Tmpfs)['/tmp'] === expected.HostConfig.Tmpfs['/tmp'] && Object.keys(object(host.Tmpfs)).length === 1
    && object(host.LogConfig).Type === 'none' && object(host.RestartPolicy).Name === 'no'
    && (!host.Binds || sameArray(host.Binds, [])) && (!host.Mounts || sameArray(host.Mounts, []))
    && (!host.VolumesFrom || sameArray(host.VolumesFrom, [])) && Object.keys(object(config.Volumes)).length === 0
  if (!valid) {
    throw new Error(`The existing ${name} container is incompatible. It was not modified.`)
  }
  return inspection.Id as string
}

const collectorErrors: Record<string, string> = {
  STALE_PROCESS: 'The PID now belongs to a different process. Select the process again before sending a signal.',
  PROCESS_NOT_FOUND: 'The process has exited.',
  PROTECTED_PROCESS: 'The collector and PID 1 are protected.',
  PERMISSION_DENIED: 'The host denied the signal. Check host security policy.',
  SIGNAL_FAILED: 'The host could not safely deliver the signal. Linux pidfd support is required.',
  INVALID_ARGUMENT: 'The collector rejected an invalid request.',
  COLLECTOR_FAILED: 'The collector could not read the Linux host. Check image compatibility and host permissions.',
}
const isHttp = (error: unknown, ...statuses: Array<number>) => error instanceof DockerError && statuses.includes(error.status ?? 0)
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal.throwIfAborted()
  const stop = () => {
    clearTimeout(timer); reject(signal.reason)
  }
  const timer = setTimeout(() => {
    signal.removeEventListener('abort', stop); resolve()
  }, ms)
  signal.addEventListener('abort', stop, {once: true})
})

/** One shared, identity-checked collector; transport stays entirely on the Docker API. */
export class DockerSource extends DataSource {
  readonly client: DockerClient
  containers = new Map<string, ContainerInfo>
  containersFetchedAt = 0
  readonly controller = new AbortController
  readonly id = 'docker'
  readonly options: DockerSourceOptions
  readonly title: string
  private ensuring?: Promise<string>
  private identity?: Promise<{
    config: AgentConfig
    name: string
  }>

  constructor(options: DockerSourceOptions) {
    super()
    this.options = options
    this.title = new URL(options.baseUrl).host
    this.client = new DockerClient({
      ...options,
      signal: this.controller.signal,
    })
  }
  async connect(onProgress: ProgressListener): Promise<HostInfo> {
    onProgress('Contacting Docker daemon', this.options.baseUrl)
    const info = await this.client.json<{
      Architecture?: string
      KernelVersion?: string
      MemTotal?: number
      Name?: string
      NCPU?: number
      OperatingSystem?: string
      OSType?: string
      ServerVersion?: string
    }>('GET', '/info')
    if (info.OSType && info.OSType !== 'linux') {
      throw new Error('Wtop requires a Linux Docker daemon. Docker Desktop exposes its Linux VM, not the physical desktop OS.')
    }
    await this.ensureAgent(onProgress)
    return {
      hostname: info.Name ?? this.title,
      architecture: info.Architecture,
      kernel: info.KernelVersion,
      memoryTotal: info.MemTotal,
      cpuCount: info.NCPU,
      operatingSystem: info.OperatingSystem,
      dockerVersion: info.ServerVersion,
    }
  }
  override dispose() {
    this.controller.abort(new DOMException('Monitor stopped', 'AbortError'))
  }
  async ensureAgent(onProgress: ProgressListener = () => {}) {
    this.controller.signal.throwIfAborted()
    if (!this.ensuring) {
      this.ensuring = this.establish(onProgress).finally(() => {
        this.ensuring = undefined
      })
    }
    return this.ensuring
  }
  async refreshContainers(force = false) {
    if (!force && this.containersFetchedAt && Date.now() - this.containersFetchedAt < 10_000) {
      return this.containers
    }
    try {
      const rows = await this.client.json<Array<ContainerSummary>>('GET', '/containers/json')
      this.containers = new Map(rows.map(row => [row.Id, {
        id: row.Id,
        name: (row.Names?.[0] ?? row.Id.slice(0, 12)).replace(/^\//, ''),
        image: row.Image,
        state: row.State,
        status: row.Status,
      }]))
      this.containersFetchedAt = Date.now()
    } catch {
      this.controller.signal.throwIfAborted()
      // Cosmetic metadata may be unavailable behind a restricted proxy.
    }
    return this.containers
  }
  async sample(): Promise<Sample> {
    if (!this.agentContainerId) {
      await this.ensureAgent()
    }
    const command = collectorCommand({
      action: 'sample',
      argv: this.options.argv ?? 'full',
    })
    const collect = async () => {
      try {
        return await this.execute(command)
      } catch (error) {
        if (!isHttp(error, 404, 409)) {
          throw error
        }
        this.agentContainerId = undefined
        await this.ensureAgent()
        return this.execute(command)
      }
    }
    const [response, containers] = await Promise.all([collect(), this.refreshContainers()])
    if (response.protocol !== Number(agentProtocol)) {
      throw new Error('The collector protocol does not match this application.')
    }
    return {
      snapshot: validateSnapshot(response.snapshot),
      containers,
      receivedAt: Date.now(),
    }
  }
  /** Never retry a signal: a failed response does not prove the signal was not delivered. */
  async signal(pid: number, signal: Signal, startTicks?: number) {
    if (!this.options.destructive) {
      throw new Error('Destructive actions are disabled.')
    }
    if (!this.agentContainerId || !Number.isSafeInteger(pid) || pid <= 1 || !Number.isSafeInteger(startTicks) || startTicks! < 0 || !isSignal(signal)) {
      throw new Error('A valid process identity and active collector are required.')
    }
    await this.execute(collectorCommand({
      action: 'signal',
      pid,
      startTicks: startTicks!,
      signal,
    }))
  }
  private async ensureImage(onProgress: ProgressListener) {
    try {
      await this.client.json('GET', `/images/${encodeURIComponent(this.options.image)}/json`)
      return
    } catch (error) {
      if (!isHttp(error, 404)) {
        throw error
      }
    }
    const {repository, tag} = splitImageReference(this.options.image)
    onProgress('Pulling collector image', this.options.image)
    const bytes = await this.client.bytes('POST', '/images/create', {
      query: {
        fromImage: repository,
        tag,
      },
      timeout: 300_000,
    })
    for (const line of (new TextDecoder).decode(bytes).split('\n').filter(line => line.trim())) {
      const progress = object(parseJson(line))
      if (progress.error || progress.errorDetail) {
        throw new Error('Docker could not pull the collector image. Check the image reference and registry access.')
      }
    }
    await this.client.json('GET', `/images/${encodeURIComponent(this.options.image)}/json`)
  }
  private async establish(onProgress: ProgressListener) {
    const {config, name} = await this.getIdentity()
    for (let attempt = 0; attempt < 6; attempt++) {
      this.controller.signal.throwIfAborted()
      onProgress('Looking for a compatible collector', name)
      try {
        let existing = await this.find(name, config)
        if (!existing) {
          await this.ensureImage(onProgress)
          onProgress('Creating collector', this.options.image)
          try {
            await this.client.json('POST', '/containers/create', {
              query: {name},
              body: config,
            })
          } catch (error) {
            if (!isHttp(error, 409)) {
              throw error
            }
          }
          existing = await this.find(name, config)
          if (!existing) {
            await wait(200, this.controller.signal)
            continue
          }
        }
        if (existing.state.Paused === true) {
          throw new Error('The shared collector is paused. It was not modified.')
        }
        if (['dead', 'exited', 'removing'].includes(String(existing.state.Status))) {
          await wait(300, this.controller.signal)
          continue
        }
        if (existing.state.Running !== true) {
          onProgress('Starting collector', name)
          await this.client.request('POST', `/containers/${existing.id}/start`, {allowedStatuses: [304]})
        }
        this.controller.signal.throwIfAborted()
        this.agentContainerId = existing.id
        return existing.id
      } catch (error) {
        if (!isHttp(error, 404, 409) || attempt === 5) {
          throw error
        }
        await wait(250, this.controller.signal)
      }
    }
    throw new Error('The collector is exiting or not ready. Wait for Docker auto-removal and retry.')
  }
  private async execute(command: Array<string>): Promise<Record<string, unknown>> {
    const created = await this.client.json<{Id: string}>('POST', `/containers/${this.agentContainerId}/exec`, {
      body: {
        Cmd: command,
        User: '0:0',
        AttachStdout: true,
        AttachStderr: true,
        AttachStdin: false,
        Tty: false,
      },
    })
    if (!/^[0-9a-f]{64}$/.test(created.Id)) {
      throw new Error('Docker returned an invalid exec identifier.')
    }
    const bytes = await this.client.bytes('POST', `/exec/${created.Id}/start`, {
      body: {
        Detach: false,
        Tty: false,
      },
      timeout: 30_000,
    })
    const {stdout, stderr} = demuxDockerStream(bytes)
    let state = await this.client.json<ExecInspect>('GET', `/exec/${created.Id}/json`)
    for (let attempt = 0; state.Running && attempt < 20; attempt++) {
      await wait(50, this.controller.signal)
      state = await this.client.json<ExecInspect>('GET', `/exec/${created.Id}/json`)
    }
    if (state.Running || state.ExitCode !== 0 || stderr.length || !stdout.length) {
      throw new Error('The collector exec failed. The image must provide Python 3.9 or later with Linux pidfd support.')
    }
    const response = object(parseJson((new TextDecoder).decode(await gunzip(stdout))))
    if (response.ok !== true) {
      throw new Error(collectorErrors[String(response.error)] ?? 'The collector returned an invalid response.')
    }
    return response
  }
  private async find(name: string, config: AgentConfig) {
    const rows = await this.client.json<Array<ContainerSummary>>('GET', '/containers/json', {query: {
      all: true,
      filters: JSON.stringify({name: [`^/${name}$`]}),
    }})
    const row = rows.find(candidate => candidate.Names?.includes(`/${name}`))
    if (!row) {
      return
    }
    const inspection = await this.client.json<Record<string, unknown>>('GET', `/containers/${row.Id}/json`)
    const id = validateAgent(inspection, config, name)
    return {
      id,
      state: object(inspection.State),
    }
  }
  private getIdentity() {
    this.identity ??= (async () => {
      const config = agentConfig(this.options.image, this.options.lifetime)
      const bytes = (new TextEncoder).encode(JSON.stringify(config))
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
      const suffix = hash.toHex().slice(0, 20)
      return {
        config,
        name: `wtop-agent-v${agentProtocol}-${suffix}`,
      }
    })()
    return this.identity
  }
}
