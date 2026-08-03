import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

export function normalizeSourcePath(relativePath) {
	if (
		typeof relativePath !== "string" ||
		!relativePath ||
		path.isAbsolute(relativePath) ||
		relativePath.includes("\\") ||
		relativePath.includes("\0")
	)
		throw new Error(`unsafe source path: ${relativePath}`);
	const normalized = path.posix.normalize(relativePath);
	if (normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/"))
		throw new Error(`source path escapes quarantine: ${relativePath}`);
	for (const segment of normalized.split("/")) {
		if (!segment || segment === "." || segment === "..")
			throw new Error(`unsafe source path segment: ${relativePath}`);
		if (/[. ]$/.test(segment) || WINDOWS_RESERVED.test(segment))
			throw new Error(`source path is not Windows portable: ${relativePath}`);
	}
	return normalized;
}

function windowsPathKey(relativePath) {
	return normalizeSourcePath(relativePath)
		.normalize("NFKC")
		.toLocaleLowerCase("en-US");
}

function confinedAbsolute(root, relativePath) {
	const normalized = normalizeSourcePath(relativePath);
	const absolute = path.resolve(root, ...normalized.split("/"));
	const resolvedRoot = path.resolve(root);
	if (absolute !== resolvedRoot && !absolute.startsWith(`${resolvedRoot}${path.sep}`))
		throw new Error(`source path escapes quarantine: ${relativePath}`);
	return { absolute, normalized };
}

export function readConfinedFile(root, relativePath, allowedPaths) {
	const { absolute, normalized } = confinedAbsolute(root, relativePath);
	if (allowedPaths && !allowedPaths.has(normalized))
		throw new Error(`source path is not in the verified closure: ${normalized}`);
	const stat = lstatSync(absolute);
	if (!stat.isFile() || stat.isSymbolicLink())
		throw new Error(`source path is not a regular file: ${normalized}`);
	const realRoot = realpathSync(root);
	const realFile = realpathSync(absolute);
	if (!realFile.startsWith(`${realRoot}${path.sep}`))
		throw new Error(`source path resolves outside quarantine: ${normalized}`);
	return readFileSync(realFile);
}

export function gitTrackedEntries(root) {
	const output = execFileSync("git", ["-C", root, "ls-files", "-s", "-z"], {
		encoding: "utf8",
	});
	return output
		.split("\0")
		.filter(Boolean)
		.map((record) => {
			const tab = record.indexOf("\t");
			const [mode, objectId, stage] = record.slice(0, tab).split(" ");
			return { mode, objectId, stage, path: record.slice(tab + 1) };
		});
}

function assertExactKeys(actual, expected, label) {
	const unknown = Object.keys(actual).filter((key) => !expected.includes(key));
	if (unknown.length) throw new Error(`unknown ${label} surface: ${unknown.sort().join(", ")}`);
}

function assertJsonEqual(actual, expected, label) {
	if (JSON.stringify(actual) !== JSON.stringify(expected))
		throw new Error(`${label} identity mismatch`);
}

function verifyReferences(root, workflow, closurePaths, allowedPaths) {
	const referencePattern = /\b(?:references|scripts|assets)\/[A-Za-z0-9_./-]+\.(?:md|mjs|js|py|sh|json|ya?ml)\b/g;
	for (const relativePath of closurePaths.filter((entry) => /\.(?:md|mjs|js)$/i.test(entry))) {
		const text = readConfinedFile(root, relativePath, allowedPaths).toString("utf8");
		for (const match of text.matchAll(referencePattern)) {
			const target = `skills/${workflow}/${match[0]}`;
			if (!allowedPaths.has(target))
				throw new Error(`unresolved source reference ${match[0]} in ${relativePath}`);
		}
	}
}

export function inspectCompoundSource({ root, policy, commitSha, trackedEntries }) {
	const entries = trackedEntries ?? gitTrackedEntries(root);
	if (!entries.length) throw new Error("official source contains no tracked files");
	const collisions = new Map();
	const allowedPaths = new Set();
	const verifiedRoots = policy.verifiedSourceRoots;
	for (const entry of entries) {
		const normalized = normalizeSourcePath(entry.path);
		allowedPaths.add(normalized);
		const isVerifiedSurface =
			!verifiedRoots ||
			verifiedRoots.some((rootPath) => normalized === rootPath || normalized.startsWith(`${rootPath}/`));
		if (!isVerifiedSurface) continue;
		if (entry.stage !== undefined && entry.stage !== "0")
			throw new Error(`unmerged source entry: ${normalized}`);
		if (entry.mode === "120000") throw new Error(`source symlink rejected: ${normalized}`);
		if (entry.mode && entry.mode !== "100644" && entry.mode !== "100755")
			throw new Error(`unsupported source entry mode ${entry.mode}: ${normalized}`);
		const key = windowsPathKey(normalized);
		if (collisions.has(key))
			throw new Error(`Windows path collision: ${collisions.get(key)} and ${normalized}`);
		collisions.set(key, normalized);
	}

	if (commitSha !== policy.peeledCommitSha)
		throw new Error(`source commit identity mismatch: ${commitSha}`);
	const manifest = JSON.parse(readConfinedFile(root, "package.json", allowedPaths));
	assertExactKeys(manifest, policy.knownManifestKeys, "package manifest");
	assertExactKeys(manifest.pi ?? {}, policy.knownPiManifestKeys, "Pi manifest");
	if (
		manifest.name !== policy.packageIdentity.name ||
		manifest.version !== policy.version ||
		manifest.repository !== policy.packageIdentity.repository
	)
		throw new Error("official package identity mismatch");
	assertJsonEqual(manifest.pi, policy.declaredPiSurface, "declared Pi surface");

	const licenseBytes = readConfinedFile(root, policy.license.path, allowedPaths);
	const licenseText = licenseBytes.toString("utf8");
	if (
		sha256(licenseBytes) !== policy.license.sha256 ||
		!licenseText.includes(policy.license.requiredPermissionText)
	)
		throw new Error("license identity or redistribution permission mismatch");

	const importedFiles = [];
	const sourceReadProof = [];
	const closures = {};
	for (const workflow of policy.workflows) {
		const prefix = `skills/${workflow}/`;
		const closurePaths = [...allowedPaths].filter((entry) => entry.startsWith(prefix)).sort();
		if (!closurePaths.includes(`${prefix}SKILL.md`))
			throw new Error(`missing workflow entrypoint: ${workflow}`);
		verifyReferences(root, workflow, closurePaths, allowedPaths);
		closures[workflow] = closurePaths;
		for (const relativePath of closurePaths) {
			const bytes = readConfinedFile(root, relativePath, allowedPaths);
			importedFiles.push({ path: relativePath, bytes: bytes.length, sha256: sha256(bytes) });
		}
		const entryBytes = readConfinedFile(root, `${prefix}SKILL.md`, allowedPaths);
		sourceReadProof.push({
			workflow,
			path: `${prefix}SKILL.md`,
			bytes: entryBytes.length,
			sha256: sha256(entryBytes),
			exactAllowlistedRead: true,
		});
	}

	return {
		packageIdentity: {
			name: manifest.name,
			version: manifest.version,
			repository: manifest.repository,
			manifestSha256: sha256(readConfinedFile(root, "package.json", allowedPaths)),
		},
		declaredPiSurface: manifest.pi,
		licenseEvidence: {
			path: policy.license.path,
			spdx: policy.license.spdx,
			sha256: sha256(licenseBytes),
			permissionTextPresent: true,
			notices: policy.notices,
		},
		closures,
		importedFiles: importedFiles.sort((left, right) => left.path.localeCompare(right.path)),
		sourceReadProof,
	};
}

export function scanRepositoryCallSites({ root, inventory, workflowNames }) {
	const files = execFileSync("git", ["-C", root, "ls-files", "-z", "--", ...inventory.scanRoots], {
		encoding: "utf8",
	})
		.split("\0")
		.filter(Boolean)
		.filter((entry) => !inventory.excludePaths.includes(entry));
	const mentions = {};
	const callSites = [];
	for (const relativePath of files.sort()) {
		const text = readFileSync(path.join(root, relativePath), "utf8");
		for (const workflow of workflowNames) {
			const expression = new RegExp(`(?<![A-Za-z0-9-])${workflow}(?![A-Za-z0-9-])`, "g");
			for (const match of text.matchAll(expression)) {
				const before = text.slice(0, match.index);
				const line = before.split("\n").length;
				const lineText = text.split(/\r?\n/)[line - 1].trim();
				callSites.push({
					workflow,
					path: relativePath,
					line,
					lineSha256: sha256(lineText),
				});
				mentions[relativePath] ??= {};
				mentions[relativePath][workflow] = (mentions[relativePath][workflow] ?? 0) + 1;
			}
		}
	}
	assertJsonEqual(mentions, inventory.expectedMentions, "repository CE call-site inventory");
	return { mentions, callSites };
}

export async function withCompoundQuarantine(callback, prefix = "ce-compound-source-") {
	const quarantinePath = mkdtempSync(path.join(os.tmpdir(), prefix));
	try {
		const value = await callback(quarantinePath);
		return { value, quarantinePath };
	} finally {
		rmSync(quarantinePath, { recursive: true, force: true, maxRetries: 3 });
	}
}

export function quarantineWasRemoved(quarantinePath) {
	return !existsSync(quarantinePath);
}
