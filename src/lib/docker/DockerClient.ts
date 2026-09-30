import type {TargetAddressSpace} from './addressSpace.ts'

import {readResponse} from './demux.ts'

export type FetchFunction = (input: string, init: RequestInit) => Promise<Response>

export type DockerClientOptions = {
  baseUrl: string
  bearer?: string
  fetch?: FetchFunction
  signal?: AbortSignal
  targetAddressSpace?: TargetAddressSpace
  /** default timeout per request in milliseconds */
  timeout?: number
}

export type DockerRequestOptions = {
  allowedStatuses?: Array<number>
  body?: unknown
  query?: Record<string, boolean | number | string | undefined>
  signal?: AbortSignal
  timeout?: number
}

export class DockerError extends Error {
  readonly hint?: string
  readonly method: string
  readonly path: string
  readonly status?: number
  constructor(message: string, options: {
    cause?: unknown
    hint?: string
    method: string
    path: string
    status?: number
  }) {
    super(message, {cause: options.cause})
    this.name = 'DockerError'
    this.status = options.status
    this.hint = options.hint
    this.method = options.method
    this.path = options.path
  }
}

const hintForStatus = (status: number, method: string, path: string, hasBearer: boolean) => {
  if (status === 401) {
    return hasBearer ? 'The endpoint rejected the Bearer token. Check the token saved for this host in the setup.' : 'The endpoint requires authentication. Save a Bearer token for this host in the setup.'
  }
  if (status === 403) {
    return `The endpoint forbids ${method} ${path.replaceAll(/\/[\da-f]{12,}/g, '/…')}. If you use a Docker socket proxy, allow POST, CONTAINERS, EXEC and IMAGES.`
  }
  if (status === 502 || status === 503 || status === 504) {
    return 'The reverse proxy could not reach the Docker daemon.'
  }
}

/**
 * Minimal Docker Engine API client for browsers, built on `fetch`.
 */
export class DockerClient {
  readonly options: DockerClientOptions
  constructor(options: DockerClientOptions) {
    this.options = {
      ...options,
      baseUrl: options.baseUrl.replace(/\/+$/, ''),
    }
  }
  async bytes(method: string, path: string, options?: DockerRequestOptions) {
    const response = await this.request(method, path, options)
    return readResponse(response)
  }
  async json<T>(method: string, path: string, options?: DockerRequestOptions) {
    const response = await this.request(method, path, options)
    const text = (new TextDecoder).decode(await readResponse(response))
    if (!text) {
      return undefined as T
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new DockerError('Docker returned malformed JSON.', {
        method,
        path,
      })
    }
  }
  async request(method: string, path: string, options: DockerRequestOptions = {}) {
    const headers: Record<string, string> = {}
    if (this.options.bearer) {
      headers.authorization = `Bearer ${this.options.bearer}`
    }
    let body: string | undefined
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(options.body)
    }
    const timeout = options.timeout ?? this.options.timeout ?? 15_000
    const signals = [AbortSignal.timeout(timeout)]
    if (this.options.signal) {
      signals.push(this.options.signal)
    }
    if (options.signal) {
      signals.push(options.signal)
    }
    const init: RequestInit & {targetAddressSpace?: TargetAddressSpace} = {
      method,
      headers,
      body,
      signal: AbortSignal.any(signals),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    }
    if (this.options.targetAddressSpace) {
      init.targetAddressSpace = this.options.targetAddressSpace
    }
    const fetchFunction: FetchFunction = this.options.fetch ?? ((input, requestInit) => globalThis.fetch(input, requestInit))
    let response: Response
    try {
      response = await fetchFunction(this.url(path, options.query), init)
    } catch (error) {
      if (this.options.signal?.aborted) {
        throw this.options.signal.reason
      }
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        if (options.signal?.aborted) {
          throw error
        }
        throw new DockerError(`${method} ${path} timed out after ${Math.round(timeout / 1000)} s`, {
          method,
          path,
          cause: error,
          hint: 'The endpoint did not finish replying before the timeout.',
        })
      }
      throw new DockerError(`Could not reach ${this.options.baseUrl}`, {
        method,
        path,
        cause: error,
        hint: 'Check host, port and protocol. The endpoint must send CORS headers (Access-Control-Allow-Origin, Access-Control-Allow-Headers including Content-Type and Authorization, Access-Control-Allow-Private-Network) and your browser must be allowed to access the local network.',
      })
    }
    if (!response.ok && !options.allowedStatuses?.includes(response.status)) {
      const message = `Docker request failed (HTTP ${response.status}).`
      await response.body?.cancel().catch(() => {})
      throw new DockerError(message, {
        method,
        path,
        status: response.status,
        hint: hintForStatus(response.status, method, path, Boolean(this.options.bearer)),
      })
    }
    return response
  }
  url(path: string, query?: DockerRequestOptions['query']) {
    const url = new URL(`${this.options.baseUrl}${path}`)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    }
    return url.href
  }
}
