export const panelOptions = [
  {
    key: 'cpu',
    label: 'CPU',
  },
  {
    key: 'memory',
    label: 'Memory',
  },
  {
    key: 'network',
    label: 'Network',
  },
  {
    key: 'storage',
    label: 'Storage',
  },
  {
    key: 'sensors',
    label: 'Sensors',
  },
  {
    key: 'containers',
    label: 'Containers',
  },
  {
    key: 'processes',
    label: 'Processes',
  },
] as const
export const columnOptions = [
  {
    key: 'pid',
    label: 'PID',
    enabled: true,
  },
  {
    key: 'tags',
    label: 'Tags',
    enabled: true,
  },
  {
    key: 'name',
    label: 'Name',
    enabled: true,
  },
  {
    key: 'user',
    label: 'User',
    enabled: true,
  },
  {
    key: 'cpu',
    label: 'CPU',
    enabled: true,
  },
  {
    key: 'memory',
    label: 'Memory',
    enabled: true,
  },
  {
    key: 'io',
    label: 'Disk I/O',
    enabled: true,
  },
  {
    key: 'threads',
    label: 'Threads',
    enabled: true,
  },
  {
    key: 'state',
    label: 'State',
    enabled: false,
  },
  {
    key: 'age',
    label: 'Age',
    enabled: true,
  },
  {
    key: 'command',
    label: 'Command',
    enabled: true,
  },
  {
    key: 'container',
    label: 'Container name',
    enabled: false,
  },
  {
    key: 'compose',
    label: 'Compose name',
    enabled: false,
  },
] as const
export const dateFormats = [
  {
    key: 'american',
    label: 'American (MM/DD/YYYY)',
  },
  {
    key: 'european',
    label: 'European (DD.MM.YYYY)',
  },
  {
    key: 'worded',
    label: 'Worded (Month DD, YYYY)',
  },
  {
    key: 'technical',
    label: 'Technical (YYYY-MM-DD)',
  },
] as const
export type DateFormat = typeof dateFormats[number]['key']
export const defaultPanels = panelOptions.map(option => option.key).join(',')
export const defaultColumns = columnOptions.filter(option => option.enabled).map(option => option.key).join(',')
/** An explicit none survives permalink parsing; an empty query value means default. */
export const selectedKeys = (value: string) => (value === 'none' ? [] : value.split(',').filter(Boolean))
export const normalizeSelection = (value: unknown, options: ReadonlyArray<{key: string}>) => {
  const values = String(value).split(',').map(key => key.trim().toLowerCase()).filter(Boolean)
  if (values.length === 1 && values[0] === 'none') {
    return 'none'
  }
  const valid = new Set(options.map(option => option.key))
  if (values.some(key => !valid.has(key))) {
    throw new TypeError('Unknown selection. Choose from the listed options.')
  }
  return options.filter(option => values.includes(option.key)).map(option => option.key).join(',') || 'none'
}
export const toggleSelection = (value: string, key: string, checked: boolean, options: ReadonlyArray<{key: string}>) => {
  const keys = new Set(selectedKeys(value))
  if (checked) {
    keys.add(key)
  } else {
    keys.delete(key)
  }
  return normalizeSelection([...keys].join(','), options)
}
