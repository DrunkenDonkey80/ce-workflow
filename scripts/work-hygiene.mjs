#!/usr/bin/env node
// Pre-commit untracked-file hygiene: classify untracked files by stack, write
// build/cache artifacts to .gitignore, and surface anything that needs a human
// decision. Pure + dir-aware so it is unit-testable against a temp git repo.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const RUNTIME_PREFIXES = [
	/^\.pi(?:-subagents)?\//,
	/^work-[^/]+-(?:bead-small|bead-worker)\.md$/,
];

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
		"css scss sass less styl toml yaml yml json json5 jsonc ini cfg conf " +
		"sh bash zsh fish ps1 psm1 bat cmd sql graphql gql proto txt lock csv tsv"
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

// Workflow-managed state that must never be escalated or gitignored by this gate:
// pi runtime + the Beads database (which the workflow tracks/commits itself).
export function isWorkflowManaged(file) {
	const norm = file.replaceAll("\\", "/");
	return isRuntimePath(file) || norm === ".beads" || norm.startsWith(".beads/");
}

export function ignorePatternForBuildArtifact(file) {
	const segs = file.replaceAll("\\", "/").split("/");
	const dirs = new Set(segs.slice(0, -1));
	const base = segs[segs.length - 1];
	for (const dir of Object.keys(DIR_PATTERNS))
		if (dirs.has(dir)) return DIR_PATTERNS[dir];
	for (const dir of dirs) {
		if (/\.egg-info$/i.test(dir)) return "*.egg-info/";
		if (/\.dist-info$/i.test(dir)) return "*.dist-info/";
	}
	if (/\.py[cod]$/i.test(base)) return "*.py[cod]";
	if (/\.egg-info(?:\.json)?$/i.test(base)) return "*.egg-info/";
	if (base === ".DS_Store") return ".DS_Store";
	return null;
}

export function isGeneratedBuildPath(file) {
	return ignorePatternForBuildArtifact(file) !== null;
}

export function isRecognizedSource(file, runGit) {
	const norm = file.replaceAll("\\", "/");
	const base = norm.split("/").pop();
	if (SOURCE_BASENAMES.has(base)) return true;
	const dot = base.lastIndexOf(".");
	const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
	if (ext && SOURCE_EXTS.has(ext)) return true;
	// Inside a subdir that already contains tracked files: assume part of the work.
	if (norm.includes("/")) {
		const slash = norm.lastIndexOf("/");
		const dir = norm.slice(0, slash + 1);
		try {
			if (String(runGit(["ls-files", "--", dir])).trim()) return true;
		} catch {
			/* git unavailable -> fall through to unrecognized */
		}
	}
	return false;
}

export function appendGitignorePatterns(dir, patterns) {
	if (!patterns.length) return false;
	const gi = path.join(dir, ".gitignore");
	let existing = "";
	let hadFile = false;
	try {
		existing = readFileSync(gi, "utf8");
		hadFile = true;
	} catch {
		/* no existing .gitignore */
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
	const sep = hadFile && existing && !existing.endsWith("\n") ? "\n" : "";
	const block = `${sep}\n# ce-workflow: auto-ignored build/cache artifacts\n${fresh.join("\n")}\n`;
	writeFileSync(gi, existing + block, "utf8");
	return true;
}

// Scan untracked files, write build/cache artifacts to .gitignore, and return
// the set that needs a human decision. Does NOT throw; the caller decides
// whether to block on `unrecognized`. Idempotent: a second run finds no new
// build/cache artifacts (already ignored) and returns an empty `ignored`.
export function tidyUntrackedFiles({ cwd, gitBin = "git" }) {
	const runGit = (argv) =>
		execFileSync(gitBin, argv, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	const status = String(
		runGit(["status", "--porcelain=v1", "--untracked-files=all"]),
	);
	const untracked = status
		.split(/\r?\n/)
		.filter((line) => line.startsWith("??"))
		.map((line) =>
			line.slice(3).trim().replace(/^"|"$/g, "").replaceAll("\\", "/"),
		)
		.filter(Boolean);
	const toIgnore = new Set();
	const unrecognized = [];
	for (const file of untracked) {
		if (isWorkflowManaged(file)) continue;
		const pattern = ignorePatternForBuildArtifact(file);
		if (pattern) {
			toIgnore.add(pattern);
			continue;
		}
		if (isRecognizedSource(file, runGit)) continue;
		unrecognized.push(file);
	}
	const gitignoreWritten = appendGitignorePatterns(cwd, [...toIgnore]);
	return { ignored: [...toIgnore], unrecognized, gitignoreWritten };
}
