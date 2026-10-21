// Session lifecycle (H2-04): new, resume, park, rename, restart, automatic parking, session locks.
// The hub never deletes or rewrites a session file; only the Pi child writes it.
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { defaultCommand, RpcChild, type RpcRecord } from "./rpc-client.ts";
import { acquireLock, holderAlive, lockPath, readLock, releaseLock, type LockInfo } from "./session-lock.ts";
import type { Registry, SessionRecord } from "./registry.ts";

export type HostOptions = { registry: Registry; command?: string[]; env?: Record<string, string>; idleParkMinutes?: number; stopGraceMs?: number; viewers?: (id: string) => number; terminal?: (args: string[], cwd: string, env: Record<string, string>) => { pid?: number; once(event: "exit", listener: () => void): unknown } };
/** H7-01 (D20): interactive Pi in its own console window (Windows Terminal hosts it when it is the default terminal). */
// `start /wait` gives Pi the new console's own handles (spawn's stdio would hand it NUL, and the TUI would exit);
// the hidden cmd lives exactly as long as that Pi.
const openWindow = (command: string[]) => (args: string[], cwd: string, env: Record<string, string>) => {
	if (process.platform !== "win32") throw new Error("Open in terminal is Windows only for now.");
	// start's first quoted argument is the window title. shortcut: a '%' or '"' in a path breaks cmd quoting; none occur in Pi session paths.
	const line = ["/c", "start", '"Pi"', "/wait", ...[...command, ...args].map(arg => `"${arg}"`)].join(" ");
	const child = spawn("cmd.exe", [line], { cwd, env: { ...process.env, ...env }, detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true });
	child.unref();
	return child;
};
export type Live = {
	id: string;
	rpc: RpcChild;
	lock?: { file: string; info: LockInfo };
	running: boolean; // between agent_start and agent_settled
	settles: number; // agent_settled count, so a late prompt response cannot mark a finished run as working
	compacting: boolean;
	command: number; // extension commands still waiting for their response (F6)
	dialogs: Map<string, RpcRecord>; // open select/confirm/input/editor requests
	busyExtra: Set<string>; // reasons reported by ce-workflow through the hub channel, e.g. "subagents"
	published: Record<string, unknown>;
	hubCommand?: boolean; // ce-workflow's /pi-hub is registered (checked once per child) // latest `pi-hub:<kind>` update per kind (ce-workflow H3-04: state = plan, modes, compacting, subagents)
	viewers: number;
	lastActivity: number;
	stopping: boolean;
	/** S-15: settles when Pi has started (and parked changes are applied); every delivery awaits it. */
	ready: Promise<void>;
};

const DIALOGS = new Set(["select", "confirm", "input", "editor"]);
const parseJson = (text: unknown) => { try { return typeof text === "string" ? JSON.parse(text) : undefined; } catch { return undefined; } };
/** The channel id of a marker ask (`pi-hub:<kind>` input with JSON placeholder), if it is one. */
export const channelId = (request: RpcRecord): string | undefined =>
	request.method === "input" && String(request.title ?? "").startsWith("pi-hub:") ? parseJson(request.placeholder)?.id : undefined;

export class SessionHost extends EventEmitter {
	readonly options: HostOptions;
	readonly live = new Map<string, Live>();
	idleParkMinutes: number;

	constructor(options: HostOptions) {
		super();
		this.options = options;
		this.idleParkMinutes = options.idleParkMinutes ?? 10; // D16
	}

	private get registry() { return this.options.registry; }

	/** Why a session cannot be parked now (D15), or [] when idle. */
	busyReasons(id: string): string[] {
		const live = this.live.get(id);
		if (!live) return [];
		const reasons = [];
		if (live.running) reasons.push("working");
		if (live.compacting) reasons.push("compacting");
		if (live.command) reasons.push("running a command");
		if (live.dialogs.size) reasons.push("waiting for an answer");
		reasons.push(...live.busyExtra);
		return reasons;
	}

