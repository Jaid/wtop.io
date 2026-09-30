const cache = new Map<string, [number, number, number]>
let probe: CanvasRenderingContext2D | null | undefined
/**
 * Converts any CSS color (including oklch()) to sRGB bytes by letting the canvas parse it.
 */
const toRgb = (color: string): [number, number, number] => {
  const cached = cache.get(color)
  if (cached) {
    return cached
  }
  if (probe === undefined) {
    probe = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d', {willReadFrequently: true})
  }
  if (!probe) {
    return [128, 128, 128]
  }
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = '#808080'
  probe.fillStyle = color
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
  const rgb: [number, number, number] = [r, g, b]
  cache.set(color, rgb)
  return rgb
}

export const rgba = (color: string, alpha: number) => {
  const [r, g, b] = toRgb(color)
  return `rgb(${r} ${g} ${b} / ${alpha})`
}

/**
 * Traffic light color for a utilization between 0 and 100, as oklch so it works in CSS and canvas.
 */
export const loadColor = (percent: number, lightness = 78) => {
  const clamped = Math.min(100, Math.max(0, percent))
  // 150 (green) → 85 (yellow) → 25 (red)
  const hue = clamped < 60 ? 150 - clamped / 60 * 65 : 85 - (clamped - 60) / 40 * 60
  return `oklch(${lightness}% ${0.13 + clamped / 100 * 0.07} ${hue})`
}

export const temperatureColor = (celsius: number, lightness = 78) => loadColor((celsius - 35) / 55 * 100, lightness)
