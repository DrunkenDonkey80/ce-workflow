// Hub session registry (H2-03). Being in the registry is what puts a session in its folder group (D18):
// hub-started sessions and starred recents both live here; unstarring removes the record, never the file.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { agentDir } from "./rpc-client.ts";

export type SessionState = "running" | "parked" | "terminal";
export type SessionRecord = {
	id: string;
	name: string;
	folder: string;
	sessionFile?: string; // unset until a new session's Pi reports its file
	state: SessionState;
	wasRunning?: boolean; // D17: running when the hub last stopped
	lastActivity?: number; // its idle clock then, kept across the restart
	createdAt: number;
};
export type Recent = { file: string; cwd: string; sessionId: string; name?: string; modified: number };

export const hubDataDir = () => path.join(agentDir(), "pi-control-hub");
const sameFile = (a?: string, b?: string) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** Windows refuses a rename over a file another process briefly holds (antivirus, indexer, a reader): EPERM/EACCES/EBUSY. Retry for about 2 s, like graceful-fs. */
function renameOver(from: string, to: string) {
	for (let attempt = 0; ; attempt++) {
		try { return renameSync(from, to); }
		catch (error) {
			if (attempt >= 20 || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * (attempt + 1)); // short synchronous back-off
		}
	}
}

export function writeJsonAtomic(file: string, value: unknown) {
	mkdirSync(path.dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
	try { writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }); renameOver(temporary, file); }
	finally { rmSync(temporary, { force: true }); }
}

export class Registry {
	readonly file: string;
	private records: SessionRecord[] = [];

	constructor(dataDir = hubDataDir()) {
		this.file = path.join(dataDir, "sessions.json");
		if (existsSync(this.file)) {
			const saved = JSON.parse(readFileSync(this.file, "utf8"));
			if (saved?.version !== 1 || !Array.isArray(saved.sessions)) throw new Error(`Unreadable hub registry: ${this.file}`);
			this.records = saved.sessions;
		}
	}

	private save() { writeJsonAtomic(this.file, { version: 1, sessions: this.records }); }
	list(): SessionRecord[] { return structuredClone(this.records); }
	get(id: string) { const record = this.records.find(r => r.id === id); return record && structuredClone(record); }
	byFile(file: string) { return this.records.find(r => sameFile(r.sessionFile, file)); }

	add(fields: { name: string; folder: string; sessionFile?: string; state?: SessionState }): SessionRecord {
		const name = fields.name.trim();
		if (!name) throw new Error("A session needs a name.");
		if (fields.sessionFile && this.byFile(fields.sessionFile)) throw new Error("That session is already in a group.");
		const record: SessionRecord = { id: crypto.randomUUID(), name, folder: path.resolve(fields.folder), sessionFile: fields.sessionFile, state: fields.state ?? "parked", createdAt: Date.now() };
		this.records.push(record); this.save();
		return structuredClone(record);
	}

	update(id: string, patch: Partial<Omit<SessionRecord, "id" | "createdAt">>): SessionRecord {
		const record = this.records.find(r => r.id === id);
		if (!record) throw new Error("Unknown session.");
		if (patch.name !== undefined && !patch.name.trim()) throw new Error("A session needs a name.");
		Object.assign(record, patch, patch.name !== undefined ? { name: patch.name.trim() } : {});
		this.save();
		return structuredClone(record);
	}

	/** Unstar: the record leaves its group; the session file is untouched. */
	remove(id: string) {
		const before = this.records.length;
		this.records = this.records.filter(r => r.id !== id);
		if (this.records.length === before) throw new Error("Unknown session.");
		this.save();
	}

	/** Groups are working folders (D2), sorted by folder name then session name. */
	groups(): { folder: string; label: string; sessions: SessionRecord[] }[] {
		const map = new Map<string, SessionRecord[]>();
		for (const record of this.records) {
			const key = record.folder.toLowerCase();
			map.set(key, [...(map.get(key) ?? []), structuredClone(record)]);
		}
		return [...map.values()]
			.map(sessions => ({ folder: sessions[0].folder, label: path.basename(sessions[0].folder) || sessions[0].folder, sessions: sessions.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) }))
			.sort((a, b) => a.label.localeCompare(b.label));
	}
}

const nameCache = new Map<string, { key: string; recent: Recent | null }>();

/** Session header (first line) plus the latest session_info name; other lines are not parsed. */
export async function readSessionSummary(file: string): Promise<Recent | null> {
	const stats = statSync(file);
	const key = `${stats.mtimeMs}:${stats.size}`;
	const cached = nameCache.get(file);
	if (cached?.key === key) return cached.recent;
	// A byte search is far faster than parsing every line of a large session file.
	const bytes = await readFile(file);
	const firstEnd = bytes.indexOf(10);
	let header: any, name: string | undefined;
	try { header = JSON.parse(bytes.subarray(0, firstEnd < 0 ? bytes.length : firstEnd).toString("utf8")); } catch { header = null; }
	if (header?.type !== "session" || typeof header.cwd !== "string") header = null;
	const at = header ? bytes.lastIndexOf('\n{"type":"session_info"') : -1;
	if (at >= 0) {
		const end = bytes.indexOf(10, at + 1);
		try { name = JSON.parse(bytes.subarray(at + 1, end < 0 ? bytes.length : end).toString("utf8")).name?.trim() || undefined; } catch {}
	}
	const recent = header ? { file, cwd: header.cwd, sessionId: String(header.id ?? ""), name, modified: stats.mtimeMs } : null;
	nameCache.set(file, { key, recent });
	return recent;
}

/** D18 Recents: Pi session files changed in the last `days` days that are not in a group, newest first. */
export async function scanRecents(registry: Registry, { sessionsDir = path.join(agentDir(), "sessions"), days = 30, now = Date.now() } = {}): Promise<Recent[]> {
	if (!existsSync(sessionsDir)) return [];
	const cutoff = now - days * 86_400_000;
	const files: string[] = [];
	for (const dir of readdirSync(sessionsDir, { withFileTypes: true })) {
		if (!dir.isDirectory()) continue;
		const folder = path.join(sessionsDir, dir.name);
		for (const entry of readdirSync(folder, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
			const file = path.join(folder, entry.name);
			if (statSync(file).mtimeMs >= cutoff && !registry.byFile(file)) files.push(file);
		}
	}
	const recents = (await Promise.all(files.map(file => readSessionSummary(file).catch(() => null)))).filter(r => r !== null);
	return recents.sort((a, b) => b.modified - a.modified);
}

/** The first free number in a folder's group, the default session name. */
export function nextName(registry: Registry, folder: string) {
	const taken = new Set(registry.list().filter(r => r.folder.toLowerCase() === path.resolve(folder).toLowerCase()).map(r => r.name));
	let n = 1; while (taken.has(String(n))) n++;
	return String(n);
}

/** Star: a recent session joins its folder's group under the given name (D18). */
export function star(registry: Registry, recent: Recent, name: string) {
	return registry.add({ name, folder: recent.cwd, sessionFile: recent.file, state: "parked" });
}
