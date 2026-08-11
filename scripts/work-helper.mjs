#!/usr/bin/env node
import { exec, execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
	acquireRepositoryMutationLock,
	admitVerificationManifest,
	runVerificationShardBatch,
	VERIFICATION_GATE_VERSION,
} from "../extensions/read-only-lanes.js";
import {
	appendWorkNote,
	closeWorkItem,
	createWorkItem,
	loadStore,
	mutateStore,
	readyWorkItems,
	storePath,
	updateWorkItem,
} from "../extensions/work-store.js";
import {
	isGeneratedBuildPath,
	isRuntimePath,
	isWorkflowManaged,
	tidyUntrackedFiles,
} from "./work-hygiene.mjs";
import {
	hasProductionDiff,
	readReviewPolicy,
} from "../extensions/work-quality-policy.js";

const cwd = process.cwd();
const [, , command, ...args] = process.argv;
const gitBin = process.env.WORK_ORCH_GIT_BIN || "git";
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function run(bin, argv, options = {}) {
	let executable = bin;
	let args = argv;
	let shell = false;
	if (/\.[cm]?js$/i.test(bin)) {
		executable = process.execPath;
		args = [bin, ...argv];
	} else if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(bin)) {
		shell = true;
	}
	return execFileSync(executable, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		shell,
		...options,
	});
}

function readWorkItem(id) {
	return loadStore(cwd).items[id];
}

function childWorkItems(parentId) {
	return Object.values(loadStore(cwd).items).filter(
		(item) => item.parentId === parentId,
	);
}

function descendantIds(parentId) {
	const byParent = new Map();
	for (const item of Object.values(loadStore(cwd).items)) {
		const children = byParent.get(item.parentId) ?? [];
		children.push(item);
		byParent.set(item.parentId, children);
	}
	const ids = new Set();
	const pending = [parentId];
	while (pending.length) {
		for (const item of byParent.get(pending.pop()) ?? []) {
			ids.add(item.id);
			pending.push(item.id);
		}
	}
	return ids;
}

function readyNativeWorkItems() {
	return readyWorkItems(loadStore(cwd));
}

function updateNativeWorkItem(id, changes) {
	return mutateStore(cwd, (store) => {
		const current = store.items[id];
		if (!current) throw new Error(`Work item not found: ${id}`);
		return updateWorkItem(store, id, changes(current));
	});
}

function git(argv) {
	return run(gitBin, argv);
}

function gitStatusPaths() {
	const records = git([
		"status",
		"--porcelain=v1",
		"-z",
		"--untracked-files=all",
	])
		.split("\0")
		.filter(Boolean);
	const paths = [];
	for (let i = 0; i < records.length; i += 1) {
		const record = records[i];
		const code = record.slice(0, 2);
		paths.push(record.slice(3));
		if (/[RC]/.test(code) && records[i + 1]) paths.push(records[++i]);
	}
	return [...new Set(paths)].filter(Boolean);
}

const LEGACY_INSTRUCTIONS_BEGIN = "<!-- BEGIN COMPOUND PI TOOL MAP -->";
const LEGACY_INSTRUCTIONS_END = "<!-- END COMPOUND PI TOOL MAP -->";
const LEGACY_INSTRUCTIONS_PHRASE = "COMPOUND PI TOOL MAP";

function markerOccurrences(text, marker) {
	const occurrences = [];
	for (let offset = text.indexOf(marker); offset !== -1; offset = text.indexOf(marker, offset + 1)) {
		const after = offset + marker.length;
		const lineStart = offset === 0 || text[offset - 1] === "\n";
		const lineEnd =
			after === text.length ||
			text[after] === "\n" ||
			(text[after] === "\r" && text[after + 1] === "\n");
		let end = after;
		if (text.slice(end, end + 2) === "\r\n") end += 2;
		else if (text[end] === "\n") end += 1;
		occurrences.push({ start: offset, end, exactLine: lineStart && lineEnd });
	}
	return occurrences;
}

function legacyInstructionsPreview(requestedFile = "AGENTS.md") {
	const file = path.resolve(cwd, requestedFile);
	if (!/(?:^|[/\\])AGENTS\.md$/i.test(file))
		return { status: "refused", reason: "not-an-AGENTS-file", file };
	if (!existsSync(file)) return { status: "no-op", reason: "file-absent", file };
	const text = readFileSync(file, "utf8");
	const begins = markerOccurrences(text, LEGACY_INSTRUCTIONS_BEGIN);
	const ends = markerOccurrences(text, LEGACY_INSTRUCTIONS_END);
	const phraseCount = text.split(LEGACY_INSTRUCTIONS_PHRASE).length - 1;
	if (!begins.length && !ends.length && phraseCount === 0)
		return { status: "no-op", reason: "markers-absent", file };
	let reason;
	if (begins.some((item) => !item.exactLine) || ends.some((item) => !item.exactLine))
		reason = "malformed-markers";
	else if (phraseCount !== begins.length + ends.length) reason = "malformed-markers";
	else if (begins.length !== 1 || ends.length !== 1)
		reason = !begins.length || !ends.length ? "missing-marker" : "duplicated-markers";
	else if (begins[0].start > ends[0].start) reason = "reversed-markers";
	if (reason) return { status: "refused", reason, file };
	const removed = text.slice(begins[0].start, ends[0].end);
	const result = text.slice(0, begins[0].start) + text.slice(ends[0].end);
	const confirmation = createHash("sha256")
		.update(`legacy-instructions-cleanup\0${file}\0${text}`)
		.digest("hex");
	return {
		status: "preview",
		file,
		confirmation,
		removed,
		result,
	};
}

