import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { data, secrets } from './local-config.mjs';

const directory = path.join(data, 'postgres');
const logfile = path.join(data, 'logs/postgres.log');
const platform = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
const binaries = await import(`@embedded-postgres/${platform}-${process.arch}`);
let ownsServer = false,
  stopping = false,
  keepAlive;
const client = () =>
  new Client({
    host: '127.0.0.1',
    port: secrets.pgPort,
    user: 'etip',
    password: secrets.pgPassword,
    database: 'postgres',
    connectionTimeoutMillis: 3000,
  });
function command(args) {
  return new Promise((resolve, reject) => {
    const process = spawn(binaries.pg_ctl, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    process.stdout.on('data', (b) => (output += b));
    process.stderr.on('data', (b) => (output += b));
    process.on('error', reject);
    process.on('exit', (code) => {
      process.stdout.destroy();
      process.stderr.destroy();
      code
        ? reject(new Error(output.trim() || 'PostgreSQL command failed; see data/logs/postgres.log'))
        : resolve();
    });
  });
}
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(keepAlive);
  try {
    if (ownsServer) await command(['-D', directory, '-m', 'fast', '-w', '-t', '30', 'stop']);
  } catch (error) {
    console.error('Database shutdown:', error.message);
    process.exitCode = 1;
  }
  if (process.connected) process.disconnect();
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
process.on('message', (message) => {
  if (message === 'stop') void stop();
});
process.on('disconnect', () => void stop());
try {
  if (!fs.existsSync(path.join(directory, 'PG_VERSION'))) {
    const initializer = new EmbeddedPostgres({
      databaseDir: directory,
      user: 'etip',
      password: secrets.pgPassword,
      port: secrets.pgPort,
      persistent: true,
      authMethod: 'scram-sha-256',
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
      onLog: (message) => fs.appendFileSync(logfile, `${message}\n`),
      onError: (message) => fs.appendFileSync(logfile, `${message}\n`),
    });
    await initializer.initialise();
  }
  let running = false;
  const probe = client();
  try {
    await probe.connect();
    const r = await probe.query('SHOW data_directory');
    if (path.resolve(r.rows[0].data_directory).toLowerCase() !== directory.toLowerCase())
      throw new Error('Another PostgreSQL cluster is using this port');
    running = true;
  } catch (error) {
    if (error.message === 'Another PostgreSQL cluster is using this port') throw error;
  } finally {
    await probe.end().catch(() => {});
  }
  if (!running) {
    await command([
      '-D',
      directory,
      '-l',
      logfile,
      '-w',
      '-t',
      '30',
      '-o',
      `-h 127.0.0.1 -p ${Number(secrets.pgPort)} -c shared_buffers=64MB -c max_connections=50 -c timezone=UTC`,
      'start',
    ]);
    ownsServer = true;
  }
  const connection = client();
  await connection.connect();
  if (!(await connection.query("SELECT 1 FROM pg_database WHERE datname='etip'")).rowCount)
    await connection.query('CREATE DATABASE etip');
  await connection.end();
  console.log(
    `PostgreSQL ready on 127.0.0.1:${secrets.pgPort}; ${running ? 'reusing existing cluster' : 'started persistent local cluster'}.`,
  );
  keepAlive = setInterval(() => {}, 3600000);
  if (process.send) process.send('ready');
} catch (error) {
  console.error('Database startup failed:', error?.message || 'See data/logs/postgres.log');
  process.exitCode = 1;
  await stop();
}
