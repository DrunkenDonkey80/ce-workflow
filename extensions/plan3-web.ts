import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
	const token = randomBytes(32).toString("hex"), clients = new Set<ServerResponse>();
	let origin = "", sequence = 0, closed = false;
	const valid = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
	const json = (res: ServerResponse, status: number, value: unknown) => {
		res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(value));
	};
	const frame = (event: string, value: unknown) => `id: ${++sequence}\nevent: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
	const send = (res: ServerResponse, data: string) => {
		res.write(data);
		if (res.writableLength > 2_200_000) { clients.delete(res); res.destroy(); }
	};
	const assets = new Map([
		["/", ["index.html", "text/html; charset=utf-8"]],
		["/app.js", ["app.ts", "text/javascript; charset=utf-8"]],
		["/layout.js", ["layout.ts", "text/javascript; charset=utf-8"]],
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
				const snapshot = await options.snapshot(webTarget(url.searchParams.get("target")));
				if (clients.size >= 8) throw new WebError(429, "Too many workspace connections.");
				res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive", "X-Accel-Buffering": "no" });
				clients.add(res); res.on("close", () => clients.delete(res));
				send(res, frame("snapshot", snapshot));
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
			res.end(asset[1].startsWith("font/") ? contents : contents.toString("utf8").replaceAll("__TOKEN__", token));
		})().catch(error => {
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
	const heartbeat = setInterval(() => { for (const res of clients) send(res, ": keepalive\n\n"); }, 15_000);
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
			for (const res of clients) send(res, data);
		},
		close() {
			if (closing) return closing;
			closed = true; clearInterval(heartbeat);
			for (const res of clients) res.end(); clients.clear();
			closing = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
			server.closeIdleConnections(); server.closeAllConnections();
			return closing;
		},
	};
}
