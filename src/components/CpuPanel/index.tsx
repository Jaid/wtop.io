import type {HistoryView as History} from '#src/lib/monitor/History.ts'
import type {Frame} from '#src/lib/monitor/types.ts'
import type {CSSProperties, FunctionComponent} from 'react'

import {FiCpu} from 'react-icons/fi'

import Graph from '#component/Graph'
import Panel from '#component/Panel'
import PeakTrace from '#component/PeakTrace'
import {Tip, TooltipTable} from '#component/Tooltip'
import {loadColor, temperatureColor} from '#src/lib/color.ts'
import {formatFrequency, formatNumber, formatPercent, formatTemperature} from '#src/lib/format.ts'

import css from './style.module.sass'

type Props = {
  frame: Frame
  history: History
  interval: number
  paused: boolean
  windowSeconds: number
}

const CoreTile: FunctionComponent<{
  frame: Frame
  index: number
}> = ({frame, index}) => {
  const core = frame.cpu.cores[index]
  const frequency = frame.frequency.cores[index]
  const style = {
    '--load': `${core.total}%`,
    '--load-color': loadColor(core.total),
  } as CSSProperties
  return <Tip
    className={css.core} content={() => <TooltipTable
      rows={[
        ['busy', formatPercent(core.total)],
        ['user', formatPercent(core.user)],
        ['system', formatPercent(core.system)],
        core.iowait > 0.05 && ['I/O wait', formatPercent(core.iowait)],
        core.steal > 0.05 && ['steal', formatPercent(core.steal)],
        frequency !== undefined && ['clock', formatFrequency(frequency)],
      ]} title={`CPU ${index}`}
    />}
  >
    <PeakTrace className={css.coreFill} color={loadColor(core.total)} value={core.total} vertical />
    <span className={css.coreFill} style={style} />
    <span className={css.coreLabel}>{Math.round(core.total) || ''}</span>
  </Tip>
}
const CpuPanel: FunctionComponent<Props> = ({frame, history, interval, paused, windowSeconds}) => {
  const {cpu} = frame
  const cores = cpu.cores.length
  const columns = cores <= 8 ? cores : Math.ceil(cores / Math.ceil(cores / 16))
  const loadPerCore = frame.load.map(value => (cores > 0 ? value / cores * 100 : 0))
  return <Panel
    accent='--cpu' aside={<>
      {frame.sensors.cpu !== undefined && <Tip content={<TooltipTable rows={frame.sensors.list.filter(sensor => /coretemp|cpu|k10temp|zenpower/.test(sensor.chip)).map(sensor => [sensor.label, formatTemperature(sensor.celsius)])} title='CPU temperature' />}>
        <span style={{color: temperatureColor(frame.sensors.cpu)}}>{formatTemperature(frame.sensors.cpu)}</span>
      </Tip>}
      {frame.frequency.average > 0 && <Tip content={<TooltipTable rows={[['average', formatFrequency(frame.frequency.average)], ['fastest core', formatFrequency(frame.frequency.max)]]} title='Clock speed' />}>
        {formatFrequency(frame.frequency.average)}
      </Tip>}
    </>} icon={FiCpu} subtitle={cpu.model} title='CPU'
  >
    <div className={css.summary}>
      <Tip
        className={css.big} content={<TooltipTable
          rows={[
            ['user', formatPercent(cpu.user)],
            ['system', formatPercent(cpu.system)],
            ['I/O wait', formatPercent(cpu.iowait)],
            cpu.steal > 0.05 && ['steal', formatPercent(cpu.steal)],
            ['context switches', `${formatNumber(frame.contextSwitchRate)}/s`],
          ]} title='CPU time'
        />}
      >
        <span style={{color: loadColor(cpu.total)}}>{formatNumber(cpu.total, cpu.total < 10 ? 1 : 0)}</span>
        <span className={css.unit}>%</span>
      </Tip>
      <div className={css.breakdown}>
        <span className={css.legend}><i style={{background: 'var(--cpu)'}} />user {formatPercent(cpu.user)}</span>
        <span className={css.legend}><i style={{background: 'var(--cpu-system)'}} />system {formatPercent(cpu.system)}</span>
        <span className={css.legend}><i style={{background: 'var(--cpu-iowait)'}} />I/O wait {formatPercent(cpu.iowait)}</span>
      </div>
      <Tip
        className={css.load} content={<TooltipTable
          rows={[
            ['1 minute', `${formatNumber(frame.load[0], 2)} (${formatPercent(loadPerCore[0])} of ${cores} CPUs)`],
            ['5 minutes', `${formatNumber(frame.load[1], 2)} (${formatPercent(loadPerCore[1])})`],
            ['15 minutes', `${formatNumber(frame.load[2], 2)} (${formatPercent(loadPerCore[2])})`],
            ['tasks', `${formatNumber(frame.tasks.running)} running of ${formatNumber(frame.tasks.total)}`],
          ]} title='Load average'
        />}
      >
        <span className={css.loadLabel}>load</span>
        {frame.load.map((value, index) => <span key={index} className={css.loadValue} style={{color: loadColor(loadPerCore[index])}}>{formatNumber(value, 2)}</span>)}
      </Tip>
    </div>
    <div className={css.graph}>
      <Graph
        data={history} format={value => formatPercent(value)} interval={interval} max={100} paused={paused} series={[
          {
            key: 'cpu',
            label: 'total',
            color: '--cpu',
            fill: true,
          },
          {
            key: 'cpu.system',
            label: 'system',
            color: '--cpu-system',
            width: 1,
          },
          {
            key: 'cpu.iowait',
            label: 'I/O wait',
            color: '--cpu-iowait',
            width: 1,
          },
        ]} tooltipTitle='CPU' windowSeconds={windowSeconds}
      />
    </div>
    <div className={css.cores} style={{'--columns': columns} as CSSProperties}>
      {cpu.cores.map((_, index) => <CoreTile key={index} frame={frame} index={index} />)}
    </div>
  </Panel>
}

export default CpuPanel
