import {describe, expect, test} from 'bun:test'

import {isFilterActive, normalizeFilterButtons, parseFilterButton, toggleFilter} from '#src/lib/filterButtons.ts'
import {deriveFrame} from '#src/lib/monitor/derive.ts'
import {buildDisplayRows, createMatcher} from '#src/lib/monitor/processes.ts'
import {hasProcessTag, processWeight} from '#src/lib/monitor/tags.ts'
import {defaultColumns, selectedKeys} from '#src/lib/preferences.ts'
import {shouldPlaySound} from '#src/lib/sound.ts'
import {SimulatedHost} from '#src/lib/source/simulation/SimulatedHost.ts'
import {buildSearch, defaults, readQueryParameters} from '#src/queryParameters.ts'

const host = new SimulatedHost({
  seed: 7,
  now: 1_790_000_000_000,
})
const sample = {
  snapshot: host.snapshot(),
  containers: host.containerInfos(),
  receivedAt: 1_790_000_000_000,
}
const frame = deriveFrame(undefined, sample)
const base = frame.processes.find(row => !row.isKernelThread)!
describe('dashboard parameters', () => {
  test('parses linger including zero and fractional durations and view-only mode', () => {
    for (const linger of [0, 0.25, 5, 3600]) {
      const result = readQueryParameters(`https://wtop.io/?host=nas&linger=${linger}&interactive=false&sound=alerts`)
      expect(result.errors).toEqual({})
      expect(result.values).toMatchObject({
        linger,
        interactive: false,
        sound: 'alerts',
      })
    }
    for (const linger of [-1, 3601, 'NaN', 'Infinity']) {
      expect(readQueryParameters(`https://wtop.io/?linger=${linger}`).errors.linger).toBeDefined()
    }
    expect(defaults.interactive).toBe(true)
  })
  test.each(['off', 'alerts', 'all'] as const)('round-trips sound=%s', sound => {
    expect(readQueryParameters(`https://wtop.io/${buildSearch({sound})}`).values.sound).toBe(sound)
  })
  test('rejects obsolete boolean sound input', () => {
    expect(readQueryParameters('https://wtop.io/?sound=true').errors.sound).toBeDefined()
  })
  test('repeated filter parameters preserve order, colons, spaces and punctuation', () => {
    const buttons = ['Heavy:tag:heavy', 'Orphan:tag:orphan', 'CPU & I/O:tag:container name:worker']
    const search = buildSearch({filter_button: buttons})
    expect(new URLSearchParams(search).getAll('filter_button')).toEqual(buttons)
    expect(readQueryParameters(`https://wtop.io/${search}`).values.filter_button).toEqual(buttons)
    expect(parseFilterButton(buttons[2])).toEqual({
      label: 'CPU & I/O',
      filter: 'tag:container name:worker',
    })
  })
  test('empty buttons are distinct from default buttons', () => {
    expect(buildSearch({filter_button: []})).toBe('?filter_button=')
    expect(readQueryParameters('https://wtop.io/?filter_button=').values.filter_button).toEqual([])
    expect(buildSearch({filter_button: [...defaults.filter_button]})).toBe('')
    expect(() => normalizeFilterButtons(['missing-colon'])).toThrow()
    expect(() => normalizeFilterButtons(['Label:'])).toThrow()
    expect(() => normalizeFilterButtons(Array.from({length: 33}).fill('A:name:a'))).toThrow()
  })
  test('new and metadata columns are disabled by default', () => {
    for (const key of ['pid', 'user', 'threads', 'weight', 'read', 'write']) {
      expect(selectedKeys(defaultColumns)).not.toContain(key)
    }
    expect(readQueryParameters('https://wtop.io/?columns=name,weight,read,write').errors).toEqual({})
  })
})
describe('sound policies', () => {
  test('off never plays, alerts excludes menu sounds, all includes them', () => {
    for (const event of ['click', 'connect', 'lost', 'restored', 'signal', 'error'] as const) {
      expect(shouldPlaySound('off', event)).toBe(false)
      expect(shouldPlaySound('all', event)).toBe(true)
      expect(shouldPlaySound('alerts', event)).toBe(event !== 'click')
    }
  })
})
describe('process load and filters', () => {
  test('weight normalizes CPU by core count and uses memory percentage', () => {
    expect(processWeight(800, 100, 8)).toBe(100)
    expect(processWeight(80, 20, 8)).toBe(2)
    expect(processWeight(0, 80, 8)).toBe(0)
    expect(processWeight(100, 0, 8)).toBe(0)
    expect(processWeight(100, 30, 0)).toBe(0)
  })
  test('tag filters match traits, not arguments or arbitrary substrings', () => {
    const row = {
      ...base,
      heavy: true,
      orphan: true,
      detached: true,
      isKernelThread: true,
      isAgent: true,
      container: {
        id: 'id',
        image: 'image',
        name: 'container',
        state: 'running',
        status: 'Up',
      },
    }
    for (const tag of ['heavy', 'container', 'orphan', 'detached', 'kernel', 'self']) {
      expect(hasProcessTag(row, tag)).toBe(true)
      expect(createMatcher(`tag:${tag}`)!(row, '')).toBe(true)
    }
    expect(createMatcher('tag:missing')!(row, 'tag:missing')).toBe(false)
    expect(createMatcher('tag:heavy tag:orphan')!({
      ...row,
      orphan: false,
    }, '')).toBe(false)
    expect(createMatcher('tag:detached')!({
      ...row,
      detached: false,
    }, '')).toBe(false)
  })
  test('explicit self and kernel queries override initial hide settings', () => {
    const rows = [{
      ...base,
      pid: 10,
      key: '10:1',
      isKernelThread: true,
      isAgent: false,
    }, {
      ...base,
      pid: 11,
      key: '11:1',
      isAgent: true,
      isKernelThread: false,
    }]
    const options = {
      filter: '',
      sort: 'cpu' as const,
      direction: 'desc' as const,
      showKernel: false,
      showAgent: false,
      tree: false,
      argvMode: 'full' as const,
    }
    expect(buildDisplayRows(rows, options)).toEqual([])
    expect(buildDisplayRows(rows, {
      ...options,
      filter: 'tag:kernel',
    }).map(row => row.process.pid)).toEqual([10])
    expect(buildDisplayRows(rows, {
      ...options,
      filter: 'tag:self',
    }).map(row => row.process.pid)).toEqual([11])
  })
  test('custom toggles preserve the rest of the filter', () => {
    const combined = toggleFilter('name:nginx', 'tag:heavy')
    expect(combined).toBe('name:nginx tag:heavy')
    expect(isFilterActive(combined, 'tag:heavy')).toBe(true)
    expect(toggleFilter(combined, 'tag:heavy')).toBe('name:nginx')
    expect(toggleFilter('tag:heavy', 'tag:heavy tag:container')).toBe('tag:heavy tag:container')
  })
  test.each(['weight', 'read', 'write'] as const)('sorts by %s', sort => {
    const rows = [{
      ...base,
      pid: 10,
      key: '10:1',
      weight: 1,
      readRate: 100,
      writeRate: 10,
    }, {
      ...base,
      pid: 11,
      key: '11:1',
      weight: 3,
      readRate: 300,
      writeRate: 30,
    }]
    const result = buildDisplayRows(rows, {
      filter: '',
      sort,
      direction: 'desc',
      showKernel: true,
      showAgent: true,
      tree: false,
      argvMode: 'full',
    })
    expect(result.map(row => row.process.pid)).toEqual([11, 10])
  })
})
