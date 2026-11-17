// Inter-hub links: the comm version check (D6), the paired-hub store and loading pi-intercom's client (present, absent, too old).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMM, commMismatch, createLinks, createLinkStore, createPeers, loadIntercom, saveInbox } from "../src/link.ts";
import { createDeviceRegistry, createPairing } from "../src/remote.ts";
import { grep, ripgrep } from "../src/peer-read.ts";
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
	// Shares need real folders (a share is served while its folder exists): emailupload and tools on pc, belot on mac.
	const work = path.join(root, "work"), emailupload = path.join(work, "pc", "emailupload"), tools = path.join(work, "pc", "tools"), belot = path.join(work, "mac", "belot");
	for (const dir of [emailupload, tools, belot]) fs.mkdirSync(dir, { recursive: true });
	const state = { alpha: { name: "ALPHA", folder: emailupload, live: true }, delta: { name: "DELTA", folder: emailupload, live: true }, other: { name: "OTHER", folder: tools, live: true },
		beta: { name: "BETA", folder: belot, live: true }, gamma: { name: "GAMMA", folder: belot, live: true }, eps: { name: "EPS", folder: belot, live: true } }, woken = [];
	const OS = { win32: "Windows", darwin: "macOS", linux: "Linux" }[process.platform];
	const pcRecords = ["alpha", "delta", "other"], macRecords = ["beta", "gamma", "eps"];
	for (const [name, url, records] of [["pc", "https://pc.t.ts.net:1", pcRecords], ["mac", "https://mac.t.ts.net:2", macRecords]]) {
		const dataDir = path.join(root, name), devices = createDeviceRegistry(dataDir), pairing = createPairing(devices), fake = broker();
		fs.mkdirSync(dataDir);
		hubs[url] = { pairing, devices, broker: fake, links: createLinks({ dataDir, devices, pairing, request, self: () => ({ name, url, login }),
			sessions: () => records.map(record => ({ record, name: state[record].name, folder: state[record].folder, live: state[record].live, sessionFile: state[record].sessionFile })),
			intercom: { intercomId: async record => `pi-${record}`, load: async () => ({ IntercomClient: fake.Client }),
				wake: async record => { woken.push(record); state[record].live = true; hubs[url].agents[record] = await fake.agent(record); } } }), agents: {} };
	}
	const [pc, mac] = Object.values(hubs), macUrl = "https://mac.t.ts.net:2", pcUrl = "https://pc.t.ts.net:1";
	const names = links => links.standins().map(s => s.name).sort();
	const until = async (check, what) => { for (let i = 0; i < 100 && !await check(); i++) await new Promise(done => setTimeout(done, 20)); assert.ok(await check(), what); };
	await assert.rejects(pc.links.share(macUrl, emailupload, true), /not paired/);
	assert.equal((await pc.links.pairWith("mac.t.ts.net:2")).code, mac.pairing.pending().code, "same code on both hubs");
	assert.equal(mac.pairing.pending().label, "Hub pc");
	await mac.pairing.decide(true);
	for (let i = 0; i < 50 && pc.links.state().pairing.state === "pending"; i++) await new Promise(done => setTimeout(done, 20));
	assert.equal(pc.links.state().pairing.state, "paired");
	assert.deepEqual([pc.links.state().hubs.map(h => h.name), mac.links.state().hubs.map(h => h.name)], [["mac"], ["pc"]], "one approval pairs both ways (D8)");

	// D-05: nothing is shared after pairing; each hub lists its own active projects for the checklist.
	await Promise.all([pc.links.tick(), mac.links.tick()]);
	assert.deepEqual([names(pc.links), names(mac.links), pc.links.state().hubs[0].projects, pc.links.state().hubs[0].shared], [[], [], [], []]);
	assert.deepEqual([pc.links.state().projects, mac.links.state().projects], [[emailupload, tools], [belot]]);
	await assert.rejects(mac.links.share(pcUrl, work, true), /Not an active project on this hub/, "only an active project can be shared");
	const alpha = pc.agents.alpha = await pc.broker.agent("alpha"), delta = pc.agents.delta = await pc.broker.agent("delta"), other = pc.agents.other = await pc.broker.agent("other");
	let beta = mac.agents.beta = await mac.broker.agent("beta");
	const gamma = mac.agents.gamma = await mac.broker.agent("gamma");
	mac.agents.eps = await mac.broker.agent("eps");

	// D-02: mac shares belot; pc hears it with the share call and gets one stand-in per belot session.
	assert.deepEqual((await mac.links.share(pcUrl, belot, true)).hubs[0].shared, [belot]);
	await pc.links.sync();
	assert.deepEqual(names(pc.links), ["belot-beta~mac", "belot-eps~mac", "belot-gamma~mac"]);
	assert.deepEqual(pc.links.state().hubs[0].projects.map(p => [p.folder, p.sessions.map(s => s.name)]), [[belot, ["BETA", "GAMMA", "EPS"]]]);
	const macDevice = pc.links.peers.get(macUrl).device, info = pc.broker.clients.get(`hublink-${macDevice}-beta`).info;
	assert.deepEqual([info.name, info.cwd, info.model], ["belot-beta~mac", `mac (${OS}): ${belot}`, 'hub-link shared by mac; files: attach {type:"file", content:"@<absolute path>"}, 5 MB total'], "fixed id per remote session; intercom shows where it runs");
	// Send: the receipt comes only after the other hub's session took it; both hubs keep the reply pair (D-11).
	assert.equal((await alpha.send("belot-beta~mac", { text: "hello" })).delivered, true);
	assert.deepEqual(beta.inbox.map(m => [m.from, m.content.text]), [["emailupload-alpha~pc", "hello"]]);
	assert.deepEqual([pc.links.store.pairs().map(p => [p.local, p.remote.record]), mac.links.store.pairs().map(p => [p.local, p.remote.record, p.remote.name, p.remote.folder])],
		[[["alpha", "beta"]], [["beta", "alpha", "ALPHA", emailupload]]]);
	await mac.links.sync();
	assert.deepEqual(mac.links.standins().map(s => [s.name, s.reply]), [["emailupload-alpha~pc", true]], "a reply stand-in, though emailupload is not shared");
	// Ask and reply: same message id across hubs; the reply lands in unshared emailupload along the pair.
	const asked = await alpha.send("belot-beta~mac", { text: "ping?", expectsReply: true });
	assert.deepEqual([beta.inbox[1].id, beta.inbox[1].expectsReply], [asked.id, true]);
	assert.equal((await beta.send("emailupload-alpha~pc", { text: "pong", replyTo: asked.id })).delivered, true);
	assert.deepEqual(alpha.inbox.map(m => [m.from, m.content.text, m.replyTo]), [["belot-beta~mac", "pong", asked.id]]);
	// D-03: a session of another pc project writes to belot too.
	assert.equal((await other.send("belot-gamma~mac", { text: "from tools" })).delivered, true);
	assert.deepEqual([gamma.inbox.at(-1).from, gamma.inbox.at(-1).content.text], ["tools-other~pc", "from tools"]);
	// A reply stand-in carries only its paired sessions: gamma never heard from alpha.
	await mac.links.sync();
	assert.equal((await gamma.send("emailupload-alpha~pc", { text: "sneak" })).delivered, false);
	assert.match(gamma.inbox.at(-1).content.text, /emailupload-alpha~pc carries replies for belot\/BETA only; not forwarded/);
	assert.equal(alpha.inbox.length, 1, "nothing crossed");
	// Forged ends: a "reply" to a pc session that never wrote to mac, an unknown target, a missing sender.
	const asMac = body => request(pcUrl, "deliver", { comm: COMM, message: { id: randomUUID(), text: "forged" }, ...body }, mac.links.peers.get(pcUrl).credential);
	assert.deepEqual((await asMac({ from: { record: "gamma", name: "GAMMA" }, to: "alpha" })), [403, { comm: COMM, error: "not-shared" }]);
	assert.deepEqual([(await asMac({ from: { record: "beta" }, to: "gone" }))[1].error, (await asMac({ to: "alpha" }))[0]], ["session-gone", 400]);
	// The @ list: every shared stand-in for any pc session; on mac a reply stand-in only for its paired session.
	assert.deepEqual(pc.links.standinsFor("delta").map(s => s.label).sort(), ["BETA", "EPS", "GAMMA"].map(n => `shared: belot/${n} on mac (${OS})`));
	assert.deepEqual([mac.links.standinsFor("beta").map(s => s.name), mac.links.standinsFor("eps")], [["emailupload-alpha~pc"], []]);
	// A parked target keeps its stand-in; a message resumes it and arrives once it joins intercom.
	state.beta.live = false; await beta.disconnect();
	assert.equal((await alpha.send("belot-beta~mac", { text: "wake up" })).delivered, true);
	await until(() => mac.agents.beta.inbox.some(m => m.content.text === "wake up"), "delivered after resume");
	assert.deepEqual(woken, ["beta"]);
	beta = mac.agents.beta;
	// D13: the other hub is unreachable: the sender is told why and the stand-ins disconnect; a good ping brings them back.
	offline.add(macUrl);
	assert.equal((await alpha.send("belot-beta~mac", { text: "lost" })).delivered, false);
	assert.match(alpha.inbox.at(-1).content.text, /Not delivered to belot-beta~mac: mac hub unreachable/);
	await pc.links.sync();
	assert.deepEqual([names(pc.links), pc.links.state().hubs[0].online], [[], false]);
	offline.delete(macUrl);
	await pc.links.tick();
	assert.deepEqual(names(pc.links), ["belot-beta~mac", "belot-eps~mac", "belot-gamma~mac"], "reconnected with the same names");
	// D11 renames through the ping, for shared and reply stand-ins alike.
	state.beta.name = "Reviewer"; state.alpha.name = "Lead";
	await Promise.all([pc.links.tick(), mac.links.tick()]);
	assert.deepEqual([names(pc.links), names(mac.links)], [["belot-eps~mac", "belot-gamma~mac", "belot-reviewer~mac"], ["emailupload-lead~pc", "tools-other~pc"]]);
	assert.equal(pc.links.store.pairs().find(p => p.local === "alpha").remote.name, "Reviewer", "the pair learns the new name");
	state.beta.name = "BETA"; state.alpha.name = "ALPHA";
	await Promise.all([pc.links.tick(), mac.links.tick()]);

	// Unshare: the share stand-ins go, the pairs stay (D-11): alpha and beta keep talking, delta cannot start, nor reach eps.
	await mac.links.share(pcUrl, belot, false);
	await pc.links.sync();
	assert.deepEqual(pc.links.standins().map(s => [s.name, s.reply]).sort(), [["belot-beta~mac", true], ["belot-gamma~mac", true]]);
	assert.equal((await beta.send("emailupload-alpha~pc", { text: "still here" })).delivered, true, "a reply from an unshared project");
	assert.equal((await alpha.send("belot-beta~mac", { text: "and back" })).delivered, true);
	assert.equal((await delta.send("belot-beta~mac", { text: "new" })).delivered, false);
	assert.match(delta.inbox.at(-1).content.text, /carries replies for emailupload\/ALPHA only/);
	const asPc = body => request(macUrl, "deliver", { comm: COMM, message: { id: randomUUID(), text: "forged" }, ...body }, pc.links.peers.get(macUrl).credential);
	assert.deepEqual(await asPc({ from: { record: "delta", name: "DELTA" }, to: "eps" }), [403, { comm: COMM, error: "not-shared" }], "a new message to an unshared project");
	// A pair ends when a session record is deleted: pc drops it at its tick, mac after the minute's grace.
	pcRecords.splice(pcRecords.indexOf("other"), 1);
	await pc.links.tick();
	assert.deepEqual([pc.links.store.pairs().map(p => p.local), names(pc.links)], [["alpha"], ["belot-beta~mac"]]);
	await mac.links.tick();
	assert.equal(mac.links.store.pairs().length, 2, "a minute's grace");
	mac.links.store.addPair({ ...mac.links.store.pairs().find(p => p.local === "gamma"), created: 0 });
	await mac.links.tick();
	assert.deepEqual([mac.links.store.pairs().map(p => p.local), names(mac.links)], [["beta"], ["emailupload-alpha~pc"]]);
	assert.deepEqual(createLinkStore(path.join(root, "pc")).pairs().map(p => p.remote.record), ["beta"], "pairs survive a restart");

	// PL-09: `@path` file attachments land in the target project's .pi/inbox and the message names the saved path (D-06 to D-09).
	const pcProj = path.join(root, "pc proj"), macProj = path.join(root, "mac proj"), macInbox = path.join(macProj, ".pi", "inbox"), outside = path.dirname(process.execPath);
	for (const dir of [pcProj, macProj]) fs.mkdirSync(dir);
	pcRecords.push("fp"); state.fp = { name: "FP", folder: pcProj, live: true };
	macRecords.push("fm"); state.fm = { name: "FM", folder: macProj, live: true };
	const fp = pc.agents.fp = await pc.broker.agent("fp"), fm = mac.agents.fm = await mac.broker.agent("fm"), toFm = "mac-proj-fm~mac";
	await mac.links.share(pcUrl, macProj, true); await pc.links.sync();
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

	// Plan 4d2fa07b S3: pc reads mac's shared project: confined to it (or its Pi session folder), secrets and .git refused, capped, logged.
	fs.mkdirSync(path.join(macProj, "src")); fs.mkdirSync(path.join(macProj, ".git"));
	fs.writeFileSync(path.join(macProj, "src", "a.txt"), "one\nneedle here\n");
	fs.writeFileSync(path.join(macProj, ".env"), "TOKEN=needle-secret\n");
	fs.writeFileSync(path.join(macProj, ".git", "config"), "needle in git\n");
	fs.writeFileSync(path.join(macProj, "big.txt"), Array.from({ length: 3000 }, (_, i) => `line ${i + 1} needle`).join("\n"));
	fs.symlinkSync(path.join(root, "mac"), path.join(macProj, "esc"), "junction");
	const sessionDir = path.join(root, "pi sessions", "--mac-proj--"); fs.mkdirSync(sessionDir, { recursive: true });
	state.fm.sessionFile = path.join(sessionDir, "s1.jsonl"); fs.writeFileSync(state.fm.sessionFile, '{"type":"session"}\n');
	const peerRead = body => pc.links.peer({ hub: "mac", project: "mac proj", ...body });
	const readLog = () => fs.readFileSync(path.join(root, "mac", "remote-reads.log"), "utf8").trim().split("\n");
	assert.deepEqual((await pc.links.peer({ op: "ls" })).hubs.map(h => [h.name, h.projects.map(p => p.folder)]), [["mac", [macProj]]], "no hub: what each paired hub shares");
	await assert.rejects(pc.links.peer({ op: "read", path: "x" }), /hub required/);
	assert.deepEqual((await peerRead({ op: "ls" })).text.split("\n"), [".pi/", "big.txt", "esc@", "src/"], "ls hides .env and .git; a link is marked");
	assert.equal((await peerRead({ op: "read", path: "src/a.txt" })).text, "one\nneedle here");
	assert.equal((await peerRead({ op: "read", path: "sessions/s1.jsonl" })).text, '{"type":"session"}', "sessions/ is the project's Pi session folder");
	assert.equal((await peerRead({ op: "ls", path: "sessions" })).text, "s1.jsonl");
	for (const [wanted, refused] of [[".env", /not readable/], [".git/config", /not readable/], ["../pc/peers.json", /not readable/], ["esc/peers.json", /not readable/], ["sessions/../../mac/peers.json", /not readable/], [path.join(root, "mac", "peers.json"), /not readable/], ["nope.txt", /does not exist/]])
		await assert.rejects(peerRead({ op: "read", path: wanted }), refused, wanted);
	await assert.rejects(peerRead({ op: "ls", path: "esc" }), /not readable/, "a junction out of the project");
	const big = await peerRead({ op: "read", path: "big.txt" });
	assert.deepEqual([big.text.split("\n").length, big.text.split("\n").at(-1)], [2001, "[more: offset 2001]"], "capped at 2000 lines");
	fs.writeFileSync(path.join(macProj, "wide.txt"), Array.from({ length: 100 }, () => "x".repeat(1023)).join("\n"));
	assert.equal((await peerRead({ op: "read", path: "wide.txt", limit: 5000 })).text.split("\n").at(-1), "[more: offset 51; cut at 2000 lines or 50 KB]", "and at 50 KB");
	assert.equal((await peerRead({ op: "read", path: "big.txt", offset: 2999, limit: 5 })).text, "line 2999 needle\nline 3000 needle");
	if (ripgrep()) {
		const found = (await peerRead({ op: "grep", pattern: "needle", path: "." })).text.split("\n");
		assert.equal(found.some(line => /secret|in git/.test(line)), false, "grep never sees .env or .git");
		assert.deepEqual([found.length > 1000 && Buffer.byteLength(found.join("\n")) <= 51_300, found.slice(0, -1).every(line => /^(big|wide|src\/a)\.txt:\d+:/.test(line)), found.at(-1)], [true, true, "[cut at 2000 lines or 50 KB]"], "capped, project-relative");
		assert.equal((await peerRead({ op: "grep", pattern: "needle", path: "src" })).text, "src/a.txt:2:needle here");
		assert.equal((await peerRead({ op: "grep", pattern: "NEEDLE-SECRET", ignoreCase: true })).text, "No matches.");
		assert.equal((await peerRead({ op: "grep", pattern: "session", path: "sessions/" })).text, 's1.jsonl:1:{"type":"session"}');
	} else console.log("skipped grep: no ripgrep here");
	await assert.rejects(grep(macProj, ".", "x", false, null), /ripgrep unavailable/);
	// Unshared: belot is a mac project pc cannot read, and pc's own folders are not mac's to read.
	const asPcRead = body => request(macUrl, "read", { comm: COMM, op: "ls", ...body }, pc.links.peers.get(macUrl).credential);
	assert.deepEqual(await asPcRead({ project: belot }), [403, { comm: COMM, error: "not-shared" }]);
	assert.deepEqual(await asPcRead({ project: emailupload }), [403, { comm: COMM, error: "not-shared" }]);
	assert.equal(readLog().length, ripgrep() ? 11 : 7, "one log line per served read");
	assert.match(readLog()[0], / pc ls .*mac proj \.$/);
	await pc.links.stop();
	assert.equal([...pc.broker.clients.keys()].some(id => id.startsWith("hublink-")), false, "stop disconnects stand-ins");
	// Unpair: both hubs forget each other, its shares and its pairs; mac's stand-ins go.
	assert.deepEqual(await pc.links.unpair(macUrl), { ok: true });
	await mac.links.sync();
	assert.deepEqual([pc.links.state().hubs, mac.links.state().hubs, pc.links.store.pairs(), mac.links.store.pairs(), mac.links.store.shares(), names(mac.links)], [[], [], [], [], [], []]);
	await mac.links.stop();

	// D-04: a version 1 list: project links become shares of this hub's folder, session links and pending unlinks go, named once.
	const legacy = path.join(root, "old");
	fs.mkdirSync(legacy);
	fs.writeFileSync(path.join(legacy, "links.json"), JSON.stringify({ version: 1, links: [
		{ id: "p1", kind: "project", folder: emailupload, hub: macUrl, remote: { name: "belot", folder: "/Users/f/belot" }, created: 1 },
		{ id: "p2", kind: "project", folder: emailupload, hub: macUrl, remote: { name: "x", folder: "/x" }, created: 1 },
		{ id: "s1", session: "alpha", hub: macUrl, remote: { record: "beta", name: "BETA", folder: "/Users/f/belot" }, created: 1 },
	], unlinks: [{ id: "u", hub: macUrl }] }));
	const upgraded = createLinks({ dataDir: legacy, devices: createDeviceRegistry(legacy), pairing: createPairing(createDeviceRegistry(legacy)), request, self: () => undefined, sessions: () => [{ record: "alpha", name: "ALPHA", folder: emailupload, live: true }] });
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(legacy, "links.json"), "utf8")), { version: 2, shares: [{ hub: macUrl, folder: emailupload }], pairs: [], dropped: [{ hub: macUrl, local: "alpha", remote: "belot/BETA" }] }, "written once at start");
	assert.deepEqual(upgraded.state().dropped, ["emailupload/ALPHA with belot/BETA on mac"]);
	upgraded.store.clearDropped();
	assert.deepEqual(upgraded.state().dropped, []);

	fs.writeFileSync(pc.links.store.file, "{");
	assert.throws(() => pc.links.store.pairs(), /corrupt/, "a corrupt link list fails closed");
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
console.log("link ok");
