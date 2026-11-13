// Inter-hub links (plan d21eefbf): the comm protocol version, the paired-hub store and the pi-intercom client loader.
// COMM changes only when the hub-to-hub protocol does (the plan's "Comm protocol" section lists what counts), never with
// the ce-workflow version: hubs on different releases keep their links while their COMM numbers are equal (D6).
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeJsonAtomic } from "./registry.ts";
import type { createDeviceRegistry, createPairing } from "./remote.ts";
import { agentDir } from "./rpc-client.ts";

// 2: project links (plan 58d5c14f): `link` with kind project, `ping` lists project sessions, `deliver` carries from and to.
export const COMM = 2;
/** S02 deadlines: a forwarded message must be confirmed inside pi-intercom's 5 s receipt window; hubs ping every 30 s. */
const DELIVER_MS = 3_000, PING_MS = 30_000;
/** D-09: files in one message total at most 5 MB; `/link/file` takes one file as base64 plus 64 KB of metadata. */
const FILES_MAX = 5 * 1024 * 1024;
export const FILE_BODY = 4 * Math.ceil(FILES_MAX / 3) + 65_536;
const inside = (root: string, real: string) => { const rel = path.relative(root, real); return rel !== "" && rel.split(/[\\/]/)[0] !== ".." && !path.isAbsolute(rel); };
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** PL-08: saves an arriving file as `<folder>/.pi/inbox/<time>-<random>-<name>`; the inbox's real path must stay in the project. */
export async function saveInbox(folder: string, bytes: Buffer, name: unknown) {
	const inbox = path.join(folder, ".pi", "inbox");
	await mkdir(inbox, { recursive: true });
	const [root, real] = await Promise.all([realpath(folder), realpath(inbox)]);
	if (!inside(root, real)) throw Object.assign(new Error("the project's .pi/inbox leads outside the project"), { status: 403 });
	// As savePastedImage: no separators, spaces or leading dots, and wx never overwrites.
	const safe = (typeof name === "string" ? path.basename(name.replaceAll("\\", "/")) : "").replace(/[^\w.()-]/g, "_").replace(/^[._]+/, "").slice(-120) || "file";
	const file = path.join(real, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}-${safe}`);
	await writeFile(file, bytes, { flag: "wx" });
	return file;
}

/** PL-07 (D-06, D-07, D-09): `@<absolute path>` files a sender may ship, real paths inside its project or the temp folder, 5 MB in total. */
export async function checkFiles(files: { name?: unknown; content: string }[], folder: string) {
	const roots = await Promise.all([folder, tmpdir()].map(root => realpath(root).catch(() => root))), checked: { real: string; name: string; size: number }[] = [];
	for (const file of files) {
		const wanted = file.content.slice(1).trim();
		if (!path.isAbsolute(wanted)) throw new Error(`${wanted} is not an absolute path`);
		const real = await realpath(wanted).catch(() => { throw new Error(`${wanted} does not exist`); });
		if (!roots.some(root => inside(root, real))) throw new Error(`${wanted} is outside this project and the temp folder`);
		const info = await stat(real);
		if (!info.isFile()) throw new Error(`${wanted} is not a file`);
		checked.push({ real, name: typeof file.name === "string" && file.name.trim() ? file.name : path.basename(real), size: info.size });
	}
	const total = checked.reduce((sum, file) => sum + file.size, 0);
	if (total > FILES_MAX) throw new Error(`the files total ${megabytes(total)}, over the 5 MB limit`);
	return checked;
}

/** null when the peer speaks this hub's comm; otherwise a message naming both numbers and which hub to update. */
export function commMismatch(theirs: unknown, peer: string, mine = COMM): string | null {
	if (theirs === mine) return null;
	if (!Number.isSafeInteger(theirs)) return `${peer} hub sent no comm version: update ${peer} hub.`;
	return `${peer} hub speaks comm ${theirs}, this hub comm ${mine}: update ${(theirs as number) > mine ? "this hub" : `${peer} hub`}.`;
}

/** A hub this one is paired with: its tailnet address and the credential it issued to this hub. */
/** credential: ours for calling that hub; device: id of the hub credential it calls us with (how a caller is known). */
export type Peer = { name: string; url: string; credential: string; device: string; paired: number };
const valid = (peer: Peer) => typeof peer?.name === "string" && peer.name.length > 0 && /^https:\/\/[^/\s]+$/.test(peer.url)
	&& /^[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$/.test(peer.credential) && /^[A-Za-z0-9_-]{12}$/.test(peer.device) && Number.isFinite(peer.paired);

/** Paired hubs in `<dataDir>/peers.json`, one per address; a corrupt file fails closed instead of forgetting them. */
export function createPeers(dataDir: string) {
	const file = path.join(dataDir, "peers.json");
	function load(): Peer[] {
		let text: string;
		try { text = readFileSync(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
		try {
			const value = JSON.parse(text);
			if (value?.version !== 1 || !Array.isArray(value.peers) || !value.peers.every(valid)) throw new Error("shape");
			return value.peers;
		} catch { throw new Error(`Paired-hub list is corrupt; hub links are off until ${file} is fixed or deleted.`); }
	}
	const save = (peers: Peer[]) => writeJsonAtomic(file, { version: 1, peers });
	return {
		file,
		list: load,
		get: (url: string) => load().find(peer => peer.url === url),
		/** Adds or replaces (same address) one paired hub. */
		put(peer: Peer) {
			if (!valid(peer)) throw new Error("Invalid paired hub.");
			save([...load().filter(other => other.url !== peer.url), peer]);
		},
		remove(url: string) { const peers = load(), kept = peers.filter(peer => peer.url !== url); save(kept); return kept.length < peers.length; },
	};
}

type Headers = Record<string, string | string[] | undefined>;
export type Reply = [status: number, body: Record<string, unknown>];
/** One hub-to-hub request: `op` on the hub at `url` (its tailscale serve address); tests swap in the fake serve headers. */
export type LinkRequest = (url: string, op: string, body: Record<string, unknown>, credential?: string) => Promise<Reply>;
const fetchRequest: LinkRequest = async (url, op, body, credential) => {
	const response = await fetch(`${url}/link/${op}`, { method: "POST", headers: { "content-type": "application/json", ...(credential ? { "x-hub-link": credential } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(op === "file" ? 120_000 : 15_000) });
	return [response.status, await response.json().catch(() => ({}))];
};
const CREDENTIAL = /^[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$/;
const cleanName = (value: unknown) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60) : "";
/** Optional link details (comm 1, ignored by older hubs): the other side's project folder and `process.platform`. */
const cleanFolder = (value: unknown) => typeof value === "string" && value.trim() ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 300) : undefined;
const cleanOs = (value: unknown) => typeof value === "string" && /^[a-z0-9]{1,20}$/.test(value) ? value : undefined;
const OS_NAMES: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };
const folderName = (folder?: string) => folder?.split(/[\\/]/).filter(Boolean).pop();
/** "emailupload/1": how the hub page names a session, so a link reads the same on both hubs. */
const sessionRef = (folder: string | undefined, name: string) => folderName(folder) ? `${folderName(folder)}/${name}` : name;
/** Same local project folder (case-insensitive on Windows); only this hub's own folders are compared. */
const folderKey = (folder: string) => { const full = path.resolve(folder).replace(/[\\/]+$/, ""); return process.platform === "win32" ? full.toLowerCase() : full; };
const sameFolder = (a?: string, b?: string) => !!a && !!b && folderKey(a) === folderKey(b);
/** A remote project's sessions as the other hub reported them (record, name, live); bounded and cleaned. */
type RemoteSession = { record: string; name: string; live: boolean };
const cleanSessions = (value: unknown): RemoteSession[] => Array.isArray(value) ? value.slice(0, 100)
	.filter(item => typeof item?.record === "string" && item.record.length > 0 && item.record.length <= 100)
	.map(item => ({ record: item.record, name: cleanName(item.name) || "session", live: item.live === true })) : [];

/** The `/link/` operations (plan section "Comm protocol") and this hub's side of pairing with another hub. */
export function createLinks(options: {
	dataDir: string;
	devices: ReturnType<typeof createDeviceRegistry>;
	pairing: ReturnType<typeof createPairing>;
	/** This hub's name and tailnet address; undefined while remote access is off. */
	self: () => { name: string; url: string; login: string } | undefined;
	/** This hub's sessions, for the other hub's link picker (D7) and link checks. */
	sessions: () => { record: string; name: string; folder: string; live: boolean }[];
	onPairing?: () => void;
	request?: LinkRequest;
	/** Stand-ins (S07): a record's current intercom id (D10), resuming a parked record, and the pi-intercom client loader. */
	intercom?: { intercomId: (record: string) => Promise<string | undefined>; wake?: (record: string) => Promise<unknown>; load?: () => Promise<IntercomLoad> };
}) {
	const { devices, pairing, self, sessions, request = fetchRequest } = options, peers = createPeers(options.dataDir), store = createLinkStore(options.dataDir);
	let outgoing: { url: string; code?: string; state: string; error?: string } | undefined;
	const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Reply => [status, { comm: COMM, error, ...extra }];
	const inFolder = (folder: string) => sessions().filter(session => sameFolder(session.folder, folder));
	const listed = (folder: string) => inFolder(folder).map(({ record, name, live }) => ({ record, name, live }));
	/** Project links (D-01): the other hub's sessions in its linked folder, from its last `link` or `ping` reply. */
	const remotes = new Map<string, RemoteSession[]>();

	/** Answers one `/link/<op>` after the hub checked the tailnet owner; credential, then comm, then payload. */
	async function serve(op: string, headers: Headers, data: unknown, login: string, closed: Promise<unknown>): Promise<Reply> {
		if (!data || typeof data !== "object" || Array.isArray(data)) return fail(400, "Expected a JSON object.");
		const body = data as { comm?: unknown; id?: unknown; offer?: unknown; hub?: { name?: unknown; url?: unknown }; link?: unknown; message?: unknown; from?: unknown; to?: unknown; file?: unknown }, open = op === "pair-start" || op === "pair-status";
		const credential = headers["x-hub-link"], device = typeof credential === "string" ? credential.split(".")[0] : "";
		if (!open && !(typeof credential === "string" && await devices.check(credential, login, "hub"))) return fail(401, "unpaired");
		// After pair-finish the caller is the paired hub its credential was issued to.
		const caller = open || op === "pair-finish" ? undefined : peers.list().find(peer => peer.device === device);
		if (!open && op !== "pair-finish" && !caller) return fail(401, "unpaired");
		if (body.comm !== COMM) return fail(409, "comm-mismatch");
		try {
			if (op === "pair-start") {
				const name = cleanName(body.hub?.name);
				if (!name) return fail(400, "hub.name required.");
				const started = pairing.start(headers, login, { name });
				options.onPairing?.();
				return [200, { comm: COMM, ...started, hub: self()?.name }];
			}
			if (op === "pair-status") {
				const result = await pairing.status(typeof body.id === "string" ? body.id : null, closed);
				return [200, { comm: COMM, state: result.state, ...(result.cookie ? { credential: result.cookie } : {}) }];
			}
			if (op === "pair-finish") {
				// The caller's credential for this hub: one approval pairs both directions (D8).
				const name = cleanName(body.hub?.name), url = body.hub?.url;
				if (!name || typeof url !== "string" || typeof body.offer !== "string" || !CREDENTIAL.test(body.offer)) return fail(400, "hub.name, hub.url and offer required.");
				peers.put({ name, url, credential: body.offer, device, paired: Date.now() });
				return [200, { comm: COMM, hub: self()?.name }];
			}
			if (op === "sessions") return [200, { comm: COMM, hub: self()?.name, sessions: sessions() }];
			if (op === "link") {
				const link = body.link as { id?: unknown; kind?: unknown; from?: { record?: unknown; name?: unknown; folder?: unknown; sessions?: unknown }; to?: { record?: unknown; folder?: unknown } } | undefined;
				if (link?.kind === "project") {
					const from = cleanFolder(link.from?.folder);
					if (typeof link.id !== "string" || !/^[0-9a-f-]{36}$/.test(link.id) || !from || typeof link.to?.folder !== "string") return fail(400, "link.id, link.from.folder and link.to.folder required.");
					if (store.list().some(other => other.id === link.id && other.hub !== caller!.url)) return fail(409, "link id taken");
					const local = sessions().find(session => sameFolder(session.folder, link.to!.folder as string));
					if (!local) return fail(410, "project-gone");
					store.add({ id: link.id, kind: "project", folder: local.folder, hub: caller!.url, remote: { name: folderName(from) ?? "project", ...details(from, (body as { os?: unknown }).os) }, created: Date.now() });
					remotes.set(link.id, cleanSessions(link.from?.sessions));
					void sync();
					return [200, { comm: COMM, os: process.platform, folder: local.folder, sessions: listed(local.folder) }];
				}
				if (typeof link?.id !== "string" || !/^[0-9a-f-]{36}$/.test(link.id) || typeof link.from?.record !== "string" || typeof link.to?.record !== "string") return fail(400, "link.id, link.from and link.to required.");
				const existing = store.list().find(other => other.id === link.id);
				if (existing && existing.hub !== caller!.url) return fail(409, "link id taken");
				const target = sessions().find(session => session.record === link.to!.record);
				if (!target) return fail(410, "session-gone");
				const made: Link = { id: link.id, session: target.record, hub: caller!.url, remote: { record: link.from.record, name: cleanName(link.from.name) || "session", ...details(link.from.folder, (body as { os?: unknown }).os) }, created: Date.now() };
				store.add(made);
				void sync();
				return [200, { comm: COMM, name: standinName(made), os: process.platform, session: { name: target.name, folder: target.folder } }];
			}
			if (op === "unlink") {
				if (typeof body.link !== "string") return fail(400, "link required.");
				if (store.list().some(other => other.id === body.link && other.hub === caller!.url)) { store.remove(body.link); void sync(); }
				return [200, { comm: COMM }];
			}
			// A call from a hub proves it is back: its stand-ins reconnect (D13).
			misses.delete(caller!.url);
			if (offline.delete(caller!.url)) await sync();
			if (op === "ping") return [200, { comm: COMM, hub: self()?.name, os: process.platform, links: store.list().filter(item => item.hub === caller!.url).map(item => { if (item.kind === "project") return { id: item.id, folder: item.folder, sessions: listed(item.folder!) }; const local = sessions().find(s => s.record === item.session); return { id: item.id, name: local?.name ?? "", folder: local?.folder }; }) }];
			if (op === "file") {
				const file = body.file as { name?: unknown; data?: unknown } | undefined;
				if (typeof file?.data !== "string") return fail(400, "file.data required.");
				const bytes = Buffer.from(file.data, "base64");
				if (bytes.length > FILES_MAX) return fail(413, `over the 5 MB limit (${megabytes(bytes.length)})`);
				const link = store.list().find(item => item.id === body.link && item.hub === caller!.url);
				if (!link) return fail(404, "not-linked");
				const end = await ends(link, body, caller!.url), local = !Array.isArray(end) && sessions().find(s => s.record === end.record);
				if (Array.isArray(end)) return end;
				if (!local) return fail(410, "session-gone");
				return [200, { comm: COMM, path: await saveInbox(local.folder, bytes, file.name) }];
			}
			if (op === "deliver") {
				const message = body.message as { id?: unknown; text?: unknown; expectsReply?: unknown; replyTo?: unknown } | undefined;
				if (typeof message?.id !== "string" || message.id.length > 100 || typeof message.text !== "string" || (message.replyTo !== undefined && typeof message.replyTo !== "string")) return fail(400, "message.id and message.text required.");
				const link = store.list().find(item => item.id === body.link && item.hub === caller!.url);
				if (!link) return fail(404, "not-linked");
				const end = await ends(link, body, caller!.url);
				if (Array.isArray(end)) return end;
				const { record, standin, back } = end, local = sessions().find(s => s.record === record);
				if (!local) return fail(410, "session-gone");
				if (!standin) return fail(502, "not-delivered", { reason: unavailable ?? "its stand-in is not connected" });
				const send = { text: message.text, messageId: message.id, ...(message.expectsReply === true ? { expectsReply: true } : {}), ...(message.replyTo ? { replyTo: message.replyTo } : {}) };
				if (!local.live) { void wakeAndSend(link, standin, send, record, local.name, back); return [200, { comm: COMM, delivered: true, resuming: true }]; }
				const target = await options.intercom!.intercomId(record);
				const result = target ? await standin.client.send(target, send).catch((error: Error) => ({ delivered: false, reason: error.message })) : { delivered: false, reason: "it has no intercom session" };
				return result.delivered ? [200, { comm: COMM, delivered: true }] : fail(502, "not-delivered", { reason: result.reason ?? "not delivered" });
			}
		} catch (error) {
			return fail((error as { status?: number }).status ?? 500, (error as Error).message);
		}
		return fail(404, "Unknown link operation.");
	}

	/** Where a `deliver` or `file` lands: the link's session; for a project link `to` in its folder, sent by a `from` the other hub listed. */
	async function ends(link: Link, body: { from?: unknown; to?: unknown }, url: string): Promise<Reply | { record: string; standin?: Standin; back: Record<string, unknown> }> {
		if (link.kind !== "project") return { record: link.session!, standin: standins.get(link.id), back: {} };
		const to = inFolder(link.folder!).find(s => s.record === body.to), known = () => remotes.get(link.id)?.some(s => s.record === body.from);
		if (!to) return fail(403, "not-in-project");
		// A session started there since the last ping: ask once before refusing.
		if (!known()) { await refresh(url); await sync(); }
		if (!known()) return fail(403, "unknown-sender");
		return { record: to.record, standin: standins.get(`${link.id}/${body.from}`), back: { from: to.record, to: body.from } };
	}

	/** A refusal as the user reads it: comm mismatch names both numbers (D6). */
	const explain = ([status, body]: Reply, peer: string) => status === 409 && body.error === "comm-mismatch"
		? commMismatch(body.comm, peer) ?? "comm mismatch" : status === 401 ? `${peer} hub no longer trusts this hub; pair again.` : String(body.error ?? `HTTP ${status}`);

	/** Pairs with the hub at `url`: returns the code to compare, then waits for approval on that hub in the background. */
	async function pairWith(input: string) {
		const me = self();
		if (!me) throw Object.assign(new Error("Turn on remote access first: hubs pair over the tailnet."), { status: 409 });
		let url: string, host: string;
		try { const parsed = new URL(input.includes("://") ? input : `https://${input}`); url = `https://${parsed.host}`; host = parsed.hostname; } catch { throw Object.assign(new Error("Enter the other hub's address, e.g. mac.tail1234.ts.net:7781."), { status: 400 }); }
		if (url === me.url) throw Object.assign(new Error("That is this hub."), { status: 400 });
		const started = await request(url, "pair-start", { comm: COMM, hub: { name: me.name } }).catch(error => fail(502, `Not reachable: ${(error as Error).message}`));
		if (started[0] !== 200) throw Object.assign(new Error(explain(started, url)), { status: 409 });
		const peer = cleanName(started[1].hub) || host.split(".")[0];
		const state = outgoing = { url, code: String(started[1].code), state: "pending" };
		void (async () => {
			const until = Date.now() + 130_000;
			while (Date.now() < until && outgoing === state) {
				const [status, body] = await request(url, "pair-status", { comm: COMM, id: started[1].id }).catch(error => fail(502, (error as Error).message));
				if (status !== 200) return Object.assign(state, { state: "failed", error: explain([status, body], peer) });
				if (body.state === "pending") continue;
				if (body.state !== "approved" || !CREDENTIAL.test(String(body.credential))) return Object.assign(state, { state: String(body.state) });
				const offer = await devices.pair(`Hub ${peer}`, me.login, "hub"), device = offer.split(".")[0];
				const finished = await request(url, "pair-finish", { comm: COMM, offer, hub: { name: me.name, url: me.url } }, String(body.credential)).catch(error => fail(502, (error as Error).message));
				if (finished[0] !== 200) { await devices.revoke(offer.split(".")[0]); return Object.assign(state, { state: "failed", error: explain(finished, peer) }); }
				peers.put({ name: peer, url, credential: String(body.credential), device, paired: Date.now() });
				return Object.assign(state, { state: "paired" });
			}
			if (state.state === "pending") Object.assign(state, { state: "expired" });
		})().catch(error => Object.assign(state, { state: "failed", error: (error as Error).message }));
		return { url, code: state.code };
	}

	const paired = (url: string) => peers.get(url) ?? (() => { throw Object.assign(new Error("That hub is not paired."), { status: 404 }); })();
	const call = async (url: string, op: string, body: Record<string, unknown>) => {
		const peer = paired(url), reply = await request(url, op, { comm: COMM, ...body }, peer.credential).catch(error => fail(502, `${peer.name} hub unreachable: ${(error as Error).message}`));
		return { peer, reply, error: reply[0] === 200 ? undefined : explain(reply, peer.name) };
	};

	/** Sessions of a paired hub for the link picker (D7). */
	async function remoteSessions(url: string) {
		const { reply, error } = await call(url, "sessions", {});
		if (error) throw Object.assign(new Error(error), { status: 409 });
		return { hub: reply[1].hub, sessions: reply[1].sessions };
	}

	/** Links a local session to `record` on the hub at `url`; stored here only after that hub stored it (D8). */
	async function link(session: string, url: string, record: string) {
		const me = self(), local = sessions().find(candidate => candidate.record === session);
		if (!me) throw Object.assign(new Error("Turn on remote access first: hubs link over the tailnet."), { status: 409 });
		if (!local) throw Object.assign(new Error("Unknown session."), { status: 404 });
		const id = randomUUID(), { reply, error } = await call(url, "link", { os: process.platform, link: { id, from: { record: session, name: local.name, folder: local.folder }, to: { record } } });
		if (error) throw Object.assign(new Error(error === "session-gone" ? "That session no longer exists on the other hub." : error), { status: 409 });
		const there = reply[1].session as { name?: unknown; folder?: unknown } | undefined;
		const made: Link = { id, session, hub: url, remote: { record, name: cleanName(there?.name) || "session", ...details(there?.folder, reply[1].os) }, created: Date.now() };
		// Stored there but not here: take it back there, so no half link stays.
		try { store.add(made); } catch (failure) { await call(url, "unlink", { link: id }); throw failure; }
		void sync();
		return { ...made, standin: standinName(made) };
	}

	/** Links this session's project folder to `folder` on the hub at `url` (D-01): every session there reaches every session here. */
	async function linkProject(session: string, url: string, folder: string) {
		const me = self(), local = sessions().find(candidate => candidate.record === session);
		if (!me) throw Object.assign(new Error("Turn on remote access first: hubs link over the tailnet."), { status: 409 });
		if (!local) throw Object.assign(new Error("Unknown session."), { status: 404 });
		if (store.list().some(item => item.kind === "project" && item.hub === url && sameFolder(item.folder, local.folder) && item.remote.folder === folder)) throw Object.assign(new Error("These projects are already linked."), { status: 409 });
		const id = randomUUID(), { reply, error } = await call(url, "link", { os: process.platform, link: { id, kind: "project", from: { folder: local.folder, sessions: listed(local.folder) }, to: { folder } } });
		if (error) throw Object.assign(new Error(error === "project-gone" ? "That project has no sessions on the other hub any more." : error), { status: 409 });
		const there = cleanFolder(reply[1].folder) ?? folder, made: Link = { id, kind: "project", folder: local.folder, hub: url, remote: { name: folderName(there) ?? "project", ...details(there, reply[1].os) }, created: Date.now() };
		try { store.add(made); } catch (failure) { await call(url, "unlink", { link: id }); throw failure; }
		remotes.set(id, cleanSessions(reply[1].sessions));
		await sync();
		return { ...made, standins: [...standins.values()].filter(standin => standin.link.id === id).map(standin => standin.name) };
	}

	/** Unlinks here at once; the other hub hears now, or later from the pending list (D12). */
	async function unlink(id: string) {
		const removed = store.remove(id, true);
		if (!removed) return { ok: false };
		void sync();
		const { error } = await call(removed.hub, "unlink", { link: id }).catch(failure => ({ error: (failure as Error).message }));
		if (!error) store.confirmed(id);
		return { ok: true, ...(error ? { pending: error } : {}) };
	}

	// S07 stand-ins (D9-D13): one pi-intercom session per link, named for the other side, while that hub is online;
	// a project link has one per session of the other project, parked ones too: a message resumes them (D-01, D-10), keyed `<link>/<record>`.
	type Remote = Link["remote"];
	type Standin = { link: Link; to: Remote; name: string; key: string; client: any };
	const standinId = (link: Link, to: Remote) => link.kind === "project" ? `${link.id}/${to.record}` : link.id;
	const targets = (link: Link): Remote[] => link.kind !== "project" ? [link.remote]
		: (remotes.get(link.id) ?? []).map(({ record, name }) => ({ ...link.remote, record, name }));
	const standins = new Map<string, Standin>(), offline = new Set<string>(), misses = new Map<string, number>();
	let unavailable: string | undefined, client: Promise<IntercomLoad> | undefined, syncing = Promise.resolve(), ticking = false, timer: NodeJS.Timeout | undefined;
	const safe = (text: string) => text.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "session";
	const hubName = (link: Link) => peers.get(link.hub)?.name ?? link.hub.slice(8).split(".")[0];
	function standinName(link: Link, to = link.remote) {
		// "emailupload-1~flexpc": the folder tells apart sessions that share a name ("1") across projects.
		const hub = safe(hubName(link)), folder = folderName(to.folder), who = (folder ? `${safe(folder)}-` : "") + safe(to.name), plain = `${who}~${hub}`, id = standinId(link, to);
		// shortcut: collisions checked against this hub's sessions and stand-ins only, not other intercom sessions on the machine; upgrade if names clash in practice.
		const taken = new Set([...sessions().map(s => s.name.toLowerCase()), ...[...standins].filter(([other]) => other !== id).map(([, s]) => s.name)]);
		return taken.has(plain) ? `${who}-${(to.record ?? "").slice(0, 4)}~${hub}` : plain;
	}
	/** Where the other session runs ("FlexPC (Windows): C:\\x\\emailupload"), shown as the stand-in's intercom cwd. */
	const remotePlace = (link: Link) => `${hubName(link)}${link.remote.os ? ` (${OS_NAMES[link.remote.os] ?? link.remote.os})` : ""}: ${link.remote.folder ?? link.hub}`;
	/** This hub's session a link belongs to; only it may send through the stand-in (D9). A project link belongs to its folder. */
	const owner = (link: Link) => {
		if (link.kind === "project") return `project ${folderName(link.folder) ?? link.folder}`;
		const local = sessions().find(s => s.record === link.session); return local ? sessionRef(local.folder, local.name) : undefined;
	};
	/** What intercom shows for a stand-in: name, the remote place as cwd, and its owner as the model column. */
	const describe = (link: Link, to = link.remote) => ({ name: standinName(link, to), cwd: remotePlace(link), model: `hub-link for ${owner(link) ?? "a removed session"}; files: attach {type:"file", content:"@<absolute path>"}, 5 MB total` });
	/** The local session behind intercom id `from` that may send through a link's stand-ins, if any. */
	async function senderOf(link: Link, from: string) {
		for (const session of link.kind === "project" ? inFolder(link.folder!) : sessions().filter(s => s.record === link.session)) if (from === await options.intercom!.intercomId(session.record)) return session;
	}

	/** Starts and stops stand-ins to match the links whose hub is online; serialized, never throws. */
	const sync = () => syncing = syncing.then(async () => {
		let links: Link[] = [];
		try { links = store.list(); } catch { /* corrupt list: every stand-in off */ }
		const wanted = new Map(links.filter(item => !offline.has(item.hub) && peers.get(item.hub)).flatMap(link => targets(link).map(to => [standinId(link, to), { link, to }] as const)));
		// A changed name, folder, OS or owner re-registers the stand-in under the same id (D11).
		for (const [id, standin] of standins) { const now = wanted.get(id); if (!now || JSON.stringify(describe(now.link, now.to)) !== standin.key) { standins.delete(id); await standin.client.disconnect().catch(() => {}); } }
		if (!wanted.size || !options.intercom) return;
		const loaded = await (client ??= (options.intercom.load ?? loadIntercom)());
		unavailable = loaded.unavailable;
		if (!loaded.IntercomClient) return;
		for (const [id, { link, to }] of wanted) if (!standins.has(id)) {
			const shown = describe(link, to), standin: Standin = { link, to, name: shown.name, key: JSON.stringify(shown), client: new loaded.IntercomClient() }, now = Date.now();
			standin.client.on("message", (from: { id: string }, message: any) => void forward(standin, from, message).catch(() => {}));
			standin.client.on("error", () => {});
			standin.client.on("disconnected", () => { if (standins.get(id) === standin) standins.delete(id); });
			try {
				// A fixed id per link (and remote session): a reconnect gets pi-intercom's mailbox for plain sends made while offline (D11, D13).
				await standin.client.connect({ cwd: shown.cwd, model: shown.model, pid: process.pid, startedAt: now, lastActivity: now, name: standin.name, status: "idle", acknowledgesReceipts: true }, `hublink-${id.replace("/", "-")}`);
				standins.set(id, standin);
			} catch { /* broker not running: the next ping retries */ }
		}
	}).catch(() => {});

	/** A local message to a stand-in: only its linked session's crosses (D9); the receipt waits for the other hub (S02). */
	async function forward({ link, to, name, client }: Standin, from: { id: string }, message: { id: string; content?: { text?: string; attachments?: Attachment[] }; expectsReply?: boolean; replyTo?: string }) {
		const tell = (text: string) => client.send(from.id, { text }).catch(() => {}), sender = await senderOf(link, from.id);
		if (!sender && link.kind === "project") return void tell(`${name} is linked to ${owner(link)} on this hub; only its sessions may send through it. Not forwarded.`);
		if (!sender) { const local = sessions().find(s => s.record === link.session); return void tell(`${name} is linked to ${local ? sessionRef(local.folder, local.name) : "another session"} on this hub, not to this session; not forwarded. Only that session may send through it.`); }
		const peer = peers.get(link.hub)?.name ?? link.hub, route = link.kind === "project" ? { from: sender.record, to: to.record } : {}, started = Date.now();
		// D-06: `@path` file attachments travel as files; any other attachment as text, the way pi-intercom shows it.
		const attachments = Array.isArray(message.content?.attachments) ? message.content.attachments : [];
		const files = attachments.filter(item => item?.type === "file" && typeof item.content === "string" && item.content.startsWith("@"));
		let text = (message.content?.text ?? "") + attachments.filter(item => !files.includes(item)).map(item => `\n\n---\nAttachment: ${item.name}\n${item.language ? `~~~${item.language}\n${item.content}\n~~~` : item.content}`).join("");
		// D-08: files go first, each by its own `/link/file`; a failure here is told back and never takes the hub offline.
		if (files.length) {
			let checked: Awaited<ReturnType<typeof checkFiles>>;
			try { checked = await checkFiles(files, sender.folder); } catch (error) { return void tell(`Not delivered to ${name}: ${(error as Error).message}.`); }
			for (const file of checked) {
				const saved = await call(link.hub, "file", { link: link.id, ...route, file: { name: file.name, data: (await readFile(file.real)).toString("base64") } });
				if (saved.error) return void tell(`Not delivered to ${name}: ${file.name} was not saved on ${peer} (${saved.error}).`);
				text += `\n\n---\nFile: ${file.name} (${megabytes(file.size)}) saved at ${saved.reply[1].path}`;
			}
		}
		const delivering = call(link.hub, "deliver", { link: link.id, ...route, message: { id: message.id, text, ...(message.expectsReply ? { expectsReply: true } : {}), ...(message.replyTo ? { replyTo: message.replyTo } : {}) } });
		const sent = await (files.length ? delivering : Promise.race([delivering, new Promise<undefined>(done => setTimeout(done, DELIVER_MS))])).catch(() => undefined);
		if (sent && !sent.error) {
			client.sendMessageReceipt({ messageId: message.id, status: "receiver_received", timestamp: Date.now() });
			// Past pi-intercom's receipt window the sender already saw "not confirmed": tell it the files did arrive.
			if (Date.now() - started > DELIVER_MS) await tell(`Delivered to ${name} after all, with ${files.length} file(s); the files took ${Math.round((Date.now() - started) / 1000)} s.`);
			return;
		}
		const code = sent?.reply[1].error, reason = sent?.reply[1].reason;
		const cause = !sent ? `${peer} hub did not answer within ${DELIVER_MS / 1000} s` : code === "not-linked" ? `the link was removed on ${peer}`
			: code === "session-gone" ? `${to.name} on ${peer} was closed` : code === "not-delivered" ? `${to.name} on ${peer} did not take it (${reason})`
			: code === "not-in-project" ? `${to.name} on ${peer} is no longer in the linked project` : code === "unknown-sender" ? `${peer} does not list this session in the linked project` : sent.error!;
		// The cause first, while this stand-in is still connected; then an unreachable hub takes its stand-ins offline (D13).
		await tell(`Not delivered to ${name}: ${cause}.`);
		if (!sent || sent.reply[0] === 502 && code !== "not-delivered") { offline.add(link.hub); void sync(); }
	}

	/** A parked target: resume it, wait until it joins intercom (60 s), then send; a failure goes back as a message. */
	async function wakeAndSend(link: Link, standin: Standin, send: Record<string, unknown>, record: string, localName: string, back: Record<string, unknown>) {
		try {
			await options.intercom!.wake?.(record);
			let target: string | undefined;
			for (const until = Date.now() + 60_000; Date.now() < until; await new Promise(done => setTimeout(done, 1000))) {
				const id = await options.intercom!.intercomId(record);
				if (id && (await standin.client.listSessions()).some((s: { id: string }) => s.id === id)) { target = id; break; }
			}
			if (!target) throw new Error(`${localName} did not join intercom within 60 s`);
			const result = await standin.client.send(target, send);
			if (!result.delivered) throw new Error(result.reason ?? "not delivered");
		} catch (error) {
			await call(link.hub, "deliver", { link: link.id, ...back, message: { id: randomUUID(), text: `Not delivered to ${localName}: ${(error as Error).message}.` } }).catch(() => {});
		}
	}

	/** Every 30 s: ping each linked hub; two misses take its stand-ins offline, a success brings them back, carries renames
	 * (D11), drops links the other hub no longer has and retries unconfirmed unlinks (D12). */
	async function tick() {
		if (ticking) return;
		ticking = true;
		try {
			const links = store.list(), unlinks = store.unlinks();
			for (const url of new Set([...links.map(item => item.hub), ...unlinks.map(item => item.hub)])) if (peers.get(url)) await refresh(url, links, unlinks);
		} catch { /* corrupt list or unpaired hub: nothing to ping */ } finally { ticking = false; }
		await sync();
	}
	/** One hub's ping: offline after two misses, renames and project sessions from the reply, pending unlinks retried. */
	async function refresh(url: string, links = store.list(), unlinks = store.unlinks()) {
		const { reply, error } = await call(url, "ping", {});
		if (error) { const missed = (misses.get(url) ?? 0) + 1; misses.set(url, missed); if (missed >= 2) offline.add(url); return; }
		misses.delete(url); offline.delete(url);
		const theirs = new Map((Array.isArray(reply[1].links) ? reply[1].links : []).map((item: { id: string; name: unknown; folder?: unknown; sessions?: unknown }) => [item.id, item]));
		for (const link of links.filter(item => item.hub === url)) {
			const item = theirs.get(link.id);
			// A minute's grace: the hub that started a link stores it just after this one.
			if (item === undefined) { if (Date.now() - link.created > 60_000) store.remove(link.id); continue; }
			if (link.kind === "project") remotes.set(link.id, cleanSessions(item.sessions));
			const remote = { ...link.remote, ...(link.kind !== "project" && cleanName(item.name) ? { name: cleanName(item.name) } : {}), ...details(item.folder, reply[1].os) };
			if (JSON.stringify(remote) !== JSON.stringify(link.remote)) store.add({ ...link, remote });
		}
		for (const item of unlinks.filter(u => u.hub === url)) if (!(await call(url, "unlink", { link: item.id })).error) store.confirmed(item.id);
	}

	return {
		serve,
		pairWith,
		remoteSessions,
		tick,
		sync,
		standins: () => [...standins.values()].map(({ link, name }) => ({ id: link.id, name })),
		start() { void tick(); timer = setInterval(() => void tick(), PING_MS); timer.unref(); },
		async stop() {
			clearInterval(timer);
			await syncing;
			await Promise.all([...standins.values()].map(standin => standin.client.disconnect().catch(() => {})));
			standins.clear();
		},
		link,
		linkProject,
		unlink,
		/** A session's links with their hub names, for its menu (D7), plus its folder's project links (D-01). */
		linksOf: (session: string) => {
			const mine = sessions().find(s => s.record === session);
			return store.list().filter(item => item.kind === "project" ? sameFolder(item.folder, mine?.folder) : item.session === session).map(item => ({ ...item, hubName: peers.get(item.hub)?.name ?? item.hub, online: !offline.has(item.hub),
				standin: item.kind === "project" ? null : standins.get(item.id)?.name ?? null, standins: [...standins.values()].filter(s => s.link.id === item.id).map(s => s.name),
				label: `${item.kind === "project" ? `project ${item.remote.name}` : sessionRef(item.remote.folder, item.remote.name)} on ${hubName(item)}${item.remote.os ? ` (${OS_NAMES[item.remote.os] ?? item.remote.os})` : ""}` }));
		},
		store,
		/** For the local page: paired hubs (no credentials) and the pairing in progress. */
		state: () => ({ comm: COMM, hubs: peers.list().map(({ name, url, paired }) => ({ name, url, paired, online: !offline.has(url) })), pairing: outgoing ?? null, ...(unavailable ? { unavailable } : {}) }),
		peers,
	};
}

