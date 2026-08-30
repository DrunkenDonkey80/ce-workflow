#!/usr/bin/env node
import { exec, execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
	acquireRepositoryMutationLock,
	admitVerificationManifest,
	normalizeVerificationShards,
	runVerificationShardBatch,
	VERIFICATION_GATE_VERSION,
} from "../extensions/read-only-lanes.js";
import {
	addWorkEvidence,
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
	formatPendingFiles,
	isGeneratedBuildPath,
	isRuntimePath,
	tidyUntrackedFiles,
} from "./work-hygiene.mjs";
import {
	hasProductionDiff,
	readReviewPolicy,
} from "../extensions/work-quality-policy.js";
import { runCapabilityAdapter } from "../extensions/work-capability-adapters.js";
import {
	compatibilityVerificationContract,
	fileArtifact,
	inlineResultArtifact,
	validateExecutableVerificationContract,
	validateVerificationContract,
	verificationContractStatus,
	verificationProofRecord,
	verificationWaiverRecord,
} from "../extensions/work-verification-contract.js";

const cwd = process.cwd();
const [, , command, ...args] = process.argv;
const gitBin = process.env.WORK_ORCH_GIT_BIN || "git";

function run(bin, argv, options = {}) {
	let executable = bin;
	let childArgs = argv;
	if (/\.[cm]?js$/i.test(bin)) {
		executable = process.execPath;
		childArgs = [bin, ...argv];
	} else if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(bin)) {
		throw new Error(
			`refusing shell-backed executable ${bin}; use an .exe or Node script`,
		);
	}
	return execFileSync(executable, childArgs, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
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
			if (ids.has(item.id)) continue;
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

function git(argv, root = cwd) {
	return run(gitBin, argv, { cwd: root });
}

function canonicalGitRoot(candidate, label) {
	const requested = realpathSync(path.resolve(candidate));
	let root;
	try {
		root = git(["rev-parse", "--show-toplevel"], requested).trim();
	} catch {
		throw new Error(`${label} is not inside a Git repository: ${requested}`);
	}
	return realpathSync(root);
}

function normalizeRepositoryPath(file) {
	return path.posix.normalize(file.replaceAll("\\", "/"));
}

function gitStatusPaths(root = cwd) {
	const records = git(
		["status", "--porcelain=v1", "-z", "--untracked-files=all"],
		root,
	)
		.split("\0")
		.filter(Boolean);
	const paths = [];
	for (let i = 0; i < records.length; i += 1) {
		const record = records[i];
		const code = record.slice(0, 2);
		paths.push(record.slice(3));
		if (/[RC]/.test(code) && records[i + 1]) paths.push(records[++i]);
	}
	return [...new Set(paths)].filter(Boolean).map(normalizeRepositoryPath);
}

function relevantChanges(root) {
	return gitStatusPaths(root).filter(
		(file) => !isRuntimePath(file) && !isGeneratedBuildPath(file),
	);
}

const LEGACY_INSTRUCTIONS_BEGIN = "<!-- BEGIN COMPOUND PI TOOL MAP -->";
const LEGACY_INSTRUCTIONS_END = "<!-- END COMPOUND PI TOOL MAP -->";
const LEGACY_INSTRUCTIONS_PHRASE = "COMPOUND PI TOOL MAP";

function markerOccurrences(text, marker) {
	const occurrences = [];
	for (
		let offset = text.indexOf(marker);
		offset !== -1;
		offset = text.indexOf(marker, offset + 1)
	) {
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

function pathEscapes(root, file) {
	const relative = path.relative(root, file);
	return (
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	);
}

function legacyInstructionsPreview(requestedFile = "AGENTS.md") {
	let file = path.resolve(cwd, requestedFile);
	if (!/(?:^|[/\\])AGENTS\.md$/i.test(file))
		return { status: "refused", reason: "not-an-AGENTS-file", file };
	if (pathEscapes(cwd, file))
		return { status: "refused", reason: "outside-repository", file };
	if (!existsSync(file)) return { status: "no-op", reason: "file-absent", file };
	file = realpathSync(file);
	if (pathEscapes(realpathSync(cwd), file))
		return { status: "refused", reason: "outside-repository", file };
	const text = readFileSync(file, "utf8");
	const begins = markerOccurrences(text, LEGACY_INSTRUCTIONS_BEGIN);
	const ends = markerOccurrences(text, LEGACY_INSTRUCTIONS_END);
	const phraseCount = text.split(LEGACY_INSTRUCTIONS_PHRASE).length - 1;
	if (!begins.length && !ends.length && phraseCount === 0)
		return { status: "no-op", reason: "markers-absent", file };
	let reason;
	if (
		begins.some((item) => !item.exactLine) ||
		ends.some((item) => !item.exactLine)
	)
		reason = "malformed-markers";
	else if (phraseCount !== begins.length + ends.length)
		reason = "malformed-markers";
	else if (begins.length !== 1 || ends.length !== 1)
		reason =
			!begins.length || !ends.length ? "missing-marker" : "duplicated-markers";
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

function reviewerHandoff(
	id,
	implementationFiles,
	reviewReasons,
	executionRoot,
	ownerRepositoryRoot,
	distinctRoots,
) {
	const helper = path.resolve(process.argv[1]);
	const root = JSON.stringify(executionRoot);
	const ownerRoot = JSON.stringify(ownerRepositoryRoot);
	const helperPrefix = distinctRoots ? `cd ${ownerRoot} && ` : "";
	const reviewOnly = implementationFiles
		.map((file) => JSON.stringify(normalizeRepositoryPath(file)))
		.join(", ");
	return [
		"independent review required",
		`Work item: ${id}`,
		`Execution repository: ${root}`,
		`Repository preflight: git -C ${root} rev-parse --show-toplevel must resolve to this execution repository; stop BLOCKED before reading files or writing notes if it does not.`,
		...(distinctRoots
			? [
					`Run file-inspection and repository preflight commands with ${root} as the current working directory.`,
					`Run helper summary and note commands with ${ownerRoot} as the current working directory.`,
					`Helper: ${JSON.stringify(helper)}`,
					`Summary command (from owner repository): ${helperPrefix}node ${JSON.stringify(helper)} work-summary ${id}`,
					`Finish retry option: --execution-root ${root}`,
				]
			: [
					`Run every helper and file-inspection command with ${root} as the current working directory.`,
					`Helper: ${JSON.stringify(helper)}`,
					`Summary command (from execution repository): node ${JSON.stringify(helper)} work-summary ${id}`,
				]),
		`Review only: ${reviewOnly}`,
		`Review reasons: ${reviewReasons.join("; ")}`,
		`Required outcome: one durable \`wo:review PASS|FAIL\` note on ${id}.`,
		`Verdict command: ${helperPrefix}node ${JSON.stringify(helper)} work-note ${JSON.stringify(id)} --append-notes "wo:review PASS <one-line evidence>" (replace PASS with the structured FAIL verdict when fixes are required).`,
		`Verdict postcondition: rerun ${helperPrefix}node ${JSON.stringify(helper)} work-summary ${JSON.stringify(id)} and confirm notes_tail contains a line beginning exactly with wo:review PASS or wo:review FAIL.`,
		"Do not use --body or shell redirection to nul/NUL; read-only checks need no redirection.",
		"Reviewer coordination: this handoff is complete. Do not contact the supervisor; return BLOCKED immediately if any supplied path or command is unusable.",
		"Finish retry: rerun the same finish-task command with --reviewed after durable PASS evidence, or after fixing and verifying residual findings from the targeted re-review.",
		"FAIL recovery: after the initial review, fix and verify findings, then rerun the same finish-task command without --reviewed to regenerate this complete handoff; never handcraft a targeted re-review task. After that targeted re-review, fix and verify residuals and use --reviewed without launching a third reviewer.",
		"Reviewer liveness: use the coded async handoff; needsAttentionAfterMs=30000 is an attention notification, not a hard timeout. Prefer no explicit timeout; otherwise use at least 10 minutes.",
	].join("\n");
}

function sameFiles(left = [], right = []) {
	return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function reviewFingerprint(root, files) {
	const hash = createHash("sha256");
	for (const file of [...files].sort()) {
		const absolute = path.join(root, file);
		hash.update(file).update("\0");
		if (existsSync(absolute)) hash.update(readFileSync(absolute));
		else hash.update("<missing>");
		hash.update("\0");
	}
	return hash.digest("hex");
}

function reviewScope(task) {
	const note = noteEntriesOf(task)
		.filter((entry) => /^wo:review-scope /i.test(entry))
		.at(-1);
	if (!note) return undefined;
	const raw = note.slice("wo:review-scope ".length);
	let scope;
	try {
		scope = JSON.parse(raw);
	} catch {
		throw new Error(
			`invalid persisted wo:review-scope ${JSON.stringify(raw)}: expected files and fingerprint`,
		);
	}
	if (Array.isArray(scope)) scope = { files: scope };
	if (
		!scope ||
		typeof scope !== "object" ||
		!Array.isArray(scope.files) ||
		scope.files.some((file) => typeof file !== "string" || !file.trim()) ||
		(scope.fingerprint !== undefined &&
			!/^\p{ASCII_Hex_Digit}{64}$/u.test(scope.fingerprint))
	)
		throw new Error(
			`invalid persisted wo:review-scope ${JSON.stringify(scope)}: expected files and fingerprint`,
		);
	return scope;
}

function targetedReviewFindings(task) {
	const notes = noteEntriesOf(task);
	const index = notes.findLastIndex((note) =>
		/^wo:review FAIL(?:[ \t]*-[ \t]*|[ \t]+)/i.test(note),
	);
	if (index < 0) return undefined;
	const payload = notes[index]
		.replace(/^wo:review FAIL(?:[ \t]*-[ \t]*|[ \t]+)/i, "")
		.trim();
	try {
		const value = JSON.parse(payload);
		if (Array.isArray(value.findings)) {
			const findings = value.findings.filter(
				(item) => typeof item === "string" && item.trim(),
			);
			if (findings.length === value.findings.length && findings.length)
				return { index, findings };
		}
	} catch {
		// Legacy compact reviewer notes carry one finding after the FAIL marker.
	}
	return payload ? { index, findings: [payload] } : undefined;
}

function dispositionNote(task, kind) {
	const notes = noteEntriesOf(task);
	for (let index = notes.length - 1; index >= 0; index -= 1) {
		const match = new RegExp(`^wo:${kind} PASS (\\{.*\\})$`, "i").exec(
			notes[index],
		);
		if (!match) continue;
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
				return { index, dispositions: value.dispositions };
		} catch {
			// Ignore malformed disposition notes and require a valid one.
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

function reviewEvents(task) {
	const notes = noteEntriesOf(task);
	const scopeIndex = notes.findLastIndex((note) =>
		/^wo:review-scope /i.test(note),
	);
	const all = notes.flatMap((note, index) => {
		const match = /^wo:review[ \t]+(PASS|FAIL)\b/i.exec(note);
		return match ? [{ index, status: match[1].toUpperCase() }] : [];
	});
	return {
		scopeIndex,
		postScope: all.filter((event) => event.index > scopeIndex),
		priorFailures: all.filter(
			(event) => event.index < scopeIndex && event.status === "FAIL",
		).length,
		priorPasses: all.filter(
			(event) => event.index < scopeIndex && event.status === "PASS",
		).length,
	};
}

function reviewDispositionSatisfied(task, productionFiles) {
	const { scopeIndex, postScope, priorFailures } = reviewEvents(task);
	if (postScope.at(-1)?.status === "PASS") return true;
	const failures = postScope.filter((event) => event.status === "FAIL").length;
	const target = targetedReviewFindings(task);
	let kind;
	if (failures >= 2 || (failures === 1 && priorFailures)) kind = "residual-fix";
	else if (failures === 1 || (failures === 0 && priorFailures))
		kind = "mechanical-fix";
	if (kind === "mechanical-fix" && productionFiles) return false;
	const disposition = kind && dispositionNote(task, kind);
	return (
		disposition?.index > scopeIndex && dispositionCovers(target, disposition)
	);
}

function verificationTimeoutMs() {
	const value = Number(
		process.env.WORK_ORCH_VERIFY_TIMEOUT_MS ?? 30 * 60 * 1000,
	);
	if (!Number.isInteger(value) || value < 1)
		throw new Error("WORK_ORCH_VERIFY_TIMEOUT_MS must be a positive integer");
	return value;
}

function validateVerificationCommand(command) {
	const value = command?.trim();
	if (!value) throw new Error("--verify requires a non-empty command");
	let quote = "";
	let escaped = false;
	for (const character of value) {
		if (escaped) {
			escaped = false;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = "";
		} else if (character === '"' || character === "'") quote = character;
	}
	if (quote)
		throw new Error("malformed --verify command: unmatched shell quote");
	if (
		/^(?:["'])?(?:ba|z|k)?sh(?:["'])?$|^(?:["'])?(?:cmd|powershell|pwsh)(?:\.exe)?(?:["'])?$/i.test(
			value,
		)
	)
		throw new Error("malformed --verify command: bare interactive shell");
}

function terminateVerificationTree(child) {
	if (!child.pid) return;
	try {
		if (process.platform === "win32")
			execFileSync("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
				stdio: "ignore",
			});
		else process.kill(-child.pid, "SIGKILL");
	} catch {
		child.kill("SIGKILL");
	}
}

function execVerification(command, shell, options, timeoutMs) {
	return new Promise((resolve, reject) => {
		let timedOut = false;
		let timer;
		const childOptions = {
			...options,
			detached: process.platform !== "win32",
			windowsHide: true,
		};
		const callback = (error, stdout, stderr) => {
			clearTimeout(timer);
			if (timedOut) {
				const timeoutError = new Error(
					`verification timed out after ${timeoutMs}ms`,
				);
				timeoutError.code = "ETIMEDOUT";
				timeoutError.stdout = stdout;
				timeoutError.stderr = stderr || timeoutError.message;
				reject(timeoutError);
			} else if (error) {
				error.stdout = stdout;
				error.stderr = stderr || error.message;
				reject(error);
			} else resolve({ stdout, stderr });
		};
		const child = shell
			? execFile(shell, ["-c", command], childOptions, callback)
			: exec(command, childOptions, callback);
		child.stdin?.end();
		timer = setTimeout(() => {
			timedOut = true;
			terminateVerificationTree(child);
		}, timeoutMs);
	});
}

async function runVerificationCommand(command, root = cwd, runtime = {}) {
	validateVerificationCommand(command);
	const options = {
		cwd: root,
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
		env: { ...process.env, ...(runtime.env ?? {}) },
	};
	const shell =
		process.env.WORK_ORCH_VERIFY_SHELL ||
		(process.platform === "win32" && process.env.MSYSTEM ? "bash" : "");
	const windowsCommand =
		process.platform === "win32" && /^\s*cmd(?:\.exe)?(?:\s|$)/i.test(command);
	const wrapper = command.match(/^(\s*)(gradlew(?:\.bat)?)(?=\s|$)/i);
	const normalized =
		shell && wrapper && existsSync(path.join(root, wrapper[2]))
			? command.replace(wrapper[0], `${wrapper[1]}./${wrapper[2]}`)
			: command;
	const result = await execVerification(
		normalized,
		!windowsCommand && shell ? shell : "",
		options,
		runtime.timeoutMs ?? verificationTimeoutMs(),
	);
	return { exitStatus: 0, stdout: result.stdout, stderr: result.stderr };
}

async function runVerification(command, shards = [], root = cwd) {
	if (!shards.length) {
		const result = await runVerificationCommand(command, root);
		return { output: String(result.stdout ?? ""), manifest: null };
	}
	const authoritativeCommand = shards.map((shard) => shard.command).join(" && ");
	if (command !== authoritativeCommand)
		throw new Error(
			"declared verification shards must exactly compose the authoritative --verify command in order",
		);
	let serialSetting = true;
	try {
		const settings = JSON.parse(
			readFileSync(
				path.join(
					process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent"),
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
		root,
		{ shards, authoritativeCommand, gateVersion: VERIFICATION_GATE_VERSION },
		async (shard) => runVerificationCommand(shard.command, root),
		{ serial: serialSetting, failFast: true, mutationOwner: true },
	);
	admitVerificationManifest(batch.manifest, {
		shards: batch.declarations,
		...batch.admission,
		authoritativeCommand,
		currentFingerprint: batch.currentFingerprint,
		gateVersion: VERIFICATION_GATE_VERSION,
	});
	return {
		output: batch.manifest.shards
			.map(
				(shard) => `${shard.id}:${shard.status}:${shard.outputHash.slice(0, 12)}`,
			)
			.join(", "),
		manifest: batch.manifest,
	};
}

function workspaceVerificationRevision(root) {
	const hash = createHash("sha256");
	let files = [];
	try {
		hash.update(git(["rev-parse", "HEAD"], root).trim());
		files = gitStatusPaths(root);
	} catch {
		hash.update(`no-git:${path.resolve(root)}`);
	}
	for (const file of files
		.filter(
			(item) => item !== ".ce-workflow/work-items.json" && !isRuntimePath(item),
		)
		.sort()) {
		hash.update(`\0${file}\0`);
		const absolute = path.join(root, file);
		if (existsSync(absolute) && statSync(absolute).isFile())
			hash.update(readFileSync(absolute));
		else hash.update("<deleted>");
	}
	return `workspace-sha256:${hash.digest("hex")}`;
}

function declaredOperationRoot(root, requested = ".") {
	const absolute = path.resolve(root, requested);
	const relative = path.relative(root, absolute).replaceAll("\\", "/");
	if (relative.startsWith("../") || path.isAbsolute(relative))
		throw new Error(
			`verification operation cwd escapes the repository: ${requested}`,
		);
	return absolute;
}

function assertionText(result, assertion, root) {
	if (assertion.target === "stdout") return String(result.stdout ?? "");
	if (assertion.target === "stderr") return String(result.stderr ?? "");
	if (assertion.target === "exit") return String(result.exitStatus);
	const absolute = path.resolve(root, assertion.path);
	const relative = path.relative(root, absolute).replaceAll("\\", "/");
	if (relative.startsWith("../") || path.isAbsolute(relative))
		throw new Error(
			`verification assertion path escapes the repository: ${assertion.path}`,
		);
	if (assertion.operator === "exists")
		return existsSync(absolute) ? "true" : "false";
	if (!existsSync(absolute) || !statSync(absolute).isFile())
		throw new Error(`verification assertion file is missing: ${assertion.path}`);
	if (assertion.operator === "sha256")
		return createHash("sha256").update(readFileSync(absolute)).digest("hex");
	return readFileSync(absolute, "utf8");
}

function assertDeclaredOperation(result, operation, root) {
	const failures = [];
	for (const assertion of operation.assertions) {
		const actual = assertionText(result, assertion, root);
		let pass = false;
		if (assertion.operator === "equals" || assertion.operator === "sha256")
			pass = actual === assertion.value;
		else if (assertion.operator === "includes")
			pass = actual.includes(assertion.value);
		else if (assertion.operator === "matches")
			pass = new RegExp(assertion.value, "u").test(actual);
		else if (assertion.operator === "exists") pass = actual === "true";
		if (!pass)
			failures.push(
				`${assertion.target}${assertion.path ? `:${assertion.path}` : ""} ${assertion.operator} ${JSON.stringify(assertion.value)} failed`,
			);
	}
	if (failures.length) throw new Error(failures.join("; "));
}

async function runDeclaredCommand(requirement, root) {
	const operation = requirement.operation;
	const operationRoot = declaredOperationRoot(root, operation.cwd);
	let result;
	try {
		result = await runVerificationCommand(operation.command, operationRoot, {
			timeoutMs: operation.timeoutMs,
			env: operation.env,
		});
	} catch (error) {
		const exitStatus = Number(error.code);
		if (!Number.isInteger(exitStatus) || exitStatus !== operation.expectedExit)
			throw error;
		result = {
			exitStatus,
			stdout: String(error.stdout ?? ""),
			stderr: String(error.stderr ?? ""),
		};
	}
	result.exitStatus ??= 0;
	if (result.exitStatus !== operation.expectedExit)
		throw new Error(
			`expected exit ${operation.expectedExit}, got ${result.exitStatus}`,
		);
	assertDeclaredOperation(result, operation, operationRoot);
	return {
		requirement,
		operation,
		operationRoot,
		result,
		output: String(result.stdout ?? "").trim(),
	};
}

function commandProofArtifacts(run) {
	const artifacts = [inlineResultArtifact("result", run.output)];
	const kinds = new Set(run.requirement.artifacts ?? []);
	if (kinds.has("stdout"))
		artifacts.push(inlineResultArtifact("stdout", run.result.stdout));
	if (kinds.has("stderr"))
		artifacts.push(inlineResultArtifact("stderr", run.result.stderr));
	for (const assertion of run.operation.assertions.filter(
		(entry) => entry.target === "file",
	))
		if (kinds.has("file"))
			artifacts.push(fileArtifact(run.operationRoot, "file", assertion.path));
	return artifacts;
}

async function finishTaskUnlocked(ownerRepositoryRoot, canonicalExecutionRoot) {
	const id = args[0];
	const message = option("--message");
	const maxFiles = Number(
		option("--max-files", command === "finish-small" ? 2 : 8),
	);
	if (!id || !message || !Number.isInteger(maxFiles) || maxFiles < 1)
		throw new Error(
			"usage: finish-task <work-item-id> --max-files <n> --message <summary> [--execution-root <git-path>] [--verify <command> [--verify-shard <json> ...] --expect <stdout> | --json <file> --equals <path=value>] [--implementation-file <task-owned-new-file> ...] [--evidence-file <docs/evidence/task-owned-file> ...] [--skip-format] [--reviewed] [--push]",
		);
	const executionRoot = canonicalExecutionRoot;
	const distinctRoots = canonicalExecutionRoot !== ownerRepositoryRoot;
	if (distinctRoots && flag("--push"))
		throw new Error(
			"distinct-root --push is not supported; push each repository explicitly after finalization",
		);
	const task = readWorkItem(id);
	if (!task) throw new Error(`Work item not found: ${id}`);
	const canonical = storePath(cwd);
	const canonicalBefore = existsSync(canonical)
		? readFileSync(canonical, "utf8")
		: null;
	const taskContractText = `${titleOf(task)}\n${field(task, "description") ?? ""}\n${field(task, "acceptance", "acceptance_criteria") ?? ""}`;
	const evidenceOnly = /\bevidence[- ](?:only|capture)\b/i.test(
		taskContractText,
	);
	const declaredImplementationFiles = [
		...new Set(options("--implementation-file").map(normalizeRepositoryPath)),
	];
	for (const file of declaredImplementationFiles) {
		const absolute = path.join(executionRoot, file);
		if (
			path.posix.isAbsolute(file) ||
			file.startsWith("../") ||
			file.startsWith(".ce-workflow/") ||
			isRuntimePath(file) ||
			!existsSync(absolute) ||
			!statSync(absolute).isFile()
		)
			throw new Error(
				`invalid implementation file ${file}: require an existing task-owned file inside the execution repository`,
			);
	}
	const priorScope = reviewScope(task)?.files ?? [];
	const ownedImplementationFiles = new Set([
		...declaredImplementationFiles,
		...priorScope.map(normalizeRepositoryPath),
	]);
	const taskEvidencePrefix = `docs/evidence/${id}`;
	const evidencePath = (file) =>
		file.startsWith(`${taskEvidencePrefix}/`) ||
		file.startsWith(`${taskEvidencePrefix}-`);
	const declaredEvidenceFiles = options("--evidence-file").map(
		normalizeRepositoryPath,
	);
	const automaticEvidenceFiles = evidenceOnly
		? gitStatusPaths(executionRoot).filter(evidencePath)
		: [];
	const evidenceFiles = [
		...new Set([
			...declaredEvidenceFiles,
			...automaticEvidenceFiles.filter((file) =>
				existsSync(path.join(executionRoot, file)),
			),
		]),
	];
	let evidenceBytes = 0;
	for (const file of evidenceFiles) {
		const absolute = path.join(executionRoot, file);
		const stat = existsSync(absolute) ? statSync(absolute) : undefined;
		if (
			path.posix.isAbsolute(file) ||
			file.startsWith("../") ||
			!evidencePath(file) ||
			!/\.(?:png|jpe?g|webp|txt|log|json)$/i.test(file) ||
			!stat?.isFile() ||
			stat.size > 10 * 1024 * 1024
		)
			throw new Error(
				`invalid evidence file ${file}: require an existing image or sanitized .txt/.log/.json file up to 10 MiB under docs/evidence/${id}...`,
			);
		evidenceBytes += stat.size;
	}
	if (evidenceFiles.length > 100 || evidenceBytes > 100 * 1024 * 1024)
		throw new Error(
			"task-owned evidence is limited to 100 files and 100 MiB per finish-task run",
		);
	const evidenceFileSet = new Set([...evidenceFiles, ...automaticEvidenceFiles]);
	const formatted = formatPendingFiles({
		cwd: executionRoot,
		files: gitStatusPaths(executionRoot),
		skip: flag("--skip-format"),
	});
	const stagedBefore = git(["diff", "--cached", "--name-only"], executionRoot)
		.split(/\r?\n/)
		.filter(Boolean);
	const unexpectedStaged = stagedBefore.filter((file) => {
		const normalized = normalizeRepositoryPath(file);
		return (
			!normalized.startsWith(".ce-workflow/") && !evidenceFileSet.has(normalized)
		);
	});
	if (unexpectedStaged.length)
		throw new Error(
			`refusing pre-staged files: ${unexpectedStaged.join(", ")}\nRun: git restore --staged -- ${unexpectedStaged.map((file) => JSON.stringify(file)).join(" ")}\nThen re-run finish-task; declare task-owned evidence under ${taskEvidencePrefix} with --evidence-file.`,
		);
	if (stagedBefore.length)
		git(["restore", "--staged", "--", ...stagedBefore], executionRoot);
	if (
		distinctRoots &&
		gitStatusPaths(executionRoot).includes(".ce-workflow/work-items.json")
	)
		throw new Error(
			"refusing changed .ce-workflow/work-items.json in distinct execution repository",
		);

	const verify = option("--verify");
	const shardDeclarations = options("--verify-shard").map((value, index) => {
		try {
			return JSON.parse(value);
		} catch {
			throw new Error(`--verify-shard ${index + 1} must be valid JSON`);
		}
	});
	const expected = option("--expect");
	if (shardDeclarations.length && expected !== undefined)
		throw new Error("--expect cannot be combined with --verify-shard");
	const normalizedShardDeclarations = shardDeclarations.length
		? normalizeVerificationShards(shardDeclarations)
		: [];
	const shardOutputs = normalizedShardDeclarations.flatMap(
		(shard) => shard.outputs,
	);
	const absentShardOutputs = new Set(
		shardOutputs.filter(
			(output) => !existsSync(path.join(executionRoot, output)),
		),
	);
	const jsonFile = option("--json");
	const executableContract = task.verificationContract
		? validateExecutableVerificationContract(task.verificationContract)
		: null;
	const commandRequirements =
		executableContract?.required.filter(
			(requirement) => requirement.capability === "command",
		) ?? [];
	const persistedLegacyContract = Boolean(
		executableContract?.required.every(
			(requirement) =>
				requirement.source === "explicit legacy finish verification",
		),
	);
	if (
		executableContract &&
		!persistedLegacyContract &&
		(jsonFile || expected !== undefined || shardDeclarations.length)
	)
		throw new Error(
			"contract-bearing finish uses each declared operation/assertion; --json, --expect, and --verify-shard are legacy-only",
		);
	if (
		executableContract &&
		!persistedLegacyContract &&
		verify &&
		(commandRequirements.length !== 1 ||
			verify !== commandRequirements[0].operation.command)
	)
		throw new Error(
			"--verify must exactly match the sole declared command operation",
		);
	if (!executableContract && shardDeclarations.length && !verify)
		throw new Error("--verify-shard requires --verify");
	if (!executableContract && !verify && !jsonFile)
		throw new Error("finish-task requires --verify or --json");
	let verificationResult;
	let verificationCommand;
	let verificationManifest;
	let output = "";
	let commandRuns = [];
	try {
		if (executableContract) {
			commandRuns = [];
			for (const requirement of commandRequirements)
				commandRuns.push(await runDeclaredCommand(requirement, executionRoot));
			verificationCommand = commandRuns
				.map((run) => run.operation.command)
				.join(" && ");
			output = commandRuns
				.map((run) => `${run.requirement.id}:${run.output}`)
				.join("\n");
		} else if (jsonFile) {
			verificationCommand = `json-assert ${jsonFile}`;
			const failures = jsonAssertionFailures(jsonFile, executionRoot);
			if (failures.length) throw new Error(failures.join("; "));
			output = "all JSON assertions passed";
		} else if (verify) {
			verificationCommand = verify;
			const verification = await runVerification(
				verify,
				normalizedShardDeclarations,
				executionRoot,
			);
			output = verification.output.trim();
			verificationManifest = verification.manifest;
			if (expected !== undefined && output !== expected)
				throw new Error(
					`expected ${JSON.stringify(expected)}, got ${JSON.stringify(output)}`,
				);
		}
	} catch (error) {
		const verificationError = String(
			error.stderr || error.message || error,
		).slice(-500);
		const verificationFailure = `wo:verify-check FAIL\nCommand: ${verificationCommand ?? "declared verification"}\n${verificationError}`;
		mutateStore(cwd, (store) => appendWorkNote(store, id, verificationFailure));
		throw new Error(
			`verification failed: ${verificationCommand ?? "declared verification"}\n${verificationError}`,
		);
	} finally {
		for (const outputPath of absentShardOutputs)
			rmSync(path.join(executionRoot, outputPath), {
				recursive: true,
				force: true,
			});
	}
	if (verificationCommand) {
		verificationResult = {
			command: verificationCommand,
			status: "PASS",
			output: output.slice(-500),
			...(verificationManifest
				? {
						gateVersion: verificationManifest.gateVersion,
						shards: verificationManifest.shards.map(({ id, status, outputHash }) => ({
							id,
							status,
							outputHash,
						})),
					}
				: {}),
		};
	}
	const tidy = tidyUntrackedFiles({
		cwd: executionRoot,
		gitBin,
		preserve: [...ownedImplementationFiles],
	});
	const unrecognized = tidy.unrecognized.filter((file) => {
		const normalized = normalizeRepositoryPath(file);
		return (
			!evidenceFileSet.has(normalized) && !ownedImplementationFiles.has(normalized)
		);
	});
	if (unrecognized.length)
		throw new Error(
			`untracked files need a decision before commit (add, gitignore, or remove):\n` +
				unrecognized.map((file) => `  - ${file}`).join("\n") +
				`\nFor each task-owned new implementation file, rerun with --implementation-file <path>; declare task-owned evidence under ${taskEvidencePrefix} with --evidence-file; resolve unrelated files first.`,
		);
	const changed = gitStatusPaths(executionRoot).filter(
		(file) =>
			!(distinctRoots && file === ".ce-workflow/work-items.json") &&
			(ownedImplementationFiles.has(file) ||
				(!isRuntimePath(file) && !isGeneratedBuildPath(file))),
	);
	const children = childWorkItems(id);
	const roadmapOnlyClose =
		!distinctRoots &&
		!changed.length &&
		/^(?:epic|initiative|roadmap)$/i.test(typeOf(task)) &&
		children.length > 0 &&
		children.every((child) => statusOf(child) === "closed");
	if (!changed.length && !roadmapOnlyClose)
		throw new Error("no related changes to commit");
	if (roadmapOnlyClose) changed.push(".ce-workflow/work-items.json");
	const implementationFiles = changed.filter(
		(file) => !file.startsWith(".ce-workflow/") && !evidenceFileSet.has(file),
	);
	if (implementationFiles.length > maxFiles)
		throw new Error(
			`scope exceeds ${maxFiles} implementation files: ${implementationFiles.join(", ")}`,
		);
	const reviewReasons = [];
	const sensitivePaths = implementationFiles.filter((file) =>
		/(?:^|\/)(?:migrations?|schema|auth|security|permissions?|payments?|billing|secrets?|deploy|infra)(?:\/|\.|$)|\.github\/workflows\//i.test(
			file,
		),
	);
	if (sensitivePaths.length)
		reviewReasons.push(`sensitive paths: ${sensitivePaths.join(", ")}`);
	if (
		implementationFiles.length > 0 &&
		/\b(?:auth(?:entication|orization)?|permission|credential|secret|payment|billing|migration|schema|database|destructive|production|deploy|release|breaking|concurren(?:cy|t)|race condition|thread safety|crypt|security|firmware flash)\b/i.test(
			taskContractText,
		)
	)
		reviewReasons.push("sensitive task contract");
	const numstat = implementationFiles.length
		? git(["diff", "--numstat", "--", ...implementationFiles], executionRoot)
		: "";
	let changedLines = numstat
		.split(/\r?\n/)
		.filter(Boolean)
		.reduce((sum, line) => {
			const [added, removed] = line.split("\t");
			return sum + (Number(added) || 0) + (Number(removed) || 0);
		}, 0);
	const untracked = new Set(
		git(["ls-files", "--others", "--exclude-standard"], executionRoot)
			.split(/\r?\n/)
			.filter(Boolean),
	);
	for (const file of implementationFiles.filter((item) => untracked.has(item))) {
		const absolute = path.join(executionRoot, file);
		if (!existsSync(absolute)) continue;
		changedLines +=
			statSync(absolute).size > 10 * 1024 * 1024
				? 301
				: readFileSync(absolute, "utf8").split(/\r?\n/).length;
	}
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
		implementationFiles.length > 0 &&
		!evidenceOnly &&
		/\b(?:hardware|firmware|device|live evidence|real[- ]world)\b/i.test(
			taskContractText,
		)
	)
		reviewReasons.push("hardware/live-evidence contract");
	const verificationRevision = workspaceVerificationRevision(executionRoot);
	let effectiveContract = executableContract;
	let effectiveRuns = commandRuns;
	if (!effectiveContract && ["task", "bug"].includes(typeOf(task))) {
		const legacyOperations = normalizedShardDeclarations.length
			? normalizedShardDeclarations.map((shard) => ({
					id: `legacy-${shard.id}`,
					command: shard.command,
				}))
			: [
					{
						id: "legacy-verification",
						command: verify ?? `json-assert ${jsonFile}`,
					},
				];
		effectiveContract = validateVerificationContract({
			version: 1,
			required: legacyOperations.map((operation) => ({
				id: operation.id,
				capability: "command",
				proof: "test",
				source: "explicit legacy finish verification",
				artifacts: ["result"],
				operation: {
					command: operation.command,
					expectedExit: 0,
					assertions: [
						{ target: "exit", operator: "equals", value: "0" },
						...(expected !== undefined && !normalizedShardDeclarations.length
							? [{ target: "stdout", operator: "equals", value: expected }]
							: []),
					],
				},
			})),
		});
		effectiveRuns = legacyOperations.map((operation) => ({
			requirement: effectiveContract.required.find(
				(requirement) => requirement.id === operation.id,
			),
			operation: {
				command: operation.command,
				exitCode: 0,
				cleanup: { ok: true },
			},
			artifacts: [inlineResultArtifact("result", output || "PASS")],
			output,
		}));
	}
	if (effectiveContract)
		mutateStore(cwd, (store) => {
			let updated = updateWorkItem(store, id, {
				verificationContract: effectiveContract,
				verificationRevision,
			});
			for (const commandRun of effectiveRuns)
				updated = addWorkEvidence(
					store,
					id,
					verificationProofRecord(effectiveContract, commandRun.requirement.id, {
						status: "PASS",
						targetRevision: verificationRevision,
						issuer: {
							type: "adapter",
							id: executableContract ? "native-command" : "legacy-finish-adapter",
							version: "1",
							capability: "command",
						},
						operation: commandRun.operation,
						artifacts: commandRun.artifacts ?? commandProofArtifacts(commandRun),
						detail: commandRun.operation.command,
					}),
				);
			return updated;
		});
	const proofState = verificationContractStatus(readWorkItem(id), {
		cwd: executionRoot,
		revision: effectiveContract ? verificationRevision : undefined,
		requireContract: Boolean(effectiveContract),
	});
	if (!proofState.ok)
		throw new Error(
			`verification contract incomplete: ${JSON.stringify({ missing: proofState.missing, blocked: proofState.blocked, stale: proofState.stale, untrusted: proofState.untrusted })}\nRecord required inspection/manual proof with work-proof; executable PASS is adapter-issued and unavailable capabilities must remain BLOCKED.`,
		);
	if (
		readReviewPolicy(executionRoot) === "review-all" &&
		hasProductionDiff(implementationFiles)
	)
		reviewReasons.push("Review All policy: production diff");
	if (reviewReasons.length) {
		const reviewed = flag("--reviewed");
		const persistedReviewScope = reviewScope(task);
		const currentReviewFingerprint = reviewFingerprint(
			executionRoot,
			implementationFiles,
		);
		const sameReviewFiles = sameFiles(
			persistedReviewScope?.files,
			implementationFiles,
		);
		const freshReviewScope =
			sameReviewFiles &&
			persistedReviewScope?.fingerprint === currentReviewFingerprint;
		const accepted =
			freshReviewScope &&
			reviewDispositionSatisfied(task, hasProductionDiff(implementationFiles));
		if (!accepted && !reviewed) {
			if (!freshReviewScope)
				mutateStore(cwd, (store) =>
					appendWorkNote(
						store,
						id,
						`wo:review-scope ${JSON.stringify({ files: implementationFiles, fingerprint: currentReviewFingerprint })}`,
					),
				);
			throw new Error(
				reviewerHandoff(
					id,
					implementationFiles,
					reviewReasons,
					canonicalExecutionRoot,
					ownerRepositoryRoot,
					distinctRoots,
				),
			);
		}
		if (!persistedReviewScope)
			throw new Error(
				"--reviewed requires a persisted wo:review-scope; rerun finish-task without --reviewed to generate the coded handoff",
			);
		if (!sameReviewFiles)
			throw new Error(
				"review scope changed; rerun finish-task without --reviewed to regenerate the coded handoff",
			);
		if (!freshReviewScope)
			throw new Error(
				"reviewed file content changed; rerun finish-task without --reviewed to regenerate the coded handoff",
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
	if (distinctRoots) {
		const ownerStaged = git(
			["diff", "--cached", "--name-only"],
			ownerRepositoryRoot,
		)
			.split(/\r?\n/)
			.filter(Boolean);
		if (ownerStaged.length)
			throw new Error(
				`refusing pre-staged owner files: ${ownerStaged.join(", ")}`,
			);
	}
	if (roadmapOnlyClose)
		mutateStore(cwd, (store) =>
			closeWorkItem(
				store,
				id,
				{
					evidence: [
						...(store.items[id]?.evidence ?? []),
						{ closeEvidence: "Completed by coded roadmap finalization" },
					],
				},
				{ cwd: executionRoot },
			),
		);
	git(["add", "-A", "--", ...changed], executionRoot);
	const staged = git(["diff", "--cached", "--name-only"], executionRoot)
		.split(/\r?\n/)
		.filter(Boolean);
	if (!staged.length)
		throw new Error("no staged changes after filtering runtime files");
	const executionHeadBefore = git(["rev-parse", "HEAD"], executionRoot).trim();
	const ownerHeadBefore = git(["rev-parse", "HEAD"], ownerRepositoryRoot).trim();
	let push = "skipped";
	let executionCommit;
	let ownerCommit = null;
	try {
		git(["commit", "-m", `${id}: ${message}`], executionRoot);
		executionCommit = git(["rev-parse", "HEAD"], executionRoot).trim();
		if (distinctRoots)
			mutateStore(cwd, (store) =>
				updateWorkItem(store, id, {
					executionRepositoryRoot: canonicalExecutionRoot,
					executionCommit,
				}),
			);
		if (!roadmapOnlyClose)
			mutateStore(cwd, (store) =>
				closeWorkItem(
					store,
					id,
					{
						evidence: [
							...(store.items[id]?.evidence ?? []),
							{ closeEvidence: "Completed by coded inline work path" },
						],
					},
					{ cwd: executionRoot },
				),
			);
		const ownerChanges = relevantChanges(ownerRepositoryRoot);
		if (ownerChanges.some((file) => file !== ".ce-workflow/work-items.json"))
			throw new Error(
				`non-work-store files changed during close: ${ownerChanges.join(", ")}`,
			);
		const storeTracked = Boolean(
			git(
				["ls-files", "--", ".ce-workflow/work-items.json"],
				ownerRepositoryRoot,
			).trim(),
		);
		if (storeTracked) {
			git(["add", "--", ".ce-workflow/work-items.json"], ownerRepositoryRoot);
			if (distinctRoots)
				git(
					["commit", "-m", `${id}: record execution metadata`],
					ownerRepositoryRoot,
				);
			else git(["commit", "--amend", "--no-edit"], executionRoot);
		}
		executionCommit = git(["rev-parse", "HEAD"], executionRoot).trim();
		ownerCommit = storeTracked
			? git(["rev-parse", "HEAD"], ownerRepositoryRoot).trim()
			: null;
		const executionRemaining = relevantChanges(executionRoot);
		const ownerRemaining = distinctRoots
			? relevantChanges(ownerRepositoryRoot)
			: executionRemaining;
		if (executionRemaining.length || ownerRemaining.length)
			throw new Error(
				`related files remain dirty: ${[
					...executionRemaining,
					...ownerRemaining,
				].join(", ")}`,
			);
		if (flag("--push")) {
			try {
				git(
					["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
					executionRoot,
				);
			} catch (error) {
				if (/upstream/i.test(String(error.stderr ?? error.message ?? error)))
					push = "skipped-no-upstream";
				else throw error;
			}
			if (push !== "skipped-no-upstream") {
				git(["push"], executionRoot);
				push = "passed";
			}
		}
	} catch (error) {
		if (distinctRoots)
			git(["reset", "--mixed", ownerHeadBefore], ownerRepositoryRoot);
		git(["reset", "--mixed", executionHeadBefore], executionRoot);
		if (canonicalBefore === null) rmSync(canonical, { force: true });
		else writeFileSync(canonical, canonicalBefore);
		throw new Error(
			`finalization rolled back before close: ${error.message ?? error}`,
		);
	}
	return {
		status: "PASS",
		work_item_id: id,
		commit: executionCommit.slice(0, 7),
		executionRepositoryRoot: canonicalExecutionRoot,
		executionCommit,
		ownerRepositoryRoot,
		ownerCommit,
		files: staged,
		verification: verificationResult,
		formatted,
		push,
		clean: true,
	};
}

async function finishTask() {
	const id = args[0];
	const verificationCommand = option("--verify");
	if (verificationCommand !== undefined && option("--json") !== undefined)
		throw new Error("--verify cannot be combined with --json");
	if (verificationCommand !== undefined) {
		validateVerificationCommand(verificationCommand);
		verificationTimeoutMs();
	}
	if (readWorkItem(id)?.initiative)
		throw new Error(
			`Initiative ${id} must be closed through /work-roadmap guarded close.`,
		);
	const requestedExecutionRoot = option("--execution-root");
	const executionRoot = canonicalGitRoot(
		requestedExecutionRoot ?? cwd,
		"execution root",
	);
	const ownerRoot = canonicalGitRoot(cwd, "owner root");
	const lockRoots =
		executionRoot === ownerRoot ? [ownerRoot] : [ownerRoot, executionRoot].sort();
	const mutations = [];
	try {
		for (const root of lockRoots)
			mutations.push(acquireRepositoryMutationLock(root));
		return await finishTaskUnlocked(ownerRoot, executionRoot);
	} finally {
		for (const mutation of mutations.reverse()) mutation.release();
	}
}

function arr(value) {
	if (Array.isArray(value)) return value;
	return value === null || value === undefined ? [] : [value];
}

function field(issue, ...names) {
	for (const name of names)
		if (issue?.[name] !== null && issue?.[name] !== undefined) return issue[name];
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

function noteEntriesOf(issue) {
	const notes = field(issue, "notes", "description", "body") ?? "";
	if (Array.isArray(notes)) return notes.map((note) => String(note));
	return (typeof notes === "string" ? notes : JSON.stringify(notes ?? "")).split(
		/\r?\n/,
	);
}

function notesOf(issue) {
	return noteEntriesOf(issue).join("\n");
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
		evidence_tail: arr(issue?.evidence).slice(-8),
		verificationContract: issue?.verificationContract,
		verificationStatus: verificationContractStatus(issue, { cwd }),
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

const BOOLEAN_OPTIONS = new Set([
	"--allow-work-store",
	"--append-notes",
	"--approved",
	"--full",
	"--immediate-format",
	"--push",
	"--reviewed",
	"--skip-format",
]);
const VALUE_OPTIONS = new Set([
	"--acceptance",
	"--add",
	"--approval",
	"--authority",
	"--blocker-code",
	"--by",
	"--bytes",
	"--confirm",
	"--decision-id",
	"--description",
	"--epic",
	"--equals",
	"--evidence-file",
	"--execution-root",
	"--expect",
	"--forbid-string",
	"--implementation-file",
	"--json",
	"--label",
	"--limit",
	"--max",
	"--max-files",
	"--message",
	"--note",
	"--notes",
	"--note-file",
	"--parent",
	"--proof-id",
	"--artifact",
	"--inspection",
	"--detail",
	"--result",
	"--resume-action",
	"--rationale",
	"--issuer",
	"--verification-contract",
	"--proposal-json",
	"--reason",
	"--remove",
	"--required",
	"--roadmap",
	"--status",
	"--token",
	"--type",
	"--verify",
	"--verify-shard",
]);

function parsedArguments() {
	const positionals = [];
	const flags = new Set();
	const values = new Map();
	const missingValues = new Set();
	if (command === "work-note")
		return { positionals: args, flags, values, missingValues };
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (!arg.startsWith("--")) {
			positionals.push(arg);
			continue;
		}
		if (BOOLEAN_OPTIONS.has(arg)) flags.add(arg);
		else if (!VALUE_OPTIONS.has(arg)) throw new Error(`unknown option: ${arg}`);
		else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
			values.set(arg, [...(values.get(arg) ?? []), args[i + 1]]);
			i += 1;
		} else missingValues.add(arg);
	}
	if (missingValues.size)
		throw new Error(`missing value for ${[...missingValues].join(", ")}`);
	return { positionals, flags, values, missingValues };
}

let parsed;

function options(name) {
	return parsed.values.get(name) ?? [];
}

function option(name, fallback = undefined) {
	return options(name)[0] ?? fallback;
}

function flag(name) {
	return parsed.flags.has(name);
}

function positional() {
	return parsed.positionals;
}

function termScore(issue, terms) {
	const haystack =
		`${titleOf(issue)}\n${labelsOf(issue).join(" ")}\n${notesOf(issue).slice(-2000)}`.toLowerCase();
	return terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
}

function jsonPath(object, key) {
	return key.split(".").reduce((value, part) => value?.[part], object);
}

function jsonAssertionFailures(file, root = cwd) {
	let data;
	try {
		data = JSON.parse(readFileSync(path.resolve(root, file), "utf8"));
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
	for (const assertion of options("--equals")) {
		const separator = assertion.indexOf("=");
		if (separator < 0) {
			failures.push(`invalid --equals ${assertion}`);
			continue;
		}
		const key = assertion.slice(0, separator);
		const expected = assertion.slice(separator + 1);
		if (String(jsonPath(data, key)) !== expected)
			failures.push(`${key} != ${expected}`);
	}
	if (parsed.missingValues.has("--forbid-string"))
		failures.push("missing --forbid-string value");
	for (const forbidden of options("--forbid-string")) {
		if (JSON.stringify(data).includes(forbidden))
			failures.push(`forbidden string ${forbidden}`);
	}
	return failures;
}

try {
	parsed = parsedArguments();
	if (command === "work-summary") {
		const issue = readWorkItem(args[0]);
		print(summary(issue));
	} else if (command === "work-children-summary") {
		const full = flag("--full");
		const status = option("--status");
		const children = childWorkItems(args[0]).filter(
			(issue) => !status || statusOf(issue) === status,
		);
		const requestedLimit = Number(option("--limit", full ? children.length : 50));
		const limit =
			Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : 50;
		const shown = children
			.slice(0, limit)
			.map((issue) => (full ? summary(issue, 300) : compactChildSummary(issue)));
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
		const scope = epic ? descendantIds(epic) : undefined;
		print(
			readyNativeWorkItems()
				.filter((issue) => !scope || scope.has(idOf(issue)))
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
			"--with-filename",
			"--field-match-separator=\\x00",
			query,
			...(paths.length ? paths : ["."]),
		];
		let raw = "";
		let exitCode = 0;
		try {
			raw = run("rg", rgArgs);
		} catch (error) {
			raw = String(error.stdout ?? "");
			exitCode = Number.isInteger(error.status) ? error.status : 2;
		}
		const encodedLines = raw.split(/\r?\n/).filter(Boolean);
		const byFile = {};
		for (const line of encodedLines) {
			const separator = line.indexOf("\0");
			const file = separator < 0 ? "<unknown>" : line.slice(0, separator);
			byFile[file] = (byFile[file] ?? 0) + 1;
		}
		raw = raw.replaceAll("\0", ":");
		const fullLogPath =
			raw.length > bytes ? artifact(command, "txt", raw) : undefined;
		const lines = raw.split(/\r?\n/).filter(Boolean);
		const capped = capText(raw, bytes);
		let status = exitCode > 1 ? "ERROR" : "PASS";
		if (exitCode <= 1 && lines.length) status = "found";
		else if (exitCode <= 1 && command === "scan-capability") status = "missing";
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
		const allowWorkStore = flag("--allow-work-store");
		const staged = git(["diff", "--cached", "--name-only"])
			.split(/\r?\n/)
			.filter(Boolean);
		const allowed = allowWorkStore
			? staged.filter((file) => file.startsWith(".ce-workflow/"))
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
				"usage: work-create <title> [--parent <id>] [--type <type>] [--description <text>] [--acceptance <text>] [--note|--notes <text>] [--verification-contract <json>] [--label <label>]",
			);
		const labels = options("--label");
		const contractText = option("--verification-contract");
		let verificationContract;
		if (contractText) {
			try {
				verificationContract = validateVerificationContract(
					JSON.parse(contractText),
				);
			} catch (error) {
				throw new Error(`invalid --verification-contract: ${error.message}`);
			}
		}
		const created = mutateStore(cwd, (store) =>
			createWorkItem(store, {
				title,
				parentId: option("--parent"),
				type: option("--type", "task"),
				description: option("--description", ""),
				acceptance: option("--acceptance", ""),
				notes: [...options("--note"), ...options("--notes")],
				labels,
				verificationContract,
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
	} else if (command === "work-run-proof") {
		const [id, proofId] = positional();
		const task = readWorkItem(id);
		if (!task?.verificationContract || !proofId)
			throw new Error(
				"usage: work-run-proof <work-item-id> <proof-id> [--inspection <goal observation>]",
			);
		const requirement = task.verificationContract.required.find(
			(entry) => entry.id === proofId,
		);
		if (!requirement)
			throw new Error(`verification proof is not declared: ${proofId}`);
		const revision = workspaceVerificationRevision(cwd);
		const result = runCapabilityAdapter({
			cwd,
			requirement,
			revision,
			inspection: option("--inspection"),
		});
		const record = verificationProofRecord(task.verificationContract, proofId, {
			...result,
			targetRevision: result.targetRevision ?? revision,
		});
		const updated = mutateStore(cwd, (store) => {
			updateWorkItem(store, id, {
				verificationRevision: revision,
				...(record.status === "BLOCKED" ? { status: "blocked" } : {}),
			});
			return addWorkEvidence(store, id, record);
		});
		print({
			status: "recorded",
			proof: record,
			verificationStatus: verificationContractStatus(updated, { cwd, revision }),
		});
	} else if (command === "work-proof") {
		const [id, positionalProofId] = positional();
		const proofId = option("--proof-id", positionalProofId);
		if (!id || !proofId)
			throw new Error(
				"usage: work-proof <work-item-id> <proof-id> [--status PASS|FAIL|BLOCKED] [--result <text>] [--artifact <kind=path> ...] [--inspection <summary>] [--by goal|human] [--issuer <id>] [--blocker-code <code> --resume-action <action>] [--detail <text>]",
			);
		const task = readWorkItem(id);
		if (!task?.verificationContract)
			throw new Error(`WorkItem ${id} has no verification contract`);
		const requirement = task.verificationContract.required.find(
			(entry) => entry.id === proofId,
		);
		if (!requirement)
			throw new Error(`verification proof is not declared: ${proofId}`);
		const status = String(option("--status", "PASS")).toUpperCase();
		if (
			status === "PASS" &&
			!["inspection", "manual"].includes(requirement.capability)
		)
			throw new Error(
				`${requirement.capability} PASS is issued only by its coded adapter`,
			);
		const by = option(
			"--by",
			requirement.capability === "manual" ? "human" : "goal",
		);
		if (
			status === "PASS" &&
			requirement.capability === "manual" &&
			by !== "human"
		)
			throw new Error("manual PASS requires human authority");
		const artifacts = options("--artifact").map((value) => {
			const separator = value.indexOf("=");
			if (separator < 1) throw new Error("--artifact must use kind=path");
			return fileArtifact(
				cwd,
				value.slice(0, separator),
				value.slice(separator + 1),
			);
		});
		if (option("--result") !== undefined)
			artifacts.push(inlineResultArtifact("result", option("--result")));
		const revision = workspaceVerificationRevision(cwd);
		const inspection = option("--inspection");
		const record = verificationProofRecord(task.verificationContract, proofId, {
			status,
			targetRevision: revision,
			...(status === "PASS"
				? {
						issuer: {
							type: by,
							id: option("--issuer", by),
						},
					}
				: {}),
			artifacts,
			...(inspection ? { inspection: { by, summary: inspection } } : {}),
			...(status === "BLOCKED"
				? {
						blocker: {
							code: option("--blocker-code"),
							resumeAction: option("--resume-action"),
						},
					}
				: {}),
			detail: option("--detail"),
		});
		const updated = mutateStore(cwd, (store) => {
			updateWorkItem(store, id, {
				verificationRevision: revision,
				...(status === "BLOCKED" ? { status: "blocked" } : {}),
			});
			return addWorkEvidence(store, id, record);
		});
		print({
			status: "recorded",
			proof: record,
			verificationStatus: verificationContractStatus(updated, {
				cwd,
				revision,
			}),
		});
	} else if (command === "work-waive") {
		const [id, proofId] = positional();
		const task = readWorkItem(id);
		const decisionId = option("--decision-id");
		if (!task?.verificationContract || !proofId || !decisionId)
			throw new Error(
				"usage: work-waive <work-item-id> <proof-id> --decision-id <recorded-human-decision> --authority <user-id> --rationale <text>",
			);
		const revision = workspaceVerificationRevision(cwd);
		const waiver = verificationWaiverRecord(task.verificationContract, proofId, {
			targetRevision: revision,
			authority: {
				type: "human",
				id: option("--authority"),
				decisionId,
			},
			rationale: option("--rationale"),
		});
		const updated = mutateStore(cwd, (store) =>
			updateWorkItem(store, id, {
				verificationRevision: revision,
				verificationWaivers: [
					...(store.items[id].verificationWaivers ?? []),
					waiver,
				],
			}),
		);
		const verificationStatus = verificationContractStatus(updated, {
			cwd,
			revision,
		});
		if (!verificationStatus.waived.includes(proofId))
			throw new Error(
				`human decision ${decisionId} is absent, unapproved, or does not authorize ${proofId}`,
			);
		print({ status: "recorded", waiver, verificationStatus });
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
			return closeWorkItem(
				store,
				id,
				{ notes: note ? [...current.notes, note] : current.notes },
				{ cwd },
			);
		});
		print(summary(closed, 300));
	} else if (command === "work-claim") {
		const id = args[0];
		const claimed = mutateStore(cwd, (store) => {
			const current = store.items[id];
			if (!current) throw new Error(`WorkItem not found: ${id}`);
			return updateWorkItem(store, id, {
				status: "in_progress",
				verificationContract:
					current.verificationContract ?? compatibilityVerificationContract(current),
			});
		});
		print(summary(claimed, 300));
	} else if (command === "work-note") {
		const [id] = args;
		const noteArgs = args.slice(args[1] === "--append-notes" ? 2 : 1);
		if (!id || !noteArgs.length)
			throw new Error(
				"usage: work-note <work-item-id> [--append-notes] <note>|--note-file <path>",
			);
		let note;
		if (noteArgs[0] === "--note-file") {
			const requested = noteArgs[1];
			const file = requested ? path.resolve(cwd, requested) : "";
			const fileInfo = file && existsSync(file) ? statSync(file) : undefined;
			const canonicalFile = fileInfo ? realpathSync(file) : "";
			if (
				noteArgs.length !== 2 ||
				path.isAbsolute(requested) ||
				!file ||
				pathEscapes(cwd, file) ||
				!fileInfo?.isFile() ||
				fileInfo.size > 1024 * 1024 ||
				pathEscapes(realpathSync(cwd), canonicalFile)
			)
				throw new Error(
					"--note-file requires one repository-contained file up to 1 MiB",
				);
			note = readFileSync(file, "utf8");
		} else note = noteArgs.join(" ");
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
				command === "bootstrap-plan-epic"
					? "usage: bootstrap-plan-epic <plan-path> [--epic <existing-epic-id>]"
					: "usage: bootstrap-plan-roadmap <plan-path> [--roadmap <existing-roadmap-id>]",
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
			"usage: work-helper <work-summary|work-children-summary|work-ready-summary|work-create|work-run-proof|work-proof|work-close|work-claim|work-note|work-label|work-block|blocker-search|search-summary|scan-capability|finish-task|finish-small|ensure-no-staged|initiative-summary|initiative-preview|initiative-apply|bootstrap-plan-roadmap|bootstrap-plan-epic|legacy-instructions-preview|legacy-instructions-apply|json-assert> ...",
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
