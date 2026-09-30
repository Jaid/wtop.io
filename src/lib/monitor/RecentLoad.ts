export type LoadObservation = {key: string, cpu: number, memory: number, memoryPercent: number}

/** Keep five minutes of heavy-process evidence, independently of the graph window. */
export class RecentLoad {
  readonly until = new Map<string, number>()
  static readonly windowMs = 5 * 60_000
  observe(rows: ReadonlyArray<LoadObservation>, time: number) {
    for (const [key, until] of this.until) {
      if (until <= time) { this.until.delete(key) }
    }
    for (const row of rows) {
      // One logical core is 100%; ignore tiny memory allocations on small hosts.
      if (row.cpu >= 80 || row.memoryPercent >= 5 && row.memory >= 256_000_000) {
        this.until.set(row.key, time + RecentLoad.windowMs)
      }
    }
  }
  isHeavy(key: string, time: number) { return (this.until.get(key) ?? 0) > time }
  clear() { this.until.clear() }
}
