#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const quiet =
	process.argv.includes("--quiet") || process.env.WORK_ORCH_VERIFY_QUIET === "1";
const failures = [];
const check = (label, ok, detail = "") => {
	if (ok) {
		if (!quiet) process.stdout.write(`ok - ${label}\n`);
		return;
	}
	failures.push(`${label}${detail ? `: ${detail}` : ""}`);
	process.stderr.write(`FAIL - ${label}${detail ? `: ${detail}` : ""}\n`);
};
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const listed = (dir) => readdirSync(path.join(root, dir)).sort();

let pkg = {};
try {
	pkg = JSON.parse(read("package.json"));
} catch (error) {
	check("package.json is valid JSON", false, error.message);
}
check(
	"native package manifest",
	pkg.name === "pi-work-orchestrator" && pkg.type === "module",
);
check("no tracker dependency", !JSON.stringify(pkg).match(/@beads|\bbd\b/i));
check(
	"native extension is packaged",
	pkg.pi?.extensions?.includes("extensions/work-models.ts"),
);
check("native store is packaged", pkg.files?.includes("extensions/"));
check("only active utility agents are statically advertised",
	pkg.files?.includes("utility-agents/") &&
	JSON.stringify(pkg.pi?.subagents?.agents) === '["./utility-agents"]' &&
	JSON.stringify(listed("utility-agents")) === '["context-knowledge-discoverer.md","diff-reviewer.md","plan3-advisor.md"]');
check("no legacy orchestration assets ship",
	!pkg.pi?.prompts && !["agents", "prompts", "skills/work-orchestrator"].some((rel) => existsSync(path.join(root, rel))));
check("only the standalone frontend design skill is statically advertised",
	JSON.stringify(pkg.pi?.skills) === '["./skills/frontend-design"]' && pkg.files?.includes("skills/"));
check("frontend design license and provenance are packaged",
	read("skills/frontend-design/LICENSE.txt").includes("END OF TERMS AND CONDITIONS") &&
	read("skills/frontend-design/UPSTREAM.md").includes("683bc88e56f3e09ba94f7055977f3d3aa499f202"));
check(
	"pi-subagents current workflow RPC compatibility floor",
	pkg.peerDependencies?.["pi-subagents"] === ">=0.75.0",
);
const subscriptionFooterProvenancePath =
	"hub/src/usage-UPSTREAM.md";
const subscriptionFooterProvenance = existsSync(
	path.join(root, subscriptionFooterProvenancePath),
)
	? read(subscriptionFooterProvenancePath)
	: "";
check(
	"subscription footer provenance is packaged",
	pkg.files?.includes("hub/") && Boolean(subscriptionFooterProvenance),
);
check(
	"subscription footer provenance retains the exact upstream MIT notice and revision",
	[
		"MIT License",
		"Copyright (c) 2026 satas20",
		"Permission is hereby granted, free of charge",
		"f21cabaafabe6aef90be88b0de229ab736abb486",
	].every((marker) => subscriptionFooterProvenance.includes(marker)),
);
check(
	"subscription footer provenance inventories intentional divergences",
	[
		"Pi-auth-only",
		"International Z.ai",
		"GLM monthly exclusion/resetless session handling",
		"Footer composition",
		"Workflow separation",
		"Cache identity/path",
		"Freshness",
		"Incidents",
		"Typography",
	].every((marker) => subscriptionFooterProvenance.includes(marker)),
);

const runtimeTracked = execFileSync("git", ["ls-files"], {
	cwd: root,
	encoding: "utf8",
})
	.split(/\r?\n/)
	.filter((file) => existsSync(path.join(root, file)))
	.filter((file) =>
		/(^|\/)(?:\.pi(?:\/|$)|\.pi-subagents(?:\/|$)|\.beads(?:\/|$)|\.dolt(?:\/|$)|.*(?:backup|export|telemetry|\.lock|\.tmp)(?:\/|$))/i.test(
			file,
		) && !file.endsWith("/Cargo.lock"), // the desktop app's Cargo.lock is a real lockfile, not a runtime lock
	);
check(
	"no runtime or legacy artifacts are tracked",
	runtimeTracked.length === 0,
	runtimeTracked.join(", "),
);

const tests = [
	"test-jev-tools.mjs",
	"test-advisor-model.mjs",
	...listed("scripts").filter((name) => /^test-work-.*\.mjs$/.test(name)),
];
const gitConfigCount = Number(process.env.GIT_CONFIG_COUNT ?? 0);
// A hub-hosted Pi sets PI_HUB=1, which switches dialogs to the hub channel; tests expect a plain session.
const { PI_HUB: _hub, ...parentEnvironment } = process.env;
const testEnvironment = {
	...parentEnvironment,
	GIT_CONFIG_COUNT: String(gitConfigCount + 1),
	[`GIT_CONFIG_KEY_${gitConfigCount}`]: "core.autocrlf",
	[`GIT_CONFIG_VALUE_${gitConfigCount}`]: "false",
	PI_CODING_AGENT_DIR: path.join(root, ".pi-test-empty-agent"),
};
for (const script of tests) {
	try {
		execFileSync(process.execPath, [path.join("scripts", script)], {
			cwd: root,
			stdio: quiet ? "pipe" : "inherit",
			env: testEnvironment,
		});
		check(`${script} passes`, true);
	} catch (error) {
		check(
			`${script} passes`,
			false,
			error instanceof Error ? error.message : String(error),
		);
	}
}

// The hub (hub/) imports ce-workflow's modules, so its suite runs with the package's.
try {
	execFileSync(process.execPath, ["--test", "scripts/test-*.mjs"], { cwd: path.join(root, "hub"), stdio: quiet ? "pipe" : "inherit", env: parentEnvironment });
	check("hub tests pass", true);
} catch (error) {
	check("hub tests pass", false, error instanceof Error ? error.message : String(error));
}

if (failures.length) {
	process.stderr.write(`\n${failures.length} verification check(s) failed:\n`);
	for (const failure of failures) process.stderr.write(`- ${failure}\n`);
	process.exit(1);
}
process.stdout.write(
	`${quiet ? "ok - package checks passed" : "\nAll package checks passed."}\n`,
);
