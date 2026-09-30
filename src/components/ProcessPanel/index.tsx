import type {ArgvMode} from '#src/lib/argv.ts'
import type {HistoryView as History} from '#src/lib/monitor/History.ts'
import type {DisplayRow} from '#src/lib/monitor/processes.ts'
import type {Frame, ProcessRow} from '#src/lib/monitor/types.ts'
import type {DateFormat} from '#src/lib/preferences.ts'
import type {Signal} from '#src/lib/procfs/script.ts'
import type {SortKey} from '#src/queryParameters.ts'
import type {CSSProperties, FunctionComponent, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject} from 'react'

import clsx from 'clsx'
import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {FiChevronDown, FiChevronRight, FiEye, FiEyeOff, FiGitMerge, FiList, FiSearch, FiX} from 'react-icons/fi'

import Command from '#component/Command'
import Panel from '#component/Panel'
import PeakTrace from '#component/PeakTrace'
import ProcessDetails from '#component/ProcessDetails'
import ProcessTags from '#component/ProcessTags'
import {Tip, TooltipTable} from '#component/Tooltip'
import {loadColor} from '#src/lib/color.ts'
import {formatBytes, formatCpuCell, formatDateTime, formatDuration, formatNumber, formatPercent, formatRate} from '#src/lib/format.ts'
import {buildDisplayRows, defaultDirection, holdRowOrder, stateDescriptions} from '#src/lib/monitor/processes.ts'
import {defaultColumns, selectedKeys} from '#src/lib/preferences.ts'

import css from './style.module.sass'

type Props = {
  argvMode: ArgvMode
  columns?: string
  dateFormat?: DateFormat
  destructive: boolean
  filter: string
  filterRef: RefObject<HTMLInputElement | null>
  frame: Frame
  history: History
  onFilterChange: (filter: string) => void
  onReverse: () => void
  onSignal: (pid: number, signal: Signal, startTicks: number) => Promise<void>
  onSortChange: (sort: SortKey) => void
  onToggle: (setting: 'agent' | 'kernel' | 'tree') => void
  reverse: boolean
  sampleCount: number
  showAgent: boolean
  showKernel: boolean
  sort: SortKey
  tree: boolean
}

type Column = {
  align?: 'right'
  /** width on very narrow screens */
  compactWidth?: string
  id: string
  label: string
  render: (row: DisplayRow, context: RenderContext) => ReactNode
  sort?: SortKey
  title: string
  width: string
}

type RenderContext = {
  argvMode: ArgvMode
  collapsed: Set<string>
  cores: number
  dateFormat: DateFormat
  toggleCollapsed: (key: string) => void
  tree: boolean
}

const rowHeight = 26
const overscan = 12
const StateBadge: FunctionComponent<{state: string}> = ({state}) => <Tip className={clsx(css.state, css[`state${state === 't' ? 'T' : state}`])} content={<TooltipTable rows={[['state', stateDescriptions[state] ?? 'unknown']]} title={`State ${state}`} />}>
  {state}
