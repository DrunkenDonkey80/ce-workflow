// Wormhole upload, offline: bencode, piece sizes and the encrypted spool with its piece hashes (decrypts back to the input).
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Keychain, encryptedSize } from "wormhole-crypto";
import { execFileSync } from "node:child_process";
import { findCommand } from "../src/platform.ts";
import { archive, bencode, encryptFile, pieceLength, roundSizeMb, sevenZip, startUpload, uploadJob } from "../src/wormhole.ts";

// A fake wormhole.app and Backblaze: `piece(index)` answers each piece upload; returns the requests seen.
function fakeWormhole(piece) {
	const seen = [], real = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		const path = String(url).replace(/^https:\/\/[^/]+/, "");
		seen.push(`${init.method} ${path}${init.headers["x-bz-file-name"] ? " " + init.headers["x-bz-file-name"] : ""}`);
		if (init.headers["x-bz-file-name"]) return piece(Number(init.headers["x-bz-file-name"].split("/")[1]));
		if (path === "/api/room") return Response.json({ id: "room1", writerToken: "w" });
		if (path.endsWith("/auth-upload")) return Response.json(Array.from({ length: JSON.parse(init.body).numTokens }, () => ({ uploadUrl: "https://pod.backblaze.com/b2", authorizationToken: "a" })));
		return new Response("");
	};
	return { seen, restore: () => { globalThis.fetch = real; } };
}
async function finished(id) {
	for (let i = 0; i < 1000 && !uploadJob(id).done; i++) await new Promise(done => setTimeout(done, 20));
	return uploadJob(id);
}
const uploadDirs = () => fs.readdirSync(os.tmpdir()).filter(name => name.startsWith("pi-hub-upload-"));

test("upload sends every piece, then finishes with a key-holding link and no temp folder left", async () => {
	const dir = fs.mkdtempSync(join(os.tmpdir(), "test-wormhole-")), before = uploadDirs(), fake = fakeWormhole(() => new Response(""));
	try {
		fs.writeFileSync(join(dir, "big.bin"), randomBytes(12e6)); // 3 pieces of about 5 MB
		const job = await finished(startUpload(join(dir, "big.bin"), ""));
		assert.match(job.url ?? job.error, /^https:\/\/wormhole\.app\/room1#[\w-]{22}$/);
		assert.equal(job.sent, job.total);
		assert.deepEqual(fake.seen.filter(line => line.startsWith("POST /b2 ")).sort(), ["POST /b2 room1/0", "POST /b2 room1/1", "POST /b2 room1/2"]);
		assert.equal(fake.seen.at(-1), "POST /api/room/room1/b2/finish-upload");
		assert.deepEqual(uploadDirs(), before);
	} finally { fake.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a failed piece stops new pieces, waits for the ones in flight, then fails for good", async () => {
	const dir = fs.mkdtempSync(join(os.tmpdir(), "test-wormhole-")), before = uploadDirs();
	const fake = fakeWormhole(async index => index === 0 ? new Response("no", { status: 400 }) : (await new Promise(done => setTimeout(done, 300)), new Response("")));
	try {
		fs.writeFileSync(join(dir, "big.bin"), randomBytes(26e6)); // 6 pieces, 4 in flight at once
		const job = await finished(startUpload(join(dir, "big.bin"), "")), frozen = JSON.stringify(job);
		assert.equal(job.status, "Failed");
		assert.match(job.error, /piece upload returned HTTP 400/);
		await new Promise(done => setTimeout(done, 500));
		assert.equal(JSON.stringify(job), frozen, "the job never changes after it is done");
		assert.deepEqual(fake.seen.filter(line => line.startsWith("POST /b2 ")).sort(), ["POST /b2 room1/0", "POST /b2 room1/1", "POST /b2 room1/2", "POST /b2 room1/3"]);
		assert.ok(!fake.seen.some(line => line.endsWith("finish-upload")));
		assert.deepEqual(uploadDirs(), before);
	} finally { fake.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("bencode sorts keys and writes bytes", () => {
	assert.equal(bencode({ z: 1, a: ["x", Buffer.from([0x61])], "piece length": 16384 }).toString(), "d1:al1:x1:ae12:piece lengthi16384e1:zi1ee");
});

test("piece length and size hint match the web app", () => {
	assert.deepEqual([pieceLength(100), pieceLength(16384), pieceLength(20_000), pieceLength(5e9)], [16384, 16384, 32768, 5_013_504]);
	assert.deepEqual([roundSizeMb(4e5), roundSizeMb(42e6), roundSizeMb(1234e6)], [0, 42, 1200]);
});

test("an archive holds only the selected file, even one named *.txt", async t => {
	if (!sevenZip()) return t.skip("7z is not installed"); // lists both zip and 7z archives
	// Windows names cannot hold * or ?; there this only checks the archive commands themselves.
	const dir = fs.mkdtempSync(join(os.tmpdir(), "test-wormhole-")), name = process.platform === "win32" ? "a.txt" : "*.txt";
	try {
		fs.writeFileSync(join(dir, name), "picked"); fs.writeFileSync(join(dir, "secret.txt"), "secret");
		for (const pack of ["zip", "7z"]) {
			if (pack === "zip" && process.platform !== "win32" && !findCommand("zip")) { t.diagnostic("zip is not installed"); continue; }
			const out = await archive(join(dir, name), pack, fs.mkdtempSync(join(dir, "out-")));
			const entries = [...execFileSync(sevenZip(), ["l", "-ba", "-slt", "-spd", out], { encoding: "utf8" }).matchAll(/^Path = (.*)$/gm)].map(match => match[1]);
			assert.deepEqual(entries, [name], pack);
		}
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("encrypted spool hashes each piece and decrypts back", async () => {
	const dir = fs.mkdtempSync(join(os.tmpdir(), "test-wormhole-")), input = join(dir, "in.bin"), out = join(dir, "out.enc"), plain = randomBytes(200_000), key = randomBytes(16);
	try {
		fs.writeFileSync(input, plain);
		const length = 65_536, hashes = await encryptFile(input, key, length, out), encrypted = fs.readFileSync(out);
		assert.equal(encrypted.length, encryptedSize(plain.length));
		assert.deepEqual(hashes.map(hash => hash.toString("hex")), Array.from({ length: Math.ceil(encrypted.length / length) }, (_, i) => createHash("sha1").update(encrypted.subarray(i * length, (i + 1) * length)).digest("hex")));
		const decrypted = await new Keychain(key, null).decryptStream(new Blob([encrypted]).stream());
		assert.deepEqual(Buffer.from(await new Response(decrypted).arrayBuffer()), plain);
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
