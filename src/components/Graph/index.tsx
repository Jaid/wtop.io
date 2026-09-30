import type {FunctionComponent, PointerEvent, ReactNode} from 'react'

import clsx from 'clsx'
import {useEffect, useLayoutEffect, useRef} from 'react'

import {useChartInspection} from '#component/GraphInspection'
import {rgba} from '#src/lib/color.ts'
import {formatClock} from '#src/lib/format.ts'
import {nearestSample} from '#src/lib/GraphCursor.ts'

import css from './style.module.sass'

type GraphData = {
  get: (key: string) => ReadonlyArray<number>
  times: ReadonlyArray<number>
}

type GraphSeries = {
  /** CSS color or custom property name like `--cpu` */
  color: string
  fill?: boolean
  key: string
  label: string
  /** draws the series downward from the center line */
  negative?: boolean
  width?: number
}

type Props = {
  className?: string
  data: GraphData
  format: (value: number) => string
  /** milliseconds between samples */
  interval: number
  /** fixed upper bound, auto-scaled if omitted */
  max?: number
  /** lower limit for the auto-scaled upper bound so idle noise does not fill the graph */
  minMax?: number
  paused?: boolean
  series: Array<GraphSeries>
  showGrid?: boolean
  tooltipTitle?: ReactNode
  windowSeconds: number
}

const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
/**
 * Canvas time series graph that scrolls smoothly at display refresh rate between samples.
 */
