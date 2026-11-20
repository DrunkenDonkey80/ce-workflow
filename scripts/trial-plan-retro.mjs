// UB-05 (plan 5e4d224a, LoopForge L3): run the plan-retro prompt on finished plans with several models, then
// write a blinded sheet (recommendations shuffled per plan, model hidden) plus a separate key for UB-06 scoring.
// Usage: node scripts/trial-plan-retro.mjs --plans id1,id2 [--models ref:thinking,...] [--output dir]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..");
const { planDigest, retroPrompt, parseRetro } = await import("../extensions/plan3-stats.ts");
const value = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const launcher = path.join(os.homedir(), ".pi", "agent", "bin", "pi-launcher.js");
const providerExtension = path.join(os.homedir(), ".pi", "agent", "git", "github.com", "DrunkenDonkey80", "pi-provider-claude-ex", "index.ts");

// One `pi --mode rpc` call (same path as benchmark-compaction-recall-live.mjs), so every provider and its auth works.
function ask(ref, thinking, prompt) {
	return new Promise((resolve, reject) => {
		const args = ["--mode", "rpc", "--model", ref, "--thinking", thinking, "--no-tools", "--no-extensions", "--no-session", "--system-prompt", "You review finished agent work plans."];
		if (ref.startsWith("anthropic/") && existsSync(providerExtension)) args.push("--extension", providerExtension);
		const child = spawn(process.execPath, [launcher, ...args], { stdio: ["pipe", "pipe", "pipe"] });
		let buffer = "", stderr = "", last;
		const timer = setTimeout(() => { child.kill(); reject(new Error(`${ref}: timed out`)); }, 600_000);
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.stdout.on("data", (chunk) => {
			buffer += chunk;
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				let event;
				try { event = JSON.parse(line); } catch { continue; }
				if (event.type === "message_end" && event.message?.role === "assistant") last = event.message;
				if (event.type === "response" && event.success === false) { clearTimeout(timer); child.kill(); reject(new Error(`${ref}: ${event.error}`)); }
				if (event.type === "agent_settled" || event.type === "agent_end") { clearTimeout(timer); child.kill(); last ? resolve(last) : reject(new Error(`${ref}: no answer`)); }
			}
		});
		child.on("exit", (code) => { clearTimeout(timer); if (!last) reject(new Error(`${ref}: pi exited ${code}: ${stderr.slice(-1000)}`)); });
		child.stdin.write(`${JSON.stringify({ type: "prompt", message: prompt })}\n`);
	});
}
const textOf = (message) => (message.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");

const plans = value("--plans", "").split(",").filter(Boolean);
const models = value("--models", "openai-codex/gpt-6-luna:medium,openai-codex/gpt-6.1-terra:medium,openai-codex/gpt-6.2-astra:high,anthropic/claude-opus-5-5:medium").split(",");
const out = path.resolve(value("--output", path.join(repo, ".pi", "plan-retro-trial", new Date().toISOString().replace(/[:.]/g, "-"))));
mkdirSync(out, { recursive: true });
const done = readdirSync(path.join(repo, "docs", "plans", "done"));
const inputs = plans.map((id) => {
	const file = done.find((f) => f.includes(id) && f.endsWith("-plan3.md"));
	const title = readFileSync(path.join(repo, "docs", "plans", "done", file), "utf8").match(/^# (.+)$/m)?.[1] ?? id;
	const logFile = path.join(repo, "docs", "plans", "logs", `${id}.md`);
	const digest = planDigest(JSON.parse(readFileSync(path.join(repo, "docs", "plans", "logs", `${id}.stats.json`), "utf8")), existsSync(logFile) ? readFileSync(logFile, "utf8") : "");
	return { id, title, digest };
});

// Models run in parallel, plans in sequence per model; one retry on a wrong reply shape.
const runs = (await Promise.all(models.map(async (spec) => {
	const [ref, thinking = "medium"] = spec.split(/:(?=[a-z]+$)/);
	const rows = [];
	for (const plan of inputs) {
		const started = Date.now();
		let result, cost = 0, error;
		for (let attempt = 0; attempt < 2 && !result; attempt++) {
			try {
				const message = await ask(ref, thinking, retroPrompt(plan.title, plan.digest));
				cost += message.usage?.cost?.total ?? 0;
				result = parseRetro(textOf(message), plan.digest);
				if (!result) error = `invalid reply: ${textOf(message).slice(0, 200)}`;
			} catch (e) { error = e.message; }
		}
		rows.push({ model: spec, plan: plan.id, result, error: result ? undefined : error, cost, s: Math.round((Date.now() - started) / 1000) });
		console.log(JSON.stringify({ model: spec, plan: plan.id, ok: !!result, project: result?.project.length, workflow: result?.workflow.length, uncited: result?.uncited, cost, s: rows.at(-1).s }));
	}
	return rows;
}))).flat();
writeFileSync(path.join(out, "runs.json"), JSON.stringify({ inputs, runs }, null, 2));

// Blind sheet: per plan and side, every model's advice shuffled with a random id; the key maps ids to models.
const key = {}, sheet = [];
const shuffle = (list) => list.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
for (const plan of inputs) {
	sheet.push(`## ${plan.title} (${plan.id})`, "", "<details><summary>Digest</summary>", "", "```", plan.digest, "```", "</details>", "");
	for (const side of ["project", "workflow"]) {
		sheet.push(`### ${side === "project" ? "Project" : "Workflow"}`, "");
		const items = shuffle(runs.filter((r) => r.plan === plan.id && r.result).flatMap((r) => r.result[side].map((rec) => ({ model: r.model, ...rec }))));
		for (const item of items) {
			const id = `${plan.id}-${side[0]}${Object.keys(key).length + 1}`;
			key[id] = item.model;
			sheet.push(`- [ ] **${id}** ${item.advice}`, `  - cites: ${item.cites}`);
		}
		if (!items.length) sheet.push("- (none)");
		sheet.push("");
	}
}
writeFileSync(path.join(out, "blind-sheet.md"), sheet.join("\n"));
writeFileSync(path.join(out, "key.json"), JSON.stringify(key, null, 2));
for (const spec of models) {
	const rs = runs.filter((r) => r.model === spec);
	console.log(`${spec}: ${rs.filter((r) => r.result).length}/${rs.length} valid, ${rs.reduce((s, r) => s + (r.result ? r.result.project.length + r.result.workflow.length : 0), 0)} recommendations, ${rs.reduce((s, r) => s + (r.result?.uncited ?? 0), 0)} uncited dropped, $${rs.reduce((s, r) => s + r.cost, 0).toFixed(3)}, ${rs.reduce((s, r) => s + r.s, 0)} s`);
}
console.log(`results: ${out}`);
