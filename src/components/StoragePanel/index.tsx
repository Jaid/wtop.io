import type {HistoryView as History} from '#src/lib/monitor/History.ts'
import type {FilesystemState, Frame} from '#src/lib/monitor/types.ts'
import type {FunctionComponent} from 'react'

import {FiHardDrive} from 'react-icons/fi'

import Graph from '#component/Graph'
import Meter from '#component/Meter'
import Panel from '#component/Panel'
import {Tip, TooltipTable} from '#component/Tooltip'
import {loadColor} from '#src/lib/color.ts'
import {byteParts, formatBytes, formatPercent, formatRate} from '#src/lib/format.ts'

import css from './style.module.sass'

type Props = {
  frame: Frame
  history: History
  interval: number
  paused: boolean
  windowSeconds: number
}

const Filesystem: FunctionComponent<{filesystem: FilesystemState}> = ({filesystem}) => {
  const tooltip = <TooltipTable
    rows={[
      ['device', filesystem.device],
      filesystem.type && ['type', filesystem.type],
      ['used', `${formatBytes(filesystem.used)} (${formatPercent(filesystem.percent)})`],
      ['available', formatBytes(filesystem.available)],
      ['size', formatBytes(filesystem.size)],
    ]} title={filesystem.mount}
  />
  return <Tip className={css.filesystem} content={tooltip} tag='div'>
    <div className={css.filesystemHeader}>
      <span className={css.mount}>{filesystem.mount}</span>
      <span className={css.filesystemValue}>{formatBytes(filesystem.available)} free</span>
    </div>
    <Meter
      segments={[{
        key: 'used',
        percent: filesystem.percent,
        color: loadColor(filesystem.percent * 1.15 - 15, 72),
      }]}
    />
  </Tip>
}
const StoragePanel: FunctionComponent<Props> = ({frame, history, interval, paused, windowSeconds}) => {
  const {disk} = frame
  const read = byteParts(disk.read)
  const write = byteParts(disk.write)
  return <Panel
    accent='--read' aside={<Tip content={<TooltipTable rows={disk.devices.map(device => [device.name, `${formatPercent(device.busy)} busy · ${formatRate(device.read)} read · ${formatRate(device.write)} written`])} title='Utilization' />}>
      {formatPercent(disk.busy)} busy
    </Tip>} icon={FiHardDrive} title='Storage'
  >
    <div className={css.rates}>
      <span className={css.rate}><i style={{background: 'var(--read)'}} /><span className={css.value}>{read.value}</span><span className={css.unit}>{read.unit}/s read</span></span>
      <span className={css.rate}><i style={{background: 'var(--write)'}} /><span className={css.value}>{write.value}</span><span className={css.unit}>{write.unit}/s write</span></span>
    </div>
    <div className={css.graph}>
      <Graph
        data={history} format={formatRate} interval={interval} minMax={1_000_000} paused={paused} series={[
          {
            key: 'disk.read',
            label: 'read',
            color: '--read',
            fill: true,
          },
          {
            key: 'disk.write',
            label: 'write',
            color: '--write',
            fill: true,
            negative: true,
          },
        ]} tooltipTitle='Storage' windowSeconds={windowSeconds}
      />
    </div>
    <div className={css.filesystems}>
      {frame.filesystems.slice(0, 4).map(filesystem => <Filesystem key={filesystem.mount} filesystem={filesystem} />)}
    </div>
  </Panel>
}

export default StoragePanel
