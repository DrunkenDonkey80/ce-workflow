// Explore: a chat-linked archive (zip, 7z, tar…) unpacked into a temp folder the page can walk, served under /x/<key>/.
// The key is a random capability, so an HTML page inside can load its own relative images, styles and scripts on this PC
// (no ?token=) and remotely (no cookie in a sandboxed frame). Such pages run sandboxed: an opaque origin that cannot call the hub.
import type http from "node:http";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, type FSWatcher, watch } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, isAbsolute } from "node:path";
import { linkedFile } from "./linked-files.ts";
import { sevenZip } from "./wormhole.ts";
import { DESIGN_CSP, renderDesign, SANDBOX_CSP } from "../../extensions/design-render.ts";
import { agentDir } from "./rpc-client.ts";
import { withBridge } from "./design-bridge.ts";
import { appPreviewFolder, buildInfo } from "../../extensions/design-build.ts";
import { catalogFiles, catalogFolder, designCatalog, type CatalogEntry } from "../../extensions/design-catalog.ts";
import { fetchSystem } from "../../extensions/design.ts";
import { confined } from "../../extensions/plan3-files.ts";

export const ARCHIVE = /\.(?:zip|7z|rar|tar|tgz|tbz2?|txz|tar\.(?:gz|bz2|xz|zst))$/i;
const TAR_FAMILY = /\.(?:tar|tgz|tbz2?|txz|tar\.(?:gz|bz2|xz|zst))$/i, MAX_ARCHIVE = 2e9, MAX_FILES = 5000;
const root = join(tmpdir(), "pi-hub-explore");
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
// archive real path + mtime + size → key, for this hub run; the first explore clears earlier runs' folders.
const unpacked = new Map<string, string>(), folders = new Map<string, string>();
// A viewed page's live folder: each file served must pass the same check as a chat link for that project and device.
// One key per open viewer (D3): the real files it served are watched, and a change tells that viewer (notify) to reload.
// own: a design session's mirror (designPage), confined to its folder instead of the chat-link check (which refuses .pi).
type View = { project: string; remote: boolean; own?: boolean; owner?: string; reference?: boolean; card?: boolean; sample?: { item: CatalogEntry; names: string[] }; cleanup?: string; notify?: (key: string) => void; served: Set<string>; timer?: ReturnType<typeof setTimeout>; extra?: FSWatcher[] };
const live = new Map<string, View>();
const referencePending = new Set<string>();
// Folders, not files, are watched: an atomic save (temp file + rename) or delete-and-recreate replaces the file's inode.
const watched = new Map<string, { watcher: FSWatcher; keys: Set<string> }>();
const idle = new Map<string, ReturnType<typeof setTimeout>>();
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
/**
 * A chat-linked file (a validated real path) shown in the Files viewer: its folder served live. An HTML page lists the
 * folder (its relative images, scripts and data load); any other file lists only itself, so a big folder is never walked.
 */
export async function viewPage(real: string, project: string, remote: boolean, watcher?: { owner: string; notify?: (key: string) => void }, own = false) {
	const folder = dirname(real), key = randomBytes(16).toString("hex");
	folders.set(key, folder); live.set(key, { project, remote, own, ...watcher, served: new Set() });
	const files: { path: string; size: number }[] = [];
	if (/\.html?$/i.test(real)) await walk(folder, "", files, true); else files.push({ path: basename(real), size: (await stat(real)).size });
	return { key, name: basename(folder), files: files.slice(0, MAX_FILES).sort((a, b) => a.path.localeCompare(b.path)), truncated: files.length > MAX_FILES, open: basename(real) };
}
/**
 * D7: a design session's page, <project>/.pi/designs/<handle>/index.html, only when both really are there (no symlinked
 * folder or page); viewPage(own) then serves only that folder. Any other .pi file stays refused.
 */
