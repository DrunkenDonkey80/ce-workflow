#!/usr/bin/env node
// Classifies each run's final reply of benchmark-self-verify-live.mjs (the handsOff regex is noisy: it flags honest
// "I didn't test decimals" caveats and misses "Run it with `node --test`").
// node scripts/judge-handoff.mjs <results.json>... [--model ID]
// Labels: handoff = asks the user to run/open/click/test something a coding agent with a shell, headless browser and
// desktop automation could do itself; blocker = asks the user only for what such tools cannot do, naming why; none = no such request.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { judgeWithRetry, parseArray, rate, runChild } from "./judge-common.mjs";

const args = process.argv.slice(2);
const value = (flag, fallback) => { const i = args.indexOf(flag); return i < 0 ? fallback : args[i + 1]; };
const runs = args.filter((a, i) => a.endsWith(".json") && !args[i - 1]?.startsWith("--"));
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

// One judge call per batch, with a deadline and one retry; a batch that still fails is a judge error.
function judge(texts) {
	return judgeWithRetry(() => runChild(process.execPath, [launcher, "-p", "--model", model, "--thinking", "low", "--no-extensions", "--no-tools", "--no-skills",
		"--no-context-files", "--no-prompt-templates", "--no-session", prompt(texts)]), (out) => parseArray(out, texts.length, (l) => LABELS.includes(l)));
}

// Labels rows in batches of 10 (small batches keep labels aligned). An empty final reply is not applicable (null)
// and is not sent; a failed batch marks only its rows with handoffJudgedError, the other batches keep scoring.
export async function labelRows(rows, texts, judgeBatch) {
	const todo = rows.map((_, i) => i).filter((i) => texts[i].trim());
	for (const r of rows) { r.handoffJudged = null; delete r.handoffJudgedError; }
	for (let i = 0; i < todo.length; i += 10) {
		const batch = todo.slice(i, i + 10);
		const verdict = await judgeBatch(batch.map((j) => texts[j]));
		batch.forEach((j, k) => { if (verdict.error) rows[j].handoffJudgedError = verdict.error; else rows[j].handoffJudged = verdict.value[k]; });
	}
}

// Per scenario: label counts, a handoff rate over judged runs with its interval, and n/a and judge errors apart.
export function summarize(rows) {
	const by = {};
	for (const r of rows) by[r.scenario] = [...(by[r.scenario] ?? []), r];
	return Object.entries(by).map(([scenario, rs]) => {
		const judged = rs.filter((r) => r.handoffJudged), count = (label) => judged.filter((r) => r.handoffJudged === label).length;
		const na = rs.filter((r) => r.handoffJudged === null && !r.handoffJudgedError).length, errors = rs.filter((r) => r.handoffJudgedError).length;
		return `${scenario} handoff ${rate(count("handoff"), judged.length, "runs")}, blocker ${count("blocker")}, none ${count("none")}${na ? `, n/a ${na}` : ""}${errors ? `, judge error ${errors} (unscored)` : ""}`;
	}).join(" | ");
}

if (process.argv[1]?.endsWith("judge-handoff.mjs")) {
	if (!runs.length) throw new Error("usage: judge-handoff.mjs <results.json>... [--model ID]");
	for (const run of runs) {
		const data = JSON.parse(readFileSync(run, "utf8"));
		const rows = data.results.filter((r) => !r.error);
		await labelRows(rows, rows.map((r) => finalText(run, r)), judge);
		writeFileSync(run, JSON.stringify(data, null, 2));
		console.log(run, summarize(rows));
	}
}
