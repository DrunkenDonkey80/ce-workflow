import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ledgerFile, unprocessedVideos } from "./work-video-status.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "video-status-"));
const ledger = path.join(root, "ledger.json");
const record = (id, status) => ({ id, status, title: "Same title", processedOn: "2026-11-09", evidence: "review.md" });
const records = [record("reviewed001", "reviewed"), record("skipped0001", "skipped")];
const save = value => writeFile(ledger, JSON.stringify(value));
const digest = async (folder, id) => {
	const directory = path.join(root, folder);
	await mkdir(directory);
	await writeFile(path.join(directory, "digest.md"), `<!-- video_digest: ${id} -->\r\n# Same title\r\n`);
};
try {
	await save(records);
	await digest("renamed-reviewed-folder", "reviewed001");
	await digest("skipped", "skipped0001");
	await digest("new", "unseen00001");
	await digest("duplicate-new", "unseen00001");
	await mkdir(path.join(root, "unfinished-download"));
	await writeFile(path.join(root, "feeds.json"), JSON.stringify({ seen: ["unseen00001"] }));
	const before = await readFile(ledger, "utf8");
	const pending = await unprocessedVideos(root, ledger);
	assert.deepEqual(pending.map(v => v.id), ["unseen00001"], "reviewed and skipped IDs must not reappear as new; ingest seen state must not hide new reviews");
	assert.equal(pending[0].title, "Same title");
	assert(path.isAbsolute(pending[0].file));
	assert.equal(await readFile(ledger, "utf8"), before, "scanning must not mark videos processed");
	await save([...records, record("unseen00001", "reviewed")]);
	assert.deepEqual(await unprocessedVideos(root, ledger), [], "recording review removes it from the next scan");
	await save([...records, records[0]]);
	await assert.rejects(unprocessedVideos(root, ledger), /Duplicate video ledger ID/);
	for (const bad of [null, {}, [null], [record("bad-id", "reviewed")], [record("unseen00001", "seen")], [{ ...records[0], evidence: "" }]]) {
		await save(bad);
		await assert.rejects(unprocessedVideos(root, ledger), /Video ledger must be an array|Invalid video ledger record/);
	}
	await writeFile(ledger, "{broken");
	await assert.rejects(unprocessedVideos(root, ledger), error => /Cannot load video ledger/.test(error.message) && error.cause instanceof SyntaxError);
	await assert.rejects(unprocessedVideos(root, path.join(root, "missing.json")), /ENOENT/);
	await save(records);
	await assert.rejects(unprocessedVideos(path.join(root, "missing"), ledger), /ENOENT/);
	await digest("malformed", "invalid");
	await assert.rejects(unprocessedVideos(root, ledger), /Missing or invalid video ID header/);
	await rm(path.join(root, "malformed"), { recursive: true });
	await rm(path.join(root, "new"), { recursive: true });
	await rm(path.join(root, "duplicate-new"), { recursive: true });
	assert.deepEqual(await unprocessedVideos(root, ledger), []);

	// Validate the committed ledger without depending on the operator's Downloads folder.
	const empty = path.join(root, "empty");
	await mkdir(empty);
	assert.deepEqual(await unprocessedVideos(empty), []);
	const committed = JSON.parse(await readFile(ledgerFile, "utf8"));
	assert.equal(committed.find(r => r.id === "djSbndoByr8")?.status, "reviewed");
	assert.equal(committed.find(r => r.id === "5C_HPTJg5ek")?.status, "skipped");
	assert.equal(committed.find(r => r.id === "lraHlXpuhKs")?.status, "skipped");
	const script = fileURLToPath(new URL("./work-video-status.mjs", import.meta.url));
	assert.equal(execFileSync(process.execPath, [script, empty], { cwd: root, encoding: "utf8" }).trim(), "[]", "CLI finds repo ledger from outside repo cwd");
	assert.throws(() => execFileSync(process.execPath, [script], { stdio: "pipe" }), error => error.status === 1 && /Usage:/.test(error.stderr.toString()));
	console.log("video status self-checks passed");
} finally {
	await rm(root, { recursive: true, force: true });
}
