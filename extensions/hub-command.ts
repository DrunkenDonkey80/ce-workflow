// /wo hub: install, start and control pi-control-hub (../hub) from inside Pi. Every action runs the hub's own CLI with
// Pi's Node, so the terminal command `pi-hub` and this menu share one implementation.
import { execFile } from "node:child_process";
import { basename, resolve } from "node:path";
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
type Live = { id: string; cwd: string; pid: number; startedAt: number; name?: string };
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

/** The live intercom peer a send addresses, as intercom resolves it: exact id or name, a unique id prefix, or the sole peer in cwd. */
export function liveTarget(live: Live[], to: string, folder?: string, selfPid = process.pid) {
	const pool = live.filter(s => s.pid !== selfPid && (!folder || sameFolder(s.cwd, folder)));
	if (!to) return pool.length === 1 ? pool[0] : undefined;
	const exact = pool.filter(s => s.id === to || s.name?.toLowerCase() === to.toLowerCase());
	if (exact.length === 1) return exact[0];
	const prefix = pool.filter(s => to.length >= 4 && s.id.startsWith(to));
	return prefix.length === 1 ? prefix[0] : undefined;
}

type Option = { title: string; description?: string };
type Question = { question: string; context?: string; options?: Option[]; allowMultiple?: boolean; allowFreeform?: boolean };
type Form = Partial<Question> & { askId: string; brief?: boolean; kind?: string; title?: string; purpose?: string; questions?: Question[];
	items?: { value: string; label: string; heading?: boolean; disabled?: boolean }[] };
const cut = (text: unknown, max = 1500) => { const value = String(text ?? ""); return value.length > max ? value.slice(0, max) + "…" : value; };
function formLines(form: Form) {
	if (form.brief) return [`Question: ${form.title}`, "(too long to show here)"];
	if (form.kind === "list") return [`Menu: ${form.title}`, form.purpose && cut(form.purpose), ...(form.items ?? []).filter(item => !item.heading).map(item => `- ${item.label}${item.value !== item.label ? ` (value: ${item.value})` : ""}${item.disabled ? " (disabled)" : ""}`),
		`Answer shape: {"action":"select","value":"<value>"}`];
	const one = (question: Partial<Question>, index?: number) => [`${index === undefined ? "Question" : `Question ${index + 1}`}: ${question.question}`, question.context && `Context: ${cut(question.context)}`,
		...(question.options ?? []).map(option => `- ${option.title}${option.description ? ` — ${cut(option.description, 200)}` : ""}`),
		question.allowMultiple && "(several may be picked)", question.allowFreeform !== false && "(free text allowed)"];
	if (Array.isArray(form.questions)) return [...form.questions.flatMap((question, index) => one(question, index)),
		`Answer shape: {"answers":[{"status":"answered","response":{"kind":"selection","selections":["<option title>"]}},{"status":"skipped"}]}, one entry per question in order; free text is {"kind":"freeform","text":"…"}`];
	return [...one(form), `Answer shape: {"selections":["<option title>"]} or {"text":"<free text>"}`];
}

/** The tool_call result for a send to a peer that sits in a dialog: its question, and the three ways on. */
export function dialogReason(peer: { id: string; name?: string }, forms: Form[]) {
	const who = peer.name ? `${peer.name} (${peer.id.slice(0, 8)})` : peer.id.slice(0, 8);
	return [`Not sent: session ${who} is waiting for its user to answer, so your message would only reach it after that closes (an ask would hang until then).`,
		...forms.flatMap(form => ["", `askId: ${form.askId}`, ...formLines(form).filter(Boolean)]), "",
		"Choose one:",
		`- Wait (usual): session_dialog {action: "wait", session: "${peer.id}", askId} — you get a message saying what was picked once it closes; then send again if it still matters.`,
		"- Drop it: carry on without that session.",
		`- Answer it: ONLY when the user told you to control or fix that session. It is the user's question; answering it takes the decision from them. session_dialog {action: "answer", session: "${peer.id}", askId, answer: <answer shape>}; that session is told the answer came from you.`,
	].join("\n");
}

