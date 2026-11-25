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
const { assertSlot, laneDrop, laneLand, laneList, lanePick, laneOwned, laneRun, laneScout, laneStart, removePlanSlots, setRunState, slotGuard, slotRoot } = await import("../extensions/plan3-lanes.ts");

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

	// Landing (D-08): pick onto current HEAD inside the slot, check there, fast-forward the main checkout.
	const C = opts("cccc3333", 2);
	const commit = (cwd, file, text) => { mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true }); writeFileSync(path.join(cwd, file), text); git(cwd, "add", file); git(cwd, "commit", "-qm", `edit ${file}`); };
	const mainHead = () => git(repo, "rev-parse", "HEAD");
	const userDirt = () => [readFileSync(path.join(repo, "a.txt"), "utf8"), readFileSync(path.join(repo, "new.txt"), "utf8")];

	let lane = await laneStart(C, "L-01");
	commit(lane.slot, "b.txt", "1\n");
	commit(lane.slot, "c.txt", "2\n");
	await laneRun(C, "L-01", "run-3");
	states.set("run-3", "running");
	await assert.rejects(laneLand(C, "L-01"), /still running/, "the range is pinned only once the helper stopped");
	states.set("run-3", "complete");
	await assert.rejects(laneLand(C, "L-01"), /Pick L-01 first/);
	let before = mainHead();
	assert.equal((await lanePick(C, "L-01")).picked, 2);
	assert.equal(mainHead(), before, "a pick (and a failing check after it) leaves master untouched");
	assert.equal((await laneLand(C, "L-01")).landed, mainHead());
	assert.deepEqual(git(repo, "log", "--format=%s", "-2").split("\n"), ["edit c.txt", "edit b.txt"], "two lane commits land in order");
	assert.deepEqual(userDirt(), ["main edit\n", "main untracked\n"]);
	assert.deepEqual(laneOwned(C.lanesFile), []);
	assert(!git(repo, "branch", "--list", "plan3/cccc3333/L-01"));

	lane = await laneStart(C, "L-02");
	commit(lane.slot, "docs/plans/x.md", "plan\n");
	await assert.rejects(lanePick(C, "L-02"), /changes plan files \(docs\/plans\/x.md\)/);
	await laneDrop(C, "L-02");

	// A conflict on the second commit aborts the whole pick and names the file.
	lane = await laneStart(C, "L-03");
	commit(lane.slot, "d.txt", "lane\n");
	commit(lane.slot, "b.txt", "lane b\n");
	commit(repo, "b.txt", "main b\n");
	before = mainHead();
	const laneTip = git(lane.slot, "rev-parse", lane.branch);
	await assert.rejects(lanePick(C, "L-03"), /conflicts with current master in b.txt; nothing landed/);
	assert.deepEqual([mainHead(), git(lane.slot, "rev-parse", lane.branch), git(lane.slot, "rev-parse", "HEAD"), git(lane.slot, "status", "--porcelain")], [before, laneTip, laneTip, ""]);
	assert.deepEqual(userDirt(), ["main edit\n", "main untracked\n"]);
	await laneDrop(C, "L-03");

	// HEAD moved after the pick: land picks again instead of moving master.
	lane = await laneStart(C, "L-04");
	commit(lane.slot, "e.txt", "lane e\n");
	await lanePick(C, "L-04");
	commit(repo, "g.txt", "main g\n");
	const again = await laneLand(C, "L-04");
	assert.deepEqual([again.repicked, again.onto], [true, mainHead()]);
	await laneLand(C, "L-04");
	assert.equal(readFileSync(path.join(repo, "e.txt"), "utf8"), "lane e\n");

	// The user's dirty file in a landed path makes the fast-forward refuse without loss.
	lane = await laneStart(C, "L-05");
	commit(lane.slot, "a.txt", "lane a\n");
	await lanePick(C, "L-05");
	before = mainHead();
	await assert.rejects(laneLand(C, "L-05"), /master did not move/);
	assert.deepEqual([mainHead(), ...userDirt()], [before, "main edit\n", "main untracked\n"]);
	await laneDrop(C, "L-05");

	// D-17 watch: the main checkout switched branch behind the main agent's back.
	lane = await laneStart(C, "L-06");
	commit(lane.slot, "h.txt", "lane h\n");
	git(repo, "checkout", "-q", "-b", "elsewhere");
	await assert.rejects(lanePick(C, "L-06"), /Main checkout changed outside the main agent/);
	git(repo, "checkout", "-q", "master");
	git(repo, "reset", "-q", "--keep", "HEAD~1");
	await assert.rejects(lanePick(C, "L-06"), /Main checkout changed outside the main agent/, "rewritten history is caught too");
	await laneDrop(C, "L-06");

	// D-17/D-13 child guard: active only in a helper child whose cwd is a registered slot.
	lane = await laneStart(C, "L-07");
	const call = (toolName, input, cwd = lane.slot) => slotGuard({ toolName, input }, cwd);
	assert.equal(call("write", { path: path.join(repo, "x.txt") }), "", "the main agent (no child flag) is not guarded");
	process.env.PI_SUBAGENT_CHILD = "1";
	try {
		assert.match(call("write", { path: path.join(repo, "x.txt") }), /only inside their slot/, "a write into the main checkout is blocked");
		assert.match(call("edit", { path: "../other/x.txt" }), /only inside their slot/, "a relative edit leaving the slot is blocked");
		assert.equal(call("write", { path: "src/new.txt" }), "", "a write inside the slot passes");
		assert.equal(call("bash", { command: "git add -A && git commit -m L-07 && git checkout -- a.txt" }), "", "own-branch work passes");
		assert.match(call("bash", { command: `cat "${repo.replaceAll("\\", "/")}/a.txt"` }), /main checkout/, "naming the main checkout is blocked");
		assert.match(call("bash", { command: "git push origin HEAD" }), /no branch or ref/);
		assert.match(call("bash", { command: "git checkout master" }), /no branch or ref/, "switching branch is blocked");
		assert.match(call("bash", { command: "git branch -f master HEAD" }), /no branch or ref/, "moving another branch is blocked");
		assert.match(call("bash", { command: "shutdown /?" }), /Night mode blocks reboot/, "night-blocked commands are always refused");
		assert.equal(call("write", { path: path.join(repo, "x.txt") }, repo), "", "outside a slot the hook does nothing");
	} finally { delete process.env.PI_SUBAGENT_CHILD; }
	await laneDrop(C, "L-07");
	console.log("plan3 lanes ok");
} finally {
	rmSync(temp, { recursive: true, force: true, maxRetries: 5 });
}
