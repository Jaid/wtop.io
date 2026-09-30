import {describe, expect, test} from 'bun:test'
import {GraphCursor, nearestSample} from '#src/lib/GraphCursor.ts'

describe('shared graph cursor', () => {
  test('moving the cursor preserves the held window and release is owner-specific', () => {
    const cursor = new GraphCursor
    let events = 0
    const unsubscribe = cursor.subscribe(() => events++)
    cursor.move('cpu', 1500, 2000)
    const epoch = cursor.getSnapshot()!.epoch
    cursor.move('cpu', 1600, 3000)
    expect(cursor.getSnapshot()).toMatchObject({
      epoch,
      time: 1600,
      end: 2000,
    })
    cursor.release('memory')
    expect(cursor.getSnapshot()).not.toBeNull()
    cursor.release('cpu')
    expect(cursor.getSnapshot()).toBeNull()
    cursor.move('memory', 1700, 3000)
    expect(cursor.getSnapshot()!.epoch).toBeGreaterThan(epoch)
    unsubscribe()
    expect(events).toBe(4)
  })
  test('does not invent samples beyond a graph history', () => {
    expect(nearestSample([], 1500)).toBe(-1)
    expect(nearestSample([1000, 2000], 999)).toBe(-1)
    expect(nearestSample([1000, 2000], 2001)).toBe(-1)
    expect(nearestSample([1000, 2000], 1800)).toBe(1)
    expect(nearestSample([1000, 2000], 1100)).toBe(0)
  })
})
