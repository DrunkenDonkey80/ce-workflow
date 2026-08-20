#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	normalizeSourcePath,
	readConfinedFile,
	sha256,
} from "../extensions/work-compound-source.js";

export const TRANSLATOR_VERSION = 6;
export const BRAINSTORM_SOURCE = "skills/ce-brainstorm/SKILL.md";
export const PLAN_SOURCE = "skills/ce-plan/SKILL.md";
export const DEBUG_SOURCE = "skills/ce-debug/SKILL.md";
export const LEARNING_SOURCE = "skills/ce-compound/SKILL.md";
export const REVIEW_SOURCE = "skills/ce-code-review/SKILL.md";
export const SIMPLIFY_SOURCE = "skills/ce-simplify-code/SKILL.md";
export const BROWSER_SOURCE = "skills/ce-test-browser/SKILL.md";
export const POV_SOURCE = "skills/ce-pov/SKILL.md";
export const EXPLAIN_SOURCE = "skills/ce-explain/SKILL.md";
const TRANSLATOR_PATH = "scripts/generate-work-private-workflows.mjs";
const WORKFLOW_RULES = {
	brainstorm: [
		"verify-complete-u1-brainstorm-closure",
		"remove-pi-discovery-frontmatter-and-executable-helpers",
		"preserve-one-question-clarification-and-requirements-only-scope",
		"adapt-output-to-work-brainstorm-markdown-link-contract",
	],
	debug: [
		"verify-complete-u1-debug-closure",
		"remove-pi-discovery-frontmatter-and-executable-helpers",
		"preserve-reproduce-root-cause-fix-verify-and-blocker-evidence",
		"adapt-output-to-work-debugger-handoff-contract",
	],
	learning: [
		"verify-complete-u1-compound-closure",
		"remove-pi-discovery-frontmatter-and-executable-helpers",
		"preserve-destination-deduplication-key-and-skip-gates",
		"adapt-output-to-post-fix-and-big-work-learning-contract",
	],
	plan: [
		"verify-complete-u1-plan-closure",
		"remove-pi-discovery-frontmatter-and-executable-helpers",
		"preserve-clarification-requirements-self-audit-and-open-question-gate",
		"adapt-output-to-work-plan-master-and-slice-handoff-contracts",
	],
	review: [
		"verify-complete-u1-code-review-closure",
		"remove-pi-discovery-frontmatter-and-executable-helpers",
		"preserve-scoped-findings-read-only-review-and-bounded-rereview",
		"adapt-output-to-work-finish-review-evidence-contract",
	],
	simplify: [
		"verify-complete-u1-simplify-code-closure",
		"remove-pi-discovery-frontmatter-and-executable-helpers",
		"preserve-equivalent-scoped-simplification-and-noop",
		"adapt-output-to-work-finish-simplify-evidence-contract",
	],
	browser: [
		"verify-complete-u1-test-browser-closure",
		"remove-pi-discovery-frontmatter-and-executable-helpers",
		"preserve-affected-ui-selection-browser-evidence-and-waiver",
		"adapt-output-to-work-finish-browser-evidence-contract",
	],
	pov: [
		"verify-complete-u1-pov-closure",
		"remove-pi-discovery-frontmatter-and-executable-helpers",
		"preserve-project-grounded-graded-verdict-and-read-only-boundary",
		"adapt-output-to-catch-up-candidate-recommendation-contract",
	],
	explain: [
		"verify-complete-u1-explain-closure",
		"remove-pi-discovery-frontmatter-and-executable-helpers",
		"preserve-deep-technical-explanation-without-changing-the-verdict",
		"adapt-output-to-conditional-catch-up-decision-support-contract",
	],
};
const WORKFLOW_SOURCES = {
	brainstorm: { closure: "ce-brainstorm", source: BRAINSTORM_SOURCE },
	browser: { closure: "ce-test-browser", source: BROWSER_SOURCE },
	debug: { closure: "ce-debug", source: DEBUG_SOURCE },
	explain: { closure: "ce-explain", source: EXPLAIN_SOURCE },
	learning: { closure: "ce-compound", source: LEARNING_SOURCE },
	plan: { closure: "ce-plan", source: PLAN_SOURCE },
	pov: { closure: "ce-pov", source: POV_SOURCE },
	review: { closure: "ce-code-review", source: REVIEW_SOURCE },
	simplify: { closure: "ce-simplify-code", source: SIMPLIFY_SOURCE },
};

