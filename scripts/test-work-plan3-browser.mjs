import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { createJiti } from "jiti";
const { createPlan3Web } = await createJiti(import.meta.url).import("../extensions/plan3-web.ts");
const binary = process.platform === "win32" ? join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe") : "agent-browser";
const session = `ce-plan3-ui-${process.pid}`, execute = promisify(execFile);
async function browser(...args) {
 const { stdout } = await execute(binary, ["--session", session, "--headed", "false", "--json", ...args], { timeout: 30_000, maxBuffer: 2_000_000 });
 const result = JSON.parse(stdout); assert(result.success, JSON.stringify(result)); return result.data;
}
async function evaluate(script) { return (await browser("eval", "-b", Buffer.from(script).toString("base64"))).result; }
const sample = JSON.parse(await readFile(new URL("./fixtures/diagrams/upload-service.diagram.json", import.meta.url), "utf8"));
const diagram = { ...sample, kind: "plan", plan: "12345678" };
const server = await createPlan3Web({ snapshot: target => ({ target, diagram, plan: { id: "12345678", title: sample.title, status: "draft" }, activity: { working: false }, messages: [], dialogs: [] }) });
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
 const errors = await browser("errors"); assert.deepEqual(errors.errors ?? [], [], "browser JavaScript must run under the strict CSP");
 console.log(`ok - Plan3 browser shell, keyboard/pointer resize and responsive layout; session=${session}`);
} finally {
 await server.close();
 if (!process.argv.includes("--keep-browser")) await browser("close");
}
