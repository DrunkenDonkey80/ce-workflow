#!/usr/bin/env node
// Skills lab (plan 79614d24, C-lab): run one skills-lab task on Sol with a skill off, forced or unforced,
// each run in its own fresh-history copy and session dir under C:\SOFT\git\skills-lab\runs, then check it.
// Usage: node scripts/skills-lab.mjs <run> --task <name> --arm <off|forced|unforced>[,...] [--reps N] [--rep-start N]
//          [--add <src>=<dest>]... [--root DIR] [--model ID] [--timeout-min N] [--no-pi]
// --no-pi: set up and check only (fixture validation on the untouched base; the arm only names the run).
// Task config: docs/proposals/skills-lab/tasks/<name>/lab.json (see design.md). Results: <root>/<run>/results.jsonl.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sessionMetrics } from "./lab-metrics.mjs";

const args = process.argv.slice(2);
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const values = (name) => args.flatMap((arg, i) => arg === name ? [args[i + 1]] : []);
const runName = args[0];
const taskName = value("--task");
if (!runName || runName.startsWith("--") || !taskName) throw new Error("usage: skills-lab.mjs <run> --task <name> --arm <off|forced|unforced>[,...] [--reps N]");
const arms = value("--arm", "off").split(",");
for (const arm of arms) if (!["off", "forced", "unforced"].includes(arm)) throw new Error(`unknown arm ${arm}`);
const reps = Number(value("--reps", "1"));
const repStart = Number(value("--rep-start", "1"));
const root = value("--root", "C:/SOFT/git/skills-lab/runs");
const model = value("--model", "openai-codex/gpt-6.1-sol");
const timeoutMs = Number(value("--timeout-min", "60")) * 60_000;
const taskDir = path.resolve(import.meta.dirname, "..", "docs", "proposals", "skills-lab", "tasks", taskName);
const task = (() => {
	try { return JSON.parse(readFileSync(path.join(taskDir, "lab.json"), "utf8")); }
	catch (error) { throw new Error(`task ${taskName}: cannot read ${path.join(taskDir, "lab.json")}: ${error.message}`); }
})();
const skills = (rel) => path.join(task.skillsRoot ?? "C:/SOFT/git/skills-lab/mattpocock-skills/skills", rel);
const UNATTENDED = "Unattended run: no one will answer questions; decide yourself and say what you decided.";
const launcher = path.join(os.homedir(), ".pi", "agent", "bin", "pi-launcher.js");
const piEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PI_HUB"))); // dialogs never reach the user's hub
if (arms.includes("unforced") && task.noUnforced) throw new Error(`${taskName}: skill has disable-model-invocation, no unforced arm`);

const sh = (cwd, command) => spawnSync("bash", ["-c", command], { cwd, encoding: "utf8", maxBuffer: 64 << 20 });
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", maxBuffer: 64 << 20 }).trim();
const commit = (dir, message) => { git(dir, "add", "-A"); git(dir, "-c", "user.name=lab", "-c", "user.email=lab@local", "commit", "-q", "-m", message); return git(dir, "rev-parse", "--short", "HEAD"); };

// tar runs inside dir: GNU tar reads "C:" in a -C path as a remote host.
// Fresh history: an archive of the source SHA (or a plain copy for "copy" tasks), task files and patch, one commit.
function setup(dir) {
	if (task.copy) { execFileSync("git", ["clone", "-q", task.copy, dir]); git(dir, "remote", "remove", "origin"); } // keeps history; no node_modules
	else mkdirSync(dir, { recursive: true });
	if (!task.copy) execFileSync("tar", ["-x"], { cwd: dir, input: execFileSync("git", ["-C", task.source, "archive", task.sha], { maxBuffer: 1 << 30 }) });
	const files = path.join(taskDir, "files");
	if (existsSync(files)) cpSync(files, dir, { recursive: true });
	const inputs = [...(task.inputs ?? []), ...values("--add").map((pair) => { const [src, dest] = pair.split("="); return { src, dest }; })];
	for (const { src, dest } of inputs) cpSync(src, path.join(dir, dest), { recursive: true });
	if (!task.copy) git(dir, "init", "-q");
	appendFileSync(path.join(dir, ".git", "info", "exclude"), "\n/.pi/\n/.ce-workflow/\n/.pi-lens-probe-home/\n__pycache__/\n.pytest_cache/\n"); // pi-lens writes probe logs into the cwd
	if (task.setupPatch) git(dir, "apply", path.join(taskDir, task.setupPatch));
	let base = task.copy ? commit(dir, "lab setup") : commit(dir, "DealFinder");
	if (task.changePatch) { git(dir, "apply", path.join(taskDir, task.changePatch)); commit(dir, task.changeMessage); }
	return base;
}

