import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const data = path.join(root, 'data');
fs.mkdirSync(path.join(data, 'logs'), { recursive: true });
const secretsPath = path.join(data, 'local-secrets.json');
if (!fs.existsSync(secretsPath)) {
  try {
    fs.writeFileSync(
      secretsPath,
      JSON.stringify({
        pgPassword: randomBytes(32).toString('base64url'),
        apiToken: randomBytes(48).toString('base64url'),
        pgPort: 5433,
      }),
      { flag: 'wx', mode: 0o600 },
    );
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}
export const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
export const python = path.join(
  root,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
export function localEnv() {
  const p = path.join(root, '.env.local');
  const entries = fs.existsSync(p)
    ? fs
        .readFileSync(p, 'utf8')
        .split(/\r?\n/)
        .filter((l) => /^\w+=/.test(l))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
        })
    : [];
  return {
    ...Object.fromEntries(entries),
    ...process.env,
    PYTHONPATH: path.join(root, 'backend'),
    PYTHONUNBUFFERED: '1',
    OMP_NUM_THREADS: '2',
    OPENBLAS_NUM_THREADS: '2',
  };
}