/** A pi-intercom message attachment (its types.ts). */
type Attachment = { type: string; name: string; content: string; language?: string };
/** One link (D8, D10): a session on this hub and a session record on a paired hub; or (kind project, D-04) a folder here and a folder there. */
export type Link = { id: string; kind?: "project"; session?: string; folder?: string; hub: string; remote: { record?: string; name: string; folder?: string; os?: string }; created: number };
/** The optional remote details, only those the other hub sent (older hubs send none). */
const details = (folder: unknown, os: unknown) => ({ ...(cleanFolder(folder) ? { folder: cleanFolder(folder) } : {}), ...(cleanOs(os) ? { os: cleanOs(os) } : {}) });
const validLink = (link: Link) => typeof link?.id === "string" && /^https:\/\/[^/\s]+$/.test(link.hub) && typeof link.remote?.name === "string" && Number.isFinite(link.created)
	&& (link.kind === "project" ? typeof link.folder === "string" && typeof link.remote.folder === "string" : link.kind === undefined && typeof link.session === "string" && typeof link.remote.record === "string");

/** Links in `<dataDir>/links.json`, plus unlinks the other hub has not confirmed yet (D12); corrupt fails closed. */
export function createLinkStore(dataDir: string) {
	const file = path.join(dataDir, "links.json");
	type State = { links: Link[]; unlinks: { id: string; hub: string }[] };
	function load(): State {
		let text: string;
		try { text = readFileSync(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { links: [], unlinks: [] }; throw error; }
		try {
			const value = JSON.parse(text);
			if (value?.version !== 1 || !Array.isArray(value.links) || !value.links.every(validLink) || !Array.isArray(value.unlinks)) throw new Error("shape");
			return { links: value.links, unlinks: value.unlinks };
		} catch { throw new Error(`Hub link list is corrupt; hub links are off until ${file} is fixed or deleted.`); }
	}
	const change = <T>(edit: (state: State) => T) => { const state = load(), result = edit(state); writeJsonAtomic(file, { version: 1, ...state }); return result; };
	return {
		file,
		list: () => load().links,
		unlinks: () => load().unlinks,
		add: (link: Link) => { if (!validLink(link)) throw new Error("Invalid link."); change(state => { state.links = [...state.links.filter(other => other.id !== link.id), link]; }); },
		/** Drops the link; `pending` keeps telling its hub until it confirms (D12). */
		remove: (id: string, pending?: boolean) => change(state => {
			const link = state.links.find(other => other.id === id);
			state.links = state.links.filter(other => other.id !== id);
			if (link && pending) state.unlinks.push({ id, hub: link.hub });
			return link;
		}),
		confirmed: (id: string) => change(state => { state.unlinks = state.unlinks.filter(other => other.id !== id); }),
	};
}

/** What a stand-in needs from pi-intercom's client (S01): one connection per session, receipts and replies. */
const NEEDED = ["connect", "send", "sendMessageReceipt", "listSessions", "disconnect", "on"];
export type IntercomLoad = { IntercomClient?: new () => any; unavailable?: string };

/** Loads pi-intercom's broker client next to this package, else from Pi's own packages; links are off without it. */
export async function loadIntercom(roots = intercomRoots()): Promise<IntercomLoad> {
	const root = roots.find(candidate => existsSync(path.join(candidate, "broker", "client.ts")));
	if (!root) return { unavailable: "pi-intercom is not installed; install it (pi install npm:pi-intercom) to link sessions across hubs." };
	try {
		// Node refuses to strip types under node_modules, so the client loads through jiti (Extension File Rule).
		const { createJiti } = await import("jiti");
		const module: any = await createJiti(import.meta.url).import(path.join(root, "broker", "client.ts"));
		const missing = NEEDED.filter(name => typeof module?.IntercomClient?.prototype?.[name] !== "function");
		if (missing.length) return { unavailable: `pi-intercom at ${root} lacks ${missing.join(", ")}; update pi-intercom to link sessions across hubs.` };
		return { IntercomClient: module.IntercomClient };
	} catch (error) {
		return { unavailable: `pi-intercom could not be loaded: ${(error as Error).message}` };
	}
}

function intercomRoots() {
	const roots: string[] = [];
	try { roots.push(path.dirname(createRequire(import.meta.url).resolve("pi-intercom/package.json"))); } catch { /* not beside this package */ }
	roots.push(path.join(agentDir(), "npm", "node_modules", "pi-intercom"));
	return roots;
}
