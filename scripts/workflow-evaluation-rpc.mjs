import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

const DIALOGS = new Set(["select", "confirm", "input", "editor"]);
const VISIBILITY_CLASSES = new Set(["public", "internal", "confidential"]);

function stable(value) {
	if (Array.isArray(value)) return value.map(stable);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, nested]) => [key, stable(nested)]),
		);
	return value;
}

export function provenanceHash(value) {
	return createHash("sha256")
		.update(JSON.stringify(stable(value)) ?? "undefined")
		.digest("hex");
}

function redactCredentialCanary(value, canary) {
	if (!canary) return value;
	if (Array.isArray(value))
		return value.map((item) => redactCredentialCanary(item, canary));
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([key, nested]) => [
				key,
				redactCredentialCanary(nested, canary),
			]),
		);
	return typeof value === "string"
		? value.replaceAll(canary, "[redacted]")
		: value;
}

function roleIdentity(cell) {
	return {
		provider: cell?.provider,
		model: cell?.model ?? cell?.id,
		effort: cell?.effort ?? cell?.thinkingLevel,
		promptHash: cell?.promptHash ?? provenanceHash(cell?.prompt),
		toolsHash: cell?.toolsHash ?? provenanceHash(cell?.tools),
		contextHash: cell?.contextHash ?? provenanceHash(cell?.context),
	};
}

export function requestedRoleProvenance(options) {
	const prompts = options.prompts ?? [options.prompt];
	const main = options.roleMap?.main ?? {
		provider: options.provider,
		model: options.model?.split("/").at(-1),
		effort: options.thinking,
		prompt: prompts.length === 1 ? prompts[0] : prompts,
		tools: options.tools,
		context: options.context,
	};
	return Object.fromEntries(
		Object.entries({ ...(options.roleMap ?? {}), main }).map(([role, cell]) => [
			role,
			roleIdentity(cell),
		]),
	);
}

function observedRoleEvents(events) {
	const observed = {};
	for (const event of events) {
		let record = null;
		if (event.type === "subagent_provenance") record = event;
		else if (
			event.type === "tool_execution_end" &&
			event.toolName === "subagent"
		)
			record = event.result?.provenance;
		if (record?.role) observed[record.role] = roleIdentity(record);
	}
	return observed;
}

export function reconcileRoleProvenance({
	requested,
	observedMain,
	events = [],
	expectedRoles = ["main"],
}) {
	const observed = {
		...observedRoleEvents(events),
		main: roleIdentity(observedMain),
	};
	const required = new Set([
		"main",
		...expectedRoles,
		...Object.keys(requested),
		...Object.keys(observed),
	]);
	const mismatches = [];
	for (const role of required) {
		if (!requested[role]) mismatches.push(`${role}:undeclared`);
		else if (!observed[role]) mismatches.push(`${role}:missing`);
		else
			for (const field of [
				"provider",
				"model",
				"effort",
				"promptHash",
				"toolsHash",
				"contextHash",
			])
				if (requested[role][field] !== observed[role][field])
					mismatches.push(`${role}:${field}`);
	}
	return { valid: mismatches.length === 0, requested, observed, mismatches };
}

export function classifyInfrastructureFailure(failure, error = "") {
	const text = `${failure ?? ""} ${error}`.toLowerCase();
	if (/model[^\n]*(?:not found|unknown|unavailable)|no such model/.test(text))
		return "model-not-found";
	if (/auth|unauthori[sz]ed|invalid api.?key|\b401\b|\b403\b/.test(text))
		return "authentication";
	if (
		/quota|rate.?limit|too many requests|out of (?:extra )?usage|\b429\b/.test(
			text,
		)
	)
		return "quota";
	if (/timeout|timed.?out/.test(text)) return "timeout";
	if (/refus|content policy|safety policy|blocked response/.test(text))
		return "refusal";
	if (/malformed|invalid json|parse error|unexpected response/.test(text))
		return "malformed-response";
	if (
		/rpc.?crash|process-(?:error|exit)|extension-error|broken pipe|econnreset/.test(
			text,
		)
	)
		return "rpc-crash";
	return null;
}

