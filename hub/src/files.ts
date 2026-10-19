// Project file tree, file and diff reads for the page (moved from ce-workflow plan3-files.ts in plan 0db155f7 H9-01).
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { captureSource, forbiddenPath, safePath, secret } from "../../extensions/jev-tools.ts";

// D11/D21: read-only project files for the browser Files tab. Hidden paths, secrets and binaries never leave.
const MAX_FILES = 5000, DIFF_BYTES = 262_144;
type Git = { code: number; stdout: string };
const git = (cwd: string, args: string[]) => new Promise<Git>(resolve => execFile("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 10_000, windowsHide: true },
	(error, stdout) => resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: stdout ?? "" })));
export class FileRefused extends Error {}

export type ProjectFile = { path: string; change?: string };
/** Porcelain paths are repository-root relative; return them relative to cwd, limited to it. */
async function status(cwd: string) {
	const prefix = (await git(cwd, ["rev-parse", "--show-prefix"])).stdout.trim();
	const fields = (await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."])).stdout.split("\0"), entries: { code: string; path: string; from?: string }[] = [];
	const local = (path?: string) => path?.startsWith(prefix) ? path.slice(prefix.length) : undefined;
	// -z porcelain: "XY path"; renames and copies add the old path as the next field.
	for (let i = 0; i < fields.length; i++) {
		if (fields[i].length < 4) continue;
		const code = fields[i].slice(0, 2), path = local(fields[i].slice(3)), from = /[RC]/.test(code[0]) ? fields[++i] : undefined;
		if (path) entries.push({ code, path, ...(local(from) ? { from: local(from) } : {}) });
	}
	return entries;
}
/** Tree from git (honours .gitignore) with porcelain change marks; a bounded walk outside git. */
export async function listFiles(cwd: string): Promise<{ files: ProjectFile[]; truncated: boolean; git: boolean }> {
	const listed = await git(cwd, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
	const paths = new Set<string>(), changes = new Map<string, string>();
	if (listed.code === 0) {
		for (const path of listed.stdout.split("\0")) if (path) paths.add(path);
		for (const { code, path } of await status(cwd)) { changes.set(path, code.trim() || code); paths.add(path); }
	} else await walk(cwd, "", paths, 0);
	const visible = [...paths].filter(path => !forbiddenPath.test(path)).sort();
	return { files: visible.slice(0, MAX_FILES).map(path => changes.has(path) ? { path, change: changes.get(path) } : { path }), truncated: visible.length > MAX_FILES || paths.size > MAX_FILES * 4, git: listed.code === 0 };
}
async function walk(root: string, prefix: string, paths: Set<string>, depth: number) {
	if (depth > 8 || paths.size > MAX_FILES * 4) return;
	let entries;
	try { entries = await readdir(join(root, prefix), { withFileTypes: true }); } catch { return; }
	for (const entry of entries) {
		const path = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (forbiddenPath.test(path) || forbiddenPath.test(path + "/")) continue;
		if (entry.isDirectory()) await walk(root, path, paths, depth + 1);
		else if (entry.isFile()) paths.add(path);
	}
}
function checked(path: unknown) {
	try { return safePath(path); } catch (error) { throw new FileRefused((error as Error).message); }
}
export async function readProjectFile(cwd: string, path: unknown) {
	const valid = checked(path);
	try { return { path: valid, content: (await captureSource(cwd, { path: valid })).content }; }
	catch (error) { throw new FileRefused((error as Error).message); }
}
/** `git diff HEAD` covers staged and unstaged edits, deletions included; untracked files and unborn repositories show content. */
export async function readProjectDiff(cwd: string, path: unknown) {
	const valid = checked(path);
	// A pathspec hides a rename's source, so add it from status when it is itself a visible path.
	const from = (await status(cwd)).find(entry => entry.path === valid)?.from;
	const source = from && !forbiddenPath.test(from) ? [from] : [];
	const result = await git(cwd, ["diff", "HEAD", "--no-color", "--no-ext-diff", "-M", "--", valid, ...source]);
	if (result.code !== 0 || !result.stdout) return { path: valid, diff: "", ...await readProjectFile(cwd, valid) };
	// The diff passes the same bounds as content, so a removed secret line is never shown.
	if (Buffer.byteLength(result.stdout) > DIFF_BYTES) throw new FileRefused("Diff too large to show; view it in the terminal.");
	if (result.stdout.includes("\0")) throw new FileRefused("Binary diff excluded.");
	if (secret.test(result.stdout)) throw new FileRefused("Potential secret-bearing diff excluded.");
	return { path: valid, diff: result.stdout };
}
