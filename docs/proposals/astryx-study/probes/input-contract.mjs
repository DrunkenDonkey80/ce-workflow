// P3-02/P3-07: same-size mouse/touch plus trusted interactions in the actual opaque design sandbox.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {agentBrowser, DESIGN_CSP} from "../../../../extensions/design-render.ts";
import {withBridge} from "../../../../hub/src/design-bridge.ts";
const fixture=fs.readFileSync(new URL("../../../../hub/scripts/fixtures/design-interactions.html",import.meta.url),"utf8");
const execute=promisify(execFile),exe=agentBrowser(),session="p3-input-"+process.pid;
assert.ok(exe,"agent-browser is required");
async function browser(...args){const {stdout}=await execute(exe,["--session",session,"--json",...args],{timeout:30000,windowsHide:true});let result;try{result=JSON.parse(stdout);}catch(error){throw new Error("Invalid agent-browser response: "+error.message);}assert.ok(result.success,result.error);return result.data;}
const server=http.createServer((request,response)=>{
 response.setHeader("content-type","text/html; charset=utf-8");
 if(request.url==="/design.html"){response.setHeader("content-security-policy",DESIGN_CSP(origin));return response.end(withBridge(fixture));}
 response.end('<style>body{margin:0}iframe{display:block;width:100vw;height:100vh;border:0}</style><iframe src="/design.html"></iframe>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let socket;
try{
 await browser("open",origin+"/");
 const {cdpUrl}=await browser("get","cdp-url");assert.ok(cdpUrl.startsWith("ws://127.0.0.1:"));
 socket=new WebSocket(cdpUrl);await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
 let seq=0;const pending=new Map(),external=[],children=new Map();
 socket.addEventListener("message",event=>{let r;try{r=JSON.parse(event.data);}catch{return;}if(r.method==="Target.attachedToTarget"&&r.params.targetInfo.type==="iframe")children.set(r.params.targetInfo.targetId,r.params.sessionId);if(r.method==="Target.detachedFromTarget")for(const [id,child]of children)if(child===r.params.sessionId)children.delete(id);if(r.method==="Network.requestWillBeSent"&&!r.params.request.url.startsWith(origin+"/")&&!r.params.request.url.startsWith("data:"))external.push(r.params.request.url);const job=pending.get(r.id);if(job){pending.delete(r.id);clearTimeout(job.timer);if(r.error)job.reject(new Error(r.error.message));else job.resolve(r.result);}});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error("CDP timeout: "+method));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...sessionId?{sessionId}:{}}));});
 const {targetInfos}=await send("Target.getTargets"),target=targetInfos.find(t=>t.type==="page"&&t.url.startsWith(origin+"/"));assert.ok(target);
 const {sessionId}=await send("Target.attachToTarget",{targetId:target.targetId,flatten:true});
 await send("Target.setAutoAttach",{autoAttach:true,waitForDebuggerOnStart:false,flatten:true},sessionId);
 const evaluate=async expression=>{const response=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true},sessionId);assert(!response.exceptionDetails,"Fixture evaluation failed");return response.result.value;};
 const stats=async message=>evaluate(`new Promise((resolve,reject)=>{const frame=document.querySelector('iframe'),request=crypto.randomUUID(),timer=setTimeout(()=>{removeEventListener('message',done);reject(new Error('Fixture reply timeout'));},2500);const done=event=>{if(event.source!==frame.contentWindow||event.data?.type!=='fixture:result'||event.data.request!==request)return;clearTimeout(timer);removeEventListener('message',done);resolve(event.data);};addEventListener('message',done);frame.contentWindow.postMessage({type:'fixture:stats',request,...${JSON.stringify(message??{})}},'*');})`);
 await send("Network.enable",{},sessionId);await browser("reload");
 await browser("wait","--fn","!!document.querySelector('iframe')?.contentWindow");
 await evaluate("window.__parentPointers=0;addEventListener('pointerdown',()=>window.__parentPointers++,true)");
 const rows=[];
 for(const touch of [false,true]){
  await send("Emulation.setDeviceMetricsOverride",{width:820,height:1180,deviceScaleFactor:1,mobile:false},sessionId);
  // Opaque frames have their own renderer: emulation must reach the child, not only its parent.
  for(const frameSession of [sessionId,...children.values()]){
   await send("Network.enable",{},frameSession);
   await send("Emulation.setTouchEmulationEnabled",{enabled:touch,maxTouchPoints:touch?1:undefined},frameSession);
   await send("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]},frameSession);
  }
  let state=await stats();assert.deepEqual([state.width,state.height,state.coarse,state.touch>0,state.reducedMotion],[820,1180,touch,touch,true]);
  assert.equal(state.rects.open.height,touch?44:28,"coarse tablets get touch targets without inflating fine-pointer desktop controls");assert.equal(state.transition,"0s","reduced motion changes the actual fixture style");
  const click=async id=>{const r=(await stats()).rects[id],point={x:r.x+r.width/2,y:r.y+r.height/2};if(touch){await send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[point]},sessionId);await send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]},sessionId);}else{await send("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...point},sessionId);await send("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...point},sessionId);}};
  const nameRef=async()=>{const snapshot=(await browser("snapshot","-i")).snapshot,ref=snapshot.split("\n").find(line=>line.includes('textbox "Project name"'))?.match(/ref=(e\d+)/)?.[1];assert.ok(ref,"native project name field exists");return "@"+ref;};
  await click("open");state=await stats();assert.equal(await evaluate("window.__parentPointers"),0,"trusted input lands in the child, not stale parent hit-test coordinates");assert(state.open,"trusted click opens the modal");assert(state.focused,"fixture document is focused");assert(state.inside,"focus is inside the modal");assert.equal(state.pointer,touch?"touch":"mouse");assert(state.trusted,"input is trusted, not dispatchEvent");
  for(let i=0;i<8;i++){await browser("press",i%3===0?"Shift+Tab":"Tab");state=await stats();assert(state.focused&&state.inside,"keyboard focus stays in the child modal");}
  await browser("press","Escape");state=await stats();assert(!state.open&&state.active==="open","Escape returns focus to the opener");
  await click("open");await browser("fill",await nameRef(),"");await click("save");state=await stats();assert(state.open&&!state.nameValid&&state.status.includes("Check"),"native validation blocks Save");
  await browser("fill",await nameRef(),"Project Delta");
  state=await stats({date:"2026-11-11"});assert(state.dateValid&&state.dateISO==="2026-11-11","native date parses a valid ISO date");
  state=await stats({date:"2026-99-99"});assert(!state.dateValid&&state.date===""&&state.dateISO===null,"native date rejects an impossible date");await stats({date:"2026-11-11"});
  await click("save");state=await stats();assert(state.open&&state.retry&&state.name==="Project Delta"&&state.status.includes("offline"),"failure keeps the unsaved fields and offers Retry");
  await click("retry");state=await stats();assert(!state.open&&state.active==="open"&&state.saved==="Saved Project Delta","Retry commits locally and restores focus");
  await click("open");await browser("fill",await nameRef(),"Discard me");await click("cancel");state=await stats();assert(!state.open&&state.saved==="Saved Project Delta"&&state.active==="open","Cancel discards edits and returns focus");
  rows.push({width:state.width,height:state.height,touch,coarse:state.coarse,trustedPointer:state.pointer,keyboardFocus:true,nativeValidation:true,nativeDate:true,retry:true,cancel:true});
  if(touch){await send("Emulation.setDeviceMetricsOverride",{width:360,height:360,deviceScaleFactor:1,mobile:false},sessionId);await click("open");state=await stats();assert(state.scrollable&&[state.rects.save,state.rects.cancel].every(r=>r.height>=44&&r.y>=0&&r.bottom<=360),"short touch dialog scrolls content while both actions remain reachable");await browser("press","Escape");}
 }
 assert.equal(external.length,0,"self-contained sandbox fixture requests no external assets during interactions");
 console.log(JSON.stringify({checks:"Actual HTTP sandbox: same-size mouse/touch, trusted pointers, keyboard focus, native form/date, retry, reduced motion, short-dialog reachability, no external assets",rows},null,2));
}finally{socket?.close();await browser("close").catch(()=>{});await new Promise(resolve=>server.close(resolve));}
