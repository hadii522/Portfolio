import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { root, python } from './local-config.mjs';
function run(command, args, cwd = root) {
  const r = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true, shell: false });
  if (r.error) throw r.error;
  if (r.status) process.exit(r.status);
}
if (!fs.existsSync(python)) {
  const candidates = [process.env.ETIP_PYTHON, 'python', 'python3', 'py'].filter(Boolean);
  const found = candidates.find((p) => {
    try {
      return (
        spawnSync(p, ['-c', 'import sys;assert sys.version_info>=(3,12)'], {
          stdio: 'ignore',
          windowsHide: true,
        }).status === 0
      );
    } catch {
      return false;
    }
  });
  if (!found)
    throw new Error('Install Python 3.12+ or set ETIP_PYTHON to its executable, then rerun npm run setup.');
  run(found, ['-m', 'venv', '.venv']);
}
run(python, ['-m', 'pip', 'install', '-r', 'backend/requirements.lock.txt']);
run(python, ['-m', 'pip', 'install', '--no-deps', '-e', './backend[dev]']);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// npm's Windows launcher requires cmd; keep the fixed package command separate from any user input.
if (process.platform === 'win32')
  run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ci --no-fund'], path.join(root, 'frontend'));
else run(npm, ['ci', '--no-fund'], path.join(root, 'frontend'));
console.log('Setup complete. Run npm start.');
