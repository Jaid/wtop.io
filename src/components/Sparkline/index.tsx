import type {FunctionComponent} from 'react'

import {useId} from 'react'

import css from './style.module.sass'

type Props = {
  color: string
  /** fixed upper bound, defaults to the data maximum */
  max?: number
  values: ReadonlyArray<number>
}

const width = 200
const height = 40
const Sparkline: FunctionComponent<Props> = ({color, max, values}) => {
  const gradientId = `spark${useId().replaceAll(/[^\w-]/g, '')}`
  const finite = values.filter(value => Number.isFinite(value))
  if (finite.length < 2) {
    return <div className={css.empty}>collecting…</div>
  }
  const upper = max ?? Math.max(...finite, 1e-9) * 1.1
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
  return <svg className={css.sparkline} preserveAspectRatio='none' viewBox={`0 0 ${width} ${height}`}>
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
  </svg>
}

export default Sparkline