	private spawn(record: SessionRecord, args: string[]): Live {
		const rpc = new RpcChild({ cwd: record.folder, args, command: this.options.command, env: { ...this.options.env, PI_HUB: "1", PI_HUB_SESSION: record.id } }); // the schedule tool addresses its own session (S-04)
		const live: Live = { id: record.id, rpc, running: false, settles: 0, compacting: false, command: 0, dialogs: new Map(), busyExtra: new Set(), published: {}, viewers: this.options.viewers?.(record.id) ?? 0, lastActivity: Date.now(), stopping: false, ready: Promise.resolve() };
		rpc.on("event", (event: RpcRecord) => {
			live.lastActivity = Date.now();
			if (event.type === "agent_start") live.running = true;
			else if (event.type === "agent_settled") { live.running = false; live.settles++; }
			else if (event.type === "compaction_start") live.compacting = true;
			else if (event.type === "compaction_end") live.compacting = false;
			this.emit("event", record.id, event);
		});
		rpc.on("ui", (request: RpcRecord) => {
			// Only a dialog is activity: extensions repaint statuses and widgets on timers, which kept idle sessions from parking.
			if (DIALOGS.has(request.method)) { live.lastActivity = Date.now(); live.dialogs.set(request.id!, request); }
			// ce-workflow hub-channel.ts: an ask that ended another way (timeout, abort, intercom) is closed by its channel id.
			if (request.method === "setStatus" && request.statusKey === "pi-hub:state") {
				const state = parseJson(request.statusText);
				live.published.state = state;
				live.busyExtra.clear();
				if (Array.isArray(state?.subagents) && state.subagents.length) live.busyExtra.add("subagents running");
				if (state?.compacting && !live.compacting) live.busyExtra.add("compacting");
			}
			if (request.method === "setStatus" && request.statusKey === "pi-hub:closed") {
				const askId = parseJson(request.statusText)?.id;
				for (const [requestId, dialog] of live.dialogs) if (askId && channelId(dialog) === askId) { live.dialogs.delete(requestId); this.emit("closed", record.id, requestId); }
			}
			this.emit("ui", record.id, request);
		});
		rpc.on("exit", exit => {
			const unexpected = !live.stopping;
			if (live.lock) releaseLock(live.lock.file, live.lock.info); // only after the child has exited (D9)
			this.live.delete(record.id);
			if (this.registry.get(record.id)) this.registry.update(record.id, { state: "parked" });
			this.emit("exit", record.id, { ...exit, unexpected });
		});
		this.live.set(record.id, live);
		rpc.start();
		return live;
	}

	/** Start a new session in a folder; Pi chooses the session file and reports it through get_state. */
	async create(folder: string, name: string): Promise<SessionRecord> {
		const record = this.registry.add({ name, folder, state: "running" });
		const live = this.spawn(record, ["--name", record.name]);
		try {
			const pending = live.rpc.send({ type: "get_state" });
			live.ready = pending.then(() => {});
			const state = await pending;
			const sessionFile = state.data?.sessionFile;
			if (!state.success || typeof sessionFile !== "string") throw new Error(state.error ?? "Pi reported no session file.");
			live.lock = { file: sessionFile, info: acquireLock(sessionFile, "pi-control-hub") }; // new file name, so nobody else can hold it
			return this.registry.update(record.id, { sessionFile, state: "running" });
		} catch (error) {
			await this.halt(live);
			this.registry.remove(record.id); // nothing was written yet; a retry starts fresh
			throw error;
		}
	}

	/** Lock first, then start Pi on the file (D9: Pi loads the file before extensions run). */
	async resume(id: string): Promise<SessionRecord> {
		const record = this.registry.get(id);
		if (!record) throw new Error("Unknown session.");
		const starting = this.live.get(id);
		if (starting) { await starting.ready; return this.registry.get(id) ?? record; } // a second caller waits for the same start (S-15)
		if (!record.sessionFile) throw new Error("This session has no file yet.");
		if (record.state === "terminal") throw new Error("This session is open in a terminal.");
		const lock = acquireLock(record.sessionFile, "pi-control-hub");
		let live: Live | undefined;
		try {
			live = this.spawn(record, ["--session", record.sessionFile]);
			live.lock = { file: record.sessionFile, info: lock };
			const started = live;
			live.ready = (async () => {
				const state = await started.rpc.send({ type: "get_state" });
				if (!state.success) throw new Error(state.error ?? "Pi did not start.");
			})();
			await live.ready;
			return this.registry.update(id, { state: "running" });
		} catch (error) {
			if (live) await this.halt(live); else releaseLock(record.sessionFile, lock);
			this.registry.update(id, { state: "parked" }); // stays retryable
			throw error;
		}
	}

