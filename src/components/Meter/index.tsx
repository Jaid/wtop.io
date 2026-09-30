import type {CSSProperties, FunctionComponent, ReactNode} from 'react'

import clsx from 'clsx'

import PeakTrace from '#component/PeakTrace'
import {useTip} from '#component/Tooltip'

import css from './style.module.sass'

type MeterSegment = {
  color: string
  key: string
  /** percentage 0–100 of the whole bar */
  percent: number
}

type Props = {
  className?: string
  segments: Array<MeterSegment>
  size?: 'large' | 'small'
  tooltip?: (() => ReactNode) | ReactNode
}

const Meter: FunctionComponent<Props> = ({className, segments, size = 'small', tooltip}) => {
  const tip = useTip(tooltip ?? null)
  const bars: Array<{
    color: string
    key: string
    offset: number
    width: number
  }> = []
  for (const segment of segments) {
    const previous = bars.at(-1)
    const offset = previous ? previous.offset + previous.width : 0
    const width = Number.isFinite(segment.percent) ? Math.max(0, Math.min(100 - offset, segment.percent)) : 0
    bars.push({
      key: segment.key,
      offset,
      width,
      color: segment.color,
    })
  }
  return <div className={clsx(css.meter, css[size], className)} {...(tooltip ? tip : {})}>
    {bars.map(bar => <PeakTrace key={`peak.${bar.key}`} className={css.segment} color={bar.color} offset={bar.offset} value={bar.width} />)}
    {bars.map(bar => <span
      key={bar.key} className={css.segment} style={{
        '--offset': `${bar.offset}%`,
        '--width': `${bar.width}%`,
        background: bar.color,
      } as CSSProperties}
    />)}
  </div>
}

export default Meter
