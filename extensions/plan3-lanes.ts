// Plan3 helper slots (D-07, D-18 to D-20): reusable worktrees outside the repository that lanes and trials take
// turns in. slots.json (one per repository, beside the slots) is the admission and ownership record; each plan's
// logs/<id>.lanes.json mirrors its own lanes so step selection can read them without Git.
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { withPlanLock } from "./plan3-files.ts";

type Owner = { plan: string; id: string; kind: "lane" | "trial"; branch: string; base: string; run?: string; orphan?: boolean; started: string };
type Slot = { n: number; path: string; owner: Owner | null; lastPlan?: string; stale?: string[] };
type Scout = { plan: string; id: string; run?: string; at: number };
type Slots = { slots: Slot[]; scouts: Scout[] };
type Lane = { id: string; kind: "lane" | "trial"; slot: string; branch: string; base: string; run?: string };
export type LaneOpts = { cwd: string; plan: string; lanesFile: string; limit: number };

const exec = promisify(execFile);
export const git = (cwd: string, ...args: string[]) => exec("git", args, { cwd, timeout: 300_000, maxBuffer: 64 * 1024 * 1024 }).then((result) => result.stdout.trim());
const ID = /^[A-Za-z0-9][\w.-]{0,39}$/;
const checkId = (id: string, what = "id") => { if (!ID.test(id ?? "")) throw new Error(`Invalid ${what} "${id}": letters, digits, . _ - only.`); return id; };
const key = (file: string) => (process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file));

// ---------- helper run status (D-19) ----------
const TERMINAL = new Set(["complete", "failed", "partial", "paused", "stopped", "rejected"]);
// pi-subagents writes <temp root>/async-subagent-runs/<run>/status.json; the root is PI_SUBAGENTS_TEMP_ROOT or tmp/pi-subagents-<scope>.
let runState = (run: string): string | undefined => {
	const env = process.env.PI_SUBAGENTS_TEMP_ROOT?.trim();
	const roots = env ? [path.resolve(env)] : fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("pi-subagents-")).map((name) => path.join(os.tmpdir(), name));
	for (const root of roots) {
		try { return JSON.parse(fs.readFileSync(path.join(root, "async-subagent-runs", run, "status.json"), "utf8")).state; } catch {}
	}
	return undefined;
};
export const setRunState = (fn: typeof runState) => { runState = fn; };
// No recorded run means the helper was never launched; an unknown run is not proof it stopped.
const stopped = (run?: string) => !run || TERMINAL.has(runState(run) ?? "");

// ---------- locked JSON ----------
const held = new Set<string>();
async function locked<T>(file: string, change: () => T | Promise<T>): Promise<T> {
	return withPlanLock(file, async () => { held.add(key(file)); try { return await change(); } finally { held.delete(key(file)); } });
}
function load<T>(file: string, empty: T): T {
	try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { if (error.code === "ENOENT") return empty; throw error; }
}
// Every write happens under its file's lock, with decisions from the state read inside it.
export function save(file: string, data: unknown) {
	if (!held.has(key(file))) throw new Error(`${path.basename(file)} written outside its lock.`);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const temp = `${file}.${crypto.randomUUID()}.tmp`;
	fs.writeFileSync(temp, `${JSON.stringify(data, null, "\t")}\n`);
	for (let attempt = 0; ; attempt++) {
		try { fs.renameSync(temp, file); return; } catch (error) { if (attempt > 20 || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) { fs.rmSync(temp, { force: true }); throw error; } }
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
	}
}

// ---------- slot root and guard ----------
export async function repoRoot(cwd: string) { return path.resolve(await git(cwd, "rev-parse", "--show-toplevel")); }
export function slotRoot(repo: string) {
	const agent = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
	return path.join(agent, "worktrees", `${path.basename(repo)}-${crypto.createHash("sha256").update(key(repo)).digest("hex").slice(0, 8)}`);
}
const slotsFile = (repo: string) => path.join(slotRoot(repo), "slots.json");
// Destructive Git commands run only in a folder under this repository's slot root that Git lists as its worktree.
export async function assertSlot(repo: string, slot: string) {
	const root = key(slotRoot(repo)) + path.sep;
	const listed = (await git(repo, "worktree", "list", "--porcelain")).split(/\r?\n/).filter((line) => line.startsWith("worktree ")).map((line) => key(line.slice(9)));
	if (!key(slot).startsWith(root) || !listed.includes(key(slot))) throw new Error(`Refusing Git cleanup outside a registered Plan3 slot: ${slot}`);
}

