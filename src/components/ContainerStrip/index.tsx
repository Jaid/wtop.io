import type {History} from '#src/lib/monitor/History.ts'
import type {ContainerFrame} from '#src/lib/monitor/types.ts'
import type {FunctionComponent} from 'react'

import clsx from 'clsx'
import {FiBox} from 'react-icons/fi'

import Sparkline from '#component/Sparkline'
import {Tip, TooltipTable} from '#component/Tooltip'
import {formatBytes, formatPercent, formatRate} from '#src/lib/format.ts'

import css from './style.module.sass'

type Props = {
  containers: Array<ContainerFrame>
  filter: string
  history: History
  onFilter: (filter: string) => void
}
const ContainerStrip: FunctionComponent<Props> = ({containers, history, filter, onFilter}) => <nav className={css.strip} aria-label='Containers'>
  <span className={css.label}><FiBox aria-hidden /> {containers.length}</span>
  <div className={css.list}>{containers.map(container => {
    const query = `container:${container.id}`
    const active = filter === query
    return <Tip
      key={container.id} content={<TooltipTable
        rows={[
          ['image', container.image],
          ['processes', String(container.processes)],
          ['CPU', formatPercent(container.cpu)],
          ['RSS sum', formatBytes(container.memory)],
          ['disk I/O', formatRate(container.read + container.write)],
          ['memory note', 'Sum of process RSS, not cgroup usage; shared pages can be counted more than once.'],
        ]} title={container.name}
      />}
    >
      <button className={clsx(css.chip, active && css.active)} aria-pressed={active} type='button' onClick={() => onFilter(active ? '' : query)}>
        <span className={css.name}>{container.name}</span>
        <span className={css.spark}><Sparkline color='var(--cpu)' values={history.get(`container.${container.id}.cpu`)} /></span>
        <span>{formatPercent(container.cpu)}</span><span className={css.memory}>{formatBytes(container.memory)}</span>
      </button>
    </Tip>
  })}</div>
</nav>
export default ContainerStrip
