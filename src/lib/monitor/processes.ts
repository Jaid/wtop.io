import type {ArgvMode} from '#src/lib/argv.ts'
import type {SortKey} from '#src/queryParameters.ts'
import type {ProcessRow} from './types.ts'

import {joinArgv, presentArgv} from '#src/lib/argv.ts'

export type SortDirection = 'asc' | 'desc'

export type DisplayRow = {
  /** tree guide prefix like “│ ├─” */
  branch: string
  command?: string
  depth: number
  /** true if the row only appears because a descendant matches the filter */
  dimmed: boolean
  exited?: boolean
  hasChildren: boolean
  process: ProcessRow
}

export type ListOptions = {
  argvMode: ArgvMode
  collapsed?: ReadonlySet<string>
  direction: SortDirection
  filter: string
  showAgent: boolean
  showKernel: boolean
  sort: SortKey
  tree: boolean
}

export const defaultDirection = (key: SortKey): SortDirection => (['command', 'compose', 'container', 'name', 'pid', 'state', 'user'].includes(key) ? 'asc' : 'desc')

const stateOrder: Record<string, number> = {
  R: 0,
  D: 1,
  Z: 2,
  T: 3,
  t: 3,
  S: 4,
  I: 5,
}
const valueOf = (row: ProcessRow, key: SortKey, command: string): number | string => {
  switch (key) {
    case 'cpu': {
      return row.cpu
    }
    case 'memory': {
      return row.memory
    }
    case 'io': {
      return (row.readRate ?? 0) + (row.writeRate ?? 0)
    }
    case 'pid': {
      return row.pid
    }
    case 'name': {
      return row.name.toLowerCase()
    }
    case 'user': {
      return row.user.toLowerCase()
    }
    case 'compose': {
      return row.container?.composeProject?.toLowerCase() ?? '\u{FFFF}'
    }
    case 'container': {
      return row.container?.name.toLowerCase() ?? '\u{FFFF}'
    }
    case 'threads': {
      return row.threads
    }
    case 'state': {
      return stateOrder[row.state] ?? 9
    }
    case 'age': {
      return row.age
    }
    case 'command': {
      return command.toLowerCase()
    }
  }
}
const createComparator = (key: SortKey, direction: SortDirection, commands: Map<string, string>) => {
  const factor = direction === 'asc' ? 1 : -1
  return (a: ProcessRow, b: ProcessRow) => {
    const valueA = valueOf(a, key, commands.get(a.key) ?? '')
    const valueB = valueOf(b, key, commands.get(b.key) ?? '')
    if (valueA < valueB) {
      return -factor
    }
    if (valueA > valueB) {
      return factor
    }
    // stable tie-breaker so rows do not jump around between samples
    return a.pid - b.pid
  }
}

/**
 * Supports plain substring search plus `key:value` tokens (`user:`, `pid:`, `container:`, `state:`), all tokens must match.
 */
export const createMatcher = (filter: string) => {
  const tokens = filter.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) {
    return
  }
  return (row: ProcessRow, command: string) => tokens.every(token => {
    const match = /^(compose|container|name|pid|ppid|state|user):(.+)$/.exec(token)
    if (match) {
      const [, field, value] = match
      switch (field) {
        case 'user': {
          return row.user.toLowerCase().includes(value)
        }
        case 'pid': {
          return String(row.pid) === value
        }
        case 'ppid': {
          return String(row.ppid) === value
        }
        case 'compose': {
          return Boolean(row.container?.composeProject?.toLowerCase().includes(value) || row.container?.composeService?.toLowerCase().includes(value))
        }
        case 'container': {
          return Boolean(row.container && (row.container.name.toLowerCase().includes(value) || row.container.id.startsWith(value)))
        }
        case 'state': {
          return row.state.toLowerCase() === value
        }
        case 'name': {
          return row.name.toLowerCase().includes(value)
        }
      }
    }
    return row.name.toLowerCase().includes(token)
      || String(row.pid) === token
      || row.user.toLowerCase().includes(token)
      || Boolean(row.container?.name.toLowerCase().includes(token))
      || command.toLowerCase().includes(token)
  })
}

