// design: OpenDesign sessions. N variants = N OD projects (OD's start_run cannot target a conversation, so one
// project = one conversation = one session). Each handle (design-1, design-2, ...) also gets its own hub Pi session,
// named by its direction, where the user chats from anywhere: each message becomes an OD run, and each ended run is
// mirrored to .pi/designs/<handle>/, which the hub's design page previews live. select exports it to docs/designs/<name>/
// and hands it to the starting session or a new one.
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allowCloneWrites, callOpenDesignTool, closePersistentOpenDesignClients, normalizeOpenDesignCommandSpec, normalizeOpenDesignUrl, readOpenDesignApi, reconcileCreatedProject, redactOpenDesignText, validateOpenDesignToolCall } from "./opendesign-client.ts";
import { atomic, confined, withPlanLock } from "./plan3-files.ts";

type Changes = { added: string[]; changed: string[]; removed: string[] };
// name: the hub row's name (the direction, short); title: its second line (the brief); from: the hub session that started it.
type Session = { handle: string; projectId: string; conversationId?: string; direction: string; name?: string; title?: string; from?: string; mirroredRun?: string; changes?: Changes; selected?: boolean; prompt?: string; requestId?: string; runId?: string; runStarted?: number; status?: string; studioUrl?: string; error?: string; hubSessionId?: string; hubError?: string; created: number };
type Store = { version: 1; next: number; sessions: Session[] };
const FILE = ".pi/designs/sessions.json";
const MAX_INPUT = 200_000, MAX_PICK = 100_000_000;

const storeFile = (cwd: string) => confined(cwd, FILE);
function load(cwd: string): Store {
	if (!fs.existsSync(storeFile(cwd))) return { version: 1, next: 1, sessions: [] };
	let store;
	try { store = JSON.parse(fs.readFileSync(storeFile(cwd), "utf8")); } catch (cause) { throw new Error(`${FILE} is unreadable; fix or delete it.`, { cause }); }
	if (store?.version !== 1 || !Array.isArray(store.sessions)) throw new Error(`${FILE} is not a design session list.`);
	return store;
}
/** Read-modify-write the store under one lock (Pi sessions and the watcher share it). */
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
/** "building 3 min" while the session's OpenDesign run is queued or running, else "". */
export function building(item: Session | undefined) {
	if (!item || !["queued", "running"].includes(item.status ?? "")) return "";
	const started = item.runStarted && item.runStarted > 1e12 ? item.runStarted : 0; // ms since 1970; anything else is not a time
	return `${item.status === "queued" ? "queued" : "building"}${started ? ` ${Math.max(0, Math.floor((Date.now() - started) / 60_000))} min` : ""}`;
}
const subtitleOf = (item: Session) => [building(item), `${item.selected ? "★ " : ""}${item.title ?? ""}`.trim()].filter(Boolean).join(" · ");
function text(value, label: string, max: number) {
	if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > max) throw new Error(`${label} must be non-empty text up to ${max} bytes.`);
	return value.trim();
}

function commandSpec(cwd: string) {
	const agent = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
	const setting = (file: string) => { try { return JSON.parse(fs.readFileSync(file, "utf8")).workOrchestrator?.openDesignCommand; } catch { return undefined; } };
	const spec = setting(path.join(cwd, ".pi", "settings.json")) ?? setting(path.join(agent, "settings.json"));
	return spec ? normalizeOpenDesignCommandSpec(spec) : undefined;
}
/** workOrchestrator.designModel, "provider/id:effort": project setting first, then global. */
function designModelSetting(cwd: string) {
	const agent = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
	const setting = (file: string) => { try { return JSON.parse(fs.readFileSync(file, "utf8")).workOrchestrator?.designModel; } catch { return undefined; } };
	return setting(path.join(cwd, ".pi", "settings.json")) ?? setting(path.join(agent, "settings.json"));
}
export function openDesign(cwd: string, signal?: AbortSignal) {
	const options = { commandSpec: commandSpec(cwd), signal, keepAlive: true };
	return {
		call: (tool: string, args) => callOpenDesignTool({ ...options, tool, args }),
		api: (apiPath: string, as?: string) => readOpenDesignApi(options, apiPath, as),
	};
}
type OD = ReturnType<typeof openDesign>;

