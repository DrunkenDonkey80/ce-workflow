import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DESIGN_SESSION_VERSION = 1;
export const DESIGN_HANDOFF_VERSION = 2;
export const DESIGN_STATES = Object.freeze([
	"not_applicable",
	"audit_required",
	"brief_required",
	"commission_ready",
	"run_pending",
	"run_active",
	"clarification_required",
	"candidate_selection_required",
	"review_ready",
	"sync_required",
	"approval_required",
	"approved",
	"imported",
	"plan_ready",
	"implementation_active",
	"proof_required",
	"completed",
	"canceled",
	"failed",
	"superseded",
]);

const TERMINAL_STATES = new Set(["completed", "canceled", "superseded"]);
const TRANSITIONS = Object.freeze({
	not_applicable: ["audit_required", "brief_required"],
	audit_required: ["brief_required", "canceled", "failed"],
	brief_required: ["commission_ready", "canceled", "failed"],
	commission_ready: ["run_pending", "approval_required", "canceled", "failed"],
	run_pending: [
		"run_active",
		"clarification_required",
		"candidate_selection_required",
		"review_ready",
		"approval_required",
		"failed",
		"canceled",
	],
	run_active: [
		"clarification_required",
		"candidate_selection_required",
		"review_ready",
		"failed",
		"canceled",
	],
	clarification_required: ["run_pending", "review_ready", "canceled", "failed"],
	candidate_selection_required: ["run_pending", "canceled", "failed"],
	review_ready: [
		"sync_required",
		"approval_required",
		"run_pending",
		"canceled",
	],
	sync_required: [
		"approval_required",
		"review_ready",
		"run_pending",
		"failed",
		"canceled",
	],
	approval_required: ["approved", "sync_required", "run_pending", "canceled"],
	approved: ["sync_required", "imported", "superseded"],
	imported: ["plan_ready", "sync_required", "superseded"],
	plan_ready: ["implementation_active", "sync_required", "superseded"],
	implementation_active: [
		"proof_required",
		"sync_required",
		"failed",
		"canceled",
	],
	proof_required: ["completed", "implementation_active", "failed", "canceled"],
	failed: ["run_pending", "approval_required", "canceled", "superseded"],
});

const MAX_TEXT = 20_000;
const MAX_ITEMS = 128;
const ALLOWED_POLICIES = new Set(["off", "auto", "required"]);
const ALLOWED_PROOFS = new Set([
	"interaction",
	"visual",
	"accessibility",
	"logs",
	"manual",
]);
const ALLOWED_VIEWPORTS = new Set(["desktop", "mobile", "tablet"]);
const ALLOWED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const REFERENCE_IMAGE_MAX_BYTES = 700_000;
const ALLOWED_TEXT_EXTENSIONS = new Set([".md", ".json"]);
const RESERVED_NAMES = new Set(["con", "prn", "aux", "nul", "com1", "lpt1"]);

function fail(message) {
	throw new Error(`design-contract: ${message}`);
}

function object(value, field) {
	if (!value || typeof value !== "object" || Array.isArray(value))
		fail(`${field} must be an object`);
	return value;
}

function string(value, field, max = MAX_TEXT) {
	if (typeof value !== "string" || !value.trim())
		fail(`${field} must be a non-empty string`);
	if (Buffer.byteLength(value, "utf8") > max)
		fail(`${field} exceeds ${max} bytes`);
	return value.trim();
}

function optionalString(value, field, max = MAX_TEXT) {
	if (value == null || value === "") return "";
	return string(value, field, max);
}

function array(value, field, { min = 0, max = MAX_ITEMS } = {}) {
	if (!Array.isArray(value) || value.length < min || value.length > max) {
		fail(`${field} must contain ${min}-${max} items`);
	}
	return value;
}

function unique(items, field) {
	const seen = new Set();
	for (const item of items) {
		if (seen.has(item)) fail(`${field} contains duplicate ${item}`);
		seen.add(item);
	}
}

function id(value, field, prefix) {
	const result = string(value, field, 80);
	if (!new RegExp(`^${prefix}-[A-Z0-9][A-Z0-9._-]*$`, "i").test(result))
		fail(`${field} has an invalid id`);
	return result;
}

function boundedJson(value, field, max = 256_000) {
	const text = JSON.stringify(value);
	if (!text || Buffer.byteLength(text, "utf8") > max)
		fail(`${field} exceeds ${max} bytes`);
}

export function canonicalizeDesignValue(value) {
	if (Array.isArray(value)) return value.map(canonicalizeDesignValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonicalizeDesignValue(value[key])]),
		);
	}
	return value;
}

export function canonicalDesignJson(value) {
	return `${JSON.stringify(canonicalizeDesignValue(value), null, 2)}\n`;
}

export function hashDesignValue(value) {
	return crypto
		.createHash("sha256")
		.update(canonicalDesignJson(value))
		.digest("hex");
}

export function createDesignSession(input = {}) {
	const now = input.now ?? new Date().toISOString();
	const state = input.state ?? "brief_required";
	if (!DESIGN_STATES.includes(state)) fail(`unknown state ${state}`);
	const policy = String(input.policy ?? "off").toLowerCase();
	if (!ALLOWED_POLICIES.has(policy)) fail(`unknown policy ${policy}`);
	const session = {
		...input.metadata,
		version: DESIGN_SESSION_VERSION,
		ownerId: string(input.ownerId, "ownerId", 128),
		policy,
		state,
		revision:
			Number.isInteger(input.revision) && input.revision >= 0 ? input.revision : 0,
		repairAttempts:
			Number.isInteger(input.repairAttempts) && input.repairAttempts >= 0
				? input.repairAttempts
				: 0,
		createdAt: now,
		updatedAt: now,
		nextAction: optionalString(input.nextAction, "nextAction", 500),
		transitions: [],
	};
	validateDesignSession(session);
	return session;
}

export function validateDesignSession(session) {
	object(session, "session");
	if (session.version !== DESIGN_SESSION_VERSION)
		fail("unsupported session version");
	string(session.ownerId, "ownerId", 128);
	if (!ALLOWED_POLICIES.has(session.policy)) fail("invalid policy");
	if (!DESIGN_STATES.includes(session.state)) fail("invalid state");
	if (!Number.isInteger(session.revision) || session.revision < 0)
		fail("revision must be a non-negative integer");
	if (
		!Number.isInteger(session.repairAttempts) ||
		session.repairAttempts < 0 ||
		session.repairAttempts > 1
	)
		fail("repairAttempts must be 0 or 1");
	array(session.transitions ?? [], "transitions", { max: 32 });
	for (const [key, value] of Object.entries(session)) {
		if (typeof value === "string" && Buffer.byteLength(value, "utf8") > MAX_TEXT)
			fail(`${key} is too large`);
	}
	boundedJson(session, "session", 128_000);
	return session;
}

export function transitionDesignSession(
	session,
	nextState,
	patch = {},
	now = new Date().toISOString(),
) {
	validateDesignSession(session);
	if (!DESIGN_STATES.includes(nextState)) fail(`unknown state ${nextState}`);
	if (
		TERMINAL_STATES.has(session.state) ||
		!(TRANSITIONS[session.state] ?? []).includes(nextState)
	) {
		fail(`illegal transition ${session.state} -> ${nextState}`);
	}
	const transitions = [
		...(session.transitions ?? []),
		{ from: session.state, to: nextState, at: now },
	].slice(-32);
	const next = {
		...session,
		...patch,
		state: nextState,
		transitions,
		updatedAt: now,
	};
	validateDesignSession(next);
	return next;
}

export function consumeDesignRepairAttempt(session) {
	validateDesignSession(session);
	if (session.repairAttempts >= 1) fail("repair attempt already consumed");
	return { ...session, repairAttempts: 1 };
}

