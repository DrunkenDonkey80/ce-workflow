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
const factory = await createJiti(import.meta.url, { virtualModules: VIRTUAL_MODULES }).import("../extensions/ask-user/index.ts", { default: true });
const bus = new EventEmitter();
let tool;
factory({ registerTool: (registered) => { tool = registered; }, events: { on: (name, fn) => { bus.on(name, fn); return () => bus.off(name, fn); }, emit: (name, event) => bus.emit(name, event) } });
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
console.log("ok - vendored ask_user single and batch native answer races");
