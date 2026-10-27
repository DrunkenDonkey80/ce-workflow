// H5-06: the page in a real browser against the real hub and scripts/fake-pi.mjs (ported from ce-workflow's
// scripts/test-work-plan3-browser.mjs). What ce-workflow answers through /pi-hub (models, usage, commands, messages and
// diagram edits) is stubbed here: fake Pi relays those calls to `stub` below. Asks go through fake Pi's /hubask.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import { readFile, rm } from "node:fs/promises";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyDiagramOperations, toolbarEdit } from "../../extensions/plan3-diagram.ts";
const binary = process.platform === "win32" ? join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe") : "agent-browser";
const session = `hub-ui-${process.pid}`, execute = promisify(execFile);
async function browser(...args) {
 if (process.env.BROWSER_TRACE) console.error(Math.round(performance.now() / 1000) + "s", args.join(" ").slice(0, 100));
 // execFile's timeout can't end a call whose pipe the agent-browser daemon still holds (Windows), so a failed wait hung the run.
 const run = execute(binary, ["--session", session, "--json", ...args], { timeout: 30_000, maxBuffer: 2_000_000 }); let timer;
 const { stdout } = await Promise.race([run, new Promise((_, reject) => { timer = setTimeout(() => { run.child.kill(); reject(new Error("agent-browser timed out: " + args.join(" ").slice(0, 200))); }, 35_000); })]).finally(() => clearTimeout(timer));
 let result; try { result = JSON.parse(stdout); } catch { throw new Error("agent-browser returned non-JSON: " + stdout.slice(0, 500)); }
 assert(result.success, JSON.stringify(result)); return result.data;
}
// agent-browser 0.38.2 drops held mouse modifiers; CDP sends trusted input with explicit bits.
async function withPageCdp(origin, run) {
 const { cdpUrl } = await browser("get", "cdp-url"); assert(cdpUrl.startsWith("ws://127.0.0.1:"));
 const socket = new WebSocket(cdpUrl), pending = new Map(); let sequence = 0;
 socket.addEventListener("message", event => { let value; try { value = JSON.parse(event.data); } catch { return; } const request = pending.get(value.id); if (!request) return; pending.delete(value.id); clearTimeout(request.timer); if (value.error) request.reject(new Error(value.error.message)); else request.resolve(value.result); });
 const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP timeout: " + method)); }, 10000);
  pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
 });
 try {
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", () => reject(new Error("CDP connection failed")), { once: true }); });
  const { targetInfos } = await send("Target.getTargets"), target = targetInfos.find(item => item.type === "page" && item.url.startsWith(origin + "/")); assert(target, "CDP must attach to our test page only");
  const { sessionId } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  return await run((method, params) => send(method, params, sessionId));
 } finally { socket.close(); for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("CDP connection closed")); } }
}
async function evaluate(script) { return (await browser("eval", "-b", Buffer.from(script).toString("base64"))).result; }
const fixture = new URL("./fixtures/diagrams/upload-service.diagram.json", import.meta.url);
let sample; try { sample = JSON.parse(await readFile(fixture, "utf8")); } catch (error) { throw new Error("Unreadable fixture " + fixture.pathname + ": " + error.message); }
let diagram = { ...sample, kind: "plan", plan: "12345678" }; const edits = [], comments = [], toolbarEdits = [];
let product = { version: 1, kind: "product", title: "Product", revision: 0, nodes: [], edges: [], notes: [] };
diagram.nodes.find(node => node.id === "backend").summary = "Manages upload writes.";

// The project: a git folder named ce-workflow (the title is "<folder> - <session>"), two plans and the diagram on disk.
const root = fs.mkdtempSync(join(os.tmpdir(), "hub-browser-"));
process.env.PI_CODING_AGENT_DIR = root;
const folder = join(root, "ce-workflow"), write = (file, text) => { fs.mkdirSync(join(folder, file, ".."), { recursive: true }); fs.writeFileSync(join(folder, file), text); };
const planFile = (id, title) => `docs/plans/2026-10-18-${title.toLowerCase().replace(/\W+/g, "-")}-${id}-plan3.md`;
const writePlan = (id, title, total, done, updated) => write(planFile(id, title), `---\nplan3: true\nstatus: active\ncreated: 2026-10-18\nupdated: ${updated}\n---\n\n# ${title}\n\n## Steps\n\n${Array.from({ length: total }, (_, i) => `- [${i < done ? "x" : " "}] **S0${i + 1}** step ${i + 1}`).join("\n")}\n`);
writePlan("12345678", sample.title, 5, 2, "2026-10-18T12:00:00Z"); writePlan("abcdef01", "Other plan", 3, 0, "2026-10-18T10:00:00Z");
const diagramFile = join(folder, planFile("12345678", sample.title).replace(/\.md$/, ".diagram.json")), productFile = join(folder, "docs/architecture/product.diagram.json");
const persist = () => { fs.writeFileSync(diagramFile, JSON.stringify(diagram)); if (product.revision) { fs.mkdirSync(join(productFile, ".."), { recursive: true }); fs.writeFileSync(productFile, JSON.stringify(product)); } };
persist();
write("docs/readme.md", "# Readme\n"); write("docs/notes.md", "# Notes\n"); write("src/app.ts", "old line\n"); write("top.txt", "<img src=x onerror=alert(1)>\nplain\n"); write(".gitignore", "fake-*\n*.lock\n");
const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: folder, stdio: "pipe" });
git("init", "-q"); git("add", "-A"); git("commit", "-qm", "init"); write("src/app.ts", "new line\n");

// What ce-workflow answers through /pi-hub, as the old in-process stub did; fake Pi relays each call here.
const pool = { acts: [] }; const answers = [], messages = [], commands = [], chatRows = new Map(); let rejectMessage = false, holdMessage = null, activity = { working: false };
const fail = (status, error) => Object.assign(new Error(error), { status });
function stub(endpoint, body) {
 if (endpoint === "/api/models") return { ...status, efforts: ["low", "high"], scoped: [{ provider: "fake", id: "fake-1", name: "Fake One" }, { provider: "fake", id: "fake-2", name: "Fake Two" }], others: [{ provider: "b", id: "other", name: "Other" }] };
 if (endpoint === "/api/usage") return { summary: [{ id: "claude", label: "Claude", window: "7d", left: 53, color: "text", bars: [{ label: "7d", left: 53, color: "text" }], warnings: [{ text: "expiring in 4h 12m (40% unused)", color: "error" }], notes: ["70% in 2h 0m"] }, { id: "codex", label: "Codex", window: "7d", left: 12, color: "error", resets: "1d 14h", soon: [{ left: 75, in: "18h 19m" }, { left: 65, in: "1d 9m" }], bars: [{ label: "5h", left: 80, color: "text", resets: "2h 3m" }, { label: "7d", left: 12, color: "error", resets: "1d 14h", at: "Tue 10:00" }], warnings: [], notes: [] }], lines: [[{ text: "Claude", color: "accent" }, { text: " 7d [████░░░░] 53% · 5h 20% │ " }, { text: "Codex", color: "accent" }, { text: " 7d 12%", color: "error" }]] };
 if (endpoint === "/api/pool") { if (body.act) { pool.acts.push(body.act + ":" + body.label + (body.value === undefined ? "" : ":" + body.value)); return { message: "done " + body.act }; } return { title: "Claude accounts", drain7d: false, rows: [{ label: "flex1", priority: 0, state: "ok", login: "ok", fiveHour: { pct: 20, resets: "2h" }, sevenDay: { pct: 53, tone: "warning", resets: "4h 12m", clock: "error" }, notes: [{ text: "as of 3m ago" }], active: true, favorite: true, weekend: false, disabled: false, dead: false }, { label: "flex2", priority: -1, state: "ok", login: "ok", fiveHour: null, sevenDay: { pct: 90, tone: "error" }, notes: [], active: false, favorite: false, weekend: false, disabled: false, dead: false }] }; }
 if (endpoint === "/api/commands") return { pi: [{ name: "plan3", description: "Plan" }], wo: [{ value: "share", description: "Toggle sharing" }], args: { wo: [{ value: "share", description: "Toggle sharing" }], plan3: [{ value: "review", description: "Review" }, { value: "review all", description: "Review" }] } };
 if (endpoint === "/api/edit" && body.target === "product") { // E-05: Project-tab edits
  const planned = toolbarEdit(product, body.edit), result = applyDiagramOperations(product, planned.operations); toolbarEdits.push(body.edit);
  product = { ...result.diagram, revision: product.revision + 1 }; persist(); publish("diagram", { target: { kind: "product" }, diagram: product });
  return { diagram: product, line: planned.line, removed: result.removed };
 }
 assert.equal(body.target, "12345678");
 if (endpoint === "/api/command") { commands.push(body.command); return { ok: true }; }
 if (endpoint === "/api/message" && body.text.startsWith("/")) { commands.push(body.text); return { accepted: true }; }
 if (endpoint === "/api/message") {
  if (rejectMessage) { rejectMessage = false; throw fail(503, "Session temporarily unavailable"); }
  messages.push(body); const row = { id: "user_" + messages.length, role: "user", text: body.text, at: new Date().toISOString(), streaming: false };
  chatRows.set(row.id, row); publish("message", row); return { accepted: true, queued: activity.working };
 }
 if (endpoint === "/api/bias") { publish("plan", { id: "12345678", title: sample.title, done: 2, total: 5, focus: "S03", bias: body.level }); return { ok: true }; }
 // G-01: the real endpoint opens ask_user pre-filled with the saved directions and settles on the answer.
 if (endpoint === "/api/generate") { ask({ question: "Directions for plan 12345678's diagram", options: [], allowMultiple: false, allowFreeform: true, initialText: "Saved directions" }); return { cancelled: true }; }
 assert(["/api/move", "/api/comment", "/api/edit"].includes(endpoint), endpoint);
 if (body.expectedRevision !== diagram.revision) throw fail(409, "Stale diagram revision");
 if (endpoint === "/api/edit") {
  const planned = toolbarEdit(diagram, body.edit), result = applyDiagramOperations(diagram, planned.operations); toolbarEdits.push(body.edit);
  diagram = { ...result.diagram, revision: diagram.revision + 1 }; persist(); publish("diagram", { target: { kind: "plan", id: "12345678" }, diagram });
  return { diagram, line: planned.line, removed: result.removed };
 }
 const operation = endpoint === "/api/move" ? { op: "move", entity: body.entity, id: body.id, x: body.x, y: body.y } : { op: "add", entity: "note", value: { text: body.text, author: "user", created: new Date().toISOString(), ...(body.element ? { target: body.element } : { x: body.x, y: body.y }) } };
 (endpoint === "/api/move" ? edits : comments).push(body); diagram = applyDiagramOperations(diagram, [operation]).diagram; diagram.revision++; persist();
 publish("diagram", { target: { kind: "plan", id: "12345678" }, diagram }); return { diagram };
}
const relay = http.createServer((request, response) => {
 let text = ""; request.on("data", chunk => text += chunk); request.on("end", async () => {
  let result;
  try { const { endpoint, data } = JSON.parse(text); if (endpoint === "/api/message" && holdMessage) await holdMessage; result = { ok: true, value: stub(endpoint, data) }; } catch (error) { result = { ok: false, status: error.status ?? 500, error: error.message }; }
  response.end(JSON.stringify(result));
 });
});
await new Promise(done => relay.listen(0, "127.0.0.1", done));
process.env.FAKE_PI_HUB_URL = `http://127.0.0.1:${relay.address().port}/`;

const { startHub } = await import("../src/hub.ts");
const { createUpdateCheck } = await import("../src/update-check.ts");
// ce-workflow has an update: the Update button shows (its menu is checked; no item is picked, that would run pi update).
const updates = createUpdateCheck({ find: async () => ({ pi: null, packages: ["ce-workflow"], installed: [{ source: "git:github.com/x/ce-workflow", name: "ce-workflow", version: "0.1.0", update: true }] }), latest: async () => null });
const hub = await startHub({ command: [process.execPath, fileURLToPath(new URL("./fake-pi.mjs", import.meta.url))], updates, usage: { usage: () => ({ summary: stub("/api/usage", {}).summary, accounts: [] }), start: async () => {}, stop() {}, refresh: async () => {}, flush: async () => {} }, pool: { available: true, daemon: () => undefined, view: async () => stub("/api/pool", {}), action: async data => stub("/api/pool", data), start() {}, stop() {} },
 app: { status: () => ({ supported: true, installed: true, version: "0.1.0", staged: null, latest: "0.2.0", running: false, login: true }), install() {}, autoStage: async () => ({}), stage: () => ({ supported: true, installed: true, version: "0.1.0", staged: "0.2.0", latest: "0.2.0", running: false, login: true }), uninstall() {}, setLogin() {} } });
