import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import workModelsExtension from "../extensions/work-models.ts";

const cwd = mkdtempSync(path.join(tmpdir(), "ce-utilities-control-"));
const commands = {}, shortcuts = {}, tools = {}, hooks = {};
const sent = [], notices = [], forwarded = [];
const previousSwitch = process.env.CE_WORKFLOW_ENABLED;
const previousAgents = process.env.PI_SUBAGENT_AGENT_DIRS;
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
try {
	// An old configuration cannot reactivate removed orchestration.
	process.env.CE_WORKFLOW_ENABLED = "1";
	process.env.PI_CODING_AGENT_DIR = path.join(cwd, "agent");
	const pi = {
		on: (name, handler) => { hooks[name] = handler; },
		registerCommand: (name, config) => { commands[name] = config; },
		registerShortcut: (name, config) => { shortcuts[name] = config; },
		registerTool: tool => { tools[tool.name] = tool; },
		events: { on: () => {}, emit: (name, args) => forwarded.push([name, args.name, args.args]) },
		sendUserMessage: text => sent.push(text),
	};
	workModelsExtension(pi);
	const ctx = { cwd, getContextUsage: () => ({ tokens: 0 }), ui: { notify: text => notices.push(text) } };
	assert(!shortcuts.f9);
	assert(!commands.ideate);
	assert(!Object.keys(tools).some(name => name.startsWith("work_")));
	assert(!Object.keys(commands).some(name => name.startsWith("__orchestrator")));
	assert(tools.knowledge && tools.compaction_note && tools.research_note);
	const names = commands.wo.getArgumentCompletions("").map(item => item.value);
	for (const name of ["goal", "pause", "monitor", "resume-work", "design", "redesign", "telemetry", "usage"]) assert(!names.includes(name), name);
	for (const name of ["plan", "plans", "resume", "settings", "compact", "fact"]) assert(names.includes(name), name);
	for (const args of ["plan finish", "plans", "resume abc"]) await commands.wo.handler(args, ctx);
	assert.deepEqual(forwarded, [["plan3:command", "plan3", "finish"], ["plan3:command", "plans3", ""], ["plan3:command", "resume3", "abc"]]);
	for (const action of ["goal", "monitor", "telemetry", "usage", "design", "redesign", "resume-work", "pause"])
		await commands.wo.handler(`${action} forbidden`, ctx);
	assert.equal(sent.length, 0);
	assert.match(notices.at(-1), /Unknown \/wo command/);
	let labels = [];
	await commands.wo.handler("settings", { ...ctx, hasUI: true,
		ui: { ...ctx.ui, select: (_title, choices) => { labels = choices; return undefined; } } });
	assert(labels.some(label => label.includes("OpenDesign executable")), "settings renders retained design controls");
	assert(labels.some(label => label.includes("Planning model")), "settings renders Plan3 controls");
	assert(!labels.some(label => /Workflow|Advisor 1|Effort profile|Background verifiers/.test(label)), "settings has no orchestration controls");
	const event = { toolName: "ask_user", input: {} };
	await hooks.tool_call(event, ctx);
	assert.equal(event.input.allowComment, true);
	console.log("Utility command self-checks passed");
} finally {
	if (previousSwitch === undefined) delete process.env.CE_WORKFLOW_ENABLED; else process.env.CE_WORKFLOW_ENABLED = previousSwitch;
	if (previousAgents === undefined) delete process.env.PI_SUBAGENT_AGENT_DIRS; else process.env.PI_SUBAGENT_AGENT_DIRS = previousAgents;
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(cwd, { recursive: true, force: true });
}
