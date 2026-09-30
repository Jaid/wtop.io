
import {createContext, use} from 'react'

export const DashboardSettings = createContext<{
  interactive: boolean
  linger: number
  sound: 'off' | 'alerts' | 'all'
}>({
  interactive: true,
  linger: 5,
  sound: 'off',
})
export const useDashboardSettings = () => use(DashboardSettings)
