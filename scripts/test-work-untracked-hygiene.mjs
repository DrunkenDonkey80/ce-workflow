#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { assert } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "work-command-fixture.mjs")),
	).href
);
const {
	appendGitignorePatterns,
	ignorePatternForBuildArtifact,
	isRecognizedSource,
	tidyUntrackedFiles,
} = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "work-hygiene.mjs")),
	).href
);

// --- pure classification by stack ---
assert(
	ignorePatternForBuildArtifact("tools/x/build/pkg/Analysis-00.toc") === "build/",
	"build/ dir maps to build/",
);
assert(
	ignorePatternForBuildArtifact("tools/x/dist/barcode-display-gui.exe") === "dist/",
	"dist/ dir maps to dist/",
);
assert(
	ignorePatternForBuildArtifact("pkg/__pycache__/m.pyc") === "__pycache__/",
	"__pycache__ maps to __pycache__/",
);
assert(
	ignorePatternForBuildArtifact("src/m.pyc") === "*.py[cod]",
	"loose .pyc maps to *.py[cod]",
);
assert(
	ignorePatternForBuildArtifact("a/b/node_modules/lib/index.js") ===
		"node_modules/",
	"node_modules maps to node_modules/",
);
assert(
	ignorePatternForBuildArtifact("foo/bar.egg-info/PKG-INFO") === "*.egg-info/",
	".egg-info maps to *.egg-info/",
);
assert(ignorePatternForBuildArtifact(".DS_Store") === ".DS_Store", ".DS_Store maps to itself");
assert(ignorePatternForBuildArtifact("src/main.py") === null, "source is not a build artifact");

// recognized source must be decided WITHOUT touching git (ext + basename paths)
const noGit = () => {
	throw new Error("git must not be consulted for an extension/basename match");
};
assert(isRecognizedSource("src/main.py", noGit), ".py is recognized source");
assert(isRecognizedSource("README.md", noGit), ".md is recognized source");
assert(isRecognizedSource("pyproject.toml", noGit), ".toml is recognized source");
assert(isRecognizedSource("Dockerfile", noGit), "Dockerfile basename is recognized");
assert(isRecognizedSource(".gitignore", noGit), ".gitignore is recognized");
assert(!isRecognizedSource("mystery.dat", noGit), ".dat is NOT recognized");
assert(!isRecognizedSource("dump.bin", noGit), ".bin is NOT recognized");

// --- .gitignore writer dedups and does not rewrite when nothing new ---
const tmpA = mkdtempSync(path.join(tmpdir(), "wo-gi-"));
const written1 = appendGitignorePatterns(tmpA, ["__pycache__/", "*.py[cod]", "build/"]);
const gi1 = readFileSync(path.join(tmpA, ".gitignore"), "utf8");
assert(written1, "first write reports a change");
assert(
	gi1.includes("__pycache__/") &&
		gi1.includes("*.py[cod]") &&
		gi1.includes("ce-workflow: auto-ignored"),
	"patterns + header written",
);
const written2 = appendGitignorePatterns(tmpA, ["__pycache__/", "node_modules/"]);
const gi2 = readFileSync(path.join(tmpA, ".gitignore"), "utf8");
assert(written2, "new node_modules/ pattern is a change");
const dupCount = (gi2.match(/__pycache__/g) || []).length;
assert(
	dupCount === 1,
	"existing __pycache__/ pattern is not duplicated",
);
assert(gi2.includes("node_modules/"), "new node_modules/ pattern appended");
const written3 = appendGitignorePatterns(tmpA, ["__pycache__/", "build/"]);
assert(!written3, "no new patterns -> no rewrite");
rmSync(tmpA, { recursive: true, force: true });

// --- end-to-end against a real temp git repo ---
const repo = mkdtempSync(path.join(tmpdir(), "wo-hygiene-"));
const g = (args) =>
	execFileSync("git", args, {
		cwd: repo,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
g(["init", "-q"]);
g(["config", "user.email", "t@t.test"]);
g(["config", "user.name", "test"]);
mkdirSync(path.join(repo, "src"));
writeFileSync(path.join(repo, "src", "old.py"), "x = 1\n");
g(["add", "-A"]);
g(["commit", "-q", "-m", "baseline"]);

// untracked mix: build/cache, source, runtime, and genuinely unknown.
mkdirSync(path.join(repo, "build", "pkg"), { recursive: true });
writeFileSync(path.join(repo, "build", "pkg", "Analysis-00.toc"), "x");
mkdirSync(path.join(repo, "__pycache__"));
writeFileSync(path.join(repo, "__pycache__", "m.pyc"), "x");
writeFileSync(path.join(repo, "src", "new.py"), "y = 2\n");
writeFileSync(path.join(repo, "src", "m.pyc"), "x");
writeFileSync(path.join(repo, "mystery.dat"), "x");
writeFileSync(path.join(repo, "data.bin"), "x");
mkdirSync(path.join(repo, "node_modules", "lib"), { recursive: true });
writeFileSync(path.join(repo, "node_modules", "lib", "index.js"), "x");
mkdirSync(path.join(repo, ".beads"), { recursive: true });
writeFileSync(path.join(repo, ".beads", "interactions.jsonl"), "{}");

const tidy = tidyUntrackedFiles({ cwd: repo });
const sorted = (arr) => [...arr].sort();
assert(
	sorted(tidy.ignored).join(",") ===
		sorted(["build/", "__pycache__/", "*.py[cod]", "node_modules/"]).join(","),
	"build/cache artifacts collected as canonical patterns",
);
assert(
	sorted(tidy.unrecognized).join(",") === sorted(["mystery.dat", "data.bin"]).join(","),
	"only the unknown extensions are escalated",
);
assert(!tidy.unrecognized.includes("src/new.py"), "new source is not escalated");
assert(!tidy.unrecognized.includes(".beads/interactions.jsonl"), "workflow-managed dirt is ignored");
assert(tidy.gitignoreWritten, ".gitignore was written");
const gi = readFileSync(path.join(repo, ".gitignore"), "utf8");
assert(gi.includes("*.py[cod]") && gi.includes("node_modules/"), "patterns landed in .gitignore");

// idempotent: a second run finds no new build/cache (already ignored) and does not rewrite.
const tidy2 = tidyUntrackedFiles({ cwd: repo });
assert(tidy2.ignored.length === 0, "second run collects no new artifacts");
assert(!tidy2.gitignoreWritten, "second run does not rewrite .gitignore");
assert(
	sorted(tidy2.unrecognized).join(",") === sorted(["mystery.dat", "data.bin"]).join(","),
	"unknown files remain escalated on the second run",
);

// once every unknown is resolved (tracked as legit source, or gitignored),
// a run is clean.
g(["add", "mystery.dat"]);
appendGitignorePatterns(repo, ["*.bin"]);
const tidy3 = tidyUntrackedFiles({ cwd: repo });
assert(
	tidy3.unrecognized.length === 0,
	"after resolving unknowns, a run has nothing to escalate",
);

rmSync(repo, { recursive: true, force: true });
console.log("untracked hygiene: PASS");
