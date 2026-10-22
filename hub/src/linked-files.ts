// Files named in chat (any path with an extension): the page asks which exist, then opens, reveals, downloads or copies them.
// The paired owner may reach any file on this PC except hidden dot-folders (.ssh, .pi, .git) and secret-shaped names.
import type http from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { forbiddenPath } from "../../extensions/jev-tools.ts";

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

/** The real absolute path of an existing, shareable file, or undefined. Relative paths are the session folder's. */
export async function linkedFile(path: unknown, project: string): Promise<string | undefined> {
	if (typeof path !== "string" || !path || path.length > 1000 || /[\x00-\x1f]/.test(path)) return undefined;
	const real = await realpath(resolve(project, path)).catch(() => undefined);
	if (!real || /[\\/]\.[^\\/]/.test(real) || forbiddenPath.test(basename(real))) return undefined;
	return (await stat(real).catch(() => undefined))?.isFile() ? real : undefined;
}
export async function linkedFiles(paths: unknown, project: string) {
	if (!Array.isArray(paths) || paths.length > 200) throw fail(400, "Invalid paths.");
	const found: Record<string, string> = {};
	const reals = await Promise.all(paths.map(path => linkedFile(path, project)));
	reals.forEach((real, i) => { if (real) found[paths[i] as string] = real; });
	return { found };
}

// Text opens as plain text: a same-origin HTML or SVG page could run script with the page's rights, and the sandbox CSP backs that up.
const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf", ".mp4": "video/mp4", ".mp3": "audio/mpeg" };
const TEXT = /^\.(?:md|txt|log|json|jsonl|ya?ml|toml|ini|cfg|conf|csv|tsv|xml|html?|css|svg|[cm]?[jt]sx?|py|rb|go|rs|java|kt|kts|cs|c|cc|cpp|h|hpp|sh|ps1|bat|cmd|sql|gradle|properties|diff|patch)$/i;
export async function sendLinkedFile(path: string | null, project: string, download: boolean, response: http.ServerResponse) {
	const real = await linkedFile(path, project);
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
export async function openLinkedFile(path: unknown, project: string, reveal: boolean) {
	const real = await linkedFile(path, project);
	if (!real) throw fail(404, "File not found or not shared.");
	const show = reveal || RUNS.test(extname(real));
	// Windows paths cannot contain quotes, so verbatim quoting is safe; explorer.exe never goes through cmd's & parsing.
	const [command, args, verbatim] = process.platform === "win32" ? ["explorer.exe", [show ? `/select,"${real}"` : `"${real}"`], true]
		: process.platform === "darwin" ? ["open", show ? ["-R", real] : [real], false]
		: ["xdg-open", [show ? dirname(real) : real], false]; // shortcut: Linux opens the folder without selecting the file; WSL needs wslview
	spawn(command, args as string[], { detached: true, stdio: "ignore", windowsHide: false, windowsVerbatimArguments: verbatim as boolean }).on("error", () => {}).unref();
	return { ok: true, revealed: show, path: real };
}
