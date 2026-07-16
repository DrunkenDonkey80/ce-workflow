#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const quiet =
	process.argv.includes("--quiet") ||
	process.env.WORK_ORCH_VERIFY_QUIET === "1";
const failures = [];
const check = (label, ok, detail = "") => {
	if (ok) {
		if (!quiet) console.log(`ok - ${label}`);
		return;
	}
	failures.push(`${label}${detail ? `: ${detail}` : ""}`);
	console.error(`FAIL - ${label}${detail ? `: ${detail}` : ""}`);
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
	pkg.pi?.extensions?.includes("extensions/work-models.js"),
);
check("native store is packaged", pkg.files?.includes("extensions/"));

const roles = [
	"advisor",
	"advisor-backup",
	"committer",
	"debugger",
	"fixer",
	"migrator",
	"planner",
	"reviewer",
	"worker",
];
const agentFiles = listed("agents");
check(
	"only work role agents ship",
	roles.every((role) => agentFiles.includes(`work-${role}.md`)) &&
		!agentFiles.some((name) => name.startsWith("bead-")),
);

const normalPaths = [
	"extensions/work-models.js",
	"scripts/work-helper.mjs",
	"scripts/work-command-fixture.mjs",
	"skills/work-orchestrator/SKILL.md",
	"skills/work-orchestrator/references/full-policy.md",
	"README.md",
	"docs/orchestrator.md",
	"docs/orchestrator_idea.md",
	...agentFiles
		.filter((name) => name.startsWith("work-"))
		.map((name) => `agents/${name}`),
	...listed("prompts")
		.filter((name) => name !== "work-remove-beads.md")
		.map((name) => `prompts/${name}`),
];
for (const rel of normalPaths) {
	const text = read(rel)
		.replaceAll("legacy-beads-migration.js", "")
		.replaceAll("work-remove-beads", "")
		.replaceAll("remove-beads", "")
		.replaceAll(".beads", "");
	const legacy = [...text.matchAll(/\bbd\b|\bbead-[\w-]*|\bBeads?\b/gi)].map(
		(match) => match[0],
	);
	check(
		`${rel} has no normal-path legacy vocabulary`,
		legacy.length === 0,
		legacy.join(", "),
	);
}
const models = read("extensions/work-models.js");
const packagedPromptCommands = pkg.pi?.prompts?.length
	? listed("prompts").map((name) => name.replace(/\.md$/, ""))
	: [];
const duplicateCommands = packagedPromptCommands.filter((name) =>
	models.includes(`registerCommand("${name}"`),
);
check(
	"commands have one packaged owner",
	duplicateCommands.length === 0,
	duplicateCommands.join(", "),
);
const helper = read("scripts/work-helper.mjs");
check(
	"models use native store directly",
	models.includes('from "./work-store.js"') &&
		models.includes("loadStore") &&
		!models.includes("nativeRead") &&
		!models.includes("bdJson"),
);
check(
	"helper uses native store directly",
	helper.includes('from "../extensions/work-store.js"') &&
		!helper.includes("workItems(argv)"),
);
check(
	"migration command remains explicit",
	models.includes('registerCommand("work-remove-beads"') &&
		read("prompts/work-remove-beads.md").includes("/work-remove-beads"),
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
		),
	);
check(
	"no runtime or legacy artifacts are tracked",
	runtimeTracked.length === 0,
	runtimeTracked.join(", "),
);

const tests = [
	"test-work-store.mjs",
	"test-work-store-performance.mjs",
	"test-work-remove-beads.mjs",
	"test-work-remove-beads-windows.mjs",
	...listed("scripts").filter(
		(name) =>
			/^test-work-.*\.mjs$/.test(name) &&
			![
				"test-work-store.mjs",
				"test-work-store-performance.mjs",
				"test-work-remove-beads.mjs",
				"test-work-remove-beads-windows.mjs",
			].includes(name),
	),
	...listed("scripts").filter((name) =>
		/^test-workflow-evaluation-.*\.mjs$/.test(name),
	),
];
for (const script of [...new Set(tests)]) {
	try {
		execFileSync(process.execPath, [path.join("scripts", script)], {
			cwd: root,
			stdio: quiet ? "pipe" : "inherit",
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

if (failures.length) {
	console.error(`\n${failures.length} verification check(s) failed:`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}
console.log(
	quiet ? "ok - package checks passed" : "\nAll package checks passed.",
);
