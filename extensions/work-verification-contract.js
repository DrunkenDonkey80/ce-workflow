import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const VERIFICATION_CONTRACT_VERSION = 1;
export const VERIFICATION_CAPABILITIES = new Set([
	"inspection",
	"command",
	"service",
	"browser",
	"desktop",
	"android",
	"device",
	"manual",
]);
export const VERIFICATION_PROOFS = new Set([
	"build",
	"test",
	"interaction",
	"output",
	"visual",
	"accessibility",
	"logs",
	"performance",
	"security",
	"approval",
]);
export const EXECUTABLE_VERIFICATION_CAPABILITIES = new Set([
	"command",
	"service",
	"browser",
	"desktop",
	"android",
	"device",
]);
const PROOF_STATUSES = new Set(["PASS", "FAIL", "BLOCKED"]);
const ASSERTION_OPERATORS = new Set([
	"equals",
	"includes",
	"matches",
	"exists",
	"sha256",
]);

function fail(message) {
	throw new Error(message);
}

function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, canonical(value[key])]),
	);
}

function boundedString(value, label, max = 2_000) {
	if (typeof value !== "string" || !value.trim() || value.length > max)
		fail(`${label} is invalid`);
	return value;
}

function validateAssertions(assertions, label) {
	if (!Array.isArray(assertions) || assertions.length === 0 || assertions.length > 16)
		fail(`${label} must contain 1-16 assertions`);
	for (const [index, assertion] of assertions.entries()) {
		const at = `${label}[${index}]`;
		if (!assertion || typeof assertion !== "object" || Array.isArray(assertion))
			fail(`${at} must be an object`);
		if (!new Set(["stdout", "stderr", "file", "exit"]).has(assertion.target))
			fail(`${at}.target is invalid`);
		if (!ASSERTION_OPERATORS.has(assertion.operator))
			fail(`${at}.operator is invalid`);
		if (assertion.target === "file")
			boundedString(assertion.path, `${at}.path`, 500);
		if (assertion.operator !== "exists" && assertion.value === undefined)
			fail(`${at}.value is required`);
		if (
			assertion.value !== undefined &&
			(typeof assertion.value !== "string" || assertion.value.length > 10_000)
		)
			fail(`${at}.value is invalid`);
	}
}

function validateOperation(operation, label, capability, executable) {
	if (operation === undefined) {
		if (executable && capability === "command")
			fail(`${label}.operation is required for executable command proof`);
		return;
	}
	if (!operation || typeof operation !== "object" || Array.isArray(operation))
		fail(`${label}.operation must be an object`);
	if (operation.adapter !== undefined)
		boundedString(operation.adapter, `${label}.operation.adapter`, 128);
	if (capability === "command")
		boundedString(operation.command, `${label}.operation.command`, 2_000);
	else if (operation.command !== undefined)
		boundedString(operation.command, `${label}.operation.command`, 2_000);
	if (
		operation.timeoutMs !== undefined &&
		(!Number.isInteger(operation.timeoutMs) ||
			operation.timeoutMs < 1 ||
			operation.timeoutMs > 900_000)
	)
		fail(`${label}.operation.timeoutMs must be 1-900000`);
	if (
		operation.expectedExit !== undefined &&
		(!Number.isInteger(operation.expectedExit) ||
			operation.expectedExit < 0 ||
			operation.expectedExit > 255)
	)
		fail(`${label}.operation.expectedExit is invalid`);
	if (operation.cwd !== undefined)
		boundedString(operation.cwd, `${label}.operation.cwd`, 500);
	if (operation.sharedId !== undefined) {
		if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(operation.sharedId))
			fail(`${label}.operation.sharedId is invalid`);
	}
	if (operation.env !== undefined) {
		if (
			!operation.env ||
			typeof operation.env !== "object" ||
			Array.isArray(operation.env) ||
			Object.keys(operation.env).length > 32 ||
			Object.entries(operation.env).some(
				([key, value]) =>
					!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
					typeof value !== "string" ||
					value.length > 2_000,
			)
		)
			fail(`${label}.operation.env is invalid`);
	}
	if (operation.assertions !== undefined)
		validateAssertions(operation.assertions, `${label}.operation.assertions`);
	if (executable && capability === "command") {
		if (operation.expectedExit === undefined)
			fail(`${label}.operation.expectedExit is required`);
		validateAssertions(operation.assertions, `${label}.operation.assertions`);
	}
}

export function verificationContractHash(contract) {
	return createHash("sha256")
		.update(JSON.stringify(canonical(contract)))
		.digest("hex");
}

