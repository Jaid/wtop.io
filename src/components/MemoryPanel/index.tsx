import type {History} from '#src/lib/monitor/History.ts'
import type {Frame} from '#src/lib/monitor/types.ts'
import type {FunctionComponent} from 'react'

import {FiDatabase} from 'react-icons/fi'

import Graph from '#component/Graph'
import Meter from '#component/Meter'
import Panel from '#component/Panel'
import {Tip, TooltipTable} from '#component/Tooltip'
import {byteParts, formatBytes, formatPercent} from '#src/lib/format.ts'

import css from './style.module.sass'

type Props = {
  frame: Frame
  history: History
  interval: number
  paused: boolean
  windowSeconds: number
}

const MemoryPanel: FunctionComponent<Props> = ({frame, history, interval, paused, windowSeconds}) => {
  const {memory} = frame
  const total = memory.total || 1
  const cachedPercent = Math.min(100, (memory.cached + memory.buffers) / total * 100)
  const used = byteParts(memory.used)
  const breakdown = <TooltipTable
    rows={[
      ['used', `${formatBytes(memory.used)} (${formatPercent(memory.percent)})`],
      ['cache', formatBytes(memory.cached)],
      ['buffers', formatBytes(memory.buffers)],
      ['shared', formatBytes(memory.shared)],
      ['free', formatBytes(memory.free)],
      ['available', formatBytes(memory.available)],
      ['total', formatBytes(memory.total)],
    ]} title='Memory'
  />
  return <Panel accent='--memory' aside={<span>{formatBytes(memory.total)}</span>} icon={FiDatabase} title='Memory'>
    <Tip className={css.big} content={breakdown}>
      <span>{used.value}</span>
      <span className={css.unit}>{used.unit}</span>
      <span className={css.percent}>{formatPercent(memory.percent)}</span>
    </Tip>
    <Meter
      segments={[
        {
          key: 'used',
          percent: memory.percent,
          color: 'var(--memory)',
        },
        {
          key: 'cache',
          percent: cachedPercent,
          color: 'var(--memory-cache)',
        },
      ]} size='large' tooltip={breakdown}
    />
    <div className={css.legend}>
      <span><i style={{background: 'var(--memory)'}} />used</span>
      <span><i style={{background: 'var(--memory-cache)'}} />cache {formatBytes(memory.cached + memory.buffers)}</span>
      <span><i style={{background: 'var(--surface-strong)'}} />free {formatBytes(memory.free)}</span>
    </div>
    <div className={css.graph}>
      <Graph
        data={history} format={value => formatPercent(value)} interval={interval} max={100} paused={paused} series={[
          {
            key: 'memory',
            label: 'used',
            color: '--memory',
            fill: true,
          },
          {
            key: 'swap',
            label: 'swap',
            color: '--swap',
            width: 1,
          },
        ]} tooltipTitle='Memory' windowSeconds={windowSeconds}
      />
    </div>
    {memory.swapTotal > 0 && <div className={css.swap}>
      <span className={css.swapLabel}>swap</span>
      <Meter
        segments={[{
          key: 'swap',
          percent: memory.swapPercent,
          color: 'var(--swap)',
        }]} tooltip={<TooltipTable rows={[['used', formatBytes(memory.swapUsed)], ['total', formatBytes(memory.swapTotal)]]} title='Swap' />}
      />
      <span className={css.swapValue}>{formatBytes(memory.swapUsed)}</span>
    </div>}
  </Panel>
}

export default MemoryPanel
