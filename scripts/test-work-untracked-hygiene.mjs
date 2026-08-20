#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	truncateSync,
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
	appendLocalExcludePatterns,
	ignorePatternForBuildArtifact,
	isRecognizedSource,
	isRuntimePath,
	isWorkflowManaged,
	tidyUntrackedFiles,
} = await import(
	pathToFileURL(realpathSync(path.join(import.meta.dirname, "work-hygiene.mjs")))
		.href
);

// --- pure classification by stack ---
assert(
	ignorePatternForBuildArtifact("tools/x/build/pkg/Analysis-00.toc") ===
		"/tools/x/build/",
	"build artifacts map to their exact directory",
);
assert(
	ignorePatternForBuildArtifact("tools/x/dist/barcode-display-gui.exe") ===
		"/tools/x/dist/",
	"dist artifacts map to their exact directory",
);
assert(
	ignorePatternForBuildArtifact("pkg/__pycache__/m.pyc") === "/pkg/__pycache__/",
	"__pycache__ maps to its exact directory",
);
assert(
	ignorePatternForBuildArtifact("src/m.pyc") === "*.py[cod]",
	"loose .pyc maps to *.py[cod]",
);
assert(
	ignorePatternForBuildArtifact("rf-lib/build-host/rf_session_tests.pdb") ===
		"*.pdb",
	"MSVC debug symbols map to *.pdb",
);
assert(
	ignorePatternForBuildArtifact("rf-lib/build-host/rf_session_tests.ilk") ===
		"*.ilk",
	"MSVC incremental linker files map to *.ilk",
);
assert(
	ignorePatternForBuildArtifact("rf-lib/build-work-9-4/CMakeCache.txt") ===
		"/rf-lib/build-work-9-4/",
	"task-specific CMake trees map to their exact directory",
);
assert(
	ignorePatternForBuildArtifact("a/b/node_modules/lib/index.js") ===
		"/a/b/node_modules/",
	"node_modules maps to its exact directory",
);
assert(
	ignorePatternForBuildArtifact("foo/bar.egg-info/PKG-INFO") ===
		"/foo/bar.egg-info/",
	".egg-info directories map to their exact directory",
);
assert(
	ignorePatternForBuildArtifact("bar.egg-info") === "*.egg-info",
	".egg-info files map to a file pattern",
);
assert(
	ignorePatternForBuildArtifact("bar.egg-info.json") === "*.egg-info.json",
	".egg-info.json files map to a file pattern",
);
assert(
	ignorePatternForBuildArtifact(".DS_Store") === ".DS_Store",
	".DS_Store maps to itself",
);
assert(
	ignorePatternForBuildArtifact("src/main.py") === null,
	"source is not a build artifact",
);

