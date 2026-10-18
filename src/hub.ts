// The hub process (H2-05): one per user, HTTP on 127.0.0.1 at a port fixed at first start (D11).
// It serves the local JSON API (CLI, tests), the web app under /s/<session>/, and remote access through Tailscale (H6-01).
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import crypto from "node:crypto";
import http from "node:http";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { Registry, hubDataDir, writeJsonAtomic } from "./registry.ts";
import { SessionHost } from "./sessions.ts";
import { SessionView } from "./view.ts";
import { createPageApi } from "./api.ts";
import { acquireLock, releaseLock } from "./session-lock.ts";
import { cookieOf, createDeviceRegistry, createPairing, deviceCookie, exec, serveAdd, serveRemove, tailscaleStatus, type Exec, type Tailnet } from "./remote.ts";

export type HubConfig = { version: 1; port: number; localKey: string; idleParkMinutes: number; remote?: boolean };
export type HubMarker = { pid: number; port: number; startedAt: number };
export const configPath = () => path.join(hubDataDir(), "config.json");
export const markerPath = () => path.join(hubDataDir(), "hub.json");

export function readConfig(): HubConfig | undefined {
	try { return JSON.parse(readFileSync(configPath(), "utf8")); } catch { return undefined; }
}

// CLI 1 MB; page JSON 64 KB and pasted images 20 MB, as ce-workflow's plan3-web.
const MAX_BODY = 1_000_000, PAGE_BODY = 65_536, IMAGE_BODY = 20_000_000;
function raw(request: http.IncomingMessage, limit: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		let size = 0; const chunks: Buffer[] = [];
		const collect = (chunk: Buffer) => {
			size += chunk.length;
			if (size <= limit) return void chunks.push(chunk);
			// Drain instead of destroying the socket, so the client still receives the 413.
			request.off("data", collect); request.resume(); chunks.length = 0;
			reject(Object.assign(new Error("Request too large."), { status: 413 }));
		};
		request.on("data", collect);
		request.on("end", () => resolve(Buffer.concat(chunks)));
		request.on("error", reject);
	});
}
async function body(request: http.IncomingMessage, limit = MAX_BODY): Promise<any> {
	const bytes = await raw(request, limit);
	try { return bytes.length ? JSON.parse(bytes.toString("utf8")) : {}; } catch { throw Object.assign(new Error("Invalid JSON."), { status: 400 }); }
}
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const sameKey = (a: unknown, b: string) => typeof a === "string" && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// H5-01: the browser app (copied from ce-workflow extensions/plan3-web) under /s/<session>/, all URLs relative to it.
const WEB = new URL("../web/", import.meta.url);
const JS = "text/javascript; charset=utf-8";
const ASSETS: Record<string, [string, string]> = {
	"app.js": ["app.ts", JS], "layout.js": ["layout.ts", JS], "diagram.js": ["diagram.ts", JS], "prompts.js": ["prompts.ts", JS],
	"files.js": ["files.ts", JS], "stream.js": ["stream.ts", JS], "pair.js": ["pair.ts", JS], "vendor/rough.js": ["vendor/rough.ts", JS], "styles.css": ["styles.css", "text/css; charset=utf-8"],
};
// Changes whenever a served file changes; an open page reloads itself when the build differs.
const BUILD = crypto.createHash("sha256").update(["index.html", "pair.html", ...Object.values(ASSETS).map(([file]) => file)].map(file => readFileSync(new URL(file, WEB))).join("\0")).digest("hex").slice(0, 12);
function webFile(file: string, key: string) {
	const text = readFileSync(new URL(file, WEB), "utf8");
	return (file.endsWith(".ts") ? stripTypeScriptTypes(text) : text).replaceAll("__TOKEN__", key).replaceAll("__BUILD__", BUILD);
}

