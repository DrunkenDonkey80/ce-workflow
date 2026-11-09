// design: design sessions (D1). Each handle (design-1, design-2, ...) is one design folder, .pi/designs/<handle>/, and one hub
// Pi session named by its direction whose own agent builds the design there while the hub's design page previews it live.
// select exports it to docs/designs/<name>/ and hands it to the starting session or a new one; clone forks another approach.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redactOpenDesignText } from "./opendesign-client.ts";
import { atomic, confined, withPlanLock } from "./plan3-files.ts";

type Changes = { added: string[]; changed: string[]; removed: string[] };
type Kind = "web" | "app" | "deck";
// name: the hub row's name (the direction, short); title: its second line; brief: what start was asked for (BRIEF.md at select);
// inputs: project files the first prompt names; references: captured sites it uses; from: the hub session that started it.
export type Session = { handle: string; direction: string; name?: string; title?: string; brief?: string; kind: Kind; inputs: string[]; references: string[]; system?: { name: string; commit: string }; from?: string; hubSessionId?: string; hubError?: string; selected?: boolean; created: number };
type Store = { version: 2; next: number; sessions: Session[] };
const FILE = ".pi/designs/sessions.json";
const KINDS = ["web", "app", "deck"];

const storeFile = (cwd: string) => confined(cwd, FILE);
/** v1 (OpenDesign) sessions: the brief was the start of the run prompt; OD's project, run and status fields go. */
function fromV1(item): Session {
	const prompt = typeof item?.prompt === "string" ? item.prompt : "";
	return {
		handle: String(item?.handle), direction: String(item?.direction ?? ""), name: item?.name, title: item?.title,
		brief: prompt ? prompt.split("\n\nDirection for this design")[0].trim() : undefined, kind: "web", inputs: [], references: [],
		from: item?.from, hubSessionId: item?.hubSessionId, selected: item?.selected, created: Number(item?.created) || Date.now(),
	};
}
function load(cwd: string): Store {
	if (!fs.existsSync(storeFile(cwd))) return { version: 2, next: 1, sessions: [] };
	let store;
	try { store = JSON.parse(fs.readFileSync(storeFile(cwd), "utf8")); } catch (cause) { throw new Error(`${FILE} is unreadable; fix or delete it.`, { cause }); }
	if (![1, 2].includes(store?.version) || !Array.isArray(store.sessions)) throw new Error(`${FILE} is not a design session list.`);
	if (store.version === 1) return { version: 2, next: Number(store.next) || store.sessions.length + 1, sessions: store.sessions.map(fromV1) };
	return store;
}
/** Read-modify-write the store under one lock (every design session shares it). */
const change = <T>(cwd: string, edit: (store: Store) => T) => withPlanLock(storeFile(cwd), () => {
	const store = load(cwd), result = edit(store);
	atomic(storeFile(cwd), JSON.stringify(store, null, "\t"));
	return result;
});
function session(store: Store, handle: string) {
	const found = store.sessions.find(item => item.handle === String(handle ?? "").replace(/^@/, ""));
	if (!found) throw new Error(`No design session ${handle}; known: ${store.sessions.map(item => item.handle).join(", ") || "none (start some)"}.`);
	return found;
}
/** Up to max characters of the first line, cut at a word. */
function short(value: string, max: number) {
	const line = value.trim().split(/\r?\n/)[0].trim();
	if (line.length <= max) return line;
	const cut = line.slice(0, max), space = cut.lastIndexOf(" ");
	return (space > max / 2 ? cut.slice(0, space) : cut).trim();
}
const subtitleOf = (item: Session) => `${item.selected ? "★ " : ""}${item.title ?? ""}`.trim();
function text(value, label: string, max: number) {
	if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > max) throw new Error(`${label} must be non-empty text up to ${max} bytes.`);
	return value.trim();
}
const clip = (value: string, max: number) => redactOpenDesignText(value.replace(/token=\w+/g, "token=…"), max);
export const designFolder = (handle: string) => `.pi/designs/${handle}`;