export function designSessionPath(cwd, ownerId) {
	const safe = string(ownerId, "ownerId", 128);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(safe))
		fail("ownerId is not path-safe");
	return path.join(
		cwd,
		".ce-workflow",
		"work-runs",
		"design-sessions",
		`${safe}.json`,
	);
}

export function saveDesignSession(cwd, session) {
	validateDesignSession(session);
	const file = designSessionPath(cwd, session.ownerId);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(temp, canonicalDesignJson(session), {
		encoding: "utf8",
		mode: 0o600,
	});
	fs.renameSync(temp, file);
	return file;
}

export function loadDesignSession(cwd, ownerId) {
	const file = designSessionPath(cwd, ownerId);
	try {
		return validateDesignSession(JSON.parse(fs.readFileSync(file, "utf8")));
	} catch (error) {
		throw new Error(`design-contract: invalid session ${file}`, { cause: error });
	}
}

function stringList(value, field, options = {}) {
	const result = array(value, field, options).map((item, index) =>
		string(item, `${field}[${index}]`),
	);
	unique(result, field);
	return result;
}

function records(value, field, prefix, validate) {
	const result = array(value, field, { min: 1 }).map((entry, index) => {
		object(entry, `${field}[${index}]`);
		id(entry.id, `${field}[${index}].id`, prefix);
		validate(entry, index);
		return entry;
	});
	unique(
		result.map((entry) => entry.id),
		`${field}.id`,
	);
	return result;
}

function designArtifactName(value, field) {
	const result = string(value, field, 128);
	if (
		result.includes("\\") ||
		result.startsWith("/") ||
		result.split("/").some((part) => !part || part === "." || part === "..") ||
		!/^[-A-Za-z0-9_./]+\.html$/.test(result)
	)
		fail(`${field} must be a confined HTML artifact path`);
	return result;
}

export function validateDesignCandidates(raw, options = {}) {
	const manifest = object(raw, "candidate manifest");
	boundedJson(manifest, "candidate manifest", 64_000);
	if (manifest.version !== 1) fail("unsupported candidate manifest version");
	const briefHash = string(
		manifest.briefHash,
		"candidate manifest.briefHash",
		64,
	);
	if (!/^[a-f0-9]{64}$/.test(briefHash))
		fail("candidate manifest.briefHash must be sha256");
	if (options.briefHash && briefHash !== options.briefHash)
		fail("candidate manifest brief hash mismatch");
	const launcherArtifact = designArtifactName(
		manifest.launcherArtifact,
		"candidate manifest.launcherArtifact",
	);
	const targetIds = new Set(
		(options.targetMatrix ?? []).map((target) => target.id),
	);
	const hostHashes = options.hostHashes ?? {};
	const candidates = records(
		manifest.candidates,
		"candidates",
		"CANDIDATE",
		(candidate, index) => {
			string(candidate.title, `candidates[${index}].title`, 120);
			string(candidate.rationale, `candidates[${index}].rationale`, 2_000);
			stringList(
				candidate.differentiators,
				`candidates[${index}].differentiators`,
				{
					min: 1,
					max: 8,
				},
			);
			const artifact = designArtifactName(
				candidate.previewArtifact,
				`candidates[${index}].previewArtifact`,
			);
			if (artifact === launcherArtifact)
				fail("candidate artifact must differ from the launcher");
			const fragment = string(
				candidate.previewFragment,
				`candidates[${index}].previewFragment`,
				120,
			);
			if (fragment !== `#candidate=${candidate.id}`)
				fail(`candidates[${index}].previewFragment must match its id`);
			const targets = stringList(
				candidate.targets,
				`candidates[${index}].targets`,
				{
					min: 1,
				},
			);
			if (targetIds.size)
				for (const target of targets)
					if (!targetIds.has(target)) fail(`unknown candidate target ${target}`);
			const artifactHash = hostHashes[candidate.id];
			if (options.requireHostHashes && !/^[a-f0-9]{64}$/.test(artifactHash ?? ""))
				fail(`host hash is missing for ${candidate.id}`);
			if (artifactHash) candidate.artifactHash = artifactHash;
		},
	);
	if (candidates.length !== 3)
		fail("candidate manifest must contain exactly three candidates");
	if (
		options.requireHostHashes &&
		new Set(candidates.map((candidate) => candidate.artifactHash)).size !== 3
	)
		fail("candidate artifact hashes must be distinct");
	return canonicalizeDesignValue({
		version: 1,
		briefHash,
		launcherArtifact,
		candidates,
	});
}

export function createDirectionSelection(input) {
	const manifest = validateDesignCandidates(input.manifest, {
		briefHash: input.briefHash,
	});
	const selected = manifest.candidates.find(
		(item) => item.id === input.candidateId,
	);
	if (!selected?.artifactHash)
		fail("selected candidate requires a host artifact hash");
	const authority = string(input.authority, "selection.authority", 20);
	if (!new Set(["human", "fixture"]).has(authority))
		fail("selection.authority must be human or fixture");
	const receipt = {
		version: 1,
		ownerId: string(input.ownerId, "selection.ownerId", 128),
		briefHash: manifest.briefHash,
		candidateManifestHash: hashDesignValue(manifest),
		candidateId: selected.id,
		candidateArtifactHash: selected.artifactHash,
		authority,
		decisionEventId: string(
			input.decisionEventId,
			"selection.decisionEventId",
			128,
		),
		decidedAt: input.decidedAt ?? new Date().toISOString(),
		note: optionalString(input.note, "selection.note", 2_000),
	};
	return canonicalizeDesignValue(receipt);
}

export function directionSelectionIsCurrent(selection, current) {
	if (!selection || !["human", "fixture"].includes(selection.authority))
		return false;
	return [
		"ownerId",
		"briefHash",
		"candidateManifestHash",
		"candidateId",
		"candidateArtifactHash",
	].every((key) => selection[key] === current[key]);
}

