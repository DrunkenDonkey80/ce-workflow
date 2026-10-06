import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TELEMETRY_SCHEMA_VERSION = 1;
export const ROUTING_POLICY_REVISION = "1";
export const ASSURANCE_CLASSIFIER_REVISION = "1";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PACKAGE_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const SOURCE_PATHS = ["extensions", "agents", "package.json"];
const identityCache = new Map();
let staticInputs;

export function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, nested]) => nested !== undefined)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, nested]) => [key, canonical(nested)]),
		);
	return value;
}

function hash(value) {
	return createHash("sha256")
		.update(typeof value === "string" ? value : JSON.stringify(canonical(value)))
		.digest("hex");
}

function sourceFiles() {
	const files = [];
	const visit = (path) => {
		const stat = statSync(path);
		if (stat.isDirectory()) {
			for (const entry of readdirSync(path).sort()) visit(join(path, entry));
		} else files.push(path);
	};
	for (const path of SOURCE_PATHS.map((name) => join(ROOT, name))) visit(path);
	return files;
}

function dirtySourceHash() {
	const digest = createHash("sha256");
	for (const file of sourceFiles()) {
		digest.update(relative(ROOT, file).replaceAll("\\", "/"));
		digest.update("\0");
		digest.update(readFileSync(file));
		digest.update("\0");
	}
	return digest.digest("hex");
}

function sourceIdentity() {
	try {
		const dirty = execFileSync(
			"git",
			["status", "--porcelain=v1", "--untracked-files=all", "--", ...SOURCE_PATHS],
			{ cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		).trim();
		if (!dirty)
			return {
				gitRevision: execFileSync("git", ["rev-parse", "HEAD"], {
					cwd: ROOT,
					encoding: "utf8",
					stdio: ["ignore", "pipe", "ignore"],
				}).trim(),
			};
	} catch {
		// Installed packages and source archives have no usable Git revision.
	}
	return { dirtySourceHash: dirtySourceHash() };
}

function rolePromptHashes() {
	const directory = join(ROOT, "agents");
	return Object.fromEntries(
		readdirSync(directory)
			.filter((name) => name.endsWith(".md"))
			.sort()
			.map((name) => [basename(name, ".md"), hash(readFileSync(join(directory, name), "utf8"))]),
	);
}

function workflowStaticInputs() {
	staticInputs ??= {
		packageVersion: PACKAGE_VERSION,
		source: sourceIdentity(),
		routingPolicyRevision: ROUTING_POLICY_REVISION,
		assuranceClassifierRevision: ASSURANCE_CLASSIFIER_REVISION,
		rolePrompts: rolePromptHashes(),
	};
	return staticInputs;
}

export function workflowBehaviorFingerprint(inputs) {
	return hash(inputs);
}

export function workflowTelemetryIdentity(behaviorSettings = {}) {
	const inputs = { ...workflowStaticInputs(), behaviorSettings };
	const key = workflowBehaviorFingerprint(inputs);
	let workflow = identityCache.get(key);
	if (!workflow) {
		workflow = Object.freeze({
			packageVersion: inputs.packageVersion,
			...inputs.source,
			routingPolicyRevision: inputs.routingPolicyRevision,
			assuranceClassifierRevision: inputs.assuranceClassifierRevision,
			behaviorFingerprint: key,
		});
		identityCache.set(key, workflow);
	}
	return { telemetrySchemaVersion: TELEMETRY_SCHEMA_VERSION, workflow };
}

function assuranceNotes(notes) {
	return (Array.isArray(notes) ? notes : [notes])
		.filter(Boolean)
		.map((note) =>
			String(
				typeof note === "object"
					? (note.text ?? note.body ?? note.content ?? note.note ?? "")
					: note,
			),
		)
		.join("\n");
}

function assuranceInput(notes) {
	const matches = [...assuranceNotes(notes).matchAll(/(?:^|\n)\s*wo:assurance\s+([^\r\n]*)/g)];
	if (!matches.length)
		return { warning: "assurance-input-missing" };
	try {
		const value = JSON.parse(matches.at(-1)[1]);
		const keys = Object.keys(value ?? {}).sort().join(",");
		if (
			keys !== "level,reasons,version" ||
			value.version !== 1 ||
			!["normal", "high"].includes(value.level) ||
			!Array.isArray(value.reasons) ||
			!value.reasons.every((reason) => typeof reason === "string" && reason.trim())
		)
			throw new Error("invalid assurance schema");
		return { value };
	} catch {
		return { warning: "assurance-input-malformed" };
	}
}

const HARD_SIGNALS = [
	["security-privacy-money", /\b(?:security|auth(?:entication|orization)?|permission|credential|secret|private data|personal data|pii|payment|billing|money|financial)\b/i],
	["migration-destructive-persistence", /\b(?:migration|schema change|database|persistent data|data loss|destructive|delete records?|drop (?:table|column))\b/i],
	["public-api-protocol-compatibility", /\b(?:public api|wire protocol|protocol compatibility|backward compatibility|breaking change|published interface)\b/i],
	["concurrency-lifecycle-recovery", /\b(?:concurren(?:cy|t)|race condition|thread safety|lifecycle|crash recovery|rollback|idempotenc[ey]|lease|deadlock)\b/i],
	["hardware-physical-effects", /\b(?:hardware|firmware|device|motor|actuator|sensor|physical effect|flash(?:ing)? firmware)\b/i],
	["acceptance-unclear-or-conflicting", /\b(?:unclear|ambiguous|conflicting|contradictory) acceptance\b/i],
	["focused-verification-oracle-missing", /\b(?:no|missing|unavailable) (?:focused )?(?:test|check|verification oracle)\b/i],
	["irreversible-effect", /\b(?:irreversible|cannot be undone|non-recoverable)\b/i],
];

export function classifyShadowAssurance(issue = {}) {
	const explicit = assuranceInput(issue.notes ?? issue.comments ?? issue.comment);
	const source = [
		issue.title,
		issue.description,
		issue.design,
		issue.acceptance,
		issue.acceptance_criteria,
	].filter(Boolean).join("\n");
	const reasons = HARD_SIGNALS
		.filter(([, pattern]) => pattern.test(source))
		.map(([reason]) => reason);
	const labels = Array.isArray(issue.labels) ? issue.labels : String(issue.labels ?? "").split(/[\s,]+/);
	if (labels.some((label) => ["wo:escalation", "wo:assurance-high"].includes(label)))
		reasons.push("explicit-owner-escalation");
	if (explicit.value?.level === "high") reasons.push("explicit-assurance-high");
	const uniqueReasons = [...new Set(reasons)].sort();
	const warnings = explicit.warning ? [explicit.warning] : [];
	if (explicit.value?.level === "normal" && uniqueReasons.length)
		warnings.push("explicit-normal-overridden-by-hard-signal");
	const suggestedAssurance = uniqueReasons.length ? "high" : "normal";
	return {
		mode: "shadow",
		requestedAssurance: explicit.value?.level,
		suggestedAssurance,
		suggestedRole: suggestedAssurance === "high" ? "work-lead" : "work-worker",
		reasons: uniqueReasons,
		warnings,
	};
}
