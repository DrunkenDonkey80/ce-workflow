#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { fingerprint } from "./workflow-evaluation-contract.mjs";
import { runRpcSample } from "./workflow-evaluation-rpc.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultSourceRoot = path.dirname(scriptRoot);
function command(cwd, executable, args) {
	const result = spawnSync(executable, args, { cwd, encoding: "utf8", timeout: 60_000, env: { ...process.env, BD_NON_INTERACTIVE: "1" } });
	if (result.status !== 0) throw new Error(`${executable} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
	return result.stdout.trim();
}

function readJson(file, label = file) {
	try { return JSON.parse(readFileSync(file, "utf8")); }
	catch (error) { throw new Error(`invalid ${label}: ${error instanceof Error ? error.message : String(error)}`); }
}

function initializeWorkspace(cwd) {
	command(cwd, "git", ["init", "--quiet"]);
	command(cwd, "git", ["config", "user.email", "workflow-evaluation@example.invalid"]);
	command(cwd, "git", ["config", "user.name", "Workflow Evaluation"]);
	command(cwd, "bd", ["init", "--non-interactive", "--stealth"]);
	command(cwd, "git", ["add", "-A"]);
	command(cwd, "git", ["commit", "--quiet", "-m", "seed"]);
}

function treeHash(root) {
	const hash = createHash("sha256");
	function visit(directory, relative = "") {
		for (const name of readdirSync(directory).sort()) {
			if (name === ".git" || name === ".beads") continue;
			const absolute = path.join(directory, name);
			const rel = path.join(relative, name).replaceAll("\\", "/");
			const stat = statSync(absolute);
			if (stat.isDirectory()) visit(absolute, rel);
			else hash.update(`${rel}\0`).update(readFileSync(absolute));
		}
	}
	visit(root);
	return hash.digest("hex");
}

function sourceState(root) {
	const status = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
	return { status: status.stdout, bundle: existsSync(path.join(root, "benchmarks", "workflow-evaluation", "v1")) ? treeHash(path.join(root, "benchmarks", "workflow-evaluation", "v1")) : null };
}

function sanitize(value, key = "") {
	if (/credential|api.?key|password|secret/i.test(key)) return "[redacted]";
	if (Array.isArray(value)) return value.map((item) => sanitize(item));
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([name]) => !/hiddenContract|productContract/i.test(name)).map(([name, nested]) => [name, sanitize(nested, name)]));
	if (typeof value === "string") return value.replaceAll(/product-contract\.md/gi, "[hidden-resource]");
	return value;
}

function appendLifecycle(file, state, details = {}) {
	appendFileSync(file, `${JSON.stringify({ state, at: new Date().toISOString(), ...details })}\n`);
}

function projectRoot(sourceRoot, project) { return path.join(sourceRoot, "benchmarks", "workflow-evaluation", "v1", "projects", project); }

function stageInput(stage) {
	if (stage === "brainstorm") return "request.txt";
	if (stage === "plan") return path.join("goldens", "brainstorm.md");
	if (stage === "work") return path.join("goldens", "plan.md");
	throw new Error(`unsupported stage: ${stage}`);
}

function provision({ sourceRoot, project, stage, side, pairIndex, runRoot, initialize }) {
	const workspaceRoot = mkdtempSync(path.join(runRoot, `${project}-${stage}-${side}-${pairIndex}-`));
	const projectDir = projectRoot(sourceRoot, project);
	if (stage === "work") cpSync(path.join(projectDir, "seed"), workspaceRoot, { recursive: true });
	else writeFileSync(path.join(workspaceRoot, ".gitkeep"), "");
	const input = stageInput(stage);
	const promptInput = readFileSync(path.join(projectDir, input), "utf8");
	initialize(workspaceRoot);
	return { workspaceRoot, projectDir, input, promptInput };
}

function passed(result, budgets) {
	if (result?.status !== "completed" || result.verifier?.passed === false) return false;
	const tokens = result.usage?.tokens?.total;
	if (!Number.isFinite(tokens)) return false;
	if (tokens > budgets.tokenCeiling) return false;
	if (Number.isFinite(result.wallMs) && result.wallMs > budgets.wallMsCeiling) return false;
	return true;
}

function disposition(attempts) {
	const baseline = attempts.find((attempt) => attempt.side === "baseline");
	const candidate = attempts.find((attempt) => attempt.side === "candidate");
	if (!baseline?.passed) return "invalid";
	if (!candidate?.passed) return "candidate-rejected";
	return "diagnostic-pass";
}

async function defaultRunSample(sample, descriptor, sourceRoot) {
	const side = descriptor[sample.side];
	const prompt = descriptor.prompt ?? `${sample.stage === "work" ? "/work-resume" : `/work-${sample.stage}`} ${sample.promptInput}`;
	const started = Date.now();
	const rpc = await runRpcSample({
		packageRoot: path.resolve(side.packageRoot ?? sourceRoot),
		revision: side.workflowRevision,
		expectedRevision: side.workflowRevision,
		tools: descriptor.tools,
		expectedTools: descriptor.tools,
		trusted: descriptor.trusted,
		isolation: descriptor.isolation,
		stage: sample.stage,
		prompt,
		answers: sample.answers,
		timeoutMs: descriptor.budgets.wallMsCeiling,
		workspaceRoot: sample.workspaceRoot,
		sourceRoot,
		bundleRoot: sample.projectDir,
		provider: side.provider,
		model: side.model,
	});
	return { ...rpc, wallMs: Date.now() - started, verifier: { passed: rpc.status === "completed" }, prompt };
}

export async function runSmokeExperiment(descriptor, seams = {}) {
	if (descriptor.mode !== "smoke") throw new Error("runSmokeExperiment requires smoke mode");
	const sourceRoot = path.resolve(seams.sourceRoot ?? defaultSourceRoot);
	const before = sourceState(sourceRoot);
	const evidenceRoot = seams.evidenceRoot ?? mkdtempSync(path.join(os.tmpdir(), "ce-workflow-evidence-"));
	const runId = `smoke-${Date.now()}-${randomUUID().slice(0, 8)}`;
	const controlRoot = path.join(evidenceRoot, runId);
	const runRoot = path.join(os.tmpdir(), `ce-workflow-samples-${runId}`);
	mkdirSync(controlRoot, { recursive: true });
	mkdirSync(runRoot, { recursive: true });
	const lifecycle = path.join(controlRoot, "lifecycle.jsonl");
	const attempts = [];
	const initialize = seams.initializeWorkspace ?? initializeWorkspace;
	try {
		for (const side of ["baseline", "candidate"]) {
			const sample = provision({ sourceRoot, project: descriptor.project, stage: descriptor.stage, side, pairIndex: 0, runRoot, initialize });
			appendLifecycle(lifecycle, "provisioned", { side, workspaceRoot: sample.workspaceRoot });
			const answers = readJson(path.join(sample.projectDir, "answers.json"), `${descriptor.project} answer bank`);
			appendLifecycle(lifecycle, "dispatched", { side });
			let result;
			try { result = await (seams.runSample ? seams.runSample({ ...sample, side, stage: descriptor.stage, answers }) : defaultRunSample({ ...sample, side, stage: descriptor.stage, answers }, descriptor, sourceRoot)); }
			catch (error) { result = { status: "failed", failure: "harness-error", error: error instanceof Error ? error.message : String(error) }; }
			const ok = passed(result, descriptor.budgets);
			attempts.push(sanitize({ side, pairIndex: 0, passed: ok, failure: ok ? null : result.failure ?? (result.status === "completed" ? "hard-gate" : result.status), result }));
			appendLifecycle(lifecycle, ok ? "verified" : "retained", { side, passed: ok });
			rmSync(sample.workspaceRoot, { recursive: true, force: true });
			appendLifecycle(lifecycle, "cleaned", { side });
		}
		const status = disposition(attempts);
		const evidence = sanitize({
			contract: "ce-workflow-evidence/v1",
			runId,
			mode: "smoke",
			decisionGrade: false,
			fingerprints: { descriptor: fingerprint(descriptor), source: before, sides: Object.fromEntries(attempts.map((item) => [item.side, fingerprint(descriptor[item.side])])) },
			declaredFactor: descriptor.factor,
			prompts: attempts.map((item) => item.result?.prompt).filter(Boolean),
			exchanges: attempts.flatMap((item) => item.result?.questions ?? []),
			artifacts: attempts.flatMap((item) => item.result?.artifacts ?? []),
			diffs: attempts.map((item) => item.result?.diff ?? ""),
			telemetry: attempts.map((item) => item.result?.telemetry ?? item.result?.usage ?? null),
			verifier: attempts.map((item) => item.result?.verifier ?? null),
			screenshots: attempts.flatMap((item) => item.result?.screenshots ?? []),
			attempts,
			disposition: status,
		});
		const evidencePath = path.join(controlRoot, "evidence.json");
		writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
		writeFileSync(path.join(controlRoot, "report.json"), `${JSON.stringify({ runId, mode: "smoke", decisionGrade: false, status, evidencePath }, null, 2)}\n`);
		const after = sourceState(sourceRoot);
		if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error("source checkout or benchmark bundle changed during comparison");
		return { runId, mode: "smoke", decisionGrade: false, status, attempts, evidencePath, reportPath: path.join(controlRoot, "report.json") };
	} finally {
		rmSync(runRoot, { recursive: true, force: true });
	}
}

function usage() {
	return "Usage: node scripts/workflow-evaluation.mjs <descriptor.json>\nModes: smoke (diagnostic), decision, calibration, golden-update, sentinel";
}

async function main() {
	if (process.argv.includes("--help") || !process.argv[2]) { console.log(usage()); return; }
	let descriptor;
	try { descriptor = readJson(path.resolve(process.argv[2]), "experiment descriptor"); }
	catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)}\n${usage()}`); }
	if (descriptor.mode !== "smoke") throw new Error(`mode ${descriptor.mode} is not implemented yet; smoke is diagnostic only`);
	console.log(JSON.stringify(await runSmokeExperiment(descriptor), null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