// Free orphaned slots whose run has stopped and drop finished or expired scout reservations.
function reconcile(state: Slots) {
	for (const slot of state.slots) if (slot.owner?.orphan && stopped(slot.owner.run)) { slot.stale = [...slot.stale ?? [], slot.owner.branch]; slot.owner = null; }
	// shortcut: a scout reserved but never given a run expires after 15 min; record runs at launch if that proves too short.
	state.scouts = state.scouts.filter((scout) => scout.run ? !stopped(scout.run) : Date.now() - scout.at < 15 * 60_000);
}
const admitted = (state: Slots) => state.slots.filter((slot) => slot.owner).length + state.scouts.length;

async function setLanes(o: LaneOpts, change: (lanes: Lane[]) => Lane[]) {
	await locked(o.lanesFile, () => save(o.lanesFile, { lanes: change(load(o.lanesFile, { lanes: [] as Lane[] }).lanes) }));
}
export const laneOwned = (lanesFile: string) => load(lanesFile, { lanes: [] as Lane[] }).lanes.filter((lane) => lane.kind === "lane").map((lane) => lane.id);

// ---------- operations ----------
export async function laneStart(o: LaneOpts, id: string, kind: "lane" | "trial" = "lane") {
	checkId(id);
	const repo = await repoRoot(o.cwd), file = slotsFile(repo), root = slotRoot(repo);
	const base = await git(repo, "rev-parse", "HEAD");
	const branch = `plan3/${o.plan}/${id}`;
	const slot = await locked(file, () => {
		const state = load<Slots>(file, { slots: [], scouts: [] });
		reconcile(state);
		if (state.slots.some((item) => item.owner?.plan === o.plan && item.owner.id === id && !item.owner.orphan)) throw new Error(`${id} already has a ${kind}.`);
		if (admitted(state) >= o.limit) throw new Error(`All ${o.limit} helper places are taken; do ${id} yourself.`);
		let free = state.slots.find((item) => !item.owner);
		if (!free) {
			let n = 1;
			while (state.slots.some((item) => item.n === n) || fs.existsSync(path.join(root, `slot-${n}`))) n++;
			free = { n, path: path.join(root, `slot-${n}`), owner: null };
			state.slots.push(free);
		}
		free.owner = { plan: o.plan, id, kind, branch, base, started: new Date().toISOString() };
		free.lastPlan = o.plan;
		save(file, state);
		return { ...free };
	});
	try {
		if (fs.existsSync(slot.path)) {
			await assertSlot(repo, slot.path);
			// Reset tracked and untracked files to the base; ignored build output stays for incremental builds.
			await git(slot.path, "checkout", "-f", "-B", branch, base);
			await git(slot.path, "clean", "-fd");
		} else await git(repo, "worktree", "add", "-f", "-B", branch, slot.path, base);
		for (const old of slot.stale ?? []) if (old !== branch) await git(repo, "branch", "-D", old).catch(() => {});
	} catch (error) {
		await locked(file, () => {
			const state = load<Slots>(file, { slots: [], scouts: [] }), mine = state.slots.find((item) => item.n === slot.n);
			if (mine?.owner?.plan === o.plan && mine.owner.id === id) { mine.owner = null; save(file, state); }
		});
		throw error;
	}
	if (slot.stale?.length) await locked(file, () => {
		const state = load<Slots>(file, { slots: [], scouts: [] }), mine = state.slots.find((item) => item.n === slot.n);
		if (mine) { delete mine.stale; save(file, state); }
	});
	await setLanes(o, (lanes) => [...lanes.filter((lane) => lane.id !== id), { id, kind, slot: slot.path, branch, base }]);
	return { id, kind, slot: slot.path, branch, base };
}

// Records the helper run launched for a lane, trial or scout reservation (D-19).
export async function laneRun(o: LaneOpts, id: string, run: string) {
	checkId(id); checkId(run, "run id");
	const repo = await repoRoot(o.cwd), file = slotsFile(repo);
	await locked(file, () => {
		const state = load<Slots>(file, { slots: [], scouts: [] });
		const owner = state.slots.find((slot) => slot.owner?.plan === o.plan && slot.owner.id === id && !slot.owner.orphan)?.owner;
		const scout = state.scouts.find((item) => item.plan === o.plan && item.id === id);
		if (!owner && !scout) throw new Error(`No helper ${id} to record a run for.`);
		if (owner) owner.run = run; else scout.run = run;
		save(file, state);
	});
	await setLanes(o, (lanes) => lanes.map((lane) => lane.id === id ? { ...lane, run } : lane));
	return { id, run };
}

// A scout takes an admission place but no slot folder (D-20).
export async function laneScout(o: LaneOpts, id: string) {
	checkId(id);
	const file = slotsFile(await repoRoot(o.cwd));
	return locked(file, () => {
		const state = load<Slots>(file, { slots: [], scouts: [] });
		reconcile(state);
		if (state.scouts.some((item) => item.plan === o.plan && item.id === id)) throw new Error(`Scout ${id} is already admitted.`);
		if (admitted(state) >= o.limit) throw new Error(`All ${o.limit} helper places are taken; research ${id} yourself.`);
		state.scouts.push({ plan: o.plan, id, at: Date.now() });
		save(file, state);
		return { id, scout: true };
	});
}