function json(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(file, label) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(`invalid ${label}: ${error.message}`, { cause: error });
	}
}

function assertVerifiedEvidence(evidence, policy) {
	const required = [
		evidence?.archive?.sha256,
		policy?.archive?.sha256,
		evidence?.licenseEvidence?.path,
		policy?.license?.path,
		evidence?.licenseEvidence?.sha256,
		policy?.license?.sha256,
		evidence?.licenseEvidence?.spdx,
		policy?.license?.spdx,
	];
	if (
		required.some((value) => typeof value !== "string" || !value.trim()) ||
		evidence?.schemaVersion !== 1 ||
		evidence.release !== policy.release ||
		evidence.peeledCommitSha !== policy.peeledCommitSha ||
		evidence.archive.sha256 !== policy.archive.sha256 ||
		evidence.licenseEvidence.path !== policy.license.path ||
		evidence.licenseEvidence.sha256 !== policy.license.sha256 ||
		evidence.licenseEvidence.spdx !== policy.license.spdx ||
		evidence.licenseEvidence?.permissionTextPresent !== true ||
		evidence.runtimeProbe?.zeroEffectiveSurface !== true ||
		(evidence.containment?.quarantineRemoved !== true &&
			evidence.containment?.temporarySourceOnly !== true) ||
		evidence.containment?.globalStateUnchanged !== true
	)
		throw new Error("unverified U1 source evidence");
}

function verifiedClosure(sourceRoot, evidence, workflow) {
	const descriptor = WORKFLOW_SOURCES[workflow];
	const closure = evidence.inventory?.resourceClosures?.[descriptor.closure];
	if (!Array.isArray(closure) || !closure.length || closure[0]?.path !== descriptor.source)
		throw new Error(`missing verified ${workflow} closure`);
	const paths = closure.map((entry) => normalizeSourcePath(entry.path));
	const prefix = `skills/${descriptor.closure}/`;
	if (new Set(paths).size !== paths.length || paths.some((entry) => !entry.startsWith(prefix)))
		throw new Error(`invalid verified ${workflow} closure`);
	const allowed = new Set(paths);
	for (const [index, entry] of closure.entries()) {
		const bytes = readConfinedFile(sourceRoot, paths[index], allowed);
		if (entry.bytes !== bytes.length || entry.sha256 !== sha256(bytes))
			throw new Error(`verified source resource changed: ${paths[index]}`);
	}
	return closure.map(({ path: sourcePath, bytes, sha256: sourceSha256 }) => ({
		path: sourcePath,
		bytes,
		sha256: sourceSha256,
	}));
}

function brainstormPlaybook(sourceClosureSha256) {
	return `# Private Brainstorm Playbook\n\n<!-- generated; source-closure-sha256: ${sourceClosureSha256} -->\n\n## Boundary\n\nExplore and settle **what** to build. Do not implement, debug, review code, or plan implementation. Keep one coherent outcome in scope and treat speculative follow-ons as non-goals.\n\n## Dialogue\n\n1. Read the full request and any already-settled decisions before asking anything.\n2. Inspect the repository only enough to avoid contradicting existing product behavior and conventions.\n3. Classify the request as lightweight, standard, or deep; match ceremony to ambiguity and consequence.\n4. Ask exactly one focused question per \`ask_user\` call until actors, desired outcome, boundaries, success criteria, and important failure behavior are clear. After each answer, continue this workflow in the same assistant turn unless the user cancels or a required answer remains unresolved; do not emit a status-only response or wait for a user-authored continuation. Prefer a blocking single-select question with 3–4 real options when choosing one direction; use an open question when options would steer the answer. Never silently skip clarification for broad, important, or underspecified work.\n5. Act as a thinking partner: surface materially different options, challenge assumptions, explain trade-offs, and recommend the smallest approach that delivers the outcome. Keep libraries, schemas, endpoints, file layouts, and other implementation choices out unless they materially change product behavior.\n6. Before writing, summarize the proposed scope, non-goals, key decisions, risks, and remaining unknowns. Obtain confirmation when unresolved choices would materially change the artifact. If a required decision remains unresolved, stop without inventing it.\n\n## Artifact\n\nWrite one requirements-only Markdown artifact below \`docs/brainstorms/\`. Preserve concise source context and include, as applicable: problem and goal; actors; requirements; user-visible flows and failure behavior; options and decision; non-goals; risks; acceptance examples; and genuinely open questions. Right-size the sections rather than filling a template mechanically. Do not start planning or implementation.\n\nAfter the file exists, end the final response with exactly:\n\n\`Brainstorm saved: <absolute path>\`\n\nDo not append a planning menu or any other text after that line.\n`;
}

