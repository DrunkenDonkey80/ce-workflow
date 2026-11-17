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

// 3: shared projects (plan 4d2fa07b): `link`, `unlink` and `sessions` gone; `ping` carries both hubs' shared projects and reply
// pairs; `deliver` and `file` carry from {record, name, folder} and to; `unpair`.
export const COMM = 3;
/** `ping` lists every shared project with up to 100 sessions each: more than the 64 KB the other small ops get. */
export const PING_BODY = 1024 * 1024;
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
/** A project the other hub shares with this one (D-02): its folder there and its sessions. */
type RemoteProject = { folder: string; sessions: RemoteSession[] };
const cleanProjects = (value: unknown): RemoteProject[] => Array.isArray(value) ? value.slice(0, 100)
	.flatMap(item => { const folder = cleanFolder(item?.folder); return folder ? [{ folder, sessions: cleanSessions(item.sessions) }] : []; }) : [];
/** The sending session of a `deliver` or `file`, as its hub names it. */
const cleanFrom = (value: any): Pair["remote"] | undefined => typeof value?.record === "string" && value.record.length > 0 && value.record.length <= 100
	? { record: value.record, name: cleanName(value.name) || "session", ...(cleanFolder(value.folder) ? { folder: cleanFolder(value.folder) } : {}) } : undefined;

