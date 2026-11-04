// Inter-hub links (plan d21eefbf): the comm protocol version, the paired-hub store and the pi-intercom client loader.
// COMM changes only when the hub-to-hub protocol does (the plan's "Comm protocol" section lists what counts), never with
// the ce-workflow version: hubs on different releases keep their links while their COMM numbers are equal (D6).
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { writeJsonAtomic } from "./registry.ts";
import type { createDeviceRegistry, createPairing } from "./remote.ts";
import { agentDir } from "./rpc-client.ts";

export const COMM = 1;
/** S02 deadlines: a forwarded message must be confirmed inside pi-intercom's 5 s receipt window; hubs ping every 30 s. */
const DELIVER_MS = 3_000, PING_MS = 30_000;

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
	const response = await fetch(`${url}/link/${op}`, { method: "POST", headers: { "content-type": "application/json", ...(credential ? { "x-hub-link": credential } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
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

	/** Answers one `/link/<op>` after the hub checked the tailnet owner; credential, then comm, then payload. */
	async function serve(op: string, headers: Headers, data: unknown, login: string, closed: Promise<unknown>): Promise<Reply> {
		if (!data || typeof data !== "object" || Array.isArray(data)) return fail(400, "Expected a JSON object.");
		const body = data as { comm?: unknown; id?: unknown; offer?: unknown; hub?: { name?: unknown; url?: unknown }; link?: unknown; message?: unknown }, open = op === "pair-start" || op === "pair-status";
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
				const link = body.link as { id?: unknown; from?: { record?: unknown; name?: unknown; folder?: unknown }; to?: { record?: unknown } } | undefined;
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
			if (op === "ping") return [200, { comm: COMM, hub: self()?.name, os: process.platform, links: store.list().filter(item => item.hub === caller!.url).map(item => { const local = sessions().find(s => s.record === item.session); return { id: item.id, name: local?.name ?? "", folder: local?.folder }; }) }];
			if (op === "deliver") {
				const message = body.message as { id?: unknown; text?: unknown; expectsReply?: unknown; replyTo?: unknown } | undefined;
				if (typeof message?.id !== "string" || message.id.length > 100 || typeof message.text !== "string" || (message.replyTo !== undefined && typeof message.replyTo !== "string")) return fail(400, "message.id and message.text required.");
				const link = store.list().find(item => item.id === body.link && item.hub === caller!.url);
				if (!link) return fail(404, "not-linked");
				const local = sessions().find(s => s.record === link.session), standin = standins.get(link.id);
				if (!local) return fail(410, "session-gone");
				if (!standin) return fail(502, "not-delivered", { reason: unavailable ?? "its stand-in is not connected" });
				const send = { text: message.text, messageId: message.id, ...(message.expectsReply === true ? { expectsReply: true } : {}), ...(message.replyTo ? { replyTo: message.replyTo } : {}) };
				if (!local.live) { void wakeAndSend(link, standin, send, local.name); return [200, { comm: COMM, delivered: true, resuming: true }]; }
				const target = await options.intercom!.intercomId(link.session);
				const result = target ? await standin.client.send(target, send).catch((error: Error) => ({ delivered: false, reason: error.message })) : { delivered: false, reason: "it has no intercom session" };
				return result.delivered ? [200, { comm: COMM, delivered: true }] : fail(502, "not-delivered", { reason: result.reason ?? "not delivered" });
			}
		} catch (error) {
			return fail((error as { status?: number }).status ?? 500, (error as Error).message);
		}
		return fail(404, "Unknown link operation.");
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

	/** Unlinks here at once; the other hub hears now, or later from the pending list (D12). */
	async function unlink(id: string) {
		const removed = store.remove(id, true);
		if (!removed) return { ok: false };
		void sync();
		const { error } = await call(removed.hub, "unlink", { link: id }).catch(failure => ({ error: (failure as Error).message }));
		if (!error) store.confirmed(id);
		return { ok: true, ...(error ? { pending: error } : {}) };
	}

	// S07 stand-ins (D9-D13): one pi-intercom session per link, named for the other side, while that hub is online.
	type Standin = { link: Link; name: string; key: string; client: any };
	const standins = new Map<string, Standin>(), offline = new Set<string>(), misses = new Map<string, number>();
	let unavailable: string | undefined, client: Promise<IntercomLoad> | undefined, syncing = Promise.resolve(), ticking = false, timer: NodeJS.Timeout | undefined;
	const safe = (text: string) => text.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "session";
	const hubName = (link: Link) => peers.get(link.hub)?.name ?? link.hub.slice(8).split(".")[0];
	function standinName(link: Link) {
		// "emailupload-1~flexpc": the folder tells apart sessions that share a name ("1") across projects.
		const hub = safe(hubName(link)), folder = folderName(link.remote.folder), who = (folder ? `${safe(folder)}-` : "") + safe(link.remote.name), plain = `${who}~${hub}`;
		// shortcut: collisions checked against this hub's sessions and stand-ins only, not other intercom sessions on the machine; upgrade if names clash in practice.
		const taken = new Set([...sessions().map(s => s.name.toLowerCase()), ...[...standins.values()].filter(s => s.link.id !== link.id).map(s => s.name)]);
		return taken.has(plain) ? `${who}-${link.remote.record.slice(0, 4)}~${hub}` : plain;
	}
	/** Where the other session runs ("FlexPC (Windows): C:\\x\\emailupload"), shown as the stand-in's intercom cwd. */
	const remotePlace = (link: Link) => `${hubName(link)}${link.remote.os ? ` (${OS_NAMES[link.remote.os] ?? link.remote.os})` : ""}: ${link.remote.folder ?? link.hub}`;
	/** This hub's session a link belongs to; only it may send through the stand-in (D9). */
	const owner = (link: Link) => { const local = sessions().find(s => s.record === link.session); return local ? sessionRef(local.folder, local.name) : undefined; };
	/** What intercom shows for a stand-in: name, the remote place as cwd, and its owner as the model column. */
	const describe = (link: Link) => ({ name: standinName(link), cwd: remotePlace(link), model: `hub-link for ${owner(link) ?? "a removed session"}` });

	/** Starts and stops stand-ins to match the links whose hub is online; serialized, never throws. */
	const sync = () => syncing = syncing.then(async () => {
		let links: Link[] = [];
		try { links = store.list(); } catch { /* corrupt list: every stand-in off */ }
		const wanted = new Map(links.filter(item => !offline.has(item.hub) && peers.get(item.hub)).map(item => [item.id, item]));
		// A changed name, folder, OS or owner re-registers the stand-in under the same id (D11).
		for (const [id, standin] of standins) { const now = wanted.get(id); if (!now || JSON.stringify(describe(now)) !== standin.key) { standins.delete(id); await standin.client.disconnect().catch(() => {}); } }
		if (!wanted.size || !options.intercom) return;
		const loaded = await (client ??= (options.intercom.load ?? loadIntercom)());
		unavailable = loaded.unavailable;
		if (!loaded.IntercomClient) return;
		for (const link of wanted.values()) if (!standins.has(link.id)) {
			const shown = describe(link), standin: Standin = { link, name: shown.name, key: JSON.stringify(shown), client: new loaded.IntercomClient() }, now = Date.now();
			standin.client.on("message", (from: { id: string }, message: any) => void forward(standin, from, message).catch(() => {}));
			standin.client.on("error", () => {});
			standin.client.on("disconnected", () => { if (standins.get(link.id) === standin) standins.delete(link.id); });
			try {
				// A fixed id per link: a reconnect gets pi-intercom's mailbox for plain sends made while offline (D11, D13).
				await standin.client.connect({ cwd: shown.cwd, model: shown.model, pid: process.pid, startedAt: now, lastActivity: now, name: standin.name, status: "idle", acknowledgesReceipts: true }, `hublink-${link.id}`);
				standins.set(link.id, standin);
			} catch { /* broker not running: the next ping retries */ }
		}
	}).catch(() => {});

	/** A local message to a stand-in: only its linked session's crosses (D9); the receipt waits for the other hub (S02). */
	async function forward({ link, name, client }: Standin, from: { id: string }, message: { id: string; content?: { text?: string }; expectsReply?: boolean; replyTo?: string }) {
		const local = sessions().find(s => s.record === link.session), tell = (text: string) => client.send(from.id, { text }).catch(() => {});
		if (!local || from.id !== await options.intercom!.intercomId(link.session)) return void tell(`${name} is linked to ${local ? sessionRef(local.folder, local.name) : "another session"} on this hub, not to this session; not forwarded. Only that session may send through it.`);
		const peer = peers.get(link.hub)?.name ?? link.hub;
		const sent = await Promise.race([
			call(link.hub, "deliver", { link: link.id, message: { id: message.id, text: message.content?.text ?? "", ...(message.expectsReply ? { expectsReply: true } : {}), ...(message.replyTo ? { replyTo: message.replyTo } : {}) } }),
			new Promise<undefined>(done => setTimeout(done, DELIVER_MS)),
		]).catch(() => undefined);
		if (sent && !sent.error) return client.sendMessageReceipt({ messageId: message.id, status: "receiver_received", timestamp: Date.now() });
		const code = sent?.reply[1].error, reason = sent?.reply[1].reason;
		const cause = !sent ? `${peer} hub did not answer within ${DELIVER_MS / 1000} s` : code === "not-linked" ? `the link was removed on ${peer}`
			: code === "session-gone" ? `${link.remote.name} on ${peer} was closed` : code === "not-delivered" ? `${link.remote.name} on ${peer} did not take it (${reason})` : sent.error!;
		// The cause first, while this stand-in is still connected; then an unreachable hub takes its stand-ins offline (D13).
		await tell(`Not delivered to ${name}: ${cause}.`);
		if (!sent || sent.reply[0] === 502 && code !== "not-delivered") { offline.add(link.hub); void sync(); }
	}

	/** A parked target: resume it, wait until it joins intercom (60 s), then send; a failure goes back as a message. */
	async function wakeAndSend(link: Link, standin: Standin, send: Record<string, unknown>, localName: string) {
		try {
			await options.intercom!.wake?.(link.session);
			let target: string | undefined;
			for (const until = Date.now() + 60_000; Date.now() < until; await new Promise(done => setTimeout(done, 1000))) {
				const id = await options.intercom!.intercomId(link.session);
				if (id && (await standin.client.listSessions()).some((s: { id: string }) => s.id === id)) { target = id; break; }
			}
			if (!target) throw new Error(`${localName} did not join intercom within 60 s`);
			const result = await standin.client.send(target, send);
			if (!result.delivered) throw new Error(result.reason ?? "not delivered");
		} catch (error) {
			await call(link.hub, "deliver", { link: link.id, message: { id: randomUUID(), text: `Not delivered to ${localName}: ${(error as Error).message}.` } }).catch(() => {});
		}
	}

	/** Every 30 s: ping each linked hub; two misses take its stand-ins offline, a success brings them back, carries renames
	 * (D11), drops links the other hub no longer has and retries unconfirmed unlinks (D12). */
	async function tick() {
		if (ticking) return;
		ticking = true;
		try {
			const links = store.list(), unlinks = store.unlinks();
			for (const url of new Set([...links.map(item => item.hub), ...unlinks.map(item => item.hub)])) {
				if (!peers.get(url)) continue;
				const { reply, error } = await call(url, "ping", {});
				if (error) { const missed = (misses.get(url) ?? 0) + 1; misses.set(url, missed); if (missed >= 2) offline.add(url); continue; }
				misses.delete(url); offline.delete(url);
				const theirs = new Map((Array.isArray(reply[1].links) ? reply[1].links : []).map((item: { id: string; name: unknown; folder?: unknown }) => [item.id, item]));
				for (const link of links.filter(item => item.hub === url)) {
					const item = theirs.get(link.id);
					// A minute's grace: the hub that started a link stores it just after this one.
					if (item === undefined) { if (Date.now() - link.created > 60_000) store.remove(link.id); continue; }
					const remote = { ...link.remote, ...(cleanName(item.name) ? { name: cleanName(item.name) } : {}), ...details(item.folder, reply[1].os) };
					if (JSON.stringify(remote) !== JSON.stringify(link.remote)) store.add({ ...link, remote });
				}
				for (const item of unlinks.filter(u => u.hub === url)) if (!(await call(url, "unlink", { link: item.id })).error) store.confirmed(item.id);
			}
		} catch { /* corrupt list or unpaired hub: nothing to ping */ } finally { ticking = false; }
		await sync();
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
		unlink,
		/** A session's links with their hub names, for its menu (D7). */
		linksOf: (session: string) => store.list().filter(item => item.session === session).map(item => ({ ...item, hubName: peers.get(item.hub)?.name ?? item.hub, online: !offline.has(item.hub), standin: standins.get(item.id)?.name ?? null,
			label: `${sessionRef(item.remote.folder, item.remote.name)} on ${hubName(item)}${item.remote.os ? ` (${OS_NAMES[item.remote.os] ?? item.remote.os})` : ""}` })),
		store,
		/** For the local page: paired hubs (no credentials) and the pairing in progress. */
		state: () => ({ comm: COMM, hubs: peers.list().map(({ name, url, paired }) => ({ name, url, paired, online: !offline.has(url) })), pairing: outgoing ?? null, ...(unavailable ? { unavailable } : {}) }),
		peers,
	};
}

/** One link (D8, D10): a session on this hub and a session record on a paired hub. */
export type Link = { id: string; session: string; hub: string; remote: { record: string; name: string; folder?: string; os?: string }; created: number };
/** The optional remote details, only those the other hub sent (older hubs send none). */
const details = (folder: unknown, os: unknown) => ({ ...(cleanFolder(folder) ? { folder: cleanFolder(folder) } : {}), ...(cleanOs(os) ? { os: cleanOs(os) } : {}) });
const validLink = (link: Link) => typeof link?.id === "string" && typeof link.session === "string" && /^https:\/\/[^/\s]+$/.test(link.hub)
	&& typeof link.remote?.record === "string" && typeof link.remote.name === "string" && Number.isFinite(link.created);

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
