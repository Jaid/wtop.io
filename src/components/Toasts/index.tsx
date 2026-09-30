import type {FunctionComponent, ReactNode} from 'react'

import clsx from 'clsx'
import {createContext, use, useEffect, useMemo, useRef, useState} from 'react'
import {FiAlertTriangle, FiCheckCircle, FiInfo, FiX} from 'react-icons/fi'

import css from './style.module.sass'

type ToastKind = 'error' | 'info' | 'success' | 'warning'

type Toast = {
  body?: ReactNode
  id: number
  kind: ToastKind
  leaving?: boolean
  title: ReactNode
}

type ToastApi = {
  dismiss: (id: number) => void
  push: (toast: Omit<Toast, 'id'> & {duration?: number}) => number
}

const ToastContext = createContext<ToastApi>({
  push: () => 0,
  dismiss: () => {},
})
const icons = {
  error: FiAlertTriangle,
  warning: FiAlertTriangle,
  success: FiCheckCircle,
  info: FiInfo,
}

export const ToastProvider: FunctionComponent<{children: ReactNode}> = ({children}) => {
  const [toasts, setToasts] = useState<Array<Toast>>([])
  const counter = useRef(0)
  const pending = useRef(new Set<ReturnType<typeof setTimeout>>)
  useEffect(() => {
    const timers = pending.current
    return () => {
      for (const timer of timers) {
        clearTimeout(timer)
      }; timers.clear()
    }
  }, [])
  const api = useMemo<ToastApi>(() => {
    const schedule = (callback: () => void, delay: number) => {
      const timer = setTimeout(() => {
        pending.current.delete(timer); callback()
      }, delay)
      pending.current.add(timer)
    }
    const dismiss = (id: number) => {
      setToasts(current => current.map(toast => (toast.id === id ? {
        ...toast,
        leaving: true,
      } : toast)))
      schedule(() => setToasts(current => current.filter(toast => toast.id !== id)), 220)
    }
    return {
      dismiss,
      push: ({duration = 4500, ...toast}) => {
        counter.current++
        const id = counter.current
        setToasts(current => [...current.slice(-4), {
          ...toast,
          id,
        }])
        if (duration > 0) {
          schedule(() => dismiss(id), duration)
        }
        return id
      },
    }
  }, [])
  return <ToastContext value={api}>
    {children}
    <div className={css.stack} aria-live='polite'>
      {toasts.map(toast => {
        const Icon = icons[toast.kind]
        return <div key={toast.id} className={clsx(css.toast, css[toast.kind], toast.leaving && css.leaving)} role='status'>
          <Icon className={css.icon} aria-hidden />
          <div className={css.content}>
            <div className={css.title}>{toast.title}</div>
            {toast.body && <div className={css.body}>{toast.body}</div>}
          </div>
          <button className={css.close} aria-label='Dismiss' type='button' onClick={() => api.dismiss(toast.id)}><FiX /></button>
        </div>
      })}
    </div>
  </ToastContext>
}

export const useToasts = () => use(ToastContext)
