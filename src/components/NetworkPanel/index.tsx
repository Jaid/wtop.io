import type {HistoryView as History} from '#src/lib/monitor/History.ts'
import type {Frame, InterfaceRates} from '#src/lib/monitor/types.ts'
import type {FunctionComponent} from 'react'

import clsx from 'clsx'
import {FiArrowDown, FiArrowUp, FiGlobe} from 'react-icons/fi'

import Graph from '#component/Graph'
import Panel from '#component/Panel'
import {Tip, TooltipTable} from '#component/Tooltip'
import {byteParts, formatBytes, formatRate} from '#src/lib/format.ts'

import css from './style.module.sass'

type Props = {
  frame: Frame
  history: History
  interval: number
  paused: boolean
  windowSeconds: number
}

const Rate: FunctionComponent<{
  direction: 'rx' | 'tx'
  value: number
}> = ({direction, value}) => {
  const parts = byteParts(value)
  const Icon = direction === 'rx' ? FiArrowDown : FiArrowUp
  return <span className={clsx(css.rate, css[direction])}>
    <Icon className={css.arrow} aria-hidden />
    <span className={css.value}>{parts.value}</span>
    <span className={css.unit}>{parts.unit}/s</span>
  </span>
}
const InterfaceRow: FunctionComponent<{entry: InterfaceRates}> = ({entry}) => <Tip
  className={clsx(css.interface, entry.virtual && css.virtual)} content={<TooltipTable
    rows={[
      ['receiving', formatRate(entry.rx)],
      ['sending', formatRate(entry.tx)],
      ['received since boot', formatBytes(entry.rxTotal)],
      ['sent since boot', formatBytes(entry.txTotal)],
      entry.virtual && ['kind', 'virtual, not counted in the total'],
    ]} title={entry.name}
  />} tag='div'
>
  <span className={css.interfaceName}>{entry.name}</span>
  <span className={css.rx}>{formatRate(entry.rx)}</span>
  <span className={css.tx}>{formatRate(entry.tx)}</span>
</Tip>
const NetworkPanel: FunctionComponent<Props> = ({frame, history, interval, paused, windowSeconds}) => {
  const {network} = frame
  const interfaces = network.interfaces
    .filter(entry => entry.name !== 'lo' && (entry.rxTotal > 0 || entry.txTotal > 0))
    .toSorted((a, b) => Number(a.virtual) - Number(b.virtual) || b.rx + b.tx - (a.rx + a.tx) || b.rxTotal - a.rxTotal)
    .slice(0, 4)
  return <Panel accent='--rx' icon={FiGlobe} title='Network'>
    <div className={css.rates}>
      <Rate direction='rx' value={network.rx} />
      <Rate direction='tx' value={network.tx} />
    </div>
    <div className={css.graph}>
      <Graph
        data={history} format={formatRate} interval={interval} minMax={128_000} paused={paused} series={[
          {
            key: 'net.rx',
            label: 'receiving',
            color: '--rx',
            fill: true,
          },
          {
            key: 'net.tx',
            label: 'sending',
            color: '--tx',
            fill: true,
            negative: true,
          },
        ]} tooltipTitle='Network' windowSeconds={windowSeconds}
      />
    </div>
    <div className={css.interfaces}>
      {interfaces.map(entry => <InterfaceRow key={entry.name} entry={entry} />)}
    </div>
  </Panel>
}

export default NetworkPanel
