import { spawn, fork } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { root, python, data, localEnv } from './local-config.mjs';

const children = [];
let database;
let stopping = false;
const runId = randomUUID();
fs.mkdirSync(path.join(data, 'runtime'), { recursive: true });
const stopFile = path.join(data, 'runtime', `${runId}.stop`);
let stopMonitor;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(stopMonitor);
  fs.writeFileSync(stopFile, 'stop');
  // Python services observe this run-specific marker and close their own resources.
  const pythonChildren = children.filter((child) => child.etipPython);
  const waits = pythonChildren.map(
    (child) =>
      new Promise((resolve) => {
        if (child.exitCode !== null) resolve();
        else child.once('exit', resolve);
      }),
  );
  await Promise.race([Promise.all(waits), new Promise((resolve) => setTimeout(resolve, 15000))]);
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (process.platform === 'win32')
      await new Promise((resolve) => {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.once('exit', resolve);
        killer.once('error', resolve);
      });
    else child.kill('SIGTERM');
  }
  if (database?.connected) {
    database.send('stop');
    await new Promise((resolve) => {
      database.once('exit', resolve);
      setTimeout(resolve, 8000);
    });
  }
  process.exit(code);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
function launch(command, args, cwd = root) {
  const child = spawn(command, args, {
    cwd,
    env: { ...localEnv(), ETIP_RUN_ID: runId },
    stdio: 'inherit',
    windowsHide: true,
  });
  child.etipPython = command === python;
  children.push(child);
  child.on('error', (error) => {
    console.error(error.message);
    void stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`A service stopped (${code}).`);
      void stop(code || 1);
    }
  });
  return child;
}
try {
  if (!fs.existsSync(python)) throw new Error('Run npm run setup first to create the Python environment.');
  if (!localEnv().ETIP_DATABASE_URL) {
    database = fork(path.join(root, 'scripts/database.mjs'), [], {
      cwd: root,
      env: localEnv(),
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      database.once('message', resolve);
      database.once('exit', (code) =>
        reject(new Error(`Database exited (${code}); see data/logs/postgres.log`)),
      );
      setTimeout(() => reject(new Error('Database startup timed out.')), 60000).unref();
    });
  }
  const init = spawn(python, ['-m', 'app.cli', 'init'], {
    cwd: root,
    env: localEnv(),
    stdio: 'inherit',
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    init.once('error', reject);
    init.once('exit', (code) => (code ? reject(new Error('Database migration failed')) : resolve()));
  });
  launch(python, ['-m', 'app.server']);
  launch(python, ['-m', 'app.worker']);
  const next = path.join(root, 'frontend/node_modules/next/dist/bin/next');
  launch(
    process.execPath,
    [
      next,
      fs.existsSync(path.join(root, 'frontend/.next/BUILD_ID')) ? 'start' : 'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3000',
    ],
    path.join(root, 'frontend'),
  );
  fs.writeFileSync(
    path.join(data, 'runtime.json'),
    JSON.stringify({ started: new Date().toISOString(), pid: process.pid, runId }),
  );
  stopMonitor = setInterval(() => {
    if (fs.existsSync(stopFile)) void stop();
  }, 500);
  console.log(
    '\nETIP: http://127.0.0.1:3000  |  API: http://127.0.0.1:8000/docs\nCtrl+C stops the services. Stored data is preserved.\n',
  );
} catch (error) {
  console.error(error.message);
  await stop(1);
}
