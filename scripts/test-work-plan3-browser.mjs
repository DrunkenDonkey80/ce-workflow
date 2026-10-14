import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";
const { applyDiagramOperations } = await createJiti(import.meta.url).import("../extensions/plan3-diagram.ts");
const { createPlan3Web, createDialogBridge, WebError, savePastedImage } = await createJiti(import.meta.url).import("../extensions/plan3-web.ts");
const binary = process.platform === "win32" ? join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe") : "agent-browser";
const session = `ce-plan3-ui-${process.pid}`, execute = promisify(execFile);
async function browser(...args) {
 const { stdout } = await execute(binary, ["--session", session, "--json", ...args], { timeout: 30_000, maxBuffer: 2_000_000 });
 const result = JSON.parse(stdout); assert(result.success, JSON.stringify(result)); return result.data;
}
// agent-browser 0.38.2 drops held mouse modifiers; CDP sends trusted input with explicit bits.
async function withPageCdp(origin, run) {
 const { cdpUrl } = await browser("get", "cdp-url"); assert(cdpUrl.startsWith("ws://127.0.0.1:"));
 const socket = new WebSocket(cdpUrl), pending = new Map(); let sequence = 0;
 socket.addEventListener("message", event => { const value = JSON.parse(event.data), request = pending.get(value.id); if (!request) return; pending.delete(value.id); clearTimeout(request.timer); if (value.error) request.reject(new Error(value.error.message)); else request.resolve(value.result); });
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
const sample = JSON.parse(await readFile(new URL("./fixtures/diagrams/upload-service.diagram.json", import.meta.url), "utf8"));
let diagram = { ...sample, kind: "plan", plan: "12345678" }; const edits = [], comments = [];
// D18 switcher fixtures: this page (idle, unseen until the page marks it), one working and one waiting session.
const seenCalls = []; let ownRevisionSeen = 0, ownRevision = 3, otherSessions = false, beta = { state: "working", revision: 1, unseen: false };
const sessionList = () => [{ id: "a", name: "alpha", cwd: "C:/work/alpha", port: server.port, state: "idle", revision: ownRevision, unseen: ownRevisionSeen < ownRevision },
 ...!otherSessions ? [] : [{ id: "b", name: "beta", cwd: "C:/work/beta", port: 1, ...beta }, { id: "c", name: "gamma", cwd: "/srv/gamma", port: 2, state: "waiting", revision: 0, unseen: false }]];
let status = { model: { provider: "a", id: "fast", name: "Fast" }, effort: "high", context: 41.6 };
let projectFiles = [{ path: "docs/readme.md" }, { path: "src/app.ts", change: "M" }, { path: "top.txt" }];
diagram.nodes.find(node => node.id === "backend").summary = "Manages upload writes.";
const listeners = new Map(), answers = [], messages = [], commands = [], chatRows = new Map(); let rejectMessage = false, activity = { working: false };
const events = { on(name, run) { const rows = listeners.get(name) ?? new Set(); rows.add(run); listeners.set(name, rows); return () => rows.delete(run); }, emit(name, value) { for (const run of listeners.get(name) ?? []) run(value); } };
events.on("ask:answer", value => answers.push(value));
const dialogs = createDialogBridge({ events }, (event, value) => server.publish(event, value));
const ask = value => { const askId = randomUUID(); events.emit("ask:pending", { askId, ...value }); return askId; };
const server = await createPlan3Web({ snapshot: target => ({ target, plan: { id: "12345678", title: sample.title, status: "draft", done: 2, total: 5 }, status, activity, chat: [...chatRows.values()], dialogs: dialogs.snapshot() }), read: (endpoint, params) => {
 if (endpoint === "/api/models") return { ...status, efforts: ["low", "high"], scoped: [{ provider: "a", id: "fast", name: "Fast" }, { provider: "b", id: "deep", name: "Deep" }], others: [{ provider: "b", id: "other", name: "Other" }] };
 if (endpoint === "/api/usage") return { summary: [{ label: "Claude", left: 53, color: "text" }, { label: "Codex", left: 12, color: "error" }], lines: [[{ text: "Claude", color: "accent" }, { text: " 7d [████░░░░] 53%" }], [{ text: "Codex", color: "accent" }, { text: " 7d 12%", color: "error" }]] };
 if (endpoint === "/api/commands") return { pi: [{ name: "plan3", description: "Plan" }], wo: [{ value: "share", description: "Toggle sharing" }] };
 if (endpoint === "/api/files") return { files: projectFiles, truncated: false, git: true };
 if (endpoint === "/api/file") return { path: params.get("path"), content: "<img src=x onerror=alert(1)>\nplain" };
 if (endpoint === "/api/diff") return { path: params.get("path"), diff: "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old line\n+new line" };
 if (endpoint === "/api/row") return { id: params.get("id"), role: "assistant", text: "Short excerpt. Full body loaded.", streaming: false };
 assert.equal(endpoint, "/api/diagram"); return { target: { kind: "plan", id: "12345678" }, diagram };
}, post: (endpoint, body) => {
 assert.equal(body.target, "12345678");
 if (endpoint === "/api/answer") return dialogs.answer(body);
 if (endpoint === "/api/message" && body.text.startsWith("/")) { commands.push(body.text); return { accepted: true }; }
 if (endpoint === "/api/message") {
  if (rejectMessage) { rejectMessage = false; throw new WebError(503, "Session temporarily unavailable"); }
  messages.push(body); const row = { id: "user_" + messages.length, role: "user", text: body.text, at: new Date().toISOString(), streaming: false };
  chatRows.set(row.id, row); server.publish("message", row); return { accepted: true, queued: activity.working };
 }
 if (endpoint === "/api/model") { status = { ...status, model: { provider: body.provider, id: body.id, name: body.id } }; server.publish("status", status); return status; }
 if (endpoint === "/api/effort") { status = { ...status, effort: body.level }; return status; }
 if (endpoint === "/api/stop") { activity = { working: false }; server.publish("activity", activity); return { accepted: true }; }
 assert(["/api/move", "/api/comment"].includes(endpoint));
 if (body.expectedRevision !== diagram.revision) throw new WebError(409, "Stale diagram revision");
 const operation = endpoint === "/api/move" ? { op: "move", entity: body.entity, id: body.id, x: body.x, y: body.y } : { op: "add", entity: "note", value: { text: body.text, author: "user", created: new Date().toISOString(), ...(body.element ? { target: body.element } : { x: body.x, y: body.y }) } };
 (endpoint === "/api/move" ? edits : comments).push(body); diagram = applyDiagramOperations(diagram, [operation]).diagram; diagram.revision++;
 server.publish("diagram", { target: { kind: "plan", id: "12345678" }, diagram }); return { diagram };
}, sessions: { list: () => sessionList(), seen: (device, revision) => { seenCalls.push({ device, revision }); ownRevisionSeen = revision; return true; } } });
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
 // R7 collapse states: narrow gives the panel the chat's width; collapsed leaves only >>.
 const width = id => evaluate(`Math.round(document.getElementById(${JSON.stringify(id)}).getBoundingClientRect().width)`);
 await browser("click", "#narrow-left");
 assert.deepEqual([await width("left-panel"), await width("chat")], [640, 628]);
 await browser("focus", "#splitter"); await browser("press", "ArrowLeft");
 assert.equal(await width("left-panel"), 630, "in narrow mode the arrows move the splitter the way they point");
 await browser("press", "End"); await browser("click", "#narrow-left"); assert.equal(await width("chat"), 640);
 await browser("click", "#collapse-left");
 assert.equal(await evaluate("document.activeElement.id"), "expand-left");
 assert.equal(await evaluate("document.getElementById(\"left-panel\").getClientRects().length"), 0);
 assert(await width("chat") > 1200, "collapsed: chat takes the width");
 assert.equal(await evaluate("localStorage.getItem(\"plan3-left\")"), "collapsed");
 await browser("click", "#expand-left"); assert.equal(await width("chat"), 640);
 await browser("click", "#tab-files");
 assert.deepEqual(await evaluate("[document.getElementById(\"files\").hidden, document.getElementById(\"canvas\").hidden, document.getElementById(\"tab-files\").getAttribute(\"aria-selected\")]"), [false, true, "true"]);
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
 projectFiles = [...projectFiles, { path: "src/new.ts", change: "??" }]; server.publish("files", {});
 await browser("wait", "[data-path=\"src/new.ts\"]");
 await browser("set", "viewport", "390", "844"); await browser("click", "#drawer-toggle"); await browser("click", "#mobile-files");
 assert(await evaluate("document.querySelector('.files-viewer').getBoundingClientRect().top >= document.querySelector('.files-tree').getBoundingClientRect().bottom - 1"), "phone: tree above the viewer");
 assert.equal(await evaluate("document.getElementById('chat').getClientRects().length"), 0, "phone shows one view at a time");
 await browser("set", "viewport", "1280", "800");
 await browser("focus", "#tab-files"); await browser("press", "ArrowRight"); assert.equal(await evaluate("document.activeElement.id"), "tab-diagram");
 assert.equal(await evaluate("document.getElementById(\"canvas\").hidden"), false);
 // R9/E5 at 390 px: Chat, Files and Diagram tabs; the composer and the attach button stay on screen.
 await browser("set", "viewport", "390", "844");
 await browser("click", "#drawer-toggle"); await browser("click", "#mobile-diagram");
 assert.deepEqual(await evaluate("[document.getElementById('canvas').getBoundingClientRect().width, document.getElementById('drawer').dataset.open]"), [390, "false"], "picking a view closes the drawer");
 await browser("click", "#drawer-toggle"); assert.equal(await evaluate("document.activeElement.id"), "mobile-diagram", "the drawer opens on the current view");
 await browser("press", "ArrowRight"); assert.equal(await evaluate("document.activeElement.id"), "mobile-chat");
 assert(await evaluate("['model-button', 'think-button', 'plan-button', 'usage-button', 'pi-commands', 'wo-commands'].every(id => document.getElementById('drawer').contains(document.getElementById(id)))"), "phone: status line and command buttons live in the drawer");
 await browser("click", "#wo-commands"); await browser("wait", ".command-option");
 await browser("click", ".command-option"); assert.deepEqual(await evaluate("[document.getElementById('message-input').value, document.getElementById('command-picker').open, document.getElementById('drawer').dataset.open]"), ["/wo share ", false, "false"], "a picked command goes into the composer");
 await browser("fill", "#message-input", "");
 await browser("click", "#title"); assert(await evaluate("!document.getElementById('title-menu').hidden && document.getElementById('title-menu').contains(document.getElementById('session-list'))"), "phone: the title opens the session picker");
 await browser("press", "Escape"); assert.equal(await evaluate("document.getElementById('title-menu').hidden"), true);
 await browser("click", "#drawer-toggle");
 await browser("press", "Escape"); assert.deepEqual(await evaluate("[document.getElementById('drawer').dataset.open, document.activeElement.id, document.getElementById('drawer-backdrop').hidden]"), ["false", "drawer-toggle", true]);
 // E5 finding: the chat itself gets most of the screen; only a slim bar sits above it.
 assert(await evaluate("(() => { const m = document.getElementById('messages').getBoundingClientRect(); return m.top < 60 && m.height > innerHeight * 0.6; })()"), "phone: messages fill the screen");
 assert.deepEqual(await evaluate("[document.getElementById('left-panel').getClientRects().length, document.querySelector('.left-tabs').getClientRects().length]"), [0, 0]);
 assert(await evaluate("(() => { const r = document.getElementById('composer').getBoundingClientRect(), a = document.querySelector('.attach').getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.top > innerHeight / 2 && a.width > 0 && a.bottom <= innerHeight; })()"), "composer and attach stay on screen");
 assert.equal(await evaluate("document.documentElement.scrollWidth"), 390, "no sideways scrolling");
 await browser("set", "viewport", "1280", "800");
 assert(await evaluate("document.getElementById('left-panel').getClientRects().length > 0 && document.getElementById('chat').getClientRects().length > 0 && document.getElementById('mobile-tabs').getClientRects().length === 0"), "desktop ignores the phone view");
 assert(await evaluate("document.getElementById('chat').contains(document.getElementById('model-button')) && document.getElementById('switcher').contains(document.getElementById('session-list')) && document.querySelector('.chat-heading').contains(document.getElementById('connection'))"), "desktop puts the status line, sessions and connection back");
 await browser("focus", "#splitter"); await browser("press", "Home");
 await browser("click", "#zoom-fit");
 // The compact layout may fit at mid zoom; zoom out to the overview band explicitly.
 for (let i = 0; i < 6 && await evaluate("document.getElementById(\"diagram\").dataset.band") !== "far"; i++) await browser("click", "#zoom-out");
 assert.equal(await evaluate("document.getElementById(\"diagram\").dataset.band"), "far");
 assert.equal(await evaluate("document.querySelectorAll(\"[data-node]\").length"), sample.nodes.filter(node => !node.parent).length);
 for (let i = 0; i < 3; i++) await browser("click", "#zoom-in");
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
 assert.equal(await shown("web_client__load_balancer"), false, "leaving the node restores the calm view");
 await browser("press", "Escape"); const lb = await evaluate("(() => { const r = document.querySelector(\"[data-node=load_balancer]\").getBoundingClientRect(); return { x: Math.round(r.x + 20), y: Math.round(r.y + 20) }; })()"); await browser("mouse", "move", String(lb.x), String(lb.y)); await browser("mouse", "down", "left"); await browser("mouse", "up", "left"); await browser("focus", "#zoom-fit");
 assert.equal(await shown("web_client__load_balancer"), true, "a clicked box stays in focus");
 await browser("mouse", "move", "2", "2"); await browser("press", "Escape"); assert.equal(await shown("web_client__load_balancer"), false, "Escape clears focus");
 await assert.rejects(savePastedImage(Buffer.from("<svg onload=alert(1)>")), /PNG, JPEG/, "non-image paste rejected by magic bytes");
 // Clipboard image paste: saved as a temp file, path inserted into the draft.
 await evaluate("(() => { const data = new DataTransfer(); data.items.add(new File([new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3])], \"shot.png\", { type: \"image/png\" })); document.getElementById(\"message-input\").dispatchEvent(new ClipboardEvent(\"paste\", { clipboardData: data, bubbles: true, cancelable: true })); })()");
 await browser("wait", "--fn", "/pi-clipboard-[0-9a-f-]+\\.png/.test(document.getElementById(\"message-input\").value)");
 const pasted = (await evaluate("document.getElementById(\"message-input\").value")).trim();
 assert.deepEqual([...(await readFile(pasted))].slice(0, 8), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); await rm(pasted);
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
 const canvasTop = await evaluate("Math.round(document.getElementById(\"diagram\").getBoundingClientRect().top)");
 await browser("mouse", "move", "8", String(canvasTop + 8)); await browser("mouse", "down", "left");
 await browser("mouse", "move", "33", String(canvasTop + 33)); await browser("mouse", "up", "left");
 assert.notEqual(await evaluate("document.getElementById(\"diagram\").firstElementChild.getAttribute(\"transform\")"), panBefore);
 assert.equal(await evaluate("document.querySelector(\"[data-node=web_client] path\").getAttribute(\"d\")"), strokeBefore, "fixed seeds keep redraw strokes stable");
 const nodePoint = await evaluate("(() => { const r = document.querySelector(\"[data-node=web_client]\").getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()");
 assert.equal(await evaluate(`document.elementFromPoint(${nodePoint.x}, ${nodePoint.y})?.closest("[data-node]")?.getAttribute("data-node")`), "web_client", "drag must hit the actual visible node");
 // A plain drag on a box pans; only Shift+drag (CDP modifier 8, agent-browser has no held keys) moves it.
 const shiftDrag = (from, modifiers = 8) => withPageCdp(server.origin, async send => { for (const [type, at, buttons] of [["mouseMoved", from, 0], ["mousePressed", from, 1], ["mouseMoved", { x: from.x + 15, y: from.y - 10 }, 1], ["mouseMoved", { x: from.x + 30, y: from.y - 20 }, 1], ["mouseReleased", { x: from.x + 30, y: from.y - 20 }, 0]]) await send("Input.dispatchMouseEvent", { ...at, type, modifiers, buttons, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) }); });
 const panBox = await evaluate("document.getElementById(\"diagram\").firstElementChild.getAttribute(\"transform\")");
 // Settle first: the agent-browser drag just above and this fresh CDP input connection can race (seen 1 in ~10 runs).
 await new Promise(done => setTimeout(done, 300)); await shiftDrag(nodePoint, 0); await new Promise(done => setTimeout(done, 300));
 assert.equal(edits.length, 0, "plain drag never moves a box"); assert.notEqual(await evaluate("document.getElementById(\"diagram\").firstElementChild.getAttribute(\"transform\")"), panBox, "plain drag on a box pans");
 const movePoint = await evaluate("(() => { const r = document.querySelector(\"[data-node=web_client]\").getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()");
 await shiftDrag(movePoint);
 await browser("wait", "--fn", "document.getElementById(\"diagram\").dataset.revision === \"2\"");
 assert.equal(edits.length, 1); assert.equal(edits[0].id, "web_client"); assert.equal(edits[0].expectedRevision, 1);
 assert(Number.isFinite(diagram.nodes.find(node => node.id === "web_client").x));
 const savedPosition = { ...diagram.nodes.find(node => node.id === "web_client") }; diagram.revision++;
 // Grab the header: the zoom controls may cover the middle of a box near the bottom edge.
 const stalePoint = await evaluate("(() => { const r = document.querySelector(\"[data-node=web_client]\").getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 12) }; })()");
 await shiftDrag(stalePoint);
 await browser("wait", "--fn", "document.getElementById(\"diagram\").dataset.revision === \"3\"");
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
 await browser("mouse", "move", "8", String(commentCanvasTop + 8)); await browser("mouse", "down", "left"); await browser("mouse", "up", "left");
 assert(await evaluate("document.getElementById(\"comment-prompt\").open"), "canvas click must open the comment dialog");
 await browser("fill", "#comment-text", "Canvas follow-up"); await browser("click", "#comment-save");
 await browser("wait", "--fn", "document.getElementById(\"diagram\").dataset.revision === \"5\"");
 assert.equal(diagram.notes.at(-1).target, undefined); assert(Number.isFinite(comments[1].x));
 await browser("click", "#pin-note"); await browser("focus", "[data-edge=cdn__web_client]"); await browser("press", "Enter");
 await browser("fill", "#comment-text", "Check CDN invalidation"); await browser("click", "#comment-save");
 await browser("wait", "--fn", "document.getElementById(\"diagram\").dataset.revision === \"6\"");
 assert.equal(comments[2].element, "cdn__web_client"); assert.equal(diagram.notes.at(-1).target, "cdn__web_client");
 await browser("click", "#zoom-fit");
 for (let i = 0; i < 6 && await evaluate("document.getElementById(\"diagram\").dataset.band") !== "far"; i++) await browser("click", "#zoom-out");
 await browser("hover", "[data-node=backend]");
 assert(await evaluate("document.getElementById(\"hover-card\").textContent.includes(\"Multipart above 100 MB\")"), "collapsed groups reveal descendant comments");
 await browser("press", "Escape");
 for (let i = 0; i < 10 && await evaluate("document.getElementById(\"diagram\").dataset.band") !== "near"; i++) await browser("click", "#zoom-in");
 assert.equal(await evaluate("document.getElementById(\"diagram\").dataset.band"), "near");
 assert(await evaluate("document.querySelectorAll(\"foreignObject .note-text\").length >= 6"));
 assert.equal(await evaluate("document.querySelector(\"foreignObject img\")"), null, "note markup stays inert text");
 await browser("reload"); await browser("wait", "--fn", "document.getElementById(\"diagram\").dataset.revision === \"6\"");
 assert.deepEqual(diagram.nodes.find(node => node.id === "web_client"), savedPosition, "saved drag survives the full snapshot after reload");
 assert.equal(await evaluate("document.querySelectorAll(\"[data-note]\").length"), 6, "saved notes survive reload");
 await browser("click", "#zoom-fit"); await browser("click", "#zoom-in");
 // Search: Ctrl+F focuses it, matches stay lit, Enter centers the next match (brings the box out from under the zoom bar).
 await browser("focus", "#diagram"); await browser("press", "Control+f"); assert.equal(await evaluate("document.activeElement.id"), "search");
 await browser("fill", "#search", "web client"); assert(await evaluate("document.getElementById(\"diagram\").classList.contains(\"searching\") && document.querySelector(\"[data-node=web_client]\").classList.contains(\"match\") && !document.querySelector(\"[data-node=worker]\").classList.contains(\"match\")"));
 await browser("press", "Enter"); await browser("press", "Escape"); assert.equal(await evaluate("document.getElementById(\"diagram\").classList.contains(\"searching\")"), false);
 // Right-click a box: composer gets "note @id: ", Enter saves it as a pinned note instead of a chat message.
 const notePoint = await evaluate("(() => { const r = document.querySelector(\"[data-node=web_client]\").getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 12) }; })()");
 await withPageCdp(server.origin, async send => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { ...notePoint, type, ...(type === "mouseMoved" ? {} : { button: "right", buttons: type === "mousePressed" ? 2 : 0, clickCount: 1 }) }); });
 assert.equal(await evaluate("document.getElementById(\"message-input\").value"), "note @web_client: ");
 const messagesBeforeNote = messages.length; await browser("keyboard", "type", "retry budget"); await browser("press", "Enter");
 await browser("wait", "--fn", "document.getElementById(\"diagram\").dataset.revision === \"7\"");
 assert.equal(comments.at(-1).element, "web_client"); assert.equal(comments.at(-1).text, "retry budget"); assert.equal(messages.length, messagesBeforeNote, "notes do not become chat messages");
 await withPageCdp(server.origin, send => send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }));
 assert(await evaluate("matchMedia(\"(prefers-reduced-motion: reduce)\").matches"));
 assert.equal(await evaluate("getComputedStyle(document.getElementById(\"diagram\")).animationDuration"), "0s");
 await browser("focus", "#zoom-in"); await browser("press", "Tab");
 assert.equal(await evaluate("document.activeElement.id"), "zoom-fit");
 assert.equal(await evaluate("getComputedStyle(document.activeElement).outlineWidth"), "2px", "keyboard focus is visibly outlined");
 const reply = { id: "assistant_1", role: "assistant", text: "Reviewing", at: new Date().toISOString(), streaming: true };
 chatRows.set(reply.id, reply); server.publish("message", reply);
 await browser("wait", "--fn", "document.getElementById(\"messages\").textContent.includes(\"Reviewing\")");
 reply.text = "Reviewing upload limits: complete."; reply.streaming = false; server.publish("message", reply);
 await browser("wait", "--fn", "document.getElementById(\"messages\").textContent.includes(\"complete.\")");
 assert.equal(await evaluate("document.querySelectorAll(\"#messages [data-id=assistant_1]\").length"), 1, "stream updates reuse their row");
 server.publish("message", { id: "assistant_2", role: "assistant", text: "Short excerpt", streaming: false, excerpt: true });
 await browser("wait", "--fn", "!document.querySelector(\"#messages [data-id=assistant_2] .row-full\")?.hidden");
 await browser("click", "#messages [data-id=assistant_2] .row-full");
 await browser("wait", "--fn", "document.getElementById(\"messages\").textContent.includes(\"Full body loaded\")");
 assert(await evaluate("document.querySelector(\"#messages [data-id=assistant_2] .row-full\").hidden"), "expanded row drops the excerpt link");
 const rowText = id => evaluate(`document.querySelector("#messages [data-id=${id}]").children[2].textContent`);
 server.publish("delta", { id: "assistant_3", role: "assistant", offset: 0, text: "Hel", streaming: true });
 server.publish("delta", { id: "assistant_3", role: "assistant", offset: 3, text: "lo", streaming: true });
 server.publish("delta", { id: "assistant_3", role: "assistant", offset: 1, text: "e", streaming: true });
 await browser("wait", "--fn", "document.querySelector(\"#messages [data-id=assistant_3]\")?.children[2].textContent === \"Hello\"");
 server.publish("delta", { id: "assistant_3", role: "assistant", offset: 5, text: " world", streaming: false });
 await browser("wait", "--fn", "document.querySelector(\"#messages [data-id=assistant_3]\")?.children[2].textContent === \"Hello world\"");
 server.publish("delta", { id: "assistant_3", role: "assistant", offset: 99, text: "x", streaming: false });
 await browser("wait", "--fn", "document.querySelector(\"#messages [data-id=assistant_3]\")?.children[2].textContent.includes(\"Full body loaded\")");
 assert.equal(await rowText("assistant_3"), "Short excerpt. Full body loaded.", "a gap refetches the row; stale deltas never duplicate text");
 // Pi-style colour coding: tool blocks by state, an edit's diff instead of its arguments, labels only for screen readers.
 server.publish("message", { id: "assistant_4", role: "assistant", text: "", streaming: false, blocks: [
  { type: "thinking", text: "hmm" },
  { type: "tool", id: "t1", name: "edit", title: "edit a.ts", args: "{oldText}", result: "ok", diff: "-1 old\n+1 new\n 2 same" },
  { type: "tool", id: "t2", name: "bash", title: "bash ls", args: "{}", result: "boom", error: true },
  { type: "tool", id: "t3", name: "read", title: "read b.ts", args: "{}" }] });
 await browser("wait", "#messages [data-id=assistant_4] .block-tool");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('#messages [data-id=assistant_4] details')].map(item => item.className)"), ["block block-thinking", "block block-tool block-ok", "block block-tool block-error", "block block-tool block-pending"]);
 assert.deepEqual(await evaluate("[...document.querySelectorAll('#messages [data-id=assistant_4] .diff span')].map(span => span.className)"), ["diff-del", "diff-add", ""]);
 assert.equal(await evaluate("[...document.querySelectorAll('#messages [data-id=assistant_4] pre')].some(pre => pre.textContent === '{oldText}')"), false, "the diff replaces raw edit arguments");
 server.publish("message", { id: "user_0", role: "user", text: "hi", streaming: false }); await browser("wait", "#messages [data-id=user_0]");
 assert.deepEqual(await evaluate("['user_0', 'assistant_3'].flatMap(id => { const row = document.querySelector('#messages [data-id=' + id + ']'); return [row.querySelector('strong').className, getComputedStyle(row).backgroundColor !== 'rgba(0, 0, 0, 0)']; })"), ["sr-only", true, "sr-only", false], "your messages are a tinted block; the label is screen-reader only");
 await browser("click", "#zoom-fit"); await browser("click", "#zoom-in");
  // Search Enter centers the box, so the click point is clear of the zoom bar; Escape clears the search.
 await browser("fill", "#search", "web_client"); await browser("press", "Enter"); await browser("press", "Escape");
 const mentionPoint = await evaluate("(() => { const r = document.querySelector(\"[data-node=web_client]\").getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()");
 await evaluate("window.mentionEvents = []; for (const name of [\"pointerdown\", \"click\"]) document.addEventListener(name, event => window.mentionEvents.push({ name, trusted: event.isTrusted, ctrl: event.ctrlKey, node: event.target.closest(\"[data-node]\")?.dataset.node }), true)");
 const revisionBeforeMention = diagram.revision, movesBeforeMention = edits.length;
 await withPageCdp(server.origin, async send => { for (const [type, buttons] of [["mouseMoved", 0], ["mousePressed", 1], ["mouseReleased", 0]]) await send("Input.dispatchMouseEvent", { ...mentionPoint, type, modifiers: 2, ...(type === "mouseMoved" ? {} : { button: "left", buttons, clickCount: 1 }) }); });
 assert.deepEqual(await evaluate("window.mentionEvents"), [{ name: "pointerdown", trusted: true, ctrl: true, node: "web_client" }, { name: "click", trusted: true, ctrl: true, node: "web_client" }]);
 assert.equal(diagram.revision, revisionBeforeMention); assert.equal(edits.length, movesBeforeMention, "modified clicks cannot start a drag");
 assert.equal(await evaluate("document.getElementById(\"message-input\").value"), "@web_client ");
 await browser("fill", "#message-input", "@web_client @ghost person@cdn.example.com <img src=x onerror=alert(1)>");
 assert.equal(await evaluate("document.querySelectorAll(\".mention-chip\").length"), 2, "emails are not mentions");
 await browser("click", "#send"); await browser("wait", "--fn", "document.getElementById(\"message-input\").value === \"\"");
 assert(messages[0].text.includes("@web_client")); assert.equal(await evaluate("document.querySelector(\"#messages img\")"), null);
 rejectMessage = true; await browser("fill", "#message-input", "Keep this draft"); await browser("press", "Control+Enter");
 await browser("wait", "--fn", "document.getElementById(\"notice\").textContent.includes(\"draft is kept\")");
 assert.equal(await evaluate("document.getElementById(\"message-input\").value"), "Keep this draft");
 ask({ question: "Pick a colour", context: "Single choice", options: [{ title: "Blue" }, { title: "Pink" }], allowMultiple: false, allowFreeform: true, allowComment: true });
 await browser("wait", "--fn", "document.getElementById(\"prompt\").open");
 await browser("click", "#prompt-form input[value=Blue]"); await browser("fill", "#prompt-form textarea[placeholder=\"Optional comment\"]", "Matches the boxes"); await browser("click", "#prompt-form button[type=submit]");
 await browser("wait", "--fn", "!document.getElementById(\"prompt\").open");
 assert.deepEqual(answers.at(-1).selections, ["Blue"]); assert.equal(answers.at(-1).comment, "Matches the boxes");
 ask({ questions: [{ question: "Pick deploy targets", options: [{ title: "Alpha" }, { title: "Beta" }], allowMultiple: true, allowFreeform: false }, { question: "Name the rollout", options: [], allowMultiple: false, allowFreeform: true }], allowComment: false });
 await browser("wait", "--fn", "document.getElementById(\"prompt\").open");
 await browser("focus", "#prompt-form input[value=Alpha]"); await browser("press", "Enter");
 assert(await evaluate("document.getElementById(\"prompt\").open"), "checklist Enter toggles instead of submitting");
 await browser("focus", "#prompt-form input[value=Beta]"); await browser("press", "Space");
 await browser("fill", "#prompt-form textarea[placeholder=\"Write a custom response\"]", "Canary"); await browser("click", "#prompt-form button[type=submit]");
 await browser("wait", "--fn", "!document.getElementById(\"prompt\").open");
 assert.deepEqual(answers.at(-1).answers[0].response.selections, ["Alpha", "Beta"]); assert.equal(answers.at(-1).answers[1].response.text, "Canary");
 const terminalId = ask({ question: "Terminal wins", options: [], allowMultiple: false, allowFreeform: true });
 await browser("wait", "--fn", "document.getElementById(\"prompt\").open"); events.emit("ask:closed", { askId: terminalId });
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
 // R13/D19 status line: model · effort, plan · progress, plan menu, model and effort picker.
 assert.deepEqual(await evaluate("['model-button', 'think-button', 'plan-button', 'usage-button'].map(id => document.getElementById(id).textContent)"), ["Model: Fast", "Context: 42% · Think: high", sample.title + " · 2/5", "Claude 7d 53% · Codex 7d 12%"]);
 assert.equal(await evaluate("document.querySelector('#usage-button .tone-error').textContent"), "12%");
 await browser("click", "#usage-button"); assert.deepEqual(await evaluate("[...document.querySelectorAll('#usage-menu .usage-line')].map(line => line.textContent)"), ["Claude 7d [████░░░░] 53%", "Codex 7d 12%"]);
 await browser("press", "Escape");
 for (const command of ["resolve", "ideas", "review", "finish", "resume", "switch"]) { await browser("click", "#plan-button"); await browser("click", "[data-command=" + command + "]"); await browser("wait", "--fn", "!document.querySelector(\"[data-command=" + command + "]\").disabled"); }
 assert.deepEqual(commands, ["/plan3 resolve 12345678", "/plan3 ideas 12345678", "/plan3 review 12345678", "/plan3 finish 12345678", "/resume3 12345678", "/plan3"]);
 await browser("click", "#plan-button"); assert.equal(await evaluate("document.getElementById('plan-button').getAttribute('aria-expanded')"), "true");
 await browser("press", "Escape"); assert.deepEqual(await evaluate("[document.getElementById('plan-menu').hidden, document.activeElement.id]"), [true, "plan-button"]);
 await browser("click", "#plan-button"); await browser("click", "[data-command=new]");
 assert.deepEqual(await evaluate("[document.getElementById('message-input').value, document.activeElement.id]"), ["/plan3 ", "message-input"]); await browser("fill", "#message-input", "");
 await browser("click", "#model-button"); await browser("wait", ".model-option");
 assert.deepEqual(await evaluate("[[...document.querySelectorAll('#model-menu .model-option')].map(b => b.textContent), document.querySelector('#model-menu input'), document.activeElement.textContent]"), [["Fast", "Deep"], null, "Fast"], "scoped models only, no filter; focus on the current one");
 await browser("click", "[title='b/deep']");
 await browser("wait", "--fn", "document.getElementById('model-button').textContent === 'Model: deep'");
 assert.equal(await evaluate("document.getElementById('model-menu').hidden"), true);
 await browser("click", "#think-button"); await browser("wait", "#think-menu button");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('#think-menu button')].map(b => b.textContent + ':' + b.getAttribute('aria-pressed'))"), ["low:false", "high:true"]);
 await browser("click", "#think-menu button");
 await browser("wait", "--fn", "document.getElementById('think-button').textContent === 'Context: 42% · Think: low'");
 // D18: stripe of colour-coded letters; this page marks its own idle run seen; the list slides out and Escape closes it.
 assert.equal(await evaluate("document.getElementById('switcher').hidden"), true, "a lone session shows no switcher");
 otherSessions = true; await evaluate("document.dispatchEvent(new Event('visibilitychange'))");
 await browser("wait", "--fn", "!document.getElementById('switcher').hidden && document.querySelector('.session[data-tone=seen]')");
 assert.deepEqual(await evaluate("[...document.querySelectorAll('.session')].map(s => s.querySelector('.session-letter').textContent + ':' + s.dataset.tone + ':' + s.tagName)"), ["A:seen:SPAN", "B:working:SPAN", "G:waiting:SPAN"], "token pages never link other ports");
 assert.deepEqual(seenCalls, [{ device: "local", revision: 3 }]);
 assert.equal(await evaluate("document.querySelector('.session[aria-current=page]').getAttribute('aria-label')"), "alpha in alpha, idle, this session");
 assert.equal(await evaluate("document.querySelector('.session-label').getBoundingClientRect().width"), 1, "closed stripe shows letters only");
 await browser("click", "#switcher-toggle"); assert(await evaluate("document.querySelector('.session-label').getBoundingClientRect().width > 100"));
 await browser("press", "Escape"); assert.deepEqual(await evaluate("[document.getElementById('switcher').dataset.open, document.activeElement.id]"), ["false", "switcher-toggle"]);
 // B finishes a run: blue until seen there. A finishes another: this page marks it seen again on return.
 beta = { state: "idle", revision: 2, unseen: true }; ownRevision = 4; await evaluate("document.dispatchEvent(new Event('visibilitychange'))");
 await browser("wait", "--fn", "document.querySelector('.session[data-port=\"1\"]').dataset.tone === 'unseen'");
 assert.equal(await evaluate("document.querySelector('.session[aria-current=page]').dataset.tone"), "seen"); assert.deepEqual(seenCalls.at(-1), { device: "local", revision: 4 });
 status = { ...status, model: { provider: "t", id: "term", name: "Terminal pick" } }; server.publish("status", status);
 await browser("wait", "--fn", "document.getElementById('model-button').textContent === 'Model: Terminal pick'");
 activity = { working: true, compacting: true, thinking: "Considering <script>safe text</script>", tools: [{ id: "tool_1", name: "read", state: "running", args: "app.ts", progress: "Loading lines" }, { id: "tool_2", parent: "tool_1", name: "child", state: "done", result: "Text-only result", durationMs: 250 }], queueExact: false, queue: [{ id: "queue_1", text: "Follow up", delivery: "followUp" }] }; server.publish("activity", activity);
 await browser("wait", "--fn", "document.getElementById(\"connection\").textContent === \"Compacting\"");
 assert.equal(await evaluate("document.getElementById(\"stop\").hidden"), false);
 assert(await evaluate("document.getElementById(\"activity\").textContent.includes(\"May be stale\")"));
 assert.equal(await evaluate("document.querySelectorAll(\".nested-tool\").length"), 1); assert.equal(await evaluate("document.querySelector(\"#activity script\")"), null);
 assert.equal(await evaluate("document.querySelector(\"details[data-id=tool_1]\").open"), false, "tool rows start collapsed");
 await browser("click", "#activity details[data-id=tool_1] summary");
 activity.tools[0] = { ...activity.tools[0], state: "error", result: "Read failed", durationMs: 100 }; activity.compacting = false; activity.error = "A safe error"; server.publish("activity", activity);
 await browser("wait", "--fn", "document.getElementById(\"activity\").textContent.includes(\"Read failed\")");
 assert.equal(await evaluate("document.querySelector(\"details[data-id=tool_1]\").open"), true, "tool updates preserve disclosure state");
 // Sending from a scrolled-up chat jumps to the bottom and follows the echoed message.
 for (let i = 0; i < 30; i++) { const row = { id: "filler_" + i, role: "assistant", text: "Filler line " + i, streaming: false }; chatRows.set(row.id, row); server.publish("message", row); }
 await browser("wait", "--fn", "document.querySelector(\"#messages [data-id=filler_29]\") !== null");
 await evaluate("document.getElementById(\"messages\").scrollTop = 0");
 await browser("fill", "#message-input", "Scroll me down"); await browser("click", "#send"); await browser("wait", "--fn", "document.getElementById(\"messages\").textContent.includes(\"Scroll me down\")");
 assert(await evaluate("(() => { const list = document.getElementById(\"messages\"); return list.scrollHeight - list.scrollTop - list.clientHeight < 48; })()"), "send scrolls the chat to the newest message");
 await browser("fill", "#message-input", "Queued follow-up"); await browser("click", "#send");
 await browser("wait", "--fn", "document.getElementById(\"notice\").textContent.includes(\"queued\")");
 await browser("click", "#stop"); await browser("wait", "--fn", "document.getElementById(\"stop\").hidden");
 const productSample = JSON.parse(await readFile(new URL("./fixtures/diagrams/ce-workflow.diagram.json", import.meta.url), "utf8"));
 diagram = { ...productSample, kind: "plan", plan: "12345678", revision: diagram.revision + 1 }; server.publish("diagram", { target: { kind: "plan", id: "12345678" }, diagram });
 await browser("wait", "--fn", "document.getElementById(\"diagram\").dataset.revision === " + JSON.stringify(String(diagram.revision)));
 await browser("click", "#zoom-fit");
 assert(await evaluate("document.querySelectorAll(\"[data-node]\").length > 0"), "whole-product sample renders");
 const errors = await browser("errors"); assert.deepEqual(errors.errors ?? [], [], "browser JavaScript must run under the strict CSP");
 console.log(`ok - Plan3 browser shell, semantic zoom, deterministic strokes, pan, revision-checked drag, node/edge/canvas notes and responsive resize; session=${session}`);
} finally {
 dialogs.close(); await server.close();
 if (!process.argv.includes("--keep-browser")) await browser("close");
}