function applyLegacyInstructionsCleanup(requestedFile, confirmation) {
	const preview = legacyInstructionsPreview(requestedFile);
	if (preview.status !== "preview") return preview;
	if (!confirmation)
		return { ...preview, status: "refused", reason: "confirmation-required" };
	if (confirmation !== preview.confirmation)
		return { ...preview, status: "refused", reason: "confirmation-mismatch" };
	writeFileSync(preview.file, preview.result);
	return { ...preview, status: "applied" };
}

function reviewerHandoff(id, implementationFiles, reviewReasons) {
	const helper = path.resolve(process.argv[1]);
	const reviewOnly = implementationFiles
		.map((file) => JSON.stringify(file.replaceAll("\\", "/")))
		.join(", ");
	return [
		"independent review required",
		`Work item: ${id}`,
		`Helper: ${JSON.stringify(helper)}`,
		`Summary command: node ${JSON.stringify(helper)} work-summary ${id}`,
		`Review only: ${reviewOnly}`,
		`Review reasons: ${reviewReasons.join("; ")}`,
		`Required outcome: one durable \`wo:review PASS|FAIL\` note on ${id}.`,
		"Reviewer coordination: this handoff is complete. Do not contact the supervisor; return BLOCKED immediately if any supplied path or command is unusable.",
		"Finish retry: rerun the same finish-task command with --reviewed after durable PASS evidence, or after fixing and verifying residual findings from the targeted re-review.",
		"FAIL recovery: after the initial review, fix and verify findings, then rerun the same finish-task command without --reviewed to regenerate this complete handoff; never handcraft a targeted re-review task. After that targeted re-review, fix and verify residuals and use --reviewed without launching a third reviewer.",
		"Reviewer liveness: use the coded async handoff; needsAttentionAfterMs=30000 is an attention notification, not a hard timeout. Prefer no explicit timeout; otherwise use at least 10 minutes.",
	].join("\n");
}

