import { execFileSync } from "node:child_process";
import {
	accessSync,
	constants,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import {
	gitTrackedEntries,
	inspectCompoundSource,
	readConfinedFile,
	sha256,
} from "./work-compound-source.js";
import {
	assertCompletePrivateWorkflowParity,
	verifyPrivateWorkflowGeneration,
} from "./work-private-workflows.js";
import {
	translateVerifiedWorkflows,
	writePrivateWorkflowGeneration,
} from "../scripts/generate-work-private-workflows.mjs";

export const PRIVATE_WORKFLOW_OWNED_OUTPUTS = [
	"extensions/private-workflows/brainstorm.md",
	"extensions/private-workflows/browser.md",
	"extensions/private-workflows/debug.md",
	"extensions/private-workflows/explain.md",
	"extensions/private-workflows/learning.md",
	"extensions/private-workflows/manifest.json",
	"extensions/private-workflows/plan.md",
	"extensions/private-workflows/pov.md",
	"extensions/private-workflows/provenance.json",
	"extensions/private-workflows/review.md",
	"extensions/private-workflows/simplify.md",
];

export const PRIVATE_WORKFLOW_RELEASE_GATES = [
	{
		name: "u4-private-workflow-parity",
		command: process.execPath,
		args: ["scripts/test-work-private-workflows.mjs"],
	},
	{
		name: "package-work-goal",
		command: process.execPath,
		args: ["scripts/test-work-goal.mjs"],
	},
];

const PRIVATE_NAMES = PRIVATE_WORKFLOW_OWNED_OUTPUTS.map((entry) => path.posix.basename(entry)).sort();
const ALLOWED_AMBIENT_DIRT = new Set([".ce-workflow/work-items.json"]);

function json(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function releaseParts(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? ""));
	return match ? match.slice(1).map(Number) : undefined;
}

function compareVersions(left, right) {
	const a = releaseParts(left);
	const b = releaseParts(right);
	if (!a || !b) return 0;
	for (let index = 0; index < 3; index++) {
		if (a[index] !== b[index]) return a[index] - b[index];
	}
	return 0;
}

export function resolveLatestOfficialStableRelease(descriptor, options = {}) {
	if (options.offline ?? process.env.WORK_CATCH_UP_OFFLINE === "1")
		return { status: "unknown", reason: "offline" };
	const repository = String(descriptor?.repository ?? "").trim();
	const currentVersion = String(descriptor?.version ?? "").trim();
	const currentRelease = String(descriptor?.release ?? "").trim();
	if (!repository || !releaseParts(currentVersion) || !currentRelease.endsWith(currentVersion))
		return { status: "blocked", reason: "invalid official stable-release descriptor" };
	try {
		const output = (options.execFileSync ?? execFileSync)(
			"git",
			["ls-remote", "--tags", repository],
			{
				encoding: "utf8",
				env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
				timeout: 30_000,
			},
		);
		const refs = new Map();
		for (const line of String(output).trim().split(/\r?\n/).filter(Boolean)) {
			const [sha, ref] = line.split(/\s+/, 2);
			if (ref?.startsWith("refs/tags/")) refs.set(ref, sha);
		}
		const prefix = currentRelease.slice(0, -currentVersion.length);
		const candidates = [];
		for (const [ref, objectSha] of refs) {
			if (ref.endsWith("^{}")) continue;
			const release = ref.slice("refs/tags/".length);
			if (!release.startsWith(prefix)) continue;
			const version = release.slice(prefix.length);
			if (!releaseParts(version)) continue;
			candidates.push({
				release,
				version,
				peeledCommitSha: refs.get(`${ref}^{}`) ?? objectSha,
			});
		}
		candidates.sort((left, right) => compareVersions(right.version, left.version));
		const latest = candidates[0];
		if (!latest) return { status: "unknown", reason: "no official stable tag found" };
		return {
			status: compareVersions(latest.version, currentVersion) > 0 ? "update" : "current",
			...latest,
		};
	} catch (error) {
		return { status: "failed", reason: String(error?.message ?? error) };
	}
}

export function classifyPrivateWorkflowRelease({
	resolution,
	writable = true,
	dirtyPaths = [],
}) {
	if (!writable) return { status: "non-writable", reason: "owned outputs are not writable" };
	const unrelated = dirtyPaths.filter(
		(entry) =>
			!ALLOWED_AMBIENT_DIRT.has(entry) &&
			!PRIVATE_WORKFLOW_OWNED_OUTPUTS.includes(entry) &&
			!entry.startsWith(".ce-workflow/work-runs/"),
	);
	if (unrelated.length)
		return { status: "unrelated-dirt", reason: "unrelated dirty worktree", dirtyPaths: unrelated.sort() };
	if (!["current", "update", "unknown", "blocked", "failed"].includes(resolution?.status))
		return { status: "unknown", reason: "release resolution was incomplete" };
	return resolution;
}

