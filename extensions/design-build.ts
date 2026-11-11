// One publication boundary for component designs. Immutable preview generations keep a failed draft off screen.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { APP_FILE, assertAppRecipe, buildApp } from "./design-app.ts";
import { atomic, confined, read } from "./plan3-files.ts";
import type { LibraryOptions } from "./design-library.ts";

export const BUILD_FILE = ".design-build.json", BUILD_STATUS = ".design-status.json", PREVIEW = ".design-preview";
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export const DRAFT_FILE = ".design-draft.json";
const generatedPath = (name: string) => /^[\w.-]+\.html?$/.test(name) || /^assets\/[\w-]+\.(?:js|css|svg|png|jpg|jpeg|webp|woff2)$/.test(name);
type Receipt = { schema: 1; sourceDigest: string; generated: Record<string, string> };
export function readAppFiles(directory: string) {
	const files = new Map<string, Buffer>(); let bytes = 0;
	function visit(rel: string) {
		for (const entry of fs.readdirSync(rel ? confined(directory, rel) : directory, { withFileTypes: true })) {
			if (entry.name === "node_modules" || !rel && [PREVIEW, BUILD_STATUS].includes(entry.name)) continue;
			const name = rel ? `${rel}/${entry.name}` : entry.name, file = confined(directory, name);
			if (entry.isSymbolicLink()) throw new Error(`App source cannot contain symlinks: ${name}.`);
			if (entry.isDirectory()) { if (name.split("/").length > 20) throw new Error("App folder is too deeply nested."); visit(name); }
			else if (entry.isFile()) {
				const size = fs.statSync(file).size; bytes += size;
				if (size > 8 * 1024 * 1024 || bytes > 32 * 1024 * 1024 || files.size >= 4096) throw new Error("App folder exceeds its bounded file/size budget.");
				files.set(name, fs.readFileSync(file));
			}
		}
	}
	if (fs.existsSync(directory)) visit("");
	return files;
}
function receipt(files: Map<string, Buffer>): Receipt | undefined {
	const bytes = files.get(BUILD_FILE); if (!bytes) return;
	let value; try { if (bytes.length > 128 * 1024) throw Error(); value = JSON.parse(bytes.toString()); } catch { throw new Error("Invalid component build receipt."); }
	if (value?.schema !== 1 || typeof value.sourceDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceDigest) || !value.generated || typeof value.generated !== "object" || Array.isArray(value.generated) || Object.keys(value.generated).length > 512 || !Object.hasOwn(value.generated, "index.html") || Object.entries(value.generated).some(([name, digest]) => !generatedPath(name) || typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest))) throw new Error("Invalid component build receipt.");
	return value;
}
export { receipt as appReceipt };
const digest = (files: Map<string, Buffer>, previous?: Receipt) => hash([...files].filter(([name]) => name !== BUILD_FILE && name !== DRAFT_FILE && !Object.hasOwn(previous?.generated ?? {}, name)).sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => `${JSON.stringify(name)}:${hash(bytes)}\n`).join(""));
const validOutput = (files: Map<string, Buffer>, record: Receipt) => Object.entries(record.generated).every(([name, digest]) => files.has(name) && hash(files.get(name)!) === digest);
const generation = (record: Receipt) => hash(JSON.stringify(record));
function saveFiles(directory: string, files: Map<string, Buffer>) { for (const [name, bytes] of files) atomic(confined(directory, name), bytes); }
function publishPreview(directory: string, files: Map<string, Buffer>, record: Receipt) {
	const root = confined(directory, PREVIEW), target = confined(root, generation(record));
	const verified = () => { try { const kept = readAppFiles(target); return validOutput(kept, record) && digest(kept, record) === record.sourceDigest; } catch { return false; } };
	if (fs.existsSync(target) && verified()) return target;
	if (!validOutput(files, record) || digest(files, record) !== record.sourceDigest) throw new Error("Last-good component generation failed integrity verification.");
	const stage = confined(root, `.stage-${randomUUID()}`), corrupt = confined(root, `.corrupt-${randomUUID()}`);
	try {
		fs.mkdirSync(stage, { recursive: true }); saveFiles(stage, files);
		if (fs.existsSync(target)) fs.renameSync(target, corrupt);
		try { fs.renameSync(stage, target); }
		catch (error) {
			// Another process may have reconstructed the same missing cache while this stage was prepared.
			if (!verified()) { if (fs.existsSync(corrupt) && !fs.existsSync(target)) fs.renameSync(corrupt, target); throw error; }
		}
	} finally { fs.rmSync(stage, { recursive: true, force: true }); fs.rmSync(corrupt, { recursive: true, force: true }); }
	return target;
}
export function appPublication(source: Map<string, Buffer>, output: Map<string, Buffer>) {
	if (!output.has("index.html") || [...output.keys()].some(name => !generatedPath(name))) throw new Error("Invalid component publication paths.");
	const record: Receipt = { schema: 1, sourceDigest: digest(source), generated: Object.fromEntries([...output].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, hash(bytes)])) };
	return new Map([...source, ...output, [BUILD_FILE, Buffer.from(JSON.stringify(record) + "\n")]]);
}
export function buildStatus(directory: string) {
	try { const bytes = Buffer.from(read(confined(directory, fs.existsSync(path.join(directory, BUILD_STATUS)) ? BUILD_STATUS : DRAFT_FILE), 4096)); if (bytes.length > 4096) return { state: "failed", error: "Invalid component build status." }; const status = JSON.parse(bytes.toString()); if (!["building", "failed", "ready"].includes(status.state)) throw Error(); return { state: status.state as string, error: typeof status.error === "string" ? status.error.slice(0, 600) : undefined }; }
	catch (error) { return error?.code === "ENOENT" ? undefined : { state: "failed", error: "Invalid component build status." }; }
}
export function buildInfo(directory: string) {
	if (!fs.existsSync(path.join(directory, APP_FILE)) && !fs.existsSync(path.join(directory, BUILD_FILE))) return undefined;
	const state = buildStatus(directory);
	try {
		const record = receipt(new Map([[BUILD_FILE, Buffer.from(read(confined(directory, BUILD_FILE), 128 * 1024))]]))!;
		return { state: state?.state ?? "ready", error: state?.error, generation: generation(record), screens: Object.keys(record.generated).filter(name => /\.html?$/.test(name)) };
	} catch (error) { return { state: state?.state ?? "failed", error: state?.error ?? error.message, generation: "", screens: [] as string[] }; }
}
/** Historical copies use their retained local output; live pages use an immutable, fully published generation. */
export function appPreviewFolder(directory: string, historical = false) {
	if (!fs.existsSync(path.join(directory, APP_FILE)) && !fs.existsSync(path.join(directory, BUILD_FILE))) return directory;
	const files = readAppFiles(directory), record = receipt(files);
	if (!record) throw new Error("Component preview is not built yet.");
	if (historical) { if (!validOutput(files, record)) throw new Error("Historical component output failed verification."); return directory; }
	const target = confined(directory, `${PREVIEW}/${generation(record)}`);
	if (fs.existsSync(target)) return publishPreview(directory, files, record);
	if (!validOutput(files, record) || digest(files, record) !== record.sourceDigest) throw new Error("Last-good component preview is unavailable; fix the draft and call design look.");
	return publishPreview(directory, files, record);
}
/** Caller holds the per-design lock. Build source is data, not a host-loaded module or executable config. */
export async function ensureAppBuilt(directory: string, options: LibraryOptions = {}) {
	const status = (state: string, error?: string) => atomic(confined(directory, BUILD_STATUS), JSON.stringify({ state, ...error ? { error: error.slice(0, 600) } : {} }) + "\n");
	try {
		const before = readAppFiles(directory); assertAppRecipe(before);
		const previous = receipt(before), sourceDigest = digest(before, previous);
		if (previous && previous.sourceDigest === sourceDigest && validOutput(before, previous)) { publishPreview(directory, before, previous); fs.rmSync(confined(directory, DRAFT_FILE), { force: true }); status("ready"); return { rebuilt: false, sourceDigest }; }
		status("building"); options.progress?.("Building the pinned component preview; last-good output stays visible.");
		const output = await buildApp(before, options);
		options.signal?.throwIfAborted();
		if (digest(readAppFiles(directory), previous) !== sourceDigest) throw new Error("Source changed during the component build; retry design look after writes settle.");
		const source = new Map([...before].filter(([name]) => name !== BUILD_FILE && name !== DRAFT_FILE && !Object.hasOwn(previous?.generated ?? {}, name)));
		const files = appPublication(source, output), record = receipt(files)!;
		if (previous?.sourceDigest === sourceDigest && JSON.stringify(previous.generated) !== JSON.stringify(record.generated)) throw new Error("Pinned component rebuild was not byte-identical; last-good preview retained.");
		publishPreview(directory, files, record);
		// Content-addressed assets land first, complete HTML next, and the matching receipt is the atomic commit pointer.
		for (const [name, bytes] of output) if (!/\.html?$/.test(name)) atomic(confined(directory, name), bytes);
		for (const [name, bytes] of output) if (/\.html?$/.test(name)) atomic(confined(directory, name), bytes);
		atomic(confined(directory, BUILD_FILE), files.get(BUILD_FILE)!); fs.rmSync(confined(directory, DRAFT_FILE), { force: true }); status("ready");
		for (const name of Object.keys(previous?.generated ?? {})) if (!output.has(name)) fs.rmSync(confined(directory, name), { force: true });
		return { rebuilt: true, sourceDigest };
	} catch (error) { status("failed", error instanceof Error ? error.message : String(error)); throw error; }
}