/** workOrchestrator.designModel, "provider/id:effort": project setting first, then global. */
function designModelSetting(cwd: string) {
	const agent = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
	const setting = (file: string) => { try { return JSON.parse(fs.readFileSync(file, "utf8")).workOrchestrator?.designModel; } catch { return undefined; } };
	return setting(path.join(cwd, ".pi", "settings.json")) ?? setting(path.join(agent, "settings.json"));
}

// The hub's own CLI, like hub-command.ts's hubCli (not imported: its menu imports need Pi's packages).
const HUB_CLI = fileURLToPath(new URL("../hub/src/cli.ts", import.meta.url));
const hubCall = (args: string[]) => new Promise<{ ok: boolean; text: string }>(resolve => execFile(process.execPath, ["--no-warnings", HUB_CLI, ...args], { timeout: 120_000, windowsHide: true }, (error, stdout, stderr) =>
	resolve({ ok: !error, text: `${stdout}\n${stderr}`.trim() || String(error?.message ?? "") })));
// ask: one choice from items (the tool draws it with ask-user's list dialog); undefined when dismissed.
// text: one line from the user (askText); undefined when dismissed.
type Tools = { hub: typeof hubCall; ask?: (title: string, purpose: string, items: { value: string; label: string }[]) => Promise<string | undefined>; text?: (title: string) => Promise<string | undefined> };

/** The first message of a new design session: what to build, from what, and where. */
function buildPrompt(item: Session) {
	return `${item.brief ?? ""}\n\nDirection for this design (${item.handle}, ${item.kind}): ${item.direction}\n${item.inputs.length ? `\nRead these project files first (read only; keep their real copy and content): ${item.inputs.join(", ")}\n` : ""}\nBuild the design now: write its files into ${designFolder(item.handle)}/ (index.html first). The user watches it appear beside this chat.`;
}

async function start(cwd: string, args, hub: Tools["hub"]) {
	const brief = text(args.brief, "brief", 60_000);
	const directions = Array.isArray(args.directions) ? args.directions.map((item, index) => text(item, `direction ${index + 1}`, 4_000)) : [];
	if (directions.length < 1 || directions.length > 6) throw new Error("Give 1-6 directions: one design session each.");
	// The session list shows these: a cut-down direction or brief made unreadable rows ("Refined design-2 (…").
	const names = Array.isArray(args.names) ? args.names.map(name => short(String(name ?? ""), 40)) : [];
	if (names.length !== directions.length || names.some(name => !name)) throw new Error("Give names: one short name per direction for the session list, e.g. Calm, Bold editorial (never design-N).");
	const title = short(text(args.title, "title (a few words naming what is designed, e.g. Home page)", 400), 60);
	const kind: Kind = KINDS.includes(args.kind) ? args.kind : "web";
	const inputs: string[] = [], skipped: string[] = [];
	for (const file of Array.isArray(args.inputs) ? args.inputs.map(String).slice(0, 30) : []) {
		try { if (!fs.statSync(confined(cwd, file)).isFile()) throw new Error("not a file"); inputs.push(file); } catch (error) { skipped.push(`${file} (${error.message})`); }
	}
	const items = await change(cwd, store => directions.map((direction, index) => {
		const item: Session = { handle: `design-${store.next++}`, direction, name: names[index], title, brief, kind, inputs, references: [], from: process.env.PI_HUB_SESSION, created: Date.now() };
		store.sessions.push(item);
		fs.mkdirSync(confined(cwd, designFolder(item.handle)), { recursive: true });
		return item;
	}));
	const opened = [];
	for (const item of items) opened.push(await openSession(cwd, item, hub, buildPrompt(item)));
	return { sessions: opened, skipped: skipped.length ? skipped : undefined };
}

