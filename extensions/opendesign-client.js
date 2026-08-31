import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const READ_TOOLS = new Set([
	"get_project",
	"get_run",
	"list_files",
	"get_artifact",
	"get_file",
]);
const WRITE_TOOLS = new Set(["create_project", "start_run", "cancel_run"]);
const MAX_MESSAGE_BYTES = 1_000_000;
const MAX_STDERR_BYTES = 32_000;
const DEFAULT_TIMEOUT_MS = 15_000;

export class OpenDesignError extends Error {
	constructor(category, message, details = {}) {
		super(message);
		this.name = "OpenDesignError";
		this.category = category;
		this.details = details;
	}
}

function error(category, message, details) {
	return new OpenDesignError(category, message, details);
}

function plainObject(value) {
	return value && typeof value === "object" && !Array.isArray(value);
}

function safeToken(value, field, max = 500) {
	if (typeof value !== "string" || !value.trim())
		throw error("invalid-input", `${field} is required`);
	if (Buffer.byteLength(value, "utf8") > max)
		throw error("invalid-input", `${field} is too large`);
	return value.trim();
}

function containsCredential(value, key = "") {
	if (plainObject(value)) {
		return Object.entries(value).some(
			([childKey, childValue]) =>
				(/^(api[_-]?key|access[_-]?token|authorization|password|secret)$/i.test(
					childKey,
				) &&
					childValue != null &&
					childValue !== "") ||
				containsCredential(childValue, childKey),
		);
	}
	if (Array.isArray(value))
		return value.some((item) => containsCredential(item, key));
	if (typeof value !== "string") return false;
	if (
		/^(api[_-]?key|access[_-]?token|authorization|password|secret)$/i.test(key)
	)
		return Boolean(value);
	return /(?:--?(?:api[_-]?key|access[_-]?token|password|secret)(?:=|\s)|\bBearer\s+[A-Za-z0-9._-]{8,}|[?&](?:token|key|secret)=\S+)/i.test(
		value,
	);
}

function assertNoCredentials(value, field = "arguments") {
	if (containsCredential(value))
		throw error("credentials-forbidden", `${field} must not contain credentials`);
}

export function redactOpenDesignText(value, max = MAX_STDERR_BYTES) {
	return String(value ?? "")
		.replace(/([?&](?:token|key|code|secret)=)[^&\s]+/gi, "$1[REDACTED]")
		.replace(/\b(?:sk|od|Bearer)[-_ ][A-Za-z0-9._-]{12,}\b/gi, "[REDACTED]")
		.replace(
			/("?(?:api[_-]?key|access[_-]?token|password|secret)"?\s*[:=]\s*)[^,\s}]+/gi,
			"$1[REDACTED]",
		)
		.slice(-max);
}

function executableFiles(directory, name, platform, pathExt) {
	const suffixes =
		platform === "win32" ? pathExt.split(";").filter(Boolean) : [""];
	return suffixes.map((suffix) =>
		path.join(
			directory,
			platform === "win32" ? `${name}${suffix.toLowerCase()}` : name,
		),
	);
}

function pathCandidates(name, env, platform) {
	const delimiter = platform === "win32" ? ";" : path.delimiter;
	const pathExt = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
	return String(env.PATH ?? "")
		.split(delimiter)
		.filter(Boolean)
		.flatMap((directory) =>
			executableFiles(directory.replace(/^"|"$/g, ""), name, platform, pathExt),
		);
}

