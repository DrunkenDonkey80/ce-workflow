



export const VERIFICATION_CONTRACT_VERSION = 1;
export const VERIFICATION_CAPABILITIES = new Set([
	"inspection",
	"command",
	"service",
	"browser",
	"desktop",
	"android",
	"device",
	"macos",
	"ios",
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



function boundedString(value, label, max = 2_000) {
	if (typeof value !== "string" || !value.trim() || value.length > max)
		fail(`${label} is invalid`);
	return value;
}

function validateAssertions(assertions, label) {
	if (
		!Array.isArray(assertions) ||
		assertions.length === 0 ||
		assertions.length > 16
	)
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
					(item) => typeof item !== "string" || !/^[a-z0-9._-]{1,32}$/i.test(item),
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
			(typeof entry.instructions !== "string" || entry.instructions.length > 2_000)
		)
			fail(`${at}.instructions is invalid`);
		validateOperation(entry.operation, at, entry.capability, options.executable);
	}
	return structuredClone(contract);
}