export function validateDesignHandoff(raw, options = {}) {
	const handoff = object(raw, "handoff");
	boundedJson(handoff, "handoff");
	if (![1, DESIGN_HANDOFF_VERSION].includes(handoff.version))
		fail("unsupported handoff version");
	if (options.targetMatrix?.length && handoff.version !== DESIGN_HANDOFF_VERSION)
		fail("new target-aware commissions require handoff version 2");
	const targetIds = new Set();
	const variantIds = new Set();
	if (handoff.version === DESIGN_HANDOFF_VERSION) {
		records(handoff.targets, "targets", "TARGET", (target, index) => {
			string(target.platform, `targets[${index}].platform`, 80);
			const viewports = stringList(
				target.requiredViewports,
				`targets[${index}].requiredViewports`,
				{ min: 1, max: 3 },
			);
			for (const viewport of viewports)
				if (!ALLOWED_VIEWPORTS.has(viewport)) fail(`invalid viewport ${viewport}`);
			stringList(target.evidence, `targets[${index}].evidence`, { min: 1 });
			stringList(target.requiredScreenIds, `targets[${index}].requiredScreenIds`, {
				min: 1,
			});
			stringList(target.requiredFlowIds, `targets[${index}].requiredFlowIds`, {
				min: 1,
			});
			targetIds.add(target.id);
		});
		records(handoff.variants, "variants", "VARIANT", (variant, index) => {
			const targetId = string(variant.targetId, `variants[${index}].targetId`, 80);
			if (!targetIds.has(targetId)) fail(`unknown variant target ${targetId}`);
			const viewport = string(variant.viewport, `variants[${index}].viewport`, 20);
			if (!ALLOWED_VIEWPORTS.has(viewport)) fail(`invalid viewport ${viewport}`);
			optionalString(variant.previewRoute, `variants[${index}].previewRoute`, 500);
			optionalString(
				variant.previewArtifact,
				`variants[${index}].previewArtifact`,
				500,
			);
			if (!variant.previewRoute && !variant.previewArtifact)
				fail(`variants[${index}] requires a preview route or artifact`);
			stringList(variant.screenIds, `variants[${index}].screenIds`, { min: 1 });
			stringList(variant.flowIds, `variants[${index}].flowIds`, { min: 1 });
			variantIds.add(variant.id);
		});
		for (const target of handoff.targets) {
			for (const viewport of target.requiredViewports) {
				const variant = handoff.variants.find(
					(item) => item.targetId === target.id && item.viewport === viewport,
				);
				if (!variant) fail(`missing ${target.id}/${viewport} variant`);
				for (const screenId of target.requiredScreenIds)
					if (!variant.screenIds.includes(screenId))
						fail(`${variant.id} omits required screen ${screenId}`);
				for (const flowId of target.requiredFlowIds)
					if (!variant.flowIds.includes(flowId))
						fail(`${variant.id} omits required flow ${flowId}`);
			}
		}
		if (options.targetMatrix?.length) {
			const expectedIds = new Set(options.targetMatrix.map((target) => target.id));
			for (const target of handoff.targets)
				if (!expectedIds.has(target.id))
					fail(`target ${target.id} is not present in the authoritative matrix`);
			for (const expected of options.targetMatrix) {
				const actual = handoff.targets.find((target) => target.id === expected.id);
				if (!actual) fail(`missing required target ${expected.id}`);
				for (const viewport of expected.requiredViewports ?? [])
					if (!actual.requiredViewports.includes(viewport))
						fail(`${expected.id} omits required viewport ${viewport}`);
			}
		}
	}
	let selection;
	if (handoff.selection != null || options.selection) {
		selection = object(handoff.selection, "selection");
		const manifestHash =
			selection.manifestHash ?? selection.candidateManifestHash;
		const candidateHash =
			selection.candidateHash ?? selection.candidateArtifactHash;
		for (const [field, value] of [
			["manifestHash", manifestHash],
			["candidateHash", candidateHash],
		]) {
			if (!/^[a-f0-9]{64}$/.test(string(value, `selection.${field}`, 64)))
				fail(`selection.${field} must be sha256`);
		}
		if (
			!selection.selectionHash ||
			!/^[a-f0-9]{64}$/.test(
				string(selection.selectionHash, "selection.selectionHash", 64),
			) ||
			(options.selection &&
				selection.selectionHash !== hashDesignValue(options.selection))
		)
			fail("selection.selectionHash does not match");
		id(selection.candidateId, "selection.candidateId", "CANDIDATE");
		if (
			options.selection &&
			!directionSelectionIsCurrent(options.selection, {
				ownerId: options.selection.ownerId,
				briefHash: options.selection.briefHash,
				candidateManifestHash: manifestHash,
				candidateId: selection.candidateId,
				candidateArtifactHash: candidateHash,
			})
		)
			fail("handoff selection lineage mismatch");
	}
	const identity = object(handoff.identity, "identity");
	id(identity.id, "identity.id", "DESIGN");
	string(identity.title, "identity.title", 200);
	if (
		!/^[a-f0-9]{64}$/.test(string(identity.briefHash, "identity.briefHash", 64))
	)
		fail("identity.briefHash must be sha256");
	if (options.briefHash && identity.briefHash !== options.briefHash)
		fail("brief hash mismatch");
	const direction = object(handoff.direction, "direction");
	string(direction.summary, "direction.summary");
	const colors = array(direction.roleColors, "direction.roleColors", {
		min: 4,
		max: 6,
	});
	for (const [index, color] of colors.entries()) {
		object(color, `direction.roleColors[${index}]`);
		string(color.name, `direction.roleColors[${index}].name`, 80);
		if (
			!/^#[0-9a-f]{6}$/i.test(
				string(color.value, `direction.roleColors[${index}].value`, 7),
			)
		)
			fail("role color must be #RRGGBB");
	}
	unique(
		colors.map((color) => color.name),
		"direction.roleColors.name",
	);
	string(direction.signatureElement, "direction.signatureElement");
	string(direction.intentionalRisk, "direction.intentionalRisk");
	object(handoff.content, "content");
	object(handoff.tokens, "tokens");
	if (handoff.elementsRef != null)
		optionalString(handoff.elementsRef, "elementsRef", 200);
	records(handoff.screens, "screens", "SCREEN", (screen, index) => {
		string(screen.title, `screens[${index}].title`, 200);
		if (handoff.version === DESIGN_HANDOFF_VERSION) {
			for (const targetId of stringList(
				screen.targetIds,
				`screens[${index}].targetIds`,
				{ min: 1 },
			))
				if (!targetIds.has(targetId)) fail(`unknown screen target ${targetId}`);
			for (const variantId of stringList(
				screen.variantIds,
				`screens[${index}].variantIds`,
				{ min: 1 },
			))
				if (!variantIds.has(variantId)) fail(`unknown screen variant ${variantId}`);
		}
		stringList(screen.states, `screens[${index}].states`, { min: 1, max: 32 });
		const viewports = stringList(
			screen.viewports,
			`screens[${index}].viewports`,
			{ min: 1, max: 3 },
		);
		for (const viewport of viewports)
			if (!ALLOWED_VIEWPORTS.has(viewport)) fail(`invalid viewport ${viewport}`);
		stringList(screen.requiredRegions, `screens[${index}].requiredRegions`, {
			min: 1,
			max: 32,
		});
		if (screen.layoutAssertions != null)
			stringList(screen.layoutAssertions, `screens[${index}].layoutAssertions`, {
				max: 32,
			});
	});
	records(handoff.flows, "flows", "FLOW", (flow, index) => {
		stringList(flow.steps, `flows[${index}].steps`, { min: 1, max: 32 });
		if (handoff.version === DESIGN_HANDOFF_VERSION) {
			for (const targetId of stringList(
				flow.targetIds,
				`flows[${index}].targetIds`,
				{ min: 1 },
			))
				if (!targetIds.has(targetId)) fail(`unknown flow target ${targetId}`);
			for (const variantId of stringList(
				flow.variantIds,
				`flows[${index}].variantIds`,
				{ min: 1 },
			))
				if (!variantIds.has(variantId)) fail(`unknown flow variant ${variantId}`);
		}
	});
	records(handoff.components, "components", "COMP", (component, index) => {
		string(component.name, `components[${index}].name`, 200);
		stringList(component.states, `components[${index}].states`, {
			min: 1,
			max: 32,
		});
	});
	stringList(handoff.responsiveRules, "responsiveRules", { min: 1 });
	records(handoff.interactions, "interactions", "INT", (interaction, index) => {
		string(interaction.trigger, `interactions[${index}].trigger`);
		string(interaction.outcome, `interactions[${index}].outcome`);
	});
	stringList(handoff.accessibility, "accessibility", { min: 1 });
	for (const [index, asset] of array(handoff.assets, "assets", {
		max: 64,
	}).entries()) {
		object(asset, `assets[${index}]`);
		validateDesignArtifactRelativePath(asset.path, { allowImages: true });
		string(asset.license, `assets[${index}].license`, 200);
		string(asset.provenance, `assets[${index}].provenance`, 500);
	}
	stringList(handoff.implementationConstraints, "implementationConstraints", {
		min: 1,
	});
	records(handoff.acceptance, "acceptance", "DES", (criterion, index) => {
		string(criterion.description, `acceptance[${index}].description`);
		stringList(criterion.screenIds, `acceptance[${index}].screenIds`, { min: 1 });
		if (handoff.version === DESIGN_HANDOFF_VERSION) {
			for (const targetId of stringList(
				criterion.targetIds,
				`acceptance[${index}].targetIds`,
				{ min: 1 },
			))
				if (!targetIds.has(targetId)) fail(`unknown acceptance target ${targetId}`);
			for (const variantId of stringList(
				criterion.variantIds,
				`acceptance[${index}].variantIds`,
				{ min: 1 },
			))
				if (!variantIds.has(variantId))
					fail(`unknown acceptance variant ${variantId}`);
		}
		stringList(criterion.states, `acceptance[${index}].states`, { min: 1 });
		const viewports = stringList(
			criterion.viewports,
			`acceptance[${index}].viewports`,
			{ min: 1, max: 3 },
		);
		const proofs = stringList(criterion.proofs, `acceptance[${index}].proofs`, {
			min: 1,
			max: 5,
		});
		for (const viewport of viewports)
			if (!ALLOWED_VIEWPORTS.has(viewport)) fail(`invalid viewport ${viewport}`);
		for (const proof of proofs)
			if (!ALLOWED_PROOFS.has(proof)) fail(`invalid proof ${proof}`);
	});
	if (array(handoff.openQuestions, "openQuestions").length)
		fail("openQuestions must be empty");
	const provenance = object(handoff.provenance, "provenance");
	string(provenance.source, "provenance.source", 500);
	string(provenance.generatedAt, "provenance.generatedAt", 100);
	if (provenance.remoteFingerprint != null)
		string(provenance.remoteFingerprint, "provenance.remoteFingerprint", 128);
	return canonicalizeDesignValue({
		version: handoff.version,
		...(handoff.elementsRef ? { elementsRef: handoff.elementsRef } : {}),
		...(handoff.version === DESIGN_HANDOFF_VERSION
			? { targets: handoff.targets, variants: handoff.variants }
			: {}),
		...(selection ? { selection } : {}),
		identity,
		direction,
		content: handoff.content,
		tokens: handoff.tokens,
		screens: handoff.screens,
		flows: handoff.flows,
		components: handoff.components,
		responsiveRules: handoff.responsiveRules,
		interactions: handoff.interactions,
		accessibility: handoff.accessibility,
		assets: handoff.assets,
		implementationConstraints: handoff.implementationConstraints,
		acceptance: handoff.acceptance,
		openQuestions: [],
		provenance,
	});
}

