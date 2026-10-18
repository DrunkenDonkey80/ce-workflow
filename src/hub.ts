// The hub process (H2-05): one per user, HTTP on 127.0.0.1 at a port fixed at first start (D11).
// Phase 5 adds the web app; this serves the local JSON API that the CLI and tests use.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import crypto from "node:crypto";
import http from "node:http";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { Registry, hubDataDir, writeJsonAtomic } from "./registry.ts";
import { SessionHost } from "./sessions.ts";
import { SessionView } from "./view.ts";
import { acquireLock, releaseLock } from "./session-lock.ts";

export type HubConfig = { version: 1; port: number; localKey: string; idleParkMinutes: number };
export type HubMarker = { pid: number; port: number; startedAt: number };
export const configPath = () => path.join(hubDataDir(), "config.json");
export const markerPath = () => path.join(hubDataDir(), "hub.json");

export function readConfig(): HubConfig | undefined {
	try { return JSON.parse(readFileSync(configPath(), "utf8")); } catch { return undefined; }
}

const MAX_BODY = 1_000_000;
function body(request: http.IncomingMessage): Promise<any> {
	return new Promise((resolve, reject) => {
		let size = 0; const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_BODY) { reject(Object.assign(new Error("Request too large."), { status: 413 })); request.destroy(); } else chunks.push(chunk); });
		request.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(Object.assign(new Error("Invalid JSON."), { status: 400 })); } });
		request.on("error", reject);
	});
}
const sameKey = (a: unknown, b: string) => typeof a === "string" && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// H5-01: the browser app (copied from ce-workflow extensions/plan3-web) under /s/<session>/, all URLs relative to it.
const WEB = new URL("../web/", import.meta.url);
const JS = "text/javascript; charset=utf-8";
const ASSETS: Record<string, [string, string]> = {
	"app.js": ["app.ts", JS], "layout.js": ["layout.ts", JS], "diagram.js": ["diagram.ts", JS], "prompts.js": ["prompts.ts", JS],
	"files.js": ["files.ts", JS], "stream.js": ["stream.ts", JS], "vendor/rough.js": ["vendor/rough.ts", JS], "styles.css": ["styles.css", "text/css; charset=utf-8"],
};
// Changes whenever a served file changes; an open page reloads itself when the build differs.
const BUILD = crypto.createHash("sha256").update(["index.html", ...Object.values(ASSETS).map(([file]) => file)].map(file => readFileSync(new URL(file, WEB))).join("\0")).digest("hex").slice(0, 12);
function webFile(file: string, key: string) {
	const text = readFileSync(new URL(file, WEB), "utf8");
	return (file.endsWith(".ts") ? stripTypeScriptTypes(text) : text).replaceAll("__TOKEN__", key).replaceAll("__BUILD__", BUILD);
}

