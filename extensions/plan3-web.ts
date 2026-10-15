import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { forbiddenPath } from "./jev-tools.ts";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import { diagramChatMessage, type Diagram } from "./plan3-diagram.ts";
import { raceRemoteAsk, remoteResponse, remoteBatch, type RemoteListPrompt } from "./ask-user/remote.ts";
import { bindListDialogBridge, listDialogResponse } from "./work-dialogs.ts";
import type { SessionSummary } from "./plan3-remote.ts";

export type WebTarget = { kind: "product" } | { kind: "plan"; id: string };
type Options = {
	port?: number;
	token?: string;
	snapshot: (target?: WebTarget) => unknown | Promise<unknown>;
	post?: (endpoint: string, body: Record<string, unknown>) => unknown | Promise<unknown>;
	read?: (endpoint: string, params: URLSearchParams) => unknown | Promise<unknown>;
	/** D8: the tailnet host and owner login once Tailscale serve maps this port. */
	remote?: () => { host?: string; login?: string } | undefined;
	/** D4/D21: whether a `pi_remote` cookie belongs to a paired, unexpired device of this owner. */
	device?: (cookie: string, login: string) => boolean | Promise<boolean>;
	/** D18: switcher list and per-device seen revision; device is the paired id, or "local" for token pages. */
	sessions?: { list(device: string): SessionSummary[]; seen(device: string, revision: number): boolean };
	/** D9/D22: asks the terminal to approve; resolves to the new device cookie, or undefined when declined. */
	pair?: (request: { code: string; label: string; address: string; login: string; signal: AbortSignal }) => Promise<string | undefined>;
	/** Open live pages changed: one paired device id, or "local" for a token page, per connection. */
	viewers?: (ids: string[]) => void;
	/** Project folder: images linked in chat may come from here (minus hidden/secret paths) or the temp folder. */
	root?: () => string | undefined;
};
type Pairing = { id: string; code: string; state: "pending" | "approved" | "denied" | "expired"; cookie?: string; abort: AbortController; waiters: Set<() => void> };
const BODY_BYTES = 65_536, IMAGE_BYTES = 20_000_000;
// Pasted images are checked by magic bytes, not the browser-declared type.
const IMAGE_KINDS: [string, (b: Buffer) => boolean][] = [
	["png", b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
	["jpg", b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
	["gif", b => b.subarray(0, 4).toString("latin1") === "GIF8"],
	["webp", b => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
];
export class WebError extends Error {
	status: number;
	constructor(status: number, message: string) { super(message); this.status = status; }
}
export function webTarget(value: unknown): WebTarget {
	if (value === "product") return { kind: "product" };
	if (typeof value === "string" && /^[a-f0-9]{8}$/.test(value)) return { kind: "plan", id: value };
	throw new WebError(400, "Name the displayed stable plan id or product target.");
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
	if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") throw new WebError(415, "JSON content type required.");
	const raw = await read(req, BODY_BYTES);
	try {
		const value = JSON.parse(raw.toString("utf8"));
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
		return value;
	} catch { throw new WebError(400, "Invalid JSON object."); }
}
/** Saves a pasted clipboard image like Pi's terminal paste does and returns its path for the chat. */
export async function savePastedImage(bytes: Buffer, dir = tmpdir()) {
	const kind = IMAGE_KINDS.find(([, test]) => test(bytes));
	if (!kind) throw new WebError(415, "Paste a PNG, JPEG, GIF or WebP image.");
	const file = join(dir, `pi-clipboard-${randomUUID()}.${kind[0]}`);
	await writeFile(file, bytes, { flag: "wx" });
	return file;
}
/** Serves a pasted image back for chat thumbnails: only Pi's own pi-clipboard-<uuid> temp names, re-checked by magic bytes. */
export async function readPastedImage(name: string | null, dir = tmpdir()) {
	if (!name || !/^pi-clipboard-[0-9a-f-]{36}\.(?:png|jpe?g|gif|webp)$/.test(name)) throw new WebError(400, "Not a pasted image name.");
	const bytes = await readFile(join(dir, name)).catch(() => { throw new WebError(404, "Image no longer available."); });
	const kind = bytes.length <= IMAGE_BYTES && IMAGE_KINDS.find(([, test]) => test(bytes));
	if (!kind) throw new WebError(415, "Not a supported image.");
	return { bytes, type: kind[0] === "jpg" ? "image/jpeg" : "image/" + kind[0] };
}
/** Serves an image linked in chat: a real image file inside the project (not hidden/secret paths) or the temp folder. */
export async function readLinkedImage(path: string | null, project?: string) {
	if (!path || path.length > 1000 || /[\x00-\x1f]/.test(path) || !/\.(?:png|jpe?g|gif|webp)$/i.test(path)) throw new WebError(400, "Not an image path.");
	if (!project && !isAbsolute(path)) throw new WebError(404, "Image not found.");
	const real = await realpath(resolve(project ?? "", path)).catch(() => { throw new WebError(404, "Image not found."); });
	const inside = async (root: string): Promise<string | undefined> => { const rel = relative(await realpath(root), real); return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.replaceAll("\\", "/") : undefined; };
	const fromProject = project ? await inside(project).catch(() => undefined) : undefined;
	if (!(fromProject ? !forbiddenPath.test(fromProject) : await inside(tmpdir()))) throw new WebError(403, "Only project and temp-folder images are shown.");
	if ((await stat(real)).size > IMAGE_BYTES) throw new WebError(413, "Image too large.");
	const bytes = await readFile(real), kind = IMAGE_KINDS.find(([, test]) => test(bytes));
	if (!kind) throw new WebError(415, "Not a supported image.");
	return { bytes, type: kind[0] === "jpg" ? "image/jpeg" : "image/" + kind[0] };
}
// Lax: opening the link from a home-screen icon or another app must send it; POSTs still need a matching Origin.
const deviceCookie = (value: string) => `pi_remote=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7776000`;
function read(req: IncomingMessage, limit: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let bytes = 0;
		const cleanup = () => { req.off("data", data); req.off("end", end); req.off("error", fail); req.off("aborted", aborted); };
		const fail = (error: Error) => { cleanup(); reject(error); req.resume(); };
		const aborted = () => fail(new WebError(400, "Request aborted."));
		const data = (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > limit) return fail(new WebError(413, "Request body too large."));
			chunks.push(chunk);
		};
		const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
		req.on("data", data); req.once("end", end); req.once("error", fail); req.once("aborted", aborted);
	});
}

