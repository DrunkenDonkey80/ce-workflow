// Daily cleanup of Pi's session files. Younger files, and each session the hub parks: only the part before the latest
// compaction is trimmed (the model never reads it again). Untouched for 14 days: images and long tool output are trimmed
// throughout (the file stays resumable); subagent forks are deleted. Untouched for 30 days: deleted. Sessions in the hub sidebar are only trimmed.
// Deleted files go to the Recycle Bin (the freedesktop Trash on Linux). Age is the last write, and a trimmed file keeps its old one.
import { execFile } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { finished } from "node:stream/promises";
import { promisify } from "node:util";
import type { Registry } from "./registry.ts";
import { holderAlive, readLock } from "./session-lock.ts";

const HOUR = 3_600_000, DAY = 86_400_000, TRIM_DAYS = 14, DELETE_DAYS = 30, KEEP = 500;

function trimContent(content: unknown[], tool: boolean) {
	let changed = false;
	const parts = content.map((part: any) => {
		if (part?.type === "image") { changed = true; return { type: "text", text: "[image removed]" }; }
		// +100: an already trimmed text (500 plus the note) is left alone.
		if (tool && part?.type === "text" && typeof part.text === "string" && part.text.length > KEEP + 100) {
			changed = true; return { ...part, text: `${part.text.slice(0, KEEP)}\n[… ${part.text.length - KEEP} more characters trimmed]` };
		}
		return part;
	});
	return changed ? parts : null;
}

/** One JSONL line, trimmed; the same string when there is nothing to trim. */
export function trimLine(line: string) {
	if (!line.includes('"image"') && !line.includes('"toolResult"')) return line;
	let entry; try { entry = JSON.parse(line); } catch { return line; }
	const message = entry?.message;
	if (!message || !Array.isArray(message.content)) return line;
	const tool = message.role === "toolResult", content = trimContent(message.content, tool);
	const details = tool && message.details && !(Object.keys(message.details).length === 1 && typeof message.details.diff === "string" && message.details.diff.length <= 2000);
	if (!content && !details) return line;
	// Only an edit's diff survives from details, clipped: the hub chat shows it.
	entry.message = { ...message, ...content && { content }, ...details && { details: typeof message.details.diff === "string" ? { diff: message.details.diff.slice(0, 2000) } : undefined } };
	return JSON.stringify(entry);
}

const lines = (file: string) => createInterface({ input: createReadStream(file), crlfDelay: Infinity });

/** The entry the latest compaction keeps from: everything before it never reaches the model again. */
async function compactedUpTo(file: string) {
	let kept: string | undefined;
	for await (const line of lines(file)) if (line.includes('"compaction"')) try { const entry = JSON.parse(line); if (entry.type === "compaction" && entry.firstKeptEntryId) kept = entry.firstKeptEntryId; } catch { /* a torn line */ }
	return kept;
}

/** Trims the whole file, or with `compacted` only the part before the latest compaction's kept entries. */
async function trimFile(file: string, compacted = false) {
	const kept = compacted ? await compactedUpTo(file) : undefined;
	if (compacted && !kept) return 0;
	const before = statSync(file), temp = `${file}.${process.pid}.trim`;
	const out = createWriteStream(temp);
	let changed = false, trimming = true;
	try {
		for await (const line of lines(file)) {
			if (kept && trimming && line.includes(`"id":"${kept}"`)) trimming = false;
			const next = trimming ? trimLine(line) : line; if (next !== line) changed = true;
			if (!out.write(next + "\n")) await new Promise<void>(resolve => out.once("drain", () => resolve()));
		}
		out.end(); await finished(out);
		const now = statSync(file);
		// Written meanwhile or opened again (someone resumed it): keep theirs.
		const lock = readLock(file);
		if (!changed || now.mtimeMs !== before.mtimeMs || now.size !== before.size || (lock && holderAlive(lock))) { rmSync(temp, { force: true }); return 0; }
		const saved = before.size - statSync(temp).size;
		utimesSync(temp, before.atime, before.mtime);
		renameSync(temp, file);
		return saved;
	} catch (error) { out.destroy(); rmSync(temp, { force: true }); throw error; }
}

