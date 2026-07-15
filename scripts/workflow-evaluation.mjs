#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { fingerprint, validateExperimentPair } from "./workflow-evaluation-contract.mjs";
import { piInvocation, reconcileWorkflowTelemetry, runRpcSample } from "./workflow-evaluation-rpc.mjs";
import { blindArtifacts, evaluateDecision, validateEvaluatorResult } from "./workflow-evaluation-score.mjs";
import { verifyCsvProject } from "../benchmarks/workflow-evaluation/v1/projects/csv-expenses/acceptance/verify.mjs";
import { verifyCalculatorProject } from "../benchmarks/workflow-evaluation/v1/projects/calculator/acceptance/verify.mjs";

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

function quietCommand(cwd, executable, args, timeout = 120_000) {
	const result = spawnSync(executable, args, { cwd, stdio: "ignore", timeout, env: { ...process.env, BD_NON_INTERACTIVE: "1" } });
	if (result.status !== 0) throw new Error(`${executable} ${args.join(" ")} failed${result.error ? `: ${result.error.message}` : ""}`);
}

function beadsInvocation(args) {
	const script = path.join(process.env.APPDATA ?? "", "npm", "node_modules", "@beads", "bd", "bin", "bd.js");
	return process.platform === "win32" && existsSync(script) ? [process.execPath, [script, ...args]] : ["bd", args];
}

function initializeWorkspace(cwd) {
	command(cwd, "git", ["init", "--quiet"]);
	command(cwd, "git", ["config", "user.email", "workflow-evaluation@example.invalid"]);
	command(cwd, "git", ["config", "user.name", "Workflow Evaluation"]);
	const [bd, initArgs] = beadsInvocation(["init", "--non-interactive", "--stealth"]);
	quietCommand(cwd, bd, initArgs);
	command(cwd, "git", ["add", "-A"]);
	command(cwd, "git", ["commit", "--quiet", "-m", "seed"]);
}

function cleanupWorkspace(cwd) {
	if (existsSync(path.join(cwd, ".beads"))) {
		const [bd, stopArgs] = beadsInvocation(["dolt", "stop"]);
		spawnSync(bd, stopArgs, { cwd, stdio: "ignore", timeout: 30_000 });
		// ponytail: embedded bd can retain its Windows cwd handle briefly; remove this wait when bd releases it synchronously.
		if (process.platform === "win32") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3_000);
	}
	rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
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

function resolvedPair(descriptor) {
	const common = {
		project: descriptor.project,
		stage: descriptor.stage,
		bundleVersion: 1,
		role: descriptor.role ?? descriptor.stage,
		provider: descriptor.provider ?? "configured",
		model: descriptor.model ?? "configured",
		effort: descriptor.effort ?? "medium",
		evaluator: descriptor.evaluator ?? { provider: "configured", model: "configured" },
		runtime: { node: process.versions.node, platform: process.platform, arch: process.arch },
		dependencies: descriptor.dependencies ?? { package: "local" },
		browser: descriptor.browser ?? { status: "unavailable" },
		rubricVersion: 1,
		tools: descriptor.tools,
	};
	return {
		baseline: { ...common, ...descriptor.baseline },
		candidate: { ...common, ...descriptor.candidate },
	};
}

function validateDescriptor(descriptor) {
	const pair = resolvedPair(descriptor);
	return validateExperimentPair({ ...pair, factor: descriptor.factor, interaction: descriptor.interaction === true });
}

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

function workTelemetry(root) {
	const directory = path.join(root, ".pi", "work-runs");
	if (!existsSync(directory)) return [];
	const records = [];
	for (const name of readdirSync(directory)) {
		if (!name.endsWith(".jsonl")) continue;
		for (const line of readFileSync(path.join(directory, name), "utf8").split(/\r?\n/).filter(Boolean)) {
			try { records.push(JSON.parse(line)); }
			catch (error) { throw new Error(`malformed workflow telemetry: ${error instanceof Error ? error.message : String(error)}`); }
		}
	}
	return records;
}

