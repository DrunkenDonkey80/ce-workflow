import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";

const READ_TOOLS = new Set([
	"collect_brief",
	"get_project",
	"get_run",
	"list_files",
	"get_artifact",
	"get_file",
]);
const WRITE_TOOLS = new Set([
	"create_project",
	"write_file",
	"start_run",
	"cancel_run",
]);
const MAX_MESSAGE_BYTES = 1_000_000;
const MAX_REFERENCE_BYTES = 700_000;
const MAX_STDERR_BYTES = 32_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const persistentClients = new Map();
const registeredDaemonUrls = new Map();
let persistentCleanupRegistered = false;

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

function traceOpenDesign(event, details = {}, env = process.env) {
	const traceFile = env.WORK_ORCH_OPENDESIGN_TRACE_FILE;
	if (!traceFile || !path.isAbsolute(traceFile)) return;
	try {
		fs.appendFileSync(
			traceFile,
			`${JSON.stringify({ at: new Date().toISOString(), event, pid: process.pid, ...details })}\n`,
		);
	} catch {}
}

function discoverRegisteredDaemonUrl(socketPath, timeoutMs = 5_000) {
	if (!socketPath) return Promise.resolve("");
	return new Promise((resolve) => {
		const socket = createConnection(socketPath);
		let buffer = "";
		let settled = false;
		const finish = (url = "") => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			socket.destroy();
			resolve(url);
		};
		const timeout = setTimeout(() => finish(), timeoutMs);
		socket.once("connect", () =>
			socket.write(`${JSON.stringify({ type: "status" })}\n`),
		);
		socket.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			try {
				const response = JSON.parse(buffer.slice(0, newline));
				const url = new URL(response?.ok ? response.result?.url : "");
				if (
					url.protocol === "http:" &&
					["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
					url.port &&
					url.pathname === "/" &&
					!url.username &&
					!url.password &&
					!url.search &&
					!url.hash
				)
					finish(url.origin);
				else finish();
			} catch {
				finish();
			}
		});
		socket.once("error", () => finish());
		socket.once("end", () => finish());
	});
}

function parseBootstrapArgs(value) {
	try {
		const args = JSON.parse(value ?? "");
		return Array.isArray(args) &&
			args.every((arg) => typeof arg === "string") &&
			args.includes("--headless")
			? args
			: null;
	} catch {
		return null;
	}
}

async function bootstrapRegisteredDaemon(env, ipcPath) {
	const command = env.OD_MCP_BOOTSTRAP_COMMAND;
	const args = parseBootstrapArgs(env.OD_MCP_BOOTSTRAP_ARGS);
	if (
		!path.isAbsolute(command ?? "") ||
		!verifyExecutable(command, process.platform) ||
		!args
	)
		return "";
	const bootstrapEnv = { ...env };
	delete bootstrapEnv.ELECTRON_RUN_AS_NODE;
	delete bootstrapEnv.OD_DAEMON_URL;
	for (const key of Object.keys(bootstrapEnv))
		if (key.startsWith("OD_SIDECAR_")) delete bootstrapEnv[key];
	// nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- installed executable and fixed --headless args are validated above.
	const child = spawn(command, args, {
		detached: true,
		env: bootstrapEnv,
		stdio: "ignore",
		windowsHide: true,
	});
	await new Promise((resolve, reject) => {
		child.once("spawn", resolve);
		child.once("error", reject);
	});
	child.unref();
	traceOpenDesign(
		"daemon.bootstrap",
		{ bootstrapPid: child.pid ?? null, ipcPath },
		env,
	);
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 250));
		const daemonUrl = await discoverRegisteredDaemonUrl(ipcPath, 500);
		if (daemonUrl) return daemonUrl;
	}
	throw error(
		"daemon-unavailable",
		"OpenDesign was launched headlessly but did not register its daemon URL.",
	);
}

function explicitDaemonArgs(command, daemonUrl) {
	const args = [...(command.args ?? [])];
	if (!daemonUrl || !command.env?.OD_MCP_BOOTSTRAP_COMMAND) return args;
	if (
		args.some((arg) => arg === "--daemon-url" || arg.startsWith("--daemon-url="))
	)
		return args;
	return [...args, "--daemon-url", daemonUrl];
}