function planPlaybook(sourceClosureSha256) {
	return `# Private Plan Playbook\n\n<!-- generated; source-closure-sha256: ${sourceClosureSha256} -->\n\n## Boundary\n\nConvert the caller's source into an implementation-ready plan. Plan only: do not implement, debug, review code, create unrelated work, or invoke a public Compound Engineering skill. The ce-workflow caller owns roadmap mutation and the final actor-visible next action.\n\n## Clarification and depth\n\n1. Read every named source artifact and settled decision before planning. Ask exactly one focused question per \`ask_user\` call when the input is broad, important, contradictory, or underspecified. After each answer, continue planning in the same assistant turn unless the user cancels or a required answer remains unresolved; do not emit a status-only response or wait for a user-authored continuation. Never replace a required product or architecture decision with an assumption.\n2. Honor the caller-selected depth. Lightweight uses strong local patterns and skips flow analysis and external research. Standard adds repository flow analysis. Deep performs the full warranted research and deepening pass. Depth changes evidence effort, not requirement preservation or the final quality gate.\n3. Inspect the repository, history, project instructions, and available learnings only enough to identify the real architecture, affected files, reusable patterns, boundaries, and verification seams. Record requested-but-unavailable evidence rather than pretending it ran.\n\n## Requirement preservation and self-audit\n\nPreserve every decided requirement, constraint, non-goal, actor-visible flow, acceptance example, authoritative reference, and open question. Trace each source decision to a plan requirement, implementation unit, verification proof, explicit open question, or intentionally dropped-with-rationale note. Keep product scope unchanged unless the user explicitly approves a substantive change.\n\nAfter drafting, self-audit for missing source decisions, weak or subjective proof, uncovered failure behavior, cross-layer effects, unsafe sequencing, and implementation units that are too broad. Resolve each material uncertainty by fixing the plan, asking one blocking question, recording a decision/blocker instruction, or documenting an explicit waiver. Never leave a blocking uncertainty as passive risk prose.\n\n## Artifact and Open Question Gate\n\nWrite the caller-requested Markdown plan under \`docs/plans/\`. A master plan includes a goal capsule, product and planning contracts, stable implementation units with Goal/Files/Approach/Test scenarios/Verification, scope boundaries, risks, sources, a verification contract, and definition of done. A slice plan stays compact and contains exactly the caller-requested implementation unit. Set implementation-ready metadata when producing a complete software plan.\n\nKeep unresolved questions explicit and classify blocking versus deferred. Do not bootstrap, attach, or hand implementation a plan with blocking open questions. Run the caller-provided work-helper bootstrap command when present; if its Open Question Gate blocks, ask each reported decision through the platform's blocking question UI, fold the answer into the plan, and rerun the same helper.\n\n## Actor-visible handoff\n\nFollow the caller's exact handoff: master planning returns the hardened plan and coded roadmap/initiative next action; slice planning appends the requested \`wo:slice-plan\` note and stops for the next resume. Do not show the legacy post-generation menu, invoke legacy \`ce-work\`, or invent a different next command.\n`;
}

function debugPlaybook(sourceClosureSha256) {
	return `# Private Debug Playbook\n\n<!-- generated; source-closure-sha256: ${sourceClosureSha256} -->\n\n## Boundary\n\nInvestigate only the assigned bug work item. Treat the work item, current Git state, named artifacts, and direct command output as evidence; inherited chat is not source of truth. Do not commit, close work items, broaden the fix, or substitute diagnosis for required verification.\n\n## Reproduce, root cause, fix, verify\n\n1. Reproduce the reported failure with the smallest safe command before editing. Record observed versus expected behavior and preserve the exact failing command and useful output.\n2. Trace every caller of the failing boundary and establish the causal chain. Distinguish the root cause from downstream symptoms; do not patch until the chain explains the reproduction.\n3. Apply the smallest fix at the shared causal boundary. Preserve unrelated behavior and existing work-item, hardware, and actor-visible contracts.\n4. Rerun the smallest check that failed, then the assigned verification contract. A fix is complete only when the original reproduction and required verification pass.\n\n## Failure and blocker evidence\n\nIf reproduction or verification cannot proceed safely after a real attempt, do not guess or report success. Preserve the command, exit or status, artifact paths, failing phase, observed versus expected behavior, touched files, current causal hypothesis, required external state or decision, and the exact next debug command. Create or reuse the caller-required blocker/debug/decision work item and leave the assigned bug open and explicitly blocked.\n\n## Actor-visible handoff\n\nReturn the work item, reproduced symptom, root cause, fix or diagnosis-only blocker, verification result, work-item updates, and whether durable learning capture is warranted. For a learning candidate, supply one stable lowercase hyphenated key and preferred destination. End with the caller's exact resume or blocker command.\n`;
}