// The hub's own CLI, like hub-command.ts's hubCli (not imported: its menu imports need Pi's packages).
const HUB_CLI = fileURLToPath(new URL("../hub/src/cli.ts", import.meta.url));
const hubCall = (args: string[]) => new Promise<{ ok: boolean; text: string }>(resolve => execFile(process.execPath, ["--no-warnings", HUB_CLI, ...args], { timeout: 120_000, windowsHide: true }, (error, stdout, stderr) =>
	resolve({ ok: !error, text: `${stdout}\n${stderr}`.trim() || String(error?.message ?? "") })));
// ask: one choice from items (the tool draws it with ask-user's list dialog); undefined when dismissed.
// text: one line from the user (askText); undefined when dismissed.
type Tools = { hub: typeof hubCall; ask?: (title: string, purpose: string, items: { value: string; label: string }[]) => Promise<string | undefined>; text?: (title: string) => Promise<string | undefined> };

// OD's agent cannot read this repository: source files go along as read-only inputs/<hash>-<name> copies.
async function upload(cwd: string, od: OD, projectId: string, files: string[]) {
	const sent: string[] = [], skipped: string[] = [];
	for (const file of files) {
		try {
			const bytes = fs.readFileSync(confined(cwd, file));
			if (bytes.length > MAX_INPUT) throw new Error("over 200 KB");
			const remote = `inputs/${crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16)}-${path.basename(file).replace(/[^A-Za-z0-9._-]/g, "_").slice(-80)}`;
			await od.call("write_file", validateOpenDesignToolCall("write_file", { project: projectId, path: remote, content: bytes.toString("base64"), encoding: "base64" }));
			sent.push(`${file} -> ${remote}`);
		} catch (error) {
			if (error?.category && !["invalid-input", "credentials-forbidden"].includes(error.category)) throw error;
			skipped.push(`${file} (${error.message})`);
		}
	}
	return { sent, skipped };
}
async function run(cwd: string, od: OD, item: Session, fresh: boolean, prompt = item.prompt) {
	// The same requestId repeats a start whose answer was lost (OD dedupes it); a retry after a finished run is a new request.
	const requestId = fresh || !item.requestId ? crypto.randomUUID() : item.requestId;
	await change(cwd, store => Object.assign(session(store, item.handle), { requestId, error: undefined }));
	try {
		const result = await od.call("start_run", { project: item.projectId, prompt, requestId });
		if (!result?.runId || result.projectId && result.projectId !== item.projectId) throw new Error("OpenDesign start identity mismatch.");
		return change(cwd, store => Object.assign(session(store, item.handle), { runId: String(result.runId), status: "queued", studioUrl: normalizeOpenDesignUrl(result.studioUrl) || item.studioUrl }));
	} catch (error) {
		return change(cwd, store => Object.assign(session(store, item.handle), { error: redactOpenDesignText(error.message, 500) }));
	}
}

async function start(cwd: string, od: OD, args, hub: Tools["hub"]) {
	const brief = text(args.brief, "brief", 60_000);
	const directions = Array.isArray(args.directions) ? args.directions.map((item, index) => text(item, `direction ${index + 1}`, 4_000)) : [];
	if (directions.length < 1 || directions.length > 6) throw new Error("Give 1-6 directions: one OpenDesign session each.");
	const inputs = Array.isArray(args.inputs) ? args.inputs.map(String).slice(0, 30) : [];
	// The session list shows these: a cut-down direction or brief made unreadable rows ("Refined design-2 (…").
	const names = Array.isArray(args.names) ? args.names.map(name => short(String(name ?? ""), 40)) : [];
	if (names.length !== directions.length || names.some(name => !name)) throw new Error("Give names: one short name per direction for the session list, e.g. Calm, Bold editorial (never design-N).");
	const title = short(text(args.title, "title (a few words naming what is designed, e.g. Home page)", 400), 60);
	const handles = await change(cwd, store => directions.map((direction, index) => {
		const handle = `design-${store.next++}`;
		store.sessions.push({ handle, projectId: `${handle}-${crypto.randomUUID()}`, direction, name: names[index], title, from: process.env.PI_HUB_SESSION, created: Date.now() });
		return handle;
	}));
	const started: Session[] = [];
	for (const handle of handles) {
		let item = session(load(cwd), handle);
		try {
			const created = await reconcileCreatedProject({ callTool: od.call, projectId: item.projectId, createArgs: { id: item.projectId, name: `${path.basename(cwd)} ${handle}` } });
			if ((created.project?.id ?? created.id) !== item.projectId) throw new Error("OpenDesign project identity mismatch.");
			const { sent, skipped } = await upload(cwd, od, item.projectId, inputs);
			const prompt = `${brief}\n\nDirection for this design (${handle}): ${directions[handles.indexOf(handle)]}\n${sent.length ? `\nRead-only source copies in this project (keep their real copy and content; never write into inputs/):\n${sent.join("\n")}\n` : ""}${skipped.length ? `Not sent: ${skipped.join("; ")}\n` : ""}\nFonts: keep the source's fonts unless the brief or direction changes them; any font you add must look the same on every device (a web font or one the project already loads, never one only Windows or Mac has, such as Bahnschrift or Segoe UI).\nBuild the design now and write the files (index.html first) in this same run; do not stop after a plan or summary. Nobody answers questions during this run.`;
			item = await change(cwd, store => Object.assign(session(store, handle), { conversationId: created.conversationId ?? undefined, prompt }));
			started.push(await run(cwd, od, item, true));
		} catch (error) {
			started.push(await change(cwd, store => Object.assign(session(store, handle), { error: redactOpenDesignText(error.message, 500) })));
		}
	}
	const opened = [];
	for (const item of started) opened.push(item.error ? item : await openSession(cwd, item, hub));
	return opened;
}