export async function designPage(project: string, handle: string, screen = "index.html", version?: number) {
	if (!/^design-\d+$/.test(handle) || !SCREEN.test(screen) || version !== undefined && !(Number.isSafeInteger(version) && version > 0)) return undefined;
	// S09: a kept version is history/<handle>/<n>/, read-only by convention (only design restore copies it back).
	const place = version ? join(".pi", "designs", "history", handle, String(version)) : join(".pi", "designs", handle);
	const base = await realpath(project).catch(() => undefined), dir = base && await realpath(join(base, place)).catch(() => undefined);
	if (!base || !dir || relative(base, dir) !== place) return undefined;
	let preview: string; try { preview = appPreviewFolder(dir, !!version); } catch { return undefined; }
	const page = await realpath(join(preview, screen)).catch(() => undefined);
	return page && dirname(page) === preview ? page : undefined;
}
// A design screen: an HTML file directly in the design folder (D7).
const SCREEN = /^[\w.-]+\.html?$/i;
/** D7, D5: a design's screens (index.html first) and kept version numbers, for the preview's pickers. */
export async function designLists(project: string, handle: string) {
	const names = async (dir: string) => (await readdir(dir, { withFileTypes: true }).catch(() => []));
	const screens = (await names(join(project, ".pi", "designs", handle))).filter(entry => entry.isFile() && SCREEN.test(entry.name)).map(entry => entry.name)
		.sort((a, b) => Number(b === "index.html") - Number(a === "index.html") || a.localeCompare(b));
	const versions = (await names(join(project, ".pi", "designs", "history", handle))).filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name)).map(entry => Number(entry.name)).sort((a, b) => a - b);
	const build = buildInfo(join(project, ".pi", "designs", handle));
	return { screens: build ? build.screens.sort((a, b) => Number(b === "index.html") - Number(a === "index.html") || a.localeCompare(b)) : screens, versions, ...build ? { build } : {} };
}
/**
 * S08: while a design view is open, its folder and history are watched; a burst of events that changed the screen or
 * version lists calls changed once with the new lists (a plain save changes neither, and file-changed covers it).
 */
export async function watchDesign(key: string, project: string, handle: string, changed: (lists: Awaited<ReturnType<typeof designLists>>) => void) {
	const view = live.get(key);
	if (!view) return;
	const history = join(project, ".pi", "designs", "history", handle);
	await mkdir(history, { recursive: true }).catch(() => undefined); // watchable before the first version exists
	let last = JSON.stringify(await designLists(project, handle)), timer: ReturnType<typeof setTimeout> | undefined;
	const check = () => { clearTimeout(timer); timer = setTimeout(async () => {
		if (!live.has(key)) return;
		const lists = await designLists(project, handle), now = JSON.stringify(lists);
		if (now !== last) { last = now; changed(lists); }
	}, 150); };
	view.extra = [join(project, ".pi", "designs", handle), history].flatMap(dir => {
		try { const watcher = watch(dir, check); watcher.on("error", () => watcher.close()); return [watcher]; } catch { return []; } // gone or out of handles: no live lists
	});
}
/** Library samples are bounded local copies, never live roots or executable build inputs. */
export async function referencePage(project: string, id: unknown, revision: unknown, owner: string, remote: boolean) {
	if (referencePending.has(owner) || referencePending.size >= 4 || [...live.values()].filter(view => view.owner === owner && view.reference && !view.card).length >= 8) throw fail(429, "A reference preview is busy; close an earlier preview and retry.");
	referencePending.add(owner);
	let directory: string | undefined;
	try {
		const sample = await catalogFiles(project, id, revision);
		directory = await mkdtemp(join(tmpdir(), "pi-hub-reference-"));
		for (const [name, bytes] of sample.files) { const target = confined(directory, name); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes); }
		const view = await viewPage(confined(directory, sample.item.page!), project, remote, { owner }, true);
		folders.set(view.key, directory);
		Object.assign(live.get(view.key)!, { reference: true, cleanup: directory, sample: { item: sample.item, names: [...sample.files.keys()] } });
		return { ...view, open: sample.item.page, files: [...sample.files].map(([path, bytes]) => ({ path, size: bytes.length })), revision: sample.revision, note: sample.note };
	} catch (error) { if (directory) await rm(directory, { recursive: true, force: true }); throw error; }
	finally { referencePending.delete(owner); }
}

/** V-04: a library card's screenshot (a live page per card cost too much memory). It is rendered once headless and kept
 * on disk by the page's content, shared by every project, so only a changed page renders again. */
