// Inter-hub links: the comm version check (D6), the paired-hub store and loading pi-intercom's client (present, absent, too old).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMM, commMismatch, createLinks, createPeers, loadIntercom } from "../src/link.ts";
import { createDeviceRegistry, createPairing } from "../src/remote.ts";
import { agentDir } from "../src/rpc-client.ts";

assert.equal(Number.isSafeInteger(COMM) && COMM >= 1, true, "comm is a plain integer of its own");
assert.equal(commMismatch(COMM, "Mac"), null, "equal comm links, whatever the package versions");
assert.equal(commMismatch(2, "Mac", 1), "Mac hub speaks comm 2, this hub comm 1: update this hub.");
assert.equal(commMismatch(1, "Mac", 2), "Mac hub speaks comm 1, this hub comm 2: update Mac hub.");
assert.equal(commMismatch(undefined, "Mac", 1), "Mac hub sent no comm version: update Mac hub.");
assert.equal(commMismatch("1", "Mac", 1), "Mac hub sent no comm version: update Mac hub.", "a string is not a comm number");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub link "));
try {
	const peers = createPeers(root), credential = `${"a".repeat(12)}.${"b".repeat(43)}`;
	assert.deepEqual(peers.list(), []);
	peers.put({ name: "mac", url: "https://mac.tail1.ts.net:7781", credential, device: "d".repeat(12), paired: 1 });
	peers.put({ name: "wsl", url: "https://home.tail1.ts.net:7782", credential, device: "d".repeat(12), paired: 2 });
	peers.put({ name: "MacBook", url: "https://mac.tail1.ts.net:7781", credential, device: "d".repeat(12), paired: 3 });
	assert.deepEqual(createPeers(root).list().map(peer => peer.name), ["wsl", "MacBook"], "same address replaces; kept on disk");
	assert.equal(peers.get("https://home.tail1.ts.net:7782")?.name, "wsl");
	assert.throws(() => peers.put({ name: "x", url: "http://mac:1", credential, paired: 1 }), /Invalid paired hub/, "https only");
	assert.throws(() => peers.put({ name: "x", url: "https://mac:1", credential: "short", paired: 1 }), /Invalid paired hub/);
	assert.equal(peers.remove("https://mac.tail1.ts.net:7781"), true);
	assert.equal(peers.remove("https://mac.tail1.ts.net:7781"), false);
	fs.writeFileSync(peers.file, "{");
	assert.throws(() => peers.list(), /corrupt; hub links are off/, "corrupt fails closed");

	// No pi-intercom: links are unavailable with a reason, nothing throws.
	const absent = await loadIntercom([path.join(root, "nowhere")]);
	assert.equal(absent.IntercomClient, undefined);
	assert.match(absent.unavailable, /pi-intercom is not installed/);
	// A pi-intercom whose client lacks what a stand-in needs.
	const old = path.join(root, "old-intercom");
	fs.mkdirSync(path.join(old, "broker"), { recursive: true });
	fs.writeFileSync(path.join(old, "broker", "client.ts"), "export class IntercomClient { connect(): void {} send(): void {} }\n");
	assert.match((await loadIntercom([old])).unavailable, /lacks sendMessageReceipt, listSessions, disconnect, on; update pi-intercom/);
	// The installed one (Pi's packages), when this machine has it.
	const installed = path.join(agentDir(), "npm", "node_modules", "pi-intercom");
	if (fs.existsSync(path.join(installed, "broker", "client.ts"))) {
		const loaded = await loadIntercom([installed]);
		assert.equal(loaded.unavailable, undefined, loaded.unavailable);
		assert.equal(typeof new loaded.IntercomClient().connect, "function");
	} else console.log("skipped: pi-intercom not installed here");

	// S06: two hubs in one process, requests passed as JSON between their /link/ handlers; `offline` drops one.
	const hubs = {}, offline = new Set(), login = "me@example.com";
	const request = async (url, op, body, credential) => {
		if (offline.has(url)) throw new Error("connect ECONNREFUSED");
		const [status, reply] = await hubs[url].links.serve(op, credential ? { "x-hub-link": credential } : {}, JSON.parse(JSON.stringify(body)), login, new Promise(() => {}));
		return [status, JSON.parse(JSON.stringify(reply))];
	};
	for (const [name, url, sessions] of [["pc", "https://pc.t.ts.net:1", ["alpha"]], ["mac", "https://mac.t.ts.net:2", ["beta", "gamma"]]]) {
		const dataDir = path.join(root, name), devices = createDeviceRegistry(dataDir), pairing = createPairing(devices);
		fs.mkdirSync(dataDir);
		hubs[url] = { pairing, devices, links: createLinks({ dataDir, devices, pairing, request, self: () => ({ name, url, login }),
			sessions: () => sessions.map(record => ({ record, name: record.toUpperCase(), folder: "C:/x", live: true })) }) };
	}
	const [pc, mac] = Object.values(hubs), macUrl = "https://mac.t.ts.net:2";
	await assert.rejects(pc.links.link("alpha", macUrl, "beta"), /not paired/);
	assert.equal((await pc.links.pairWith("mac.t.ts.net:2")).code, mac.pairing.pending().code, "same code on both hubs");
	assert.equal(mac.pairing.pending().label, "Hub pc");
	await mac.pairing.decide(true);
	for (let i = 0; i < 50 && pc.links.state().pairing.state === "pending"; i++) await new Promise(done => setTimeout(done, 20));
	assert.equal(pc.links.state().pairing.state, "paired");
	assert.deepEqual([pc.links.state().hubs.map(h => h.name), mac.links.state().hubs.map(h => h.name)], [["mac"], ["pc"]], "one approval pairs both ways (D8)");
	assert.deepEqual((await pc.links.remoteSessions(macUrl)).sessions.map(s => s.name), ["BETA", "GAMMA"]);
	await assert.rejects(pc.links.link("alpha", macUrl, "gone"), /no longer exists/);
	assert.equal(mac.links.store.list().length, 0, "a refused link is stored nowhere");
	const made = await pc.links.link("alpha", macUrl, "beta");
	assert.deepEqual([made.remote, pc.links.linksOf("alpha")[0].hubName], [{ record: "beta", name: "BETA" }, "mac"]);
	assert.deepEqual(mac.links.store.list().map(l => [l.id, l.session, l.hub, l.remote.record, l.remote.name]), [[made.id, "beta", "https://pc.t.ts.net:1", "alpha", "ALPHA"]], "both hubs store the link");
	// Only the hub a link belongs to may remove it; unknown ids succeed (retries).
	assert.deepEqual(await mac.links.serve("unlink", {}, { comm: COMM, link: made.id }, login, null), [401, { comm: COMM, error: "unpaired" }]);
	assert.equal((await request("https://mac.t.ts.net:2", "unlink", { comm: COMM, link: "x" }, pc.links.peers.get(macUrl).credential))[0], 200);
	// D12: unlinking while the other hub is offline removes it here at once and remembers to tell it.
	offline.add(macUrl);
	const pending = await pc.links.unlink(made.id);
	assert.equal(pending.ok, true); assert.match(pending.pending, /mac hub unreachable/);
	assert.deepEqual([pc.links.linksOf("alpha"), pc.links.store.unlinks().map(u => u.id), mac.links.store.list().length], [[], [made.id], 1]);
	offline.delete(macUrl);
	const second = await mac.links.link("gamma", "https://pc.t.ts.net:1", "alpha");
	assert.deepEqual(await mac.links.unlink(second.id), { ok: true });
	assert.deepEqual([mac.links.store.list().map(l => l.id), pc.links.store.list().length, mac.links.store.unlinks()], [[made.id], 0, []], "online unlink removes both sides");
	fs.writeFileSync(pc.links.store.file, "{");
	assert.throws(() => pc.links.store.list(), /corrupt/, "a corrupt link list fails closed");
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
console.log("link ok");
