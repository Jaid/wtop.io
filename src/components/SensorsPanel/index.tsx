import type {HistoryView as History} from '#src/lib/monitor/History.ts'
import type {Frame, GpuState} from '#src/lib/monitor/types.ts'
import type {SensorReading} from '#src/lib/procfs/types.ts'
import type {FunctionComponent} from 'react'

import {FiThermometer} from 'react-icons/fi'

import Graph from '#component/Graph'
import Meter from '#component/Meter'
import Panel from '#component/Panel'
import {Tip, TooltipTable} from '#component/Tooltip'
import {loadColor, temperatureColor} from '#src/lib/color.ts'
import {formatBytes, formatPercent, formatTemperature} from '#src/lib/format.ts'

import css from './style.module.sass'

type Props = {
  frame: Frame
  history: History
  interval: number
  paused: boolean
  windowSeconds: number
}

const chipNames: Record<string, string> = {
  k10temp: 'CPU',
  zenpower: 'CPU',
  coretemp: 'CPU',
  nvme: 'NVMe',
  drivetemp: 'Drive',
  amdgpu: 'GPU',
  nouveau: 'GPU',
  acpitz: 'ACPI',
  iwlwifi_1: 'Wi‑Fi',
}
/** one representative reading per chip instance keeps the list short */
const groupSensors = (sensors: Array<SensorReading>) => {
  const groups = new Map<string, Array<SensorReading>>
  for (const sensor of sensors) {
    const key = sensor.id ?? sensor.chip
    const list = groups.get(key) ?? []
    list.push(sensor)
    groups.set(key, list)
  }
  return [...groups].map(([chip, readings]) => ({
    chip,
    name: chipNames[readings[0].chip] ?? readings[0].chip,
    readings,
    max: Math.max(...readings.map(reading => reading.celsius)),
  })).toSorted((a, b) => b.max - a.max)
}
const GpuRow: FunctionComponent<{gpu: GpuState}> = ({gpu}) => <Tip
  className={css.gpu} content={<TooltipTable
    rows={[
      gpu.state && ['power state', gpu.state],
      gpu.device && ['device', gpu.device],
      gpu.busy !== undefined && ['busy', formatPercent(gpu.busy)],
      gpu.vramUsed !== undefined && ['VRAM used', formatBytes(gpu.vramUsed)],
      gpu.vramTotal !== undefined && ['VRAM total', formatBytes(gpu.vramTotal)],
    ]} title={`GPU ${gpu.card}`}
  />} tag='div'
>
  <span className={css.gpuName}>{gpu.card}</span>
  {gpu.busy !== undefined && <Meter
    segments={[{
      key: 'busy',
      percent: gpu.busy,
      color: loadColor(gpu.busy, 72),
    }]}
  />}
  <span className={css.gpuValue}>{gpu.state === 'suspended' ? 'asleep' : gpu.busy === undefined ? '–' : formatPercent(gpu.busy, 0)}</span>
  {gpu.vramPercent !== undefined && <>
    <span className={css.gpuSub}>VRAM</span>
    <Meter
      segments={[{
        key: 'vram',
        percent: gpu.vramPercent,
        color: 'var(--gpu)',
      }]}
    />
    <span className={css.gpuValue}>{formatBytes(gpu.vramUsed ?? 0)}</span>
  </>}
</Tip>
const SensorsPanel: FunctionComponent<Props> = ({frame, history, interval, paused, windowSeconds}) => {
  const groups = groupSensors(frame.sensors.list)
  const uniqueGpus = frame.gpus.filter((gpu, index, all) => !gpu.device || all.findIndex(other => other.device === gpu.device) === index)
  const hasGraph = frame.sensors.cpu !== undefined
  return <Panel accent='--temperature' icon={FiThermometer} title='Sensors'>
    {hasGraph && <div className={css.graph}>
      <Graph
        data={history} format={formatTemperature} interval={interval} max={100} paused={paused} series={[{
          key: 'temp.cpu',
          label: 'CPU',
          color: '--temperature',
          fill: true,
        }]} tooltipTitle='Temperature' windowSeconds={windowSeconds}
      />
    </div>}
    <div className={css.sensors}>
      {groups.length === 0 && <span className={css.empty}>No temperature sensors exposed by the host</span>}
      {groups.slice(0, 6).map(group => <Tip key={group.chip} className={css.sensor} content={<TooltipTable rows={group.readings.map(reading => [reading.label, formatTemperature(reading.celsius)])} title={group.chip} />} tag='div'>
        <span className={css.sensorName}>{group.name}</span>
        <Meter
          segments={[{
            key: 'temperature',
            percent: Math.min(100, Math.max(0, (group.max - 20) / 80 * 100)),
            color: temperatureColor(group.max, 72),
          }]}
        />
        <span className={css.sensorValue} style={{color: temperatureColor(group.max)}}>{formatTemperature(group.max)}</span>
      </Tip>)}
    </div>
    {frame.fans.length > 0 && <div className={css.sensors}>{frame.fans.map((fan, index) => <span key={index} className={css.sensor}>{fan.chip} · {fan.label}<span>{Math.round(fan.rpm)} rpm</span></span>)}</div>}
    {Object.keys(frame.pressure).length > 0 && <Tip content='Linux pressure stall information: percentage of time tasks were stalled, averaged over the last 10 seconds.' tag='div'>
      <div className={css.pressure}><span>Pressure</span>{(['cpu', 'memory', 'io'] as const).map(key => <span key={key}>{key} {frame.pressure[key]?.some ? formatPercent(frame.pressure[key].some.avg10) : '–'}</span>)}</div>
    </Tip>}
    {uniqueGpus.length > 0 && <div className={css.gpus}>
      {uniqueGpus.slice(0, 2).map(gpu => <GpuRow key={gpu.card} gpu={gpu} />)}
    </div>}
  </Panel>
}

export default SensorsPanel
