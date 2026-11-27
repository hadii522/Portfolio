import fs from 'node:fs';
import path from 'node:path';
import { data } from './local-config.mjs';
const file = path.join(data, 'runtime.json');
if (!fs.existsSync(file)) {
  console.log('No supervised application run is recorded.');
  process.exitCode = 1;
} else {
  const runtime = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!runtime.runId) throw new Error('This run predates supervised shutdown. Stop it with Ctrl+C.');
  fs.writeFileSync(path.join(data, 'runtime', `${runtime.runId}.stop`), 'stop');
  console.log('Shutdown requested. The services will finish their current step and preserve stored data.');
}