/** A hub Pi session for one handle, in the same folder; first is its first message (it starts the agent's work). */
async function openSession(cwd: string, item: Session, hub: Tools["hub"], first: string) {
	if (item.hubSessionId) return item;
	const made = await hub(["new", cwd, item.name ?? item.handle]);
	const id = made.ok ? made.text.match(/\/s\/([0-9a-f-]{36})\//)?.[1] : undefined;
	if (!id) return change(cwd, store => Object.assign(session(store, item.handle), { hubError: `no hub session (is pi-control-hub running?): ${clip(made.text, 300)}` }));
	const saved = await change(cwd, store => Object.assign(session(store, item.handle), { hubSessionId: id, hubError: undefined }));
	if (subtitleOf(saved)) await hub(["subtitle", id, subtitleOf(saved)]); // cosmetic: a failure leaves the row without its title
	const told = await hub(["prompt", id, first]);
	if (!told.ok) return change(cwd, store => Object.assign(session(store, item.handle), { hubError: `hub session made, first message failed: ${clip(told.text, 300)}` }));
	return saved;
}
/** open: a hub session for a handle that has none; it continues the design when files are there, else builds it. */
function reopenPrompt(cwd: string, item: Session) {
	return readTree(confined(cwd, designFolder(item.handle))).size
		? `You are design session ${item.handle} (${item.name ?? item.handle}), direction: ${item.direction}. Its files are in ${designFolder(item.handle)}/ and show beside this chat. Wait for the user's next request; reply in one line.`
		: buildPrompt(item);
}

/** A folder's files as relative "/" paths with their bytes (symlinks are skipped). */
export function readTree(dir: string) {
	const out = new Map<string, Buffer>();
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
		const full = path.join(entry.parentPath, entry.name);
		out.set(path.relative(dir, full).split(path.sep).join("/"), fs.readFileSync(full));
	}
	return out;
}
const delta = (before: Map<string, Buffer>, after: Map<string, Buffer>): Changes => ({
	added: [...after.keys()].filter(file => !before.has(file)).sort(),
	changed: [...after.keys()].filter(file => before.has(file) && !before.get(file)!.equals(after.get(file)!)).sort(),
	removed: [...before.keys()].filter(file => !after.has(file)).sort(),
});
/** Makes root hold exactly files: writes new and changed ones, deletes the rest. Returns what changed. */
function syncTree(cwd: string, root: string, files: Map<string, Buffer>) {
	const changes = delta(readTree(confined(cwd, root)), files);
	for (const file of [...changes.added, ...changes.changed]) atomic(confined(cwd, `${root}/${file}`), files.get(file)!);
	for (const file of changes.removed) fs.rmSync(confined(cwd, `${root}/${file}`), { force: true }); // shortcut: empty folders stay; prune them if they clutter
	return changes;
}
// D5: versions. .pi/designs/history/<handle>/<n>/ holds the folder as it was after a turn that changed it (the newest 30 kept).
const KEEP = 30;
const historyFolder = (handle: string) => `.pi/designs/history/${handle}`;
/** The kept version numbers of a design, oldest first. */
export function versions(cwd: string, handle: string) {
	const dir = confined(cwd, historyFolder(handle));
	return fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => /^\d+$/.test(name)).map(Number).sort((a, b) => a - b) : [];
}
const same = (a: Map<string, Buffer>, b: Map<string, Buffer>) => a.size === b.size && [...a].every(([file, bytes]) => b.get(file)?.equals(bytes));
/**
 * The one snapshot boundary (agent_end, select and restore call it): copies the design folder to the next version unless it
 * equals the newest one, and returns the version that now holds exactly the folder (0 while the folder is empty).
 */
