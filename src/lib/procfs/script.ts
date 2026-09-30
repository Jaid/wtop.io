import type {ArgvMode} from '#src/lib/argv.ts'

import {collectorSource} from './collectorSource.ts'

export const heartbeatFile = '/tmp/wtop-heartbeat'
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

/** Data is passed as a literal argument, never interpolated into executable code. */
export const collectorCommand = (request: CollectorRequest): Array<string> => ['python3', '-I', '-c', collectorSource, JSON.stringify(request)]
