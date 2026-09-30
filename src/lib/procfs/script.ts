import type {ArgvMode} from '#src/lib/argv.ts'

import {collectorSource} from './collectorSource.ts'

export const heartbeatFile = '/tmp/wtop.sock'
export const signals = ['TERM', 'KILL', 'INT', 'HUP', 'STOP', 'CONT', 'USR1', 'USR2'] as const
export type Signal = typeof signals[number]
export const signalDescriptions: Record<Signal, string> = {
  TERM: 'ask the process to terminate gracefully',
  KILL: 'terminate immediately, cannot be caught',
  INT: 'interrupt, like pressing Ctrl+C',
  HUP: 'hang up, many daemons reload their configuration',
  STOP: 'pause execution, cannot be caught',
  CONT: 'resume a paused process',
  USR1: 'user-defined signal 1',
  USR2: 'user-defined signal 2',
}
export const isSignal = (value: unknown): value is Signal => typeof value === 'string' && (signals as ReadonlyArray<string>).includes(value)

type CollectorRequest = {
  action: 'sample'
  argv: ArgvMode
} | {
  action: 'signal'
  pid: number
  signal: Signal
  startTicks: number
} | {
  action: 'watch'
  lifetime: number
}

const client = `try {
  const response = await fetch('http://localhost/', {unix: '/tmp/wtop.sock', method: 'POST', body: process.argv.at(-1), signal: AbortSignal.timeout(25000)});
  if (!response.ok) throw new Error();
  await Bun.write(Bun.stdout, new Uint8Array(await response.arrayBuffer()));
} catch { process.stderr.write('WTOP_NOT_READY'); process.exitCode = 1; }`

/** Only startup carries the bundle. Samples use a tiny Unix-socket client. */
export const collectorCommand = (request: CollectorRequest): Array<string> => ['bun', '--smol', '--eval', request.action === 'watch' ? collectorSource : client, JSON.stringify(request)]
