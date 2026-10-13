import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import { diagramChatMessage, type Diagram } from "./plan3-diagram.ts";
import { raceRemoteAsk, remoteResponse, remoteBatch, type RemoteListPrompt } from "./ask-user/remote.ts";
import { bindListDialogBridge, listDialogResponse } from "./work-dialogs.ts";

export type WebTarget = { kind: "product" } | { kind: "plan"; id: string };
type Options = {
	snapshot: (target: WebTarget) => unknown | Promise<unknown>;
	post?: (endpoint: string, body: Record<string, unknown>) => unknown | Promise<unknown>;
};
const BODY_BYTES = 65_536;
export class WebError extends Error {
	status: number;
	constructor(status: number, message: string) { super(message); this.status = status; }
}
export function webTarget(value: unknown): WebTarget {
	if (value === "product") return { kind: "product" };
	if (typeof value === "string" && /^[a-f0-9]{8}$/.test(value)) return { kind: "plan", id: value };
	throw new WebError(400, "Name the displayed stable plan id or product target.");
}
function body(req: IncomingMessage): Promise<Record<string, unknown>> {
	if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") throw new WebError(415, "JSON content type required.");
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let bytes = 0;
		const cleanup = () => { req.off("data", data); req.off("end", end); req.off("error", fail); req.off("aborted", aborted); };
		const fail = (error: Error) => { cleanup(); reject(error); req.resume(); };
		const aborted = () => fail(new WebError(400, "Request aborted."));
		const data = (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > BODY_BYTES) return fail(new WebError(413, "Request body too large."));
			chunks.push(chunk);
		};
		const end = () => {
			cleanup();
			try {
				const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
				resolve(value);
			} catch { reject(new WebError(400, "Invalid JSON object.")); }
		};
		req.on("data", data); req.once("end", end); req.once("error", fail); req.once("aborted", aborted);
	});
}