/** Moves files to the Recycle Bin / Trash; never deletes outright. */
export async function trash(files: string[]) {
	if (!files.length) return;
	if (process.platform === "win32") {
		const list = path.join(os.tmpdir(), `pi-hub-trash-${process.pid}.txt`);
		writeFileSync(list, files.join("\n"), "utf8");
		try {
			await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
				"Add-Type -AssemblyName Microsoft.VisualBasic; foreach ($f in Get-Content -LiteralPath $env:PI_TRASH_LIST -Encoding UTF8) { if ($f) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($f, 'OnlyErrorDialogs', 'SendToRecycleBin') } }"],
				{ env: { ...process.env, PI_TRASH_LIST: list }, windowsHide: true, timeout: 600_000 });
		} finally { rmSync(list, { force: true }); }
		return;
	}
	// The freedesktop Trash (what file managers and `gio trash` use): the file under files/, where it came from under info/.
	const bin = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "Trash");
	mkdirSync(path.join(bin, "files"), { recursive: true }); mkdirSync(path.join(bin, "info"), { recursive: true });
	for (const file of files) {
		let name = path.basename(file);
		for (let n = 2; existsSync(path.join(bin, "files", name)) || existsSync(path.join(bin, "info", `${name}.trashinfo`)); n++) name = `${path.basename(file, ".jsonl")}.${n}.jsonl`;
		const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 19); // local time, as the spec asks
		writeFileSync(path.join(bin, "info", `${name}.trashinfo`), `[Trash Info]\nPath=${encodeURI(file)}\nDeletionDate=${date}\n`);
		renameSync(file, path.join(bin, "files", name));
	}
}

function sessionFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name);
		return entry.isDirectory() ? sessionFiles(full) : entry.isFile() && entry.name.endsWith(".jsonl") ? [full] : [];
	});
}

/** A session Pi just closed (the hub parked it): its compacted part, which no model turn reads again, is trimmed now. */
export async function trimCompacted(file: string) {
	const lock = readLock(file);
	return lock && holderAlive(lock) ? 0 : trimFile(file, true);
}

export async function pruneSessions(registry: Pick<Registry, "byFile">, sessionsDir: string, { now = Date.now(), moveToTrash = trash } = {}) {
	const doomed: string[] = [];
	let trimmed = 0, saved = 0;
	for (const file of sessionFiles(sessionsDir)) {
		let stats; try { stats = statSync(file); } catch { continue; }
		const age = (now - stats.mtimeMs) / DAY;
		const lock = readLock(file);
		if (lock && holderAlive(lock)) continue; // open in Pi right now
		// Younger files: only their compacted part, and not within the hour (a Pi without the lock may still be writing).
		if (age < TRIM_DAYS) {
			if (now - stats.mtimeMs < HOUR) continue;
			try { const bytes = await trimFile(file, true); if (bytes > 0) { trimmed++; saved += bytes; } }
			catch (error) { console.error(`session cleanup: ${file}: ${(error as Error).message}`); }
			continue;
		}
		const kept = !!registry.byFile(file), fork = file.split(path.sep).includes("forks");
		if (!kept && (fork || age >= DELETE_DAYS)) { doomed.push(file); continue; }
		try { const bytes = await trimFile(file); if (bytes > 0) { trimmed++; saved += bytes; } }
		catch (error) { console.error(`session cleanup: ${file}: ${(error as Error).message}`); }
	}
	const freed = doomed.reduce((sum, file) => { try { return sum + statSync(file).size; } catch { return sum; } }, 0);
	await moveToTrash(doomed);
	// Fork folders left empty go too; a folder with anything left in it stays (rmdir refuses).
	for (const dir of new Set(doomed.map(file => path.dirname(file))))
		for (let at = dir; at.startsWith(sessionsDir + path.sep); at = path.dirname(at)) { try { rmdirSync(at); } catch { break; } }
	return { trimmed, saved, deleted: doomed.length, freed };
}

/** Linux: the session files this cleanup put in the Trash (counted by where they came from), emptied on request; other trashed files stay. */
export function sessionTrash(sessionsDir: string, empty = false) {
	if (process.platform !== "linux") return { supported: false, files: 0, bytes: 0 };
	const bin = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "Trash");
	let files = 0, bytes = 0;
	for (const info of existsSync(path.join(bin, "info")) ? readdirSync(path.join(bin, "info")).filter(name => name.endsWith(".trashinfo")) : []) {
		let from = ""; try { from = decodeURI(/^Path=(.*)$/m.exec(readFileSync(path.join(bin, "info", info), "utf8"))?.[1] ?? ""); } catch { continue; }
		if (!from.startsWith(sessionsDir + path.sep)) continue;
		const file = path.join(bin, "files", info.slice(0, -".trashinfo".length));
		try { bytes += statSync(file).size; } catch { /* only the info is left */ }
		if (empty) { rmSync(file, { force: true }); rmSync(path.join(bin, "info", info), { force: true }); } else files++;
	}
	return { supported: true, files, bytes: empty ? 0 : bytes, ...empty && { freed: bytes } };
}
