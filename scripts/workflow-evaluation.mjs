#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	appendFileSync,
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
	fingerprint,
	validateExperimentPair,
} from "./workflow-evaluation-contract.mjs";
import {
	classifyInfrastructureFailure,
	piInvocation,
	reconcileAgentLedger,
	reconcileWorkflowTelemetry,
	runRpcSample,
} from "./workflow-evaluation-rpc.mjs";
import {
	blindArtifacts,
	evaluateDecision,
	validateEvaluatorResult,
} from "./workflow-evaluation-score.mjs";
import { verifyCsvProject } from "../benchmarks/workflow-evaluation/v1/projects/csv-expenses/acceptance/verify.mjs";
import { verifyCalculatorProject } from "../benchmarks/workflow-evaluation/v1/projects/calculator/acceptance/verify.mjs";
import { initStore, loadStore } from "../extensions/work-store.js";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultSourceRoot = path.dirname(scriptRoot);
function command(cwd, executable, args) {
	const result = spawnSync(executable, args, {
		cwd,
		encoding: "utf8",
		timeout: 60_000,
		env: { ...process.env, BD_NON_INTERACTIVE: "1" },
	});
	if (result.status !== 0)
		throw new Error(
			`${executable} ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
		);
	return result.stdout.trim();
}

function readJson(file, label = file) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(
			`invalid ${label}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function requireRoleCase(value, message) {
	if (!value) throw new Error(message);
}

export function visibleRoleCase(corpus, role, partition) {
	const roleDefinition = corpus.roles?.find((item) => item.role === role);
	const partitionDefinition = corpus.partitions?.[partition];
	requireRoleCase(roleDefinition, `unknown role case: ${role}`);
	requireRoleCase(partitionDefinition, `unknown role partition: ${partition}`);
	return {
		contract: "ce-workflow-role-case/v1",
		campaignRevision: corpus.campaignRevision,
		project: corpus.project,
		arm: `${role}:${partition}`,
		role: roleDefinition,
		partition,
		input: partitionDefinition.visible,
		freeze: corpus.freeze,
	};
}

export function critiqueEnvelope(arm, findings = []) {
	const envelope = {
		schema: "critique-envelope/v1",
		arm,
		kind: findings.length ? "critique" : "empty",
		findings,
	};
	return { ...envelope, signature: fingerprint(envelope) };
}

export function verifyRoleCaseOutput(corpus, partition, output) {
	const authority = corpus.partitions?.[partition]?.authority;
	requireRoleCase(authority, `missing authority partition: ${partition}`);
	const text = String(output ?? "");
	return {
		passed:
			(authority.mustInclude ?? []).every((value) => text.includes(value)) &&
			(authority.mustExclude ?? []).every((value) => !text.includes(value)),
	};
}

export function replayCritiqueCase(corpus, role, partition, run) {
	const visible = visibleRoleCase(corpus, role, partition);
	const expectedFingerprint = fingerprint(visible);
	requireRoleCase(
		run.targetArm === visible.arm,
		"critique delivered to wrong arm",
	);
	requireRoleCase(
		run.visibleFingerprint === expectedFingerprint,
		"visible role case bytes changed in transit",
	);
	requireRoleCase(
		run.deliveredAtMs === corpus.freeze.deliveryAtMs,
		"critique delivery timing changed",
	);
	requireRoleCase(
		run.reviserId === corpus.freeze.reviser.id,
		"fixed reviser identity changed",
	);
	const envelope = run.envelope;
	requireRoleCase(
		envelope?.signature ===
			fingerprint({
				schema: envelope.schema,
				arm: envelope.arm,
				kind: envelope.kind,
				findings: envelope.findings,
			}),
		"critique envelope signature mismatch",
	);
	requireRoleCase(
		envelope.arm === visible.arm,
		"critique envelope arm mismatch",
	);
	requireRoleCase(
		(envelope.findings.length === 0) === (envelope.kind === "empty"),
		"empty critique control schema mismatch",
	);
	const eventIds = new Set();
	for (const event of run.events ?? []) {
		requireRoleCase(
			event.id && !eventIds.has(event.id),
			"duplicate critique event",
		);
		eventIds.add(event.id);
	}
	const consumed = (run.events ?? []).some(
		(event) => event.type === "critique-consumed",
	);
	const findingIds = envelope.findings.map((finding) => finding.id);
	requireRoleCase(
		new Set(findingIds).size === findingIds.length,
		"duplicate critique finding",
	);
	const accepted = new Set(
		(run.events ?? [])
			.filter((event) => event.type === "finding-accepted")
			.map((event) => event.findingId),
	);
	const applied = new Set(
		(run.events ?? [])
			.filter((event) => event.type === "finding-applied")
			.map((event) => event.findingId),
	);
	for (const findingId of [...accepted, ...applied])
		requireRoleCase(
			findingIds.includes(findingId),
			`unknown critique finding: ${findingId}`,
		);
	const verified = (run.events ?? []).some(
		(event) => event.type === "revision-verified" && event.passed === true,
	);
	const regressed = (run.events ?? []).some(
		(event) => event.type === "regression-detected",
	);
	const creditedFindings = findingIds.filter(
		(findingId) => accepted.has(findingId) && applied.has(findingId),
	);
	return {
		visibleFingerprint: expectedFingerprint,
		replayFingerprint: fingerprint({ visible, envelope, events: run.events }),
		cost: run.cost ?? { tokens: 0, wallMs: 0 },
		consumed,
		creditedFindings,
		verified,
		regressed,
		credit:
			envelope.kind === "critique" &&
			consumed &&
			creditedFindings.length > 0 &&
			verified &&
			!regressed,
	};
}

function initializeWorkspace(cwd) {
	command(cwd, "git", ["init", "--quiet"]);
	command(cwd, "git", [
		"config",
		"user.email",
		"workflow-evaluation@example.invalid",
	]);
	command(cwd, "git", ["config", "user.name", "Workflow Evaluation"]);
	initStore(cwd);
	command(cwd, "git", ["add", "-A"]);
	command(cwd, "git", ["commit", "--quiet", "-m", "seed"]);
}

export function recoverStaleWorkspaces(
	tempRoot = os.tmpdir(),
	maxAgeMs = 24 * 60 * 60 * 1000,
	now = Date.now(),
) {
	const removed = [];
	for (const name of readdirSync(tempRoot).filter((entry) =>
		entry.startsWith("ce-workflow-samples-"),
	)) {
		const directory = path.join(tempRoot, name);
		const leaseFile = path.join(directory, ".active.json");
		let lease = null;
		try {
			lease = JSON.parse(readFileSync(leaseFile, "utf8"));
		} catch {}
		const age = now - Number(lease?.startedAt ?? statSync(directory).mtimeMs);
		let alive = false;
		if (Number.isInteger(lease?.pid)) {
			try {
				process.kill(lease.pid, 0);
				alive = true;
			} catch {}
		}
		if (age > maxAgeMs && !alive) {
			rmSync(directory, {
				recursive: true,
				force: true,
				maxRetries: 10,
				retryDelay: 250,
			});
			removed.push(directory);
		}
	}
	return removed;
}

function markRunRoot(runRoot) {
	recoverStaleWorkspaces(path.dirname(runRoot));
	mkdirSync(runRoot, { recursive: true });
	writeFileSync(
		path.join(runRoot, ".active.json"),
		`${JSON.stringify({ pid: process.pid, startedAt: Date.now() })}\n`,
	);
}

function cleanupWorkspace(cwd) {
	rmSync(cwd, {
		recursive: true,
		force: true,
		maxRetries: 10,
		retryDelay: 250,
	});
}

function writeEvidenceManifest(root, manifest) {
	const file = path.join(root, "evidence-manifest.json");
	writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, {
		mode: 0o600,
	});
	if (process.platform !== "win32") chmodSync(file, 0o600);
	return manifest;
}

export function prepareEvidenceStore(root, now = Date.now()) {
	mkdirSync(root, { recursive: true, mode: 0o700 });
	const authorityRoot = path.join(root, "authority");
	mkdirSync(authorityRoot, { recursive: true, mode: 0o700 });
	if (process.platform !== "win32") {
		chmodSync(root, 0o700);
		chmodSync(authorityRoot, 0o700);
	}
	return writeEvidenceManifest(root, {
		version: 1,
		visibility: "authority-only",
		authorityRoot: "authority",
		createdAt: new Date(now).toISOString(),
		expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
		durableAt: null,
		rawDeletedAt: null,
		hashes: {},
		rawFiles: [],
	});
}

function evidenceRawFiles(root) {
	const files = [];
	function visit(directory) {
		for (const name of readdirSync(directory)) {
			const file = path.join(directory, name);
			const relative = path.relative(root, file);
			if (
				relative === "authority" ||
				relative.startsWith(`authority${path.sep}`)
			)
				continue;
			if (["evidence-manifest.json", "report.json"].includes(relative))
				continue;
			if (statSync(file).isDirectory()) visit(file);
			else files.push(relative);
		}
	}
	visit(root);
	return files;
}

export function finalizeEvidenceStore(
	root,
	rawFiles = evidenceRawFiles(root),
	now = Date.now(),
) {
	const manifest = readJson(
		path.join(root, "evidence-manifest.json"),
		"evidence manifest",
	);
	manifest.rawFiles = [...new Set(rawFiles)].sort();
	manifest.hashes = Object.fromEntries(
		manifest.rawFiles.map((relative) => {
			const file = path.resolve(root, relative);
			if (
				!file.startsWith(`${path.resolve(root)}${path.sep}`) ||
				!existsSync(file)
			)
				throw new Error(`invalid raw evidence path: ${relative}`);
			return [relative.replaceAll("\\", "/"), fileSha(file)];
		}),
	);
	manifest.durableAt = new Date(now).toISOString();
	return writeEvidenceManifest(root, manifest);
}

export function expireEvidenceStore(root, now = Date.now()) {
	const manifest = readJson(
		path.join(root, "evidence-manifest.json"),
		"evidence manifest",
	);
	if (now < Date.parse(manifest.expiresAt)) return false;
	if (!manifest.durableAt)
		throw new Error("raw evidence cannot expire before durability");
	for (const relative of manifest.rawFiles) {
		const file = path.resolve(root, relative);
		if (!file.startsWith(`${path.resolve(root)}${path.sep}`))
			throw new Error(`invalid raw evidence path: ${relative}`);
		rmSync(file, { force: true, recursive: true });
	}
	manifest.rawDeletedAt = new Date(now).toISOString();
	writeEvidenceManifest(root, manifest);
	return true;
}

function hashTree(root, exclude = () => false) {
	const hash = createHash("sha256");
	function visit(directory, relative = "") {
		for (const name of readdirSync(directory).sort()) {
			const absolute = path.join(directory, name);
			const rel = path.join(relative, name).replaceAll("\\", "/");
			if (exclude(rel, name)) continue;
			const stat = statSync(absolute);
			if (stat.isDirectory()) visit(absolute, rel);
			else hash.update(`${rel}\0`).update(readFileSync(absolute));
		}
	}
	visit(root);
	return hash.digest("hex");
}

function treeHash(root) {
	return hashTree(
		root,
		(_relative, name) => name === ".git" || name === ".ce-workflow",
	);
}

function sourceState(root) {
	const status = spawnSync(
		"git",
		["status", "--porcelain=v1", "--untracked-files=all"],
		{ cwd: root, encoding: "utf8" },
	);
	const listed = spawnSync(
		"git",
		["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
		{ cwd: root },
	);
	if (status.status !== 0 || listed.status !== 0)
		throw new Error("cannot fingerprint source checkout");
	const hash = createHash("sha256");
	for (const relative of listed.stdout
		.toString()
		.split("\0")
		.filter(Boolean)
		.sort()) {
		const file = path.join(root, relative);
		if (existsSync(file) && statSync(file).isFile())
			hash
				.update(`${relative.replaceAll("\\", "/")}\0`)
				.update(readFileSync(file));
	}
	return {
		status: status.stdout,
		files: hash.digest("hex"),
		bundle: existsSync(
			path.join(root, "benchmarks", "workflow-evaluation", "v1"),
		)
			? treeHash(path.join(root, "benchmarks", "workflow-evaluation", "v1"))
			: null,
	};
}

function sanitize(value, key = "") {
	if (/credential|api.?key|password|secret/i.test(key)) return "[redacted]";
	if (Array.isArray(value)) {
		const items = value.slice(0, 2_000).map((item) => sanitize(item));
		if (value.length > items.length)
			items.push({ truncatedItems: value.length - items.length });
		return items;
	}
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.filter(([name]) => !/hiddenContract|productContract/i.test(name))
				.map(([name, nested]) => [name, sanitize(nested, name)]),
		);
	if (typeof value === "string") {
		const redacted = value
			.replaceAll(/product-contract\.md/gi, "[hidden-resource]")
			.replaceAll(
				/(?:goldens[\\/](?:brainstorm|plan)\.md|answers\.json)/gi,
				"[authority-resource]",
			)
			.replace(
				/\b(?:sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/-]{16,}|AKIA[A-Z0-9]{16})\b/g,
				"[redacted]",
			);
		return redacted.length > 65_536
			? `${redacted.slice(0, 65_536)}\n[truncated ${redacted.length - 65_536} chars]`
			: redacted;
	}
	return value;
}

