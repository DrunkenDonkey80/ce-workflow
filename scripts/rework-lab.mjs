#!/usr/bin/env node
// Rework lab: run the rework recipe unattended on a throwaway full clone of a project.
// A fresh clone at the pre-rework SHA, Plan3 driven over Pi RPC, the driver playing the human:
// recommended answers in dialogs, gates turned on in order when the run stalls on them.
// Usage: node scripts/rework-lab.mjs <run-name> [--source DIR] [--sha SHA] [--hours N] [--request-file FILE] [--resume]
//          [--plan-only] [--check CMD] [--add SRC=DEST]...
// --add copies task inputs (a fixture) into the clone as one commit on top of SHA; diffs and counts start after it.
// --resume continues an existing run's clone and plan instead of cloning and planning again.
// --plan-only stops after the first /plan3 turn and copies the draft plan to <root>/<run>.plan.md.
// --check runs CMD (bash) in the clone at the end; its result goes on the final line.
// No plan after /plan3 (the planner sized it Tiny and just did it) ends as outcome "tiny", not a failure.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sessionMetrics } from "./lab-metrics.mjs";
import { reworkRequest } from "../extensions/plan3-rework.ts";

const args = process.argv.slice(2);
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const runName = args[0];
if (!runName || runName.startsWith("--")) throw new Error("usage: rework-lab.mjs <run-name> [--source DIR] [--sha SHA] [--hours N] [--request-file FILE]");
const source = value("--source", "C:/SOFT/git/DealFinder");
const sha = value("--sha", "27221be");
const hours = Number(value("--hours", "10"));
const root = value("--root", "C:/SOFT/git/rework-lab");
const thinker = value("--thinker", "anthropic/claude-opus-5-5");
const worker = value("--worker", "openai-codex/gpt-6.1-sol");
const dir = path.join(root, runName);
const log = path.join(root, `${runName}.lab.jsonl`);
const note = (kind, data = {}) => { const line = { t: new Date().toISOString(), kind, ...data }; appendFileSync(log, `${JSON.stringify(line)}\n`); console.log(kind, JSON.stringify(data).slice(0, 300)); };
const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();

const request = value("--request-file") ? readFileSync(value("--request-file"), "utf8").trim()
	: reworkRequest("", sha);
// Answer for every free-text dialog: this run has no human, so the agent's own recommendation stands.
const HUMAN = "Unattended lab run in a throwaway clone: go with your recommended option. Any watch window is waived and counts as passed. Never waive or remove a gate: I turn gates on with Alt+A myself when their phase is next.";
const GATE_DODGE = /amend|chat approval|instead of alt\+a|remove .*needs|waive .*gate/i;

// ---------- clone ----------
function setup() {
	if (existsSync(dir)) throw new Error(`${dir} exists; pick a new run name`);
	mkdirSync(root, { recursive: true });
	execFileSync("git", ["clone", "-q", "--no-local", source, dir]);
	git("reset", "-q", "--hard", sha);
	git("remote", "remove", "origin"); // later commits (a pilot's answers) must not be reachable
	git("reflog", "expire", "--expire=now", "--all");
	git("gc", "-q", "--prune=now");
	const adds = args.flatMap((arg, i) => arg === "--add" ? [args[i + 1].split("=")] : []);
	for (const [src, dest] of adds) cpSync(src, path.join(dir, dest), { recursive: true });
	if (adds.length) { git("add", "-A"); git("-c", "user.name=lab", "-c", "user.email=lab@local", "commit", "-q", "-m", "lab: task inputs"); }
	git("tag", "lab-base");
	if (existsSync(path.join(source, "data"))) cpSync(path.join(source, "data"), path.join(dir, "data"), { recursive: true });
	mkdirSync(path.join(dir, ".pi"), { recursive: true });
	writeFileSync(path.join(dir, ".pi", "settings.json"), `${JSON.stringify({ workOrchestrator: { plan3: { planningModel: thinker, codingModel: worker, codingEffort: "high" }, context: { mode: "ultrafull" } } }, null, "\t")}\n`);
	appendFileSync(path.join(dir, ".git", "info", "exclude"), "\n/.pi/\n/.ce-workflow/\n/.pi-lens-probe-home/\n"); // pi-lens writes probe logs into the cwd
	note("clone", { dir, sha: git("rev-parse", "--short", "HEAD"), commits: git("rev-list", "--all", "--count") });
}

