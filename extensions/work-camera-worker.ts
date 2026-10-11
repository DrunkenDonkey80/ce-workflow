import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";

// This short-lived supervisor owns one process, never a service or camera permission.
let child: ReturnType<typeof spawn> | undefined;
let closing = false;
let killTimer: ReturnType<typeof setTimeout> | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
let bytes = 0;
let limit = 0;
function report(message: Record<string, unknown>, done?: () => void) {
	if (process.connected) process.send!(message, () => done?.());
	else done?.();
}
function stop() {
	closing = true;
	if (!child) { report({ type: "closed", code: 0, signal: null }, () => { if (process.connected) process.disconnect!(); }); return; }
	child.kill();
	clearTimeout(killTimer);
	killTimer = setTimeout(() => child?.kill("SIGKILL"), 1000);
}
process.on("disconnect", stop);
process.on("SIGTERM", stop);
process.on("message", (message: any) => {
	if (message?.type === "stop") return stop();
	if (message?.type !== "start" || child || closing) return;
	if (typeof message.command !== "string" || !isAbsolute(message.command) || message.command.includes("\0") || !Array.isArray(message.args) || !message.args.every((arg: unknown) => typeof arg === "string" && !arg.includes("\0")) ||
		!Number.isSafeInteger(message.durationMs) || message.durationMs <= 0 || message.durationMs > 172800000 ||
		!Number.isSafeInteger(message.maxBytes) || message.maxBytes <= 0 || message.maxBytes > 64 * 1024 * 1024) return stop();
	limit = message.maxBytes;
	// IPC comes only from the owning parent; this internal API is never exposed as tool arguments.
	child = spawn(message.command, message.args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
	child.on("spawn", () => report({ type: "started", pid: child!.pid }));
	child.on("error", error => { report({ type: "fault", message: error.message }); });
	for (const [source, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]] as const) {
		source!.on("data", (data: Buffer) => {
			if (closing) return;
			if (!message.streamOutput || source === child?.stderr) bytes += data.length;
			if (bytes > limit || data.length > limit) { report({ type: "fault", message: "Camera process output exceeded its byte limit." }); stop(); return; }
			if (!target.write(data)) source!.pause();
		});
		target.on("drain", () => source!.resume());
	}
	child.on("close", (code, signal) => {
		clearTimeout(killTimer); clearTimeout(deadline);
		const finish = () => { child = undefined; if (process.connected) process.disconnect!(); };
		report({ type: "closed", code, signal }, finish);
	});
	deadline = setTimeout(() => { report({ type: "fault", message: "Camera process deadline reached." }); stop(); }, message.durationMs);
});
report({ type: "ready" });
