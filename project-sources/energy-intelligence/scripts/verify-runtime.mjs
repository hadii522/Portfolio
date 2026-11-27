import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root } from './local-config.mjs';
const base='http://127.0.0.1:8000/api/v1';
async function get(route){const r=await fetch(base+route);assert.equal(r.status,200,`${route}: HTTP ${r.status}`);return r.json()}
let previous='';let jobs;
for(let i=0;i<600;i++){
  jobs=await get('/jobs');
  const active=jobs.filter(j=>['queued','running'].includes(j.status));
  if(!active.length)break;
  const running=active.find(j=>j.status==='running')||active[0];
  const message=`${running.kind}: ${running.progress}% · ${running.message}`;
  if(message!==previous){console.log(message);previous=message}
  if(i===599)throw new Error('Operations did not finish within the verification window');
  await new Promise(resolve=>setTimeout(resolve,2000));
}
const health=await get('/health');assert.equal(health.database,'connected');assert.equal(health.worker,'running');
const overview=await get('/overview');assert.equal(overview.data_mode,'real');assert.ok(overview.inventory.length>=10);
const forecast=await get('/forecasts/latest');assert.ok(forecast.available);assert.equal(forecast.points.length,48);
for(const fold of forecast.metadata.folds){assert.ok(new Date(fold.train_end)<new Date(fold.calibration_start));assert.ok(new Date(fold.calibration_start)<new Date(fold.origin));}
assert.ok(new Date(forecast.metadata.validation_start)<new Date(forecast.metadata.test_start));
for(const scores of Object.values(forecast.metadata.test_scores)){assert.ok(scores.n>=300);assert.ok(Number.isFinite(scores.rmse));}
const series=await get('/series?metric=demand&days=2');assert.ok(series.points.length>50);
const archive=await fetch(base+'/archive?path='+encodeURIComponent(series.points.at(-1).archive));assert.equal(archive.status,200);
assert.equal((await fetch(base+'/archive?path=local-secrets.json')).status,404);
const reports=await get('/reports');assert.ok(reports.length>0);assert.equal(reports[0].payload.validation.status,'verified');
const quality=await get('/quality');
let llmVerification={status:'not_requested'};
if(process.argv.includes('--llm')){
  const settings=await get('/settings');
  if(settings.llm_configured){
    const {token}=await get('/session');
    const response=await fetch(base+'/jobs',{method:'POST',headers:{'Content-Type':'application/json','X-ETIP-Token':token},body:JSON.stringify({kind:'report',use_llm:true})});
    assert.equal(response.status,202);const submitted=await response.json();
    for(let i=0;i<60;i++){const job=(await get('/jobs')).find(j=>j.id===submitted.id);if(!['queued','running'].includes(job.status)){llmVerification={status:job.status,message:job.message,result:job.result};break}await new Promise(resolve=>setTimeout(resolve,2000))}
  }else llmVerification={status:'not_configured'};
}
const result={verified_at:new Date().toISOString(),health,observed_points:quality.total_observations,stored_vintages:quality.total_vintages,weather_vintages:quality.weather_vintages,model:forecast.model,run_id:forecast.id,test_scores:forecast.metadata.test_scores,weather_coverage:forecast.metadata.weather_coverage,latest_operations:jobs.slice(0,8).map(({kind,status,result})=>({kind,status,result})),llmVerification};
fs.mkdirSync(path.join(root,'work'),{recursive:true});fs.writeFileSync(path.join(root,'work/runtime-verification.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({observed_points:result.observed_points,weather_vintages:result.weather_vintages,model:result.model,llm:llmVerification.status},null,2));
