import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
assert.ok(process.env.STUDY_ROOT && process.env.STUDY_DEPS, "Set STUDY_ROOT (fixture/output root) and STUDY_DEPS (installed node_modules)");
const {chromium}=await import(pathToFileURL(path.join(process.env.STUDY_DEPS,"playwright/index.mjs")).href);
import {withBridge} from "../../../../hub/src/design-bridge.ts";
import {SANDBOX_CSP} from "../../../../extensions/design-render.ts";
const localForms=process.argv.includes("--control-local-forms"),allowForms=localForms||process.argv.includes("--control-allow-forms");
const root=path.resolve(process.env.STUDY_ROOT), out=path.join(root,localForms?"parent-control-local-forms":allowForms?"parent-control-forms":"parent-checks");fs.mkdirSync(out,{recursive:true});
const result={allowForms,startedAt:new Date().toISOString(),cases:[]};
const server=http.createServer((req,res)=>{
 const origin=`http://127.0.0.1:${server.address().port}`;
 const pathname=new URL(req.url,origin).pathname;
 const wrapper=pathname.match(/^\/view\/(html|astryx)\/(index|settings)\.html$/);
 if(wrapper){res.setHeader("content-type","text/html; charset=utf-8");return res.end(`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><iframe id="design" style="display:block;width:100%;height:100vh;border:0" sandbox="allow-scripts allow-popups allow-pointer-lock allow-downloads${allowForms?' allow-forms':''}" src="/${wrapper[1]}/public/${wrapper[2]}.html"></iframe><script>window.messages=[];addEventListener('message',e=>messages.push(e.data));</script></body></html>`);}
 const file=path.resolve(root,"."+decodeURIComponent(pathname));
 if(!["html","astryx"].some(a=>file.startsWith(path.join(root,a,"public")+path.sep))||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 res.setHeader("content-type",({".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8"})[path.extname(file)]??"application/octet-stream");
 res.setHeader("access-control-allow-origin","*");res.setHeader("content-security-policy",(allowForms?SANDBOX_CSP(origin).replace("sandbox ","sandbox allow-forms "):SANDBOX_CSP(origin))+(localForms?"; form-action 'none'":""));
 res.end(file.endsWith(".html")?withBridge(fs.readFileSync(file,"utf8")):fs.readFileSync(file));
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
async function open(arm,file,width,height,touch=false){
 const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch,reducedMotion:"reduce"});
 const page=await context.newPage();page.setDefaultTimeout(5000);
 const row={arm,file,width,height,touch,errors:[],externalRequests:[],failedResources:[],checks:[]};result.cases.push(row);
 row.console=[];page.on("console",m=>{if(m.type()==="error"||m.type()==="warning")row.console.push(m.text());});
 page.on("pageerror",e=>row.errors.push(e.message));page.on("response",r=>{if(r.status()>=400)row.failedResources.push([r.status(),r.url()]);});
 await context.route("**/*",r=>{if(r.request().url().startsWith(origin))return r.continue();row.externalRequests.push(r.request().url());return r.abort();});
 await page.goto(`${origin}/view/${arm}/${file}`);const frame=page.frames().find(f=>f.url().includes(`/${arm}/public/`));assert.ok(frame);
 await frame.locator("h1").waitFor();await frame.evaluate(()=>document.fonts.ready);
 const check=(name,ok,detail)=>{row.checks.push({name,ok:!!ok,detail});};
 const id=s=>frame.locator(`[data-id="${s}"]`);
 const click=async s=>{const el=id(s);if(await el.evaluate(e=>e.tagName==="INPUT"&&!!e.closest("label")))await el.locator("xpath=ancestor::label[1]").click();else await el.click();};
 const send=async data=>{await page.evaluate(data=>document.querySelector("iframe").contentWindow.postMessage({load:"parent-test",...data},"*"),data);await frame.evaluate(()=>new Promise(requestAnimationFrame));};
 return {context,page,frame,row,check,id,click,send};
}
async function layout(t){
 const stats=await t.frame.evaluate(()=>{
  const els=[...document.querySelectorAll("[data-id]")],ids=els.map(e=>e.dataset.id);
  const small=[...document.querySelectorAll("button,a[href],input,select,[role=radio]")].map(e=>e.matches("input[type=checkbox],input[type=radio]")?(e.closest("label")??e):e).filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&r.x>=0&&getComputedStyle(e).visibility!=="hidden"&&!e.closest("[hidden]");}).map(e=>({id:e.dataset.id,text:e.textContent.trim().slice(0,50),w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})).filter(r=>r.w<43.5||r.h<43.5);
  return {overflow:document.documentElement.scrollWidth>innerWidth,duplicates:ids.filter((v,i)=>ids.indexOf(v)!==i),h1:document.querySelectorAll("h1").length,lang:document.documentElement.lang,small,coarse:matchMedia("(pointer: coarse)").matches,storage:(()=>{try{void localStorage.length;return "available";}catch(e){return e.name;}})()};
 });t.row.layout=stats;t.check("no overflow",!stats.overflow);t.check("unique stable IDs",!stats.duplicates.length,stats.duplicates);t.check("one h1 and language",stats.h1===1&&!!stats.lang);t.check("opaque storage",stats.storage==="SecurityError");
 if(t.row.touch&&t.row.width<600)t.check("phone targets 44px",!stats.small.length,stats.small);
 if(t.row.touch&&t.row.width>=600)t.row.largeTouchTargetGaps=stats.small;
}
async function interaction(t){
 const {frame,page,id,click,check,send}=t;
 const rows=()=>frame.locator('[data-id="project-atlas"],[data-id="project-beacon"],[data-id="project-cedar"],[data-id="project-delta"],[data-id="project-ember"],[data-id="project-fjord"]').count();
 check("six sample rows",await rows()===6);
 await id("project-search").fill("MAYA");check("owner search",await rows()===2);
 await click("status-filter-planned");check("combined search/status",await rows()===1&&await id("project-fjord").isVisible());
 await click("reset-filters");check("reset filters",await rows()===6&&(await id("project-search").inputValue())==="");
 await id("project-search").fill("no-such-project");check("no results",await rows()===0);await click("reset-filters");
 await click("edit-atlas");await id("project-name").fill("Discard this");await click("cancel-project");
 check("cancel discards",(await id("project-atlas").innerText()).includes("Atlas mobile rollout"));check("cancel restores focus",await id("edit-atlas").evaluate(e=>e===document.activeElement));
 await click("edit-atlas");await id("project-name").fill("Discard via Escape");await page.keyboard.press("Escape");
 check("Escape discards",(await id("project-atlas").innerText()).includes("Atlas mobile rollout"));check("Escape restores focus",await id("edit-atlas").evaluate(e=>e===document.activeElement));
 await click("edit-atlas");await id("project-name").fill("   ");await click("save-project");
 check("blank name blocked",await id("edit-project-dialog").evaluate(e=>e.open)&&await id("project-name").getAttribute("aria-invalid")==="true");
 let escaped=0;for(let n=0;n<12;n++){await page.keyboard.press(n%4===0?"Shift+Tab":"Tab");if(!await frame.evaluate(()=>!!document.activeElement.closest("dialog")))escaped++;}check("focus trapped",escaped===0,escaped);
 await id("project-name").fill("Atlas Mobile");const status=id("project-status");
 if(await status.evaluate(e=>e.tagName==="SELECT"))await status.selectOption("Paused");else{await status.click();await frame.getByRole("option",{name:"Paused",exact:true}).click();}
 await click("save-project");const saved=/Atlas Mobile/.test(await id("project-atlas").innerText())&&/Paused/.test(await id("project-atlas").innerText());check("save updates name/status",saved);
 if(saved){await click("status-filter-paused");check("Paused filters edited row",await rows()===1&&await id("project-atlas").isVisible());await click("reset-filters");}else{t.row.blocked=["Paused filter on saved edit: saving failed"];await page.keyboard.press("Escape");}
 for(const state of ["loading","empty","error"]){await click("state-"+state);check("state "+state,await rows()===0);await page.screenshot({path:path.join(out,`${t.row.arm}-${t.row.width}-${t.row.touch}-${state}.png`)});}
 await click("error-retry");check("Retry restores rows",await rows()===6);
 // Real bridge, not a substitute mock.
 await send({type:"design:hello",mode:"comment"});await click("edit-atlas");
 await page.waitForFunction(()=>messages.some(m=>m.type==="design:pick"));
 check("bridge comment stable ID",await page.evaluate(()=>messages.filter(m=>m.type==="design:pick").at(-1).id==="edit-atlas"));
 await send({mode:"edit"});await click("edit-atlas");await send({style:{"background-color":"rgb(220, 40, 40)"}});
 check("bridge inline edit",await id("edit-atlas").evaluate(e=>e.style.backgroundColor==="rgb(220, 40, 40)"));
 await send({mode:""});await click("edit-atlas");await send({mode:"comment",pins:[{n:1,screen:"index.html",id:"save-project"}]});await click("save-project");
 check("modal comment stable ID",await page.evaluate(()=>messages.filter(m=>m.type==="design:pick").at(-1).id==="save-project"));
 t.row.pinLayer=await frame.evaluate(()=>{const pin=[...document.querySelectorAll('[data-design-chrome] span')].find(e=>e.textContent==="1");return {exists:!!pin,inDialog:!!pin?.closest("dialog"),modalOpen:!!document.querySelector("dialog:modal")};});
 await page.waitForTimeout(500); // Capture the settled modal, not Astryx's opening transition.
 await page.screenshot({path:path.join(out,`${t.row.arm}-${t.row.width}-${t.row.touch}-modal-pin.png`)});
 await send({mode:"",pins:[]});await page.keyboard.press("Escape");
}
try{
 for(const arm of ["html","astryx"]){
  for(const [w,h,touch] of [[360,800,true],[390,844,true],[820,1180,true],[1440,900,false],[844,390,true]])for(const file of ["index.html","settings.html"]){
   const t=await open(arm,file,w,h,touch);
   try{await layout(t);await t.page.screenshot({path:path.join(out,`${arm}-${file}-${w}x${h}.png`)});if(file==="index.html"&&(w===390||w===1440))await interaction(t);
    if(file==="settings.html"&&w===390){await t.id("workspace-name").fill("");await t.click("save-settings");t.check("settings validation",await t.id("workspace-name").getAttribute("aria-invalid")==="true");await t.id("workspace-name").fill("Relay North");for(const name of ["notifications","appearance"]){const el=t.id(name);const input=await el.evaluate(e=>e.tagName==="INPUT")?el:el.locator("input");const before=await input.isChecked();await t.click(name);t.check(name+" toggles",await input.isChecked()!==before);}await t.click("save-settings");t.check("settings acknowledgement",/saved/i.test(await t.frame.locator("body").innerText()));await t.page.screenshot({path:path.join(out,`${arm}-settings-dark.png`)});}
   }catch(e){t.row.failure=e.message;}finally{t.check("no errors/offline",!t.row.errors.length&&!t.row.externalRequests.length&&!t.row.failedResources.length);await t.context.close();}
  }
  for(const [w,h]of [[360,360],[844,390]]){
   const t=await open(arm,"index.html",w,h,true);try{await t.click("edit-fjord");await t.id("project-name").fill("");await t.click("save-project");t.row.actions=await t.frame.locator('[data-id="save-project"],[data-id="cancel-project"]').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {id:e.dataset.id,top:r.top,bottom:r.bottom,reachable:r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};}));t.check("short touch dialog actions reachable",t.row.actions.every(a=>a.reachable),t.row.actions);await t.page.waitForTimeout(500);
 await t.page.screenshot({path:path.join(out,`${arm}-short-${w}x${h}.png`)});}catch(e){t.row.failure=e.message;}finally{await t.context.close();}
  }
 }
}finally{await browser.close();await new Promise(r=>server.close(r));result.endedAt=new Date().toISOString();fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result.cases.map(c=>({arm:c.arm,file:c.file,size:`${c.width}x${c.height}`,touch:c.touch,checks:c.checks.length,failed:c.checks.filter(x=>!x.ok),failure:c.failure?.split("\n")[0],console:c.console,pinLayer:c.pinLayer})),null,2));}
process.exitCode=result.cases.some(c=>c.failure||c.checks.some(x=>!x.ok))?1:0;