export function snapshot(cwd: string, handle: string) {
	return withPlanLock(confined(cwd, historyFolder(handle)), () => {
		const files = readTree(confined(cwd, designFolder(handle))), kept = versions(cwd, handle), newest = kept.at(-1) ?? 0;
		if (!files.size) return newest;
		if (newest && same(files, readTree(confined(cwd, `${historyFolder(handle)}/${newest}`)))) return newest;
		syncTree(cwd, `${historyFolder(handle)}/${newest + 1}`, files);
		for (const old of kept.slice(0, Math.max(0, kept.length + 1 - KEEP))) fs.rmSync(confined(cwd, `${historyFolder(handle)}/${old}`), { recursive: true, force: true });
		return newest + 1;
	});
}
/** D19: version n back into the design folder as a new version; pending edits are kept first as their own version. */
async function restore(cwd: string, handle: string, version) {
	const item = session(load(cwd), handle), n = Number(version);
	if (!versions(cwd, item.handle).includes(n)) throw new Error(`${item.handle} has no version ${version}; kept: ${versions(cwd, item.handle).join(", ") || "none"}.`);
	await snapshot(cwd, item.handle);
	syncTree(cwd, designFolder(item.handle), readTree(confined(cwd, `${historyFolder(item.handle)}/${n}`)));
	return { handle: item.handle, restored: n, version: await snapshot(cwd, item.handle) };
}
/** D9: a design session writes only inside its own folder and the shared references; undefined when the path is allowed. */
export function writeRefusal(cwd: string, handle: string, file: string) {
	const target = path.resolve(cwd, file), inside = (dir: string) => { const rel = path.relative(path.resolve(cwd, dir), target); return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel); };
	if (inside(designFolder(handle)) || inside(".pi/designs/references")) return undefined;
	return `Design session ${handle} writes only inside ${designFolder(handle)}/ (and .pi/designs/references/); ${file} is outside it. The chosen design is built in a normal session after select.`;
}

/** One session's design folder: its files and first page. */
function show(cwd: string, handle: string) {
	const item = session(load(cwd), handle), root = designFolder(item.handle), files = [...readTree(confined(cwd, root)).keys()].sort();
	const page = files.includes("index.html") ? "index.html" : files.find(file => file.endsWith(".html"));
	return { handle: item.handle, name: item.name, kind: item.kind, folder: root, files, page, versions: versions(cwd, item.handle) };
}
function status(cwd: string, handle?: string) {
	const items = handle ? [session(load(cwd), handle)] : load(cwd).sessions;
	return items.map(item => ({ ...item, brief: undefined, files: readTree(confined(cwd, designFolder(item.handle))).size }));
}
const slug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
/** Q-01: the folder whose DESIGN.json names this handle (kept after a rename), else a free slug of the name (-2, -3 on a clash). */
function exportFolder(cwd: string, item: Session) {
	const base = confined(cwd, "docs/designs"), dirs = fs.existsSync(base) ? fs.readdirSync(base) : [];
	const owner = (dir: string) => { try { return JSON.parse(fs.readFileSync(path.join(base, dir, "DESIGN.json"), "utf8")).handle; } catch { return undefined; } };
	const own = dirs.find(dir => owner(dir) === item.handle);
	if (own) return own;
	const stem = slug(item.name ?? "") || item.handle;
	for (let n = 1; ; n++) if (!fs.existsSync(path.join(base, n === 1 ? stem : `${stem}-${n}`))) return n === 1 ? stem : `${stem}-${n}`;
}
/**
 * R7: the design folder into docs/designs/<name>/ (never a folder another handle or the user owns), starred, and handed to
 * the starting session (offered only while the hub has it) or a new one. D10: a reselect lists what changed since the last
 * selection, kept in .pi/designs/selected/<handle>/ (the one before it in <handle>.before/ for git diff --no-index).
 */
