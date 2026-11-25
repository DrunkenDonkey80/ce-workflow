#!/usr/bin/env node
// Plan3 helper slots: admission across plans, reuse, run-status guard, drop patches and plan cleanup.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const temp = mkdtempSync(path.join(os.tmpdir(), "plan3-lanes-"));
process.env.PI_CODING_AGENT_DIR = path.join(temp, "agent");
Object.assign(process.env, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });
const { assertSlot, laneDrop, laneList, laneOwned, laneRun, laneScout, laneStart, removePlanSlots, setRunState, slotRoot } = await import("../extensions/plan3-lanes.ts");

const repo = path.join(temp, "repo");
mkdirSync(repo);
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
git(repo, "init", "-q", "-b", "master");
git(repo, "config", "core.autocrlf", "false");
writeFileSync(path.join(repo, "a.txt"), "one\n");
writeFileSync(path.join(repo, ".gitignore"), "target/\n");
git(repo, "add", "-A");
git(repo, "commit", "-qm", "base");
const head = git(repo, "rev-parse", "HEAD");
// The main checkout is mid-step: a modified tracked file and an untracked file.
writeFileSync(path.join(repo, "a.txt"), "main edit\n");
writeFileSync(path.join(repo, "new.txt"), "main untracked\n");

const states = new Map();
setRunState((run) => states.get(run));
const opts = (plan, limit = 1) => ({ cwd: repo, plan, limit, lanesFile: path.join(repo, "docs", "plans", "logs", `${plan}.lanes.json`) });
const A = opts("aaaa1111"), B = opts("bbbb2222");

try {
	const first = await laneStart(A, "W-02");
	assert.equal(first.base, head);
	assert.equal(git(first.slot, "branch", "--show-current"), "plan3/aaaa1111/W-02");
	assert.equal(readFileSync(path.join(first.slot, "a.txt"), "utf8"), "one\n", "the slot starts at HEAD, not the dirty main checkout");
	assert.deepEqual(laneOwned(A.lanesFile), ["W-02"]);
	await assert.rejects(laneStart(B, "X-01"), /helper places are taken/, "another plan cannot take the same repository's last place");
	await assert.rejects(laneScout(B, "q1"), /helper places are taken/, "scouts share the cap");

	// The helper works: ignored build output, a tracked edit and an untracked file.
	mkdirSync(path.join(first.slot, "target"));
	writeFileSync(path.join(first.slot, "target", "out.bin"), "build");
	writeFileSync(path.join(first.slot, "a.txt"), "helper edit\n");
	writeFileSync(path.join(first.slot, "helper.txt"), "helper untracked\n");
	await laneRun(A, "W-02", "run-1");
	states.set("run-1", "running");
	assert.deepEqual(await laneDrop(A, "W-02"), { id: "W-02", dropped: "orphan" }, "a running helper keeps its slot");
	assert(existsSync(path.join(first.slot, "helper.txt")), "no reset while the run is not confirmed stopped");
	assert.deepEqual(laneOwned(A.lanesFile), [], "the step goes back to the main agent at once");
	await assert.rejects(laneStart(A, "W-03"), /helper places are taken/, "no reuse while the run is not confirmed stopped");
	await assert.rejects(removePlanSlots(repo, "aaaa1111"), /still hold W-02/, "no removal while the run is not confirmed stopped");

	states.set("run-1", "complete");
	const second = await laneStart(A, "W-03");
	assert.equal(second.slot, first.slot, "a stopped helper's slot is reused");
	assert.equal(readFileSync(path.join(second.slot, "target", "out.bin"), "utf8"), "build", "ignored build output stays");
	assert.equal(readFileSync(path.join(second.slot, "a.txt"), "utf8"), "one\n", "tracked changes are reset");
	assert(!existsSync(path.join(second.slot, "helper.txt")), "untracked files are removed");
	assert(!git(repo, "branch", "--list", "plan3/aaaa1111/W-02"), "the orphan's branch is deleted");

	// Drop of a stopped helper saves its work as a patch outside the slot and frees the slot.
	writeFileSync(path.join(second.slot, "trial.txt"), "kept as a patch\n");
	const dropped = await laneDrop(A, "W-03");
	assert.equal(dropped.dropped, "lane");
	assert.match(readFileSync(dropped.patch, "utf8"), /kept as a patch/);
	assert(!dropped.patch.startsWith(second.slot), "patches live outside the slot");
	assert(!git(repo, "branch", "--list", "plan3/aaaa1111/W-03"), "drop deletes the branch");
	assert.deepEqual((await laneList(A)).slots.map((slot) => slot.owner), [null]);

	// Scouts take a place without a slot; a finished scout run frees it. A holds slot-1, so B gets slot-2.
	await laneStart(A, "W-05");
	const two = opts("bbbb2222", 3);
	await laneScout(two, "q1");
	await laneRun(two, "q1", "run-2");
	states.set("run-2", "running");
	await laneStart(two, "X-01");
	await assert.rejects(laneScout(two, "q2"), /helper places are taken/);
	states.set("run-2", "complete");
	await laneScout(two, "q2");
	assert.equal((await laneList(two)).used, 3);
	await laneDrop(A, "W-05");

	await assert.rejects(assertSlot(repo, repo), /outside a registered Plan3 slot/, "destructive Git refuses the main checkout");
	await assert.rejects(removePlanSlots(repo, "bbbb2222"), /still hold X-01/);
	await laneDrop(two, "X-01");
	await laneDrop(two, "q2");

	// Completion removes the plan's slots and branches only; patches stay; the main checkout is untouched.
	const removed = await removePlanSlots(repo, "aaaa1111");
	assert.deepEqual(removed, [first.slot]);
	assert(!existsSync(first.slot));
	assert(existsSync(dropped.patch));
	assert.equal((await laneList(two)).slots.length, 1, "plan B's slot stays");
	assert.deepEqual([readFileSync(path.join(repo, "a.txt"), "utf8"), readFileSync(path.join(repo, "new.txt"), "utf8"), git(repo, "branch", "--show-current")], ["main edit\n", "main untracked\n", "master"]);
	assert.deepEqual(readdirSync(slotRoot(repo)).sort(), ["patches", "slot-2", "slots.json"]);
	console.log("plan3 lanes ok");
} finally {
	rmSync(temp, { recursive: true, force: true, maxRetries: 5 });
}
