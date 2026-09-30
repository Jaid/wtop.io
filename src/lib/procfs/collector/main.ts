import {chmodSync, rmSync} from 'node:fs'

import {Packr} from 'msgpackr/pack'

import {Sampler, signalProcess} from './sample.ts'

const protocol = 3
const socket = '/tmp/wtop.sock'
const packr = new Packr({useRecords: false, variableMapSize: true})
const configuration = JSON.parse(process.argv.at(-1) ?? '{}') as {action?: string, lifetime?: number}
if (configuration.action !== 'watch' || !Number.isSafeInteger(configuration.lifetime) || configuration.lifetime! < 10 || configuration.lifetime! > 86400) {
  throw new Error('Invalid collector configuration')
}
process.umask(0o077)
rmSync(socket, {force: true})
const sampler = new Sampler()
let lastRequest = performance.now()
const lifetime = configuration.lifetime! * 1000
let activeRequests = 0
const server = Bun.serve({
  unix: socket,
  maxRequestBodySize: 4096,
  async fetch(request) {
    if (request.method !== 'POST') { return new Response(null, {status: 405}) }
    let response: unknown
    try {
      const value = await request.json() as Record<string, unknown>
      if (!value || !['sample', 'signal'].includes(String(value.action))) { throw new Error('INVALID_ARGUMENT') }
      const argv = value.argv ?? 'full'
      if (value.action === 'sample' && !['full', 'censored', 'hidden'].includes(String(argv))) { throw new Error('INVALID_ARGUMENT') }
      lastRequest = performance.now()
      activeRequests++
      try {
        const started = performance.now()
        response = value.action === 'sample'
          ? {ok: true, protocol, snapshot: await sampler.sample(argv as 'full' | 'censored' | 'hidden'), collectionMs: performance.now() - started}
          : signalProcess(value)
      } finally {
        activeRequests--
        // A slow but active sample should not race the idle watchdog.
        lastRequest = performance.now()
      }
    } catch (error) {
      response = {ok: false, error: error instanceof Error && error.message === 'INVALID_ARGUMENT' ? 'INVALID_ARGUMENT' : 'COLLECTOR_FAILED'}
    }
    // The full, completed envelope is produced before writing any response bytes.
    // Gzip is an explicit wire layer, not HTTP Content-Encoding (Bun would decode it).
    return new Response(Bun.gzipSync(new Uint8Array(packr.pack(response)), {level: 1}), {headers: {'content-type': 'application/vnd.wtop.msgpack+gzip'}})
  },
})
chmodSync(socket, 0o600)
const stop = () => {
  clearInterval(watchdog)
  server.stop(true)
  rmSync(socket, {force: true})
}
const watchdog = setInterval(() => {
  if (activeRequests === 0 && performance.now() - lastRequest >= lifetime) { stop() }
}, 250)
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