async function defaultRunSample(sample, descriptor, sourceRoot) {
	const side = descriptor[sample.side];
	const commandName = sample.stage === "work" ? "work-resume" : `work-${sample.stage}`;
	const prompt = descriptor.prompt ?? `/${commandName} ${sample.promptInput}`;
	const prompts = sample.stage === "work" && !descriptor.prompt ? [`/work-migrate ${sample.promptInput}`, "/work-resume"] : [prompt];
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
		prompts,
		answers: sample.answers,
		timeoutMs: descriptor.budgets.wallMsCeiling,
		workspaceRoot: sample.workspaceRoot,
		sourceRoot,
		bundleRoot: sample.projectDir,
		provider: side.provider,
		model: side.model && side.effort ? `${side.model}:${side.effort}` : side.model,
	});
	const wallMs = Date.now() - started;
	const output = [...(rpc.events ?? [])].reverse().find((event) => event.type === "message_end" && event.message?.role === "assistant" && messageText(event.message))?.message;
	const outputText = messageText(output);
	let telemetry = null;
	let telemetryError = null;
	if (rpc.status === "completed") {
		try { telemetry = reconcileWorkflowTelemetry(workTelemetry(sample.workspaceRoot)); }
		catch (error) { telemetryError = error instanceof Error ? error.message : String(error); }
	}
	const gitStatus = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: sample.workspaceRoot, encoding: "utf8" }).stdout.split(/\r?\n/).filter((line) => line && !/^[? ][? ] \.pi\//.test(line));
	const usage = rpc.usage ?? {};
	const toolEvents = (rpc.events ?? []).filter((event) => event.type === "tool_execution_end");
	const metrics = {
		tokens: usage.tokens?.total,
		wallMs,
		toolCalls: usage.toolCalls,
		subagentCalls: (rpc.events ?? []).filter((event) => event.type === "tool_execution_start" && event.toolName === "subagent").length,
		toolOutputChars: toolEvents.reduce((sum, event) => sum + JSON.stringify(event.result ?? {}).length, 0),
		retries: (rpc.events ?? []).filter((event) => event.type === "auto_retry_start").length,
		contextTokens: usage.contextUsage?.tokens,
		questions: rpc.questions?.length ?? 0,
	};
	const verifier = { passed: rpc.status === "completed" && Boolean(outputText) && Boolean(telemetry) && gitStatus.length === 0, output: Boolean(outputText), telemetry: telemetryError ?? "complete", gitClean: gitStatus.length === 0 };
	return { ...rpc, wallMs, metrics, telemetry, artifacts: outputText ? [outputText] : [], output: outputText, diff: gitStatus.join("\n"), verifier, prompt, prompts };
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
	const [piCommand, piArgs] = piInvocation(args, descriptor.piCommand);
	const run = spawnSync(piCommand, piArgs, { input: JSON.stringify(blinded.evaluatorInput), encoding: "utf8", timeout: evaluator.timeoutMs ?? 900_000, maxBuffer: 16 * 1024 * 1024 });
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
	if (!descriptor.calibration) validateDescriptor(descriptor);
	const sourceRoot = path.resolve(seams.sourceRoot ?? defaultSourceRoot);
	if (!seams.skipApproval) validateGoldenApproval(projectRoot(sourceRoot, descriptor.project), readJson(path.join(projectRoot(sourceRoot, descriptor.project), "goldens", "approval.json"), `${descriptor.project} approval`));
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
					cleanupWorkspace(sample.workspaceRoot);
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

function projectBundleHash(root) {
	const hash = createHash("sha256");
	function visit(directory, relative = "") {
		for (const name of readdirSync(directory).sort()) {
			const absolute = path.join(directory, name);
			const rel = path.join(relative, name).replaceAll("\\", "/");
			if (rel === "goldens/approval.json") continue;
			const stat = statSync(absolute);
			if (stat.isDirectory()) visit(absolute, rel);
			else hash.update(`${rel}\0`).update(readFileSync(absolute));
		}
	}
	visit(root);
	return hash.digest("hex");
}

function fileSha(file) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }

export function buildGoldenApproval(projectDirectory, metadata = {}) {
	return {
		version: 1,
		approved: metadata.approved === true,
		approvedBy: metadata.approvedBy ?? null,
		approvedAt: metadata.approvedAt ?? null,
		bundleSha: projectBundleHash(projectDirectory),
		brainstormSha: fileSha(path.join(projectDirectory, "goldens", "brainstorm.md")),
		planSha: fileSha(path.join(projectDirectory, "goldens", "plan.md")),
		acceptancePassed: metadata.acceptancePassed === true,
		evidence: metadata.evidence ?? null,
	};
}