function appendLifecycle(file, state, details = {}) {
	appendFileSync(
		file,
		`${JSON.stringify({ state, at: new Date().toISOString(), ...details })}\n`,
	);
}

function appendResultLifecycle(file, details, result) {
	for (const question of result.questions ?? []) {
		appendLifecycle(file, "awaiting_scripted_answer", {
			...details,
			questionId: question.id,
		});
		appendLifecycle(file, "running", details);
	}
	let terminal = "failed";
	if (result.status === "completed") terminal = "completed";
	else if (result.failure === "timeout" || result.status === "timed_out")
		terminal = "timed_out";
	appendLifecycle(file, terminal, { ...details, failure: result.failure });
	const verified =
		details.passed ??
		(result.status === "completed" && result.verifier?.passed !== false);
	appendLifecycle(file, verified ? "verified" : "retained", details);
}

function projectRoot(sourceRoot, project) {
	return path.join(
		sourceRoot,
		"benchmarks",
		"workflow-evaluation",
		"v1",
		"projects",
		project,
	);
}

function dependencyRoots(descriptor) {
	if (descriptor.dependencyPackages)
		return descriptor.dependencyPackages.map((root) => path.resolve(root));
	return ["pi-compound-engineering", "pi-subagents", "pi-ask-user"]
		.map((name) =>
			path.join(os.homedir(), ".pi", "agent", "npm", "node_modules", name),
		)
		.filter(existsSync);
}

function requiredStageResources(stage) {
	if (stage === "brainstorm") return ["skill:ce-brainstorm"];
	if (stage === "plan") return ["skill:ce-plan"];
	return ["skill:work-orchestrator"];
}

export function buildEvaluationSettings(
	side,
	ambientSettings,
	credentialCanary,
) {
	if (!side.roleMap) return ambientSettings ?? null;
	if (ambientSettings && Object.keys(ambientSettings).length > 0)
		throw new Error("ambient settings are invalid for a canonical role map");
	const main = side.roleMap.main;
	const settings = {
		defaultProvider: main.provider,
		defaultModel: main.model,
		defaultThinkingLevel: main.effort,
		...(main.context && typeof main.context === "object" ? main.context : {}),
		subagents: {
			agentOverrides: Object.fromEntries(
				Object.entries(side.roleMap)
					.filter(([role]) => role !== "main")
					.map(([role, cell]) => [
						role,
						{ model: `${cell.provider}/${cell.model}`, thinking: cell.effort },
					]),
			),
		},
	};
	if (credentialCanary && JSON.stringify(settings).includes(credentialCanary))
		throw new Error("credential canary reached serialized settings");
	return settings;
}

export function writeEvaluationSettings(
	workspaceRoot,
	side,
	ambientSettings,
	credentialCanary,
) {
	const settings = buildEvaluationSettings(
		side,
		ambientSettings,
		credentialCanary,
	);
	if (!settings) return null;
	const file = path.join(workspaceRoot, ".pi", "settings.json");
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
	return file;
}

function resolvedPair(descriptor) {
	const common = {
		project: descriptor.project,
		stage: descriptor.stage,
		bundleVersion: 1,
		role: descriptor.role ?? descriptor.stage,
		provider: descriptor.provider ?? "configured",
		model: descriptor.model ?? "configured",
		effort: descriptor.effort ?? "medium",
		evaluator: descriptor.evaluator ?? {
			provider: "configured",
			model: "configured",
		},
		runtime: {
			node: process.versions.node,
			platform: process.platform,
			arch: process.arch,
		},
		dependencies: descriptor.dependencies ?? { package: "local" },
		browser: descriptor.browser ?? { status: "unavailable" },
		rubricVersion: 1,
		tools: descriptor.tools,
		roleMap: descriptor.roleMap,
	};
	return {
		baseline: { ...common, ...descriptor.baseline },
		candidate: { ...common, ...descriptor.candidate },
	};
}

function validateDescriptor(descriptor) {
	const pair = resolvedPair(descriptor);
	return validateExperimentPair({
		...pair,
		factor: descriptor.factor,
		interaction: descriptor.interaction === true,
	});
}

function stageInput(stage) {
	if (stage === "brainstorm") return "request.txt";
	if (stage === "plan") return path.join("goldens", "brainstorm.md");
	if (stage === "work") return path.join("goldens", "plan.md");
	throw new Error(`unsupported stage: ${stage}`);
}

function provision({
	sourceRoot,
	project,
	stage,
	side,
	pairIndex,
	runRoot,
	initialize,
}) {
	const workspaceRoot = mkdtempSync(
		path.join(runRoot, `${project}-${stage}-${side}-${pairIndex}-`),
	);
	const projectDir = projectRoot(sourceRoot, project);
	if (stage === "work")
		cpSync(path.join(projectDir, "seed"), workspaceRoot, { recursive: true });
	else writeFileSync(path.join(workspaceRoot, ".gitkeep"), "");
	const input = stageInput(stage);
	const promptInput = readFileSync(path.join(projectDir, input), "utf8");
	const stageInputPath = path.join(workspaceRoot, ".benchmark-input.md");
	writeFileSync(stageInputPath, promptInput);
	initialize(workspaceRoot);
	return {
		workspaceRoot,
		projectDir,
		input,
		promptInput,
		stageInputPath: path.basename(stageInputPath),
	};
}

function comparableProvenance(result, factor) {
	const provenance = structuredClone(result?.provenance ?? {});
	const factors = new Set(Array.isArray(factor) ? factor : [factor]);
	delete provenance.roles;
	if ([...factors].some((item) => item.startsWith("modelAssignment")))
		delete provenance.model;
	if ([...factors].some((item) => item.startsWith("effort")))
		delete provenance.thinking;
	if ([...factors].some((item) => item.startsWith("prompt")))
		delete provenance.payload;
	if (factors.has("workflowRevision")) {
		delete provenance.packageRoot;
		delete provenance.revision;
		if (Array.isArray(provenance.resources))
			provenance.resources = provenance.resources.map(({ name, source }) => ({
				name,
				source,
			}));
	}
	return provenance;
}

function provenanceMismatch(baseline, candidate, factor) {
	if (!baseline?.provenance || !candidate?.provenance) return false;
	return (
		fingerprint(comparableProvenance(baseline, factor)) !==
		fingerprint(comparableProvenance(candidate, factor))
	);
}

