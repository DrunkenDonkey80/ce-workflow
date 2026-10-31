import assert from "node:assert/strict";
import { SITUATIONAL_TOOLS, toolsEnableTool } from "../extensions/tool-loader.ts";

let active = ["read", "bash"];
const registered = [
	{ name: "read", exposure: "direct" },
	{ name: "mobile_act", exposure: "deferred" },
	{ name: "screen_read", exposure: "deferred" },
	{ name: "generate_image", exposure: "hidden" }, // no image model: not offered
	{ name: "other_deferred", exposure: "deferred" }, // not ours: not offered
];
const pi = { getAllTools: () => registered, getActiveTools: () => active, setActiveTools: (names) => { active = names; } };

assert.equal(toolsEnableTool({ getAllTools: () => [{ name: "read", exposure: "direct" }] }), undefined, "no situational tools, no loader");
const loader = toolsEnableTool(pi);
assert.deepEqual(loader.parameters.properties.tools.items.enum, ["mobile_act", "screen_read"]);
assert.match(loader.description, /- mobile_act: operate an iOS/);
assert.doesNotMatch(loader.description, /generate_image|other_deferred/);
const result = await loader.execute("1", { tools: ["mobile_act", "screen_read", "mobile_act", "generate_image"] });
assert.deepEqual(active, ["read", "bash", "mobile_act", "screen_read"], "activates each named tool once, keeps the rest");
assert.match(result.content[0].text, /Enabled mobile_act, screen_read/);
await assert.rejects(loader.execute("2", { tools: ["generate_image"] }), /Name one of: mobile_act, screen_read/);
for (const line of Object.values(SITUATIONAL_TOOLS)) assert(line.length <= 110, `catalog lines stay short: ${line}`);

// Every tool the catalog names registers deferred, so it costs nothing until enabled.
const { readFileSync } = await import("node:fs");
for (const [file, name] of [["screen-read", "screenReadTool"], ["mobile-act", "mobileActTool"], ["app-act", "appActTool"], ["browser-act", "browserActTool"], ["browser-search", "imageSearchTool"]])
	assert.match(readFileSync(new URL(`../extensions/${file}.ts`, import.meta.url), "utf8"), new RegExp(`\\{ \\.\\.\\.${name}\\([^)]*\\)\\)?, exposure: "deferred" \\}`), `${name} registers deferred`);
console.log("ok - tools_enable lists registered situational tools and declares the named ones");
