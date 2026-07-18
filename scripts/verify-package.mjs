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
	pkg.pi?.extensions?.includes("extensions/work-models.js"),
);
check("native store is packaged", pkg.files?.includes("extensions/"));
check(
	"evaluation bundles are packaged",
	pkg.files?.includes("benchmarks/") &&
		pkg.files?.includes("scripts/") &&
		pkg.files?.includes("agents/"),
);

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

const evaluationFiles = [
	"agents/workflow-evaluator.md",
	"benchmarks/workflow-evaluation/v1/experiments/calibration.example.json",
	"benchmarks/workflow-evaluation/v1/experiments/decision.example.json",
	"benchmarks/workflow-evaluation/v1/experiments/golden-update.example.json",
	"benchmarks/workflow-evaluation/v1/experiments/model-role-campaign.example.json",
	"benchmarks/workflow-evaluation/v1/experiments/role-calibration.example.json",
	"benchmarks/workflow-evaluation/v1/experiments/role-decisions/u8.example.json",
	"benchmarks/workflow-evaluation/v1/experiments/role-smoke.example.json",
	"benchmarks/workflow-evaluation/v1/experiments/sentinel.example.json",
	"benchmarks/workflow-evaluation/v1/experiments/smoke.example.json",
	"benchmarks/workflow-evaluation/v1/manifest.json",
	"benchmarks/workflow-evaluation/v1/pricing.example.json",
	"benchmarks/workflow-evaluation/v1/role-cases/calculator/corpus.json",
	"benchmarks/workflow-evaluation/v1/role-cases/csv-expenses/corpus.json",
	"benchmarks/workflow-evaluation/v1/projects/calculator/acceptance/verify.mjs",
	"benchmarks/workflow-evaluation/v1/projects/calculator/answers.json",
	"benchmarks/workflow-evaluation/v1/projects/calculator/goldens/approval.json",
	"benchmarks/workflow-evaluation/v1/projects/calculator/goldens/brainstorm.md",
	"benchmarks/workflow-evaluation/v1/projects/calculator/goldens/plan.md",
	"benchmarks/workflow-evaluation/v1/projects/calculator/product-contract.md",
	"benchmarks/workflow-evaluation/v1/projects/calculator/project.json",
	"benchmarks/workflow-evaluation/v1/projects/calculator/request.txt",
	"benchmarks/workflow-evaluation/v1/projects/calculator/rubric.json",
	"benchmarks/workflow-evaluation/v1/projects/calculator/seed/app.js",
	"benchmarks/workflow-evaluation/v1/projects/calculator/seed/index.html",
	"benchmarks/workflow-evaluation/v1/projects/calculator/seed/styles.css",
	"benchmarks/workflow-evaluation/v1/projects/csv-expenses/acceptance/fixtures/expected-report.txt",
	"benchmarks/workflow-evaluation/v1/projects/csv-expenses/acceptance/fixtures/malformed.csv",
	"benchmarks/workflow-evaluation/v1/projects/csv-expenses/acceptance/fixtures/valid.csv",
	"benchmarks/workflow-evaluation/v1/projects/csv-expenses/acceptance/verify.mjs",
	"benchmarks/workflow-evaluation/v1/projects/csv-expenses/answers.json",
	"benchmarks/workflow-evaluation/v1/projects/csv-expenses/goldens/approval.json",
	"benchmarks/workflow-evaluation/v1/projects/csv-expenses/goldens/brainstorm.md",
	"benchmarks/workflow-evaluation/v1/projects/csv-expenses/goldens/plan.md",
	"benchmarks/workflow-evaluation/v1/projects/csv-expenses/product-contract.md",
	"benchmarks/workflow-evaluation/v1/projects/csv-expenses/project.json",
	"benchmarks/workflow-evaluation/v1/projects/csv-expenses/request.txt",
	"benchmarks/workflow-evaluation/v1/projects/csv-expenses/rubric.json",
	"benchmarks/workflow-evaluation/v1/projects/csv-expenses/seed/package.json",
	"benchmarks/workflow-evaluation/v1/projects/csv-expenses/seed/src/analyze.mjs",
	"benchmarks/workflow-evaluation/v1/projects/csv-expenses/seed/test/analyze.test.mjs",
	"scripts/test-workflow-evaluation-calculator.mjs",
	"scripts/test-workflow-evaluation-contract.mjs",
	"scripts/test-workflow-evaluation-critique.mjs",
	"scripts/test-workflow-evaluation-csv.mjs",
	"scripts/test-workflow-evaluation-panel.mjs",
	"scripts/test-workflow-evaluation-rpc.mjs",
	"scripts/test-workflow-evaluation-runner.mjs",
	"scripts/test-workflow-evaluation-score.mjs",
	"scripts/test-workflow-evaluation-sentinel.mjs",
	"scripts/workflow-evaluation-contract.mjs",
	"scripts/workflow-evaluation-rpc.mjs",
	"scripts/workflow-evaluation-score.mjs",
	"scripts/workflow-evaluation.mjs",
];
const missingEvaluationFiles = evaluationFiles.filter(
	(rel) => !existsSync(path.join(root, rel)),
);
check(
	"complete workflow evaluation inventory",
	missingEvaluationFiles.length === 0,
	missingEvaluationFiles.join(", "),
);
for (const rel of evaluationFiles.filter((file) => file.endsWith(".json"))) {
	try {
		JSON.parse(read(rel));
		check(`${rel} is valid JSON`, true);
	} catch (error) {
		check(
			`${rel} is valid JSON`,
			false,
			error instanceof Error ? error.message : String(error),
		);
	}
}
const evaluationDocs = read("README.md");
check(
	"evaluation authority and operations are documented",
	[
		"smoke",
		"decision",
		"calibration",
		"golden-update",
		"sentinel",
		"non-decision-grade",
		"evidencePath",
		".ce-workflow/work-items.json",
	].every((term) => evaluationDocs.includes(term)),
);
check(
	"evaluation security boundary is documented",
	evaluationDocs.includes("full process permissions") &&
		evaluationDocs.includes("not a hostile-code sandbox") &&
		evaluationDocs.includes("sandboxCommand"),
);
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
	process.stderr.write(`\n${failures.length} verification check(s) failed:\n`);
	for (const failure of failures) process.stderr.write(`- ${failure}\n`);
	process.exit(1);
}
process.stdout.write(
	`${quiet ? "ok - package checks passed" : "\nAll package checks passed."}\n`,
);
