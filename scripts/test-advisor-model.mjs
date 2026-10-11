// Oracle launches get the first /wo Plan models entry from another model family, set in code.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const agentDir = mkdtempSync(path.join(tmpdir(), "advisor-"));
const cwd = mkdtempSync(path.join(tmpdir(), "advisor-cwd-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const settings = (models) => writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ workOrchestrator: { plan3: { models } } }));
settings([{ model: "openai-codex/gpt-6-astra", thinking: "high" }, { model: "anthropic/claude-opus-5-5" }]);
const { default: advisor, advisorModel } = await import("../extensions/advisor-model.ts");

const opus = { cwd, model: { provider: "anthropic", id: "claude-opus-5-5" } };
const sol = { cwd, model: { provider: "openai-codex", id: "gpt-6.1-sol" } };
assert.equal(await advisorModel(opus), "openai-codex/gpt-6-astra:high", "Opus -> Astra");
assert.equal(await advisorModel(sol), "anthropic/claude-opus-5-5:high", "Sol -> Opus, thinking defaults to high");

const handlers = {};
advisor({ on: (name, fn) => { handlers[name] = fn; } });
const call = { toolName: "subagent", input: { agent: "oracle", task: "why", model: "whatever/guess" } };
await handlers.tool_call(call, opus);
assert.equal(call.input.model, "openai-codex/gpt-6-astra:high", "the settings choice overrides the agent's guess");
const other = { toolName: "subagent", input: { agent: "worker", task: "x" } };
await handlers.tool_call(other, opus);
assert.equal(other.input.model, undefined, "other agents are untouched");

settings([{ model: "openai-codex/gpt-5.6-terra", thinking: "xhigh" }]);
const event = { systemPromptOptions: { promptGuidelines: ["keep"] } };
await handlers.before_agent_start(event, opus);
assert.deepEqual(event.systemPromptOptions.promptGuidelines.slice(0, 1), ["keep"]);
assert.match(event.systemPromptOptions.promptGuidelines[1], /openai-codex\/gpt-5\.6-terra:xhigh/, "a settings change applies on the next run");

mkdirSync(path.join(cwd, ".pi"));
writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ workOrchestrator: { plan3: { models: [] } } }));
const bare = { systemPromptOptions: {} };
await handlers.before_agent_start(bare, opus);
assert.equal(bare.systemPromptOptions.promptGuidelines, undefined, "no Plan models: no guideline");
console.log("ok - advisor model comes from the Plan models setting");
