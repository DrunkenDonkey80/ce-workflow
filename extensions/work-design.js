import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DESIGN_SESSION_VERSION = 1;
export const DESIGN_HANDOFF_VERSION = 1;
export const DESIGN_STATES = Object.freeze([
	"not_applicable",
	"audit_required",
	"brief_required",
	"commission_ready",
	"run_pending",
	"run_active",
	"clarification_required",
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
		"review_ready",
		"approval_required",
		"failed",
		"canceled",
	],
	run_active: ["clarification_required", "review_ready", "failed", "canceled"],
	clarification_required: ["run_pending", "review_ready", "canceled", "failed"],
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

export function validateDesignHandoff(raw, options = {}) {
	const handoff = object(raw, "handoff");
	boundedJson(handoff, "handoff");
	if (handoff.version !== DESIGN_HANDOFF_VERSION)
		fail("unsupported handoff version");
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
	records(handoff.screens, "screens", "SCREEN", (screen, index) => {
		string(screen.title, `screens[${index}].title`, 200);
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
	});
	records(handoff.flows, "flows", "FLOW", (flow, index) =>
		stringList(flow.steps, `flows[${index}].steps`, { min: 1, max: 32 }),
	);
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
			const name = validateDesignArtifactRelativePath(file.path ?? file.name);
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
	const allowed = options.allowImages
		? new Set([...ALLOWED_TEXT_EXTENSIONS, ...ALLOWED_IMAGE_EXTENSIONS])
		: ALLOWED_TEXT_EXTENSIONS;
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

export function copyDesignReferenceAsset(cwd, designDirectory, input) {
	const directory = String(designDirectory ?? "").replaceAll("\\", "/");
	if (!/^docs\/designs\/[^/]+$/.test(directory))
		fail("design directory must be one confined docs/designs child");
	if (!["repository-local", "browser-adapter"].includes(input.sourceKind))
		fail("image source must be repository-local or browser-adapter");
	const license = string(input.license, "asset.license", 200);
	if (/^(unknown|unlicensed|tbd|none)$/i.test(license.trim()))
		fail("production asset requires a known license");
	const sourcePath = validateDesignArtifactRelativePath(input.sourcePath, {
		allowImages: true,
	});
	if (!ALLOWED_IMAGE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase()))
		fail("only approved image types can be copied");
	const source = resolveDesignArtifactPath(cwd, sourcePath, {
		allowImages: true,
	});
	const stats = fs.lstatSync(source);
	if (!stats.isFile() || stats.size > (input.maxBytes ?? 5_000_000))
		fail("image source must be a bounded regular file");
	const targetName = path.basename(input.targetName ?? sourcePath);
	validateDesignArtifactRelativePath(targetName, { allowImages: true });
	return writeConfinedDesignArtifact(
		path.resolve(cwd, directory),
		`reference/${targetName}`,
		fs.readFileSync(source),
		{ allowImages: true, maxBytes: input.maxBytes ?? 5_000_000 },
	);
}

export function renderDesignRepairPrompt(errors = []) {
	const list = array(errors, "repair errors", { min: 1, max: 20 })
		.map((entry) => string(String(entry), "repair error", 500))
		.sort();
	return [
		"Repair the design handoff only; preserve the approved visual direction.",
		"Return root DESIGN-HANDOFF.json v1 and DESIGN-HANDOFF.md.",
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
		decidedAt: input.decidedAt ?? new Date().toISOString(),
		notes: optionalString(input.notes, "approval.notes", 2_000),
	};
	if (!Number.isInteger(approval.revision) || approval.revision < 0)
		fail("approval.revision must be a non-negative integer");
	for (const field of ["briefHash", "handoffHash", "remoteFingerprint"])
		if (!/^[a-f0-9]{64}$/.test(approval[field]))
			fail(`approval.${field} must be sha256`);
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
) {
	return [
		"Revise the current design without changing settled product behavior.",
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