export function snapshotProviderPayload({
	payload,
	provider,
	visibility,
	endpoint,
	approvedEndpoints,
	credentialCanary,
}) {
	if (!provider) throw new Error("provider payload is not bound to a provider");
	if (!VISIBILITY_CLASSES.has(visibility))
		throw new Error("undeclared provider payload visibility class");
	if (!endpoint || !approvedEndpoints?.includes(endpoint))
		throw new Error("provider payload endpoint is not approved");
	const serialized = JSON.stringify(stable(payload));
	if (credentialCanary && serialized.includes(credentialCanary))
		throw new Error("credential canary reached provider payload");
	if (
		/ignore (?:all |the )?(?:previous|prior) instructions|reveal (?:the )?(?:system prompt|secret)|product-contract\.md|goldens[\\/]|answers\.json/i.test(
			serialized,
		)
	)
		throw new Error(
			"provider payload contains denied prompt injection or hidden authority data",
		);
	return {
		provider,
		visibility,
		endpoint,
		sha256: createHash("sha256").update(serialized).digest("hex"),
	};
}

const CORE_AGENT_METRICS = [
	"toolCalls",
	"toolOutputBytes",
	"subagentCalls",
	"retries",
	"questions",
];
const OPTIONAL_AGENT_METRICS = [
	"reasoningTokens",
	"cacheReadTokens",
	"cacheWriteTokens",
	"providerLatencyMs",
	"queueLatencyMs",
	"contextGrowth",
	"compactions",
	"cost",
];
const HASH = /^[a-f0-9]{64}$/i;

function requireLedger(value, message) {
	if (!value) throw new Error(message);
}

export function reconcileAgentLedger(records) {
	requireLedger(
		Array.isArray(records) && records.length > 0,
		"agent ledger is missing",
	);
	const starts = new Map();
	const terminals = new Map();
	for (const record of records) {
		if (!new Set(["agent-dispatched", "agent-terminal"]).has(record?.type))
			continue;
		for (const field of [
			"sampleId",
			"pairId",
			"attemptId",
			"agentId",
			"role",
			"treatmentId",
		])
			requireLedger(
				record[field] !== undefined && record[field] !== "",
				`agent ledger missing ${field}`,
			);
		requireLedger(
			"parentAgentId" in record,
			"agent ledger missing parentAgentId",
		);
		const target = record.type === "agent-dispatched" ? starts : terminals;
		requireLedger(
			!target.has(record.agentId),
			`duplicate ${record.type}: ${record.agentId}`,
		);
		target.set(record.agentId, record);
	}
	requireLedger(starts.size > 0, "agent ledger has no dispatches");
	const sampleIds = new Set(
		[...starts.values()].map((record) => record.sampleId),
	);
	const pairIds = new Set([...starts.values()].map((record) => record.pairId));
	const attemptIds = new Set(
		[...starts.values()].map((record) => record.attemptId),
	);
	requireLedger(
		sampleIds.size === 1 && pairIds.size === 1 && attemptIds.size === 1,
		"agent ledger mixes sample identities",
	);
	const agents = [];
	for (const [agentId, start] of starts) {
		const terminal = terminals.get(agentId);
		requireLedger(terminal, `missing terminal agent event: ${agentId}`);
		for (const field of [
			"sampleId",
			"pairId",
			"attemptId",
			"role",
			"treatmentId",
			"parentAgentId",
		])
			requireLedger(
				terminal[field] === start[field],
				`agent identity drift: ${agentId}:${field}`,
			);
		if (start.parentAgentId !== null)
			requireLedger(
				starts.has(start.parentAgentId),
				`orphan or wrong parent: ${agentId}`,
			);
		const startedAt = Date.parse(start.startedAt);
		const endedAt = Date.parse(terminal.endedAt);
		requireLedger(
			Number.isFinite(startedAt) &&
				Number.isFinite(endedAt) &&
				endedAt >= startedAt,
			`invalid agent interval: ${agentId}`,
		);
		for (const field of ["provider", "model", "effort", "terminalReason"])
			requireLedger(
				terminal[field] !== undefined && terminal[field] !== "",
				`agent terminal missing ${field}: ${agentId}`,
			);
		const tokens = terminal.tokens;
		requireLedger(
			Number.isFinite(tokens?.input) &&
				Number.isFinite(tokens?.output) &&
				Number.isFinite(tokens?.total) &&
				tokens.input >= 0 &&
				tokens.output >= 0 &&
				tokens.total >= tokens.input + tokens.output,
			`agent terminal missing provider token totals: ${agentId}`,
		);
		for (const field of CORE_AGENT_METRICS)
			requireLedger(
				Number.isFinite(terminal[field]) && terminal[field] >= 0,
				`agent terminal missing ${field}: ${agentId}`,
			);
		requireLedger(
			Array.isArray(terminal.artifactIds),
			`agent terminal missing artifactIds: ${agentId}`,
		);
		agents.push({
			...terminal,
			startedAt: start.startedAt,
			activeWallMs: endedAt - startedAt,
			capabilities: Object.fromEntries(
				OPTIONAL_AGENT_METRICS.map((field) => [
					field,
					terminal[field] ?? "unavailable",
				]),
			),
		});
	}
	requireLedger(terminals.size === starts.size, "orphan terminal agent event");
	const roleAgents = agents.filter(
		(agent) => !["harness", "evaluator"].includes(agent.costScope),
	);
	const totalsFor = (selected) => ({
		tokens: selected.reduce((sum, agent) => sum + agent.tokens.total, 0),
		toolCalls: selected.reduce((sum, agent) => sum + agent.toolCalls, 0),
		toolOutputBytes: selected.reduce(
			(sum, agent) => sum + agent.toolOutputBytes,
			0,
		),
		subagentCalls: selected.reduce(
			(sum, agent) => sum + agent.subagentCalls,
			0,
		),
		retries: selected.reduce((sum, agent) => sum + agent.retries, 0),
		questions: selected.reduce((sum, agent) => sum + agent.questions, 0),
		activeWallMs: selected.reduce((sum, agent) => sum + agent.activeWallMs, 0),
	});
	const first = Math.min(...agents.map((agent) => Date.parse(agent.startedAt)));
	const last = Math.max(...agents.map((agent) => Date.parse(agent.endedAt)));
	const overlaps = [];
	for (let left = 0; left < agents.length; left += 1)
		for (let right = left + 1; right < agents.length; right += 1) {
			const a = agents[left];
			const b = agents[right];
			if (
				Date.parse(a.startedAt) < Date.parse(b.endedAt) &&
				Date.parse(b.startedAt) < Date.parse(a.endedAt)
			)
				overlaps.push([a.agentId, b.agentId]);
		}
	return {
		version: 2,
		sampleId: [...sampleIds][0],
		pairId: [...pairIds][0],
		attemptId: [...attemptIds][0],
		agents,
		sampleWallMs: last - first,
		overlaps,
		totals: {
			workflowRoles: totalsFor(roleAgents),
			harness: totalsFor(
				agents.filter((agent) => agent.costScope === "harness"),
			),
			evaluator: totalsFor(
				agents.filter((agent) => agent.costScope === "evaluator"),
			),
		},
	};
}

