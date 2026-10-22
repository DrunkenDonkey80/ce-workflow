import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultCommand, RpcChild, stripAnsi } from "../src/rpc-client.ts";
const fake = fileURLToPath(new URL("./fake-pi.mjs", import.meta.url));
const start = (flags = "") => new RpcChild({ cwd: os.tmpdir(), command: [process.execPath, fake], env: { FAKE_PI: flags } }).start();

// Login services lack the shell's PATH: managed launchers must work by absolute path.
{
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub rpc "));
	const saved = process.env.PI_CODING_AGENT_DIR;
	let pi;
	try {
		process.env.PI_CODING_AGENT_DIR = root;
		const bin = path.join(root, "bin"), legacy = path.join(bin, "pi-launcher.js"), launcher = path.join(bin, "pi");
		fs.mkdirSync(bin);
		assert.deepEqual(defaultCommand(), ["pi"], "npm installs keep the PATH fallback");
		fs.writeFileSync(legacy, "");
		assert.deepEqual(defaultCommand(), [process.execPath, legacy], "Windows/legacy JS launcher stays supported");
		if (process.platform !== "win32") {
			fs.writeFileSync(launcher, '#!/bin/sh\nexec "$FAKE_PI_NODE" "$FAKE_PI_SCRIPT" "$@"\n', { mode: 0o755 });
			assert.deepEqual(defaultCommand(), [process.execPath, legacy], "existing JS launcher keeps precedence");
			fs.rmSync(legacy);
			assert.deepEqual(defaultCommand(), [launcher]);
			pi = new RpcChild({ cwd: root, env: { PATH: bin, FAKE_PI_NODE: process.execPath, FAKE_PI_SCRIPT: fake } }).start();
			assert.equal((await pi.send({ type: "get_state" })).success, true, "managed shell launcher starts without pi on PATH");
		}
	} finally {
		if (pi) await pi.stop();
		if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = saved;
		fs.rmSync(root, { recursive: true, force: true });
	}
}

// Split records, U+2028 and multi-byte text survive framing; ANSI is stripped from status text.
{
	const pi = start("split-output");
	const status = new Promise(r => pi.once("ui", r));
	const ended = new Promise(r => pi.on("event", e => e.type === "agent_end" && r(e)));
	const text = "line\u2028sep ünï 🐴 \"q\"";
	assert.equal((await pi.send({ type: "prompt", message: text })).data.disposition, "started");
	assert.equal((await ended).messages[0].content[0].text, `echo: ${text}`);
	assert.equal((await status).statusText, "ready");
	assert.equal((await pi.stop()).code, 0);
}
// Out-of-order responses: a slow extension command answers after a later get_state (F6); UI round trip.
{
	const pi = start("slow-command");
	pi.on("ui", r => r.method === "input" && pi.respondUi(r.id, { value: r.placeholder + "!" }));
	const notify = new Promise(r => pi.on("ui", u => u.method === "notify" && r(u.message)));
	const order = [];
	const slow = pi.send({ type: "prompt", message: "/ask hello" }).then(r => order.push(r.command));
	const fast = pi.send({ type: "get_state" }).then(r => order.push(r.command));
	await Promise.all([slow, fast]);
	assert.deepEqual(order, ["get_state", "prompt"]);
	assert.equal(await notify, "answer:hello!");
	assert.equal((await pi.send({ type: "nope" })).success, false);
	await pi.stop();
}
// Crash mid-request rejects pending sends with the exit code; later sends fail fast.
{
	const pi = start("crash-on-prompt");
	await assert.rejects(pi.send({ type: "prompt", message: "x" }), /code 3/);
	assert.equal((await pi.exited).code, 3);
	await assert.rejects(pi.send({ type: "get_state" }), /not running/);
}
assert.equal(stripAnsi("\u001b[38;2;1;2;3m●\u001b[39m ok"), "● ok");
console.log("rpc client ok");