export async function startHub({ command = process.env.PI_HUB_PI_COMMAND ? JSON.parse(process.env.PI_HUB_PI_COMMAND) : undefined, run = exec as Exec } = {}) {
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
	// H6-01 remote access: the tailnet while serving, paired devices and their open streams (dropped on revoke).
	const devices = createDeviceRegistry(dataDir), pairing = createPairing(devices), streams = new Map<string, Set<http.ServerResponse>>();
	let tailnet: Tailnet | undefined, serving = false, remoteError: string | undefined;
	async function applyRemote() {
		remoteError = undefined;
		if (!config.remote) { tailnet = undefined; if (serving) await serveRemove(run, config.port); serving = false; return; }
		tailnet = await tailscaleStatus(run);
		if (tailnet.missing.length) return;
		try { await serveAdd(run, config.port); serving = true; } catch (error) { remoteError = (error as Error).message; tailnet = undefined; }
	}
	const remoteStatus = () => ({ on: !!config.remote, url: serving && tailnet?.host ? `https://${tailnet.host}:${config.port}/` : undefined, missing: tailnet?.missing.length ? tailnet.missing : undefined, error: remoteError });
	const dropDevice = (id: string) => { for (const response of streams.get(id) ?? []) response.destroy(); streams.delete(id); };
	/** A session's view, created by its first browser request and kept while the hub runs (parked sessions show their file). */
	async function view(id: string) {
		let value = views.get(id);
		if (!value) views.set(id, value = new SessionView({
			file: () => registry.get(id)?.sessionFile,
			idle: () => !host.live.get(id)?.running,
			viewers: count => { const live = host.live.get(id); if (live) live.viewers = count; },
			forms: () => pageApi.forms(id),
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
		"GET /api/status": () => ({ pid: process.pid, port: config.port, remote: remoteStatus(), sessions: summary() }),
		"POST /api/remote": async data => { config.remote = data.on === true; writeJsonAtomic(configPath(), config); await applyRemote(); return remoteStatus(); },
		"GET /api/pairing": () => ({ pending: pairing.pending() }),
		"POST /api/pairing": data => pairing.decide(data.approve === true),
		"GET /api/devices": () => ({ devices: devices.list() }),
		"POST /api/devices/([A-Za-z0-9_-]{12})/revoke": async (_d, m) => { const ok = await devices.revoke(m[1]); dropDevice(m[1]); return { ok }; },
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

	const pageApi = createPageApi({ host, registry, views });
	const server = http.createServer(async (request, response) => {
		const send = (status: number, value: unknown) => {
			if (response.headersSent) return void response.destroy(); // failed mid-image: drop the connection
			response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value ?? { ok: true }));
		};
		response.setHeader("X-Content-Type-Options", "nosniff");
		response.setHeader("Referrer-Policy", "no-referrer");
		response.setHeader("Content-Security-Policy", CSP);
		try {
			// Request checks kept from ce-workflow plan3-web (H5-03): the Host stops DNS rebinding, the Origin cross-site posts.
			if ((request.url ?? "").length > 2048) return send(414, { error: "Request URL too long." });
			// The Host picks the mode: the tailnet name means remote (owner login plus paired-device cookie), 127.0.0.1 the local key.
			const hostName = request.headers.host ?? "", remoteHost = serving && tailnet?.host && tailnet.login ? `${tailnet.host}:${config.port}` : undefined;
			const remote = hostName === remoteHost;
			if (!remote && ![`127.0.0.1:${config.port}`, `localhost:${config.port}`].includes(hostName)) return send(403, { error: "Foreign Host rejected." });
			const origin = request.headers.origin, expected = remote ? `https://${remoteHost}` : `http://${hostName}`;
			if (origin !== undefined && origin !== expected) return send(403, { error: "Foreign Origin rejected." });
			const url = new URL(request.url ?? "/", expected);
			const rootAsset = request.method === "GET" && /^\/a\/([0-9a-f]{12})\/(pair\.js|styles\.css)$/.exec(url.pathname);
			const serveAsset = (build: string, name: string) => {
				if (build !== BUILD) return send(404, { error: "Stale build; reload the page." });
				response.writeHead(200, { "content-type": ASSETS[name][1], "cache-control": "private, max-age=31536000, immutable" });
				response.end(webFile(ASSETS[name][0], remote ? "" : config.localKey));
			};
			let device: string | undefined;
			if (remote) {
				if (request.headers["x-forwarded-proto"] !== "https" || request.headers["tailscale-user-login"] !== tailnet!.login) return send(403, { error: "Only the Tailscale owner may connect." });
				if (request.method === "POST" && origin === undefined) return send(403, { error: "Missing Origin rejected." });
				// The local key never authorizes remote requests: a leaked link still needs pairing.
				const cookie = cookieOf(request.headers.cookie);
				if (!cookie || !await devices.check(cookie, tailnet!.login!)) {
					if (request.method === "POST" && url.pathname === "/pair/start") return send(200, pairing.start(request.headers, tailnet!.login!));
					if (request.method === "GET" && url.pathname === "/pair/status") {
						const result = await pairing.status(url.searchParams.get("id"), new Promise(done => response.once("close", done)));
						if (result.cookie) response.setHeader("set-cookie", deviceCookie(result.cookie));
						return send(200, { state: result.state });
					}
					if (request.method === "GET" && url.pathname === "/") { response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return response.end(webFile("pair.html", "")); }
					if (rootAsset) return serveAsset(rootAsset[1], rootAsset[2]);
					return send(401, { error: "This device is not paired." });
				}
				// A pairing page loaded without the cookie (Strict cookies skip cross-site opens) is already paired: renew and reload.
				if (request.method === "POST" && url.pathname === "/pair/start") { response.setHeader("set-cookie", deviceCookie(cookie)); return send(200, { paired: true }); }
				device = cookie.split(".")[0];
			} else {
				// The CLI sends x-hub-key; the browser app sends the same key as a Bearer token or ?token= (its page carries it).
				const keys = [request.headers["x-hub-key"], request.headers.authorization?.replace(/^Bearer /, ""), url.searchParams.get("token")];
				if (!keys.some(key => sameKey(key, config.localKey))) return send(401, { error: "Missing or wrong hub key." });
				// Browsers always send an Origin on POST; only the CLI posts without one, and it sends x-hub-key.
				if (request.method === "POST" && origin === undefined && !sameKey(request.headers["x-hub-key"], config.localKey)) return send(403, { error: "Missing Origin rejected." });
			}
			if (rootAsset) return serveAsset(rootAsset[1], rootAsset[2]);
			// The bare address opens a session page: a live one first.
			if (request.method === "GET" && url.pathname === "/") {
				const first = registry.list().find(record => host.live.has(record.id)) ?? registry.list()[0];
				if (!first) return send(404, { error: "No sessions yet; start one with pi-hub." });
				response.writeHead(302, { location: `/s/${first.id}/${remote ? "" : url.search}` }); return response.end();
			}
			const page = /^\/s\/([0-9a-f-]{36})(\/.*)?$/.exec(url.pathname);
			if (remote && !page) return send(403, { error: "Remote devices reach session pages only." });
			const endpoint = page && /^\/api\/([a-z]+)$/.exec(page[2] ?? "")?.[1];
			if (page && endpoint && request.method === "POST") {
				if (!registry.get(page[1])) return send(404, { error: "Unknown session." });
				if (endpoint === "paste") return send(200, { path: await pageApi.saveImage(await raw(request, IMAGE_BODY)) });
				// A JSON content type needs a CORS preflight, which this server never grants.
				if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") return send(415, { error: "JSON content type required." });
				const data = await body(request, PAGE_BODY);
				if (!data || typeof data !== "object" || Array.isArray(data)) return send(400, { error: "Expected a JSON object." });
				return send(200, await pageApi.post(page[1], endpoint, data));
			}
			if (page && request.method === "GET") {
				if (!registry.get(page[1])) return send(404, { error: "Unknown session." });
				if (!page[2]) { response.writeHead(301, { location: `/s/${page[1]}/${url.search}` }); return response.end(); }
				const asset = /^\/a\/([0-9a-f]{12})\/(.+)$/.exec(page[2]);
				if (page[2] === "/") {
					response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
					return response.end(webFile("index.html", remote ? "" : config.localKey));
				}
				if (asset && (ASSETS[asset[2]] || asset[1] !== BUILD)) return serveAsset(asset[1], asset[2]);
				if (asset) return send(404, { error: "Unknown asset." });
				// H5-02: the session view.
				if (["events", "snapshot", "rows", "row"].includes(endpoint ?? "")) {
					const sessionView = await view(page[1]);
					if (endpoint === "rows") return send(200, await sessionView.page(url.searchParams.get("before") ?? undefined));
					if (endpoint === "row") return send(200, await sessionView.row(url.searchParams.get("id") ?? ""));
					const extras = { ...await pageApi.extras(page[1], url.searchParams.get("target")), build: BUILD };
					if (endpoint !== "events") return send(200, sessionView.snapshot(extras));
					if (device) {
						const open = streams.get(device) ?? new Set(); streams.set(device, open.add(response));
						response.once("close", () => { open.delete(response); if (!open.size && streams.get(device!) === open) streams.delete(device!); });
					}
					return sessionView.attach(response, extras);
				}
				// H5-03: the rest of the page API.
				if (endpoint) { const value = await pageApi.get(page[1], endpoint, url.searchParams, response); return value === undefined ? undefined : send(200, value); }
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
	if (config.remote) await applyRemote().catch(error => { remoteError = (error as Error).message; });
	const restored = await host.restoreRunning(); // D17
	const timer = setInterval(() => void host.autoPark(), 60_000);
	timer.unref();

	async function stop() {
		return closing ??= (async () => {
			clearInterval(timer);
			pairing.close();
			if (serving) await serveRemove(run, config.port); // no forgotten mapping while the hub is down
			for (const value of views.values()) value.close();
			await host.shutdown();
			await new Promise(resolve => server.close(resolve));
			if (existsSync(markerPath())) rmSync(markerPath(), { force: true });
			releaseLock(path.join(dataDir, "hub"), lock);
		})();
	}
	return { config, host, registry, views, server, restored, devices, remote: remoteStatus, stop };
}

if (import.meta.main) {
	const hub = await startHub();
	console.log(`pi-control-hub ${process.pid} on http://127.0.0.1:${hub.config.port} (restored ${hub.restored.length})`);
	const remote = hub.remote();
	if (remote.on) console.log(remote.url ? `remote: ${remote.url}` : `remote off: ${remote.error ?? remote.missing?.join(" ")}`);
	for (const failure of hub.restored.filter(r => r.error)) console.error(`restore ${failure.id}: ${failure.error}`);
	const quit = () => void hub.stop().then(() => process.exit(0));
	process.on("SIGINT", quit);
	process.on("SIGTERM", quit);
	hub.server.on("close", () => setTimeout(() => process.exit(0), 100).unref());
}