export function validateOpenDesignToolCall(name, args = {}) {
	if (![...READ_TOOLS, ...WRITE_TOOLS].includes(name))
		throw error("tool-forbidden", `OpenDesign tool is not allowlisted: ${name}`);
	if (!plainObject(args))
		throw error("invalid-input", `${name} arguments must be an object`);
	assertNoCredentials(args, `${name} arguments`);
	if (name === "collect_brief") {
		const artifactType = safeToken(args.artifactType, "artifactType", 80);
		if (!/^[a-z][a-z0-9-]*$/i.test(artifactType))
			throw error("invalid-input", "artifactType is invalid");
	}
	if (name === "write_file") {
		safeToken(args.project, "project", 128);
		const file = safeToken(args.path, "path", 128);
		if (!/^references\/[a-f0-9]{64}\.(?:png|jpe?g|webp)$/i.test(file))
			throw error("invalid-input", "write_file is confined to hashed references");
		if (args.encoding !== "base64" || typeof args.content !== "string")
			throw error("invalid-input", "write_file requires base64 content");
		if (
			!args.content ||
			args.content.length % 4 !== 0 ||
			!/^[A-Za-z0-9+/]+={0,2}$/.test(args.content)
		)
			throw error("invalid-input", "write_file content is not valid base64");
		const bytes = Buffer.from(args.content, "base64");
		if (bytes.length > MAX_REFERENCE_BYTES)
			throw error("invalid-input", "reference image is too large");
		const expectedHash = path.posix.basename(file).split(".")[0];
		if (crypto.createHash("sha256").update(bytes).digest("hex") !== expectedHash)
			throw error("invalid-input", "reference image hash does not match its path");
	}
	return args;
}

export function redactOpenDesignText(value, max = MAX_STDERR_BYTES) {
	return String(value ?? "")
		.replace(/([?&](?:token|key|code|secret)=)[^&\s]+/gi, "$1[REDACTED]")
		.replace(/\b(?:sk|od|Bearer)[-_ ][A-Za-z0-9._-]{12,}\b/gi, "[REDACTED]")
		.replace(
			/("?(?:api[_-]?key|access[_-]?token|token|password|secret)"?\s*[:=]\s*)[^,\s}]+/gi,
			"$1[REDACTED]",
		)
		.slice(-max);
}

