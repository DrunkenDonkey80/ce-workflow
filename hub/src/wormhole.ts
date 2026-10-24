// Chat file links → an end-to-end encrypted wormhole.app link (24 h, unlimited downloads). Encryption is Wormhole's own
// MIT wormhole-crypto; the site API below is undocumented (worked out from a third-party client) and may change.
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Keychain, encryptedSize } from "wormhole-crypto";
import { findCommand } from "./platform.ts";

const API = "https://wormhole.app/api", MAX_BYTES = 5e9, LIFETIME = 86_400;
export type Pack = "" | "zip" | "7z";
type Job = { name: string; status: string; sent: number; total: number; url?: string; error?: string; done: boolean };
const jobs = new Map<string, Job>();

let sevenZipPath: string | null | undefined;
export const sevenZip = () => sevenZipPath === undefined ? sevenZipPath = findCommand("7z") ?? findCommand("7zz") ?? findCommand("7za") ?? null : sevenZipPath;
export const uploadJob = (id: string) => jobs.get(id);

/** Starts packing (optional), encrypting and uploading a validated real file path; poll uploadJob(id). */
export function startUpload(real: string, pack: Pack) {
	const id = randomUUID(), job: Job = { name: basename(real), status: pack ? `Packing ${basename(real)}…` : "Encrypting…", sent: 0, total: 0, done: false };
	jobs.set(id, job);
	void upload(real, pack, job).then(url => Object.assign(job, { url, status: "Link ready", done: true }), error => Object.assign(job, { error: `Wormhole upload failed: ${(error as Error).message}`, status: "Failed", done: true }))
		.finally(() => setTimeout(() => jobs.delete(id), 3_600_000).unref());
	return id;
}

