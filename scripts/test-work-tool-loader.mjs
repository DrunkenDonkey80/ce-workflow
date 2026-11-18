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
assert.match(loader.description, /- mobile_act: drive an iOS/);
assert.doesNotMatch(loader.description, /generate_image|other_deferred/);
assert.match(loader.description, /^Before telling the user to open, click, look at or test something[\s\S]*desktop app → app_act[\s\S]*phone app or simulator → mobile_act[\s\S]*grant no consent/, "the loader says when to reach for each family, not just what it is");
const result = await loader.execute("1", { tools: ["mobile_act", "screen_read", "mobile_act", "generate_image"] });
assert.deepEqual(active, ["read", "bash", "mobile_act", "screen_read"], "activates each named tool once, keeps the rest");
assert.match(result.content[0].text, /Enabled mobile_act, screen_read/);
await assert.rejects(loader.execute("2", { tools: ["generate_image"] }), /Name one of: mobile_act, screen_read/);
for (const line of Object.values(SITUATIONAL_TOOLS)) assert(line.length <= 110, `catalog lines stay short: ${line}`);

// Every tool the catalog names registers deferred, so it costs nothing until enabled.
const { readFileSync } = await import("node:fs");
for (const [file, name] of [["screen-read", "screenReadTool"], ["mobile-act", "mobileActTool"], ["app-act", "appActTool"], ["browser-act", "browserActTool"], ["browser-search", "imageSearchTool"], ["vm-act", "vmActTool"]])
	assert.match(readFileSync(new URL(`../extensions/${file}.ts`, import.meta.url), "utf8"), new RegExp(`\\{ \\.\\.\\.${name}\\([^)]*\\)\\)?, exposure: "deferred" \\}`), `${name} registers deferred`);
console.log("ok - tools_enable lists registered situational tools and declares the named ones");

// E7: near-unused tools (<1 call per 1,000 turns, census E3) start undeclared and are listed by tools_enable.
{
	const { activateNamedTools } = await import("../extensions/tool-loader.ts");
	let on = ["read"], sets = 0;
	const tools = [{ name: "camera_capture", exposure: "model-only" }, { name: "plan3_diagram", exposure: "deferred" }, { name: "session_dialog", exposure: "deferred" }, { name: "browser_fetch", exposure: "deferred" }, { name: "jev_triage", exposure: "hidden" }];
	const host = { getAllTools: () => tools, getActiveTools: () => on, setActiveTools: (names) => { on = names; sets++; } };
	assert.deepEqual(toolsEnableTool(host).parameters.properties.tools.items.enum, ["camera_capture", "plan3_diagram", "session_dialog", "browser_fetch"], "model-only camera tools are offered too, hidden ones are not");
	assert.deepEqual(toolsEnableTool(host, ["camera_capture"]).parameters.properties.tools.items.enum, ["plan3_diagram", "session_dialog", "browser_fetch"], "a camera that is off is not offered");
	activateNamedTools(host, "Update the diagram through plan3_diagram target product; browser_fetch the page.");
	assert.deepEqual(on, ["read", "plan3_diagram"], "an instruction naming plan3_diagram declares it; tools the harness never instructs stay off");
	activateNamedTools(host, "use plan3_diagram again");
	assert.equal(sets, 1, "already active: no tool-set change (keeps the prompt cache)");
	activateNamedTools(host, "session_dialog {action: \"wait\"}");
	assert.deepEqual(on, ["read", "plan3_diagram", "session_dialog"]);
	for (const [file, pattern] of [
		["browser-search", /registerTool\?\.\(\{ \.\.\.browserSearchTool\(\), exposure: "deferred" \}\)/],
		["browser-fetch", /registerTool\?\.\(\{ \.\.\.browserFetchTool\(\), exposure: "deferred" \}\)/],
		["plan3", /name: "plan3_diagram", label: "Plan3 diagram", exposure: "deferred"/],
		["hub-command", /name: "session_dialog",\s+label: "Session dialog",\s+exposure: "deferred"/],
		["jev-tools", /exposure: definition\.name === "jev_triage" \? "deferred" : "direct"/],
	]) assert.match(readFileSync(new URL(`../extensions/${file}.ts`, import.meta.url), "utf8"), pattern, `${file} registers its near-unused tool deferred`);
	const camera = readFileSync(new URL("../extensions/work-camera-tools.ts", import.meta.url), "utf8");
	assert.equal(camera.match(/exposure: "model-only", defaultActive: false/g)?.length, 4, "all four camera tools register inactive");
	for (const name of ["camera_capture", "camera_recover", "camera_watch", "camera_stop", "plan3_diagram", "session_dialog", "browser_search", "browser_fetch", "jev_triage"]) assert(name in SITUATIONAL_TOOLS, `${name} has a tools_enable line`);
	const hub = readFileSync(new URL("../extensions/hub-command.ts", import.meta.url), "utf8");
	assert.match(hub, /activateTools\(pi, \["session_dialog"\]\)/, "a send stopped at a peer's open question declares session_dialog");
	console.log("ok - near-unused tools start undeclared, tools_enable offers them, their instructions declare them");
}

