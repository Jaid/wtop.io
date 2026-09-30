import {useLayoutEffect, useRef} from 'react'

import {PeakHold} from '#src/lib/PeakHold.ts'

/** A translucent, independently expiring trace underneath a live bar. */
const PeakTrace = ({value, color, offset = 0, vertical = false, className}: {
  className?: string
  color: string
  offset?: number
  value: number
  vertical?: boolean
}) => {
  const element = useRef<HTMLElement>(null)
  const holder = useRef<PeakHold | null>(null)
  const previous = useRef<{
    color: string
    offset: number
    value: number
  } | null>(null)
  useLayoutEffect(() => {
    const node = element.current
    if (!node) {
      return
    }
    const now = performance.now()
    holder.current ??= new PeakHold
    const hold = holder.current
    if (previous.current) {
      hold.add({
        ...previous.current,
        time: now,
      })
    }
    const current = {
      value: Math.max(0, Math.min(100, value)),
      color,
      offset,
    }
    hold.add({
      ...current,
      time: now,
    })
    previous.current = current
    let timer: ReturnType<typeof setTimeout> | undefined
    const paint = () => {
      const time = performance.now()
      const peak = hold.get(time)
      const displayed = peak ?? current
      node.style[vertical ? 'height' : 'width'] = `${displayed.value}%`
      node.style[vertical ? 'bottom' : 'left'] = `${displayed.offset}%`
      node.style.background = displayed.color
      node.dataset.peak = String(displayed.value)
      if (peak) {
        timer = setTimeout(paint, Math.max(1, peak.time + hold.holdMs - time + 1))
      }
    }
    paint()
    return () => clearTimeout(timer)
  }, [value, color, offset, vertical])
  return <i
    className={className} aria-hidden style={{
      opacity: 0.13,
      pointerEvents: 'none',
    }} ref={element}
  />
}
export default PeakTrace