</Tip>
const columns: Array<Column> = [
  {
    id: 'pid',
    label: 'PID',
    title: 'process ID',
    sort: 'pid',
    width: '56px',
    compactWidth: '44px',
    align: 'right',
    render: ({process}) => <span className={css.pid}>{process.pid}</span>,
  },
  {
    id: 'tags',
    label: 'Tags',
    title: 'process tags',
    width: '81px',
    render: ({process}) => <ProcessTags process={process} />,
  },
  {
    id: 'name',
    label: 'Name',
    title: 'executable name (comm)',
    sort: 'name',
    width: 'minmax(90px, 1.1fr)',
    compactWidth: 'minmax(70px, 1fr)',
    render: ({branch, hasChildren, process}, context) => <span className={css.nameCell}>
      {context.tree && branch && <span className={css.branch} aria-hidden>{branch}</span>}
      {context.tree && hasChildren ? <button
        className={css.caret} aria-label={context.collapsed.has(process.key) ? 'Expand' : 'Collapse'} type='button' onClick={event => {
          event.stopPropagation()
          context.toggleCollapsed(process.key)
        }}
      >{context.collapsed.has(process.key) ? <FiChevronRight /> : <FiChevronDown />}</button> : context.tree && <span className={css.caretSpacer} />}
      <span className={clsx(css.name, process.isKernelThread && css.kernel)}>{process.name}</span>
    </span>,
  },
  {
    id: 'user',
    label: 'User',
    title: 'owner of the process',
    sort: 'user',
    width: '96px',
    render: ({process}) => <span className={clsx(css.user, process.uid === 0 && css.root)}>{process.user}</span>,
  },
  {
    id: 'cpu',
    label: 'CPU',
    title: 'CPU usage in percent of one core',
    sort: 'cpu',
    width: '84px',
    compactWidth: '60px',
    align: 'right',
    render: ({process}) => {
      const style = {
        '--bar': `${Math.min(100, process.cpu)}%`,
        '--bar-color': loadColor(Math.min(100, process.cpu), 70),
      } as CSSProperties
      return <span className={css.cpu} style={style}><PeakTrace className={css.peakRow} color={loadColor(Math.min(100, process.cpu), 70)} value={Math.min(100, process.cpu)} />{formatCpuCell(process.cpu)}</span>
    },
  },
  {
    id: 'memory',
    label: 'Memory',
    title: 'resident memory',
    sort: 'memory',
    width: '80px',
    compactWidth: '68px',
    align: 'right',
    render: ({process}) => <span className={css.memory} style={{'--bar': `${Math.min(100, process.memoryPercent * 4)}%`} as CSSProperties}><PeakTrace className={css.peakRow} color='var(--memory)' value={Math.min(100, process.memoryPercent * 4)} />{process.memory > 0 ? formatBytes(process.memory) : '–'}</span>,
  },
  {
    id: 'io',
    label: 'Disk I/O',
    title: 'bytes read and written per second',
    sort: 'io',
    width: '96px',
    align: 'right',
    render: ({process}) => {
      const total = (process.readRate ?? 0) + (process.writeRate ?? 0)
      if (process.readRate === undefined && process.writeRate === undefined) {
        return <span className={css.faint}>–</span>
      }
      return <Tip className={clsx(total < 1 && css.faint)} content={<TooltipTable rows={[['read', formatRate(process.readRate ?? 0)], ['write', formatRate(process.writeRate ?? 0)]]} title='Disk I/O' />}>
        {Math.round(total) === 0 ? '' : formatRate(total)}
      </Tip>
    },
  },
  {
    id: 'threads',
    label: 'Thr',
    title: 'number of threads',
    sort: 'threads',
    width: '48px',
    align: 'right',
    render: ({process}) => <span className={clsx(process.threads === 1 && css.faint)}>{process.threads}</span>,
  },
  {
    id: 'state',
    label: 'S',
    title: 'process state',
    sort: 'state',
    width: '30px',
    render: ({process}) => <StateBadge state={process.state} />,
  },
  {
    id: 'age',
    label: 'Age',
    title: 'time since the process started',
    sort: 'age',
    width: '70px',
    align: 'right',
    render: ({process}, context) => <Tip className={css.faintish} content={<TooltipTable rows={[['started', formatDateTime(new Date(process.startedAt), context.dateFormat)]]} title='Age' />}>{formatDuration(process.age)}</Tip>,
  },
  {
    id: 'command',
    label: 'Command',
    title: 'command line',
    sort: 'command',
    width: 'minmax(160px, 3fr)',
    render: ({process}, context) => <Command mode={context.argvMode} process={process} />,
  },
  {
    id: 'container',
    label: 'Container',
    title: 'container name',
    sort: 'container',
    width: 'minmax(120px, 1fr)',
    render: ({process}) => process.container?.name ?? '',
  },
  {
    id: 'compose',
    label: 'Compose',
    title: 'Compose project and service',
    sort: 'compose',
    width: 'minmax(120px, 1fr)',
    render: ({process}) => (process.container?.composeProject ? `${process.container.composeProject}${process.container.composeService ? ` / ${process.container.composeService}` : ''}` : ''),
  },
]
const useElementWidth = (ref: RefObject<HTMLElement | null>) => {
  const [width, setWidth] = useState(1200)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(entries => {
      setWidth(Math.round(entries[0].contentRect.width))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}
const ProcessPanel: FunctionComponent<Props> = props => {
  const {columns: selectedColumns = defaultColumns, dateFormat = 'technical', argvMode, destructive, filter, filterRef, frame, history, onFilterChange, onSignal, onSortChange, onToggle, sampleCount, showAgent, showKernel, sort, tree, reverse, onReverse} = props
  const initialDirection = defaultDirection(sort)
  const direction = reverse ? (initialDirection === 'asc' ? 'desc' : 'asc') : initialDirection
  const [selectedKey, setSelectedKey] = useState<string>()
  const [selectedSnapshot, setSelectedSnapshot] = useState<ProcessRow>()
  const [collapsed, setCollapsed] = useState(() => new Set<string>)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const tableRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tableWidth = useElementWidth(tableRef)
  const [orderHeld, setOrderHeld] = useState(false)
  const [locked, setLocked] = useState<{
    rows: Array<DisplayRow>
    signature: string
  }>()
  const sortedRows = buildDisplayRows(frame.processes, {
    sort,
    direction,
    filter,
    tree,
    showKernel,
    showAgent,
    argvMode,
    collapsed,
  })
  const signature = JSON.stringify([sort, direction, filter, tree, showKernel, showAgent, argvMode, [...collapsed]])
  if (orderHeld && locked?.signature !== signature) {
    setLocked({
      signature,
      rows: sortedRows,
    })
  }
  const rows = orderHeld && locked?.signature === signature ? holdRowOrder(sortedRows, locked.rows) : sortedRows
  const visibleColumns = columns.filter(column => selectedKeys(selectedColumns).includes(column.id) && !(column.id === 'command' && argvMode === 'hidden'))
  const compact = tableWidth < 440
  const template = visibleColumns.map(column => (compact ? column.compactWidth ?? column.width : column.width)).join(' ')
  const minimumWidth = visibleColumns.reduce((sum, column) => sum + Number.parseFloat((compact ? column.compactWidth ?? column.width : column.width).replace('minmax(', '')), 24 + Math.max(0, visibleColumns.length - 1) * 10)
  const selectedRow = selectedKey ? frame.processes.find(process => process.key === selectedKey) : undefined
  // Retain the last selected identity even after that process exits.
  if (selectedRow && selectedRow !== selectedSnapshot) {
    setSelectedSnapshot(selectedRow)
  }
  const detailRow = selectedRow ?? (selectedKey ? selectedSnapshot : undefined)
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(entries => {
      setViewportHeight(entries[0].contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!selectedKey) {
      return
    }
    const onWindowKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key === 'Escape' && !event.defaultPrevented && !(target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))) {
        setSelectedKey(undefined)
        setSelectedSnapshot(undefined)
      }
    }
    globalThis.addEventListener('keydown', onWindowKey)
    return () => globalThis.removeEventListener('keydown', onWindowKey)
  }, [selectedKey])
  const selectedIndex = selectedKey ? rows.findIndex(row => row.process.key === selectedKey) : -1
  const scrollToIndex = (index: number) => {
    const element = scrollRef.current
    if (!element || index < 0) {
      return
    }
    const top = index * rowHeight
    if (top < element.scrollTop) {
      element.scrollTop = top
    } else if (top + rowHeight > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + rowHeight - element.clientHeight
    }
  }
  const select = (key: string | undefined) => {
    setSelectedKey(key)
    if (key) {
      setSelectedSnapshot(rows.find(row => row.process.key === key)?.process)
    }
    if (!key) {
      setSelectedSnapshot(undefined)
    }
  }
  const selectPid = (pid: number) => {
    const target = frame.processes.find(process => process.pid === pid)
    if (target) {
      select(target.key)
      const index = rows.findIndex(row => row.process.key === target.key)
      requestAnimationFrame(() => scrollToIndex(index))
    }
  }
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'PageDown' || event.key === 'PageUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const page = Math.max(1, Math.floor(viewportHeight / rowHeight) - 1)
      let index = selectedIndex
      if (event.key === 'ArrowDown') {
        index = Math.min(rows.length - 1, index + 1)
      } else if (event.key === 'ArrowUp') {
        index = Math.max(0, index - 1)
      } else if (event.key === 'PageDown') {
        index = Math.min(rows.length - 1, index + page)
      } else if (event.key === 'PageUp') {
        index = Math.max(0, index - page)
      } else if (event.key === 'Home') {
        index = 0
      } else {
        index = rows.length - 1
      }
      const row = rows[index]
      if (row) {
        select(row.process.key)
        scrollToIndex(index)
      }
    } else if (event.key === 'Escape' && selectedKey) {
      event.stopPropagation()
      select(undefined)
    } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && tree && selectedKey) {
      const row = rows[selectedIndex]
      if (row?.hasChildren || collapsed.has(selectedKey)) {
        event.preventDefault()
        setCollapsed(current => {
          const next = new Set(current)
          if (event.key === 'ArrowLeft') {
            next.add(selectedKey)
          } else {
            next.delete(selectedKey)
          }
          return next
        })
      }
    }
  }
  const setSort = (key: SortKey) => {
    if (key === sort) {
      onReverse()
    } else {
      onSortChange(key)
    }
  }
  const context: RenderContext = {
    dateFormat,
    argvMode,
    tree,
    collapsed,
    cores: frame.cpu.cores.length,
    toggleCollapsed: key => setCollapsed(current => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    }),
  }
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [filter, sort, reverse, tree, showKernel, showAgent])
  const boundedTop = Math.min(scrollTop, Math.max(0, rows.length * rowHeight - viewportHeight))
  const first = Math.max(0, Math.floor(boundedTop / rowHeight) - overscan)
  const last = Math.min(rows.length, Math.ceil((boundedTop + viewportHeight) / rowHeight) + overscan)
  const visibleRows = rows.slice(first, last)
  const hiddenCount = Math.max(0, frame.processes.length - rows.length)
  const parent = detailRow ? frame.processes.find(process => process.pid === detailRow.ppid && process.pid !== detailRow.pid) : undefined
  const childCount = detailRow ? frame.processes.filter(process => process.ppid === detailRow.pid && process.pid !== detailRow.pid).length : 0
  const totalCpu = rows.reduce((sum, row) => sum + row.process.cpu, 0)
  return <Panel
    className={css.panel} accent='--accent' aside={<span className={css.count}>
      {formatNumber(rows.length)} shown{orderHeld && <span className={css.held}> · order held</span>}{hiddenCount > 0 && <span className={css.faint}> · {formatNumber(hiddenCount)} hidden</span>}
    </span>} icon={FiList} title='Processes'
  >
    <div className={css.toolbar}>
      <label className={css.search}>
        <FiSearch className={css.searchIcon} aria-hidden />
        <input
          aria-label='Filter processes'
          placeholder='Filter by name, command, user, container or PID…'
          spellCheck={false}
          type='search'
          value={filter}
          ref={filterRef}
          onChange={event => onFilterChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              if (filter) {
                event.stopPropagation()
                onFilterChange('')
              } else {
                event.currentTarget.blur()
              }
            } else if (event.key === 'ArrowDown' || event.key === 'Enter') {
              event.preventDefault()
              scrollRef.current?.focus()
              if (!selectedKey && rows[0]) {
                select(rows[0].process.key)
              }
            }
          }}
        />
        {filter && <button className={css.clear} aria-label='Clear filter' type='button' onClick={() => onFilterChange('')}><FiX /></button>}
        <kbd className={css.hint}>F</kbd>
      </label>
      <div className={css.toggles}>
        <Tip content={<TooltipTable rows={[['shortcut', <kbd key='t'>T</kbd>], ['keys', '← → collapse and expand']]} title='Show processes as a tree' />}>
          <button className={clsx(css.toggle, tree && css.active)} aria-pressed={tree} type='button' onClick={() => onToggle('tree')}><FiGitMerge aria-hidden />Tree</button>
        </Tip>
        <Tip content={<TooltipTable rows={[['shortcut', <kbd key='k'>K</kbd>]]} title='Show kernel threads' />}>
          <button className={clsx(css.toggle, showKernel && css.active)} aria-pressed={showKernel} type='button' onClick={() => onToggle('kernel')}>{showKernel ? <FiEye aria-hidden /> : <FiEyeOff aria-hidden />}Kernel</button>
        </Tip>
        <Tip content={<TooltipTable rows={[['what', 'processes of the helper container that collects the data']]} title='Show the wtop agent' />}>
          <button className={clsx(css.toggle, showAgent && css.active)} aria-pressed={showAgent} type='button' onClick={() => onToggle('agent')}>{showAgent ? <FiEye aria-hidden /> : <FiEyeOff aria-hidden />}Agent</button>
        </Tip>
      </div>
    </div>
    {visibleColumns.length === 0 && <p className={css.empty}>No columns selected. Choose columns in setup.</p>}
    <div className={clsx(css.body, detailRow && css.withDetails)}>
      <div
        className={css.table} data-order-held={orderHeld || undefined} role='table' style={{
          '--template': template,
          '--table-width': `${minimumWidth}px`,
        } as CSSProperties} ref={tableRef} onPointerCancel={() => {
          setOrderHeld(false); setLocked(undefined)
        }} onPointerEnter={event => {
          if (event.pointerType !== 'touch') {
            setOrderHeld(true); setLocked({
              signature,
              rows: sortedRows,
            })
          }
        }} onPointerLeave={() => {
          setOrderHeld(false); setLocked(undefined)
        }}
      >
        <div className={css.headerRow} role='row' ref={headerRef}>
          {visibleColumns.map(column => <button
            key={column.id}
            className={clsx(css.headerCell, column.align === 'right' && css.right, column.sort === sort && css.sorted)}
            aria-sort={column.sort === sort ? direction === 'asc' ? 'ascending' : 'descending' : undefined}
            role='columnheader'
            title={`Sort by ${column.title}`}
            type='button'
            onClick={() => column.sort && setSort(column.sort)}
          >
            {column.label}
            {column.sort === sort && <span className={css.arrow} aria-hidden>{direction === 'asc' ? '▲' : '▼'}</span>}
            {column.id === 'cpu' && <span className={css.headerSum}>{formatPercent(totalCpu, 0)}</span>}
          </button>)}
        </div>
        <div
          className={css.scroll}
          aria-label='Process list'
          role='rowgroup'
          tabIndex={0}
          ref={scrollRef}
          onKeyDown={onKeyDown}
          onScroll={event => {
            setScrollTop(event.currentTarget.scrollTop); if (headerRef.current) {
              headerRef.current.style.transform = `translateX(${-event.currentTarget.scrollLeft}px)`
            }
          }}
        >
          <div
            style={{
              height: rows.length * rowHeight,
              position: 'relative',
            }}
          >
            {visibleRows.map((row, offset) => {
              const index = first + offset
              const {process} = row
              return <div
                key={process.key}
                className={clsx(css.row, process.key === selectedKey && css.selected, row.exited && css.exited, row.dimmed && css.dimmed, sampleCount > 1 && process.age < 2.5 && css.fresh, process.state === 'Z' && css.zombie, process.state === 'T' && css.stopped, index % 2 === 1 && css.odd)}
                aria-selected={process.key === selectedKey}
                data-cpu={process.cpu}
                data-exited={row.exited || undefined}
                data-process-key={process.key}
                role='row'
                style={{top: index * rowHeight}}
                title={row.exited ? 'This process exited while the table order was held.' : undefined}
                onClick={() => select(process.key === selectedKey ? undefined : process.key)}
              >
                {visibleColumns.map(column => <span key={column.id} className={clsx(css.cell, column.align === 'right' && css.right)} role='cell'>{column.render(row, context)}</span>)}
              </div>
            })}
          </div>
          {rows.length === 0 && <div className={css.empty}>{filter ? `No process matches “${filter}”` : 'No processes'}</div>}
        </div>
      </div>
      {detailRow && <div className={css.detailsSlot}>
        <ProcessDetails
          key={detailRow.key}
          argvMode={argvMode}
          childCount={childCount}
          cores={frame.cpu.cores.length}
          dateFormat={dateFormat}
          destructive={destructive}
          gone={!selectedRow}
          history={history.processes.get(detailRow.key)}
          parent={parent}
          row={selectedRow ?? detailRow}
          onClose={() => select(undefined)}
          onFilter={onFilterChange}
          onSelectPid={selectPid}
          onSignal={onSignal}
        />
      </div>}
    </div>
  </Panel>
}

export default ProcessPanel
