// Inter-hub links: the comm version check (D6), the paired-hub store and loading pi-intercom's client (present, absent, too old).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
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
	// S07: each hub has its own in-memory broker; a session's intercom id is `pi-<record>`, and agents acknowledge receipts.
	const broker = () => {
		const clients = new Map(), pending = new Map();
		class Client extends EventEmitter {
			async connect(registration, sessionId) { this.info = { ...registration, id: sessionId ?? registration.name }; clients.set(this.info.id, this); }
			async listSessions() { return [...clients.values()].map(client => client.info); }
			async disconnect() { clients.delete(this.info.id); this.emit("disconnected"); }
			send(to, options) {
				const target = clients.get(to) ?? [...clients.values()].find(client => client.info.name === to), id = options.messageId ?? randomUUID();
				if (!target) return Promise.resolve({ id, delivered: false, reason: "not connected" });
				return new Promise(resolve => {
					const timer = setTimeout(() => { pending.delete(id); resolve({ id, delivered: false, reason: "no receipt" }); }, 1000);
					pending.set(id, () => { clearTimeout(timer); resolve({ id, delivered: true }); });
					target.emit("message", this.info, { id, content: { text: options.text }, expectsReply: options.expectsReply, replyTo: options.replyTo });
				});
			}
			sendMessageReceipt({ messageId }) { pending.get(messageId)?.(); pending.delete(messageId); }
		}
		const agent = async record => {
			const client = new Client(), inbox = [];
			client.on("message", (from, message) => { inbox.push({ from: from.name, ...message }); client.sendMessageReceipt({ messageId: message.id }); });
			await client.connect({ name: record }, `pi-${record}`);
			return Object.assign(client, { inbox });
		};
		return { Client, clients, agent };
	};
	const state = { alpha: { name: "ALPHA", live: true }, beta: { name: "BETA", live: true }, gamma: { name: "GAMMA", live: true } }, woken = [];
	for (const [name, url, records] of [["pc", "https://pc.t.ts.net:1", ["alpha"]], ["mac", "https://mac.t.ts.net:2", ["beta", "gamma"]]]) {
		const dataDir = path.join(root, name), devices = createDeviceRegistry(dataDir), pairing = createPairing(devices), fake = broker();
		fs.mkdirSync(dataDir);
		hubs[url] = { pairing, devices, broker: fake, links: createLinks({ dataDir, devices, pairing, request, self: () => ({ name, url, login }),
			sessions: () => records.map(record => ({ record, name: state[record].name, folder: "C:/x", live: state[record].live })),
			intercom: { intercomId: async record => `pi-${record}`, load: async () => ({ IntercomClient: fake.Client }),
				wake: async record => { woken.push(record); state[record].live = true; hubs[url].agents[record] = await fake.agent(record); } } }), agents: {} };
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

	// S07 stand-ins. The next ping tells mac about the unlink it missed (D12).
	await pc.links.tick();
	assert.deepEqual([pc.links.store.unlinks(), mac.links.store.list().length], [[], 0], "pending unlink delivered at the next ping");
	const until = async (check, what) => { for (let i = 0; i < 100 && !await check(); i++) await new Promise(done => setTimeout(done, 20)); assert.ok(await check(), what); };
	const alpha = pc.agents.alpha = await pc.broker.agent("alpha"), other = await pc.broker.agent("other"), beta = mac.agents.beta = await mac.broker.agent("beta");
	const link = await pc.links.link("alpha", macUrl, "beta");
	await Promise.all([pc.links.sync(), mac.links.sync()]);
	assert.deepEqual([pc.links.standins(), mac.links.standins()], [[{ id: link.id, name: "beta~mac" }], [{ id: link.id, name: "alpha~pc" }]], "D11 names, one stand-in on each hub");
	assert.equal(pc.broker.clients.get(`hublink-${link.id}`).info.name, "beta~mac", "fixed id per link");
	// Send: the receipt comes only after the other hub's session took it.
	assert.equal((await alpha.send("beta~mac", { text: "hello" })).delivered, true);
	assert.deepEqual(beta.inbox.map(m => [m.from, m.content.text]), [["alpha~pc", "hello"]]);
	// Ask and reply: same message id across hubs; the reply comes back to the asker as a reply.
	const asked = await alpha.send("beta~mac", { text: "ping?", expectsReply: true });
	assert.deepEqual([beta.inbox[1].id, beta.inbox[1].expectsReply], [asked.id, true]);
	assert.equal((await beta.send("alpha~pc", { text: "pong", replyTo: asked.id })).delivered, true);
	assert.deepEqual(alpha.inbox.map(m => [m.from, m.content.text, m.replyTo]), [["beta~mac", "pong", asked.id]]);
	// D9: another local session sees the stand-in but cannot talk through it.
	assert.equal((await other.send("beta~mac", { text: "sneak" })).delivered, false);
	assert.match(other.inbox[0].content.text, /beta~mac is linked to ALPHA, not to this session; not forwarded/);
	assert.equal(beta.inbox.length, 2, "nothing crossed");
	// A parked target is resumed and gets the message once it joins intercom.
	state.beta.live = false; await beta.disconnect();
	assert.equal((await alpha.send("beta~mac", { text: "wake up" })).delivered, true);
	await until(() => mac.agents.beta.inbox.some(m => m.content.text === "wake up"), "delivered after resume");
	assert.deepEqual(woken, ["beta"]);
	// D13: the other hub is unreachable: the sender is told why and the stand-in disconnects; a good ping brings it back.
	offline.add(macUrl);
	assert.equal((await alpha.send("beta~mac", { text: "lost" })).delivered, false);
	assert.match(alpha.inbox.at(-1).content.text, /Not delivered to beta~mac: mac hub unreachable/);
	await pc.links.sync();
	assert.deepEqual([pc.links.standins(), pc.links.linksOf("alpha")[0].online, pc.links.state().hubs[0].online], [[], false, false]);
	offline.delete(macUrl);
	await pc.links.tick();
	assert.deepEqual(pc.links.standins().map(s => s.name), ["beta~mac"], "reconnected with the same name");
	// D11 rename through ping; the link removed on mac reaches pc's sender as a cause.
	state.beta.name = "Reviewer";
	await pc.links.tick();
	assert.deepEqual(pc.links.standins().map(s => s.name), ["reviewer~mac"]);
	mac.links.store.remove(link.id); await mac.links.sync();
	assert.equal((await alpha.send("reviewer~mac", { text: "gone?" })).delivered, false);
	assert.match(alpha.inbox.at(-1).content.text, /the link was removed on mac/);
	await Promise.all([pc.links.stop(), mac.links.stop()]);
	assert.equal(pc.broker.clients.has(`hublink-${link.id}`), false, "stop disconnects stand-ins");

	fs.writeFileSync(pc.links.store.file, "{");
	assert.throws(() => pc.links.store.list(), /corrupt/, "a corrupt link list fails closed");
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
console.log("link ok");
