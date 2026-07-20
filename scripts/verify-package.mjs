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
	"explicit improvement reporting is packaged",
	existsSync(path.join(root, "extensions/work-improvement-reporting.js")) &&
		existsSync(path.join(root, "scripts/test-work-improvement-reporting.mjs")),
);
check(
	"autonomous improvement surface is absent",
	![
		"extensions/work-improvement.js",
		"scripts/work-improvement-runner.mjs",
		"agents/workflow-improver.md",
		"agents/workflow-improvement-reviewer.md",
	].some((rel) => existsSync(path.join(root, rel))),
);
check(
	"evaluation bundles are packaged",
	pkg.files?.includes("benchmarks/") &&
		pkg.files?.includes("scripts/") &&
		pkg.files?.includes("agents/"),
);

const roles = [
	"advisor",
	"advisor-2",
	"advisor-3",
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
		!agentFiles.includes("work-advisor-backup.md") &&
		!agentFiles.some((name) => name.startsWith("bead-")),
);
const advisorFiles = [
	"agents/work-advisor.md",
	"agents/work-advisor-2.md",
	"agents/work-advisor-3.md",
];
const advisorBodies = advisorFiles.map((rel) =>
	read(rel).replace(/^---[\s\S]*?---\s*/, ""),
);
check(
	"parallel advisors share one exact review contract",
	advisorBodies.every((body) => body === advisorBodies[0]),
);
const reviewer = read("agents/work-reviewer.md");
check(
	"reviewer coordination gaps stay blocked, not failed",
	reviewer.includes("Outcome: PASS|FAIL|BLOCKED") &&
		reviewer.includes("Return `BLOCKED` immediately") &&
		reviewer.includes("Do not guess or append `wo:review FAIL`") &&
		reviewer.includes("not an implementation failure"),
);
for (const rel of advisorFiles) {
	const text = read(rel);
	check(
		`${rel} checks ordered plan feasibility`,
		[
			"weak or missing requirements",
			"unverified",
			"incomplete decisions",
			"ambiguous scope",
			"untested assumptions",
		].every((signal) => text.includes(signal)) &&
			text.includes("supplements, rather than replaces") &&
			text.includes("declared order") &&
			text.includes("before a slice uses it") &&
			/independent(?:ly)? buildable and verifi|built and verified independently/.test(
				text,
			),
	);
}

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

const userFacingDocs = [
	"README.md",
	"docs/orchestrator.md",
	"docs/orchestrator_idea.md",
	"skills/work-orchestrator/SKILL.md",
	"skills/work-orchestrator/references/full-policy.md",
	...agentFiles.map((name) => `agents/${name}`),
	...listed("prompts").map((name) => `prompts/${name}`),
];
const staleRoadmapTerms = userFacingDocs.flatMap((rel) =>
	[...read(rel).matchAll(/\bepics?\b/gi)].map((match) => `${rel}:${match[0]}`),
);
check(
	"user-facing workflow vocabulary uses roadmap",
	staleRoadmapTerms.length === 0,
	staleRoadmapTerms.join(", "),
);

const evaluationFiles = [
	"agents/workflow-evaluator.md",
	"benchmarks/workflow-evaluation/v1/experiments/calibration.example.json",
	"benchmarks/workflow-evaluation/v1/experiments/critique-decisions/u10.example.json",
	"benchmarks/workflow-evaluation/v1/experiments/decision.example.json",
	"benchmarks/workflow-evaluation/v1/experiments/golden-update.example.json",
	"benchmarks/workflow-evaluation/v1/experiments/model-role-campaign.example.json",
	"benchmarks/workflow-evaluation/v1/experiments/role-calibration.example.json",
	"benchmarks/workflow-evaluation/v1/experiments/role-decisions/u8.example.json",
	"benchmarks/workflow-evaluation/v1/experiments/role-decisions/u9.example.json",
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
const initiatives = read("extensions/work-initiatives.js");
check(
	"initiative domain is packaged with one-way dependencies",
	initiatives.includes("projectInitiativeHierarchy") &&
		!initiatives.includes('from "./work-models.js"'),
);
check(
	"initiative helper and planner contracts are packaged",
	["initiative-summary", "initiative-preview", "initiative-apply"].every(
		(command) => helper.includes(`command === "${command}"`),
	) &&
		read("agents/work-planner.md").includes(
			"select exactly one needs-plan child",
		) &&
		read("prompts/work-plan.md").includes("initiative-preview") &&
		existsSync(path.join(root, "scripts", "test-work-initiative.mjs")),
);
const plannerAgent = read("agents/work-planner.md");
const workerAgent = read("agents/work-worker.md");
const reviewerAgent = read("agents/work-reviewer.md");
check(
	"role agents fail closed on missing native helper paths",
	[plannerAgent, workerAgent, reviewerAgent].every(
		(text) =>
			text.includes("exact absolute `work-helper.mjs` path") &&
			text.includes("directly edit `.ce-workflow/work-items.json`"),
	) &&
		models.includes("Never guess another helper path"),
);
check(
	"reviewers never block on supervisor coordination",
	!reviewerAgent.match(/^tools:.*contact_supervisor/m) &&
		reviewerAgent.includes("Reviewers do not open blocking supervisor requests"),
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
	"test-work-improvement-reporting.mjs",
	"test-work-store.mjs",
	"test-work-store-performance.mjs",
	"test-work-remove-beads.mjs",
	"test-work-remove-beads-windows.mjs",
	...listed("scripts").filter(
		(name) =>
			/^test-work-.*\.mjs$/.test(name) &&
			![
				"test-work-improvement-reporting.mjs",
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
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: path.join(root, ".pi-test-empty-agent"),
			},
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
