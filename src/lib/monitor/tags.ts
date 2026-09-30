import type {ProcessRow} from './types.ts'

export const hasProcessTag = (row: ProcessRow, tag: string): boolean => {
  switch (tag.toLowerCase()) {
    case 'heavy': { return Boolean(row.heavy) }
    case 'container': { return Boolean(row.container) }
    case 'orphan': { return Boolean(row.orphan) }
    case 'kernel': { return row.isKernelThread }
    case 'self': { return row.isAgent }
    default: { return false }
  }
}

/** Product of whole-machine CPU share and RAM share, scaled to a 0–100 score. */
export const processWeight = (cpu: number, memoryPercent: number, cores: number) => {
  if (!Number.isFinite(cpu) || !Number.isFinite(memoryPercent) || cores <= 0) {
    return 0
  }
  return Math.min(100, Math.max(0, cpu / cores)) * Math.min(100, Math.max(0, memoryPercent)) / 100
}