const origin = `http://127.0.0.1:${hub.config.port}`;
const own = await hub.host.create(folder, "1"), id = own.id, rpc = () => hub.host.live.get(id).rpc;
const publish = (event, value) => hub.views.get(id)?.publish(event, value);
const api = async route => (await fetch(`${origin}/s/${id}/api/${route}`, { headers: { authorization: `Bearer ${hub.config.localKey}` } })).json();
// Fake Pi's ask answers come back as notify "answer:<value>".
hub.host.on("ui", (sessionId, request) => { if (sessionId === id && request.method === "notify" && String(request.message).startsWith("answer:")) { const value = request.message.slice(7); try { answers.push(value === "<cancelled>" ? { cancelled: true } : JSON.parse(value)); } catch { answers.push({ invalid: value }); } } });
const ask = (value, ms = 0) => { void rpc().send({ type: "prompt", message: `/hubask ${ms} ${JSON.stringify(value)}` }).catch(() => {}); };
await rpc().send({ type: "prompt", message: "/state " + JSON.stringify({ plan: { id: "12345678", title: sample.title, status: "draft", done: 2, total: 5, focus: "S03", bias: 0 }, modes: { research: "off", night: "off" } }) });
let status = (await api("snapshot")).status;
const server = { url: target => `${origin}/s/${id}/?token=${hub.config.localKey}&target=${target.id}` };
try {
 // An older running hub may not serve newly added optional assets: the page must still boot.
 await browser("network", "route", "**/icons.js?*", "--abort");
 await browser("open", server.url({ kind: "plan", id: "12345678" }));
 await browser("wait", "--fn", "document.getElementById(\"title\").textContent === \"ce-workflow - 1\"");
 assert.equal(await evaluate("document.getElementById(\"send\").disabled"), false, "missing icons do not disable chat");
 await browser("network", "unroute", "**/icons.js?*");
 await browser("reload");
 await browser("set", "viewport", "1280", "800");
 await browser("wait", "--fn", "document.getElementById(\"title\").textContent === \"ce-workflow - 1\"");
 // Ctrl+wheel: the page 10% bigger, still exactly filling the window; and back.
 const wheel = up => `document.getElementById("chat").dispatchEvent(new WheelEvent("wheel", { deltaY: ${up ? -100 : 100}, ctrlKey: true, bubbles: true, cancelable: true }))`;
 assert.deepEqual(await evaluate(`(() => { ${wheel(true)}; const r = document.body.getBoundingClientRect(); return [document.body.style.zoom, Math.round(r.bottom) === innerHeight, localStorage.getItem("hub-zoom")]; })()`), ["1.1", true, "1.1"]);
 await new Promise(resolve => setTimeout(resolve, 150));
 assert.equal(await evaluate(`(() => { ${wheel(false)}; localStorage.removeItem("hub-zoom"); return document.body.style.zoom; })()`), "1");
 // The excerpt and stream-gap refetches ask the hub for the whole row; here every row's full text is fixed.
 hub.views.get(id).row = async rowId => ({ id: rowId, role: "assistant", text: "Short excerpt. Full body loaded.", streaming: false });
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
 // R7 collapse states: narrow gives the panel the chat's width; collapsed leaves only >>.
 const width = id => evaluate(`Math.round(document.getElementById(${JSON.stringify(id)}).getBoundingClientRect().width)`);
 await browser("click", "#narrow-left");
 assert.deepEqual([await width("left-panel"), await width("chat")], [640, await width("workspace") - 652], "narrow: the chat takes the rest");
 await browser("focus", "#splitter"); await browser("press", "ArrowLeft");
 assert.equal(await width("left-panel"), 630, "in narrow mode the arrows move the splitter the way they point");
 await browser("press", "End"); await browser("click", "#narrow-left"); assert.equal(await width("chat"), 640);
 await browser("click", "#collapse-left");
 assert.equal(await evaluate("document.activeElement.id"), "expand-left");
 assert.equal(await evaluate("document.getElementById(\"left-panel\").getClientRects().length"), 0);
 assert(await width("chat") > await width("workspace") - 60, "collapsed: chat takes the width");
 assert.equal(await evaluate("localStorage.getItem(\"plan3-left\")"), "collapsed");
 await browser("click", "#expand-left"); assert.equal(await width("chat"), 640);
 await browser("click", "#tab-files");
 assert.deepEqual(await evaluate("[document.getElementById(\"files\").hidden, document.getElementById(\"canvas\").hidden, document.getElementById(\"tab-files\").getAttribute(\"aria-selected\")]"), [false, true, "true"]);
 assert.equal(await evaluate("document.getElementById('zoom-controls').hidden"), true, "zoom controls belong to the diagram tab");
 // R8/E4: changed files are marked, open as a coloured diff and keep folders open; content renders as text only.
 await browser("wait", "[data-path=\"src/app.ts\"]");
 assert.equal(await evaluate("document.querySelector(\"[data-path='src/app.ts'] .file-mark\").textContent"), "M");
 assert.equal(await evaluate("document.querySelector(\"[data-path='src/app.ts']\").closest(\"details\").open"), true, "changed folders start open");
 assert.equal(await evaluate("document.querySelector(\"[data-path='docs/readme.md']\").closest(\"details\").open"), false);
 await browser("click", "[data-path=\"src/app.ts\"]"); await browser("wait", ".files-body .add");
 assert.deepEqual(await evaluate("[document.querySelector('.files-body .add').textContent, document.querySelector('.files-body .del').textContent, getComputedStyle(document.querySelector('.files-body .add')).backgroundColor]"), ["+new line\n", "-old line\n", "rgb(178, 242, 187)"]);
 assert.deepEqual(await evaluate("(() => { const r = [document.querySelector('.files-tree').getBoundingClientRect(), document.querySelector('.files-viewer').getBoundingClientRect()]; return [r[1].left >= r[0].right - 1, Math.abs(r[0].top - r[1].top) < 2]; })()"), [true, true], "desktop: tree beside the viewer");
 await browser("focus", "[data-path=\"top.txt\"]"); await browser("press", "Enter"); await browser("wait", "--fn", "document.querySelector('.files-body').textContent.includes('plain')");
 assert.equal(await evaluate("document.querySelector('.files-body img')"), null, "file content is inert text");
 write("src/new.ts", "x\n"); publish("files", {});
 await browser("wait", "[data-path=\"src/new.ts\"]");
 await browser("set", "viewport", "390", "844"); await browser("click", "#drawer-toggle"); await browser("click", "#mobile-files");
 assert(await evaluate("document.querySelector('.files-viewer').getBoundingClientRect().top >= document.querySelector('.files-tree').getBoundingClientRect().bottom - 1"), "phone: tree above the viewer");
 assert.equal(await evaluate("document.getElementById('chat').getClientRects().length"), 0, "phone shows one view at a time");
 await browser("set", "viewport", "1280", "800");
 // T-01: Project and Plan tabs share the canvas, each with its own diagram; events update only their tab.
 await browser("focus", "#tab-files"); await browser("press", "ArrowRight"); assert.equal(await evaluate("document.activeElement.id"), "tab-project");
 assert.deepEqual(await evaluate("[document.getElementById('canvas').hidden, document.getElementById('empty-diagram').hidden, document.getElementById('empty-diagram').textContent, !!document.querySelector('[data-node=mobile_client]')]"), [false, false, "No project diagram yet. Generate one, or draw with the bar above.", false]);
 product = { ...product, revision: 1, nodes: [{ id: "core", label: "Core service", kind: "service" }] }; publish("diagram", { target: { kind: "product" }, diagram: product });
 publish("diagram", { target: { kind: "plan", id: "abcdef01" }, diagram: { ...product, nodes: [{ id: "stray", label: "Stray", kind: "service" }] } });
 await browser("wait", "[data-node=core]");
 assert.deepEqual(await evaluate("[document.getElementById('empty-diagram').hidden, !!document.querySelector('[data-node=stray]')]"), [true, false], "another plan's diagram event is ignored");
 await browser("press", "ArrowRight"); assert.equal(await evaluate("document.activeElement.id"), "tab-plan");
 assert.deepEqual(await evaluate("[!!document.querySelector('[data-node=mobile_client]'), !!document.querySelector('[data-node=core]'), localStorage.getItem('plan3-tab')]"), [true, false, "plan"]);
 assert.equal(await evaluate("document.getElementById(\"canvas\").hidden"), false);
 assert(await evaluate("(() => { const zoom = document.getElementById('zoom-controls'), canvas = document.getElementById('canvas').getBoundingClientRect(); return !zoom.hidden && zoom.parentElement.classList.contains('left-tabs') && zoom.nextElementSibling.id === 'narrow-left' && zoom.getBoundingClientRect().bottom <= canvas.top; })()"), "zoom controls sit in the tab bar beside Narrow, not over the diagram");
 // R9/E5 at 390 px: Chat, Files and Diagram tabs; the composer and the attach button stay on screen.
 await browser("set", "viewport", "390", "844");
 await browser("click", "#drawer-toggle"); await browser("click", "#mobile-plan");
 assert.deepEqual(await evaluate("[document.getElementById('canvas').getBoundingClientRect().width, document.getElementById('drawer').dataset.open]"), [390, "false"], "picking a view closes the drawer");
 await browser("click", "#drawer-toggle"); assert.equal(await evaluate("document.activeElement.id"), "mobile-plan", "the drawer opens on the current view");
 await browser("press", "ArrowRight"); assert.equal(await evaluate("document.activeElement.id"), "mobile-chat");
 assert(await evaluate("['model-button', 'context-button', 'bias-button', 'plan-button', 'usage-button', 'pi-commands', 'wo-commands'].every(id => document.getElementById('drawer').contains(document.getElementById(id)))"), "phone: status line and command buttons live in the drawer");
 assert(await evaluate("(() => { const bar = document.querySelector('.topbar'), was = document.getElementById('connection').dataset.state; document.getElementById('connection').dataset.state = 'working'; const orange = getComputedStyle(bar).backgroundColor; document.getElementById('connection').dataset.state = 'idle'; const idle = getComputedStyle(bar).backgroundColor; document.getElementById('connection').dataset.state = was; return orange !== idle && /rgb/.test(orange); })()"), "phone: the top bar turns orange while working");
 assert(await evaluate("(() => { const top = id => document.getElementById(id).getBoundingClientRect().top, wide = id => document.getElementById(id).getBoundingClientRect().width; return Math.abs(top('model-button') - top('context-button')) < 2 && top('bias-button') > top('model-button') + 20 && top('plan-button') < top('model-button') && top('settings-button') < top('mobile-chat') && document.getElementById('drawer-gear').contains(document.getElementById('settings-menu')) && document.querySelector('#context-button .context-label').offsetParent === null && wide('model-button') > 120; })()"), "phone: gear by View, plan under Session, then model + context, then think and load; context numbers only");
 assert(await evaluate("(() => { const plan = document.getElementById('title-plan'), r = id => document.getElementById(id).getBoundingClientRect(); return !plan.hidden && plan.lastElementChild.textContent === '2/5' && r('title-plan').top >= r('title').bottom && r('title-plan').top > r('connection').bottom; })()"), "phone: plan name and steps on a second top-bar line under the session name and state");
 await browser("click", "#wo-commands"); await browser("wait", ".command-option");
 await browser("click", ".command-option"); assert.deepEqual(await evaluate("[document.getElementById('message-input').value, document.getElementById('command-picker').open, document.getElementById('drawer').dataset.open]"), ["/wo share ", false, "false"], "a picked command goes into the composer");
 await browser("fill", "#message-input", "");
 // Typing / lists commands above the box; Enter picks, /wo then lists its subcommands.
 await browser("focus", "#message-input"); await browser("press", "/"); await browser("wait", "#slash-menu:not([hidden]) .slash-option");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('.slash-option')].map(o => o.dataset.command)"), ["/plan3"]);
 await browser("press", "Enter"); assert.equal(await evaluate("document.getElementById('message-input').value"), "/plan3 ", "Enter picks instead of sending");
 // Push to talk: holding the button streams recognised words into the box, in the chosen language; release stops.
 await evaluate(`(() => { window.webkitSpeechRecognition = window.SpeechRecognition = class { start() { window.heard = this; } stop() { window.stopped = true; this.onend(); } }; document.getElementById("message-input").value = "Hi"; })()`);
 await browser("click", "#talk-lang"); await evaluate(`document.getElementById("talk").dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, bubbles: true }))`);
 await evaluate(`window.heard.onresult({ results: [[{ transcript: "здравей" }], [{ transcript: " свят" }]] })`);
 assert.deepEqual(await evaluate(`[document.getElementById("message-input").value, window.heard.lang, document.getElementById("talk").classList.contains("live")]`), ["Hi здравей свят", "bg-BG", true]);
 await evaluate(`document.getElementById("talk").dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }))`);
 assert.deepEqual(await evaluate(`[window.stopped, document.getElementById("talk").classList.contains("live")]`), [true, false]); await browser("click", "#talk-lang");
 await browser("fill", "#message-input", ""); await browser("type", "#message-input", "/wo s"); await browser("wait", "#slash-menu:not([hidden]) [data-command='/wo share']");
 await browser("press", "Escape"); assert.equal(await evaluate("document.getElementById('slash-menu').hidden"), true);
 // Picking /plan3 lists its arguments.
 await browser("fill", "#message-input", ""); await browser("type", "#message-input", "/plan3 rev"); await browser("wait", "#slash-menu:not([hidden]) [data-command='/plan3 review all']");
 await browser("press", "Escape");
 await browser("fill", "#message-input", "");
 // S-12: the first keystroke in a parked session resumes it once; more typing does not resume again.
 const resumes = []; const resume = hub.host.resume.bind(hub.host); hub.host.resume = async sid => { resumes.push(sid); return resume(sid); };
 const early = []; const sendPrompt = hub.host.prompt.bind(hub.host); hub.host.prompt = async (sid, text, ...rest) => { if (text.includes("/wo compact early")) early.push(sid); return sendPrompt(sid, text, ...rest); };
 publish("status", { ...status, parked: true }); await browser("wait", "200");
 await browser("type", "#message-input", "he"); for (let i = 0; i < 100 && !resumes.length; i++) await new Promise(r => setTimeout(r, 20));
 await browser("type", "#message-input", "llo"); await new Promise(r => setTimeout(r, 200));
 // The second resume is the early-compact message (every message resumes first; a no-op on a live session).
 assert.deepEqual([resumes, early], [[id, id], [id]], "one resume for the first keystrokes, then the woken session compacts early if it needs to");
 hub.host.prompt = sendPrompt;
 assert.equal(await evaluate("document.querySelector('#model-button') !== null"), true);
 hub.host.resume = resume; await browser("fill", "#message-input", "");
 await browser("click", "#title"); assert(await evaluate("!document.getElementById('title-menu').hidden && document.getElementById('title-menu').contains(document.getElementById('plan-menu')) && !document.getElementById('plan-menu').hidden && document.getElementById('drawer-sessions').contains(document.getElementById('session-list'))"), "phone: the title opens plans and commands; sessions sit in the drawer");
 await browser("press", "Escape"); assert.equal(await evaluate("document.getElementById('title-menu').hidden"), true);
 await browser("click", "#drawer-toggle");
 await browser("press", "Escape"); assert.deepEqual(await evaluate("[document.getElementById('drawer').dataset.open, document.activeElement.id, document.getElementById('drawer-backdrop').hidden]"), ["false", "drawer-toggle", true]);
 // E5 finding: the chat itself gets most of the screen; only a slim bar sits above it.
 assert(await evaluate("(() => { const m = document.getElementById('feed').getBoundingClientRect(); return m.top < 60 && m.height > innerHeight * 0.6; })()"), "phone: messages fill the screen");
 assert.deepEqual(await evaluate("[document.getElementById('left-panel').getClientRects().length, document.querySelector('.left-tabs').getClientRects().length]"), [0, 0]);
 assert(await evaluate("(() => { const r = document.getElementById('composer').getBoundingClientRect(), a = document.querySelector('.attach').getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.top > innerHeight / 2 && a.width > 0 && a.bottom <= innerHeight; })()"), "composer and attach stay on screen");
 assert.equal(await evaluate("document.documentElement.scrollWidth"), 390, "no sideways scrolling");
 // Phones have no Ctrl+F: the drawer's Search button opens the chat search bar, which fits the narrow screen.
 await browser("click", "#drawer-toggle"); await browser("click", "#chat-search-m");
 assert(await evaluate("(() => { const bar = document.getElementById('chat-search'), r = bar.getBoundingClientRect(); return document.getElementById('drawer').dataset.open === 'false' && !bar.hidden && document.activeElement.id === 'chat-find' && r.width > 0 && [...bar.children].every(item => { const box = item.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.width > 0; }) && parseFloat(getComputedStyle(document.getElementById('chat-find')).fontSize) >= 16 && document.documentElement.scrollWidth === 390; })()"), "phone: the drawer opens a chat search bar that fits the screen");
 await browser("click", "#chat-search [data-find=close]"); assert.equal(await evaluate("document.getElementById('chat-search').hidden"), true);
 const phoneBox = await evaluate("[document.getElementById('message-input').rows, document.getElementById('message-input').clientHeight]");
 await browser("set", "viewport", "1280", "800");
 await browser("wait", "--fn", "document.getElementById('message-input').rows === 6");
 assert.equal(phoneBox[0], 4, "the phone keeps its 4-row box");
 assert(await evaluate("document.getElementById('message-input').clientHeight") > phoneBox[1], "T-03: the desktop box is taller");
 assert(await evaluate("document.getElementById('left-panel').getClientRects().length > 0 && document.getElementById('chat').getClientRects().length > 0 && document.getElementById('mobile-tabs').getClientRects().length === 0"), "desktop ignores the phone view");
 // The media-query listener moves them back asynchronously after the resize.
 await browser("wait", "--fn", "document.querySelector('.topbar').contains(document.getElementById('model-button')) && document.getElementById('switcher').contains(document.getElementById('session-list')) && document.querySelector('.chat-heading').contains(document.getElementById('connection'))");
 await browser("focus", "#splitter"); await browser("press", "Home");
 await browser("click", "#zoom-fit");
 // T-02: no overview band; zoomed far out the mid layout just renders smaller, with every box.
 for (let i = 0; i < 6; i++) await browser("click", "#zoom-out");
 assert.equal(await evaluate("document.getElementById(\"diagram\").dataset.band"), "mid", "no overview band");
 assert.equal(await evaluate("document.querySelectorAll(\"[data-node]\").length"), sample.nodes.length);
 await browser("click", "#zoom-fit");
 assert.equal(await evaluate("document.getElementById(\"diagram\").dataset.band"), "mid");
 assert.equal(await evaluate("document.querySelectorAll(\"[data-node]\").length"), sample.nodes.length);
 // Focus mode: cross-group edges collapse into one bundle until an end is hovered or selected.
 const shown = id => evaluate(`getComputedStyle(document.querySelector("[data-edge=${id}]")).display !== "none"`);
 assert(await evaluate("document.querySelectorAll(\".bundle-edge\").length > 0")); assert.equal(await shown("web_client__load_balancer"), false, "bundled edge hidden by default");
 assert.equal(await evaluate("getComputedStyle(document.querySelector(\"[data-edge=storage__cdn] .edge-label\")).display"), "none", "mid band hides edge labels");
 await browser("focus", "[data-node=web_client]");
 assert.equal(await shown("web_client__load_balancer"), true, "hover reveals the node's edges");
 assert(await evaluate("document.getElementById(\"diagram\").classList.contains(\"focusing\") && document.querySelector(\"[data-node=load_balancer]\").classList.contains(\"lit\") && !document.querySelector(\"[data-node=worker]\").classList.contains(\"lit\")"), "neighbors lit, others dim");
 await browser("focus", "#zoom-fit");
 // E-02: pending marks are drawn red, removed edges get an X, group colors inherit, pending edges are never bundled.
 {
  const saved = diagram, marked = structuredClone(diagram), mark = (list, id, value) => Object.assign(marked[list].find(item => item.id === id), value);
  mark("nodes", "worker", { edit: "add" }); mark("nodes", "metadata_db", { edit: "remove" }); mark("nodes", "processing", { color: 4 });
  mark("edges", "web_client__load_balancer", { edit: "remove" }); marked.revision = saved.revision + 100;
  diagram = marked; publish("diagram", { target: { kind: "plan", id: "12345678" }, diagram });
  await browser("wait", "--fn", `document.getElementById("diagram").dataset.revision === "${marked.revision}"`);
  assert(await evaluate("!!document.querySelector('[data-node=worker].pending-add .pending-outline') && !!document.querySelector('[data-node=metadata_db].pending-remove .pending-x')"), "pending boxes outlined, removed box crossed");
  assert(await evaluate("!!document.querySelector('[data-edge=web_client__load_balancer].pending-remove .pending-x')"), "removed edge has an X");
  assert.equal(await evaluate("document.querySelector('[data-node=processing] .group-label').classList.contains('tone-4') && [...document.querySelectorAll('[data-node=queue] path')].some(path => path.getAttribute('stroke') === '#1098ad')"), true, "a group's color reaches its boxes");
  await browser("focus", "[data-node=storage]");
  assert.equal(await shown("web_client__load_balancer"), true, "a pending cross-group edge stays visible with focus elsewhere");
  diagram = saved; publish("diagram", { target: { kind: "plan", id: "12345678" }, diagram });
  await browser("wait", "--fn", `document.getElementById("diagram").dataset.revision === "${diagram.revision}"`);
  await browser("focus", "#zoom-fit");
 }
 assert.equal(await shown("web_client__load_balancer"), false, "leaving the node restores the calm view");
 await browser("press", "Escape"); const lb = await evaluate("(() => { const r = document.querySelector(\"[data-node=load_balancer]\").getBoundingClientRect(); return { x: Math.round(r.x + 6), y: Math.round(r.bottom - 6) }; })()"); await browser("mouse", "move", String(lb.x), String(lb.y)); await browser("mouse", "down", "left"); await browser("mouse", "up", "left"); await browser("focus", "#zoom-fit");
 assert.equal(await shown("web_client__load_balancer"), true, "a clicked box stays in focus");
 await browser("mouse", "move", "2", "2"); await browser("press", "Escape"); assert.equal(await shown("web_client__load_balancer"), false, "Escape clears focus");
 { const hub_ = (body) => fetch(`${origin}/s/${id}/api/hub`, { method: "POST", headers: { authorization: `Bearer ${hub.config.localKey}`, origin, "content-type": "application/json" }, body: JSON.stringify({ action: "settings", ...body }) });
  { const { idleParkMinutes, icon, usageHidden } = await (await hub_({ idleParkMinutes: 5, icon: "house", usageHidden: ["glm", "codex:5h"] })).json();
  assert.deepEqual({ idleParkMinutes, icon, usageHidden }, { idleParkMinutes: 5, icon: "house", usageHidden: ["glm", "codex:5h"] }, "gear settings save"); }
  assert.equal((await hub_({ usageHidden: ["nope:5h"] })).status, 400, "window keys name a known provider");
  assert.equal((await hub_({ idleParkMinutes: -1 })).status, 400);
  await hub_({ idleParkMinutes: 0, icon: "", usageHidden: [] }); }
 { const r = await fetch(`${origin}/s/${id}/api/paste`, { method: "POST", headers: { authorization: `Bearer ${hub.config.localKey}`, origin }, body: "<svg onload=alert(1)>" }); assert.match((await r.json()).error, /PNG, JPEG/, "non-image paste rejected by magic bytes"); }
 // Clipboard image paste: saved as a temp file, path inserted into the draft.
 await evaluate("(() => { const data = new DataTransfer(); data.items.add(new File([Uint8Array.from(atob(\"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==\"), c => c.charCodeAt(0))], \"shot.png\", { type: \"image/png\" })); document.getElementById(\"message-input\").dispatchEvent(new ClipboardEvent(\"paste\", { clipboardData: data, bubbles: true, cancelable: true })); })()");
 await browser("wait", "--fn", "/pi-clipboard-[0-9a-f-]+\\.png/.test(document.getElementById(\"message-input\").value)");
 const pasted = (await evaluate("document.getElementById(\"message-input\").value")).trim();
 assert.deepEqual([...(await readFile(pasted))].slice(0, 8), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
 // Its thumbnail under the box opens the annotator; a marker's note goes into the box as text after the new image's path.
 await browser("click", "#composer-thumbs .composer-thumb"); await browser("wait", "dialog.annotate[open] canvas");
 await browser("click", ".annotate-tool[aria-label^=Numbered]"); await browser("click", "dialog.annotate canvas");
 await browser("wait", "--fn", "document.activeElement?.className === 'annotate-note'"); // a clicked marker opens its note box, ready to type
 await browser("press", "Escape"); assert.equal(await evaluate("document.querySelectorAll('.annotate-legend li').length"), 0, "Escape on a fresh marker drops it");
 await browser("press", "3"); await browser("wait", "--fn", "document.activeElement?.className === 'annotate-note'"); await browser("fill", ".annotate-note", "red mark"); await browser("press", "Enter");
 assert.equal(await evaluate("document.querySelector('.annotate-legend').textContent"), "(3) red mark");
 await browser("click", ".annotate-save"); await browser("wait", "--fn", `(v => v.includes(".png\\n(3) red mark") && !v.includes(${JSON.stringify(pasted)}))(document.getElementById("message-input").value)`);
 assert.equal(await evaluate("!!document.querySelector('dialog.annotate')"), false, "the dialog is removed after saving");
 await evaluate(`(() => { const input = document.getElementById("message-input"); input.value = ${JSON.stringify(pasted + " ")}; input.dispatchEvent(new Event("input")); })()`);
	// Image and Markdown paths in chat become links; images also show as thumbnails. Only temp-folder and project images are served.
 { const row = { id: "img_row", role: "agent", text: `look ${pasted}, see docs/notes.md. and ${process.platform === "win32" ? "C:\\Windows\\Web\\x.png" : "/etc/x.png"}`, streaming: false }; chatRows.set(row.id, row); publish("message", row); }
 await browser("wait", "[data-id=img_row] .thumb img");
 const verified = row => browser("wait", "--fn", `!document.querySelector('[data-id=${row}] a.file-link:not([data-full])')`);
 await verified("img_row"); // files the hub cannot find (x.png) stay plain text
 assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-id=img_row] .file-link')].map(a => a.textContent.split(/[\\\\/]/).pop())"), [pasted.split(/[\\/]/).pop(), "notes.md"]);
 assert(await evaluate("document.querySelector('[data-id=img_row]').textContent.includes('x.png')"));
 assert.deepEqual(await evaluate("(async () => { const [ok] = [...document.querySelectorAll('[data-id=img_row] .file-link')].map(a => a.getAttribute('href')); const a = await fetch(ok), b = await fetch(ok + '&download=1'), c = await fetch(ok.replace(/\\.png/, '.txt')); return [a.status, a.headers.get('content-type'), a.headers.get('content-disposition').split(';')[0], b.headers.get('content-disposition').split(';')[0], c.status]; })()"), [200, "image/png", "inline", "attachment", 404]);
 { // Hidden files are never shared; text (even HTML) is served as sandboxed plain text.
  const { found } = await (await fetch(`${origin}/s/${id}/api/paths`, { method: "POST", headers: { authorization: `Bearer ${hub.config.localKey}`, origin, "content-type": "application/json" }, body: JSON.stringify({ paths: ["docs/notes.md", ".gitignore", "top.txt", "nope.txt"] }) })).json();
  assert.deepEqual(Object.keys(found).sort(), ["docs/notes.md", "top.txt"]); assert.equal(found["top.txt"], fs.realpathSync(join(folder, "top.txt")));
  const text = await fetch(`${origin}/s/${id}/api/download?path=top.txt`, { headers: { authorization: `Bearer ${hub.config.localKey}` } });
  assert.equal(text.headers.get("content-type"), "text/plain; charset=utf-8"); assert.match(text.headers.get("content-security-policy"), /^sandbox/);
  // A remote device gets only the project, plus temp/Downloads files from the last 5 days.
  const { linkedFile } = await import("../src/linked-files.ts"), old = join(os.tmpdir(), `hub-old-${process.pid}.txt`);
  const oldImage = old.replace(/txt$/, "png"); fs.writeFileSync(oldImage, "x"); fs.utimesSync(oldImage, 0, 0); assert(await linkedFile(oldImage, folder, true), "images open remotely from anywhere"); fs.rmSync(oldImage);
  fs.writeFileSync(old, "x"); fs.utimesSync(old, new Date(Date.now() - 6 * 864e5), new Date(Date.now() - 6 * 864e5));
  assert.deepEqual([!!await linkedFile("top.txt", folder, true), !!await linkedFile(pasted, folder, true), !!await linkedFile(old, folder, true), !!await linkedFile(old, folder, false), !!await linkedFile(process.execPath, folder, true)], [true, true, false, true, false]);
  fs.rmSync(old);
  // Wormhole upload takes only what Download would serve (no network here: every request is refused before it starts).
  const upload = body => fetch(`${origin}/s/${id}/api/upload`, { method: "POST", headers: { authorization: `Bearer ${hub.config.localKey}`, origin, "content-type": "application/json" }, body: JSON.stringify(body) }).then(r => r.status);
  assert.deepEqual([await upload({ path: ".gitignore" }), await upload({ path: "nope.txt" }), await upload({ path: "top.txt", pack: "rar" })], [404, 404, 400]);
 }
 // Right-click on this PC offers Open, Open folder, Copy path and the Wormhole uploads (a click would open the file with its app).
 await evaluate("document.querySelector('[data-id=img_row] .file-link').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))");
 assert.deepEqual((await evaluate("[...document.querySelectorAll('.session-menu:not([hidden]) button')].map(b => b.textContent)")).filter(text => text !== "7z and upload"), ["Open", "Open folder", "Copy path", "Upload", "Zip and upload"]);
 await evaluate("document.querySelector('.session-menu').hidden = true");
 // Web addresses link too, without the Markdown bold around them.
 { const row = { id: "url_row", role: "agent", text: "Here's the link: **http://127.0.0.1:8768/index.html** (it's running now).", streaming: false }; chatRows.set(row.id, row); publish("message", row); }
 await browser("wait", "[data-id=url_row] a.chat-link");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-id=url_row] a.chat-link')].map(a => [a.getAttribute('href'), a.target])"), [["http://127.0.0.1:8768/index.html", "_blank"]]);
 // Markdown subset: bold, inline code and tables render as elements, not raw ** and pipes.
 { const row = { id: "md_row", role: "agent", text: "**Load:** use `Thread.Yield`\n\n| Setup | echo |\n|---|---|\n| RF | **5 ms** |\n\nafter *slow* _fast_ snake_case_name [docs](https://example.com/a) [bad](javascript:alert(1))", streaming: false }; chatRows.set(row.id, row); publish("message", row); }
 await browser("wait", "[data-id=md_row] table");
 assert.deepEqual(await evaluate("(() => { const m = document.querySelector('[data-id=md_row]'); return [m.querySelector('b').textContent, m.querySelector('code').textContent, [...m.querySelectorAll('th,td')].map(c => c.textContent), m.textContent.includes('**') || m.textContent.includes('|'), [...m.querySelectorAll('i')].map(i => i.textContent), m.textContent.includes('snake_case_name'), [...m.querySelectorAll('a.chat-link')].map(a => [a.textContent, a.getAttribute('href')]), m.textContent.includes('](')]; })()"), ["Load:", "Thread.Yield", ["Setup", "echo", "RF", "5 ms"], false, ["slow", "fast"], true, [["docs", "https://example.com/a"]], false]);
 // Quoted or backticked paths may hold spaces (and _ that is not italics); file:/// URLs link to their decoded path.
 {
  const spaced = join(pasted, "..", "_pi_ hub spaces", "shot one.png"), decoded = spaced.replaceAll("\\", "/"), fileUrl = "file:///" + decoded.replace(/^\//, "").replaceAll(" ", "%20"), bare = process.platform === "win32" ? "C:\\tmp\\a.png" : "/tmp/a.png";
  fs.mkdirSync(join(spaced, ".."), { recursive: true }); fs.copyFileSync(pasted, spaced);
  const row = { id: "space_row", role: "agent", text: `quoted "${spaced}" and \`${spaced}\` and ${fileUrl}. [pic](${fileUrl}) "docs/my notes.md" "/review docs/plan.md" \`/review docs/plan.md\` "see docs/notes.md" "hello world" file:///C:/archive.png/photo.png file:///C:/a.txt my shot one.png "oops ${bare}\n\n\`\`\`\nsaved "${spaced}"\n\`\`\``, streaming: false }; chatRows.set(row.id, row); publish("message", row);
  await browser("wait", "--fn", "[...document.querySelectorAll('[data-id=space_row] .thumb img')].some(img => img.naturalWidth > 0)");
  await verified("space_row");
  assert.deepEqual((await evaluate("[...document.querySelectorAll('[data-id=space_row] .file-link')].map(a => a.textContent)")).filter(text => text !== bare), [spaced, spaced, decoded, "pic", "docs/notes.md", spaced], "quoted and file:/// paths link whole; missing files stay text");
  const hrefs = await evaluate("[...document.querySelectorAll('[data-id=space_row] .file-link')].map(a => a.getAttribute('href'))");
  assert(hrefs[0].startsWith("api/download?path=" + encodeURIComponent(spaced)) && hrefs[2].startsWith("api/download?path=" + encodeURIComponent(decoded)) && hrefs[3] === hrefs[2], "links go to the exact path");
  assert.deepEqual(await evaluate(`Promise.all(${JSON.stringify([hrefs[0], hrefs[2]])}.map(async href => { const r = await fetch(href); return [r.status, r.headers.get('content-type')]; }))`), [[200, "image/png"], [200, "image/png"]]);
  assert(await evaluate("document.querySelector('[data-id=space_row]').textContent.includes('\"hello world\"')"), "quoted plain text stays text");
  fs.rmSync(join(spaced, ".."), { recursive: true, force: true });
 }
 // Tool output paths link too; their thumbnails sit under the collapsed block, and an unservable one is dropped.
 { const row = { id: "tool_img_row", role: "assistant", text: "", streaming: false, blocks: [{ type: "tool", id: "t1", name: "screen_read", title: "screen_read", args: "{}", result: `Saved ${pasted}\nlisted look-missing.png` }] }; chatRows.set(row.id, row); publish("message", row); }
 await browser("wait", "[data-id=tool_img_row] .thumb img");
 await browser("wait", "--fn", "document.querySelectorAll('[data-id=tool_img_row] .thumb').length === 1");
 await verified("tool_img_row");
 assert.deepEqual(await evaluate("[document.querySelector('[data-id=tool_img_row] details').open, [...document.querySelectorAll('[data-id=tool_img_row] pre .file-link')].map(a => a.textContent.split(/[\\\\/]/).pop())]"), [false, [pasted.split(/[\\/]/).pop()]], "tool output paths are links, thumbnails visible while collapsed");
 await browser("click", "#tab-plan");
 chatRows.delete("img_row"); chatRows.delete("tool_img_row"); await rm(pasted);
 // The Image button (phones have no clipboard paste) uploads the same way.
 await browser("fill", "#message-input", "");
 await evaluate("(() => { const data = new DataTransfer(); data.items.add(new File([new Uint8Array([0xff,0xd8,0xff,0xe0,1,2])], \"photo.jpg\", { type: \"image/jpeg\" })); const input = document.getElementById(\"attach\"); input.files = data.files; input.dispatchEvent(new Event(\"change\")); })()");
 await browser("wait", "--fn", "/pi-clipboard-[0-9a-f-]+\\.jpg/.test(document.getElementById(\"message-input\").value)");
 const attached = (await evaluate("document.getElementById(\"message-input\").value")).trim();
 assert.equal(await evaluate("document.getElementById(\"attach\").value"), "", "the picker resets so the same photo can be attached again"); await rm(attached);
 await browser("fill", "#message-input", "");
 await browser("focus", "#diagram");
 // The fit scale depends on box sizes, so zoom until the near band rather than a fixed number of steps.
 for (let i = 0; i < 8 && await evaluate("document.getElementById(\"diagram\").dataset.band") !== "near"; i++) await browser("press", "+");
 assert.equal(await evaluate("document.getElementById(\"diagram\").dataset.band"), "near");
 assert(await evaluate("document.getElementById(\"diagram\").textContent.includes(\"POST /uploads\")"));
 const beforePan = await evaluate("document.getElementById(\"diagram\").firstElementChild.getAttribute(\"transform\")");
 await browser("press", "ArrowLeft");
 assert.notEqual(await evaluate("document.getElementById(\"diagram\").firstElementChild.getAttribute(\"transform\")"), beforePan);
 // Fit/mid keeps the actual node in the viewport for a pointer drag.
 await browser("click", "#zoom-fit"); await browser("click", "#zoom-in");
 const strokeBefore = await evaluate("document.querySelector(\"[data-node=web_client] path\").getAttribute(\"d\")");
 const panBefore = await evaluate("document.getElementById(\"diagram\").firstElementChild.getAttribute(\"transform\")");
 const canvasTop = await evaluate("Math.round(document.getElementById(\"diagram\").getBoundingClientRect().top)"), canvasLeft = await evaluate("Math.round(document.getElementById(\"diagram\").getBoundingClientRect().left)");
 // Start the pan on a point no box covers (the tab bar height moves what fit puts at the corner).
 const [panX, panY] = await evaluate("(() => { const r = document.getElementById('diagram').getBoundingClientRect(); for (let y = r.top + 8; y < r.bottom; y += 12) for (let x = r.left + 8; x < r.right; x += 12) { const hit = document.elementFromPoint(x, y); if (hit?.closest('#diagram') && !hit.closest('[data-node]:not(.group-node), [data-edge], [data-note]')) return [Math.round(x), Math.round(y)]; } })()");
 await browser("mouse", "move", String(panX), String(panY)); await browser("mouse", "down", "left");
 await browser("mouse", "move", String(panX + 25), String(panY + 25)); await browser("mouse", "up", "left");
 assert.notEqual(await evaluate("document.getElementById(\"diagram\").firstElementChild.getAttribute(\"transform\")"), panBefore);
 assert.equal(await evaluate("document.querySelector(\"[data-node=web_client] path\").getAttribute(\"d\")"), strokeBefore, "fixed seeds keep redraw strokes stable");
 const nodePoint = await evaluate("(() => { const r = document.querySelector(\"[data-node=web_client]\").getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()");
 assert.equal(await evaluate(`document.elementFromPoint(${nodePoint.x}, ${nodePoint.y})?.closest("[data-node]")?.getAttribute("data-node")`), "web_client", "drag must hit the actual visible node");
 // E-04: a plain drag on a box moves it (Shift+drag, CDP modifier 8, still moves too; agent-browser has no held keys).
 const shiftDrag = (from, modifiers = 8) => withPageCdp(origin, async send => { for (const [type, at, buttons] of [["mouseMoved", from, 0], ["mousePressed", from, 1], ["mouseMoved", { x: from.x + 15, y: from.y - 10 }, 1], ["mouseMoved", { x: from.x + 30, y: from.y - 20 }, 1], ["mouseReleased", { x: from.x + 30, y: from.y - 20 }, 0]]) await send("Input.dispatchMouseEvent", { ...at, type, modifiers, buttons, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) }); });
 // shortcut: a fresh CDP connection right after agent-browser input sometimes drops the whole gesture (no request is sent, seen
 // 2 in 5 runs against the hub), so a drag with no effect is retried once; retry more only if that stops being enough.
 const dragUntil = async (from, done, modifiers) => { for (let attempt = 0; attempt < 2; attempt++) { await shiftDrag(from, modifiers); for (let i = 0; i < 30; i++) { if (await evaluate(done)) return; await new Promise(r => setTimeout(r, 100)); } } assert.fail("drag had no effect: " + done); };
 const panBox = await evaluate("document.getElementById(\"diagram\").firstElementChild.getAttribute(\"transform\")");
 // Settle first: the agent-browser drag just above and this fresh CDP input connection can race (seen 1 in ~10 runs).
 await new Promise(done => setTimeout(done, 1000)); await dragUntil(nodePoint, "document.getElementById(\"diagram\").dataset.revision === \"2\"", 0);
 assert.equal(await evaluate("document.getElementById(\"diagram\").firstElementChild.getAttribute(\"transform\")"), panBox, "plain drag on a box moves it, not the view");
 assert.equal(edits.length, 1); assert.equal(edits[0].id, "web_client"); assert.equal(edits[0].expectedRevision, 1);
 assert(Number.isFinite(diagram.nodes.find(node => node.id === "web_client").x));
 const savedPosition = { ...diagram.nodes.find(node => node.id === "web_client") }; diagram.revision++; persist(); // saved elsewhere meanwhile
 // Fit first so the box is on screen, then grab a visible part: the zoom controls may cover part of it.
 await browser("click", "#zoom-fit");
 const stalePoint = await evaluate("(() => { const r = document.querySelector(\"[data-node=web_client]\").getBoundingClientRect(); for (let y = r.y + 8; y < r.bottom; y += 8) for (let x = r.x + 8; x < r.right; x += 16) if (document.elementFromPoint(x, y)?.closest(\"[data-node=web_client]\")) return { x: Math.round(x), y: Math.round(y) }; })()");
 assert(stalePoint, "part of the box is visible"); await dragUntil(stalePoint, "document.getElementById(\"diagram\").dataset.revision === \"3\"");
 assert.equal(edits.length, 1); assert.deepEqual(diagram.nodes.find(node => node.id === "web_client"), savedPosition);
 assert(await evaluate("document.getElementById(\"notice\").textContent.includes(\"Positions were not saved\")"));
 await browser("press", "Escape");
 await browser("click", "#pin-note"); await browser("focus", "[data-node=web_client]"); await browser("press", "Enter"); // keyboard pin: the box may sit under the zoom bar after the drags
 assert(await evaluate("document.getElementById(\"comment-prompt\").open"));
 await browser("fill", "#comment-text", "Check <img src=x onerror=alert(1)> upload limits"); await browser("click", "#comment-save");
 await browser("wait", "--fn", "document.getElementById(\"diagram\").dataset.revision === \"4\"");
 assert.equal(comments[0].element, "web_client"); assert.equal(diagram.notes.at(-1).target, "web_client");
 await browser("focus", "[data-note=note_4]"); // focus shows the same card; the note may sit under the zoom bar
 assert(await evaluate("document.getElementById(\"hover-card\").textContent.includes(\"upload limits\")"));
 await browser("press", "Escape");
 await browser("click", "#pin-note");
 const commentCanvasTop = await evaluate("Math.round(document.getElementById(\"diagram\").getBoundingClientRect().top)");
 await browser("mouse", "move", String(canvasLeft + 8), String(commentCanvasTop + 8)); await browser("mouse", "down", "left"); await browser("mouse", "up", "left");
 assert(await evaluate("document.getElementById(\"comment-prompt\").open"), "canvas click must open the comment dialog");
 await browser("fill", "#comment-text", "Canvas follow-up"); await browser("click", "#comment-save");
 await browser("wait", "--fn", "document.getElementById(\"diagram\").dataset.revision === \"5\"");
 assert.equal(diagram.notes.at(-1).target, undefined); assert(Number.isFinite(comments[1].x));
 await browser("click", "#pin-note"); await browser("focus", "[data-edge=cdn__web_client]"); await browser("press", "Enter");
 await browser("fill", "#comment-text", "Check CDN invalidation"); await browser("click", "#comment-save");
 await browser("wait", "--fn", "document.getElementById(\"diagram\").dataset.revision === \"6\"");
 assert.equal(comments[2].element, "cdn__web_client"); assert.equal(diagram.notes.at(-1).target, "cdn__web_client");
 await browser("click", "#zoom-fit");
 await browser("focus", "[data-node=backend]");
 assert(await evaluate("document.getElementById(\"hover-card\").textContent.includes(\"Multipart above 100 MB\")"), "a group's card shows descendant comments");
 await browser("press", "Escape");
 for (let i = 0; i < 10 && await evaluate("document.getElementById(\"diagram\").dataset.band") !== "near"; i++) await browser("click", "#zoom-in");
 assert.equal(await evaluate("document.getElementById(\"diagram\").dataset.band"), "near");
 assert(await evaluate("document.querySelectorAll(\"foreignObject .note-text\").length >= 6"));
 assert.equal(await evaluate("document.querySelector(\"foreignObject img\")"), null, "note markup stays inert text");
 await browser("fill", "#message-input", "half-written draft");
 await browser("reload"); await browser("wait", "--fn", "document.getElementById(\"diagram\").dataset.revision === \"6\"");
 assert.equal(await evaluate("document.getElementById('message-input').value"), "half-written draft", "unsent draft survives leaving the page");
 await browser("fill", "#message-input", "");
 assert.deepEqual(diagram.nodes.find(node => node.id === "web_client"), savedPosition, "saved drag survives the full snapshot after reload");
 assert.equal(await evaluate("document.querySelectorAll(\"[data-note]\").length"), 6, "saved notes survive reload");
 await browser("click", "#zoom-fit"); await browser("click", "#zoom-in");
 // Search: Ctrl+F focuses it, matches stay lit, Enter centers the next match (brings the box out from under the zoom bar).
 await browser("focus", "#diagram"); await browser("press", "Control+f"); assert.equal(await evaluate("document.activeElement.id"), "search");
 await browser("fill", "#search", "web client"); assert(await evaluate("document.getElementById(\"diagram\").classList.contains(\"searching\") && document.querySelector(\"[data-node=web_client]\").classList.contains(\"match\") && !document.querySelector(\"[data-node=worker]\").classList.contains(\"match\")"));
 await browser("press", "Enter"); await browser("press", "Escape"); assert.equal(await evaluate("document.getElementById(\"diagram\").classList.contains(\"searching\")"), false);
 // Right-click a box: a centred popup adds "@id: note" as a message line; several notes plus a closing request go out as one message.
 const notePoint = await evaluate("(() => { const r = document.querySelector(\"[data-node=web_client]\").getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 12) }; })()");
 await withPageCdp(origin, async send => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { ...notePoint, type, ...(type === "mouseMoved" ? {} : { button: "right", buttons: type === "mousePressed" ? 2 : 0, clickCount: 1 }) }); });
 assert(await evaluate("document.getElementById('comment-prompt').open && document.getElementById('comment-title').textContent === 'Note on @web_client'"), "right-click opens the note popup");
 const messagesBeforeNote = messages.length, commentsBeforeNote = comments.length;
 await browser("keyboard", "type", "retry budget"); await browser("press", "Enter");
 assert.deepEqual(await evaluate("[document.getElementById('comment-prompt').open, document.getElementById('message-input').value]"), [false, "@web_client: retry budget\n"]);
 await withPageCdp(origin, async send => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { ...notePoint, type, ...(type === "mouseMoved" ? {} : { button: "right", buttons: type === "mousePressed" ? 2 : 0, clickCount: 1 }) }); });
 await browser("keyboard", "type", "and a timeout"); await browser("press", "Enter");
 assert.equal(messages.length, messagesBeforeNote, "notes wait in the composer until sent");
 await browser("mouse", "move", "2", "2"); // the pointer left on the box keeps its hover card over the chat
 await browser("focus", "#message-input"); await browser("keyboard", "type", "Please apply these."); await browser("press", "Enter");
 await browser("wait", "--fn", "document.getElementById('message-input').value === ''");
 assert.equal(messages.at(-1).text, "@web_client: retry budget\n@web_client: and a timeout\nPlease apply these.", "notes and the closing request go as one message");
 assert.equal(comments.length, commentsBeforeNote, "right-click notes are not pinned to the diagram");
 // Bookmarks: Ctrl+Shift+N saves the box text, Ctrl+N puts it back; the star window lists them.
 await browser("fill", "#message-input", "Run the targeted tests"); await browser("press", "Control+Shift+Digit3");
 await browser("fill", "#message-input", ""); await browser("press", "Control+Digit3");
 assert.equal(await evaluate("document.getElementById('message-input').value"), "Run the targeted tests", "Ctrl+3 inserts bookmark 3");
 await browser("click", "#bookmarks-button"); assert.equal(await evaluate("document.querySelectorAll('.bookmark-use')[2].textContent"), "3Run the targeted tests");
 await evaluate("document.getElementById('bookmarks').close()"); await browser("fill", "#message-input", "");
 // Hovering the sidebar file counts lists the changed files.
 assert.match(await evaluate("document.querySelector('.session-git-files')?.textContent"), /Modified.*src\/app\.ts/, "the hover list names the changed file under its kind");
 // Prompt history: ↑ at the start of the box recalls the last prompt; after a stopped run it opens in edit mode (orange),
 // and Send first drops it from the context, then posts the fix.
 await evaluate("(() => { const real = window.fetch; window.drops = []; window.fetch = (url, init) => String(url).endsWith('api/drop') ? (window.drops.push(JSON.parse(init.body).text), Promise.resolve(new Response(JSON.stringify({ ok: true })))) : real(url, init); })()");
 publish("message", { id: "assistant_stop", role: "assistant", text: "", error: "Request was aborted", streaming: false });
 await browser("press", "ArrowUp"); assert.equal(await evaluate("document.getElementById('message-input').value"), "", "the first ↑ at the top only arms history");
 await browser("press", "ArrowUp"); assert.match(await evaluate("document.getElementById('history-when').textContent"), /./, "the recalled message shows when it was sent");
 assert.deepEqual(await evaluate("[document.getElementById('message-input').value.endsWith('Please apply these.'), document.getElementById('message-input').classList.contains('editing-last')]"), [true, true], "↑ recalls the stopped prompt in edit mode");
 await evaluate("(b => b.setSelectionRange(b.value.length, b.value.length))(document.getElementById('message-input'))"); await browser("press", "ArrowDown"); assert.equal(await evaluate("document.getElementById('message-input').value"), "", "↓ past the newest returns to the draft");
 // Escape: a recalled prompt goes back to the (empty) draft; typed text is cleared; nothing is stopped while text was there.
 await browser("press", "ArrowUp"); await browser("press", "ArrowUp"); await browser("press", "Escape");
 assert.deepEqual(await evaluate("[document.getElementById('message-input').value, document.getElementById('message-input').classList.contains('editing-last')]"), ["", false], "Escape leaves a recalled prompt");
 await browser("type", "#message-input", "typo"); await browser("press", "Escape"); assert.equal(await evaluate("document.getElementById('message-input').value"), "", "Escape clears typed text");
 await browser("press", "ArrowUp"); await browser("press", "ArrowUp"); await browser("fill", "#message-input", "Please apply only the first."); await browser("press", "Enter");
 await browser("wait", "--fn", "document.getElementById('message-input').value === ''");
 assert.deepEqual([await evaluate("window.drops.at(-1)?.endsWith('Please apply these.')"), messages.at(-1).text], [true, "Please apply only the first."], "Send drops the stopped prompt, then posts the edit");
 await withPageCdp(origin, send => send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }));
 assert(await evaluate("matchMedia(\"(prefers-reduced-motion: reduce)\").matches"));
 assert.equal(await evaluate("getComputedStyle(document.getElementById(\"diagram\")).animationDuration"), "0s");
 await browser("focus", "#zoom-in"); await browser("press", "Tab");
 assert.equal(await evaluate("document.activeElement.id"), "zoom-fit");
 assert.equal(await evaluate("getComputedStyle(document.activeElement).outlineWidth"), "2px", "keyboard focus is visibly outlined");
 const reply = { id: "assistant_1", role: "assistant", text: "Reviewing", at: new Date().toISOString(), streaming: true };
 chatRows.set(reply.id, reply); publish("message", reply);
 await browser("wait", "--fn", "document.getElementById(\"messages\").textContent.includes(\"Reviewing\")");
 reply.text = "Reviewing upload limits: complete."; reply.streaming = false; publish("message", reply);
 await browser("wait", "--fn", "document.getElementById(\"messages\").textContent.includes(\"complete.\")");
 assert.equal(await evaluate("document.querySelectorAll(\"#messages [data-id=assistant_1]\").length"), 1, "stream updates reuse their row");
 publish("message", { id: "assistant_2", role: "assistant", text: "Short excerpt", streaming: false, excerpt: true });
 // The turn's final reply loads in full by itself and stands out; the earlier agent text is no longer final.
 await browser("wait", "--fn", "document.getElementById(\"messages\").textContent.includes(\"Full body loaded\")");
 assert(await evaluate("document.querySelector(\"#messages [data-id=assistant_2] .row-full\").hidden"), "expanded row drops the excerpt link");
 assert(await evaluate("document.querySelector(\"#messages [data-id=assistant_2]\").classList.contains(\"final\") && !document.querySelector(\"#messages [data-id=assistant_1]\").classList.contains(\"final\")"), "only the last reply is final");
 // Compact chat hides in-between agent text but keeps the final reply; the choice is remembered. Full → Thinking → Compact.
 await browser("click", "#chat-compact"); await browser("click", "#chat-compact");
 assert.equal(await evaluate("getComputedStyle(document.querySelector(\"#messages [data-id=assistant_1]\")).display"), "none", "compact hides in-between agent text");
 assert.notEqual(await evaluate("getComputedStyle(document.querySelector(\"#messages [data-id=assistant_2]\")).display"), "none", "compact keeps the final reply");
 assert.equal(await evaluate("localStorage.getItem(\"plan3-chat\")"), "compact");
 await browser("click", "#chat-compact");
 assert.equal(await evaluate("document.getElementById(\"chat-compact\").textContent"), "Full", "the third click returns to Full");
 const rowText = id => evaluate(`document.querySelector("#messages [data-id=${id}]").children[2].textContent`);
 publish("delta", { id: "assistant_3", role: "assistant", offset: 0, text: "Hel", streaming: true });
 publish("delta", { id: "assistant_3", role: "assistant", offset: 3, text: "lo", streaming: true });
 publish("delta", { id: "assistant_3", role: "assistant", offset: 1, text: "e", streaming: true });
 await browser("wait", "--fn", "document.querySelector(\"#messages [data-id=assistant_3]\")?.children[2].textContent === \"Hello\"");
 publish("delta", { id: "assistant_3", role: "assistant", offset: 5, text: " world", streaming: false });
 await browser("wait", "--fn", "document.querySelector(\"#messages [data-id=assistant_3]\")?.children[2].textContent === \"Hello world\"");
 publish("delta", { id: "assistant_3", role: "assistant", offset: 99, text: "x", streaming: false });
 await browser("wait", "--fn", "document.querySelector(\"#messages [data-id=assistant_3]\")?.children[2].textContent.includes(\"Full body loaded\")");
 assert.equal(await rowText("assistant_3"), "Short excerpt. Full body loaded.", "a gap refetches the row; stale deltas never duplicate text");
 // Chat search: Ctrl+F opens it, hits are counted and marked, Enter wraps around, Esc closes.
 await evaluate("document.getElementById('message-input').focus(); dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))");
 await evaluate("const input = document.getElementById('chat-find'); input.value = 'loaded'; input.dispatchEvent(new Event('input'))");
 assert.equal(await evaluate("document.getElementById('chat-find-count').textContent"), "2/2", "both shown rows hit; the newest is current");
 assert.equal(await evaluate("CSS.highlights.get('chat-hit-current').size"), 1, "the current hit is marked");
 await evaluate("document.getElementById('chat-find').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))");
 assert.equal(await evaluate("document.getElementById('chat-find-count').textContent"), "1/2", "next wraps around to the first");
 await evaluate("document.getElementById('chat-find').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
 assert(await evaluate("document.getElementById('chat-search').hidden && CSS.highlights.get('chat-hit').size === 0"), "Esc closes and clears marks");
 // A hit crosses bold/code/link text within a block, never a row; Unicode case folding never shifts the marks.
 const findRow = { id: "assistant_find", role: "assistant", text: "Split **bo**ld, `co`de and [li](https://example.com/x)nk; \u0130\u0130 tail \u03a3\u0391\u03a3 GRO\u1e9e stra\u00dfe zq", streaming: false };
 const nextRow = { id: "assistant_find2", role: "assistant", text: "xw \u0130", streaming: false };
 for (const row of [findRow, nextRow]) { chatRows.set(row.id, row); publish("message", row); }
 await browser("wait", "--fn", "document.querySelector('#messages [data-id=assistant_find2]')?.textContent.includes('xw')");
 await evaluate("dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))");
 const find = query => evaluate(`(() => { const input = document.getElementById('chat-find'); input.value = ${JSON.stringify(query)}; input.dispatchEvent(new Event('input')); const hit = [...CSS.highlights.get('chat-hit-current')][0]; return [document.getElementById('chat-find-count').textContent, hit?.toString() ?? null, hit ? hit.startContainer !== hit.endContainer : null]; })()`);
 assert.deepEqual(await find("BOLD"), ["1/1", "bold", true], "a hit crosses bold text");
 assert.deepEqual(await find("code"), ["1/1", "code", true], "a hit crosses inline code");
 assert.deepEqual(await find("link"), ["1/1", "link", true], "a hit crosses a link");
 assert.deepEqual(await find("tail"), ["1/1", "tail", false], "\u0130 lowercasing to two units does not shift later marks");
 assert.deepEqual(await find("\u03c3\u03b1\u03c2"), ["1/1", "\u03a3\u0391\u03a3", false], "Greek sigma forms match case-insensitively");
 assert.deepEqual(await find("gro\u00df"), ["1/1", "GRO\u1e9e", false], "\u00df finds capital \u1e9e");
 assert.deepEqual(await find("STRA\u1e9eE"), ["1/1", "stra\u00dfe", false], "capital \u1e9e finds \u00df");
 assert.deepEqual(await find("\u1e9e"), ["2/2", "\u00df", false], "\u1e9e and \u00df both hit, each marked whole");
 assert.deepEqual(await find("zqxw"), ["0", null, null], "no hit spans two rows");
 assert.deepEqual(await find("zq"), ["1/1", "zq", false]);
 assert.deepEqual(await find("\ud800"), ["0", null, null], "a lone surrogate finds nothing and does not throw");
 assert.deepEqual(await find("\u0130"), ["3/3", "\u0130", false]);
 // Streaming re-renders the row with the current hit; the search stays on that hit.
 await evaluate("document.getElementById('chat-find').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))");
 assert.equal(await evaluate("document.getElementById('chat-find-count').textContent"), "2/3");
 findRow.text += " \u0130 more"; publish("message", findRow);
 await browser("wait", "--fn", "document.getElementById('chat-find-count').textContent === '2/4'");
 assert.equal(await evaluate("[...CSS.highlights.get('chat-hit-current')][0].startContainer.parentElement.closest('li').dataset.id"), "assistant_find", "the current hit survives its row re-rendering");
 // Id-less activity lines keep their selected hit through chat updates and activity re-renders.
 publish("activity", { error: "qvq qvq" }); await browser("wait", "--fn", "document.querySelector('#activity .activity-error')?.textContent === 'qvq qvq'");
 assert.deepEqual(await find("qvq"), ["2/2", "qvq", false]);
 await evaluate("document.querySelector('#chat-search [data-find=first]').click()");
 nextRow.text += " again"; publish("message", nextRow); await browser("wait", "--fn", "document.querySelector('#messages [data-id=assistant_find2]').textContent.includes('again')");
 publish("activity", { error: "qvq qvq", working: false }); await new Promise(resolve => setTimeout(resolve, 300));
 assert.equal(await evaluate("document.getElementById('chat-find-count').textContent"), "1/2", "an activity hit stays selected through unrelated updates");
 publish("activity", { error: null }); await browser("wait", "--fn", "!document.querySelector('#activity .activity-error')");
 await evaluate("document.querySelector('#chat-search [data-find=close]').click()");
 assert.equal(await evaluate("document.getElementById('chat-search').hidden"), true, "the close button closes the search");
 // Pi-style colour coding: tool blocks by state, an edit's diff instead of its arguments, labels only for screen readers.
 publish("message", { id: "assistant_4", role: "assistant", text: "", streaming: false, blocks: [
  { type: "thinking", text: "hmm" },
  { type: "tool", id: "t1", name: "edit", title: "edit a.ts", args: "{oldText}", result: "ok", diff: "-1 old\n+1 new\n 2 same" },
  { type: "tool", id: "t2", name: "bash", title: "bash ls", args: "{}", result: "boom", error: true },
  { type: "thinking", text: "more" },
  { type: "tool", id: "t3", name: "read", title: "read b.ts", args: "{}" }] });
 await browser("wait", "#messages [data-id=assistant_4] .block-tool");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('#messages [data-id=assistant_4] details')].map(item => item.className)"), ["block block-thinking", "block block-tool block-change block-ok", "block block-tool block-error", "block block-thinking", "block block-tool block-read block-pending"]);
 assert.deepEqual(await evaluate("[...document.querySelectorAll('#messages [data-id=assistant_4] .diff span')].map(span => span.className)"), ["diff-del", "diff-add", ""]);
 assert.equal(await evaluate("[...document.querySelectorAll('#messages [data-id=assistant_4] pre')].some(pre => pre.textContent === '{oldText}')"), false, "the diff replaces raw edit arguments");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('#messages [data-id=assistant_4] details')].map(item => item.open)"), [false, true, false, false, false], "only file changes start open");
 publish("message", { id: "user_0", role: "user", text: "hi", streaming: false }); await browser("wait", "#messages [data-id=user_0]");
 assert.deepEqual(await evaluate("['user_0', 'assistant_1'].flatMap(id => { const row = document.querySelector('#messages [data-id=' + id + ']'); return [row.querySelector('strong').className, getComputedStyle(row).backgroundColor !== 'rgba(0, 0, 0, 0)']; })"), ["sr-only", true, "sr-only", false], "your messages are a tinted block; the label is screen-reader only");
 await browser("click", "#zoom-fit"); await browser("click", "#zoom-in");
  // Search Enter centers the box, so the click point is clear of the zoom bar; Escape clears the search.
 await browser("fill", "#search", "web_client"); await browser("press", "Enter"); await browser("press", "Escape");
 const mentionPoint = await evaluate("(() => { const r = document.querySelector(\"[data-node=web_client]\").getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()");
 await evaluate("window.mentionEvents = []; for (const name of [\"pointerdown\", \"click\"]) document.addEventListener(name, event => window.mentionEvents.push({ name, trusted: event.isTrusted, ctrl: event.ctrlKey, node: event.target.closest(\"[data-node]\")?.dataset.node }), true)");
 const revisionBeforeMention = diagram.revision, movesBeforeMention = edits.length;
 await withPageCdp(origin, async send => { for (const [type, buttons] of [["mouseMoved", 0], ["mousePressed", 1], ["mouseReleased", 0]]) await send("Input.dispatchMouseEvent", { ...mentionPoint, type, modifiers: 2, ...(type === "mouseMoved" ? {} : { button: "left", buttons, clickCount: 1 }) }); });
 assert.deepEqual(await evaluate("window.mentionEvents"), [{ name: "pointerdown", trusted: true, ctrl: true, node: "web_client" }, { name: "click", trusted: true, ctrl: true, node: "web_client" }]);
 assert.equal(diagram.revision, revisionBeforeMention); assert.equal(edits.length, movesBeforeMention, "modified clicks cannot start a drag");
 assert.equal(await evaluate("document.getElementById(\"message-input\").value"), "@web_client ");
 await browser("fill", "#message-input", "@web_client @ghost person@cdn.example.com <img src=x onerror=alert(1)>");
 assert.equal(await evaluate("document.querySelectorAll(\".mention-chip\").length"), 2, "emails are not mentions");
 await browser("click", "#send"); await browser("wait", "--fn", "document.getElementById(\"message-input\").value === \"\"");
 assert(messages[0].text.includes("@web_client")); assert.equal(await evaluate("document.querySelector(\"#messages img\")"), null);
 // Leaving the page while a send is in flight must not restore the sent text from storage.
 let release; holdMessage = new Promise(resolve => release = resolve);
 await browser("fill", "#message-input", "Sent while leaving"); await browser("click", "#send");
 await browser("wait", "--fn", "document.getElementById(\"send\").disabled");
 assert.equal(await evaluate("localStorage.getItem('plan3-draft:' + location.pathname.split('/')[2])"), null, "a send in flight drops the stored draft");
 holdMessage = null; release(); await browser("wait", "--fn", "document.getElementById(\"message-input\").value === \"\"");
 rejectMessage = true; await browser("fill", "#message-input", "Keep this draft"); await browser("press", "Control+Enter");
 await browser("wait", "--fn", "document.getElementById(\"notice\").textContent.includes(\"draft is kept\")");
 assert.equal(await evaluate("document.getElementById(\"message-input\").value"), "Keep this draft");
 assert.equal(await evaluate("localStorage.getItem('plan3-draft:' + location.pathname.split('/')[2])"), "Keep this draft", "a failed send stores the draft again");
 ask({ question: "Pick a colour", context: "Single choice", options: [{ title: "Blue" }, { title: "Pink" }], allowMultiple: false, allowFreeform: true, allowComment: true });
 await browser("wait", "--fn", "document.getElementById(\"prompt\").open");
 assert.equal(await evaluate("document.querySelectorAll('#prompt-form textarea').length"), 1, "one text box, like the terminal");
 await browser("click", "#prompt-form input[value=Blue]"); await browser("fill", "#prompt-form textarea", "Matches the boxes"); await browser("click", "#prompt-form button[type=submit]");
 await browser("wait", "--fn", "!document.getElementById(\"prompt\").open");
 assert.deepEqual(answers.at(-1).selections, ["Blue"]); assert.equal(answers.at(-1).comment, "Matches the boxes", "with an option chosen the text is the comment");
 ask({ question: "Pick a colour", options: [{ title: "Blue" }, { title: "Pink" }], allowMultiple: false, allowFreeform: true, allowComment: true });
 await browser("wait", "--fn", "document.getElementById(\"prompt\").open");
 await browser("click", "#prompt-form input[value=Pink]"); await browser("click", "#prompt-form input[value=Pink]");
 assert.equal(await evaluate("document.querySelector('#prompt-form input[value=Pink]').checked"), false, "tapping the chosen radio clears it");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('#prompt-form .dialog-actions button')].map(b => b.textContent + ':' + b.className)"), ["Cancel:danger", "Send answer:primary"]);
 await browser("focus", "#prompt-form textarea"); await browser("press", "Shift+Enter");
 assert(await evaluate("document.getElementById('prompt').open"), "Shift+Enter is a new line, not send");
 await browser("fill", "#prompt-form textarea", "Teal"); await browser("press", "Enter");
 await browser("wait", "--fn", "!document.getElementById(\"prompt\").open");
 assert.equal(answers.at(-1).text, "Teal", "with nothing chosen the text is your own answer");
 ask({ questions: [{ question: "Pick deploy targets", options: [{ title: "Alpha" }, { title: "Beta" }], allowMultiple: true, allowFreeform: false }, { question: "Name the rollout", options: [], allowMultiple: false, allowFreeform: true, initialText: "" }, { question: "Keep it", options: [{ title: "Session", selected: true }, { title: "Permanent" }], allowFreeform: false }], allowComment: false });
 await browser("wait", "--fn", "document.getElementById(\"prompt\").open");
 assert.deepEqual(await evaluate("[document.querySelector('#prompt-form textarea').rows, document.querySelector('#prompt-form input[value=Session]').checked]"), [1, true], "a short pre-filled answer is one line; a selected option starts chosen");
 await browser("focus", "#prompt-form input[value=Alpha]"); await browser("press", "Enter");
 assert(await evaluate("document.getElementById(\"prompt\").open"), "checklist Enter toggles instead of submitting");
 await browser("focus", "#prompt-form input[value=Beta]"); await browser("press", "Space");
 await browser("fill", "#prompt-form textarea[placeholder=\"Write your answer\"]", "Canary"); await browser("click", "#prompt-form button[type=submit]");
 await browser("wait", "--fn", "!document.getElementById(\"prompt\").open");
 assert.deepEqual(answers.at(-1).answers[0].response.selections, ["Alpha", "Beta"]); assert.equal(answers.at(-1).answers[1].response.text, "Canary"); assert.deepEqual(answers.at(-1).answers[2].response.selections, ["Session"]);
 await browser("wait", "--fn", "!document.getElementById('update-button').hidden");
 await browser("click", "#update-button");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('.session-menu:not([hidden]) button')].map(b => b.textContent)"), ["Update everything (Pi, extensions, ce-workflow)", "Update only ce-workflow"], "Update offers everything or just ce-workflow");
 await browser("press", "Escape");
 await browser("click", "#settings-button"); assert(await evaluate("!document.getElementById('settings-menu').hidden && !!document.getElementById('hub-restart') && !!document.getElementById('hub-update')"), "gear opens the hub settings menu");
 // H-04 (C3): this PC's page shows the Desktop app row; Update stages the newer pin.
 await browser("wait", "--fn", "document.getElementById('app-status').textContent === 'Installed 0.1.0 · 0.2.0 available'");
 assert.deepEqual(await evaluate("[document.getElementById('app-group').hidden, document.getElementById('app-install').textContent, document.getElementById('app-login').checked]"), [false, "Update", true]);
 await browser("click", "#app-install");
 await browser("wait", "--fn", "document.getElementById('app-status').textContent.includes('0.2.0 ready')");
 assert.match(await evaluate("document.getElementById('hub-version').textContent"), /^Version: \d+\.\d+\.\d+$/, "settings name the version");
 { // Install app: the page links a manifest whose start URL and icon work locally; the icon is the picked one.
  const manifest = await evaluate("fetch(document.querySelector('link[rel=manifest]').href).then(r => r.json())");
  assert.equal(manifest.display, "standalone"); assert.equal(manifest.start_url, "/?token=" + hub.config.localKey);
  const icon = await fetch(new URL(manifest.icons[0].src, origin)); assert.equal(icon.headers.get("content-type"), "image/svg+xml"); assert.match(await icon.text(), /^<svg /);
  assert.equal((await fetch(`${origin}/s/${id}/manifest.webmanifest`)).status, 401, "manifest needs the key");
  assert(await evaluate("document.querySelector('link[rel=apple-touch-icon]').href.startsWith('data:image/png;base64,')"), "iPhone home-screen icon is a PNG");
 }
 await browser("click", "#hub-version"); await browser("wait", "--fn", "document.getElementById('changelog').open && document.querySelectorAll('#changelog-body h3').length > 5");
 assert.equal(await evaluate("document.getElementById('changelog-title').textContent"), "Changelog", "the version opens the whole changelog");
 await browser("click", "#changelog-close");
 assert.equal(await evaluate("document.getElementById('changelog').open"), false);
 const whatsNew = (await api("changelog?since=0.1.58")).entries.map(entry => entry.version);
 assert(whatsNew.includes("0.1.59") && !whatsNew.includes("0.1.58") && !whatsNew.includes("Unreleased"), "What's new keeps released versions after the one last seen");
 const badSeen = await fetch(`${origin}/s/${id}/api/hub`, { method: "POST", headers: { authorization: `Bearer ${hub.config.localKey}`, origin, "content-type": "application/json" }, body: JSON.stringify({ action: "settings", seenVersion: "../x" }) });
 assert.equal(badSeen.status, 400, "seen version must be x.y.z");
 await browser("wait", "--fn", "document.querySelector('#load-cpu polyline').getAttribute('points')");
 assert.match(await evaluate("['load-cpu', 'load-memory'].map(id => document.getElementById(id).getAttribute('aria-label')).join(' · ')"), /^CPU \d+% · Memory \d+%$/, "PC load boxes left of the gear");
 assert.deepEqual(await evaluate("['load-cpu', 'load-memory', 'settings-button'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })"), [[34, 34], [34, 34], [34, 34]], "same-size squares");
 // A form taller than the window scrolls inside its frame, with the title and buttons kept in view.
 const long = { question: "Long one", context: "Line\n".repeat(30), options: [{ title: "A" }, { title: "B" }], allowMultiple: false, allowFreeform: true };
 ask({ questions: [long, long, long], allowComment: true });
 await browser("wait", "--fn", "document.getElementById(\"prompt\").open");
 assert(await evaluate(`(() => { const d = document.getElementById("prompt"), r = d.getBoundingClientRect(), b = d.querySelector(".dialog-actions").getBoundingClientRect(), t = document.getElementById("prompt-title").getBoundingClientRect();
  return d.scrollHeight > d.clientHeight && r.bottom <= innerHeight && b.bottom <= r.bottom + 1 && t.top >= r.top - 1; })()`), "long form scrolls inside the frame with title and buttons visible");
 await browser("click", "#prompt-form button.danger"); await browser("wait", "--fn", "!document.getElementById(\"prompt\").open");
 // An ask that ends in Pi (here its timeout) closes the page form.
 ask({ question: "Terminal wins", options: [], allowMultiple: false, allowFreeform: true }, 3000);
 await browser("wait", "--fn", "document.getElementById(\"prompt\").open");
 await browser("wait", "--fn", "!document.getElementById(\"prompt\").open");
 const picker = { kind: "list", title: "Choose model", purpose: "Search Pi models; Tab shows all models.", tabAction: true, currentValue: "beta", items: [{ value: "alpha", label: "Alpha" }, { value: "beta", label: "Beta" }] };
 ask(picker); await browser("wait", "--fn", "document.getElementById(\"prompt\").open"); await browser("fill", ".prompt-filter", "Beta"); await browser("press", "Tab");
 await browser("wait", "--fn", "!document.getElementById(\"prompt\").open"); assert.equal(answers.at(-1).action, "tab");
 ask(picker); await browser("wait", "--fn", "document.getElementById(\"prompt\").open");
 assert.equal(await evaluate("document.querySelector(\".prompt-filter\").value"), "Beta", "filter survives model scope round trips");
 await browser("press", "Enter"); await browser("wait", "--fn", "!document.getElementById(\"prompt\").open"); assert.equal(answers.at(-1).value, "beta");
 ask({ kind: "list", title: "Choose slices", purpose: "Toggle slices; Escape returns.", multi: { selected: ["one"], requireOne: true }, items: [{ value: "one", label: "One" }, { value: "two", label: "Two" }] });
 await browser("wait", "--fn", "document.getElementById(\"prompt\").open"); await browser("focus", "#prompt-form input[value=two]"); await browser("press", "Enter");
 assert.equal(await evaluate("document.activeElement.value"), "two"); await browser("press", "Escape");
 await browser("wait", "--fn", "!document.getElementById(\"prompt\").open"); assert.deepEqual(answers.at(-1).values, ["one", "two"]);
 // R13/D19 status line: [model: effort] [context] [bias]; plan and usage as coloured progress bars; title folder - tab: plan.
 assert.deepEqual(await evaluate("['model-button', 'context-button', 'bias-button', 'plan-button'].map(id => document.getElementById(id).textContent)"), ["fake-1: Low", "Context: 84k/200k", "Default", sample.title + "2/5"]);
 assert.equal(await evaluate("document.getElementById('title').textContent"), "ce-workflow - 1", "desktop title: folder - session name; the plan is in its bar");
 // Usage: one bar per window (5h when there is one, then the headline 7d); a warning shows in the headline and colours it.
 const usageBars = "[...document.querySelectorAll('#usage-button .usage-bar')].map(b => b.textContent + '|' + b.dataset.tone + '|' + b.style.getPropertyValue('--fill'))";
 assert.deepEqual(await evaluate(usageBars), ["Claude 7d: 53% · expiring in 4h 12m (40% unused)|error|53%", "Codex 5h: 80% 2h 3m|accent|80%", "Codex 7d: 12% 1d 14h|error|12%"], "usage: a bar per window, the warning on the headline");
 assert.match(await evaluate("document.querySelector('#usage-button .usage-bar').title"), /Claude · 7d 53% left · expiring in 4h 12m/, "hover shows the provider's bars and warnings");
 assert.equal(await evaluate("document.getElementById('plan-button').style.getPropertyValue('--fill')"), "40%");
 assert(await evaluate("(() => { const top = document.querySelector('.topbar').getBoundingClientRect(), ids = ['model-button', 'context-button', 'bias-button', 'plan-button', 'usage-button'].map(id => document.getElementById(id).getBoundingClientRect()); return ids.every(r => r.top >= top.top && r.bottom <= top.bottom && Math.abs(r.top - ids[0].top) < 4); })()"), "desktop: the whole status line is one row in the top bar");
 await browser("click", "#bias-button"); await browser("click", "#bias-menu [data-level='1']");
 await browser("wait", "--fn", "document.getElementById('bias-button').textContent === 'Thinker (Task)'");
 // Alt+= / Alt+- step the bias like the terminal, clamped at the plan's ends.
 for (const key of ["Alt+Equal", "Alt+Equal"]) await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { code: "${key.slice(4)}", key: "=", altKey: true, bubbles: true }))`);
 await browser("wait", "--fn", "document.getElementById('bias-button').textContent.startsWith('Thinker (Plan)')");
 await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { code: "Minus", key: "-", altKey: true, bubbles: true }))`);
 await browser("wait", "--fn", "document.getElementById('bias-button').textContent === 'Thinker (Task)'");
 await browser("click", "#context-button"); await browser("click", "#compact-now"); assert.equal(commands.at(-1), "/wo compact"); commands.length = 0;
 // Clicking a provider opens its window: every quota window as a bar; Claude adds the account pool with its actions.
 await browser("click", "#usage-button [data-provider=codex]"); await browser("wait", "--fn", "document.getElementById('usage-window').open");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('#usage-body .usage-window-bar')].map(b => b.textContent)"), ["5h 80% left · resets in 2h 3m", "7d 12% left · resets in 1d 14h (Tue 10:00)18h 19m · 75%1d 9m · 65%"], "codex window: 5h and 7d bars");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('#usage-body .usage-soon span')].map(s => s.style.bottom)"), ["1px", "14px"], "close refill labels stack instead of overlapping");
 // Right-click hides one bar; the window's Top bar boxes show it again; a click outside closes the window.
 await evaluate("document.querySelector('#usage-button [data-provider=codex][data-window=\"5h\"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))");
 await browser("wait", "--fn", "document.querySelectorAll('#usage-button .usage-bar').length === 2");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('#usage-body .usage-top input')].map(b => b.checked)"), [false, true], "the window's Top bar boxes follow the right-click");
 await evaluate("(() => { const b = document.querySelector('#usage-body .usage-top input'); b.checked = true; b.dispatchEvent(new Event('change')); })()");
 await browser("wait", "--fn", "document.querySelectorAll('#usage-button .usage-bar').length === 3");
 await browser("mouse", "move", "3", "300"); await browser("mouse", "down", "left"); await browser("mouse", "up", "left");
 await browser("wait", "--fn", "!document.getElementById('usage-window').open");
 await browser("click", "#usage-button [data-provider=claude]"); await browser("wait", ".pool-row");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('#usage-body .usage-alert, #usage-body .pool-row')].map(e => e.className)"), ["usage-alert tone-error", "pool-row active forced picked", "pool-row"], "claude window: warning, then the pool rows, active one picked");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('.pool-row.active .pool-bar-fill')].map(f => f.className + ' ' + f.style.width)"), ["pool-bar-fill tone-success 80%", "pool-bar-fill tone-warning 47%"], "5h and 7d as coloured bars (% left by default)");
 assert.equal(await evaluate("document.querySelectorAll('.pool-row.active .pool-bar')[1].querySelector('.tone-error')?.textContent"), "4h 12m", "an expiring week's clock is red");
 assert.equal(await evaluate("document.querySelectorAll('.pool-actions').length"), 1, "one action row for the picked account");
 await browser("click", ".pool-row:not(.active)"); await browser("wait", "--fn", "document.querySelector('.pool-pick')?.textContent === 'flex2'");
 assert.equal(await evaluate("document.querySelector('.pool-actions select').value"), "-1", "the level menu shows the picked account's priority");
 await browser("click", ".pool-actions button:first-of-type"); await browser("wait", "--fn", "document.getElementById('notice').textContent.includes('done switch')");
 assert.equal(await evaluate("document.querySelector('.pool-actions button:nth-of-type(2)').textContent"), "Force use");
 await browser("click", ".pool-actions button:nth-of-type(2)"); await browser("wait", "--fn", "document.getElementById('notice').textContent.includes('done favorite')");
 await evaluate("(() => { const s = document.querySelector('.pool-actions select'); s.value = '2'; s.dispatchEvent(new Event('change')); })()"); await browser("wait", "--fn", "document.getElementById('notice').textContent.includes('done priority')");
 await browser("click", ".pool-tools button:nth-of-type(2)"); await browser("wait", "--fn", "document.getElementById('notice').textContent.includes('done mode')");
 await evaluate("window.prompt = () => '{\"accounts\":[]}', 0"); await browser("click", ".pool-tools button:nth-of-type(4)"); await browser("wait", "--fn", "document.getElementById('notice').textContent.includes('done import')");
 assert.deepEqual(pool.acts, ["switch:flex2", "favorite:flex2", "priority:flex2:2", "mode:", "import:undefined"], "pool actions reach the hub's pool; Paste logins sends the pasted text");
 await browser("click", "#usage-close");
 await browser("click", "#settings-button");
 assert.deepEqual(await evaluate("[document.querySelectorAll('#settings-menu #icon-grid .icon-choice').length > 1, !!document.getElementById('icon-colors'), document.querySelector('#icon-grid [aria-checked=true]')?.title]"), [true, false, "pc"], "icons sit in the settings menu, no colours, the first is the default");
 await browser("click", "#settings-button");
 // The plan bar lines up with the sidebar's folder boxes below it.
 assert(await evaluate("(() => { const plan = document.getElementById('plan-button').getBoundingClientRect().left, box = document.querySelector('.session-folder')?.getBoundingClientRect().left; return box === undefined || Math.abs(plan - box) < 2; })()"), "plan bar aligns with the sidebar: " + await evaluate("JSON.stringify([document.getElementById('plan-button').getBoundingClientRect().left, document.querySelector('.session-folder')?.getBoundingClientRect().left])"));
 // Think and the usage bars together span the chat panel width.
 assert.deepEqual(await evaluate("['plan-button', 'model-button', 'context-button', 'usage-button', 'bias-button', 'settings-button'].map(id => document.getElementById(id).getBoundingClientRect().left).every((left, index, all) => !index || left > all[index - 1])"), true, "desktop order: plan, model, context, usage, think, gear");
 assert(await evaluate("(() => { const bar = document.querySelector('.topbar').getBoundingClientRect(), side = document.getElementById('switcher').getBoundingClientRect(); return bar.left === 0 && (document.getElementById('switcher').hidden || side.top >= bar.bottom - 1); })()"), "the top bar spans the width above the sidebar: " + await evaluate("JSON.stringify([document.querySelector('.topbar').getBoundingClientRect(), document.getElementById('switcher').getBoundingClientRect(), getComputedStyle(document.body).paddingLeft])"));
 await browser("press", "Escape");
 await browser("click", "#plan-button"); await browser("wait", ".plan-option");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('#plan-menu .plan-option')].map(b => b.textContent + ':' + b.getAttribute('aria-pressed')).concat(document.getElementById('plan-divider').hidden)"), [sample.title + " · 2/5 (current):true", "Other plan · 0/3:false", false], "plans on top, the shown one marked, then a divider");
 await browser("press", "Escape");
 for (const command of ["resolve", "ideas", "review", "finish", "resume"]) { await browser("click", "#plan-button"); await browser("click", "[data-command=" + command + "]"); await browser("wait", "--fn", "!document.querySelector(\"[data-command=" + command + "]\").disabled"); }
 assert.deepEqual(commands, ["resolve", "ideas", "review", "finish", "resume"]);
 await browser("click", "#plan-button"); assert.equal(await evaluate("document.getElementById('plan-button').getAttribute('aria-expanded')"), "true");
 await browser("press", "Escape"); assert.deepEqual(await evaluate("[document.getElementById('plan-menu').hidden, document.activeElement.id]"), [true, "plan-button"]);
 await browser("click", "#plan-button"); await browser("click", "[data-command=new]");
 assert.deepEqual(await evaluate("[document.getElementById('message-input').value, document.activeElement.id]"), ["/plan3 ", "message-input"]); await browser("fill", "#message-input", "");
 await browser("click", "#model-button"); await browser("wait", ".model-option");
 assert.deepEqual(await evaluate("[[...document.querySelectorAll('#model-menu .model-option')].map(b => b.textContent), document.querySelector('#model-menu input'), document.activeElement.textContent]"), [["Fake One", "Fake Two"], null, "Fake One"], "scoped models only, no filter; focus on the current one");
 await browser("click", "[data-ref='fake/fake-2']"); // the hub sets it in Pi over RPC
 await browser("wait", "--fn", "document.getElementById('model-button').textContent === 'fake-2: Low'");
 assert.equal(await evaluate("document.getElementById('model-menu').hidden"), true);
 await browser("click", "#model-button"); await browser("wait", "#model-menu .effort-row button");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('#model-menu .effort-row button')].map(b => b.textContent + ':' + b.getAttribute('aria-pressed'))"), ["Low:true", "Mid:false", "High:false"], "effort on one line in the model menu");
 await browser("click", "#model-menu [data-level=high]");
 await browser("wait", "--fn", "document.getElementById('model-button').textContent === 'fake-2: High'");
 // Sketch C: a Roles summary under the list; a role row opens that role's list, Escape goes back. (No role is set here:
 // this hub uses the real Pi settings.)
 await browser("click", "#model-button"); await browser("wait", "#model-menu .role-summary");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('#model-menu .role-summary')].map(b => b.dataset.role)"), ["default", "work", "think"], "roles summary under the list");
 await browser("click", "#model-menu .model-all");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('#model-menu .model-option')].map(b => b.textContent)"), ["Fake One", "Fake Two", "Other"], "show all models adds the unscoped ones");
 await browser("click", "#model-menu [data-role=work]"); await browser("wait", "#model-menu .model-back");
 assert.equal(await evaluate("document.querySelector('#model-menu .model-back').textContent"), "← 🔨 Work model");
 await browser("press", "Escape"); assert.deepEqual(await evaluate("[document.getElementById('model-menu').hidden, !!document.querySelector('#model-menu .role-summary')]"), [false, true], "Escape goes back to this chat's list");
 await browser("press", "Escape"); assert.equal(await evaluate("document.getElementById('model-menu').hidden"), true);
 // H5-05 session bar: one group per folder, colour-coded letters. This page's session is seen, a parked one grey, a running
 // one working; a run that ends while no page watches it stays unseen.
 assert.equal(await evaluate("document.getElementById('switcher').hidden"), false, "desktop always shows the session bar");
 fs.writeFileSync(join(root, "two.jsonl"), ""); hub.registry.add({ name: "2", folder, sessionFile: join(root, "two.jsonl"), state: "parked" });
 // Notifications: a stub records what the page announces once it has a baseline.
 await evaluate(`(() => { window.notes = []; window.Notification = class { static permission = "granted"; constructor(title, options) { window.notes.push(title + "|" + options.tag.split(":")[1]); } close() {} }; })()`);
 const third = await hub.host.create(folder, "3"); await hub.host.live.get(third.id).rpc.send({ type: "prompt", message: "hold" });
 const tones = "[...document.querySelectorAll('.session:not(.recent)')].map(s => s.querySelector('.session-letter').textContent + ':' + s.dataset.tone).join()";
 await evaluate("document.dispatchEvent(new Event('visibilitychange'))"); await browser("wait", "--fn", `${tones} === "1:seen,2:parked,3:working"`);
 assert.equal(await evaluate("document.querySelector('.session-group-label').textContent"), "ce-workflow (3)");
 // @ lists the other sessions by folder/name; picking one writes its reference in place of the word.
 await browser("fill", "#message-input", "ask @CE-workflow/2"); await browser("wait", "#slash-menu:not([hidden])");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('#slash-menu .slash-option')].map(o => o.dataset.command)"), ["ce-workflow/2"], "this session is not listed");
 await browser("press", "Enter"); assert.equal(await evaluate("document.getElementById('message-input').value"), "ask ce-workflow/2 "); await browser("fill", "#message-input", "");
 assert.equal(await evaluate("document.querySelector('.session[aria-current=page]').closest('.session-folder').dataset.tone"), "working", "the open session's folder is boxed; working (orange) beats current (blue)");
 assert.equal(await evaluate("document.querySelector('.session[aria-current=page] .session-link').getAttribute('aria-label')"), "1 in ce-workflow, idle, this session");
 assert(await evaluate("document.getElementById('switcher').getBoundingClientRect().width === 200 && document.querySelector('.session-label').getBoundingClientRect().width > 4 && document.querySelector('.session-label').textContent === '1'"), "open by default with the session name");
 await browser("focus", "#switcher-toggle"); await browser("press", "Escape"); assert.deepEqual(await evaluate("[document.getElementById('switcher').dataset.open, document.activeElement.id]"), ["false", "switcher-toggle"]);
 assert.equal(await evaluate("document.querySelector('.session-label').getBoundingClientRect().width"), 1, "collapsed stripe shows letters only");
 assert.equal(await evaluate("localStorage.getItem('plan3-switcher')"), "closed", "collapse is remembered");
 await browser("click", "#switcher-toggle");
 await hub.host.live.get(third.id).rpc.send({ type: "abort" });
 await evaluate("document.dispatchEvent(new Event('visibilitychange'))"); await browser("wait", "--fn", `${tones} === "1:seen,2:parked,3:unseen"`);
 assert.deepEqual(await evaluate("window.notes"), ["ce-workflow - 3 finished|unseen"], "working to idle announces once; the new session's first tone does not");
 { const set = await fetch(`${origin}/s/${id}/api/hub`, { method: "POST", headers: { authorization: `Bearer ${hub.config.localKey}`, origin, "content-type": "application/json" }, body: JSON.stringify({ action: "settings", notify: { done: false } }) });
  assert.deepEqual((await set.json()).notify, { question: true, done: false }, "notify defaults on and saves per key"); }
 await hub.host.live.get(third.id).rpc.send({ type: "prompt", message: "hold" }); await evaluate("document.dispatchEvent(new Event('visibilitychange'))"); await browser("wait", "--fn", `${tones} === "1:seen,2:parked,3:working"`);
 await browser("wait", "--fn", "document.getElementById('notify-done').checked === false");
 await hub.host.live.get(third.id).rpc.send({ type: "abort" }); await evaluate("document.dispatchEvent(new Event('visibilitychange'))"); await browser("wait", "--fn", `${tones} === "1:seen,2:parked,3:unseen"`);
 assert.equal(await evaluate("window.notes.length"), 1, "Finished off: no announcement");
 await hub.host.park(third.id);
 // H-02 (D5): inside the desktop app the title is a machine line; this session's own finished run counts while unfocused.
 assert(!(await evaluate("document.title")).startsWith("pi-hub-state"), "a normal browser keeps its own title");
 await evaluate("(() => { Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 PiHubApp/0.1.0' }); document.hasFocus = () => false; })()");
 await hub.host.prompt(id, "app");
 await browser("wait", "--fn", "document.title.startsWith('pi-hub-state {') && JSON.parse(document.title.slice(13)).states.join() === 'unseen'");
 const line = JSON.parse((await evaluate("document.title")).slice(13));
 assert.deepEqual([typeof line.icon, line.icon.length > 0, line.name, line.states], ["string", true, os.hostname(), ["unseen"]], "icon, hub name (hostname) and own unseen");
 assert.deepEqual([line.latest > 0, line.key], [true, "ctrl+shift+a"], "the newest attention time and the app's attention key");
 // pi-hub progress: a bar under the chat heading, refused without numbers, gone on --clear.
 { const report = body => fetch(`${origin}/api/sessions/${id}/progress`, { method: "POST", headers: { "x-hub-key": hub.config.localKey, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await report({ done: "x", total: 5 })).status, 400, "progress needs numbers");
  await report({ done: 2450, total: 5000, label: "items" }); await browser("wait", "--fn", "!document.getElementById('job-progress').hidden");
  assert.deepEqual(await evaluate("[document.querySelector('#job-progress span').textContent, document.querySelector('#job-progress b').style.width]"), ["items 2450/5000 (49%)", "49%"], "label, count, percent and bar");
  await evaluate("document.dispatchEvent(new Event('visibilitychange'))"); await browser("wait", "--fn", "document.querySelector('.session-job small')?.textContent === '49%'");
  await report({ clear: true }); await browser("wait", "--fn", "document.getElementById('job-progress').hidden"); await evaluate("document.dispatchEvent(new Event('visibilitychange'))"); await browser("wait", "--fn", "!document.querySelector('.session-job')"); }
  // A parked session with a check timer shows blue (scheduled) on the icon; it needs nobody, so the attention count stays.
 { const other = hub.registry.list().find(record => record.id !== id && !hub.host.live.has(record.id)).id, post = (route, body) => fetch(`${origin}/api/${route}`, { method: "POST", headers: { "x-hub-key": hub.config.localKey, "content-type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
  const before = JSON.parse((await evaluate("document.title")).slice(13)).attention;
  const check = await post(`sessions/${other}/timers`, { kind: "script", command: "exit 0", everyMinutes: 5 });
  await evaluate("document.dispatchEvent(new Event('visibilitychange'))"); await browser("wait", "--fn", "JSON.parse(document.title.slice(13)).states.includes('scheduled')");
  assert.equal(JSON.parse((await evaluate("document.title")).slice(13)).attention, before, "a timer is not attention");
  await post(`timers/${check.id}/cancel`, {}); await evaluate("document.dispatchEvent(new Event('visibilitychange'))"); await browser("wait", "--fn", "!JSON.parse(document.title.slice(13)).states.includes('scheduled')"); }
 await evaluate("(() => { delete navigator.userAgent; delete document.hasFocus; })()");
 // Sidebar filter: Enter on this session clears the filter and puts the cursor in the chat box.
 await browser("fill", "#session-filter", "1"); await browser("press", "Enter");
 assert.deepEqual(await evaluate("[document.getElementById('session-filter').value, document.activeElement.id]"), ["", "message-input"], "filter cleared, chat focused");
 // Escape in an empty filter box goes back to the chat; it never folds the session list away.
 await evaluate("(() => { const box = document.getElementById('session-filter'); box.focus(); box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); })()");
 assert.deepEqual(await evaluate("[document.getElementById('switcher').dataset.open, document.activeElement.id]"), ["true", "message-input"], "Escape in an empty filter keeps the sessions open and goes back to the chat box");
 // A sidebar click marks the next page to start with the chat box focused (navigation blocked here).
 assert.equal(await evaluate("(() => { const stop = event => event.preventDefault(); window.addEventListener('click', stop, true); document.querySelector('.session-link').click(); window.removeEventListener('click', stop, true); const set = sessionStorage.getItem('focus-chat'); sessionStorage.removeItem('focus-chat'); return set; })()"), "1");
 // New folder opens a dialog whose Local button starts a session in ~/pi-local, creating it without asking (request stubbed: no real home folder).
 await evaluate("(() => { window.__sent = []; window.__fetch = fetch; window.fetch = (url, init) => { if (String(init?.body).includes('pi-local')) { __sent.push(JSON.parse(init.body)); return Promise.reject(new Error('stub')); } return __fetch(url, init); }; [...document.querySelectorAll('#session-list .session-devices')].find(b => b.textContent === 'New folder').click(); })()");
 assert.equal(await evaluate("document.getElementById('new-folder').open"), true, "New folder is a dialog");
 await browser("click", "#new-folder-local"); await browser("wait", "--fn", "window.__sent.length");
 assert.deepEqual(await evaluate("(() => { window.fetch = __fetch; return [document.getElementById('new-folder').open, __sent.map(b => [b.action, b.folder, b.create])]; })()"), [false, [["new", "~/pi-local", true]]]);
 // H6-03 (D19): a phone asks to pair; this local page shows its code, approves it, then lists and revokes it.
 const pairCode = hub.pairing.start({ "user-agent": "Mozilla/5.0 (iPhone) Safari/1" }, "me@example.com").code;
 await evaluate("document.dispatchEvent(new Event('visibilitychange'))"); await browser("wait", "--fn", "document.getElementById('pair-approve').open");
 assert.deepEqual(await evaluate("[document.getElementById('pair-approve-code').textContent, document.getElementById('pair-device').textContent, document.activeElement.id]"), [pairCode, "iPhone Safari \u00b7 me@example.com \u00b7 unknown address", "pair-reject"], "focus starts on Reject");
 await browser("click", "#pair-accept"); await browser("wait", "--fn", "!document.getElementById('pair-approve').open");
 assert.deepEqual(hub.devices.list().map(device => device.label), ["iPhone Safari"]);
 assert.equal(await evaluate("!!document.getElementById('devices-button').closest('#remote-group')"), true, "Devices sits with Remote access, not in the sidebar");
 await evaluate("document.getElementById('devices-button').click()"); await browser("wait", "--fn", "document.getElementById('devices').open && document.querySelector('#device-list button')");
 assert.equal(await evaluate("document.getElementById('devices-remote').textContent"), "Remote access is off (pi-hub remote on).");
 await browser("click", "#device-list button"); await browser("wait", "--fn", "document.querySelector('#device-list li').textContent === 'No paired devices.'");
 assert.deepEqual(hub.devices.list(), []); await browser("click", "#devices-close"); await browser("hover", "#message-input"); // leave the session bar, whose hover card covers the chips
 hub.pairing.start({}, "me@example.com"); await evaluate("document.dispatchEvent(new Event('visibilitychange'))"); await browser("wait", "--fn", "document.getElementById('pair-approve').open");
 await browser("press", "Escape"); await browser("wait", "--fn", "!document.getElementById('pair-approve').open");
 assert.equal(hub.pairing.pending(), null, "Escape rejects"); assert.deepEqual(hub.devices.list(), []);
 status = { ...(await api("snapshot")).status, model: { provider: "t", id: "term", name: "Terminal pick" } }; publish("status", status);
 await browser("wait", "--fn", "document.getElementById('model-button').textContent === 'Terminal pick: High'");
 // Session modes: chips mirror research/night, tint the chat and send the toggle command.
 publish("status", { ...status, modes: { research: "on", night: "off" } });
 await browser("wait", "--fn", "document.getElementById('chat').dataset.mode === 'accent' && document.getElementById('mode-research').getAttribute('aria-pressed') === 'true'");
 await browser("click", "#mode-research"); await browser("wait", "--fn", "!document.getElementById('mode-research').disabled");
 assert.equal(commands.at(-1), "/research off");
 // Research mode puts Resolve/Review/Finish/Resume above the chat, enabled only when the plan allows them.
 publish("plan", { id: "12345678", title: sample.title, done: 2, total: 5, open: 2, planning: true, finishable: false, bias: 0 });
 await browser("wait", "--fn", "!document.getElementById('plan-actions').hidden && document.querySelector('#plan-actions [data-command=resolve]').textContent === 'Resolve (2)'");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('#plan-actions > button')].map(b => b.textContent + ':' + b.disabled)"), ["Resolve (2):false", "Review:false", "Finish:true", "Resume:true"]);
 await browser("click", "#review-button"); await browser("click", "#review-menu [data-command='review all']"); await browser("wait", "--fn", "!document.getElementById('review-button').disabled");
 assert.equal(commands.at(-1), "review all");
 publish("status", { ...status, modes: { research: "off", night: "on" } });
 await browser("wait", "--fn", "document.getElementById('chat').dataset.mode === 'accent' && document.getElementById('plan-actions').hidden && document.getElementById('mode-night').getAttribute('aria-pressed') === 'true'");
 publish("status", status); await browser("wait", "--fn", "document.getElementById('chat').dataset.mode === ''");
 // Pi switching its current plan moves the page to it (and back).
 publish("plan", { id: "87654321", title: "Newer plan", done: 0, total: 16, bias: 0 });
 await browser("wait", "--fn", "document.getElementById('plan-button').textContent.includes('Newer plan')");
 publish("plan", { id: "12345678", title: sample.title, done: 2, total: 5, focus: "S03", bias: 0 });
 await browser("wait", "--fn", "document.getElementById('plan-button').textContent.includes('0/16') === false && !document.getElementById('plan-button').textContent.includes('Newer plan')");
 // The plan finishing by itself (Pi publishes no plan) repaints to New plan without a refresh; the next plan comes back.
 publish("plan", null); await browser("wait", "--fn", "document.getElementById('plan-button').textContent.startsWith('New plan')");
 publish("plan", { id: "12345678", title: sample.title, done: 2, total: 5, focus: "S03", bias: 0 });
 await browser("wait", "--fn", `document.getElementById('plan-button').textContent.includes(${JSON.stringify(sample.title)})`);
 activity = { working: true, compacting: true, thinking: "Considering <script>safe text</script>", tools: [{ id: "tool_1", name: "read", state: "running", startedAt: Date.now() - 65_000, args: JSON.stringify({ path: "src/app.ts", limit: 9 }), progress: "Loading lines" }, { id: "tool_2", parent: "tool_1", name: "child", state: "done", result: "Text-only result", durationMs: 250 }], queueExact: false, queue: [{ id: "queue_1", text: "Follow up", delivery: "followUp" }] }; publish("activity", activity);
 await browser("wait", "--fn", "document.getElementById(\"connection\").textContent === \"Compacting\"");
 assert.equal(await evaluate("document.getElementById(\"stop\").hidden"), false);
 assert.deepEqual(await evaluate("[...document.querySelectorAll('.queued-msg')].map(r => r.textContent)"), ["Follow upedit✕"], "a queued message shows grey with edit and cancel");
 assert.equal(await evaluate("document.querySelectorAll(\".nested-tool\").length"), 1); assert.equal(await evaluate("document.querySelector(\"#activity script\")"), null);
 assert.equal(await evaluate("document.querySelector(\"details[data-id=tool_1]\").open"), false, "tool rows start collapsed");
 assert.equal(await evaluate("document.querySelector(\"details[data-id=tool_1] summary\").textContent"), "(1:05) read src/app.ts · running", "the running time leads the live tool line");
 // While working, Thinking and Compact keep the live thinking and only the latest tool call; Compact drops thinking once settled.
 const activityShown = () => evaluate("['#activity [data-id=tool_1]', '#activity [data-id=tool_2]', '#activity .thinking-row'].map(sel => !!document.querySelector(sel) && getComputedStyle(document.querySelector(sel)).display !== 'none')");
 await browser("click", "#chat-compact"); assert.deepEqual(await activityShown(), [false, true, true], "Thinking view while working");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('#messages [data-id=assistant_4] .thinking-text')].map(text => [text.textContent, getComputedStyle(text).display])"), [["hmm", "block"], ["more", "block"]], "Thinking view shows the thinking text; a file change splits the run");
 assert.deepEqual(await evaluate("['t1', 't2'].map(id => { const item = document.querySelector('#messages [data-id=assistant_4] details[data-key=' + id + ']'); return [getComputedStyle(item).display !== 'none', item.open]; })"), [[true, false], [false, false]], "Thinking view keeps edits and writes, collapsed; other tools stay hidden");
 await browser("click", "#chat-compact"); assert.deepEqual(await activityShown(), [false, true, true], "Compact view while working");
 publish("activity", { ...activity, working: false }); await browser("wait", "--fn", "!document.getElementById('activity').classList.contains('working')");
 assert.deepEqual(await activityShown(), [false, false, false], "Compact after the run: only the final reply");
 publish("activity", activity); await browser("wait", "#activity.working");
 await browser("click", "#chat-compact"); assert.deepEqual(await activityShown(), [true, true, true], "Full shows every row");
 await browser("click", "#activity details[data-id=tool_1] summary");
 activity.tools[0] = { ...activity.tools[0], state: "error", result: "Read failed", durationMs: 100 }; activity.compacting = false; activity.error = "A safe error"; publish("activity", activity);
 await browser("wait", "--fn", "document.getElementById(\"activity\").textContent.includes(\"Read failed\")");
 assert.equal(await evaluate("document.querySelector(\"details[data-id=tool_1]\").open"), true, "tool updates preserve disclosure state");
 // A settled run hides its tool list, so the final reply is the last thing shown.
 publish("activity", { ...activity, working: false }); await browser("wait", "--fn", "document.querySelector('#activity details[data-id=tool_1]') === null");
 publish("activity", activity); await browser("wait", "#activity details[data-id=tool_1]");
 // Background subagents keep the page busy after the main run settles.
 publish("activity", { ...activity, working: false, subagents: [{ id: "run1", label: "plan3-advisor", model: "GPT-6 Astra", state: "running", turns: 3, tools: 7 }] });
 await browser("wait", "--fn", "document.getElementById('connection').textContent === 'Subagents\u2026' && document.getElementById('connection').dataset.state === 'working' && document.getElementById('activity').textContent.includes('Subagent (GPT-6 Astra) plan3-advisor')");
 publish("activity", { ...activity, subagents: [] });
 // Sending from a scrolled-up chat jumps to the bottom and follows the echoed message.
 for (let i = 0; i < 30; i++) { const row = { id: "filler_" + i, role: "assistant", text: "Filler line " + i, streaming: false }; chatRows.set(row.id, row); publish("message", row); }
 await browser("wait", "--fn", "document.querySelector(\"#messages [data-id=filler_29]\") !== null");
 await evaluate("document.getElementById(\"feed\").scrollTop = 0");
 await browser("fill", "#message-input", "Scroll me down"); await browser("click", "#send"); await browser("wait", "--fn", "document.getElementById(\"messages\").textContent.includes(\"Scroll me down\")");
 assert(await evaluate("(() => { const list = document.getElementById(\"feed\"); return list.scrollHeight - list.scrollTop - list.clientHeight < 48; })()"), "send scrolls the chat to the newest message");
 // Content that grows after it was drawn (a thumbnail loading, a block opening) must not unpin the chat; only scrolling up does.
 await evaluate("(() => { const l = document.getElementById('feed'); l.scrollTop = l.scrollHeight; })()"); await new Promise(done => setTimeout(done, 100));
 await evaluate("document.querySelector('#messages > li:last-child').append(Object.assign(document.createElement('div'), { style: 'height: 200px' }))");
 { const row = { id: "after_grow", role: "assistant", text: "Still following", streaming: false }; chatRows.set(row.id, row); publish("message", row); }
 await browser("wait", "[data-id=after_grow]");
 assert(await evaluate("(() => { const list = document.getElementById('feed'); return list.scrollHeight - list.scrollTop - list.clientHeight < 4 && document.getElementById('to-bottom').hidden; })()"), "late growth does not unpin the chat");
 await browser("fill", "#message-input", "Queued follow-up"); await browser("click", "#send");
 await browser("wait", "--fn", "document.getElementById(\"notice\").textContent.includes(\"steers\")");
 // Queue and tool rows below the newest message grow the one scroll area: a reader at the end stays at the end.
 activity = { working: true, tools: [], queue: [], hasPendingMessages: false, error: undefined, thinking: "" }; publish("activity", activity);
 await browser("wait", "--fn", "document.querySelectorAll('#activity details').length === 0");
 await evaluate("(() => { const l = document.getElementById('feed'); l.scrollTop = l.scrollHeight; })()"); await new Promise(done => setTimeout(done, 100));
 activity = { working: true, error: undefined, thinking: "", queue: [{ id: "q1", text: "Queued follow-up", delivery: "followUp" }], tools: Array.from({ length: 6 }, (_, i) => ({ id: "grow_" + i, name: "bash", state: "running", args: "step " + i })) }; publish("activity", activity);
 await browser("wait", "--fn", "document.querySelectorAll('#activity details').length >= 6 && document.querySelector('.queued-msg')"); await new Promise(done => setTimeout(done, 200));
 assert(await evaluate("(() => { const feed = document.getElementById('feed'), activity = document.getElementById('activity'), messages = document.getElementById('messages'); return [activity, messages].every(item => item.parentElement === feed && item.scrollHeight <= item.clientHeight + 1) && messages.nextElementSibling === activity && activity.getBoundingClientRect().bottom - feed.getBoundingClientRect().bottom < 4; })()"), "one scroll area: messages, then the live activity at the end");
 // A scroll event arriving after content grew below (reader did not move) keeps the pin.
 await evaluate("(() => { document.querySelector('#messages > li:last-child').append(Object.assign(document.createElement('div'), { style: 'height: 200px' })); document.getElementById('feed').dispatchEvent(new Event('scroll')); })()");
 { const row = { id: "after_queue", role: "assistant", text: "Working on it", streaming: false }; chatRows.set(row.id, row); publish("message", row); }
 await browser("wait", "[data-id=after_queue]");
 assert(await evaluate("(() => { const list = document.getElementById('feed'); return list.scrollHeight - list.scrollTop - list.clientHeight < 4; })()"), "queued message: the chat stays at the end");
 // Stop is a real abort: fake Pi runs until it, then settles.
 await rpc().send({ type: "prompt", message: "hold" }); await browser("wait", "--fn", "!document.getElementById(\"stop\").hidden");
 await browser("click", "#stop"); await browser("wait", "--fn", "document.getElementById(\"stop\").hidden");
 // E-03 + Phase 6b: direct manipulation. Box and Group draw, labels open the dialog, handles connect and resize, drops reparent.
 {
  await browser("click", "#tab-plan"); await browser("fill", "#message-input", "");
  diagram = { ...diagram, revision: diagram.revision + 1, nodes: [{ id: "web_client", label: "Web client", kind: "client" }], edges: [], notes: [] };
  publish("diagram", { target: { kind: "plan", id: "12345678" }, diagram });
  await browser("wait", "--fn", `document.getElementById('diagram').dataset.revision === '${diagram.revision}'`); await browser("click", "#zoom-fit");
  const revision = () => evaluate("Number(document.getElementById('diagram').dataset.revision)"), composer = () => evaluate("document.getElementById('message-input').value"), rows = async () => (await composer()).trim().split(/\r?\n/);
  const rect = selector => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; })()`);
  // The visible point of an element nearest the preferred spot (HTML overlays such as the zoom controls may cover part of it).
  const point = (selector, fx = .5, fy = .5) => evaluate(`(() => { const item = document.querySelector(${JSON.stringify(selector)}), r = item.getBoundingClientRect(), px = r.x + r.width * ${fx}, py = r.y + r.height * ${fy}, spots = [];
   for (let y = r.y + 2; y < r.bottom - 1; y += 4) for (let x = r.x + 2; x < r.right - 1; x += 4) spots.push([Math.hypot(x - px, y - py), Math.round(x), Math.round(y)]);
   for (const [, x, y] of spots.sort((a, b) => a[0] - b[0])) { const hit = document.elementFromPoint(x, y); if (hit && (hit === item || item.contains(hit))) return { x, y }; }
   throw new Error("no visible point on ${selector.replaceAll('"', "'")}"); })()`);
  const drag = async (from, to, during) => {
   await browser("mouse", "move", String(from.x), String(from.y)); await browser("mouse", "down", "left");
   await browser("mouse", "move", String(Math.round((from.x + to.x) / 2)), String(Math.round((from.y + to.y) / 2))); await browser("mouse", "move", String(to.x), String(to.y));
   if (during) await during(); await browser("mouse", "up", "left");
  };
  const tap = at => drag(at, at), after = before => browser("wait", "--fn", `Number(document.getElementById('diagram').dataset.revision) > ${before}`);
  const settled = async count => { const before = await revision(); return async () => { await browser("wait", "--fn", `Number(document.getElementById('diagram').dataset.revision) >= ${before + count}`); }; };
  // Empty canvas: a w x h screen area whose corners and center hit the bare svg.
  const emptyAt = (w, h) => evaluate(`(() => { const svg = document.getElementById('diagram'), r = svg.getBoundingClientRect(), free = (x, y) => document.elementFromPoint(x, y) === svg; for (let y = r.top + 80; y + ${h} < r.bottom - 20; y += 20) for (let x = r.left + 20; x + ${w} < r.right - 20; x += 20) if ([[0, 0], [${w}, 0], [0, ${h}], [${w}, ${h}], [${w} / 2, ${h} / 2]].every(([dx, dy]) => free(x + dx, y + dy))) return { x: Math.round(x), y: Math.round(y) }; return null; })()`);
  const edgeAt = id => evaluate(`(() => { const line = document.querySelector('[data-edge=${id}] .edge-hit'), p = line.getPointAtLength(line.getTotalLength() / 2), m = line.getScreenCTM(); return { x: Math.round(p.x * m.a + p.y * m.c + m.e), y: Math.round(p.x * m.b + p.y * m.d + m.f) }; })()`);
  const node = id => diagram.nodes.find(item => item.id === id), dialogOpen = () => evaluate("document.getElementById('comment-prompt').open");
  // U-01: named, iconed tabs and tools; the chosen swatch carries a ring; D12: no Connect or Delete tool.
  assert.deepEqual(await evaluate("['tab-project', 'tab-plan'].map(id => document.getElementById(id).textContent.trim())"), ["UML Project", "UML Plan"]);
  assert.equal(await evaluate("['tab-project', 'tab-plan', 'mobile-project', 'mobile-plan'].every(id => document.querySelector('#' + id + ' svg.icon')) && [...document.querySelectorAll('[data-tool=select], [data-tool=box], [data-tool=group]')].every(button => button.querySelector('svg.icon'))"), true, "tabs and tools have icons");
  assert.equal(await evaluate("document.querySelectorAll('#edit-bar [data-tool]').length"), 3, "the bar is Select, Box and Group");
  await browser("click", "[data-tool=group]"); await browser("click", "[data-color='2']");
  assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.swatch-2')).boxShadow"), "none", "the chosen color shows a ring");
  // U-02 + D13: dragging a group around Web client previews it in the chosen color, creates it at the drawn size and adopts the box; U-03: no dialog.
  const client = await rect("[data-node=web_client]"), grouped = await settled(2);
  await drag({ x: Math.round(client.x - 40), y: Math.round(client.y - 70) }, { x: Math.round(client.right + 40), y: Math.round(client.bottom + 40) }, async () => assert.equal(await evaluate("document.querySelector('.draw-preview')?.getAttribute('stroke')"), "#e8590c", "the outline previews the chosen color"));
  await grouped();
  assert.equal(await dialogOpen(), false, "creating opens no dialog");
  assert.deepEqual([node("new_group").color, node("new_group").edit, node("new_group").w >= 120, node("new_group").h >= 60, node("web_client").parent], [2, "add", true, true, "new_group"]);
  assert.deepEqual(await rows(), ['Add group "New group" (@new_group) (orange)', 'Move "Web client" (@web_client) into "New group" (@new_group)']);
  assert.equal(await evaluate("document.querySelector('[data-tool=select]').getAttribute('aria-pressed')"), "true", "the tool returns to Select");
  // A plain click with Box on the group's title band adds a default-size box inside it.
  await browser("click", "[data-tool=box]"); let before = await revision(); await tap(await point("[data-node=new_group] > .title-band", .92)); await after(before);
  assert.deepEqual([node("new_box").parent, node("new_box").w], ["new_group", undefined]); assert.equal((await rows()).at(-1), 'Add box "New box" (@new_box) in "New group" (@new_group)');
  // A drag on empty canvas draws a box at that size.
  const spot = await emptyAt(260, 140); assert(spot, "empty canvas for a drawn box");
  await browser("click", "[data-tool=box]"); before = await revision(); await drag(spot, { x: spot.x + 260, y: spot.y + 140 }); await after(before);
  assert(node("new_box_2").w >= 120 && node("new_box_2").h >= 60 && node("new_box_2").parent === undefined, JSON.stringify(node("new_box_2")));
  // U-03: an A+ cursor over labels; a label click opens the pre-filled dialog; renaming a pending add rewrites its line.
  assert.match(await evaluate("getComputedStyle(document.querySelector('[data-node=new_box] .node-label')).cursor"), /url\(/);
  await tap(await point("[data-node=new_box] .node-label")); await browser("wait", "--fn", "document.getElementById('comment-prompt').open");
  assert.equal(await evaluate("document.getElementById('comment-text').value"), "New box"); await browser("fill", "#comment-text", "Redis"); await browser("click", "#comment-save");
  await browser("wait", "--fn", "document.getElementById('message-input').value.includes('\"Redis\"')");
  assert.deepEqual((await rows()).slice(2), ['Add box "Redis" (@new_box) in "New group" (@new_group)', 'Add box "New box 2" (@new_box_2)'], "one line per element");
  // U-06: a side handle drags a connection (live line), once; itself or a duplicate adds nothing.
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-node=web_client] .connect-handle')).cursor"), "pointer");
  const handle = () => point("[data-node=web_client] .connect-handle:nth-of-type(2)"), target = () => point("[data-node=new_box_2]");
  before = await revision(); await drag(await handle(), await target(), async () => assert(await evaluate("!!document.querySelector('.connect-preview')"), "a live line follows the pointer")); await after(before);
  assert.equal(diagram.edges.find(edge => edge.id === "web_client__new_box_2")?.edit, "add"); assert.equal((await rows()).at(-1), 'Connect "Web client" (@web_client) → "New box 2" (@new_box_2)');
  const count = toolbarEdits.length; await drag(await handle(), await target()); await drag(await handle(), await point("[data-node=web_client]", .3, .7));
  assert.equal(toolbarEdits.length, count, "duplicate and self connections add nothing");
  // U-07: clicking a connection opens its label dialog with Delete; Delete asks once more, then undoes the pending add and its line.
  await tap(await edgeAt("web_client__new_box_2")); await browser("wait", "--fn", "document.getElementById('comment-prompt').open && !document.getElementById('comment-delete').hidden");
  await browser("fill", "#comment-text", "reads"); await browser("click", "#comment-save"); await browser("wait", "--fn", "document.getElementById('message-input').value.includes('(\"reads\")')");
  assert.equal((await rows()).at(-1), 'Connect "Web client" (@web_client) → "New box 2" (@new_box_2) ("reads")', "renaming a pending connection rewrites its line");
  await tap(await edgeAt("web_client__new_box_2")); await browser("wait", "--fn", "document.getElementById('comment-prompt').open");
  await browser("click", "#comment-delete"); assert.equal(await evaluate("document.getElementById('comment-delete').textContent"), "Confirm: delete connection @web_client__new_box_2");
  assert(diagram.edges.some(edge => edge.id === "web_client__new_box_2"), "the first click only asks"); before = await revision(); await browser("click", "#comment-delete"); await after(before);
  assert.equal(await evaluate("document.querySelector('[data-edge=web_client__new_box_2]')"), null); assert.equal((await rows()).length, 4, "the Connect line went with it");
  // U-04: the group's title band grabs and moves it (layout: no chat line); its corner handle resizes it.
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-node=new_group] > .title-band')).cursor"), "grab");
  const band = await point("[data-node=new_group] > .title-band", .92); const moves = edits.length; before = await revision();
  await drag(band, { x: band.x + 30, y: band.y + 20 }); await after(before); assert.equal(edits.length, moves + 1); assert.equal(edits.at(-1).id, "new_group");
  const width = node("new_group").w, corner = await point("[data-node=new_group] > .resize-handle"); before = await revision();
  await drag(corner, { x: corner.x + 80, y: corner.y + 40 }); await after(before);
  assert.equal(toolbarEdits.at(-1).kind, "resize"); assert(node("new_group").w > width, "the corner handle widens the group"); assert.equal((await rows()).length, 4, "resize adds no chat line");
  // U-05: a box dropped on the group moves inside (drop target lit); dropped on bare canvas it moves out.
  const inside = await point("[data-node=new_group]", .5, .6); before = await revision();
  await drag(await point("[data-node=new_box_2]", .25, .25), inside, async () => assert(await evaluate("!!document.querySelector('[data-node=new_group].drop-target')"), "the drop group lights up")); await after(before);
  assert.equal(node("new_box_2").parent, "new_group"); assert.equal((await rows()).at(-1), 'Move "New box 2" (@new_box_2) into "New group" (@new_group)');
  const out = await emptyAt(40, 40); before = await revision(); await drag(await point("[data-node=web_client]", .25, .25), out); await after(before);
  assert.equal(node("web_client").parent, undefined); assert.equal((await rows()).at(-1), 'Move "Web client" (@web_client) out of "New group" (@new_group)');
  // E-04: a tap on the title band selects the group; a swatch recolors it.
  await tap(await point("[data-node=new_group] > .title-band", .92)); assert.equal(await evaluate("document.getElementById('diagram').dataset.selected"), "new_group");
  await browser("click", "[data-color='4']"); await browser("wait", "--fn", "document.getElementById('message-input').value.includes('Recolor')");
  await browser("click", "[data-tool=box]"); await browser("press", "Escape"); assert.equal(await evaluate("document.querySelector('[data-tool=select]').getAttribute('aria-pressed')"), "true", "Escape returns to Select");
  // U-07 + E-05: deleting the pending group names what goes with it, removes its cascade and drops exactly those lines, keeping the user's typing.
  await browser("fill", "#message-input", "my note\n" + await composer());
  await tap(await point("[data-node=new_group] .node-label")); await browser("wait", "--fn", "document.getElementById('comment-prompt').open");
  await browser("click", "#comment-delete"); assert.equal(await evaluate("document.getElementById('comment-delete').textContent"), 'Confirm: delete group "New group" and 2 inside');
  before = await revision(); await browser("click", "#comment-delete"); await after(before);
  assert.deepEqual(["new_group", "new_box", "new_box_2"].map(id => node(id)), [undefined, undefined, undefined]); assert(node("web_client"), "the box moved out stays");
  // A2: a Project edit keeps its context after switching to Plan, even with the same id in both diagrams.
  // `!cmd` runs through Pi's bash command (not a prompt): the command and its output show as your row.
  { const before = messages.length; await browser("fill", "#message-input", "!echo hi"); await browser("click", "#send");
  await browser("wait", "--fn", "[...document.querySelectorAll('#messages li.user')].some(li => li.textContent.includes('ran echo hi'))");
  assert.equal(messages.length, before, "no prompt was sent"); }
  await browser("fill", "#message-input", ""); await browser("click", "#tab-project");
  await browser("click", "[data-tool=box]"); await tap(await emptyAt(40, 40)); await browser("wait", "[data-node=new_box]");
  await browser("click", "#tab-plan"); await browser("wait", "[data-node=web_client]");
  await browser("click", "[data-tool=box]"); await tap(await emptyAt(40, 40)); await browser("wait", "[data-node=new_box]");
  await browser("press", "Escape"); const sentBefore = messages.length; await browser("click", "#send");
  await browser("wait", "--fn", "document.getElementById('message-input').value === ''");
  assert.equal(messages.length, sentBefore + 1); assert.deepEqual(messages.at(-1).diagrams, [{ target: "product", ids: ["new_box"] }, { target: "12345678", ids: ["new_box"] }], "Send carries each line's diagram");
  // Paste an image and send at once: Send waits for the upload, so text and image go in one message (not text now, image as a steer).
  { const before = messages.length;
  await evaluate(`(() => { const box = document.getElementById("message-input"); box.value = "look at this"; const data = new DataTransfer(); data.items.add(new File([Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0))], "p.png", { type: "image/png" })); box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); document.getElementById("composer").requestSubmit(); })()`);
  await browser("wait", "--fn", "document.getElementById('message-input').value === ''");
  assert.equal(messages.length, before + 1, "one message");
  const pastedImage = messages.at(-1).text.match(/\S*pi-clipboard-[0-9a-f-]+\.png/)?.[0]; assert(messages.at(-1).text.startsWith("look at this") && pastedImage, "the pasted image rides in the same message: " + messages.at(-1).text); await rm(pastedImage); }
  await browser("click", "#generate"); await browser("wait", "--fn", "document.getElementById('prompt').open");
  assert.equal(await evaluate("document.querySelector('#prompt-form textarea').value"), "Saved directions", "Generate opens a pre-filled prompt");
  // A prompt's answer box takes a pasted (or picked) image: its path is inserted and a small thumbnail shows below.
  assert(await evaluate("!!document.querySelector('#prompt-form .attach input[type=file]')"), "prompts offer an Image picker");
  await evaluate(`(() => { const data = new DataTransfer(); data.items.add(new File([Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0))], "p.png", { type: "image/png" })); document.querySelector("#prompt-form textarea").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); })()`);
  await browser("wait", "--fn", "document.querySelector('#prompt-form .prompt-thumbs img')?.naturalWidth > 0");
  const promptImage = (await evaluate("document.querySelector('#prompt-form textarea').value")).match(/\S*pi-clipboard-[0-9a-f-]+\.png/)?.[0]; assert(promptImage, "the pasted image path is in the answer");
  assert.equal(await evaluate("document.querySelector('#prompt-form .prompt-thumbs img').naturalWidth"), 1); await rm(promptImage);
  // Clicking a thumbnail opens the full-size viewer in the page.
  await evaluate("document.querySelector('#prompt-form .prompt-thumbs .thumb').click()");
  assert(await evaluate("document.getElementById('viewer').open && document.querySelector('#viewer img').src.includes('/api/image?')"), "thumbnail opens the in-page viewer");
  await evaluate("document.getElementById('viewer').click()"); assert.equal(await evaluate("document.getElementById('viewer').open"), false);
  await browser("click", "#prompt-form button.danger"); await browser("wait", "--fn", "!document.getElementById('prompt').open");
  assert.deepEqual(answers.at(-1), { cancelled: true }, "Cancel reaches Pi");
  await browser("set", "viewport", "390", "800");
  assert.equal(await evaluate("document.getElementById('edit-bar').getClientRects().length"), 0, "no editing bar on the phone");
  await browser("set", "viewport", "1280", "800"); await browser("fill", "#message-input", "");
 }
 const productSample = JSON.parse(await readFile(new URL("./fixtures/diagrams/ce-workflow.diagram.json", import.meta.url), "utf8"));
 diagram = { ...productSample, kind: "plan", plan: "12345678", revision: diagram.revision + 1 }; publish("diagram", { target: { kind: "plan", id: "12345678" }, diagram });
 await browser("wait", "--fn", "document.getElementById(\"diagram\").dataset.revision === " + JSON.stringify(String(diagram.revision)));
 await browser("click", "#zoom-fit");
 assert(await evaluate("document.querySelectorAll(\"[data-node]\").length > 0"), "whole-product sample renders");
 const errors = await browser("errors"); assert.deepEqual(errors.errors ?? [], [], "browser JavaScript must run under the strict CSP");
 // A long tool-only turn fills the first 20-row page with hidden rows; compact keeps loading until the earlier prompt shows.
 // Pi-shaped events go through the hub's chat mirror, so the reloaded page gets them as pages.
 await evaluate("localStorage.setItem(\"plan3-chat\", \"compact\")");
 const view = hub.views.get(id), t0 = Date.now();
 view.emit("message_end", { message: { role: "user", timestamp: t0, content: [{ type: "text", text: "Earlier question" }] } });
 for (let n = 1; n <= 25; n++) view.emit("message_end", { message: { role: "assistant", timestamp: t0 + n, content: [{ type: "toolCall", id: "tl" + n, name: "bash", arguments: {} }] } });
 view.emit("message_end", { message: { role: "assistant", timestamp: t0 + 30, content: [{ type: "text", text: "Long turn done" }] } });
 await browser("reload");
 await browser("wait", "--fn", "document.documentElement.classList.contains(\"chat-compact\")");
 // The reload drew the sidebar from the last list at once (sessionStorage), before the hub answered, without errors.
 assert.deepEqual((await browser("errors")).errors ?? [], []); assert.equal(await evaluate("document.getElementById(\"switcher\").hidden"), false);
 await browser("wait", "--fn", "[...document.querySelectorAll(\"#messages li\")].some(item => item.textContent.includes(\"Earlier question\") && item.offsetParent)");
 await evaluate("localStorage.setItem(\"plan3-chat\", \"expanded\")");
 console.log(`ok - hub page against the real hub and fake Pi: browser shell, session bar, semantic zoom, deterministic strokes, pan, revision-checked drag, node/edge/canvas notes and responsive resize; session=${session}`);
} finally {
 await hub.stop(); relay.close(); relay.closeAllConnections(); await rm(root, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
 if (!process.argv.includes("--keep-browser")) await browser("close").catch(() => {}); // a failed close must not hide the test failure
}