const shooting = new Map<string, Promise<Buffer>>(), shotQueue: (() => void)[] = [];
let shots = 0;
// An OpenDesign theme is pictured as one fixed sample screen in its colors (its own color page is just swatches).
const THEME_SAMPLE = readFile(new URL("./theme-sample.html", import.meta.url));
export async function cardShot(project: string, id: unknown, revision: unknown) {
	const { item, files, revision: content } = await catalogFiles(project, id, revision);
	const tokens = item.id.startsWith("od-colors:") ? files.get("tokens.css") : undefined;
	const key = createHash("sha256").update(`${item.id}\0${item.page}\0${content}`).update(tokens ? await THEME_SAMPLE : "").digest("hex");
	const file = join(agentDir(), "ce-workflow", "design-thumbs", `${key}.png`);
	const kept = await readFile(file).catch(() => undefined);
	if (kept) return kept;
	let pending = shooting.get(key);
	if (!pending) { pending = shoot(project, id, revision, file, tokens).finally(() => shooting.delete(key)); shooting.set(key, pending); }
	return pending;
}
/** V-04: the hub renders every card's shot in the background once the library opens, so nobody has to scroll to keep it
 * going. One at a time, leaving a render slot for the cards the user is looking at; OpenDesign packages download first. */
const warming = new Set<string>();
export function warmShots(project: string) {
	if (warming.has(project)) return;
	warming.add(project);
	void (async () => {
		for (const item of (await designCatalog(project)).entries) {
			if (item.preview !== "sample" || item.availability === "unavailable") continue;
			try {
				if (item.source === "od" && item.availability !== "cached") await fetchSystem(project, item.id.replace(/^od(?:-colors)?:/, ""));
				await cardShot(project, item.id, item.revision);
			} catch { /* one page that fails does not stop the rest; its card offers Retry */ }
		}
	})().catch(() => undefined).finally(() => warming.delete(project));
}
// shortcut: old shots of changed pages stay on disk (about 100 KB each); prune by age if the folder grows.
async function shoot(project: string, id: unknown, revision: unknown, file: string, tokens?: Buffer) {
	if (shots >= 2) await new Promise<void>(go => shotQueue.push(go)); // each render starts a headless browser
	shots++;
	let sample: string | undefined;
	try {
		let { item, directory } = await catalogFolder(project, id, revision), screen = item.page!;
		if (tokens) {
			sample = directory = await mkdtemp(join(tmpdir(), "pi-hub-theme-")); screen = "index.html";
			await writeFile(join(sample, "index.html"), await THEME_SAMPLE); await writeFile(join(sample, "tokens.css"), tokens);
		}
		const shot = await renderDesign({ folder: directory, screen, width: 1280, height: 800, reducedMotion: true, maxEdge: 640 });
		if (!shot.png.length) throw fail(502, "The page gave no picture.");
		await mkdir(dirname(file), { recursive: true });
		const temp = `${file}.${randomBytes(4).toString("hex")}`;
		await writeFile(temp, shot.png); await rename(temp, file);
		return shot.png;
	} finally { shots--; shotQueue.shift()?.(); if (sample) await rm(sample, { recursive: true, force: true }); }
}

/** Attach the exact isolated sample shown, even when its original studio source has since changed. */
export async function referenceSnapshot(project: string, key: unknown, id: unknown, revision: unknown, owner: string) {
 if (typeof key !== "string" || !/^[a-f0-9]{32}$/.test(key)) throw fail(400, "Invalid sample capability.");
 const view = live.get(key), folder = folders.get(key);
 if (!view?.reference || view.owner !== owner || view.project !== project || !folder || !view.sample || view.sample.item.id !== id || view.sample.item.revision !== revision) throw fail(404, "No such reference sample in this session.");
 const files = new Map<string, Buffer>();
 for (const name of view.sample.names) files.set(name, await readFile(confined(folder, name)));
 return { source: view.sample.item, files };
}

