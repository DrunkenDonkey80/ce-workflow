// One Pi session as a `pi --mode rpc` child process (D7). LF-delimited JSONL per Pi docs/rpc.md "Framing".
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type RpcRecord = { type: string; id?: string; [key: string]: any };
export type RpcExit = { code: number | null; signal: string | null; stderr: string };
export type RpcOptions = { cwd: string; args?: string[]; env?: Record<string, string>; command?: string[] };

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
export const stripAnsi = (text: string) => text.replace(ANSI, "");
export const agentDir = () => process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
// Use managed launchers by absolute path: login services do not inherit the shell's PATH.
export const defaultCommand = () => {
	const bin = path.join(agentDir(), "bin"), legacy = path.join(bin, "pi-launcher.js"), launcher = path.join(bin, "pi");
	if (existsSync(legacy)) return [process.execPath, legacy];
	if (process.platform !== "win32" && existsSync(launcher)) return [launcher];
	return ["pi"];
};

export class RpcChild extends EventEmitter {
	readonly options: RpcOptions;
	process: ChildProcessWithoutNullStreams | undefined;
	exited: Promise<RpcExit> | undefined;
	stderrTail = "";
	private pending = new Map<string, { resolve: (r: RpcRecord) => void; reject: (e: Error) => void }>();
	private nextId = 0;
	private chunks: Buffer[] = [];
	private models: Promise<RpcRecord> | undefined;

	constructor(options: RpcOptions) { super(); this.options = options; }

	start() {
		const [command, ...prefix] = this.options.command ?? defaultCommand();
		const child = spawn(command, [...prefix, "--mode", "rpc", ...(this.options.args ?? [])], {
			cwd: this.options.cwd, env: { ...process.env, ...this.options.env }, stdio: "pipe", windowsHide: true,
		});
		this.process = child;
		child.stdout.on("data", (chunk: Buffer) => this.read(chunk));
		child.stderr.on("data", (chunk: Buffer) => { this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-4000); });
		child.stdin.on("error", () => {}); // EPIPE after a crash surfaces through "exit" instead.
		this.exited = new Promise(resolve => {
			const finish = (code: number | null, signal: string | null) => {
				const exit = { code, signal, stderr: this.stderrTail };
				const error = new Error(`Pi exited (code ${code ?? signal}) before answering.${this.stderrTail ? ` ${this.stderrTail.trim().slice(-300)}` : ""}`);
				for (const waiter of this.pending.values()) waiter.reject(error);
				this.pending.clear();
				this.emit("exit", exit); resolve(exit);
			};
			child.on("exit", finish);
			child.on("error", error => { this.stderrTail += String(error.message); finish(null, "spawn-error"); });
		});
		return this;
	}

	private read(chunk: Buffer) {
		let start = 0, index;
		while ((index = chunk.indexOf(10, start)) >= 0) {
			this.chunks.push(chunk.subarray(start, index));
			const line = Buffer.concat(this.chunks).toString("utf8").replace(/\r$/, "");
			this.chunks = []; start = index + 1;
			if (line.trim()) this.record(line);
		}
		if (start < chunk.length) this.chunks.push(chunk.subarray(start));
	}

	private record(line: string) {
		let record: RpcRecord;
		try { record = JSON.parse(line); } catch { this.emit("noise", line); return; }
		if (record.type === "response" && record.id && this.pending.has(record.id)) {
			const waiter = this.pending.get(record.id)!; this.pending.delete(record.id); waiter.resolve(record); return;
		}
		if (record.type === "extension_ui_request") {
			if (typeof record.statusText === "string") record.statusText = stripAnsi(record.statusText);
			this.emit("ui", record); return;
		}
		this.emit("event", record);
	}

	private write(value: unknown) {
		if (!this.process || this.process.exitCode !== null || this.process.stdin.destroyed) throw new Error("Pi is not running.");
		this.process.stdin.write(JSON.stringify(value) + "\n");
	}

	/** Correlated by id; responses may arrive in any order (F6). Rejects if Pi exits first. */
	send(command: RpcRecord): Promise<RpcRecord> {
		const id = `h${++this.nextId}`;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			try { this.write({ ...command, id }); } catch (error) { this.pending.delete(id); reject(error as Error); }
		});
	}

	respondUi(id: string, response: { value?: string; confirmed?: boolean; cancelled?: boolean }) {
		this.write({ type: "extension_ui_response", id, ...response });
	}

	/** The model list is about 250 KB (F5): fetch once per child. */
	availableModels() { return this.models ??= this.send({ type: "get_available_models" }); }

	/** Closing stdin is Pi's orderly shutdown (F2); kill only after the grace period. */
	async stop(graceMs = 15000): Promise<RpcExit> {
		if (!this.process || !this.exited) throw new Error("Pi was never started.");
		if (this.process.exitCode === null && !this.process.stdin.destroyed) this.process.stdin.end();
		const timer = setTimeout(() => this.process?.kill(), graceMs);
		try { return await this.exited; } finally { clearTimeout(timer); }
	}
}
