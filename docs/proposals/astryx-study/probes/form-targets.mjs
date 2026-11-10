// P3-02 candidate policy probe. No product change: --candidate adds allow-forms + form-action 'none'.
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {SANDBOX_CSP} from "../../../../extensions/design-render.ts";
assert.ok(process.env.STUDY_DEPS,"Set STUDY_DEPS to reviewed installed node_modules");
const {chromium}=await import(pathToFileURL(path.join(process.env.STUDY_DEPS,"playwright/index.mjs")).href);
const candidate=process.argv.includes("--candidate"),requests=[];
const server=http.createServer((req,res)=>{
 const origin=`http://127.0.0.1:${server.address().port}`,url=new URL(req.url,origin);
 res.setHeader("content-type","text/html");
 if(url.pathname==="/collect"){requests.push({method:req.method,url:req.url});return res.end("collected");}
 if(url.pathname==="/wrapper")return res.end('<iframe src="/frame'+url.search+'"></iframe>');
 let policy=SANDBOX_CSP(origin);
 if(candidate||url.searchParams.has("positive"))policy=policy.replace("sandbox ","sandbox allow-forms ");
 if(candidate&&!url.searchParams.has("positive"))policy+="; form-action 'none'";
 res.setHeader("content-security-policy",policy);
 res.end(`<form id="local"><input id="email" required type="email"><button id="save">Save</button></form>
 <form id="native" action="${origin}/collect" method="POST"><input name="value" value="probe"><button id="send">Send</button><button id="override" formaction="${origin}/collect?override=1" formmethod="GET" formtarget="_blank">Override</button></form>
 <a id="popup" href="about:blank" target="probe-popup">Open named popup</a>
 <dialog id="dialog"><form method="dialog"><button id="close">Close</button></form></dialog>
 <script>window.saved=0;window.invalid=0;window.violations=[];local.addEventListener('submit',e=>{e.preventDefault();saved++});local.addEventListener('invalid',()=>invalid++,true);addEventListener('securitypolicyviolation',e=>violations.push(e.violatedDirective));</script>`);
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH}),origin=`http://127.0.0.1:${server.address().port}`,results=[];
async function open(positive=false){const context=await browser.newContext(),page=await context.newPage();await page.goto(origin+"/wrapper"+(positive?"?positive=1":""));const frame=page.frames().find(f=>f.url().startsWith(origin+"/frame"));assert.ok(frame);return{context,page,frame};}
try{
 {
  const {context,frame}=await open();
  try{
   await frame.locator("#save").click();assert.equal(await frame.evaluate(()=>saved),0);
   if(candidate)assert.ok(await frame.evaluate(()=>invalid)>0,"required validation runs");
   await frame.locator("#email").fill("valid@example.test");await frame.locator("#save").click();
   assert.equal(await frame.evaluate(()=>saved),candidate?1:0,"prevented local submit");
   await frame.locator("#email").press("Enter");assert.equal(await frame.evaluate(()=>saved),candidate?2:0,"Enter submit");
   const isolation=await frame.evaluate(()=>{let storage=false,parentBlocked=false;try{void localStorage.length;}catch{storage=true;}try{void parent.document.body;}catch{parentBlocked=true;}return{storage,parentBlocked};});
   assert.deepEqual(isolation,{storage:true,parentBlocked:true});
   await frame.evaluate(()=>dialog.showModal());await frame.locator("#close").click();
   assert.equal(await frame.evaluate(()=>dialog.open),!candidate,"method=dialog closes only with form permission");
   results.push({case:"local validation/save/Enter/dialog/isolation",candidate});
  }finally{await context.close();}
 }
 for(const method of ["GET","POST"])for(const target of ["_self","_parent","_top","_blank","probe-popup"]){
  const {context,page,frame}=await open(),messages=[];
  page.on("console",message=>messages.push(message.text()));
  try{
   const before=requests.length,frameUrl=frame.url(),parentUrl=page.url();
   await frame.evaluate(({method,target})=>{native.method=method;native.target=target;},{method,target});
   if(target==="probe-popup"){
    const [popup]=await Promise.all([context.waitForEvent("page"),frame.locator("#popup").click()]);
    assert.equal(popup.url(),"about:blank","named popup exists before submission");
   }
   const sandboxRejection=!candidate||["_parent","_top"].includes(target);
   const rejected=sandboxRejection?page.waitForEvent("console",{predicate:message=>candidate?/Unsafe attempt to initiate navigation/.test(message.text())&&/allow-top-navigation/.test(message.text()):/form submission/.test(message.text())&&/allow-forms/.test(message.text()),timeout:3000}):Promise.resolve();
   await Promise.all([rejected,frame.locator("#send").click()]);
   if(!sandboxRejection)await frame.waitForFunction(()=>violations.includes("form-action"),{},{timeout:3000});
   assert.equal(requests.length,before);assert.equal(frame.url(),frameUrl);assert.equal(page.url(),parentUrl);
   assert.ok(context.pages().every(p=>p===page||p.url()==="about:blank"),"no popup navigated");results.push({case:method+" "+target,blocked:true});
  }catch(error){throw new Error(`${method} ${target}: ${messages.join("; ")}`,{cause:error});}finally{await context.close();}
 }
 for(const action of ["submit","requestSubmit","override"]){
  const {context,page,frame}=await open();
  try{
   const before=requests.length;
   const rejected=!candidate?page.waitForEvent("console",{predicate:message=>/form submission/.test(message.text())&&/allow-forms/.test(message.text()),timeout:3000}):Promise.resolve();
   await Promise.all([rejected,action==="override"?frame.locator("#override").click():frame.evaluate(action=>native[action](),action)]);
   if(candidate)await frame.waitForFunction(()=>violations.includes("form-action"),{},{timeout:3000});
   assert.equal(requests.length,before);assert.ok(context.pages().every(p=>p===page||p.url()==="about:blank"));results.push({case:action,blocked:true});
  }finally{await context.close();}
 }
 const {context,frame}=await open(true);
 try{const before=requests.length;await Promise.all([frame.waitForURL(origin+"/collect"),frame.locator("#send").click()]);assert.equal(requests.length,before+1);assert.equal(requests.at(-1).method,"POST");results.push({case:"unrestricted positive control",receivedPOST:true});}finally{await context.close();}
 console.log(JSON.stringify({candidate,results},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