function learningPlaybook(sourceClosureSha256) {
	return `# Private Learning-Capture Playbook\n\n<!-- generated; source-closure-sha256: ${sourceClosureSha256} -->\n\n## Eligibility and skip gate\n\nRun only after a verified root-cause fix or eligible big-work completion. Capture a durable project-specific debugging, architecture, workflow, integration, or operational fact only when it is non-obvious and reusable. Skip routine implementation facts, unverified conclusions, secrets, transient incident data, and any learning key already recorded on the roadmap. Skipping is a successful gate outcome.\n\n## Destination and deduplication\n\nSearch existing project instructions, executable configuration, and \`docs/solutions/\` before writing. Update the existing canonical location instead of duplicating it. Put direct procedures in executable configuration or project instructions; put non-obvious rationale and troubleshooting in \`docs/solutions/\`. Keep the artifact scoped, searchable, and free of session-only narration.\n\n## Work-item key and handoff\n\nDerive one stable lowercase hyphenated key. Check roadmap notes for \`wo:learning:<key>=<artifact>\`; if present, skip capture. After creating or updating the durable artifact, append that exact marker through the caller-provided work helper so future gates deduplicate it, then commit the artifact and marker through the coded finish path before roadmap closure. Report the destination, key, whether content was created, updated, or skipped, and the caller's exact next action.\n`;
}

function reviewPlaybook(sourceClosureSha256) {
	return `# Private Scoped Code-Review Playbook\n\n<!-- generated; source-closure-sha256: ${sourceClosureSha256} -->\n\n## Boundary\n\nReview only the caller-supplied work item, scoped dirty files, current diff, acceptance contract, and verification evidence. Review is read-only: do not edit, stage, commit, close work items, broaden to the whole repository, simplify code, or run browser acceptance.\n\n## Findings and bounded cycle\n\n1. Inspect the complete scoped diff and the smallest surrounding code needed to validate correctness, security, reliability, compatibility, tests, and project conventions. Apply only relevant specialist lenses; do not manufacture findings to fill categories.\n2. Report each actionable finding with severity, file and location, observed risk, and the smallest safe fix. Reject duplicates, speculation without a causal path, and pre-existing issues outside the slice.\n3. Run one initial review cycle. The caller batches blocking fixes into one fixer pass, then runs at most one targeted re-review only when those fixes materially changed production behavior. Skip re-review for tests, docs, formatting, traceability, or other mechanical fixes. Never launch a third review cycle.\n\n## Evidence and failure\n\nAppend exactly one durable \`wo:review PASS\` note when no blocking findings remain, or \`wo:review FAIL\` with the actionable findings when they do. A failed, unavailable, or incomplete required review blocks coded commit and close; do not claim PASS or substitute prose. Return the scoped verdict and the caller's exact next finish action.\n`;
}

function simplifyPlaybook(sourceClosureSha256) {
	return `# Private Scoped Simplification Playbook\n\n<!-- generated; source-closure-sha256: ${sourceClosureSha256} -->\n\n## Boundary and selection\n\nRun only on the caller-supplied non-trivial implementation diff after self-verification and before review. Inspect the scoped diff for concrete duplication, dead flexibility, unnecessary abstraction, avoidable indirection, or code that can be made plainly smaller without changing behavior, public contracts, error handling, validation, security, or accessibility. Do not redesign or widen scope.\n\n## Equivalent change or no-op\n\nIf no material simplification is justified, do not churn the diff; append \`wo:simplify NOOP\`. Otherwise make the smallest equivalent cleanup, rerun the focused verification affected by the edit, and append \`wo:simplify PASS\` with the command and result. Do not stage, commit, close the work item, or perform correctness review or browser testing here.\n\n## Failure\n\nIf equivalence or verification is uncertain, restore or leave the last verified behavior unchanged, record the exact failure evidence, and stop. Missing PASS/NOOP evidence blocks the coded review/commit path.\n`;
}

