import assert from "node:assert/strict";
import { createJiti } from "jiti";
import { EventEmitter } from "node:events";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const releases = path.join(homedir(), ".pi", "agent", "install", "releases");
const sdkRoots = existsSync(releases) ? readdirSync(releases).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map(version => path.join(releases, version, "node_modules", "@earendil-works", "pi-coding-agent")) : [];
try { sdkRoots.push(path.dirname(path.dirname(createRequire(import.meta.url).resolve("@earendil-works/pi-coding-agent")))); } catch { /* Managed host installation supplies the SDK. */ }
const sdkRoot = sdkRoots.find(root => existsSync(path.join(root, "dist", "core", "extensions", "virtual-modules.js")));
assert(sdkRoot, "vendored popup selfcheck needs an installed Pi SDK");
const { VIRTUAL_MODULES } = await import(pathToFileURL(path.join(sdkRoot, "dist", "core", "extensions", "virtual-modules.js")).href);
const { default: factory, registerAskUser } = await createJiti(import.meta.url, { virtualModules: VIRTUAL_MODULES }).import("../extensions/ask-user/index.ts");
const bus = new EventEmitter();
let tool;
registerAskUser({ registerTool: (registered) => { tool = registered; }, events: { on: (name, fn) => { bus.on(name, fn); return () => bus.off(name, fn); }, emit: (name, event) => bus.emit(name, event) } });
assert.equal(tool.name, "ask_user");
assert.equal(tool.executionMode, "sequential");
assert.equal(tool.parameters.properties.questions.maxItems, 4);
await assert.rejects(tool.execute("a", { question: "Choose?" }, undefined, undefined, { hasUI: false }), /interactive mode/);
await assert.rejects(tool.execute("b", { questions: [{ question: "Only one?" }] }, undefined, undefined, { hasUI: false }), /2-4/);
const result = await tool.execute("c", { question: "Cancelled?" }, AbortSignal.abort(), undefined, { hasUI: false });
assert.equal(result.details.cancelled, true);

const question = { question: "Ship?", options: [{ title: "Ship" }, { title: "Hold" }], allowFreeform: false };
const ctx = { hasUI: true, ui: { custom: async () => ({ kind: "selection", selections: ["Hold"] }) } };
const local = await tool.execute("local", question, undefined, undefined, ctx);
assert.deepEqual(local.details.response, { kind: "selection", selections: ["Hold"] });
assert.equal(bus.listenerCount("ask:answer"), 0);
bus.once("ask:pending", event => bus.emit("ask:answer", { askId: event.askId, text: "Ship" }));
const remote = await tool.execute("remote", question, undefined, undefined, { hasUI: true, ui: { custom: () => assert.fail("remote already answered") } });
assert.deepEqual(remote.details.response, { kind: "selection", selections: ["Ship"] });
bus.once("ask:pending", event => {
 assert.equal(event.questions.length, 2);
 bus.emit("ask:answer", { askId: event.askId, answers: [{ status: "answered", response: { kind: "selection", selections: ["Ship"] } }, { status: "skipped" }] });
});
const batch = await tool.execute("batch", { questions: [question, { ...question, question: "Deploy?" }] }, undefined, undefined, ctx);
assert.equal(batch.details.cancelled, false);
assert.deepEqual(batch.details.answers, [{ status: "answered", response: { kind: "selection", selections: ["Ship"] } }, { status: "skipped" }]);
assert.equal(bus.listenerCount("ask:answer"), 0);

// initialText (D9): the editor opens with the text, the browser receives it, the answer is the edited text.
{
 const ask = { question: "Directions?", initialText: "Draw the modules" };
 let rendered = "";
 const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: text => text, italic: text => text, underline: text => text, strikethrough: text => text, inverse: text => text };
 const custom = async factory => {
  let result; const component = factory({ requestRender() {}, terminal: { rows: 40, columns: 100 } }, theme, { matches: () => false, getKeys: () => [] }, value => { result = value; });
  rendered = component.render(100).join("\n");
  return result ?? { kind: "freeform", text: "Draw the modules and their links" };
 };
 bus.once("ask:pending", event => assert.equal(event.initialText, "Draw the modules", "the browser gets the pre-filled text"));
 const edited = await tool.execute("prefill", ask, undefined, undefined, { hasUI: true, ui: { custom, input: () => assert.fail("one-line input cannot pre-fill") } });
 assert.match(rendered, /Draw the modules/, "the terminal editor opens holding the text");
 assert.deepEqual(edited.details.response, { kind: "freeform", text: "Draw the modules and their links" });
 const fallback = await tool.execute("prefill-fallback", ask, undefined, undefined, { hasUI: true, ui: { custom: async () => undefined, editor: async (_title, prefill) => prefill + " too" } });
 assert.deepEqual(fallback.details.response, { kind: "freeform", text: "Draw the modules too" }, "without the custom UI the editor dialog is pre-filled");
 bus.once("ask:pending", event => bus.emit("ask:answer", { askId: event.askId, text: "From the browser" }));
 const browser = await tool.execute("prefill-remote", ask, undefined, undefined, { hasUI: true, ui: { custom: () => new Promise(() => {}) } });
 assert.deepEqual(browser.details.response, { kind: "freeform", text: "From the browser" });
 await assert.rejects(tool.execute("prefill-options", { ...question, initialText: "x" }, undefined, undefined, ctx), /without options/);
 await assert.rejects(tool.execute("prefill-long", { question: "Long?", initialText: "x".repeat(16_001) }, undefined, undefined, ctx), /at most/);
 bus.once("ask:pending", event => {
  assert.equal(event.questions[1].initialText, "Saved");
  bus.emit("ask:answer", { askId: event.askId, answers: [{ status: "skipped" }, { status: "answered", response: { kind: "freeform", text: "Saved, edited" } }] });
 });
 const prefilledBatch = await tool.execute("prefill-batch", { questions: [question, { question: "Notes?", initialText: "Saved" }] }, undefined, undefined, { hasUI: true, ui: { custom: () => new Promise(() => {}) } });
 assert.deepEqual(prefilledBatch.details.answers[1], { status: "answered", response: { kind: "freeform", text: "Saved, edited" } });
}

for (const external of [false, true]) {
 let start, registrations = 0, warnings = 0;
 factory({ on: (name, fn) => { assert.equal(name, "session_start"); start = fn; },
   getAllTools: () => external ? [{ name: "ask_user" }] : [],
   registerTool: () => registrations++ });
 assert.equal(registrations, 0, "wait for all extension factories before deciding coexistence");
 start({}, { ui: { notify: () => warnings++ } });
 start({}, { ui: { notify: () => warnings++ } });
 assert.equal(registrations, external ? 0 : 1);
 assert.equal(warnings, external ? 1 : 0);
}
console.log("ok - vendored ask_user single/batch races and coexistence");