export function validateGoldenApproval(projectDirectory, approval) {
	if (!approval?.approved || !approval.approvedBy || !approval.approvedAt) throw new Error("human golden approval is required");
	if (!approval.acceptancePassed || !approval.evidence) throw new Error("golden acceptance evidence is required");
	const current = buildGoldenApproval(projectDirectory, approval);
	for (const field of ["bundleSha", "brainstormSha", "planSha"]) if (approval[field] !== current[field]) throw new Error(`golden approval is stale: ${field}`);
	return approval;
}

export function deriveCalibration(pairs) {
	if (!Array.isArray(pairs) || pairs.length !== 3) throw new Error("calibration requires three unchanged pairs");
	const values = (side, metric) => pairs.map((pair) => pair[side]?.[metric]);
	for (const side of ["baseline", "candidate"]) for (const metric of ["tokens", "wallMs"]) if (!values(side, metric).every(Number.isFinite)) throw new Error(`calibration ${metric} is incomplete`);
	const noise = pairs.flatMap((pair) => [Math.abs(pair.candidate.tokens - pair.baseline.tokens) / Math.max(1, pair.baseline.tokens), Math.abs(pair.candidate.wallMs - pair.baseline.wallMs) / Math.max(1, pair.baseline.wallMs)]);
	return {
		minimumImprovement: Math.max(0.05, ...noise),
		maximumDimensionRegression: Math.max(0.1, ...noise),
		tokenCeiling: Math.ceil(Math.max(...values("baseline", "tokens"), ...values("candidate", "tokens")) * 1.2),
		wallMsCeiling: Math.ceil(Math.max(...values("baseline", "wallMs"), ...values("candidate", "wallMs")) * 1.2),
	};
}

export function requiresSentinel(changedPaths, declaredChangeType = "") {
	if (/handoff|artifact|routing|finalization|default-behavior/.test(declaredChangeType)) return true;
	const knownNarrow = /^(README\.md|docs\/|scripts\/test-|benchmarks\/workflow-evaluation\/)/;
	return changedPaths.some((file) => /^(extensions\/work-models\.js|skills\/ce-(brainstorm|plan|work)\/|prompts\/work-|agents\/bead-)/.test(file.replaceAll("\\", "/")) || !knownNarrow.test(file.replaceAll("\\", "/")));
}