/** A hub Pi session for one handle, in the same folder; its first message tells it what it is. */
async function openSession(cwd: string, item: Session, hub: Tools["hub"]) {
	if (item.hubSessionId) return item;
	const made = await hub(["new", cwd, item.name ?? item.handle]);
	const id = made.ok ? made.text.match(/\/s\/([0-9a-f-]{36})\//)?.[1] : undefined;
	if (!id) return change(cwd, store => Object.assign(session(store, item.handle), { hubError: `no hub session (is pi-control-hub running?): ${redactOpenDesignText(made.text.replace(/token=\w+/g, "token=…"), 300)}` }));
	const saved = await change(cwd, store => Object.assign(session(store, item.handle), { hubSessionId: id, hubError: undefined }));
	if (subtitleOf(saved)) await hub(["subtitle", id, subtitleOf(saved)]); // cosmetic: a failure leaves the row without its brief
	const told = await hub(["prompt", id, `You are design session ${item.handle} (${saved.name ?? item.handle}): OpenDesign project ${item.projectId}, direction: ${item.direction}. ${item.runId && ["queued", "running"].includes(item.status ?? "") ? "Its first run is going; you will be told when it ends." : "Call design show to see where it stands."} Reply in one line.`]);
	if (!told.ok) return change(cwd, store => Object.assign(session(store, item.handle), { hubError: `hub session made, first message failed: ${redactOpenDesignText(told.text, 300)}` }));
	return saved;
}

/** Each session's newest run in its project: OD continues by itself and the user chats in the OD app. */
async function refresh(cwd: string, od: OD, item: Session) {
	try {
		const runs = (await od.api(`/api/runs?projectId=${encodeURIComponent(item.projectId)}`))?.runs;
		const newest = (Array.isArray(runs) ? runs : []).filter(run => run?.projectId === item.projectId && typeof run.id === "string").sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))[0];
		if (!newest) return item;
		return await change(cwd, store => Object.assign(session(store, item.handle), { runId: newest.id, status: String(newest.status ?? "unknown"), runStarted: Number(newest.createdAt) || undefined, conversationId: item.conversationId ?? newest.conversationId }));
	} catch (error) {
		return { ...item, error: `cannot read OpenDesign runs: ${redactOpenDesignText(error.message, 300)}` };
	}
}
async function pages(od: OD, item: Session) {
	const files = (await od.api(`/api/projects/${encodeURIComponent(item.projectId)}/files`))?.files;
	return (Array.isArray(files) ? files : []).filter(file => file?.type === "file" && typeof file.path === "string" && !file.path.startsWith("inputs/"));
}
async function status(cwd: string, od: OD, handle?: string) {
	const items = handle ? [session(load(cwd), handle)] : load(cwd).sessions;
	return Promise.all(items.map(async item => {
		const current = await refresh(cwd, od, item);
		const made = current.runId && !current.error ? (await pages(od, current).catch(() => undefined))?.map(file => file.path) : undefined;
		return { ...current, prompt: undefined, requestId: undefined, files: made, nothingMade: made?.length === 0 && ["succeeded", "failed"].includes(current.status) || undefined };
	}));
}