export function normalizeRemoteFingerprint(files) {
	const normalized = array(files, "remote files", { max: 64 }).map(
		(file, index) => {
			object(file, `remote files[${index}]`);
			const name = validateDesignArtifactRelativePath(file.path ?? file.name, {
				allowHtml: true,
			});
			const size = Number(file.size ?? 0);
			if (!Number.isSafeInteger(size) || size < 0)
				fail(`remote files[${index}].size must be a non-negative integer`);
			return {
				name,
				size,
				modifiedAt: optionalString(
					file.mtime == null && file.modifiedAt == null
						? undefined
						: String(file.mtime ?? file.modifiedAt),
					`remote files[${index}].modifiedAt`,
					100,
				),
				mime: optionalString(file.mime, `remote files[${index}].mime`, 100),
				kind: optionalString(file.kind, `remote files[${index}].kind`, 100),
			};
		},
	);
	normalized.sort((a, b) => a.name.localeCompare(b.name));
	return hashDesignValue(normalized);
}

export function validateDesignArtifactRelativePath(relativePath, options = {}) {
	const value = string(relativePath, "artifact path", 300).replaceAll("\\", "/");
	if (
		value.startsWith("/") ||
		/^[A-Za-z]:/.test(value) ||
		value.split("/").includes("..")
	)
		fail("artifact path escapes design directory");
	const parts = value.split("/");
	if (
		parts.some(
			(part) => !part || RESERVED_NAMES.has(part.split(".")[0].toLowerCase()),
		)
	)
		fail("artifact path contains a reserved name");
	const extension = path.extname(value).toLowerCase();
	const allowed = new Set([
		...ALLOWED_TEXT_EXTENSIONS,
		...(options.allowImages ? ALLOWED_IMAGE_EXTENSIONS : []),
		...(options.allowHtml ? [".html"] : []),
	]);
	if (!allowed.has(extension))
		fail(`artifact type ${extension || "none"} is not allowed`);
	return value;
}

export function resolveDesignArtifactPath(root, relativePath, options = {}) {
	const relative = validateDesignArtifactRelativePath(relativePath, options);
	const base = path.resolve(root);
	const target = path.resolve(base, relative);
	if (target !== base && !target.startsWith(`${base}${path.sep}`))
		fail("artifact path escapes design directory");
	let current = base;
	for (const part of path.relative(base, target).split(path.sep)) {
		current = path.join(current, part);
		if (!fs.existsSync(current)) break;
		const stats = fs.lstatSync(current);
		if (stats.isSymbolicLink()) fail("artifact path cannot traverse a symlink");
		if (current === target && !stats.isFile())
			fail("artifact must be a regular file");
	}
	return target;
}

export function writeConfinedDesignArtifact(
	root,
	relativePath,
	content,
	options = {},
) {
	const target = resolveDesignArtifactPath(root, relativePath, options);
	const bytes = Buffer.isBuffer(content)
		? content
		: Buffer.from(String(content), "utf8");
	const maxBytes = options.maxBytes ?? 512_000;
	if (bytes.length > maxBytes) fail("artifact is too large");
	fs.mkdirSync(path.dirname(target), { recursive: true });
	resolveDesignArtifactPath(root, relativePath, options);
	const temp = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
	try {
		fs.writeFileSync(temp, bytes, { mode: 0o600, flag: "wx" });
		fs.renameSync(temp, target);
	} finally {
		if (fs.existsSync(temp)) fs.unlinkSync(temp);
	}
	return target;
}

function designImageMime(bytes, extension) {
	if (
		bytes
			.subarray(0, 8)
			.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
		extension === ".png"
	)
		return "image/png";
	if (
		bytes[0] === 0xff &&
		bytes[1] === 0xd8 &&
		bytes[2] === 0xff &&
		[".jpg", ".jpeg"].includes(extension)
	)
		return "image/jpeg";
	if (
		bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
		bytes.subarray(8, 12).toString("ascii") === "WEBP" &&
		extension === ".webp"
	)
		return "image/webp";
	fail("image bytes do not match the approved extension");
}

export function inspectUserDesignReference(
	sourcePath,
	maxBytes = REFERENCE_IMAGE_MAX_BYTES,
) {
	const source = path.resolve(string(sourcePath, "asset.sourcePath", 2_000));
	const stats = fs.lstatSync(source);
	if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maxBytes)
		fail("user reference must be a bounded regular file");
	const extension = path.extname(source).toLowerCase();
	if (!ALLOWED_IMAGE_EXTENSIONS.has(extension))
		fail("only approved image types can be copied");
	const content = fs.readFileSync(source);
	return {
		source,
		content,
		extension,
		mime: designImageMime(content, extension),
		sha256: crypto.createHash("sha256").update(content).digest("hex"),
	};
}