/** One instance per Pi session; the command owner reuses it and closes it on session_shutdown. */
export async function createPlan3Web(options: Options) {
	const token = randomBytes(32).toString("hex"), clients = new Map<ServerResponse, { ready: boolean; frames: string[]; bytes: number }>();
	let origin = "", sequence = 0, closed = false;
	const valid = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
	const json = (res: ServerResponse, status: number, value: unknown) => {
		res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(value));
	};
	const frame = (event: string, value: unknown, id = ++sequence) => `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
	const send = (res: ServerResponse, data: string) => {
		res.write(data);
		if (res.writableLength > 8_000_000) { clients.delete(res); res.destroy(); }
	};
	const assets = new Map([
		["/", ["index.html", "text/html; charset=utf-8"]],
		["/app.js", ["app.ts", "text/javascript; charset=utf-8"]],
		["/layout.js", ["layout.ts", "text/javascript; charset=utf-8"]],
		["/diagram.js", ["diagram.ts", "text/javascript; charset=utf-8"]],
		["/prompts.js", ["prompts.ts", "text/javascript; charset=utf-8"]],
		["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
		["/vendor/rough.js", ["vendor/rough.ts", "text/javascript; charset=utf-8"]],
		["/vendor/Virgil.woff2", ["vendor/Virgil.woff2", "font/woff2"]],
	]);
	const endpoints = new Set(["/api/message", "/api/answer", "/api/comment", "/api/move", "/api/command", "/api/stop"]);
	const server = createServer((req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("Referrer-Policy", "no-referrer");
		res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
		void (async () => {
			if (closed) throw new WebError(503, "Workspace closed.");
			if (req.headers.host !== origin.slice("http://".length)) throw new WebError(403, "Foreign Host rejected.");
			if (req.headers.origin !== undefined && req.headers.origin !== origin || req.method === "POST" && req.headers.origin !== origin) throw new WebError(403, "Foreign or missing Origin rejected.");
			if (!req.url || req.url.length > 2048) throw new WebError(414, "Request URL too long.");
			const url = new URL(req.url, origin);
			if (url.origin !== origin) throw new WebError(403, "Foreign request URL rejected.");
			// Cookies cross localhost ports; use an explicit token, never ambient browser credentials.
			if (![req.headers.authorization?.replace(/^Bearer /, ""), url.searchParams.get("token")].some(valid)) throw new WebError(401, "Workspace token required.");
			if (req.method === "GET" && url.pathname === "/api/snapshot") return json(res, 200, await options.snapshot(webTarget(url.searchParams.get("target"))));
			if (req.method === "GET" && url.pathname === "/api/events") {
				if (clients.size >= 8) throw new WebError(429, "Too many workspace connections.");
				const target = webTarget(url.searchParams.get("target")), fence = ++sequence;
				const connection = { ready: false, frames: [] as string[], bytes: 0 };
				clients.set(res, connection); res.on("close", () => clients.delete(res));
				// Subscribe before an async snapshot so changes during initial load cannot disappear.
				const snapshot = await options.snapshot(target), initial = frame("snapshot", snapshot, fence);
				if (closed || res.destroyed) return;
				if (Buffer.byteLength(initial) > 4_000_000) throw new WebError(413, "Workspace snapshot too large.");
				res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive", "X-Accel-Buffering": "no" });
				send(res, initial);
				connection.ready = true;
				for (const queued of connection.frames) send(res, queued);
				connection.frames = []; connection.bytes = 0;
				return;
			}
			if (req.method === "POST") {
				if (!endpoints.has(url.pathname)) throw new WebError(404, "Unknown workspace endpoint.");
				if (!options.post) throw new WebError(501, "Session bridge is not attached.");
				return json(res, 200, await options.post(url.pathname, await body(req)));
			}
			if (req.method !== "GET") throw new WebError(405, "Method not allowed.");
			const asset = assets.get(url.pathname);
			if (!asset) throw new WebError(404, "Unknown workspace asset.");
			let contents: Buffer;
			try { contents = readFileSync(fileURLToPath(new URL(`./plan3-web/${asset[0]}`, import.meta.url))); }
			catch { throw new WebError(404, "Workspace asset is not installed."); }
			res.writeHead(200, { "Content-Type": asset[1] });
			res.end(asset[1].startsWith("font/") ? contents : (asset[0].endsWith(".ts") ? stripTypeScriptTypes(contents.toString("utf8")) : contents.toString("utf8")).replaceAll("__TOKEN__", token));
		})().catch(error => {
			clients.delete(res);
			if (res.destroyed || res.writableEnded) return;
			if (res.headersSent) { res.end(); return; }
			json(res, error instanceof WebError ? error.status : 500, { error: error instanceof Error ? error.message.replaceAll(token, "[token]") : "Workspace request failed." });
		});
	});
	server.requestTimeout = 15_000; server.headersTimeout = 10_000;
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Workspace did not bind a TCP port.");
	origin = `http://127.0.0.1:${address.port}`;
	const heartbeat = setInterval(() => { for (const [res, connection] of clients) if (connection.ready) send(res, ": keepalive\n\n"); }, 15_000);
	heartbeat.unref();
	let closing: Promise<void> | undefined;
	return {
		origin,
		url: (target: WebTarget) => `${origin}/?token=${token}&target=${target.kind === "product" ? "product" : target.id}`,
		publish(event: string, value: unknown) {
			if (closed) return;
			if (!/^[a-z][a-z0-9_-]{0,40}$/.test(event)) throw new Error("Invalid workspace event name.");
			const data = frame(event, value);
			if (Buffer.byteLength(data) > 1_100_000) throw new Error("Workspace event too large.");
			for (const [res, connection] of clients) {
				if (connection.ready) send(res, data);
				else {
					connection.frames.push(data); connection.bytes += Buffer.byteLength(data);
					if (connection.bytes > 8_000_000) { clients.delete(res); res.destroy(); }
				}
			}
		},
		close() {
			if (closing) return closing;
			closed = true; clearInterval(heartbeat);
			for (const res of clients.keys()) res.end(); clients.clear();
			closing = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
			server.closeIdleConnections(); server.closeAllConnections();
			return closing;
		},
	};
}

