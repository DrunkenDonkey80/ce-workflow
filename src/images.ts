// Pasted and chat-linked images for the page (moved from ce-workflow plan3-web.ts in plan 0db155f7 H9-01).
import { randomUUID } from "node:crypto";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { forbiddenPath } from "pi-work-orchestrator/extensions/jev-tools.ts";

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const IMAGE_BYTES = 20_000_000;
// Pasted images are checked by magic bytes, not the browser-declared type.
const IMAGE_KINDS: [string, (b: Buffer) => boolean][] = [
	["png", b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
	["jpg", b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
	["gif", b => b.subarray(0, 4).toString("latin1") === "GIF8"],
	["webp", b => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
];
/** Saves a pasted clipboard image like Pi's terminal paste does and returns its path for the chat. */
export async function savePastedImage(bytes: Buffer, dir = tmpdir()) {
	const kind = IMAGE_KINDS.find(([, test]) => test(bytes));
	if (!kind) throw fail(415, "Paste a PNG, JPEG, GIF or WebP image.");
	const file = join(dir, `pi-clipboard-${randomUUID()}.${kind[0]}`);
	await writeFile(file, bytes, { flag: "wx" });
	return file;
}
/** Serves a pasted image back for chat thumbnails: only Pi's own pi-clipboard-<uuid> temp names, re-checked by magic bytes. */
export async function readPastedImage(name: string | null, dir = tmpdir()) {
	if (!name || !/^pi-clipboard-[0-9a-f-]{36}\.(?:png|jpe?g|gif|webp)$/.test(name)) throw fail(400, "Not a pasted image name.");
	const bytes = await readFile(join(dir, name)).catch(() => { throw fail(404, "Image no longer available."); });
	const kind = bytes.length <= IMAGE_BYTES && IMAGE_KINDS.find(([, test]) => test(bytes));
	if (!kind) throw fail(415, "Not a supported image.");
	return { bytes, type: kind[0] === "jpg" ? "image/jpeg" : "image/" + kind[0] };
}
/** Serves an image linked in chat: a real image file inside the project (not hidden/secret paths) or the temp folder. */
export async function readLinkedImage(path: string | null, project?: string) {
	if (!path || path.length > 1000 || /[\x00-\x1f]/.test(path) || !/\.(?:png|jpe?g|gif|webp)$/i.test(path)) throw fail(400, "Not an image path.");
	if (!project && !isAbsolute(path)) throw fail(404, "Image not found.");
	const real = await realpath(resolve(project ?? "", path)).catch(() => { throw fail(404, "Image not found."); });
	const inside = async (root: string): Promise<string | undefined> => { const rel = relative(await realpath(root), real); return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.replaceAll("\\", "/") : undefined; };
	const fromProject = project ? await inside(project).catch(() => undefined) : undefined;
	// Any image on this PC (other projects' renders too) for the paired owner; hidden dot-folders (.ssh, .pi) stay closed.
	if (fromProject ? forbiddenPath.test(fromProject) : /[\\/]\.[^\\/]/.test(real)) throw fail(403, "Images in hidden or generated folders are not shown.");
	if ((await stat(real)).size > IMAGE_BYTES) throw fail(413, "Image too large.");
	const bytes = await readFile(real), kind = IMAGE_KINDS.find(([, test]) => test(bytes));
	if (!kind) throw fail(415, "Not a supported image.");
	return { bytes, type: kind[0] === "jpg" ? "image/jpeg" : "image/" + kind[0] };
}
