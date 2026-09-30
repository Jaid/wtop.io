import {dlopen, read as readPointer} from 'bun:ffi'
import {readFileSync} from 'node:fs'

/** Linux ELF auxiliary-vector values are independent of libc's sysconf enum. */
export const platformSizes = (auxiliary = readFileSync('/proc/self/auxv')) => {
  const values = new Map<number, number>()
  for (let offset = 0; offset + 16 <= auxiliary.length; offset += 16) {
    values.set(Number(auxiliary.readBigUInt64LE(offset)), Number(auxiliary.readBigUInt64LE(offset + 8)))
  }
  const clockTicks = values.get(17)
  const pageSize = values.get(6)
  if (!clockTicks || !pageSize) {
    throw new Error('Linux AT_CLKTCK and AT_PAGESZ are required.')
  }
  return {clockTicks, pageSize}
}

// The pinned distroless/slim images provide glibc. All calls have fixed C signatures.
// No compiler, shell, Python installation or additional executable is needed.
const openLibc = () => dlopen('libc.so.6', {
  pidfd_open: {args: ['i32', 'u32'], returns: 'i32'},
  pidfd_send_signal: {args: ['i32', 'i32', 'ptr', 'u32'], returns: 'i32'},
  close: {args: ['i32'], returns: 'i32'},
  __errno_location: {args: [], returns: 'ptr'},
})
let library: ReturnType<typeof openLibc> | undefined
const libc = () => (library ??= openLibc()).symbols

export const processHandle = (pid: number) => {
  const symbols = libc()
  const fd = symbols.pidfd_open(pid, 0)
  if (fd < 0) {
    const errno = readPointer.i32(symbols.__errno_location()!)
    throw new Error(errno === 3 ? 'PROCESS_NOT_FOUND' : errno === 1 || errno === 13 ? 'PERMISSION_DENIED' : 'SIGNAL_FAILED')
  }
  return {
    send(signal: number) {
      if (symbols.pidfd_send_signal(fd, signal, null, 0) < 0) {
        const errno = readPointer.i32(symbols.__errno_location()!)
        throw new Error(errno === 3 ? 'PROCESS_NOT_FOUND' : errno === 1 || errno === 13 ? 'PERMISSION_DENIED' : 'SIGNAL_FAILED')
      }
    },
    close() { symbols.close(fd) },
  }
}