// recognized source must be decided WITHOUT touching git (ext + basename paths)
const noGit = () => {
	throw new Error("git must not be consulted for an extension/basename match");
};
assert(isRecognizedSource("src/main.py", noGit), ".py is recognized source");
assert(isRecognizedSource("README.md", noGit), ".md is recognized source");
assert(
	isRecognizedSource("pyproject.toml", noGit),
	".toml is recognized source",
);
assert(
	isRecognizedSource("Dockerfile", noGit),
	"Dockerfile basename is recognized",
);
assert(isRecognizedSource(".gitignore", noGit), ".gitignore is recognized");
assert(
	isRecognizedSource("vendor-manifest.sha256", noGit),
	"SHA-256 manifests are recognized source",
);
assert(
	isRecognizedSource("toolchain.cmake", noGit),
	".cmake is recognized source",
);
assert(
	isRecognizedSource("events.ndjson", noGit),
	".ndjson is recognized evidence",
);
assert(
	isRecognizedSource("events.jsonl", noGit),
	".jsonl is recognized evidence",
);
assert(isRecognizedSource("settings.gradle", noGit), ".gradle is recognized");
assert(isRecognizedSource("gradlew", noGit), "gradlew is recognized");
assert(
	isRecognizedSource("gradle/wrapper/gradle-wrapper.properties", noGit),
	"Gradle wrapper properties are recognized",
);
assert(
	isRecognizedSource("gradle/wrapper/gradle-wrapper.jar", noGit),
	"only the standard Gradle wrapper JAR path is recognized",
);
assert(!isRecognizedSource("mystery.dat", noGit), ".dat is NOT recognized");
assert(
	!isRecognizedSource("random.jar", noGit),
	"arbitrary JARs are NOT recognized",
);
assert(!isRecognizedSource("dump.bin", noGit), ".bin is NOT recognized");
assert(
	!isRecognizedSource("src/blob.dat", () => "src/old.py\n"),
	"directory inference requires an explicit repository root",
);
assert(isRuntimePath(".pi/work-runs/run.json"), ".pi runtime is recognized");
assert(
	isRuntimePath(".pi-subagents\\artifacts\\review.md"),
	"Windows runtime separators are normalized",
);
assert(
	isWorkflowManaged(".ce-workflow/work-items.json"),
	"canonical work state is workflow-managed",
);
assert(
	!isWorkflowManaged(".ce-workflow/roadmap.md"),
	"ordinary workflow documents remain implementation files",
);

// --- local exclude writer dedups and does not rewrite when nothing new ---
const tmpA = mkdtempSync(path.join(tmpdir(), "wo-gi-"));
execFileSync("git", ["init", "-q"], { cwd: tmpA });
const written1 = appendLocalExcludePatterns(tmpA, [
	"__pycache__/",
	"*.py[cod]",
	"build/",
]);
const excludePath = path.join(tmpA, ".git", "info", "exclude");
const gi1 = readFileSync(excludePath, "utf8");
assert(written1, "first write reports a change");
assert(
	gi1.includes("__pycache__/") &&
		gi1.includes("*.py[cod]") &&
		gi1.includes("ce-workflow: locally ignored"),
	"patterns + header written",
);
const written2 = appendLocalExcludePatterns(tmpA, [
	"__pycache__/",
	"node_modules/",
]);
const gi2 = readFileSync(excludePath, "utf8");
assert(written2, "new node_modules/ pattern is a change");
const dupCount = (gi2.match(/__pycache__/g) || []).length;
assert(dupCount === 1, "existing __pycache__/ pattern is not duplicated");
assert(gi2.includes("node_modules/"), "new node_modules/ pattern appended");
const written3 = appendLocalExcludePatterns(tmpA, ["__pycache__/", "build/"]);
assert(!written3, "no new patterns -> no rewrite");
assert(
	!readFileSync(path.join(tmpA, ".git", "info", "exclude"), "utf8").includes(
		"auto-ignored",
	),
	"tracked ignore marker is not used",
);
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
writeFileSync(path.join(repo, "src", "blob.dat"), "bounded inferred source\n");
writeFileSync(path.join(repo, "src", "huge.dat"), "");
truncateSync(path.join(repo, "src", "huge.dat"), 10 * 1024 * 1024 + 1);
writeFileSync(path.join(repo, "mystery.dat"), "x");
writeFileSync(path.join(repo, "package.egg-info"), "x");
writeFileSync(path.join(repo, "metadata.egg-info.json"), "x");
writeFileSync(path.join(repo, "symbols.pdb"), "x");
writeFileSync(path.join(repo, "data.bin"), "x");
writeFileSync(path.join(repo, "events.ndjson"), '{"event":"start"}\n');
writeFileSync(path.join(repo, "server.jsonl"), '{"status":200}\n');
writeFileSync(path.join(repo, "too-large.ndjson"), "");
truncateSync(path.join(repo, "too-large.ndjson"), 10 * 1024 * 1024 + 1);
mkdirSync(path.join(repo, "node_modules", "lib"), { recursive: true });
writeFileSync(path.join(repo, "node_modules", "lib", "index.js"), "x");
mkdirSync(path.join(repo, "rf-lib", "build-work-9-4"), { recursive: true });
writeFileSync(
	path.join(repo, "rf-lib", "build-work-9-4", "CMakeCache.txt"),
	"x",
);
mkdirSync(path.join(repo, "android", "gradle", "wrapper"), { recursive: true });
writeFileSync(
	path.join(repo, "android", "settings.gradle"),
	"rootProject.name = 'x'\n",
);
writeFileSync(path.join(repo, "android", "gradlew"), "#!/bin/sh\n");
writeFileSync(
	path.join(repo, "android", "gradle", "wrapper", "gradle-wrapper.properties"),
	"distributionUrl=x\n",
);
writeFileSync(
	path.join(repo, "android", "gradle", "wrapper", "gradle-wrapper.jar"),
	"jar",
);
mkdirSync(path.join(repo, ".ce-workflow"), { recursive: true });
writeFileSync(path.join(repo, ".ce-workflow", "work-items.json"), "{}");