const Graph: FunctionComponent<Props> = props => {
  const inspection = useChartInspection(props.data)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const propsRef = useRef({
    ...props,
    data: inspection.data,
    cursor: inspection.cursor,
  })
  useLayoutEffect(() => {
    propsRef.current = {
      ...props,
      data: inspection.data,
      cursor: inspection.cursor,
    }
  }, [props, inspection.data, inspection.cursor])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const context = canvas.getContext('2d')
    if (!context) {
      return
    }
    let frame = 0
    let visible = true
    let width = 0
    let height = 0
    let scale = 1
    let currentMax = 0
    let frozenNow: number | undefined
    let held: {
      data: GraphData
      now: number
      scale: number
    } | undefined
    let colors = new Map<string, string>
    const resolveColors = () => {
      const style = getComputedStyle(canvas)
      colors = new Map(propsRef.current.series.map(series => {
        const value = series.color.startsWith('--') ? style.getPropertyValue(series.color).trim() : series.color
        return [series.color, value || '#888']
      }))
      colors.set('grid', style.getPropertyValue('--border').trim() || 'rgb(128 128 128 / 20%)')
      colors.set('text', style.getPropertyValue('--muted').trim() || '#888')
    }
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      scale = window.devicePixelRatio || 1
      width = Math.max(1, rect.width)
      height = Math.max(1, rect.height)
      canvas.width = Math.round(width * scale)
      canvas.height = Math.round(height * scale)
    }
    const effectiveDelay = (times: ReadonlyArray<number>, interval: number) => {
      const recent: Array<number> = []
      for (let index = Math.max(1, times.length - 6); index < times.length; index++) {
        recent.push(times[index] - times[index - 1])
      }
      recent.sort((a, b) => a - b)
      const median = recent.length > 0 ? recent[Math.floor(recent.length / 2)] : interval
      return Math.max(interval, median) * 1.08 + 60
    }
    const draw = () => {
      const {data: liveData, cursor, series, windowSeconds, interval, max, minMax = 0, paused, showGrid = true} = propsRef.current
      const reduced = prefersReducedMotion()
      if (cursor && !held) {
        const times = [...liveData.times]
        const values = new Map(series.map(entry => [entry.key, [...liveData.get(entry.key)]]))
        held = {
          data: {
            times,
            get: key => values.get(key) ?? [],
          },
          now: cursor.end,
          scale: currentMax,
        }
      } else if (!cursor) {
        held = undefined
      }
      canvas.dataset.frozen = String(Boolean(held))
      const data = held?.data ?? liveData
      const times = data.times
      const latest = times.at(-1) ?? Date.now()
      if (paused) {
        frozenNow ??= reduced ? latest : Date.now() - effectiveDelay(times, interval)
      } else {
        frozenNow = undefined
      }
      const now = held?.now ?? frozenNow ?? (reduced ? latest : Math.min(Date.now() - effectiveDelay(times, interval), latest + interval))
      canvas.dataset.plotTime = String(now)
      const span = windowSeconds * 1000
      const start = now - span
      const mirrored = series.some(entry => entry.negative)
      const toX = (time: number) => (time - start) / span * width
      let firstIndex = 0
      while (firstIndex < times.length - 1 && times[firstIndex + 1] < start) {
        firstIndex++
      }
      let visibleMax = 0
      for (const entry of series) {
        const values = data.get(entry.key)
        for (let index = firstIndex; index < values.length; index++) {
          const value = values[index]
          if (Number.isFinite(value) && value > visibleMax) {
            visibleMax = value
          }
        }
      }
      const targetMax = max ?? Math.max(minMax, visibleMax * 1.15)
      currentMax = currentMax === 0 || max !== undefined ? targetMax : currentMax + (targetMax - currentMax) * (reduced ? 1 : 0.12)
      if (held) {
        currentMax = held.scale || targetMax
      }
      const scaleMax = currentMax || 1
      const baseline = mirrored ? height / 2 : height - 1
      const amplitude = mirrored ? height / 2 - 2 : height - 3
      const toY = (value: number, negative?: boolean) => {
        const ratio = Math.min(1.05, Math.max(0, value / scaleMax))
        return negative ? baseline + ratio * amplitude : baseline - ratio * amplitude
      }
      context.setTransform(scale, 0, 0, scale, 0, 0)
      context.clearRect(0, 0, width, height)
      if (showGrid) {
        context.strokeStyle = colors.get('grid') ?? '#333'
        context.lineWidth = 1
        context.setLineDash([2, 4])
        context.beginPath()
        for (const ratio of mirrored ? [0.25, 0.75] : [0.25, 0.5, 0.75]) {
          const y = Math.round(height * ratio) + 0.5
          context.moveTo(0, y)
          context.lineTo(width, y)
        }
        context.stroke()
        context.setLineDash([])
        if (mirrored) {
          context.beginPath()
          context.moveTo(0, Math.round(baseline) + 0.5)
          context.lineTo(width, Math.round(baseline) + 0.5)
          context.stroke()
        }
      }
      for (const entry of series) {
        const values = data.get(entry.key)
        const color = colors.get(entry.color) ?? '#888'
        const segments: Array<Array<[number, number]>> = []
        let segment: Array<[number, number]> = []
        for (let index = Math.max(0, firstIndex - 1); index < times.length; index++) {
          const value = values[index]
          if (!Number.isFinite(value)) {
            if (segment.length > 0) {
              segments.push(segment)
            }
            segment = []
            continue
          }
          segment.push([toX(times[index]), toY(value, entry.negative)])
        }
        if (segment.length > 0) {
          segments.push(segment)
        }
        for (const points of segments) {
          if (points.length < 2) {
            continue
          }
          if (entry.fill) {
            // the gradient follows the visible peak, so low values still get a clearly tinted area
            let peak = baseline
            for (const [, y] of points) {
              peak = entry.negative ? Math.max(peak, y) : Math.min(peak, y)
            }
            const gradient = context.createLinearGradient(0, peak, 0, baseline)
            gradient.addColorStop(0, rgba(color, 0.38))
            gradient.addColorStop(1, rgba(color, 0.03))
            context.fillStyle = gradient
            context.beginPath()
            context.moveTo(points[0][0], baseline)
            for (const [x, y] of points) {
              context.lineTo(x, y)
            }
            context.lineTo(points.at(-1)![0], baseline)
            context.closePath()
            context.fill()
          }
          context.strokeStyle = color
          context.lineWidth = entry.width ?? 1.5
          context.lineJoin = 'round'
          context.beginPath()
          for (const [index, [x, y]] of points.entries()) {
            if (index === 0) {
              context.moveTo(x, y)
            } else {
              context.lineTo(x, y)
            }
          }
          context.stroke()
        }
      }
      if (cursor) {
        canvas.dataset.hoverTime = String(cursor.time)
        const x = toX(cursor.time)
        const nearest = nearestSample(times, cursor.time)
        if (x >= 0 && x <= width) {
          context.strokeStyle = colors.get('text') ?? '#888'
          context.globalAlpha = 0.6
          context.beginPath()
          context.moveTo(Math.round(x) + 0.5, 0)
          context.lineTo(Math.round(x) + 0.5, height)
          context.stroke()
          context.globalAlpha = 1
          for (const entry of series) {
            const value = data.get(entry.key)[nearest]
            if (!Number.isFinite(value)) {
              continue
            }
            context.fillStyle = colors.get(entry.color) ?? '#888'
            context.beginPath()
            context.arc(x, toY(value, entry.negative), 3, 0, Math.PI * 2)
            context.fill()
          }
        }
      } else {
        delete canvas.dataset.hoverTime
      }
    }
    const loop = () => {
      frame = 0
      if (!visible || document.hidden) {
        return
      }
      draw()
      frame = requestAnimationFrame(loop)
    }
    const kick = () => {
      if (!frame && visible && !document.hidden) {
        frame = requestAnimationFrame(loop)
      }
    }
    resolveColors()
    resize()
    const resizeObserver = new ResizeObserver(() => {
      resize()
      draw()
    })
    resizeObserver.observe(canvas)
    const intersectionObserver = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting)
      kick()
    })
    intersectionObserver.observe(canvas)
    const schemeQuery = matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => {
      resolveColors()
      draw()
    }
    schemeQuery.addEventListener('change', onScheme)
    document.addEventListener('visibilitychange', kick)
    const colorTimer = setInterval(resolveColors, 3000)
    kick()
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      schemeQuery.removeEventListener('change', onScheme)
      document.removeEventListener('visibilitychange', kick)
      clearInterval(colorTimer)
    }
  }, [])
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'touch') {
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const end = inspection.cursor?.end ?? Number(event.currentTarget.dataset.plotTime)
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    inspection.move(end - props.windowSeconds * 1000 * (1 - ratio), end)
  }
  const index = inspection.cursor ? nearestSample(inspection.data.times, inspection.cursor.time) : -1
  const handlers = inspection.interactive ? {
    onPointerCancel: inspection.leave,
    onPointerEnter: onPointerMove,
    onPointerLeave: inspection.leave,
    onPointerMove,
  } : {}
  return <div className={clsx(css.frame, props.className)}>
    <canvas className={css.graph} style={{cursor: inspection.interactive ? 'crosshair' : 'default'}} ref={canvasRef} {...handlers} />
    {inspection.cursor && <div className={css.readout} data-graph-tooltip data-hover-time={inspection.cursor.time} role='tooltip'>
      <div className={css.tooltipTitle}>{props.tooltipTitle}<time>{formatClock(new Date(inspection.cursor.time))}</time></div>
      {props.series.map(entry => <div key={entry.key} className={css.tooltipRow}>
        <span className={css.swatch} style={{background: entry.color.startsWith('--') ? `var(${entry.color})` : entry.color}} />
        <span className={css.tooltipLabel}>{entry.label}</span>
        <span className={css.tooltipValue}>{props.format(inspection.data.get(entry.key)[index])}</span>
      </div>)}
    </div>}
  </div>
}

export default Graph