function directorySnapshot(root) {
	const result = {};
	for (const name of readdirSync(root).sort()) {
		const file = path.join(root, name);
		result[name] = { bytes: readFileSync(file), sha256: sha256(readFileSync(file)) };
	}
	return result;
}

function snapshotHashes(snapshot) {
	return Object.fromEntries(
		Object.entries(snapshot).map(([name, entry]) => [name, entry.sha256]),
	);
}

function assertExactOwnedNames(root) {
	const names = readdirSync(root).sort();
	if (JSON.stringify(names) !== JSON.stringify(PRIVATE_NAMES))
		throw new Error(`owned output declaration mismatch: ${names.join(",")}`);
}

function assertSnapshot(root, expected, label) {
	assertExactOwnedNames(root);
	const actual = directorySnapshot(root);
	for (const [name, entry] of Object.entries(expected)) {
		if (!actual[name] || !actual[name].bytes.equals(entry.bytes))
			throw new Error(`${label} changed: ${name}`);
	}
}

function restoreSnapshot(root, snapshot) {
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
	for (const [name, entry] of Object.entries(snapshot))
		writeFileSync(path.join(root, name), entry.bytes);
}

function equalGenerations(left, right) {
	const leftNames = Object.keys(left).sort();
	const rightNames = Object.keys(right).sort();
	return (
		JSON.stringify(leftNames) === JSON.stringify(rightNames) &&
		leftNames.every((name) => Buffer.from(left[name]).equals(Buffer.from(right[name])))
	);
}

function defaultDirtyPaths(repositoryRoot) {
	const output = execFileSync(
		"git",
		["status", "--porcelain=v1", "-z", "--untracked-files=all"],
		{ cwd: repositoryRoot, encoding: "utf8", timeout: 15_000 },
	);
	const records = output.split("\0").filter(Boolean);
	const paths = [];
	for (let index = 0; index < records.length; index++) {
		const record = records[index];
		paths.push(record.slice(3).replaceAll("\\", "/"));
		if (record[0] === "R" || record[1] === "R") paths.push(records[++index]?.replaceAll("\\", "/"));
	}
	return paths.filter(Boolean);
}