export function validateVerificationContract(
	contract,
	label = "verificationContract",
	options = {},
) {
	if (!contract || typeof contract !== "object" || Array.isArray(contract))
		fail(`${label} must be an object`);
	if (contract.version !== VERIFICATION_CONTRACT_VERSION)
		fail(`${label}.version must be ${VERIFICATION_CONTRACT_VERSION}`);
	if (!Array.isArray(contract.required) || contract.required.length === 0)
		fail(`${label}.required must contain at least one proof`);
	if (contract.required.length > 32)
		fail(`${label}.required is limited to 32 proofs`);
	const ids = new Set();
	for (const [index, entry] of contract.required.entries()) {
		const at = `${label}.required[${index}]`;
		if (!entry || typeof entry !== "object" || Array.isArray(entry))
			fail(`${at} must be an object`);
		if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(entry.id ?? ""))
			fail(`${at}.id is invalid`);
		if (ids.has(entry.id)) fail(`${at}.id is duplicated`);
		ids.add(entry.id);
		if (!VERIFICATION_CAPABILITIES.has(entry.capability))
			fail(`${at}.capability is invalid`);
		if (!VERIFICATION_PROOFS.has(entry.proof)) fail(`${at}.proof is invalid`);
		boundedString(entry.source, `${at}.source`, 500);
		if (
			entry.artifacts !== undefined &&
			(!Array.isArray(entry.artifacts) ||
				entry.artifacts.length > 8 ||
				entry.artifacts.some(
					(item) =>
						typeof item !== "string" ||
						!/^[a-z0-9._-]{1,32}$/i.test(item),
				))
		)
			fail(`${at}.artifacts is invalid`);
		if (
			entry.inspection !== undefined &&
			entry.inspection !== "goal" &&
			entry.inspection !== "human"
		)
			fail(`${at}.inspection must be goal or human`);
		if (
			entry.instructions !== undefined &&
			(typeof entry.instructions !== "string" ||
				entry.instructions.length > 2_000)
		)
			fail(`${at}.instructions is invalid`);
		validateOperation(entry.operation, at, entry.capability, options.executable);
	}
	return structuredClone(contract);
}

export function validateExecutableVerificationContract(
	contract,
	label = "verificationContract",
) {
	return validateVerificationContract(contract, label, { executable: true });
}

function proof(
	id,
	capability,
	kind,
	source,
	artifacts = ["result"],
	extra = {},
) {
	return { id, capability, proof: kind, source, artifacts, ...extra };
}

export function compatibilityVerificationContract(item = {}) {
	const source = String(item.acceptance ?? item.description ?? item.title ?? "Legacy WorkItem").slice(0, 500) || "Legacy WorkItem";
	return validateVerificationContract({
		version: VERIFICATION_CONTRACT_VERSION,
		required: [
			proof("legacy-inspection", "inspection", "approval", source, ["result"], {
				inspection: "goal",
				instructions:
					"Inspect the completed legacy WorkItem outcome and record a revision-bound summary.",
			}),
		],
	});
}

export function inferVerificationContract(
	text,
	source = "WorkItem acceptance",
	options = {},
) {
	const value = String(text ?? "");
	const lower = value.toLowerCase();
	const commandOperation = options.command
		? {
				command: options.command,
				timeoutMs: options.timeoutMs ?? 120_000,
				expectedExit: 0,
				assertions: [{ target: "exit", operator: "equals", value: "0" }],
			}
		: undefined;
	const required = [
		proof(
			"check",
			"command",
			/\bbuild\b/.test(lower) ? "build" : "test",
			source,
			["result"],
			commandOperation
				? { operation: commandOperation }
				: {
						instructions:
							"Declare the exact verification command and assertions before claim.",
					},
		),
	];
	const addRendered = (capability) => {
		if (
			/\b(?:interact|interaction|keyboard|pointer|click|tap|flow|accessib|persist|reload|navigation)\b/.test(
				lower,
			)
		)
			required.push(
				proof(`${capability}-interaction`, capability, "interaction", source),
			);
		if (
			/\b(?:ui|visual|screenshot|responsive|presentation|theme|layout|screen|viewport|window)\b/.test(
				lower,
			)
		)
			required.push(
				proof(
					`${capability}-visual`,
					capability,
					"visual",
					source,
					["screenshot"],
					{ inspection: "goal" },
				),
			);
		if (
			/\b(?:console|logcat|logs?|crash|exception|error[- ]free|cleanliness)\b/.test(
				lower,
			)
		)
			required.push(
				proof(`${capability}-logs`, capability, "logs", source, ["log"]),
			);
	};
	if (
		/\b(?:browser|html|css|dom|viewport|web(?:site|app)?|chromium|firefox|safari)\b/.test(
			lower,
		)
	)
		addRendered("browser");
	if (/\b(?:android|adb|emulator|logcat|apk|gradle)\b/.test(lower))
		addRendered("android");
	if (
		/\b(?:desktop|electron|tauri|wpf|winui|appkit|gtk|qt|window)\b/.test(
			lower,
		)
	)
		addRendered("desktop");
	if (/\b(?:api|http|service|endpoint|server|response)\b/.test(lower))
		required.push(proof("service-interaction", "service", "interaction", source));
	if (/\b(?:hardware|firmware|physical device|sensor|actuator)\b/.test(lower))
		required.push(proof("device-check", "device", "interaction", source));
	return validateVerificationContract({
		version: VERIFICATION_CONTRACT_VERSION,
		required,
	});
}

