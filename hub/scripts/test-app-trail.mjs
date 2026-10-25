// The desktop app's back/forward trail (hub/app/ui/index.html): the strip's own functions, run with stub tabs.
import fs from "node:fs"; import assert from "node:assert/strict";
const html = fs.readFileSync(new URL("../app/ui/index.html", import.meta.url), "utf8");
const code = html.slice(html.indexOf("function select(id, stepping"), html.indexOf("for (const type of [\"mousedown\""));
const run = new Function("tabs", "invoke", "render", `let active = 0; ${code}; return { select, visited, step, get spot() { return spot; }, get active() { return active; } };`);
const calls = [], tabs = [{ id: 0, session: "a1" }, { id: 1, session: "b1" }];
const s = run(tabs, (cmd, arg) => { calls.push([cmd, arg]); return Promise.resolve(); }, () => {});
s.visited(tabs[0]);                              // on a1
tabs[0].session = "a2"; s.visited(tabs[0]);      // a2
s.select(1);                                     // attention key: hub b, b1
s.step(-1, false); assert.deepEqual([s.active, calls.at(-1)], [0, ["show", { id: 0 }]], "back returns to hub a, already on a2");
s.step(-1, false); assert.deepEqual(calls.at(-1), ["go", { id: 0, session: "a1" }], "back again opens a1");
tabs[0].session = "a1"; s.visited(tabs[0]); assert.equal(s.spot, 0, "the opened page does not add a visit");
s.step(1, true); assert.deepEqual(calls.at(-1), ["go", { id: 0, session: "a2" }], "ctrl+forward stays in hub a");
tabs[0].session = "a2"; s.visited(tabs[0]);
s.step(1, true); assert.equal(s.spot, 1, "ctrl+forward skips hub b: nothing left in hub a");
s.step(1, false); assert.equal(s.active, 1, "plain forward reaches hub b");