type ChatRow = { id: string; role: string; text: string; streaming: boolean; truncated?: boolean; error?: string };
export function createChatMirror(pi, publish: (event: string, data: unknown) => void) {
	const rows: ChatRow[] = [], active = new Map<string, string>();
	let next = 0;
	const put = (message, streaming: boolean, emit = true, start = false) => {
		if (!["user", "assistant"].includes(message?.role)) return;
		const role = message.role;
		const base = typeof message.timestamp === "number" ? `${role}_${message.timestamp}` : `${role}_${++next}`;
		let id = active.get(role) ?? base;
		if (start) {
			id = base;
			for (let suffix = 2; rows.some(row => row.id === id); suffix++) id = `${base}_${suffix}`;
		}
		active.set(role, id);
		const content = typeof message.content === "string" ? message.content : (Array.isArray(message.content) ? message.content.map(part => part?.type === "text" && typeof part.text === "string" ? part.text : part?.type === "image" ? "[image]" : "").join("\n") : "");
		// shortcut: keep 100 recent rows / 512 KB; each row is capped at 64k chars, show truncation in the UI.
		const row: ChatRow = { id, role, text: content.slice(0, 64_000), streaming, ...(content.length > 64_000 ? { truncated: true } : {}), ...(typeof message.errorMessage === "string" ? { error: message.errorMessage.slice(0, 4000) } : {}) };
		const index = rows.findIndex(item => item.id === id);
		if (index < 0) rows.push(row); else rows[index] = row;
		while (rows.length > 100 || Buffer.byteLength(JSON.stringify(rows)) > 512_000) rows.shift();
		if (emit) publish("message", row);
		if (!streaming) active.delete(role);
	};
	pi.on("input", event => { publish("input", { text: typeof event.text === "string" ? event.text.slice(0, 64_000) : "", source: event.source, streamingBehavior: event.streamingBehavior }); });
	pi.on("message_start", event => put(event.message, true, true, true));
	pi.on("message_update", event => put(event.message, true));
	pi.on("message_end", event => put(event.message, false));
	return {
		snapshot: () => structuredClone(rows),
		reset: () => { rows.length = 0; active.clear(); next = 0; },
		hydrate(ctx) {
			const live = structuredClone(rows);
			rows.length = 0;
			for (const entry of (ctx.sessionManager?.getBranch?.() ?? []).filter(entry => entry.type === "message").slice(-100)) put(entry.message, false, false, true);
			for (const row of live) {
				const index = rows.findIndex(item => item.id === row.id);
				if (index < 0) rows.push(row); else rows[index] = row;
			}
			while (rows.length > 100 || Buffer.byteLength(JSON.stringify(rows)) > 512_000) rows.shift();
			active.clear();
			for (const row of rows) if (row.streaming) active.set(row.role, row.id);
		},
	};
}

export async function stopLiveRun(ctx) {
	if (ctx.isIdle()) throw new WebError(409, "No running agent to stop.");
	await ctx.abort();
	return { accepted: true };
}

export function forwardDiagramChat(pi, ctx, diagram: Diagram, message: unknown, comments: unknown, publish: (event: string, value: unknown) => void) {
	const prepared = diagramChatMessage(diagram, message, comments), queued = !ctx.isIdle();
	try {
		const pending = pi.sendUserMessage(prepared.message, { expandPromptTemplates: false, ...(queued ? { deliverAs: "followUp" } : {}) });
		// SDK declaration says void, but live probe found a promise that settles only after the run.
		void Promise.resolve(pending).catch(error => publish("error", { message: `Message not delivered: ${error instanceof Error ? error.message : String(error)}` }));
	} catch (error) {
		publish("error", { message: `Message not delivered: ${error instanceof Error ? error.message : String(error)}` });
		throw error;
	}
	return { queued, mentions: prepared.mentions, unknownMentions: prepared.unknownMentions };
}

