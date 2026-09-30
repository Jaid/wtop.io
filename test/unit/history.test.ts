import {describe, expect, test} from 'bun:test'
import {History} from '#src/lib/monitor/History.ts'
import {deriveFrame} from '#src/lib/monitor/derive.ts'
import {SimulatedHost} from '#src/lib/source/simulation/SimulatedHost.ts'

const host = new SimulatedHost({seed: 7, now: 1_790_000_000_000})
const sample = {snapshot: host.snapshot(), containers: host.containerInfos(), receivedAt: 1_790_000_000_000}
const frame = deriveFrame(undefined, sample)
const base = frame.processes.find(row => !row.isKernelThread)!

describe('immutable chart snapshots', () => {
  test('stable until a new sample, then new series and process arrays', () => {
    const history = new History(3)
    history.pushFrame({
      ...frame,
      receivedAt: 1,
    })
    const first = history.getSnapshot()
    const name = `container.${frame.containers[0].id}.cpu`
    expect(history.getSnapshot()).toBe(first)
    expect(first.get(name)).toHaveLength(1)
    history.pushFrame({
      ...frame,
      receivedAt: 2,
    })
    const second = history.getSnapshot()
    expect(second).not.toBe(first)
    expect(second.get(name)).toHaveLength(2)
    expect(first.get(name)).toHaveLength(1)
    expect(first.times).toEqual([1])
    expect(first.processes.get(base.key)?.cpu).toHaveLength(1)
    expect(second.processes.get(base.key)?.cpu).toHaveLength(2)
    history.pushFrame({
      ...frame,
      receivedAt: 3,
    })
    history.resize(2)
    expect(first.times).toEqual([1])
    expect(history.getSnapshot().times).toEqual([2, 3])
  })
})
