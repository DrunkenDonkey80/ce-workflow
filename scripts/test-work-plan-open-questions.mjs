#!/usr/bin/env node
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { assert, installWorkflowFixture } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "work-command-fixture.mjs")),
	).href
);
const { buildWorkPlanState, scanPlanOpenQuestions, bootstrapPlanEpic } =
	await import(
		pathToFileURL(
			realpathSync(
				path.join(import.meta.dirname, "../extensions/work-models.js"),
			),
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
			/suggested default/.test(state.handoffPrompt),
		"handoff prompt drives a per-question ask_user loop with suggested defaults",
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
			fixture.store().items[bootstrapped.epic.id]?.documentLinks?.design === cleanPlanRel,
		"bootstrap creates the epic plus one planning task with a plan link",
	);
} finally {
	fixture.cleanup();
}

console.log("open-questions gate: PASS");
