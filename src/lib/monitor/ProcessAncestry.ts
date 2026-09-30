import type {ProcessRow} from './types.ts'

type ParentIdentity = {
  key: string
  name: string
  pid: number
}

type AncestryRecord = {
  currentParent?: ParentIdentity
  detachedEvidence: boolean
  formerParent?: ParentIdentity
  misses: number
  orphaned: boolean
}

/**
 * Tracks parent identities across samples.
 *
 * "orphan" means Wtop has evidence that a process lost or changed a non-init
 * parent. "detached" is deliberately narrower: Wtop first saw the process
 * essentially from birth already parented only by init and never observed a
 * different parent.
 */
export class ProcessAncestry {
  private readonly records = new Map<string, AncestryRecord>()

  clear() {
    this.records.clear()
  }

  observe(rows: ReadonlyArray<ProcessRow>, intervalSeconds: number): Array<ProcessRow> {
    const byPid = new Map(rows.map(row => [row.pid, row]))
    const currentKeys = new Set(rows.map(row => row.key))
    for (const [key, record] of this.records) {
      if (currentKeys.has(key)) {
        record.misses = 0
      } else if (++record.misses > 8) {
        this.records.delete(key)
      }
    }

    return rows.map(row => {
      if (row.pid <= 1 || row.isKernelThread) {
        return {
          ...row,
          detached: false,
          orphan: false,
          formerParent: undefined,
        }
      }

      const parentRow = row.ppid > 1 ? byPid.get(row.ppid) : undefined
      const parent = parentRow && parentRow.key !== row.key ? {
        key: parentRow.key,
        name: parentRow.name,
        pid: parentRow.pid,
      } satisfies ParentIdentity : undefined
      const parentless = row.ppid <= 1 || !parent
      let record = this.records.get(row.key)

      if (!record) {
        // A process younger than the interval was born after the preceding
        // sample. If it is already a direct child of init, Wtop has observed
        // its entire measurable lifetime without another parent.
        const bornDuringObservation = row.age <= Math.max(0.05, intervalSeconds * 1.1)
        record = {
          currentParent: parent,
          detachedEvidence: bornDuringObservation && row.ppid === 1,
          misses: 0,
          orphaned: false,
        }
        this.records.set(row.key, record)
      } else {
        const previousParent = record.currentParent
        if (previousParent && (!parent || parent.key !== previousParent.key)) {
          record.orphaned = true
          record.formerParent ??= previousParent
        }
        if (parent) {
          record.currentParent = parent
        } else {
          record.currentParent = undefined
        }
        if (record.orphaned) {
          record.detachedEvidence = false
        }
      }

      return {
        ...row,
        orphan: record.orphaned,
        detached: !record.orphaned && parentless && record.detachedEvidence,
        formerParent: record.orphaned && record.formerParent ? {
          name: record.formerParent.name,
          pid: record.formerParent.pid,
        } : undefined,
      }
    })
  }
}
