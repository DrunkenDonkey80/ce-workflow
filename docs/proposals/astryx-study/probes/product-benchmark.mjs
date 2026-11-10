// Product-wired C10: production design start, real hub Pi, production guides/tools and agent_end snapshots.
// Usage: node docs/proposals/astryx-study/probes/product-benchmark.mjs --root DIR --label prechange-html --run
// All paid runs share ROOT/budget.json. Never put ROOT in this study archive. No automatic retries.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {runDesign} from "../../../../extensions/design.ts";
import {readConfig, markerPath} from "../../../../hub/src/hub.ts";
import {withPlanLock} from "../../../../extensions/plan3-files.ts";

export function aggregate(files) {
 const seen=new Set(), total={sessions:files.length,turns:0,toolCalls:0,input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:0,missingUsage:0,missingCost:0,models:{},compactions:0,errors:[]};
 const add=usage=>{for(const k of ["input","output","cacheRead","cacheWrite","totalTokens"])total[k]+=usage?.[k]??0; total.cost+=usage?.cost?.total??0;};
 for(const [file,rows] of files)for(const [index,e] of rows.entries()) {
  const key=e.id??`${file}:${index}`; if(seen.has(key))continue; seen.add(key);
  if(e.type==="message"&&e.message?.role==="assistant") {
   const m=e.message; total.turns++; total.toolCalls+=(m.content??[]).filter(c=>c.type==="toolCall").length; add(m.usage);
   if(!m.usage)total.missingUsage++; if(!Number.isFinite(m.usage?.cost?.total))total.missingCost++;
   const model=m.provider+"/"+m.model;total.models[model]=(total.models[model]??0)+1;
   if(m.stopReason==="error"||m.stopReason==="aborted")total.errors.push(m.errorMessage??m.stopReason);
  }
  if(e.type==="compaction") {total.compactions++; if(e.usage)add(e.usage);}
  for(const attempt of e.details?.compactionAttempts??[])if(attempt.usage)add(attempt.usage);
 }
 return total;
}
function readJson(text) { try { return JSON.parse(text); } catch(error) { throw new Error("Malformed benchmark input: "+error.message); } }
const readRows=file=>fs.readFileSync(file,"utf8").split("\n").filter(Boolean).map(readJson);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main() {
 if(process.argv.includes("--self-check")) {
  const u={input:1,output:2,cacheRead:3,cacheWrite:4,totalTokens:10,cost:{total:0.2}},m={id:"one",type:"message",message:{role:"assistant",provider:"test",model:"model",usage:u,content:[{type:"toolCall"}]}};
  const r=aggregate([["a",[m]],["b",[m,{id:"two",type:"compaction",usage:u},{id:"three",details:{compactionAttempts:[{usage:u}]}}]]]);
  assert.deepEqual([r.turns,r.toolCalls,r.compactions,r.totalTokens,r.missingUsage],[1,1,1,30,0]); assert.ok(Math.abs(r.cost-0.6)<0.00001);
  assert.equal(aggregate([["c",[{type:"message",message:{role:"assistant"}}]]]).missingUsage,1);
  console.log("ok - deduplicated continuation accounting, compaction attempts and missing usage");return;
 }
 const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
 const rootArg=option("--root"),label=option("--label"),arm=option("--arm","html");
 assert.ok(rootArg&&label&&/^[a-z0-9-]+$/.test(label),"Give --root and a unique --label");
 assert.ok(["html","astryx"].includes(arm));
 const root=path.resolve(rootArg),repo=path.resolve(import.meta.dirname,"../../../.."),dir=path.join(root,label),project=path.join(dir,"project");
 assert.ok(!root.startsWith(path.resolve(import.meta.dirname,"..")+path.sep),"Use a scratch output root, not the archive");
 assert.ok(!fs.existsSync(dir),"Refuse to overwrite a previous run; inspect failed runs rather than retrying automatically");
 fs.mkdirSync(project,{recursive:true}); fs.mkdirSync(path.join(project,".pi"));
 const settings={workOrchestrator:{designModel:"anthropic/claude-opus-5-5:high",context:{mode:"ultrafull"}},compaction:{enabled:true}};
 fs.writeFileSync(path.join(project,".pi/settings.json"),JSON.stringify(settings,null,2));
 fs.writeFileSync(path.join(project,"package.json"),'{"private":true,"type":"module"}\n');
 const study=path.resolve(import.meta.dirname,".."),brief=fs.readFileSync(path.join(study,"brief.md"),"utf8"),refine=fs.readFileSync(path.join(study,"refinement.md"),"utf8");
 const translation="\n\nProduct benchmark mapping (applies identically to both product arms): the historical fixture brief above names public/ and supplied craft/check files. In this real design session, deliver directly in your own .pi/designs/<handle>/ instead; craft guides are supplied by the production session. Use the existing design look action and read its returned images instead of ../look.mjs; write CHECKS.md inside your design folder. Source/build handling follows the selected production foundation. The content, behavior, fixed data, stable IDs and requested refinement are unchanged. No delegation, external research, commits, package installation or files outside your own design folder. Do not wait for user input. Stop on tool/setup failure.";
 const manifest={label,arm,repoHead:execFileSync("git",["rev-parse","HEAD"],{cwd:repo,encoding:"utf8"}).trim(),dirty:execFileSync("git",["status","--short"],{cwd:repo,encoding:"utf8"}),model:settings.workOrchestrator.designModel,compaction:"ultrafull",translation,project,startedAt:new Date().toISOString(),sessions:[],stages:[],state:"prepared"};
 const save=()=>fs.writeFileSync(path.join(dir,"result.json"),JSON.stringify(manifest,null,2)+"\n");save();
 for(const f of ["design.ts","design-guide.md","design-guide.UPSTREAM.md"])fs.copyFileSync(path.join(repo,"extensions",f),path.join(dir,f));
 fs.copyFileSync(path.join(repo,"skills/frontend-design/SKILL.md"),path.join(dir,"frontend-design.md"));
 if(!process.argv.includes("--run")){console.log("Prepared only (no provider calls): "+dir);return;}
 const config=readConfig(),marker=readJson(fs.readFileSync(markerPath(),"utf8"));assert.ok(config&&marker.port===config.port,"Real hub must already be running");
 const call=async(route,body)=>{const res=await fetch(`http://127.0.0.1:${marker.port}${route}`,{method:body===undefined?"GET":"POST",headers:{"x-hub-key":config.localKey,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});const value=await res.json();if(!res.ok)throw new Error(value.error??`HTTP ${res.status}`);return value;};
 const budgetFile=path.join(root,"budget.json");
 // One benchmark process owns this shared budget through completion; concurrent invocations fail before generation.
 await withPlanLock(budgetFile,async()=>{
  const budget=fs.existsSync(budgetFile)?readJson(fs.readFileSync(budgetFile,"utf8")):{limit:40,runs:[]};
  assert.equal(budget.limit,40,"D15 approved $40; changing it needs user approval");
  assert.ok(budget.runs.every(r=>r.finished),"Previous run unfinished: reconcile its actual usage before spending again");
  const previous=budget.runs.reduce((n,r)=>n+r.cost,0);assert.ok(previous<budget.limit,"Approved benchmark budget exhausted");
  const entry={label,cost:0,finished:false};budget.runs.push(entry);const saveBudget=()=>fs.writeFileSync(budgetFile,JSON.stringify(budget,null,2)+"\n");saveBudget();
  let id;
  const usage=async()=>{
   const s=(await call("/api/status")).sessions.find(s=>s.id===id);assert.ok(s,"Benchmark session disappeared");
   if(s.sessionFile&&!manifest.sessions.includes(s.sessionFile))manifest.sessions.push(s.sessionFile);
   manifest.metrics=aggregate(manifest.sessions.map(f=>[f,readRows(f)]));entry.cost=manifest.metrics.cost;saveBudget();save();return s;
  };
  const wait=async()=>{const deadline=Date.now()+30*60000;while(Date.now()<deadline){await pause(1500);const s=await usage();if(previous+entry.cost>=budget.limit){await call(`/s/${id}/api/stop`,{});throw new Error("Approved budget reached; stopped benchmark");}if(s.busy.some(x=>/answer|question|dialog|confirm/i.test(x)))throw new Error("Benchmark requires an unexpected user answer");if(manifest.metrics.turns&&!s.busy.length){assert.equal(manifest.metrics.errors.length,0,"Provider failure or abort; no automatic retry");return;}if(!s.live)throw new Error("Benchmark Pi exited before completion");}throw new Error("Benchmark exceeded 30-minute stage deadline");};
  try {
   // Production start owns prompt creation and the real hub session, not a hand-built worker prompt.
   const started=await runDesign(project,{action:"start",kind:"app",title:"Relay dashboard",brief:brief+translation,directions:["Calm, legible professional workspace with one deliberate visual signature"],names:["Relay "+arm],...(arm==="astryx"?{system:"astryx"}:{})});
   const item=started.sessions[0];id=item.hubSessionId;manifest.handle=item.handle;manifest.hubSessionId=id;assert.ok(id&&!item.hubError,item.hubError??"No hub session");manifest.state="running";save();
   let began=Date.now();await wait();manifest.stages.push({name:"initial",elapsedMs:Date.now()-began,metrics:manifest.metrics});save();
   const folder=path.join(project,".pi/designs",item.handle);assert.ok(fs.existsSync(path.join(folder,"index.html")),"Initial design did not produce index.html");
   fs.cpSync(folder,path.join(dir,"initial"),{recursive:true});
   // Reset turn count detection: the next prompt must actually add an assistant before idle counts.
   const before=manifest.metrics.turns;began=Date.now();await call(`/api/sessions/${id}/prompt`,{message:refine+translation});
   while(manifest.metrics.turns<=before){await pause(1500);await usage();if(Date.now()-began>120000)throw new Error("Refinement did not start");}
   await wait();manifest.stages.push({name:"refinement",elapsedMs:Date.now()-began,metrics:manifest.metrics});
   const rows=manifest.sessions.flatMap(readRows),tools=[...new Set(rows.flatMap(e=>e.message?.role==="assistant"?(e.message.content??[]).filter(c=>c.type==="toolCall").map(c=>c.name):[]))];
   manifest.toolsUsed=tools;assert.ok(Object.keys(manifest.metrics.models).every(m=>m==="anthropic/claude-opus-5-5"),"Frozen model mismatch");
   assert.equal(manifest.metrics.missingUsage,0);assert.equal(manifest.metrics.missingCost,0);
   assert.ok(fs.existsSync(path.join(folder,"settings.html")),"No settings screen");
   manifest.versions=await runDesign(project,{action:"show",handle:item.handle});manifest.state="complete";
  } catch(error) {manifest.state="failed";manifest.error=error.message;if(id){await usage().catch(()=>{});await call(`/s/${id}/api/stop`,{}).catch(()=>{});}throw error;}
  finally {manifest.endedAt=new Date().toISOString();manifest.elapsedMs=Date.parse(manifest.endedAt)-Date.parse(manifest.startedAt);entry.finished=!id;if(id){for(let n=0;n<20;n++){await pause(500);const state=await usage().catch(()=>null);if(state&&!state.busy.length){entry.finished=true;break;}}if(entry.finished)await call(`/api/sessions/${id}/park`,{}).catch(()=>{});}saveBudget();save();console.log(JSON.stringify({label,state:manifest.state,metrics:manifest.metrics,error:manifest.error,dir},null,2));}
 });
}
main().catch(error=>{console.error(error);process.exitCode=1;});
