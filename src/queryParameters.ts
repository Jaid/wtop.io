import type {ArgvMode} from '#src/lib/argv.ts'
import type {DateFormat} from '#src/lib/preferences.ts'

import readPermalink, {parseBoolean, parseNumber} from 'read-permalink'

import {argvModes} from '#src/lib/argv.ts'
import {columnOptions, dateFormats, defaultColumns, defaultPanels, normalizeSelection, panelOptions} from '#src/lib/preferences.ts'

export type SortKey = 'age' | 'command' | 'compose' | 'container' | 'cpu' | 'io' | 'memory' | 'name' | 'pid' | 'state' | 'threads' | 'user'

export const sortKeys: ReadonlyArray<SortKey> = ['cpu', 'memory', 'io', 'pid', 'name', 'user', 'container', 'compose', 'threads', 'state', 'age', 'command']

const clampedNumber = (min: number, max: number) => (value: unknown) => {
  const number = parseNumber(value)
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new RangeError(`Expected a value between ${min} and ${max}.`)
  }
  return number
}
const oneOf = <T extends string>(options: ReadonlyArray<T>) => (value: unknown): T => {
  const normalized = String(value).trim().toLowerCase()
  if (!(options as ReadonlyArray<string>).includes(normalized)) {
    throw new TypeError(`Expected one of ${options.join(', ')}.`)
  }
  return normalized as T
}
const trimmed = (value: unknown) => String(value).trim()
const hostname = (value: unknown) => {
  const host = trimmed(value).replace(/^\[(.*)\]$/, '$1')
  if (!host || /[\s#%/?@\\]/.test(host)) {
    throw new TypeError('Enter a hostname or IP address, without a scheme, path or credentials.')
  }
  try {
    const bracketed = host.includes(':') ? `[${host}]` : host
    const url = new URL(`http://${bracketed}:2375`)
    return url.hostname.replaceAll(/^\[|\]$/g, '')
  } catch {
    throw new TypeError('Invalid host or IP address. Put the port in its own field.')
  }
}
const apiPath = (value: unknown) => {
  const path = trimmed(value).replace(/\/+$/, '')
  if (/[\s#?\\]/.test(path) || path.split('/').some(part => ['.', '..'].includes(decodeURIComponent(part)))) {
    throw new TypeError('Use an API path without query, fragment or traversal segments.')
  }
  return path && !path.startsWith('/') ? `/${path}` : path
}
const bearerToken = (value: unknown) => {
  const token = trimmed(value)
  if (!/^[\x21-\x7E]*$/.test(token)) {
    throw new TypeError('Bearer tokens must not contain whitespace or control characters.')
  }
  return token
}
const imageReference = (value: unknown) => {
  const image = trimmed(value)
  if (!/^[0-9A-Za-z][-./0-9:@A-Z_a-z]*$/.test(image) || image.includes('@') && !/@sha256:[0-9a-f]{64}$/.test(image)) {
    throw new TypeError('Enter a Docker image name, optionally with a tag or sha256 digest.')
  }
  return image
}

export const defaults = {
  panels: defaultPanels,
  columns: defaultColumns,
  dateFormat: 'technical' as DateFormat,
  /** Docker daemon port */
  port: 2375,
  /** Docker daemon protocol */
  protocol: 'http' as 'http' | 'https',
  /** path prefix of the Docker Engine API, for reverse proxies that serve it below a sub path */
  path: '',
  /** process refresh interval in milliseconds */
  interval: 1000,
  /** seconds of history shown in graphs */
  history: 120,
  /** image of the collector container, needs Bun 1.4.2 (distroless or slim) */
  image: 'oven/bun:1.4.2-distroless',
  /** seconds the agent container keeps running after the last request */
  lifetime: 120,
  /** `'censored'` to censor all argv values (like “--host=•••••••••• --port ••••”), `'hidden'` to fully omit argv from the dashboard */
  argv: 'full' as ArgvMode,
  /** whether to expose destructive actions (like killing processes) in the interface instead of just being a read-only dashboard */
  destructive: false,
  /** whether to play sound effects */
  sound: false,
  /** whether to list kernel threads */
  kernel: false,
  /** whether to list the processes of wtop’s own agent container */
  agent: false,
  /** whether to show processes as a tree */
  tree: false,
  /** initial sort column of the process list */
  sort: 'cpu' as SortKey,
  /** initial filter of the process list */
  filter: '',
  reverse: false,
  addressSpace: 'auto' as 'auto' | 'local' | 'loopback' | 'public',
}

export type QueryParameters = typeof defaults & {
  /** Bearer authentication token */
  bearer?: string
  /** Docker daemon host name or IP address */
  host?: string
}

export type ParameterKey = keyof QueryParameters

export const normalizations: {[Key in ParameterKey]-?: (value: unknown) => QueryParameters[Key]} = {
  panels: value => normalizeSelection(value, panelOptions),
  columns: value => normalizeSelection(value, columnOptions),
  dateFormat: oneOf(dateFormats.map(option => option.key)),
  host: hostname,
  port: clampedNumber(1, 65_535),
  protocol: oneOf(['http', 'https'] as const),
  path: apiPath,
  bearer: bearerToken,
  interval: clampedNumber(250, 60_000),
  history: clampedNumber(10, 3600),
  image: imageReference,
  lifetime: clampedNumber(10, 86_400),
  argv: oneOf(argvModes),
  destructive: parseBoolean,
  sound: parseBoolean,
  kernel: parseBoolean,
  agent: parseBoolean,
  tree: parseBoolean,
  sort: oneOf(sortKeys),
  filter: trimmed,
  reverse: parseBoolean,
  addressSpace: oneOf(['auto', 'local', 'loopback', 'public'] as const),
}

const parameterKeys = Object.keys(normalizations) as Array<ParameterKey>

export type ReadResult = {
  errors: Partial<Record<ParameterKey, string>>
  values: QueryParameters
}

/**
 * Reads and validates all parameters from a URL. Invalid values fall back to their defaults and are reported in `errors` instead of throwing.
 */
export const readQueryParameters = (href: string): ReadResult => {
  let raw: Record<string, unknown> = {}
  const errors: ReadResult['errors'] = {}
  try {
    raw = readPermalink(href)
  } catch (error) {
    errors.host = `The permalink could not be decoded: ${Error.isError(error) ? error.message : String(error)}`
  }
  const values: QueryParameters = {...defaults}
  for (const key of parameterKeys) {
    const value = raw[key]
    if (value === undefined || value === null || value === '') {
      continue
    }
    try {
      const normalized = normalizations[key](value)
      if (normalized !== '' || key === 'path') {
        Object.assign(values, {[key]: normalized})
      }
    } catch (error) {
      errors[key] = Error.isError(error) ? error.message : String(error)
    }
  }
  return {
    values,
    errors,
  }
}

/**
 * Serializes parameters to a query string, omitting defaults and (unless requested) the Bearer token.
 */
export const buildSearch = (values: Partial<QueryParameters>, options: {includeBearer?: boolean} = {}) => {
  const search = new URLSearchParams
  for (const key of parameterKeys) {
    const value = values[key]
    if (value === undefined || value === '') {
      continue
    }
    if (key === 'bearer' && !options.includeBearer) {
      continue
    }
    if (key in defaults && defaults[key as keyof typeof defaults] === value) {
      continue
    }
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

/** the base URL of the Docker Engine API described by the parameters */
export const getApiBaseUrl = (values: Pick<QueryParameters, 'host' | 'path' | 'port' | 'protocol'>) => {
  if (!values.host) {
    return
  }
  const host = values.host.includes(':') && !values.host.startsWith('[') ? `[${values.host}]` : values.host
  return `${values.protocol}://${host}:${values.port}${values.path}`
}

/** stable identifier of a Docker endpoint, used as key for saved Bearer tokens */
export const getEndpointKey = (values: Pick<QueryParameters, 'host' | 'path' | 'port' | 'protocol'>) => (() => {
  const base = getApiBaseUrl(values)
  if (!base) {
    return
  }
  const url = new URL(base)
  return url.origin + (url.pathname === '/' ? '' : url.pathname)
})()
