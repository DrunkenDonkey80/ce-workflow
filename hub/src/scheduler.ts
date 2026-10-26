// S-01: timers per hub session (plan a62d54be D2-D5, D8, D15). A message timer sends a fixed message each tick;
// a script timer runs a command each tick and wakes the agent only when the command prints something.
import { spawn } from "node:child_process";
import { piSdk } from "./pi-sdk.ts";
import { hubEnv } from "./commands.ts";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { writeJsonAtomic, type Registry } from "./registry.ts";
import type { SessionHost } from "./sessions.ts";

export type Timer = {
	id: string;
	session: string; // hub record id
	sessionFile: string; // D15: the conversation it was set for; /new (new file) or unstar (no record) cancels it
	kind: "message" | "script";
	text?: string; // message kind
	command?: string; // script kind
	dueAt: number;
	every?: number; // ms; absent = one-off
	until?: number; // message repeats need until or runsLeft (D8)
	runsLeft?: number;
	expiresAt?: number; // script repeats stop after 24 h unless renewed (D8)
	failures: number;
	pending?: string; // a message waiting for delivery (session busy starting, or open in a terminal)
	lastRun?: number;
	lastResult?: string;
	createdAt: number;
};
export type TimerInput = { session: string; kind: "message" | "script"; text?: string; command?: string; inMinutes?: number; at?: number; everyMinutes?: number; until?: number; runs?: number };
export type ScriptResult = { code: number | null; output: string; timedOut: boolean };

export const MIN_EVERY_MS = 60_000, MIN_SCRIPT_EVERY_MS = 10_000, DEFAULT_RUNS = 12, SCRIPT_LIFETIME_MS = 24 * 3_600_000, SCRIPT_TIMEOUT_MS = 60_000, OUTPUT_CAP = 4096, MAX_FAILURES = 3;
export const CANCEL_EXIT = 3;
const fail = (message: string) => Object.assign(new Error(message), { status: 400 });

/** S-02: the API body of a new timer, checked field by field (trust boundary). Times are epoch ms or ISO strings. */
export function timerInput(session: string, data: Record<string, unknown>): TimerInput {
	const allowed = ["kind", "text", "command", "inMinutes", "at", "everyMinutes", "until", "runs"];
	if (Object.keys(data).some(key => !allowed.includes(key))) throw fail("Invalid timer fields.");
	if (data.kind !== "message" && data.kind !== "script") throw fail("Timer kind must be message or script.");
	const text = (key: string) => data[key] === undefined ? undefined : typeof data[key] === "string" && (data[key] as string).length <= 8000 ? data[key] as string : (() => { throw fail(`${key} must be text up to 8000 characters.`); })();
	const number = (key: string) => data[key] === undefined ? undefined : typeof data[key] === "number" && Number.isFinite(data[key]) && (data[key] as number) > 0 ? data[key] as number : (() => { throw fail(`${key} must be a positive number.`); })();
	const time = (key: string) => {
		if (data[key] === undefined) return undefined;
		const value = typeof data[key] === "string" ? Date.parse(data[key] as string) : data[key];
		if (typeof value !== "number" || !Number.isFinite(value)) throw fail(`${key} must be a time.`);
		return value;
	};
	const runs = number("runs");
	if (runs !== undefined && !Number.isInteger(runs)) throw fail("runs must be a whole number.");
	return { session, kind: data.kind, text: text("text"), command: text("command"), inMinutes: number("inMinutes"), at: time("at"), everyMinutes: number("everyMinutes"), until: time("until"), runs };
}

// Windows: the bash Pi's own bash tool uses (Git Bash), so a timer runs what the agent tested; cmd.exe would find WSL's bash.exe first.
// shortcut: ignores a shellPath set in Pi's settings, read it here if someone sets one.
let bash: Promise<{ shell: string; args: string[] } | null> | undefined;
const windowsBash = () => bash ??= process.platform !== "win32" ? Promise.resolve(null) : piSdk().then(sdk => { const config = sdk.getShellConfig(); return config.commandTransport ? null : config; }).catch(() => null); // WSL-only PC: cmd.exe