export async function runSentinelExperiment(descriptor, seams = {}) {
	if (descriptor.mode !== "sentinel") throw new Error("runSentinelExperiment requires sentinel mode");
	const sourceRoot = path.resolve(descriptor.sourceRoot ?? seams.sourceRoot ?? defaultSourceRoot);
	const before = sourceState(sourceRoot);
	const evidenceRoot = seams.evidenceRoot ?? mkdtempSync(path.join(os.tmpdir(), "ce-workflow-evidence-"));
	const runId = `sentinel-${Date.now()}-${randomUUID().slice(0, 8)}`;
	const controlRoot = path.join(evidenceRoot, runId);
	const runRoot = path.join(os.tmpdir(), `ce-workflow-samples-${runId}`);
	mkdirSync(controlRoot, { recursive: true });
	mkdirSync(runRoot, { recursive: true });
	const results = [];
	const runStage = seams.runStage ?? (async ({ side, stage, input, workspaceRoot, projectDir }) => {
		const answers = readJson(path.join(projectDir, "answers.json"), `${path.basename(projectDir)} answer bank`);
		const result = await defaultRunSample({ side, stage, promptInput: input, workspaceRoot, projectDir, answers }, descriptor, sourceRoot);
		return { ...result, artifact: result.output };
	});
	const verifyProject = seams.verifyProject ?? (async ({ project, workspaceRoot }) => {
		if (project === "csv-expenses") return verifyCsvProject(workspaceRoot);
		return verifyCalculatorProject(workspaceRoot, null);
	});
	try {
		for (const project of descriptor.projects ?? ["calculator", "csv-expenses"]) {
			const projectDir = projectRoot(sourceRoot, project);
			if (!seams.skipApproval) validateGoldenApproval(projectDir, readJson(path.join(projectDir, "goldens", "approval.json"), `${project} approval`));
			for (const side of descriptor.sides ?? ["baseline", "candidate"]) {
				const workspaceRoot = mkdtempSync(path.join(runRoot, `${project}-${side}-`));
				cpSync(path.join(projectDir, "seed"), workspaceRoot, { recursive: true });
				(seams.initializeWorkspace ?? initializeWorkspace)(workspaceRoot);
				const projectResult = { project, side, stages: [], acceptance: null };
				let input = readFileSync(path.join(projectDir, "request.txt"), "utf8");
				let inputSource = "original-request";
				for (const stage of ["brainstorm", "plan", "work"]) {
					let stageResult;
					try { stageResult = await runStage({ project, side, stage, input, inputSource, workspaceRoot, projectDir }); }
					catch (error) { stageResult = { status: "failed", failure: "harness-error", error: error instanceof Error ? error.message : String(error) }; }
					if (!stageResult) stageResult = { status: "failed", failure: "live-stage-adapter-unavailable" };
					projectResult.stages.push(sanitize({ stage, inputSource, inputSha: fingerprint(input), ...stageResult }));
					if (stageResult.status !== "completed" || stageResult.verifier?.passed === false || stageResult.usedGolden) break;
					input = String(stageResult.artifact ?? "");
					inputSource = `actual:${stage}`;
				}
				if (projectResult.stages.length === 3 && projectResult.stages.every((stage) => stage.status === "completed" && stage.verifier?.passed !== false)) projectResult.acceptance = await verifyProject({ project, side, workspaceRoot, projectDir });
				results.push(projectResult);
				cleanupWorkspace(workspaceRoot);
			}
		}
		const status = results.every((project) => project.stages.length === 3 && project.stages.every((stage) => stage.status === "completed" && stage.verifier?.passed !== false && !stage.usedGolden) && project.acceptance?.passed) ? "passed" : "failed";
		const evidencePath = path.join(controlRoot, "evidence.json");
		writeFileSync(evidencePath, `${JSON.stringify(sanitize({ contract: "ce-workflow-evidence/v1", runId, mode: "sentinel", status, projects: results, source: before }), null, 2)}\n`);
		if (JSON.stringify(sourceState(sourceRoot)) !== JSON.stringify(before)) throw new Error("source checkout or benchmark bundle changed during sentinel");
		return { runId, mode: "sentinel", status, projects: results, evidencePath };
	} finally { rmSync(runRoot, { recursive: true, force: true }); }
}

export async function runCalibrationExperiment(descriptor, seams = {}) {
	if (descriptor.mode !== "calibration") throw new Error("runCalibrationExperiment requires calibration mode");
	const decision = await runDecisionExperiment({ ...descriptor, mode: "decision", factor: "unchanged-calibration", calibration: true }, seams);
	if (!decision.verdict?.pairs || decision.verdict.pairs.length !== 3) return { ...decision, mode: "calibration", status: "invalid-calibration" };
	const pairs = decision.verdict.pairs.map((pair) => {
		const attempt = pair.attempts[pair.selectedAttempt];
		return { baseline: { tokens: attempt.baseline.metrics.tokens, wallMs: attempt.baseline.metrics.wallMs }, candidate: { tokens: attempt.candidate.metrics.tokens, wallMs: attempt.candidate.metrics.wallMs } };
	});
	const calibration = deriveCalibration(pairs);
	const calibrationPath = path.join(path.dirname(decision.evidencePath), "calibration.json");
	writeFileSync(calibrationPath, `${JSON.stringify({ project: descriptor.project, stage: descriptor.stage, generatedAt: new Date().toISOString(), ...calibration }, null, 2)}\n`);
	return { ...decision, mode: "calibration", status: "calibrated", calibration, calibrationPath };
}

