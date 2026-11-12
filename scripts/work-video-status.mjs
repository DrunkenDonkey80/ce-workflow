// Repository-local review state; yt-ingest owns downloads, not review decisions.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ledgerFile = new URL("../docs/upstream/processed-videos.json", import.meta.url);
const videoId = /^[A-Za-z0-9_-]{11}$/;

export async function unprocessedVideos(directory, ledger = ledgerFile) {
	let records;
	try { records = JSON.parse(await readFile(ledger, "utf8")); }
	catch (error) { throw new Error(`Cannot load video ledger ${ledger}: ${error.message}`, { cause: error }); }
	if (!Array.isArray(records)) throw new Error("Video ledger must be an array");
	const processed = new Set();
	for (const record of records) {
		if (!record || typeof record.id !== "string" || !videoId.test(record.id)
			|| !["reviewed", "skipped"].includes(record.status)
			|| typeof record.title !== "string" || !record.title.trim()
			|| typeof record.processedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.processedOn)
			|| typeof record.evidence !== "string" || !record.evidence.trim()) {
			throw new Error("Invalid video ledger record");
		}
		if (processed.has(record.id)) throw new Error(`Duplicate video ledger ID: ${record.id}`);
		processed.add(record.id);
	}
	const pending = [], listed = new Set();
	// yt-ingest's layout is one directory per video, each containing digest.md.
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const file = path.resolve(directory, entry.name, "digest.md");
		let digest;
		try { digest = await readFile(file, "utf8"); }
		catch (error) { if (error.code === "ENOENT") continue; throw error; }
		const id = digest.match(/^\uFEFF?<!-- video_digest: ([A-Za-z0-9_-]{11}) -->\r?\n/)?.[1];
		if (!id) throw new Error(`Missing or invalid video ID header: ${file}`);
		if (processed.has(id) || listed.has(id)) continue;
		listed.add(id);
		pending.push({ id, title: digest.match(/^# (.+)$/m)?.[1]?.trim() || id, file });
	}
	return pending.sort((a, b) => a.id.localeCompare(b.id));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
	try {
		if (process.argv.length !== 3) throw new Error("Usage: node scripts/work-video-status.mjs <yt-ingest digest directory> (ce-workflow checkout only)");
		console.log(JSON.stringify(await unprocessedVideos(process.argv[2]), null, 2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