export function copyDesignReferenceAsset(cwd, designDirectory, input) {
	const directory = String(designDirectory ?? "").replaceAll("\\", "/");
	if (!/^docs\/designs\/[^/]+$/.test(directory))
		fail("design directory must be one confined docs/designs child");
	if (
		!["repository-local", "browser-adapter", "user-local"].includes(
			input.sourceKind,
		)
	)
		fail("image source must be repository-local, browser-adapter, or user-local");
	let sourcePath;
	let source;
	let maxBytes = input.maxBytes ?? 5_000_000;
	if (input.sourceKind === "user-local") {
		if (input.explicit !== true)
			fail("user-local reference must come from explicit user input");
		const inspected = inspectUserDesignReference(
			input.sourcePath,
			input.maxBytes ?? REFERENCE_IMAGE_MAX_BYTES,
		);
		sourcePath = inspected.source;
		source = inspected.content;
		maxBytes = input.maxBytes ?? REFERENCE_IMAGE_MAX_BYTES;
	} else {
		const license = string(input.license, "asset.license", 200);
		if (/^(unknown|unlicensed|tbd|none)$/i.test(license.trim()))
			fail("production asset requires a known license");
		sourcePath = validateDesignArtifactRelativePath(input.sourcePath, {
			allowImages: true,
		});
		if (!ALLOWED_IMAGE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase()))
			fail("only approved image types can be copied");
		const resolved = resolveDesignArtifactPath(cwd, sourcePath, {
			allowImages: true,
		});
		const stats = fs.lstatSync(resolved);
		if (!stats.isFile() || stats.size > maxBytes)
			fail("image source must be a bounded regular file");
		source = fs.readFileSync(resolved);
	}
	const targetName = path.basename(input.targetName ?? sourcePath);
	validateDesignArtifactRelativePath(targetName, { allowImages: true });
	return writeConfinedDesignArtifact(
		path.resolve(cwd, directory),
		`reference/${targetName}`,
		source,
		{ allowImages: true, maxBytes },
	);
}

function openDesignExecutionBoundary() {
	return [
		"Execution boundary:",
		"- Work only inside the OpenDesign project workspace and Preview.",
		"- Do not inspect, edit, create, delete, execute commands in, or run Git against any local source repository or external filesystem path.",
		"- Treat implementation source as read-only context. Describe production changes in DESIGN-HANDOFF.md; do not apply them.",
		"- Commands needed to build the Preview are allowed only inside the OpenDesign project workspace.",
	];
}

function designHandoffContractPrompt({
	briefHash,
	targetMatrix = [],
	selection,
} = {}) {
	const selectionContract = selection
		? {
				manifestHash: selection.candidateManifestHash,
				candidateId: selection.candidateId,
				candidateHash: selection.candidateArtifactHash,
				selectionHash: hashDesignValue(selection),
			}
		: undefined;
	return [
		"DESIGN-HANDOFF.json must use the ce-workflow v2 contract below; do not substitute another schema.",
		briefHash ? `Authoritative briefHash: ${briefHash}` : "",
		targetMatrix.length
			? `Authoritative targets: ${canonicalDesignJson(targetMatrix)}`
			: "",
		selectionContract
			? `Authoritative selection: ${canonicalDesignJson(selectionContract)}`
			: "",
		"Required top-level keys: version, targets, variants, identity, direction, content, tokens, screens, flows, components, responsiveRules, interactions, accessibility, assets, implementationConstraints, acceptance, openQuestions, provenance; include selection when supplied above.",
		'Use version: 2. targets is 1+ {id:"TARGET-*",platform,requiredViewports:[desktop|tablet|mobile],evidence:[string],requiredScreenIds:["SCREEN-*"],requiredFlowIds:["FLOW-*"]}.',
		'variants is 1+ {id:"VARIANT-*",targetId,viewport,previewRoute or previewArtifact,screenIds:["SCREEN-*"],flowIds:["FLOW-*"]}; cover every required target/viewport.',
		'identity is {id:"DESIGN-*",title,briefHash}. direction is {summary,roleColors:[4-6 {name,value:"#RRGGBB"}],signatureElement,intentionalRisk}. content and tokens are objects.',
		'screens is 1+ {id:"SCREEN-*",title,targetIds,variantIds,states,viewports,requiredRegions,layoutAssertions?}; layoutAssertions is an optional string array of spatial facts like "display above keypad" verified per viewport. flows is 1+ {id:"FLOW-*",steps,targetIds,variantIds}; components is 1+ {id:"COMP-*",name,states}.',
		'Optional top-level elementsRef may point at the hash-bound design/elements.json sidecar (list it in assets with path "design/elements.json"); geometry gates bind to that hash.',
		'interactions is 1+ {id:"INT-*",trigger,outcome}. responsiveRules, accessibility, and implementationConstraints are non-empty string arrays. assets is an array of {path,license,provenance}; asset paths may end only in .md, .json, .png, .jpg, .jpeg, or .webp. Never list .html in assets: an HTML Preview belongs only in variants[].previewArtifact.',
		'acceptance is 1+ {id:"DES-*",description,screenIds,targetIds,variantIds,states,viewports,proofs:[interaction|visual|accessibility|logs|manual]}. openQuestions must be []. provenance is {source,generatedAt}; omit remoteFingerprint (if present it must be at most 128 UTF-8 bytes).',
	].filter(Boolean);
}

export function renderOpenDesignGenerationPrompt(
	brief,
	briefHash,
	{ projectType = "product", targetMatrix = [], references = [] } = {},
) {
	const content = string(brief, "brief");
	const hash =
		briefHash ?? crypto.createHash("sha256").update(content).digest("hex");
	return [
		content,
		`Artifact form: ${string(projectType, "projectType", 80)}. Respect this framing; do not default to website/dashboard/app chrome.`,
		targetMatrix.length
			? `Required target matrix (exact coverage):\n${JSON.stringify(targetMatrix)}`
			: "",
		references.length
			? `Project-local inspiration references (analyze these files; never copy exact trade dress):\n${references.map((reference) => `- ${reference.remotePath}: borrow ${reference.borrow}; avoid ${reference.avoid}`).join("\n")}`
			: "",
		...openDesignExecutionBoundary(),
		...designHandoffContractPrompt({ briefHash: hash, targetMatrix }),
		"Delivery contract:",
		"- Create a complete, runnable, visually intentional interface in OpenDesign Preview. Do not reproduce the current/default interface with only cosmetic changes.",
		`- Return root DESIGN-HANDOFF.json v${DESIGN_HANDOFF_VERSION} and DESIGN-HANDOFF.md alongside the Preview. Include targets[] and separately addressable variants[] covering every required target/viewport; mobile is a real interaction/layout variant, not a shrunken desktop canvas.`,
		"- DESIGN-HANDOFF.md must include an Implementation description with screen-by-screen deltas, component/token changes, responsive behavior, interactions, accessibility, and a production source-change plan. Describe only; do not edit production source.",
		`- Set identity.briefHash to ${string(hash, "briefHash", 64)}.`,
	]
		.filter(Boolean)
		.join("\n");
}

export function renderOpenDesignCandidatePrompt(
	brief,
	briefHash,
	{ targetMatrix = [] } = {},
) {
	const content = string(brief, "brief");
	const hash =
		briefHash ?? crypto.createHash("sha256").update(content).digest("hex");
	return [
		content,
		...openDesignExecutionBoundary(),
		"Candidate delivery contract:",
		"- Produce exactly three genuinely different visual directions; do not pick one.",
		"- Create root DESIGN-CANDIDATES.json v1, candidate-launcher.html, and exactly three candidate HTML artifacts.",
		"- Use top-level launcherArtifact (not launcher). Each candidate must have a CANDIDATE-* id, title, rationale, differentiators, previewArtifact, previewFragment exactly #candidate=<ID>, and targets as an array of required target IDs (not targetCoverage).",
		"- Each previewArtifact must name that candidate's distinct HTML file, never candidate-launcher.html; do not use an artifact alias.",
		"- The launcher must render the chosen candidate as a same-origin document with data-ce-candidate-id and data-ce-brief-hash markers.",
		`- Set briefHash to ${string(hash, "briefHash", 64)}.`,
		targetMatrix.length
			? `- Required targets: ${targetMatrix.map((target) => target.id).join(", ")}.`
			: "",
		"- Do not create DESIGN-HANDOFF.json yet; refinement happens only after the user selects a candidate.",
	]
		.filter(Boolean)
		.join("\n");
}