export function createDialogBridge(pi, publish: (event: string, value: unknown) => void) {
	const pending = new Map(), bound = new Set(), shutdown = new AbortController();
	const disposers = [
		pi.events.on("ask:pending", ask => {
			if (typeof ask?.askId !== "string" || !/^[a-f0-9-]{36}$/.test(ask.askId)) return;
			if (ask.kind === "list" ? !Array.isArray(ask.items) : !Array.isArray(ask.questions) && typeof ask.question !== "string") return;
			pending.set(ask.askId, structuredClone(ask)); publish("dialog", ask);
		}),
		pi.events.on("ask:closed", ({ askId }) => { if (pending.delete(askId)) publish("dialog_closed", { askId }); }),
	];
	return {
		snapshot: () => structuredClone([...pending.values()]),
		answer(value: Record<string, unknown>) {
			if (typeof value.askId !== "string" || !/^[a-f0-9-]{36}$/.test(value.askId)) throw new WebError(400, "Invalid dialog id.");
			const ask = pending.get(value.askId);
			if (!ask) return { accepted: false, closed: true };
			const decoded = value.cancel === true ? null : ask.kind === "list" ? listDialogResponse(value, ask) : ask.questions ? remoteBatch(value, ask.questions, ask.allowComment) : remoteResponse(value, ask, ask.allowComment);
			if (decoded === undefined) throw new WebError(400, "Invalid dialog answer.");
			pi.events.emit("ask:answer", value);
			if (pending.delete(value.askId)) publish("dialog_closed", { askId: value.askId });
			return { accepted: true, closed: true };
		},
		bind(ctx) {
			bound.add(ctx.ui);
			bindListDialogBridge(ctx, (options, run) => {
				const subject: RemoteListPrompt = {
					kind: "list", title: options.title, purpose: options.purpose ?? (options.multi ? "Choose one or more options." : "Choose an option to continue."),
					items: options.items.map(item => ({ value: item.value, label: item.label, description: item.description, heading: item.heading, disabled: item.disabled, enabled: item.enabled, rowAction: item.rowAction })),
					currentValue: options.currentValue, ...(options.multi ? { multi: { selected: [...(options.multi.selected ?? [])], requireOne: options.multi.requireOne } } : {}),
					spaceAction: Boolean(options.spaceAction), rowAction: Boolean(options.rowAction), tabAction: Boolean(options.tabAction),
				};
				const signal = options.signal ? AbortSignal.any([options.signal, shutdown.signal]) : shutdown.signal;
				return raceRemoteAsk(pi, subject, signal, undefined, payload => listDialogResponse(payload, options), run);
			});
		},
		close() {
			shutdown.abort(); pending.clear();
			for (const ui of bound) bindListDialogBridge({ ui }, undefined);
			bound.clear(); for (const dispose of disposers) dispose();
		},
	};
}

