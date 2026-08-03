import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSourcePath, sha256 } from "./work-compound-source.js";

const RESOURCE_ROOT = fileURLToPath(new URL("./private-workflows/", import.meta.url));
const INTERNAL_CALLER = fileURLToPath(new URL("./work-models.js", import.meta.url));
const ACTION_TOKEN = "work-models:F7:brainstorm:v1";
const ALLOWLIST = new Map([["brainstorm", "brainstorm.md"]]);

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
	return readFileSync(real);
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
	exactKeys(manifest.workflows, ["brainstorm"], "allowlist");
	exactKeys(manifest.workflows.brainstorm, ["path", "sha256"], "brainstorm entry");

	for (const relativePath of [manifest.provenance.path, manifest.workflows.brainstorm.path])
		normalizeSourcePath(relativePath);
	if (
		manifest.provenance.path !== "provenance.json" ||
		manifest.workflows.brainstorm.path !== ALLOWLIST.get("brainstorm")
	)
		throw new Error("private workflow resource is outside the allowlist");
	const { generationSha256, ...generation } = manifest;
	if (generationSha256 !== sha256(JSON.stringify(generation)))
		throw new Error("unverified private workflow generation");
}

export function dispatchPrivateWorkflow(workflow, authority = {}) {
	if (
		authority.actionToken !== ACTION_TOKEN ||
		path.resolve(fileURLToPath(authority.callerUrl ?? "file:///external")) !== path.resolve(INTERNAL_CALLER)
	)
		throw new Error("external private workflow caller rejected");
	if (!ALLOWLIST.has(workflow))
		throw new Error(`unknown private workflow: ${workflow}`);

	const manifest = parseJson(confinedFile("manifest.json"), "manifest");
	verifyManifest(manifest);
	const provenance = confinedFile(manifest.provenance.path);
	if (sha256(provenance) !== manifest.provenance.sha256)
		throw new Error("private workflow provenance changed");
	const provenanceRecord = parseJson(provenance, "provenance");
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
	if (sha256(resource) !== entry.sha256)
		throw new Error(`private workflow resource changed: ${workflow}`);
	return resource.toString("utf8");
}

