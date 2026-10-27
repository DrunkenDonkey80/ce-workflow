// Auto-update: listed extension updates download with sessions running; a hub restart (own code, Pi, failed download)
// waits for two idle checks in a row, and the same reason is not retried within 6 hours.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAutoUpdate } from "../src/auto-update.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-auto-")), attemptsFile = path.join(dir, "auto-update.json");
try {
	let state = { pi: null, packages: ["ce-workflow", "x"], checkedAt: 1, checking: false, installed: [{ source: "git:ce-workflow", name: "ce-workflow", version: "1.0.0", update: true }, { source: "npm:x", name: "x", version: "1", update: true }] };
	let disk = "1.0.0", busy = ["Plan run"], clock = 0;
	const downloads = [], maintained = [];
	const auto = createAutoUpdate({
		state: () => state, refresh: async () => { state = { ...state, packages: [], installed: state.installed.map(item => ({ ...item, update: false })) }; },
		busy: () => busy, loaded: "1.0.0", disk: () => disk, attemptsFile, now: () => clock, log: () => {},
		download: async source => { downloads.push(source); if (source === "npm:x") throw new Error("EBUSY: locked"); if (source === "git:ce-workflow") disk = "1.0.1"; },
		maintain: async action => { maintained.push(action); },
	});
	await auto.tick();
	assert.deepEqual(downloads, ["git:ce-workflow", "npm:x"], "downloads with a session busy");
	assert.deepEqual(auto.waiting(), { action: "update", why: ["ce-workflow 1.0.0 → 1.0.1", "npm:x (download failed while sessions ran)"], busy: ["Plan run"] });
	assert.deepEqual(maintained, [], "never while a session is busy");
	busy = [];
	await auto.tick(); assert.deepEqual(maintained, [], "one idle check is not enough");
	await auto.tick(); assert.deepEqual(maintained, ["update"], "two idle checks: the hub updates (a failed download needs Pi's full update)");
	assert.equal(downloads.length, 2, "a tried download is not repeated");
	// The restart did not fix it: same reason, no loop until 6 hours later.
	const again = createAutoUpdate({ state: () => state, refresh: async () => {}, busy: () => [], loaded: "1.0.0", disk: () => "1.0.1", attemptsFile, now: () => clock, log: () => {}, download: async () => {}, maintain: async action => { maintained.push(action); } });
	await again.tick(); await again.tick(); await again.tick();
	assert.deepEqual(maintained, ["update", "restart"], "a different reason (only the code changed now) restarts");
	await again.tick(); await again.tick();
	assert.equal(maintained.length, 2, "the same reason waits 6 hours");
	clock += 6 * 3_600_000 + 1; await again.tick();
	assert.equal(maintained.length, 3, "and is tried again after them");
	assert.equal(createAutoUpdate({ state: () => ({ pi: null, packages: [], checkedAt: 1, checking: false }), refresh: async () => {}, busy: () => [], loaded: "1", disk: () => "1", attemptsFile, maintain: async () => {} }).waiting(), null, "nothing new: no waiting");
	console.log("auto-update ok");
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
