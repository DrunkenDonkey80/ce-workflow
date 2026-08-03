#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	normalizeSourcePath,
	readConfinedFile,
	sha256,
} from "../extensions/work-compound-source.js";

export const TRANSLATOR_VERSION = 1;
export const BRAINSTORM_SOURCE = "skills/ce-brainstorm/SKILL.md";
const TRANSLATOR_PATH = "scripts/generate-work-private-workflows.mjs";
const RULES = [
	"verify-complete-u1-brainstorm-closure",
	"remove-pi-discovery-frontmatter-and-executable-helpers",
	"preserve-one-question-clarification-and-requirements-only-scope",
	"adapt-output-to-work-brainstorm-markdown-link-contract",
];

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

function verifiedClosure(sourceRoot, evidence) {
	const closure = evidence.inventory?.resourceClosures?.["ce-brainstorm"];
	if (!Array.isArray(closure) || !closure.length || closure[0]?.path !== BRAINSTORM_SOURCE)
		throw new Error("missing verified brainstorm closure");
	const paths = closure.map((entry) => normalizeSourcePath(entry.path));
	if (new Set(paths).size !== paths.length || paths.some((entry) => !entry.startsWith("skills/ce-brainstorm/")))
		throw new Error("invalid verified brainstorm closure");
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

function playbook(sourceClosureSha256) {
	return `# Private Brainstorm Playbook\n\n<!-- generated; source-closure-sha256: ${sourceClosureSha256} -->\n\n## Boundary\n\nExplore and settle **what** to build. Do not implement, debug, review code, or plan implementation. Keep one coherent outcome in scope and treat speculative follow-ons as non-goals.\n\n## Dialogue\n\n1. Read the full request and any already-settled decisions before asking anything.\n2. Inspect the repository only enough to avoid contradicting existing product behavior and conventions.\n3. Classify the request as lightweight, standard, or deep; match ceremony to ambiguity and consequence.\n4. Ask exactly one focused clarification per turn until actors, desired outcome, boundaries, success criteria, and important failure behavior are clear. Prefer a blocking single-select question with 3–4 real options when choosing one direction; use an open question when options would steer the answer. Never silently skip clarification for broad, important, or underspecified work.\n5. Act as a thinking partner: surface materially different options, challenge assumptions, explain trade-offs, and recommend the smallest approach that delivers the outcome. Keep libraries, schemas, endpoints, file layouts, and other implementation choices out unless they materially change product behavior.\n6. Before writing, summarize the proposed scope, non-goals, key decisions, risks, and remaining unknowns. Obtain confirmation when unresolved choices would materially change the artifact. If a required decision remains unresolved, stop without inventing it.\n\n## Artifact\n\nWrite one requirements-only Markdown artifact below \`docs/brainstorms/\`. Preserve concise source context and include, as applicable: problem and goal; actors; requirements; user-visible flows and failure behavior; options and decision; non-goals; risks; acceptance examples; and genuinely open questions. Right-size the sections rather than filling a template mechanically. Do not start planning or implementation.\n\nAfter the file exists, end the final response with exactly:\n\n\`Brainstorm saved: <absolute path>\`\n\nDo not append a planning menu or any other text after that line.\n`;
}

export function translateVerifiedBrainstorm({ sourceRoot, evidence, policy, translatorBytes }) {
	assertVerifiedEvidence(evidence, policy);
	const sources = verifiedClosure(sourceRoot, evidence);
	const sourceClosureSha256 = sha256(JSON.stringify(sources));
	const translator = {
		path: TRANSLATOR_PATH,
		sha256: sha256(translatorBytes ?? readFileSync(fileURLToPath(import.meta.url))),
		version: TRANSLATOR_VERSION,
		rules: RULES,
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
	const provenanceText = json(provenance);
	const brainstormText = playbook(sourceClosureSha256);
	const workflow = { path: "brainstorm.md", sha256: sha256(brainstormText) };
	const generation = {
		schemaVersion: 1,
		verified: true,
		translator: { path: translator.path, sha256: translator.sha256, version: translator.version },
		provenance: { path: "provenance.json", sha256: sha256(provenanceText) },
		workflows: { brainstorm: workflow },
	};
	const manifest = {
		...generation,
		generationSha256: sha256(JSON.stringify(generation)),
	};
	return {
		"brainstorm.md": brainstormText,
		"manifest.json": json(manifest),
		"provenance.json": provenanceText,
	};
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
	const files = translateVerifiedBrainstorm({ sourceRoot: path.resolve(args.source), evidence, policy });
	writePrivateWorkflowGeneration(outputRoot, files);
	console.log(`PASS generate-work-private-workflows release=${evidence.release} workflows=brainstorm files=${Object.keys(files).length}`);
}
