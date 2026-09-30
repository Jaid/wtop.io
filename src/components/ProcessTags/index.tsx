import type {ProcessRow} from '#src/lib/monitor/types.ts'

import {FiActivity, FiBox, FiClock, FiCpu, FiGitBranch, FiPause, FiTrendingUp, FiX, FiZap} from 'react-icons/fi'

import {Tip, TooltipTable} from '#component/Tooltip'
import {stateDescriptions} from '#src/lib/monitor/processes.ts'

import css from './style.module.sass'

const stateIcons = {
  R: FiZap,
  D: FiClock,
  T: FiPause,
  t: FiPause,
  Z: FiX,
  X: FiX,
}
const ProcessTags = ({process}: {process: ProcessRow}) => {
  const StateIcon = stateIcons[process.state as keyof typeof stateIcons] ?? FiActivity
  const state = !['I', 'S'].includes(process.state)
  return <span className={css.tags}>
    {process.isAgent && <Tip content='Wtop collector'><span className={css.tag} aria-label='Wtop collector' data-tag='wtop'><img alt='' src='/icon.svg' /></span></Tip>}
    {process.isKernelThread && <Tip content='Linux kernel thread'><span className={css.tag} aria-label='Kernel thread' data-tag='kernel'><FiCpu aria-hidden /></span></Tip>}
    {process.orphan && <Tip content='Parent is PID 1 or absent from the current sample. This includes ordinary system services.'><span className={css.tag} aria-label='Orphan: parent is PID 1 or absent' data-tag='orphan'><FiGitBranch aria-hidden /></span></Tip>}
    {state && <Tip content={stateDescriptions[process.state] ?? `Process state ${process.state}`}><span className={css.tag} aria-label={`State ${process.state}`} data-state={process.state} data-tag='state'><StateIcon aria-hidden /></span></Tip>}
    {process.heavy && <Tip content='Heavy in the last five minutes: at least 80% of one CPU core, or at least 5% of host memory and 256 MB.'><span className={css.tag} aria-label='Heavy in the last five minutes' data-tag='heavy'><FiTrendingUp aria-hidden /></span></Tip>}
    {process.container && <Tip
      content={<TooltipTable
        rows={[
          ['name', process.container.name],
          ['image', process.container.image],
          process.container.composeProject && ['Compose', process.container.composeProject],
          process.container.composeService && ['service', process.container.composeService],
        ]} title='Docker container'
      />}
    ><span className={css.tag} aria-label={`Container ${process.container.name}`} data-tag='container'><FiBox aria-hidden /></span></Tip>}
  </span>
}
export default ProcessTags