function verifyExecutable(file, platform) {
	try {
		const stats = fs.statSync(file);
		if (!stats.isFile()) return false;
		if (platform === "win32") return true;
		fs.accessSync(file, fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function normalizeCommandSpec(spec, source) {
	if (typeof spec === "string")
		return { command: safeToken(spec, `${source}.command`, 1_000), args: [] };
	if (!plainObject(spec))
		throw error(
			"invalid-command",
			`${source} must be a command string or object`,
		);
	const command = safeToken(spec.command, `${source}.command`, 1_000);
	const args = spec.args ?? [];
	if (
		!Array.isArray(args) ||
		args.some((item) => typeof item !== "string" || item.length > 2_000)
	) {
		throw error("invalid-command", `${source}.args must be bounded strings`);
	}
	const env = spec.env ?? {};
	if (
		!plainObject(env) ||
		Object.keys(env).length > 32 ||
		Object.entries(env).some(
			([key, value]) =>
				!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
				typeof value !== "string" ||
				value.length > 4_000,
		)
	)
		throw error(
			"invalid-command",
			`${source}.env must contain bounded environment strings`,
		);
	const normalized = {
		command,
		args: [...args],
		...(Object.keys(env).length ? { env: { ...env } } : {}),
	};
	assertNoCredentials(normalized, source);
	return normalized;
}

export function normalizeOpenDesignCommandSpec(spec) {
	return normalizeCommandSpec(spec, "commandSpec");
}

export function resolveOpenDesignCommand(options = {}) {
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;
	let spec;
	let source;
	if (options.commandSpec) {
		spec = normalizeOpenDesignCommandSpec(options.commandSpec);
		source = "configured";
	} else if (env.OD_BIN) {
		spec = normalizeCommandSpec({ command: env.OD_BIN, args: ["mcp"] }, "OD_BIN");
		source = "OD_BIN";
	} else {
		const candidate = pathCandidates("od", env, platform).find((file) =>
			verifyExecutable(file, platform),
		);
		if (!candidate)
			throw error(
				"executable-missing",
				"OpenDesign executable not found; configure the Settings MCP command spec",
			);
		spec = { command: candidate, args: ["mcp"] };
		source = "PATH";
	}
	const resolved = path.isAbsolute(spec.command)
		? spec.command
		: pathCandidates(spec.command, env, platform).find((file) =>
				verifyExecutable(file, platform),
			);
	if (!resolved || !verifyExecutable(resolved, platform))
		throw error(
			"executable-missing",
			`OpenDesign executable is unavailable: ${spec.command}`,
		);
	if (platform === "darwin" && path.resolve(resolved) === "/usr/bin/od") {
		throw error(
			"executable-collision",
			"/usr/bin/od is the macOS octal-dump utility; copy the OpenDesign Settings MCP command spec",
		);
	}
	const command = {
		command: resolved,
		args: spec.args.length ? spec.args : ["mcp"],
		source,
	};
	if (spec.env) command.env = spec.env;
	assertNoCredentials(command, "command");
	return command;
}

function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (plainObject(value))
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonical(value[key])]),
		);
	return value;
}

export function openDesignPayloadDigest(value) {
	return crypto
		.createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex");
}

export function validateStartRecovery(original, recovery, options = {}) {
	if (!plainObject(original) || !plainObject(recovery))
		throw error("invalid-input", "start payloads must be objects");
	assertNoCredentials(original, "start payload");
	assertNoCredentials(recovery, "recovery payload");
	const base = { ...recovery };
	delete base.resume;
	if (openDesignPayloadDigest(original) !== openDesignPayloadDigest(base)) {
		throw error(
			"mutation-mismatch",
			"start recovery must reuse the exact original requestId and payload",
		);
	}
	if (recovery.resume === true && options.resumeConfirmed !== true) {
		throw error(
			"confirmation-required",
			"recharge resume requires explicit user confirmation",
		);
	}
	if (recovery.resume != null && recovery.resume !== true)
		throw error("invalid-input", "resume may only be true");
	return recovery;
}

function decodeToolResult(result) {
	if (!plainObject(result))
		throw error("protocol-error", "tool result must be an object");
	if (result.isError === true) {
		const message =
			result.content?.find?.((item) => item?.type === "text")?.text ??
			"OpenDesign tool failed";
		throw error("tool-failed", redactOpenDesignText(message, 2_000));
	}
	if (plainObject(result.structuredContent)) return result.structuredContent;
	const text = result.content?.find?.((item) => item?.type === "text")?.text;
	if (typeof text !== "string") return result;
	try {
		return JSON.parse(text);
	} catch {
		return { text: text.slice(0, 20_000) };
	}
}