export function runGoldenUpdate(descriptor, seams = {}) {
	if (descriptor.mode !== "golden-update") throw new Error("runGoldenUpdate requires golden-update mode");
	const sourceRoot = path.resolve(seams.sourceRoot ?? defaultSourceRoot);
	const projectDir = projectRoot(sourceRoot, descriptor.project);
	const approvalFile = path.join(projectDir, "goldens", "approval.json");
	const before = existsSync(approvalFile) ? readJson(approvalFile, `${descriptor.project} prior approval`) : null;
	if (descriptor.contractChanged && !descriptor.humanApproved) throw new Error("contract changes require explicit human approval before mutation");
	if (descriptor.contractChanged) {
		const projectFile = path.join(projectDir, "project.json");
		const project = readJson(projectFile, `${descriptor.project} project`);
		writeFileSync(projectFile, `${JSON.stringify({ ...project, version: Number(project.version ?? 0) + 1 }, null, 2)}\n`);
	}
	const next = buildGoldenApproval(projectDir, {
		approved: descriptor.humanApproved === true,
		approvedBy: descriptor.approvedBy,
		approvedAt: descriptor.approvedAt ?? (descriptor.humanApproved ? new Date().toISOString() : null),
		acceptancePassed: descriptor.acceptancePassed === true,
		evidence: descriptor.acceptanceEvidence,
	});
	const evidenceRoot = seams.evidenceRoot ?? mkdtempSync(path.join(os.tmpdir(), "ce-workflow-evidence-"));
	const updateRoot = path.join(evidenceRoot, `golden-update-${Date.now()}-${randomUUID().slice(0, 8)}`);
	mkdirSync(updateRoot, { recursive: true });
	const evidencePath = path.join(updateRoot, "evidence.json");
	writeFileSync(evidencePath, `${JSON.stringify({ project: descriptor.project, before, after: next, contractChanged: Boolean(descriptor.contractChanged) }, null, 2)}\n`);
	if (!descriptor.humanApproved) return { mode: "golden-update", status: "pending-human-approval", candidate: next, evidencePath };
	validateGoldenApproval(projectDir, next);
	writeFileSync(approvalFile, `${JSON.stringify(next, null, 2)}\n`);
	return { mode: "golden-update", status: "approved", approvalPath: approvalFile, evidencePath };
}

export async function runSmokeExperiment(descriptor, seams = {}) {
	if (descriptor.mode !== "smoke") throw new Error("runSmokeExperiment requires smoke mode");
	validateDescriptor(descriptor);
	const sourceRoot = path.resolve(seams.sourceRoot ?? defaultSourceRoot);
	if (["plan", "work"].includes(descriptor.stage) && !seams.skipApproval) validateGoldenApproval(projectRoot(sourceRoot, descriptor.project), readJson(path.join(projectRoot(sourceRoot, descriptor.project), "goldens", "approval.json"), `${descriptor.project} approval`));
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
			let failure = null;
			if (!ok) {
				failure = result.failure;
				if (!failure) failure = result.status === "completed" ? "hard-gate" : result.status;
			}
			attempts.push(sanitize({ side, pairIndex: 0, passed: ok, failure, result }));
			appendLifecycle(lifecycle, ok ? "verified" : "retained", { side, passed: ok });
			cleanupWorkspace(sample.workspaceRoot);
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
	return [
		"Usage: node scripts/workflow-evaluation.mjs <descriptor.json>",
		"Modes: smoke (one pair, diagnostic only), decision (three approved pairs), calibration (three unchanged pairs), golden-update, sentinel.",
		"Decision/sentinel require fresh SHA-bound human approvals and calibration. Missing credentials, evaluator, browser, provenance, metrics, or approvals fail closed.",
		"Reports and retained evidence are written under the printed operating-system temporary path; disposable workspaces are removed.",
	].join("\n");
}

async function main() {
	if (process.argv.includes("--help") || !process.argv[2]) { console.log(usage()); return; }
	let descriptor;
	try { descriptor = readJson(path.resolve(process.argv[2]), "experiment descriptor"); }
	catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)}\n${usage()}`); }
	if (descriptor.mode === "smoke") console.log(JSON.stringify(await runSmokeExperiment(descriptor), null, 2));
	else if (descriptor.mode === "decision") console.log(JSON.stringify(await runDecisionExperiment(descriptor), null, 2));
	else if (descriptor.mode === "calibration") console.log(JSON.stringify(await runCalibrationExperiment(descriptor), null, 2));
	else if (descriptor.mode === "golden-update") console.log(JSON.stringify(runGoldenUpdate(descriptor), null, 2));
	else if (descriptor.mode === "sentinel") console.log(JSON.stringify(await runSentinelExperiment(descriptor), null, 2));
	else throw new Error(`unsupported mode ${descriptor.mode}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
