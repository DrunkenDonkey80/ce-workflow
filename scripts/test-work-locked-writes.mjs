// Locked-writes check: flags locked-write callbacks that ignore the state they receive (plan 427dd6a8 D-12).
import assert from "node:assert/strict";
import { ignoredStateCallbacks, lockedWritesNote } from "../extensions/locked-writes.ts";

const lines = (code) => ignoredStateCallbacks(code).map(hit => hit.line);

// The benchmark's mechanical wrapping, each on its own line.
assert.deepEqual(lines([
	"await repo.transact(id, () => patch);",
	"await repo.updateWorkspace(id, () => ({ order: withEvent }));",
	"await repo.updateWorkspace(id, (_current) => ({ order }));",
	"await repo.updateWorkspace(id, async (current) => { return { order }; });",
	"await repo.updateWorkspace(id, (fresh) => ({ order: stale.order }));",
].join("\n")), [1, 2, 3, 4, 5]);

// Callbacks that read their argument, plain locks and type annotations stay quiet.
assert.deepEqual(lines([
	"await repo.updateWorkspace(id, (fresh) => ({ feedback: [...fresh.feedback, record] }));",
	"await repo.transact(id, current => current.paid ? {} : { paid: true });",
	"await repo.transact(id, ({ order }) => ({ order: { ...order, paid: true } }));",
	"await withProjectWriteLock(id, () => this.saveWorkspace(normalized));",
	"db.transaction(() => { insert.run(row); })();",
	"function updatePlacement(spread, id, update: (placement: Placement) => Placement) {}",
	"setItems(() => ({ a: 1 }));",
	"repo.update(id, \"x, () => patch\", (c) => c.y);",
].join("\n")), []);

// Multi-line call: the hit points at the call's line.
assert.deepEqual(lines("const a = 1;\nawait repo.transact(\n\tid,\n\t() => ({\n\t\torder,\n\t}),\n);"), [2]);

// The tool_result note: source writes and edits only, never tests, failures or other tools.
const bad = "await repo.transact(id, () => patch);";
assert.match(lockedWritesNote("write", { path: "server/a.ts", content: `\n${bad}` }, false), /Locked writes check: 1 [\s\S]*- line 2: transact\(/);
assert.match(lockedWritesNote("edit", { path: "server/a.ts", edits: [{ oldText: "x", newText: bad }] }, false), /- transact\(/);
assert.equal(lockedWritesNote("edit", { path: "server/a.ts", edits: [{ oldText: bad, newText: "ok()" }] }, false), undefined, "only new text counts");
assert.equal(lockedWritesNote("write", { path: "server/a.test.ts", content: bad }, false), undefined);
assert.equal(lockedWritesNote("write", { path: "notes.md", content: bad }, false), undefined);
assert.equal(lockedWritesNote("write", { path: "server/a.ts", content: bad }, true), undefined);
assert.equal(lockedWritesNote("read", { path: "server/a.ts", content: bad }, false), undefined);
console.log("locked-writes check ok");
