import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_GRANT_MS = 48 * 60 * 60 * 1000;
const MAX_STATE_BYTES = 1024 * 1024;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
type Device = { id: string; label: string };
type Grant = { id: string; project: string; device: string; revision: string; kind: "once" | "time"; request: string; issuedAt: number; expiresAt: number };
export type CameraLease = { id: string; project: string; device: string; revision: string; grant: string; kind: "once" | "time"; expiresAt: number; ownerPid: number; workerPid: number; childPid: number };
type State = { version: 1; seenAt: number; revisions: Record<string, string>; grants: Record<string, Grant>; leases: Record<string, CameraLease> };
export const cameraRequestKey = (request: unknown) => createHash("sha256").update(JSON.stringify(request)).digest("hex");
const key = (value: string) => createHash("sha256").update(value).digest("hex");
export function cameraProject(cwd: string) {
	const canonical = realpathSync(cwd);
	return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}
// DirectShow moniker casing must not allow two owners of the same Windows camera.
const deviceKey = (id: string) => key(id.toLowerCase());
const grantKey = (project: string, id: string) => key(JSON.stringify([project, id]));
const pid = (value: number) => Number.isSafeInteger(value) && value >= 0;
const instant = (value: number) => Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown) => Boolean(value && typeof value === "object" && !Array.isArray(value));
function alive(processId: number) {
	if (!processId) return false;
	try { process.kill(processId, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
function validScope(value: Grant | CameraLease) {
	return uuid.test(value.id) && typeof value.project === "string" && isAbsolute(value.project) &&
		typeof value.device === "string" && /^@device_[a-z]+_/i.test(value.device) && value.device.length <= 2048 &&
		!/[\x00-\x1f\x7f":]/.test(value.device) && (value.revision === "" || uuid.test(value.revision)) &&
		(value.kind === "once" || value.kind === "time") && instant(value.expiresAt);
}
function readState(file: string): State {
	if (!existsSync(file)) return { version: 1, seenAt: 0, revisions: {}, grants: {}, leases: {} };
	if (statSync(file).size > MAX_STATE_BYTES) throw new Error("Camera permission store exceeds its bounded size.");
	let state: State;
	try { state = JSON.parse(readFileSync(file, "utf8"), (name, value) => {
		if (["__proto__", "constructor", "prototype"].includes(name)) throw new Error("Unsafe camera state key");
		return value;
	}); } catch { throw new Error("Camera permission store is corrupt; access denied. Repair it only with camera activity stopped."); }
	if (!record(state) || state.version !== 1 || !instant(state.seenAt) || !record(state.revisions) || !record(state.grants) || !record(state.leases))
		throw new Error("Invalid camera permission store; access denied.");
	for (const [scope, revision] of Object.entries(state.revisions))
		if (!hash.test(scope) || !uuid.test(revision)) throw new Error("Invalid camera revocation record.");
	for (const [scope, grant] of Object.entries(state.grants))
		if (!record(grant) || !validScope(grant) || scope !== grantKey(grant.project, grant.device) ||
			!instant(grant.issuedAt) || grant.issuedAt > state.seenAt || grant.expiresAt <= grant.issuedAt || grant.expiresAt - grant.issuedAt > MAX_GRANT_MS ||
			!(grant.request === "" && grant.kind === "time" || hash.test(grant.request) && grant.kind === "once"))
			throw new Error("Invalid camera grant; access denied.");
	for (const [scope, lease] of Object.entries(state.leases))
		if (!record(lease) || !validScope(lease) || scope !== deviceKey(lease.device) || !uuid.test(lease.grant) ||
			lease.expiresAt > state.seenAt + MAX_GRANT_MS || !pid(lease.ownerPid) || !lease.ownerPid || !pid(lease.workerPid) || !pid(lease.childPid))
			throw new Error("Invalid camera ownership record; access denied.");
	return state;
}

// Metadata only: creating this object starts no timers, processes or acquisition.
export function createCameraState({ directory = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "camera"), now = Date.now } = {}) {
	const root = resolve(directory);
	async function transaction<T>(cwd: string, change: (state: State, project: string, time: number) => T, mode: "access" | "cleanup" = "access"): Promise<T> {
		let project = resolve(cwd);
		if (process.platform === "win32") project = project.toLowerCase();
		if (existsSync(cwd)) project = cameraProject(cwd);
		else if (mode === "access") throw new Error("Camera project is unavailable; access denied.");
		const inside = (dir: string) => {
			const path = relative(project, dir);
			return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
		};
		let ancestor = root;
		const parts: string[] = [];
		while (!existsSync(ancestor)) { parts.unshift(basename(ancestor)); ancestor = dirname(ancestor); }
		if (inside(root) || inside(join(realpathSync(ancestor), ...parts))) throw new Error("Camera permission storage must be outside the project.");
		mkdirSync(root, { recursive: true, mode: 0o700 });
		const actual = realpathSync(root);
		if (inside(actual)) throw new Error("Camera permission storage resolves inside the project.");
		const lock = join(actual, "state.lock");
		const file = join(actual, "state.json");
		let fd: number;
		const until = performance.now() + 2000;
		for (;;) {
			try { fd = openSync(lock, "wx", 0o600); break; }
			catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				// ponytail: a forced crash during a metadata write leaves a fail-closed lock; remove it only with all Pi processes stopped.
				if (performance.now() >= until) throw new Error("Camera state is busy or has a stale lock; access denied. Stop all Pi processes before removing state.lock.");
				await new Promise(done => setTimeout(done, 10));
			}
		}
		const temporary = join(actual, `state-${randomUUID()}.tmp`);
		try {
			const state = readState(file);
			const time = now();
			if (!instant(time) || mode === "access" && time < state.seenAt) throw new Error("Clock moved backwards; camera access denied until the clock is corrected.");
			if (mode === "access") state.seenAt = time;
			for (const [scope, grant] of Object.entries(state.grants)) if (grant.expiresAt <= time) delete state.grants[scope];
			const result = change(state, project, time);
			const text = JSON.stringify(state);
			if (Buffer.byteLength(text) > MAX_STATE_BYTES) throw new Error("Camera permission store exceeds its bounded size; no new permission saved.");
			writeFileSync(temporary, text, { flag: "wx", mode: 0o600 });
			renameSync(temporary, file);
			return result;
		} finally {
			try { rmSync(temporary, { force: true }); }
			finally { try { closeSync(fd); } finally { rmSync(lock, { force: true }); } }
		}
	}
	const revision = (state: State, project: string) => state.revisions[key(project)] ?? "";
	return {
		directory: root,
		present() { return existsSync(join(root, "state.json")) || existsSync(join(root, "state.lock")); },
		revision(cwd: string) { return transaction(cwd, (state, project) => ({ project, revision: revision(state, project) })); },
		issue(cwd: string, device: Device, choice: { kind: "once" | "time"; expiresAt: number }, expectedScope: { project: string; revision: string }, request: string, assertApproval?: () => void) {
			return transaction(cwd, (state, project, time) => {
				assertApproval?.();
				if (project !== expectedScope.project || revision(state, project) !== expectedScope.revision) throw new Error("Camera project changed or permission was revoked while approval was pending.");
				if (!instant(choice.expiresAt) || choice.expiresAt <= time || choice.expiresAt > time + MAX_GRANT_MS || !hash.test(request)) throw new Error("Invalid camera grant deadline/scope.");
				const grant: Grant = { id: randomUUID(), project, device: device.id, revision: expectedScope.revision, kind: choice.kind, request: choice.kind === "once" ? request : "", issuedAt: time, expiresAt: choice.expiresAt };
				if (!validScope(grant)) throw new Error("Invalid camera device/scope.");
				state.grants[grantKey(project, device.id)] = grant;
				return { ...grant };
			});
		},
		grant(cwd: string, device: Device) {
			return transaction(cwd, (state, project, time) => {
				const grant = state.grants[grantKey(project, device.id)];
				return grant && grant.issuedAt <= time && grant.revision === revision(state, project) ? { ...grant } : undefined;
			});
		},
		claim(cwd: string, device: Device, grantId: string, request: string, deadlineMs: number) {
			return transaction(cwd, (state, project, time) => {
				const scope = grantKey(project, device.id);
				const grant = state.grants[scope];
				if (!grant || grant.id !== grantId || grant.revision !== revision(state, project) || grant.kind === "once" && grant.request !== request)
					throw new Error("Camera permission expired, consumed, revoked or belongs to another request.");
				if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > MAX_GRANT_MS || !hash.test(request)) throw new Error("Invalid bounded camera deadline/scope.");
				const occupied = state.leases[deviceKey(device.id)];
				if (occupied && [occupied.ownerPid, occupied.workerPid, occupied.childPid].some(alive)) throw new Error("Camera is owned by another active request; no concurrent acquisition allowed.");
				const lease: CameraLease = { id: randomUUID(), project, device: device.id, revision: grant.revision, grant: grant.id, kind: grant.kind, expiresAt: Math.min(grant.expiresAt, time + deadlineMs), ownerPid: process.pid, workerPid: 0, childPid: 0 };
				if (grant.kind === "once") delete state.grants[scope];
				state.leases[deviceKey(device.id)] = lease;
				return { ...lease };
			});
		},
		validate(cwd: string, lease: CameraLease) {
			return transaction(cwd, (state, project, time) => {
				const current = state.leases[deviceKey(lease.device)];
				if (!current || current.id !== lease.id || current.ownerPid !== process.pid || lease.project !== project ||
					current.revision !== revision(state, project) || current.expiresAt <= time ||
					current.kind === "time" && (state.grants[grantKey(project, lease.device)]?.id !== current.grant || current.expiresAt > state.grants[grantKey(project, lease.device)].expiresAt))
					throw new Error("Camera ownership/permission expired or was revoked.");
				return current.expiresAt;
			});
		},
		worker(cwd: string, lease: CameraLease, workerPid: number, childPid = 0) {
			return transaction(cwd, (state, project) => {
				const current = state.leases[deviceKey(lease.device)];
				if (!current || current.id !== lease.id || current.project !== project || current.ownerPid !== process.pid || !pid(workerPid) || !pid(childPid)) throw new Error("Camera ownership changed or has invalid process identity.");
				current.workerPid = workerPid; current.childPid = childPid;
			});
		},
		release(cwd: string, lease: CameraLease) {
			return transaction(cwd, (state, project) => {
				const current = state.leases[deviceKey(lease.device)];
				if (current?.id === lease.id && current.project === project && current.ownerPid === process.pid) delete state.leases[deviceKey(lease.device)];
			}, "cleanup");
		},
		revoke(cwd: string) {
			return transaction(cwd, (state, project) => {
				state.revisions[key(project)] = randomUUID();
				for (const [scope, grant] of Object.entries(state.grants)) if (grant.project === project) delete state.grants[scope];
			}, "cleanup");
		},
	};
}