/** The `/link/` operations (plan section "Comm protocol") and this hub's side of pairing with another hub. */
export function createLinks(options: {
	dataDir: string;
	devices: ReturnType<typeof createDeviceRegistry>;
	pairing: ReturnType<typeof createPairing>;
	/** This hub's name and tailnet address; undefined while remote access is off. */
	self: () => { name: string; url: string; login: string } | undefined;
	/** This hub's sessions: its active projects (D-02) and the ends of messages. */
	sessions: () => { record: string; name: string; folder: string; live: boolean }[];
	onPairing?: () => void;
	request?: LinkRequest;
	/** Stand-ins (S07): a record's current intercom id (D10), resuming a parked record, and the pi-intercom client loader. */
	intercom?: { intercomId: (record: string) => Promise<string | undefined>; wake?: (record: string) => Promise<unknown>; load?: () => Promise<IntercomLoad> };
}) {
	const { devices, pairing, self, sessions, request = fetchRequest } = options, peers = createPeers(options.dataDir), store = createLinkStore(options.dataDir);
	let outgoing: { url: string; code?: string; state: string; error?: string } | undefined;
	const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Reply => [status, { comm: COMM, error, ...extra }];
	const listed = (folder: string) => sessions().filter(session => sameFolder(session.folder, folder)).map(({ record, name, live }) => ({ record, name, live }));
	/** What each paired hub shares with this one, from the last ping either way (memory only: the first ping after a start fills it). */
	const remotes = new Map<string, { os?: string; projects: RemoteProject[] }>();
	/** This hub's folders shared with the hub at `url`; a share whose folder is gone is not served (and pruned at the next tick). */
	const sharedWith = (url: string) => store.shares().filter(share => share.hub === url && existsSync(share.folder)).map(share => share.folder);
	const isShared = (url: string, folder: string) => sharedWith(url).some(shared => sameFolder(shared, folder));
	const pairOf = (url: string, local: string, remote: string) => store.pairs().find(pair => pair.hub === url && pair.local === local && pair.remote.record === remote);
	const info = (session: { record: string; name: string; folder: string }) => ({ record: session.record, name: session.name, folder: session.folder });

	/** This hub's half of a ping: its projects shared with `url`, and its reply pairs with `url` whose local session still exists. */
	function mine(url: string) {
		const local = new Map(sessions().map(session => [session.record, session]));
		return { hub: self()?.name, os: process.platform, projects: sharedWith(url).map(folder => ({ folder, sessions: listed(folder) })),
			paired: store.pairs().filter(pair => pair.hub === url && local.has(pair.local)).map(pair => ({ ...info(local.get(pair.local)!), with: pair.remote.record })) };
	}
	/** The other hub's half: what it shares; a pair it no longer has ends here too, after a minute's grace (it stores its side just after). */
	function apply(url: string, data: Record<string, unknown>) {
		remotes.set(url, { os: cleanOs(data.os), projects: cleanProjects(data.projects) });
		const theirs: any[] = Array.isArray(data.paired) ? data.paired.slice(0, 1000) : [];
		for (const pair of store.pairs().filter(item => item.hub === url)) {
			const item = theirs.find(other => other?.record === pair.remote.record && other?.with === pair.local);
			if (!item) { if (Date.now() - pair.created > 60_000) store.prune(() => true, other => !samePair(other, pair)); continue; }
			const remote = cleanFrom(item) ?? pair.remote;
			if (JSON.stringify(remote) !== JSON.stringify(pair.remote)) store.addPair({ ...pair, remote });
		}
	}

	/** Answers one `/link/<op>` after the hub checked the tailnet owner; credential, then comm, then payload. */
	async function serve(op: string, headers: Headers, data: unknown, login: string, closed: Promise<unknown>): Promise<Reply> {
		if (!data || typeof data !== "object" || Array.isArray(data)) return fail(400, "Expected a JSON object.");
		const body = data as { comm?: unknown; id?: unknown; offer?: unknown; hub?: { name?: unknown; url?: unknown }; message?: unknown; from?: unknown; to?: unknown; file?: unknown }, open = op === "pair-start" || op === "pair-status";
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
			if (op === "unpair") { await forget(caller!); return [200, { comm: COMM }]; }
			// A call from a hub proves it is back: its stand-ins reconnect (D13).
			misses.delete(caller!.url);
			if (offline.delete(caller!.url)) await sync();
			// Both halves travel in one ping, so a share change reaches the other hub with the next call either way.
			if (op === "ping") { apply(caller!.url, body as Record<string, unknown>); void sync(); return [200, { comm: COMM, ...mine(caller!.url) }]; }
			if (op === "file") {
				const file = body.file as { name?: unknown; data?: unknown } | undefined;
				if (typeof file?.data !== "string") return fail(400, "file.data required.");
				const bytes = Buffer.from(file.data, "base64");
				if (bytes.length > FILES_MAX) return fail(413, `over the 5 MB limit (${megabytes(bytes.length)})`);
				const end = await authorize(caller!, body);
				if (Array.isArray(end)) return end;
				return [200, { comm: COMM, path: await saveInbox(end.local.folder, bytes, file.name) }];
			}
			if (op === "deliver") {
				const message = body.message as { id?: unknown; text?: unknown; expectsReply?: unknown; replyTo?: unknown } | undefined;
				if (typeof message?.id !== "string" || message.id.length > 100 || typeof message.text !== "string" || (message.replyTo !== undefined && typeof message.replyTo !== "string")) return fail(400, "message.id and message.text required.");
				const end = await authorize(caller!, body);
				if (Array.isArray(end)) return end;
				const { local, from, standin } = end;
				if (!standin) return fail(502, "not-delivered", { reason: unavailable ?? "its stand-in is not connected" });
				const send = { text: message.text, messageId: message.id, ...(message.expectsReply === true ? { expectsReply: true } : {}), ...(message.replyTo ? { replyTo: message.replyTo } : {}) };
				if (!local.live) { void wakeAndSend(caller!.url, standin, send, local, from.record); return [200, { comm: COMM, delivered: true, resuming: true }]; }
				const target = await options.intercom!.intercomId(local.record);
				const result = target ? await standin.client.send(target, send).catch((error: Error) => ({ delivered: false, reason: error.message })) : { delivered: false, reason: "it has no intercom session" };
				return result.delivered ? [200, { comm: COMM, delivered: true }] : fail(502, "not-delivered", { reason: result.reason ?? "not delivered" });
			}
		} catch (error) {
			return fail((error as { status?: number }).status ?? 500, (error as Error).message);
		}
		return fail(404, "Unknown link operation.");
	}

	/** D-03, D-11: a `deliver` or `file` from any session of the caller lands on `to` when this hub shares `to`'s project with the
	 * caller (which starts a reply pair), or along an existing reply pair; the sender's stand-in here carries the answer back. */
	async function authorize(caller: Peer, body: { from?: unknown; to?: unknown }): Promise<Reply | { local: ReturnType<typeof sessions>[number]; from: Pair["remote"]; standin?: Standin }> {
		const from = cleanFrom(body.from), local = typeof body.to === "string" ? sessions().find(session => session.record === body.to) : undefined;
		if (!from || typeof body.to !== "string") return fail(400, "from and to required.");
		if (!local) return fail(410, "session-gone");
		if (!pairOf(caller.url, local.record, from.record)) {
			if (!isShared(caller.url, local.folder)) return fail(403, "not-shared");
			store.addPair({ hub: caller.url, local: local.record, remote: from, created: Date.now() });
		}
		const id = `${caller.device}/${from.record}`;
		if (!standins.has(id)) await sync();
		return { local, from, standin: standins.get(id) };
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

	/** D-02, D-05: shares (or stops sharing) one of this hub's active projects with the hub at `url`; that hub hears it at once when online. */
	async function share(url: string, folder: string, on: boolean) {
		paired(url);
		const local = sessions().find(session => sameFolder(session.folder, folder))?.folder ?? sharedWith(url).find(shared => sameFolder(shared, folder));
		// Only an active project of this hub: a share opens its folder to the remote read tools.
		if (!local) throw Object.assign(new Error("Not an active project on this hub."), { status: 404 });
		store.setShare(url, local, on);
		await refresh(url);
		await sync();
		return state();
	}

	/** Unpairs from the hub at `url`: that hub is told (best effort) and both drop each other's shares and reply pairs. */
	async function unpair(url: string) {
		const peer = paired(url);
		await call(url, "unpair", {}).catch(() => {});
		await forget(peer);
		return { ok: true };
	}
	async function forget(peer: Peer) {
		peers.remove(peer.url);
		await devices.revoke(peer.device);
		store.dropHub(peer.url);
		remotes.delete(peer.url); offline.delete(peer.url); misses.delete(peer.url);
		await sync();
	}

	// S07 stand-ins (D9-D13): one pi-intercom session per remote session this hub may reach, named for it, while its hub is
	// online: every session of a project shared with this hub (parked ones too: a message resumes them), and the other end of
	// each reply pair (D-11). Keyed `<hub device>/<record>`.
	type Target = Pair["remote"];
	type Standin = { hub: string; to: Target; reply: boolean; name: string; key: string; client: any };
	const standins = new Map<string, Standin>(), offline = new Set<string>(), misses = new Map<string, number>();
	let unavailable: string | undefined, client: Promise<IntercomLoad> | undefined, syncing = Promise.resolve(), ticking = false, timer: NodeJS.Timeout | undefined;
	const safe = (text: string) => text.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "session";
	const hubName = (url: string) => peers.get(url)?.name ?? url.slice(8).split(".")[0];
	const osName = (url: string) => { const os = remotes.get(url)?.os; return os ? ` (${OS_NAMES[os] ?? os})` : ""; };
	function standinName(url: string, to: Target, id: string) {
		// "emailupload-1~flexpc": the folder tells apart sessions that share a name ("1") across projects.
		const hub = safe(hubName(url)), folder = folderName(to.folder), who = (folder ? `${safe(folder)}-` : "") + safe(to.name), plain = `${who}~${hub}`;
		// shortcut: collisions checked against this hub's sessions and stand-ins only, not other intercom sessions on the machine; upgrade if names clash in practice.
		const taken = new Set([...sessions().map(s => s.name.toLowerCase()), ...[...standins].filter(([other]) => other !== id).map(([, s]) => s.name)]);
		return taken.has(plain) ? `${who}-${to.record.slice(0, 4)}~${hub}` : plain;
	}
	/** This hub's sessions that may send through a reply stand-in: those paired with its remote session. */
	const repliers = (url: string, record: string) => sessions().filter(session => pairOf(url, session.record, record));
	/** What intercom shows for a stand-in: name, the remote place as cwd ("mac (macOS): /Users/f/belot"), and who may send as the model column. */
	const describe = (url: string, to: Target, reply: boolean, id: string) => ({ name: standinName(url, to, id), cwd: `${hubName(url)}${osName(url)}: ${to.folder ?? url}`,
		model: `hub-link ${reply ? `reply to ${repliers(url, to.record).map(s => sessionRef(s.folder, s.name)).join(", ") || "a removed session"}` : `shared by ${hubName(url)}`}; files: attach {type:"file", content:"@<absolute path>"}, 5 MB total` });
	/** The local session behind intercom id `from` that may send through a stand-in: any session of this hub (D-03), only paired ones for a reply stand-in. */
	async function senderOf({ hub, to, reply }: Standin, from: string) {
		for (const session of reply ? repliers(hub, to.record) : sessions()) if (from === await options.intercom!.intercomId(session.record)) return session;
	}
	function wanted() {
		const out = new Map<string, { hub: string; to: Target; reply: boolean }>(), pairs = store.pairs(), local = new Set(sessions().map(s => s.record));
		for (const peer of peers.list()) {
			if (offline.has(peer.url)) continue;
			for (const project of remotes.get(peer.url)?.projects ?? []) for (const { record, name } of project.sessions) out.set(`${peer.device}/${record}`, { hub: peer.url, to: { record, name, folder: project.folder }, reply: false });
			for (const pair of pairs) if (pair.hub === peer.url && local.has(pair.local) && !out.has(`${peer.device}/${pair.remote.record}`)) out.set(`${peer.device}/${pair.remote.record}`, { hub: peer.url, to: pair.remote, reply: true });
		}
		return out;
	}

	/** Starts and stops stand-ins to match what paired, online hubs share and the reply pairs; serialized, never throws. */
	const sync = () => syncing = syncing.then(async () => {
		let want = new Map<string, { hub: string; to: Target; reply: boolean }>();
		try { want = wanted(); } catch { /* corrupt list: every stand-in off */ }
		// A changed name, folder, OS or sender list re-registers the stand-in under the same id (D11).
		for (const [id, standin] of standins) { const now = want.get(id); if (!now || JSON.stringify(describe(now.hub, now.to, now.reply, id)) !== standin.key) { standins.delete(id); await standin.client.disconnect().catch(() => {}); } }
		if (!want.size || !options.intercom) return;
		const loaded = await (client ??= (options.intercom.load ?? loadIntercom)());
		unavailable = loaded.unavailable;
		if (!loaded.IntercomClient) return;
		for (const [id, { hub, to, reply }] of want) if (!standins.has(id)) {
			const shown = describe(hub, to, reply, id), standin: Standin = { hub, to, reply, name: shown.name, key: JSON.stringify(shown), client: new loaded.IntercomClient() }, now = Date.now();
			standin.client.on("message", (from: { id: string }, message: any) => void forward(standin, from, message).catch(() => {}));
			standin.client.on("error", () => {});
			standin.client.on("disconnected", () => { if (standins.get(id) === standin) standins.delete(id); });
			try {
				// A fixed id per remote session: a reconnect gets pi-intercom's mailbox for plain sends made while offline (D11, D13).
				await standin.client.connect({ cwd: shown.cwd, model: shown.model, pid: process.pid, startedAt: now, lastActivity: now, name: standin.name, status: "idle", acknowledgesReceipts: true }, `hublink-${id.replace("/", "-")}`);
				standins.set(id, standin);
			} catch { /* broker not running: the next ping retries */ }
		}
	}).catch(() => {});

	/** A local message to a stand-in: the receipt waits for the other hub (S02); a delivered first message starts a reply pair (D-11). */
	async function forward(standin: Standin, from: { id: string }, message: { id: string; content?: { text?: string; attachments?: Attachment[] }; expectsReply?: boolean; replyTo?: string }) {
		const { hub, to, name, client } = standin, tell = (text: string) => client.send(from.id, { text }).catch(() => {}), sender = await senderOf(standin, from.id);
		if (!sender) return void tell(standin.reply ? `${name} carries replies for ${repliers(hub, to.record).map(s => sessionRef(s.folder, s.name)).join(", ") || "a removed session"} only; not forwarded. Its project is not shared with this hub.` : `${name} takes messages from this hub's sessions only; not forwarded.`);
		const peer = peers.get(hub)?.name ?? hub, route = { from: info(sender), to: to.record }, started = Date.now();
		// D-06: `@path` file attachments travel as files; any other attachment as text, the way pi-intercom shows it.
		const attachments = Array.isArray(message.content?.attachments) ? message.content.attachments : [];
		const files = attachments.filter(item => item?.type === "file" && typeof item.content === "string" && item.content.startsWith("@"));
		let text = (message.content?.text ?? "") + attachments.filter(item => !files.includes(item)).map(item => `\n\n---\nAttachment: ${item.name}\n${item.language ? `~~~${item.language}\n${item.content}\n~~~` : item.content}`).join("");
		// D-08: files go first, each by its own `/link/file`; a failure here is told back and never takes the hub offline.
		if (files.length) {
			let checked: Awaited<ReturnType<typeof checkFiles>>;
			try { checked = await checkFiles(files, sender.folder); } catch (error) { return void tell(`Not delivered to ${name}: ${(error as Error).message}.`); }
			for (const file of checked) {
				const saved = await call(hub, "file", { ...route, file: { name: file.name, data: (await readFile(file.real)).toString("base64") } });
				if (saved.error) return void tell(`Not delivered to ${name}: ${file.name} was not saved on ${peer} (${saved.error}).`);
				text += `\n\n---\nFile: ${file.name} (${megabytes(file.size)}) saved at ${saved.reply[1].path}`;
			}
		}
		const delivering = call(hub, "deliver", { ...route, message: { id: message.id, text, ...(message.expectsReply ? { expectsReply: true } : {}), ...(message.replyTo ? { replyTo: message.replyTo } : {}) } });
		const sent = await (files.length ? delivering : Promise.race([delivering, new Promise<undefined>(done => setTimeout(done, DELIVER_MS))])).catch(() => undefined);
		if (sent && !sent.error) {
			if (!pairOf(hub, sender.record, to.record)) { store.addPair({ hub, local: sender.record, remote: to, created: Date.now() }); void sync(); }
			client.sendMessageReceipt({ messageId: message.id, status: "receiver_received", timestamp: Date.now() });
			// Past pi-intercom's receipt window the sender already saw "not confirmed": tell it the files did arrive.
			if (Date.now() - started > DELIVER_MS) await tell(`Delivered to ${name} after all, with ${files.length} file(s); the files took ${Math.round((Date.now() - started) / 1000)} s.`);
			return;
		}
		const code = sent?.reply[1].error, reason = sent?.reply[1].reason;
		const cause = !sent ? `${peer} hub did not answer within ${DELIVER_MS / 1000} s` : code === "not-shared" ? `${peer} does not share ${to.name}'s project with this hub, and ${to.name} never wrote to ${sessionRef(sender.folder, sender.name)}`
			: code === "session-gone" ? `${to.name} on ${peer} was closed` : code === "not-delivered" ? `${to.name} on ${peer} did not take it (${reason})` : sent.error!;
		// The cause first, while this stand-in is still connected; then an unreachable hub takes its stand-ins offline (D13).
		await tell(`Not delivered to ${name}: ${cause}.`);
		if (!sent || sent.reply[0] === 502 && code !== "not-delivered") { offline.add(hub); void sync(); }
	}

	/** A parked target: resume it, wait until it joins intercom (60 s), then send; a failure goes back to the sender as a message. */
	async function wakeAndSend(url: string, standin: Standin, send: Record<string, unknown>, local: ReturnType<typeof sessions>[number], sender: string) {
		try {
			await options.intercom!.wake?.(local.record);
			let target: string | undefined;
			for (const until = Date.now() + 60_000; Date.now() < until; await new Promise(done => setTimeout(done, 1000))) {
				const id = await options.intercom!.intercomId(local.record);
				if (id && (await standin.client.listSessions()).some((s: { id: string }) => s.id === id)) { target = id; break; }
			}
			if (!target) throw new Error(`${local.name} did not join intercom within 60 s`);
			const result = await standin.client.send(target, send);
			if (!result.delivered) throw new Error(result.reason ?? "not delivered");
		} catch (error) {
			await call(url, "deliver", { from: info(local), to: sender, message: { id: randomUUID(), text: `Not delivered to ${local.name}: ${(error as Error).message}.` } }).catch(() => {});
		}
	}

	/** Every 30 s: drops shares whose folder is gone and pairs whose local session was deleted, then pings each paired hub. */
	async function tick() {
		if (ticking) return;
		ticking = true;
		try {
			const urls = new Set(peers.list().map(peer => peer.url)), records = new Set(sessions().map(session => session.record));
			store.prune(item => urls.has(item.hub) && existsSync(item.folder), pair => urls.has(pair.hub) && records.has(pair.local));
			for (const url of urls) await refresh(url);
		} catch { /* corrupt list: nothing to ping */ } finally { ticking = false; }
		await sync();
	}
	/** One hub's ping: offline after two misses; otherwise both hubs learn each other's shares and reply pairs. */
	async function refresh(url: string) {
		const { reply, error } = await call(url, "ping", mine(url));
		if (error) { const missed = (misses.get(url) ?? 0) + 1; misses.set(url, missed); if (missed >= 2) offline.add(url); return; }
		misses.delete(url); offline.delete(url);
		apply(url, reply[1]);
	}

	/** For the page: paired hubs (no credentials) with what each shares either way, this hub's active projects and the D-04 notice. */
	function state() {
		const local = sessions(), byRecord = new Map(local.map(session => [session.record, session])), projects = new Map<string, string>();
		for (const folder of [...local.map(session => session.folder), ...store.shares().map(item => item.folder).filter(folder => existsSync(folder))]) if (!projects.has(folderKey(folder))) projects.set(folderKey(folder), folder);
		return {
			comm: COMM,
			hubs: peers.list().map(({ name, url, paired }) => ({ name, url, paired, online: !offline.has(url), os: remotes.get(url)?.os, shared: sharedWith(url), projects: remotes.get(url)?.projects ?? [] })),
			projects: [...projects.values()],
			dropped: store.dropped().map(item => { const mine = byRecord.get(item.local); return `${mine ? sessionRef(mine.folder, mine.name) : "a removed session"} with ${item.remote} on ${hubName(item.hub)}`; }),
			pairing: outgoing ?? null,
			...(unavailable ? { unavailable } : {}),
		};
	}

	return {
		serve,
		pairWith,
		share,
		unpair,
		tick,
		sync,
		state,
		standins: () => [...standins].map(([id, { name, reply }]) => ({ id, name, reply })),
		/** The stand-ins `session` may send through, for the `@` list: every shared one, and the reply ones paired with it. */
		standinsFor: (session: string) => [...standins.values()].filter(standin => !standin.reply || pairOf(standin.hub, session, standin.to.record))
			.map(({ hub, to, name, reply }) => ({ name, label: `${reply ? "replies to" : "shared:"} ${sessionRef(to.folder, to.name)} on ${hubName(hub)}${osName(hub)}` })),
		start() { void tick(); timer = setInterval(() => void tick(), PING_MS); timer.unref(); },
		async stop() {
			clearInterval(timer);
			await syncing;
			await Promise.all([...standins.values()].map(standin => standin.client.disconnect().catch(() => {})));
			standins.clear();
		},
		store,
		peers,
	};
}

