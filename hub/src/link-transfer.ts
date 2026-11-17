// Plan 4d2fa07b S4 (D-06, D-09): files between paired hubs travel as raw binary HTTP bodies, at most 200 MB each, and
// resume after a dropped connection from the bytes already on disk (a partial file under the hub data folder).
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm, stat, statfs, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const FILE_MAX = 200 * 1024 * 1024;
const PARTIAL_IDLE_MS = 24 * 60 * 60 * 1000;
export const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export const overCap = (name: string, size: number) => `${name} is ${megabytes(size)}, over the 200 MB limit`;
const refuse = (status: number, error: string) => Object.assign(new Error(error), { status });

/** One answer of `/link/fetch` (GET) or `/link/upload` (PUT): JSON, or for a fetch the file's bytes from the asked offset. */
export type TransferReply = { status: number; json?: Record<string, unknown>; stream?: Readable; length?: number; size?: number };
/** One hub-to-hub transfer request; tests swap in an in-process one. */
export type Transfer = (url: string, op: "fetch" | "upload", query: Record<string, string>, headers: Record<string, string>, body?: Readable) => Promise<TransferReply>;

// undici's 5-minute header and body timeouts are idle timeouts, so a slow 200 MB transfer still finishes.
export const fetchTransfer: Transfer = async (url, op, query, headers, body) => {
	const response = await fetch(`${url}/link/${op}?${new URLSearchParams(query)}`, { method: op === "fetch" ? "GET" : "PUT", headers, ...(body ? { body: Readable.toWeb(body) as ReadableStream, duplex: "half" } : {}) } as RequestInit);
	if (op === "fetch" && (response.status === 200 || response.status === 206) && response.body)
		return { status: response.status, stream: Readable.fromWeb(response.body as never), size: Number(response.headers.get("x-hub-size")) };
	return { status: response.status, json: await response.json().catch(() => ({})) };
};

/** The partials folder, with partials idle for 24 h removed. */
export async function partials(dataDir: string) {
	const dir = path.join(dataDir, "partials");
	await mkdir(dir, { recursive: true });
	for (const name of await readdir(dir)) {
		const file = path.join(dir, name), info = await stat(file).catch(() => undefined);
		if (info && Date.now() - info.mtimeMs > PARTIAL_IDLE_MS) await rm(file, { force: true });
	}
	return dir;
}

export const sizeOf = (file: string) => stat(file).then(info => info.size, () => 0);

/** D-09: refuses before any byte is written when the disk holding `dir` cannot take `needed` more bytes. */
export async function checkSpace(dir: string, needed: number) {
	const { bavail, bsize } = await statfs(dir);
	if (bavail * bsize < needed) throw refuse(507, `not enough free disk on this hub for ${megabytes(needed)}`);
}

/** Appends `source` to `file`, refusing more than `max` bytes; a cut source leaves what arrived, to resume from. */
export async function append(file: string, source: Readable, max: number) {
	let seen = 0;
	const count = new Transform({ transform(chunk: Buffer, _encoding, done) { seen += chunk.length; done(seen > max ? refuse(413, "more bytes than announced") : null, chunk); } });
	await pipeline(source, count, createWriteStream(file, { flags: "a" }));
	return sizeOf(file);
}

/** Moves a finished partial into place; across drives a copy. */
export async function moveFile(from: string, to: string) {
	try { await rename(from, to); } catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
		await copyFile(from, to);
		await unlink(from);
	}
}
