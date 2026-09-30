import type {History} from '#src/lib/monitor/History.ts'
import type {ContainerFrame} from '#src/lib/monitor/types.ts'
import type {FunctionComponent} from 'react'

import clsx from 'clsx'
import {FiBox} from 'react-icons/fi'

import Meter from '#component/Meter'
import Panel from '#component/Panel'
import Sparkline from '#component/Sparkline'
import {Tip, TooltipTable} from '#component/Tooltip'
import {formatBytes, formatCpuCell, formatPercent, formatRate} from '#src/lib/format.ts'

import css from './style.module.sass'

type Props = {
  containers: Array<ContainerFrame>
  filter: string
  history: History
  memoryTotal: number
  onFilter: (filter: string) => void
}
const ContainerPanel: FunctionComponent<Props> = ({containers, history, filter, memoryTotal, onFilter}) => <Panel
  className={css.panel} accent='--info' aside={<span>{containers.length}</span>} icon={FiBox} title='Containers'
>
  <div className={css.headings}><span>Name</span><span>CPU</span><span>Memory</span></div>
  <div className={css.list} aria-label='Container list' tabIndex={0}>
    {containers.map(container => {
      const query = `container:${container.id}`
      const active = filter === query
      return <Tip
        key={container.id} content={<TooltipTable
          rows={[
            ['image', container.image],
            container.composeProject && ['Compose', `${container.composeProject}${container.composeService ? ` / ${container.composeService}` : ''}`],
            ['processes', String(container.processes)],
            ['CPU', formatPercent(container.cpu)],
            ['memory', formatBytes(container.memory)],
            ['disk I/O', formatRate(container.read + container.write)],
          ]} title={container.name}
        />} tag='div'
      >
        <button className={clsx(css.row, active && css.active)} aria-pressed={active} type='button' onClick={() => onFilter(active ? '' : query)}>
          <span className={css.identity}><FiBox aria-hidden /><span className={css.name}>{container.name}</span></span>
          <span className={css.metric}><span>{formatCpuCell(container.cpu)}</span><Meter
            segments={[{
              key: 'cpu',
              percent: Math.min(100, container.cpu),
              color: 'var(--cpu)',
            }]}
          /></span>
          <span className={css.metric}><span>{formatBytes(container.memory)}</span><Meter
            segments={[{
              key: 'memory',
              percent: memoryTotal > 0 ? container.memory / memoryTotal * 100 : 0,
              color: 'var(--memory)',
            }]}
          /></span>
          <span className={css.spark}><Sparkline color='var(--cpu)' values={history.get(`container.${container.id}.cpu`)} /></span>
          <span className={css.details}>{container.processes} processes{container.composeProject ? ` · ${container.composeProject}` : ''}</span>
        </button>
      </Tip>
    })}
    {!containers.length && <p className={css.empty}>No container processes in this sample.</p>}
  </div>
</Panel>

export default ContainerPanel