function sameFiles(left = [], right = []) {
	return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function reviewScope(task) {
	const matches = [...notesOf(task).matchAll(/^wo:review-scope (.+)$/gim)];
	if (!matches.length) return undefined;
	const raw = matches.at(-1)[1];
	let scope;
	try {
		scope = JSON.parse(raw);
	} catch {
		throw new Error(
			`invalid persisted wo:review-scope ${JSON.stringify(raw)}: expected a JSON array of file paths`,
		);
	}
	if (
		!Array.isArray(scope) ||
		scope.some((file) => typeof file !== "string" || !file.trim())
	)
		throw new Error(
			`invalid persisted wo:review-scope ${JSON.stringify(scope)}: expected a JSON array of file paths`,
		);
	return scope;
}

function targetedReviewFindings(task) {
	const matches = [
		...notesOf(task).matchAll(/^wo:review FAIL(?:\s*-\s*|\s+)(.+)$/gim),
	];
	const match = matches.at(-1);
	if (!match) return undefined;
	const payload = match[1].trim();
	try {
		const value = JSON.parse(payload);
		if (Array.isArray(value.findings)) {
			const findings = value.findings.filter(
				(item) => typeof item === "string" && item.trim(),
			);
			if (findings.length === value.findings.length && findings.length)
				return { index: match.index, findings };
		}
	} catch {
		// Legacy compact reviewer notes carry one finding after the FAIL marker.
	}
	return payload ? { index: match.index, findings: [payload] } : undefined;
}

function residualDisposition(task) {
	const matches = [
		...notesOf(task).matchAll(/^wo:residual-fix PASS (\{.*\})$/gim),
	];
	for (const match of matches.reverse()) {
		try {
			const value = JSON.parse(match[1]);
			if (
				Array.isArray(value.dispositions) &&
				value.dispositions.length > 0 &&
				value.dispositions.every((item) =>
					["finding", "fix", "evidence"].every(
						(key) => typeof item?.[key] === "string" && item[key].trim(),
					),
				)
			)
				return { index: match.index, dispositions: value.dispositions };
		} catch {
			// Ignore malformed disposition notes and require a valid one.
		}
	}
	return undefined;
}

function mechanicalDisposition(task) {
	const matches = [
		...notesOf(task).matchAll(/^wo:mechanical-fix PASS (\{.*\})$/gim),
	];
	for (const match of matches.reverse()) {
		try {
			const value = JSON.parse(match[1]);
			if (
				Array.isArray(value.dispositions) &&
				value.dispositions.length > 0 &&
				value.dispositions.every((item) =>
					["finding", "fix", "evidence"].every(
						(key) => typeof item?.[key] === "string" && item[key].trim(),
					),
				)
			)
				return { index: match.index, dispositions: value.dispositions };
		} catch {
			// Ignore malformed mechanical dispositions and require a valid one.
		}
	}
	return undefined;
}

function dispositionCovers(target, disposition) {
	return (
		target &&
		disposition?.index > target.index &&
		disposition.dispositions.length === target.findings.length &&
		target.findings.every(
			(finding) =>
				disposition.dispositions.filter((item) => item.finding === finding)
					.length === 1,
		)
	);
}

function reviewDispositionSatisfied(task) {
	const notes = notesOf(task);
	const reviews = [
		...notes.matchAll(/(?:wo:review|review(?: result)?):?\s*(PASS|FAIL)\b/gi),
	];
	if (reviews.at(-1)?.[1]?.toUpperCase() === "PASS") return true;
	const failures = reviews.filter(
		(event) => event[1]?.toUpperCase() === "FAIL",
	).length;
	const target = targetedReviewFindings(task);
	return failures === 1
		? dispositionCovers(target, mechanicalDisposition(task))
		: failures >= 2 && dispositionCovers(target, residualDisposition(task));
}

function formatPendingFiles() {
	if (!args.includes("--immediate-format")) return [];
	const files = gitStatusPaths().filter(
		(file) =>
			!isWorkflowManaged(file) &&
			/\.(?:[cm]?[jt]sx?|jsonc?|css|scss|sass|vue|svelte|html?)$/i.test(file) &&
			existsSync(file),
	);
	if (!files.length) return [];
	const suffix = process.platform === "win32" ? ".cmd" : "";
	const candidates = [
		process.env.WORK_ORCH_FORMATTER_BIN,
		path.join(cwd, "node_modules", ".bin", `biome${suffix}`),
		path.join(
			os.homedir(),
			".pi-lens",
			"tools",
			"node_modules",
			".bin",
			`biome${suffix}`,
		),
	].filter(Boolean);
	const formatter = candidates.find(existsSync);
	if (!formatter) return [];
	run(formatter, ["format", "--write", ...files]);
	return files;
}

async function runVerificationCommand(command) {
	const options = { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 };
	const shell =
		process.env.WORK_ORCH_VERIFY_SHELL ||
		(process.platform === "win32" && process.env.MSYSTEM ? "bash" : "");
	try {
		const result = shell
			? await execFileAsync(shell, ["-c", command], options)
			: await execAsync(command, options);
		return { exitStatus: 0, stdout: result.stdout, stderr: result.stderr };
	} catch (error) {
		if (error instanceof Error) throw error;
		throw new Error(String(error));
	}
}

async function runVerification(command, shards = []) {
	if (!shards.length) {
		const result = await runVerificationCommand(command);
		return { output: String(result.stdout ?? ""), manifest: null };
	}
	const authoritativeCommand = shards
		.map((shard) => shard.command)
		.join(" && ");
	if (command !== authoritativeCommand)
		throw new Error(
			"declared verification shards must exactly compose the authoritative --verify command in order",
		);
	let serialSetting = true;
	try {
		const settings = JSON.parse(
			readFileSync(
				path.join(
					process.env.PI_CODING_AGENT_DIR ||
						path.join(os.homedir(), ".pi", "agent"),
					"settings.json",
				),
				"utf8",
			),
		);
		serialSetting = settings?.workPerformance?.parallelVerification !== true;
	} catch {
		// Verification shards default to sequential.
	}
	if (process.env.WORK_ORCH_SERIAL === "1") serialSetting = true;
	const batch = await runVerificationShardBatch(
		cwd,
		{ shards, authoritativeCommand, gateVersion: VERIFICATION_GATE_VERSION },
		async (shard) => runVerificationCommand(shard.command),
		{ serial: serialSetting, failFast: true, mutationOwner: true },
	);
	admitVerificationManifest(batch.manifest, {
		shards: batch.declarations,
		invocationId: batch.manifest.invocationId,
		authoritativeCommand,
		baseHead: batch.manifest.baseHead,
		sourceFingerprint: batch.manifest.sourceFingerprint,
		currentFingerprint: batch.currentFingerprint,
		gateVersion: VERIFICATION_GATE_VERSION,
		reviews: batch.manifest.reviews,
	});
	return {
		output: batch.manifest.shards
			.map(
				(shard) =>
					`${shard.id}:${shard.status}:${shard.outputHash.slice(0, 12)}`,
			)
			.join(", "),
		manifest: batch.manifest,
	};
}

async function finishTaskUnlocked() {
	const id = args[0];
	const message = option("--message");
	const maxFiles = Number(
		option("--max-files", command === "finish-small" ? 2 : 8),
	);
	if (!id || !message || !Number.isInteger(maxFiles) || maxFiles < 1)
		throw new Error(
			"usage: finish-task <work-item-id> --max-files <n> --message <summary> [--verify <command> [--verify-shard <json> ...] --expect <stdout> | --json <file> --equals <path=value>] [--evidence-file <docs/evidence/task-owned-image> ...] [--immediate-format] [--reviewed] [--push]",
		);
	const task = readWorkItem(id);
	if (task?.initiative)
		throw new Error(
			`Initiative ${id} must be closed through /work-roadmap guarded close.`,
		);
	const taskContractText = `${titleOf(task)}\n${field(task, "description") ?? ""}\n${field(task, "acceptance", "acceptance_criteria") ?? ""}`;
	const evidenceOnly =
		/evidence[- ](?:only|capture)|\b(?:record|capture|probe|verify|test|try)\b/i.test(
			taskContractText,
		);
	const evidenceFiles = [
		...new Set(
			options("--evidence-file").map((file) =>
				path.posix.normalize(file.replaceAll("\\", "/")),
			),
		),
	];
	if (evidenceFiles.length > 20)
		throw new Error("finish-task accepts at most 20 declared evidence files");
	for (const file of evidenceFiles) {
		const taskEvidencePrefix = `docs/evidence/${id}`;
		if (
			!evidenceOnly ||
			path.posix.isAbsolute(file) ||
			file.startsWith("../") ||
			!(file.startsWith(`${taskEvidencePrefix}/`) ||
				file.startsWith(`${taskEvidencePrefix}-`)) ||
			!/\.(?:png|jpe?g|webp)$/i.test(file) ||
			!existsSync(path.join(cwd, file)) ||
			!statSync(path.join(cwd, file)).isFile() ||
			statSync(path.join(cwd, file)).size > 10 * 1024 * 1024
		)
			throw new Error(
				`invalid evidence file ${file}: require an existing image up to 10 MiB under docs/evidence/${id}... for an evidence task`,
			);
	}
	const evidenceFileSet = new Set(evidenceFiles);
	const formatted = formatPendingFiles();
	const stagedBefore = git(["diff", "--cached", "--name-only"])
		.split(/\r?\n/)
		.filter(Boolean);
	const unexpectedStaged = stagedBefore.filter(
		(file) => !file.replaceAll("\\", "/").startsWith(".ce-workflow/"),
	);
	if (unexpectedStaged.length)
		throw new Error(
			`refusing pre-staged files: ${unexpectedStaged.join(", ")}`,
		);
	if (stagedBefore.length) git(["restore", "--staged", "--", ...stagedBefore]);

	const canonicalBeforeVerificationPath = storePath(cwd);
	const canonicalBeforeVerification = existsSync(
		canonicalBeforeVerificationPath,
	)
		? readFileSync(canonicalBeforeVerificationPath, "utf8")
		: null;
	const verify = option("--verify");
	const shardDeclarations = options("--verify-shard").map((value, index) => {
		try {
			return JSON.parse(value);
		} catch {
			throw new Error(`--verify-shard ${index + 1} must be valid JSON`);
		}
	});
	const absentShardOutputs = new Set(
		shardDeclarations
			.flatMap((shard) => (Array.isArray(shard.outputs) ? shard.outputs : []))
			.filter(
				(output) =>
					typeof output === "string" &&
					!path.isAbsolute(output) &&
					!existsSync(path.join(cwd, output)),
			),
	);
	const jsonFile = option("--json");
	if (!verify && !jsonFile)
		throw new Error("finish-task requires --verify or --json");
	let verificationResult;
	let verificationCommand;
	let verificationManifest;
	let output;
	try {
		if (jsonFile) {
			verificationCommand = `json-assert ${jsonFile}`;
			const failures = jsonAssertionFailures(jsonFile);
			if (failures.length) throw new Error(failures.join("; "));
			output = "all JSON assertions passed";
		} else if (verify) {
			verificationCommand = verify;
			const verification = await runVerification(verify, shardDeclarations);
			output = verification.output.trim();
			verificationManifest = verification.manifest;
			const expected = option("--expect");
			if (expected !== undefined && output !== expected)
				throw new Error(
					`expected ${JSON.stringify(expected)}, got ${JSON.stringify(output)}`,
				);
		}
	} catch (error) {
		if (shardDeclarations.length) {
			if (canonicalBeforeVerification === null)
				rmSync(canonicalBeforeVerificationPath, { force: true });
			else
				writeFileSync(
					canonicalBeforeVerificationPath,
					canonicalBeforeVerification,
				);
		} else {
			mutateStore(cwd, (store) =>
				appendWorkNote(
					store,
					id,
					`wo:verify-check FAIL\nCommand: ${verificationCommand}\n${String(error.stderr ?? error.message ?? error).slice(-500)}`,
				),
			);
		}
		throw new Error(`verification failed: ${verificationCommand}`);
	}
	for (const output of absentShardOutputs)
		if (
			verificationManifest?.shards.some((shard) =>
				shard.outputs.includes(output),
			)
		)
			rmSync(path.join(cwd, output), { recursive: true, force: true });
	if (verificationCommand)
		verificationResult = {
			command: verificationCommand,
			status: "PASS",
			output: output.slice(-500),
			...(verificationManifest
				? {
						gateVersion: verificationManifest.gateVersion,
						shards: verificationManifest.shards.map(
							({ id, status, outputHash }) => ({ id, status, outputHash }),
						),
					}
				: {}),
		};
	const tidy = tidyUntrackedFiles({ cwd, gitBin });
	const unrecognized = tidy.unrecognized.filter(
		(file) => !evidenceFileSet.has(file.replaceAll("\\", "/")),
	);
	if (unrecognized.length)
		throw new Error(
			`untracked files need a decision before commit (add, gitignore, or remove):\n` +
				unrecognized.map((file) => `  - ${file}`).join("\n") +
				`\nResolve each, then re-run finish-task.`,
		);
	const changed = gitStatusPaths().filter(
		(file) => !isRuntimePath(file) && !isGeneratedBuildPath(file),
	);
	if (!changed.length) throw new Error("no related changes to commit");
	const implementationFiles = changed.filter((file) => {
		const normalized = file.replaceAll("\\", "/");
		return (
			!normalized.startsWith(".ce-workflow/") &&
			normalized !== ".ce-workflow/work-items.json" &&
			!evidenceFileSet.has(normalized)
		);
	});
	if (implementationFiles.length > maxFiles)
		throw new Error(
			`scope exceeds ${maxFiles} implementation files: ${implementationFiles.join(", ")}`,
		);
	const reviewReasons = [];
	const sensitivePaths = implementationFiles.filter((file) =>
		/(?:^|\/)(?:migrations?|schema|auth|security|permissions?|payments?|billing|secrets?|deploy|infra)(?:\/|\.|$)|\.github\/workflows\//i.test(
			file.replaceAll("\\", "/"),
		),
	);
	if (sensitivePaths.length)
		reviewReasons.push(`sensitive paths: ${sensitivePaths.join(", ")}`);
	if (
		/\b(?:auth(?:entication|orization)?|permission|credential|secret|payment|billing|migration|schema|database|destructive|production|deploy|release|breaking|concurren(?:cy|t)|race condition|thread safety|crypt|security|firmware flash)\b/i.test(
			taskContractText,
		)
	)
		reviewReasons.push("sensitive task contract");
	const numstat = git(["diff", "--numstat", "--", ...implementationFiles]);
	let changedLines = numstat
		.split(/\r?\n/)
		.filter(Boolean)
		.reduce((sum, line) => {
			const [added, removed] = line.split("\t");
			return sum + (Number(added) || 0) + (Number(removed) || 0);
		}, 0);
	const untracked = new Set(
		git(["ls-files", "--others", "--exclude-standard"])
			.split(/\r?\n/)
			.filter(Boolean),
	);
	for (const file of implementationFiles.filter((item) => untracked.has(item)))
		if (existsSync(file))
			changedLines += readFileSync(file, "utf8").split(/\r?\n/).length;
	if (changedLines > 300)
		reviewReasons.push(`large diff: ${changedLines} lines`);
	const uiFiles = implementationFiles.filter((file) =>
		/\.(?:tsx|jsx|css|scss|html|vue|svelte)$/i.test(file),
	);
	if (
		uiFiles.length &&
		/\b(?:ui|visual|browser|screenshot|interaction)\b/i.test(taskContractText)
	)
		reviewReasons.push(`UI acceptance: ${uiFiles.join(", ")}`);
	if (
		!evidenceOnly &&
		/\b(?:hardware|firmware|device|live evidence|real[- ]world)\b/i.test(
			taskContractText,
		)
	)
		reviewReasons.push("hardware/live-evidence contract");
	if (
		readReviewPolicy(cwd) === "review-all" &&
		hasProductionDiff(implementationFiles)
	)
		reviewReasons.push("Review All policy: production diff");
	if (reviewReasons.length) {
		const reviewed = args.includes("--reviewed");
		const priorScope = reviewScope(task);
		const accepted =
			priorScope !== undefined &&
			sameFiles(priorScope, implementationFiles) &&
			reviewDispositionSatisfied(task);
		if (!accepted && !reviewed) {
			if (
				priorScope === undefined ||
				!sameFiles(priorScope, implementationFiles)
			)
				mutateStore(cwd, (store) =>
					appendWorkNote(
						store,
						id,
						`wo:review-scope ${JSON.stringify(implementationFiles)}`,
					),
				);
			throw new Error(reviewerHandoff(id, implementationFiles, reviewReasons));
		}
		if (!priorScope)
			throw new Error(
				"--reviewed requires a persisted wo:review-scope; rerun finish-task without --reviewed to generate the coded handoff",
			);
		if (!sameFiles(priorScope, implementationFiles))
			throw new Error(
				"review scope changed; rerun finish-task without --reviewed to regenerate the coded handoff",
			);
		if (!accepted)
			throw new Error(
				"--reviewed requires durable wo:review PASS evidence or a verified residual fix after the targeted re-review",
			);
	}
	if (verificationCommand)
		mutateStore(cwd, (store) =>
			appendWorkNote(
				store,
				id,
				`wo:verify-check PASS\nCommand: ${verificationCommand}\nOutput: ${output.slice(-500)}`,
			),
		);
	git(["add", "-A", "--", ...changed]);
	const staged = git(["diff", "--cached", "--name-only"])
		.split(/\r?\n/)
		.filter(Boolean);
	if (!staged.length)
		throw new Error("no staged changes after filtering runtime files");
	const headBefore = git(["rev-parse", "HEAD"]).trim();
	const canonical = storePath(cwd);
	const canonicalBefore = existsSync(canonical)
		? readFileSync(canonical, "utf8")
		: null;
	let push = "skipped";
	try {
		git(["commit", "-m", `${id}: ${message}`]);
		mutateStore(cwd, (store) =>
			updateWorkItem(store, id, {
				status: "closed",
				evidence: [
					...(store.items[id]?.evidence ?? []),
					{ closeEvidence: "Completed by coded inline work path" },
				],
			}),
		);
		const closeChanges = gitStatusPaths().filter(
			(file) => !isRuntimePath(file),
		);
		if (
			closeChanges.some(
				(file) => file.replaceAll("\\", "/") !== ".ce-workflow/work-items.json",
			)
		)
			throw new Error(
				`non-work-store files changed during close: ${closeChanges.join(", ")}`,
			);
		if (git(["ls-files", "--", ".ce-workflow/work-items.json"]).trim()) {
			git(["add", "--", ".ce-workflow/work-items.json"]);
			git(["commit", "--amend", "--no-edit"]);
		}
		const remaining = gitStatusPaths().filter((file) => !isRuntimePath(file));
		if (remaining.length)
			throw new Error(`related files remain dirty: ${remaining.join(", ")}`);
		if (args.includes("--push")) {
			try {
				git([
					"rev-parse",
					"--abbrev-ref",
					"--symbolic-full-name",
					"@{upstream}",
				]);
			} catch (error) {
				if (/upstream/i.test(String(error.stderr ?? error.message ?? error)))
					push = "skipped-no-upstream";
				else throw error;
			}
			if (push !== "skipped-no-upstream") {
				git(["push"]);
				push = "passed";
			}
		}
	} catch (error) {
		if (canonicalBefore === null) rmSync(canonical, { force: true });
		else writeFileSync(canonical, canonicalBefore);
		git(["reset", "--mixed", headBefore]);
		throw new Error(
			`finalization rolled back before close: ${error.message ?? error}`,
		);
	}
	return {
		status: "PASS",
		work_item_id: id,
		commit: git(["rev-parse", "--short", "HEAD"]).trim(),
		files: staged,
		verification: verificationResult,
		formatted,
		push,
		clean: true,
	};
}

