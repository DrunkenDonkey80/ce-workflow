// Files named in chat (any path with an extension): the page asks which exist, then opens, reveals, downloads or copies them.
// Never hidden dot-folders (.ssh, .pi, .git) or secret-shaped names. On this PC any other file works; a remote device
// (a phone over the tailnet) gets images from anywhere, other files only from the session's project, plus temp and
// Downloads files changed in the last 5 days.
import type http from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, isAbsolute } from "node:path";
import { forbiddenPath } from "../../extensions/jev-tools.ts";
import { fromWindowsPath, isWsl, toWindowsPath } from "./platform.ts";

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

/** The real absolute path of an existing, shareable file, or undefined. Relative paths are the session folder's. */
/** folders: on this PC an absolute folder path also links; it only opens in the file manager (no download, upload or explore). */
export async function linkedFile(path: unknown, project: string, remote = false, folders = false): Promise<string | undefined> {
	if (typeof path !== "string" || !path || path.length > 1000 || /[\x00-\x1f]/.test(path)) return undefined;
	const local = fromWindowsPath(path).replace(/^~(?=[\\/])/, homedir()); // ~/x is the home folder, as in a shell
	const real = await realpath(resolve(project, local)).catch(() => undefined);
	if (!real || /[\\/]\.[^\\/]/.test(real) || forbiddenPath.test(basename(real))) return undefined;
	const info = await stat(real).catch(() => undefined);
	if (folders && !remote && info?.isDirectory() && isAbsolute(local)) return real;
	if (!info?.isFile()) return undefined;
	if (!remote || IMAGE.test(real) || await inside(real, project)) return real;
	const recent = Date.now() - info.mtimeMs < RECENT_MS;
	return recent && (await inside(real, tmpdir()) || await inside(real, join(homedir(), "Downloads"))) ? real : undefined;
}
const RECENT_MS = 5 * 24 * 3600_000, IMAGE = /\.(?:png|jpe?g|gif|webp|svg|bmp)$/i; // images (other projects' renders) open from anywhere
/** True when the real file sits under the folder's real path (symlinks resolved on both sides). */
async function inside(real: string, folder: string) {
	const root = await realpath(folder).catch(() => undefined), rest = root && relative(root, real);
	return !!rest && !rest.startsWith("..") && !isAbsolute(rest);
}
export async function linkedFiles(paths: unknown, project: string, remote = false) {
	if (!Array.isArray(paths) || paths.length > 200) throw fail(400, "Invalid paths.");
	const found: Record<string, string> = {};
	const reals = await Promise.all(paths.map(path => linkedFile(path, project, remote, true)));
	reals.forEach((real, i) => { if (real) found[paths[i] as string] = real; });
	// Folders get their own menu on the page (open, copy, zip and upload).
	const folders = (await Promise.all(Object.entries(found).map(async ([path, real]) => (await stat(real)).isDirectory() && path))).filter(Boolean);
	return { found, folders };
}

// Text opens as plain text: a same-origin HTML or SVG page could run script with the page's rights, and the sandbox CSP backs that up.
const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf", ".mp4": "video/mp4", ".mp3": "audio/mpeg" };
const TEXT = /^\.(?:md|txt|log|json|jsonl|ya?ml|toml|ini|cfg|conf|csv|tsv|xml|html?|css|svg|[cm]?[jt]sx?|py|rb|go|rs|java|kt|kts|cs|c|cc|cpp|h|hpp|sh|ps1|bat|cmd|sql|gradle|properties|diff|patch)$/i;
export async function sendLinkedFile(path: string | null, project: string, download: boolean, response: http.ServerResponse, remote = false) {
	const real = await linkedFile(path, project, remote);
	if (!real) throw fail(404, "File not found or not shared.");
	const ext = extname(real).toLowerCase(), type = TYPES[ext] ?? (TEXT.test(ext) ? "text/plain; charset=utf-8" : "application/octet-stream");
	response.writeHead(200, {
		"content-type": type, "content-length": (await stat(real)).size, "cache-control": "private, no-store", "x-content-type-options": "nosniff",
		"content-security-policy": "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
		"content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(basename(real))}`,
	});
	createReadStream(real).on("error", () => response.destroy()).pipe(response);
}

// Programs and scripts are revealed in their folder, never started: a link in model text must not run anything.
const RUNS = /^\.(?:exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|mjs|cjs|wsf|wsh|msi|msp|msc|lnk|scr|hta|cpl|reg|jar|url|sh|bash|appimage|desktop|run|app|command|pif|scf|inf|application|gadget)$/i;
/** Opens the file with its default app, or with reveal shows it selected in its folder (Explorer, Finder, the Linux file manager). */
export async function openLinkedFile(path: unknown, project: string, reveal: boolean, remote = false) {
	const real = await linkedFile(path, project, remote, true);
	if (!real) throw fail(404, "File not found or not shared.");
	const show = reveal || RUNS.test(extname(real));
	// Windows paths cannot contain quotes, so verbatim quoting is safe; explorer.exe never goes through cmd's & parsing.
	const [command, args, verbatim] = process.platform === "win32" ? ["explorer.exe", [show ? `/select,"${real}"` : `"${real}"`], true]
		: isWsl() ? ["explorer.exe", [show ? `/select,${toWindowsPath(real)}` : toWindowsPath(real)], false] // WSL has no xdg-open by default
		: process.platform === "darwin" ? ["open", show ? ["-R", real] : [real], false]
		: ["xdg-open", [show ? dirname(real) : real], false]; // shortcut: Linux opens the folder without selecting the file
	spawn(command, args as string[], { detached: true, stdio: "ignore", windowsHide: false, windowsVerbatimArguments: verbatim as boolean }).on("error", () => {}).unref();
	return { ok: true, revealed: show, path: real };
}
