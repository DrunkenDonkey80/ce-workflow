// /wo hub: install, start and control pi-control-hub (../hub) from inside Pi. Every action runs the hub's own CLI with
// Pi's Node, so the terminal command `pi-hub` and this menu share one implementation.
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { showListDialog } from "./ask-user/menu.ts";

const CLI = fileURLToPath(new URL("../hub/src/cli.ts", import.meta.url));

/** Runs `pi-hub <args>`; resolves with its output, errors included (the CLI prints them and exits non-zero). */
export function hubCli(args: string[], timeout = 180_000): Promise<{ ok: boolean; text: string }> {
	// The hub runs its .ts files with Node's type stripping: Node 24+, and never from inside node_modules.
	if (Number(process.versions.node.split(".")[0]) < 24) return Promise.resolve({ ok: false, text: `The hub needs Node 24 or newer; Pi runs on ${process.version}.` });
	if (/[\\/]node_modules[\\/]/.test(CLI)) return Promise.resolve({ ok: false, text: "The hub cannot run from node_modules; install ce-workflow from git (pi install git:…)." });
	return new Promise(resolve => execFile(process.execPath, ["--no-warnings", CLI, ...args], { timeout, windowsHide: true }, (error, stdout, stderr) =>
		resolve({ ok: !error, text: [stdout, stderr].map(s => String(s).trim()).filter(Boolean).join("\n") || (error ? error.message : "Done.") })));
}

// Parked hub sessions on intercom: `list` shows them beside the live ones, and a send/ask/handover addressed to one
// (by id, by name within cwd, or by cwd alone when nothing there is live) resumes it first, waits until it joins
// intercom and sends to the id it joined with. New sessions are never started here.
type Parked = { id: string; name: string; folder: string; sessionId: string };
type Live = { id: string; cwd: string; pid: number; startedAt: number };
const SENDS = new Set(["send", "ask", "handover"]);
const sameFolder = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const JOIN_TIMEOUT_MS = 60_000;

/** The intercom session a woken parked session joined as: its Pi session id, else (stable or claimed ids) the one new session in its folder. */
export function joinedSession(live: Live[], target: Parked, since: number, selfPid = process.pid) {
	const exact = live.find(s => s.id === target.sessionId);
	if (exact) return exact;
	const fresh = live.filter(s => s.pid !== selfPid && sameFolder(s.cwd, target.folder) && s.startedAt >= since);
	return fresh.length === 1 ? fresh[0] : undefined;
}

/** Intercom's session list through its extension bus; undefined while intercom is not loaded or not connected. */
function intercomRoster(pi) {
	let channel: { listSessions(): Promise<Live[]> } | undefined;
	const register = () => { if (!channel) pi.events.emit("intercom:extension-register", { namespace: "ce-workflow/hub-parked", ownerEligible: false, onEvent() {}, onReady(c) { channel = c; } }); };
	register(); pi.events.on("intercom:extension-registry-ready", register); // whichever extension loads first
	return async () => { try { return channel ? await channel.listSessions() : undefined; } catch { return undefined; } };
}

export async function parkedSessions(): Promise<Parked[]> {
	const result = await hubCli(["parked"], 30_000);
	try { return result.ok ? JSON.parse(result.text) : []; } catch { return []; }
}

/** The parked session a send addresses: `to` as a Pi session id prefix, or (within `cwd`) its hub name. */
export function parkedTarget(parked: Parked[], to: string, folder?: string) {
	const pool = folder ? parked.filter(s => sameFolder(s.folder, folder)) : parked;
	const byId = pool.filter(s => to.length >= 4 && s.sessionId.startsWith(to));
	if (byId.length === 1) return byId[0];
	const byName = folder ? pool.filter(s => s.name.toLowerCase() === to.toLowerCase()) : [];
	return byName.length === 1 ? byName[0] : undefined;
}

export const parkedList = (parked: Parked[]) => parked.length
	? `\n\n**Parked (pi-control-hub; a message to one resumes it first):**\n${parked.map(s => `\u2022 ${s.name} (${s.sessionId.slice(0, 8)}) \u2014 ${s.folder} [parked]`).join("\n")}`
	: "";