class FrameDecoder {
	constructor(onMessage, maxBytes = MAX_MESSAGE_BYTES) {
		this.buffer = Buffer.alloc(0);
		this.onMessage = onMessage;
		this.maxBytes = maxBytes;
	}

	push(chunk) {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		if (this.buffer.length > this.maxBytes)
			throw error("message-too-large", "OpenDesign stdout exceeded the byte cap");
		while (this.buffer.length) {
			if (
				/^Content-Length:/i.test(
					this.buffer.toString("ascii", 0, Math.min(20, this.buffer.length)),
				)
			) {
				const boundary = this.buffer.indexOf("\r\n\r\n");
				const alternate = this.buffer.indexOf("\n\n");
				const end = boundary >= 0 ? boundary : alternate;
				if (end < 0) return;
				const separator = boundary >= 0 ? 4 : 2;
				const header = this.buffer.subarray(0, end).toString("ascii");
				const match = /^Content-Length:\s*(\d+)$/im.exec(header);
				if (!match) throw error("protocol-error", "invalid Content-Length header");
				const length = Number(match[1]);
				if (!Number.isSafeInteger(length) || length > this.maxBytes)
					throw error("message-too-large", "OpenDesign frame exceeded the byte cap");
				if (this.buffer.length < end + separator + length) return;
				const body = this.buffer.subarray(
					end + separator,
					end + separator + length,
				);
				this.buffer = this.buffer.subarray(end + separator + length);
				this.emit(body);
				continue;
			}
			const newline = this.buffer.indexOf(10);
			if (newline < 0) return;
			const body = this.buffer
				.subarray(0, newline)
				.toString("utf8")
				.replace(/\r$/, "")
				.trim();
			this.buffer = this.buffer.subarray(newline + 1);
			if (body) this.emit(Buffer.from(body));
		}
	}

	emit(body) {
		try {
			this.onMessage(JSON.parse(body.toString("utf8")));
		} catch (cause) {
			if (cause instanceof OpenDesignError) throw cause;
			throw error("protocol-error", "OpenDesign emitted malformed JSON", {
				cause: String(cause),
			});
		}
	}
}

export class OpenDesignClient {
	constructor(command, options = {}) {
		this.command = command;
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.maxMessageBytes = options.maxMessageBytes ?? MAX_MESSAGE_BYTES;
		this.nextId = 1;
		this.pending = new Map();
		this.stderr = "";
		this.tools = new Set();
		this.closed = false;
		this.abortSignal = options.signal;
	}

	async connect() {
		if (this.child) return this;
		const env = { ...process.env, ...(this.command.env ?? {}) };
		this.child = spawn(this.command.command, this.command.args ?? [], {
			stdio: ["pipe", "pipe", "pipe"],
			shell: false,
			windowsHide: true,
			env,
		});
		this.child.stdin.on("error", (cause) => {
			if (!this.closed)
				this.failAll(
					error("process-exit", "OpenDesign stdin closed unexpectedly", {
						cause: String(cause),
					}),
				);
		});
		const decoder = new FrameDecoder(
			(message) => this.handleMessage(message),
			this.maxMessageBytes,
		);
		this.child.stdout.on("data", (chunk) => {
			try {
				decoder.push(chunk);
			} catch (failure) {
				this.failAll(failure);
				this.close();
			}
		});
		this.child.stderr.on("data", (chunk) => {
			this.stderr = redactOpenDesignText(
				`${this.stderr}${chunk.toString("utf8")}`,
			);
		});
		this.child.once("error", (cause) =>
			this.failAll(
				error("spawn-failed", "Could not start OpenDesign", {
					cause: String(cause),
				}),
			),
		);
		this.child.once("exit", (code, signal) => {
			if (!this.closed)
				this.failAll(
					error("process-exit", `OpenDesign exited before completing the request`, {
						code,
						signal,
						stderr: this.stderr,
					}),
				);
		});
		if (this.abortSignal) {
			if (this.abortSignal.aborted)
				throw error("canceled", "OpenDesign action canceled");
			this.abortHandler = () => {
				this.failAll(error("canceled", "OpenDesign action canceled"));
				this.close();
			};
			this.abortSignal.addEventListener("abort", this.abortHandler, {
				once: true,
			});
		}
		const initialized = await this.request("initialize", {
			protocolVersion: "2025-03-26",
			capabilities: {},
			clientInfo: { name: "ce-workflow", version: "1" },
		});
		const serverName = initialized?.serverInfo?.name;
		if (
			typeof serverName !== "string" ||
			!/^open[- ]?design$/i.test(serverName)
		) {
			throw error(
				"identity-mismatch",
				`Expected OpenDesign MCP server, received ${serverName ?? "unknown"}`,
			);
		}
		this.notify("notifications/initialized", {});
		const listed = await this.request("tools/list", {});
		if (!Array.isArray(listed?.tools))
			throw error("protocol-error", "OpenDesign tools/list returned no tools");
		this.tools = new Set(
			listed.tools
				.map((tool) => tool?.name)
				.filter((name) => typeof name === "string"),
		);
		return this;
	}