// E7: pi-lens's near-unused always-active tools are withdrawn at session start; a branch that enabled one keeps it.
{
	const { deferForeignTools } = await import("../extensions/tool-loader.ts");
	let on = ["read", "symbol_search", "read_enclosing", "effective_config", "lens_diagnostics"];
	const host = { getAllTools: () => on.map((name) => ({ name, exposure: "direct" })), getActiveTools: () => on, setActiveTools: (names) => { on = names; } };
	const offered = toolsEnableTool(host).parameters.properties.tools.items.enum;
	assert.deepEqual(offered, ["symbol_search", "read_enclosing", "effective_config"], "direct pi-lens tools are offered; their other direct tools are not");
	const branch = [{ message: { role: "toolResult", toolName: "tools_enable", details: { enabled: ["read_enclosing"] } } }, { message: { role: "toolResult", toolName: "read", details: { enabled: ["effective_config"] } } }];
	deferForeignTools(host, branch);
	assert.deepEqual(on, ["read", "read_enclosing", "lens_diagnostics"], "withdrawn unless tools_enable enabled it on this branch");
	const wo = readFileSync(new URL("../extensions/work-models.ts", import.meta.url), "utf8");
	assert.match(wo, /session_start[\s\S]{0,200}deferForeignTools\(pi, ctx\.sessionManager/, "session start withdraws them");
	const { PHASE_DROPS } = await import("../extensions/tool-loader.ts");
	const dropped = [...new Set(Object.values(PHASE_DROPS).flat())];
	const withDrops = { getAllTools: () => [...dropped, "read"].map((name) => ({ name, exposure: "direct" })) };
	assert.deepEqual(toolsEnableTool(withDrops).parameters.properties.tools.items.enum, dropped, "every tool a Plan3 phase drops stays reachable through tools_enable");
	on = ["read", "resolve-library-id", "query-docs", "pi_lens_activate_tools", "project_report", "module_report", "read_symbol"];
	deferForeignTools(host, []);
	assert.deepEqual(on, ["read", "read_symbol"], "Context7 and the rarely used pi-lens tools are withdrawn too");
	const { setToolsActive } = await import("../extensions/tool-loader.ts");
	let sets = 0;
	const mode = { getAllTools: () => ["read", "research_note", "research_exit"].map((name) => ({ name })), getActiveTools: () => on, setActiveTools: (names) => { sets++; on = names; } };
	on = ["read", "research_note", "research_exit"];
	setToolsActive(mode, ["research_note", "research_exit"], false);
	assert.deepEqual(on, ["read"], "research tools leave with research mode");
	setToolsActive(mode, ["research_note", "research_exit"], false);
	assert.equal(sets, 1, "already off: no tool-set change");
	setToolsActive(mode, ["research_note", "research_exit"], true);
	assert.deepEqual(on, ["read", "research_note", "research_exit"], "and come back with it");
	on = ["read", "research_note"];
	setToolsActive(mode, ["research_note", "research_exit"], false);
	assert.deepEqual(on, ["read"], "a partly active set is withdrawn too");
	assert.match(readFileSync(new URL("../extensions/work-models.ts", import.meta.url), "utf8"), /setToolsActive\(workExtensionPi, \["research_note", "research_exit"\], Boolean\(researchContext\)\)/, "research mode drives them");
	console.log("ok - pi-lens near-unused tools start undeclared unless this branch enabled them");
}
