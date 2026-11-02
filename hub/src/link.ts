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
}) {
	const { devices, pairing, self, sessions, request = fetchRequest } = options, peers = createPeers(options.dataDir), store = createLinkStore(options.dataDir);
	let outgoing: { url: string; code?: string; state: string; error?: string } | undefined;
	const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Reply => [status, { comm: COMM, error, ...extra }];

	/** Answers one `/link/<op>` after the hub checked the tailnet owner; credential, then comm, then payload. */
	async function serve(op: string, headers: Headers, data: unknown, login: string, closed: Promise<unknown>): Promise<Reply> {
		if (!data || typeof data !== "object" || Array.isArray(data)) return fail(400, "Expected a JSON object.");
		const body = data as { comm?: unknown; id?: unknown; offer?: unknown; hub?: { name?: unknown; url?: unknown }; link?: unknown }, open = op === "pair-start" || op === "pair-status";
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
				const link = body.link as { id?: unknown; from?: { record?: unknown; name?: unknown }; to?: { record?: unknown } } | undefined;
				if (typeof link?.id !== "string" || !/^[0-9a-f-]{36}$/.test(link.id) || typeof link.from?.record !== "string" || typeof link.to?.record !== "string") return fail(400, "link.id, link.from and link.to required.");
				const existing = store.list().find(other => other.id === link.id);
				if (existing && existing.hub !== caller!.url) return fail(409, "link id taken");
				const target = sessions().find(session => session.record === link.to!.record);
				if (!target) return fail(410, "session-gone");
				store.add({ id: link.id, session: target.record, hub: caller!.url, remote: { record: link.from.record, name: cleanName(link.from.name) || "session" }, created: Date.now() });
				return [200, { comm: COMM, session: { name: target.name } }];
			}
			if (op === "unlink") {
				if (typeof body.link !== "string") return fail(400, "link required.");
				if (store.list().some(other => other.id === body.link && other.hub === caller!.url)) store.remove(body.link);
				return [200, { comm: COMM }];
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
		const id = randomUUID(), { reply, error } = await call(url, "link", { link: { id, from: { record: session, name: local.name }, to: { record } } });
		if (error) throw Object.assign(new Error(error === "session-gone" ? "That session no longer exists on the other hub." : error), { status: 409 });
		const made: Link = { id, session, hub: url, remote: { record, name: cleanName((reply[1].session as { name?: unknown } | undefined)?.name) || "session" }, created: Date.now() };
		// Stored there but not here: take it back there, so no half link stays.
		try { store.add(made); } catch (failure) { await call(url, "unlink", { link: id }); throw failure; }
		return made;
	}

	/** Unlinks here at once; the other hub hears now, or later from the pending list (D12). */
	async function unlink(id: string) {
		const removed = store.remove(id, true);
		if (!removed) return { ok: false };
		const { error } = await call(removed.hub, "unlink", { link: id }).catch(failure => ({ error: (failure as Error).message }));
		if (!error) store.confirmed(id);
		return { ok: true, ...(error ? { pending: error } : {}) };
	}

	return {
		serve,
		pairWith,
		remoteSessions,
		link,
		unlink,
		/** A session's links with their hub names, for its menu (D7). */
		linksOf: (session: string) => store.list().filter(item => item.session === session).map(item => ({ ...item, hubName: peers.get(item.hub)?.name ?? item.hub })),
		store,
		/** For the local page: paired hubs (no credentials) and the pairing in progress. */
		state: () => ({ comm: COMM, hubs: peers.list().map(({ name, url, paired }) => ({ name, url, paired })), pairing: outgoing ?? null }),
		peers,
	};
}

/** One link (D8, D10): a session on this hub and a session record on a paired hub. */
export type Link = { id: string; session: string; hub: string; remote: { record: string; name: string }; created: number };
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
