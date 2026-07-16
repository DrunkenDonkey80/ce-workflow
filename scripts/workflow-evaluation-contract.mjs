import { createHash } from "node:crypto";
import path from "node:path";

const SHA256 = /^[a-f0-9]{64}$/i;
const REQUIRED_METRICS = [
	"tokens",
	"wallMs",
	"toolCalls",
	"subagentCalls",
	"toolOutputChars",
	"retries",
	"contextTokens",
	"questions",
];
const REQUIRED_DEPTHS = ["smoke", "decision", "sentinel", "calibration"];
const REQUIRED_INPUTS = [
	"workflowRevision",
	"project",
	"stage",
	"bundleVersion",
	"role",
	"provider",
	"model",
	"effort",
	"evaluator",
	"runtime",
	"dependencies",
	"browser",
	"rubricVersion",
	"tools",
];
const ALLOWED_FACTORS = new Set([
	"workflowRevision",
	"mode",
	"role",
	"reviewer",
	"effort",
	"prompt",
	"modelAssignment",
]);
// R2 configurable roles under test; work-committer stays a deterministic control (no model slot).
const CONFIGURABLE_ROLES = new Set([
	"main",
	"work-planner",
	"work-migrator",
	"work-worker",
	"work-fixer",
	"work-debugger",
	"work-reviewer",
	"work-advisor",
	"work-advisor-backup",
]);
const SUPPORTED_EFFORTS = new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);
const ROLE_CELL_FIELDS = [
	"provider",
	"model",
	"effort",
	"prompt",
	"tools",
	"context",
	"fallback",
	"runtime",
];
const ALLOWED_FALLBACKS = new Set(["none", "advisor-backup"]);
const ROLE_SCOPED_FACTORS = new Set([
	"effort",
	"prompt",
	"tools",
	"context",
	"fallback",
]);

export function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, nested]) => [key, canonical(nested)]),
		);
	return value;
}

export function fingerprint(value) {
	return createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex");
}

function requireValue(condition, message) {
	if (!condition) throw new Error(message);
}

export function validateBundle(bundle) {
	requireValue(bundle?.version === 1, "bundle version must be 1");
	requireValue(
		Array.isArray(bundle.projects) &&
			["calculator", "csv-expenses"].every((id) =>
				bundle.projects.includes(id),
			),
		"both projects are required",
	);
	requireValue(
		Array.isArray(bundle.hiddenResources) && bundle.hiddenResources.length > 0,
		"hidden resources are required",
	);
	requireValue(
		REQUIRED_METRICS.every((metric) => bundle.metrics?.includes(metric)),
		"required metric definitions are missing",
	);
	for (const depth of REQUIRED_DEPTHS) {
		const value = bundle.depths?.[depth];
		requireValue(
			Number.isInteger(value?.samples) && value.samples > 0,
			`${depth} samples are required`,
		);
		requireValue(
			Number.isFinite(value?.tokenCeiling) && value.tokenCeiling > 0,
			`${depth} token ceiling is required`,
		);
		requireValue(
			Number.isFinite(value?.wallMsCeiling) && value.wallMsCeiling > 0,
			`${depth} wall ceiling is required`,
		);
	}
	requireValue(
		Array.isArray(bundle.rubric?.anchors) && bundle.rubric.anchors.length >= 3,
		"rubric anchors are required",
	);
	requireValue(
		Array.isArray(bundle.rubric?.criticalDimensions) &&
			bundle.rubric.criticalDimensions.length > 0,
		"critical rubric dimensions are required",
	);
	for (const project of bundle.projects) {
		const approval = bundle.approvals?.[project];
		requireValue(
			approval &&
				[approval.bundleSha, approval.brainstormSha, approval.planSha].every(
					(sha) => SHA256.test(sha),
				),
			`${project} golden approval SHAs are required`,
		);
		requireValue(
			approval.approved === true &&
				typeof approval.approvedBy === "string" &&
				approval.approvedBy.length > 0 &&
				typeof approval.approvedAt === "string" &&
				approval.approvedAt.length > 0,
			`${project} human approval is required`,
		);
		requireValue(
			approval.acceptancePassed === true && approval.evidence,
			`${project} approval acceptance evidence is required`,
		);
	}
	return bundle;
}

function changedPaths(baseline, candidate, prefix = "") {
	const keys = new Set([
		...Object.keys(baseline ?? {}),
		...Object.keys(candidate ?? {}),
	]);
	const changed = [];
	for (const key of keys) {
		const name = prefix ? `${prefix}.${key}` : key;
		const a = baseline?.[key];
		const b = candidate?.[key];
		if (
			a &&
			b &&
			typeof a === "object" &&
			typeof b === "object" &&
			!Array.isArray(a) &&
			!Array.isArray(b)
		)
			changed.push(...changedPaths(a, b, name));
		else if (JSON.stringify(canonical(a)) !== JSON.stringify(canonical(b)))
			changed.push(name);
	}
	return changed;
}