/** Runs a script timer's command in the session folder: Pi's bash on Windows, else the platform shell. */
export async function runScript(command: string, cwd: string, timeoutMs = SCRIPT_TIMEOUT_MS, env?: Record<string, string>): Promise<ScriptResult> {
	const shell = await windowsBash();
	return new Promise(resolve => {
		const options = { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] } as const;
		const child = shell ? spawn(shell.shell, [...shell.args, command], options) : spawn(command, { ...options, shell: true });
		let output = "", timedOut = false;
		const take = (chunk: Buffer) => { if (output.length < OUTPUT_CAP * 2) output += chunk.toString("utf8"); };
		child.stdout.on("data", take); child.stderr.on("data", take);
		const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
		child.on("error", error => { clearTimeout(timer); resolve({ code: null, output: error.message, timedOut: false }); });
		child.on("close", code => { clearTimeout(timer); resolve({ code, output: output.trim().slice(0, OUTPUT_CAP), timedOut }); });
	});
}

/** How a delivered scheduled message starts, so the chat can mark it (D11, S-06). */
export const SCHEDULED_PREFIX = "⏰ Scheduled";
export const scheduledText = (timer: Timer, body: string) => `${SCHEDULED_PREFIX} (${timer.kind} timer ${timer.id.slice(0, 8)}): ${body}`;

export class Scheduler extends EventEmitter {
	readonly file: string;
	private timers: Timer[] = [];
	private running = new Set<string>(); // ticks in flight, so a slow script or resume never overlaps itself

	readonly options: { dataDir: string; registry: Registry; host: SessionHost; run?: typeof runScript };

	constructor(options: Scheduler["options"]) {
		super();
		this.options = options;
		this.file = path.join(options.dataDir, "timers.json");
		if (existsSync(this.file)) {
			let saved;
			try { saved = JSON.parse(readFileSync(this.file, "utf8")); } catch { saved = undefined; }
			// Like the registry: refuse to start rather than overwrite timers it cannot read.
			if (saved?.version !== 1 || !Array.isArray(saved.timers)) throw new Error(`Unreadable hub timers: ${this.file}`);
			this.timers = saved.timers;
		}
	}

	private save() { writeJsonAtomic(this.file, { version: 1, timers: this.timers }); this.emit("change"); }
	list(session?: string): Timer[] { return structuredClone(this.timers.filter(t => !session || t.session === session)); }

	add(input: TimerInput, now = Date.now()): Timer {
		const record = this.options.registry.get(input.session);
		if (!record?.sessionFile) throw fail("Timers need a hub session with a conversation.");
		if (input.kind === "message" ? !input.text?.trim() : input.kind === "script" ? !input.command?.trim() : true) throw fail("A message timer needs text; a script timer needs a command.");
		const dueAt = input.at ?? now + (input.inMinutes ?? input.everyMinutes ?? 0) * 60_000;
		if (!Number.isFinite(dueAt) || dueAt < now - 1000) throw fail("The time is in the past.");
		const every = input.everyMinutes === undefined ? undefined : input.everyMinutes * 60_000;
		// Script ticks cost no tokens, so they may poll every 10 s; message ticks are model turns.
		if (every !== undefined && input.kind === "script" && !(every >= MIN_SCRIPT_EVERY_MS)) throw fail("Repeating script timers run at most every 10 seconds.");
		if (every !== undefined && input.kind === "message" && !(every >= MIN_EVERY_MS)) throw fail("Repeating message timers run at most once a minute (D8).");
		const timer: Timer = { id: randomUUID(), session: record.id, sessionFile: record.sessionFile, kind: input.kind, dueAt, failures: 0, createdAt: now,
			...(input.kind === "message" ? { text: input.text!.trim() } : { command: input.command!.trim() }), ...(every ? { every } : {}) };
		if (every && input.kind === "message") {
			if (input.until !== undefined) timer.until = input.until;
			else timer.runsLeft = input.runs ?? DEFAULT_RUNS;
		}
		if (every && input.kind === "script") timer.expiresAt = now + SCRIPT_LIFETIME_MS;
		if (input.runs !== undefined && every) timer.runsLeft = input.runs;
		this.timers.push(timer); this.save();
		return structuredClone(timer);
	}

	cancel(id: string, reason = "cancelled"): boolean {
		const timer = this.timers.find(t => t.id === id);
		if (!timer) return false;
		this.timers = this.timers.filter(t => t !== timer); this.save();
		this.emit("ended", timer, reason);
		return true;
	}

	/** D15: /new and unstar end the conversation the timers were set for. */
	cancelSession(session: string, reason: string) { for (const timer of this.list(session)) this.cancel(timer.id, reason); }