export function reconcileArtifactLedger(events) {
	requireLedger(Array.isArray(events), "artifact ledger must be an array");
	const eventIds = new Set();
	const artifacts = new Map();
	const findings = new Map();
	let previousTime = -Infinity;
	for (const event of events) {
		requireLedger(
			event?.eventId && !eventIds.has(event.eventId),
			"duplicate or missing artifact eventId",
		);
		eventIds.add(event.eventId);
		const timestamp = Date.parse(event.timestamp);
		requireLedger(
			Number.isFinite(timestamp) && timestamp >= previousTime,
			"artifact ledger is not append ordered",
		);
		previousTime = timestamp;
		if (event.type === "artifact-produced") {
			requireLedger(
				!artifacts.has(event.artifactId),
				`duplicate artifact: ${event.artifactId}`,
			);
			for (const field of [
				"artifactId",
				"producerAgentId",
				"visibility",
				"promptHash",
				"resourceHash",
				"contentHash",
			])
				requireLedger(event[field], `artifact production missing ${field}`);
			requireLedger(
				Array.isArray(event.allowedConsumers),
				"artifact production missing allowedConsumers",
			);
			requireLedger(
				[event.promptHash, event.resourceHash, event.contentHash].every(
					(hash) => HASH.test(hash),
				),
				"artifact production has invalid hash",
			);
			artifacts.set(event.artifactId, { ...event, events: [event.eventId] });
			continue;
		}
		const artifact = artifacts.get(event.artifactId);
		requireLedger(artifact, `orphan artifact event: ${event.artifactId}`);
		artifact.events.push(event.eventId);
		if (event.type === "artifact-consumed")
			requireLedger(
				artifact.allowedConsumers.includes(event.consumerAgentId),
				`artifact consumer denied: ${event.consumerAgentId}`,
			);
		if (event.type === "finding-received") {
			requireLedger(
				event.findingId && !findings.has(event.findingId),
				"duplicate or missing finding receipt",
			);
			findings.set(event.findingId, "received");
		}
		if (["finding-accepted", "finding-rejected"].includes(event.type)) {
			requireLedger(
				findings.get(event.findingId) === "received",
				`finding decision without receipt: ${event.findingId}`,
			);
			findings.set(
				event.findingId,
				event.type === "finding-accepted" ? "accepted" : "rejected",
			);
		}
		if (event.type === "revision-produced")
			for (const findingId of event.findingIds ?? [])
				requireLedger(
					findings.get(findingId) === "accepted",
					`revision uses unaccepted finding: ${findingId}`,
				);
		if (["verification-passed", "regression-detected"].includes(event.type))
			requireLedger(
				event.revisionArtifactId && artifacts.has(event.revisionArtifactId),
				"verification or regression lacks revision artifact",
			);
	}
	return {
		version: 1,
		events: events.length,
		artifacts: Object.fromEntries(artifacts),
		findings: Object.fromEntries(findings),
	};
}