function runPi(dir, art, arm, prompt) {
	const sessions = `${art}-sessions`;
	const skillArgs = arm === "off" ? [] : [task.skill, ...(task.deps ?? [])].flatMap((rel) => ["--skill", skills(rel)]);
	const message = `${arm === "forced" ? `/skill:${path.basename(task.skill)} ` : ""}${prompt}\n\n${UNATTENDED}`;
	const events = `${art}.events.jsonl`;
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [launcher, "-p", "--mode", "json", "--model", model, "--thinking", task.thinking ?? "high",
			"--session-dir", sessions, ...skillArgs, message], { cwd: dir, env: piEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
		let timedOut = false;
		const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
		child.stdout.on("data", (chunk) => appendFileSync(events, chunk));
		child.stderr.on("data", (chunk) => appendFileSync(`${events}.stderr`, chunk));
		child.on("exit", (code) => { clearTimeout(timer); resolve({ code, timedOut, events }); });
	});
}

// Tool calls of the run, paths with forward slashes. skillRead: did it read the skill file (for unforced runs: did
// the description trigger it)? outside: calls touching the lab tree beyond its own copy and its skills (sibling
// runs are visible from a run dir; the judge reviews any hit).
function toolCalls(events) {
	if (!existsSync(events)) return [];
	return readFileSync(events, "utf8").split("\n").filter((line) => line.includes("\"tool_execution_start\"")).map((line) => line.replaceAll("\\\\", "/").toLowerCase());
}
function audit(events, dir) {
	const calls = toolCalls(events);
	const own = [dir.replaceAll("\\", "/"), ...[task.skill, ...(task.deps ?? [])].filter(Boolean).map((rel) => `mattpocock-skills/skills/${rel}`)].map((s) => s.toLowerCase());
	return {
		skillRead: Boolean(task.skill) && calls.some((line) => line.includes(`${task.skill}/skill.md`)),
		outside: calls.filter((line) => /skills-lab|\/skl-/.test(line) && !own.some((p) => line.includes(p))).length,
	};
}

function check(dir) {
	return (task.checks ?? []).map((item) => {
		const copied = (item.hidden ?? []).map((file) => { const to = path.join(dir, item.to ?? "tests", path.basename(file)); cpSync(path.join(taskDir, file), to); return to; });
		const result = sh(dir, item.run);
		for (const file of copied) rmSync(file, { force: true });
		const output = `${result.stdout}${result.stderr}`.trim().split("\n");
		return { name: item.name, pass: result.status === 0, tail: output.slice(-3).join("\n").slice(-400) };
	});
}

async function one(arm, rep) {
	const id = `${taskName}-${arm}-${rep}`;
	// Artifacts (events, sessions, diff) under root; the workspace in its own temp folder, so a run cannot list sibling runs.
	const art = path.join(root, runName, id);
	if (existsSync(`${art}.diff`)) throw new Error(`${art} exists; pick a new run name or --rep-start`);
	const sessions = `${art}-sessions`;
	const dir = path.join(mkdtempSync(path.join(os.tmpdir(), "skl-")), path.basename(task.copy ?? task.source));
	const base = setup(dir);
	const prompt = task.prompt.replaceAll("{base}", base);
	const started = Date.now();
	const pi = args.includes("--no-pi") ? { code: null, timedOut: false, events: "" } : await runPi(dir, art, arm, prompt);
	const wallMs = Date.now() - started;
	git(dir, "add", "-A");
	writeFileSync(`${art}.diff`, git(dir, "diff", "--cached", base));
	const line = { t: new Date().toISOString(), run: runName, task: taskName, arm, rep, model, thinking: task.thinking ?? "high", pi: piVersion,
		exit: pi.code, timedOut: pi.timedOut, wallMs, ...audit(pi.events, dir), metrics: sessionMetrics(sessions),
		checks: check(dir), diffStat: git(dir, "diff", "--cached", "--shortstat", base), dir };
	appendFileSync(path.join(root, runName, "results.jsonl"), `${JSON.stringify(line)}\n`);
	console.log(id, JSON.stringify({ exit: line.exit, wallMs, turns: line.metrics.turns, cost: line.metrics.cost, checks: line.checks.map((c) => `${c.name}:${c.pass}`) }));
	return line;
}

const piVersion = execFileSync(process.execPath, [launcher, "--version"], { encoding: "utf8", env: piEnv }).trim();
mkdirSync(path.join(root, runName), { recursive: true });
const jobs = arms.flatMap((arm) => Array.from({ length: reps }, (_, i) => [arm, repStart + i]));
// Up to 5 runs at a time (R6), each in its own copy and session dir.
for (let i = 0; i < jobs.length; i += 5) await Promise.all(jobs.slice(i, i + 5).map(([arm, rep]) => one(arm, rep)));
