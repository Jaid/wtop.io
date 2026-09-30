import type {SoundMode} from './sound.ts'

import {createContext, use} from 'react'

export const DashboardSettings = createContext<{
  interactive: boolean
  linger: number
  sound: SoundMode
}>({
  interactive: true,
  linger: 5,
  sound: 'off',
})
export const useDashboardSettings = () => use(DashboardSettings)