function artifactCurrent(cwd, artifact) {
	if (artifact.inline === true)
		return typeof artifact.sha256 === "string" && artifact.sha256.length === 64;
	if (
		!cwd ||
		typeof artifact.path !== "string" ||
		typeof artifact.sha256 !== "string"
	)
		return false;
	const absolute = path.resolve(cwd, artifact.path);
	const relative = path.relative(cwd, absolute).replaceAll("\\", "/");
	if (
		!relative ||
		relative.startsWith("../") ||
		path.isAbsolute(relative) ||
		!existsSync(absolute) ||
		!statSync(absolute).isFile()
	)
		return false;
	return (
		createHash("sha256").update(readFileSync(absolute)).digest("hex") ===
		artifact.sha256
	);
}

function trustedIssuer(requirement, record) {
	const issuer = record.issuer;
	if (!issuer || typeof issuer !== "object") return false;
	if (EXECUTABLE_VERIFICATION_CAPABILITIES.has(requirement.capability))
		return (
			issuer.type === "adapter" &&
			issuer.capability === requirement.capability &&
			typeof issuer.id === "string" &&
			issuer.id.length > 0 &&
			typeof issuer.version === "string" &&
			issuer.version.length > 0
		);
	if (requirement.capability === "manual") return issuer.type === "human";
	return issuer.type === "goal" || issuer.type === "human";
}

function validWaiver(item, requirement, hash, revision) {
	return (item.verificationWaivers ?? []).some((waiver) => {
		const decision = (item.evidence ?? []).find(
			(entry) =>
				entry?.kind === "human-decision" &&
				entry.id === waiver?.authority?.decisionId &&
				entry.source === "user" &&
				entry.approved === true &&
				Array.isArray(entry.proofIds) &&
				entry.proofIds.includes(requirement.id),
		);
		return (
			waiver?.proofId === requirement.id &&
			waiver.contractHash === hash &&
			(!revision || waiver.targetRevision === revision) &&
			waiver.authority?.type === "human" &&
			typeof waiver.authority?.id === "string" &&
			waiver.authority.id.length > 0 &&
			typeof waiver.authority?.decisionId === "string" &&
			Boolean(decision) &&
			typeof waiver.rationale === "string" &&
			waiver.rationale.trim().length > 0 &&
			typeof waiver.decidedAt === "string"
		);
	});
}

export function verificationContractStatus(item, options = {}) {
	const contract = item?.verificationContract;
	if (!contract)
		return {
			required: Boolean(options.requireContract),
			ok: !options.requireContract,
			missing: options.requireContract ? ["verification-contract"] : [],
			blocked: [],
			stale: [],
			untrusted: [],
			waived: [],
		};
	validateVerificationContract(contract);
	const hash = verificationContractHash(contract);
	const revision = options.revision ?? item.verificationRevision;
	const records = (item.evidence ?? []).filter(
		(entry) =>
			entry?.kind === "verification-proof" && typeof entry.id === "string",
	);
	const missing = [];
	const blocked = [];
	const stale = [];
	const untrusted = [];
	const waived = [];
	const passed = [];
	for (const requirement of contract.required) {
		if (validWaiver(item, requirement, hash, revision)) {
			waived.push(requirement.id);
			continue;
		}
		const record = records.filter((entry) => entry.id === requirement.id).at(-1);
		if (!record) {
			missing.push(requirement.id);
			continue;
		}
		if (record.status === "BLOCKED") {
			blocked.push(requirement.id);
			continue;
		}
		if (!trustedIssuer(requirement, record)) {
			untrusted.push(requirement.id);
			continue;
		}
		const artifacts = Array.isArray(record.artifacts) ? record.artifacts : [];
		const artifactKinds = new Set(artifacts.map((artifact) => artifact.kind));
		const current = artifacts.every((artifact) =>
			artifactCurrent(options.cwd, artifact),
		);
		const completeArtifacts = (requirement.artifacts ?? []).every((kind) =>
			artifactKinds.has(kind),
		);
		const inspected =
			!requirement.inspection ||
			(record.inspection?.by === requirement.inspection &&
				typeof record.inspection?.summary === "string" &&
				record.inspection.summary.trim());
		if (
			record.status !== "PASS" ||
			record.contractHash !== hash ||
			!record.targetRevision ||
			(revision && record.targetRevision !== revision) ||
			!completeArtifacts ||
			!current ||
			!inspected
		) {
			stale.push(requirement.id);
			continue;
		}
		passed.push(requirement.id);
	}
	return {
		required: true,
		ok:
			missing.length === 0 &&
			blocked.length === 0 &&
			stale.length === 0 &&
			untrusted.length === 0,
		contractHash: hash,
		revision,
		passed,
		waived,
		missing,
		blocked,
		stale,
		untrusted,
	};
}

