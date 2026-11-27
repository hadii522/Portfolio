import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, python, localEnv } from './local-config.mjs';
function run(command, args, cwd = root) {
  const r = spawnSync(command, args, { cwd, env: localEnv(), stdio: 'inherit', windowsHide: true });
  if (r.error) throw r.error;
  if (r.status) process.exit(r.status);
}
run(python, ['-m', 'ruff', 'check', 'backend/app', 'backend/tests']);
run(python, ['-m', 'ruff', 'format', '--check', 'backend/app', 'backend/tests']);
run(python, ['-m', 'pytest', 'backend/tests/unit', 'backend/tests/integration']);
const npmCli =
  process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
for (const script of ['type-check', 'lint', 'build'])
  run(process.execPath, [npmCli, 'run', script], path.join(root, 'frontend'));
if (process.argv.includes('--browser'))
  run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test']);
console.log('All requested checks passed.');