function browserPlaybook(sourceClosureSha256) {
	return `# Private Affected-UI Browser Playbook\n\n<!-- generated; source-closure-sha256: ${sourceClosureSha256} -->\n\n## Affected UI selection\n\nUse only the caller-supplied UI diff and acceptance contract. Map changed routes, pages, components, views, templates, and styles to the smallest runnable affected pages and user flows. Do not test unrelated pages or infer backend-only coverage from a UI-looking filename. If the project has no runnable web frontend or the affected surface cannot execute, append \`wo:browser NOOP\` with the observed reason.\n\n## Browser verification\n\nStart the documented local app when safe, use the available browser driver, and exercise the smallest non-destructive path for each affected flow, including the relevant failure state and console/network evidence. Preserve user data and restore any toggle or value changed by the check. Append \`wo:browser PASS\` with affected pages, commands/tools, and concise observed evidence only when every required check passes.\n\n## Waiver and failure\n\nOnly an explicit evidence-only user waiver may replace runnable required evidence; append \`wo:browser WAIVED\` with the user's reason. Tool unavailability, a blocking UI failure, or incomplete evidence is not an implicit waiver: record the exact failure and stop. Without PASS, NOOP, or explicit WAIVED evidence, coded commit and close remain blocked. Do not stage, commit, close work items, simplify code, or perform the code-review gate.\n`;
}

function povPlaybook(sourceClosureSha256) {
	return `# Private Catch-up POV Playbook\n\n<!-- generated; source-closure-sha256: ${sourceClosureSha256} -->\n\n## Boundary and evidence floor\n\nApply this read-only playbook to every actionable catch-up candidate, one candidate (or one tightly related group) at a time. Ground the recommendation in both verified upstream release/API evidence and current repository call sites, constraints, prior decisions, and incumbent behavior. Conversation claims are pointers to verify, not evidence. Do not implement, mutate the baseline, ask the actor, or advance the candidate while forming the POV.\n\n## Graded verdict\n\nReturn exactly one project-grounded grade: Adopt, Trial, Hold, Reject, or Not-our-problem. Include the reversibility tier, concise bottom line, verified project fit, benefit, cost/risk, confidence, and one actor-visible recommendation. Adopt or Reject is forbidden when either the project or external evidence floor is missing; return Hold with the missing evidence instead. Preserve the grade and rationale unchanged into the catch-up decision record.\n\n## Handoff and failure\n\nThe caller owns the one-at-a-time Adopt now, Defer, or Skip this release question and all implementation or durable work-item mutation. Reject and Not-our-problem normally become no-action without a question. Missing, contradictory, or unverifiable evidence leaves the candidate undecided and blocks baseline advancement; report the exact evidence needed rather than producing a generic opinion.\n`;
}

function explainPlaybook(sourceClosureSha256) {
	return `# Private Catch-up Technical-Explanation Playbook\n\n<!-- generated; source-closure-sha256: ${sourceClosureSha256} -->\n\n## Conditional boundary\n\nInvoke this read-only playbook only after the POV marks a candidate intentionally too-technical for the actor to decide from its concise summary. Do not invoke it for ordinary candidates, brief follow-ups, status reporting, or as a substitute for missing POV evidence. It teaches the already-grounded candidate and never selects, changes, or softens the graded verdict.\n\n## Decision-ready explanation\n\nExplain the candidate's mechanism in the repository's actual terms, then connect it to the current call sites, incumbent behavior, likely change, benefit, cost, risk, and reversibility. Prefer a compact worked example or before/after flow over generic background. Label any unverified claim and keep internal workflow mechanics out of the actor-visible explanation.\n\n## Return and failure\n\nReturn the explanation to the same undecided candidate so the caller can present its original POV, recommendation, and one-at-a-time Adopt now, Defer, or Skip this release choice. If the explanation cannot be grounded safely, identify the missing fact and keep the candidate undecided; do not advance the completion manifest.\n`;
}

const PLAYBOOKS = {
	brainstorm: brainstormPlaybook,
	browser: browserPlaybook,
	debug: debugPlaybook,
	explain: explainPlaybook,
	learning: learningPlaybook,
	plan: planPlaybook,
	pov: povPlaybook,
	review: reviewPlaybook,
	simplify: simplifyPlaybook,
};

