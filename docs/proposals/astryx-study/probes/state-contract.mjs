// P3-02: the same bounded draft replay contract on native HTML and React, without serializing framework internals.
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {SANDBOX_CSP, renderDesign, reportText} from "../../../../extensions/design-render.ts";
assert.ok(process.env.STUDY_DEPS,"Set STUDY_DEPS to reviewed installed node_modules");
const deps=process.env.STUDY_DEPS,{chromium}=await import(pathToFileURL(path.join(deps,"playwright/index.mjs")).href),{build}=await import(pathToFileURL(path.join(deps,"esbuild/lib/main.js")).href);
const react=await build({stdin:{contents:`import React,{useState,useLayoutEffect,useRef} from 'react';import{createRoot}from'react-dom/client';function App(){const[open,setOpen]=useState(false),[draft,setDraft]=useState('Saved'),ack=useRef();useLayoutEffect(()=>{window.designPreview={capture:()=>({open,draft}),restore:state=>open===state.open&&draft===state.draft?Promise.resolve():new Promise(resolve=>{ack.current=resolve;setOpen(state.open);setDraft(state.draft);})};window.__ready?.();if(ack.current){ack.current();ack.current=null;}});return <><button id="edit" onClick={()=>setOpen(true)}>Edit</button>{open&&<div role="dialog"><input id="draft" value={draft} onChange={event=>setDraft(event.target.value)}/></div>}</>}createRoot(document.getElementById('app')).render(<App/>);`,resolveDir:deps,loader:"jsx"},bundle:true,format:"iife",platform:"browser",write:false,define:{"process.env.NODE_ENV":'"production"'}});
const html=`<button id="edit" onclick="dialog.showModal()">Edit</button><dialog id="dialog"><input id="draft" value="Saved"></dialog><script>window.designPreview={capture:()=>({open:dialog.open,draft:draft.value}),restore:value=>{draft.value=value.draft;if(value.open&&!dialog.open)dialog.showModal();if(!value.open&&dialog.open)dialog.close();}};</script>`;
function bounded(value){const text=JSON.stringify(value);assert.ok(text&&Buffer.byteLength(text)<=16384,"State must fit 16 KiB");let plain;try{plain=JSON.parse(text);}catch(error){throw new Error("Invalid state JSON: "+error.message);}function walk(v,depth=0){assert.ok(depth<=8,"State nesting exceeds 8");if(v&&typeof v==="object")for(const [key,child]of Object.entries(v)){assert.ok(!["__proto__","prototype","constructor"].includes(key));walk(child,depth+1);}}walk(plain);return plain;}
assert.throws(()=>bounded({draft:"x".repeat(16384)}));assert.throws(()=>bounded(Object.fromEntries([["__proto__",{}]])));
const preview=kind=>'<meta name="viewport" content="width=device-width">'+(kind==="react"?'<div id="app"></div><script>window.designReady=new Promise(resolve=>window.__ready=resolve);</script><script>'+react.outputFiles[0].text+'</script>':html);
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),"design-state-contract-"));
for(const kind of ["html","react"])fs.writeFileSync(path.join(fixture,kind+".html"),preview(kind));
const server=http.createServer((req,res)=>{const origin=`http://127.0.0.1:${server.address().port}`;res.setHeader("content-type","text/html");res.setHeader("content-security-policy",SANDBOX_CSP(origin));res.end(preview(req.url==="/react"?"react":"html"));});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH}),results=[];
try{for(const kind of ["html","react"]){const page=await browser.newPage();try{
 const url=`http://127.0.0.1:${server.address().port}/${kind}`;await page.goto(url);await page.waitForFunction(()=>!!window.designPreview);
 await page.locator("#edit").click();await page.locator("#draft").fill("Unsaved Delta");
 const state=bounded(await page.evaluate(()=>window.designPreview.capture()));assert.deepEqual(state,{open:true,draft:"Unsaved Delta"});
 await page.reload();await page.waitForFunction(()=>!!window.designPreview);
 const ack=await page.evaluate(async state=>{await Promise.race([window.designPreview.restore(state),new Promise((_,reject)=>setTimeout(()=>reject(new Error("Replay timeout")),2000))]);await Promise.race([window.designPreview.restore(state),new Promise((_,reject)=>setTimeout(()=>reject(new Error("Idempotent replay timeout")),2000))]);return window.designPreview.capture();},state);
 assert.deepEqual(bounded(ack),state);assert.equal(await page.locator("#draft").inputValue(),"Unsaved Delta");assert.ok(await page.getByRole("dialog").isVisible());
 const rendered=await renderDesign({folder:fixture,screen:kind+".html",width:360,height:800,pageState:state,element:'[role="dialog"], dialog'});
 assert.equal(rendered.report.state?.restored,true,kind+" draft is acknowledged through the real product renderer: "+reportText(rendered.report));
 assert(!rendered.report.missing&&rendered.png.length&&rendered.height<800,kind+" captures the restored modal by custom selector");
 results.push({kind,replayedDialog:true,replayedUnsavedValue:true,idempotentReplay:true,productReplay:true,productModalSize:[rendered.width,rendered.height]});
 }finally{await page.close();}}
 console.log(JSON.stringify({maxBytes:16384,maxDepth:8,results},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(fixture,{recursive:true,force:true});}
