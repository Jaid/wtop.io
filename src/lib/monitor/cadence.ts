/** Next epoch-aligned boundary, strictly after now. Missed slots are skipped. */
export const nextSampleTime = (now: number, interval: number) => {
  if (!Number.isFinite(now) || !Number.isFinite(interval) || interval <= 0) {
    throw new RangeError('A finite timestamp and positive interval are required.')
  }
  return (Math.floor(now / interval) + 1) * interval
}
