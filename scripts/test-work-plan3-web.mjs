// What ce-workflow still serves pi-control-hub (plan 0db155f7 H9-01): diagram chat forwarding, the ask_user
// race other sessions answer through ask:pending/ask:answer, list answers and the activity mirror.
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const { webTarget, createActivityMirror, forwardDiagramChat } = await createJiti(import.meta.url).import("../extensions/plan3-web.ts");
assert.deepEqual(webTarget("product"), { kind: "product" }); assert.deepEqual(webTarget("12345678"), { kind: "plan", id: "12345678" });
assert.throws(() => webTarget("../x"), error => error.status === 400);
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
assert.doesNotMatch(prepared.message, /settle/, "no pending hint without red edits");
{ // Pending edits are listed so the agent knows what to settle.
 const marked = applyDiagramOperations(contextDiagram, [{ op: "add", entity: "node", value: { id: "cache", label: "Cache", kind: "store", edit: "add" } }, { op: "add", entity: "edge", value: { from: "api", to: "cache", edit: "remove" } }]).diagram;
 const hinted = diagramChatMessage(marked, "Add @cache");
 assert.match(hinted.message, /settle exactly those you addressed/);
 assert.match(hinted.message, /"pendingEdits":\[\{"entity":"node","id":"cache","edit":"add"\},\{"entity":"edge","id":"api__cache","edit":"remove"\}\]/);
}
{ // A2: each part resolves only its own ids; the displayed part takes the unclaimed rest.
 const plan = applyDiagramOperations(emptyDiagram({ kind: "plan", plan: { id: "12345678", title: "Plan" } }), [{ op: "add", entity: "node", value: { id: "api", label: "Plan API", kind: "service" } }, { op: "add", entity: "node", value: { id: "worker", label: "Worker", kind: "service" } }]).diagram;
 const both = diagramChatMessage([{ diagram: plan, ids: [] }, { diagram: contextDiagram, ids: ["api"] }], "Add @api and @worker");
 const blocks = both.message.split("Diagram context").slice(1);
 assert.equal(blocks.length, 2); assert.match(blocks[0], /Worker/); assert.doesNotMatch(blocks[0], /Plan API/); assert.match(blocks[1], /Bounded uploads/);
 assert.deepEqual(both.unknownMentions, []);
}
assert.throws(() => diagramChatMessage(contextDiagram, "hello", ["missing"]), /Unknown diagram comment/);
assert.throws(() => diagramChatMessage(contextDiagram, "x".repeat(20_001)), /bounded/);
const submitted = [], deliveryErrors = [];
const sendApi = { sendUserMessage: (message, options) => { submitted.push({ message, options }); return new Promise(() => {}); } };
forwardDiagramChat(sendApi, { isIdle: () => true }, contextDiagram, "hello", [], () => {});
assert.equal(submitted.at(-1).message, "hello");
forwardDiagramChat(sendApi, { isIdle: () => false }, contextDiagram, "/plan3 review 12345678", [], () => {});
assert.equal(submitted.at(-1).message, "/plan3 review 12345678");
assert.equal(submitted.at(-1).options.expandPromptTemplates, true);
forwardDiagramChat(sendApi, { isIdle: () => true }, contextDiagram, "/reload", [], () => {});
assert.equal(submitted.at(-1).message, "/wo reload", "web /reload runs the extension reload command");
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
const busListeners = new Map();
const bus = {
 on(name, handler) { const set = busListeners.get(name) ?? new Set(); set.add(handler); busListeners.set(name, set); return () => set.delete(handler); },
 emit(name, value) { for (const handler of [...(busListeners.get(name) ?? [])]) handler(value); },
};
const askApi = { events: bus }, pending = [], closed = [];
bus.on("ask:pending", ask => pending.push(ask)); bus.on("ask:closed", ({ askId }) => closed.push(askId));
const answer = value => bus.emit("ask:answer", value);
const { raceRemoteAsk, remoteResponse, remoteBatch } = await createJiti(import.meta.url).import("../extensions/ask-user/remote.ts");
const question = { question: "Pick one", options: [{ title: "A" }, { title: "B" }], allowMultiple: false, allowFreeform: true, allowComment: true };
let localSignal, terminalAnswer;
const asking = raceRemoteAsk(askApi, question, undefined, undefined, payload => remoteResponse(payload, question, true), signal => { localSignal = signal; return new Promise(resolve => { terminalAnswer = resolve; }); });
await Promise.resolve();
const singleId = pending.at(-1).askId;
answer({ askId: singleId, selections: ["A", "B"] }); // invalid for a single choice: ignored
answer({ askId: singleId, selections: ["B"], comment: "Because" });
assert.deepEqual(await asking, { kind: "selection", selections: ["B"], comment: "Because" });
assert(localSignal.aborted, "remote winner dismisses the native popup");
terminalAnswer({ kind: "selection", selections: ["A"] });
assert.equal(closed.filter(id => id === singleId).length, 1);
const batch = raceRemoteAsk(askApi, { questions: [question, question], allowComment: true }, undefined, undefined, payload => remoteBatch(payload, [question, question], true), () => new Promise(() => {}));
answer({ askId: pending.at(-1).askId, answers: [{ status: "skipped" }, { status: "answered", response: { kind: "freeform", text: "Another option" } }] });
assert.deepEqual(await batch, [{ status: "skipped" }, { status: "answered", response: { kind: "freeform", text: "Another option" } }]);
const nativeWin = raceRemoteAsk(askApi, question, undefined, undefined, payload => remoteResponse(payload, question, true), () => Promise.resolve({ kind: "selection", selections: ["A"] }));
assert.deepEqual(await nativeWin, { kind: "selection", selections: ["A"] });
const canceled = raceRemoteAsk(askApi, question, undefined, undefined, payload => remoteResponse(payload, question, true), () => new Promise(() => {}));
answer({ askId: pending.at(-1).askId, cancel: true });
assert.equal(await canceled, null, "remote cancel matches native Escape");
assert.equal(busListeners.get("ask:answer").size, 0, "every race releases its answer listener");
const { listDialogResponse } = await createJiti(import.meta.url).import("../extensions/ask-user/menu.ts");
const listOptions = { title: "Menu", purpose: "Choose a route.", cursorKey: "menu", items: [{ value: "one", label: "One" }, { value: "disabled", label: "Disabled", disabled: true }] };
assert.equal(listDialogResponse({ action: "select", value: "disabled" }, listOptions), undefined);
assert.deepEqual(listDialogResponse({ action: "select", value: "one" }, listOptions)?.value, "one");
assert.equal(listDialogResponse({ action: "back", values: [] }, { ...listOptions, multi: { requireOne: true, selected: [] } }), undefined);
assert.deepEqual(listDialogResponse({ action: "back", values: ["one"] }, { ...listOptions, multi: { requireOne: true, selected: new Set(["one"]) } }), { action: "back", values: ["one"] });
assert.equal(listDialogResponse({ action: "tab" }, listOptions), undefined);
assert.deepEqual(listDialogResponse({ action: "tab" }, { ...listOptions, tabAction: true }), { action: "tab" });
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
assert.deepEqual([activityMirror.snapshot().tools[0].progress, activityMirror.snapshot().tools[0].result], ["half", "[image]\nresult"], "tool results show their text, not JSON");
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
{ // Boundary compaction and background subagents reach the page through pi.events.
 const bus = new Map(), hooks = new Map(), seen = [];
 let runs = [{ id: "run1", label: "plan3-advisor", state: "running", activity: { turnCount: 3, toolCount: 7, currentTool: "read" } }, { id: "old", label: "x", state: "complete" }];
 const events = { on: (name, handler) => { bus.set(name, handler); return () => bus.delete(name); }, emit: (name, value) => {
  if (name === "subagents:rpc:v1:request") queueMicrotask(() => bus.get("subagents:rpc:v1:reply:" + value.requestId)?.({ success: true, data: { asyncSnapshot: { runs }, fleet: { entries: [{ key: "fleet-1", agent: "plan3-advisor", model: "openai-codex/gpt-6-astra:high" }] } } }));
  else bus.get(name)?.(value);
 } };
 const mirror = createActivityMirror({ on: (name, handler) => hooks.set(name, handler), events }, (event, value) => seen.push({ event, value }));
 hooks.get("session_start")({}, { modelRegistry: { getAvailable: async () => [{ provider: "openai-codex", id: "gpt-6-astra", name: "GPT-6 Astra" }] } }); await new Promise(resolve => setTimeout(resolve, 10));
 events.emit("wo:compacting", { active: true }); assert(mirror.snapshot().compacting, "boundary compaction shows");
 events.emit("wo:compacting", { active: false }); assert.equal(mirror.snapshot().compacting, false);
 events.emit("subagent:async-started", {}); await new Promise(resolve => setTimeout(resolve, 400));
 assert.deepEqual(mirror.snapshot().subagents, [{ id: "run1", label: "plan3-advisor", model: "GPT-6 Astra", state: "running", turns: 3, tools: 7, tool: "read" }], "only active runs are listed, with their model's friendly name");
 runs = [{ id: "run1", label: "plan3-advisor", state: "complete" }];
 events.emit("subagent:async-complete", {}); await new Promise(resolve => setTimeout(resolve, 400));
 assert.deepEqual(mirror.snapshot().subagents, [], "finished runs leave the list");
 assert(seen.some(item => item.event === "activity" && item.value.subagents.length === 1));
 mirror.dispose(); assert.equal(bus.size, 0, "dispose releases the event listeners");
}
activityHooks.get("input")({ streamingBehavior: "steer", text: "cancelled in terminal" });
assert.equal(activityMirror.snapshot({ isIdle: () => false, hasPendingMessages: () => false }).queue.length, 0);
assert.equal(activityMirror.snapshot().queueExact, false, "SDK input events do not prove exact queue edits/cancellations");
activityHooks.get("agent_settled")({ aborted: true });
assert.equal(activityMirror.snapshot().working, false);
assert(activityMirror.snapshot().interrupted);

assert(activityMirror.snapshot().tools.length > 0); activityHooks.get("agent_start")({});
assert.equal(activityMirror.snapshot().tools.length, 0, "a new run starts with an empty tool list");
activityMirror.reset();
assert.deepEqual(activityMirror.snapshot().tools, []);
assert.equal(activityMirror.snapshot().error, ""); assert.equal(activityMirror.snapshot().compacting, false);
console.log("ok - plan3 diagram chat forwarding, remote ask races and bounded activity");
