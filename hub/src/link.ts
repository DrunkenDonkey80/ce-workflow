// Inter-hub links (plan d21eefbf): the comm protocol version, the paired-hub store and the pi-intercom client loader.
// COMM changes only when the hub-to-hub protocol does (the plan's "Comm protocol" section lists what counts), never with
// the ce-workflow version: hubs on different releases keep their links while their COMM numbers are equal (D6).
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { writeJsonAtomic } from "./registry.ts";
import { agentDir } from "./rpc-client.ts";

export const COMM = 1;

/** null when the peer speaks this hub's comm; otherwise a message naming both numbers and which hub to update. */
export function commMismatch(theirs: unknown, peer: string, mine = COMM): string | null {
	if (theirs === mine) return null;
	if (!Number.isSafeInteger(theirs)) return `${peer} hub sent no comm version: update ${peer} hub.`;
	return `${peer} hub speaks comm ${theirs}, this hub comm ${mine}: update ${(theirs as number) > mine ? "this hub" : `${peer} hub`}.`;
}

/** A hub this one is paired with: its tailnet address and the credential it issued to this hub. */
export type Peer = { name: string; url: string; credential: string; paired: number };
const valid = (peer: Peer) => typeof peer?.name === "string" && peer.name.length > 0 && /^https:\/\/[^/\s]+$/.test(peer.url)
	&& /^[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$/.test(peer.credential) && Number.isFinite(peer.paired);

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
