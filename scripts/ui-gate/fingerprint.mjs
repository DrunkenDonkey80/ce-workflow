#!/usr/bin/env node
// CI cheap-mode (plan-final.md §2.6): hash the files that can affect
// rendering; an unchanged fingerprint reuses the last recorded verdict with
// telemetry — no capture at all.
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	".pi",
	".ce-workflow",
	".tmp",
	"dist",
	"coverage",
	"evidence",
]);

export const DEFAULT_RENDER_GLOBS = [
	"**/*.css",
	"**/*.html",
	"**/*.htm",
	"**/*.svg",
	"styles/**",
	"components/**",
	"templates/**",
	"tokens/**",
];

function globToRegExp(glob) {
	const source = glob
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, "\u0000")
		.replace(/\*/g, "[^/]*")
		.replace(/\?/g, ".")
		.split("\u0000")
		.join(".*");
	return new RegExp(`^${source}$`);
}

export function uiSurfaceFingerprint({ root, globs = DEFAULT_RENDER_GLOBS }) {
	const patterns = globs.map(globToRegExp);
	const files = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
				continue;
			}
			if (!entry.isFile()) continue;
			const rel = path
				.relative(root, path.join(dir, entry.name))
				.replaceAll(path.sep, "/");
			if (patterns.some((pattern) => pattern.test(rel)))
				files.push({ rel, file: path.join(dir, entry.name) });
		}
	};
	const rootStat = statSync(root, { throwIfNoEntry: false });
	if (!rootStat) throw new Error(`fingerprint root missing: ${root}`);
	if (rootStat.isFile()) files.push({ rel: path.basename(root), file: root });
	else walk(root);
	files.sort((a, b) => a.rel.localeCompare(b.rel));
	const digest = createHash("sha256");
	for (const { rel, file } of files)
		digest.update(
			`${rel}\0${createHash("sha256").update(readFileSync(file)).digest("hex")}\n`,
		);
	return { hash: digest.digest("hex"), files: files.length };
}

export function readVerdictCache(file) {
	if (!file || !existsSync(file)) return null;
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(
			`unreadable verdict cache (${file}): ${error instanceof Error ? error.message : error}`,
		);
	}
}

export function writeVerdictCache(file, entry) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(entry, null, 1)}\n`);
}

// Wrap a gate run: when the UI-surface fingerprint is unchanged, reuse the
// recorded verdict (fast path) and record the reuse in telemetry.
export async function runGateCheap({
	fingerprintRoot,
	globs,
	verdictCacheFile,
	out,
	run,
}) {
	const fingerprint = uiSurfaceFingerprint({ root: fingerprintRoot, globs });
	const cached = readVerdictCache(verdictCacheFile);
	if (cached?.fingerprint === fingerprint.hash) {
		mkdirSync(out, { recursive: true });
		appendFileSync(
			path.join(out, "telemetry.jsonl"),
			`${JSON.stringify({
				event: "ui_gate_verdict_reused",
				fingerprint: fingerprint.hash.slice(0, 16),
				files: fingerprint.files,
			})}\n`,
		);
		return { ...cached.verdict, reused: true, fingerprint: fingerprint.hash };
	}
	const result = await run();
	writeVerdictCache(verdictCacheFile, {
		fingerprint: fingerprint.hash,
		files: fingerprint.files,
		verdict: {
			ok: result.ok,
			errors: result.errors,
			warnings: result.warnings,
			total: result.total,
		},
		at: Date.now(),
	});
	return { ...result, reused: false, fingerprint: fingerprint.hash };
}