async function finishTask() {
	const mutation = acquireRepositoryMutationLock(cwd);
	try {
		return await finishTaskUnlocked();
	} finally {
		mutation.release();
	}
}

function arr(value) {
	if (Array.isArray(value)) return value;
	return value === null || value === undefined ? [] : [value];
}

function field(issue, ...names) {
	for (const name of names)
		if (issue?.[name] !== null && issue?.[name] !== undefined)
			return issue[name];
}

function idOf(issue) {
	return field(issue, "id", "ID") ?? "";
}

function titleOf(issue) {
	return field(issue, "title", "summary", "name") ?? "";
}

function typeOf(issue) {
	return field(issue, "issue_type", "type") ?? "";
}

function statusOf(issue) {
	return field(issue, "status", "state") ?? "";
}

function labelsOf(issue) {
	return arr(field(issue, "labels", "tags"));
}

function parentOf(issue) {
	return field(issue, "parentId", "parent", "parent_id", "epic_id") ?? "";
}

function notesOf(issue) {
	const notes = field(issue, "notes", "description", "body") ?? "";
	if (Array.isArray(notes)) return notes.join("\n");
	return typeof notes === "string" ? notes : JSON.stringify(notes ?? "");
}

function depsOf(issue) {
	return arr(field(issue, "dependencies", "deps", "blocked_by"))
		.map((dep) =>
			typeof dep === "string"
				? dep
				: field(dep, "id", "depends_on_id", "blocked_by_id"),
		)
		.filter(Boolean);
}