// ---------- plan state ----------
const plansDir = () => path.join(dir, "docs", "plans");
const known = new Set(existsSync(path.join(source, "docs", "plans")) ? readdirSync(path.join(source, "docs", "plans")) : []);
// Plan3 archives a complete plan into done/; follow it there so the loop sees "complete" instead of resuming an older plan.
function planFile() {
	const list = (sub) => existsSync(path.join(plansDir(), sub)) ? readdirSync(path.join(plansDir(), sub)).filter((f) => f.endsWith("-plan3.md") && !known.has(f)).map((f) => path.join(plansDir(), sub, f)) : [];
	return [...list(""), ...list("done")].sort((a, b) => path.basename(a).localeCompare(path.basename(b))).at(-1);
}
const planText = () => { const f = planFile(); return f ? readFileSync(f, "utf8") : ""; };
const status = () => planText().match(/^status:\s*(\S+)/m)?.[1];
const fingerprint = () => createHash("sha1").update(planText()).update(git("rev-parse", "HEAD")).update(git("status", "--porcelain")).update(git("diff")).digest("hex");
const needsPath = () => { const f = planFile(); return f && path.join(plansDir(), "logs", `${path.basename(f).match(/-([0-9a-f]{8})-plan3\.md$/)?.[1]}.needs.json`); };
// A human grants a gate only when its phase is next: every step above the phase that needs it is done.
function nextGate() {
	const lines = planText().split(/\r?\n/);
	const needs = (() => { try { return JSON.parse(readFileSync(needsPath(), "utf8")); } catch { return {}; } })();
	for (const id of ["R-design-approved", "R-cutover-approved", "R-retire-approved"]) {
		const at = lines.findIndex((line) => new RegExp(`needs:.*\\b${id}\\b`).test(line));
		if (at < 0 || needs.day?.[id]) continue;
		// [human] steps (Pick, Switch) stay [human] in the plan; the gate grant is their human action.
		const before = lines.slice(0, at).filter((line) => /^- \[[^\]]*\] \*\*/.test(line));
		return before.every((line) => /^- \[(x|human)\]/.test(line)) ? id : undefined;
	}
}
function grant(id) {
	const file = needsPath();
	let needs = {};
	try { needs = JSON.parse(readFileSync(file, "utf8")); } catch {}
	needs.day = { ...needs.day, [id]: true };
	needs.night = { ...(needs.night ?? needs.day), [id]: true, human: false };
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(needs, null, "\t")}\n`);
	note("grant", { id });
}

// ---------- Pi over RPC ----------
const launcher = path.join(os.homedir(), ".pi", "agent", "bin", "pi-launcher.js");
let lastNotify = "", lastTitle = "", repeats = 0;
let child, running = false, lastActivity = Date.now(), buffer = "";
const rpcOut = path.join(root, `${runName}.rpc.jsonl`);
const sessions = path.join(root, `${runName}-sessions`);
function start() {
	child = spawn(process.execPath, [launcher, "--mode", "rpc", "--session-dir", sessions, "--model", thinker, "--thinking", "high"], { cwd: dir, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PI_HUB"))), stdio: ["pipe", "pipe", "pipe"] }); // no hub: dialogs must come here, not to the user's hub
	child.stdout.on("data", (chunk) => {
		appendFileSync(rpcOut, chunk);
		buffer += chunk;
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) { try { onEvent(JSON.parse(line)); } catch {} }
	});
	child.stderr.on("data", (chunk) => appendFileSync(path.join(root, `${runName}.stderr.log`), chunk));
	child.on("exit", (code) => note("pi-exit", { code }));
}
const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);
function answer(req) {
	const options = (req.options ?? []).map(String);
	// No marked recommendation: answer in free text so the agent takes its own, instead of the first option winning by position.
	// The agent asking for a gate is the moment a human presses Alt+A; a proposal to replace the gate is refused.
	const gate = nextGate();
	if (gate && String(req.title).includes(gate)) grant(gate);
	const pick = options.find((o) => /recommended|^start work here/i.test(o) && !GATE_DODGE.test(o)) ?? options.find((o) => /rework/i.test(o)) ?? options.find((o) => /type custom response/i.test(o)) ?? options.find((o) => !/^(cancel|other|skip|later|stop|no\b)/i.test(o)) ?? options[0];
	repeats = req.title === lastTitle ? repeats + 1 : 0;
	lastTitle = req.title;
	// Checklists (✓/○ rows) toggle a row per pick and save on Esc; leave them as they are. A dialog that keeps coming back is cancelled too.
	const checklist = req.method === "select" && options.length > 0 && options.every((o) => /^[✓○] /.test(o));
	const reply = checklist || repeats >= 5 ? { cancelled: true } : req.method === "select" ? { value: pick } : req.method === "confirm" ? { confirmed: true } : { value: HUMAN };
	note("dialog", { method: req.method, title: req.title, options, reply });
	send({ type: "extension_ui_response", id: req.id, ...reply });
}
function onEvent(event) {
	lastActivity = Date.now();
	if (event.type === "agent_start") running = true;
	if (event.type === "agent_settled" || event.type === "agent_end") running = false;
	if (event.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(event.method)) answer(event);
	if (event.type === "extension_ui_request" && event.method === "notify") lastNotify = String(event.message ?? "");
	if (event.type === "response" && event.success === false) note("rpc-error", { command: event.command, error: event.error });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Idle = no run and no event for 45 s, so extension follow-ups (stop guard, phase switch) get their turn.
async function idle(deadline) {
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error("pi exited");
		if (!running && Date.now() - lastActivity > 45_000) return;
		await sleep(2000);
	}
	throw new Error("deadline");
}
async function prompt(message, deadline) {
	note("prompt", { message: message.slice(0, 200) });
	lastActivity = Date.now();
	send({ type: "prompt", message });
	await idle(deadline);
}

// R3 metrics for the final line: every session of the run (all prompts, continuations, subagent children) summed,
// wall time of this invocation, the check result and the diff against the pre-rework SHA.
const started = Date.now();
// NUL excluded: an agent's `2>NUL` in bash leaves a file git refuses to add.
function result() {
	const tail = (text) => String(text).trim().split("\n").slice(-3).join("\n");
	const check = value("--check") && (() => {
		try { return { pass: true, tail: tail(execFileSync("bash", ["-c", value("--check")], { cwd: dir, encoding: "utf8", stdio: "pipe" })) }; }
		catch (error) { return { pass: false, tail: tail(`${error.stdout ?? ""}${error.stderr ?? ""}`) }; }
	})();
	return { wallMs: Date.now() - started, metrics: sessionMetrics(sessions), ...(check ? { check } : {}), diffStat: (git("add", "-N", "--", ".", ":(exclude)NUL"), git("diff", "--shortstat", "lab-base")), sessions };
}

// ---------- main ----------
const resume = args.includes("--resume");
if (!resume) setup();
else if (!git("tag", "-l", "lab-base")) git("tag", "lab-base", sha); // runs cloned before --add existed
const deadline = Date.now() + hours * 3600_000;
start();
try {
	if (!resume) await prompt(`/plan3 ${request}`, deadline);
	if (!planFile()) {
		note("done", { outcome: "tiny", head: git("rev-parse", "--short", "HEAD"), ...result() });
	} else if (args.includes("--plan-only")) {
		cpSync(planFile(), path.join(root, `${runName}.plan.md`));
		note("done", { outcome: "plan-only", status: status(), plan: planFile(), ...result() });
	} else await execute();
} catch (error) {
	note("failed", { error: String(error?.message ?? error), status: status(), ...result() });
} finally {
	child.kill();
}

async function execute() {
	// Planning ends only through /plan3 finish (review offer, then "Start work here").
	for (let tries = 0; status() === "draft"; tries++) {
		if (tries === 4) throw new Error(`plan still draft: ${lastNotify}`);
		lastNotify = "";
		await prompt("/plan3 finish", deadline);
		if (status() === "draft" && /not ready/i.test(lastNotify)) await prompt(`${lastNotify}\nFix these problems in the plan, then stop.`, deadline);
	}
	note("planned", { plan: planFile(), status: status() });
	let last = "", stalls = 0, lastMarks = "", markStalls = 0;
	while (status() !== "complete") {
		const now = fingerprint();
		stalls = now === last ? stalls + 1 : 0;
		last = now;
		// A run waiting on a gate still commits checkpoints, so gates go by step markers alone.
		const marks = planText().split(/\r?\n/).filter((line) => /^- \[[^\]]*\] \*\*/.test(line)).join("\n");
		markStalls = marks === lastMarks ? markStalls + 1 : 0;
		lastMarks = marks;
		const gate = markStalls >= 2 ? nextGate() : undefined;
		if (gate || stalls >= 2) {
			if (!gate) { note("stuck", { status: status() }); break; }
			grant(gate);
			stalls = markStalls = 0;
			await prompt(`Plan3 requirements changed by the user: ${gate} on. Continue the plan.`, deadline);
			continue;
		}
		await prompt("/resume3", deadline); // a run start applies the phase model
	}
	note("done", { outcome: status() === "complete" ? "complete" : "stuck", status: status(), head: git("rev-parse", "--short", "HEAD"), commits: git("rev-list", "--count", "lab-base..HEAD"), ...result() });
}
