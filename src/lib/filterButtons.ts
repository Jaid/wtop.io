export type FilterButton = {
  filter: string
  label: string
}

/** The first colon separates the label; the rest is an ordinary filter expression. */
export const parseFilterButton = (value: string): FilterButton => {
  const colon = value.indexOf(':')
  const label = value.slice(0, colon).trim()
  const filter = value.slice(colon + 1).trim()
  if (colon < 1 || !label || !filter || label.length > 64 || filter.length > 2048 || /[\n\r]/.test(value)) {
    throw new TypeError('Use Label:filter, for example Heavy:tag:heavy, with one button per line.')
  }
  return {
    label,
    filter,
  }
}

export const normalizeFilterButtons = (value: unknown): Array<string> => {
  const entries = Array.isArray(value) ? value : [value]
  if (entries.length > 32 || entries.some(entry => typeof entry !== 'string')) {
    throw new TypeError('Supply at most 32 filter buttons as strings.')
  }
  return entries.filter(entry => entry.trim()).map(entry => {
    const {label, filter} = parseFilterButton(entry)
    return `${label}:${filter}`
  })
}

/** Toggle a complete expression without overwriting text typed into the filter. */
export const isFilterActive = (current: string, expression: string) => {
  const tokens = new Set(current.trim().toLowerCase().split(/\s+/))
  return expression.trim().toLowerCase().split(/\s+/).every(token => tokens.has(token))
}
export const toggleFilter = (current: string, expression: string) => {
  const terms = expression.trim().split(/\s+/)
  const existing = current.trim().split(/\s+/).filter(Boolean)
  const wanted = new Set(terms.map(term => term.toLowerCase()))
  if (isFilterActive(current, expression)) {
    return existing.filter(term => !wanted.has(term.toLowerCase())).join(' ')
  }
  const present = new Set(existing.map(term => term.toLowerCase()))
  return [...existing, ...terms.filter(term => !present.has(term.toLowerCase()))].join(' ')
}