	/** One pass: deliver waiting messages and run due timers. The hub calls it every few seconds; tests pass a clock. */
	async tick(now = Date.now()): Promise<void> {
		await Promise.all(this.timers.filter(t => !this.running.has(t.id)).map(async timer => {
			const record = this.options.registry.get(timer.session);
			// D15: the conversation is gone (unstar) or replaced (/new).
			if (!record) return this.cancel(timer.id, "the session was removed");
			if (record.sessionFile !== timer.sessionFile) return this.cancel(timer.id, "the session started a new conversation");
			if (timer.pending !== undefined) return this.guard(timer, () => this.deliverPending(timer));
			if ((timer.until !== undefined && now > timer.until) || (timer.expiresAt !== undefined && now > timer.expiresAt)) return this.cancel(timer.id, "expired");
			if (timer.dueAt > now) return;
			return this.guard(timer, () => timer.kind === "message" ? this.messageTick(timer, now) : this.scriptTick(timer, now));
		}));
	}

	private async guard(timer: Timer, work: () => Promise<unknown>) {
		this.running.add(timer.id);
		try { await work(); } finally { this.running.delete(timer.id); }
	}

	/** After a tick: a repeat moves on (from now, so a hub that was down fires once), a one-off ends. */
	private next(timer: Timer, now: number, result: string) {
		timer.lastRun = now; timer.lastResult = result;
		if (timer.runsLeft !== undefined) timer.runsLeft--;
		if (!timer.every || timer.runsLeft === 0) {
			if (timer.pending === undefined) return this.cancel(timer.id, timer.every ? "ran its last time" : "done");
			timer.every = undefined; timer.dueAt = Infinity; // ends once its waiting message is delivered
		} else timer.dueAt = Math.max(timer.dueAt + timer.every, now + timer.every);
		this.save();
	}

	private async messageTick(timer: Timer, now: number) {
		// D3 rule: a repeating message tick is skipped while the agent works, so ticks never stack.
		if (timer.every && this.options.host.busyReasons(timer.session).length) { timer.dueAt = now + timer.every; timer.lastResult = "skipped: busy"; return this.save(); }
		timer.pending = scheduledText(timer, timer.text!);
		this.next(timer, now, "sent");
		await this.deliverPending(timer);
	}

	private async scriptTick(timer: Timer, now: number) {
		const record = this.options.registry.get(timer.session)!;
		const result = await (this.options.run ?? runScript)(timer.command!, record.folder, undefined, hubEnv(timer.session));
		if (!this.timers.includes(timer)) return; // cancelled while the script ran
		if (result.code === CANCEL_EXIT) return this.cancel(timer.id, "the script cancelled it");
		if (result.code === 0 && !result.timedOut) {
			timer.failures = 0;
			if (!result.output) return this.next(timer, now, "quiet");
			// Printed output wakes the agent and ends the timer; the agent sets a new one if it wants (D3).
			timer.pending = scheduledText(timer, result.output); timer.every = undefined;
			this.next(timer, now, "woke the agent");
			return this.deliverPending(timer);
		}
		timer.failures++;
		const why = result.timedOut ? `timed out after ${SCRIPT_TIMEOUT_MS / 1000} s` : `exit ${result.code}`;
		if (timer.failures < MAX_FAILURES) return this.next(timer, now, `failed: ${why}`);
		timer.pending = scheduledText(timer, `the script \`${timer.command}\` failed ${MAX_FAILURES} times in a row and was stopped (${why}).${result.output ? `\n\n${result.output}` : ""}`);
		timer.every = undefined;
		this.next(timer, now, `stopped after ${MAX_FAILURES} failures`);
		return this.deliverPending(timer);
	}

	/** Resume a parked session (D5: only for a message), then send; a busy agent gets it as a follow-up. */
	private async deliverPending(timer: Timer) {
		const { host, registry } = this.options;
		if (registry.get(timer.session)?.state === "terminal") return; // D15: paused while a terminal holds it
		try {
			await host.resume(timer.session);
			const busy = host.busyReasons(timer.session).length > 0;
			await host.prompt(timer.session, timer.pending!, busy ? { streamingBehavior: "followUp" } : {});
		} catch (error) { timer.lastResult = `delivery failed: ${(error as Error).message}`; return this.save(); } // retried next tick
		this.emit("delivered", timer);
		timer.pending = undefined;
		if (timer.dueAt === Infinity) return this.cancel(timer.id, "done");
		this.save();
	}
}
