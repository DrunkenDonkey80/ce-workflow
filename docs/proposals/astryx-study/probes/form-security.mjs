import http from "node:http";
import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import {pathToFileURL} from "node:url";
assert.ok(process.env.STUDY_ROOT && process.env.STUDY_DEPS, "Set STUDY_ROOT (output root) and STUDY_DEPS (installed node_modules)");
const {chromium}=await import(pathToFileURL(path.join(process.env.STUDY_DEPS,"playwright/index.mjs")).href);
import {SANDBOX_CSP} from "../../../../extensions/design-render.ts";
let posts=0;
const server=http.createServer((req,res)=>{
 const origin=`http://127.0.0.1:${server.address().port}`;
 if(req.url==="/collect"){posts++;res.writeHead(204);return res.end();}
 const u=new URL(req.url,origin),mode=u.searchParams.get("mode");
 res.setHeader("content-type","text/html");
 if(u.pathname==="/wrapper")return res.end(`<iframe sandbox="allow-scripts allow-popups${mode==='original'?'':' allow-forms'}" src="/page?mode=${mode}"></iframe>`);
 let csp=SANDBOX_CSP(origin);if(mode!=="original")csp=csp.replace("sandbox ","sandbox allow-forms ");if(mode==="local")csp+="; form-action 'none'";
 res.setHeader("content-security-policy",csp);
 res.end(`<form id="handled"><button id="save">Save locally</button></form><form id="network" action="${origin}/collect" method="POST"><input name="fixture" value="research-only"><button id="send">Send</button></form><script>window.saved=0;window.violations=[];handled.addEventListener('submit',e=>{e.preventDefault();saved++});addEventListener('securitypolicyviolation',e=>violations.push(e.violatedDirective));</script>`);
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH});
const results=[];
try{for(const mode of ["original","local","unrestricted-control"]){
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/wrapper?mode=${mode}`);const frame=page.frames().find(f=>f.url().includes("/page?"));assert.ok(frame);await frame.locator("#save").click();
 const saved=await frame.evaluate(()=>saved);assert.equal(saved,mode==="original"?0:1);
 const inaccessible=await frame.evaluate(()=>{try{void localStorage.length;return false}catch{return true}});assert.equal(inaccessible,true);
 const before=posts;await frame.locator("#send").click();
 if(mode==="local"){await frame.waitForFunction(()=>violations.includes("form-action"));assert.equal(posts,before);}
 else if(mode!=="original"){await page.waitForTimeout(200);assert.equal(posts,before+1,"Positive control must actually receive a POST");}
 const violations=await frame.evaluate(()=>window.violations??[]).catch(()=>[]);
 results.push({mode,localHandlerCalls:saved,posts:posts-before,opaqueStorage:inaccessible,violations});await page.close();
}}finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(process.env.STUDY_ROOT,"form-security.json"),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));}
