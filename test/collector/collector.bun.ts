import {afterEach, describe, expect, test} from 'bun:test'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {Packr, unpack} from 'msgpackr'

import {censorArgv} from '#src/lib/argv.ts'
import {platformSizes} from '#src/lib/procfs/collector/native.ts'
import {collectHardware, collectProcesses, filesystemEntries, hostPath, parseProcessStat, Sampler, signalProcess, unescapeMount} from '#src/lib/procfs/collector/sample.ts'
import {validateSnapshot} from '#src/lib/procfs/validate.ts'

const folders: Array<string> = []
const directory = () => {
  const path = mkdtempSync(join(tmpdir(), 'wtop-test-')); folders.push(path); return path
}
const file = (root: string, path: string, value: Uint8Array | string) => {
  const target = join(root, path); mkdirSync(join(target, '..'), {recursive: true}); writeFileSync(target, value)
}
afterEach(() => {
  for (const path of folders.splice(0)) {
    rmSync(path, {
      recursive: true,
      force: true,
    })
  }
})
const stat = (name = 'process', start = 42, flags = 0) => {
  const fields = Array.from({length: 50}, () => '0')
  fields[0] = 'S'; fields[1] = '1'; fields[6] = String(flags); fields[11] = '50'; fields[12] = '10'; fields[15] = '20'; fields[17] = '2'; fields[19] = String(start); fields[21] = '3'
  return `123 (${name}) ${fields.join(' ')}`
}
const processFixture = () => {
  const root = directory()
  file(root, '123/stat', stat())
  file(root, '123/status', 'Uid:\t1000\t1001\t1001\t1001\nVmRSS:\t128 kB\n')
  file(root, '123/io', 'read_bytes: 100\nwrite_bytes: 200\n')
  file(root, '123/cgroup', `0::/system.slice/docker-${'a'.repeat(64)}.scope\n`)
  file(root, '123/cmdline', 'node\0--token=secret\0-psecret\0--\0--position\0')
  return root
}
describe('Bun Linux collector', () => {
  test('reads platform clock and page size from ELF auxv', () => {
    const sizes = platformSizes(); expect(sizes.clockTicks).toBeGreaterThan(0); expect(sizes.pageSize).toBeGreaterThanOrEqual(4096)
  })
  test('rejects missing auxv fields rather than assuming constants', () => {
    expect(() => platformSizes(Buffer.alloc(32))).toThrow()
  })
  test('handles newlines, spaces and parentheses in comm', () => {
    const row = parseProcessStat(stat('tricky ) (name\nline'), 65_536)
    expect(row.comm).toBe('tricky ) (name\nline'); expect(row.rss).toBe(3 * 65_536); expect(row.ticks).toBe(60)
  })
  test('uses effective UID, current RSS and innermost cgroup', () => {
    const [row] = collectProcesses('full', 4096, processFixture())
    expect(row.uid).toBe(1001); expect(row.rss).toBe(128 * 1024); expect(row.containerId).toBe('a'.repeat(64)); expect(row.readBytes).toBe(100); expect(row.writeBytes).toBe(200)
  })
  test('hidden mode does not require or open command-line files', () => {
    const root = processFixture(); rmSync(join(root, '123/cmdline')); mkdirSync(join(root, '123/cmdline'))
    const [row] = collectProcesses('hidden', 4096, root); expect(row.cmdline).toEqual([]); expect(row.pid).toBe(123)
  })
  test('censors before serialization, including fused values and positional flags', () => {
    const [row] = collectProcesses('censored', 4096, processFixture()); const text = JSON.stringify(row.cmdline)
    expect(text).not.toContain('secret'); expect(text).not.toContain('position'); expect(text).toContain('--token=')
  })
  test('kernel identity does not depend on argv visibility', () => {
    const root = processFixture(); file(root, '123/stat', stat('kworker', 42, 0x20_00_00))
    expect(collectProcesses('hidden', 4096, root)[0].isKernelThread).toBe(true)
  })
  test('missing process files are tolerated', () => {
    const root = processFixture(); rmSync(join(root, '123/stat')); expect(collectProcesses('full', 4096, root)).toEqual([])
  })
  test('resolves absolute and relative host symlinks under the host root', () => {
    const root = directory(); file(root, 'store/passwd', 'hostuser'); mkdirSync(join(root, 'etc')); symlinkSync('/store/passwd', join(root, 'etc/passwd'))
    expect(readFileSync(hostPath(root, '/etc/passwd'), 'utf8')).toBe('hostuser')
  })
  test('bounds symlink cycles', () => {
    const root = directory(); symlinkSync('/a', join(root, 'a')); expect(() => hostPath(root, '/a')).toThrow('loop')
  })
  test('decodes escaped mounts and excludes network filesystems', () => {
    expect(unescapeMount(String.raw`/data\040disk`)).toBe('/data disk')
    const entries = filesystemEntries('1 0 8:1 / / rw - ext4 /dev/sda1 rw\n2 0 0:2 / /remote rw - nfs host:/ remote\n3 0 8:1 / /bind rw - ext4 /dev/sda1 rw', directory())
    expect(entries).toHaveLength(1); expect(entries[0].mount).toBe('/')
  })
  test('equal counters do not merge distinct GPUs; suspended GPUs remain visible', () => {
    const root = directory()
    for (const index of [0, 1]) {
      file(root, `devices/gpu${index}/power/runtime_status`, index ? 'suspended' : 'active')
      file(root, `devices/gpu${index}/gpu_busy_percent`, '0')
      mkdirSync(join(root, `class/drm/card${index}`), {recursive: true})
      symlinkSync(join(root, `devices/gpu${index}`), join(root, `class/drm/card${index}/device`))
    }
    const {gpus} = collectHardware(root); expect(gpus).toHaveLength(2); expect(gpus[1].state).toBe('suspended'); expect(gpus[1].busy).toBeUndefined()
  })
  test('samples real Linux without shell utilities or Python', async () => {
    const snapshot = await (new Sampler).sample('hidden')
    expect(validateSnapshot(snapshot)).toBe(snapshot); expect(snapshot.cpus.length).toBeGreaterThan(0); expect(snapshot.processes.length).toBeGreaterThan(0)
    expect(snapshot.processes.every(row => row.cmdline.length === 0)).toBe(true)
    expect(snapshot.clockTicks).toBe(platformSizes().clockTicks)
  })
  test('MessagePack plus gzip retains exact counters and Unicode', () => {
    const packer = new Packr({
      useRecords: false,
      variableMapSize: true,
    })
    const value = {
      counter: Number.MAX_SAFE_INTEGER,
      label: '℃ • Grüß',
      argv: censorArgv(['bun', '--token=private']),
    }
    expect(unpack(Bun.gunzipSync(Bun.gzipSync(new Uint8Array(packer.pack(value)))))).toEqual(value)
  })
  test('rejects invalid and protected PIDs', () => {
    expect(signalProcess({
      pid: 1,
      startTicks: 0,
      signal: 'TERM',
    }).ok).toBe(false)
    expect(signalProcess({
      pid: process.pid,
      startTicks: 0,
      signal: 'TERM',
    }).error).toBe('PROTECTED_PROCESS')
    expect(signalProcess({
      pid: 123,
      startTicks: 0,
      signal: 'EVIL',
    }).error).toBe('INVALID_ARGUMENT')
  })
  test('pidfd refuses stale identity and signals only a disposable child', async () => {
    const child = Bun.spawn([process.execPath, '--eval', 'setInterval(()=>{},1000)'], {
      stdout: 'ignore',
      stderr: 'ignore',
    })
    try {
      const row = parseProcessStat(readFileSync(`/proc/${child.pid}/stat`, 'utf8'), 4096)
      expect(signalProcess({
        pid: child.pid,
        startTicks: row.startTicks + 1,
        signal: 'TERM',
      }, false).error).toBe('STALE_PROCESS')
      expect(signalProcess({
        pid: child.pid,
        startTicks: row.startTicks,
        signal: 'TERM',
      }, false).ok).toBe(true)
      await child.exited
    } finally {
      child.kill()
    }
  })
})
