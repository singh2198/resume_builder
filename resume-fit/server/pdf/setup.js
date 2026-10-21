import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error(
      result.error?.message || 'PDF engine setup failed. Install Python 3.10+ and retry.',
    );
    process.exit(1);
  }
}
run(process.env.PDF_PYTHON || 'python3', ['-m', 'venv', '.venv']);
run(path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), [
  '-m',
  'pip',
  'install',
  '-r',
  'server/pdf/requirements.txt',
]);