const displayCommand = (row: ProcessRow, mode: ArgvMode) => {
  const argv = presentArgv(row.argv, mode)
  if (!argv) {
    return
  }
  if (argv.length === 0) {
    return row.isKernelThread ? `[${row.name}]` : ''
  }
  return joinArgv(argv)
}

/**
 * Applies visibility toggles, filter and sort order, optionally as a process tree.
 */
export const buildDisplayRows = (processes: ReadonlyArray<ProcessRow>, options: ListOptions): Array<DisplayRow> => {
  const visible = processes.filter(row => (options.showKernel || !row.isKernelThread) && (options.showAgent || !row.isAgent))
  const commands = new Map<string, string>
  for (const row of visible) {
    commands.set(row.key, displayCommand(row, options.argvMode) ?? '')
  }
  const matcher = createMatcher(options.filter)
  const comparator = createComparator(options.sort, options.direction, commands)
  if (!options.tree) {
    const rows = matcher ? visible.filter(row => matcher(row, commands.get(row.key) ?? '')) : [...visible]
    rows.sort(comparator)
    return rows.map(process => ({
      process,
      depth: 0,
      branch: '',
      hasChildren: false,
      dimmed: false,
      command: commands.get(process.key),
    }))
  }
  const byPid = new Map(visible.map(row => [row.pid, row]))
  const children = new Map<number, Array<ProcessRow>>
  const roots: Array<ProcessRow> = []
  for (const row of visible) {
    if (row.ppid !== row.pid && byPid.has(row.ppid)) {
      const list = children.get(row.ppid) ?? []
      list.push(row)
      children.set(row.ppid, list)
    } else {
      roots.push(row)
    }
  }
  let included: Set<number> | undefined
  const matched = new Set<number>
  if (matcher) {
    included = new Set<number>
    for (const row of visible) {
      if (!matcher(row, commands.get(row.key) ?? '')) {
        continue
      }
      matched.add(row.pid)
      let current: ProcessRow | undefined = row
      while (current && !included.has(current.pid)) {
        included.add(current.pid)
        current = byPid.get(current.ppid)
      }
    }
  }
  const result: Array<DisplayRow> = []
  const walk = (row: ProcessRow, depth: number, prefix: string, isLast: boolean, visited: Set<number>) => {
    if (visited.has(row.pid)) {
      return
    }
    visited.add(row.pid)
    const kids = (children.get(row.pid) ?? []).filter(child => !included || included.has(child.pid)).toSorted(comparator)
    const branch = depth === 0 ? '' : `${prefix}${isLast ? '└─' : '├─'}`
    result.push({
      process: row,
      depth,
      branch,
      hasChildren: kids.length > 0,
      dimmed: Boolean(matcher && !matched.has(row.pid)),
      command: commands.get(row.key),
    })
    if (options.collapsed?.has(row.key)) {
      return
    }
    const childPrefix = depth === 0 ? '' : `${prefix}${isLast ? '  ' : '│ '}`
    for (const [index, child] of kids.entries()) {
      walk(child, depth + 1, childPrefix, index === kids.length - 1, visited)
    }
  }
  const visited = new Set<number>
  for (const root of roots.filter(row => !included || included.has(row.pid)).toSorted(comparator)) {
    walk(root, 0, '', true, visited)
  }
  return result
}

export const stateDescriptions: Record<string, string> = {
  R: 'running or runnable',
  S: 'sleeping, waiting for an event',
  D: 'uninterruptible sleep, usually waiting for I/O',
  Z: 'zombie, terminated but not reaped by its parent',
  T: 'stopped by a signal',
  t: 'stopped by a debugger',
  I: 'idle kernel thread',
  X: 'dead',
  W: 'paging',
  P: 'parked',
}

/** Keep every occupied slot until pointer leave, including exited-process placeholders. */
export const holdRowOrder = (current: ReadonlyArray<DisplayRow>, held: ReadonlyArray<DisplayRow>): Array<DisplayRow> => {
  const latest = new Map(current.map(row => [row.process.key, row]))
  return held.map(row => latest.get(row.process.key) ?? {
    ...row,
    exited: true,
  })
}
