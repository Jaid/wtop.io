import {describe, expect, test} from 'bun:test'

import {censorArgv, joinArgv} from '#src/lib/argv.ts'
import {commandTokens} from '#src/lib/commandTokens.ts'
import {formatCpuCell, formatDate, formatDateTime, formatUptime} from '#src/lib/format.ts'
import {deriveFrame} from '#src/lib/monitor/derive.ts'
import {buildDisplayRows, holdRowOrder} from '#src/lib/monitor/processes.ts'
import {PeakHold} from '#src/lib/PeakHold.ts'
import {columnOptions, defaultColumns, defaultPanels, normalizeSelection, panelOptions, selectedKeys, toggleSelection} from '#src/lib/preferences.ts'
import {SimulatedHost} from '#src/lib/source/simulation/SimulatedHost.ts'
import {buildSearch, defaults, readQueryParameters} from '#src/queryParameters.ts'

const date = new Date(2026, 8, 30, 14, 5, 9)
describe('presentation preferences', () => {
  test('defaults include all seven panels, tags, but no state or container name columns', () => {
    expect(selectedKeys(defaultPanels)).toHaveLength(7)
    expect(selectedKeys(defaultColumns)).toContain('tags')
    expect(selectedKeys(defaultColumns)).not.toContain('state')
    expect(selectedKeys(defaultColumns)).not.toContain('container')
    expect(selectedKeys(defaultColumns)).not.toContain('compose')
  })
  test('canonicalizes selections and rejects unknown entries', () => {
    expect(normalizeSelection('memory,cpu,cpu', panelOptions)).toBe('cpu,memory')
    expect(normalizeSelection('compose,tags', columnOptions)).toBe('tags,compose')
    expect(() => normalizeSelection('made-up', panelOptions)).toThrow()
    expect(toggleSelection('cpu', 'cpu', false, panelOptions)).toBe('none')
    expect(toggleSelection('none', 'containers', true, panelOptions)).toBe('containers')
  })
  test('explicit none and custom selections round-trip through permalinks', () => {
    const values = {
      ...defaults,
      panels: 'none',
      columns: 'pid,tags,compose',
      dateFormat: 'european' as const,
    }
    const search = buildSearch(values)
    const result = readQueryParameters(`https://wtop.io/demo${search}`)
    expect(result.errors).toEqual({})
    expect(result.values.panels).toBe('none')
    expect(result.values.columns).toBe('pid,tags,compose')
    expect(result.values.dateFormat).toBe('european')
    expect(buildSearch(defaults)).toBe('')
  })
  test.each([
    ['american', '09/30/2026'],
    ['european', '30.09.2026'],
    ['worded', 'September 30, 2026'],
    ['technical', '2026-09-30'],
  ] as const)('formats %s dates', (format, expected) => {
    expect(formatDate(date, format)).toBe(expected)
    expect(formatDateTime(date, format)).toBe(`${expected} 14:05:09`)
  })
  test('uptime uses whole hours until the exact 48-hour boundary', () => {
    expect(formatUptime(0)).toBe('00:00:00')
    expect(formatUptime(25 * 3600 + 61)).toBe('25:01:01')
    expect(formatUptime(172_799)).toBe('47:59:59')
    expect(formatUptime(172_800)).toBe('2d 00:00:00')
    expect(formatUptime(172_800 + 3661)).toBe('2d 01:01:01')
    expect(formatUptime(Number.NaN)).toBe('–')
  })
  test('CPU display suppresses rounded zero but preserves small nonzero usage', () => {
    expect(formatCpuCell(0)).toBe('')
    expect(formatCpuCell(0.04)).toBe('')
    expect(formatCpuCell(0.12)).toBe('0.1')
    expect(formatCpuCell(12)).toBe('12')
  })
})
describe('command highlighting', () => {
  test('emphasizes the executable basename while retaining its complete path', () => {
    const path = '/nix/store/b4b1x5fhxpc78qlclj3kdbl9dd49g917-systemd-260.4/lib/systemd/systemd-udevd'
    const tokens = commandTokens([path, '--log-level=debug', '-psecret', 'position'])
    expect(tokens.filter(token => token.kind === 'executable').map(token => token.text)).toEqual(['systemd-udevd'])
    expect(tokens.find(token => token.kind === 'flag')?.text).toBe('--log-level')
    expect(tokens.map(token => token.text).join('')).toBe(`${path} --log-level=debug -psecret position`)
  })
  test('uses argv boundaries rather than guessing from shell text', () => {
    const argv = ['program', '--', '--positional', 'a b', '']
    const tokens = commandTokens(argv)
    expect(tokens.some(token => token.kind === 'flag')).toBe(false)
    expect(tokens.map(token => token.text).join('')).toBe(joinArgv(argv))
  })
  test('colors kernel names and never reintroduces censored values', () => {
    expect(commandTokens([], 'kworker/0:0H-kblockd').map(token => token.text).join('')).toBe('[kworker/0:0H-kblockd]')
    expect(commandTokens([], 'kworker/0:0H-kblockd').find(token => token.kind === 'kernel')?.text).toBe('kworker')
    expect(commandTokens(censorArgv(['bun', '--token=private'])).map(token => token.text).join('')).not.toContain('private')
  })
})
describe('held table order', () => {
  const host = new SimulatedHost({
    seed: 3,
    now: 1_790_000_000_000,
  })
  const sample = {
    snapshot: host.snapshot(),
    receivedAt: 1_790_000_000_000,
    containers: host.containerInfos(),
  }
  const processes = deriveFrame(undefined, sample).processes.slice(0, 3)
  const options = {
    argvMode: 'full' as const,
    direction: 'desc' as const,
    filter: '',
    showAgent: true,
    showKernel: true,
    sort: 'cpu' as const,
    tree: false,
  }
  test('updates values while preserving every original slot', () => {
    const held = buildDisplayRows(processes, options)
    const current = buildDisplayRows(processes.map((row, index) => ({
      ...row,
      cpu: index * 50,
    })), options)
    const result = holdRowOrder(current, held)
    expect(result.map(row => row.process.key)).toEqual(held.map(row => row.process.key))
    for (const row of result) {
      expect(row.process.cpu).toBe(current.find(candidate => candidate.process.key === row.process.key)!.process.cpu)
    }
  })
  test('preserves exited placeholders and defers newcomers, including recycled PIDs', () => {
    const held = buildDisplayRows(processes, options)
    const newer = {
      ...held[0].process,
      key: `${held[0].process.pid}:new`,
      startTicks: 99_999,
    }
    const current = buildDisplayRows([newer, held[1].process], options)
    const result = holdRowOrder(current, held)
    expect(result).toHaveLength(held.length)
    expect(result[0].exited).toBe(true)
    expect(result.some(row => row.process.key === newer.key)).toBe(false)
    expect(result[1].exited).not.toBe(true)
  })
})
describe('five-second peak traces', () => {
  test('retains original peak color and offset, then expires at five seconds', () => {
    const peak = new PeakHold
    peak.add({
      time: 0,
      value: 80,
      color: 'red',
      offset: 5,
    })
    peak.add({
      time: 1000,
      value: 20,
      color: 'green',
      offset: 0,
    })
    expect(peak.get(4999)).toMatchObject({
      value: 80,
      color: 'red',
      offset: 5,
    })
    expect(peak.get(5000)?.value).toBe(20)
    expect(peak.get(6000)).toBeUndefined()
  })
  test('new higher peaks supersede older ones without retaining unbounded history', () => {
    const peak = new PeakHold
    peak.add({
      time: 0,
      value: 10,
      color: 'red',
      offset: 0,
    })
    peak.add({
      time: 100,
      value: 90,
      color: 'blue',
      offset: 0,
    })
    peak.add({
      time: 200,
      value: Number.NaN,
      color: 'invalid',
      offset: 0,
    })
    expect(peak.get(5000)).toMatchObject({
      value: 90,
      color: 'blue',
    })
    expect(peak.get(5100)).toBeUndefined()
  })
})