async function upload(real: string, pack: Pack, job: Job) {
	const work = await mkdtemp(join(tmpdir(), "pi-hub-upload-"));
	try {
		const file = pack ? await archive(real, pack, work) : real, name = basename(file), size = (await stat(file)).size;
		if (size > MAX_BYTES) throw new Error("Wormhole stores files up to 5 GB.");
		const key = randomBytes(16), keychain = new Keychain(key, null), total = encryptedSize(size), length = pieceLength(total);
		const room = await api("/room", "POST", undefined, { readerToken: b64(await keychain.authToken()), salt: b64(keychain.salt), lifetime: LIFETIME });
		if (typeof room?.id !== "string" || !/^[\w-]+$/.test(room.id) || typeof room.writerToken !== "string") throw new Error("Wormhole returned an unexpected room.");
		await api(`/room/${room.id}/uploader-online`, "PATCH", room.writerToken);
		Object.assign(job, { status: "Encrypting…", total });
		const encrypted = join(work, "encrypted"), hashes = await encryptFile(file, key, length, encrypted);
		if ((await stat(encrypted)).size !== total) throw new Error("Encrypted size mismatch.");
		const info = { length: total, name, nonce: randomBytes(16).toString("hex"), "piece length": length, pieces: Buffer.concat(hashes), private: 1 };
		const announce = "wss://wormhole.app/websocket", torrent = bencode({ announce, "announce-list": [[announce]], "created by": "WebTorrent/0108", "creation date": Math.floor(Date.now() / 1000), info, private: 1, "url-list": [] });
		await api(`/room/${room.id}`, "PATCH", room.writerToken, { infoHash: createHash("sha1").update(bencode(info)).digest("hex"), encryptedTorrentFile: b64(await keychain.encryptMeta(torrent)), multiFile: false, sizeMb: roundSizeMb(total) }, { Origin: "https://wormhole.app", Referer: "https://wormhole.app/" });
		const tokens: { uploadUrl: string; authorizationToken: string }[] = [];
		for (let i = 0; i < hashes.length; i += 10) tokens.push(...await api(`/room/${room.id}/b2/auth-upload`, "POST", room.writerToken, { numTokens: Math.min(10, hashes.length - i) }));
		// The upload URLs come from the server: only Backblaze B2 over https gets the encrypted pieces.
		if (tokens.length !== hashes.length || tokens.some(token => !/^https:\/\/[\w.-]+\.backblaze(?:b2)?\.com\//.test(String(token?.uploadUrl)))) throw new Error("Wormhole returned unexpected upload tokens.");
		job.status = "Uploading…";
		const handle = await open(encrypted);
		try {
			let next = 0, failure: { error: unknown } | undefined;
			// The first failure stops new pieces; the others in flight settle before the file closes and the job fails.
			const worker = async () => {
				try {
					for (let i = next++; i < hashes.length && !failure; i = next++) {
						const bytes = new Uint8Array(Math.min(length, total - i * length));
						await handle.read(bytes, 0, bytes.length, i * length);
						await retry(() => piece(tokens[i], `${room.id}/${i}`, hashes[i].toString("hex"), bytes));
						job.sent += bytes.length; job.status = `Uploading ${Math.floor(job.sent / total * 100)}%`;
					}
				} catch (error) { failure ??= { error }; }
			};
			await Promise.all([worker(), worker(), worker(), worker()]); // 4 pieces in flight
			if (failure) throw failure.error;
		} finally { await handle.close(); }
		await api(`/room/${room.id}/b2/finish-upload`, "POST", room.writerToken, { success: true });
		return `https://wormhole.app/${room.id}#${key.toString("base64url")}`;
	} finally { await rm(work, { recursive: true, force: true }); }
}

/** Zip uses Windows' bsdtar (Git's GNU tar on PATH cannot write zip) or Info-ZIP elsewhere; 7z uses 7z, 7zz or 7za.
 * -spd and -nw keep a name like `*.txt` literal, so neighbours Download would refuse never get packed. */
export async function archive(real: string, pack: Exclude<Pack, "">, work: string) {
	const entry = basename(real).startsWith("-") ? "./" + basename(real) : basename(real), out = join(work, basename(real, extname(real)) + "." + pack);
	const [command, args] = pack === "7z" ? [sevenZip(), ["a", "-bd", "-y", "-spd", out, "--", entry]]
		: process.platform === "win32" ? [join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", out, entry]] : ["zip", ["-q", "-nw", out, entry]];
	if (!command) throw new Error("7z is not installed.");
	await new Promise<void>((done, failed) => execFile(command, args, { cwd: dirname(real), windowsHide: true, maxBuffer: 1 << 20 }, (error, _out, err) => error ? failed(new Error(`${pack} failed: ${(err || error.message).trim().slice(0, 300)}`)) : done()));
	return out;
}

/** Encrypts to disk and returns the SHA-1 of each torrent piece, so a 5 GB file never sits in memory. */
export async function encryptFile(file: string, key: Uint8Array, length: number, out: string) {
	const hashes: Buffer[] = []; let hash = createHash("sha1"), filled = 0;
	const stream = await new Keychain(key, null).encryptStream(Readable.toWeb(createReadStream(file)));
	await pipeline(Readable.fromWeb(stream), async function* (source: AsyncIterable<Uint8Array>) {
		for await (const chunk of source) {
			for (let at = 0; at < chunk.length;) {
				const take = Math.min(length - filled, chunk.length - at);
				hash.update(chunk.subarray(at, at += take));
				if ((filled += take) === length) { hashes.push(hash.digest()); hash = createHash("sha1"); filled = 0; }
			}
			yield chunk;
		}
	}, createWriteStream(out));
	if (filled) hashes.push(hash.digest());
	return hashes;
}

/** WebTorrent's piece size as Wormhole's web app picks it, at least 5 MB (or the whole file). */
export function pieceLength(size: number) {
	const base = size < 1024 ? 16384 : Math.max(16384, 1 << Math.floor(Math.log2(size / 1024) + 0.5));
	return Math.max(base, Math.ceil(Math.min(size, 5e6) / 16384) * 16384);
}
/** Whole MB, rounded to two significant digits above 100 MB (the web app's size hint). */
export function roundSizeMb(bytes: number) {
	let scale = 1, mb = Math.round(bytes / 1e6);
	while (mb > 100) { scale *= 10; mb = Math.round(bytes / 1e6 / scale); }
	return mb * scale;
}
export function bencode(value: unknown): Buffer {
	if (typeof value === "number") return Buffer.from(`i${value}e`);
	if (typeof value === "string" || value instanceof Uint8Array) { const bytes = Buffer.from(value); return Buffer.concat([Buffer.from(`${bytes.length}:`), bytes]); }
	if (Array.isArray(value)) return Buffer.concat([Buffer.from("l"), ...value.map(bencode), Buffer.from("e")]);
	const object = value as Record<string, unknown>;
	return Buffer.concat([Buffer.from("d"), ...Object.keys(object).sort().flatMap(key => [bencode(key), bencode(object[key])]), Buffer.from("e")]);
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
async function api(path: string, method: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
	const response = await fetch(API + path, { method, signal: AbortSignal.timeout(60_000), headers: { ...body ? { "content-type": "application/json" } : {}, ...token ? { authorization: `Bearer sync-v1 ${token}` } : {}, ...headers }, body: body ? JSON.stringify(body) : undefined });
	if (!response.ok) throw Object.assign(new Error(`${method} ${path.replace(/\/room\/[^/]+/, "/room")} returned HTTP ${response.status} ${(await response.text().catch(() => "")).slice(0, 200)}`.trim()), { status: response.status });
	const text = await response.text();
	try { return text ? JSON.parse(text) : undefined; } catch { throw new Error(`${method} ${path} returned a reply that is not JSON.`); }
}
async function piece(token: { uploadUrl: string; authorizationToken: string }, name: string, sha1: string, bytes: Uint8Array) {
	const response = await fetch(token.uploadUrl, { method: "POST", signal: AbortSignal.timeout(300_000), body: bytes, headers: { authorization: token.authorizationToken, "x-bz-file-name": name, "x-bz-content-sha1": sha1, "content-type": "application/octet-stream" } });
	if (!response.ok) throw Object.assign(new Error(`piece upload returned HTTP ${response.status}`), { status: response.status });
	await response.arrayBuffer();
}
async function retry(run: () => Promise<void>) {
	for (let attempt = 1; ; attempt++) {
		try { return await run(); } catch (error) {
			const status = (error as { status?: number }).status;
			if (attempt >= 3 || status && status < 500) throw error;
			await new Promise(done => setTimeout(done, 500 * 2 ** (attempt - 1)));
		}
	}
}
