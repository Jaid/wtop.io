/** narrow no-break space (U+202F), used as thousands separator and between values and units */
const narrowSpace = '\u{202F}'
const byteUnits = ['b', 'kb', 'mb', 'gb', 'tb', 'pb'] as const

/**
 * Groups the integer part of a number with narrow spaces, but only for amounts ≥ 10 000.
 */
export const formatNumber = (value: number, fractionDigits = 0) => {
  if (!Number.isFinite(value)) {
    return '–'
  }
  const fixed = Math.abs(value).toFixed(fractionDigits)
  const [integerPart, fractionPart] = fixed.split('.')
  const grouped = Math.abs(value) >= 10_000 ? integerPart.replaceAll(/\B(?=(\d{3})+(?!\d))/g, narrowSpace) : integerPart
  const sign = value < 0 && Number(fixed) !== 0 ? '−' : ''
  return fractionPart ? `${sign}${grouped}.${fractionPart}` : `${sign}${grouped}`
}

/**
 * Picks a precision that yields roughly three significant digits.
 */
const smartDigits = (value: number) => {
  const magnitude = Math.abs(value)
  if (magnitude >= 100 || magnitude === 0) {
    return 0
  }
  if (magnitude >= 10) {
    return 1
  }
  return 2
}

export type ByteParts = {
  unit: string
  value: string
}

/**
 * Splits a byte amount into a rounded value and an SI unit (1 kb = 1000 b).
 */
export const byteParts = (bytes: number, fractionDigits?: number): ByteParts => {
  if (!Number.isFinite(bytes)) {
    return {
      value: '–',
      unit: '',
    }
  }
  let unitIndex = 0
  let scaled = Math.abs(bytes)
  while (scaled >= 1000 && unitIndex < byteUnits.length - 1) {
    scaled /= 1000
    unitIndex++
  }
  const digits = unitIndex === 0 ? 0 : fractionDigits ?? smartDigits(scaled)
  let rounded = Number(scaled.toFixed(digits))
  if (rounded >= 1000 && unitIndex < byteUnits.length - 1) {
    rounded /= 1000
    unitIndex++
  }
  const sign = bytes < 0 ? -1 : 1
  return {
    value: formatNumber(sign * rounded, unitIndex === 0 ? 0 : fractionDigits ?? smartDigits(rounded)),
    unit: byteUnits[unitIndex],
  }
}

export const formatBytes = (bytes: number, fractionDigits?: number) => {
  const {value, unit} = byteParts(bytes, fractionDigits)
  if (!unit) {
    return value
  }
  return `${value}${narrowSpace}${unit}`
}

export const formatRate = (bytesPerSecond: number) => {
  const formatted = formatBytes(bytesPerSecond)
  if (formatted === '–') {
    return formatted
  }
  return `${formatted}/s`
}

export const formatPercent = (value: number, fractionDigits?: number) => {
  if (!Number.isFinite(value)) {
    return '–'
  }
  const digits = fractionDigits ?? (Math.abs(value) < 10 ? 1 : 0)
  return `${formatNumber(value, digits)}%`
}

/**
 * Human-readable duration with the two most significant units, like “3d 4h” or “12m 5s”.
 */
export const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '–'
  }
  const total = Math.floor(seconds)
  const days = Math.floor(total / 86_400)
  const hours = Math.floor(total % 86_400 / 3600)
  const minutes = Math.floor(total % 3600 / 60)
  const secs = total % 60
  if (days > 0) {
    return `${formatNumber(days)}d ${hours}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`
  }
  return `${secs}s`
}

const pad = (value: number) => String(value).padStart(2, '0')

export const formatClock = (date: Date, withSeconds = true) => {
  const base = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return withSeconds ? `${base}:${pad(date.getSeconds())}` : base
}

export const formatDateTime = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatClock(date)}`

export const formatTemperature = (celsius: number) => {
  if (!Number.isFinite(celsius)) {
    return '–'
  }
  return `${formatNumber(celsius, 0)}${narrowSpace}℃`
}

export const formatFrequency = (megahertz: number) => {
  if (!Number.isFinite(megahertz) || megahertz <= 0) {
    return '–'
  }
  if (megahertz >= 1000) {
    return `${formatNumber(megahertz / 1000, 2)}${narrowSpace}GHz`
  }
  return `${formatNumber(megahertz, 0)}${narrowSpace}MHz`
}

export const formatInterval = (milliseconds: number) => {
  if (milliseconds < 1000) {
    return `${formatNumber(milliseconds)}${narrowSpace}ms`
  }
  const seconds = milliseconds / 1000
  return `${formatNumber(seconds, Number.isInteger(seconds) ? 0 : 1)}${narrowSpace}s`
}

/** countdown for retry buttons, like “12 s” */
export const formatRetry = (milliseconds: number) => `${Math.max(0, Math.ceil(milliseconds / 1000))}${narrowSpace}s`
