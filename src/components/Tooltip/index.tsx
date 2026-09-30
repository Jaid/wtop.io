import type {FunctionComponent, ReactNode, PointerEvent as ReactPointerEvent} from 'react'

import {createContext, use, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'

import css from './style.module.sass'

type Point = {
  x: number
  y: number
}

type TooltipApi = {
  hide: (owner: string) => void
  move: (point: Point) => void
  show: (owner: string, content: ReactNode, point?: Point) => void
}

const noop: TooltipApi = {
  show: () => {},
  move: () => {},
  hide: () => {},
}
const TooltipContext = createContext<TooltipApi>(noop)
const offset = 16

export const TooltipProvider: FunctionComponent<{children: ReactNode}> = ({children}) => {
  const [state, setState] = useState<{
    content: ReactNode
    owner: string
  } | null>(null)
  const elementRef = useRef<HTMLDivElement>(null)
  const pointRef = useRef<Point>({
    x: 0,
    y: 0,
  })
  const place = useCallback(() => {
    const element = elementRef.current
    if (!element) {
      return
    }
    const {x, y} = pointRef.current
    const width = element.offsetWidth
    const height = element.offsetHeight
    const maxX = window.innerWidth - width - 8
    const maxY = window.innerHeight - height - 8
    let left = x + offset
    let top = y + offset
    if (left > maxX) {
      left = Math.max(8, x - offset - width)
    }
    if (top > maxY) {
      top = Math.max(8, y - offset - height)
    }
    element.style.translate = `${Math.round(left)}px ${Math.round(top)}px`
  }, [])
  const api = useMemo<TooltipApi>(() => ({
    show: (owner, content, point) => {
      if (point) {
        pointRef.current = point
      }
      setState({
        owner,
        content,
      })
    },
    move: point => {
      pointRef.current = point
      place()
    },
    hide: owner => {
      setState(current => (current?.owner === owner ? null : current))
    },
  }), [place])
  useLayoutEffect(place)
  const visible = Boolean(state)
  useEffect(() => {
    if (!visible) {
      return
    }
    const hideOnScroll = () => setState(null)
    window.addEventListener('scroll', hideOnScroll, {
      capture: true,
      passive: true,
    })
    window.addEventListener('blur', hideOnScroll)
    return () => {
      window.removeEventListener('scroll', hideOnScroll, {capture: true})
      window.removeEventListener('blur', hideOnScroll)
    }
  }, [visible])
  return <TooltipContext value={api}>
    {children}
    {state && createPortal(<div className={css.tooltip} role='tooltip' ref={elementRef}>{state.content}</div>, document.body)}
  </TooltipContext>
}

const useTooltipApi = () => use(TooltipContext)

/**
 * Attaches a rich tooltip to an element. The content stays live while the tooltip is visible.
 */
export const useTip = (content: (() => ReactNode) | ReactNode) => {
  const api = useTooltipApi()
  const owner = useId()
  const activeRef = useRef(false)
  const resolve = () => (typeof content === 'function' ? content() : content)
  useEffect(() => {
    if (activeRef.current) {
      api.show(owner, resolve())
    }
  })
  useEffect(() => () => {
    if (activeRef.current) {
      api.hide(owner)
    }
  }, [api, owner])
  return {
    onPointerEnter: (event: ReactPointerEvent) => {
      if (event.pointerType === 'touch') {
        return
      }
      activeRef.current = true
      api.show(owner, resolve(), {
        x: event.clientX,
        y: event.clientY,
      })
    },
    onPointerMove: (event: ReactPointerEvent) => {
      if (activeRef.current) {
        api.move({
          x: event.clientX,
          y: event.clientY,
        })
      }
    },
    onPointerLeave: () => {
      activeRef.current = false
      api.hide(owner)
    },
  }
}

type TipProps = {
  children: ReactNode
  className?: string
  content: (() => ReactNode) | ReactNode
  tag?: 'div' | 'span'
}

export const Tip: FunctionComponent<TipProps> = ({children, className, content, tag = 'span'}) => {
  const handlers = useTip(content)
  const Tag = tag
  return <Tag className={className} {...handlers}>{children}</Tag>
}

/** falsy entries are skipped, so rows can be written as `condition && [label, value]` */
type TooltipRow = [label: ReactNode, value: ReactNode] | 0 | '' | false | null | undefined

export const TooltipTable: FunctionComponent<{
  rows: Array<TooltipRow>
  title?: ReactNode
}> = ({title, rows}) => <div className={css.table}>
  {title && <div className={css.title}>{title}</div>}
  {rows.filter(Boolean).map((row, index) => {
    const [label, value] = row as [ReactNode, ReactNode]
    return <div key={index} className={css.row}>
      <span className={css.label}>{label}</span>
      <span className={css.value}>{value}</span>
    </div>
  })}
</div>
