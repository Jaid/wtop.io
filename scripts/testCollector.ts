// Stream a self-contained test bundle: works with local and SSH Docker daemons.
const result = await Bun.build({
  entrypoints: ['./test/collector/collector.bun.ts'],
  target: 'bun',
  external: ['bun:test'],
  minify: false,
})
if (!result.success) {
  throw new AggregateError(result.logs, 'Collector test bundling failed.')
}
const bundle = await result.outputs[0].text()
const bootstrap = 'await Bun.write(\'/tmp/collector.test.js\', await Bun.stdin.text()); const child=Bun.spawn([process.execPath,\'test\',\'/tmp/collector.test.js\'],{stdout:\'inherit\',stderr:\'inherit\'});process.exitCode=await child.exited;'
const child = Bun.spawn(['docker', 'run', '--rm', '--interactive', '--network', 'none', '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--entrypoint', 'bun', 'oven/bun:1.4.2-distroless', '--eval', bootstrap], {
  stdin: new Blob([bundle]),
  stdout: 'inherit',
  stderr: 'inherit',
})
process.exitCode = await child.exited
