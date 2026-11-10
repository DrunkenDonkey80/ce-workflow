import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { sessionMetrics } from "../../../../scripts/lab-metrics.mjs";
assert.ok(process.env.STUDY_ROOT && process.env.SUBAGENT_RUNS_DIR, "Set STUDY_ROOT and SUBAGENT_RUNS_DIR");
const root = path.resolve(process.env.STUDY_ROOT);
const native = process.env.SUBAGENT_RUNS_DIR;
try {
const runs = JSON.parse(fs.readFileSync(path.join(root,"runs.json"),"utf8"));
const result = {};
const files = dir => fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? files(path.join(dir,e.name)) : [path.join(dir,e.name)]);
for(const [arm,ids] of Object.entries(runs)) {
 const statuses=ids.map(id=>JSON.parse(fs.readFileSync(path.join(native,id,"status.json"))));
 const sessionFiles=[...new Set(statuses.map(s=>s.sessionFile ?? s.steps[0].sessionFile))];
 assert.equal(sessionFiles.length,1,"Expected native retained resume to reuse canonical session; inspect before aggregating");
 const rows=fs.readFileSync(sessionFiles[0],"utf8").trim().split("\n").map(s=>JSON.parse(s));
 const messages=rows.filter(r=>r.type==="message"&&r.message?.role==="assistant");
 const metrics=sessionMetrics(path.dirname(sessionFiles[0]));
 assert.equal(metrics.sessions,1,"Unexpected extra session file; avoid duplicate accounting");
 assert.equal(messages.length,metrics.turns);
 const typeCounts={};for(const r of rows)typeCounts[r.customType??r.type]=(typeCounts[r.customType??r.type]??0)+1;
 const auxiliary=rows.flatMap(r=>(r.details?.compactionAttempts??[]).map(a=>({kind:"compaction",model:a.model,usage:a.usage})));
 const inclusiveMetrics={...metrics};for(const a of auxiliary){for(const k of ["input","output","cacheRead","cacheWrite","totalTokens"])inclusiveMetrics[k]+=a.usage?.[k]??0;inclusiveMetrics.cost+=a.usage?.cost?.total??0;}inclusiveMetrics.cost=Math.round(inclusiveMetrics.cost*10000)/10000;
 const costEvidence={providerReported:messages.filter(r=>r.message.usage?.cost?.totalFromProvider===true).length,explicitlyEstimated:messages.filter(r=>r.message.usage?.cost?.totalFromProvider===false).length,unspecified:messages.filter(r=>r.message.usage?.cost?.totalFromProvider===undefined).length};
 const missingUsage=messages.filter(r=>!r.message.usage).length;
 const missingCost=messages.filter(r=>!Number.isFinite(r.message.usage?.cost?.total)).length;
 const outsideCalls=messages.flatMap(r=>(r.message.content??[]).filter(c=>c.type==="toolCall"&&/(?:\.\.\/|\/tmp|ce-workflow|astryx-assessment|findings\.md|comparison[\\/](?:html|astryx))/.test(JSON.stringify(c.arguments))).map(c=>({tool:c.name,args:JSON.stringify(c.arguments).slice(0,500)})));
 result[arm]={metrics,inclusiveMetrics,auxiliary,costEvidence,missingUsage,missingCost,canonicalSessionFile:sessionFiles[0],entryTypes:typeCounts,compactionRows:rows.filter(r=>/compact/i.test(r.type)||/compact/i.test(r.customType??"")).map(r=>({type:r.type,customType:r.customType,timestamp:r.timestamp})),thinking:rows.filter(r=>r.type==="thinking_level_change").map(r=>r.thinkingLevel),stages:statuses.map(s=>({runId:s.runId,startedAt:new Date(s.startedAt).toISOString(),endedAt:new Date(s.endedAt).toISOString(),elapsedSeconds:(s.endedAt-s.startedAt)/1000,model:s.steps[0].model,thinking:s.steps[0].thinking,reportedTokens:s.totalTokens,reportedCost:s.totalCost,sessionDir:s.sessionDir})),activeSeconds:statuses.reduce((n,s)=>n+(s.endedAt-s.startedAt)/1000,0),elapsedSeconds:(statuses.at(-1).endedAt-statuses[0].startedAt)/1000,scopeAuditCandidateCount:outsideCalls.length};
 const assets=files(path.join(root,arm,"public")).map(file=>{const bytes=fs.readFileSync(file);return {path:path.relative(path.join(root,arm,"public"),file).replaceAll("\\","/"),bytes:bytes.length,gzip:gzipSync(bytes).length};});
 result[arm].assets=assets;
 result[arm].runtimeAssetBytes=assets.filter(a=>/\.(html|css|js|svg|png|woff2?)$/.test(a.path)).reduce((n,a)=>n+a.bytes,0);
 result[arm].runtimeAssetGzipBytes=assets.filter(a=>/\.(html|css|js|svg|png|woff2?)$/.test(a.path)).reduce((n,a)=>n+a.gzip,0);
 result[arm].sourceFiles=files(path.join(root,arm,"public")).filter(f=>/\.(html|css|js)$/.test(f)&&!f.includes("assets")).map(f=>({path:path.relative(root,f),lines:fs.readFileSync(f,"utf8").split("\n").length}));
}
fs.writeFileSync(path.join(root,"metrics.json"),JSON.stringify(result,null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([a,r])=>[a,{...r,sourceFiles:undefined,assets:undefined}])),null,2));
} catch (error) { console.error("Cannot aggregate study metrics:", error); process.exitCode=1; }
