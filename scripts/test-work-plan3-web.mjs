import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { createJiti } from "jiti";
const { applyText } = await createJiti(import.meta.url).import("../extensions/plan3-web/stream.ts");
const { createPlan3Web, checkIn, webTarget, createChatMirror, createDialogBridge, createActivityMirror, forwardDiagramChat, stopLiveRun } = await createJiti(import.meta.url).import("../extensions/plan3-web.ts");
const posted = []; let stopIdle = true, aborts = 0;
const stopCtx = { isIdle: () => stopIdle, abort: async () => { aborts++; } };
const server = await createPlan3Web({ snapshot: target => ({ target, revision: 3, title: "Safe <text>" }), post: (endpoint, value) => { posted.push({ endpoint, value }); return endpoint === "/api/stop" ? stopLiveRun(stopCtx) : { ok: true }; } });
let reader;
try {
 const opening = new URL(server.url({ kind: "plan", id: "12345678" })), token = opening.searchParams.get("token");
 const auth = { Authorization: `Bearer ${token}` };
 assert.equal(opening.hostname, "127.0.0.1");
 assert.match(token, /^[a-f0-9]{64}$/);
 assert.throws(() => webTarget("../secret"));
 assert.throws(() => webTarget("12345678/../../"));
 const request = async (url, options = {}) => { const response = await fetch(new URL(url, server.origin), options); const text = await response.text(); return { response, text }; };
 assert.equal((await request("/api/snapshot?target=product")).response.status, 401);
 assert.equal((await request("/api/snapshot?target=product", { headers: { Authorization: "Bearer bad" } })).response.status, 401);
 assert.equal((await request("/api/snapshot?target=product", { headers: { ...auth, Origin: "https://evil.example" } })).response.status, 403);
 // Node fetch replaces Host; use a raw HTTP request to exercise DNS-rebinding defense.
 const foreignHost = await new Promise((resolve, reject) => {
  const req = httpRequest(`${server.origin}/api/snapshot?target=product`, { headers: { ...auth, Host: "evil.example" } }, res => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
  req.on("error", reject); req.end();
 });
 assert.equal(foreignHost, 403);
 const snap = await request("/api/snapshot?target=12345678", { headers: auth });
 assert.equal(snap.response.status, 200);
 assert.deepEqual(JSON.parse(snap.text).target, { kind: "plan", id: "12345678" });
 assert.equal((await request("/api/snapshot", { headers: auth })).response.status, 200);
 assert.equal(new URL(server.url()).searchParams.has("target"), false);
 assert.match(snap.response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
 assert.equal(snap.response.headers.get("referrer-policy"), "no-referrer");
 assert.equal(snap.response.headers.get("x-content-type-options"), "nosniff");
 const bootstrap = await request(`/api/snapshot?token=${token}&target=product`);
 assert.equal(bootstrap.response.status, 200);
 assert.equal(bootstrap.response.headers.get("set-cookie"), null, "localhost-port sessions never leak ambient cookie credentials");
 assert.equal((await request("/api/snapshot?target=product", { headers: { Cookie: `plan3=${token}` } })).response.status, 401);
 assert.equal((await request("/api/snapshot?target=../../", { headers: auth })).response.status, 400);
 assert.equal((await request("/%2f..%2fpackage.json", { headers: auth })).response.status, 404);
 assert.equal((await request("/layout.js", { headers: auth })).response.headers.get("content-type"), "text/javascript; charset=utf-8");
 const shell = await request("/", { headers: auth });
 assert.equal(shell.response.status, 200); assert.match(shell.text, /aria-label="Resize chat pane"/);
 assert.match(shell.text, /data-command="resolve"/); assert(shell.text.includes(`app.js?token=${token}`));
 assert(!shell.text.includes("__TOKEN__")); assert(!shell.text.includes("__BUILD__"));
 assert(shell.text.includes(`/a/${server.build}/app.js?token=`)); assert.equal(shell.response.headers.get("cache-control"), "no-store", "the page itself is never cached");
 const cached = await request(`/a/${server.build}/app.js`, { headers: auth });
 assert.equal(cached.response.status, 200); assert.match(cached.response.headers.get("cache-control"), /immutable/, "build-fingerprinted assets are cacheable");
 assert.equal((await request("/a/000000000000/app.js", { headers: auth })).response.status, 404, "an old build URL never serves new code");
 assert.equal((await request("/app.js", { headers: auth })).response.headers.get("content-type"), "text/javascript; charset=utf-8");
 const css = await request("/styles.css", { headers: auth });
 assert.match(css.text, /--chat-width: 380px/); assert.match(css.text, /max-width: 899px/);
 const post = { method: "POST", headers: { ...auth, Origin: server.origin, "Content-Type": "application/json" }, body: JSON.stringify({ target: "12345678", text: "hello" }) };
 assert.equal((await request("/api/message", { ...post, headers: { ...auth, "Content-Type": "application/json" } })).response.status, 403);
 assert.equal((await request("/api/message", { ...post, headers: { ...post.headers, Authorization: "Bearer bad" } })).response.status, 401);
 assert.equal((await request("/api/message", { ...post, body: "[]" })).response.status, 400);
 assert.equal((await request("/api/message", { ...post, body: "{" })).response.status, 400);
 assert.equal((await request("/api/message", { ...post, body: JSON.stringify({ text: "x".repeat(65_536) }) })).response.status, 413);
 assert.equal((await request("/api/message", { ...post, headers: { ...post.headers, "Content-Type": "text/plain" } })).response.status, 415);
 assert.equal((await request("/api/unknown", post)).response.status, 404);
 assert.equal((await request("/api/message", post)).response.status, 200);
 assert.deepEqual(posted, [{ endpoint: "/api/message", value: { target: "12345678", text: "hello" } }]);
 const stopPost = { ...post, body: JSON.stringify({ target: "12345678" }) };
 assert.equal((await request("/api/stop", { ...stopPost, headers: { Origin: server.origin, "Content-Type": "application/json" } })).response.status, 401);
 assert.equal((await request("/api/stop", stopPost)).response.status, 409);
 assert.equal(aborts, 0); stopIdle = false;
 const stopped = await request("/api/stop", stopPost);
 assert.equal(stopped.response.status, 200); assert.equal(JSON.parse(stopped.text).accepted, true); assert.equal(aborts, 1);
 const stream = await fetch(`${server.origin}/api/events?target=12345678`, { headers: auth });
 assert.equal(stream.headers.get("content-type"), "text/event-stream");
 reader = stream.body.getReader();
 const decoder = new TextDecoder();
 const initial = decoder.decode((await reader.read()).value);
 assert.match(initial, /event: snapshot/);
 assert.match(initial, /^retry: 1000\n/, "browser retries quickly while Pi reloads");
 assert.match(server.build, /^[a-f0-9]{12}$/); assert(initial.includes(`"build":"${server.build}"`), "page learns the build to reload on change");
 assert.match(initial, /"revision":3/);
 server.publish("diagram", { revision: 4 });
 const next = decoder.decode((await reader.read()).value);
 assert.match(next, /event: diagram/);
 assert.match(next, /"revision":4/);
 assert(Number(/id: (\d+)/.exec(next)[1]) > Number(/id: (\d+)/.exec(initial)[1]));
 assert.throws(() => server.publish("bad\nevent", {}));
 await reader.cancel(); reader = undefined;
 await Promise.all([server.close(), server.close()]);
 await assert.rejects(fetch(`${server.origin}/api/snapshot?target=product`, { headers: auth }));
} finally { await reader?.cancel(); await server.close(); }
const chatHooks = new Map(), mirrored = [];
const mirror = createChatMirror({ on: (name, handler) => chatHooks.set(name, handler) }, (event, value) => mirrored.push({ event, value }));
const user = { role: "user", timestamp: 1, content: "Hello <script>" }, assistant = { role: "assistant", timestamp: 2, content: [{ type: "text", text: "Reply" }] };
chatHooks.get("input")({ text: user.content, source: "interactive", streamingBehavior: "followUp" });
chatHooks.get("message_start")({ message: user }); chatHooks.get("message_end")({ message: user });
chatHooks.get("message_start")({ message: assistant });
chatHooks.get("message_update")({ message: { ...assistant, content: [{ type: "text", text: "Reply streamed" }] } });
chatHooks.get("message_end")({ message: { ...assistant, content: [{ type: "text", text: "Reply complete" }] } });
assert.equal(mirror.snapshot().length, 2);
assert.equal(mirror.snapshot()[0].text, user.content, "text remains data, never interpreted as markup");
assert.equal(mirror.snapshot()[1].text, "Reply complete");
assert.equal(mirror.snapshot()[1].streaming, false);
assert(mirrored.some(item => item.event === "input" && item.value.streamingBehavior === "followUp"));
const branch = { sessionManager: { getBranch: () => [{ type: "message", message: { role: "user", timestamp: 0, content: "Older" } }, { type: "message", message: user }, { type: "message", message: { ...assistant, content: [{ type: "text", text: "Reply complete" }] } }] } };
mirror.hydrate(branch);
assert.equal(mirror.snapshot().length, 3, "hydrate adds earlier branch chat without duplicating streamed rows");
chatHooks.get("message_start")({ message: { ...assistant, content: [] } });
mirror.hydrate(branch);
chatHooks.get("message_update")({ message: { ...assistant, content: [{ type: "text", text: "Same-millisecond second reply" }] } });
assert.equal(mirror.snapshot().length, 4, "same-millisecond messages keep independent ids across reopen");
assert.equal(mirror.snapshot().at(-1).text, "Same-millisecond second reply");
chatHooks.get("message_end")({ message: { role: "assistant", timestamp: 3, content: [{ type: "text", text: "x".repeat(70_000) }] } });
assert(mirror.snapshot().at(-1).truncated);
const toolTurn = { role: "assistant", timestamp: 3.5, content: [{ type: "thinking", thinking: "Plan the edit" }, { type: "toolCall", id: "call_1", name: "edit", arguments: { path: "C:/a.ts", edits: [] } }] };
chatHooks.get("message_start")({ message: toolTurn }); chatHooks.get("message_end")({ message: toolTurn });
chatHooks.get("message_end")({ message: { role: "toolResult", toolCallId: "call_1", toolName: "edit", content: [{ type: "text", text: "Edited" }], isError: true } });
const blocks = mirror.snapshot().at(-1).blocks;
assert.deepEqual(blocks.map(block => block.type === "tool" ? [block.title, block.result, block.error] : [block.type, block.text]), [["thinking", "Plan the edit"], ["edit C:/a.ts", "Edited", true]], "thinking and tool calls become collapsed blocks; the result joins its call");
assert.equal(mirror.snapshot().at(-1).text, "");
const brief = mirror.page().rows.at(-1);
assert(brief.brief && !brief.excerpt && brief.blocks[0].text === "" && brief.blocks[1].args === "" && brief.blocks[1].result === "" && brief.blocks[1].title === "edit C:/a.ts", "check-in rows keep block titles and completion only");
assert.equal(mirror.row(brief.id).blocks[1].result, "Edited", "full row on expand");
const long = mirror.page().rows.find(row => row.text.length === 2000); assert(long?.excerpt, "long text is a 2 KB excerpt");
assert.throws(() => mirror.row("missing"), /Unknown chat row/);
for (let timestamp = 4; timestamp < 110; timestamp++) chatHooks.get("message_end")({ message: { role: "user", timestamp, content: "recent" } });
assert.equal(mirror.snapshot().length, 100);
{
 const hooks = new Map(), events = [], live = createChatMirror({ on: (name, handler) => hooks.set(name, handler) }, (event, value) => events.push({ event, value }));
 const turn = text => ({ role: "assistant", timestamp: 50, content: [{ type: "text", text }] });
 hooks.get("message_start")({ message: turn("") });
 for (let i = 1; i <= 20; i++) hooks.get("message_update")({ message: turn("a".repeat(i)) });
 assert.equal(events.length, 1, "token updates within 250 ms coalesce");
 await new Promise(resolve => setTimeout(resolve, 300));
 assert.deepEqual(events.map(item => item.event), ["delta", "delta"]);
 assert.deepEqual([events[1].value.offset, events[1].value.text], [0, "a".repeat(20)], "a delta appends only the unsent text");
 hooks.get("message_update")({ message: { ...turn("a".repeat(20)), content: [{ type: "text", text: "a".repeat(20) }, { type: "toolCall", id: "c", name: "read", arguments: { path: "x" } }] } });
 hooks.get("message_end")({ message: { ...turn("a".repeat(25)), content: [{ type: "text", text: "a".repeat(25) }, { type: "toolCall", id: "c", name: "read", arguments: { path: "x" } }] } });
 const final = events.at(-1).value;
 assert.deepEqual([final.offset, final.text, final.streaming], [20, "aaaaa", false], "message_end flushes at once");
 assert.equal(final.blocks[0].title, "read x"); assert.equal(final.blocks[0].args, "", "blocks travel brief");
 hooks.get("message_end")({ message: { role: "toolResult", toolCallId: "c", content: [{ type: "text", text: "body" }] } });
 assert.deepEqual([events.at(-1).value.offset, events.at(-1).value.text, events.at(-1).value.blocks[0].result], [25, "", ""], "a tool result resends only brief blocks");
 live.reset();
}
const newest = mirror.page(); assert.equal(newest.rows.length, 20); assert(newest.more);
const older = mirror.page(newest.rows[0].id); assert.equal(older.rows.at(-1).id, mirror.snapshot()[79].id, "Show earlier pages back without overlap");
assert.equal(mirror.page(mirror.snapshot()[10].id).more, false);
const { emptyDiagram, applyDiagramOperations, diagramChatMessage } = await createJiti(import.meta.url).import("../extensions/plan3-diagram.ts");
const contextDiagram = applyDiagramOperations(emptyDiagram({ kind: "product" }), [
 { op: "add", entity: "node", value: { id: "api", label: "API", kind: "service", details: "Bounded uploads" } },
 { op: "add", entity: "note", value: { id: "note_1", target: "api", text: "Why no retries?", author: "user", created: "2026-10-13" } },
]).diagram;
const prepared = diagramChatMessage(contextDiagram, "Change @api; discuss @note_1 and @missing. Contact a@api.com", ["note_1"]);
assert.deepEqual(prepared.mentions, ["api", "note_1", "missing"]);
assert.deepEqual(prepared.unknownMentions, ["missing"]);
assert.match(prepared.message, /Bounded uploads/);
assert.match(prepared.message, /Why no retries/);
assert.match(prepared.message, /untrusted user data/);
assert.throws(() => diagramChatMessage(contextDiagram, "hello", ["missing"]), /Unknown diagram comment/);
assert.throws(() => diagramChatMessage(contextDiagram, "x".repeat(20_001)), /bounded/);
const submitted = [], deliveryErrors = [];
const sendApi = { sendUserMessage: (message, options) => { submitted.push({ message, options }); return new Promise(() => {}); } };
forwardDiagramChat(sendApi, { isIdle: () => true }, contextDiagram, "hello", [], () => {});
assert.equal(submitted.at(-1).message, "hello");
forwardDiagramChat(sendApi, { isIdle: () => false }, contextDiagram, "/plan3 review 12345678", [], () => {});
assert.equal(submitted.at(-1).message, "/plan3 review 12345678");
assert.equal(submitted.at(-1).options.expandPromptTemplates, true);
assert.throws(() => forwardDiagramChat(sendApi, { isIdle: () => true }, contextDiagram, "/reload", [], () => {}), /terminal only/);
assert.throws(() => forwardDiagramChat(sendApi, { isIdle: () => true }, contextDiagram, "/model other", [], () => {}), /terminal only/);
const queued = forwardDiagramChat(sendApi, { isIdle: () => false }, contextDiagram, "Edit @api", [], (event, value) => deliveryErrors.push({ event, value }));
assert(queued.queued, "busy send returns immediately, never awaits the model run");
assert.equal(submitted.at(-1).options.deliverAs, "followUp");
assert.equal(submitted.at(-1).options.expandPromptTemplates, false);
forwardDiagramChat(sendApi, { isIdle: () => true }, contextDiagram, "Edit @api", [], () => {});
assert.equal(submitted.at(-1).options.deliverAs, undefined);
forwardDiagramChat({ sendUserMessage: () => Promise.reject(new Error("compaction in progress")) }, { isIdle: () => false }, contextDiagram, "hello", [], (event, value) => deliveryErrors.push({ event, value }));
await Promise.resolve();
assert.match(deliveryErrors.at(-1).value.message, /compaction in progress/);
assert.throws(() => forwardDiagramChat({ sendUserMessage: () => { throw new Error("stale context"); } }, { isIdle: () => true }, contextDiagram, "hello", [], (event, value) => deliveryErrors.push({ event, value })), /stale context/);
const busListeners = new Map(), dialogEvents = [];
const bus = {
 on(name, handler) { const set = busListeners.get(name) ?? new Set(); set.add(handler); busListeners.set(name, set); return () => set.delete(handler); },
 emit(name, value) { for (const handler of [...(busListeners.get(name) ?? [])]) handler(value); },
};
const askApi = { events: bus };
const dialogBridge = createDialogBridge(askApi, (event, value) => dialogEvents.push({ event, value }));
const { raceRemoteAsk, remoteResponse, remoteBatch } = await createJiti(import.meta.url).import("../extensions/ask-user/remote.ts");
const question = { question: "Pick one", options: [{ title: "A" }, { title: "B" }], allowMultiple: false, allowFreeform: true, allowComment: true };
let localSignal, terminalAnswer;
const asking = raceRemoteAsk(askApi, question, undefined, undefined, payload => remoteResponse(payload, question, true), signal => { localSignal = signal; return new Promise(resolve => { terminalAnswer = resolve; }); });
await Promise.resolve();
const singleId = dialogBridge.snapshot()[0].askId;
assert.throws(() => dialogBridge.answer({ askId: singleId, selections: ["A", "B"] }), /Invalid dialog answer/);
assert.equal(dialogBridge.snapshot().length, 1);
assert(dialogBridge.answer({ askId: singleId, selections: ["B"], comment: "Because" }).accepted);
assert.deepEqual(await asking, { kind: "selection", selections: ["B"], comment: "Because" });
assert(localSignal.aborted, "remote winner dismisses the native popup");
terminalAnswer({ kind: "selection", selections: ["A"] });
assert(!dialogBridge.answer({ askId: singleId, selections: ["A"] }).accepted, "late second answer ignored");
assert.equal(dialogEvents.filter(item => item.event === "dialog_closed" && item.value.askId === singleId).length, 1);
const batch = raceRemoteAsk(askApi, { questions: [question, question], allowComment: true }, undefined, undefined, payload => remoteBatch(payload, [question, question], true), () => new Promise(() => {}));
const batchId = dialogBridge.snapshot()[0].askId;
dialogBridge.answer({ askId: batchId, answers: [{ status: "skipped" }, { status: "answered", response: { kind: "freeform", text: "Another option" } }] });
assert.deepEqual(await batch, [{ status: "skipped" }, { status: "answered", response: { kind: "freeform", text: "Another option" } }]);
const nativeWin = raceRemoteAsk(askApi, question, undefined, undefined, payload => remoteResponse(payload, question, true), () => Promise.resolve({ kind: "selection", selections: ["A"] }));
const nativeId = dialogBridge.snapshot()[0].askId;
await nativeWin;
assert.equal(dialogBridge.snapshot().length, 0);
assert(!dialogBridge.answer({ askId: nativeId, text: "late" }).accepted);
const canceled = raceRemoteAsk(askApi, question, undefined, undefined, payload => remoteResponse(payload, question, true), () => new Promise(() => {}));
dialogBridge.answer({ askId: dialogBridge.snapshot()[0].askId, cancel: true });
assert.equal(await canceled, null, "browser cancel matches native Escape");
const { showListDialog, listDialogResponse } = await createJiti(import.meta.url).import("../extensions/work-dialogs.ts");
let nativeDone, nativeDisposed = false;
const listCtx = { mode: "tui", ui: { custom: factory => new Promise(resolve => {
 const component = factory({ requestRender() {} }, { fg: (_color, value) => value, bold: value => value }, {}, value => { nativeDone = undefined; component.dispose?.(); nativeDisposed = true; resolve(value); });
 nativeDone = resolve;
}), notify() {} } };
dialogBridge.bind(listCtx);
const listOptions = { title: "Menu", purpose: "Choose a route.", cursorKey: "menu", items: [{ value: "one", label: "One" }, { value: "disabled", label: "Disabled", disabled: true }] };
const choosing = showListDialog(listCtx, listOptions);
await Promise.resolve();
assert(nativeDone, "terminal list remains visible while browser is pending");
const listId = dialogBridge.snapshot()[0].askId;
assert.equal(dialogBridge.snapshot()[0].kind, "list");
assert.throws(() => dialogBridge.answer({ askId: listId, action: "select", value: "disabled" }), /Invalid dialog answer/);
dialogBridge.answer({ askId: listId, action: "select", value: "one" });
assert.equal((await choosing).value, "one");
assert(nativeDisposed, "browser list answer closes and disposes losing overlay");
assert.equal(listDialogResponse({ action: "back", values: [] }, { ...listOptions, multi: { requireOne: true, selected: [] } }), undefined);
assert.deepEqual(listDialogResponse({ action: "back", values: ["one"] }, { ...listOptions, multi: { requireOne: true, selected: new Set(["one"]) } }), { action: "back", values: ["one"] });
assert.equal(listDialogResponse({ action: "tab" }, listOptions), undefined);
assert.deepEqual(listDialogResponse({ action: "tab" }, { ...listOptions, tabAction: true }), { action: "tab" });
dialogBridge.close(); dialogBridge.close();
assert.equal(dialogBridge.snapshot().length, 0);
assert([...busListeners.values()].every(set => set.size === 0), "all remote race and registry listeners released");
const activityHooks = new Map(), activityEvents = [];
const activityMirror = createActivityMirror({ on: (name, handler) => activityHooks.set(name, handler) }, (event, value) => activityEvents.push({ event, value }));
activityHooks.get("agent_start")({});
activityHooks.get("ui_prompt_start")({ kind: "confirm", title: "Approve camera?" });
assert.equal(activityMirror.snapshot().dialog, "Approve camera?", "terminal-only dialogs are visible remotely");
activityHooks.get("ui_prompt_end")({ kind: "confirm" });
assert.equal(activityMirror.snapshot().dialog, "");
activityHooks.get("ui_prompt_start")({ kind: "select" });
assert.equal(activityMirror.snapshot().dialog, "select prompt"); activityHooks.get("ui_prompt_end")({});
activityHooks.get("input")({ streamingBehavior: "followUp", text: "later" });
assert.equal(activityMirror.snapshot().queue.length, 1);
activityHooks.get("message_start")({ message: { role: "user", content: [{ type: "text", text: "later" }] } });
assert.equal(activityMirror.snapshot().queue.length, 0);
activityHooks.get("message_update")({ message: { role: "assistant", content: [{ type: "thinking", thinking: "Reasoning" }] }, assistantMessageEvent: { type: "thinking_delta" } });
activityHooks.get("tool_execution_start")({ toolCallId: "tool1", toolName: "read", args: { path: "example" } });
activityHooks.get("tool_execution_update")({ toolCallId: "tool1", toolName: "read", partialResult: { content: [{ type: "text", text: "half" }] } });
activityHooks.get("tool_execution_end")({ toolCallId: "tool1", toolName: "read", result: { content: [{ type: "image", data: "private-base64" }, { type: "text", text: "result" }] }, durationMs: 12, isError: false });
assert.equal(activityMirror.snapshot().thinking, "Reasoning");
assert.equal(activityMirror.snapshot().tools[0].state, "done");
assert.equal(activityMirror.snapshot().tools[0].durationMs, 12);
activityHooks.get("tool_execution_start")({ toolCallId: "tool2", toolName: "bash" });
activityHooks.get("tool_execution_end")({ toolCallId: "tool2", toolName: "bash", result: "ok" });
assert(Number.isFinite(activityMirror.snapshot().tools[1].durationMs));
assert.equal(activityMirror.snapshot({ isIdle: () => false, hasPendingMessages: () => true }).hasPendingMessages, true);
assert(!JSON.stringify(activityMirror.snapshot()).includes("private-base64"));
assert(activityEvents.filter(item => item.event === "activity").every(item => !("tools" in item.value) && !("thinking" in item.value)), "activity state events carry no tool list or thinking");
assert.deepEqual(activityEvents.filter(item => item.event === "tool").map(item => [item.value.id, item.value.state]).slice(-2), [["tool2", "running"], ["tool2", "done"]], "only the changed tool row is sent");
await new Promise(resolve => setTimeout(resolve, 300));
assert.deepEqual(activityEvents.filter(item => item.event === "thinking").at(-1).value, { offset: 0, text: "Reasoning" }, "coalesced thinking delta follows agent_start");
assert(!activityHooks.has("agent_end"), "agent_end alone does not mean settled/idle");
activityHooks.get("session_before_compact")({});
assert(activityMirror.snapshot().compacting);
activityHooks.get("session_compact")({}); assert.equal(activityMirror.snapshot().compacting, false);
activityHooks.get("session_before_compact")({});
activityHooks.get("session_compact_failed")({ errorMessage: "failed", aborted: false });
assert.equal(activityMirror.snapshot().compacting, false);
assert.equal(activityMirror.snapshot().error, "failed");
activityHooks.get("input")({ streamingBehavior: "steer", text: "cancelled in terminal" });
assert.equal(activityMirror.snapshot({ isIdle: () => false, hasPendingMessages: () => false }).queue.length, 0);
assert.equal(activityMirror.snapshot().queueExact, false, "SDK input events do not prove exact queue edits/cancellations");
activityHooks.get("agent_settled")({ aborted: true });
assert.equal(activityMirror.snapshot().working, false);
assert(activityMirror.snapshot().interrupted);

function eventsFrom(response) {
 const reader = response.body.getReader(), decoder = new TextDecoder(); let buffered = "";
 return {
  async next() {
   while (!buffered.includes("\n\n")) { const part = await reader.read(); assert(!part.done, "SSE ended before expected event"); buffered += decoder.decode(part.value, { stream: true }); }
   const end = buffered.indexOf("\n\n"), raw = buffered.slice(0, end); buffered = buffered.slice(end + 2);
   let data;
   try { data = JSON.parse(/^data: (.*)$/m.exec(raw)?.[1]); } catch (error) { assert.fail(`Invalid test-server SSE JSON: ${error}`); }
   return { id: Number(/^id: (\d+)$/m.exec(raw)?.[1]), event: /^event: (.*)$/m.exec(raw)?.[1], data };
  },
  close: () => reader.cancel(),
 };
}
let resyncServer, releaseSnapshot, enteredSnapshot;
const snapshotEntered = new Promise(resolve => { enteredSnapshot = resolve; });
const resyncDialogs = createDialogBridge(askApi, (event, value) => resyncServer?.publish(event, value));
let nativeResolve, holdSnapshot = true;
const unanswered = raceRemoteAsk(askApi, question, undefined, undefined, payload => remoteResponse(payload, question, true), () => new Promise(resolve => { nativeResolve = resolve; }));
const unansweredId = resyncDialogs.snapshot()[0].askId;
resyncServer = await createPlan3Web({ snapshot: async target => {
 if (holdSnapshot) { holdSnapshot = false; enteredSnapshot(); await new Promise(resolve => { releaseSnapshot = resolve; }); }
 return { target, diagram: contextDiagram, chat: mirror.snapshot(), activity: activityMirror.snapshot(), dialogs: resyncDialogs.snapshot() };
} });
try {
 const resyncUrl = new URL(resyncServer.url({ kind: "product" }));
 const connectUrl = `${resyncServer.origin}/api/events${resyncUrl.search}`;
 const connecting = fetch(connectUrl, { signal: AbortSignal.timeout(10_000) });
 await snapshotEntered;
 resyncServer.publish("activity", { marker: "during asynchronous snapshot" });
 releaseSnapshot();
 const first = eventsFrom(await connecting), initial = await first.next(), buffered = await first.next();
 assert.equal(initial.event, "snapshot");
 assert.equal(initial.data.diagram.revision, contextDiagram.revision);
 assert(initial.data.chat.length);
 assert.equal(initial.data.activity.tools[0].state, "done");
 assert.equal(initial.data.dialogs[0].askId, unansweredId, "refresh restores unanswered dialog");
 assert.equal(buffered.event, "activity");
 assert(buffered.id > initial.id, "no event gap during async snapshot, ids stay ordered");
 await first.close();
 nativeResolve({ kind: "selection", selections: ["A"] }); await unanswered;
 const reconnect = eventsFrom(await fetch(connectUrl, { headers: { "Last-Event-ID": String(buffered.id) }, signal: AbortSignal.timeout(10_000) }));
 const fresh = await reconnect.next();
 assert.equal(fresh.event, "snapshot");
 assert(fresh.id > buffered.id, "fresh snapshot supersedes every pre-disconnect event");
 assert.equal(fresh.data.dialogs.length, 0, "terminal answer while disconnected cannot resurrect a popup");
 assert.equal(fresh.data.activity.working, false);
 assert.equal(new Set([initial.id, buffered.id, fresh.id]).size, 3, "snapshot/event ids are distinct across reconnects");
 await reconnect.close();
} finally { resyncDialogs.close(); await resyncServer.close(); }
// C-WEB byte budgets (D21).
{
 const hooks = new Map(), big = createChatMirror({ on: (name, handler) => hooks.set(name, handler) }, () => {});
 const wide = "😀界é".repeat(1200);
 for (let t = 1; t <= 100; t++) hooks.get("message_end")({ message: { role: t % 2 ? "user" : "assistant", timestamp: 1000 + t, content: wide } });
 const live = { working: true, thinking: "思".repeat(64_000), tools: [{ id: "t", name: "bash", state: "running", args: "x".repeat(16_000), progress: "y".repeat(16_000) }, { id: "d", name: "read", state: "done", result: "z".repeat(16_000) }], queue: Array.from({ length: 100 }, (_, i) => ({ id: "q" + i, text: "q".repeat(5000), delivery: "followUp" })) };
 const question = { askId: "11111111-2222-4333-8444-555555555555", question: "Pick one", context: "Ω".repeat(200_000), options: [{ title: "A" }] };
 const packet = checkIn(big, live, [question], { target: { kind: "plan", id: "12345678" } }), size = Buffer.byteLength(JSON.stringify(packet));
 assert(size <= 64_000, `check-in snapshot is ${size} bytes`);
 assert.equal(packet.chat.at(-1).id, big.snapshot().at(-1).id, "the newest row survives the budget"); assert(packet.more);
 assert(packet.chat.every(row => row.excerpt && !/[\ud800-\udbff]$/.test(row.text)), "excerpts never split a surrogate pair");
 assert(packet.dialogs[0].brief && packet.dialogs[0].title === "Pick one" && !("context" in packet.dialogs[0]), "a large question travels brief");
 assert.deepEqual(packet.activity.tools.map(tool => tool.id), ["t"]); assert.equal(packet.activity.thinkingLength, 64_000);
}
{
 const realNow = Date.now; let clock = realNow(), live, beforeCapture;
 Date.now = () => clock;
 const hooks = new Map(), streamMirror = createChatMirror({ on: (name, handler) => hooks.set(name, handler) }, (event, value) => live.publish(event, value));
 live = await createPlan3Web({ snapshot: async () => { beforeCapture?.(); beforeCapture = undefined; await new Promise(resolve => setImmediate(resolve)); return checkIn(streamMirror, { thinking: "", tools: [], queue: [] }, []); } });
 try {
  const connect = async () => { const events = eventsFrom(await fetch(`${live.origin}/api/events${new URL(live.url()).search}`, { signal: AbortSignal.timeout(10_000) })); const first = await events.next(); assert.equal(first.event, "snapshot"); return { events, rows: first.data.chat }; };
  const follow = async (events, text, id) => {
   let bytes = 0, count = 0;
   for (;;) {
    const event = await events.next(); bytes += Buffer.byteLength(`event: ${event.event}\nid: ${event.id}\ndata: ${JSON.stringify(event.data)}\n\n`);
    if (event.event !== "delta" || event.data.id !== id) continue;
    count++; const next = applyText(text, event.data.offset, event.data.text); assert.notEqual(next, "gap");
    if (next !== "stale") text = next;
    if (!event.data.streaming) return { text, bytes, count };
   }
  };
  const token = i => `word${i} ünï 😀 界 `.padEnd(40, "x"), turn = (timestamp, text) => ({ role: "assistant", timestamp, content: [{ type: "text", text }] });
  // 500 flushed deltas cost about the text plus a small frame each, never the quadratic full-row republish.
  hooks.get("message_start")({ message: turn(7000, "") });
  const a = await connect(); let full = "";
  const reading = follow(a.events, a.rows.find(row => row.id === "assistant_7000").text, "assistant_7000");
  for (let i = 0; i < 500; i++) { clock += 250; full += token(i); hooks.get("message_update")({ message: turn(7000, full) }); }
  hooks.get("message_end")({ message: turn(7000, full) });
  const streamed = await reading; await a.events.close();
  assert.equal(streamed.text, full, "500 deltas reconstruct the exact text");
  assert(streamed.count >= 500, `only ${streamed.count} deltas were sent`); assert(streamed.bytes < 100_000, `500 deltas cost ${streamed.bytes} bytes`);
  // Mid-stream reconnect: unsent coalesced text, a delta published while the snapshot is built, then the final flush.
  hooks.get("message_start")({ message: turn(8000, "") }); let short = "";
  for (let i = 0; i < 15; i++) { clock += 100; short += token(i); hooks.get("message_update")({ message: turn(8000, short) }); }
  beforeCapture = () => { clock += 300; short += token(15); hooks.get("message_update")({ message: turn(8000, short) }); };
  const b = await connect(), start = b.rows.find(row => row.id === "assistant_8000");
  assert(!start.excerpt && start.text === short, "the snapshot carries the text the buffered delta also sends");
  const resumed = follow(b.events, start.text, "assistant_8000");
  for (let i = 16; i < 30; i++) { clock += 100; short += token(i); hooks.get("message_update")({ message: turn(8000, short) }); }
  hooks.get("message_end")({ message: turn(8000, short) });
  assert.equal((await resumed).text, short, "exact text after a mid-stream reconnect");
  await b.events.close();
 } finally { Date.now = realNow; streamMirror.reset(); await live.close(); }
}
assert.equal(applyText("abc", 0, "x"), "x"); assert.equal(applyText("abc", 1, "b"), "stale"); assert.equal(applyText("abc", 4, "d"), "gap"); assert.equal(applyText(undefined, 2, "c"), "gap"); assert.equal(applyText("abc", 2, "cd"), "abcd");
mirror.reset(); activityMirror.reset();
assert.deepEqual(mirror.snapshot(), []); assert.deepEqual(activityMirror.snapshot().tools, []);
assert.equal(activityMirror.snapshot().error, ""); assert.equal(activityMirror.snapshot().compacting, false);
// Session credentials survive a new runtime without entering the conversation.
const { mkdtemp, writeFile, stat, rm } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { randomUUID } = await import("node:crypto");
const { loadShareRecord, saveSharePort } = await createJiti(import.meta.url).import("../extensions/plan3-remote.ts");
const credentialDir = await mkdtemp(join(tmpdir(), "plan3-remote-test-"));
let persistent, occupied, fallback;
try {
 const id = randomUUID(), record = await loadShareRecord(id, credentialDir);
 assert.equal(record.port, 0);
 await assert.rejects(loadShareRecord("../../escape", credentialDir));
 assert.deepEqual(await loadShareRecord(id, credentialDir), record);
 if (process.platform !== "win32") assert.equal((await stat(join(credentialDir, `${id}.json`))).mode & 0o077, 0);
 persistent = await createPlan3Web({ token: record.token, snapshot: () => ({}) });
 await saveSharePort(record, persistent.port, credentialDir);
 const saved = await loadShareRecord(id, credentialDir);
 assert.equal(saved.port, persistent.port);
 await persistent.close();
 persistent = await createPlan3Web({ token: saved.token, port: saved.port, snapshot: () => ({}) });
 assert.equal(persistent.port, saved.port);
 assert.equal(persistent.portChanged, false);
 assert(new URL(persistent.url({ kind: "product" })).searchParams.get("token") === record.token);
 occupied = persistent;
 fallback = await createPlan3Web({ token: saved.token, port: saved.port, snapshot: () => ({}) });
 assert.notEqual(fallback.port, saved.port); assert.equal(fallback.portChanged, true);
 await writeFile(join(credentialDir, `${id}.json`), "{}");
 await assert.rejects(loadShareRecord(id, credentialDir), /Invalid/);
} finally { await fallback?.close(); await occupied?.close(); await persistent?.close(); await rm(credentialDir, { recursive: true, force: true }); }
console.log("ok - plan3 web security, Stop, dialog races, bounded activity, reconnect and persisted port/token");