/** One instance per Pi session; the command owner reuses it and closes it on session_shutdown. */
export async function createPlan3Web(options: Options) {
	const token = options.token ?? randomBytes(32).toString("hex"), clients = new Map<ServerResponse, { ready: boolean; frames: string[]; bytes: number; device?: { cookie: string; login: string } }>();
	if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid workspace token.");
	let origin = "", port = 0, sequence = 0, closed = false;
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
		["/files.js", ["files.ts", "text/javascript; charset=utf-8"]],
		["/stream.js", ["stream.ts", "text/javascript; charset=utf-8"]],
		["/pair.js", ["pair.ts", "text/javascript; charset=utf-8"]],
		["/pair.html", ["pair.html", "text/html; charset=utf-8"]],
		["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
		["/vendor/rough.js", ["vendor/rough.ts", "text/javascript; charset=utf-8"]],
	]);
	// Changes when any served asset or this server changes; an open page reloads itself after /reload installs new code.
	const buildHash = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url)));
	for (const file of new Set(Array.from(assets.values(), ([file]) => file))) {
		try { buildHash.update(readFileSync(fileURLToPath(new URL(`./plan3-web/${file}`, import.meta.url)))); } catch { /* A missing asset is reported when requested. */ }
	}
	const build = buildHash.digest("hex").slice(0, 12);
	function asset(res: ServerResponse, pathname: string, remote: boolean) {
		// /a/<build>/<file> never changes, so browsers cache it; the page itself stays no-store.
		const fingerprinted = /^\/a\/([0-9a-f]{12})(\/.+)$/.exec(pathname);
		if (fingerprinted && fingerprinted[1] !== build) throw new WebError(404, "Stale workspace build; reload the page.");
		const entry = assets.get(fingerprinted?.[2] ?? pathname);
		if (!entry) throw new WebError(404, "Unknown workspace asset.");
		let contents: Buffer;
		try { contents = readFileSync(fileURLToPath(new URL(`./plan3-web/${entry[0]}`, import.meta.url))); }
		catch { throw new WebError(404, "Workspace asset is not installed."); }
		res.writeHead(200, { "Content-Type": entry[1], ...(fingerprinted ? { "Cache-Control": "private, max-age=31536000, immutable" } : {}) });
		res.end(entry[1].startsWith("font/") ? contents : (entry[0].endsWith(".ts") ? stripTypeScriptTypes(contents.toString("utf8")) : contents.toString("utf8")).replaceAll("__TOKEN__", remote ? "" : token).replaceAll("__BUILD__", build));
	}
	// D22 pairing: one pending request per server, 2-minute codes, at most 5 starts per 10 minutes.
	let pairing: Pairing | undefined, pairStarts: number[] = [];
	function startPairing(req: IncomingMessage, login: string) {
		if (!options.pair) throw new WebError(501, "Pairing is not available in this session.");
		const time = Date.now();
		pairStarts = pairStarts.filter(start => time - start < 600_000);
		if (pairing?.state === "pending") throw new WebError(409, "Another device is waiting for approval at the PC.");
		if (pairStarts.length >= 5) throw new WebError(429, "Too many pairing attempts; wait a few minutes.");
		pairStarts.push(time);
		const digits = String(randomInt(0, 1_000_000)).padStart(6, "0"), code = `${digits.slice(0, 3)} ${digits.slice(3)}`;
		const entry: Pairing = { id: randomBytes(16).toString("hex"), code, state: "pending", abort: new AbortController(), waiters: new Set() };
		const settle = (state: Pairing["state"], cookie?: string) => {
			if (entry.state !== "pending") return;
			entry.state = state; entry.cookie = cookie; clearTimeout(timer); entry.abort.abort();
			for (const wake of entry.waiters) wake();
		};
		const timer = setTimeout(() => settle("expired"), 120_000); timer.unref();
		const clean = (value: unknown, limit: number) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, limit);
		const agent = clean(req.headers["user-agent"], 300), label = ["iPhone", "iPad", "Android", "Windows", "Mac OS X", "Linux"].find(name => agent.includes(name)) ?? "Unknown device";
		const browser = /(Edg|Firefox|Chrome|Safari)\//.exec(agent)?.[1] ?? "browser";
		pairing = entry;
		options.pair({ code, label: `${label} ${browser === "Edg" ? "Edge" : browser}`, address: clean(req.headers["x-forwarded-for"], 60) || "unknown address", login, signal: entry.abort.signal })
			.then(cookie => settle(cookie && /^[A-Za-z0-9._-]{1,200}$/.test(cookie) ? "approved" : "denied", cookie), () => settle("denied"));
		return { id: entry.id, code };
	}
	async function pairStatus(res: ServerResponse, id: string | null) {
		const entry = pairing;
		if (!entry || !id || id.length !== entry.id.length || !timingSafeEqual(Buffer.from(id), Buffer.from(entry.id))) throw new WebError(404, "Unknown or finished pairing.");
		if (entry.state === "pending") await new Promise<void>(resolve => {
			const done = () => { clearTimeout(timer); entry.waiters.delete(done); resolve(); };
			const timer = setTimeout(done, 10_000); entry.waiters.add(done); res.once("close", done);
		});
		if (entry.state === "approved") {
			// Delivered once; host-only, so every session port on this machine shares it (D18).
			res.setHeader("Set-Cookie", deviceCookie(entry.cookie));
			pairing = undefined;
		} else if (entry.state !== "pending") pairing = undefined;
		return json(res, 200, { state: entry.state });
	}
	const endpoints = new Set(["/api/message", "/api/answer", "/api/comment", "/api/move", "/api/edit", "/api/generate", "/api/command", "/api/stop", "/api/model", "/api/effort", "/api/bias"]);
	const server = createServer((req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("Referrer-Policy", "no-referrer");
		res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
		void (async () => {
			if (closed) throw new WebError(503, "Workspace closed.");
			// D8: the Host picks the mode; local uses the token, the tailnet host the owner login plus a paired-device cookie.
			const tailnet = options.remote?.(), remoteHost = tailnet?.host && tailnet.login ? `${tailnet.host}:${port}` : undefined;
			const remote = req.headers.host === remoteHost;
			if (!remote && req.headers.host !== origin.slice("http://".length)) throw new WebError(403, "Foreign Host rejected.");
			const expected = remote ? `https://${remoteHost}` : origin;
			if (req.headers.origin !== undefined && req.headers.origin !== expected || req.method === "POST" && req.headers.origin !== expected) throw new WebError(403, "Foreign or missing Origin rejected.");
			if (!req.url || req.url.length > 2048) throw new WebError(414, "Request URL too long.");
			const url = new URL(req.url, expected);
			if (url.origin !== expected) throw new WebError(403, "Foreign request URL rejected.");
			let device: { cookie: string; login: string } | undefined;
			if (remote) {
				if (req.headers["x-forwarded-proto"] !== "https" || req.headers["tailscale-user-login"] !== tailnet.login) throw new WebError(403, "Only the Tailscale owner may connect.");
				// The token never authorizes remote requests: a leaked link must still need terminal pairing (D4).
				const cookie = /(?:^|;\s*)pi_remote=([A-Za-z0-9._-]{1,200})(?:;|$)/.exec(req.headers.cookie ?? "")?.[1];
				if (!cookie || !await options.device?.(cookie, tailnet.login)) {
					// Unpaired: only the static pairing page and its two endpoints (D22).
					if (req.method === "POST" && url.pathname === "/pair/start") return json(res, 200, startPairing(req, tailnet.login));
					if (req.method === "GET" && url.pathname === "/pair/status") return pairStatus(res, url.searchParams.get("id"));
					const fingerprinted = /^\/a\/[0-9a-f]{12}(\/(?:pair\.js|styles\.css))$/.exec(url.pathname);
					if (req.method === "GET" && (url.pathname === "/" || fingerprinted)) return asset(res, url.pathname === "/" ? "/pair.html" : url.pathname, true);
					throw new WebError(401, "This device is not paired.");
				}
				device = { cookie, login: tailnet.login };
				// A pairing page loaded without the cookie (older Strict cookies skip cross-site opens) is already paired: renew as Lax and let it reload.
				if (req.method === "POST" && url.pathname === "/pair/start") { res.setHeader("Set-Cookie", deviceCookie(cookie)); return json(res, 200, { paired: true }); }
			}
			// Cookies cross localhost ports; use an explicit token, never ambient browser credentials.
			else if (![req.headers.authorization?.replace(/^Bearer /, ""), url.searchParams.get("token")].some(valid)) throw new WebError(401, "Workspace token required.");
			const viewer = device ? device.cookie.split(".")[0] : "local";
			if (url.pathname === "/api/sessions" || url.pathname === "/api/seen") {
				if (!options.sessions) throw new WebError(501, "Session list is not attached.");
				if (req.method === "GET" && url.pathname === "/api/sessions") return json(res, 200, { sessions: await options.sessions.list(viewer) });
				if (req.method !== "POST" || url.pathname !== "/api/seen") throw new WebError(405, "Method not allowed.");
				const data = await body(req);
				if (Object.keys(data).some(key => key !== "revision") || !Number.isSafeInteger(data.revision) || (data.revision as number) < 0) throw new WebError(400, "Invalid seen revision.");
				return json(res, 200, { ok: await options.sessions.seen(viewer, data.revision as number) });
			}
			if (req.method === "GET" && url.pathname === "/api/snapshot") return json(res, 200, await options.snapshot(url.searchParams.has("target") ? webTarget(url.searchParams.get("target")) : undefined));
			if (req.method === "GET" && url.pathname === "/api/events") {
				if (clients.size >= 8) throw new WebError(429, "Too many workspace connections.");
				const target = url.searchParams.has("target") ? webTarget(url.searchParams.get("target")) : undefined, fence = ++sequence;
				const connection = { ready: false, frames: [] as string[], bytes: 0, device };
				const viewers = () => options.viewers?.([...clients.values()].map(item => item.device ? item.device.cookie.split(".")[0] : "local"));
				clients.set(res, connection); viewers(); res.on("close", () => { clients.delete(res); viewers(); });
				// Subscribe before an async snapshot so changes during initial load cannot disappear.
				const snapshot = await options.snapshot(target), initial = `retry: 1000\n${frame("snapshot", Object.assign({}, snapshot, { build }), fence)}`;
				if (closed || res.destroyed) return;
				if (Buffer.byteLength(initial) > 4_000_000) throw new WebError(413, "Workspace snapshot too large.");
				res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive", "X-Accel-Buffering": "no" });
				send(res, initial);
				connection.ready = true;
				for (const queued of connection.frames) send(res, queued);
				connection.frames = []; connection.bytes = 0;
				return;
			}
			if (req.method === "GET" && ["/api/row", "/api/rows", "/api/diagram", "/api/dialog", "/api/files", "/api/file", "/api/diff", "/api/plans", "/api/models", "/api/usage", "/api/commands"].includes(url.pathname)) {
				if (!options.read) throw new WebError(501, "Session bridge is not attached.");
				return json(res, 200, await options.read(url.pathname, url.searchParams));
			}
			if (req.method === "GET" && url.pathname === "/api/image") {
				const image = url.searchParams.has("path") ? await readLinkedImage(url.searchParams.get("path"), options.root?.()) : await readPastedImage(url.searchParams.get("name"));
				res.writeHead(200, { "Content-Type": image.type, "Cache-Control": "private, max-age=86400" }); return res.end(image.bytes);
			}
			if (req.method === "POST" && url.pathname === "/api/paste") return json(res, 200, { path: await savePastedImage(await read(req, IMAGE_BYTES)) });
			if (req.method === "POST") {
				if (!endpoints.has(url.pathname)) throw new WebError(404, "Unknown workspace endpoint.");
				if (!options.post) throw new WebError(501, "Session bridge is not attached.");
				return json(res, 200, await options.post(url.pathname, await body(req)));
			}
			if (req.method !== "GET") throw new WebError(405, "Method not allowed.");
			asset(res, url.pathname, remote);
		})().catch(error => {
			clients.delete(res);
			if (res.destroyed || res.writableEnded) return;
			if (res.headersSent) { res.end(); return; }
			json(res, error instanceof WebError ? error.status : 500, { error: error instanceof Error ? error.message.replaceAll(token, "[token]") : "Workspace request failed." });
		});
	});
	server.requestTimeout = 15_000; server.headersTimeout = 10_000;
	const listen = (port: number) => new Promise<void>((resolve, reject) => {
		const ready = () => { server.off("error", failed); resolve(); };
		const failed = (error: Error) => { server.off("listening", ready); reject(error); };
		server.once("error", failed); server.once("listening", ready);
		server.listen(port, "127.0.0.1");
	});
	let portChanged = false;
	for (let attempt = 0; ; attempt++) {
		try { await listen(options.port ?? 0); break; }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || !options.port) throw error;
			if (attempt >= 10) { await listen(0); portChanged = true; break; }
			await new Promise(done => setTimeout(done, 50));
		}
	}
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Workspace did not bind a TCP port.");
	origin = `http://127.0.0.1:${address.port}`; port = address.port;
	const heartbeat = setInterval(() => { for (const [res, connection] of clients) if (connection.ready) send(res, ": keepalive\n\n"); }, 15_000);
	heartbeat.unref();
	// D21: revoked or expired devices lose open streams, queued frames included, within 5 s.
	const recheck = setInterval(() => {
		for (const [res, connection] of clients) {
			if (!connection.device) continue;
			Promise.resolve().then(() => options.device?.(connection.device.cookie, connection.device.login)).then(ok => ok, () => false).then(ok => {
				if (ok) return;
				clients.delete(res); connection.frames = []; res.destroy();
			});
		}
	}, 2000);
	recheck.unref();
	let closing: Promise<void> | undefined;
	return {
		origin,
		port: address.port,
		portChanged,
		build,
		url: (target?: WebTarget) => `${origin}/?token=${token}${target ? `&target=${target.kind === "product" ? "product" : target.id}` : ""}`,
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
			closed = true; clearInterval(heartbeat); clearInterval(recheck); pairing?.abort.abort();
			for (const res of clients.keys()) res.end(); clients.clear();
			closing = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
			server.closeIdleConnections(); server.closeAllConnections();
			return closing;
		},
	};
}