/** The viewer closed: its key stops serving and its watches close. */
export function unview(key: string, owner?: string) {
	const view = live.get(key);
	if (!view || owner !== undefined && view.owner !== owner) return false;
	clearTimeout(view.timer); live.delete(key); folders.delete(key);
	if (view.cleanup) void rm(view.cleanup, { recursive: true, force: true }).catch(() => {});
	for (const watcher of view.extra ?? []) watcher.close();
	for (const [dir, entry] of watched) if (entry.keys.delete(key) && !entry.keys.size) { entry.watcher.close(); watched.delete(dir); }
	return true;
}
/** A session's page count: with no page open for a minute (not a reconnect), its viewers close. */
export function viewers(owner: string, count: number, grace = 60_000) {
	clearTimeout(idle.get(owner)); idle.delete(owner);
	if (!count) idle.set(owner, setTimeout(() => { idle.delete(owner); for (const [key, view] of live) if (view.owner === owner) unview(key); }, grace));
}
function track(key: string, view: View, real: string) {
	if (!view.notify || view.served.has(real)) return;
	view.served.add(real);
	const dir = dirname(real);
	let entry = watched.get(dir);
	if (!entry) {
		try {
			const watcher = watch(dir, (_event, name) => {
				const file = name ? join(dir, String(name)) : undefined;
				for (const id of watched.get(dir)?.keys ?? []) {
					const at = live.get(id);
					// One notice per save: a save is often several events (truncate, write, rename).
					if (at && (!file || at.served.has(file))) { clearTimeout(at.timer); at.timer = setTimeout(() => at.notify?.(id), 150); }
				}
			});
			watcher.on("error", () => { watcher.close(); watched.delete(dir); });
			watched.set(dir, entry = { watcher, keys: new Set() });
		} catch { return; } // folder gone or out of watch handles: that file just won't live-reload
	}
	entry.keys.add(key);
}
async function walk(base: string, prefix: string, files: { path: string; size: number }[], skipHidden = false) {
	if (files.length > MAX_FILES) return;
	for (const entry of await readdir(join(base, prefix), { withFileTypes: true }).catch(() => [])) {
		if (skipHidden && entry.name.startsWith(".")) continue;
		const path = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) await walk(base, path, files, skipHidden);
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
	const access = live.get(match[1]);
	if (!info?.isFile() || access && !access.own && !await linkedFile(real, access.project, access.remote)) { response.writeHead(404, { "content-type": "text/plain" }); response.end("Not found (the hub restarted? Explore the archive again)."); return true; }
	if (access) track(match[1], access, real!);
	const type = TYPES[extname(real!).toLowerCase()] ?? "text/plain; charset=utf-8"; // unknown: plain text, never sniffed into a page
	// S10: a design session's own pages get the comment bridge; other explored pages are served as they are.
	const bridged = access?.own && !access.reference && !download && type.startsWith("text/html") ? Buffer.from(withBridge(await readFile(real!, "utf8"))) : undefined;
	response.writeHead(200, {
		"content-type": download ? "application/octet-stream" : type, "content-length": bridged?.length ?? info.size, "cache-control": "private, no-store", "x-content-type-options": "nosniff",
		// Opaque origin (no allow-same-origin): page scripts run but cannot read the hub. https: lets pages load libraries from a CDN;
		// their module scripts and fetches are cross-origin to this opaque page, hence allow-origin * (the key is the capability).
		"content-security-policy": access?.reference
			? `sandbox allow-scripts; default-src 'none'; script-src ${origin}/x/${match[1]}/ 'unsafe-inline' 'unsafe-eval'; style-src ${origin}/x/${match[1]}/ 'unsafe-inline'; img-src ${origin}/x/${match[1]}/ data: blob:; font-src ${origin}/x/${match[1]}/ data:; media-src ${origin}/x/${match[1]}/ data: blob:; connect-src ${origin}/x/${match[1]}/; base-uri 'none'; form-action 'none'; object-src 'none'`
			: (access?.own ? DESIGN_CSP : SANDBOX_CSP)(origin),
		"referrer-policy": "no-referrer",
		"x-dns-prefetch-control": "off",
		"access-control-allow-origin": "*",
		"content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(basename(real!))}`,
	});
	if (bridged) response.end(bridged); else createReadStream(real!).on("error", () => response.destroy()).pipe(response);
	return true;
}
