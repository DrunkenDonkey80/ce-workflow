import { execFile, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export async function resolveCameraFFmpeg(): Promise<string> {
	if (process.platform !== "win32") throw new Error("Native camera acquisition requires Windows DirectShow.");
	return new Promise((resolve, reject) => {
		execFile("where.exe", ["ffmpeg.exe"], { windowsHide: true, timeout: 5000, maxBuffer: 16384 }, (error, stdout) => {
			if (error) return reject(new Error("Existing FFmpeg executable unavailable; no download or fallback."));
			const path = stdout.split(/\r?\n/).find(line => isAbsolute(line.trim()));
			try { if (!path) throw new Error("FFmpeg lookup returned no absolute executable."); resolve(realpathSync(path.trim())); }
			catch (error) { reject(error); }
		});
	});
}

type Owner = {
	signal: AbortSignal;
	guard(): Promise<void>;
	begin(): Promise<void>;
	attachStop(stop: () => Promise<void>): void;
	worker(workerPid: number, childPid?: number): Promise<void>;
	finish(): Promise<void>;
};
// Internal argument-vector API only; tool arguments never choose an executable or arbitrary arguments.
export async function runCameraProcess(owner: Owner, command: string, args: string[], { durationMs, maxBytes }: { durationMs: number; maxBytes: number }) {
	if (!isAbsolute(command) || !Array.isArray(args) || !args.every(arg => typeof arg === "string" && !arg.includes("\0")) ||
		!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > 172800000 ||
		!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 64 * 1024 * 1024) throw new Error("Invalid bounded camera subprocess request.");
	await owner.guard();
	const workerPath = fileURLToPath(new URL("./work-camera-worker.ts", import.meta.url));
	const jitiPath = createRequire(import.meta.url).resolve("jiti");
	const bootstrap = `require(${JSON.stringify(jitiPath)}).createJiti(${JSON.stringify(workerPath)}).import(${JSON.stringify(workerPath)}).catch(error => { console.error(error); process.exit(1); });`;
	const worker = spawn(process.execPath, ["-e", bootstrap], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
	let closed = false;
	let confirmed = false;
	let error: Error | undefined;
	let bytes = 0;
	const stdout: Buffer[] = [], stderr: Buffer[] = [];
	let resolveClosed: () => void;
	const closure = new Promise<void>(resolve => { resolveClosed = resolve; });
	let resolveResult: (result: { stdout: Buffer; stderr: string; code: number | null }) => void;
	let rejectResult: (error: Error) => void;
	const result = new Promise<{ stdout: Buffer; stderr: string; code: number | null }>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
	// Observe immediately: setup or metadata failure may occur before the caller can await result.
	void result.catch(() => {});
	const send = (message: Record<string, unknown>) => { if (worker.connected) worker.send(message, sendError => { if (sendError) error ??= sendError; }); };
	const stop = async () => {
		if (!closed) send({ type: "stop" });
		let timeout: ReturnType<typeof setTimeout>;
		try { await Promise.race([closure, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Camera subprocess closure unconfirmed; ownership retained for retry.")), 5000); })]); }
		finally { clearTimeout(timeout!); }
		if (!confirmed) throw new Error("Camera supervisor exited without confirming child closure; ownership retained.");
	};
	try { owner.attachStop(stop); }
	catch (error) { worker.disconnect(); throw error; }
	const abort = () => send({ type: "stop" });
	owner.signal.addEventListener("abort", abort, { once: true });
	const startedAt = performance.now();
	let ready = false;
	let started = false;
	const fault = (failure: Error) => { error ??= failure; send({ type: "stop" }); };
	let checking = false;
	const guardTimer = setInterval(() => {
		if (checking || closed) return;
		checking = true;
		void owner.guard().catch(fault).finally(() => { checking = false; });
		if (performance.now() - startedAt >= durationMs) fault(new Error("Camera subprocess deadline reached."));
	}, 100);
	worker.on("message", (message: any) => {
		if (message?.type === "ready" && !ready) {
			ready = true;
			void (async () => {
				await owner.worker(worker.pid!);
				await owner.guard();
				await owner.begin();
				const remaining = Math.floor(durationMs - (performance.now() - startedAt));
				if (remaining <= 0 || owner.signal.aborted) throw new Error("Camera subprocess request expired before start.");
				send({ type: "start", command, args, durationMs: remaining, maxBytes });
			})().catch(fault);
		} else if (message?.type === "started" && Number.isSafeInteger(message.pid) && message.pid > 0) {
			started = true;
			void owner.worker(worker.pid!, message.pid).catch(fault);
		} else if (message?.type === "fault") fault(new Error(String(message.message).slice(0, 512)));
		else if (message?.type === "closed") {
			confirmed = true;
			if (message.code !== 0 && !owner.signal.aborted) error ??= new Error(`Camera subprocess failed (${message.code ?? message.signal}).`);
		}
	});
	for (const [stream, buffers] of [[worker.stdout, stdout], [worker.stderr, stderr]] as const) stream!.on("data", (data: Buffer) => {
		bytes += data.length;
		if (bytes > maxBytes) return fault(new Error("Camera process output exceeded its byte limit."));
		buffers.push(data);
	});
	worker.on("error", failure => { error ??= failure; });
	worker.on("close", code => {
		closed = true; clearInterval(guardTimer); owner.signal.removeEventListener("abort", abort); resolveClosed!();
		if (!confirmed) error ??= new Error("Camera supervisor closed without confirming child release.");
		if (owner.signal.aborted) error ??= new Error("Camera subprocess cancelled.");
		if (!started) error ??= new Error("Camera subprocess never started.");
		if (error) rejectResult!(error); else resolveResult!({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString("utf8"), code });
	});
	if (owner.signal.aborted) abort();
	try { return await result; }
	finally { await owner.finish(); }
}
