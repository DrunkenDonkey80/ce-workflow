// P3-02: prove touch emulation independently of viewport size, through the installed agent-browser/CDP.
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {agentBrowser} from "../../../../extensions/design-render.ts";
const execute=promisify(execFile),exe=agentBrowser(),session="p3-input-"+process.pid;
assert.ok(exe,"agent-browser is required");
async function browser(...args){const {stdout}=await execute(exe,["--session",session,"--json",...args],{timeout:30000,windowsHide:true});let result;try{result=JSON.parse(stdout);}catch(error){throw new Error("Invalid agent-browser response: "+error.message);}assert.ok(result.success,JSON.stringify(result));return result.data;}
let socket;
try{
 await browser("open","data:text/html,<meta name=viewport content=width=device-width><h1>Input contract</h1>");
 const {cdpUrl}=await browser("get","cdp-url");assert.ok(cdpUrl.startsWith("ws://127.0.0.1:"));
 socket=new WebSocket(cdpUrl);await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
 let seq=0;const pending=new Map();
 socket.addEventListener("message",event=>{let r;try{r=JSON.parse(event.data);}catch{return;}const job=pending.get(r.id);if(job){pending.delete(r.id);clearTimeout(job.timer);r.error?job.reject(new Error(r.error.message)):job.resolve(r.result);}});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error("CDP timeout: "+method));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...sessionId?{sessionId}:{}}));});
 const {targetInfos}=await send("Target.getTargets"),target=targetInfos.find(t=>t.type==="page"&&t.url.startsWith("data:text/html,"));assert.ok(target);
 const {sessionId}=await send("Target.attachToTarget",{targetId:target.targetId,flatten:true});
 const rows=[];
 for(const touch of [false,true]){
  await send("Emulation.setDeviceMetricsOverride",{width:820,height:1180,deviceScaleFactor:1,mobile:touch},sessionId);
  await send("Emulation.setTouchEmulationEnabled",{enabled:touch,maxTouchPoints:touch?1:undefined},sessionId);
  await send("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]},sessionId);
  const {result}=await send("Runtime.evaluate",{expression:'({width:innerWidth,height:innerHeight,touch:navigator.maxTouchPoints,coarse:matchMedia("(pointer:coarse)").matches,reducedMotion:matchMedia("(prefers-reduced-motion:reduce)").matches})',returnByValue:true},sessionId);
  assert.deepEqual([result.value.width,result.value.height,result.value.coarse,result.value.touch>0,result.value.reducedMotion],[820,1180,touch,touch,true]);rows.push(result.value);
 }
 console.log(JSON.stringify({checks:"Same dimensions, different actual pointer/touch capabilities; reduced motion confirmed",rows},null,2));
}finally{socket?.close();await browser("close").catch(()=>{});}
