#!/usr/bin/env node
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { assert, installWorkflowFixture } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "work-command-fixture.mjs")),
	).href
);
const {
	buildWorkPlanState,
	scanPlanOpenQuestions,
	bootstrapPlanEpic,
	executeOrchestratorAction,
} = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "../extensions/work-models.js")),
	).href
);

const planWithOpenQuestions = [
	"---",
	"title: Demo plan",
	"---",
	"# Plan",
	"## Open Questions",
	"- **OQ-1 (scope, non-blocking):** One barcode per step or multi? Default if no answer: single-step only; focus stays CLI-only.",
	"- **OQ-2:** Bundle firmware image or pick from disk? (default: pick from disk)",
	"## Decisions",
	"- D1 reuse the engine.",
	"",
].join("\n");

// Unit: the scanner finds unresolved open questions with suggested defaults.
const found = scanPlanOpenQuestions(planWithOpenQuestions);
assert(
	Array.isArray(found) && found.length === 2,
	"scanner finds both open questions",
);
assert(
	found[0].id === "OQ-1" && /single-step only/.test(found[0].suggested_default),
	"OQ-1 id and suggested default captured",
);
assert(
	found[1].id === "OQ-2" && /pick from disk/.test(found[1].suggested_default),
	"OQ-2 id and suggested default captured",
);

// Unit: a resolved section / confirmed items do not count as open.
assert(
	scanPlanOpenQuestions(
		[
			"# Plan",
			"## Resolved Decisions (no open questions remain)",
			"- **OQ-1 → confirmed: single-step only.**",
			"- **OQ-2 decided: pick from disk.**",
			"",
		].join("\n"),
	).length === 0,
	"resolved decisions section yields no open questions",
);
assert(
	scanPlanOpenQuestions("# Plan\n- **OQ-3:** deferred, waived for now.\n")
		.length === 0,
	"waived bullet is excluded",
);
assert(
	scanPlanOpenQuestions("# Plan\nNarrative with no open questions section.\n")
		.length === 0,
	"plan without an Open Questions section yields nothing",
);

// Integration: /work-plan blocks epic creation while open questions remain.
const fixture = installWorkflowFixture({ native: true });
try {
	const cwd = fixture.cwd;
	const planRel = path.join("docs", "plans", "demo-plan.md");
	mkdirSync(path.join(cwd, "docs", "plans"), { recursive: true });
	writeFileSync(path.join(cwd, planRel), planWithOpenQuestions, "utf8");

	const state = buildWorkPlanState(cwd, planRel);
	assert(
		state.action === "open-questions-block",
		`plan with open questions blocks epic creation (got ${state.action})`,
	);
	assert(
		state.open_questions?.length === 2,
		"blocked state exposes the unresolved open questions",
	);
	assert(
		/ask_user/.test(state.handoffPrompt) &&
			/suggested default/.test(state.handoffPrompt) &&
			/allowComment=true/.test(state.handoffPrompt),
		"handoff prompt drives a nuanced per-question ask_user loop with suggested defaults",
	);
	assert(
		Object.keys(fixture.store().items).length === 2,
		"no epic or task is created while open questions remain",
	);

	// bootstrapPlanEpic (the agent's in-flow epic creator) also blocks on open questions.
	const blockedBootstrap = bootstrapPlanEpic(cwd, planRel);
	assert(
		blockedBootstrap.action === "open-questions-block" &&
			blockedBootstrap.open_questions?.length === 2,
		"bootstrapPlanEpic blocks epic creation on open questions",
	);
	assert(
		Object.keys(fixture.store().items).length === 2,
		"bootstrapPlanEpic creates no item while open questions remain",
	);

	// A clean plan bootstraps the epic + first planning WorkItem directly.
	const cleanPlanRel = path.join("docs", "plans", "clean-plan.md");
	writeFileSync(
		path.join(cwd, cleanPlanRel),
		[
			"---",
			"title: Clean demo plan",
			"---",
			"# Plan",
			"## Summary",
			"A clean plan with no open questions.",
			"## Decisions",
			"- D1 reuse the engine.",
			"",
		].join("\n"),
		"utf8",
	);
	const bootstrapped = bootstrapPlanEpic(cwd, cleanPlanRel);
	assert(
		bootstrapped.action === "run-planner" && bootstrapped.epic?.id,
		"bootstrapPlanEpic creates the epic for a clean plan",
	);
	assert(
		Object.keys(fixture.store().items).length === 4 &&
			fixture.store().items[bootstrapped.epic.id]?.documentLinks?.design ===
				cleanPlanRel.replaceAll("\\", "/"),
		"bootstrap creates the epic plus one planning task with a plan link",
	);
} finally {
	fixture.cleanup();
}