	handleMessage(message) {
		if (!plainObject(message) || message.jsonrpc !== "2.0")
			throw error("protocol-error", "invalid JSON-RPC message");
		if (message.id == null) return;
		const pending = this.pending.get(message.id);
		if (!pending) return;
		this.pending.delete(message.id);
		clearTimeout(pending.timer);
		if (message.error)
			pending.reject(
				error(
					"rpc-error",
					redactOpenDesignText(
						message.error.message ?? "OpenDesign RPC failed",
						2_000,
					),
					{ code: message.error.code },
				),
			);
		else pending.resolve(message.result);
	}

	request(method, params) {
		if (!this.child?.stdin?.writable)
			return Promise.reject(
				error("process-exit", "OpenDesign stdin is unavailable"),
			);
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(
					error("timeout", `OpenDesign ${method} timed out`, {
						stderr: this.stderr,
					}),
				);
				this.close();
			}, this.timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			this.child.stdin.write(
				`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
			);
		});
	}

	notify(method, params) {
		this.child.stdin.write(
			`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
		);
	}

	async callTool(name, args = {}) {
		if (!this.tools.has(name))
			throw error("tool-missing", `OpenDesign tool is unavailable: ${name}`);
		if (![...READ_TOOLS, ...WRITE_TOOLS].includes(name))
			throw error("tool-forbidden", `OpenDesign tool is not allowlisted: ${name}`);
		assertNoCredentials(args, `${name} arguments`);
		return decodeToolResult(
			await this.request("tools/call", { name, arguments: args }),
		);
	}

	failAll(failure) {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(failure);
		}
		this.pending.clear();
	}

	close() {
		if (this.closed) return;
		this.closed = true;
		this.abortSignal?.removeEventListener?.("abort", this.abortHandler);
		this.child?.stdin?.end();
		if (this.child && !this.child.killed) this.child.kill();
	}
}

export async function callOpenDesignTool(options) {
	const tool = safeToken(options.tool, "tool", 100);
	if (!READ_TOOLS.has(tool) && !WRITE_TOOLS.has(tool))
		throw error("tool-forbidden", `unsupported OpenDesign tool ${tool}`);
	const attempts = READ_TOOLS.has(tool) && options.retryRead !== false ? 2 : 1;
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const command = options.command ?? resolveOpenDesignCommand(options);
		const client = new OpenDesignClient(command, options);
		try {
			await client.connect();
			return await client.callTool(tool, options.args ?? {});
		} catch (failure) {
			lastError = failure;
			if (
				attempt >= attempts ||
				!["timeout", "process-exit", "spawn-failed", "protocol-error"].includes(
					failure?.category,
				)
			)
				throw failure;
		} finally {
			client.close();
		}
	}
	throw lastError;
}

export async function reconcileCreatedProject(options) {
	try {
		return await callOpenDesignTool({
			...options,
			tool: "create_project",
			args: options.createArgs,
			retryRead: false,
		});
	} catch (failure) {
		if (
			!options.projectId ||
			!["timeout", "process-exit", "protocol-error"].includes(failure?.category)
		)
			throw failure;
		return callOpenDesignTool({
			...options,
			tool: "get_project",
			args: { project: options.projectId },
		});
	}
}
