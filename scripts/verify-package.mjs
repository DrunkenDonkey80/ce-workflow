#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
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
	JSON.stringify(listed("utility-agents")) === '["context-knowledge-discoverer.md","plan3-advisor.md"]');
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
	"extensions/subscription-footer-UPSTREAM.md";
const subscriptionFooterProvenance = existsSync(
	path.join(root, subscriptionFooterProvenancePath),
)
	? read(subscriptionFooterProvenancePath)
	: "";
check(
	"subscription footer provenance is packaged",
	pkg.files?.includes("extensions/") && Boolean(subscriptionFooterProvenance),
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
check(
	"explicit improvement reporting is packaged",
	existsSync(path.join(root, "extensions/work-improvement-reporting.ts")) &&
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
	"background-verifier",
	"advisor",
	"advisor-2",
	"advisor-3",
	"committer",
	"debugger",
	"divergent",
	"fixer",
	"lead",
	"migrator",
	"planner",
	"reviewer",
	"worker",
];
const agentFiles = listed("agents");
check(
	"background verifier role is registered",
	roles.includes("background-verifier"),
);
check(
	"only work role agents ship",
	roles.every((role) => agentFiles.includes(`work-${role}.md`)) &&
		!agentFiles.includes("work-advisor-backup.md") &&
		!agentFiles.some((name) => name.startsWith("bead-")),
);
const divergentAgent = read("agents/work-divergent.md").replaceAll(
	"\r\n",
	"\n",
);
check(
	"divergent role is isolated and tool-free",
	[
		"name: work-divergent",
		"tools:\nthinking: high",
		"inheritProjectContext: false",
		"Never see or request sibling output",
		"Return only this compact JSON array",
	].every((marker) => divergentAgent.includes(marker)),
);
const backgroundVerifierAgent = read("agents/work-background-verifier.md");
check(
	"background verifier agent preserves its immutable read-only contract",
	[
		"name: work-background-verifier",
		"tools: work_verifier_read, work_verifier_list, work_verifier_find, work_verifier_grep",
		"supplied immutable checkpoint",
		"Do not write or edit files, run shell commands or processes, use the network",
		"Return exactly one JSON object",
		"trusted runtime persists that final response",
	].every((marker) => backgroundVerifierAgent.includes(marker)),
);
const lensVerifierAgent = read("agents/work-background-verifier-lens.md");
check(
	"pi-lens verifier preserves the optional read-only orientation contract",
	[
		"name: work-background-verifier-lens",
		"work_verifier_grep, project_report",
		"If it is unavailable or cold",
		"never wait or poll",
		"Verify every finding",
		"Return exactly one JSON object",
	].every((marker) => lensVerifierAgent.includes(marker)),
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
		reviewer.includes("work-note <work-item-id> --append-notes") &&
		reviewer.includes("notes_tail") &&
		reviewer.includes("unsupported `--body`") &&
		reviewer.includes("shell redirection to `nul`/`NUL`") &&
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
	"extensions/work-models.ts",
	"scripts/work-helper.mjs",
	"scripts/work-command-fixture.mjs",
	"skills/work-orchestrator/SKILL.md",
	"skills/work-orchestrator/references/full-policy.md",
	"skills/work-design-handoff/SKILL.md",
	"README.md",
	"docs/orchestrator.md",
	"docs/orchestrator_idea.md",
	...agentFiles
		.filter((name) => name.startsWith("work-"))
		.map((name) => `agents/${name}`),
];
for (const rel of normalPaths) {
	const text = read(rel)
		.replaceAll("legacy-beads-migration.ts", "")
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

const designHandoffSkill = read("skills/work-design-handoff/SKILL.md");
check(
	"design handoff skill is bounded to approved artifacts and existing orchestration",
	designHandoffSkill.includes(
		"adds no command, provider call, or orchestration loop",
	) &&
		designHandoffSkill.includes("prototype code as reference only") &&
		designHandoffSkill.includes("wo:design-deviation") &&
		!designHandoffSkill.includes("API key:"),
);

const learningPolicy = read(
	"skills/work-orchestrator/references/full-policy.md",
);
check(
	"learning capture includes operational discoveries and durable deduplication",
	learningPolicy.includes(
		"project-specific operational facts that took repeated attempts",
	) &&
		learningPolicy.includes("wo:learning:<key>=<artifact>") &&
		read("agents/work-debugger.md").includes("canonical build/test command"),
);

const userFacingDocs = [
	"README.md",
	"docs/orchestrator.md",
	"docs/orchestrator_idea.md",
	"skills/work-orchestrator/SKILL.md",
	"skills/work-orchestrator/references/full-policy.md",
	"skills/work-design-handoff/SKILL.md",
	...agentFiles.map((name) => `agents/${name}`),
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
	"scripts/test-workflow-evaluation-routing-cohorts.mjs",
	"scripts/test-workflow-evaluation-rpc.mjs",
	"scripts/test-workflow-evaluation-runner.mjs",
	"scripts/test-workflow-evaluation-score.mjs",
	"scripts/test-workflow-evaluation-sentinel.mjs",
	"scripts/workflow-evaluation-contract.mjs",
	"scripts/workflow-evaluation-routing-cohorts.mjs",
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
const models = read("extensions/work-models.ts");
const verifierStore = read("extensions/background-verifiers.ts");
check(
	"background verifier tools are registered with the extension",
	[
		"work_verifier_read",
		"work_verifier_list",
		"work_verifier_find",
		"work_verifier_grep",
	].every((tool) => models.includes(`"${tool}"`)),
);
check(
	"background verifier status contract is packaged",
	[
		"not-configured",
		"queued/running",
		"failed/orphaned",
		"completed-awaiting-triage",
		"fully-triaged",
	].every((status) => verifierStore.includes(`"${status}"`)),
);
check(
	"orchestrator has /wo plus F7/F8/F9 and no legacy work slash commands",
	!listed("prompts").some((name) => name.startsWith("work-")) &&
		!models.match(/registerCommand\(["'`]work-/) &&
		models.includes('registerCommand("wo"') &&
		!models.includes('registerCommand("wf"') &&
		["f7", "f8", "f9"].every((key) =>
			models.includes(`registerShortcut?.("${key}"`),
		) &&
		models.includes('title: `${workflowOn ? "Orchestrator" : "Utilities"} — ${LOADED_WORKFLOW_BUILD_LABEL}`'),
);
const helper = read("scripts/work-helper.mjs");
check(
	"models use native store directly",
	models.includes('from "./work-store.ts"') &&
		models.includes("loadStore") &&
		!models.includes("nativeRead") &&
		!models.includes("bdJson"),
);
check(
	"helper uses native store directly",
	helper.includes('import("../extensions/work-store.ts")') &&
		!helper.includes("workItems(argv)"),
);
const initiatives = read("extensions/work-initiatives.ts");
check(
	"initiative domain is packaged with one-way dependencies",
	initiatives.includes("projectInitiativeHierarchy") &&
		!initiatives.includes('from "./work-models.ts"'),
);
check(
	"initiative helper and planner contracts are packaged",
	["initiative-summary", "initiative-preview", "initiative-apply"].every(
		(command) => helper.includes(`command === "${command}"`),
	) &&
		read("agents/work-planner.md").includes(
			"consume its coded preparation state",
		) &&
		read("agents/work-planner.md").includes(
			"do not create slice-planning or executable WorkItems",
		) &&
		models.includes("initiative-preview") &&
		existsSync(path.join(root, "scripts", "test-work-initiative.mjs")),
);
const plannerAgent = read("agents/work-planner.md");
const workerAgent = read("agents/work-worker.md");
const leadAgent = read("agents/work-lead.md");
const reviewerAgent = read("agents/work-reviewer.md");
check(
	"role agents fail closed on missing native helper paths",
	[plannerAgent, workerAgent, leadAgent, reviewerAgent].every(
		(text) =>
			text.includes("exact absolute `work-helper.mjs` path") &&
			text.includes("directly edit `.ce-workflow/work-items.json`"),
	) &&
		models.includes("Never guess another helper path") &&
		models.includes('kind: "role"') &&
		models.includes('agents: ["work-lead"]') &&
		leadAgent.includes("diagnose architecture and plan constraints"),
);
check(
	"worker bounds formatter and Pi Lens autofix expansion",
	workerAgent.includes("git diff HEAD --numstat") &&
		workerAgent.includes("git diff HEAD --ignore-all-space --numstat") &&
		workerAgent.includes("at least a 4× raw-to-semantic ratio") &&
		workerAgent.includes("formatter expansion") &&
		workerAgent.includes("`autofix.enabled: false`") &&
		workerAgent.includes("do not create project config"),
);
check(
	"worker browser deferral remains parent-owned",
	workerAgent.includes("browser-driven web acceptance") &&
		workerAgent.includes("parent-owned finish gate") &&
		workerAgent.includes("Browser gate: pending parent"),
);
check(
	"reviewers never block on supervisor coordination",
	!reviewerAgent.match(/^tools:.*contact_supervisor/m) &&
		reviewerAgent.includes("Reviewers do not open blocking supervisor requests"),
);
check(
	"legacy migration remains available from Orchestrator",
	models.includes('value: "work-remove-beads"') &&
		models.includes("buildWorkRemoveBeadsState"),
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
	"test-jev-tools.mjs",
	"test-background-verifiers.mjs",
	"test-ui-gate-fidelity.mjs",
	"test-ui-gate-hardening.mjs",
	"test-ui-gate-native.mjs",
	"test-ui-gate-repair.mjs",
	"test-ui-gate-tier3.mjs",
	"test-ui-gate-validity.mjs",
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
				// Provider-backed smoke: run explicitly; default verification must stay deterministic.
				"test-work-child-auth-live.mjs",
			].includes(name),
	),
	...listed("scripts").filter((name) =>
		/^test-workflow-evaluation-.*\.mjs$/.test(name),
	),
];
check(
	"background verifier test is discovered exactly once",
	tests.filter((script) => script === "test-background-verifiers.mjs").length ===
		1,
);
// Legacy workflow switch (workOrchestrator.workflow.enabled; unset = off), read like the extension does.
const readJson = (file) => {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return {};
	}
};
const switchOf = (settings) => settings.workOrchestrator?.workflow?.enabled;
const workflowOn =
	process.env.CE_WORKFLOW_ENABLED === "1" ||
	(process.env.CE_WORKFLOW_ENABLED !== "0" &&
		(switchOf(readJson(path.join(root, ".pi", "settings.json"))) ??
			switchOf(readJson(path.join(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent"), "settings.json")))) === true);
// Tests that stay meaningful with the workflow off; every other test is workflow-only.
const GENERAL_TESTS = new Set([
	"test-jev-tools.mjs",
	"test-work-ask-remote.mjs",
	"test-work-compaction.mjs",
	"test-work-compaction-notifications.mjs",
	"test-work-compound-source.mjs",
	"test-work-dialogs.mjs",
	"test-work-extension-scout.mjs",
	"test-work-knowledge.mjs",
	"test-work-knowledge-retrieval.mjs",
	"test-work-microcompact-agent.mjs",
	"test-work-native-smoke.mjs",
	"test-work-plan3.mjs",
	"test-work-prompt-commands.mjs",
	"test-work-settings.mjs",
	"test-work-store.mjs",
	"test-work-store-performance.mjs",
	"test-work-subscription-footer.mjs",
	"test-work-telemetry.mjs",
	"test-work-usage.mjs",
]);
const gitConfigCount = Number(process.env.GIT_CONFIG_COUNT ?? 0);
const testEnvironment = {
	...process.env,
	GIT_CONFIG_COUNT: String(gitConfigCount + 1),
	[`GIT_CONFIG_KEY_${gitConfigCount}`]: "core.autocrlf",
	[`GIT_CONFIG_VALUE_${gitConfigCount}`]: "false",
	PI_CODING_AGENT_DIR: path.join(root, ".pi-test-empty-agent"),
	CE_WORKFLOW_ENABLED: workflowOn ? "1" : "0",
};
for (const script of [...new Set(tests)]) {
	if (!workflowOn && !GENERAL_TESTS.has(script)) {
		process.stdout.write(`skip - ${script} (workflow disabled)\n`);
		continue;
	}
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

if (failures.length) {
	process.stderr.write(`\n${failures.length} verification check(s) failed:\n`);
	for (const failure of failures) process.stderr.write(`- ${failure}\n`);
	process.exit(1);
}
process.stdout.write(
	`${quiet ? "ok - package checks passed" : "\nAll package checks passed."}\n`,
);
