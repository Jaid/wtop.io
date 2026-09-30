// Separate processes prevent DOM globals from changing network and timer semantics.
for (const script of ['test:unit', 'test:dom']) {
  const child = Bun.spawn([process.execPath, 'run', script], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await child.exited
  if (code !== 0) {
    process.exit(code)
  }
}