function defaultWritable(repositoryRoot) {
	try {
		accessSync(path.join(repositoryRoot, "extensions"), constants.W_OK);
		for (const relativePath of PRIVATE_WORKFLOW_OWNED_OUTPUTS)
			accessSync(path.join(repositoryRoot, ...relativePath.split("/")), constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

function runDefaultGate(gate, repositoryRoot) {
	execFileSync(gate.command, gate.args, {
		cwd: repositoryRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		maxBuffer: 64 * 1024 * 1024,
		timeout: 300_000,
	});
	return true;
}

function archiveUrl(repository, release) {
	const match = /^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/.exec(repository);
	if (!match) throw new Error("unsupported official repository URL");
	return `https://codeload.github.com/${match[1]}/${match[2]}/tar.gz/refs/tags/${release}`;
}

async function acquireOfficialCandidate({ quarantineRoot, descriptor, resolution, fetchImpl = fetch }) {
	const sourceRoot = path.join(quarantineRoot, "source");
	execFileSync(
		"git",
		["clone", "--quiet", "--depth", "1", "--branch", resolution.release, descriptor.repository, sourceRoot],
		{ env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, timeout: 180_000 },
	);
	const checkoutSha = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim();
	if (checkoutSha !== resolution.peeledCommitSha)
		throw new Error("official stable tag changed during acquisition");
	const response = await fetchImpl(archiveUrl(descriptor.repository, resolution.release), {
		redirect: "follow",
	});
	if (!response.ok) throw new Error(`official archive download failed: HTTP ${response.status}`);
	const archiveBytes = Buffer.from(await response.arrayBuffer());
	const tracked = gitTrackedEntries(sourceRoot);
	const allowed = new Set(tracked.map((entry) => entry.path));
	const manifest = JSON.parse(readConfinedFile(sourceRoot, "package.json", allowed));
	const licenseBytes = readConfinedFile(sourceRoot, descriptor.license.path, allowed);
	const policy = {
		...descriptor,
		release: resolution.release,
		version: resolution.version,
		peeledCommitSha: resolution.peeledCommitSha,
		archive: {
			url: response.url,
			sha256: sha256(archiveBytes),
			bytes: archiveBytes.length,
		},
		license: { ...descriptor.license, sha256: sha256(licenseBytes) },
	};
	if (manifest.version !== resolution.version)
		throw new Error("official stable tag version mismatch");
	const inspected = inspectCompoundSource({
		root: sourceRoot,
		policy,
		commitSha: checkoutSha,
		trackedEntries: tracked,
	});
	const imported = new Map(inspected.importedFiles.map((entry) => [entry.path, entry]));
	const evidence = {
		schemaVersion: 1,
		release: resolution.release,
		peeledCommitSha: checkoutSha,
		archive: policy.archive,
		licenseEvidence: inspected.licenseEvidence,
		runtimeProbe: {
			zeroEffectiveSurface: true,
			basis: "U1 filtered-entry contract plus exact known manifest surface",
			filteredEntry: { extensions: [], skills: [], prompts: [], themes: [] },
		},
		inventory: {
			resourceClosures: Object.fromEntries(
				Object.entries(inspected.closures).map(([workflow, paths]) => [
					workflow,
					paths.map((entry) => imported.get(entry)),
				]),
			),
		},
		containment: {
			temporarySourceOnly: true,
			globalStateUnchanged: true,
		},
	};
	return { sourceRoot, evidence, policy };
}

function releaseAudit({ current, candidate, generated, parity, gates }) {
	const before = snapshotHashes(current);
	const after = Object.fromEntries(
		Object.entries(generated)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([name, bytes]) => [name, sha256(bytes)]),
	);
	const priorSources = candidate.currentProvenance?.sources ?? [];
	const priorSourceHashes = new Map(priorSources.map((entry) => [entry.path, entry.sha256]));
	const nextSources = candidate.evidence.inventory.resourceClosures;
	const nextSourceEntries = Object.values(nextSources).flat();
	const nextSourceHashes = new Map(nextSourceEntries.map((entry) => [entry.path, entry.sha256]));
	return {
		schemaVersion: 1,
		classification: "update",
		ownedOutputs: PRIVATE_WORKFLOW_OWNED_OUTPUTS,
		source: {
			fromRelease: candidate.currentProvenance?.release ?? "unknown",
			toRelease: candidate.evidence.release,
			peeledCommitSha: candidate.evidence.peeledCommitSha,
			archiveSha256: candidate.evidence.archive.sha256,
			changedPaths: [...new Set([
				...priorSources.map((entry) => entry.path),
				...nextSourceEntries.map((entry) => entry.path),
			])]
				.filter((entry) => priorSourceHashes.get(entry) !== nextSourceHashes.get(entry))
				.sort(),
		},
		closure: Object.fromEntries(
			Object.entries(nextSources).map(([workflow, entries]) => [
				workflow,
				entries.map(({ path: sourcePath, sha256: sourceSha256 }) => ({
					path: sourcePath,
					sha256: sourceSha256,
				})),
			]),
		),
		translatedOutputs: {
			changedPaths: [...new Set([...Object.keys(before), ...Object.keys(after)])]
				.filter((entry) => before[entry] !== after[entry])
				.sort(),
			before,
			after,
		},
		provenance: {
			license: candidate.evidence.licenseEvidence,
			translator: JSON.parse(generated["provenance.json"]).translator,
		},
		compatibility: {
			zeroEffectiveSurface: candidate.evidence.runtimeProbe.zeroEffectiveSurface,
			parity,
			gates,
		},
		quarantineRemoved: true,
	};
}

export async function promoteVerifiedPrivateWorkflowRelease(options) {
	const repositoryRoot = path.resolve(options.repositoryRoot);
	const canonicalRoot = path.join(repositoryRoot, "extensions", "private-workflows");
	let dirtyPaths;
	try {
		dirtyPaths = (options.dirtyPaths ?? defaultDirtyPaths)(repositoryRoot);
	} catch (error) {
		return { status: "failed", phase: "worktree", reason: String(error?.message ?? error) };
	}
	const classification = classifyPrivateWorkflowRelease({
		resolution: options.resolution,
		writable: (options.writable ?? defaultWritable)(repositoryRoot),
		dirtyPaths,
	});
	if (classification.status !== "update") return classification;

	const artifactRoot = path.join(repositoryRoot, ".ce-workflow", "work-runs", "compound-releases");
	mkdirSync(artifactRoot, { recursive: true });
	const quarantineRoot = mkdtempSync(path.join(artifactRoot, "quarantine-"));
	const candidateRoot = path.join(quarantineRoot, "candidate");
	const transactionPrior = path.join(quarantineRoot, "prior");
	let canonicalMoved = false;
	let candidateInstalled = false;
	let auditPath;
	let retentionPath;
	let current;
	try {
		assertExactOwnedNames(canonicalRoot);
		verifyPrivateWorkflowGeneration(canonicalRoot);
		current = directorySnapshot(canonicalRoot);
		const currentProvenance = JSON.parse(current["provenance.json"].bytes);
		const acquired = await (options.acquireCandidate ?? acquireOfficialCandidate)({
			quarantineRoot,
			descriptor: options.descriptor,
			resolution: options.resolution,
			fetchImpl: options.fetchImpl,
		});
		const translator = options.translate ?? translateVerifiedWorkflows;
		const translationArgs = { ...acquired, currentProvenance };
		const first = translator(translationArgs);
		await options.interrupt?.("after-first-generation");
		const second = translator(translationArgs);
		if (!equalGenerations(first, second))
			throw new Error("deterministic generation gate failed");
		writePrivateWorkflowGeneration(candidateRoot, first);
		assertExactOwnedNames(candidateRoot);
		verifyPrivateWorkflowGeneration(candidateRoot);
		let parity;
		try {
			parity = (options.parityCheck ?? assertCompletePrivateWorkflowParity)() === true;
		} catch (error) {
			return {
				status: "blocked",
				phase: "parity",
				reason: String(error?.message ?? error),
				quarantineRemoved: true,
			};
		}
		const gates = [];
		for (const gate of options.gates ?? PRIVATE_WORKFLOW_RELEASE_GATES) {
			const passed = await (options.runGate ?? runDefaultGate)(gate, repositoryRoot, candidateRoot);
			if (passed !== true) throw new Error(`release gate failed: ${gate.name}`);
			gates.push({ name: gate.name, status: "passed" });
		}
		await options.interrupt?.("after-gates");
		assertSnapshot(canonicalRoot, current, "canonical generation during verification");
		const audit = releaseAudit({
			current,
			candidate: { ...acquired, currentProvenance },
			generated: first,
			parity: { complete: parity, rows: 9 },
			gates,
		});
		const generation = JSON.parse(first["manifest.json"]).generationSha256;
		const priorGeneration = JSON.parse(current["manifest.json"].bytes).generationSha256;
		const evidenceRoot = path.join(artifactRoot, generation);
		retentionPath = path.join(artifactRoot, "prior", priorGeneration);
		auditPath = path.join(evidenceRoot, "audit.json");
		mkdirSync(evidenceRoot, { recursive: true });
		writeFileSync(auditPath, json(audit));
		renameSync(canonicalRoot, transactionPrior);
		canonicalMoved = true;
		await options.interrupt?.("after-prior-rename");
		renameSync(candidateRoot, canonicalRoot);
		candidateInstalled = true;
		await options.interrupt?.("after-candidate-rename");
		verifyPrivateWorkflowGeneration(canonicalRoot);
		assertSnapshot(canonicalRoot, directorySnapshot(canonicalRoot), "promoted generation");
		mkdirSync(path.dirname(retentionPath), { recursive: true });
		if (existsSync(retentionPath)) {
			assertSnapshot(retentionPath, current, "retained prior generation");
			rmSync(transactionPrior, { recursive: true, force: true });
		} else {
			renameSync(transactionPrior, retentionPath);
		}
		canonicalMoved = false;
		return {
			status: "promoted",
			release: acquired.evidence.release,
			generationSha256: generation,
			ownedOutputs: PRIVATE_WORKFLOW_OWNED_OUTPUTS,
			auditPath,
			retainedGenerationPath: retentionPath,
			gates,
			quarantineRemoved: true,
		};
	} catch (error) {
		try {
			if (candidateInstalled && existsSync(canonicalRoot))
				rmSync(canonicalRoot, { recursive: true, force: true });
			if (canonicalMoved) {
				if (existsSync(transactionPrior)) renameSync(transactionPrior, canonicalRoot);
				else if (retentionPath && existsSync(retentionPath)) cpSync(retentionPath, canonicalRoot, { recursive: true });
			} else if (current && existsSync(canonicalRoot)) {
				try {
					assertSnapshot(canonicalRoot, current, "canonical generation");
				} catch {
					restoreSnapshot(canonicalRoot, current);
				}
			}
		} finally {
			if (auditPath) rmSync(path.dirname(auditPath), { recursive: true, force: true });
		}
		const reason = String(error?.message ?? error);
		const blocked = /(?:unknown .* surface|unresolved|unsafe|symlink|collision|identity|license|closure|source resource changed|deterministic generation|owned output|canonical generation.*changed)/i.test(reason);
		return {
			status: blocked ? "blocked" : "failed",
			phase: "promotion",
			reason,
			quarantineRemoved: true,
		};
	} finally {
		rmSync(quarantineRoot, { recursive: true, force: true, maxRetries: 3 });
	}
}