export function normalizeOpenDesignUrl(value) {
	const text = String(value ?? "")
		.trim()
		.slice(0, 2_000);
	if (!text) return "";
	try {
		const url = new URL(text);
		return ["http:", "https:"].includes(url.protocol) &&
			!url.username &&
			!url.password
			? text
			: "";
	} catch {
		return "";
	}
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

function discoverWindowsOpenDesign(env) {
	const appData =
		env.APPDATA ||
		(env.USERPROFILE ? path.join(env.USERPROFILE, "AppData", "Roaming") : "");
	if (!appData) return null;
	const root = path.join(appData, "Open Design");
	const aliases = path.join(root, "en");
	let entries = [];
	try {
		entries = fs.readdirSync(aliases);
	} catch {
		return null;
	}
	for (const entry of entries) {
		const activeRoot = path.join(aliases, entry);
		const command = path.join(activeRoot, "Open Design.exe");
		const cli = path.join(
			activeRoot,
			"resources",
			"app",
			"prebundled",
			"daemon",
			"daemon-cli.mjs",
		);
		const configFile = path.join(
			activeRoot,
			"resources",
			"open-design-config.json",
		);
		if (!verifyExecutable(command, "win32") || !fs.existsSync(cli)) continue;
		let namespace;
		try {
			namespace = JSON.parse(fs.readFileSync(configFile, "utf8")).namespace;
		} catch {
			continue;
		}
		if (!/^[A-Za-z0-9._-]+$/.test(namespace)) continue;
		let bootstrap = command;
		const channels = path.join(root, "launcher", "channels");
		try {
			for (const channel of fs.readdirSync(channels)) {
				const installFile = path.join(
					channels,
					channel,
					"namespaces",
					namespace,
					"install.json",
				);
				try {
					const launchPath = JSON.parse(
						fs.readFileSync(installFile, "utf8"),
					).launchPath;
					if (verifyExecutable(launchPath, "win32")) bootstrap = launchPath;
				} catch {}
			}
		} catch {}
		return {
			command,
			args: [cli, "mcp"],
			env: {
				OD_DATA_DIR: path.join(root, "namespaces", namespace, "data"),
				OD_SIDECAR_IPC_PATH: `\\\\.\\pipe\\open-design-${namespace}-daemon`,
				OD_MCP_BOOTSTRAP_COMMAND: bootstrap,
				OD_MCP_BOOTSTRAP_ARGS: "[]",
				ELECTRON_RUN_AS_NODE: "1",
			},
		};
	}
	return null;
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
		const installed =
			platform === "win32" ? discoverWindowsOpenDesign(env) : null;
		if (installed) {
			spec = installed;
			source = "installed";
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
	const normalizedResolved = path.resolve(resolved).replaceAll("\\", "/");
	if (
		(platform === "darwin" && normalizedResolved === "/usr/bin/od") ||
		(platform === "win32" &&
			/(?:\/Git\/usr\/bin|\/msys64\/usr\/bin|\/cygwin(?:64)?\/bin)\/od\.exe$/i.test(
				normalizedResolved,
			))
	) {
		throw error(
			"executable-collision",
			`${resolved} is an octal-dump utility, not OpenDesign; copy the OpenDesign Settings MCP command spec`,
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
		this.sandboxCwd = options.sandboxCwd;
	}

	async connect() {
		if (this.child) return this;
		const env = { ...process.env, ...(this.command.env ?? {}) };
		const ipcPath = env.OD_SIDECAR_IPC_PATH ?? "";
		let daemonUrlSource = env.OD_DAEMON_URL ? "explicit" : "";
		if (!env.OD_DAEMON_URL && ipcPath) {
			const cached = registeredDaemonUrls.get(ipcPath);
			const daemonUrl =
				cached ?? (await discoverRegisteredDaemonUrl(ipcPath, 800));
			if (daemonUrl) {
				env.OD_DAEMON_URL = daemonUrl;
				registeredDaemonUrls.set(ipcPath, daemonUrl);
				daemonUrlSource = cached ? "cache" : "ipc-before-spawn";
			}
		}
		if (
			!env.OD_DAEMON_URL &&
			ipcPath &&
			this.command.source === "installed" &&
			env.OD_MCP_BOOTSTRAP_COMMAND
		) {
			const daemonUrl = await bootstrapRegisteredDaemon(env, ipcPath);
			if (!daemonUrl)
				throw error(
					"daemon-unavailable",
					"The packaged OpenDesign runtime cannot be launched safely.",
				);
			env.OD_DAEMON_URL = daemonUrl;
			registeredDaemonUrls.set(ipcPath, daemonUrl);
			daemonUrlSource = "bootstrap-before-mcp";
		}
		const commandArgs = explicitDaemonArgs(this.command, env.OD_DAEMON_URL);
		traceOpenDesign(
			"connect.plan",
			{
				command: this.command.command,
				daemonUrl: env.OD_DAEMON_URL ?? "",
				daemonUrlSource: daemonUrlSource || "bootstrap",
				ipcPath,
			},
			env,
		);
		if (this.sandboxCwd) {
			env.PWD = this.sandboxCwd;
			delete env.OLDPWD;
			delete env.INIT_CWD;
		}
		this.child = spawn(this.command.command, commandArgs, {
			stdio: ["pipe", "pipe", "pipe"],
			shell: false,
			windowsHide: true,
			cwd: this.sandboxCwd,
			env,
		});
		traceOpenDesign("connect.spawn", { childPid: this.child.pid ?? null }, env);
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
			traceOpenDesign(
				"connect.exit",
				{ childPid: this.child?.pid ?? null, closed: this.closed, code, signal },
				env,
			);
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
		if (ipcPath && !registeredDaemonUrls.has(ipcPath)) {
			const registeredUrl = await discoverRegisteredDaemonUrl(ipcPath);
			if (registeredUrl) registeredDaemonUrls.set(ipcPath, registeredUrl);
		}
		traceOpenDesign(
			"connect.ready",
			{
				childPid: this.child.pid ?? null,
				ipcPath,
				registeredDaemonUrl: registeredDaemonUrls.get(ipcPath) ?? "",
			},
			env,
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
		validateOpenDesignToolCall(name, args);
		const result = decodeToolResult(
			await this.request("tools/call", { name, arguments: args }),
		);
		if (name !== "get_run" || !plainObject(result)) return result;
		return {
			...result,
			previewUrl: normalizeOpenDesignUrl(result.previewUrl),
			studioUrl: normalizeOpenDesignUrl(result.studioUrl),
			agentMessage: redactOpenDesignText(result.agentMessage, 4_000),
		};
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

function persistentClientKey(command, options) {
	return JSON.stringify(
		canonical({
			command,
			maxMessageBytes: options.maxMessageBytes ?? MAX_MESSAGE_BYTES,
			sandboxCwd: options.sandboxCwd ?? "",
			timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		}),
	);
}

function releasePersistentClient(key, entry) {
	if (persistentClients.get(key) === entry) persistentClients.delete(key);
	entry.client.close();
	if (entry.ownsSandbox)
		fs.rm(
			entry.sandboxCwd,
			{ recursive: true, force: true, maxRetries: 5, retryDelay: 50 },
			() => {},
		);
}

async function persistentOpenDesignClient(command, options) {
	const key = persistentClientKey(command, options);
	const keyDigest = crypto
		.createHash("sha256")
		.update(key)
		.digest("hex")
		.slice(0, 12);
	let entry = persistentClients.get(key);
	traceOpenDesign("persistent.lookup", {
		childPid: entry?.client?.child?.pid ?? null,
		hit: Boolean(entry),
		keyDigest,
	});
	if (!entry) {
		const ownsSandbox = !options.sandboxCwd;
		const sandboxCwd =
			options.sandboxCwd ??
			fs.mkdtempSync(path.join(os.tmpdir(), "ce-opendesign-"));
		const client = new OpenDesignClient(command, {
			...options,
			signal: undefined,
			sandboxCwd,
		});
		entry = { client, ownsSandbox, sandboxCwd };
		entry.ready = client.connect().catch((failure) => {
			releasePersistentClient(key, entry);
			throw failure;
		});
		persistentClients.set(key, entry);
		traceOpenDesign("persistent.created", {
			childPid: client.child?.pid ?? null,
			keyDigest,
		});
		if (!persistentCleanupRegistered) {
			persistentCleanupRegistered = true;
			process.once("exit", closePersistentOpenDesignClients);
		}
	}
	await entry.ready;
	return { entry, key };
}

export function closePersistentOpenDesignClients() {
	for (const [key, entry] of persistentClients)
		releasePersistentClient(key, entry);
	persistentClients.clear();
}

export async function callOpenDesignTool(options) {
	const tool = safeToken(options.tool, "tool", 100);
	if (!READ_TOOLS.has(tool) && !WRITE_TOOLS.has(tool))
		throw error("tool-forbidden", `unsupported OpenDesign tool ${tool}`);
	const attempts = READ_TOOLS.has(tool) && options.retryRead !== false ? 2 : 1;
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const command = options.command ?? resolveOpenDesignCommand(options);
		const persistent = options.keepAlive === true;
		const ownsSandbox = !options.sandboxCwd;
		const sandboxCwd = persistent
			? undefined
			: (options.sandboxCwd ??
				fs.mkdtempSync(path.join(os.tmpdir(), "ce-opendesign-")));
		let client;
		let persistentEntry;
		let persistentKey;
		try {
			if (persistent) {
				const acquired = await persistentOpenDesignClient(command, options);
				client = acquired.entry.client;
				persistentEntry = acquired.entry;
				persistentKey = acquired.key;
			} else {
				client = new OpenDesignClient(command, { ...options, sandboxCwd });
				await client.connect();
			}
			return await client.callTool(tool, options.args ?? {});
		} catch (failure) {
			lastError = failure;
			const transportFailure = [
				"timeout",
				"process-exit",
				"spawn-failed",
				"protocol-error",
			].includes(failure?.category);
			if (persistentEntry && transportFailure)
				releasePersistentClient(persistentKey, persistentEntry);
			if (attempt >= attempts || !transportFailure) throw failure;
		} finally {
			if (!persistent) {
				client?.close();
				if (ownsSandbox)
					fs.rm(
						sandboxCwd,
						{ recursive: true, force: true, maxRetries: 5, retryDelay: 50 },
						() => {},
					);
			}
		}
	}
	throw lastError;
}

export async function reconcileCreatedProject(options) {
	const callTool = options.callTool
		? (tool, args) => options.callTool(tool, args)
		: (tool, args) =>
				callOpenDesignTool({ ...options, tool, args, retryRead: false });
	try {
		return await callTool("create_project", options.createArgs);
	} catch (failure) {
		if (
			!options.projectId ||
			!["timeout", "process-exit", "protocol-error", "tool-failed"].includes(
				failure?.category,
			)
		)
			throw failure;
		return options.callTool
			? options.callTool("get_project", { project: options.projectId })
			: callOpenDesignTool({
					...options,
					tool: "get_project",
					args: { project: options.projectId },
				});
	}
}