function summary(issue, notesTail = 2000) {
	return {
		id: idOf(issue),
		title: titleOf(issue),
		status: statusOf(issue),
		type: typeOf(issue),
		priority: issue?.priority,
		labels: labelsOf(issue),
		parentId: parentOf(issue),
		dependencies: depsOf(issue),
		updatedAt: field(issue, "updatedAt", "updated_at"),
		description: String(issue?.description ?? "").slice(0, 4000),
		design: String(issue?.design ?? "").slice(0, 4000),
		acceptance: String(
			field(issue, "acceptance", "acceptance_criteria") ?? "",
		).slice(0, 4000),
		evidence_tail: arr(issue?.evidence).slice(-3),
		notes_tail: notesOf(issue).slice(-notesTail),
	};
}

function compactChildSummary(issue) {
	return {
		id: idOf(issue),
		title: titleOf(issue),
		status: statusOf(issue),
		type: typeOf(issue),
		parentId: parentOf(issue),
		dependencies: depsOf(issue),
	};
}

function artifact(prefix, ext, content) {
	const dir = path.join(cwd, ".pi", "work-runs", "helper");
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${prefix}-${Date.now().toString(36)}.${ext}`);
	writeFileSync(file, String(content ?? ""));
	return file;
}

function print(value) {
	console.log(JSON.stringify(value, null, 2));
}

function capText(text, bytes = 10000) {
	if (text.length <= bytes) return { text, truncated: false };
	const half = Math.max(400, Math.floor((bytes - 80) / 2));
	return {
		text: `${text.slice(0, half)}\n… truncated ${text.length - half * 2} chars …\n${text.slice(-half)}`,
		truncated: true,
	};
}

function options(name) {
	return args.flatMap((arg, index) =>
		arg === name && index + 1 < args.length ? [args[index + 1]] : [],
	);
}
function option(name, fallback = undefined) {
	return options(name)[0] ?? fallback;
}

function positional() {
	const out = [];
	for (let i = 0; i < args.length; i += 1) {
		if (args[i].startsWith("--")) {
			i += 1;
			continue;
		}
		out.push(args[i]);
	}
	return out;
}

function termScore(issue, terms) {
	const haystack =
		`${titleOf(issue)}\n${labelsOf(issue).join(" ")}\n${notesOf(issue).slice(-2000)}`.toLowerCase();
	return terms.reduce(
		(sum, term) => sum + (haystack.includes(term) ? 1 : 0),
		0,
	);
}

function jsonPath(object, key) {
	return key.split(".").reduce((value, part) => value?.[part], object);
}

function jsonAssertionFailures(file) {
	let data;
	try {
		data = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		return [`invalid JSON assertion file: ${error.message}`];
	}
	const failures = [];
	for (const key of String(option("--required", ""))
		.split(",")
		.filter(Boolean)) {
		const value = jsonPath(data, key);
		if (value === null || value === undefined) failures.push(`missing ${key}`);
	}
	for (let i = 1; i < args.length; i += 1) {
		if (args[i] === "--equals") {
			const [key, expected] = String(args[++i]).split("=", 2);
			if (String(jsonPath(data, key)) !== expected)
				failures.push(`${key} != ${expected}`);
		} else if (args[i] === "--forbid-string") {
			const forbidden = args[++i];
			if (JSON.stringify(data).includes(forbidden))
				failures.push(`forbidden string ${forbidden}`);
		}
	}
	return failures;
}

try {
	if (command === "work-summary") {
		const issue = readWorkItem(args[0]);
		print(summary(issue));
	} else if (command === "work-children-summary") {
		const full = args.includes("--full");
		const status = option("--status");
		const children = childWorkItems(args[0]).filter(
			(issue) => !status || statusOf(issue) === status,
		);
		const requestedLimit = Number(
			option("--limit", full ? children.length : 50),
		);
		const limit =
			Number.isInteger(requestedLimit) && requestedLimit > 0
				? requestedLimit
				: 50;
		const shown = children
			.slice(0, limit)
			.map((issue) =>
				full ? summary(issue, 300) : compactChildSummary(issue),
			);
		if (children.length > shown.length)
			shown.push({
				truncated: true,
				total: children.length,
				shown: shown.length,
				hint: "Use --status <status>, --limit <n>, or --full for targeted detail.",
			});
		print(shown);
	} else if (command === "work-ready-summary") {
		const epic = args[0];
		print(
			readyNativeWorkItems()
				.filter((issue) => !epic || descendantIds(epic).has(idOf(issue)))
				.map((issue) => ({
					id: idOf(issue),
					title: titleOf(issue),
					status: statusOf(issue),
					type: typeOf(issue),
					parentId: parentOf(issue),
					dependencies: depsOf(issue),
				})),
		);
	} else if (command === "blocker-search") {
		const [epic, ...queryParts] = args;
		const terms = queryParts
			.join(" ")
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((term) => term.length >= 4);
		const matches = childWorkItems(epic)
			.filter((issue) => statusOf(issue) !== "closed")
			.filter(
				(issue) =>
					/bug|decision/.test(typeOf(issue)) ||
					labelsOf(issue).some((label) => /blocked|debug|follow/.test(label)) ||
					/blocked/i.test(notesOf(issue)),
			)
			.map((issue) => ({
				score: termScore(issue, terms),
				...summary(issue, 500),
			}))
			.filter((issue) => issue.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, Number(option("--limit", 5)));
		print({ status: matches.length ? "found" : "missing", matches });
	} else if (command === "search-summary" || command === "scan-capability") {
		const [query, ...paths] = positional();
		const max = String(option("--max", 80));
		const bytes = Number(option("--bytes", 10000));
		const rgArgs = [
			"-n",
			"-i",
			"-m",
			max,
			query,
			...(paths.length ? paths : ["."]),
		];
		let raw = "";
		let exitCode = 0;
		try {
			raw = run("rg", rgArgs);
		} catch (error) {
			raw = String(error.stdout ?? "");
			exitCode = Number(error.status ?? 1);
		}
		const fullLogPath =
			raw.length > bytes ? artifact(command, "txt", raw) : undefined;
		const lines = raw.split(/\r?\n/).filter(Boolean);
		const byFile = {};
		for (const line of lines) {
			const file = line.split(":", 1)[0] || "<unknown>";
			byFile[file] = (byFile[file] ?? 0) + 1;
		}
		const capped = capText(raw, bytes);
		let status = "PASS";
		if (lines.length) status = "found";
		else if (command === "scan-capability") status = "missing";
		print({
			status,
			exit_code: exitCode,
			query,
			match_count: lines.length,
			matches_by_file: byFile,
			evidence_lines: lines.slice(0, 30),
			truncated: capped.truncated,
			summary: capped.text,
			full_log_path: fullLogPath,
		});
	} else if (command === "finish-small" || command === "finish-task") {
		print(await finishTask());
	} else if (command === "legacy-instructions-preview") {
		print(legacyInstructionsPreview(positional()[0]));
	} else if (command === "legacy-instructions-apply") {
		print(applyLegacyInstructionsCleanup(positional()[0], option("--confirm")));
	} else if (command === "ensure-no-staged") {
		const allowWorkStore = args.includes("--allow-work-store");
		const staged = git(["diff", "--cached", "--name-only"])
			.split(/\r?\n/)
			.filter(Boolean);
		const allowed = allowWorkStore
			? staged.filter(
					(file) =>
						file === ".ce-workflow/issues.jsonl" ||
						file.startsWith(".ce-workflow/"),
				)
			: [];
		if (allowed.length) git(["restore", "--staged", ...allowed]);
		const remaining = git(["diff", "--cached", "--name-only"])
			.split(/\r?\n/)
			.filter(Boolean);
		print({
			status: remaining.length ? "FAIL" : "PASS",
			unstaged: allowed,
			remaining_staged: remaining,
		});
	} else if (command === "work-create") {
		const [title] = positional();
		if (!title)
			throw new Error(
				"usage: work-create <title> [--parent <id>] [--type <type>] [--description <text>] [--acceptance <text>] [--note <text>] [--label <label>]",
			);
		const labels = args.flatMap((arg, index) =>
			arg === "--label" && args[index + 1] ? [args[index + 1]] : [],
		);
		const created = mutateStore(cwd, (store) =>
			createWorkItem(store, {
				title,
				parentId: option("--parent"),
				type: option("--type", "task"),
				description: option("--description", ""),
				acceptance: option("--acceptance", ""),
				notes: option("--note") ? [option("--note")] : [],
				labels,
			}),
		);
		if (created.type === "epic" && !created.parentId) {
			const modUrl = pathToFileURL(
				path.join(import.meta.dirname, "..", "extensions", "work-models.js"),
			);
			const { rememberWorkflowEpicForHelper } = await import(modUrl.href);
			rememberWorkflowEpicForHelper(cwd, created);
		}
		print(summary(created, 300));
	} else if (command === "work-close") {
		const id = args[0];
		if (!id)
			throw new Error(
				"usage: work-close <work-item-id> [--reason <text>|--note <text>]",
			);
		const note = option("--reason") ?? option("--note");
		const closed = mutateStore(cwd, (store) => {
			const current = store.items[id];
			if (!current) throw new Error(`WorkItem not found: ${id}`);
			if (current.initiative)
				throw new Error(
					`Initiative ${id} must be closed through /work-roadmap guarded close.`,
				);
			return closeWorkItem(store, id, {
				notes: note ? [...current.notes, note] : current.notes,
			});
		});
		print(summary(closed, 300));
	} else if (command === "work-claim") {
		print(
			summary(
				updateNativeWorkItem(args[0], (current) => ({
					...current,
					status: "in_progress",
				})),
				300,
			),
		);
	} else if (command === "work-note") {
		const [id] = args;
		const noteArgs = args.slice(args[1] === "--append-notes" ? 2 : 1);
		if (!id || !noteArgs.length)
			throw new Error(
				"usage: work-note <work-item-id> [--append-notes] <note>",
			);
		const note =
			noteArgs.length === 1 && existsSync(noteArgs[0])
				? readFileSync(noteArgs[0], "utf8")
				: noteArgs.join(" ");
		print(
			summary(
				updateNativeWorkItem(id, (current) => ({
					...current,
					notes: [...current.notes, note],
				})),
				500,
			),
		);
	} else if (command === "work-block") {
		const task = args[0];
		const blocker = option("--by");
		if (!task || !blocker)
			throw new Error("usage: work-block <task-id> --by <blocker-id>");
		mutateStore(cwd, (store) => {
			const current = store.items[task];
			if (!current || !store.items[blocker])
				throw new Error("task or blocker work item is missing");
			updateWorkItem(store, task, {
				dependencies: [...new Set([...current.dependencies, blocker])],
			});
		});
		print({ status: "PASS", task, blocker });
	} else if (command === "work-label") {
		const id = args[0];
		const add = option("--add");
		const remove = option("--remove");
		print(
			summary(
				updateNativeWorkItem(id, (current) => ({
					...current,
					labels: current.labels
						.filter((label) => label !== remove)
						.concat(add ? [add] : []),
				})),
				300,
			),
		);
	} else if (command === "initiative-summary") {
		const [target] = positional();
		const { buildInitiativeProjection } = await import(
			"../extensions/work-models.js"
		);
		const projection = buildInitiativeProjection(cwd);
		if (target) {
			const root = projection.nodes.find((node) => node.id === target);
			if (!root) throw new Error(`Initiative or roadmap not found: ${target}`);
			print({
				schemaVersion: projection.schemaVersion,
				roots: [root.id],
				nodes: [
					root,
					...projection.nodes.filter((node) => node.parentId === root.id),
				],
			});
		} else print(projection);
	} else if (command === "initiative-preview") {
		const [proposalFile] = positional();
		const proposalJson = option("--proposal-json");
		if (!proposalFile && !proposalJson)
			throw new Error(
				"usage: initiative-preview [proposal-json-file | --proposal-json <json>]",
			);
		const { previewInitiativeReconciliation } = await import(
			"../extensions/work-models.js"
		);
		print(
			previewInitiativeReconciliation(
				cwd,
				JSON.parse(proposalJson ?? readFileSync(proposalFile, "utf8")),
			),
		);
	} else if (command === "initiative-apply") {
		const [proposalFile] = positional();
		const proposalJson = option("--proposal-json");
		const token = option("--token");
		const approval = option("--approval");
		if ((!proposalFile && !proposalJson) || !token || !approval)
			throw new Error(
				"usage: initiative-apply [proposal-json-file | --proposal-json <json>] --token <preview-token> --approval <receipt>",
			);
		const { applyInitiativeReconciliation } = await import(
			"../extensions/work-models.js"
		);
		print(
			applyInitiativeReconciliation(
				cwd,
				JSON.parse(proposalJson ?? readFileSync(proposalFile, "utf8")),
				token,
				{ approval },
			),
		);
	} else if (
		["bootstrap-plan-roadmap", "bootstrap-plan-epic"].includes(command)
	) {
		const [rel] = positional();
		const targetEpicId = option("--roadmap") ?? option("--epic");
		if (!rel)
			throw new Error(
				"usage: bootstrap-plan-roadmap <plan-path> [--roadmap <existing-roadmap-id>]",
			);
		const modUrl = pathToFileURL(
			path.join(import.meta.dirname, "..", "extensions", "work-models.js"),
		).href;
		const roadmapIdField =
			command === "bootstrap-plan-epic" ? "epic_id" : "roadmap_id";
		const roadmapTitleField =
			command === "bootstrap-plan-epic" ? "epic_title" : "roadmap_title";
		const bridge = `(async () => {
			const { bootstrapPlanEpic } = await import(${JSON.stringify(modUrl)});
			const s = bootstrapPlanEpic(${JSON.stringify(cwd)}, ${JSON.stringify(rel)}, "/work-plan", undefined, undefined, ${JSON.stringify(targetEpicId ? { targetEpicId } : undefined)});
			const slim = {
				ok: !!s.ok,
				action: s.action,
				[${JSON.stringify(roadmapIdField)}]: s.epic?.id ?? null,
				[${JSON.stringify(roadmapTitleField)}]: s.epic?.title ?? null,
				planning_id: s.selectedWorkItem?.id ?? null,
				initiative: s.initiative ?? null,
				selected_child: s.selectedChild ?? null,
				preparation: s.preparation ?? null,
				suggested_commands: s.suggestedCommands ?? [],
				open_questions: s.open_questions ?? [],
				message: s.message ?? "",
				nextAction: s.nextAction ?? "",
			};
			process.stdout.write(JSON.stringify(slim));
		})();`;
		let raw = "";
		try {
			raw = run(process.execPath, ["--input-type=module", "-e", bridge]);
		} catch (error) {
			raw = String(error.stdout ?? "");
			if (!raw) throw error;
		}
		const parsed = JSON.parse(raw || "{}");
		print(parsed);
		if (!["run-planner", "initiative-preparation"].includes(parsed.action))
			process.exitCode = 1;
	} else if (command === "json-assert") {
		const failures = jsonAssertionFailures(args[0]);
		print({
			status: failures.length ? "FAIL" : "PASS",
			failed_assertions: failures,
		});
		if (failures.length) process.exitCode = 1;
	} else {
		console.error(
			"usage: work-helper <work-summary|work-children-summary|work-ready-summary|work-create|work-close|work-claim|work-note|work-label|work-block|blocker-search|search-summary|scan-capability|finish-task|finish-small|ensure-no-staged|initiative-summary|initiative-preview|initiative-apply|bootstrap-plan-roadmap|json-assert> ...",
		);
		process.exitCode = 2;
	}
} catch (error) {
	print({
		status: "FAIL",
		error: error instanceof Error ? error.message : String(error),
		...(error?.code ? { code: error.code } : {}),
		...(error?.conflicts ? { conflicts: error.conflicts } : {}),
	});
	process.exitCode = process.exitCode || 1;
}
