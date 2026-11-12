// Inter-hub links: the comm version check (D6), the paired-hub store and loading pi-intercom's client (present, absent, too old).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMM, commMismatch, createLinks, createPeers, loadIntercom, saveInbox } from "../src/link.ts";
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
	const hubs = {}, offline = new Set(), login = "me@example.com", slow = { file: 0 };
	const request = async (url, op, body, credential) => {
		if (op === "file" && slow.file) await new Promise(done => setTimeout(done, slow.file));
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
					target.emit("message", this.info, { id, content: { text: options.text, attachments: options.attachments }, expectsReply: options.expectsReply, replyTo: options.replyTo });
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
	const state = { alpha: { name: "ALPHA", folder: "C:\\w\\emailupload", live: true }, beta: { name: "BETA", folder: "/Users/f/belot", live: true }, gamma: { name: "GAMMA", folder: "/Users/f/belot", live: true } }, woken = [];
	const OS = { win32: "Windows", darwin: "macOS", linux: "Linux" }[process.platform];
	const pcRecords = ["alpha"], macRecords = ["beta", "gamma"];
for (const [name, url, records] of [["pc", "https://pc.t.ts.net:1", pcRecords], ["mac", "https://mac.t.ts.net:2", macRecords]]) {
		const dataDir = path.join(root, name), devices = createDeviceRegistry(dataDir), pairing = createPairing(devices), fake = broker();
		fs.mkdirSync(dataDir);
		hubs[url] = { pairing, devices, broker: fake, links: createLinks({ dataDir, devices, pairing, request, self: () => ({ name, url, login }),
			sessions: () => records.map(record => ({ record, name: state[record].name, folder: state[record].folder, live: state[record].live })),
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
	assert.deepEqual([made.remote, made.standin, pc.links.linksOf("alpha")[0].hubName], [{ record: "beta", name: "BETA", folder: "/Users/f/belot", os: process.platform }, "belot-beta~mac", "mac"]);
	assert.equal(pc.links.linksOf("alpha")[0].label, `belot/BETA on mac (${OS})`, "the link names folder, PC and OS");
	assert.deepEqual(mac.links.store.list()[0].remote, { record: "alpha", name: "ALPHA", folder: "C:\\w\\emailupload", os: process.platform }, "the other side learns them too");
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
	assert.deepEqual([pc.links.standins(), mac.links.standins()], [[{ id: link.id, name: "belot-beta~mac" }], [{ id: link.id, name: "emailupload-alpha~pc" }]], "D11 names with the folder, one stand-in on each hub");
	const info = pc.broker.clients.get(`hublink-${link.id}`).info;
	assert.deepEqual([info.name, info.cwd, info.model], ["belot-beta~mac", `mac (${OS}): /Users/f/belot`, 'hub-link for emailupload/ALPHA; files: attach {type:"file", content:"@<absolute path>"}, 5 MB total'], "fixed id per link; intercom shows where it runs and whose it is");
	// Send: the receipt comes only after the other hub's session took it.
	assert.equal((await alpha.send("belot-beta~mac", { text: "hello" })).delivered, true);
	assert.deepEqual(beta.inbox.map(m => [m.from, m.content.text]), [["emailupload-alpha~pc", "hello"]]);
	// Ask and reply: same message id across hubs; the reply comes back to the asker as a reply.
	const asked = await alpha.send("belot-beta~mac", { text: "ping?", expectsReply: true });
	assert.deepEqual([beta.inbox[1].id, beta.inbox[1].expectsReply], [asked.id, true]);
	assert.equal((await beta.send("emailupload-alpha~pc", { text: "pong", replyTo: asked.id })).delivered, true);
	assert.deepEqual(alpha.inbox.map(m => [m.from, m.content.text, m.replyTo]), [["belot-beta~mac", "pong", asked.id]]);
	// D9: another local session sees the stand-in but cannot talk through it.
	assert.equal((await other.send("belot-beta~mac", { text: "sneak" })).delivered, false);
	assert.match(other.inbox[0].content.text, /belot-beta~mac is linked to emailupload\/ALPHA on this hub, not to this session; not forwarded/);
	assert.equal(beta.inbox.length, 2, "nothing crossed");
	// A parked target is resumed and gets the message once it joins intercom.
	state.beta.live = false; await beta.disconnect();
	assert.equal((await alpha.send("belot-beta~mac", { text: "wake up" })).delivered, true);
	await until(() => mac.agents.beta.inbox.some(m => m.content.text === "wake up"), "delivered after resume");
	assert.deepEqual(woken, ["beta"]);
	// D13: the other hub is unreachable: the sender is told why and the stand-in disconnects; a good ping brings it back.
	offline.add(macUrl);
	assert.equal((await alpha.send("belot-beta~mac", { text: "lost" })).delivered, false);
	assert.match(alpha.inbox.at(-1).content.text, /Not delivered to belot-beta~mac: mac hub unreachable/);
	await pc.links.sync();
	assert.deepEqual([pc.links.standins(), pc.links.linksOf("alpha")[0].online, pc.links.state().hubs[0].online], [[], false, false]);
	offline.delete(macUrl);
	await pc.links.tick();
	assert.deepEqual(pc.links.standins().map(s => s.name), ["belot-beta~mac"], "reconnected with the same name");
	// D11 rename through ping; the link removed on mac reaches pc's sender as a cause.
	state.beta.name = "Reviewer"; state.beta.folder = "/Users/f/review";
	await pc.links.tick();
	assert.deepEqual(pc.links.standins().map(s => s.name), ["review-reviewer~mac"]);
	assert.equal(pc.broker.clients.get(`hublink-${link.id}`).info.cwd, `mac (${OS}): /Users/f/review`, "a moved folder reaches the stand-in");
	// A link stored by an older hub has no folder or OS: the old name~hub form and the hub address as place.
	pc.links.store.add({ ...pc.links.store.list()[0], remote: { record: "beta", name: "Reviewer" } }); await pc.links.sync();
	assert.deepEqual([pc.links.standins().map(s => s.name), pc.broker.clients.get(`hublink-${link.id}`).info.cwd], [["reviewer~mac"], `mac: ${macUrl}`]);
	await pc.links.tick();
	assert.deepEqual(pc.links.standins().map(s => s.name), ["review-reviewer~mac"], "the next ping fills them in");
	mac.links.store.remove(link.id); await mac.links.sync();
	assert.equal((await alpha.send("review-reviewer~mac", { text: "gone?" })).delivered, false);
	assert.match(alpha.inbox.at(-1).content.text, /the link was removed on mac/);
	// Plan 58d5c14f: a project link joins emailupload on pc and belot on mac, every session to every session (D-01).
	pcRecords.push("delta"); state.delta = { name: "DELTA", folder: state.alpha.folder, live: true };
	macRecords.push("eps"); state.eps = { name: "EPS", folder: "/Users/f/belot", live: true };
	const delta = pc.agents.delta = await pc.broker.agent("delta"), gamma = mac.agents.gamma = await mac.broker.agent("gamma"), eps = mac.agents.eps = await mac.broker.agent("eps");
	const project = await pc.links.linkProject("alpha", macUrl, "/Users/f/belot");
	await mac.links.sync();
	assert.deepEqual([project.standins.sort(), mac.links.standins().map(s => s.name).sort()], [["belot-eps~mac", "belot-gamma~mac"], ["emailupload-alpha~pc", "emailupload-delta~pc"]], "one stand-in per live session of the other project");
	assert.match(pc.broker.clients.get(`hublink-${project.id}-gamma`).info.model, /^hub-link for project emailupload; files: /);
	await assert.rejects(pc.links.linkProject("delta", macUrl, "/Users/f/belot"), /already linked/);
	await assert.rejects(pc.links.linkProject("alpha", macUrl, "/Users/f/nothing"), /no sessions on the other hub/);
	assert.deepEqual(pc.links.linksOf("delta").filter(l => l.kind === "project").map(l => l.label), [`project belot on mac (${OS})`], "every session of the folder sees the project link");
	// 2 by 2: each sender reaches each target, and the reply returns only to the actual sender.
	for (const [sender, peer] of [[alpha, delta], [delta, alpha]]) for (const target of [gamma, eps]) {
		const standin = `belot-${target.info.name}~mac`, before = peer.inbox.length, asked = await sender.send(standin, { text: `hi from ${sender.info.name}`, expectsReply: true });
		assert.equal(asked.delivered, true, `${sender.info.name} to ${standin}`);
		const got = target.inbox.at(-1);
		assert.deepEqual([got.from, got.content.text, got.id], [`emailupload-${sender.info.name}~pc`, `hi from ${sender.info.name}`, asked.id]);
		assert.equal((await target.send(got.from, { text: "back", replyTo: asked.id })).delivered, true);
		assert.deepEqual([sender.inbox.at(-1).from, sender.inbox.at(-1).replyTo, peer.inbox.length], [standin, asked.id, before], "reply to the sender only");
	}
	// Forged ends are refused: a target outside the linked folder, a sender pc does not list for its project.
	const asPc = body => request(macUrl, "deliver", { comm: COMM, link: project.id, message: { id: randomUUID(), text: "forged" }, ...body }, pc.links.peers.get(macUrl).credential);
	assert.deepEqual([(await asPc({ from: "alpha", to: "beta" }))[1].error, (await asPc({ from: "other", to: "gamma" }))[1].error], ["not-in-project", "unknown-sender"]);
	// A local session outside the folder sees the stand-ins but cannot send through them.
	assert.equal((await other.send("belot-gamma~mac", { text: "sneak" })).delivered, false);
	assert.match(other.inbox.at(-1).content.text, /linked to project emailupload on this hub; only its sessions may send through it/);
	// A session started on mac since pc's last ping: pc asks mac once, then delivers through its new stand-in.
	macRecords.push("zeta"); state.zeta = { name: "ZETA", folder: "/Users/f/belot", live: true };
	const zeta = mac.agents.zeta = await mac.broker.agent("zeta");
	assert.equal((await zeta.send("emailupload-alpha~pc", { text: "new here" })).delivered, true);
	assert.deepEqual([alpha.inbox.at(-1).from, alpha.inbox.at(-1).content.text], ["belot-zeta~mac", "new here"]);
	// A parked session drops its stand-in at the next ping; unlink removes the rest on both hubs.
	state.eps.live = false; await pc.links.tick();
	assert.deepEqual(pc.links.standins().filter(s => s.id === project.id).map(s => s.name).sort(), ["belot-gamma~mac", "belot-zeta~mac"]);
	assert.deepEqual(await pc.links.unlink(project.id), { ok: true });
	await Promise.all([pc.links.sync(), mac.links.sync()]);
	assert.deepEqual([pc.links.standins().filter(s => s.id === project.id), mac.links.standins(), mac.links.store.list()], [[], [], []]);
	// PL-09: `@path` file attachments land in the target project's .pi/inbox and the message names the saved path (D-06 to D-09).
	const pcProj = path.join(root, "pc proj"), macProj = path.join(root, "mac proj"), macInbox = path.join(macProj, ".pi", "inbox"), outside = path.dirname(process.execPath);
	for (const dir of [pcProj, macProj]) fs.mkdirSync(dir);
	pcRecords.push("fp"); state.fp = { name: "FP", folder: pcProj, live: true };
	macRecords.push("fm"); state.fm = { name: "FM", folder: macProj, live: true };
	const fp = pc.agents.fp = await pc.broker.agent("fp"), fm = mac.agents.fm = await mac.broker.agent("fm"), toFm = "mac-proj-fm~mac";
	await pc.links.linkProject("fp", macUrl, macProj);
	const binary = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37) % 256)), binFile = path.join(pcProj, "bin.dat");
	fs.writeFileSync(binFile, binary);
	const file = (content, name = "bin.dat") => ({ type: "file", name, content });
	const saved = () => { const match = /File: .+ saved at (.+)$/.exec(fm.inbox.at(-1).content.text); return match?.[1]; };
	assert.equal((await fp.send(toFm, { text: "see file", attachments: [file(`@${binFile}`), { type: "snippet", name: "note", content: "x = 1", language: "js" }] })).delivered, true);
	const first = saved();
	assert.match(fm.inbox.at(-1).content.text, /^see file\n\n---\nAttachment: note\n~~~js\nx = 1\n~~~\n\n---\nFile: bin\.dat \(0\.0 MB\) saved at /, "text attachments travel as text, files by saved path");
	assert.deepEqual([path.dirname(first), fs.readFileSync(first).equals(binary)], [fs.realpathSync(macInbox), true], "binary round trip into the project inbox");
	assert.equal((await fp.send(toFm, { text: "again", attachments: [file(`@${binFile}`, "../../evil.dat")] })).delivered, true);
	assert.notEqual(saved(), first, "two same-name arrivals both kept");
	assert.deepEqual([path.dirname(saved()), path.basename(saved()).endsWith("-evil.dat")], [fs.realpathSync(macInbox), true], "a traversal name stays in the inbox");
	// Refused before any upload, with the reason back to the sender.
	fs.symlinkSync(outside, path.join(pcProj, "out"), "junction");
	fs.writeFileSync(path.join(pcProj, "a.bin"), Buffer.alloc(3 * 1024 * 1024)); fs.writeFileSync(path.join(pcProj, "b.bin"), Buffer.alloc(3 * 1024 * 1024));
	for (const [attachments, reason] of [
		[[file(`@${process.execPath}`)], /is outside this project and the temp folder/],
		[[file(`@${path.join(pcProj, "out", path.basename(process.execPath))}`)], /is outside this project and the temp folder/],
		[[file("@bin.dat")], /bin\.dat is not an absolute path/],
		[[file(`@${path.join(pcProj, "a.bin")}`), file(`@${path.join(pcProj, "b.bin")}`)], /the files total 6\.0 MB, over the 5 MB limit/],
	]) {
		const before = fs.readdirSync(macInbox).length;
		assert.equal((await fp.send(toFm, { text: "refused", attachments })).delivered, false);
		assert.match(fp.inbox.at(-1).content.text, reason);
		assert.equal(fs.readdirSync(macInbox).length, before, "nothing uploaded");
	}
	// An inbox whose real path leaves the project is refused.
	const jumped = path.join(root, "jumped"); fs.mkdirSync(jumped); fs.symlinkSync(path.join(root, "pc"), path.join(jumped, ".pi"), "junction");
	await assert.rejects(saveInbox(jumped, binary, "x"), /leads outside the project/);
	// Uploads past pi-intercom's receipt window: the sender hears the late outcome; a failed upload never takes the hub offline.
	slow.file = 3_100;
	assert.equal((await fp.send(toFm, { text: "slow", attachments: [file(`@${binFile}`)] })).delivered, false, "receipt window missed");
	for (let i = 0; i < 50 && !/after all/.test(fp.inbox.at(-1).content.text); i++) await new Promise(done => setTimeout(done, 100));
	assert.match(fp.inbox.at(-1).content.text, /^Delivered to mac-proj-fm~mac after all, with 1 file\(s\)/);
	assert.match(fm.inbox.at(-1).content.text, /^slow\n/);
	slow.file = 1_200; offline.add(macUrl);
	assert.equal((await fp.send(toFm, { text: "late fail", attachments: [file(`@${binFile}`)] })).delivered, false);
	for (let i = 0; i < 30 && !/was not saved/.test(fp.inbox.at(-1).content.text); i++) await new Promise(done => setTimeout(done, 100));
	assert.match(fp.inbox.at(-1).content.text, /^Not delivered to mac-proj-fm~mac: bin\.dat was not saved on mac \(mac hub unreachable: connect ECONNREFUSED\)/);
	assert.equal(pc.links.state().hubs[0].online, true, "a failed upload does not take the hub offline");
	slow.file = 0; offline.delete(macUrl);
	await Promise.all([pc.links.stop(), mac.links.stop()]);
	assert.equal(pc.broker.clients.has(`hublink-${link.id}`), false, "stop disconnects stand-ins");

	fs.writeFileSync(pc.links.store.file, "{");
	assert.throws(() => pc.links.store.list(), /corrupt/, "a corrupt link list fails closed");
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
console.log("link ok");