async function select(cwd: string, handle: string, tools: Tools) {
	const item = session(load(cwd), handle), version = await snapshot(cwd, item.handle);
	if (!version) throw new Error(`${item.handle} has no design files yet.`);
	const files = readTree(confined(cwd, `${historyFolder(item.handle)}/${version}`)); // the immutable version, not a folder the agent may still write
	const dir = exportFolder(cwd, item), root = `docs/designs/${dir}`, copy = `.pi/designs/selected/${item.handle}`, before = `${copy}.before`;
	const previous = readTree(confined(cwd, copy)), changes = previous.size ? delta(previous, files) : undefined;
	const owned = Buffer.from(`${JSON.stringify({ handle: item.handle, name: item.name, version }, null, "\t")}\n`);
	syncTree(cwd, root, new Map([...files, ["DESIGN.json", owned]]));
	fs.rmSync(confined(cwd, before), { recursive: true, force: true });
	if (previous.size) fs.renameSync(confined(cwd, copy), confined(cwd, before));
	syncTree(cwd, copy, files);
	const saved = await change(cwd, store => Object.assign(session(store, item.handle), { selected: true }));
	if (saved.hubSessionId) await tools.hub(["subtitle", saved.hubSessionId, subtitleOf(saved)]);
	const name = saved.name ?? saved.handle, list = (label: string, items: string[]) => items.length ? `${label}: ${items.join(", ")}` : "";
	const message = changes
		? `Design ${name} (${saved.handle}) was selected again: ${root}/ now holds the new version. Since the last selection: ${[list("added", changes.added), list("changed", changes.changed), list("removed", changes.removed)].filter(Boolean).join("; ") || "no file changed"}. See the lines with git diff --no-index ${before} ${root}, then update the implementation to match.`
		: `Design ${name} (${saved.handle}) was selected for implementation: ${root}/ (index.html first, ${files.size} file${files.size === 1 ? "" : "s"}). Compare it with the current code, then write the implementation plan with /plan3.`;
	// D2: the starting session only while the hub still has it.
	const found = saved.from ? await tools.hub(["session", saved.from]) : undefined;
	let starting: { name?: string } | undefined;
	try { starting = found?.ok ? JSON.parse(found.text) : undefined; } catch { starting = undefined; }
	const items = [...starting ? [{ value: "start", label: `The starting session: ${starting.name ?? saved.from}` }] : [], { value: "new", label: "A new session" }];
	const where = await tools.ask?.(`Implement ${name} where?`, `Exported to ${root}/.`, items);
	let target: string | undefined, sent: string;
	if (where === "start") target = saved.from;
	else if (where === "new") {
		const made = await tools.hub(["new", cwd, `Build ${name}`]);
		target = made.ok ? made.text.match(/\/s\/([0-9a-f-]{36})\//)?.[1] : undefined;
		if (!target) sent = `no new session (is pi-control-hub running?): ${clip(made.text, 300)}`;
	}
	if (!where) sent = "not sent: no session was chosen; pass the message on yourself";
	else if (target && target === process.env.PI_HUB_SESSION) sent = "this session: act on the message now";
	else if (target) {
		if (where === "start") await tools.hub(["wake", target]); // parked sessions take no prompt
		const told = await tools.hub(["prompt", target, message]);
		sent = told.ok ? `sent to ${where === "start" ? starting?.name ?? target : `Build ${name}`}` : `not sent: ${clip(told.text, 300)}`;
	}
	return { handle: saved.handle, name, version, folder: `${root}/`, files: [...files.keys()].sort(), changes, implement: where ?? "none", sent: sent!, message };
}
/** D12: another approach from this design: a new handle with a copy of its folder, and a hub session forked from this one (its chat so far). */
async function clone(cwd: string, handle: string, args, tools: Tools) {
	const source = session(load(cwd), handle);
	const given = typeof args.name === "string" && args.name.trim() ? args.name : await tools.text?.(`Name the copy of ${source.name ?? source.handle}`);
	const name = short(text(given, "name", 200), 40);
	const item = await change(cwd, store => {
		const added: Session = { ...structuredClone(source), handle: `design-${store.next++}`, name, selected: undefined, hubSessionId: undefined, hubError: undefined, created: Date.now() };
		store.sessions.push(added);
		return added;
	});
	const copied = [...syncTree(cwd, designFolder(item.handle), readTree(confined(cwd, designFolder(source.handle)))).added];
	const first = `You are now design session ${item.handle} (${name}), a copy of ${source.handle} (${source.name ?? source.handle}): ${designFolder(item.handle)}/ holds a copy of its files, and the chat above was ${source.handle}'s. From now on write only into ${designFolder(item.handle)}/. Reply in one line.`;
	if (!source.hubSessionId) return { ...await openSession(cwd, item, tools.hub, first), copied };
	const made = await tools.hub(["fork", source.hubSessionId, name]);
	const id = made.ok ? made.text.match(/\/s\/([0-9a-f-]{36})\//)?.[1] : undefined;
	if (!id) return { ...await change(cwd, store => Object.assign(session(store, item.handle), { hubError: `no forked hub session: ${clip(made.text, 300)}` })), copied };
	const saved = await change(cwd, store => Object.assign(session(store, item.handle), { hubSessionId: id }));
	if (subtitleOf(saved)) await tools.hub(["subtitle", id, subtitleOf(saved)]);
	const told = await tools.hub(["prompt", id, first]);
	if (!told.ok) return { ...await change(cwd, store => Object.assign(session(store, item.handle), { hubError: `forked, first message failed: ${clip(told.text, 300)}` })), copied };
	return { ...saved, copied };
}

export async function runDesign(cwd: string, args, tools: Tools = { hub: hubCall }) {
	const handle = args.handle ?? ownSession(cwd)?.handle;
	if (args.action === "start") return start(cwd, args, tools.hub);
	if (args.action === "status") return status(cwd, args.handle);
	if (args.action === "open") { const item = session(load(cwd), handle); return [await openSession(cwd, item, tools.hub, reopenPrompt(cwd, item))]; }
	if (args.action === "select") return select(cwd, handle, tools);
	if (args.action === "clone") return [await clone(cwd, handle, args, tools)];
	if (args.action === "show") return show(cwd, handle);
	if (args.action === "restore") return restore(cwd, handle, args.version);
	throw new Error("action is start, status, open, show, restore, select or clone.");
}
/** This Pi's own design session, when the hub started it for one (PI_HUB_SESSION is the hub's id for it). */
export function ownSession(cwd: string) {
	const id = process.env.PI_HUB_SESSION;
	try { return id ? load(cwd).sessions.find(item => item.hubSessionId === id) : undefined; } catch { return undefined; }
}

const DESIGN_ROLE = (item: Session) => `You are design session ${item.handle} (${item.name ?? item.handle}): you build this one design yourself (${item.kind}, direction: ${item.direction}). Write its files only into ${designFolder(item.handle)}/ (index.html first, one HTML file per screen, shared styles.css). The page shows the design live beside this chat (reloaded when files change), so never describe it at length and never post links or file paths to view it: the user is looking at it. After a change, reply in a line or two with what you changed. When the user picks this design ("select this", "use it"), call design {action:"select"}: it exports, stars it and asks the user where to implement it. To try a different approach without losing this one, call design {action:"clone", name} (ask the user for a name when they gave none).`;

export default function designExtension(pi) {
	let self: Session | undefined, modelSet = false;
	pi.registerTool?.({
		name: "design", label: "Design", exposure: "deferred",
		description: "Design sessions: each design is a folder .pi/designs/<handle>/ built by its own hub Pi session. start: one design session per direction (the same brief: project description, the current interface with real copy, what the user wants changed; source files in inputs; kind web, app or deck), returns handles design-N; each opens its own hub Pi session named after its direction (names) with the brief's title below, whose agent builds the design while the user watches and refines it there; do not approve, repair or refine for them. status: every session, its files and hub session. open: open the hub session of a handle that has none. show (inside a design session, handle defaults to it): its files and kept versions. restore (when the user asks, e.g. \"Restore version 2\"): copies that version back; it becomes the newest version and nothing is lost. select (when the user picks one, e.g. \"@design-2\", or \"select this\" inside its session): exports its files to docs/designs/<name>/, stars it and asks the user where to implement it (the session it was started from, or a new one), which gets a message naming the folder; selecting again updates the same folder and lists what changed. clone (to try another approach): a new handle with a copy of this design's files and a hub session forked from this one (name: the copy's name).",
		promptSnippet: "Design sessions: start variants built live in the hub, select one for implementation",
		parameters: { type: "object", additionalProperties: false, required: ["action"], properties: {
			action: { type: "string", enum: ["start", "status", "open", "show", "restore", "select", "clone"] },
			version: { type: "number", description: "restore: the version to bring back (it becomes the newest version)" },
			name: { type: "string", description: "clone: the copy's name for the session list (asked when missing)" },
			brief: { type: "string", description: "start: the design brief" },
			directions: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "start: one direction per session" },
			names: { type: "array", items: { type: "string" }, maxItems: 6, description: "start (required): a short name per direction for the session list, e.g. Calm, Bold editorial (never design-N), no default: the direction's first words" },
			title: { type: "string", description: "start (required): a few words naming what is designed, shown under each name, e.g. Home page" },
			kind: { type: "string", enum: KINDS, description: "start: web (pages), app (screens of an application) or deck (slides); default web" },
			inputs: { type: "array", items: { type: "string" }, description: "start: project-relative source files the design session should read first" },
			handle: { type: "string", description: "design-N (in a design session: defaults to it)" },
		} },
		async execute(_id, args, signal, _update, ctx) {
			const ask: Tools["ask"] = async (title, purpose, items) => {
				const { showListDialog } = await import("./ask-user/menu.ts"); // loaded on use: it pulls in the dialog stack
				return (await showListDialog(ctx, { title, purpose, compact: true, filter: false, items, signal }))?.value;
			};
			const askName = async (title: string) => (await import("./ask-user/menu.ts")).askText(ctx, pi, title);
			const result = await runDesign(ctx.cwd, args, { hub: hubCall, ask, text: askName });
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	});
	// A design session: its model (workOrchestrator.designModel), its role and a hub badge.
	pi.on?.("session_start", (_event, ctx) => { self = ownSession(ctx.cwd); });
	pi.on?.("input", async (_event, ctx) => {
		const was = self;
		self = ownSession(ctx.cwd) ?? self;
		if (self && !was) pi.events?.emit?.("wo:modes-changed", {});
		if (!self || modelSet) return;
		modelSet = true;
		const [ref, level] = String(designModelSetting(ctx.cwd) ?? "").split(":"), slash = ref.indexOf("/");
		const model = slash > 0 ? ctx.modelRegistry?.find?.(ref.slice(0, slash), ref.slice(slash + 1)) : undefined;
		if (model) await pi.setModel?.(model);
		if (model && level) pi.setThinkingLevel?.(level);
	});
	pi.on?.("before_agent_start", event => {
		if (!self) return;
		const sections = event?.systemPromptOptions?.sections;
		if (sections && typeof sections === "object") { sections.design = DESIGN_ROLE(self); return; }
		return { systemPrompt: `${event.systemPrompt ?? ""}\n\n${DESIGN_ROLE(self)}` };
	});
	pi.events?.on?.("wo:web-info", info => { if (self) info.design = self.handle; });
	pi.on?.("tool_call", (event, ctx) => {
		if (!self || !["write", "edit"].includes(event?.toolName)) return;
		const reason = writeRefusal(ctx.cwd, self.handle, String(event.input?.path ?? ""));
		return reason ? { block: true, reason } : undefined;
	});
	// D5: every turn that changed the design becomes a version.
	pi.on?.("agent_end", async (_event, ctx) => { if (self) await snapshot(ctx.cwd, self.handle).catch(() => {}); }); // shortcut: a failed copy skips one version; report it if versions go missing
}
