import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSourcePath, sha256 } from "./work-compound-source.js";

const RESOURCE_ROOT = fileURLToPath(new URL("./private-workflows/", import.meta.url));
const WORK_MODELS_CALLER = fileURLToPath(new URL("./work-models.js", import.meta.url));
const EVALUATION_CALLER = fileURLToPath(new URL("../scripts/workflow-evaluation.mjs", import.meta.url));
const ALLOWLIST = new Map([
	["brainstorm", "brainstorm.md"],
	["browser", "browser.md"],
	["debug", "debug.md"],
	["learning", "learning.md"],
	["plan", "plan.md"],
	["review", "review.md"],
	["simplify", "simplify.md"],
]);
const AUTHORITIES = new Map([
	["work-models:F7:brainstorm:v1", { caller: WORK_MODELS_CALLER, workflows: new Set(["brainstorm"]) }],
	["work-models:debug:investigation:v1", { caller: WORK_MODELS_CALLER, workflows: new Set(["debug"]) }],
	["work-models:finish:learning-capture:v1", { caller: WORK_MODELS_CALLER, workflows: new Set(["learning"]) }],
	["work-models:finish:browser:v1", { caller: WORK_MODELS_CALLER, workflows: new Set(["browser"]) }],
	["work-models:finish:review:v1", { caller: WORK_MODELS_CALLER, workflows: new Set(["review"]) }],
	["work-models:finish:simplify:v1", { caller: WORK_MODELS_CALLER, workflows: new Set(["simplify"]) }],
	["work-models:F7:plan:v1", { caller: WORK_MODELS_CALLER, workflows: new Set(["plan"]) }],
	[
		"workflow-evaluation:candidate-private-resource:v1",
		{ caller: EVALUATION_CALLER, workflows: new Set(["brainstorm", "plan"]) },
	],
]);

function exactKeys(value, expected, label) {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`invalid private workflow ${label}`);
	const keys = Object.keys(value).sort();
	if (JSON.stringify(keys) !== JSON.stringify([...expected].sort()))
		throw new Error(`unknown private workflow ${label} surface`);
}

function confinedFile(relativePath) {
	const normalized = normalizeSourcePath(relativePath);
	const root = realpathSync(RESOURCE_ROOT);
	const absolute = path.resolve(root, ...normalized.split("/"));
	if (!absolute.startsWith(`${root}${path.sep}`))
		throw new Error(`private workflow path escapes resource root: ${relativePath}`);
	const stat = lstatSync(absolute);
	if (!stat.isFile() || stat.isSymbolicLink())
		throw new Error(`private workflow resource is not a regular file: ${relativePath}`);
	const real = realpathSync(absolute);
	if (!real.startsWith(`${root}${path.sep}`))
		throw new Error(`private workflow path resolves outside resource root: ${relativePath}`);
	return { bytes: readFileSync(real), path: real };
}

function parseJson(bytes, label) {
	try {
		return JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error(`invalid private workflow ${label}`);
	}
}

function verifyManifest(manifest) {
	exactKeys(
		manifest,
		["schemaVersion", "verified", "translator", "provenance", "workflows", "generationSha256"],
		"manifest",
	);
	if (manifest.schemaVersion !== 1 || manifest.verified !== true)
		throw new Error("unverified private workflow generation");
	exactKeys(manifest.translator, ["path", "sha256", "version"], "translator");
	exactKeys(manifest.provenance, ["path", "sha256"], "provenance");
	exactKeys(manifest.workflows, [...ALLOWLIST.keys()], "allowlist");
	for (const [workflow, expectedPath] of ALLOWLIST) {
		const entry = manifest.workflows[workflow];
		exactKeys(entry, ["path", "sha256"], `${workflow} entry`);
		normalizeSourcePath(entry.path);
		if (entry.path !== expectedPath)
			throw new Error("private workflow resource is outside the allowlist");
	}
	normalizeSourcePath(manifest.provenance.path);
	if (manifest.provenance.path !== "provenance.json")
		throw new Error("private workflow resource is outside the allowlist");
	const { generationSha256, ...generation } = manifest;
	if (generationSha256 !== sha256(JSON.stringify(generation)))
		throw new Error("unverified private workflow generation");
}

function verifyAuthority(workflow, authority) {
	const permitted = AUTHORITIES.get(authority.actionToken);
	const caller = fileURLToPath(authority.callerUrl ?? "file:///external");
	if (
		!permitted ||
		!permitted.workflows.has(workflow) ||
		path.resolve(caller) !== path.resolve(permitted.caller)
	)
		throw new Error("external private workflow caller rejected");
}

function resolvePrivateWorkflow(workflow, authority) {
	if (!ALLOWLIST.has(workflow))
		throw new Error(`unknown private workflow: ${workflow}`);
	verifyAuthority(workflow, authority);

	const manifestFile = confinedFile("manifest.json");
	const manifest = parseJson(manifestFile.bytes, "manifest");
	verifyManifest(manifest);
	const provenance = confinedFile(manifest.provenance.path);
	if (sha256(provenance.bytes) !== manifest.provenance.sha256)
		throw new Error("private workflow provenance changed");
	const provenanceRecord = parseJson(provenance.bytes, "provenance");
	if (
		provenanceRecord.schemaVersion !== 1 ||
		provenanceRecord.translator?.path !== manifest.translator.path ||
		provenanceRecord.translator?.sha256 !== manifest.translator.sha256 ||
		provenanceRecord.translator?.version !== manifest.translator.version ||
		!Array.isArray(provenanceRecord.sources) ||
		!provenanceRecord.sources.length ||
		!provenanceRecord.release ||
		!provenanceRecord.peeledCommitSha ||
		!provenanceRecord.license?.path ||
		!provenanceRecord.license?.sha256 ||
		!provenanceRecord.license?.spdx
	)
		throw new Error("unverified private workflow provenance");

	const entry = manifest.workflows[workflow];
	const resource = confinedFile(entry.path);
	if (sha256(resource.bytes) !== entry.sha256)
		throw new Error(`private workflow resource changed: ${workflow}`);
	return { entry, resource };
}

export function dispatchPrivateWorkflow(workflow, authority = {}) {
	return resolvePrivateWorkflow(workflow, authority).resource.bytes.toString("utf8");
}

export function describePrivateWorkflowForEvaluation(workflow, authority = {}) {
	const { entry, resource } = resolvePrivateWorkflow(workflow, authority);
	return {
		name: `private-workflow:${workflow}`,
		path: resource.path,
		sha256: entry.sha256,
	};
}