export function renderOpenDesignRefinementPrompt(
	brief,
	selection,
	{ targetMatrix = [] } = {},
) {
	const authority = {
		manifestHash: selection.candidateManifestHash,
		candidateId: selection.candidateId,
		candidateHash: selection.candidateArtifactHash,
		selectionHash: hashDesignValue(selection),
		// Compatibility aliases for older OpenDesign peers.
		candidateManifestHash: selection.candidateManifestHash,
		candidateArtifactHash: selection.candidateArtifactHash,
	};
	return [
		string(brief, "brief"),
		...openDesignExecutionBoundary(),
		...designHandoffContractPrompt({
			briefHash: selection.briefHash,
			targetMatrix,
			selection,
		}),
		`Refine only selected candidate ${string(selection.candidateId, "selection.candidateId", 80)} with artifact hash ${string(selection.candidateArtifactHash, "selection.candidateArtifactHash", 64)}.`,
		"Create the complete responsive design and root DESIGN-HANDOFF.json v2 plus DESIGN-HANDOFF.md.",
		"At every required viewport, fix horizontal overflow, clipped controls, and content extending beyond the visible canvas before finalizing.",
		"DESIGN-HANDOFF.json must include selection.manifestHash, selection.candidateId, selection.candidateHash, and selection.selectionHash exactly as supplied.",
		`Selection authority: ${canonicalDesignJson(authority)}`,
		"Do not edit production source.",
	].join("\n");
}

export function renderDesignRepairPrompt(errors = [], contract = {}) {
	const list = array(errors, "repair errors", { min: 1, max: 20 })
		.map((entry) => string(String(entry), "repair error", 500))
		.sort();
	return [
		"Repair the design handoff only; preserve the approved visual direction.",
		...openDesignExecutionBoundary(),
		...designHandoffContractPrompt(contract),
		`Return root DESIGN-HANDOFF.json v${DESIGN_HANDOFF_VERSION} and DESIGN-HANDOFF.md.`,
		"Do not generate executable code or binary assets.",
		"Validation errors:",
		...list.map((entry) => `- ${entry}`),
	].join("\n");
}

export function createDesignApproval(input) {
	const approval = {
		version: 1,
		ownerId: string(input.ownerId, "approval.ownerId", 128),
		briefHash: string(input.briefHash, "approval.briefHash", 64),
		handoffHash: string(input.handoffHash, "approval.handoffHash", 64),
		remoteFingerprint: string(
			input.remoteFingerprint,
			"approval.remoteFingerprint",
			64,
		),
		revision: input.revision,
		decision: "approved",
		...(input.selectionHash
			? {
					selectionHash: string(input.selectionHash, "approval.selectionHash", 64),
					candidateManifestHash: string(
						input.candidateManifestHash,
						"approval.candidateManifestHash",
						64,
					),
					candidateArtifactHash: string(
						input.candidateArtifactHash,
						"approval.candidateArtifactHash",
						64,
					),
					authority: string(input.authority, "approval.authority", 20),
					decisionEventId: string(
						input.decisionEventId,
						"approval.decisionEventId",
						128,
					),
				}
			: {}),
		decidedAt: input.decidedAt ?? new Date().toISOString(),
		notes: optionalString(input.notes, "approval.notes", 2_000),
	};
	if (!Number.isInteger(approval.revision) || approval.revision < 0)
		fail("approval.revision must be a non-negative integer");
	for (const field of [
		"briefHash",
		"handoffHash",
		"remoteFingerprint",
		...(approval.selectionHash
			? ["selectionHash", "candidateManifestHash", "candidateArtifactHash"]
			: []),
	])
		if (!/^[a-f0-9]{64}$/.test(approval[field]))
			fail(`approval.${field} must be sha256`);
	if (
		approval.selectionHash &&
		!["human", "fixture"].includes(approval.authority)
	)
		fail("approval.authority must be human or fixture");
	return approval;
}

export function designApprovalIsCurrent(approval, current) {
	if (!approval || approval.decision !== "approved") return false;
	return [
		"ownerId",
		"briefHash",
		"handoffHash",
		"remoteFingerprint",
		"revision",
		...(current.selectionHash
			? [
					"selectionHash",
					"candidateManifestHash",
					"candidateArtifactHash",
					"authority",
				]
			: []),
	].every((key) => approval[key] === current[key]);
}

export function createTextFallbackHandoff(input) {
	const briefHash = string(input.briefHash, "briefHash", 64);
	return validateDesignHandoff({
		version: 1,
		identity: {
			id: input.id ?? "DESIGN-FALLBACK",
			title: input.title ?? "Text-only design handoff",
			briefHash,
		},
		direction: {
			summary: string(input.summary, "summary"),
			roleColors: input.roleColors,
			signatureElement: input.signatureElement ?? "Documented product hierarchy",
			intentionalRisk: input.intentionalRisk ?? "No rendered design preview",
		},
		content: input.content ?? { authority: "brief" },
		tokens: input.tokens ?? { authority: "existing repository" },
		screens: input.screens,
		flows: input.flows,
		components: input.components,
		responsiveRules: input.responsiveRules,
		interactions: input.interactions,
		accessibility: input.accessibility,
		assets: input.assets ?? [],
		implementationConstraints: [
			...(input.implementationConstraints ?? []),
			"Text fallback: no generated prototype code is authoritative",
		],
		acceptance: input.acceptance,
		openQuestions: [],
		provenance: {
			source: input.source ?? "ce-workflow text fallback",
			generatedAt: input.generatedAt ?? new Date().toISOString(),
		},
	});
}

export function renderDesignBrief(input) {
	return `# ${string(input.title, "brief.title", 200)}\n\n${string(input.objective, "brief.objective")}\n\n## Actors and flows\n\n${stringList(
		input.actorsAndFlows,
		"brief.actorsAndFlows",
		{ min: 1 },
	)
		.map((line) => `- ${line}`)
		.join("\n")}\n\n## States and content\n\n${stringList(
		input.statesAndContent,
		"brief.statesAndContent",
		{ min: 1 },
	)
		.map((line) => `- ${line}`)
		.join("\n")}\n\n## Constraints\n\n${stringList(
		input.constraints,
		"brief.constraints",
		{ min: 1 },
	)
		.map((line) => `- ${line}`)
		.join("\n")}\n`;
}

export function renderCurrentUiAudit(input) {
	return `# Current UI audit\n\n## Preserve\n${stringList(
		input.preserve,
		"audit.preserve",
	)
		.map((line) => `- ${line}`)
		.join("\n")}\n\n## Reconsider\n${stringList(
		input.reconsider,
		"audit.reconsider",
	)
		.map((line) => `- ${line}`)
		.join("\n")}\n\n## Remove\n${stringList(input.remove, "audit.remove")
		.map((line) => `- ${line}`)
		.join("\n")}\n`;
}

export function renderDesignRevisionPrompt(
	feedback,
	acceptedFacts = [],
	constraints = [],
	contract = {},
) {
	return [
		"Revise the current design without changing settled product behavior.",
		...openDesignExecutionBoundary(),
		...designHandoffContractPrompt(contract),
		"Update the Preview plus root DESIGN-HANDOFF.json and DESIGN-HANDOFF.md; do not modify production source.",
		`Feedback: ${string(feedback, "feedback", 4_000)}`,
		`Preserve: ${stringList(acceptedFacts, "acceptedFacts", { max: 64 }).join("; ") || "the accepted direction"}`,
		`Constraints: ${stringList(constraints, "constraints", { max: 64 }).join("; ") || "none beyond the brief"}`,
	].join("\n");
}