/** A pi-intercom message attachment (its types.ts). */
type Attachment = { type: string; name: string; content: string; language?: string };
/** D-02: one of this hub's project folders, visible to the paired hub at `hub`. */
export type Share = { hub: string; folder: string };
/** D-11: `local` (a session here) and `remote` (a session on `hub`) exchanged a message, so either may answer the other. */
export type Pair = { hub: string; local: string; remote: { record: string; name: string; folder?: string }; created: number };
/** D-04: a session link the upgrade dropped, named once in the Paired hubs dialog. */
export type Dropped = { hub: string; local: string; remote: string };
const HUB_URL = /^https:\/\/[^/\s]+$/;
const validShare = (share: Share) => HUB_URL.test(share?.hub) && typeof share.folder === "string" && share.folder.length > 0;
const validPair = (pair: Pair) => HUB_URL.test(pair?.hub) && typeof pair.local === "string" && typeof pair.remote?.record === "string" && typeof pair.remote.name === "string" && Number.isFinite(pair.created);
const samePair = (a: Pair, b: Pair) => a.hub === b.hub && a.local === b.local && a.remote.record === b.remote.record;
/** A link in a version 1 list (plans d21eefbf, 58d5c14f): a session to a session, or (kind project) a folder to a folder. */
const validOldLink = (link: any) => typeof link?.id === "string" && HUB_URL.test(link.hub) && typeof link.remote?.name === "string"
	&& (link.kind === "project" ? typeof link.folder === "string" : typeof link.session === "string");

