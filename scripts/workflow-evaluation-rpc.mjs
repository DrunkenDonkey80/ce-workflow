import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

const DIALOGS = new Set(["select", "confirm", "input", "editor"]);

export function createJsonlParser(onRecord, onError = (error) => { throw error; }) {
	const decoder = new StringDecoder("utf8");
	let buffer = "";
	function parse(line) {
		if (!line) return;
		try { onRecord(JSON.parse(line.endsWith("\r") ? line.slice(0, -1) : line)); }
		catch (error) { onError(error); }
	}
	return {
		write(chunk) {
			buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
			for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
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

function normalize(value) { return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

export function answerUiRequest(request, bank) {
	if (!DIALOGS.has(request?.method)) return { ignored: true };
	const question = normalize([request.title, request.message].filter(Boolean).join(" ").split(/\n\s*\nContext:/i)[0]);
	const expected = Object.entries(bank?.expected ?? {}).map((entry) => ({ entry, unexpected: false }));
	const fallback = Object.entries(bank?.fallback ?? {}).map((entry) => ({ entry, unexpected: true }));
	const aliases = (key) => String(key).split("|").map(normalize);
	const match = [...expected, ...fallback]
		.sort((left, right) => Math.max(...aliases(right.entry[0]).map((alias) => alias.length)) - Math.max(...aliases(left.entry[0]).map((alias) => alias.length)))
		.find(({ entry: [key] }) => aliases(key).some((alias) => question.includes(alias) || alias.includes(question)));
	if (!match) return null;
	const values = Array.isArray(match.entry[1]) ? match.entry[1] : [match.entry[1]];
	if (request.method === "confirm") return { type: "extension_ui_response", id: request.id, confirmed: /^(yes|true|continue|confirm)$/i.test(String(values[0])), unexpected: match.unexpected };
	if (request.method === "select") {
		const option = request.options?.find((item) => values.some((value) => normalize(item) === normalize(value)));
		if (!option) return null;
		return { type: "extension_ui_response", id: request.id, value: option, unexpected: match.unexpected };
	}
	return { type: "extension_ui_response", id: request.id, value: String(values[0]), unexpected: match.unexpected };
}

function sameStrings(left, right) { return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort()); }

function packageIdentity(root) {
	const packageRoot = realpathSync(root);
	const file = path.join(packageRoot, "package.json");
	let manifest;
	try { manifest = JSON.parse(readFileSync(file, "utf8")); }
	catch (error) { throw new Error(`invalid dependency package ${root}: ${error instanceof Error ? error.message : String(error)}`); }
	return { name: manifest.name, version: manifest.version, root: packageRoot, manifestSha: createHash("sha256").update(readFileSync(file)).digest("hex") };
}

export function preflightRpcSample(options) {
	if (!path.isAbsolute(options.packageRoot)) throw new Error("package root must be absolute");
	if (options.revision !== options.expectedRevision) throw new Error("package revision mismatch");
	const packageRoot = realpathSync(options.packageRoot);
	let revision = options.revision;
	if (revision === "local" || /^[a-f0-9]{7,40}$/i.test(revision)) {
		const resolved = spawnSync("git", ["rev-parse", "HEAD"], { cwd: packageRoot, encoding: "utf8", timeout: 30_000 });
		if (resolved.status !== 0) throw new Error("selected package revision is unavailable");
		const actual = resolved.stdout.trim();
		if (revision !== "local" && actual !== revision) throw new Error("selected package checkout does not match its declared revision");
		const dirty = spawnSync("git", ["status", "--porcelain=v1", "--", "agents", "extensions", "prompts", "skills", "scripts", "benchmarks", "package.json"], { cwd: packageRoot, encoding: "utf8", timeout: 30_000 });
		if (dirty.status !== 0 || dirty.stdout.trim()) throw new Error("selected package checkout has uncommitted resource changes");
		revision = actual;
	}
	const dependencies = (options.dependencyRoots ?? []).map(packageIdentity);
	if (!sameStrings(options.tools ?? [], options.expectedTools ?? [])) throw new Error("tool allowlist mismatch");
	if (!options.trusted && options.isolation !== "os") throw new Error("untrusted revisions require an external OS sandbox");
	if (!options.trusted && (!options.sandboxCommand?.command || !Array.isArray(options.sandboxCommand.args))) throw new Error("untrusted revisions require an explicit sandbox command");
	if (!new Set(["path", "os"]).has(options.isolation)) throw new Error("isolation must be path or os");
	return { packageRoot, revision, dependencies, sandboxCommand: options.sandboxCommand ?? null, isolation: options.isolation, trust: options.trusted ? "trusted" : "untrusted-sandboxed" };
}

function canonicalPath(target) {
	const resolved = path.resolve(target);
	if (existsSync(resolved)) return realpathSync(resolved);
	let parent = path.dirname(resolved);
	while (!existsSync(parent) && path.dirname(parent) !== parent) parent = path.dirname(parent);
	return path.join(realpathSync(parent), path.relative(parent, resolved));
}

export function lexicallyContained(root, target, pathApi = path) {
	if (!root || !target) return false;
	const relative = pathApi.relative(root, target);
	return relative === "" || (!relative.startsWith("..") && !pathApi.isAbsolute(relative));
}

function contained(root, target) { return root && target ? lexicallyContained(canonicalPath(root), canonicalPath(target)) : false; }

function commandName(stage) { return stage === "work" ? "work-resume" : `work-${stage}`; }

function validateCommands(commands, options) {
	const requiredCommands = options.requiredCommands ?? [commandName(options.stage)];
	for (const expected of requiredCommands) {
		const matches = (commands ?? []).filter((item) => item.name === expected);
		const owners = matches.filter((item) => item.source === "extension");
		if (owners.length !== 1) throw new Error(`command provenance mismatch for ${expected}`);
		for (const item of matches) {
			const ownerPath = item.path ?? item.sourceInfo?.path;
			if (!ownerPath || !contained(options.packageRoot, ownerPath)) throw new Error(`command ${expected} is not owned by selected package`);
		}
	}
	const allowedRoots = [options.packageRoot, ...(options.dependencyRoots ?? [])];
	for (const required of options.requiredResources ?? []) {
		const resources = (commands ?? []).filter((item) => item.name === required);
		if (resources.length !== 1) throw new Error(`required resource provenance mismatch for ${required}`);
		const ownerPath = resources[0].path ?? resources[0].sourceInfo?.path;
		if (!ownerPath || !allowedRoots.some((root) => contained(root, ownerPath))) throw new Error(`required resource ${required} is outside the package allowlist`);
	}
	return requiredCommands;
}

function absolutePaths(value) {
	const text = JSON.stringify(value ?? {});
	return [...text.matchAll(/[A-Za-z]:[\\/][^"\s]*|\/(?:home|tmp|Users|var)\/[^"\s]*/g)].map((match) => match[0].replaceAll("\\", path.sep));
}

function forbiddenWrite(event, options) {
	if (event.type !== "tool_execution_start" || !new Set(["write", "edit", "bash"]).has(event.toolName)) return null;
	const workspace = options.workspaceRoot ?? process.cwd();
	const explicit = event.toolName === "bash" ? [] : [event.args?.path, event.args?.file, event.args?.filePath, event.args?.file_path].filter((value) => typeof value === "string");
	for (const value of explicit) {
		const target = path.isAbsolute(value) ? value : path.resolve(workspace, value);
		if (contained(options.sourceRoot, target) || contained(options.bundleRoot, target) || !contained(workspace, target)) return target;
	}
	if (event.toolName === "bash" && /(^|\s)(?:\.\.[\\/])+/.test(String(event.args?.command ?? ""))) return "relative traversal in bash command";
	for (const target of absolutePaths(event.args)) {
		if (contained(options.sourceRoot, target) || contained(options.bundleRoot, target)) return target;
		if (contained(workspace, target) || (options.dependencyRoots ?? []).some((root) => contained(root, target))) continue;
		return target;
	}
	return null;
}

export function reconcileWorkflowTelemetry(records) {
	if (!Array.isArray(records) || records.length === 0) throw new Error("workflow telemetry is missing");
	const correlated = records.filter((record) => record?.workflowRunId);
	const ids = [...new Set(correlated.map((record) => record.workflowRunId))];
	if (ids.length === 0) throw new Error("workflow telemetry has no identity");
	const terminals = [];
	for (const id of ids) {
		const matches = correlated.filter((record) => record.workflowRunId === id && record.type === "workflow-complete");
		if (matches.length !== 1) throw new Error(`workflow terminal telemetry must be exactly once for ${id}`);
		terminals.push(matches[0]);
	}
	return { workflowRunId: ids.length === 1 ? ids[0] : null, workflowRunIds: ids, events: correlated, terminals };
}

export function piInvocation(args, override) {
	if (override) return [override, args];
	const script = path.join(process.env.APPDATA ?? "", "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
	return process.platform === "win32" && path.isAbsolute(script) ? [process.execPath, [script, ...args]] : ["pi", args];
}

function defaultSpawn(command, args, options) { return spawn(command, args, options); }

export function terminationPlan(platform, pid) {
	return platform === "win32" ? { command: "taskkill", args: ["/PID", String(pid), "/T", "/F"] } : { signal: "SIGTERM" };
}

function terminate(child) {
	if (!child?.pid) return child?.kill?.("SIGTERM");
	const plan = terminationPlan(process.platform, child.pid);
	if (plan.command) spawnSync(plan.command, plan.args, { stdio: "ignore", timeout: 30_000 });
	else child.kill(plan.signal);
}

export async function runRpcSample(options) {
	let preflight;
	try { preflight = preflightRpcSample(options); }
	catch (error) { return { status: "failed", failure: "preflight", error: error instanceof Error ? error.message : String(error) }; }
	const args = ["--mode", "rpc", "--no-session", "--offline", "--no-context-files", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "-e", preflight.packageRoot];
	for (const dependency of preflight.dependencies) args.push("-e", dependency.root);
	args.push("--tools", options.tools.join(","));
	if (options.provider) args.push("--provider", options.provider);
	if (options.model) args.push("--model", options.model);
	let [piCommand, piArgs] = piInvocation(args, options.piCommand);
	if (preflight.sandboxCommand) {
		piArgs = [...preflight.sandboxCommand.args, piCommand, ...piArgs];
		piCommand = preflight.sandboxCommand.command;
	}
	const child = (options.spawnProcess ?? defaultSpawn)(piCommand, piArgs, { cwd: options.workspaceRoot ?? process.cwd(), env: options.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
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
			resolve({ ...result, stageWallMs: stageStartedAt ? Date.now() - stageStartedAt : 0, initialUsage, events, questions, stderr: stderr.slice(-8000), provenance: { packageRoot: preflight.packageRoot, revision: preflight.revision, dependencies: preflight.dependencies, resources: resourceProvenance, tools: options.tools, isolation: preflight.isolation, trusted: options.trusted, model: runtimeState?.model ?? null, thinking: options.thinking ?? runtimeState?.thinkingLevel } });
		};
		const send = (command) => { if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(command)}\n`); };
		const dispatchPrompt = () => {
			prompted = true;
			stageStartedAt ??= Date.now();
			send({ id: `prompt-${promptIndex}`, type: "prompt", message: prompts[promptIndex] });
			promptIndex += 1;
		};
		const settle = (result) => {
			if (done || pendingResult) return;
			pendingResult = result;
			terminate(child);
			setTimeout(() => finish(pendingResult), process.platform === "win32" && child?.pid ? 5_000 : 250);
		};
		const fail = (failure, error) => settle({ status: "failed", failure, error });
		const onAbort = () => { send({ type: "abort" }); fail("aborted", "RPC sample aborted"); };
		const parser = createJsonlParser((event) => {
			events.push(event);
			const target = forbiddenWrite(event, options);
			if (target) return fail("forbidden-write", target);
			if (event.type === "extension_error") return fail("extension-error", event.error ?? "extension failed");
			if (event.type === "message_end" && event.message?.role === "assistant" && (event.message.stopReason === "error" || event.message.errorMessage)) return fail("provider-error", event.message.errorMessage ?? "assistant failed");
			if (event.type === "extension_ui_request" && DIALOGS.has(event.method)) {
				const response = answerUiRequest(event, options.answers);
				questions.push({ title: event.title ?? "", method: event.method, expected: Boolean(response) && !response.unexpected, response: response?.value ?? response?.confirmed });
				if (!response) return fail("unanswerable-question", event.title ?? event.message ?? "unknown question");
				const { unexpected: _unexpected, ...wireResponse } = response;
				send(wireResponse);
			}
			if (event.type === "response" && event.id === "commands") {
				if (!event.success) return fail("resource-provenance", event.error ?? "get_commands failed");
				try {
					const required = validateCommands(event.data?.commands, { ...options, packageRoot: preflight.packageRoot, dependencyRoots: preflight.dependencies.map((dependency) => dependency.root) });
					const names = new Set([...required, ...(options.requiredResources ?? [])]);
					resourceProvenance = (event.data?.commands ?? []).filter((item) => names.has(item.name)).map((item) => ({ name: item.name, source: item.source, path: canonicalPath(item.path ?? item.sourceInfo?.path) }));
				}
				catch (error) { return fail("resource-provenance", error instanceof Error ? error.message : String(error)); }
				send({ id: "state", type: "get_state" });
			}
			if (event.type === "response" && event.id === "state") {
				if (!event.success || !event.data?.model) return fail("model-provenance", event.error ?? "configured model is unavailable");
				runtimeState = event.data;
				if (options.provider && event.data.model.provider !== options.provider) return fail("model-provenance", "provider mismatch");
				const expectedModel = options.model?.split("/").at(-1);
				if (expectedModel && event.data.model.id !== expectedModel) return fail("model-provenance", "model mismatch");
				send({ id: "initial-stats", type: "get_session_stats" });
			}
			if (event.type === "response" && event.id === "initial-stats") {
				if (!event.success || !event.data?.contextUsage) return fail("missing-usage", event.error ?? "initial context usage missing");
				initialUsage = event.data;
				if (options.thinking) send({ id: "thinking", type: "set_thinking_level", level: options.thinking });
				else dispatchPrompt();
			}
			if (event.type === "response" && event.id === "thinking") {
				if (!event.success) return fail("model-provenance", event.error ?? "thinking level unavailable");
				dispatchPrompt();
			}
			if (event.type === "response" && String(event.id).startsWith("prompt-") && !event.success) return fail("prompt-rejected", event.error ?? "prompt rejected");
			if (event.type === "agent_settled") {
				if (promptIndex < prompts.length) {
					send({ id: `prompt-${promptIndex}`, type: "prompt", message: prompts[promptIndex] });
					promptIndex += 1;
				} else {
					settled = true;
					send({ id: "stats", type: "get_session_stats" });
				}
			}
			if (event.type === "response" && event.id === "stats") {
				if (!settled || !event.success || !event.data?.tokens || !Number.isFinite(event.data.tokens.total) || event.data.tokens.total <= 0) return fail("missing-usage", event.error ?? "session usage missing");
				settle({ status: "completed", usage: event.data });
			}
		}, (error) => fail("malformed-rpc", error instanceof Error ? error.message : String(error)));
		child.stdout.on("data", (chunk) => parser.write(chunk));
		child.stdout.on("end", () => parser.end());
		child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
		child.on("error", (error) => fail("process-error", error.message));
		child.on("exit", (code, signal) => { if (!done && !pendingResult) fail("process-exit", `RPC exited ${code ?? signal}${prompted ? " after dispatch" : " before dispatch"}`); });
		child.on("close", () => { if (pendingResult) finish(pendingResult); });
		timer = setTimeout(() => { send({ type: "abort" }); fail("timeout", `RPC exceeded ${options.timeoutMs}ms`); }, options.timeoutMs);
		if (options.signal?.aborted) onAbort();
		else options.signal?.addEventListener("abort", onAbort, { once: true });
		send({ id: "commands", type: "get_commands" });
	});
}