// Thinking and tool calls travel as collapsed blocks (like Pi's terminal); a tool result joins its call's block.
type ChatBlock = { type: "thinking"; text: string } | { type: "tool"; id: string; name: string; title: string; args: string; result?: string; error?: boolean; diff?: string };
type ChatRow = { id: string; role: string; text: string; streaming: boolean; truncated?: boolean; excerpt?: boolean; brief?: boolean; error?: string; blocks?: ChatBlock[] };
// Thinking/tool blocks as titles only (brief); the page fetches the full row when one opens.
const briefBlocks = (blocks: ChatBlock[]) => blocks.map(block => block.type === "thinking" ? { ...block, text: "" } : { ...block, args: "", ...(block.result === undefined ? {} : { result: "" }), ...(block.diff === undefined ? {} : { diff: "" }) });
// Cuts never split a surrogate pair.
const head = (text: string, length: number) => text.length > length ? text.slice(0, length).replace(/[\ud800-\udbff]$/, "") : text;
const tail = (text: string, length: number) => text.length > length ? text.slice(-length).replace(/^[\udc00-\udfff]/, "") : text;
// Check-in rows (D20): at most 2 KB of text (excerpt) and brief blocks.
function excerptRow(row: ChatRow): ChatRow {
	return { ...row, text: head(row.text, 2000), ...(row.text.length > 2000 ? { excerpt: true } : {}), ...(row.blocks?.length ? { blocks: briefBlocks(row.blocks), brief: true } : {}) };
}
/** Calls `flush(key)` at most every `ms` per key; `now` flushes at once (final updates). */
function coalescer(flush: (key: string) => void, ms = 250) {
	const timers = new Map<string, { at: number; timer?: ReturnType<typeof setTimeout> }>();
	const run = (key: string) => { const entry = timers.get(key); clearTimeout(entry?.timer); timers.set(key, { at: Date.now() }); flush(key); };
	return {
		push(key: string, now = false) {
			const entry = timers.get(key);
			if (now || !entry || Date.now() - entry.at >= ms) return run(key);
			entry.timer ??= setTimeout(() => run(key), ms - (Date.now() - entry.at));
		},
		clear() { for (const entry of timers.values()) clearTimeout(entry.timer); timers.clear(); },
	};
}
const clip = (text: string, limit: number) => text.length > limit ? text.slice(0, limit) + "\n\u2026 truncated" : text;
/** One-line tool label: the name plus its most telling argument (path, command, query or the first text). */
function toolTitle(name: string, args: Record<string, unknown>) {
	const value = ["path", "file", "command", "query", "url", "question", "action", "agent"].map(key => args?.[key]).find(item => typeof item === "string") ?? Object.values(args ?? {}).find(item => typeof item === "string");
	const line = String(value ?? "").split("\n").find(item => item.trim())?.trim() ?? "";
	return (name + " " + (line.length > 90 ? line.slice(0, 89) + "\u2026" : line)).trim();
}
export function createChatMirror(pi, publish: (event: string, data: unknown) => void) {
	const rows: ChatRow[] = [], active = new Map<string, string>(), sent = new Map<string, { length: number; blocks: string }>();
	let next = 0;
	// Live stream (D20/D21): `{ id, offset, text }` appends; blocks travel brief and only when they change.
	// shortcut: assumes streamed text only grows (a shorter text resends from offset 0); hash the prefix if rewrites appear.
	const stream = coalescer(id => {
		const row = rows.find(item => item.id === id);
		if (!row) return void sent.delete(id);
		const last = sent.get(id), offset = last && row.text.length >= last.length ? last.length : 0;
		const blocks = row.blocks?.length ? briefBlocks(row.blocks) : [], json = JSON.stringify(blocks);
		publish("delta", { id, role: row.role, offset, text: row.text.slice(offset), streaming: row.streaming, ...(row.truncated ? { truncated: true } : {}), ...(row.error ? { error: row.error } : {}), ...(json !== last?.blocks ? { blocks } : {}) });
		sent.set(id, { length: row.text.length, blocks: json });
		for (const key of sent.keys()) if (!rows.some(item => item.id === key)) sent.delete(key);
	});
	const put = (message, streaming: boolean, emit = true, start = false) => {
		if (message?.role === "toolResult") {
			const row = rows.findLast(item => item.blocks?.some(block => block.type === "tool" && block.id === message.toolCallId));
			const block = row?.blocks.find(item => item.type === "tool" && item.id === message.toolCallId);
			if (!block || block.type !== "tool") return;
			block.result = clip((Array.isArray(message.content) ? message.content : []).map(part => part?.type === "text" ? part.text : part?.type === "image" ? "[image]" : "").join("\n"), 4000);
			if (message.isError) block.error = true;
			// Pi's edit tool: "+12 line" / "-12 line" / " 12 line" rows, coloured like the terminal.
			if (typeof message.details?.diff === "string") block.diff = clip(message.details.diff, 8000);
			if (emit) stream.push(row.id, true);
			return;
		}
		if (!["user", "assistant"].includes(message?.role)) return;
		const role = message.role;
		const base = typeof message.timestamp === "number" ? `${role}_${message.timestamp}` : `${role}_${++next}`;
		let id = active.get(role) ?? base;
		if (start) {
			id = base;
			for (let suffix = 2; rows.some(row => row.id === id); suffix++) id = `${base}_${suffix}`;
		}
		active.set(role, id);
		const content = typeof message.content === "string" ? message.content : (Array.isArray(message.content) ? message.content.map(part => part?.type === "text" && typeof part.text === "string" ? part.text : part?.type === "image" ? "[image]" : "").filter(Boolean).join("\n") : "");
		// shortcut: keep 100 recent rows / 512 KB; each row is capped at 64k chars, show truncation in the UI.
		const index = rows.findIndex(item => item.id === id), results = new Map((rows[index]?.blocks ?? []).flatMap(block => block.type === "tool" && block.result !== undefined ? [[block.id, block]] : []));
		const blocks: ChatBlock[] = (Array.isArray(message.content) ? message.content : []).flatMap(part => part?.type === "thinking" && part.thinking?.trim() ? [{ type: "thinking" as const, text: clip(part.thinking, 4000) }]
			: part?.type === "toolCall" ? [{ type: "tool" as const, id: String(part.id), name: String(part.name), title: toolTitle(String(part.name), part.arguments), args: clip(JSON.stringify(part.arguments ?? {}, null, 1), 2000), ...(part.name === "write" && typeof part.arguments?.content === "string" ? { diff: clip(part.arguments.content.split("\n").map(line => "+" + line).join("\n"), 8000) } : {}), ...(results.has(part.id) ? { result: results.get(part.id).result, ...(results.get(part.id).error ? { error: true } : {}), ...(results.get(part.id).diff === undefined ? {} : { diff: results.get(part.id).diff }) } : {}) }] : []);
		const row: ChatRow = { id, role, text: content.slice(0, 64_000), streaming, ...(content.length > 64_000 ? { truncated: true } : {}), ...(typeof message.errorMessage === "string" ? { error: message.errorMessage.slice(0, 4000) } : {}), ...(blocks.length ? { blocks } : {}) };
		if (index < 0) rows.push(row); else rows[index] = row;
		while (rows.length > 100 || Buffer.byteLength(JSON.stringify(rows)) > 512_000) rows.shift();
		if (emit) stream.push(id, !streaming);
		if (!streaming) active.delete(role);
	};
	pi.on("input", event => { publish("input", { text: typeof event.text === "string" ? event.text.slice(0, 64_000) : "", source: event.source, streamingBehavior: event.streamingBehavior }); });
	pi.on("message_start", event => put(event.message, true, true, true));
	pi.on("message_update", event => put(event.message, true));
	pi.on("message_end", event => put(event.message, false));
	return {
		snapshot: () => structuredClone(rows),
		/** The `count` rows before `before` (default: newest) as excerpts, and whether older rows exist. */
		page(before?: string, count = 20) {
			const end = before ? rows.findIndex(row => row.id === before) : rows.length;
			if (end < 0) throw new WebError(404, "Unknown chat row.");
			return { rows: rows.slice(Math.max(0, end - count), end).map(excerptRow), more: end > count };
		},
		row(id: string) {
			const row = rows.find(item => item.id === id);
			if (!row) throw new WebError(404, "Unknown chat row.");
			return structuredClone(row);
		},
		reset: () => { rows.length = 0; active.clear(); sent.clear(); stream.clear(); next = 0; },
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

const terminalCommands = new Set(["settings", "model", "thinking", "scoped-models", "login", "logout", "llama", "new", "resume", "name", "session", "tree", "fork", "clone", "compact", "import", "copy", "export", "share", "bug", "trust", "hotkeys", "changelog", "quit"]);
export function forwardDiagramChat(pi, ctx, diagram: Diagram | { diagram: Diagram; ids?: string[] }[], message: unknown, comments: unknown, publish: (event: string, value: unknown) => void) {
	const contextual = diagramChatMessage(diagram, message, comments);
	const prepared = contextual.mentions.length || (Array.isArray(comments) && comments.length) ? contextual : { message: (message as string).trim(), mentions: [], unknownMentions: [] };
	const command = prepared.message.startsWith("/");
	const name = command ? prepared.message.slice(1).split(/\s/, 1)[0] : "";
	if (terminalCommands.has(name)) throw new WebError(400, `/${name}: terminal only.`);
	// Built-in /reload cannot run from sendUserMessage; /wo reload calls ctx.reload() and the page reconnects.
	if (name === "reload") prepared.message = "/wo reload";
	const queued = !ctx.isIdle();
	try {
		const pending = pi.sendUserMessage(prepared.message, { expandPromptTemplates: command, ...(queued ? { deliverAs: "followUp" } : {}) });
		// SDK declaration says void, but live probe found a promise that settles only after the run.
		void Promise.resolve(pending).catch(error => publish("error", { message: `Message not delivered: ${error instanceof Error ? error.message : String(error)}` }));
	} catch (error) {
		publish("error", { message: `Message not delivered: ${error instanceof Error ? error.message : String(error)}` });
		throw error;
	}
	return { queued, mentions: prepared.mentions, unknownMentions: prepared.unknownMentions };
}

/**
 * Check-in packet (D20/D21): newest row excerpts, running tools, whole dialogs up to 16 KB (larger ones brief,
 * fetched via /api/dialog) and a thinking tail, within 64 KB encoded. The diagram loads separately.
 */
export function checkIn(chat: { page: () => { rows: ChatRow[]; more: boolean } }, live, asks: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
	const page = chat.page(), bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
	const dialogs = asks.map(ask => bytes(ask) <= 16_000 ? ask : { askId: ask.askId, kind: ask.kind, brief: true, title: head(String(ask.title ?? ask.question ?? "Answer questions"), 200) });
	const snapshot = { ...extra, dialogs, chat: page.rows, more: page.more, activity: { ...live, thinking: tail(live.thinking, 2000), thinkingLength: live.thinking.length, queue: live.queue.slice(-20).map(item => ({ ...item, text: head(item.text, 500) })), tools: live.tools.filter(tool => tool.state === "running") } };
	while (snapshot.chat.length > 1 && bytes(snapshot) > 64_000) { snapshot.chat.shift(); snapshot.more = true; }
	// shortcut: only many dialogs near 16 KB can still pass 64 KB; brief them all if that ever shows up.
	if (bytes(snapshot) > 64_000) snapshot.activity.tools = snapshot.activity.tools.map(({ args: _args, progress: _progress, ...tool }) => tool);
	return snapshot;
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
		get(askId: string) {
			if (!pending.has(askId)) throw new WebError(404, "Dialog is no longer open.");
			return structuredClone(pending.get(askId));
		},
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
type SubagentActivity = { id: string; label: string; model?: string; state: string; turns?: number; tools?: number; tool?: string };
// pi-subagents' public status RPC; undefined when it is not loaded or does not answer.
function subagentRuns(pi): Promise<{ runs: any[]; fleet: any[] } | undefined> {
	if (!pi.events?.on || !pi.events?.emit) return Promise.resolve(undefined);
	return new Promise(resolve => {
		const requestId = randomUUID();
		let off;
		const done = (value?: { runs: any[]; fleet: any[] }) => { clearTimeout(timer); off?.(); resolve(value); };
		const timer = setTimeout(() => done(), 2000);
		off = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, reply => done(reply?.success && Array.isArray(reply.data?.asyncSnapshot?.runs) ? { runs: reply.data.asyncSnapshot.runs, fleet: Array.isArray(reply.data.fleet?.entries) ? reply.data.fleet.entries : [] } : undefined));
		pi.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method: "status", params: {} });
	});
}
export function createActivityMirror(pi, publish: (event: string, value: unknown) => void) {
	const tools: ToolActivity[] = [], queued: { id: string; digest: string; text: string; delivery: string }[] = [];
	let working = false, compacting = false, thinking = "", error = "", interrupted = false, sequence = 0, dialog = "";
	// Background subagents outlive the parent's run, so the page stays busy until they finish too.
	let subagents: SubagentActivity[] = [], subagentTimer: ReturnType<typeof setTimeout> | undefined, polling = false;
	const digest = (text: string) => createHash("sha256").update(text).digest("hex");
	const textOf = message => typeof message?.content === "string" ? message.content : (message?.content ?? []).filter(part => part?.type === "text").map(part => part.text).join("\n");
	const brief = (value: unknown) => {
		try {
			const text = typeof value === "string" ? value : JSON.stringify(value, (_key, item) => item?.type === "image" ? { type: "image", note: "Image omitted from activity" } : item) ?? "";
			return text.length > 16_000 ? text.slice(0, 16_000) + "\n… truncated" : text;
		} catch { return "[Unserializable tool data]"; }
	};
	// Tool results are { content: [{ type: "text", text }] }: show their text, not escaped JSON.
	const resultText = (value: unknown) => Array.isArray((value as { content?: unknown })?.content)
		? brief((value as { content: { type?: string; text?: string }[] }).content.map(part => part?.type === "text" ? part.text ?? "" : part?.type === "image" ? "[image]" : "").filter(Boolean).join("\n"))
		: brief(value);
	const snapshot = ctx => {
		const hasPendingMessages = ctx?.hasPendingMessages?.();
		if (hasPendingMessages === false) queued.length = 0;
		return { hasPendingMessages, working: ctx?.isIdle ? !ctx.isIdle() : working, compacting, subagents: structuredClone(subagents), dialog, thinking, error, interrupted, queueExact: false, queue: queued.map(({ id, text, delivery }) => ({ id, text, delivery })), tools: structuredClone(tools) };
	};
	// Live activity (D20): state without tools/thinking; tools travel as single changed rows, thinking as deltas.
	const emit = () => { const { tools: _tools, thinking: _thinking, ...state } = snapshot(undefined); publish("activity", state); };
	let thinkingSent = 0;
	const thoughts = coalescer(() => { const offset = thinking.length >= thinkingSent ? thinkingSent : 0; publish("thinking", { offset, text: thinking.slice(offset) }); thinkingSent = thinking.length; });
	const tool = (event, patch: Partial<ToolActivity>) => {
		if (typeof event.toolCallId !== "string" || typeof event.toolName !== "string") return;
		const index = tools.findIndex(row => row.id === event.toolCallId);
		const row = { ...(tools[index] ?? { state: "running" }), id: event.toolCallId, name: event.toolName, ...(event.parentToolCallId ? { parent: event.parentToolCallId } : {}), ...patch };
		if (index < 0) tools.push(row); else tools[index] = row;
		// shortcut: latest 50 tool rows / 512 KB, text-only snapshots; native custom renderers stay in the terminal.
		while (tools.length > 50 || Buffer.byteLength(JSON.stringify(tools)) > 512_000) tools.shift();
		publish("tool", row);
	};
	// Each run starts a fresh tool list; finished calls stay in the chat rows.
	pi.on("agent_start", () => { tools.length = 0; working = true; interrupted = false; thinking = ""; error = ""; thoughts.push("thinking", true); emit(); });
	pi.on("agent_settled", event => {
		working = false; interrupted = Boolean(event.aborted); queued.length = 0;
		for (const row of tools) if (row.state === "running") { row.state = interrupted ? "interrupted" : "settled"; publish("tool", row); }
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
		if (event.assistantMessageEvent?.type?.startsWith("thinking_")) thoughts.push("thinking");
	});
	pi.on("message_end", event => { if (event.message?.errorMessage) { error = brief(event.message.errorMessage); emit(); } });
	pi.on("input", event => {
		if (!event.streamingBehavior || typeof event.text !== "string") return;
		queued.push({ id: `queued_${++sequence}`, digest: digest(event.text), text: brief(event.text), delivery: event.streamingBehavior });
		while (queued.length > 100 || Buffer.byteLength(JSON.stringify(queued)) > 512_000) queued.shift();
		emit();
	});
	pi.on("tool_execution_start", event => tool(event, { state: "running", startedAt: Date.now(), args: brief(event.args) }));
	pi.on("tool_execution_update", event => tool(event, { progress: resultText(event.partialResult) }));
	pi.on("tool_execution_end", event => {
		const startedAt = tools.find(row => row.id === event.toolCallId)?.startedAt;
		tool(event, { state: event.isError ? "error" : "done", result: resultText(event.result), durationMs: event.durationMs ?? (startedAt === undefined ? undefined : Date.now() - startedAt) });
	});
	// Any blocking terminal dialog; the page hides it while a bridged ask_user/Plan3 dialog is open there.
	pi.on("ui_prompt_start", event => { dialog = brief(event.title || `${event.kind} prompt`).slice(0, 200); emit(); });
	pi.on("ui_prompt_end", () => { dialog = ""; emit(); });
	pi.on("session_before_compact", () => { compacting = true; emit(); });
	pi.on("session_compact", () => { compacting = false; emit(); });
	pi.on("session_compact_failed", event => { compacting = false; error = brief(event.errorMessage ?? (event.aborted ? "Compaction cancelled" : "Compaction failed")); emit(); });
	const offs = [pi.events?.on?.("wo:compacting", event => { compacting = Boolean(event?.active); emit(); })];
	// Poll pi-subagents only while its runs are active; lifecycle events and session start (re)arm it.
	const pollSubagents = async () => {
		if (polling) return;
		polling = true; clearTimeout(subagentTimer); subagentTimer = undefined;
		try {
			const status = await subagentRuns(pi);
			if (status) {
				// The async snapshot has no model; the fleet rows do, keyed by agent name.
				const modelOf = (label: string) => { const agents = label.split(", "), ids = [...new Set(status.fleet.filter(entry => agents.includes(entry?.agent) && typeof entry.model === "string").map(entry => entry.model.replace(/:[a-z]+$/, "")))]; return ids.length ? ids.map(id => modelNames.get(id) ?? id.split("/").pop()).join(", ") : undefined; };
				const next = status.runs.filter(run => run?.state === "running" || run?.state === "queued").map(run => { const label = String(run.label ?? "subagent"), model = modelOf(label); return { id: String(run.id), label, ...(model ? { model } : {}), state: run.state, turns: run.activity?.turnCount, tools: run.activity?.toolCount, tool: run.activity?.currentTool }; });
				if (JSON.stringify(next) !== JSON.stringify(subagents)) { subagents = next; emit(); }
			}
		} finally { polling = false; }
		if (subagents.length) { subagentTimer = setTimeout(pollSubagents, 3000); subagentTimer.unref?.(); }
	};
	// The started event can precede pi-subagents registering the job, so look a moment later.
	const soon = () => { clearTimeout(subagentTimer); subagentTimer = setTimeout(pollSubagents, 300); subagentTimer.unref?.(); };
	for (const name of ["subagent:async-started", "subagent:async-complete", "subagent:child-status"]) offs.push(pi.events?.on?.(name, soon));
	// Friendly model names ("GPT-6 Astra") from the session's registry.
	let modelNames = new Map<string, string>();
	pi.on("session_start", (_event, ctx) => { soon(); Promise.resolve(ctx?.modelRegistry?.getAvailable?.()).then(list => { if (Array.isArray(list)) modelNames = new Map(list.map(model => [`${model.provider}/${model.id}`, model.name ?? model.id])); }).catch(() => {}); });
	return { snapshot, dispose: () => { clearTimeout(subagentTimer); for (const off of offs) off?.(); }, reset: () => {
		subagents = []; soon(); tools.length = 0; queued.length = 0; working = false; compacting = false; dialog = ""; thinking = ""; thinkingSent = 0; thoughts.clear(); error = ""; interrupted = false; sequence = 0; } };
}
