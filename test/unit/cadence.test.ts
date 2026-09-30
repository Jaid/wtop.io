import {describe, expect, spyOn, test} from 'bun:test'

import {nextSampleTime} from '#src/lib/monitor/cadence.ts'
import {Monitor} from '#src/lib/monitor/Monitor.ts'
import {RecentLoad} from '#src/lib/monitor/RecentLoad.ts'
import {SimulationSource} from '#src/lib/source/SimulationSource.ts'

describe('absolute sample cadence', () => {
  test('independently started instances target the same epoch boundary', () => {
    expect(nextSampleTime(1234, 1000)).toBe(2000)
    expect(nextSampleTime(1876, 1000)).toBe(2000)
    expect(nextSampleTime(2000, 1000)).toBe(3000)
    expect(nextSampleTime(2901, 250)).toBe(3000)
  })
  test('skips missed slots and rejects invalid intervals', () => {
    expect(nextSampleTime(5834, 1000)).toBe(6000)
    expect(() => nextSampleTime(1, 0)).toThrow()
    expect(() => nextSampleTime(Number.NaN, 1000)).toThrow()
  })
  test('read duration does not move the next boundary; resume realigns', async () => {
    let now = 1234
    const clock = spyOn(Date, 'now').mockImplementation(() => now)
    const source = new SimulationSource({clock: () => now})
    const monitor = new Monitor(source, {
      historySeconds: 10,
      interval: 1000,
    })
    const delays: Array<number> = []
    monitor.schedule = delay => {
      delays.push(delay)
    }
    monitor.running = true
    try {
      monitor.scheduleNext()
      expect(delays.at(-1)).toBe(766)
      const sample = source.sample.bind(source)
      source.sample = async () => {
        now = 4250; return sample()
      }
      await monitor.tick(0)
      expect(delays.at(-1)).toBe(750)
      now = 5321
      monitor.setPaused(false)
      expect(delays.at(-1)).toBe(679)
      now = 6140
      monitor.setSuspended(false)
      expect(delays.at(-1)).toBe(860)
    } finally {
      monitor.stop(); clock.mockRestore()
    }
  })
})
describe('five-minute heavy tags', () => {
  const row = {
    key: '1:2',
    cpu: 0,
    memory: 0,
    memoryPercent: 0,
  }
  test('retains CPU spikes for five minutes regardless of graph length', () => {
    const recent = new RecentLoad
    recent.observe([{
      ...row,
      cpu: 90,
    }], 1000)
    recent.observe([row], 2000)
    expect(recent.isHeavy(row.key, 300_999)).toBe(true)
    expect(recent.isHeavy(row.key, 301_000)).toBe(false)
  })
  test('uses meaningful memory thresholds and never inherits tags across PID reuse', () => {
    const recent = new RecentLoad
    recent.observe([{
      ...row,
      memory: 1e9,
      memoryPercent: 10,
    }], 1000)
    expect(recent.isHeavy(row.key, 1001)).toBe(true)
    expect(recent.isHeavy('1:3', 1001)).toBe(false)
    recent.observe([{
      ...row,
      key: 'small',
      memory: 1e6,
      memoryPercent: 20,
    }], 1000)
    expect(recent.isHeavy('small', 1001)).toBe(false)
    recent.clear()
    expect(recent.isHeavy(row.key, 1001)).toBe(false)
  })
})