export function intercomParkedSessions(pi) {
	const woken = new Map<string, string>(); // toolCallId -> session name, for a clearer failure
	const roster = intercomRoster(pi);
	pi.on("tool_call", async (event, ctx) => {
		const input = event.input ?? {};
		if (event.toolName !== "intercom" || !SENDS.has(input.action)) return;
		const to = typeof input.to === "string" ? input.to.trim() : "";
		const folder = typeof input.cwd === "string" ? resolve(ctx.cwd, input.cwd) : undefined;
		if (!to && !folder) return;
		let target: Parked | undefined;
		if (to) target = parkedTarget(await parkedSessions(), to, folder);
		else {
			// cwd alone: intercom picks the sole live peer there; only when none is live does a parked one stand in.
			const live = await roster();
			if (!live || live.some(s => s.pid !== process.pid && sameFolder(s.cwd, folder!))) return;
			const parked = (await parkedSessions()).filter(s => sameFolder(s.folder, folder!));
			if (parked.length > 1) return { block: true, reason: `No live session in ${folder}; several are parked. Send again with to: <id>; it resumes first.${parkedList(parked)}` };
			target = parked[0];
		}
		if (!target) return;
		const since = Date.now() - 2_000;
		const woke = await hubCli(["wake", target.id], 120_000);
		if (!woke.ok) return { block: true, reason: `Could not resume parked session ${target.name} in ${target.folder}: ${woke.text}` };
		let joined: Live | undefined;
		for (const end = Date.now() + JOIN_TIMEOUT_MS; !joined && Date.now() < end; await new Promise(done => setTimeout(done, 500))) {
			const live = await roster();
			if (!live) break; // intercom's bus is unavailable: send to the Pi session id and let the result say if it raced
			joined = joinedSession(live, target, since);
		}
		input.to = joined?.id ?? target.sessionId;
		delete input.openProjectPaneIfMissing;
		woken.set(event.toolCallId, target.name);
	});
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "intercom") return;
		const text = event.content?.map(part => part.type === "text" ? part.text : "").join("\n") ?? "";
		const name = woken.get(event.toolCallId); woken.delete(event.toolCallId);
		if (name && event.isError) return { content: [{ type: "text", text: `${text}\n\nParked session ${name} was just resumed and may not have joined intercom yet; wait ~10 s and send again.` }], isError: true };
		const action = event.input?.action;
		// A send by cwd alone finds no live session (intercom's pane opener then fails): point at the parked ones there.
		if (event.isError && SENDS.has(action) && typeof event.input.cwd === "string" && /HERDR|Herdr|No (other )?intercom sessions? (is |are )?connected in/.test(text)) {
			const parked = (await parkedSessions()).filter(s => sameFolder(s.folder, resolve(ctx.cwd, event.input.cwd)));
			if (parked.length) return { content: [{ type: "text", text: `No live session there.${parkedList(parked)}\n\nSend again with to: <id> (drop openProjectPaneIfMissing); it resumes first.` }], isError: true };
		}
		if (event.isError || (action !== "list" && action !== "list-cwd")) return;
		const folder = action === "list-cwd" ? resolve(ctx.cwd, typeof event.input.cwd === "string" ? event.input.cwd : ".") : undefined;
		const parked = (await parkedSessions()).filter(s => !folder || sameFolder(s.folder, folder));
		if (parked.length) return { content: [{ type: "text", text: text + parkedList(parked) }], isError: false };
	});
}

export type HubStatus = { pairing?: { code: string; label?: string; login?: string } | null; running: boolean; autostart: boolean; command: boolean; local?: string; remote: { on: boolean; url?: string; error?: string; missing?: string[] }; sessions?: number; live?: number; busy?: number };

export async function handleHubCommand(args: string, ctx) {
	const notify = (text: string, ok = true) => ctx.ui?.notify?.(text, ok ? "info" : "warning");
	// Typed form: /wo hub install | start | stop | restart | open [remote] | remote on|off | autostart on|off | new … | update
	if (args.trim()) { const result = await hubCli(args.trim().split(/\s+/)); return notify(result.text, result.ok); }
	const read = await hubCli(["status", "--json"], 30_000);
	let status: HubStatus;
	try { status = JSON.parse(read.text); } catch { return notify(read.text, false); }
	const { summary, items } = hubMenu(status, ctx.cwd);
	const selected = await showListDialog(ctx, { title: "Pi control hub", purpose: summary, items, filter: false, cursorKey: "hub-menu" });
	if (!selected) return;
	const result = await hubCli(selected.value === "new" ? ["new", ctx.cwd] : selected.value.split(" "));
	notify(result.text, result.ok);
}