async function dialogBlock(peer: Live | undefined) {
	if (!peer) return;
	const result = await hubCli(["dialogs", peer.id], 30_000);
	let state: { forms?: Form[] };
	try { state = JSON.parse(result.text); } catch { return; } // no hub, or the peer is not one of its sessions
	if (state.forms?.length) return { block: true, reason: dialogReason(peer, state.forms) };
}

const text = (value: string) => ({ content: [{ type: "text", text: value }], details: {} });
/** Another session's open question (from a blocked intercom send): wait for it to close, or answer it when the user said so. */
export function sessionDialogTool(pi) {
	return {
		name: "session_dialog",
		label: "Session dialog",
		description: "Act on another hub session's open question after an intercom send was stopped because it is waiting for its user. wait: you get a message once it closes, saying what was picked and by whom. answer: answer it yourself, only when the user told you to control or fix that session; it is told the answer came from you.",
		parameters: {
			type: "object", additionalProperties: false, required: ["action", "session"],
			properties: {
				action: { type: "string", enum: ["wait", "answer"] },
				session: { type: "string", description: "The session id from the stopped send" },
				askId: nullable({ type: "string", description: "Which question; omitted: its open one (answer then shows it with the answer shape)" }),
				answer: nullable({ type: "object", description: "answer: the answer shape shown with the question" }),
			},
		},
		async execute(_id, args, _signal, _update, ctx) {
			if (!args.askId || (args.action === "answer" && !args.answer)) {
				const open = await hubCli(["dialogs", args.session], 30_000);
				let forms: Form[] = [];
				try { forms = JSON.parse(open.text).forms ?? []; } catch { throw new Error(`The hub could not be asked: ${open.text}`); }
				if (!forms.length) return text("That session has no open question now.");
				if (args.action === "answer") return text(dialogReason({ id: args.session }, forms));
				args = { ...args, askId: forms[0].askId };
			}
			if (args.action === "answer") {
				if (!args.answer || typeof args.answer !== "object") throw new Error("answer needs the answer object shown with the question.");
				const me = `${pi.getSessionName?.() || ctx.sessionManager?.getSessionId?.()?.slice(0, 8) || "a session"} in ${basename(ctx.cwd)}`;
				const result = await hubCli(["answer", args.session, "--json", JSON.stringify({ ...args.answer, askId: args.askId }), "--by", me], 30_000);
				if (!result.ok) throw new Error(result.text);
				return text(/"accepted":true/.test(result.text) ? "Answered; that session continues with it." : "Not accepted: the question is already closed, or the answer does not fit it (check the shape and option titles).");
			}
			// One waiting child per question; it polls the hub and exits once the question closes.
			void hubCli(["dialogs", args.session, "--wait", args.askId], 24 * 3600_000).then(result => {
				let answer: { by?: string; answer?: string } | undefined;
				try { answer = JSON.parse(result.text).answer; } catch { /* hub gone: say closed */ }
				const line = answer ? `answered "${answer.answer}" by ${answer.by ? `session ${answer.by}` : "the user"}` : "closed (no answer recorded by the hub: cancelled, timed out, or the hub restarted)";
				pi.sendMessage({ customType: "session-dialog", content: `Session ${args.session.slice(0, 8)}'s question ${args.askId} ${line}. Send your message again if it still matters.`, display: true }, { triggerTurn: true, deliverAs: "followUp" });
			});
			return text("Waiting; a message arrives here when that question closes. Carry on meanwhile or end your turn.");
		},
	};
}

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
		if (to) {
			target = parkedTarget(await parkedSessions(), to, folder);
			if (!target) return dialogBlock(liveTarget(await roster() ?? [], to, folder));
		} else {
			// cwd alone: intercom picks the sole live peer there; only when none is live does a parked one stand in.
			const live = await roster();
			if (!live) return;
			if (live.some(s => s.pid !== process.pid && sameFolder(s.cwd, folder!))) return dialogBlock(liveTarget(live, "", folder));
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
		// Only a failed delivery means it may not have joined yet; an ask that timed out was delivered and is still being worked on.
		if (name && event.isError && !/No reply from .* within/.test(text)) return { content: [{ type: "text", text: `${text}\n\nParked session ${name} was just resumed and may not have joined intercom yet; wait ~10 s and send again.` }], isError: true };
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
	description: "Wake this hub session later instead of keeping a turn open to poll. Prefer kind script: the hub runs `command` in the project folder each tick at no token cost; exit 0 with no output keeps watching, printed output becomes your next message and ends the timer, even a repeating one (a watchdog: re-add it after handling an alert), exit 3 cancels it, 3 failures in a row report the error. Kind message sends `text` as a full model turn (only when the check needs your judgement). One-off: inMinutes or at (ISO time). Repeating: everyMinutes (script at least 1/6 = 10 s, e.g. waiting for a program; message at least 1; GitHub runs: 1); message repeats need until or runs (default 12); script repeats stop after 24 h. Also list and cancel (by id). Timers survive a hub restart (one overdue run fires once). A message from a timer that already ended can arrive later: it waits as a follow-up while you are busy, so list no longer shows that timer.",
	parameters: {
		type: "object", additionalProperties: false, required: ["action"],
		properties: {
			action: { type: "string", enum: ["add", "list", "cancel"] },
			kind: nullable({ type: "string", enum: ["script", "message"] }),
			command: nullable({ type: "string", description: "Shell command (script kind); runs in the same bash as your bash tool (Git Bash on Windows). For a long job (downloads, a batch), the script or your bash can show a bar above the chat with `pi-hub progress <done> <total> [label]` (`pi-hub progress --clear` removes it); it hides itself 1 min after done reaches total or 15 min after the last report. pi-hub progress/notice work from timer scripts and from processes your bash tool starts (they inherit PI_HUB_SESSION); anything started another way passes --session <hub id>." }),
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

// Project commands: buttons above the hub page's chat for this folder, kept in the hub's data (not the repo).
export const projectCommandsTool = {
	name: "project_commands",
	label: "Project commands",
	description: "Add, remove or list the user's project command buttons shown above the hub page's chat for this folder. Use when the user asks to add a (custom/user/project) command or button. kind prompt: clicking sends `text` to the agent as a message (costs a turn), e.g. name \"Run tests\", text \"run the tests and fix failures\". kind run: clicking starts `text` as a shell command line in the project folder on the hub PC with no agent and no captured output, for things that open windows, e.g. name \"Terminal\", text \"start wt -d .\" (Windows) or \"x-terminal-emulator\" (Linux). A run command can be a whole flow with no model turn: its script (put it in a file in the project and run that) may call `pi-hub ask \"Question?\" --option A --option B` (also --context text, --text prefill, --multiple, --no-freeform), which shows an ask_user form on the hub page, waits for the answer, prints the chosen option titles one per line or the typed text, and exits 1 when cancelled; --raw prints JSON {selections, comment} or {text}, and --json '<ask_user JSON>' (or - for stdin) takes option descriptions and questions batches. `pi-hub notice \"text\"` shows a line on the page; the script runs hidden with no captured output, so report results and errors that way. Keep name 1-3 words; help is one short line shown on hover. Adding an existing name replaces it.",
	parameters: {
		type: "object", additionalProperties: false, required: ["action"],
		properties: {
			action: { type: "string", enum: ["add", "remove", "list"] },
			name: nullable({ type: "string", description: "Button label (add, remove)" }),
			kind: nullable({ type: "string", enum: ["prompt", "run"] }),
			text: nullable({ type: "string", description: "prompt: message to send; run: shell command line" }),
			help: nullable({ type: "string", description: "One short line shown on hover" }),
			local: nullable({ type: "boolean", description: "Show only on this PC's own hub page, not remote ones (for runs that open windows or act on this desktop)" }),
		},
	},
	async execute(_id, args, _signal, _update, ctx) {
		if (args.action !== "list" && !args.name) throw new Error(`${args.action} needs name.`);
		const cli = ["commands", args.action, "--folder", ctx?.cwd ?? process.cwd()];
		for (const key of ["name", "kind", "text", "help"]) if (args[key] != null && (args.action === "add" || key === "name")) cli.push(`--${key}`, String(args[key]));
		if (args.action === "add" && args.local === true) cli.push("--local");
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
