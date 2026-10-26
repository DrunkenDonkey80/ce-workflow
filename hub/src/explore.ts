// Explore: a chat-linked archive (zip, 7z, tar…) unpacked into a temp folder the page can walk, served under /x/<key>/.
// The key is a random capability, so an HTML page inside can load its own relative images, styles and scripts on this PC
// (no ?token=) and remotely (no cookie in a sandboxed frame). Such pages run sandboxed: an opaque origin that cannot call the hub.
import type http from "node:http";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, resolve, isAbsolute } from "node:path";
import { sevenZip } from "./wormhole.ts";

const ARCHIVE = /\.(?:zip|7z|rar|tar|tgz|tbz2?|txz|tar\.(?:gz|bz2|xz|zst))$/i;
const TAR_FAMILY = /\.(?:tar|tgz|tbz2?|txz|tar\.(?:gz|bz2|xz|zst))$/i, MAX_ARCHIVE = 2e9, MAX_FILES = 5000;
const root = join(tmpdir(), "pi-hub-explore");
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
// archive real path + mtime + size → key, for this hub run; the first explore clears earlier runs' folders.
const unpacked = new Map<string, string>(), folders = new Map<string, string>();
let cleared: Promise<unknown> | undefined;

const run = (command: string, args: string[]) => new Promise<void>((done, failed) => execFile(command, args, { timeout: 300_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
	(error, _stdout, stderr) => error ? failed(new Error(String(stderr || error.message).trim().split("\n").pop())) : done()));
// 7-Zip and tar both refuse ../ and absolute member names; reads below still stay inside the folder (symlinks resolved).
// shortcut: no cap on the unpacked size (a zip bomb could fill the temp drive); add a listed-size check if that bites.
async function unpack(real: string, into: string) {
	const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar"; // Windows' bsdtar, not Git's GNU tar
	const seven = sevenZip();
	// shortcut: without 7-Zip, Linux GNU tar unpacks only tar archives (Windows and macOS bsdtar also read zip and 7z).
	if (seven && !TAR_FAMILY.test(real)) await run(seven, ["x", "-y", "-bd", `-o${into}`, "--", real]);
	else await run(tar, ["-xf", real, "-C", into]);
}

/** Unpacks a validated real archive path once per hub run; returns its key and file list. */
export async function explore(real: string) {
	if (!ARCHIVE.test(real)) throw fail(400, "Only zip, 7z, rar and tar archives can be explored.");
	const info = await stat(real);
	if (info.size > MAX_ARCHIVE) throw fail(413, "Archives up to 2 GB can be explored.");
	const id = `${real}|${info.mtimeMs}|${info.size}`;
	let key = unpacked.get(id);
	if (!key) {
		await (cleared ??= rm(root, { recursive: true, force: true }).catch(() => undefined));
		key = randomBytes(16).toString("hex");
		const into = join(root, key);
		await mkdir(into, { recursive: true });
		try { await unpack(real, into); } catch (error) { await rm(into, { recursive: true, force: true }); throw fail(422, `Could not unpack ${basename(real)}: ${(error as Error).message}`); }
		unpacked.set(id, key); folders.set(key, into);
	}
	const files: { path: string; size: number }[] = [];
	await walk(folders.get(key)!, "", files);
	return { key, name: basename(real), files: files.slice(0, MAX_FILES).sort((a, b) => a.path.localeCompare(b.path)), truncated: files.length > MAX_FILES };
}
async function walk(base: string, prefix: string, files: { path: string; size: number }[]) {
	if (files.length > MAX_FILES) return;
	for (const entry of await readdir(join(base, prefix), { withFileTypes: true }).catch(() => [])) {
		const path = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) await walk(base, path, files);
		else if (entry.isFile()) files.push({ path, size: (await stat(join(base, path))).size });
	}
}

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
	".pdf": "application/pdf", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf" };
/** GET /x/<key>/<path>[?download=1]: one unpacked file. Returns false when the URL is not an explore URL. */
export async function sendExplored(pathname: string, download: boolean, origin: string, response: http.ServerResponse) {
	const match = /^\/x\/([0-9a-f]{32})\/(.+)$/.exec(pathname);
	if (!match) return false;
	const base = folders.get(match[1]);
	let rel: string; try { rel = decodeURIComponent(match[2]); } catch { rel = ""; }
	const real = base && rel && await realpath(resolve(base, rel)).catch(() => undefined), rest = real && relative(await realpath(base!), real);
	const info = rest && !rest.startsWith("..") && !isAbsolute(rest) ? await stat(real!).catch(() => undefined) : undefined;
	if (!info?.isFile()) { response.writeHead(404, { "content-type": "text/plain" }); response.end("Not found (the hub restarted? Explore the archive again)."); return true; }
	const type = TYPES[extname(real!).toLowerCase()] ?? "text/plain; charset=utf-8"; // unknown: plain text, never sniffed into a page
	response.writeHead(200, {
		"content-type": download ? "application/octet-stream" : type, "content-length": info.size, "cache-control": "private, no-store", "x-content-type-options": "nosniff",
		// Opaque origin (no allow-same-origin): page scripts run but cannot read the hub, and fetch only from this host.
		"content-security-policy": `sandbox allow-scripts allow-popups; default-src ${origin} data: blob: 'unsafe-inline' 'unsafe-eval'`,
		"content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(basename(real!))}`,
	});
	createReadStream(real!).on("error", () => response.destroy()).pipe(response);
	return true;
}