// Gives the step back to the main agent. A stopped helper's slot is saved as a patch, reset and freed; a running one
// leaves its slot unavailable (orphan) until its run is confirmed stopped.
export async function laneDrop(o: LaneOpts, id: string) {
	checkId(id);
	const repo = await repoRoot(o.cwd), file = slotsFile(repo);
	const scoutGone = await locked(file, () => {
		const state = load<Slots>(file, { slots: [], scouts: [] }), before = state.scouts.length;
		state.scouts = state.scouts.filter((item) => !(item.plan === o.plan && item.id === id));
		if (state.scouts.length !== before) { save(file, state); return true; }
		return false;
	});
	if (scoutGone) return { id, dropped: "scout" };
	const slot = load<Slots>(file, { slots: [], scouts: [] }).slots.find((item) => item.owner?.plan === o.plan && item.owner.id === id);
	let result: { id: string; dropped: string; patch?: string };
	if (!slot) result = { id, dropped: "none" };
	else if (!stopped(slot.owner.run)) {
		await locked(file, () => {
			const state = load<Slots>(file, { slots: [], scouts: [] }), mine = state.slots.find((item) => item.n === slot.n);
			if (mine?.owner?.plan === o.plan && mine.owner.id === id) { mine.owner.orphan = true; save(file, state); }
		});
		result = { id, dropped: "orphan" };
	} else {
		await assertSlot(repo, slot.path);
		const owner = slot.owner;
		await git(slot.path, "add", "-A");
		const diff = await git(slot.path, "diff", "--cached", "--binary", owner.base);
		let patch;
		if (diff) {
			patch = path.join(slotRoot(repo), "patches", `${o.plan}-${id}-${new Date().toISOString().replace(/[:.]/g, "-")}.patch`);
			fs.mkdirSync(path.dirname(patch), { recursive: true });
			fs.writeFileSync(patch, `${diff}\n`);
		}
		await git(slot.path, "checkout", "-f", "--detach", owner.base);
		await git(slot.path, "clean", "-fd");
		await git(repo, "branch", "-D", owner.branch).catch(() => {});
		await locked(file, () => {
			const state = load<Slots>(file, { slots: [], scouts: [] }), mine = state.slots.find((item) => item.n === slot.n);
			if (mine?.owner?.plan === o.plan && mine.owner.id === id) { mine.owner = null; save(file, state); }
		});
		result = { id, dropped: owner.kind, ...patch && { patch } };
	}
	await setLanes(o, (lanes) => lanes.filter((lane) => lane.id !== id));
	return result;
}

export async function laneList(o: LaneOpts) {
	const file = slotsFile(await repoRoot(o.cwd));
	const state = await locked(file, () => { const state = load<Slots>(file, { slots: [], scouts: [] }); reconcile(state); save(file, state); return state; });
	return { limit: o.limit, used: admitted(state), slots: state.slots.map(({ n, path: folder, owner }) => ({ n, path: folder, owner })), scouts: state.scouts, lanes: load(o.lanesFile, { lanes: [] as Lane[] }).lanes };
}

// D-15: at plan completion remove the slots this plan used last; refuse while it still owns one. Trial patches stay.
export async function removePlanSlots(cwd: string, plan: string) {
	let repo;
	try { repo = await repoRoot(cwd); } catch { return []; } // Not a Git repository: no slots.
	const file = slotsFile(repo);
	if (!fs.existsSync(file)) return [];
	const gone = await locked(file, () => {
		const state = load<Slots>(file, { slots: [], scouts: [] });
		reconcile(state);
		const owned = state.slots.filter((slot) => slot.owner?.plan === plan).map((slot) => slot.owner.id);
		if (owned.length) throw new Error(`Helpers still hold ${owned.join(", ")}; land or drop them first.`);
		const gone = state.slots.filter((slot) => slot.lastPlan === plan);
		state.slots = state.slots.filter((slot) => slot.lastPlan !== plan);
		state.scouts = state.scouts.filter((scout) => scout.plan !== plan);
		save(file, state);
		return gone;
	});
	for (const slot of gone) {
		if (fs.existsSync(slot.path)) { await assertSlot(repo, slot.path); await git(repo, "worktree", "remove", "--force", slot.path); }
		for (const old of slot.stale ?? []) await git(repo, "branch", "-D", old).catch(() => {});
	}
	const branches = (await git(repo, "for-each-ref", "--format=%(refname:short)", `refs/heads/plan3/${plan}/`)).split(/\r?\n/).filter(Boolean);
	for (const branch of branches) await git(repo, "branch", "-D", branch).catch(() => {});
	return gone.map((slot) => slot.path);
}
