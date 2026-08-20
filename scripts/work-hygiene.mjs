#!/usr/bin/env node
// Pre-commit untracked-file hygiene: classify untracked files by stack, ignore
// build/cache artifacts locally, and surface anything that needs a human
// decision. Pure + dir-aware so it is unit-testable against a temp git repo.

import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const RUNTIME_PREFIXES = [
	/^\.pi(?:-subagents)?\//,
	/^\.ce-workflow\/work-runs\//,
	/^work-[^/]+-(?:workItem-small|workItem-worker)\.md$/,
];
const MAX_INFERRED_SOURCE_BYTES = 10 * 1024 * 1024;

// dir segment -> canonical .gitignore pattern
const DIR_PATTERNS = {
	__pycache__: "__pycache__/",
	build: "build/",
	dist: "dist/",
	node_modules: "node_modules/",
	target: "target/",
	".pytest_cache": ".pytest_cache/",
	".mypy_cache": ".mypy_cache/",
	".ruff_cache": ".ruff_cache/",
	".tox": ".tox/",
	".gradle": ".gradle/",
};

// Recognized source/markup/config extensions. A file with one of these is
// assumed to be intended work and is auto-added (it is already part of the
// commit's `changed` set); it is NOT escalated.
const SOURCE_EXTS = new Set(
	(
		"py js mjs cjs ts jsx tsx go rs java kt scala rb php swift " +
		"c h cpp hpp cc hh cs fs vb clj cljs ex exs erl elm hs jl lua pl pm " +
		"r dart vue svelte astro md mdx html htm xml svg rst adoc tex " +
		"css scss sass less styl toml yaml yml json json5 jsonc ini cfg conf properties " +
		"gradle sh bash zsh fish ps1 psm1 bat cmd sql graphql gql proto txt lock csv tsv ndjson jsonl sha256 cmake"
	).split(" "),
);

// Basenames (no meaningful extension) that are always intended source/config.
const SOURCE_BASENAMES = new Set([
	"Makefile",
	"Dockerfile",
	"Rakefile",
	"Gemfile",
	"Vagrantfile",
	"CMakeLists.txt",
	"gradlew",
	"requirements.txt",
	"package.json",
	"tsconfig.json",
	"pyproject.toml",
	"Cargo.toml",
	"go.mod",
	"go.sum",
	".gitignore",
	".gitattributes",
	".editorconfig",
]);

export function isRuntimePath(file) {
	const norm = file.replaceAll("\\", "/");
	return RUNTIME_PREFIXES.some((re) => re.test(norm));
}

// Workflow-managed state that must never be escalated or gitignored by this gate.
// The canonical native snapshot is tracked source; runtime state remains under .pi.
export function isWorkflowManaged(file) {
	const norm = file.replaceAll("\\", "/");
	return isRuntimePath(file) || norm === ".ce-workflow/work-items.json";
}

export function ignorePatternForBuildArtifact(file) {
	const segs = file.replaceAll("\\", "/").split("/");
	const dirs = new Set(segs.slice(0, -1));
	const base = segs[segs.length - 1];
	for (const dir of Object.keys(DIR_PATTERNS))
		if (dirs.has(dir)) return DIR_PATTERNS[dir];
	for (const dir of dirs) {
		if (/^build-work-[^/]+$/i.test(dir)) return "build-work-*/";
		if (/\.egg-info$/i.test(dir)) return "*.egg-info/";
		if (/\.dist-info$/i.test(dir)) return "*.dist-info/";
	}
	if (/\.py[cod]$/i.test(base)) return "*.py[cod]";
	if (/\.pdb$/i.test(base)) return "*.pdb";
	if (/\.ilk$/i.test(base)) return "*.ilk";
	if (/\.egg-info$/i.test(base)) return "*.egg-info";
	if (/\.egg-info\.json$/i.test(base)) return "*.egg-info.json";
	if (base === ".DS_Store") return ".DS_Store";
	return null;
}

export function isGeneratedBuildPath(file) {
	return ignorePatternForBuildArtifact(file) !== null;
}