	private async halt(live: Live) {
		live.stopping = true;
		await live.rpc.stop(this.options.stopGraceMs);
	}

	/** End the Pi process and keep the file (D15: refused while busy unless forced, e.g. hub shutdown). */
	async park(id: string, { force = false } = {}): Promise<void> {
		const live = this.live.get(id);
		if (!live) return;
		const busy = this.busyReasons(id);
		if (busy.length && !force) throw new Error(`Cannot park while ${busy.join(", ")}.`);
		await this.halt(live);
	}

	async rename(id: string, name: string): Promise<SessionRecord> {
		const record = this.registry.update(id, { name });
		const live = this.live.get(id);
		if (live) await live.rpc.send({ type: "set_session_name", name: record.name });
		return record;
	}

	/** /new from the page: Pi starts a fresh session file in the same process; the hub lock moves with it. */
	async newSession(id: string): Promise<SessionRecord> {
		const live = this.live.get(id);
		if (!live) throw new Error("Session is parked; resume it first.");
		if (live.running) throw new Error("Stop the agent before starting a new session.");
		const result = await live.rpc.send({ type: "new_session" });
		if (!result.success || result.data?.cancelled) throw new Error(result.error ?? "Pi kept the current session.");
		const state = await live.rpc.send({ type: "get_state" }), sessionFile = state.data?.sessionFile;
		if (!state.success || typeof sessionFile !== "string") throw new Error(state.error ?? "Pi reported no session file.");
		if (live.lock) releaseLock(live.lock.file, live.lock.info);
		live.lock = { file: sessionFile, info: acquireLock(sessionFile, "pi-control-hub") };
		return this.registry.update(id, { sessionFile });
	}

	/** D12: RPC has no reload, so Reload parks and resumes, idle only. */
	async restart(id: string): Promise<SessionRecord> {
		await this.park(id);
		return this.resume(id);
	}

	/**
	 * H7-01 (D9, D20): park, then open the session file in a terminal Pi. The lock stays held for it, under the terminal's
	 * process id, so it outlives a hub restart; ce-workflow lets that one Pi through by the lock's start time
	 * (PI_HUB_TERMINAL_LOCK). The session is "terminal" until the lock ends (checkTerminals).
	 */
	async openTerminal(id: string): Promise<SessionRecord> {
		const record = this.registry.get(id);
		if (!record) throw new Error("Unknown session.");
		if (!record.sessionFile) throw new Error("This session has no file yet.");
		if (record.state === "terminal") throw new Error("This session is already open in a terminal.");
		await this.park(id);
		const file = record.sessionFile, info = acquireLock(file, "pi-control-hub terminal");
		let child;
		try {
			child = (this.options.terminal ?? openWindow(this.options.command ?? defaultCommand()))(["--session", file], record.folder, { PI_HUB_TERMINAL_LOCK: String(info.startedAt) });
			if (!child.pid) throw new Error("The terminal did not start.");
		} catch (error) { releaseLock(file, info); throw error; }
		// Same start time, the terminal's pid: written before Pi can read it (its extensions load seconds later).
		writeFileSync(lockPath(file), JSON.stringify({ ...info, pid: child.pid }));
		child.once("exit", () => { releaseLock(file, { ...info, pid: child.pid! }); this.checkTerminals(); });
		return this.registry.update(id, { state: "terminal" });
	}

	/** Sessions whose terminal lock has ended (closed window, or a hub restart lost the exit event) go back to parked. */
	checkTerminals(): string[] {
		const back = [];
		for (const record of this.registry.list().filter(r => r.state === "terminal")) {
			const holder = record.sessionFile ? readLock(record.sessionFile) : undefined;
			if (holder?.owner === "pi-control-hub terminal" && holderAlive(holder)) continue;
			this.registry.update(record.id, { state: "parked" }); back.push(record.id);
		}
		if (back.length) this.emit("terminals", back);
		return back;
	}

	/** D16: park sessions idle for idleParkMinutes with no dialog, even with a page open (posting resumes them); 0 disables. */
	async autoPark(now = Date.now()): Promise<string[]> {
		if (!this.idleParkMinutes) return [];
		const parked = [];
		for (const live of [...this.live.values()]) {
			if (this.busyReasons(live.id).length || now - live.lastActivity < this.idleParkMinutes * 60_000) continue;
			try { await this.park(live.id); parked.push(live.id); } catch { /* turned busy meanwhile; retried next minute */ }
		}
		return parked;
	}