export function translateVerifiedWorkflows({
	sourceRoot,
	evidence,
	policy,
	translatorBytes,
	workflows = ["brainstorm", "browser", "debug", "explain", "learning", "plan", "pov", "review", "simplify"],
}) {
	assertVerifiedEvidence(evidence, policy);
	if (
		!workflows.length ||
		workflows.some(
			(workflow) =>
				!WORKFLOW_SOURCES[workflow] ||
				!WORKFLOW_RULES[workflow] ||
				!PLAYBOOKS[workflow],
		)
	)
		throw new Error("unknown private workflow translation request");
	const selected = [...new Set(workflows)].sort();
	const closures = Object.fromEntries(
		selected.map((workflow) => [workflow, verifiedClosure(sourceRoot, evidence, workflow)]),
	);
	const sources = selected.flatMap((workflow) => closures[workflow]);
	const sourceClosureSha256 = sha256(JSON.stringify(sources));
	const translator = {
		path: TRANSLATOR_PATH,
		sha256: sha256(translatorBytes ?? readFileSync(fileURLToPath(import.meta.url))),
		version: TRANSLATOR_VERSION,
		rules: selected.flatMap((workflow) => WORKFLOW_RULES[workflow]),
	};
	const provenance = {
		schemaVersion: 1,
		release: evidence.release,
		peeledCommitSha: evidence.peeledCommitSha,
		archive: { sha256: evidence.archive.sha256 },
		license: {
			path: evidence.licenseEvidence.path,
			spdx: evidence.licenseEvidence.spdx,
			sha256: evidence.licenseEvidence.sha256,
			permissionTextPresent: true,
			notices: evidence.licenseEvidence.notices ?? [],
		},
		translator,
		sourceClosureSha256,
		sources,
	};
	const playbooks = Object.fromEntries(
		selected.map((workflow) => {
			const closureHash = sha256(JSON.stringify(closures[workflow]));
			return [workflow, PLAYBOOKS[workflow](closureHash)];
		}),
	);
	const provenanceText = json(provenance);
	const workflowEntries = Object.fromEntries(
		selected.map((workflow) => [
			workflow,
			{ path: `${workflow}.md`, sha256: sha256(playbooks[workflow]) },
		]),
	);
	const generation = {
		schemaVersion: 1,
		verified: true,
		translator: { path: translator.path, sha256: translator.sha256, version: translator.version },
		provenance: { path: "provenance.json", sha256: sha256(provenanceText) },
		workflows: workflowEntries,
	};
	return {
		...Object.fromEntries(selected.map((workflow) => [`${workflow}.md`, playbooks[workflow]])),
		"manifest.json": json({
			...generation,
			generationSha256: sha256(JSON.stringify(generation)),
		}),
		"provenance.json": provenanceText,
	};
}

export function translateVerifiedBrainstorm(args) {
	return translateVerifiedWorkflows({ ...args, workflows: ["brainstorm"] });
}

export function writePrivateWorkflowGeneration(outputRoot, files) {
	mkdirSync(outputRoot, { recursive: true });
	for (const name of Object.keys(files).sort())
		writeFileSync(path.join(outputRoot, name), files[name]);
}

function argumentsFrom(argv) {
	const values = {};
	const allowed = new Set(["--source", "--evidence", "--output"]);
	for (let index = 0; index < argv.length; index += 2) {
		const name = argv[index];
		const value = argv[index + 1];
		if (!allowed.has(name) || value === undefined || value.startsWith("--"))
			throw new Error(`invalid argument: ${name ?? "missing"}`);
		values[name.slice(2)] = value;
	}
	return values;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = argumentsFrom(process.argv.slice(2));
	if (!args.source || !args.evidence)
		throw new Error("usage: generate-work-private-workflows.mjs --source <verified-root> --evidence <u1-report> [--output <directory>]");
	const repositoryRoot = path.resolve(import.meta.dirname, "..");
	const evidence = readJson(path.resolve(args.evidence), "source evidence");
	const policy = readJson(
		path.join(repositoryRoot, "extensions", "work-compound-source-policy.json"),
		"source policy",
	);
	const outputRoot = path.resolve(
		args.output ?? path.join(repositoryRoot, "extensions", "private-workflows"),
	);
	const files = translateVerifiedWorkflows({ sourceRoot: path.resolve(args.source), evidence, policy });
	writePrivateWorkflowGeneration(outputRoot, files);
	console.log(`PASS generate-work-private-workflows release=${evidence.release} workflows=brainstorm,browser,debug,explain,learning,plan,pov,review,simplify files=${Object.keys(files).length}`);
}