function passed(result, budgets) {
	if (result?.status !== "completed" || result.verifier?.passed === false)
		return false;
	const tokens = result.usage?.tokens?.total;
	if (!Number.isFinite(tokens)) return false;
	if (tokens > budgets.tokenCeiling) return false;
	if (Number.isFinite(result.wallMs) && result.wallMs > budgets.wallMsCeiling)
		return false;
	return true;
}

function disposition(attempts) {
	const baseline = attempts.find((attempt) => attempt.side === "baseline");
	const candidate = attempts.find((attempt) => attempt.side === "candidate");
	if (!baseline?.passed) return "invalid";
	if (!candidate?.passed && infrastructureFailure([candidate.result]))
		return "invalid";
	if (!candidate?.passed) return "candidate-rejected";
	return "diagnostic-pass";
}

function planArtifacts(root) {
	const directory = path.join(root, "docs", "plans");
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((name) => /\.(?:md|html)$/i.test(name))
		.map((name) => {
			const file = path.join(directory, name);
			const content = readFileSync(file, "utf8");
			const readiness =
				content.match(/artifact_readiness:\s*([A-Za-z-]+)/i)?.[1] ?? null;
			return {
				path: path.relative(root, file).replaceAll("\\", "/"),
				content,
				readiness,
				sha: fileSha(file),
			};
		});
}

function workItemFinalization(root) {
	let items;
	try {
		items = Object.values(loadStore(root).items);
	} catch {
		return { passed: false, reason: "work-store-unavailable" };
	}
	const executable = items.filter(
		(item) =>
			!["epic", "decision"].includes(String(item.type).toLowerCase()) &&
			item.status !== "closed",
	);
	return {
		passed: executable.length === 0,
		openExecutable: executable.map((item) => item.id),
	};
}