type ToolActivity = { id: string; name: string; state: string; parent?: string; args?: string; progress?: string; result?: string; startedAt?: number; durationMs?: number };
export function createActivityMirror(pi, publish: (event: string, value: unknown) => void) {
	const tools: ToolActivity[] = [], queued: { id: string; digest: string; text: string; delivery: string }[] = [];
	let working = false, compacting = false, thinking = "", error = "", interrupted = false, sequence = 0;
	const digest = (text: string) => createHash("sha256").update(text).digest("hex");
	const textOf = message => typeof message?.content === "string" ? message.content : (message?.content ?? []).filter(part => part?.type === "text").map(part => part.text).join("\n");
	const brief = (value: unknown) => {
		try {
			const text = typeof value === "string" ? value : JSON.stringify(value, (_key, item) => item?.type === "image" ? { type: "image", note: "Image omitted from activity" } : item) ?? "";
			return text.length > 16_000 ? text.slice(0, 16_000) + "\n… truncated" : text;
		} catch { return "[Unserializable tool data]"; }
	};
	const snapshot = ctx => {
		const hasPendingMessages = ctx?.hasPendingMessages?.();
		if (hasPendingMessages === false) queued.length = 0;
		return { hasPendingMessages, working: ctx?.isIdle ? !ctx.isIdle() : working, compacting, thinking, error, interrupted, queueExact: false, queue: queued.map(({ id, text, delivery }) => ({ id, text, delivery })), tools: structuredClone(tools) };
	};
	const emit = () => publish("activity", snapshot(undefined));
	const tool = (event, patch: Partial<ToolActivity>) => {
		if (typeof event.toolCallId !== "string" || typeof event.toolName !== "string") return;
		const index = tools.findIndex(row => row.id === event.toolCallId);
		const row = { ...(tools[index] ?? { state: "running" }), id: event.toolCallId, name: event.toolName, ...(event.parentToolCallId ? { parent: event.parentToolCallId } : {}), ...patch };
		if (index < 0) tools.push(row); else tools[index] = row;
		// shortcut: latest 50 tool rows / 512 KB, text-only snapshots; native custom renderers stay in the terminal.
		while (tools.length > 50 || Buffer.byteLength(JSON.stringify(tools)) > 512_000) tools.shift();
		emit();
	};
	pi.on("agent_start", () => { working = true; interrupted = false; thinking = ""; error = ""; emit(); });
	pi.on("agent_settled", event => {
		working = false; interrupted = Boolean(event.aborted); queued.length = 0;
		for (const row of tools) if (row.state === "running") row.state = interrupted ? "interrupted" : "settled";
		emit();
	});
	pi.on("message_start", event => {
		if (event.message?.role === "user") {
			const index = queued.findIndex(item => item.digest === digest(textOf(event.message)));
			if (index >= 0) queued.splice(index, 1);
			emit();
		}
	});
	pi.on("message_update", event => {
		if (event.message?.role !== "assistant") return;
		const content = event.message.content ?? [];
		thinking = content.filter(part => part.type === "thinking").map(part => part.thinking ?? "[redacted thinking]").join("\n").slice(0, 64_000);
		if (event.assistantMessageEvent?.type?.startsWith("thinking_")) emit();
	});
	pi.on("message_end", event => { if (event.message?.errorMessage) { error = brief(event.message.errorMessage); emit(); } });
	pi.on("input", event => {
		if (!event.streamingBehavior || typeof event.text !== "string") return;
		queued.push({ id: `queued_${++sequence}`, digest: digest(event.text), text: brief(event.text), delivery: event.streamingBehavior });
		while (queued.length > 100 || Buffer.byteLength(JSON.stringify(queued)) > 512_000) queued.shift();
		emit();
	});
	pi.on("tool_execution_start", event => tool(event, { state: "running", startedAt: Date.now(), args: brief(event.args) }));
	pi.on("tool_execution_update", event => tool(event, { progress: brief(event.partialResult) }));
	pi.on("tool_execution_end", event => {
		const startedAt = tools.find(row => row.id === event.toolCallId)?.startedAt;
		tool(event, { state: event.isError ? "error" : "done", result: brief(event.result), durationMs: event.durationMs ?? (startedAt === undefined ? undefined : Date.now() - startedAt) });
	});
	pi.on("session_before_compact", () => { compacting = true; emit(); });
	pi.on("session_compact", () => { compacting = false; emit(); });
	pi.on("session_compact_failed", event => { compacting = false; error = brief(event.errorMessage ?? (event.aborted ? "Compaction cancelled" : "Compaction failed")); emit(); });
	return { snapshot, reset: () => { tools.length = 0; queued.length = 0; working = false; compacting = false; thinking = ""; error = ""; interrupted = false; sequence = 0; } };
}