export function createJsonlParser(
	onRecord,
	onError = (error) => {
		throw error;
	},
) {
	const decoder = new StringDecoder("utf8");
	let buffer = "";
	function parse(line) {
		if (!line) return;
		try {
			onRecord(JSON.parse(line.endsWith("\r") ? line.slice(0, -1) : line));
		} catch (error) {
			onError(error);
		}
	}
	return {
		write(chunk) {
			buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
			for (
				let index = buffer.indexOf("\n");
				index >= 0;
				index = buffer.indexOf("\n")
			) {
				const line = buffer.slice(0, index);
				buffer = buffer.slice(index + 1);
				parse(line);
			}
		},
		end() {
			buffer += decoder.end();
			if (buffer) parse(buffer);
			buffer = "";
		},
	};
}

function normalize(value) {
	return String(value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

export function answerUiRequest(request, bank) {
	if (!DIALOGS.has(request?.method)) return { ignored: true };
	const question = normalize(
		[request.title, request.message]
			.filter(Boolean)
			.join(" ")
			.split(/\n\s*\nContext:/i)[0],
	);
	const expected = Object.entries(bank?.expected ?? {}).map((entry) => ({
		entry,
		unexpected: false,
	}));
	const fallback = Object.entries(bank?.fallback ?? {}).map((entry) => ({
		entry,
		unexpected: true,
	}));
	const aliases = (key) => String(key).split("|").map(normalize);
	const match = [...expected, ...fallback]
		.sort(
			(left, right) =>
				Math.max(...aliases(right.entry[0]).map((alias) => alias.length)) -
				Math.max(...aliases(left.entry[0]).map((alias) => alias.length)),
		)
		.find(({ entry: [key] }) =>
			aliases(key).some(
				(alias) => question.includes(alias) || alias.includes(question),
			),
		);
	if (!match) return null;
	const values = Array.isArray(match.entry[1])
		? match.entry[1]
		: [match.entry[1]];
	if (request.method === "confirm")
		return {
			type: "extension_ui_response",
			id: request.id,
			confirmed: /^(yes|true|continue|confirm)$/i.test(String(values[0])),
			unexpected: match.unexpected,
		};
	if (request.method === "select") {
		const option = request.options?.find((item) =>
			values.some((value) => normalize(item) === normalize(value)),
		);
		if (!option) return null;
		return {
			type: "extension_ui_response",
			id: request.id,
			value: option,
			unexpected: match.unexpected,
		};
	}
	return {
		type: "extension_ui_response",
		id: request.id,
		value: String(values[0]),
		unexpected: match.unexpected,
	};
}

function sameStrings(left, right) {
	return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function packageIdentity(root) {
	const packageRoot = realpathSync(root);
	const file = path.join(packageRoot, "package.json");
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(
			`invalid dependency package ${root}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return {
		name: manifest.name,
		version: manifest.version,
		root: packageRoot,
		manifestSha: createHash("sha256").update(readFileSync(file)).digest("hex"),
	};
}

export function preflightRpcSample(options) {
	if (!path.isAbsolute(options.packageRoot))
		throw new Error("package root must be absolute");
	if (options.revision !== options.expectedRevision)
		throw new Error("package revision mismatch");
	const packageRoot = realpathSync(options.packageRoot);
	let revision = options.revision;
	if (revision === "local" || /^[a-f0-9]{7,40}$/i.test(revision)) {
		const resolved = spawnSync("git", ["rev-parse", "HEAD"], {
			cwd: packageRoot,
			encoding: "utf8",
			timeout: 30_000,
		});
		if (resolved.status !== 0)
			throw new Error("selected package revision is unavailable");
		const actual = resolved.stdout.trim();
		if (revision !== "local" && actual !== revision)
			throw new Error(
				"selected package checkout does not match its declared revision",
			);
		const dirty = spawnSync(
			"git",
			[
				"status",
				"--porcelain=v1",
				"--",
				"agents",
				"extensions",
				"prompts",
				"skills",
				"scripts",
				"benchmarks",
				"package.json",
			],
			{ cwd: packageRoot, encoding: "utf8", timeout: 30_000 },
		);
		if (dirty.status !== 0 || dirty.stdout.trim())
			throw new Error(
				"selected package checkout has uncommitted resource changes",
			);
		revision = actual;
	}
	const dependencies = (options.dependencyRoots ?? []).map(packageIdentity);
	if (!sameStrings(options.tools ?? [], options.expectedTools ?? []))
		throw new Error("tool allowlist mismatch");
	if (!options.trusted && options.isolation !== "os")
		throw new Error("untrusted revisions require an external OS sandbox");
	if (
		!options.trusted &&
		(!options.sandboxCommand?.command ||
			!Array.isArray(options.sandboxCommand.args))
	)
		throw new Error("untrusted revisions require an explicit sandbox command");
	if (!new Set(["path", "os"]).has(options.isolation))
		throw new Error("isolation must be path or os");
	return {
		packageRoot,
		revision,
		dependencies,
		sandboxCommand: options.sandboxCommand ?? null,
		isolation: options.isolation,
		trust: options.trusted ? "trusted" : "untrusted-sandboxed",
	};
}

function canonicalPath(target) {
	const resolved = path.resolve(target);
	if (existsSync(resolved)) return realpathSync(resolved);
	let parent = path.dirname(resolved);
	while (!existsSync(parent) && path.dirname(parent) !== parent)
		parent = path.dirname(parent);
	return path.join(realpathSync(parent), path.relative(parent, resolved));
}

export function lexicallyContained(root, target, pathApi = path) {
	if (!root || !target) return false;
	const relative = pathApi.relative(root, target);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !pathApi.isAbsolute(relative))
	);
}

function contained(root, target) {
	return root && target
		? lexicallyContained(canonicalPath(root), canonicalPath(target))
		: false;
}

function commandName(stage) {
	return stage === "work" ? "work-resume" : `work-${stage}`;
}

function validateCommands(commands, options) {
	const requiredCommands = options.requiredCommands ?? [
		commandName(options.stage),
	];
	for (const expected of requiredCommands) {
		const matches = (commands ?? []).filter((item) => item.name === expected);
		const owners = matches.filter((item) => item.source === "extension");
		if (owners.length !== 1)
			throw new Error(`command provenance mismatch for ${expected}`);
		for (const item of matches) {
			const ownerPath = item.path ?? item.sourceInfo?.path;
			if (!ownerPath || !contained(options.packageRoot, ownerPath))
				throw new Error(`command ${expected} is not owned by selected package`);
		}
	}
	const allowedRoots = [
		options.packageRoot,
		...(options.dependencyRoots ?? []),
	];
	for (const required of options.requiredResources ?? []) {
		const resources = (commands ?? []).filter((item) => item.name === required);
		if (resources.length !== 1)
			throw new Error(`required resource provenance mismatch for ${required}`);
		const ownerPath = resources[0].path ?? resources[0].sourceInfo?.path;
		if (!ownerPath || !allowedRoots.some((root) => contained(root, ownerPath)))
			throw new Error(
				`required resource ${required} is outside the package allowlist`,
			);
	}
	return requiredCommands;
}

function absolutePaths(value) {
	const text = JSON.stringify(value ?? {});
	return [
		...text.matchAll(
			/[A-Za-z]:[\\/][^"\s]*|\/(?:home|tmp|Users|var)\/[^"\s]*/g,
		),
	].map((match) => match[0].replaceAll("\\", path.sep));
}

function forbiddenWrite(event, options) {
	if (
		event.type !== "tool_execution_start" ||
		!new Set(["write", "edit", "bash"]).has(event.toolName)
	)
		return null;
	const workspace = options.workspaceRoot ?? process.cwd();
	const explicit =
		event.toolName === "bash"
			? []
			: [
					event.args?.path,
					event.args?.file,
					event.args?.filePath,
					event.args?.file_path,
				].filter((value) => typeof value === "string");
	for (const value of explicit) {
		const target = path.isAbsolute(value)
			? value
			: path.resolve(workspace, value);
		if (
			contained(options.sourceRoot, target) ||
			contained(options.bundleRoot, target) ||
			!contained(workspace, target)
		)
			return target;
	}
	if (
		event.toolName === "bash" &&
		/(^|\s)(?:\.\.[\\/])+/.test(String(event.args?.command ?? ""))
	)
		return "relative traversal in bash command";
	for (const target of absolutePaths(event.args)) {
		if (
			contained(options.sourceRoot, target) ||
			contained(options.bundleRoot, target)
		)
			return target;
		if (
			contained(workspace, target) ||
			(options.dependencyRoots ?? []).some((root) => contained(root, target))
		)
			continue;
		return target;
	}
	return null;
}

export function reconcileWorkflowTelemetry(records) {
	if (!Array.isArray(records) || records.length === 0)
		throw new Error("workflow telemetry is missing");
	const correlated = records.filter((record) => record?.workflowRunId);
	const ids = [...new Set(correlated.map((record) => record.workflowRunId))];
	if (ids.length === 0) throw new Error("workflow telemetry has no identity");
	const terminals = [];
	for (const id of ids) {
		const matches = correlated.filter(
			(record) =>
				record.workflowRunId === id && record.type === "workflow-complete",
		);
		if (matches.length !== 1)
			throw new Error(
				`workflow terminal telemetry must be exactly once for ${id}`,
			);
		terminals.push(matches[0]);
	}
	return {
		workflowRunId: ids.length === 1 ? ids[0] : null,
		workflowRunIds: ids,
		events: correlated,
		terminals,
	};
}

export function piInvocation(args, override) {
	if (override) return [override, args];
	const script = path.join(
		process.env.APPDATA ?? "",
		"npm",
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
		"dist",
		"cli.js",
	);
	return process.platform === "win32" && path.isAbsolute(script)
		? [process.execPath, [script, ...args]]
		: ["pi", args];
}

function defaultSpawn(command, args, options) {
	return spawn(command, args, options);
}

export function terminationPlan(platform, pid) {
	return platform === "win32"
		? { command: "taskkill", args: ["/PID", String(pid), "/T", "/F"] }
		: { signal: "SIGTERM" };
}

function terminate(child) {
	if (!child?.pid) return child?.kill?.("SIGTERM");
	const plan = terminationPlan(process.platform, child.pid);
	if (plan.command)
		spawnSync(plan.command, plan.args, { stdio: "ignore", timeout: 30_000 });
	else child.kill(plan.signal);
}

export async function runRpcSample(options) {
	let preflight;
	try {
		preflight = preflightRpcSample(options);
	} catch (error) {
		return {
			status: "failed",
			failure: "preflight",
			error: error instanceof Error ? error.message : String(error),
		};
	}
	let payloadSnapshot = null;
	try {
		if (options.providerPolicy)
			payloadSnapshot = snapshotProviderPayload({
				...options.providerPolicy,
				provider: options.provider,
				payload: {
					prompts: options.prompts ?? [options.prompt],
					tools: options.tools,
					context: options.context ?? options.roleMap?.main?.context,
				},
			});
	} catch (error) {
		return {
			status: "failed",
			failure: "payload-policy",
			error: error instanceof Error ? error.message : String(error),
		};
	}
	const args = [
		"--mode",
		"rpc",
		"--no-session",
		"--offline",
		"--no-context-files",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"-e",
		preflight.packageRoot,
	];
	for (const dependency of preflight.dependencies)
		args.push("-e", dependency.root);
	args.push("--tools", options.tools.join(","));
	if (options.provider) args.push("--provider", options.provider);
	if (options.model) args.push("--model", options.model);
	let [piCommand, piArgs] = piInvocation(args, options.piCommand);
	if (preflight.sandboxCommand) {
		piArgs = [...preflight.sandboxCommand.args, piCommand, ...piArgs];
		piCommand = preflight.sandboxCommand.command;
	}
	const child = (options.spawnProcess ?? defaultSpawn)(piCommand, piArgs, {
		cwd: options.workspaceRoot ?? process.cwd(),
		env: options.env ?? process.env,
		stdio: ["pipe", "pipe", "pipe"],
	});
	const events = [];
	const questions = [];
	let stderr = "";
	let done = false;
	let prompted = false;
	let settled = false;
	let promptIndex = 0;
	const prompts = options.prompts ?? [options.prompt];
	let runtimeState = null;
	let resourceProvenance = null;
	let initialUsage = null;
	let stageStartedAt = null;
	let pendingResult = null;
	return await new Promise((resolve) => {
		let timer;
		const finish = (result) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			const requestedRoles = requestedRoleProvenance({
				...options,
				provider: options.provider ?? runtimeState?.model?.provider,
				model: options.model ?? runtimeState?.model?.id,
				thinking: options.thinking ?? runtimeState?.thinkingLevel,
			});
			const roleProvenance = reconcileRoleProvenance({
				requested: requestedRoles,
				observedMain: {
					provider: runtimeState?.model?.provider,
					model: runtimeState?.model?.id,
					effort: runtimeState?.thinkingLevel,
					prompt: prompts.length === 1 ? prompts[0] : prompts,
					tools: options.tools,
					context: options.context,
				},
				events,
				expectedRoles: options.expectedRoles,
			});
			const settledResult =
				result.status === "completed" && !roleProvenance.valid
					? {
							status: "failed",
							failure: "role-provenance",
							error: roleProvenance.mismatches.join(", "),
						}
					: result;
			resolve(
				redactCredentialCanary(
					{
						...settledResult,
						infrastructureClass: classifyInfrastructureFailure(
							settledResult.failure,
							settledResult.error,
						),
						stageWallMs: stageStartedAt ? Date.now() - stageStartedAt : 0,
						initialUsage,
						events,
						questions,
						stderr: stderr.slice(-8000),
						provenance: {
							packageRoot: preflight.packageRoot,
							revision: preflight.revision,
							dependencies: preflight.dependencies,
							resources: resourceProvenance,
							tools: options.tools,
							isolation: preflight.isolation,
							trusted: options.trusted,
							model: runtimeState?.model ?? null,
							thinking: runtimeState?.thinkingLevel,
							roles: roleProvenance,
							payload: payloadSnapshot,
						},
					},
					options.providerPolicy?.credentialCanary,
				),
			);
		};
		const send = (command) => {
			if (!child.stdin.destroyed)
				child.stdin.write(`${JSON.stringify(command)}\n`);
		};
		const dispatchPrompt = () => {
			prompted = true;
			stageStartedAt ??= Date.now();
			send({
				id: `prompt-${promptIndex}`,
				type: "prompt",
				message: prompts[promptIndex],
			});
			promptIndex += 1;
		};
		const settle = (result) => {
			if (done || pendingResult) return;
			pendingResult = result;
			terminate(child);
			setTimeout(
				() => finish(pendingResult),
				process.platform === "win32" && child?.pid ? 5_000 : 250,
			);
		};
		const fail = (failure, error) =>
			settle({ status: "failed", failure, error });
		child.stdin.on("error", (error) => {
			if (error?.code !== "EPIPE")
				fail(
					"process-error",
					error instanceof Error ? error.message : String(error),
				);
		});
		const onAbort = () => {
			send({ type: "abort" });
			fail("aborted", "RPC sample aborted");
		};
		const parser = createJsonlParser(
			(event) => {
				events.push(event);
				const target = forbiddenWrite(event, options);
				if (target) return fail("forbidden-write", target);
				if (event.type === "extension_error")
					return fail("extension-error", event.error ?? "extension failed");
				if (
					event.type === "message_end" &&
					event.message?.role === "assistant" &&
					(event.message.stopReason === "error" || event.message.errorMessage)
				)
					return fail(
						"provider-error",
						event.message.errorMessage ?? "assistant failed",
					);
				if (
					event.type === "extension_ui_request" &&
					DIALOGS.has(event.method)
				) {
					const response = answerUiRequest(event, options.answers);
					questions.push({
						title: event.title ?? "",
						method: event.method,
						expected: Boolean(response) && !response.unexpected,
						response: response?.value ?? response?.confirmed,
					});
					if (!response)
						return fail(
							"unanswerable-question",
							event.title ?? event.message ?? "unknown question",
						);
					const { unexpected: _unexpected, ...wireResponse } = response;
					send(wireResponse);
				}
				if (event.type === "response" && event.id === "commands") {
					if (!event.success)
						return fail(
							"resource-provenance",
							event.error ?? "get_commands failed",
						);
					try {
						const required = validateCommands(event.data?.commands, {
							...options,
							packageRoot: preflight.packageRoot,
							dependencyRoots: preflight.dependencies.map(
								(dependency) => dependency.root,
							),
						});
						const names = new Set([
							...required,
							...(options.requiredResources ?? []),
						]);
						resourceProvenance = (event.data?.commands ?? [])
							.filter((item) => names.has(item.name))
							.map((item) => ({
								name: item.name,
								source: item.source,
								path: canonicalPath(item.path ?? item.sourceInfo?.path),
							}));
					} catch (error) {
						return fail(
							"resource-provenance",
							error instanceof Error ? error.message : String(error),
						);
					}
					send({ id: "state", type: "get_state" });
				}
				if (event.type === "response" && event.id === "state") {
					if (!event.success || !event.data?.model)
						return fail(
							"model-provenance",
							event.error ?? "configured model is unavailable",
						);
					runtimeState = event.data;
					if (
						options.provider &&
						event.data.model.provider !== options.provider
					)
						return fail("model-provenance", "provider mismatch");
					const expectedModel = options.model?.split("/").at(-1);
					if (expectedModel && event.data.model.id !== expectedModel)
						return fail("model-provenance", "model mismatch");
					if (
						options.providerPolicy &&
						(event.data.model.baseUrl ?? event.data.model.endpoint) !==
							options.providerPolicy.endpoint
					)
						return fail("model-provenance", "provider endpoint mismatch");
					send({ id: "initial-stats", type: "get_session_stats" });
				}
				if (event.type === "response" && event.id === "initial-stats") {
					if (!event.success || !event.data?.contextUsage)
						return fail(
							"missing-usage",
							event.error ?? "initial context usage missing",
						);
					initialUsage = event.data;
					if (options.thinking)
						send({
							id: "thinking",
							type: "set_thinking_level",
							level: options.thinking,
						});
					else dispatchPrompt();
				}
				if (event.type === "response" && event.id === "thinking") {
					if (!event.success)
						return fail(
							"model-provenance",
							event.error ?? "thinking level unavailable",
						);
					send({ id: "state-after-thinking", type: "get_state" });
				}
				if (event.type === "response" && event.id === "state-after-thinking") {
					if (!event.success || !event.data?.model)
						return fail(
							"model-provenance",
							event.error ??
								"configured model is unavailable after effort update",
						);
					runtimeState = event.data;
					if (event.data.thinkingLevel !== options.thinking)
						return fail("model-provenance", "effort mismatch");
					if (
						(options.provider &&
							event.data.model.provider !== options.provider) ||
						(options.model &&
							event.data.model.id !== options.model.split("/").at(-1))
					)
						return fail("model-provenance", "silent model fallback");
					if (
						options.providerPolicy &&
						(event.data.model.baseUrl ?? event.data.model.endpoint) !==
							options.providerPolicy.endpoint
					)
						return fail("model-provenance", "provider endpoint mismatch");
					dispatchPrompt();
				}
				if (
					event.type === "response" &&
					String(event.id).startsWith("prompt-") &&
					!event.success
				)
					return fail("prompt-rejected", event.error ?? "prompt rejected");
				if (event.type === "agent_settled") {
					if (promptIndex < prompts.length) {
						send({
							id: `prompt-${promptIndex}`,
							type: "prompt",
							message: prompts[promptIndex],
						});
						promptIndex += 1;
					} else {
						settled = true;
						send({ id: "stats", type: "get_session_stats" });
					}
				}
				if (event.type === "response" && event.id === "stats") {
					if (
						!settled ||
						!event.success ||
						!event.data?.tokens ||
						!Number.isFinite(event.data.tokens.total) ||
						event.data.tokens.total <= 0
					)
						return fail(
							"missing-usage",
							event.error ?? "session usage missing",
						);
					settle({ status: "completed", usage: event.data });
				}
			},
			(error) =>
				fail(
					"malformed-rpc",
					error instanceof Error ? error.message : String(error),
				),
		);
		child.stdout.on("data", (chunk) => parser.write(chunk));
		child.stdout.on("end", () => parser.end());
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => fail("process-error", error.message));
		child.on("exit", (code, signal) => {
			if (!done && !pendingResult)
				fail(
					"process-exit",
					`RPC exited ${code ?? signal}${prompted ? " after dispatch" : " before dispatch"}`,
				);
		});
		child.on("close", () => {
			if (pendingResult) finish(pendingResult);
		});
		timer = setTimeout(() => {
			send({ type: "abort" });
			fail("timeout", `RPC exceeded ${options.timeoutMs}ms`);
		}, options.timeoutMs);
		if (options.signal?.aborted) onAbort();
		else options.signal?.addEventListener("abort", onAbort, { once: true });
		send({ id: "commands", type: "get_commands" });
	});
}
