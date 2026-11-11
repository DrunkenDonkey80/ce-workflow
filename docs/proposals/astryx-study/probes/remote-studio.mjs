// C11: optional real-hub probe; uses the already installed research Playwright, never downloads it.
import assert from "node:assert/strict";
import fs from "node:fs";
import {execFileSync} from "node:child_process";
import {join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {setTimeout as delay} from "node:timers/promises";
import {appStarter} from "../../../../extensions/design-app.ts";
import {BUILD_STATUS, ensureAppBuilt} from "../../../../extensions/design-build.ts";
import {ensureDesignRuntime} from "../../../../extensions/design-runtime.ts";
import {withPlanLock} from "../../../../extensions/plan3-files.ts";
import {decodePng} from "../../../../extensions/screen-read.ts";

const app = `import {useState,useRef,useLayoutEffect} from "react";
import {flushSync} from "react-dom";
import {Button} from "@astryxdesign/core/Button";
export function App({onReady}) {
 const [open,setOpen]=useState(false),[draft,setDraft]=useState("initial"),panel=useRef();
 useLayoutEffect(()=>{if(open&&!panel.current.open)panel.current.showModal();if(!open&&panel.current.open)panel.current.close();},[open]);
 useLayoutEffect(()=>{
  window.designPreview={capture:()=>({open,draft}),restore(value){
   if(!value||Object.keys(value).length!==2||typeof value.open!=="boolean"||typeof value.draft!=="string"||value.draft.length>1000)throw Error("Invalid remote fixture state");
   flushSync(()=>{setOpen(value.open);setDraft(value.draft);});
  },states:{initial:{open:false,draft:"initial"},editing:{open:true,draft:"initial"}}};onReady();
 },[open,draft,onReady]);
 return <main className="starter"><h1 data-id="heading">Remote component</h1>
  <Button label="Edit project" data-id="open" onClick={()=>setOpen(true)}/>
  <dialog ref={panel} aria-label="Project editor" onCancel={()=>setOpen(false)} onClose={()=>setOpen(false)} style={{width:280,background:draft==="Remote draft"?"red":"white"}}>
   <form onSubmit={event=>{event.preventDefault();setOpen(false);}}>
    <label>Project name<input data-id="draft" required value={draft} onChange={event=>setDraft(event.target.value)}/></label>
    <Button label="Color block" data-id="swatch" onClick={()=>{}}/>
    <button type="submit">Save project</button><button type="button" onClick={()=>setOpen(false)}>Cancel project</button>
   </form>
  </dialog>
 </main>;
}
`;

export async function remoteStudio({browser,origin,designDir,hostAgentDir,ownerKey}) {
 assert(process.env.STUDY_DEPS,"STUDY_DEPS must name the retained research node_modules; this probe installs nothing");assert(typeof ownerKey==="string"&&ownerKey.length>=32);
 const {chromium}=await import(pathToFileURL(join(process.env.STUDY_DEPS,"playwright/index.mjs")).href);
 const {cdpUrl}=await browser("get","cdp-url");assert(cdpUrl.startsWith("ws://127.0.0.1:"));
 // This browser-owned worker also appears on a blank owned page; no other worker is exempt.
 const browserWorker="chrome-extension://nkeimhogjdpnpccoofpliimaahmaaome/thunk.js";
 const desktop=await chromium.connectOverCDP(cdpUrl),old=desktop.contexts().flatMap(context=>context.pages()).find(page=>page.url().startsWith(origin+"/"));
 assert(old,"attach only to the owned real-hub test page");assert(old.context().serviceWorkers().every(worker=>worker.url()===browserWorker),"owned prefix must have no app service worker");
 const entryUrl=URL.parse(old.url());assert(entryUrl);entryUrl.searchParams.delete("token");entryUrl.searchParams.delete("key");
 const entry=entryUrl.href,storageState=await old.context().storageState();
 const physical=!!process.env.C11_DEVICE_CDP_URL,serial=process.env.C11_DEVICE_SERIAL,port=URL.parse(origin)?.port;
 assert(port,"fixture origin must include its port");assert.equal(physical,!!serial,"physical checks require both C11_DEVICE_CDP_URL and C11_DEVICE_SERIAL");
 if(physical)assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.C11_DEVICE_CDP_URL),"device CDP must use an existing local ADB forward");
 const connection=physical?await chromium.connectOverCDP(process.env.C11_DEVICE_CDP_URL,{noDefaults:true}):desktop;
 const context=await connection.newContext({storageState,extraHTTPHeaders:{authorization:"Bearer "+ownerKey},serviceWorkers:"block",viewport:physical?null:{width:1280,height:800},hasTouch:physical,reducedMotion:"reduce"});
 const activate=physical?"tap":"click";let reversed=false;
 const adb=(...args)=>execFileSync("adb",["-s",serial,...args],{encoding:"utf8",timeout:15000,windowsHide:true}).trim();
 const network=[],jobs=[],errors=[];let phase="setup",page,refining;const controller=new AbortController();
 const report={passed:false,environment:{browser:connection.version(),transport:"loopback Chromium: whole-response fulfilment delayed per response, not streaming or a shared physical link; SSE/WebSockets/ranges unthrottled; not remote hardware or Safari",latencyMs:150,downloadBytesPerSecond:65536,uploadBytesPerSecond:32768,byteAccounting:"decoded fulfilled body buffers; excludes wire compression and HTTP/TLS overhead",scope:"instrumented UI pages and opaque frames; host-side Mark renderer and the known browser-owned extension worker are outside this trace",browserOwnedWorkerExcluded:browserWorker,cache:"routing disables HTTP cache; prototype responses are asserted no-store"},network,instrumentationErrors:errors};
 if(physical)report.environment.transport="physical Android Chrome, wireless ADB CDP plus a fixture-only ADB reverse tunnel; whole-response delayed fulfilment; NOT production Tailscale/paired-device HTTPS or Safari";
 const reportFile=new URL(physical?"../android-browser-results.json":"../remote-browser-results.json",import.meta.url);
 const redacted=url=>{const value=URL.parse(url);return !value?"<invalid URL>":value.origin==="null"?value.protocol:value.origin+value.pathname.replace(/\/x\/[^/]+\//,"/x/<cap>/");};
 const safeError=error=>String(error).replaceAll(ownerKey,"<auth>");
 const rows=new Map();
 context.on("request",request=>{let frame;try{frame=redacted(request.frame().url());}catch{frame="not-yet-attached";}const row={phase,url:redacted(request.url()),frame,type:request.resourceType(),method:request.method(),startedMs:Date.now(),outcome:"pending"};rows.set(request,row);network.push(row);});
 context.on("requestfailed",request=>Object.assign(rows.get(request)??{},{outcome:"failed",error:request.failure()?.errorText}));
 context.on("requestfinished",request=>{jobs.push((async()=>{const row=rows.get(request),response=await request.response();Object.assign(row,{outcome:"finished",elapsedMs:Date.now()-row.startedMs,status:response?.status(),cacheControl:response?.headers()["cache-control"],csp:response?.headers()["content-security-policy"]});})().catch(error=>errors.push(safeError(error))));});
 await context.routeWebSocket("**/*",route=>{const allowed=URL.parse(route.url())?.origin===origin.replace(/^http/,"ws");network.push({phase,url:redacted(route.url()),type:"websocket",outcome:allowed?"connected":"blocked",blocked:!allowed});if(allowed)route.connectToServer();else route.close();});
 await context.route("**/*",async route=>{
  const request=route.request(),row=rows.get(request);
  try{
   if(new URL(request.url()).origin!==origin){Object.assign(row,{blocked:true});await route.abort("blockedbyclient");return;}
   const headers=request.headers();
   if(new URL(request.url()).pathname.endsWith("/api/events")||headers.accept?.includes("text/event-stream")||headers.range){Object.assign(row,{timing:"unthrottled-live-or-range"});await route.continue();return;}
   const response=await route.fetch({maxRedirects:0,timeout:30000}),body=await response.body(),uploadBytes=request.postDataBuffer()?.length??0;
   const simulatedMs=Math.ceil(150+1000*uploadBytes/32768+1000*body.length/65536);
   Object.assign(row,{bodyBytes:body.length,uploadBytes,simulatedMs});
   await delay(simulatedMs,undefined,{signal:controller.signal});await route.fulfill({response,body});
  }catch(error){if(!controller.signal.aborted)errors.push(safeError(error));await route.abort().catch(()=>{});}
 });
 const metrics=name=>{const records=network.filter(row=>row.phase===name&&row.url.includes("/x/<cap>/")&&row.outcome==="finished"),large=records.filter(row=>row.frame.includes("/x/<cap>/")&&row.bodyBytes>1_000_000);assert(large.length,"real large bundle must load inside the opaque preview");assert(large.every(row=>row.elapsedMs>=row.bodyBytes/65536*1000*0.9),"size-based delay must cover opaque frames on initial load and refinement");return {requests:records.length,bodyBytes:records.reduce((sum,row)=>sum+(row.bodyBytes??0),0),uploadBytes:records.reduce((sum,row)=>sum+(row.uploadBytes??0),0),largeBundleElapsedMs:large.map(row=>row.elapsedMs)};};
 try {
  if(physical){
   assert(!adb("reverse","--list").split(/\r?\n/).some(line=>line.split(/\s+/)[1]===`tcp:${port}`),"never replace an existing reverse mapping");
   adb("reverse",`tcp:${port}`,`tcp:${port}`);reversed=true;
   report.environment.device={model:adb("shell","getprop","ro.product.model"),android:adb("shell","getprop","ro.build.version.release")};
   assert.equal(report.environment.device.model,"Pixel 10a","only the operator-approved physical device");
  }
  await old.close();
  const options={signal:controller.signal,runtime:async()=>{const value=await ensureDesignRuntime({agentDir:hostAgentDir,confirm:async()=>assert.fail("C11 may only reuse the approved host cache")});assert.equal(value.downloadBytes,0);assert.equal(value.cold,false);report.hostCacheVerifications=(report.hostCacheVerifications??0)+1;return value;}};
  const source=appStarter("Remote component");source.set("src/App.jsx",Buffer.from(app));
  const started=Date.now();
  await withPlanLock(designDir,async()=>{for(const[name,bytes]of source){fs.mkdirSync(join(designDir,name,".."),{recursive:true});fs.writeFileSync(join(designDir,name),bytes);}await ensureAppBuilt(designDir,options);});
  report.initialBuildMs=Date.now()-started;report.downloadBytes=0;
  page=await context.newPage();page.setDefaultTimeout(90000);await page.bringToFront();
  if(physical){report.environment.viewport=await page.evaluate(()=>({screenWidth:screen.width,screenHeight:screen.height,touchPoints:navigator.maxTouchPoints,userAgent:navigator.userAgent}));assert(report.environment.viewport.touchPoints>0,"physical browser must expose touch");}
  phase="initial";const initial=Date.now(),navigation=await page.goto(entry,{waitUntil:"domcontentloaded",timeout:120000});assert(navigation?.ok(),"hub navigation must authenticate: HTTP "+navigation?.status());
  const preview=page.frameLocator("#files .files-frame");await preview.getByRole("heading",{name:"Remote component",exact:true}).waitFor();
  await Promise.all(jobs);report.initial={elapsedMs:Date.now()-initial,...metrics("initial")};assert(report.initial.bodyBytes>1_000_000,"exercise the real pinned bundle, not the small publication stub");
  phase="interaction";
  if(physical){
   report.toolbar=await page.locator('#files .files-actions > :is(button,select,a)').evaluateAll(elements=>elements.filter(el=>el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);return {label:el.getAttribute('aria-label')??el.textContent,lines:el.tagName==='BUTTON'?range.getClientRects().length:1,width:r.width,height:r.height,fits:r.left>=0&&r.right<=innerWidth+1};}));
   assert(report.toolbar.length>=7&&report.toolbar.every(control=>control.lines===1&&control.fits&&control.width>=44&&control.height>=44),'physical design toolbar must keep readable, contained 44px controls');
   await page.screenshot({path:fileURLToPath(new URL('../screenshots/android-studio.png',import.meta.url))});
  }
  await preview.getByRole("button",{name:"Edit project",exact:true})[activate]();
  const draft=preview.getByRole("textbox",{name:"Project name",exact:true});await draft.fill("");await preview.getByRole("button",{name:"Save project",exact:true})[activate]();assert(await draft.evaluate(input=>input.validity.valueMissing),"native validation blocks invalid local submission");
  await draft.fill("Remote draft");
  for(let i=0;i<4;i++){await page.keyboard.press(i%2?"Shift+Tab":"Tab");assert(await preview.locator("dialog").evaluate(dialog=>dialog.open&&dialog.contains(dialog.ownerDocument.activeElement)),"focus remains in the native child modal");}
  await page.locator("#files .design-comment").locator("..").screenshot({path:fileURLToPath(new URL(physical?"../screenshots/android-comment-control.png":"../../../changelog/astryx-comment-control.png",import.meta.url))});
  await page.locator("#files .design-comment")[activate]();await draft[activate]();await page.locator("#comment-text").fill("Keep this native draft");
  await page.locator("#comment-form").locator("..").screenshot({path:fileURLToPath(new URL(physical?"../screenshots/android-comment-dialog.png":"../../../changelog/astryx-comment-dialog.png",import.meta.url))});
  await page.locator("#comment-form").evaluate(form=>form.requestSubmit());
  assert.match(await page.locator("#message-input").inputValue(),/@draft.*Keep this native draft/);await page.locator("#files .design-comment")[activate]();
  await page.locator("#files .design-edit")[activate]();await preview.getByRole("button",{name:"Color block",exact:true})[activate]();
  await page.locator('#files .design-inspector [name="background-color"]').fill("rgb(0, 255, 0)");await page.locator("#files .design-inspector").evaluate(form=>{form.querySelector('[name="background-color"]').dispatchEvent(new Event("input",{bubbles:true}));form.requestSubmit();});await page.locator("#files .design-edit")[activate]();
  await page.locator("#files .design-mark")[activate]();await page.locator("dialog.annotate[open] canvas").waitFor({timeout:90000});
  const markedPath=(await page.locator("#message-input").inputValue()).match(/\S*pi-clipboard-[0-9a-f-]+\.png/)?.[0];assert(markedPath);
  const marked=decodePng(fs.readFileSync(markedPath));let red=0,green=0;for(let i=0;i<marked.rgba.length;i+=4){if(marked.rgba[i]===255&&marked.rgba[i+1]===0&&marked.rgba[i+2]===0)red++;if(marked.rgba[i]===0&&marked.rgba[i+1]===255&&marked.rgba[i+2]===0)green++;}assert(red>1000&&green>500,"native component Mark restores the unsaved React modal/draft plus live CSS");
  if(physical)await page.screenshot({path:fileURLToPath(new URL("../screenshots/android-mark-replay.png",import.meta.url))});
  await page.locator("dialog.annotate").getByRole("button",{name:"Cancel",exact:true})[activate]();
  const frame=await page.locator("#files .files-frame").getAttribute("src");
  await assert.rejects(withPlanLock(designDir,async()=>{fs.writeFileSync(join(designDir,"src/App.jsx"),"export const = invalid;");await ensureAppBuilt(designDir,options);}),error=>/Expected|Build failed/i.test(String(error))&&!error.cause?.killed&&!/timed out|SIGKILL/.test(String(error)));
  assert.equal(JSON.parse(fs.readFileSync(join(designDir,BUILD_STATUS),"utf8")).state,"failed");assert.equal(await page.locator("#files .files-frame").getAttribute("src"),frame);assert.equal(await draft.inputValue(),"Remote draft");
  await withPlanLock(designDir,async()=>{fs.writeFileSync(join(designDir,"src/App.jsx"),app);assert.equal((await ensureAppBuilt(designDir,options)).rebuilt,false);});
  phase="refinement";const refinement=Date.now();
  refining=withPlanLock(designDir,async()=>{fs.writeFileSync(join(designDir,"src/App.jsx"),app.replace("Remote component</h1>","Remote component refined</h1>"));return ensureAppBuilt(designDir,options);});refining.catch(()=>{});
  await page.locator(".design-build-status").filter({hasText:"Building"}).waitFor({timeout:20000});assert.equal(await draft.inputValue(),"Remote draft");assert.equal(await page.locator("#files .files-frame").getAttribute("src"),frame,"building leaves the last-good live modal intact");
  const rebuilt=await refining;assert.equal(rebuilt.rebuilt,true);report.refinementBuildMs=Date.now()-refinement;
  await preview.getByRole("heading",{name:"Remote component refined",exact:true}).waitFor({timeout:120000});await Promise.all(jobs);
  report.refinement={elapsedMs:Date.now()-refinement,...metrics("refinement")};assert(report.refinement.bodyBytes>1_000_000,"measure repeated private bundle transfer");
  assert(network.filter(row=>row.url.includes("/x/<cap>/")&&row.outcome==="finished").every(row=>/no-store/i.test(row.cacheControl??"")),"cache-disabled instrumentation matches the actual prototype no-store contract");
  const documents=network.filter(row=>row.type==="document"&&row.url.includes("/x/<cap>/")&&row.outcome==="finished");assert(documents.length&&documents.every(row=>/sandbox[^;]*\ballow-forms\b/.test(row.csp??"")&&/form-action 'none'/.test(row.csp??"")),"fulfilment retains the real design sandbox and form-navigation policy");
  assert.equal(network.filter(row=>![origin,origin.replace(/^http/,"ws")].includes(URL.parse(row.url)?.origin)&&!row.blocked).length,0,"ordinary pinned runtime requests stay on the hub origin");
  phase="negative-control";
  await preview.locator("body").evaluate(body=>{const image=new Image();image.src="https://blocked.invalid/nested-image.png";body.appendChild(image);const link=document.createElement("link");link.rel="stylesheet";link.href="https://blocked.invalid/nested-style.css";document.head.appendChild(link);const font=new FontFace("NetworkProbe","url(https://blocked.invalid/nested-font.woff2)");document.fonts.add(font);font.load().catch(()=>{});fetch("https://blocked.invalid/nested-fetch").catch(()=>{});});
  const denied=["nested-image.png","nested-style.css","nested-font.woff2","nested-fetch"],allDenied=()=>denied.every(name=>network.some(row=>row.url.endsWith("/"+name)&&row.blocked&&row.outcome==="failed"&&row.frame.includes("/x/<cap>/")));
  for(let i=0;i<100&&!allDenied();i++)await new Promise(resolve=>setTimeout(resolve,100));
  assert(allDenied(),"the external deny gate must abort every nested image, stylesheet, font and fetch");
  await Promise.all(jobs);assert.deepEqual(errors,[]);report.serviceWorkerUrls=context.serviceWorkers().map(worker=>redacted(worker.url()));assert(context.serviceWorkers().every(worker=>worker.url()===browserWorker),"no app service worker; only the observed browser-owned extension worker is exempt");
  report.passed=true;report.checks=["real pinned app build","native form validation and focus","modal pins","CSS edit","React modal/draft/CSS Mark replay","syntax failure preserves last-good unsaved draft","successful live publication","initial and repeated decoded payloads with size-based delayed fulfilment in opaque frames","instrumented UI-context external HTTP/WebSocket deny and request log","service workers blocked"];
 } catch(error) {report.error=safeError(error);if(page){report.ui=await page.locator("body").innerText({timeout:3000}).then(value=>value.slice(0,1500)).catch(()=>"unavailable");report.frames=page.frames().map(frame=>redacted(frame.url()));}throw error;}
 finally {controller.abort();await refining?.catch(()=>{});fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+"\n");await context.close().catch(()=>{});await connection.close().catch(()=>{});if(physical)await desktop.close().catch(()=>{});if(reversed)adb("reverse","--remove",`tcp:${port}`);}
 console.log(JSON.stringify({C11:report.passed,initial:report.initial,refinement:report.refinement,initialBuildMs:report.initialBuildMs,refinementBuildMs:report.refinementBuildMs,downloadBytes:report.downloadBytes,report:reportFile.pathname}));
}