const DESIGN_PROOF_ARTIFACTS = Object.freeze({
	interaction: ["screenshot", "log"],
	visual: ["screenshot", "log"],
	accessibility: ["log"],
	logs: ["log"],
});

const DESIGN_INSPECTION =
	"Inspect hierarchy/signature, tokens, required regions/content, responsive reflow, visible states, clipping/overlap, focus, and reduced motion; raw pixel equality is not required.";

export function createDesignFidelityContract({
	authority,
	criteriaIds,
	verificationContract,
	strict = false,
}) {
	const selected = authority.criteria.filter((criterion) =>
		criteriaIds.includes(criterion.id),
	);
	const browserTemplate = verificationContract.required.find(
		(entry) =>
			entry.capability === "browser" &&
			typeof entry.operation?.command === "string" &&
			entry.operation.command.trim(),
	);
	const groups = new Map();
	for (const criterion of selected) {
		const proofs = new Set(criterion.proofs);
		if (strict) proofs.add("manual");
		for (const proof of proofs) {
			if (proof === "manual" && !strict) continue;
			const viewports = [...criterion.viewports].sort();
			const key = `${proof}\0${viewports.join("\0")}`;
			const group = groups.get(key) ?? { proof, viewports, cells: [] };
			for (const screenId of criterion.screenIds)
				for (const state of criterion.states)
					for (const viewport of viewports)
						group.cells.push({
							criterionId: criterion.id,
							screenId,
							state,
							viewport,
							proof,
							expectedArtifacts:
								proof === "manual" ? [] : DESIGN_PROOF_ARTIFACTS[proof],
						});
			groups.set(key, group);
		}
	}
	if (
		[...groups.values()].some((group) => group.proof !== "manual") &&
		!browserTemplate
	)
		return {
			ok: false,
			blocker: {
				code: "browser-runner-unavailable",
				message:
					"Design fidelity proof requires a declared browser entry with operation.command.",
			},
		};
	const retained = verificationContract.required.filter(
		(entry) => entry.capability !== "browser" && entry.fidelity === undefined,
	);
	const required = [...groups.values()]
		.sort((left, right) =>
			`${left.proof}:${left.viewports.join(",")}`.localeCompare(
				`${right.proof}:${right.viewports.join(",")}`,
			),
		)
		.map((group) => {
			const digest = hashDesignValue({
				proof: group.proof,
				viewports: group.viewports,
				cells: group.cells,
			}).slice(0, 12);
			if (group.proof === "manual")
				return {
					id: `design-manual-${digest}`,
					capability: "manual",
					proof: "approval",
					source: "Strict approved-design fidelity review",
					inspection: "human",
					instructions: DESIGN_INSPECTION,
					fidelity: {
						version: 1,
						handoffHash: authority.handoffHash,
						approvalHash: authority.approvalHash,
						viewports: group.viewports,
						cells: group.cells,
					},
				};
			return {
				id: `design-${group.proof}-${digest}`,
				capability: "browser",
				proof: group.proof,
				source: "Approved design fidelity matrix",
				artifacts: DESIGN_PROOF_ARTIFACTS[group.proof],
				inspection: "goal",
				instructions: DESIGN_INSPECTION,
				operation: structuredClone(browserTemplate.operation),
				fidelity: {
					version: 1,
					handoffHash: authority.handoffHash,
					approvalHash: authority.approvalHash,
					viewports: group.viewports,
					cells: group.cells,
				},
			};
		});
	if (retained.length + required.length > 32)
		return {
			ok: false,
			blocker: {
				code: "design-fidelity-manifest-too-large",
				message: "Design fidelity requirements cannot be grouped into 32 proofs.",
			},
		};
	return {
		ok: true,
		contract: { version: 1, required: [...retained, ...required] },
		manifest: required.flatMap((entry) => entry.fidelity.cells),
	};
}

