export type LoadObservation = {
  cpu: number
  key: string
  memory: number
  memoryPercent: number
}

/** Keep five minutes of heavy-process evidence, independently of the graph window. */
export class RecentLoad {
  static readonly windowMs = 5 * 60_000
  readonly until = new Map<string, number>
  clear() {
    this.until.clear()
  }
  isHeavy(key: string, time: number) {
    return (this.until.get(key) ?? 0) > time
  }
  observe(rows: ReadonlyArray<LoadObservation>, time: number) {
    for (const [key, until] of this.until) {
      if (until <= time) {
        this.until.delete(key)
      }
    }
    for (const row of rows) {
      // One logical core is 100%; ignore tiny memory allocations on small hosts.
      if (row.cpu >= 80 || row.memoryPercent >= 5 && row.memory >= 256_000_000) {
        this.until.set(row.key, time + RecentLoad.windowMs)
      }
    }
  }
}
