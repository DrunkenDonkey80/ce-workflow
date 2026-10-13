import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { createJiti } from "jiti";
const { applyDiagramOperations } = await createJiti(import.meta.url).import("../extensions/plan3-diagram.ts");
const { createPlan3Web, WebError } = await createJiti(import.meta.url).import("../extensions/plan3-web.ts");
const binary = process.platform === "win32" ? join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe") : "agent-browser";
const session = `ce-plan3-ui-${process.pid}`, execute = promisify(execFile);
async function browser(...args) {
 const { stdout } = await execute(binary, ["--session", session, "--headed", "false", "--json", ...args], { timeout: 30_000, maxBuffer: 2_000_000 });
 const result = JSON.parse(stdout); assert(result.success, JSON.stringify(result)); return result.data;
}
async function evaluate(script) { return (await browser("eval", "-b", Buffer.from(script).toString("base64"))).result; }
const sample = JSON.parse(await readFile(new URL("./fixtures/diagrams/upload-service.diagram.json", import.meta.url), "utf8"));
let diagram = { ...sample, kind: "plan", plan: "12345678" }; const edits = [];
diagram.nodes.find(node => node.id === "backend").summary = "Manages upload writes.";
const server = await createPlan3Web({ snapshot: target => ({ target, diagram, plan: { id: "12345678", title: sample.title, status: "draft" }, activity: { working: false }, chat: [], dialogs: [] }), post: (endpoint, body) => {
 assert.equal(body.target, "12345678"); assert.equal(endpoint, "/api/move");
 if (body.expectedRevision !== diagram.revision) throw new WebError(409, "Stale diagram revision");
 edits.push(body); diagram = applyDiagramOperations(diagram, [{ op: "move", entity: body.entity, id: body.id, x: body.x, y: body.y }]).diagram; diagram.revision++;
 server.publish("diagram", { target: { kind: "plan", id: "12345678" }, diagram }); return { diagram };
} });
try {
 await browser("open", server.url({ kind: "plan", id: "12345678" }));
 await browser("set", "viewport", "1280", "800");
 await browser("wait", "--fn", "document.getElementById(\"title\").textContent === \"Upload service\"");
 const snapshot = await browser("snapshot", "-i"); assert(JSON.stringify(snapshot).includes("Resize chat pane"));
 assert.equal(await evaluate("document.getElementById(\"chat\").getBoundingClientRect().width"), 380);
 await browser("focus", "#splitter"); await browser("press", "ArrowLeft");
 assert.equal(await evaluate("document.getElementById(\"chat\").getBoundingClientRect().width"), 390);
 const handle = await evaluate("(() => { const r = document.getElementById(\"splitter\").getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()");
 await browser("mouse", "move", String(handle.x), String(handle.y)); await browser("mouse", "down", "left");
 await browser("mouse", "move", String(handle.x - 80), String(handle.y)); await browser("mouse", "up", "left");
 assert.equal(await evaluate("document.getElementById(\"chat\").getBoundingClientRect().width"), 470);
 await browser("focus", "#splitter"); await browser("press", "Home");
 assert.equal(await evaluate("document.getElementById(\"chat\").getBoundingClientRect().width"), 280);
 await browser("press", "End");
 assert.equal(await evaluate("document.getElementById(\"chat\").getBoundingClientRect().width"), 640);
 await browser("set", "viewport", "760", "800");
 assert(await evaluate("document.getElementById(\"chat\").getBoundingClientRect().top >= document.getElementById(\"canvas\").getBoundingClientRect().bottom"));
 await browser("set", "viewport", "1280", "800");
 await browser("focus", "#splitter"); await browser("press", "Home");
 await browser("click", "#zoom-fit");
 assert.equal(await evaluate("document.getElementById(\"diagram\").dataset.band"), "far");
 assert.equal(await evaluate("document.querySelectorAll(\"[data-node]\").length"), sample.nodes.filter(node => !node.parent).length);
 for (let i = 0; i < 3; i++) await browser("click", "#zoom-in");
 assert.equal(await evaluate("document.getElementById(\"diagram\").dataset.band"), "mid");
 assert.equal(await evaluate("document.querySelectorAll(\"[data-node]\").length"), sample.nodes.length);
 await browser("focus", "#diagram"); await browser("press", "+"); await browser("press", "+"); await browser("press", "+");
 assert.equal(await evaluate("document.getElementById(\"diagram\").dataset.band"), "near");
 assert(await evaluate("document.getElementById(\"diagram\").textContent.includes(\"POST /uploads\")"));
 const beforePan = await evaluate("document.getElementById(\"diagram\").firstElementChild.getAttribute(\"transform\")");
 await browser("press", "ArrowLeft");
 assert.notEqual(await evaluate("document.getElementById(\"diagram\").firstElementChild.getAttribute(\"transform\")"), beforePan);
 // Fit/mid keeps the actual node in the viewport for a pointer drag.
 await browser("click", "#zoom-fit"); await browser("click", "#zoom-in");
 const strokeBefore = await evaluate("document.querySelector(\"[data-node=web_client] path\").getAttribute(\"d\")");
 const panBefore = await evaluate("document.getElementById(\"diagram\").firstElementChild.getAttribute(\"transform\")");
 const canvasTop = await evaluate("Math.round(document.getElementById(\"diagram\").getBoundingClientRect().top)");
 await browser("mouse", "move", "8", String(canvasTop + 8)); await browser("mouse", "down", "left");
 await browser("mouse", "move", "33", String(canvasTop + 33)); await browser("mouse", "up", "left");
 assert.notEqual(await evaluate("document.getElementById(\"diagram\").firstElementChild.getAttribute(\"transform\")"), panBefore);
 assert.equal(await evaluate("document.querySelector(\"[data-node=web_client] path\").getAttribute(\"d\")"), strokeBefore, "fixed seeds keep redraw strokes stable");
 const nodePoint = await evaluate("(() => { const r = document.querySelector(\"[data-node=web_client]\").getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()");
 assert.equal(await evaluate(`document.elementFromPoint(${nodePoint.x}, ${nodePoint.y})?.closest("[data-node]")?.getAttribute("data-node")`), "web_client", "drag must hit the actual visible node");
 await browser("mouse", "move", String(nodePoint.x), String(nodePoint.y)); await browser("mouse", "down", "left");
 await browser("mouse", "move", String(nodePoint.x + 30), String(nodePoint.y + 20)); await browser("mouse", "up", "left");
 await browser("wait", "--fn", "document.getElementById(\"diagram\").dataset.revision === \"2\"");
 assert.equal(edits.length, 1); assert.equal(edits[0].id, "web_client"); assert.equal(edits[0].expectedRevision, 1);
 assert(Number.isFinite(diagram.nodes.find(node => node.id === "web_client").x));
 const savedPosition = { ...diagram.nodes.find(node => node.id === "web_client") }; diagram.revision++;
 const stalePoint = await evaluate("(() => { const r = document.querySelector(\"[data-node=web_client]\").getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()");
 await browser("mouse", "move", String(stalePoint.x), String(stalePoint.y)); await browser("mouse", "down", "left");
 await browser("mouse", "move", String(stalePoint.x + 30), String(stalePoint.y + 20)); await browser("mouse", "up", "left");
 await browser("wait", "--fn", "document.getElementById(\"diagram\").dataset.revision === \"3\"");
 assert.equal(edits.length, 1); assert.deepEqual(diagram.nodes.find(node => node.id === "web_client"), savedPosition);
 assert(await evaluate("document.getElementById(\"notice\").textContent.includes(\"Positions were not saved\")"));
 const errors = await browser("errors"); assert.deepEqual(errors.errors ?? [], [], "browser JavaScript must run under the strict CSP");
 console.log(`ok - Plan3 browser shell, semantic zoom, deterministic strokes, pan, revision-checked drag and responsive resize; session=${session}`);
} finally {
 await server.close();
 if (!process.argv.includes("--keep-browser")) await browser("close");
}