const tidy = tidyUntrackedFiles({ cwd: repo });
const sorted = (arr) => [...arr].sort();
assert(
	sorted(tidy.ignored).join(",") ===
		sorted([
			"/build/",
			"/rf-lib/build-work-9-4/",
			"/__pycache__/",
			"*.py[cod]",
			"*.egg-info",
			"*.egg-info.json",
			"*.pdb",
			"/node_modules/",
		]).join(","),
	"build/cache artifacts are scoped to observed directories",
);
assert(
	sorted(tidy.unrecognized).join(",") ===
		sorted(["mystery.dat", "data.bin", "src/huge.dat", "too-large.ndjson"]).join(
			",",
		),
	"only unknown or oversized files are escalated",
);
assert(
	!tidy.unrecognized.includes("src/new.py") &&
		!tidy.unrecognized.includes("src/blob.dat") &&
		!tidy.unrecognized.includes("events.ndjson") &&
		!tidy.unrecognized.includes("server.jsonl") &&
		!tidy.unrecognized.some((file) => file.startsWith("android/")),
	"new source, bounded event logs, and standard Gradle infrastructure are not escalated",
);
assert(
	!tidy.unrecognized.includes(".ce-workflow/work-items.json"),
	"canonical workflow state is preserved",
);
assert(tidy.excludeWritten, "local exclude was written");
assert(
	!readFileSync(path.join(repo, ".git", "info", "exclude"), "utf8").includes(
		"auto-ignored",
	),
	"tracked ignore marker is absent",
);
const gi = readFileSync(path.join(repo, ".git", "info", "exclude"), "utf8");
assert(
	gi.includes("*.py[cod]") && gi.includes("/node_modules/"),
	"patterns landed in the local exclude",
);
assert(
	!g(["status", "--short"]).includes(".gitignore"),
	"tracked .gitignore is unchanged",
);

// idempotent: a second run finds no new build/cache (already ignored) and does not rewrite.
const tidy2 = tidyUntrackedFiles({ cwd: repo });
assert(tidy2.ignored.length === 0, "second run collects no new artifacts");
assert(!tidy2.excludeWritten, "second run does not rewrite the local exclude");
assert(
	sorted(tidy2.unrecognized).join(",") ===
		sorted(["mystery.dat", "data.bin", "src/huge.dat", "too-large.ndjson"]).join(
			",",
		),
	"unknown and oversized files remain escalated on the second run",
);

// once every unknown is resolved (tracked as legit source, or gitignored),
// a run is clean.
g(["add", "mystery.dat", "src/huge.dat", "too-large.ndjson"]);
appendLocalExcludePatterns(repo, ["*.bin"]);
const tidy3 = tidyUntrackedFiles({ cwd: repo });
assert(
	tidy3.unrecognized.length === 0,
	"after resolving unknowns, a run has nothing to escalate",
);

rmSync(repo, { recursive: true, force: true });
console.log("untracked hygiene: PASS");
