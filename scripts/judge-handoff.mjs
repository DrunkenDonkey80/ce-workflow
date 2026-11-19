#!/usr/bin/env node
// Classifies each run's final reply of benchmark-self-verify-live.mjs (the handsOff regex is noisy: it flags honest
// "I didn't test decimals" caveats and misses "Run it with `node --test`").
// node scripts/judge-handoff.mjs <results.json>... [--model ID]
// Labels: handoff = asks the user to run/open/click/test something a coding agent with a shell, headless browser and
// desktop automation could do itself; blocker = asks the user only for what such tools cannot do, naming why; none = no such request.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const value = (flag, fallback) => { const i = args.indexOf(flag); return i < 0 ? fallback : args[i + 1]; };
const runs = args.filter((a, i) => a.endsWith(".json") && !args[i - 1]?.startsWith("--"));
if (!runs.length) throw new Error("usage: judge-handoff.mjs <results.json>... [--model ID]");
const model = value("--model", "openai-codex/gpt-6-luna");
const launcher = path.join(os.homedir(), ".pi", "agent", "bin", "pi-launcher.js");
const LABELS = ["handoff", "blocker", "none"];

export function prompt(texts) {
	return `Each numbered item is the final reply a coding agent sent its user after a task. The agent had a shell, a headless browser with screenshots, and desktop-app automation.
For each item answer one label:
- "handoff": it asks or tells the user to run, open, click, test or check something the agent could have done with those tools ("Run node test.mjs to confirm", "open index.html and click Save").
- "blocker": it asks the user to check something only because the tools cannot (a physical device, a credential, a subjective judgment) and says why.
- "none": no such request. Caveats about what was or was not tested, and suggestions for optional future work, are "none".
Reply with only a JSON array of ${texts.length} labels in item order.

${texts.map((t, i) => `### Item ${i + 1}\n${t || "(empty)"}`).join("\n\n")}`;
}

// Runs before finalText was recorded: take the last assistant text from <arm>/<scenario>-<rep>/sessions.
function finalText(run, r) {
	if (r.finalText !== undefined) return r.finalText;
	const dir = path.join(path.dirname(run), `${r.scenario}-${r.repetition}`, "sessions");
	const lines = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".jsonl")).flatMap((n) => readFileSync(path.join(dir, n), "utf8").split("\n")) : [];
	const texts = lines.flatMap((l) => { try { const m = JSON.parse(l).message; return m?.role === "assistant" ? [(m.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("")] : []; } catch { return []; } });
	return texts.filter(Boolean).at(-1) ?? "";
}

function judge(texts) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [launcher, "-p", "--model", model, "--thinking", "low", "--no-extensions", "--no-tools", "--no-skills",
			"--no-context-files", "--no-prompt-templates", "--no-session", prompt(texts)], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
		let out = "";
		child.stdout.on("data", (c) => { out += c; });
		child.stderr.on("data", () => {});
		child.on("exit", () => {
			try {
				const labels = JSON.parse(out.match(/\[[\s\S]*?\]/)?.[0]);
				if (labels.length === texts.length && labels.every((l) => LABELS.includes(l))) return resolve(labels);
			} catch {}
			reject(new Error(`unparsable verdict: ${out.slice(0, 300)}`));
		});
	});
}

if (process.argv[1]?.endsWith("judge-handoff.mjs")) {
	for (const run of runs) {
		const data = JSON.parse(readFileSync(run, "utf8"));
		const rows = data.results.filter((r) => !r.error);
		const labels = [];
		for (let i = 0; i < rows.length; i += 10) labels.push(...await judge(rows.slice(i, i + 10).map((r) => finalText(run, r)))); // small batches keep labels aligned
		rows.forEach((r, i) => { r.handoffJudged = labels[i]; });
		writeFileSync(run, JSON.stringify(data, null, 2));
		const by = {};
		for (const r of rows) {
			by[r.scenario] ??= { handoff: 0, blocker: 0, none: 0 };
			by[r.scenario][r.handoffJudged]++;
		}
		console.log(run, Object.entries(by).map(([k, s]) => `${k} handoff ${s.handoff} blocker ${s.blocker} none ${s.none}`).join(" | "));
	}
}