export function isRecognizedSource(file, runGit, root) {
	const norm = file.replaceAll("\\", "/");
	const base = norm.split("/").pop();
	if (SOURCE_BASENAMES.has(base)) return true;
	if (/(?:^|\/)gradle\/wrapper\/gradle-wrapper\.jar$/i.test(norm)) return true;
	const dot = base.lastIndexOf(".");
	const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
	if (ext && SOURCE_EXTS.has(ext)) return true;
	// Unknown extensions inherit source intent only from a tracked directory and
	// only when the candidate is a bounded regular file.
	if (root && norm.includes("/")) {
		const slash = norm.lastIndexOf("/");
		const dir = norm.slice(0, slash + 1);
		try {
			const stat = lstatSync(path.join(root, file));
			if (
				stat.isFile() &&
				stat.size <= MAX_INFERRED_SOURCE_BYTES &&
				String(runGit(["ls-files", "--", dir])).trim()
			)
				return true;
		} catch {
			/* git/stat unavailable -> fall through to unrecognized */
		}
	}
	return false;
}

export function appendLocalExcludePatterns(dir, patterns, runGit) {
	if (!patterns.length) return false;
	const git =
		runGit ??
		((argv) =>
			execFileSync("git", argv, {
				cwd: dir,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}));
	const exclude = path.resolve(
		dir,
		String(git(["rev-parse", "--git-path", "info/exclude"])).trim(),
	);
	let existing = "";
	try {
		existing = readFileSync(exclude, "utf8");
	} catch {
		/* Git creates this file lazily. */
	}
	const present = new Set(
		existing
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean),
	);
	const fresh = [...new Set(patterns)].filter(
		(pattern) => !present.has(pattern),
	);
	if (!fresh.length) return false;
	const sep = existing && !existing.endsWith("\n") ? "\n" : "";
	const block = `${sep}\n# ce-workflow: locally ignored build/cache artifacts\n${fresh.join("\n")}\n`;
	mkdirSync(path.dirname(exclude), { recursive: true });
	writeFileSync(exclude, existing + block, "utf8");
	return true;
}

// Scan untracked files, write build/cache artifacts to Git's local exclude, and
// return the set that needs a human decision. Does NOT throw; the caller decides
// whether to block on `unrecognized`. Idempotent: a second run finds no new
// build/cache artifacts (already ignored) and returns an empty `ignored`.
export function tidyUntrackedFiles({ cwd, gitBin = "git", preserve = [] }) {
	const preserved = new Set(preserve.map((file) => file.replaceAll("\\", "/")));
	const scriptedGit = /\.[cm]?js$/i.test(gitBin);
	const runGit = (argv) =>
		execFileSync(
			scriptedGit ? process.execPath : gitBin,
			scriptedGit ? [gitBin, ...argv] : argv,
			{
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
	const status = String(
		runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
	);
	const untracked = status
		.split("\0")
		.filter((record) => record.startsWith("?? "))
		.map((record) => record.slice(3).replaceAll("\\", "/"))
		.filter(Boolean);
	const toIgnore = new Set();
	const unrecognized = [];
	for (const file of untracked) {
		if (isWorkflowManaged(file) || preserved.has(file)) continue;
		const pattern = ignorePatternForBuildArtifact(file);
		if (pattern) {
			toIgnore.add(pattern);
			continue;
		}
		if (isRecognizedSource(file, runGit, cwd)) {
			if (/\.(?:ndjson|jsonl)$/i.test(file)) {
				try {
					const stat = lstatSync(path.join(cwd, file));
					if (!stat.isFile() || stat.size > MAX_INFERRED_SOURCE_BYTES) {
						unrecognized.push(file);
					}
				} catch {
					unrecognized.push(file);
				}
			}
			continue;
		}
		unrecognized.push(file);
	}
	const excludeWritten = appendLocalExcludePatterns(cwd, [...toIgnore], runGit);
	return { ignored: [...toIgnore], unrecognized, excludeWritten };
}