	/** Open dialogs, oldest first, so a browser that reconnects mid-ask can show them again. */
	pendingDialogs(id: string): RpcRecord[] { return [...(this.live.get(id)?.dialogs.values() ?? [])]; }

	/** Answer a dialog the hub showed; the dialog stops counting as busy. */
	respond(id: string, requestId: string, response: { value?: string; confirmed?: boolean; cancelled?: boolean }) {
		const live = this.live.get(id);
		if (!live?.dialogs.delete(requestId)) return false;
		live.rpc.respondUi(requestId, response);
		live.lastActivity = Date.now();
		return true;
	}

	/** Send a prompt; extension commands are counted as busy until Pi answers (F6). */
	/**
	 * Call one of ce-workflow's plan operations (H3-09: /api/command, /api/bias, /api/generate, /api/edit, /api/comment, /api/move).
	 * The answer is its `pi-hub:result` by call id. Never waits on the command's own response (F6), which can trail by minutes.
	 */
	async call(id: string, endpoint: string, data: Record<string, unknown>): Promise<{ ok: boolean; value?: unknown; status?: number; error?: string }> {
		const live = this.live.get(id);
		if (!live) throw new Error("Session is parked.");
		await live.ready;
		// Without ce-workflow's /pi-hub, Pi would send the call to the model as an ordinary prompt.
		live.hubCommand ??= (await live.rpc.send({ type: "get_commands" })).data?.commands?.some((command: { name?: string }) => command.name === "pi-hub") ?? false;
		if (!live.hubCommand) throw new Error("This session has no ce-workflow hub support.");
		const callId = randomUUID();
		return new Promise((resolve, reject) => {
			const done = () => { this.off("ui", onUi); this.off("exit", onExit); };
			const onUi = (sid: string, request: RpcRecord) => {
				if (sid !== id || request.method !== "setStatus" || request.statusKey !== "pi-hub:result") return;
				const result = parseJson(request.statusText);
				if (result?.id !== callId) return;
				done(); const { id: _id, ...rest } = result; resolve(rest);
			};
			const onExit = (sid: string) => { if (sid === id) { done(); reject(new Error("The session ended before answering.")); } };
			this.on("ui", onUi); this.on("exit", onExit);
			this.prompt(id, `/pi-hub ${JSON.stringify({ id: callId, endpoint, data })}`).catch(error => { done(); reject(error); });
		});
	}

	async prompt(id: string, message: string, extra: Record<string, unknown> = {}): Promise<RpcRecord> {
		const live = this.live.get(id);
		if (!live) throw new Error("Session is parked.");
		await live.ready;
		const command = message.trimStart().startsWith("/");
		if (command) live.command++;
		live.lastActivity = Date.now();
		const settles = live.settles;
		try {
			const response = await live.rpc.send({ type: "prompt", message, ...extra });
			if (response.data?.disposition === "started" && live.settles === settles) live.running = true; // agent_start may still be on its way
			return response;
		}
		finally { if (command) live.command--; live.lastActivity = Date.now(); }
	}

	/** Hub shutdown: remember what was running (D17), then stop every child. */
	async shutdown(): Promise<void> {
		for (const record of this.registry.list()) this.registry.update(record.id, { wasRunning: this.live.has(record.id), lastActivity: this.live.get(record.id)?.lastActivity });
		await Promise.all([...this.live.keys()].map(id => this.park(id, { force: true }).catch(() => {})));
	}

	/** D17: after a hub restart, start again the sessions that were running. */
	async restoreRunning(): Promise<{ id: string; error?: string }[]> {
		const results = [];
		for (const record of this.registry.list().filter(r => r.wasRunning)) {
			try {
				await this.resume(record.id);
				// A hub restart keeps the idle clock, so frequent restarts do not keep idle sessions from parking (D16).
				const live = this.live.get(record.id);
				if (live && record.lastActivity) live.lastActivity = Math.min(live.lastActivity, record.lastActivity);
				results.push({ id: record.id });
			}
			catch (error) { results.push({ id: record.id, error: (error as Error).message }); }
		}
		return results;
	}
}
