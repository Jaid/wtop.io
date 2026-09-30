export type GraphCursorState = {
  end: number
  epoch: number
  owner: string
  time: number
}

/** One time-domain cursor per dashboard. No pixel coordinates are shared across graphs. */
export class GraphCursor {
  clear = () => {
    if (!this.state) {
      return
    }
    this.state = null
    for (const listener of this.listeners) {
      listener()
    }
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private epoch = 0
  private readonly listeners = new Set<() => void>
  private state: GraphCursorState | null = null
  move(owner: string, time: number, end: number) {
    if (!Number.isFinite(time) || !Number.isFinite(end)) {
      return
    }
    const epoch = this.state?.epoch ?? ++this.epoch
    this.state = {
      owner,
      epoch,
      time,
      end: this.state?.end ?? end,
    }
    for (const listener of this.listeners) {
      listener()
    }
  }
  release(owner: string) {
    if (this.state?.owner === owner) {
      this.clear()
    }
  }
}

export const nearestSample = (times: ReadonlyArray<number>, time: number) => {
  const last = times.at(-1)
  if (last === undefined || time < times[0] || time > last) {
    return -1
  }
  let low = 0
  let high = times.length - 1
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (times[mid] < time) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low > 0 && time - times[low - 1] < times[low] - time ? low - 1 : low
}