export function inlineResultArtifact(kind, value) {
	return {
		kind,
		inline: true,
		sha256: createHash("sha256")
			.update(String(value ?? ""))
			.digest("hex"),
	};
}

export function fileArtifact(cwd, kind, requestedPath) {
	const absolute = path.resolve(cwd, requestedPath);
	const relative = path.relative(cwd, absolute).replaceAll("\\", "/");
	if (
		!relative ||
		relative.startsWith("../") ||
		path.isAbsolute(relative) ||
		!existsSync(absolute) ||
		!statSync(absolute).isFile()
	)
		fail(
			`verification artifact must be an existing file inside the repository: ${requestedPath}`,
		);
	return {
		kind,
		path: relative,
		bytes: statSync(absolute).size,
		sha256: createHash("sha256").update(readFileSync(absolute)).digest("hex"),
	};
}

export function verificationProofRecord(contract, proofId, input = {}) {
	validateVerificationContract(contract);
	const requirement = contract.required.find((entry) => entry.id === proofId);
	if (!requirement) fail(`verification proof is not declared: ${proofId}`);
	const status = String(input.status ?? "PASS").toUpperCase();
	if (!PROOF_STATUSES.has(status))
		fail("verification proof status must be PASS, FAIL, or BLOCKED");
	if (status === "PASS" && !input.targetRevision)
		fail("PASS verification proof requires targetRevision");
	if (status === "PASS" && !trustedIssuer(requirement, { issuer: input.issuer }))
		fail(`PASS verification proof requires a trusted ${requirement.capability} issuer`);
	if (status === "BLOCKED") {
		boundedString(input.blocker?.code, "verification blocker code", 128);
		boundedString(input.blocker?.resumeAction, "verification blocker resumeAction", 1_000);
	}
	return {
		kind: "verification-proof",
		id: proofId,
		capability: requirement.capability,
		proof: requirement.proof,
		status,
		contractHash: verificationContractHash(contract),
		...(input.targetRevision
			? { targetRevision: String(input.targetRevision).slice(0, 200) }
			: {}),
		...(input.issuer ? { issuer: structuredClone(input.issuer) } : {}),
		...(input.operation ? { operation: structuredClone(input.operation) } : {}),
		artifacts: structuredClone(input.artifacts ?? []),
		...(input.inspection
			? { inspection: structuredClone(input.inspection) }
			: {}),
		...(input.blocker ? { blocker: structuredClone(input.blocker) } : {}),
		...(input.detail ? { detail: String(input.detail).slice(0, 2_000) } : {}),
		recordedAt: String(input.recordedAt ?? new Date().toISOString()),
	};
}

export function verificationWaiverRecord(contract, proofId, input = {}) {
	validateVerificationContract(contract);
	if (!contract.required.some((entry) => entry.id === proofId))
		fail(`verification waiver is not declared: ${proofId}`);
	if (input.authority?.type !== "human")
		fail("verification waiver requires explicit human authority");
	boundedString(input.authority.id, "verification waiver authority.id", 200);
	boundedString(
		input.authority.decisionId,
		"verification waiver authority.decisionId",
		200,
	);
	boundedString(input.rationale, "verification waiver rationale", 1_000);
	boundedString(input.targetRevision, "verification waiver targetRevision", 200);
	return {
		proofId,
		contractHash: verificationContractHash(contract),
		targetRevision: input.targetRevision,
		authority: structuredClone(input.authority),
		rationale: input.rationale,
		decidedAt: String(input.decidedAt ?? new Date().toISOString()),
	};
}