const executableFixture = installWorkflowFixture({ native: true });
try {
	const cwd = executableFixture.cwd;
	const planRel = path.join("docs", "plans", "executable-plan.md");
	mkdirSync(path.join(cwd, "docs", "plans"), { recursive: true });
	const commandContract = {
		version: 1,
		required: [
			{
				id: "focused-test",
				capability: "command",
				proof: "test",
				source: "declared plan operation",
				operation: {
					command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify("process.stdout.write('ok')")}`,
					expectedExit: 0,
					assertions: [{ target: "stdout", operator: "includes", value: "ok" }],
				},
			},
		],
	};
	const browserContract = {
		version: 1,
		required: [
			{
				id: "browser-visual",
				capability: "browser",
				proof: "visual",
				source: "declared plan operation",
				operation: { adapter: "browser", timeoutMs: 60_000 },
				artifacts: ["screenshot"],
				inspection: "goal",
			},
		],
	};
	writeFileSync(
		path.join(cwd, planRel),
		[
			"---",
			"title: Executable demo plan",
			"artifact_readiness: executable",
			"---",
			"# Executable demo plan",
			"```json",
			JSON.stringify({
				implementationUnits: [
					{
						key: "U1",
						title: "Mechanical behavior",
						outcome: "Keyboard arithmetic works.",
						acceptance: ["Focused command passes."],
						dependencies: [],
						files: ["src/calculator.js"],
						nonGoals: ["Browser styling"],
						verificationContract: commandContract,
					},
					{
						key: "U2",
						title: "Browser presentation",
						outcome: "Browser interaction and responsive presentation work.",
						acceptance: "Visual proof is captured and inspected.",
						dependencies: ["U1"],
						surfaces: ["browser"],
						discoveryAllowed: true,
						nonGoals: ["Desktop packaging"],
						verificationContract: browserContract,
					},
				],
			}),
			"```",
			"",
		].join("\n"),
		"utf8",
	);
	const materialized = bootstrapPlanEpic(cwd, planRel);
	const children = Object.values(executableFixture.store().items).filter(
		(item) => item.parentId === materialized.epic?.id,
	);
	assert(
		materialized.action !== "run-planner" &&
			children.length === 2 &&
			children.every(
				(item) =>
					!item.labels.includes("wo:planning") &&
					item.labels.includes("wo:slice-planned"),
			) &&
			!materialized.handoffPrompt?.includes("Advisor critic gate"),
		`executable plan units materialize as planned work without another planner or advisor gate: ${JSON.stringify({ materialized, children })}`,
	);
	assert(
		children[0].dependencies.length === 0 &&
			children[1].dependencies.includes(children[0].id) &&
			children[0].implementationScope.files[0] === "src/calculator.js" &&
			children[1].implementationScope.discoveryAllowed === true,
		"materialized units preserve the declared dependency graph and scope",
	);
	assert(
		children[0].verificationContract.required.some(
			(entry) => entry.capability === "command",
		) &&
			children[1].verificationContract.required.some(
				(entry) => entry.capability === "browser" && entry.proof === "visual",
			),
		"materialization preserves per-slice declared mechanical and rendered capability proof",
	);
} finally {
	executableFixture.cleanup();
}

const incompleteFixture = installWorkflowFixture({ native: true });
try {
	const planRel = "incomplete-plan.md";
	writeFileSync(
		path.join(incompleteFixture.cwd, planRel),
		"---\nartifact_readiness: implementation-ready\n---\n# Plan\n## U1: Heading only\n",
	);
	const rejected = bootstrapPlanEpic(incompleteFixture.cwd, planRel);
	assert(
		rejected.action === "planning-required" &&
			rejected.missingFields.includes(
				"implementationUnits[].verificationContract",
			) &&
			Object.keys(incompleteFixture.store().items).length === 2,
		"heading-only readiness is rejected with exact missing structured fields and no store mutation",
	);
} finally {
	incompleteFixture.cleanup();
}

const migrationFixture = installWorkflowFixture({ native: true });
try {
	const cwd = migrationFixture.cwd;
	writeFileSync(
		path.join(cwd, "PLAN.md"),
		[
			"---",
			"artifact_readiness: implementation-ready",
			"---",
			"# Imported plan",
			"```json",
			JSON.stringify({
				implementationUnits: [
					{
						key: "U1",
						title: "Complete behavior",
						outcome: "Focused behavior is complete.",
						acceptance: "The declared command passes.",
						dependencies: [],
						files: ["src/result.js"],
						verificationContract: {
							version: 1,
							required: [
								{
									id: "focused-test",
									capability: "command",
									proof: "test",
									source: "imported plan",
									operation: {
										command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify("process.exit(0)")}`,
										expectedExit: 0,
										assertions: [{ target: "exit", operator: "equals", value: "0" }],
									},
								},
							],
						},
					},
				],
			}),
			"```",
		].join("\n"),
	);
	const messages = [];
	const migrated = await executeOrchestratorAction(
		"work-migrate",
		"PLAN.md",
		{
			cwd,
			mode: "rpc",
			ui: { notify: () => {} },
			sendUserMessage: async (message) => messages.push(message),
		},
		{ sendUserMessage: async (message) => messages.push(message) },
	);
	assert(
		migrated.action === "migrate-materialized" &&
			migrated.materializedUnits?.length === 1 &&
			messages.length === 0,
		"executable plan migration is coded and launches neither migrator nor planner",
	);
} finally {
	migrationFixture.cleanup();
}

console.log("open-questions and executable materialization gates: PASS");