const conversationText = messages => messages.map(message => `## ${message.role === "user" ? "User" : "OpenDesign"}${message.runId ? ` (run ${message.runId}, ${message.runStatus ?? "?"})` : ""}\n\n${String(message.content ?? "").trim() || "(no text)"}`).join("\n\n");
async function add(cwd: string, od: OD, projectId: string) {
	const id = text(projectId, "project", 200);
	const project = await od.call("get_project", { project: id });
	if ((project?.project?.id ?? project?.id) !== id) throw new Error(`OpenDesign has no project ${id}.`);
	const item = await change(cwd, store => {
		const known = store.sessions.find(entry => entry.projectId === id);
		if (known) return known;
		const added = { handle: `design-${store.next++}`, projectId: id, direction: "added from an existing OpenDesign project", created: Date.now() };
		store.sessions.push(added);
		return added;
	});
	return refresh(cwd, od, item);
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
const ended = (item: Session) => Boolean(item.runId) && !["queued", "running"].includes(item.status ?? "");
/** D7: an ended run's files into .pi/designs/<handle>/. Everything is fetched first, so a failed fetch keeps the old
 * mirror; then files are replaced one by one (the folder stays, so the hub's watcher keeps seeing it) and removed ones deleted. */
async function mirror(cwd: string, od: OD, item: Session, list?: Awaited<ReturnType<typeof pages>>) {
	const root = `.pi/designs/${item.handle}`, fetched = new Map<string, Buffer>();
	let total = 0;
	for (const file of list ?? await pages(od, item)) {
		confined(cwd, `${root}/${file.path}`); // OD's file names are untrusted: refuse escapes before fetching
		const bytes = Buffer.from(await od.api(`/api/projects/${encodeURIComponent(item.projectId)}/files/${file.path.split("/").map(encodeURIComponent).join("/")}`, "bytes"));
		if ((total += bytes.length) > MAX_PICK) throw new Error("The design is over 100 MB; open it in the OpenDesign app instead.");
		fetched.set(file.path, bytes);
	}
	// A project with no files keeps what was mirrored: nothing to show is not a reason to clear the preview.
	const changes = fetched.size ? syncTree(cwd, root, fetched) : { added: [], changed: [], removed: [] };
	return change(cwd, store => Object.assign(session(store, item.handle), { mirroredRun: item.runId, changes }));
}
/** Mirror a run that ended while nobody looked (parked session, run started in the OpenDesign app). */
const catchUp = async (cwd: string, od: OD, item: Session) => !item.error && ended(item) && item.runId !== item.mirroredRun ? mirror(cwd, od, item) : item;
/** The newest result of one session: mirrored if needed, with what the last mirrored run changed. */
async function show(cwd: string, od: OD, handle: string) {
	const item = await catchUp(cwd, od, await refresh(cwd, od, session(load(cwd), handle)));
	const root = `.pi/designs/${item.handle}`, files = [...readTree(confined(cwd, root)).keys()].sort();
	const page = files.includes("index.html") ? "index.html" : files.find(file => file.endsWith(".html"));
	return { handle: item.handle, name: item.name, runId: item.runId, status: item.status, error: item.error, folder: root, files, changes: item.changes, page };
}
/** OpenDesign's chat and comments for the export (what the user asked for, beside what it made). */
async function notes(od: OD, item: Session) {
	const out = new Map<string, Buffer>();
	const conversationId = item.conversationId ?? (await od.api(`/api/projects/${encodeURIComponent(item.projectId)}/conversations`))?.conversations?.[0]?.id;
	if (!conversationId) return out;
	const base = `/api/projects/${encodeURIComponent(item.projectId)}/conversations/${encodeURIComponent(conversationId)}`;
	out.set("CONVERSATION.md", Buffer.from(`# ${item.name ?? item.handle} conversation in OpenDesign\n\n${conversationText((await od.api(`${base}/messages`))?.messages ?? [])}\n`));
	const comments = (await od.api(`${base}/comments`).catch(() => undefined))?.comments;
	if (comments?.length) out.set("COMMENTS.json", Buffer.from(JSON.stringify(comments, null, "\t")));
	return out;
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
 * R7: the mirrored design into docs/designs/<name>/ (never a folder another handle or the user owns), starred, and handed to
 * the starting session (offered only while the hub has it) or a new one. D10: a reselect lists what changed since the last
 * selection, kept in .pi/designs/selected/<handle>/ (the one before it in <handle>.before/ for git diff --no-index).
 */
async function select(cwd: string, od: OD, handle: string, tools: Tools) {
	const item = await catchUp(cwd, od, await refresh(cwd, od, session(load(cwd), handle)));
	if (["queued", "running"].includes(item.status ?? "")) throw new Error(`${item.handle} is still running in OpenDesign; select it when the run ends.`);
	const files = readTree(confined(cwd, `.pi/designs/${item.handle}`));
	if (!files.size) throw new Error(`${item.handle} has no design files yet; wait for its first run.`);
	const dir = exportFolder(cwd, item), root = `docs/designs/${dir}`, copy = `.pi/designs/selected/${item.handle}`, before = `${copy}.before`;
	const previous = readTree(confined(cwd, copy)), changes = previous.size ? delta(previous, files) : undefined;
	const owned = Buffer.from(`${JSON.stringify({ handle: item.handle, name: item.name, project: item.projectId, run: item.runId }, null, "\t")}\n`);
	syncTree(cwd, root, new Map([...files, ...await notes(od, item).catch(() => new Map<string, Buffer>()), ["DESIGN.json", owned]]));
	fs.rmSync(confined(cwd, before), { recursive: true, force: true });
	if (previous.size) fs.renameSync(confined(cwd, copy), confined(cwd, before));
	syncTree(cwd, copy, files);
	const saved = await change(cwd, store => Object.assign(session(store, item.handle), { selected: true }));
	if (saved.hubSessionId) await tools.hub(["subtitle", saved.hubSessionId, subtitleOf(saved)]);
	const name = saved.name ?? saved.handle, list = (label: string, items: string[]) => items.length ? `${label}: ${items.join(", ")}` : "";
	const message = changes
		? `Design ${name} (${saved.handle}) was selected again: ${root}/ now holds the new version. Since the last selection: ${[list("added", changes.added), list("changed", changes.changed), list("removed", changes.removed)].filter(Boolean).join("; ") || "no file changed"}. See the lines with git diff --no-index ${before} ${root}, then update the implementation to match.`
		: `Design ${name} (${saved.handle}) was selected for implementation: ${root}/ (index.html first, ${files.size} file${files.size === 1 ? "" : "s"}, CONVERSATION.md is what the user asked OpenDesign for). Compare it with the current code, then write the implementation plan with /plan3.`;
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
		if (!target) sent = `no new session (is pi-control-hub running?): ${redactOpenDesignText(made.text.replace(/token=\w+/g, "token=…"), 300)}`;
	}
	if (!where) sent = "not sent: no session was chosen; pass the message on yourself";
	else if (target && target === process.env.PI_HUB_SESSION) sent = "this session: act on the message now";
	else if (target) {
		if (where === "start") await tools.hub(["wake", target]); // parked sessions take no prompt
		const told = await tools.hub(["prompt", target, message]);
		sent = told.ok ? `sent to ${where === "start" ? starting?.name ?? target : `Build ${name}`}` : `not sent: ${redactOpenDesignText(told.text, 300)}`;
	}
	return { handle: saved.handle, name, folder: `${root}/`, files: [...files.keys()].sort(), changes, implement: where ?? "none", sent: sent!, message };
}
/**
 * D12: another approach from this design: a new handle whose new OpenDesign project holds a copy of every file (written
 * through the clone-only validator path), its mirror copied, and a hub session forked from this one (its chat so far).
 */
async function clone(cwd: string, od: OD, handle: string, args, tools: Tools) {
	const source = await catchUp(cwd, od, await refresh(cwd, od, session(load(cwd), handle)));
	if (["queued", "running"].includes(source.status ?? "")) throw new Error(`${source.handle} is still running in OpenDesign; clone it when the run ends.`);
	const given = typeof args.name === "string" && args.name.trim() ? args.name : await tools.text?.(`Name the copy of ${source.name ?? source.handle}`);
	const name = short(text(given, "name", 200), 40);
	let item = await change(cwd, store => {
		const added: Session = { handle: `design-${store.next++}`, projectId: "", direction: source.direction, name, title: source.title, from: source.from, prompt: source.prompt, created: Date.now() };
		added.projectId = `${added.handle}-${crypto.randomUUID()}`;
		store.sessions.push(added);
		return added;
	});
	const copied: string[] = [];
	try {
		const created = await reconcileCreatedProject({ callTool: od.call, projectId: item.projectId, createArgs: { id: item.projectId, name: `${path.basename(cwd)} ${item.handle}` } });
		if ((created.project?.id ?? created.id) !== item.projectId) throw new Error("OpenDesign project identity mismatch.");
		item = await change(cwd, store => Object.assign(session(store, item.handle), { conversationId: created.conversationId ?? undefined }));
		const listed = (await od.api(`/api/projects/${encodeURIComponent(source.projectId)}/files`))?.files;
		const release = allowCloneWrites(item.projectId);
		try {
			let total = 0;
			for (const file of (Array.isArray(listed) ? listed : []).filter(entry => entry?.type === "file" && typeof entry.path === "string")) {
				const bytes = await od.api(`/api/projects/${encodeURIComponent(source.projectId)}/files/${file.path.split("/").map(encodeURIComponent).join("/")}`, "bytes");
				if ((total += bytes.length) > MAX_PICK) throw new Error("The design is over 100 MB; copy it in the OpenDesign app instead.");
				await od.call("write_file", validateOpenDesignToolCall("write_file", { project: item.projectId, path: file.path, content: bytes.toString("base64"), encoding: "base64" }));
				copied.push(file.path);
			}
		} finally { release(); }
		syncTree(cwd, `.pi/designs/${item.handle}`, readTree(confined(cwd, `.pi/designs/${source.handle}`)));
	} catch (error) {
		return { ...await change(cwd, store => Object.assign(session(store, item.handle), { error: redactOpenDesignText(error.message, 500) })), copied };
	}
	if (!source.hubSessionId) return { ...await openSession(cwd, item, tools.hub), copied };
	const made = await tools.hub(["fork", source.hubSessionId, name]);
	const id = made.ok ? made.text.match(/\/s\/([0-9a-f-]{36})\//)?.[1] : undefined;
	if (!id) return { ...await change(cwd, store => Object.assign(session(store, item.handle), { hubError: `no forked hub session: ${redactOpenDesignText(made.text.replace(/token=\w+/g, "token=…"), 300)}` })), copied };
	const saved = await change(cwd, store => Object.assign(session(store, item.handle), { hubSessionId: id }));
	if (subtitleOf(saved)) await tools.hub(["subtitle", id, subtitleOf(saved)]);
	const told = await tools.hub(["prompt", id, `You are now design session ${saved.handle} (${name}), a copy of ${source.handle} (${source.name ?? source.handle}): OpenDesign project ${saved.projectId} holds a copy of its files, and the chat above was ${source.handle}'s. Your next send starts its first run there. Reply in one line.`]);
	if (!told.ok) return { ...await change(cwd, store => Object.assign(session(store, item.handle), { hubError: `forked, first message failed: ${redactOpenDesignText(told.text, 300)}` })), copied };
	return { ...saved, prompt: undefined, copied };
}
/** One watcher pass: mirrors and reports each run that ended since the last pass (or before a restart). */
export async function checkRuns(cwd: string, od: OD, self: Session | undefined, empty: Set<string>) {
	const sessions = load(cwd).sessions, out: string[] = [];
	const running = self ? sessions.filter(item => item.handle === self.handle) : sessions.filter(item => !item.hubSessionId && (["queued", "running"].includes(item.status ?? "") || empty.has(item.runId ?? "")));
	for (const item of running) {
		const now = await refresh(cwd, od, item);
		if (now.error || !ended(now) || self && now.runId === now.mirroredRun) continue;
		const made = await pages(od, now);
		const nothing = now.status === "succeeded" && made.length === 0;
		// OD often continues a run that ended with no files with a new one: look once more before reporting it
		if (nothing && !empty.has(now.runId!)) { empty.add(now.runId!); continue; }
		empty.delete(now.runId!);
		const changes = self ? (await mirror(cwd, od, now, made)).changes! : undefined;
		const summary = changes && !nothing ? ` (${changes.added.length} added, ${changes.changed.length} changed, ${changes.removed.length} removed)` : "";
		out.push(`${now.handle}: ${now.status}${nothing ? " with no files" : ""}${summary}`);
	}
	return { ended: out, running: running.length };
}

export async function runDesign(cwd: string, args, signal?: AbortSignal, od = openDesign(cwd, signal), tools: Tools = { hub: hubCall }) {
	const handle = args.handle ?? ownSession(cwd)?.handle;
	if (args.action === "start") return start(cwd, od, args, tools.hub);
	if (args.action === "status") return status(cwd, od, args.handle);
	if (args.action === "add") return [await openSession(cwd, await add(cwd, od, args.project), tools.hub)];
	if (args.action === "open") return [await openSession(cwd, await catchUp(cwd, od, await refresh(cwd, od, session(load(cwd), handle))), tools.hub)];
	if (args.action === "select") return select(cwd, od, handle, tools);
	if (args.action === "clone") return [await clone(cwd, od, handle, args, tools)];
	if (args.action === "show") return show(cwd, od, handle);
	if (args.action === "send") {
		const message = text(args.message, "message", 20_000), item = await refresh(cwd, od, session(load(cwd), handle));
		if (["queued", "running"].includes(item.status ?? "")) throw new Error(`${item.handle} is still running in OpenDesign; send it when the run ends (you will be told).`);
		return [await run(cwd, od, item, true, `${message}\n\nWrite the changes to the files in this same run; do not stop after a plan or summary. Nobody answers questions during this run.`)];
	}
	if (args.action === "retry") {
		const item = await refresh(cwd, od, session(load(cwd), args.handle));
		if (!item.prompt) throw new Error(`${item.handle} was added from OpenDesign; retry it in the OpenDesign app.`);
		if (["queued", "running"].includes(item.status ?? "")) throw new Error(`${item.handle} is still running.`);
		return [await run(cwd, od, item, Boolean(item.runId))];
	}
	throw new Error("action is start, status, retry, add, open, send, show, select or clone.");
}
/** This Pi's own design session, when the hub started it for one (PI_HUB_SESSION is the hub's id for it). */
export function ownSession(cwd: string) {
	const id = process.env.PI_HUB_SESSION;
	try { return id ? load(cwd).sessions.find(item => item.hubSessionId === id) : undefined; } catch { return undefined; }
}

const DESIGN_GUIDE = (item: Session) => `You are design session ${item.handle}: you relay between the user and OpenDesign project ${item.projectId} (direction: ${item.direction}). Every user message that asks for a change goes to OpenDesign with design {action:"send", message} in the user's own words (add only what OpenDesign cannot know, such as which page). Do not edit repository files and do not design it yourself. The page shows the design live beside this chat (reloaded when files change), so never describe it at length, never post links or file paths to view it (OpenDesign links point at this PC and fail on the user's other devices), and never say you have not seen it: the user is looking at it. When you are told a run ended, call design {action:"show"} and reply in a line or two: what OpenDesign changed (its added, changed and removed files). A run that made no files: say so and offer to send again. Questions about the design you answer from its files in show's folder. When the user picks this design (\"select this\", \"use it\"), call design {action:\"select\"}: it exports, stars it and asks the user where to implement it. To try a different approach without losing this one, call design {action:\"clone\", name} (ask the user for a name when they gave none): a new design session with a copy of this design and this chat.`;

export default function designExtension(pi) {
	let watch, self: Session | undefined, modelSet = false, busy = "", shown = "";
	// Runs take 10+ minutes: look once a minute and wake the agent when one ends. A design session watches its own
	// session for good (the user may start runs in the OpenDesign app too); the parent watches the ones without one.
	function watchRuns(cwd: string) {
		clearInterval(watch);
		let looking = false;
		const empty = new Set<string>(); // runs that ended with no files: OD often continues them with a new run, so look once more
		const stopAt = Date.now() + 3 * 3_600_000;
		const look = async () => {
			if (looking) return;
			looking = true;
			try {
				self = ownSession(cwd) ?? self;
				const { ended, running } = await checkRuns(cwd, openDesign(cwd), self, empty);
				if (self) {
					// While OpenDesign builds, the hub shows this session working (the agent itself is idle) with the minutes so far.
					const now = load(cwd).sessions.find(item => item.handle === self!.handle) ?? self, line = subtitleOf(now);
					if (building(now) !== busy) { busy = building(now); pi.events?.emit?.("wo:modes-changed", {}); }
					if (line !== shown && now.hubSessionId) { shown = line; await hubCall(["subtitle", now.hubSessionId, line]).catch(() => {}); }
				}
				if (!self && (!running || Date.now() > stopAt)) return clearInterval(watch);
				if (ended.length) pi.sendMessage({ customType: "design", content: self ? `OpenDesign run ended: ${ended.join(", ")}. Call design show and tell the user what changed.` : `OpenDesign runs ended: ${ended.join(", ")}. Run design status, then tell the user (with links); offer a retry for a failed or empty one.`, display: true }, { triggerTurn: true, deliverAs: "followUp" });
			} catch { /* shortcut: a failed look is retried next minute, silently; surface repeated failures if users miss them */ } finally { looking = false; }
		};
		watch = setInterval(look, Number(process.env.DESIGN_POLL_MS) || 60_000);
		void look(); // show a run that is already going now, not a minute later
		watch.unref?.();
	}
	pi.registerTool?.({
		name: "design", label: "Design", exposure: "deferred",
		description: "OpenDesign design sessions. start: one OpenDesign session per direction (the same brief: project description, the current interface with real copy, what the user wants changed; source files in inputs), returns handles design-N with Studio links; each also opens its own hub Pi session (hubSessionId) named after its direction (names) with the brief's title below, where the user refines it by chat or in the OpenDesign app; do not approve, repair or refine for them. status: each session's newest run (also runs OpenDesign or the user started there), files, links. retry: run a failed or empty session's prompt again (only when the user agrees). add: track an existing OpenDesign project as a new handle (opens its hub session). open: open the hub session of a handle that has none. send/show: used inside a design session (handle defaults to it): send turns the user's message into an OpenDesign run; show returns the mirrored files under .pi/designs/<handle>/ and what the last run added, changed and removed. select (when the user picks one, e.g. \"@design-2\", or \"select this\" inside its session): exports its files, conversation and comments to docs/designs/<name>/, stars it and asks the user where to implement it (the session it was started from, or a new one), which gets a message naming the folder; selecting again updates the same folder and lists what changed. clone (to try another approach): a new handle and OpenDesign project holding a copy of this design's files, with a hub session forked from this one (name: the copy's name).",
		promptSnippet: "OpenDesign design sessions: start variants, track them, select one for implementation",
		parameters: { type: "object", additionalProperties: false, required: ["action"], properties: {
			action: { type: "string", enum: ["start", "status", "retry", "add", "open", "send", "show", "select", "clone"] },
			name: { type: "string", description: "clone: the copy's name for the session list (asked when missing)" },
			message: { type: "string", description: "send: the change request, in the user's words" },
			brief: { type: "string", description: "start: the design brief" },
			directions: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "start: one direction per session" },
			names: { type: "array", items: { type: "string" }, maxItems: 6, description: "start (required): a short name per direction for the session list, e.g. Calm, Bold editorial (never design-N), no default: the direction's first words" },
			title: { type: "string", description: "start (required): a few words naming what is designed, shown under each name, e.g. Home page" },
			inputs: { type: "array", items: { type: "string" }, description: "start: project-relative source files OpenDesign should read (up to 200 KB each; credentials are refused)" },
			handle: { type: "string", description: "design-N (in a design session: defaults to it)" },
			project: { type: "string", description: "add: an existing OpenDesign project id" },
		} },
		async execute(_id, args, signal, _update, ctx) {
			const ask: Tools["ask"] = async (title, purpose, items) => {
				const { showListDialog } = await import("./ask-user/menu.ts"); // loaded on use: it pulls in the dialog stack
				return (await showListDialog(ctx, { title, purpose, compact: true, filter: false, items, signal }))?.value;
			};
			const askName = async (title: string) => (await import("./ask-user/menu.ts")).askText(ctx, pi, title);
			const result = await runDesign(ctx.cwd, args, signal, undefined, { hub: hubCall, ask, text: askName });
			if (!["select", "show"].includes(args.action)) watchRuns(ctx.cwd);
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	});
	// A design session: its model (workOrchestrator.designModel), its role, a hub badge, and its own run watcher.
	pi.on?.("session_start", (_event, ctx) => { self = ownSession(ctx.cwd); if (self || process.env.PI_HUB_SESSION) watchRuns(ctx.cwd); });
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
		if (sections && typeof sections === "object") { sections.design = DESIGN_GUIDE(self); return; }
		return { systemPrompt: `${event.systemPrompt ?? ""}\n\n${DESIGN_GUIDE(self)}` };
	});
	pi.events?.on?.("wo:web-info", info => { if (self) { info.design = self.handle; if (busy) info.busy = `OpenDesign ${busy}`; } });
	pi.on?.("session_shutdown", async () => { clearInterval(watch); await closePersistentOpenDesignClients(); });
}
