import type {ReactNode} from 'react'

import {createContext, use, useEffect, useId, useState, useSyncExternalStore} from 'react'

import {useDashboardSettings} from '#src/lib/dashboardSettings.ts'
import {GraphCursor} from '#src/lib/GraphCursor.ts'

const fallback = new GraphCursor
const Context = createContext(fallback)
export const GraphInspection = ({children}: {children: ReactNode}) => {
  const [store] = useState(() => new GraphCursor)
  useEffect(() => {
    window.addEventListener('blur', store.clear)
    document.addEventListener('visibilitychange', store.clear)
    return () => {
      window.removeEventListener('blur', store.clear)
      document.removeEventListener('visibilitychange', store.clear)
      store.clear()
    }
  }, [store])
  return <Context value={store}>{children}</Context>
}

/** Freeze immutable render data for the whole hover session, not just the hovered chart. */
export const useChartInspection = <T,>(live: T) => {
  const store = use(Context)
  const {interactive} = useDashboardSettings()
  const owner = useId()
  const active = useSyncExternalStore(store.subscribe, store.getSnapshot, () => null)
  const cursor = interactive ? active : null
  const [held, setHeld] = useState<{
    data: T
    epoch: number
  }>()
  if (cursor && held?.epoch !== cursor.epoch) {
    setHeld({
      epoch: cursor.epoch,
      data: live,
    })
  }
  if (!cursor && held) {
    setHeld(undefined)
  }
  useEffect(() => () => store.release(owner), [owner, store])
  return {
    cursor,
    data: cursor && held?.epoch === cursor.epoch ? held.data : live,
    move: (time: number, end: number) => {
      if (interactive) {
        store.move(owner, time, end)
      }
    },
    leave: () => store.release(owner),
    interactive,
  }
}