export async function startHub({ command = process.env.PI_HUB_PI_COMMAND ? JSON.parse(process.env.PI_HUB_PI_COMMAND) : undefined } = {}) {
	const dataDir = hubDataDir();
	mkdirSync(dataDir, { recursive: true }); // `node src/hub.ts` on a fresh machine, not only through the CLI
	// One running hub only: the same lock file rule as sessions (D9), on `<data>/hub.lock`.
	const lock = acquireLock(path.join(dataDir, "hub"), "pi-control-hub");
	const saved = readConfig();
	const config: HubConfig = saved ?? { version: 1, port: 0, localKey: crypto.randomBytes(32).toString("hex"), idleParkMinutes: 60 };
	const registry = new Registry(dataDir);
	const views = new Map<string, SessionView>();
	const host = new SessionHost({ registry, command, idleParkMinutes: config.idleParkMinutes, viewers: id => views.get(id)?.clients.size ?? 0 });
	let closing: Promise<void> | undefined;
	/** A session's view, created by its first browser request and kept while the hub runs (parked sessions show their file). */
	async function view(id: string) {
		let value = views.get(id);
		if (!value) views.set(id, value = new SessionView({
			file: () => registry.get(id)?.sessionFile,
			idle: () => !host.live.get(id)?.running,
			viewers: count => { const live = host.live.get(id); if (live) live.viewers = count; },
		}));
		const live = host.live.get(id);
		if (!value.hydrated) await value.hydrate(live ? (await live.rpc.send({ type: "get_messages" })).data?.messages : undefined);
		return value;
	}
	host.on("event", (id: string, event) => views.get(id)?.feed(event));
	// A child that ends mid-run never sends agent_settled; settle the page's activity so it stops showing work.
	host.on("exit", (id: string) => views.get(id)?.feed({ type: "agent_settled", aborted: true }));

	const summary = () => registry.list().map(record => ({ ...record, busy: host.busyReasons(record.id), live: host.live.has(record.id), state: host.live.get(record.id)?.published.state }));
	const routes: Record<string, (data: any, match: RegExpMatchArray) => Promise<unknown> | unknown> = {
		"GET /api/status": () => ({ pid: process.pid, port: config.port, sessions: summary() }),
		"POST /api/sessions": data => host.create(String(data.folder ?? ""), String(data.name ?? "")),
		"POST /api/sessions/([0-9a-f-]{36})/resume": (_d, m) => host.resume(m[1]),
		"POST /api/sessions/([0-9a-f-]{36})/park": (_d, m) => host.park(m[1]).then(() => ({ ok: true })),
		"POST /api/sessions/([0-9a-f-]{36})/restart": (_d, m) => host.restart(m[1]),
		"POST /api/sessions/([0-9a-f-]{36})/rename": (data, m) => host.rename(m[1], String(data.name ?? "")),
		"POST /api/sessions/([0-9a-f-]{36})/prompt": (data, m) => host.prompt(m[1], String(data.message ?? "")),
		"POST /api/stop": data => {
			// D17: a normal stop or restart is refused while any session is busy.
			const busy = summary().filter(s => s.busy.length);
			if (busy.length && data.force !== true) throw Object.assign(new Error(`Busy: ${busy.map(s => `${s.name} (${s.busy.join(", ")})`).join("; ")}`), { status: 409 });
			setImmediate(() => void stop());
			return { ok: true };
		},
	};

	const server = http.createServer(async (request, response) => {
		const send = (status: number, value: unknown) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value ?? { ok: true })); };
		try {
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			// The CLI sends x-hub-key; the browser app sends the same key as a Bearer token or ?token= (its page carries it).
			const keys = [request.headers["x-hub-key"], request.headers.authorization?.replace(/^Bearer /, ""), url.searchParams.get("token")];
			if (!keys.some(key => sameKey(key, config.localKey))) return send(401, { error: "Missing or wrong hub key." });
			const page = /^\/s\/([0-9a-f-]{36})(\/.*)?$/.exec(url.pathname);
			if (page && request.method === "GET") {
				if (!registry.get(page[1])) return send(404, { error: "Unknown session." });
				if (!page[2]) { response.writeHead(301, { location: `/s/${page[1]}/${url.search}` }); return response.end(); }
				const asset = /^\/a\/([0-9a-f]{12})\/(.+)$/.exec(page[2]);
				if (page[2] === "/") {
					response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
					return response.end(webFile("index.html", config.localKey));
				}
				if (asset && asset[1] === BUILD && ASSETS[asset[2]]) {
					response.writeHead(200, { "content-type": ASSETS[asset[2]][1], "cache-control": "private, max-age=31536000, immutable" });
					return response.end(webFile(ASSETS[asset[2]][0], config.localKey));
				}
				if (asset) return send(404, { error: asset[1] === BUILD ? "Unknown asset." : "Stale build; reload the page." });
				// H5-02: the session view.
				const api = /^\/api\/(events|snapshot|rows|row)$/.exec(page[2]);
				if (api) {
					const sessionView = await view(page[1]);
					if (api[1] === "events") return sessionView.attach(response);
					if (api[1] === "snapshot") return send(200, sessionView.snapshot());
					if (api[1] === "rows") return send(200, await sessionView.page(url.searchParams.get("before") ?? undefined));
					return send(200, await sessionView.row(url.searchParams.get("id") ?? ""));
				}
			}
			for (const [route, handler] of Object.entries(routes)) {
				const [method, pattern] = route.split(" ");
				const match = method === request.method ? url.pathname.match(new RegExp(`^${pattern}$`)) : null;
				if (match) return send(200, await handler(method === "POST" ? await body(request) : {}, match));
			}
			send(404, { error: "Not found." });
		} catch (error: any) {
			send(error?.status ?? 400, { error: String(error?.message ?? error) });
		}
	});

	await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(config.port, "127.0.0.1", () => resolve()); })
		.catch(error => { releaseLock(path.join(dataDir, "hub"), lock); throw error; });
	config.port = (server.address() as { port: number }).port;
	if (!saved) writeJsonAtomic(configPath(), config); // the port stays fixed from now on (D11)
	writeJsonAtomic(markerPath(), { pid: process.pid, port: config.port, startedAt: Date.now() } satisfies HubMarker);
	const restored = await host.restoreRunning(); // D17
	const timer = setInterval(() => void host.autoPark(), 60_000);
	timer.unref();

	async function stop() {
		return closing ??= (async () => {
			clearInterval(timer);
			for (const value of views.values()) value.close();
			await host.shutdown();
			await new Promise(resolve => server.close(resolve));
			if (existsSync(markerPath())) rmSync(markerPath(), { force: true });
			releaseLock(path.join(dataDir, "hub"), lock);
		})();
	}
	return { config, host, registry, server, restored, stop };
}

if (import.meta.main) {
	const hub = await startHub();
	console.log(`pi-control-hub ${process.pid} on http://127.0.0.1:${hub.config.port} (restored ${hub.restored.length})`);
	for (const failure of hub.restored.filter(r => r.error)) console.error(`restore ${failure.id}: ${failure.error}`);
	const quit = () => void hub.stop().then(() => process.exit(0));
	process.on("SIGINT", quit);
	process.on("SIGTERM", quit);
	hub.server.on("close", () => setTimeout(() => process.exit(0), 100).unref());
}
