#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	normalizeSourcePath,
	readConfinedFile,
	sha256,
} from "../extensions/work-compound-source.js";

export const TRANSLATOR_VERSION = 3;
export const BRAINSTORM_SOURCE = "skills/ce-brainstorm/SKILL.md";
export const PLAN_SOURCE = "skills/ce-plan/SKILL.md";
export const DEBUG_SOURCE = "skills/ce-debug/SKILL.md";
export const LEARNING_SOURCE = "skills/ce-compound/SKILL.md";
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
};
const WORKFLOW_SOURCES = {
	brainstorm: { closure: "ce-brainstorm", source: BRAINSTORM_SOURCE },
	debug: { closure: "ce-debug", source: DEBUG_SOURCE },
	learning: { closure: "ce-compound", source: LEARNING_SOURCE },
	plan: { closure: "ce-plan", source: PLAN_SOURCE },
};

function json(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function assertVerifiedEvidence(evidence, policy) {
	if (
		evidence?.schemaVersion !== 1 ||
		evidence.release !== policy.release ||
		evidence.peeledCommitSha !== policy.peeledCommitSha ||
		evidence.archive?.sha256 !== policy.archive.sha256 ||
		evidence.licenseEvidence?.path !== policy.license.path ||
		evidence.licenseEvidence?.sha256 !== policy.license.sha256 ||
		evidence.licenseEvidence?.spdx !== policy.license.spdx ||
		evidence.licenseEvidence?.permissionTextPresent !== true ||
		evidence.runtimeProbe?.zeroEffectiveSurface !== true ||
		evidence.containment?.quarantineRemoved !== true ||
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
	return `# Private Brainstorm Playbook\n\n<!-- generated; source-closure-sha256: ${sourceClosureSha256} -->\n\n## Boundary\n\nExplore and settle **what** to build. Do not implement, debug, review code, or plan implementation. Keep one coherent outcome in scope and treat speculative follow-ons as non-goals.\n\n## Dialogue\n\n1. Read the full request and any already-settled decisions before asking anything.\n2. Inspect the repository only enough to avoid contradicting existing product behavior and conventions.\n3. Classify the request as lightweight, standard, or deep; match ceremony to ambiguity and consequence.\n4. Ask exactly one focused clarification per turn until actors, desired outcome, boundaries, success criteria, and important failure behavior are clear. Prefer a blocking single-select question with 3–4 real options when choosing one direction; use an open question when options would steer the answer. Never silently skip clarification for broad, important, or underspecified work.\n5. Act as a thinking partner: surface materially different options, challenge assumptions, explain trade-offs, and recommend the smallest approach that delivers the outcome. Keep libraries, schemas, endpoints, file layouts, and other implementation choices out unless they materially change product behavior.\n6. Before writing, summarize the proposed scope, non-goals, key decisions, risks, and remaining unknowns. Obtain confirmation when unresolved choices would materially change the artifact. If a required decision remains unresolved, stop without inventing it.\n\n## Artifact\n\nWrite one requirements-only Markdown artifact below \`docs/brainstorms/\`. Preserve concise source context and include, as applicable: problem and goal; actors; requirements; user-visible flows and failure behavior; options and decision; non-goals; risks; acceptance examples; and genuinely open questions. Right-size the sections rather than filling a template mechanically. Do not start planning or implementation.\n\nAfter the file exists, end the final response with exactly:\n\n\`Brainstorm saved: <absolute path>\`\n\nDo not append a planning menu or any other text after that line.\n`;
}

function planPlaybook(sourceClosureSha256) {
	return `# Private Plan Playbook\n\n<!-- generated; source-closure-sha256: ${sourceClosureSha256} -->\n\n## Boundary\n\nConvert the caller's source into an implementation-ready plan. Plan only: do not implement, debug, review code, create unrelated work, or invoke a public Compound Engineering skill. The ce-workflow caller owns roadmap mutation and the final actor-visible next action.\n\n## Clarification and depth\n\n1. Read every named source artifact and settled decision before planning. Ask exactly one focused clarification per turn when the input is broad, important, contradictory, or underspecified; never replace a required product or architecture decision with an assumption.\n2. Honor the caller-selected depth. Lightweight uses strong local patterns and skips flow analysis and external research. Standard adds repository flow analysis. Deep performs the full warranted research and deepening pass. Depth changes evidence effort, not requirement preservation or the final quality gate.\n3. Inspect the repository, history, project instructions, and available learnings only enough to identify the real architecture, affected files, reusable patterns, boundaries, and verification seams. Record requested-but-unavailable evidence rather than pretending it ran.\n\n## Requirement preservation and self-audit\n\nPreserve every decided requirement, constraint, non-goal, actor-visible flow, acceptance example, authoritative reference, and open question. Trace each source decision to a plan requirement, implementation unit, verification proof, explicit open question, or intentionally dropped-with-rationale note. Keep product scope unchanged unless the user explicitly approves a substantive change.\n\nAfter drafting, self-audit for missing source decisions, weak or subjective proof, uncovered failure behavior, cross-layer effects, unsafe sequencing, and implementation units that are too broad. Resolve each material uncertainty by fixing the plan, asking one blocking question, recording a decision/blocker instruction, or documenting an explicit waiver. Never leave a blocking uncertainty as passive risk prose.\n\n## Artifact and Open Question Gate\n\nWrite the caller-requested Markdown plan under \`docs/plans/\`. A master plan includes a goal capsule, product and planning contracts, stable implementation units with Goal/Files/Approach/Test scenarios/Verification, scope boundaries, risks, sources, a verification contract, and definition of done. A slice plan stays compact and contains exactly the caller-requested implementation unit. Set implementation-ready metadata when producing a complete software plan.\n\nKeep unresolved questions explicit and classify blocking versus deferred. Do not bootstrap, attach, or hand implementation a plan with blocking open questions. Run the caller-provided work-helper bootstrap command when present; if its Open Question Gate blocks, ask each reported decision through the platform's blocking question UI, fold the answer into the plan, and rerun the same helper.\n\n## Actor-visible handoff\n\nFollow the caller's exact handoff: master planning returns the hardened plan and coded roadmap/initiative next action; slice planning appends the requested \`wo:slice-plan\` note and stops for the next resume. Do not show the legacy post-generation menu, invoke legacy \`ce-work\`, or invent a different next command.\n`;
}

function debugPlaybook(sourceClosureSha256) {
	return `# Private Debug Playbook\n\n<!-- generated; source-closure-sha256: ${sourceClosureSha256} -->\n\n## Boundary\n\nInvestigate only the assigned bug work item. Treat the work item, current Git state, named artifacts, and direct command output as evidence; inherited chat is not source of truth. Do not commit, close work items, broaden the fix, or substitute diagnosis for required verification.\n\n## Reproduce, root cause, fix, verify\n\n1. Reproduce the reported failure with the smallest safe command before editing. Record observed versus expected behavior and preserve the exact failing command and useful output.\n2. Trace every caller of the failing boundary and establish the causal chain. Distinguish the root cause from downstream symptoms; do not patch until the chain explains the reproduction.\n3. Apply the smallest fix at the shared causal boundary. Preserve unrelated behavior and existing work-item, hardware, and actor-visible contracts.\n4. Rerun the smallest check that failed, then the assigned verification contract. A fix is complete only when the original reproduction and required verification pass.\n\n## Failure and blocker evidence\n\nIf reproduction or verification cannot proceed safely after a real attempt, do not guess or report success. Preserve the command, exit or status, artifact paths, failing phase, observed versus expected behavior, touched files, current causal hypothesis, required external state or decision, and the exact next debug command. Create or reuse the caller-required blocker/debug/decision work item and leave the assigned bug open and explicitly blocked.\n\n## Actor-visible handoff\n\nReturn the work item, reproduced symptom, root cause, fix or diagnosis-only blocker, verification result, work-item updates, and whether durable learning capture is warranted. For a learning candidate, supply one stable lowercase hyphenated key and preferred destination. End with the caller's exact resume or blocker command.\n`;
}

function learningPlaybook(sourceClosureSha256) {
	return `# Private Learning-Capture Playbook\n\n<!-- generated; source-closure-sha256: ${sourceClosureSha256} -->\n\n## Eligibility and skip gate\n\nRun only after a verified root-cause fix or eligible big-work completion. Capture a durable project-specific debugging, architecture, workflow, integration, or operational fact only when it is non-obvious and reusable. Skip routine implementation facts, unverified conclusions, secrets, transient incident data, and any learning key already recorded on the roadmap. Skipping is a successful gate outcome.\n\n## Destination and deduplication\n\nSearch existing project instructions, executable configuration, and \`docs/solutions/\` before writing. Update the existing canonical location instead of duplicating it. Put direct procedures in executable configuration or project instructions; put non-obvious rationale and troubleshooting in \`docs/solutions/\`. Keep the artifact scoped, searchable, and free of session-only narration.\n\n## Work-item key and handoff\n\nDerive one stable lowercase hyphenated key. Check roadmap notes for \`wo:learning:<key>=<artifact>\`; if present, skip capture. After creating or updating the durable artifact, append that exact marker through the caller-provided work helper so future gates deduplicate it, then commit the artifact and marker through the coded finish path before roadmap closure. Report the destination, key, whether content was created, updated, or skipped, and the caller's exact next action.\n`;
}

const PLAYBOOKS = {
	brainstorm: brainstormPlaybook,
	debug: debugPlaybook,
	learning: learningPlaybook,
	plan: planPlaybook,
};

export function translateVerifiedWorkflows({
	sourceRoot,
	evidence,
	policy,
	translatorBytes,
	workflows = ["brainstorm", "debug", "learning", "plan"],
}) {
	assertVerifiedEvidence(evidence, policy);
	if (!workflows.length || workflows.some((workflow) => !WORKFLOW_SOURCES[workflow]))
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
	for (let index = 0; index < argv.length; index += 2) {
		const name = argv[index];
		if (!name?.startsWith("--") || argv[index + 1] === undefined)
			throw new Error(`invalid argument: ${name ?? "missing"}`);
		values[name.slice(2)] = argv[index + 1];
	}
	return values;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = argumentsFrom(process.argv.slice(2));
	if (!args.source || !args.evidence)
		throw new Error("usage: generate-work-private-workflows.mjs --source <verified-root> --evidence <u1-report> [--output <directory>]");
	const repositoryRoot = path.resolve(import.meta.dirname, "..");
	const evidence = JSON.parse(readFileSync(path.resolve(args.evidence), "utf8"));
	const policy = JSON.parse(
		readFileSync(path.join(repositoryRoot, "extensions", "work-compound-source-policy.json"), "utf8"),
	);
	const outputRoot = path.resolve(
		args.output ?? path.join(repositoryRoot, "extensions", "private-workflows"),
	);
	const files = translateVerifiedWorkflows({ sourceRoot: path.resolve(args.source), evidence, policy });
	writePrivateWorkflowGeneration(outputRoot, files);
	console.log(`PASS generate-work-private-workflows release=${evidence.release} workflows=brainstorm,debug,learning,plan files=${Object.keys(files).length}`);
}
