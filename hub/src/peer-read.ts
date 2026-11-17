// Plan 4d2fa07b S3: read-only access to a shared project for a paired hub: list, ripgrep and read, confined to the
// project's folder (or its Pi session folder) by real path, with secrets and .git/ refused (D-10) and output capped.
import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { appendFile, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { agentDir } from "./rpc-client.ts";

export const MAX_LINES = 2000, MAX_BYTES = 50 * 1024;
const LOG_MAX = 1024 * 1024;
// D-10: refused anywhere in a path; a secret under an unusual name stays readable.
const SECRETS = [".env*", "*.pem", "*.key", "id_*", ".ssh", ".npmrc", "credentials*", "*.p12", "*.pfx", ".git"];
const secretRe = new RegExp(`^(${SECRETS.map(glob => glob.replace(/[.]/g, "\\.").replace(/\*/g, ".*")).join("|")})$`, "i");
export const isSecret = (rel: string) => rel.split(/[\\/]/).some(part => secretRe.test(part));

const refuse = (status: number, error: string) => Object.assign(new Error(error), { status });

/** The real path of `rel` under `root`, refused when it escapes (`..`, a symlink) or names a secret on either side. */
export async function confine(root: string, rel: string) {
	const realRoot = await realpath(root);
	if (path.isAbsolute(rel) || isSecret(rel)) throw refuse(403, `${rel} is not readable`);
	const real = await realpath(path.resolve(realRoot, rel)).catch(() => { throw refuse(404, `${rel} does not exist`); });
	const inside = path.relative(realRoot, real);
	if (inside.split(/[\\/]/)[0] === ".." || path.isAbsolute(inside) || isSecret(inside)) throw refuse(403, `${rel} is not readable`);
	return { realRoot, real, inside };
}

/** Collects lines up to the caps; `full` tells the reader to stop. */
function capped() {
	const lines: string[] = [];
	let bytes = 0, cut = false;
	return {
		lines,
		get cut() { return cut; },
		add(line: string) {
			const size = Buffer.byteLength(line) + 1;
			if (lines.length >= MAX_LINES || bytes + size > MAX_BYTES) { cut = true; return false; }
			lines.push(line); bytes += size; return true;
		},
	};
}

export async function list(root: string, rel = ".") {
	const { real, inside } = await confine(root, rel);
	if (!(await stat(real)).isDirectory()) throw refuse(400, `${rel} is not a folder`);
	const out = capped();
	for (const entry of (await readdir(real, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
		if (isSecret(entry.name)) continue;
		if (!out.add(`${entry.name}${entry.isDirectory() ? "/" : entry.isSymbolicLink() ? "@" : ""}`)) break;
	}
	return { path: inside || ".", text: out.lines.join("\n") + (out.cut ? `\n[cut at ${MAX_LINES} lines or ${MAX_BYTES / 1024} KB]` : "") };
}

/** Lines `offset` (1-based) onward, at most `limit`, within the caps; never loads the whole file. */
export async function read(root: string, rel: string, offset = 1, limit = MAX_LINES) {
	const { real, inside } = await confine(root, rel);
	if (!(await stat(real)).isFile()) throw refuse(400, `${rel} is not a file`);
	const out = capped(), lines = createInterface({ input: createReadStream(real, "utf8"), crlfDelay: Infinity });
	let n = 0, more = false;
	for await (const line of lines) {
		if (++n < offset) continue;
		if (out.lines.length >= limit || !out.add(line)) { more = true; break; }
	}
	lines.close();
	const next = offset + out.lines.length;
	return { path: inside, text: out.lines.join("\n") + (more ? `\n[more: offset ${next}${out.cut ? `; cut at ${MAX_LINES} lines or ${MAX_BYTES / 1024} KB` : ""}]` : "") };
}

/** ripgrep on PATH, then Pi's own bin folder. */
export function ripgrep(env = process.env) {
	const names = process.platform === "win32" ? ["rg.exe"] : ["rg"];
	const dirs = [...(env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean), path.join(agentDir(), "bin")];
	for (const dir of dirs) for (const name of names) if (existsSync(path.join(dir, name))) return path.join(dir, name);
}

export async function grep(root: string, rel: string, pattern: string, ignoreCase = false, rg = ripgrep()) {
	if (!pattern) throw refuse(400, "pattern required");
	if (!rg) throw refuse(501, "ripgrep unavailable");
	const { realRoot, inside } = await confine(root, rel);
	// --no-ignore --hidden: gitignored files are searched too; the D-10 globs keep secrets out; no -L, so links are not followed.
	const args = ["--hidden", "--no-ignore", "-n", "--no-heading", "--color", "never", ...SECRETS.flatMap(glob => ["-g", `!${glob}`]), ...(ignoreCase ? ["-i"] : []), "--path-separator", "/", "-e", pattern, ...(inside ? ["--", inside] : [])];
	const child = spawn(rg, args, { cwd: realRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
	const out = capped(), lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
	let errors = "";
	child.stderr.on("data", chunk => { if (errors.length < 2000) errors += chunk; });
	const exited = new Promise<number | null>(done => child.on("close", done));
	for await (const line of lines) if (!out.add(line)) { child.kill(); break; }
	const code = await exited;
	if (code === 2 && !out.lines.length && !out.cut) throw refuse(400, errors.trim().split("\n")[0] || "ripgrep failed");
	return { path: inside || ".", text: (out.lines.join("\n") || "No matches.") + (out.cut ? `\n[cut at ${MAX_LINES} lines or ${MAX_BYTES / 1024} KB]` : "") };
}

/** One line per remote read; past 1 MB the older half goes. */
export async function logRead(file: string, line: string) {
	await appendFile(file, `${new Date().toISOString()} ${line.replace(/[\r\n]+/g, " ")}\n`);
	if ((await stat(file)).size <= LOG_MAX) return;
	const text = await readFile(file, "utf8"), half = text.indexOf("\n", text.length / 2);
	await writeFile(file, text.slice(half + 1));
}

/** One `/link/read` op on `root`; `hub` names this hub when ripgrep is missing. */
export async function runRead(root: string, rel: string, body: Record<string, unknown>, hub: string) {
	const num = (value: unknown, fallback: number) => Number.isInteger(value) && (value as number) > 0 ? value as number : fallback;
	if (body.op === "ls") return list(root, rel);
	if (body.op === "read") return read(root, rel, num(body.offset, 1), num(body.limit, MAX_LINES));
	if (body.op !== "grep") throw refuse(400, "op must be ls, grep or read.");
	return grep(root, rel, String(body.pattern ?? ""), body.ignoreCase === true).catch(error => {
		throw (error as Error).message === "ripgrep unavailable" ? refuse(501, `ripgrep unavailable on ${hub}`) : error;
	});
}
