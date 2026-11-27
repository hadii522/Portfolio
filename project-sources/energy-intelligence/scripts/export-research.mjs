import fs from 'node:fs';
import path from 'node:path';
import { root } from './local-config.mjs';
const run = await (await fetch('http://127.0.0.1:8000/api/v1/forecasts/latest')).json();
if (!run.available) throw new Error('No completed forecast run to export');
const { test_points, ...metadata } = run.metadata;
fs.writeFileSync(
  path.join(root, 'docs/EVALUATION_RESULTS.json'),
  JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      model: run.model,
      run_id: run.id,
      created_at: run.created_at,
      cutoff: run.cutoff,
      ...metadata,
    },
    null,
    2,
  ) + '\n',
);
console.log('Recorded the measured model card in docs/EVALUATION_RESULTS.json.');