// A role cell (R3) must fully declare its identity; ambiguous or partial cells fail before provisioning.
export function validateRoleMap(roleMap) {
	if (roleMap === undefined) return;
	requireValue(
		roleMap && typeof roleMap === "object" && !Array.isArray(roleMap),
		"role map must be an object",
	);
	for (const role of CONFIGURABLE_ROLES)
		requireValue(
			roleMap[role] !== undefined,
			`incomplete role map: missing ${role}`,
		);
	for (const [role, cell] of Object.entries(roleMap)) {
		requireValue(
			CONFIGURABLE_ROLES.has(role),
			`unknown role in role map: ${role}`,
		);
		requireValue(
			cell && typeof cell === "object" && !Array.isArray(cell),
			`role cell must be an object: ${role}`,
		);
		for (const field of ROLE_CELL_FIELDS)
			requireValue(
				cell[field] !== undefined && cell[field] !== null && cell[field] !== "",
				`incomplete role cell ${role}: missing ${field}`,
			);
		requireValue(
			cell.alias === undefined,
			`model aliases are invalid in role ${role}; declare the exact model`,
		);
		requireValue(
			SUPPORTED_EFFORTS.has(cell.effort),
			`unsupported effort in role ${role}: ${cell.effort}`,
		);
		requireValue(
			ALLOWED_FALLBACKS.has(cell.fallback),
			`undeclared fallback in role ${role}: ${cell.fallback}`,
		);
	}
}

// Map a declared factor to the concrete resolved-pair paths it may change.
// A modelAssignment binds provider+exact model as one factor (top-level or role-scoped).
function expandFactor(name) {
	const [head, ...rest] = name.split(".");
	const role = rest.join(".");
	if (head === "modelAssignment")
		return role
			? [`roleMap.${role}.provider`, `roleMap.${role}.model`]
			: ["provider", "model"];
	if (role && ROLE_SCOPED_FACTORS.has(head)) return [`roleMap.${role}.${head}`];
	return [name];
}

export function validateExperimentPair({
	baseline,
	candidate,
	factor,
	interaction = false,
}) {
	for (const side of [baseline, candidate])
		for (const field of REQUIRED_INPUTS)
			requireValue(
				side?.[field] !== undefined,
				`missing experiment input: ${field}`,
			);
	for (const side of [baseline, candidate]) {
		requireValue(
			SUPPORTED_EFFORTS.has(side.effort),
			`unsupported effort: ${side.effort}`,
		);
		requireValue(
			!side.ambientOverrides || Object.keys(side.ambientOverrides).length === 0,
			"ambient override outside the declared role map is invalid",
		);
		validateRoleMap(side.roleMap);
	}
	const factors = Array.isArray(factor) ? factor : [factor];
	requireValue(
		factors.every((item) => typeof item === "string" && item.length > 0),
		"declared factor is required",
	);
	requireValue(
		factors.every((item) => ALLOWED_FACTORS.has(item.split(".")[0])),
		"declared factor is outside the V1 allowlist",
	);
	if (factors.some((item) => item === "modelAssignment" || item.includes(".")))
		for (const side of [baseline, candidate])
			requireValue(
				side.roleMap !== undefined,
				"complete role map is required for model assignment or role-scoped factors",
			);
	for (const item of factors) {
		const role = item.split(".").slice(1).join(".");
		requireValue(
			!role || CONFIGURABLE_ROLES.has(role),
			`declared factor references an unknown role: ${item}`,
		);
	}
	const changed = changedPaths(baseline, candidate);
	requireValue(changed.length > 0, "no-op factor is invalid");
	const prefixes = factors.flatMap(expandFactor);
	const allowed = changed.every((name) =>
		prefixes.some((prefix) => name === prefix || name.startsWith(`${prefix}.`)),
	);
	requireValue(allowed, "multiple or undeclared factor changes are invalid");
	for (const item of factors) {
		if (!item.startsWith("modelAssignment")) continue;
		const owned = expandFactor(item);
		requireValue(
			changed.some((name) =>
				owned.some(
					(prefix) => name === prefix || name.startsWith(`${prefix}.`),
				),
			),
			"no-op modelAssignment (alias) is invalid",
		);
	}
	requireValue(
		interaction || factors.length === 1,
		"multiple factors require an interaction test",
	);
	return {
		factor,
		interaction,
		changed,
		baselineFingerprint: fingerprint(baseline),
		candidateFingerprint: fingerprint(candidate),
		baselineRoleMapFingerprint: baseline.roleMap
			? fingerprint(baseline.roleMap)
			: undefined,
		candidateRoleMapFingerprint: candidate.roleMap
			? fingerprint(candidate.roleMap)
			: undefined,
	};
}

export function auditStageInput(input, stage) {
	requireValue(
		typeof input === "string" && input.length > 0,
		"stage input is required",
	);
	const normalized = input.replaceAll("\\", "/");
	requireValue(
		!path.isAbsolute(input) && !normalized.split("/").includes(".."),
		"stage input must stay inside the bundle",
	);
	requireValue(
		!/(product-contract|acceptance|evaluator)/i.test(normalized),
		"stage input leaks a hidden resource or evaluator label",
	);
	if (stage === "plan")
		requireValue(
			/^goldens\/brainstorm\.md$/i.test(normalized),
			"plan stage must use only the approved brainstorm golden",
		);
	if (stage === "work")
		requireValue(
			/^goldens\/plan\.md$/i.test(normalized),
			"work stage must use only the approved plan golden",
		);
	if (stage === "brainstorm")
		requireValue(
			!/goldens\//i.test(normalized),
			"brainstorm stage cannot use a golden",
		);
	return normalized;
}
