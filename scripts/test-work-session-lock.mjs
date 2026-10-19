import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { releaseSessionLock, takeSessionLock } from "../extensions/session-lock.ts";

// D9: same lock file format and takeover rules as pi-control-hub.
const dir = mkdtempSync(path.join(os.tmpdir(), "session-lock-"));
const file = path.join(dir, "s.jsonl"), lock = `${file}.lock`;
const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
try {
	const { info } = takeSessionLock(file);
	assert.equal(JSON.parse(readFileSync(lock, "utf8")).pid, process.pid);
	assert.deepEqual(takeSessionLock(file).info, info, "our own lock (after /reload) is kept");
	releaseSessionLock(file, info);
	assert(!existsSync(lock));

	// A live pid that started after the lock was written (reused pid, e.g. after a reboot) is not the holder.
	for (const startedAt of [1, Date.now() - 60_000]) {
		writeFileSync(lock, JSON.stringify({ pid: holder.pid, owner: "pi-control-hub", startedAt }));
		const stale = takeSessionLock(file).info;
		assert.equal(stale?.pid, process.pid, `a reused pid's lock is taken over (startedAt ${startedAt})`);
		releaseSessionLock(file, stale);
	}

	const startedAt = Date.now();
	writeFileSync(lock, JSON.stringify({ pid: holder.pid, owner: "pi-control-hub", startedAt }));
	assert.deepEqual(takeSessionLock(file), { holder: { pid: holder.pid, owner: "pi-control-hub", startedAt } }, "a live holder refuses");
	releaseSessionLock(file, info);
	assert(existsSync(lock), "never removes someone else's lock");

	holder.kill();
	await new Promise(resolve => holder.once("exit", resolve));
	const taken = takeSessionLock(file).info;
	assert.equal(taken?.pid, process.pid, "a dead holder is taken over");
	releaseSessionLock(file, taken);
	console.log("ok - session lock");
} finally {
	holder.kill();
	rmSync(dir, { recursive: true, force: true });
}