/** Shares, reply pairs and the upgrade notice in `<dataDir>/links.json`; a corrupt file fails closed. */
export function createLinkStore(dataDir: string) {
	const file = path.join(dataDir, "links.json");
	type State = { shares: Share[]; pairs: Pair[]; dropped: Dropped[] };
	function load(): State {
		let text: string;
		try { text = readFileSync(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { shares: [], pairs: [], dropped: [] }; throw error; }
		try {
			const value = JSON.parse(text);
			if (value?.version === 1 && Array.isArray(value.links) && value.links.every(validOldLink)) return migrate(value.links);
			if (value?.version !== 2 || ![value.shares, value.pairs, value.dropped].every(Array.isArray) || !value.shares.every(validShare) || !value.pairs.every(validPair)) throw new Error("shape");
			return { shares: value.shares, pairs: value.pairs, dropped: value.dropped };
		} catch { throw new Error(`Hub link list is corrupt; hub links are off until ${file} is fixed or deleted.`); }
	}
	/** D-04: each project link becomes a share of this hub's own folder; session links and pending unlinks go, named for the notice. */
	function migrate(links: any[]): State {
		const state: State = { shares: [], pairs: [], dropped: [] };
		for (const link of links) {
			if (link.kind !== "project") state.dropped.push({ hub: link.hub, local: link.session, remote: sessionRef(link.remote.folder, cleanName(link.remote.name) || "session") });
			else if (!state.shares.some(other => other.hub === link.hub && sameFolder(other.folder, link.folder))) state.shares.push({ hub: link.hub, folder: link.folder });
		}
		return state;
	}
	const save = (state: State) => writeJsonAtomic(file, { version: 2, ...state });
	const change = (edit: (state: State) => void) => { const state = load(); edit(state); save(state); };
	// The upgrade is written once, at the first start of this release.
	try { if (JSON.parse(readFileSync(file, "utf8"))?.version === 1) save(load()); } catch { /* absent, or corrupt: load() reports it */ }
	return {
		file,
		shares: () => load().shares,
		pairs: () => load().pairs,
		dropped: () => load().dropped,
		setShare: (hub: string, folder: string, on: boolean) => change(state => { state.shares = [...state.shares.filter(other => !(other.hub === hub && sameFolder(other.folder, folder))), ...(on ? [{ hub, folder }] : [])]; }),
		addPair: (pair: Pair) => { if (!validPair(pair)) throw new Error("Invalid reply pair."); change(state => { state.pairs = [...state.pairs.filter(other => !samePair(other, pair)), pair]; }); },
		/** Keeps the shares and pairs that pass; writes only when one went (it runs every tick). */
		prune(keepShare: (share: Share) => boolean, keepPair: (pair: Pair) => boolean) {
			const state = load(), shares = state.shares.filter(keepShare), pairs = state.pairs.filter(keepPair);
			if (shares.length < state.shares.length || pairs.length < state.pairs.length) save({ ...state, shares, pairs });
		},
		/** Unpairing ends that hub's shares and reply pairs. */
		dropHub: (hub: string) => change(state => { state.shares = state.shares.filter(other => other.hub !== hub); state.pairs = state.pairs.filter(other => other.hub !== hub); }),
		clearDropped: () => change(state => { state.dropped = []; }),
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
