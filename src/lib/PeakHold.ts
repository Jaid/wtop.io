export type PeakSample = {
  color: string
  offset: number
  time: number
  value: number
}

/** Monotonic maximum queue. Old values expire without extending lower peaks. */
export class PeakHold {
  private readonly queue: Array<PeakSample> = []
  constructor(readonly holdMs = 5000) {}
  add(sample: PeakSample) {
    if (!Number.isFinite(sample.value)) {
      return
    }
    while (this.queue.length && this.queue.at(-1)!.value <= sample.value) {
      this.queue.pop()
    }
    this.queue.push({
      ...sample,
      value: Math.max(0, sample.value),
    })
    this.get(sample.time)
  }
  get(time: number) {
    while (this.queue.length && this.queue[0].time + this.holdMs <= time) {
      this.queue.shift()
    }
    return this.queue[0]
  }
}
