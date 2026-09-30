import type {FunctionComponent} from 'react'

import {useId} from 'react'

import {useChartInspection} from '#component/GraphInspection'
import {formatClock, formatNumber} from '#src/lib/format.ts'
import {nearestSample} from '#src/lib/GraphCursor.ts'

import css from './style.module.sass'

type Props = {
  color: string
  format?: (value: number) => string
  label?: string
  /** fixed upper bound, defaults to the data maximum */
  max?: number
  times?: ReadonlyArray<number>
  values: ReadonlyArray<number>
}

const width = 200
const height = 40
const Sparkline: FunctionComponent<Props> = ({color, max, values: liveValues, times: liveTimes = [], label = 'History', format = formatNumber}) => {
  const inspection = useChartInspection({
    values: liveValues,
    times: liveTimes,
    max,
  })
  const {values, times, max: scaleMax} = inspection.data
  const gradientId = `spark${useId().replaceAll(/[^\w-]/g, '')}`
  const finite = values.filter(value => Number.isFinite(value))
  if (finite.length < 2) {
    return <div className={css.empty}>collecting…</div>
  }
  const upper = scaleMax ?? Math.max(...finite, 1e-9) * 1.1
  const step = width / (values.length - 1)
  const paths: Array<{
    fill: string
    line: string
  }> = []
  let points: Array<string> = []
  let firstX = 0
  let lastX = 0
  const flush = () => {
    if (points.length > 1) {
      const line = `M${points.join('L')}`
      paths.push({
        line,
        fill: `${line}L${lastX},${height}L${firstX},${height}Z`,
      })
    }
    points = []
  }
  for (const [index, value] of values.entries()) {
    if (!Number.isFinite(value)) {
      flush(); continue
    }
    const x = index * step
    if (!points.length) {
      firstX = x
    }
    lastX = x
    points.push(`${x.toFixed(1)},${(height - Math.min(1, Math.max(0, value / upper)) * (height - 2) - 1).toFixed(1)}`)
  }
  flush()
  const cursor = inspection.cursor
  const index = cursor ? nearestSample(times, cursor.time) : -1
  const start = times[0]
  const end = times.at(-1) ?? start
  const lineX = cursor && end > start ? (cursor.time - start) / (end - start) * width : -1
  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'touch' || !times.length) {
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    inspection.move(start + (end - start) * ratio, end)
  }
  const handlers = inspection.interactive ? {
    onPointerEnter: move,
    onPointerMove: move,
    onPointerCancel: inspection.leave,
    onPointerLeave: inspection.leave,
  } : {}
  return <div className={css.wrapper}>
    <svg className={css.sparkline} data-frozen={Boolean(cursor) || undefined} data-hover-time={cursor?.time} preserveAspectRatio='none' viewBox={`0 0 ${width} ${height}`} {...handlers}>
      <defs>
        <linearGradient id={gradientId} x1='0' x2='0' y1='0' y2='1'>
          <stop offset='0' stopColor={color} stopOpacity='0.4' />
          <stop offset='1' stopColor={color} stopOpacity='0.02' />
        </linearGradient>
      </defs>
      {paths.map((path, index) => <g key={index}>
        <path d={path.fill} fill={`url(#${gradientId})`} />
        <path d={path.line} fill='none' stroke={color} strokeWidth='1.5' vectorEffect='non-scaling-stroke' />
      </g>)}
      {lineX >= 0 && lineX <= width && <line opacity={0.6} stroke='currentColor' strokeWidth={1} vectorEffect='non-scaling-stroke' x1={lineX} x2={lineX} y1={0} y2={height} />}
    </svg>
    {cursor && <span className={css.readout} aria-label={label} data-graph-tooltip data-hover-time={cursor.time} role='tooltip'>
      {format(values[index])}<time>{formatClock(new Date(cursor.time))}</time>
    </span>}
  </div>
}

export default Sparkline
