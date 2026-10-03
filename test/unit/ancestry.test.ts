import type {ProcessRow} from '#src/lib/monitor/types.ts'

import {describe, expect, test} from 'bun:test'

import {ProcessAncestry} from '#src/lib/monitor/ProcessAncestry.ts'
import {hasProcessTag} from '#src/lib/monitor/tags.ts'

const row = (pid: number, options: Partial<ProcessRow> = {}): ProcessRow => ({
  age: 100,
  argv: [],
  cpu: 0,
  isAgent: false,
  isKernelThread: false,
  key: `${pid}:1`,
  memory: 0,
  memoryPercent: 0,
  name: `p${pid}`,
  nice: 0,
  pid,
  ppid: 1,
  priority: 0,
  processor: 0,
  startedAt: 0,
  startTicks: 1,
  state: 'S',
  threads: 1,
  user: 'test',
  ...options,
})
describe('process ancestry tags', () => {
  test('marks a process orphan only after an observed parent disappears', () => {
    const ancestry = new ProcessAncestry
    const parent = row(10, {
      ppid: 1,
      name: 'launcher',
    })
    const child = row(20, {
      ppid: 10,
      name: 'worker',
    })
    let rows = ancestry.observe([parent, child], 1)
    expect(rows.find(item => item.pid === 20)).toMatchObject({
      orphan: false,
      detached: false,
    })
    rows = ancestry.observe([{
      ...child,
      ppid: 1,
    }], 1)
    expect(rows[0]).toMatchObject({
      orphan: true,
      detached: false,
      formerParent: {
        name: 'launcher',
        pid: 10,
      },
    })
    expect(hasProcessTag(rows[0], 'orphan')).toBe(true)
    expect(hasProcessTag(rows[0], 'detached')).toBe(false)
  })
  test('detects adoption by a different parent, including same-PID reuse', () => {
    const ancestry = new ProcessAncestry
    const child = row(20, {ppid: 10})
    ancestry.observe([row(10, {
      key: '10:old',
      name: 'old-parent',
    }), child], 1)
    const adopted = ancestry.observe([
      row(10, {
        key: '10:new',
        startTicks: 999,
        name: 'new-parent',
      }),
      child,
    ], 1).find(item => item.pid === 20)!
    expect(adopted.orphan).toBe(true)
    expect(adopted.formerParent).toEqual({
      name: 'old-parent',
      pid: 10,
    })
  })
  test('marks only newly observed direct children of init as detached', () => {
    const ancestry = new ProcessAncestry
    const newborn = ancestry.observe([row(20, {
      age: 0.4,
      ppid: 1,
    })], 1)[0]
    expect(newborn).toMatchObject({
      orphan: false,
      detached: true,
    })
    expect(hasProcessTag(newborn, 'detached')).toBe(true)
    const old = (new ProcessAncestry).observe([row(21, {
      age: 3600,
      ppid: 1,
    })], 1)[0]
    expect(old).toMatchObject({
      orphan: false,
      detached: false,
    })
  })
  test('leaves a missing parent unknown when there is no earlier observation', () => {
    const ancestry = new ProcessAncestry
    const child = ancestry.observe([row(20, {
      age: 0.2,
      ppid: 4321,
    })], 1)[0]
    expect(child).toMatchObject({
      orphan: false,
      detached: false,
    })
  })
  test('retains ancestry across brief process-scan omissions', () => {
    const ancestry = new ProcessAncestry
    const parent = row(10, {name: 'launcher'})
    const child = row(20, {ppid: 10})
    ancestry.observe([parent, child], 1)
    ancestry.observe([parent], 1)
    const returned = ancestry.observe([{
      ...child,
      ppid: 1,
    }], 1)[0]
    expect(returned.orphan).toBe(true)
    expect(returned.formerParent).toEqual({
      name: 'launcher',
      pid: 10,
    })
  })
  test('kernel threads and PID 1 never receive ancestry tags', () => {
    const ancestry = new ProcessAncestry
    const rows = ancestry.observe([
      row(1, {
        age: 0,
        ppid: 0,
      }),
      row(2, {
        age: 0,
        isKernelThread: true,
        ppid: 0,
      }),
    ], 1)
    for (const process of rows) {
      expect(process.orphan).toBe(false)
      expect(process.detached).toBe(false)
    }
  })
  test('clear forgets ancestry evidence after a host reboot', () => {
    const ancestry = new ProcessAncestry
    const child = row(20, {ppid: 10})
    ancestry.observe([row(10, {name: 'launcher'}), child], 1)
    expect(ancestry.observe([{
      ...child,
      ppid: 1,
    }], 1)[0].orphan).toBe(true)
    ancestry.clear()
    const after = ancestry.observe([{
      ...child,
      age: 500,
      ppid: 1,
    }], 1)[0]
    expect(after.orphan).toBe(false)
    expect(after.detached).toBe(false)
  })
})