function workTelemetry(root) {
	const directory = path.join(root, ".pi", "work-runs");
	if (!existsSync(directory)) return [];
	const records = [];
	for (const name of readdirSync(directory)) {
		if (!name.endsWith(".jsonl")) continue;
		for (const line of readFileSync(path.join(directory, name), "utf8")
			.split(/\r?\n/)
			.filter(Boolean)) {
			try {
				records.push(JSON.parse(line));
			} catch (error) {
				throw new Error(
					`malformed workflow telemetry: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}
	return records;
}

async function defaultRunSample(sample, descriptor, sourceRoot) {
	const side = {
		...descriptor[sample.side],
		roleMap: descriptor[sample.side].roleMap ?? descriptor.roleMap,
	};
	writeEvaluationSettings(
		sample.workspaceRoot,
		side,
		side.settings ?? descriptor.settings,
		descriptor.credentialCanary,
	);
	const commandName =
		sample.stage === "work" ? "work-resume" : `work-${sample.stage}`;
	const argument =
		sample.stage === "brainstorm" ? sample.promptInput : sample.stageInputPath;
	const customPrompt = side.prompt ?? descriptor.prompt;
	let prompts = [customPrompt ?? `/${commandName} ${argument}`];
	let requiredCommands = [commandName];
	let requiredResources = requiredStageResources(sample.stage);
	if (customPrompt) {
		const customCommand = customPrompt.match(/^\/(work-[A-Za-z0-9-]+)/)?.[1];
		const skillCommand = customPrompt.match(/^\/(ce-[A-Za-z0-9-]+)/)?.[1];
		requiredCommands = customCommand ? [customCommand] : [];
		if (skillCommand) requiredResources = [`skill:${skillCommand}`];
	}
	if (sample.stage === "work" && !customPrompt) {
		prompts = [
			`/work-migrate ${sample.stageInputPath}`,
			"/work-goal Resume the active migrated plan through every executable WorkItem, verification, review, commit, and finalization.",
		];
		requiredCommands = ["work-migrate", "work-goal"];
	}
	const prompt = prompts[0];
	const mainRole = side.roleMap?.main;
	const providerPolicy =
		side.visibility || descriptor.visibility
			? {
					visibility: side.visibility ?? descriptor.visibility,
					endpoint: side.endpoint ?? descriptor.endpoint,
					approvedEndpoints: descriptor.approvedEndpoints,
					credentialCanary: descriptor.credentialCanary,
				}
			: null;
	if (side.roleMap && !providerPolicy)
		throw new Error(
			"canonical role maps require a declared provider payload policy",
		);
	const provider = mainRole?.provider ?? side.provider ?? descriptor.provider;
	const model = mainRole?.model ?? side.model ?? descriptor.model;
	const effort = mainRole?.effort ?? side.effort ?? descriptor.effort;
	const pairIndex = sample.pairIndex ?? 0;
	const attemptIndex = sample.attemptIndex ?? 0;
	const pairId = `${descriptor.mode}:${sample.stage}:${pairIndex}`;
	const sampleId = `${pairId}:${attemptIndex}:${sample.side}`;
	const runtimeTemp = path.join(sample.workspaceRoot, ".pi", "tmp");
	mkdirSync(runtimeTemp, { recursive: true });
	const started = Date.now();
	const rpc = await runRpcSample({
		packageRoot: path.resolve(side.packageRoot ?? sourceRoot),
		revision: side.workflowRevision,
		expectedRevision: side.workflowRevision,
		tools: descriptor.tools,
		expectedTools: descriptor.tools,
		trusted: descriptor.trusted,
		isolation: descriptor.isolation,
		sandboxCommand: descriptor.sandboxCommand,
		stage: sample.stage,
		prompt,
		prompts,
		answers: sample.answers,
		timeoutMs: descriptor.budgets.wallMsCeiling,
		env: {
			...process.env,
			TEMP: runtimeTemp,
			TMP: runtimeTemp,
			TMPDIR: runtimeTemp,
			CE_SCRATCH_ROOT: path.join(runtimeTemp, "compound-engineering"),
			CE_EVAL_SAMPLE_ID: sampleId,
			CE_EVAL_PAIR_ID: pairId,
			CE_EVAL_ATTEMPT_ID: String(attemptIndex),
			CE_EVAL_AGENT_ID: `${sampleId}:main`,
			CE_EVAL_ROLE: "main",
			CE_EVAL_TREATMENT_ID: `${Array.isArray(descriptor.factor) ? descriptor.factor.join("+") : descriptor.factor}:${sample.side}`,
			CE_EVAL_PROVIDER: provider,
			CE_EVAL_MODEL: model,
			CE_EVAL_EFFORT: effort,
		},
		workspaceRoot: sample.workspaceRoot,
		sourceRoot,
		bundleRoot: sample.projectDir,
		dependencyRoots: dependencyRoots(descriptor),
		requiredResources,
		requiredCommands,
		provider,
		model,
		thinking: effort,
		context: mainRole?.context,
		roleMap: side.roleMap,
		expectedRoles: side.expectedRoles ?? descriptor.expectedRoles,
		providerPolicy,
		// ponytail: CE skills currently hardcode this disposable scratch root;
		// remove the exception when upstream accepts a per-run scratch setting.
		allowedWriteRoots: descriptor.allowedScratchRoots ?? [],
	});
	const totalRpcWallMs = Date.now() - started;
	const wallMs = rpc.stageWallMs ?? totalRpcWallMs;
	const output = (rpc.events ?? [])
		.toReversed()
		.find(
			(event) =>
				event.type === "message_end" &&
				event.message?.role === "assistant" &&
				messageText(event.message),
		)?.message;
	const outputText = messageText(output);
	let telemetry = null;
	let telemetryError = null;
	if (rpc.status === "completed") {
		try {
			const records = workTelemetry(sample.workspaceRoot);
			telemetry = reconcileWorkflowTelemetry(records);
			const agentRecords = records.filter(
				(record) => record.sampleId === sampleId,
			);
			if (agentRecords.length > 0)
				telemetry.agentLedger = reconcileAgentLedger(agentRecords);
		} catch (error) {
			telemetryError = error instanceof Error ? error.message : String(error);
		}
	}
	const gitStatus = spawnSync(
		"git",
		["status", "--porcelain=v1", "--untracked-files=all"],
		{ cwd: sample.workspaceRoot, encoding: "utf8" },
	)
		.stdout.split(/\r?\n/)
		.filter((line) => line && !/^[? ][? ] \.pi\//.test(line));
	const artifacts = planArtifacts(sample.workspaceRoot);
	let stageGate;
	if (sample.stage === "brainstorm")
		stageGate = {
			passed: artifacts.some(
				(artifact) => artifact.readiness === "requirements-only",
			),
			artifacts,
		};
	else if (sample.stage === "plan")
		stageGate = {
			passed: artifacts.some(
				(artifact) => artifact.readiness === "implementation-ready",
			),
			artifacts,
		};
	else if (path.basename(sample.projectDir) === "csv-expenses")
		stageGate = verifyCsvProject(sample.workspaceRoot);
	else
		stageGate = await verifyCalculatorProject(
			sample.workspaceRoot,
			descriptor.browserRunner ?? null,
			{ evidenceDirectory: sample.evidenceDirectory },
		);
	if (sample.stage === "work") {
		const workItems = workItemFinalization(sample.workspaceRoot);
		stageGate = {
			...stageGate,
			passed: stageGate.passed && workItems.passed,
			workItems,
		};
	}
	if (stageGate.browser && descriptor.browser?.name) {
		const browserMatches =
			stageGate.browser.name === descriptor.browser.name &&
			stageGate.browser.version === descriptor.browser.version;
		if (!browserMatches)
			stageGate = {
				...stageGate,
				passed: false,
				reason: "browser-fingerprint-mismatch",
			};
	}
	const usage = rpc.usage ?? {};
	const toolEvents = (rpc.events ?? []).filter(
		(event) => event.type === "tool_execution_end",
	);
	const metrics = {
		tokens: usage.tokens?.total,
		wallMs,
		toolCalls: usage.toolCalls,
		subagentCalls: (rpc.events ?? []).filter(
			(event) =>
				event.type === "tool_execution_start" && event.toolName === "subagent",
		).length,
		toolOutputChars: toolEvents.reduce(
			(sum, event) => sum + JSON.stringify(event.result ?? {}).length,
			0,
		),
		retries: (rpc.events ?? []).filter(
			(event) => event.type === "auto_retry_start",
		).length,
		contextTokens:
			Number.isFinite(usage.contextUsage?.tokens) &&
			Number.isFinite(rpc.initialUsage?.contextUsage?.tokens)
				? Math.max(
						0,
						usage.contextUsage.tokens - rpc.initialUsage.contextUsage.tokens,
					)
				: undefined,
		questions: rpc.questions?.length ?? 0,
	};
	const provenanceComplete = Boolean(
		rpc.provenance?.revision &&
			rpc.provenance?.resources &&
			rpc.provenance?.model &&
			rpc.provenance?.isolation &&
			rpc.provenance?.roles?.valid !== false &&
			(!providerPolicy || rpc.provenance?.payload),
	);
	const verifier = {
		passed:
			rpc.status === "completed" &&
			provenanceComplete &&
			Boolean(outputText) &&
			Boolean(telemetry) &&
			gitStatus.length === 0 &&
			stageGate.passed,
		output: Boolean(outputText),
		telemetry: telemetryError ?? "complete",
		provenance: provenanceComplete,
		gitClean: gitStatus.length === 0,
		stage: stageGate,
	};
	let handoffArtifact = outputText;
	if (sample.stage !== "work") {
		const readiness =
			sample.stage === "brainstorm"
				? "requirements-only"
				: "implementation-ready";
		handoffArtifact =
			artifacts.find((artifact) => artifact.readiness === readiness)?.content ??
			outputText;
	}
	const screenshots = (stageGate.gates ?? [])
		.filter((gate) => gate.name === "screenshot" && gate.passed)
		.map((gate) => gate.detail);
	return {
		...rpc,
		wallMs,
		harnessRpcWallMs: Math.max(0, totalRpcWallMs - wallMs),
		metrics,
		telemetry,
		artifacts,
		screenshots,
		output: outputText,
		handoffArtifact,
		diff: gitStatus.join("\n"),
		verifier,
		prompt,
		prompts,
	};
}

function messageText(message) {
	return (message?.content ?? [])
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n");
}

function parseJsonObject(text, label) {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start)
		throw new Error(`${label} did not return JSON`);
	try {
		return JSON.parse(text.slice(start, end + 1));
	} catch (error) {
		throw new Error(
			`invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function defaultEvaluatePair(
	baselineArtifact,
	candidateArtifact,
	rubric,
	descriptor,
) {
	const blinded = blindArtifacts(baselineArtifact, candidateArtifact, rubric);
	const system = readFileSync(
		path.join(
			descriptor.sourceRoot ?? defaultSourceRoot,
			"agents",
			"workflow-evaluator.md",
		),
		"utf8",
	);
	const evaluator = descriptor.evaluator ?? {};
	const args = [
		"--mode",
		"json",
		"--print",
		"--no-session",
		"--offline",
		"--no-tools",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"--system-prompt",
		system,
	];
	if (evaluator.provider) args.push("--provider", evaluator.provider);
	if (evaluator.model) args.push("--model", evaluator.model);
	const payload = JSON.stringify(blinded.evaluatorInput);
	if (payload.length > 524_288)
		throw new Error("evaluator payload exceeds 512 KiB");
	const promptRoot = mkdtempSync(
		path.join(os.tmpdir(), "ce-workflow-evaluator-"),
	);
	const promptFile = path.join(promptRoot, "prompt.json");
	writeFileSync(promptFile, payload);
	args.push(`@${promptFile}`);
	const started = Date.now();
	try {
		const [piCommand, piArgs] = piInvocation(args, descriptor.piCommand);
		const run = spawnSync(piCommand, piArgs, {
			encoding: "utf8",
			timeout: evaluator.timeoutMs ?? 900_000,
			maxBuffer: 16 * 1024 * 1024,
		});
		if (run.status !== 0)
			throw new Error(`evaluator failed: ${run.stderr || run.stdout}`);
		const events = run.stdout
			.split(/\r?\n/)
			.filter(Boolean)
			.flatMap((line) => {
				try {
					return [JSON.parse(line)];
				} catch {
					return [];
				}
			});
		const assistant = events
			.filter(
				(event) =>
					event.type === "message_end" && event.message?.role === "assistant",
			)
			.at(-1)?.message;
		const result = parseJsonObject(messageText(assistant), "evaluator");
		const actualProvider = assistant?.provider ?? evaluator.provider;
		const actualModel = assistant?.model ?? evaluator.model;
		if (
			evaluator.provider &&
			actualProvider &&
			evaluator.provider !== actualProvider
		)
			throw new Error("evaluator provider fingerprint mismatch");
		if (
			evaluator.model &&
			actualModel &&
			!String(actualModel).endsWith(String(evaluator.model).split("/").at(-1))
		)
			throw new Error("evaluator model fingerprint mismatch");
		const dimensions =
			rubric.stageDimensions?.[descriptor.stage] ?? rubric.criticalDimensions;
		validateEvaluatorResult(result, dimensions, rubric);
		const scores = Object.fromEntries(
			Object.entries(blinded.control.mapping).map(([label, side]) => [
				side,
				result[label],
			]),
		);
		return {
			scores,
			control: blinded.control,
			evaluator: {
				provider: actualProvider,
				model: actualModel,
				wallMs: Date.now() - started,
				usage: assistant?.usage ?? null,
			},
		};
	} finally {
		rmSync(promptRoot, { recursive: true, force: true });
	}
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
	return {
		hard: { passed: passed(result, budgets) },
		metrics,
		scores,
		unexpectedQuestions: (result.questions ?? []).filter(
			(item) => item.expected === false,
		).length,
	};
}

function infrastructureFailure(results) {
	return (
		results
			.map(
				(result) =>
					result.infrastructureClass ??
					classifyInfrastructureFailure(result.failure, result.error),
			)
			.find(Boolean) ?? null
	);
}

function compactVerdict(verdict) {
	return {
		...verdict,
		pairs: (verdict.pairs ?? []).map(
			({ pairIndex, order, selectedAttempt, deltas }) => ({
				pairIndex,
				order,
				selectedAttempt,
				deltas,
			}),
		),
	};
}

export function calibrationBinding(descriptor, sourceRoot, side = "baseline") {
	return {
		project: descriptor.project,
		stage: descriptor.stage,
		bundleSha: projectBundleHash(projectRoot(sourceRoot, descriptor.project)),
		assignment: resolvedPair(descriptor)[side],
		campaignFingerprint: descriptor.campaignFingerprint ?? null,
		seed: descriptor.seed ?? null,
		priceTableFingerprint:
			descriptor.priceTableFingerprint ??
			descriptor.priceTable?.fingerprint ??
			null,
		evaluatorPanel:
			descriptor.evaluatorPanel ??
			descriptor.evaluators ??
			descriptor.evaluator ??
			null,
		rubricSha: fileSha(
			path.join(projectRoot(sourceRoot, descriptor.project), "rubric.json"),
		),
		providerEndpoint:
			descriptor[side]?.endpoint ??
			descriptor.providerEndpoint ??
			descriptor.endpoint ??
			null,
		visibility: descriptor[side]?.visibility ?? descriptor.visibility ?? null,
	};
}

export function loadCalibration(
	descriptor,
	sourceRoot,
	side = "baseline",
	calibrationPath = descriptor.calibrationPath,
) {
	if (!calibrationPath)
		throw new Error(`decision mode requires approved ${side} calibration`);
	const calibration = readJson(
		path.resolve(calibrationPath),
		`${side} calibration evidence`,
	);
	if (
		calibration.project !== descriptor.project ||
		calibration.stage !== descriptor.stage
	)
		throw new Error("calibration project/stage mismatch");
	if (
		calibration.bundleSha !==
		projectBundleHash(projectRoot(sourceRoot, descriptor.project))
	)
		throw new Error("calibration bundle is stale");
	if (calibration.recordFingerprint) {
		const { recordFingerprint, ...record } = calibration;
		if (recordFingerprint !== fingerprint(record))
			throw new Error("calibration record is tampered");
	}
	if (calibration.bindingFingerprint) {
		if (
			calibration.bindingFingerprint !== fingerprint(calibration.binding) ||
			calibration.bindingFingerprint !==
				fingerprint(calibrationBinding(descriptor, sourceRoot, side))
		)
			throw new Error("calibration environment is stale");
	} else if (
		side !== "baseline" ||
		calibration.baselineFingerprint !==
			fingerprint(resolvedPair(descriptor).baseline)
	)
		throw new Error("calibration environment is stale");
	if (
		!(calibration.minimumImprovement >= 0.05) ||
		!(calibration.maximumDimensionRegression >= 0.1) ||
		!Number.isFinite(calibration.tokenCeiling) ||
		!Number.isFinite(calibration.wallMsCeiling)
	)
		throw new Error("calibration weakens fixed threshold floors");
	return calibration;
}

export function combineCalibrations(baseline, candidate) {
	return {
		minimumImprovement: Math.max(
			baseline.minimumImprovement,
			candidate.minimumImprovement,
		),
		maximumDimensionRegression: Math.max(
			baseline.maximumDimensionRegression,
			candidate.maximumDimensionRegression,
		),
		tokenCeiling: Math.max(baseline.tokenCeiling, candidate.tokenCeiling),
		wallMsCeiling: Math.max(baseline.wallMsCeiling, candidate.wallMsCeiling),
		twoSided: true,
	};
}

export function loadCalibrationPair(descriptor, sourceRoot) {
	if (!descriptor.calibrationPaths)
		return loadCalibration(descriptor, sourceRoot);
	const missing = ["baseline", "candidate"].filter(
		(side) => !descriptor.calibrationPaths[side],
	);
	if (missing.length)
		return {
			status: "needs-more-evidence",
			reason: `missing ${missing.join(" and ")} calibration`,
		};
	return combineCalibrations(
		loadCalibration(
			descriptor,
			sourceRoot,
			"baseline",
			descriptor.calibrationPaths.baseline,
		),
		loadCalibration(
			descriptor,
			sourceRoot,
			"candidate",
			descriptor.calibrationPaths.candidate,
		),
	);
}

export async function runDecisionExperiment(descriptor, seams = {}) {
	if (descriptor.mode !== "decision")
		throw new Error("runDecisionExperiment requires decision mode");
	const harnessStarted = Date.now();
	if (!descriptor.calibration) validateDescriptor(descriptor);
	const sourceRoot = path.resolve(seams.sourceRoot ?? defaultSourceRoot);
	const calibration =
		descriptor.calibration || seams.skipCalibration
			? null
			: loadCalibrationPair(descriptor, sourceRoot);
	if (calibration?.status === "needs-more-evidence")
		return {
			mode: "decision",
			decisionGrade: true,
			status: calibration.status,
			reason: calibration.reason,
		};
	if (calibration)
		descriptor = {
			...descriptor,
			budgets: {
				...descriptor.budgets,
				tokenCeiling: calibration.tokenCeiling,
				wallMsCeiling: calibration.wallMsCeiling,
			},
		};
	if (!seams.skipApproval)
		validateGoldenApproval(
			projectRoot(sourceRoot, descriptor.project),
			readJson(
				path.join(
					projectRoot(sourceRoot, descriptor.project),
					"goldens",
					"approval.json",
				),
				`${descriptor.project} approval`,
			),
		);
	const before = sourceState(sourceRoot);
	const evidenceRoot =
		seams.evidenceRoot ??
		mkdtempSync(path.join(os.tmpdir(), "ce-workflow-evidence-"));
	const evidenceMode = descriptor.calibration ? "calibration" : "decision";
	const runId = `${evidenceMode}-${Date.now()}-${randomUUID().slice(0, 8)}`;
	const controlRoot = path.join(evidenceRoot, runId);
	const runRoot = path.join(os.tmpdir(), `ce-workflow-samples-${runId}`);
	prepareEvidenceStore(controlRoot);
	markRunRoot(runRoot);
	const lifecycle = path.join(controlRoot, "lifecycle.jsonl");
	const initialize = seams.initializeWorkspace ?? initializeWorkspace;
	const fullRubric = readJson(
		path.join(projectRoot(sourceRoot, descriptor.project), "rubric.json"),
		`${descriptor.project} rubric`,
	);
	const dimensions =
		fullRubric.stageDimensions?.[descriptor.stage] ??
		fullRubric.criticalDimensions;
	const rubric = {
		...fullRubric,
		dimensions,
		criticalDimensions: fullRubric.criticalDimensions.filter((dimension) =>
			dimensions.includes(dimension),
		),
	};
	const pairs = [];
	const evaluatorEvidence = [];
	const evaluatorControl = [];
	try {
		for (let pairIndex = 0; pairIndex < 3; pairIndex += 1) {
			const order =
				pairIndex % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
			const attempts = [];
			for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
				const raw = {};
				for (const side of order) {
					const sample = provision({
						sourceRoot,
						project: descriptor.project,
						stage: descriptor.stage,
						side,
						pairIndex,
						runRoot,
						initialize,
					});
					sample.evidenceDirectory = path.join(
						controlRoot,
						"screenshots",
						`${pairIndex}-${attemptIndex}-${side}`,
					);
					appendLifecycle(lifecycle, "provisioned", {
						pairIndex,
						attemptIndex,
						side,
						workspaceRoot: sample.workspaceRoot,
					});
					const answers = readJson(
						path.join(sample.projectDir, "answers.json"),
						`${descriptor.project} answer bank`,
					);
					appendLifecycle(lifecycle, "dispatched", {
						pairIndex,
						attemptIndex,
						side,
					});
					appendLifecycle(lifecycle, "running", {
						pairIndex,
						attemptIndex,
						side,
					});
					try {
						raw[side] = await (seams.runSample
							? seams.runSample({
									...sample,
									side,
									stage: descriptor.stage,
									pairIndex,
									attemptIndex,
									answers,
								})
							: defaultRunSample(
									{
										...sample,
										side,
										stage: descriptor.stage,
										pairIndex,
										attemptIndex,
										answers,
									},
									descriptor,
									sourceRoot,
								));
					} catch (error) {
						raw[side] = {
							status: "failed",
							failure: "harness-error",
							error: error instanceof Error ? error.message : String(error),
						};
					}
					writeFileSync(
						path.join(
							controlRoot,
							`raw-${pairIndex}-${attemptIndex}-${side}.json`,
						),
						`${JSON.stringify(sanitize(raw[side]), null, 2)}\n`,
					);
					appendResultLifecycle(
						lifecycle,
						{
							pairIndex,
							attemptIndex,
							side,
							passed: passed(raw[side], descriptor.budgets),
						},
						raw[side],
					);
					cleanupWorkspace(sample.workspaceRoot);
					appendLifecycle(lifecycle, "cleaned", {
						pairIndex,
						attemptIndex,
						side,
					});
				}
				if (
					provenanceMismatch(raw.baseline, raw.candidate, descriptor.factor)
				) {
					attempts.push({
						comparisonFailure: "provenance-mismatch",
						baseline: decisionSample(raw.baseline, {}, descriptor.budgets),
						candidate: decisionSample(raw.candidate, {}, descriptor.budgets),
						raw: sanitize(raw),
					});
					break;
				}
				const infra = infrastructureFailure(Object.values(raw));
				if (infra) {
					attempts.push({
						infrastructureFailure: infra,
						baseline: decisionSample(raw.baseline, {}, descriptor.budgets),
						candidate: decisionSample(raw.candidate, {}, descriptor.budgets),
						raw: sanitize(raw),
					});
					if (attemptIndex === 0) continue;
					break;
				}
				if (
					!passed(raw.baseline, descriptor.budgets) ||
					!passed(raw.candidate, descriptor.budgets)
				) {
					attempts.push({
						baseline: decisionSample(raw.baseline, {}, descriptor.budgets),
						candidate: decisionSample(raw.candidate, {}, descriptor.budgets),
						raw: sanitize(raw),
					});
					break;
				}
				let evaluation;
				try {
					evaluation = await (seams.evaluatePair
						? seams.evaluatePair(raw.baseline, raw.candidate, rubric, {
								pairIndex,
								attemptIndex,
							})
						: defaultEvaluatePair(
								raw.baseline.artifacts ?? raw.baseline.output ?? "",
								raw.candidate.artifacts ?? raw.candidate.output ?? "",
								rubric,
								{ ...descriptor, sourceRoot },
							));
				} catch (error) {
					attempts.push({
						evaluatorFailure:
							error instanceof Error ? error.message : String(error),
						baseline: decisionSample(raw.baseline, {}, descriptor.budgets),
						candidate: decisionSample(raw.candidate, {}, descriptor.budgets),
						raw: sanitize(raw),
					});
					break;
				}
				const evaluatorIdentity = {
					provider: evaluation.evaluator?.provider,
					model: evaluation.evaluator?.model,
				};
				if (
					evaluatorEvidence.some(
						(item) =>
							fingerprint({ provider: item.provider, model: item.model }) !==
							fingerprint(evaluatorIdentity),
					)
				) {
					attempts.push({
						evaluatorFailure: "changed evaluator fingerprint",
						baseline: decisionSample(raw.baseline, {}, descriptor.budgets),
						candidate: decisionSample(raw.candidate, {}, descriptor.budgets),
						raw: sanitize(raw),
					});
					break;
				}
				evaluatorEvidence.push(evaluation.evaluator ?? {});
				evaluatorControl.push({
					pairIndex,
					attemptIndex,
					...evaluation.control,
				});
				writeFileSync(
					path.join(controlRoot, "evaluator-control.json"),
					`${JSON.stringify(evaluatorControl, null, 2)}\n`,
				);
				attempts.push({
					baseline: decisionSample(
						raw.baseline,
						evaluation.scores.baseline,
						descriptor.budgets,
					),
					candidate: decisionSample(
						raw.candidate,
						evaluation.scores.candidate,
						descriptor.budgets,
					),
					raw: sanitize(raw),
				});
				break;
			}
			pairs.push({ pairIndex, order, attempts });
		}
		const verdict = evaluateDecision(pairs, rubric, {
			primaryMetric: descriptor.primaryMetric,
			minimumImprovement:
				calibration?.minimumImprovement ?? descriptor.minimumImprovement,
			maximumDimensionRegression: calibration?.maximumDimensionRegression,
		});
		const workflowWallMs = pairs
			.flatMap((pair) => pair.attempts)
			.reduce(
				(sum, attempt) =>
					sum +
					(attempt.raw?.baseline?.wallMs ?? 0) +
					(attempt.raw?.candidate?.wallMs ?? 0),
				0,
			);
		const evaluatorWallMs = evaluatorEvidence.reduce(
			(sum, evaluator) => sum + (evaluator.wallMs ?? 0),
			0,
		);
		const costs = {
			workflow: { wallMs: workflowWallMs },
			harness: {
				wallMs: Math.max(
					0,
					Date.now() - harnessStarted - workflowWallMs - evaluatorWallMs,
				),
			},
			evaluator: { wallMs: evaluatorWallMs, samples: evaluatorEvidence },
		};
		const rawSamples = pairs.flatMap((pair) =>
			pair.attempts.flatMap((attempt) =>
				[attempt.raw?.baseline, attempt.raw?.candidate].filter(Boolean),
			),
		);
		const evidence = sanitize({
			contract: "ce-workflow-evidence/v1",
			runId,
			mode: evidenceMode,
			decisionGrade: !descriptor.calibration,
			fingerprints: {
				descriptor: fingerprint(descriptor),
				calibration: calibration ? fingerprint(calibration) : null,
				source: before,
			},
			declaredFactor: descriptor.factor,
			costs,
			testOutput: rawSamples.map((sample) => sample.verifier ?? null),
			bugs: rawSamples
				.filter(
					(sample) =>
						!passed(sample, descriptor.budgets) &&
						!infrastructureFailure([sample]),
				)
				.map((sample) => ({
					failure: sample.failure,
					error: sample.error,
					verifier: sample.verifier,
				})),
			pairs,
			evaluator: evaluatorEvidence,
			verdict,
		});
		const evidencePath = path.join(controlRoot, "evidence.json");
		writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
		writeFileSync(
			path.join(controlRoot, "evaluator-control.json"),
			`${JSON.stringify(evaluatorControl, null, 2)}\n`,
		);
		const reportPath = path.join(controlRoot, "report.json");
		const infrastructureFailures = rawSamples
			.filter((sample) => infrastructureFailure([sample]))
			.map((sample) => ({ failure: sample.failure, error: sample.error }));
		writeFileSync(
			reportPath,
			`${JSON.stringify({ runId, mode: evidenceMode, decisionGrade: !descriptor.calibration, status: verdict.status, evidencePath, deterministicFacts: { hardGateStatus: verdict.status, pairCount: pairs.length }, evaluatorJudgments: verdict.qualitative ?? null, workflowCosts: verdict.summary ?? costs.workflow, harnessCost: costs.harness, evaluatorCost: costs.evaluator, infrastructureFailures, invalid: verdict.status === "invalid", benchmarkContractChanged: false, verdict: compactVerdict(verdict) }, null, 2)}\n`,
		);
		finalizeEvidenceStore(controlRoot);
		if (JSON.stringify(sourceState(sourceRoot)) !== JSON.stringify(before))
			throw new Error(
				"source checkout or benchmark bundle changed during comparison",
			);
		return {
			runId,
			mode: evidenceMode,
			decisionGrade: !descriptor.calibration,
			status: verdict.status,
			verdict,
			evidencePath,
			reportPath,
		};
	} finally {
		rmSync(runRoot, { recursive: true, force: true });
	}
}

function projectBundleHash(root) {
	return hashTree(root, (relative) => relative === "goldens/approval.json");
}

function fileSha(file) {
	return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function buildGoldenApproval(projectDirectory, metadata = {}) {
	return {
		version: 1,
		approved: metadata.approved === true,
		approvedBy: metadata.approvedBy ?? null,
		approvedAt: metadata.approvedAt ?? null,
		bundleSha: projectBundleHash(projectDirectory),
		brainstormSha: fileSha(
			path.join(projectDirectory, "goldens", "brainstorm.md"),
		),
		planSha: fileSha(path.join(projectDirectory, "goldens", "plan.md")),
		acceptancePassed: metadata.acceptancePassed === true,
		evidence: metadata.evidence ?? null,
	};
}

export function validateGoldenApproval(projectDirectory, approval) {
	if (!approval?.approved || !approval.approvedBy || !approval.approvedAt)
		throw new Error("human golden approval is required");
	if (!approval.acceptancePassed || !approval.evidence)
		throw new Error("golden acceptance evidence is required");
	const current = buildGoldenApproval(projectDirectory, approval);
	for (const field of ["bundleSha", "brainstormSha", "planSha"])
		if (approval[field] !== current[field])
			throw new Error(`golden approval is stale: ${field}`);
	return approval;
}

export function deriveCalibration(pairs) {
	if (!Array.isArray(pairs) || pairs.length !== 3)
		throw new Error("calibration requires three unchanged pairs");
	const values = (side, metric) => pairs.map((pair) => pair[side]?.[metric]);
	for (const side of ["baseline", "candidate"])
		for (const metric of ["tokens", "wallMs"])
			if (!values(side, metric).every(Number.isFinite))
				throw new Error(`calibration ${metric} is incomplete`);
	const noise = pairs.flatMap((pair) => [
		Math.abs(pair.candidate.tokens - pair.baseline.tokens) /
			Math.max(1, pair.baseline.tokens),
		Math.abs(pair.candidate.wallMs - pair.baseline.wallMs) /
			Math.max(1, pair.baseline.wallMs),
	]);
	return {
		minimumImprovement: Math.max(0.05, ...noise),
		maximumDimensionRegression: Math.max(0.1, ...noise),
		tokenCeiling: Math.ceil(
			Math.max(
				...values("baseline", "tokens"),
				...values("candidate", "tokens"),
			) * 1.2,
		),
		wallMsCeiling: Math.ceil(
			Math.max(
				...values("baseline", "wallMs"),
				...values("candidate", "wallMs"),
			) * 1.2,
		),
	};
}

export function requiresSentinel(changedPaths, declaredChangeType = "") {
	if (
		/handoff|artifact|routing|finalization|default-behavior/.test(
			declaredChangeType,
		)
	)
		return true;
	const knownNarrow =
		/^(README\.md|docs\/|scripts\/test-|benchmarks\/workflow-evaluation\/)/;
	return changedPaths.some(
		(file) =>
			/^(extensions\/work-models\.js|skills\/ce-(brainstorm|plan|work)\/|prompts\/work-|agents\/workItem-)/.test(
				file.replaceAll("\\", "/"),
			) || !knownNarrow.test(file.replaceAll("\\", "/")),
	);
}

export function adoptionDecision({
	qualifiedMapping,
	evidenceStatus = "missing",
	sharedRoleCoverage = false,
	providerAvailable = true,
	identityMatched = true,
	evaluatorAgreement = true,
	costWin = true,
	sentinelStatus = "not-run",
} = {}) {
	const retain = (reason, runSentinels = false) => ({
		status: "baseline-retained",
		reason,
		runSentinels,
		changeDefaults: false,
		preset: null,
		fallback: "provider-neutral",
	});
	if (!qualifiedMapping) return retain("no-qualified-mapping");
	if (evidenceStatus !== "fresh") return retain("missing-or-stale-evidence");
	if (!sharedRoleCoverage) return retain("incomplete-shared-role-coverage");
	if (!providerAvailable) return retain("provider-unavailable");
	if (!identityMatched) return retain("identity-drift-or-fallback");
	if (!evaluatorAgreement) return retain("evaluator-disagreement");
	if (!costWin) return retain("quality-pass-no-cost-win");
	if (sentinelStatus !== "passed")
		return retain(
			sentinelStatus === "failed" ? "sentinel-failed" : "sentinel-required",
			sentinelStatus !== "failed",
		);
	return {
		status: "eligible-for-adoption",
		reason: "qualified-mapping-and-sentinels-passed",
		runSentinels: false,
		changeDefaults: false,
		preset: null,
		fallback: "provider-neutral",
	};
}

export async function runSentinelExperiment(descriptor, seams = {}) {
	if (descriptor.mode !== "sentinel")
		throw new Error("runSentinelExperiment requires sentinel mode");
	if (!seams.skipApproval)
		validateDescriptor({
			...descriptor,
			project: descriptor.projects?.[0] ?? "calculator",
			stage: "brainstorm",
		});
	const sourceRoot = path.resolve(
		descriptor.sourceRoot ?? seams.sourceRoot ?? defaultSourceRoot,
	);
	const before = sourceState(sourceRoot);
	const evidenceRoot =
		seams.evidenceRoot ??
		mkdtempSync(path.join(os.tmpdir(), "ce-workflow-evidence-"));
	const runId = `sentinel-${Date.now()}-${randomUUID().slice(0, 8)}`;
	const controlRoot = path.join(evidenceRoot, runId);
	const runRoot = path.join(os.tmpdir(), `ce-workflow-samples-${runId}`);
	prepareEvidenceStore(controlRoot);
	markRunRoot(runRoot);
	const lifecycle = path.join(controlRoot, "lifecycle.jsonl");
	const results = [];
	const runStage =
		seams.runStage ??
		(async ({ side, stage, input, workspaceRoot, projectDir }) => {
			const project = path.basename(projectDir);
			const stageDescriptor = {
				...descriptor,
				project,
				stage,
				calibrationPath: descriptor.calibrations?.[`${project}:${stage}`],
			};
			if (!stageDescriptor.calibrationPath)
				throw new Error(
					`sentinel requires calibration for ${project}:${stage}`,
				);
			const calibration = loadCalibration(stageDescriptor, sourceRoot);
			stageDescriptor.budgets = {
				...descriptor.budgets,
				tokenCeiling: calibration.tokenCeiling,
				wallMsCeiling: calibration.wallMsCeiling,
			};
			const answers = readJson(
				path.join(projectDir, "answers.json"),
				`${project} answer bank`,
			);
			const stageInputPath = ".benchmark-input.md";
			writeFileSync(path.join(workspaceRoot, stageInputPath), input);
			command(workspaceRoot, "git", ["add", stageInputPath]);
			command(workspaceRoot, "git", [
				"commit",
				"--quiet",
				"-m",
				`benchmark handoff: ${stage}`,
			]);
			const result = await defaultRunSample(
				{
					side,
					stage,
					promptInput: input,
					stageInputPath,
					workspaceRoot,
					projectDir,
					answers,
					evidenceDirectory: path.join(
						controlRoot,
						"screenshots",
						`${project}-${side}-${stage}`,
					),
				},
				stageDescriptor,
				sourceRoot,
			);
			return { ...result, artifact: result.handoffArtifact };
		});
	const verifyProject =
		seams.verifyProject ??
		(async ({ project, workspaceRoot }) => {
			if (project === "csv-expenses") return verifyCsvProject(workspaceRoot);
			return verifyCalculatorProject(workspaceRoot, null);
		});
	try {
		for (const project of descriptor.projects ?? [
			"calculator",
			"csv-expenses",
		]) {
			const projectDir = projectRoot(sourceRoot, project);
			if (!seams.skipApproval)
				validateGoldenApproval(
					projectDir,
					readJson(
						path.join(projectDir, "goldens", "approval.json"),
						`${project} approval`,
					),
				);
			for (const side of descriptor.sides ?? ["baseline", "candidate"]) {
				const workspaceRoot = mkdtempSync(
					path.join(runRoot, `${project}-${side}-`),
				);
				cpSync(path.join(projectDir, "seed"), workspaceRoot, {
					recursive: true,
				});
				(seams.initializeWorkspace ?? initializeWorkspace)(workspaceRoot);
				appendLifecycle(lifecycle, "provisioned", {
					project,
					side,
					workspaceRoot,
				});
				const projectResult = { project, side, stages: [], acceptance: null };
				let input = readFileSync(path.join(projectDir, "request.txt"), "utf8");
				let inputSource = "original-request";
				for (const stage of ["brainstorm", "plan", "work"]) {
					let stageResult;
					appendLifecycle(lifecycle, "dispatched", { project, side, stage });
					appendLifecycle(lifecycle, "running", { project, side, stage });
					try {
						stageResult = await runStage({
							project,
							side,
							stage,
							input,
							inputSource,
							workspaceRoot,
							projectDir,
						});
					} catch (error) {
						stageResult = {
							status: "failed",
							failure: "harness-error",
							error: error instanceof Error ? error.message : String(error),
						};
					}
					if (!stageResult)
						stageResult = {
							status: "failed",
							failure: "live-stage-adapter-unavailable",
						};
					projectResult.stages.push(
						sanitize({
							stage,
							inputSource,
							inputSha: fingerprint(input),
							...stageResult,
						}),
					);
					writeFileSync(
						path.join(controlRoot, `checkpoint-${project}-${side}.json`),
						`${JSON.stringify(projectResult, null, 2)}\n`,
					);
					appendResultLifecycle(
						lifecycle,
						{ project, side, stage },
						stageResult,
					);
					if (
						stageResult.status !== "completed" ||
						stageResult.verifier?.passed === false ||
						stageResult.usedGolden
					)
						break;
					input = String(stageResult.artifact ?? "");
					inputSource = `actual:${stage}`;
				}
				if (
					projectResult.stages.length === 3 &&
					projectResult.stages.every(
						(stage) =>
							stage.status === "completed" && stage.verifier?.passed !== false,
					)
				)
					projectResult.acceptance = await verifyProject({
						project,
						side,
						workspaceRoot,
						projectDir,
					});
				results.push(projectResult);
				cleanupWorkspace(workspaceRoot);
				appendLifecycle(lifecycle, "cleaned", { project, side });
			}
		}
		const status = results.every(
			(project) =>
				project.stages.length === 3 &&
				project.stages.every(
					(stage) =>
						stage.status === "completed" &&
						stage.verifier?.passed !== false &&
						!stage.usedGolden,
				) &&
				project.acceptance?.passed,
		)
			? "passed"
			: "failed";
		const evidencePath = path.join(controlRoot, "evidence.json");
		writeFileSync(
			evidencePath,
			`${JSON.stringify(sanitize({ contract: "ce-workflow-evidence/v1", runId, mode: "sentinel", status, projects: results, source: before }), null, 2)}\n`,
		);
		const reportPath = path.join(controlRoot, "report.json");
		const projectSummary = results.map((result) => ({
			project: result.project,
			side: result.side,
			stages: result.stages.map((stage) => ({
				stage: stage.stage,
				status: stage.status,
				failure: stage.failure,
			})),
			acceptance: result.acceptance?.passed ?? false,
		}));
		writeFileSync(
			reportPath,
			`${JSON.stringify({ runId, mode: "sentinel", status, evidencePath, projects: projectSummary }, null, 2)}\n`,
		);
		finalizeEvidenceStore(controlRoot);
		if (JSON.stringify(sourceState(sourceRoot)) !== JSON.stringify(before))
			throw new Error(
				"source checkout or benchmark bundle changed during sentinel",
			);
		return {
			runId,
			mode: "sentinel",
			status,
			projects: results,
			evidencePath,
			reportPath,
		};
	} finally {
		rmSync(runRoot, { recursive: true, force: true });
	}
}

export async function runCalibrationExperiment(descriptor, seams = {}) {
	if (descriptor.mode !== "calibration")
		throw new Error("runCalibrationExperiment requires calibration mode");
	const decision = await runDecisionExperiment(
		{
			...descriptor,
			mode: "decision",
			factor: "unchanged-calibration",
			calibration: true,
		},
		seams,
	);
	const stable = ["candidate-accepted", "quality-pass-no-cost-win"].includes(
		decision.status,
	);
	if (
		!stable ||
		!decision.verdict?.pairs ||
		decision.verdict.pairs.length !== 3
	)
		return { ...decision, mode: "calibration", status: "invalid-calibration" };
	const pairs = decision.verdict.pairs.map((pair) => {
		const attempt = pair.attempts[pair.selectedAttempt];
		return {
			baseline: {
				tokens: attempt.baseline.metrics.tokens,
				wallMs: attempt.baseline.metrics.wallMs,
			},
			candidate: {
				tokens: attempt.candidate.metrics.tokens,
				wallMs: attempt.candidate.metrics.wallMs,
			},
		};
	});
	const calibration = deriveCalibration(pairs);
	const sourceRoot = path.resolve(seams.sourceRoot ?? defaultSourceRoot);
	const target = descriptor.calibrationTarget ?? "baseline";
	if (!new Set(["baseline", "candidate"]).has(target))
		throw new Error("calibrationTarget must be baseline or candidate");
	const binding = calibrationBinding(descriptor, sourceRoot, target);
	const calibrationRecord = {
		project: descriptor.project,
		stage: descriptor.stage,
		target,
		bundleSha: binding.bundleSha,
		baselineFingerprint: fingerprint(resolvedPair(descriptor).baseline),
		binding,
		bindingFingerprint: fingerprint(binding),
		generatedAt: new Date().toISOString(),
		...calibration,
	};
	calibrationRecord.recordFingerprint = fingerprint(calibrationRecord);
	const calibrationPath = path.join(
		path.dirname(decision.evidencePath),
		"calibration.json",
	);
	writeFileSync(
		calibrationPath,
		`${JSON.stringify(calibrationRecord, null, 2)}\n`,
	);
	return {
		...decision,
		mode: "calibration",
		status: "calibrated",
		calibration,
		calibrationPath,
	};
}

export function runGoldenUpdate(descriptor, seams = {}) {
	if (descriptor.mode !== "golden-update")
		throw new Error("runGoldenUpdate requires golden-update mode");
	const sourceRoot = path.resolve(seams.sourceRoot ?? defaultSourceRoot);
	const projectDir = projectRoot(sourceRoot, descriptor.project);
	const approvalFile = path.join(projectDir, "goldens", "approval.json");
	const before = existsSync(approvalFile)
		? readJson(approvalFile, `${descriptor.project} prior approval`)
		: null;
	if (
		descriptor.humanApproved &&
		(!descriptor.approvedBy ||
			!descriptor.acceptancePassed ||
			!descriptor.acceptanceEvidence)
	)
		throw new Error(
			"approved golden updates require approver and retained acceptance evidence",
		);
	if (descriptor.contractChanged && !descriptor.humanApproved)
		throw new Error(
			"contract changes require explicit human approval before mutation",
		);
	if (descriptor.contractChanged) {
		const projectFile = path.join(projectDir, "project.json");
		const project = readJson(projectFile, `${descriptor.project} project`);
		writeFileSync(
			projectFile,
			`${JSON.stringify({ ...project, version: Number(project.version ?? 0) + 1 }, null, 2)}\n`,
		);
	}
	const next = buildGoldenApproval(projectDir, {
		approved: descriptor.humanApproved === true,
		approvedBy: descriptor.approvedBy,
		approvedAt:
			descriptor.approvedAt ??
			(descriptor.humanApproved ? new Date().toISOString() : null),
		acceptancePassed: descriptor.acceptancePassed === true,
		evidence: descriptor.acceptanceEvidence,
	});
	const evidenceRoot =
		seams.evidenceRoot ??
		mkdtempSync(path.join(os.tmpdir(), "ce-workflow-evidence-"));
	const updateRoot = path.join(
		evidenceRoot,
		`golden-update-${Date.now()}-${randomUUID().slice(0, 8)}`,
	);
	mkdirSync(updateRoot, { recursive: true });
	const evidencePath = path.join(updateRoot, "evidence.json");
	writeFileSync(
		evidencePath,
		`${JSON.stringify({ project: descriptor.project, before, after: next, contractChanged: Boolean(descriptor.contractChanged) }, null, 2)}\n`,
	);
	if (!descriptor.humanApproved)
		return {
			mode: "golden-update",
			status: "pending-human-approval",
			candidate: next,
			evidencePath,
		};
	validateGoldenApproval(projectDir, next);
	writeFileSync(approvalFile, `${JSON.stringify(next, null, 2)}\n`);
	const manifestFile = path.join(
		sourceRoot,
		"benchmarks",
		"workflow-evaluation",
		"v1",
		"manifest.json",
	);
	const manifest = readJson(manifestFile, "workflow evaluation manifest");
	manifest.approvals = { ...manifest.approvals, [descriptor.project]: next };
	writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
	return {
		mode: "golden-update",
		status: "approved",
		approvalPath: approvalFile,
		manifestPath: manifestFile,
		evidencePath,
	};
}

export async function runSmokeExperiment(descriptor, seams = {}) {
	if (descriptor.mode !== "smoke")
		throw new Error("runSmokeExperiment requires smoke mode");
	const harnessStarted = Date.now();
	validateDescriptor(descriptor);
	const sourceRoot = path.resolve(seams.sourceRoot ?? defaultSourceRoot);
	const calibration = descriptor.calibrationPath
		? loadCalibration(descriptor, sourceRoot)
		: null;
	if (calibration)
		descriptor = {
			...descriptor,
			budgets: {
				...descriptor.budgets,
				tokenCeiling: calibration.tokenCeiling,
				wallMsCeiling: calibration.wallMsCeiling,
			},
		};
	if (["plan", "work"].includes(descriptor.stage) && !seams.skipApproval)
		validateGoldenApproval(
			projectRoot(sourceRoot, descriptor.project),
			readJson(
				path.join(
					projectRoot(sourceRoot, descriptor.project),
					"goldens",
					"approval.json",
				),
				`${descriptor.project} approval`,
			),
		);
	const before = sourceState(sourceRoot);
	const evidenceRoot =
		seams.evidenceRoot ??
		mkdtempSync(path.join(os.tmpdir(), "ce-workflow-evidence-"));
	const runId = `smoke-${Date.now()}-${randomUUID().slice(0, 8)}`;
	const controlRoot = path.join(evidenceRoot, runId);
	const runRoot = path.join(os.tmpdir(), `ce-workflow-samples-${runId}`);
	prepareEvidenceStore(controlRoot);
	markRunRoot(runRoot);
	const lifecycle = path.join(controlRoot, "lifecycle.jsonl");
	const attempts = [];
	const fullRubric = readJson(
		path.join(projectRoot(sourceRoot, descriptor.project), "rubric.json"),
		`${descriptor.project} rubric`,
	);
	const dimensions =
		fullRubric.stageDimensions?.[descriptor.stage] ??
		fullRubric.criticalDimensions;
	const rubric = {
		...fullRubric,
		dimensions,
		criticalDimensions: fullRubric.criticalDimensions.filter((dimension) =>
			dimensions.includes(dimension),
		),
	};
	const initialize = seams.initializeWorkspace ?? initializeWorkspace;
	try {
		for (const side of ["baseline", "candidate"]) {
			const sample = provision({
				sourceRoot,
				project: descriptor.project,
				stage: descriptor.stage,
				side,
				pairIndex: 0,
				runRoot,
				initialize,
			});
			sample.evidenceDirectory = path.join(controlRoot, "screenshots", side);
			appendLifecycle(lifecycle, "provisioned", {
				side,
				workspaceRoot: sample.workspaceRoot,
			});
			const answers = readJson(
				path.join(sample.projectDir, "answers.json"),
				`${descriptor.project} answer bank`,
			);
			appendLifecycle(lifecycle, "dispatched", { side });
			appendLifecycle(lifecycle, "running", { side });
			let result;
			try {
				result = await (seams.runSample
					? seams.runSample({
							...sample,
							side,
							stage: descriptor.stage,
							answers,
						})
					: defaultRunSample(
							{
								...sample,
								side,
								stage: descriptor.stage,
								pairIndex: 0,
								attemptIndex: 0,
								answers,
							},
							descriptor,
							sourceRoot,
						));
			} catch (error) {
				result = {
					status: "failed",
					failure: "harness-error",
					error: error instanceof Error ? error.message : String(error),
				};
			}
			const ok = passed(result, descriptor.budgets);
			let failure = null;
			if (!ok) {
				failure = result.failure;
				if (!failure)
					failure = result.status === "completed" ? "hard-gate" : result.status;
			}
			const attempt = sanitize({
				side,
				pairIndex: 0,
				passed: ok,
				failure,
				result,
			});
			attempts.push(attempt);
			writeFileSync(
				path.join(controlRoot, `attempt-${side}.json`),
				`${JSON.stringify(attempt, null, 2)}\n`,
			);
			appendResultLifecycle(lifecycle, { side, passed: ok }, result);
			cleanupWorkspace(sample.workspaceRoot);
			appendLifecycle(lifecycle, "cleaned", { side });
		}
		let status = disposition(attempts);
		if (
			provenanceMismatch(
				attempts[0]?.result,
				attempts[1]?.result,
				descriptor.factor,
			)
		)
			status = "invalid";
		let evaluation = null;
		let evaluatorFailure = null;
		if (status === "diagnostic-pass") {
			try {
				evaluation = await (seams.evaluatePair
					? seams.evaluatePair(attempts[0].result, attempts[1].result, rubric, {
							pairIndex: 0,
							attemptIndex: 0,
						})
					: defaultEvaluatePair(
							attempts[0].result.artifacts ?? attempts[0].result.output ?? "",
							attempts[1].result.artifacts ?? attempts[1].result.output ?? "",
							rubric,
							{ ...descriptor, sourceRoot },
						));
				if (evaluation.control)
					writeFileSync(
						path.join(controlRoot, "evaluator-control.json"),
						`${JSON.stringify(evaluation.control, null, 2)}\n`,
					);
				const baselineScores = evaluation.scores.baseline;
				const candidateScores = evaluation.scores.candidate;
				const qualityRegressed =
					dimensions.reduce(
						(sum, dimension) =>
							sum + candidateScores[dimension] - baselineScores[dimension],
						0,
					) < 0 ||
					rubric.criticalDimensions.some(
						(dimension) =>
							candidateScores[dimension] < baselineScores[dimension],
					);
				const baselineQuestions = (attempts[0].result.questions ?? []).filter(
					(question) => question.expected === false,
				).length;
				const candidateQuestions = (attempts[1].result.questions ?? []).filter(
					(question) => question.expected === false,
				).length;
				if (qualityRegressed || candidateQuestions > baselineQuestions)
					status = "diagnostic-candidate-rejected";
			} catch (error) {
				evaluatorFailure =
					error instanceof Error ? error.message : String(error);
				status = "invalid";
			}
		}
		const workflowWallMs = attempts.reduce(
			(sum, attempt) => sum + (attempt.result?.wallMs ?? 0),
			0,
		);
		const evaluatorWallMs = evaluation?.evaluator?.wallMs ?? 0;
		const evidence = sanitize({
			contract: "ce-workflow-evidence/v1",
			runId,
			mode: "smoke",
			decisionGrade: false,
			fingerprints: {
				descriptor: fingerprint(descriptor),
				calibration: calibration ? fingerprint(calibration) : null,
				source: before,
				sides: Object.fromEntries(
					attempts.map((item) => [
						item.side,
						fingerprint(descriptor[item.side]),
					]),
				),
			},
			declaredFactor: descriptor.factor,
			costs: {
				workflow: attempts.map((attempt) => ({
					side: attempt.side,
					metrics: attempt.result?.metrics ?? attempt.result?.usage ?? null,
				})),
				harness: {
					wallMs: Math.max(
						0,
						Date.now() - harnessStarted - workflowWallMs - evaluatorWallMs,
					),
				},
				evaluator: evaluation?.evaluator ?? null,
			},
			evaluator: evaluation
				? { scores: evaluation.scores, evaluator: evaluation.evaluator }
				: null,
			evaluatorFailure,
			prompts: attempts.map((item) => item.result?.prompt).filter(Boolean),
			exchanges: attempts.flatMap((item) => item.result?.questions ?? []),
			artifacts: attempts.flatMap((item) => item.result?.artifacts ?? []),
			diffs: attempts.map((item) => item.result?.diff ?? ""),
			telemetry: attempts.map(
				(item) => item.result?.telemetry ?? item.result?.usage ?? null,
			),
			verifier: attempts.map((item) => item.result?.verifier ?? null),
			testOutput: attempts.map((item) => ({
				side: item.side,
				verifier: item.result?.verifier ?? null,
			})),
			bugs: attempts
				.filter((item) => item.failure && !infrastructureFailure([item.result]))
				.map((item) => ({
					side: item.side,
					failure: item.failure,
					error: item.result?.error,
				})),
			screenshots: attempts.flatMap((item) => item.result?.screenshots ?? []),
			attempts,
			disposition: status,
		});
		const evidencePath = path.join(controlRoot, "evidence.json");
		writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
		const infrastructureFailures = attempts
			.filter((item) => infrastructureFailure([item.result]))
			.map((item) => ({
				side: item.side,
				failure: item.failure,
				error: item.result?.error,
			}));
		writeFileSync(
			path.join(controlRoot, "report.json"),
			`${JSON.stringify({ runId, mode: "smoke", decisionGrade: false, status, evidencePath, deterministicFacts: attempts.map(({ side, passed, failure }) => ({ side, passed, failure })), evaluatorJudgments: evaluation?.scores ?? null, workflowCosts: evidence.costs.workflow, harnessCost: evidence.costs.harness, evaluatorCost: evidence.costs.evaluator, infrastructureFailures, invalid: status === "invalid", benchmarkContractChanged: false }, null, 2)}\n`,
		);
		finalizeEvidenceStore(controlRoot);
		const after = sourceState(sourceRoot);
		if (JSON.stringify(after) !== JSON.stringify(before))
			throw new Error(
				"source checkout or benchmark bundle changed during comparison",
			);
		return {
			runId,
			mode: "smoke",
			decisionGrade: false,
			status,
			attempts,
			evidencePath,
			reportPath: path.join(controlRoot, "report.json"),
		};
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
	if (process.argv.includes("--help") || !process.argv[2]) {
		process.stdout.write(`${usage()}\n`);
		return;
	}
	let descriptor;
	try {
		descriptor = readJson(
			path.resolve(process.argv[2]),
			"experiment descriptor",
		);
	} catch (error) {
		throw new Error(
			`${error instanceof Error ? error.message : String(error)}\n${usage()}`,
		);
	}
	let result;
	if (descriptor.mode === "smoke")
		result = await runSmokeExperiment(descriptor);
	else if (descriptor.mode === "decision")
		result = await runDecisionExperiment(descriptor);
	else if (descriptor.mode === "calibration")
		result = await runCalibrationExperiment(descriptor);
	else if (descriptor.mode === "golden-update")
		result = runGoldenUpdate(descriptor);
	else if (descriptor.mode === "sentinel")
		result = await runSentinelExperiment(descriptor);
	else throw new Error(`unsupported mode ${descriptor.mode}\n${usage()}`);
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	if (
		[
			"invalid",
			"failed",
			"candidate-rejected",
			"invalid-calibration",
			"pending-human-approval",
		].includes(result.status)
	)
		process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
	main().catch((error) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
