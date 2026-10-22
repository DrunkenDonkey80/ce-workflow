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
const { default: advisor, advisorModel, reviewRange, reviewPrompt } = await import("../extensions/advisor-model.ts");

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

// Diff review: baseline is the later of the last commit and the last review; commits wait for a review when set.
const { execFileSync } = await import("node:child_process");
const repo = mkdtempSync(path.join(tmpdir(), "review-repo-"));
const g = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" });
g("init", "-q"); writeFileSync(path.join(repo, "a.txt"), "one"); g("add", "-A"); g("commit", "-qm", "init");
settings([{ model: "openai-codex/gpt-6.1-sol", thinking: "medium" }]);
const ctx = { cwd: repo, model: { provider: "anthropic", id: "claude-opus-5-5" }, sessionManager: { getBranch: () => [{ type: "message", timestamp: new Date().toISOString(), message: { role: "user", content: "fix the parser" } }] } };
assert.match((await reviewPrompt(ctx, "x")).error, /Nothing changed/, "clean tree: nothing to review");
writeFileSync(path.join(repo, "b.txt"), "new untracked");
const first = await reviewPrompt(ctx, "The user ran /wo review.");
assert.match(first.stat, /b\.txt/, "untracked files are reviewed");
assert.match(first.prompt, /"agent":"diff-reviewer","model":"openai-codex\/gpt-6\.1-sol:medium"/, "Opus code gets the OpenAI reviewer");
assert.match(first.prompt, /fix the parser/, "user prompts are the task");
first.mark();
assert.equal(reviewRange(repo).stat, "", "after a review only later changes count");
writeFileSync(path.join(repo, "a.txt"), "two");
assert.match(reviewRange(repo).stat, /a\.txt/); assert.doesNotMatch(reviewRange(repo).stat, /b\.txt/);
g("add", "-A"); g("commit", "-qm", "c2");
assert.equal(reviewRange(repo).stat, "", "a newer commit becomes the baseline");
assert.equal(g("status", "--porcelain"), "", "the real index is untouched");

const gate = {}; advisor({ on: (name, fn) => { gate[name] = fn; }, events: { on() {} }, sendUserMessage() {} });
const commit = { toolName: "bash", input: { command: "git commit -am x" } };
writeFileSync(path.join(repo, "a.txt"), "three");
assert.equal(await gate.tool_call(commit, ctx), undefined, "review before commit is off by default");
mkdirSync(path.join(repo, ".pi"));
writeFileSync(path.join(repo, ".pi", "settings.json"), JSON.stringify({ workOrchestrator: { reviewBeforeCommit: "always" } }));
writeFileSync(path.join(repo, "a.txt"), "four");
const blocked = await gate.tool_call(commit, ctx);
assert.equal(blocked?.block, true, "always: the commit waits for a review");
assert.match(blocked.reason, /diff-reviewer/);
assert.equal(await gate.tool_call(commit, ctx), undefined, "the commit after triage goes through");
console.log("ok - diff review range and before-commit gate");
