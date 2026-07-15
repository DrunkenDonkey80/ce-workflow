import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
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
	const question = normalize([request.title, request.message].filter(Boolean).join(" "));
	const entries = Object.entries(bank?.expected ?? {});
	const match = entries.find(([key]) => question.includes(normalize(key)) || normalize(key).includes(question));
	if (!match) return null;
	const value = match[1];
	if (request.method === "confirm") return { type: "extension_ui_response", id: request.id, confirmed: /^(yes|true|continue|confirm)$/i.test(String(value)) };
	if (request.method === "select") {
		const option = request.options?.find((item) => normalize(item) === normalize(value));
		if (!option) return null;
		return { type: "extension_ui_response", id: request.id, value: option };
	}
	return { type: "extension_ui_response", id: request.id, value: String(value) };
}

function sameStrings(left, right) { return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort()); }

export function preflightRpcSample(options) {
	if (!path.isAbsolute(options.packageRoot)) throw new Error("package root must be absolute");
	if (options.revision !== options.expectedRevision) throw new Error("package revision mismatch");
	if (!sameStrings(options.tools ?? [], options.expectedTools ?? [])) throw new Error("tool allowlist mismatch");
	if (!options.trusted && options.isolation !== "os") throw new Error("untrusted revisions require an external OS sandbox");
	if (!new Set(["path", "os"]).has(options.isolation)) throw new Error("isolation must be path or os");
	return { packageRoot: realpathSync(options.packageRoot), isolation: options.isolation, trust: options.trusted ? "trusted" : "untrusted-sandboxed" };
}

function contained(root, target) {
	if (!root || !target) return false;
	const relative = path.relative(path.resolve(root), path.resolve(target));
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function commandName(stage) { return stage === "work" ? "work-resume" : `work-${stage}`; }

function validateCommands(commands, options) {
	const expected = commandName(options.stage);
	const owners = (commands ?? []).filter((item) => item.name === expected);
	if (owners.length !== 1) throw new Error(`command provenance mismatch for ${expected}`);
	if (!owners[0].path || !contained(options.packageRoot, owners[0].path)) throw new Error(`command ${expected} is not owned by selected package`);
	return owners[0];
}

function absolutePaths(value) {
	const text = JSON.stringify(value ?? {});
	return [...text.matchAll(/[A-Za-z]:[\\/][^"\s]*|\/(?:home|tmp|Users|var)\/[^"\s]*/g)].map((match) => match[0].replaceAll("\\", path.sep));
}

function forbiddenWrite(event, options) {
	if (event.type !== "tool_execution_start" || !new Set(["write", "edit", "bash"]).has(event.toolName)) return null;
	for (const target of absolutePaths(event.args)) {
		if (contained(options.sourceRoot, target) || contained(options.bundleRoot, target) || !contained(options.workspaceRoot, target)) return target;
	}
	return null;
}

export function reconcileWorkflowTelemetry(records) {
	if (!Array.isArray(records) || records.length === 0) throw new Error("workflow telemetry is missing");
	const correlated = records.filter((record) => record?.workflowRunId);
	const ids = [...new Set(correlated.map((record) => record.workflowRunId))];
	if (ids.length !== 1) throw new Error("workflow telemetry is ambiguous");
	const terminal = correlated.filter((record) => record.type === "workflow-complete");
	if (terminal.length !== 1) throw new Error("workflow terminal telemetry must be exactly once");
	return { workflowRunId: ids[0], events: correlated, terminal: terminal[0] };
}

function defaultSpawn(command, args, options) { return spawn(command, args, options); }

function terminate(child) {
	if (!child?.pid) return child?.kill?.("SIGTERM");
	if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
	else child.kill("SIGTERM");
}

export async function runRpcSample(options) {
	let preflight;
	try { preflight = preflightRpcSample(options); }
	catch (error) { return { status: "failed", failure: "preflight", error: error instanceof Error ? error.message : String(error) }; }
	const args = ["--mode", "rpc", "--no-session", "--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "-e", preflight.packageRoot, "--tools", options.tools.join(",")];
	if (options.provider) args.push("--provider", options.provider);
	if (options.model) args.push("--model", options.model);
	const child = (options.spawnProcess ?? defaultSpawn)(options.piCommand ?? "pi", args, { cwd: options.workspaceRoot ?? process.cwd(), env: options.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
	const events = [];
	const questions = [];
	let stderr = "";
	let done = false;
	let prompted = false;
	let settled = false;
	return await new Promise((resolve) => {
		const finish = (result) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			resolve({ ...result, events, questions, stderr: stderr.slice(-8000), provenance: { packageRoot: preflight.packageRoot, revision: options.revision, tools: options.tools, isolation: preflight.isolation, trusted: options.trusted } });
		};
		const send = (command) => { if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(command)}\n`); };
		const fail = (failure, error) => {
			if (done) return;
			finish({ status: "failed", failure, error });
			terminate(child);
		};
		const parser = createJsonlParser((event) => {
			events.push(event);
			const target = forbiddenWrite(event, options);
			if (target) return fail("forbidden-write", target);
			if (event.type === "extension_error") return fail("extension-error", event.error ?? "extension failed");
			if (event.type === "extension_ui_request" && DIALOGS.has(event.method)) {
				const response = answerUiRequest(event, options.answers);
				questions.push({ title: event.title ?? "", method: event.method, expected: Boolean(response), response: response?.value ?? response?.confirmed });
				if (!response) return fail("unanswerable-question", event.title ?? event.message ?? "unknown question");
				send(response);
			}
			if (event.type === "response" && event.id === "commands") {
				if (!event.success) return fail("resource-provenance", event.error ?? "get_commands failed");
				try { validateCommands(event.data?.commands, options); }
				catch (error) { return fail("resource-provenance", error instanceof Error ? error.message : String(error)); }
				prompted = true;
				send({ id: "prompt", type: "prompt", message: options.prompt });
			}
			if (event.type === "agent_settled") {
				settled = true;
				send({ id: "stats", type: "get_session_stats" });
			}
			if (event.type === "response" && event.id === "stats") {
				if (!settled || !event.success || !event.data?.tokens || !Number.isFinite(event.data.tokens.total)) return fail("missing-usage", event.error ?? "session usage missing");
				finish({ status: "completed", usage: event.data });
			}
		}, (error) => fail("malformed-rpc", error instanceof Error ? error.message : String(error)));
		child.stdout.on("data", (chunk) => parser.write(chunk));
		child.stdout.on("end", () => parser.end());
		child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
		child.on("error", (error) => fail("process-error", error.message));
		child.on("exit", (code, signal) => { if (!done) fail("process-exit", `RPC exited ${code ?? signal}${prompted ? " after dispatch" : " before dispatch"}`); });
		const timer = setTimeout(() => { send({ type: "abort" }); fail("timeout", `RPC exceeded ${options.timeoutMs}ms`); }, options.timeoutMs);
		send({ id: "commands", type: "get_commands" });
	});
}