// S-04: the agent's timers, through `pi-hub schedule`. Registered only in hub-started Pi (PI_HUB_SESSION), which the hub can wake.
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
export const scheduleTool = {
	name: "schedule",
	label: "Schedule",
	description: "Wake this hub session later instead of keeping a turn open to poll. Prefer kind script: the hub runs `command` in the project folder each tick at no token cost; exit 0 with no output keeps watching, printed output becomes your next message and ends the timer, exit 3 cancels it, 3 failures in a row report the error. Kind message sends `text` as a full model turn (only when the check needs your judgement). One-off: inMinutes or at (ISO time). Repeating: everyMinutes (at least 1); message repeats need until or runs (default 12); script repeats stop after 24 h. Also list and cancel (by id).",
	parameters: {
		type: "object", additionalProperties: false, required: ["action"],
		properties: {
			action: { type: "string", enum: ["add", "list", "cancel"] },
			kind: nullable({ type: "string", enum: ["script", "message"] }),
			command: nullable({ type: "string", description: "Shell command (script kind)" }),
			text: nullable({ type: "string", description: "Message to send (message kind)" }),
			inMinutes: nullable({ type: "number" }),
			at: nullable({ type: "string", description: "ISO time of the first run" }),
			everyMinutes: nullable({ type: "number" }),
			until: nullable({ type: "string", description: "ISO time after which a repeat stops" }),
			runs: nullable({ type: "integer" }),
			id: nullable({ type: "string", description: "Timer id (or its first 8 characters) to cancel" }),
		},
	},
	async execute(_id, args) {
		if (!process.env.PI_HUB_SESSION) throw new Error("Timers need a session started by pi-control-hub; this Pi was not.");
		const cli = ["schedule", args.action];
		if (args.action === "cancel") { if (!args.id) throw new Error("cancel needs id."); cli.push(args.id); }
		if (args.action === "add") {
			if (!args.kind) throw new Error("add needs kind (script or message).");
			cli.push(args.kind, args.kind === "script" ? "--command" : "--text", String((args.kind === "script" ? args.command : args.text) ?? ""));
			for (const [key, flag] of [["inMinutes", "in"], ["at", "at"], ["everyMinutes", "every"], ["until", "until"], ["runs", "runs"]]) if (args[key] != null) cli.push(`--${flag}`, String(args[key]));
		}
		const result = await hubCli(cli, 30_000);
		if (!result.ok) throw new Error(result.text);
		return { content: [{ type: "text", text: result.text }], details: {} };
	},
};

/** The menu for a hub status: Install or Start while stopped, page/session/remote controls while running. */
export function hubMenu(status: HubStatus, cwd: string) {
	const installed = status.autostart || status.command;
	const remote = !status.remote.on ? "Remote off" : status.remote.url ? `Remote: ${status.remote.url}` : `Remote on, not served: ${status.remote.error ?? status.remote.missing?.join(" ") ?? "unknown"}`;
	const item = (value: string, label: string, description: string) => ({ value, label, description });
	const items = !status.running ? [
		installed ? item("start", "Start", "Start the hub now; it brings back the sessions that were running.")
			: item("install", "Install (Recommended)", "Adds the pi-hub terminal command, starts the hub at login and starts it now. Then shows its address."),
		...(installed ? [item("install", "Reinstall", "Re-adds the pi-hub command and login start, then starts the hub.")] : []),
	] : [
		// A phone waiting on the pairing page: approve it here, no browser needed.
		...(status.pairing ? [item("pair approve", `Approve device ${status.pairing.code}`, `${status.pairing.label ?? "A device"}${status.pairing.login ? ` (${status.pairing.login})` : ""} shows this code; approve only if it matches.`),
			item("pair reject", "Reject that device", "It stays unpaired.")] : []),
		item("open", "Open local page", `${status.local} in this PC's browser.`),
		...(status.remote.url ? [item("open remote", "Open remote page", `${status.remote.url}, the address your phone uses.`)] : []),
		item("new", "New session in this folder", `Starts a hub session in ${cwd}; it shows on the page.`),
		item("restart", "Restart", "Stops every hub session and starts them again; refused while one is busy."),
		item("stop", "Stop", "Stops the hub and its sessions; refused while one is busy."),
		item(`remote ${status.remote.on ? "off" : "on"}`, status.remote.on ? "Turn remote access off" : "Turn remote access on", status.remote.on ? "Removes the tailnet address." : "Serves the hub on your tailnet (Tailscale with HTTPS certificates) for the phone; never public."),
	];
	items.push(item(`autostart ${status.autostart ? "off" : "on"}`, status.autostart ? "Don't start at login" : "Start at login", status.autostart ? "Removes the login start." : "Starts the hub hidden when you log in."));
	const summary = status.running
		? `${status.pairing ? `Device waiting, code ${status.pairing.code} · ` : ""}Running · ${status.sessions} sessions (${status.live} live${status.busy ? `, ${status.busy} busy` : ""}) · ${status.local} · ${remote}`
		: installed ? `Stopped · ${remote}` : "Not installed";
	return { summary, items };
}
