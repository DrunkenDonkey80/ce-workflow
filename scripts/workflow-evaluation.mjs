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
import { blindArtifacts, evaluateDecision, validateEvaluatorResult } from "./workflow-evaluation-score.mjs";

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

function messageText(message) {
	return (message?.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
}

function parseJsonObject(text, label) {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) throw new Error(`${label} did not return JSON`);
	try { return JSON.parse(text.slice(start, end + 1)); }
	catch (error) { throw new Error(`invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

function defaultEvaluatePair(baselineArtifact, candidateArtifact, rubric, descriptor) {
	const blinded = blindArtifacts(baselineArtifact, candidateArtifact, rubric);
	const system = readFileSync(path.join(descriptor.sourceRoot ?? defaultSourceRoot, "agents", "workflow-evaluator.md"), "utf8");
	const evaluator = descriptor.evaluator ?? {};
	const args = ["--mode", "json", "--print", "--no-session", "--offline", "--no-tools", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--system-prompt", system];
	if (evaluator.provider) args.push("--provider", evaluator.provider);
	if (evaluator.model) args.push("--model", evaluator.model);
	const started = Date.now();
	const run = spawnSync(descriptor.piCommand ?? "pi", args, { input: JSON.stringify(blinded.evaluatorInput), encoding: "utf8", timeout: evaluator.timeoutMs ?? 900_000, maxBuffer: 16 * 1024 * 1024 });
	if (run.status !== 0) throw new Error(`evaluator failed: ${run.stderr || run.stdout}`);
	const events = run.stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
	const assistant = events.filter((event) => event.type === "message_end" && event.message?.role === "assistant").at(-1)?.message;
	const result = parseJsonObject(messageText(assistant), "evaluator");
	const dimensions = rubric.stageDimensions?.[descriptor.stage] ?? rubric.criticalDimensions;
	validateEvaluatorResult(result, dimensions, rubric);
	const scores = Object.fromEntries(Object.entries(blinded.control.mapping).map(([label, side]) => [side, result[label]]));
	return { scores, control: blinded.control, evaluator: { provider: evaluator.provider, model: evaluator.model, wallMs: Date.now() - started, usage: assistant?.usage ?? null } };
}

function decisionSample(result, scores, budgets) {
	const usage = result.usage ?? {};
	const metrics = result.metrics ?? {
		tokens: usage.tokens?.total,
		wallMs: result.wallMs,
		toolCalls: usage.toolCalls,
		subagentCalls: result.telemetry?.subagentCalls,
		toolOutputChars: result.telemetry?.toolOutputChars,
		retries: result.telemetry?.retries,
		contextTokens: usage.contextUsage?.tokens,
		questions: result.questions?.length,
	};
	return { hard: { passed: passed(result, budgets) }, metrics, scores, unexpectedQuestions: (result.questions ?? []).filter((item) => item.expected === false).length };
}

function infrastructureFailure(results) {
	const failures = results.map((result) => result.failure).filter(Boolean);
	return failures.find((failure) => /timeout|rate-limit|provider|process-error|browser-unavailable/.test(failure)) ?? null;
}

export async function runDecisionExperiment(descriptor, seams = {}) {
	if (descriptor.mode !== "decision") throw new Error("runDecisionExperiment requires decision mode");
	const sourceRoot = path.resolve(seams.sourceRoot ?? defaultSourceRoot);
	const before = sourceState(sourceRoot);
	const evidenceRoot = seams.evidenceRoot ?? mkdtempSync(path.join(os.tmpdir(), "ce-workflow-evidence-"));
	const runId = `decision-${Date.now()}-${randomUUID().slice(0, 8)}`;
	const controlRoot = path.join(evidenceRoot, runId);
	const runRoot = path.join(os.tmpdir(), `ce-workflow-samples-${runId}`);
	mkdirSync(controlRoot, { recursive: true });
	mkdirSync(runRoot, { recursive: true });
	const lifecycle = path.join(controlRoot, "lifecycle.jsonl");
	const initialize = seams.initializeWorkspace ?? initializeWorkspace;
	const fullRubric = readJson(path.join(projectRoot(sourceRoot, descriptor.project), "rubric.json"), `${descriptor.project} rubric`);
	const dimensions = fullRubric.stageDimensions?.[descriptor.stage] ?? fullRubric.criticalDimensions;
	const rubric = { ...fullRubric, dimensions, criticalDimensions: fullRubric.criticalDimensions.filter((dimension) => dimensions.includes(dimension)) };
	const pairs = [];
	const evaluatorEvidence = [];
	const evaluatorControl = [];
	try {
		for (let pairIndex = 0; pairIndex < 3; pairIndex += 1) {
			const order = pairIndex % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
			const attempts = [];
			for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
				const raw = {};
				for (const side of order) {
					const sample = provision({ sourceRoot, project: descriptor.project, stage: descriptor.stage, side, pairIndex, runRoot, initialize });
					const answers = readJson(path.join(sample.projectDir, "answers.json"), `${descriptor.project} answer bank`);
					appendLifecycle(lifecycle, "dispatched", { pairIndex, attemptIndex, side });
					try { raw[side] = await (seams.runSample ? seams.runSample({ ...sample, side, stage: descriptor.stage, pairIndex, attemptIndex, answers }) : defaultRunSample({ ...sample, side, stage: descriptor.stage, answers }, descriptor, sourceRoot)); }
					catch (error) { raw[side] = { status: "failed", failure: "harness-error", error: error instanceof Error ? error.message : String(error) }; }
					rmSync(sample.workspaceRoot, { recursive: true, force: true });
				}
				const infra = infrastructureFailure(Object.values(raw));
				if (infra) {
					attempts.push({ infrastructureFailure: infra, baseline: decisionSample(raw.baseline, {}, descriptor.budgets), candidate: decisionSample(raw.candidate, {}, descriptor.budgets), raw: sanitize(raw) });
					if (attemptIndex === 0) continue;
					break;
				}
				let evaluation;
				try {
					evaluation = await (seams.evaluatePair ? seams.evaluatePair(raw.baseline, raw.candidate, rubric, { pairIndex, attemptIndex }) : defaultEvaluatePair(raw.baseline.artifacts ?? raw.baseline.output ?? "", raw.candidate.artifacts ?? raw.candidate.output ?? "", rubric, { ...descriptor, sourceRoot }));
				} catch (error) {
					attempts.push({ evaluatorFailure: error instanceof Error ? error.message : String(error), baseline: decisionSample(raw.baseline, {}, descriptor.budgets), candidate: decisionSample(raw.candidate, {}, descriptor.budgets), raw: sanitize(raw) });
					break;
				}
				evaluatorEvidence.push(evaluation.evaluator ?? {});
				evaluatorControl.push({ pairIndex, attemptIndex, ...evaluation.control });
				attempts.push({ baseline: decisionSample(raw.baseline, evaluation.scores.baseline, descriptor.budgets), candidate: decisionSample(raw.candidate, evaluation.scores.candidate, descriptor.budgets), raw: sanitize(raw) });
				break;
			}
			pairs.push({ pairIndex, order, attempts });
		}
		const verdict = evaluateDecision(pairs, rubric, { primaryMetric: descriptor.primaryMetric, minimumImprovement: descriptor.minimumImprovement });
		const evidence = sanitize({ contract: "ce-workflow-evidence/v1", runId, mode: "decision", decisionGrade: true, fingerprints: { descriptor: fingerprint(descriptor), source: before }, declaredFactor: descriptor.factor, pairs, evaluator: evaluatorEvidence, verdict });
		const evidencePath = path.join(controlRoot, "evidence.json");
		writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
		writeFileSync(path.join(controlRoot, "evaluator-control.json"), `${JSON.stringify(evaluatorControl, null, 2)}\n`);
		const reportPath = path.join(controlRoot, "report.json");
		writeFileSync(reportPath, `${JSON.stringify({ runId, mode: "decision", status: verdict.status, evidencePath, verdict }, null, 2)}\n`);
		if (JSON.stringify(sourceState(sourceRoot)) !== JSON.stringify(before)) throw new Error("source checkout or benchmark bundle changed during comparison");
		return { runId, mode: "decision", status: verdict.status, verdict, evidencePath, reportPath };
	} finally { rmSync(runRoot, { recursive: true, force: true }); }
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
	if (descriptor.mode === "smoke") console.log(JSON.stringify(await runSmokeExperiment(descriptor), null, 2));
	else if (descriptor.mode === "decision") console.log(JSON.stringify(await runDecisionExperiment(descriptor), null, 2));
	else throw new Error(`mode ${descriptor.mode} is not implemented yet`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