function sha256File(file) {
	return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function fidelityHash(value, field) {
	const hash = string(value, field, 64);
	if (!/^[a-f0-9]{64}$/.test(hash)) fail(`${field} must be sha256`);
	return hash;
}

export function validateReferenceCaptureReceipt(raw, current, options = {}) {
	const receipt = object(raw, "reference capture receipt");
	if (receipt.version !== 1)
		fail("unsupported reference capture receipt version");
	if (receipt.initiatedBy !== "human")
		fail("reference capture must be explicitly user initiated");
	for (const field of [
		"projectId",
		"runId",
		"candidateId",
		"browserFingerprint",
	])
		string(receipt[field], `reference capture ${field}`, 256);
	for (const field of [
		"briefHash",
		"artifactHash",
		"selectionHash",
		"originHash",
		"documentHash",
	])
		fidelityHash(receipt[field], `reference capture ${field}`);
	if (receipt.documentHash !== receipt.artifactHash)
		fail("captured document hash does not match the OpenDesign artifact");
	const viewport = object(receipt.viewport, "reference capture viewport");
	if (
		!Number.isInteger(viewport.width) ||
		!Number.isInteger(viewport.height) ||
		viewport.width < 200 ||
		viewport.width > 4096 ||
		viewport.height < 200 ||
		viewport.height > 4096
	)
		fail("reference capture viewport is invalid");
	const security = object(receipt.security, "reference capture security");
	for (const field of [
		"cookies",
		"credentials",
		"downloads",
		"clipboard",
		"popups",
		"crossOriginRequests",
	])
		if (security[field] !== false)
			fail(`reference capture security.${field} must be false`);
	for (const field of [
		"projectId",
		"runId",
		"candidateId",
		"briefHash",
		"artifactHash",
		"selectionHash",
	])
		if (current?.[field] !== receipt[field])
			fail(`reference capture ${field} is stale`);
	const screenshot = object(receipt.screenshot, "reference capture screenshot");
	const workspace = path.resolve(options.workspaceRoot ?? ".");
	const file = path.resolve(
		workspace,
		string(screenshot.path, "screenshot.path", 500),
	);
	if (file !== workspace && !file.startsWith(`${workspace}${path.sep}`))
		fail("reference capture screenshot escaped its workspace");
	const screenshotHash = fidelityHash(
		screenshot.sha256,
		"reference capture screenshot.sha256",
	);
	if (!fs.existsSync(file) || sha256File(file) !== screenshotHash)
		fail("reference capture screenshot hash does not match");
	return canonicalizeDesignValue(receipt);
}

function hueFamily(hex) {
	const [red, green, blue] = [1, 3, 5].map((offset) =>
		Number.parseInt(hex.slice(offset, offset + 2), 16),
	);
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	if (max - min < 40) return "neutral";
	if (max === red) return blue > green ? "magenta" : "red";
	if (max === green) return red > blue ? "yellow" : "green";
	return red > green ? "violet" : "blue";
}

export function validateDesignFidelityEvidence(raw, authority, handoff) {
	const evidence = object(raw, "design fidelity evidence");
	if (evidence.version !== 1)
		fail("unsupported design fidelity evidence version");
	for (const field of [
		"briefHash",
		"candidateManifestHash",
		"selectionHash",
		"candidateArtifactHash",
		"handoffHash",
		"approvalHash",
	]) {
		fidelityHash(evidence.authority?.[field], `fidelity authority.${field}`);
		if (evidence.authority[field] !== authority[field])
			fail(`fidelity authority.${field} is stale`);
	}
	if (
		!/^[a-f0-9]{40,64}$/.test(string(evidence.gitHead, "fidelity gitHead", 64))
	)
		fail("fidelity gitHead is invalid");
	const declaredColors = new Set(
		handoff.direction.roleColors.map((color) => color.value.toLowerCase()),
	);
	const computedColors = new Set(
		stringList(evidence.computedRoleColors, "fidelity computedRoleColors", {
			min: 4,
		}).map((color) => color.toLowerCase()),
	);
	for (const color of declaredColors)
		if (!computedColors.has(color))
			fail(`approved role color ${color} is unused`);
	const hueFamilies = new Set(
		[...computedColors].map(hueFamily).filter((hue) => hue !== "neutral"),
	);
	if (declaredColors.size < 4 || hueFamilies.size < 3)
		fail(
			"bright kids-like fidelity requires four colors across three hue families",
		);
	if (!string(evidence.signatureElement, "fidelity signatureElement").trim())
		fail("playful signature element is missing");
	const requiredRegions = new Set(
		handoff.screens.flatMap((screen) => screen.requiredRegions),
	);
	const actualRegions = new Set(
		stringList(evidence.regions, "fidelity regions", { min: 1 }),
	);
	for (const region of requiredRegions)
		if (!actualRegions.has(region)) fail(`required region ${region} is missing`);
	for (const [field, values] of [
		["geometry", evidence.geometryDeltas],
		["typography", evidence.typographyDeltas],
	])
		for (const delta of array(values, `fidelity ${field}`, { min: 1 }))
			if (typeof delta !== "number" || delta < 0 || delta > 0.15)
				fail(`${field} exceeds the 15% tolerance`);
	for (const field of [
		"reflow",
		"noHorizontalOverflow",
		"visibleFocus",
		"contrast",
	])
		if (evidence.responsive?.[field] !== true)
			fail(`responsive ${field} proof is missing`);
	const workspaceRoot = path.resolve(
		string(evidence.workspaceRoot, "fidelity workspaceRoot", 500),
	);
	const captures = array(evidence.captures, "fidelity captures", {
		min: 4,
		max: 4,
	});
	for (const capture of captures) {
		if (!["selected", "implemented"].includes(capture.role))
			fail("fidelity capture role is invalid");
		if (!["mobile", "desktop"].includes(capture.viewport))
			fail("fidelity capture viewport is invalid");
		string(capture.state, "fidelity capture state", 100);
		fidelityHash(capture.screenshotHash, "fidelity capture screenshotHash");
		if (
			capture.handoffHash !== authority.handoffHash ||
			capture.approvalHash !== authority.approvalHash
		)
			fail("fidelity capture design authority is stale");
		if (
			capture.role === "implemented" &&
			(path.resolve(capture.workspaceRoot ?? "") !== workspaceRoot ||
				capture.gitHead !== evidence.gitHead)
		)
			fail("implemented capture is from the wrong workspace or revision");
	}
	for (const viewport of ["mobile", "desktop"]) {
		const selected = captures.find(
			(capture) => capture.viewport === viewport && capture.role === "selected",
		);
		const implemented = captures.find(
			(capture) => capture.viewport === viewport && capture.role === "implemented",
		);
		if (!selected || !implemented)
			fail(`missing selected/implemented ${viewport} capture pair`);
		if (selected.state !== implemented.state)
			fail(`capture state mismatch for ${viewport}`);
	}
	if (
		!evidence.baselineHash ||
		!captures
			.filter((capture) => capture.role === "implemented")
			.every((capture) => capture.screenshotHash !== evidence.baselineHash)
	)
		fail("implemented result is not proven different from the baseline");
	const evaluation = object(
		evidence.visualEvaluation,
		"fidelity visualEvaluation",
	);
	if (
		evaluation.passed !== true ||
		evaluation.evaluatorFingerprint === evidence.writerFingerprint
	)
		fail("independent visual evaluation is missing or not independent");
	const scores = [
		"palette",
		"hierarchy",
		"composition",
		"typography",
		"signatureElement",
		"responsiveAdaptation",
	].map((field) => Number(evaluation.scores?.[field]));
	if (scores.some((score) => !Number.isFinite(score) || score < 3 || score > 4))
		fail("visual evaluation dimension score is below 3/4");
	if (scores.reduce((sum, score) => sum + score, 0) / scores.length < 3.25)
		fail("visual evaluation mean is below 3.25");
	const acceptance = object(
		evidence.finalAcceptance,
		"fidelity finalAcceptance",
	);
	if (
		acceptance.authority !== "human" ||
		acceptance.accepted !== true ||
		!acceptance.decisionEventId ||
		acceptance.gitHead !== evidence.gitHead ||
		acceptance.approvalHash !== authority.approvalHash
	)
		fail("current explicit final fidelity acceptance is missing");
	return canonicalizeDesignValue(evidence);
}

export function designLifecycleTelemetry(session, input = {}) {
	const phase = DESIGN_STATES.includes(session?.state)
		? session.state
		: "failed";
	const policy = ALLOWED_POLICIES.has(session?.policy) ? session.policy : "off";
	const allowedAvailability = new Set([
		"not-checked",
		"available",
		"unavailable",
		"fallback",
	]);
	const availability = allowedAvailability.has(input.availability)
		? input.availability
		: session?.fallback
			? "fallback"
			: session?.projectId
				? "available"
				: "not-checked";
	const durationMs = Math.max(
		0,
		Math.min(
			86_400_000,
			Number(input.durationMs) ||
				Date.parse(session?.updatedAt ?? "") -
					Date.parse(session?.createdAt ?? "") ||
				0,
		),
	);
	const count = (value) =>
		Math.max(0, Math.min(10_000, Number.isInteger(value) ? value : 0));
	return {
		version: 1,
		eligible: policy !== "off",
		policy,
		availability,
		phase,
		durationMs,
		revision: count(session?.revision),
		counts: {
			clarifications: count(input.clarifications),
			repairs: count(session?.repairAttempts),
			syncs: count(input.syncs),
			stale: count(input.stale),
			criteria: count(input.criteria),
			proofs: count(input.proofs),
		},
		fallback: Boolean(session?.fallback),
		approvalDurationMs:
			phase === "approved" || phase === "imported" ? durationMs : undefined,
		cancellationCategory: phase === "canceled" ? "human" : undefined,
		failureCategory:
			phase === "failed"
				? ["protocol", "process", "validation", "unknown"].includes(
						input.failureCategory,
					)
					? input.failureCategory
					: "unknown"
				: undefined,
	};
}

export function designFidelityStatus(item, contractStatus) {
	const entries = (item.verificationContract?.required ?? []).filter(
		(entry) => entry.fidelity?.version === 1,
	);
	const states = ["missing", "blocked", "stale", "untrusted", "waived"];
	const stateFor = (id) =>
		states.find((state) => contractStatus[state]?.includes(id));
	const cells = entries.flatMap((entry) =>
		entry.fidelity.cells.map((cell) => ({
			...cell,
			proofId: entry.id,
			status: stateFor(entry.id) ?? "passed",
		})),
	);
	return {
		ok: cells.every((cell) => ["passed", "waived"].includes(cell.status)),
		cells,
		missingCells: cells.filter(
			(cell) => !["passed", "waived"].includes(cell.status),
		),
	};
}

export function designLineageNotes(input) {
	const pairs = {
		"design-source": input.sourceId ?? input.sourceArtifact,
		"design-directory": input.designDirectory,
		"design-brief": input.briefPath,
		"design-brief-sha256": input.briefHash,
		"design-handoff": input.handoffPath,
		"design-handoff-sha256": input.handoffHash,
		"design-approval": input.approvalPath,
		"design-approval-sha256": input.approvalHash,
		"design-project": input.projectId,
		"design-run": input.runId,
		"design-state": input.state,
		"design-supersedes": input.supersedes,
	};
	return Object.entries(pairs)
		.filter(([, value]) => value != null && value !== "")
		.map(([key, value]) => `wo:design ${key}: ${string(String(value), key, 500)}`)
		.slice(0, 16);
}
