// Inter-hub links: the comm version check (D6), the paired-hub store and loading pi-intercom's client (present, absent, too old).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMM, commMismatch, createPeers, loadIntercom } from "../src/link.ts";
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
	peers.put({ name: "mac", url: "https://mac.tail1.ts.net:7781", credential, paired: 1 });
	peers.put({ name: "wsl", url: "https://home.tail1.ts.net:7782", credential, paired: 2 });
	peers.put({ name: "MacBook", url: "https://mac.tail1.ts.net:7781", credential, paired: 3 });
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
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
console.log("link ok");
