import {DockerClient, DockerError} from '#src/lib/docker/DockerClient.ts'
import {DockerSource} from '#src/lib/source/DockerSource.ts'

const baseUrl = Bun.env.WTOP_DOCKER_URL
if (!baseUrl) {
  throw new Error('Set WTOP_DOCKER_URL to an explicitly authorized Linux Docker endpoint.')
}
const bearer = Bun.env.WTOP_DOCKER_BEARER
const options = {
  baseUrl,
  bearer,
  image: 'oven/bun:1.4.2-distroless',
  lifetime: 10,
  argv: 'hidden' as const,
}
const first = new DockerSource(options)
const second = new DockerSource(options)
const inspector = new DockerClient({
  baseUrl,
  bearer,
  timeout: 3000,
})
let id: string | undefined
try {
  await Promise.all([first.connect(() => {}), second.connect(() => {})])
  id = first.agentContainerId
  if (!id || second.agentContainerId !== id) {
    throw new Error('Collector reuse failed.')
  }
  const a = await first.sample()
  const b = await second.sample()
  if (!a.snapshot.processes.length || !b.snapshot.processes.length) {
    throw new Error('The collector returned no processes.')
  }
  if (a.snapshot.processes.some(process => process.cmdline.length) || b.snapshot.processes.some(process => process.cmdline.length)) {
    throw new Error('Hidden arguments crossed the transport boundary.')
  }
  process.stdout.write(`${JSON.stringify({
    sharedCollector: true,
    samples: 2,
    cores: b.snapshot.cpus.length,
    processes: b.snapshot.processes.length,
    filesystems: b.snapshot.filesystems.length,
    privacy: 'hidden',
    clockTicks: b.snapshot.clockTicks,
  })}\n`)
} finally {
  first.dispose()
  second.dispose()
}
if (id) {
  let removed = false
  for (let attempt = 0; attempt < 40; attempt++) {
    await Bun.sleep(500)
    try {
      await inspector.json('GET', `/containers/${id}/json`)
    } catch (error) {
      if (error instanceof DockerError && error.status === 404) {
        removed = true; break
      }
      throw error
    }
  }
  if (!removed) {
    throw new Error('Collector was not auto-removed after its idle lease. Another matching client may be keeping it alive.')
  }
  process.stdout.write('Idle collector automatically removed.\n')
}
