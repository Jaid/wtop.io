import {readFile} from 'fs-extra'

// Stream fixture files instead of bind-mounting: this also works with SSH Docker daemons.
const files: Record<string, string> = {}
for (const path of ['src/lib/procfs/collector.py', 'test/collector/test_collector.py']) {
  files[path] = await readFile(path, 'utf8')
}
const bootstrap = [
  'import json,os,pathlib,subprocess,sys,tempfile',
  'payload=json.load(sys.stdin)',
  'with tempfile.TemporaryDirectory() as directory:',
  ' for name,content in payload.items():',
  '  path=pathlib.Path(directory,name); path.parent.mkdir(parents=True,exist_ok=True); path.write_text(content,encoding="utf8")',
  ' result=subprocess.run([sys.executable,"-m","unittest","discover","-s","test/collector","-v"],cwd=directory)',
  ' sys.exit(result.returncode)',
].join('\n')
const child = Bun.spawn(['docker', 'run', '--rm', '--interactive', '--network', 'none', '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--env', 'PYTHONDONTWRITEBYTECODE=1', 'python:3.14-alpine', 'python', '-I', '-c', bootstrap], {
  stdin: new Blob([JSON.stringify(files)]),
  stdout: 'inherit',
  stderr: 'inherit',
})
process.exitCode = await child.exited
