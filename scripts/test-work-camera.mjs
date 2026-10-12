#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const { runCameraProcess } = await createJiti(import.meta.url).import("../extensions/work-camera-process.ts");
const { cameraSettings, parseDshowDevices, cameraGrantExpiry, createCameraController } = await createJiti(import.meta.url).import("../extensions/work-camera.ts");
const { cameraRequestKey } = await createJiti(import.meta.url).import("../extensions/work-camera-state.ts");
const sandbox = mkdtempSync(join(tmpdir(), "work-camera-ui-"));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const projectDir = join(sandbox, "project");
const otherDir = join(sandbox, "other");
process.env.PI_CODING_AGENT_DIR = join(sandbox, "agent");
mkdirSync(projectDir); mkdirSync(otherDir);
try {
const printer = { id: "@device_pnp_printer", label: "Printer camera" };
const laptop = { id: "@device_pnp_laptop", label: "Laptop camera" };
const devices = parseDshowDevices([
	`[dshow] "Printer camera" (video)`, `[dshow] Alternative name "${printer.id}"`,
	`[dshow] "Printer camera" (video)`, `[dshow] Alternative name "@device_pnp_second"`,
	`[dshow] "Microphone" (audio)`, `[dshow] Alternative name "@device_pnp_microphone"`,
	`[dshow] "Laptop camera" (video)`, `[dshow] Alternative name "${laptop.id}"`,
].join("\n"));
assert.equal(devices.length, 3, "retain duplicate friendly names by distinct identity; never choose audio");
assert.deepEqual(devices[0], printer);
assert.equal(cameraSettings({}).enabled, false);
assert.equal(cameraSettings({ workOrchestrator: { camera: { enabled: true } } }).enabled, false);
for (const id of ["Printer camera", "@device_pnp_bad:audio=mic", "@device_pnp_bad\n", "@device_pnp_bad\"", "@device_pnp_" + "x".repeat(2048)])
	assert.equal(cameraSettings({ workOrchestrator: { camera: { enabled: true, device: { ...printer, id } } } }).enabled, false);

const previousTZ = process.env.TZ;
try {
	process.env.TZ = "America/New_York";
	const spring = Date.parse("2026-03-08T00:30:00-05:00");
	const autumn = Date.parse("2026-11-01T00:30:00-04:00");
	assert.equal(cameraGrantExpiry("day", spring, 1), Date.parse("2026-03-09T00:00:00-04:00"));
	assert.equal(cameraGrantExpiry("day", autumn, 1), Date.parse("2026-11-02T00:00:00-05:00"));
	assert.equal(cameraGrantExpiry("once", spring, 4000), spring + 4000);
	assert.equal(cameraGrantExpiry("hour", spring, 1), spring + 3600000);
	assert.equal(cameraGrantExpiry("48h", spring, 1), spring + 48 * 3600000);
	assert.throws(() => cameraGrantExpiry("forever", spring, 1));
} finally {
	if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ;
}

let project = {};
let enumerations = 0;
let writes = 0;
let choices = [];
let pending;
const listeners = new Map();
const controller = createCameraController({ on(name, fn) { listeners.set(name, fn); } }, {
	readProjectSettings() { return structuredClone(project); },
	writeProjectSettings(_cwd, settings) { project = settings; writes++; },
	async listDevices() { enumerations++; return [printer, laptop]; },
});
const widgets = new Map();
const theme = { fg: (color, text) => `${color}:${text}` };
const warning = () => widgets.get("camera-access")?.({}, theme).render(120)[0];
const ctx = { cwd: projectDir, mode: "tui", hasUI: true, ui: {
	workDialogsNative: true,
	theme,
	setWidget(key, value) { if (value) widgets.set(key, value); else widgets.delete(key); },
	notify() {},
	async select(_title, labels) {
		if (pending) { const fn = pending; pending = undefined; await fn(); }
		const target = choices.shift();
		return target ? labels.find(label => label.includes(target)) : undefined;
	},
} };
for (const mode of ["rpc", "print", "json", undefined]) {
	await assert.rejects(controller.menu({ ...ctx, mode }), /local TUI/);
	await assert.rejects(controller.choosePermission({ ...ctx, mode }, { summary: "Capture", deadlineMs: 10000 }), /local TUI/);
	await assert.rejects(controller.permission({ ...ctx, mode }), /local TUI/);
}
await assert.rejects(controller.menu({ ...ctx, hasUI: false }), /local TUI/);
assert.equal(writes, 0);
assert.equal(enumerations, 0, "unsupported modes cannot even use the selection menu");
choices = ["Selected camera", printer.label];
await controller.menu(ctx);
assert.equal(enumerations, 1);
assert.equal(controller.settings(ctx).enabled, false, "selection alone never enables capture");
assert.deepEqual(controller.settings(ctx).device, printer);
choices = ["Camera: OFF"];
await controller.menu(ctx);
assert.equal(controller.settings(ctx).enabled, true, "only explicit local menu selection enables the project");
choices = ["Selected camera", laptop.label];
await controller.menu(ctx);
assert.equal(controller.settings(ctx).enabled, false, "switching device disables access");
assert.equal(controller.settings(ctx).device.id, laptop.id);
assert.equal(existsSync(join(process.env.PI_CODING_AGENT_DIR, "camera")), false, "settings-only selection/enable/revocation never creates permission resources");
choices = ["Camera: OFF"];
await controller.menu(ctx);

choices = ["Deny camera access"];
assert.equal(await controller.choosePermission(ctx, { summary: "Capture 1 still", deadlineMs: 10000 }), undefined);
choices = ["One hour"];
const grant = await controller.choosePermission(ctx, { summary: "Capture 1 still", deadlineMs: 10000 });
assert.equal(grant.kind, "time");
assert.equal(grant.device.id, laptop.id);
assert.ok(grant.expiresAt > Date.now() + 3590000);
assert.equal((await controller.permission(ctx)).id, grant.id, "approved time grant is persisted separately from settings");
const restarted = createCameraController({ on() {} }, {
	readProjectSettings() { return structuredClone(project); },
	writeProjectSettings() { throw new Error("permission restore must not write project settings"); },
	async listDevices() { throw new Error("permission restore must not enumerate/open hardware"); },
});
assert.equal((await restarted.permission(ctx)).id, grant.id, "time grant survives reload without starting acquisition");
await listeners.get("session_shutdown")();
assert.equal((await restarted.permission(ctx)).id, grant.id, "orderly shutdown preserves the unexpired time grant");
for (const mode of ["rpc", "print", "json"]) await assert.rejects(restarted.permission({ ...ctx, mode }), /local TUI/);
assert.equal(await restarted.permission({ ...ctx, cwd: otherDir }), undefined, "saved permission cannot move projects");
const heldLock = join(process.env.PI_CODING_AGENT_DIR, "camera", "state.lock");
choices = ["48 hours"];
pending = () => {
	writeFileSync(heldLock, "another metadata transaction");
	setTimeout(() => { listeners.get("session_before_switch")(); rmSync(heldLock); }, 30);
};
await assert.rejects(controller.choosePermission(ctx, { summary: "Capture after switch", deadlineMs: 10000 }), /changed while permission/);
assert.equal((await restarted.permission(ctx)).id, grant.id, "a switch during the metadata lock wait cannot persist abandoned consent");
choices = ["One bounded watch"];
const once = await controller.choosePermission(ctx, { summary: "Watch 10 seconds", watch: true, deadlineMs: 10000 });
assert.equal(once.kind, "once");
assert.ok(once.expiresAt <= Date.now() + 10000);
await assert.rejects(controller.choosePermission(ctx, { summary: "Unbounded", deadlineMs: Infinity }), /bounded deadline/);

for (const event of ["session_shutdown", "session_before_switch", "session_before_fork", "session_before_tree", "session_tree"]) {
	choices = ["One hour"];
	pending = () => listeners.get(event)();
	await assert.rejects(controller.choosePermission(ctx, { summary: "Capture", deadlineMs: 10000 }), /changed while permission/);
}
choices = ["Camera: ON"];
pending = () => listeners.get("session_before_switch")();
const before = writes;
await assert.rejects(controller.menu(ctx), /session changed/);
assert.equal(writes, before, "abandoned menu cannot mutate settings in an old session");
assert.equal(listeners.has("ask:answer"), false, "permission never subscribes to the remote-answer bus");
assert.equal(listeners.has("ask:pending"), false);
const request = (name, deadlineMs = 10000) => ({ summary: name, deadlineMs, requestKey: cameraRequestKey(name) });
choices = ["One hour"];
const owned = await controller.lease(ctx, request("Lifecycle test"));
await owned.guard();
assert.match(warning(), /^warning:CAMERA ARMED/);
await owned.begin();
assert.match(warning(), /^error:CAMERA CAPTURING/);
assert.ok(widgets.get("camera-access")({}, theme).render(10)[0].length <= 16, "ASCII warning fits narrow width before styling");
let confirmClosed;
owned.attachStop(() => new Promise(done => { confirmClosed = done; }));
const shutdown = listeners.get("session_shutdown")();
assert.equal(owned.signal.aborted, true, "shutdown aborts the owner before waiting for hardware release");
assert.match(warning(), /^error:CAMERA STOPPING/);
await assert.rejects(controller.lease(ctx, request("Overlap")), /already owns/);
assert.equal(typeof confirmClosed, "function");
confirmClosed();
await shutdown;
assert.equal(warning(), undefined, "warning clears only after closure");
await assert.rejects(owned.guard(), /cancelled|changed/);
const retry = await controller.lease(ctx, request("Release failure"));
await retry.begin();
let stops = 0;
retry.attachStop(async () => { if (++stops === 1) throw new Error("Backend still open"); });
await assert.rejects(retry.finish(), /Backend still open/);
assert.match(warning(), /^error:CAMERA STOPPING/);
await assert.rejects(controller.lease(ctx, request("Cannot steal failed release")), /already owns/);
await retry.finish();
assert.equal(stops, 2, "failed closure retains ownership and allows an explicit cleanup retry");
assert.equal(warning(), undefined);
await assert.rejects(controller.lease({ ...ctx, ui: { ...ctx.ui, setWidget: undefined } }, request("Missing UI")), /warning UI/);
const watching = await controller.lease(ctx, { ...request("Watch"), watch: true });
await watching.begin();
assert.match(warning(), /^error:CAMERA WATCHING/);
ctx.hasUI = false;
await assert.rejects(watching.guard(), /local TUI/);
await watching.finish();
ctx.hasUI = true;
assert.equal(warning(), undefined, "cleanup works after UI loss");
const interruptedSignal = new AbortController();
const interruptedOwner = await controller.lease(ctx, request("Tool interruption"), interruptedSignal.signal);
let interruptedStops = 0;
interruptedOwner.attachStop(async () => { interruptedStops++; });
interruptedSignal.abort();
await interruptedOwner.finish();
assert.equal(interruptedStops, 1);
const expired = await controller.lease(ctx, request("Bounded expiry", 30));
let expiredStops = 0;
expired.attachStop(async () => { expiredStops++; });
await new Promise(done => setTimeout(done, 70));
await expired.finish();
assert.equal(expired.signal.aborted, true);
assert.equal(expiredStops, 1, "owner deadline cancels and closes the callback once");
choices = ["Revoke camera permission"];
await controller.menu(ctx);
assert.equal(await restarted.permission(ctx), undefined, "native revoke invalidates persisted permission across controllers");
assert.equal(controller.settings(ctx).enabled, true, "revocation does not erase camera selection/configuration");
choices = ["One hour"];
pending = async () => { await new Promise(done => setTimeout(done, 30)); };
await assert.rejects(controller.choosePermission(ctx, { summary: "Expired declared request", deadlineMs: 10 }), /expired before approval/);
assert.equal(await controller.permission(ctx), undefined, "expired declared request does not persist a new time grant");
// Native process supervision tests use Node fixtures, never a camera or FFmpeg input.
const supervisorOwner = () => {
	const abort = new AbortController();
	let stop, released = false;
	const pids = [];
	return {
		signal: abort.signal, pids,
		async guard() { if (abort.signal.aborted) throw new Error("cancelled"); },
		async begin() {},
		attachStop(fn) { stop = fn; },
		async worker(workerPid, childPid = 0) { pids.push([workerPid, childPid]); },
		async finish() { await stop(); released = true; },
		cancel() { abort.abort(); },
		get released() { return released; },
	};
};
choices = ["One hour"];
const repeatedOwner = await controller.lease(ctx, request("Declared spaced burst", 10000));
await runCameraProcess(repeatedOwner, process.execPath, ["-e", "process.stdout.write('one')"], { durationMs: 5000, maxBytes: 1024, keepLease: true });
assert.equal(repeatedOwner.signal.aborted, false, "hardware close between shots does not consume another grant");
assert.match(warning(), /^warning:CAMERA ARMED/);
await runCameraProcess(repeatedOwner, process.execPath, ["-e", "process.stdout.write('two')"], { durationMs: 5000, maxBytes: 1024, keepLease: true });
await repeatedOwner.finish();
assert.equal(warning(), undefined);
const normal = supervisorOwner();
const output = await runCameraProcess(normal, process.execPath, ["-e", "process.stdout.write('frame');"], { durationMs: 5000, maxBytes: 1024 });
assert.equal(output.stdout.toString(), "frame");
assert.equal(normal.released, true);
assert.ok(normal.pids.some(([, child]) => child > 0));
const streamed = supervisorOwner(); let streamedBytes = 0;
const streamingResult = await runCameraProcess(streamed, process.execPath, ["-e", "process.stdout.write(Buffer.alloc(1024*1024));"], { durationMs: 5000, maxBytes: 128 * 1024, onData(data) { streamedBytes += data.length; } });
assert.equal(streamedBytes, 1024 * 1024, "bounded chunks drain without retaining the whole stream");
assert.equal(streamingResult.stdout.length, 0);
const failure = supervisorOwner();
await assert.rejects(runCameraProcess(failure, process.execPath, ["-e", "process.exit(7)"], { durationMs: 5000, maxBytes: 1024 }), /failed/);
assert.equal(failure.released, true);
const overrun = supervisorOwner();
await assert.rejects(runCameraProcess(overrun, process.execPath, ["-e", "process.stdout.write('x'.repeat(4096));setInterval(()=>{},1000)"], { durationMs: 5000, maxBytes: 1024 }), /byte limit/);
assert.equal(overrun.released, true);
const cancelled = supervisorOwner();
const running = runCameraProcess(cancelled, process.execPath, ["-e", "setInterval(()=>{},1000)"], { durationMs: 5000, maxBytes: 1024 });
const waitUntil = async predicate => { const until = Date.now() + 8000; while (!predicate()) { if (Date.now() >= until) throw new Error("fixture readiness timed out"); await new Promise(done => setTimeout(done, 20)); } };
await waitUntil(() => cancelled.pids.some(([, child]) => child > 0));
cancelled.cancel();
await assert.rejects(running, /cancelled/);
assert.equal(cancelled.released, true);
const expiredProcess = supervisorOwner();
await assert.rejects(runCameraProcess(expiredProcess, process.execPath, ["-e", "setInterval(()=>{},1000)"], { durationMs: 1000, maxBytes: 1024 }), /deadline|expired/);
assert.equal(expiredProcess.released, true);
const gone = processId => { try { process.kill(processId, 0); return false; } catch (error) { return error.code === "ESRCH"; } };
// Abrupt parent death must leave the supervisor alive long enough to close its child.
const parentFixture = fileURLToPath(new URL("./fixtures/camera-parent.mjs", import.meta.url));
const parent = spawn(process.execPath, [parentFixture], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let identities = ""; parent.stdout.on("data", data => { identities += data; });
let parentError = ""; parent.stderr.on("data", data => { parentError += data; });
await waitUntil(() => identities.includes("\n"));
const [workerPid, childPid] = JSON.parse(identities.trim());
const parentClosed = new Promise(done => parent.on("close", done));
parent.kill("SIGKILL"); await parentClosed;
await waitUntil(() => gone(workerPid) && gone(childPid));
assert.equal(parentError, "");
const { createCameraImages } = await createJiti(import.meta.url).import("../extensions/work-camera-images.ts");
let imageTime = 1000;
const imageDirectory = join(sandbox, "images");
const images = createCameraImages({ directory: imageDirectory, now: () => imageTime, maxFiles: 2, maxBytes: 8 });
assert.equal(existsSync(imageDirectory), false, "unused storage allocates nothing");
images.cleanup(projectDir);
assert.equal(existsSync(imageDirectory), false);
const firstFrame = images.save(projectDir, Buffer.from("test"), "jpg");
const secondFrame = images.save(projectDir, Buffer.from("more"), "png");
assert.equal(images.read(projectDir, firstFrame.id).data.toString(), "test");
assert.throws(() => images.save(projectDir, Buffer.from("x"), "jpg"), /budget/);
images.drop(projectDir, secondFrame.id);
assert.equal(images.read(projectDir, secondFrame.id), undefined);
const missing = images.save(projectDir, Buffer.from("gone"), "jpg");
rmSync(join(imageDirectory, `camera-${missing.id}.jpg`));
assert.equal(images.read(projectDir, missing.id), undefined, "missing source is never recaptured");
writeFileSync(join(imageDirectory, "personal.jpg"), "leave alone");
imageTime = firstFrame.expiresAt;
images.cleanup(projectDir);
assert.equal(images.read(projectDir, firstFrame.id), undefined);
assert.equal(existsSync(join(imageDirectory, "personal.jpg")), true);
writeFileSync(join(imageDirectory, "images.lock"), ""); // another Pi session mid-sweep
images.cleanup(projectDir);
assert.throws(() => images.save(projectDir, Buffer.from("x"), "jpg"), /busy/, "acquisition still fails closed on a held lock");
rmSync(join(imageDirectory, "images.lock"));
assert.throws(() => images.drop(projectDir, "../personal"), /identity/);
const corrupt = images.save(projectDir, Buffer.from("test"), "jpg");
writeFileSync(join(imageDirectory, `camera-${corrupt.id}.json`), "broken");
assert.throws(() => images.cleanup(projectDir), /Corrupt/);
assert.equal(existsSync(join(imageDirectory, `camera-${corrupt.id}.jpg`)), true, "corrupt metadata never authorizes deletion");
const inside = createCameraImages({ directory: join(projectDir, "bad-images") });
assert.throws(() => inside.save(projectDir, Buffer.from("x"), "jpg"), /outside/);
assert.equal(existsSync(join(projectDir, "bad-images")), false);
const redirect = join(sandbox, "redirect");
symlinkSync(projectDir, redirect, process.platform === "win32" ? "junction" : "dir");
const redirected = createCameraImages({ directory: join(redirect, "bad-images") });
assert.throws(() => redirected.save(projectDir, Buffer.from("x"), "jpg"), /outside/);
assert.equal(existsSync(join(projectDir, "bad-images")), false, "redirected ancestors cannot allocate inside the repository");
images.stop();
const { cameraCaptureRequest, cameraModes, cameraStillArgs, cameraPNGSize, createCameraCapture } = await createJiti(import.meta.url).import("../extensions/work-camera-capture.ts");
assert.throws(() => cameraCaptureRequest({ count: 9 }), /bounded/);
assert.throws(() => cameraCaptureRequest({ crop: { x: -1, y: 0, width: 1, height: 1 } }), /crop/);
assert.throws(() => cameraCaptureRequest({ width: 20 }), /size/);
assert.throws(() => cameraCaptureRequest({ fullSize: true, width: 20, height: 10 }), /Full-size/);
const modes = cameraModes("[dshow] pixel_format=yuyv422 min s=640x480 fps=5 max s=1280x720 fps=30\n[dshow] vcodec=mjpeg min s=1920x1080 fps=30 max s=1920x1080 fps=30");
assert.equal(modes[0].width, 1920);
const overview = cameraStillArgs(printer.id, modes[0], cameraCaptureRequest({}));
assert.equal(overview.width, 1024);
assert.ok(overview.args.includes(`video=${printer.id}`));
assert.ok(!overview.args.some(arg => arg.includes("audio=")));
assert.equal(cameraStillArgs(printer.id, modes[0], cameraCaptureRequest({ fullSize: true })).width, 1920);
assert.throws(() => cameraStillArgs(printer.id, modes[0], cameraCaptureRequest({ crop: { x: 1900, y: 0, width: 30, height: 1 } })), /outside/);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGNcAAAAASUVORK5CYII=", "base64");
assert.deepEqual(cameraPNGSize(png), { width: 1, height: 1 });
assert.throws(() => cameraPNGSize(png.subarray(0, 30)), /complete/);
const retained = createCameraImages({ directory: join(sandbox, "capture-images") });
let runCount = 0, leaseCount = 0;
const nativeOwner = supervisorOwner();
const fakeController = {
	images: retained, settings() { return { enabled: true, device: printer }; },
	async lease(_ctx, captureRequest) { assert.ok(captureRequest.summary.includes("full field of view")); leaseCount++; return { ...nativeOwner, async finish() {} }; },
};
const fakeCapture = createCameraCapture(fakeController, {
	async resolveFFmpeg() { return process.execPath; }, async devices() { return [printer]; },
	async run(_owner, _exe, args) { runCount++; return args.includes("-list_options") ? { stdout: Buffer.alloc(0), stderr: "pixel_format=rgb24 min s=1x1 fps=30 max s=1x1 fps=30", code: 1, receivedAt: 0 } : { stdout: png, stderr: "", code: 0, receivedAt: 12345 }; },
});
const burst = await fakeCapture.capture(ctx, { count: 2, intervalMs: 0 });
assert.equal(burst.frames.length, 2);
assert.notEqual(burst.frames[0].id, burst.frames[1].id, "identical pixels remain distinct captures");
assert.equal(leaseCount, 1, "one-use authorization covers exactly the declared burst");
assert.equal(runCount, 3, "mode query and two finite captures, no catch-up saves");
assert.equal(burst.frames[0].capture.timestamp, 12345);
assert.equal(fakeCapture.recover({ ...ctx, cwd: otherDir }, burst.frames[0].id), undefined, "history cannot move between projects");
assert.deepEqual(fakeCapture.recover(ctx, burst.frames[0].id).data, png);
for (const mode of ["rpc", "print", "json"]) await assert.rejects(fakeCapture.capture({ ...ctx, mode }, {}), /local TUI/);
const noFallback = createCameraCapture(fakeController, { async resolveFFmpeg() { return process.execPath; }, async devices() { return [laptop]; }, async run() { assert.fail("never opens another camera"); } });
await assert.rejects(noFallback.capture(ctx, {}), /identity changed|unavailable/);
retained.drop(projectDir, burst.frames[0].id);
assert.equal(fakeCapture.recover(ctx, burst.frames[0].id), undefined);
const { cameraTools } = await createJiti(import.meta.url).import("../extensions/work-camera-tools.ts");
const recovery = cameraTools(fakeController).find(tool => tool.name === "camera_recover");
const recovered = await recovery.execute("test", { frame: burst.frames[1].id }, undefined, undefined, ctx);
assert.equal(recovered.content.filter(part => part.type === "image").length, 1);
const { stripProcessedPayloads } = await import("../extensions/work-models.ts");
const conversation = [{ role: "toolResult", toolName: "camera_recover", toolCallId: "test", timestamp: 1, ...recovered }];
const stripped = stripProcessedPayloads(conversation, { imageBeforeTimestamp: Infinity });
assert.ok(!stripped[0].content.some(part => part.type === "image"));
assert.ok(stripped[0].content.some(part => part.type === "text" && part.text.includes(burst.frames[1].id)), "manifest survives pixel stripping");
const { createVisionBridge } = await import("../extensions/work-vision.ts");
const bridge = createVisionBridge();
const projected = bridge.project(conversation);
assert.ok(projected.messages[0].content.some(part => part.type === "text" && part.text.includes("another model's interpretation")));
assert.ok(projected.messages[0].content.some(part => part.type === "text" && part.text.includes(burst.frames[1].id)));
retained.drop(projectDir, burst.frames[1].id);
const unavailable = await recovery.execute("test", { frame: burst.frames[1].id }, undefined, undefined, ctx);
assert.equal(unavailable.content.some(part => part.type === "image"), false);
assert.equal(unavailable.details.outcome, "unavailable");
let partialShots = 0;
const partialCapture = createCameraCapture(fakeController, {
	async resolveFFmpeg() { return process.execPath; }, async devices() { return [printer]; },
	async run(_owner, _exe, args) { if (args.includes("-list_options")) return { stderr: "pixel_format=rgb24 min s=1x1 fps=30 max s=1x1 fps=30" }; if (++partialShots === 2) throw new Error("fixture capture fault"); return { stdout: png, receivedAt: 456 }; },
});
const partial = await partialCapture.capture(ctx, { count: 2, intervalMs: 0 });
assert.equal(partial.outcome, "partial");
assert.equal(partial.frames.length, 1);
assert.match(partial.failure, /fixture capture fault/);
retained.stop();
const { createCameraDetector, cameraRawFrames, runCameraAcquisition } = await createJiti(import.meta.url).import("../extensions/work-camera-detect.ts");
const detector = createCameraDetector({ width: 16, height: 16, tileSize: 2, staleMs: 500, settleMs: 0 });
const off = Buffer.alloc(16 * 16 * 3), on = Buffer.from(off); on.fill(255, 0, 3);
assert.equal(detector.frame(off, 1000, 0).type, "ready");
const led = detector.frame(on, 1050, 50);
assert.equal(led.type, "change", "small LED survives a mostly unchanged frame");
assert.deepEqual(led.changedBox, { x: 0, y: 0, width: 2, height: 2 }, "change reports where it happened");
assert.equal(detector.frame(off, 1100, 100).type, "change");
assert.equal(detector.frame(on, 1150, 150).type, "change", "on-off-on preserves every qualifying capture");
assert.equal(detector.stats().sequence, 4);
assert.throws(() => detector.assertFresh(651), /stalled/);
assert.throws(() => detector.frame(off, 2000, 1000), /stalled/, "a delayed incoming frame cannot retroactively establish uninterrupted quiet");
const warming = createCameraDetector({ width: 2, height: 2, settleMs: 200, maxSettleMs: 1000 });
assert.equal(warming.frame(Buffer.alloc(12, 10), 1000, 0).type, "warming");
assert.equal(warming.frame(Buffer.alloc(12, 12), 1100, 100).type, "warming", "auto-exposure drift restarts the stability window");
assert.equal(warming.frame(Buffer.alloc(12, 12), 1250, 250).type, "warming");
const settledReady = warming.frame(Buffer.alloc(12, 12), 1300, 300);
assert.deepEqual([settledReady.type, settledReady.settled, settledReady.warmupMs], ["ready", true, 300], "ready only after a stable picture");
const busy = createCameraDetector({ width: 2, height: 2, settleMs: 200, maxSettleMs: 400 });
for (let step = 0; step < 4; step++) assert.equal(busy.frame(Buffer.alloc(12, step * 40), 1000 + step * 100, step * 100).type, "warming");
const capped = busy.frame(Buffer.alloc(12, 200), 1400, 400);
assert.deepEqual([capped.type, capped.settled], ["ready", false], "continuous activity cannot block readiness forever and is reported unsettled");
assert.throws(() => createCameraDetector({ width: 2, height: 2, maxSettleMs: 15000 }), /Invalid/, "warm-up stays under the 15 s readiness ceiling");
const drift = createCameraDetector({ width: 2, height: 2, settleMs: 0 });
drift.frame(Buffer.alloc(12), 1000, 0);
assert.equal(drift.frame(Buffer.alloc(12, 3), 1010, 10).type, "sample", "sensor noise does not qualify");
assert.equal(drift.frame(Buffer.alloc(12, 20), 1020, 20).type, "sample");
const exposure = drift.frame(Buffer.alloc(12, 40), 1030, 30);
assert.equal(exposure.type, "change", "gradual change accumulates against last qualifying baseline");
assert.equal(exposure.possibleExposureShift, true, "global exposure changes are flagged, not silently suppressed");
const ordered = [];
const assembly = cameraRawFrames(2, 2, (frame, timestamp) => ordered.push([Buffer.from(frame), timestamp]));
assembly.push(Buffer.alloc(5, 1), 1);
assembly.push(Buffer.concat([Buffer.alloc(7, 1), Buffer.alloc(12, 2)]), 2);
assert.deepEqual(ordered.map(([frame]) => frame[0]), [1, 2]);
assembly.finish();
assembly.push(Buffer.alloc(1), 3);
assert.throws(() => assembly.finish(), /partial frame/);
const acquisitionSamples = [];
await runCameraAcquisition(ctx, fakeController, { width: 1, height: 1, deadlineMs: 2000, settleMs: 0, summary: "full field of view detector fixture" }, { owner() {}, sample(sample) { acquisitionSamples.push(sample); } }, undefined, {
	async resolveFFmpeg() { return process.execPath; }, async devices() { return [printer]; },
	async run(_owner, _exe, args, options) {
		if (args.includes("-list_options")) return { stderr: "pixel_format=rgb24 min s=1x1 fps=30 max s=1x1 fps=30" };
		assert.ok(args.includes("rawvideo")); assert.ok(!args.includes("-frames:v"));
		options.onData(Buffer.alloc(3), 1000); options.onData(Buffer.alloc(3, 255), 1100); options.onData(Buffer.alloc(3), 1200);
	},
});
assert.deepEqual(acquisitionSamples.map(sample => sample.type), ["ready", "change", "change"]);
retained.stop();
const { cameraRGBPNG, createCameraRetention } = await createJiti(import.meta.url).import("../extensions/work-camera-retain.ts");
const encoded = cameraRGBPNG(Buffer.from([10, 20, 30]), 1, 1);
assert.deepEqual(cameraPNGSize(encoded), { width: 1, height: 1 });
const { inflateSync } = await import("node:zlib");
const idatSize = encoded.readUInt32BE(33);
assert.deepEqual(inflateSync(encoded.subarray(41, 41 + idatSize)), Buffer.from([0, 10, 20, 30]), "encoded triggering pixels are unchanged");
let retentionClock = 0;
const watchImages = createCameraImages({ directory: join(sandbox, "watch-images"), now: () => retentionClock });
const policy = createCameraRetention(watchImages, projectDir);
const geometry = { width: 1, height: 1 };
const observation = (time, sequence, type = "change") => ({ type, raw: Buffer.from([sequence % 255, 0, 0]), sequence, receivedAt: time, lastMonotonic: time, lastChange: time });
assert.equal(policy.event(observation(0, 0, "ready"), geometry), undefined, "readiness is not post-readiness activity");
for (let n = 0; n < 25; n++) policy.event(observation(n * 50, n), geometry);
assert.equal(policy.initial().length, 20);
assert.equal(policy.stats().stageSaves[0], 20);
assert.ok(policy.event(observation(7000, 30), geometry), "stage clocks advance even after initial cap fills");
for (let n = 0; n < 20; n++) policy.event(observation(130000 + n * 60000, 40 + n), geometry);
assert.ok(policy.stats().replacements > 0);
assert.equal(policy.frames().length, 28, "protected initial plus bounded rolling tail");
const finalEvidence = policy.finish(observation(1400000, 80, "sample"), geometry);
assert.equal(finalEvidence.capture.retainedAs, "final");
assert.equal(policy.frames().length, 29);
assert.equal(policy.finish(observation(1500000, 81), geometry).id, finalEvidence.id, "final slot is one-shot");
retentionClock = 24 * 60 * 60 * 1000;
watchImages.cleanup(projectDir);
assert.ok(policy.initial().every(frame => frame.availability === "unavailable"), "long watches retain metadata, never expired initial pixels");
assert.equal(policy.stats().savedCount, 42);
const lifetime = createCameraRetention(watchImages, projectDir);
for (let n = 0; n < 400; n++) lifetime.event(observation(n * 60000, n), geometry);
assert.equal(lifetime.stats().savedCount, 255, "whole-watch saves are bounded even when old tail files are deleted");
assert.ok(lifetime.stats().dropped > 0);
assert.ok(lifetime.finish(observation(30000000, 401, "sample"), geometry), "final evidence has a reserved count/byte slot");
assert.equal(lifetime.stats().savedCount, 256);
watchImages.stop();
const { createCameraWatch } = await createJiti(import.meta.url).import("../extensions/work-camera-watch.ts");
let idle = false, session = "watch-session", sampleCallback, closeStream, watchStops = 0;
const watchListeners = new Map(), wakeMessages = [];
const watchCtx = { ...ctx, isIdle() { return idle; }, sessionManager: { getSessionId() { return session; } } };
const watchController = { images: watchImages };
const watcher = createCameraWatch({ on(event, fn) { watchListeners.set(event, fn); }, sendMessage(message) { wakeMessages.push(message); } }, watchController, {
	async acquire(_ctx, _controller, _input, callbacks, signal) {
		let closed = false;
		const done = new Promise(resolve => { closeStream = resolve; });
		callbacks.owner({ lease: { expiresAt: Date.now() + 10000 }, current() {}, cancel() { closeStream(); }, async finish() { if (!closed) { closed = true; watchStops++; } closeStream(); } });
		sampleCallback = (sample) => callbacks.sample(sample, geometry);
		callbacks.sample(observation(0, 0, "ready"), geometry);
		signal.addEventListener("abort", closeStream, { once: true });
		await done;
	},
});
const watchReady = await watcher.start(watchCtx, { deadlineMs: 10000, quietMs: 500 });
assert.equal(watchReady.outcome, "ready", "tool returns only after baseline readiness");
sampleCallback(observation(10, 1));
sampleCallback({ ...observation(2200, 2, "sample"), lastChange: 2100 });
assert.equal(wakeMessages.length, 0, "no native busy queue receives stale images");
sampleCallback({ ...observation(3000, 3, "sample"), lastChange: 2200 });
await waitUntil(() => watchStops === 1);
const coalesced = await watchListeners.get("agent_before_settle")({ outcome: "completed" }, watchCtx);
assert.equal(coalesced.entries.length, 1);
assert.equal(coalesced.entries[0].details.outcome, "quiet");
assert.equal(coalesced.continue, true);
assert.equal(coalesced.entries[0].content.filter(part => part.type === "image").length, 2, "early + final coalesce without polling");
idle = true;
await watcher.start(watchCtx, { deadlineMs: 10000, quietMs: 500 });
sampleCallback(observation(10, 1));
sampleCallback({ ...observation(2200, 2, "sample"), lastChange: 2100 });
assert.equal(wakeMessages.length, 1);
const initialIDs = wakeMessages[0].details.frames.map(frame => frame.id);
sampleCallback({ ...observation(3000, 3, "sample"), lastChange: 2200 });
await waitUntil(() => wakeMessages.length === 2);
assert.ok(wakeMessages[1].details.frames.every(frame => !initialIDs.includes(frame.id)), "protected initial frames are never duplicated in final delivery");
assert.equal(wakeMessages[1].details.outcome, "quiet");
idle = false;
await watcher.start(watchCtx, { deadlineMs: 10000, quietMs: 500 });
sampleCallback(observation(10, 1));
sampleCallback({ ...observation(2200, 2, "sample"), lastChange: 2100 });
await watchListeners.get("agent_before_settle")({ outcome: "aborted" }, watchCtx);
assert.equal(await watchListeners.get("agent_before_settle")({ outcome: "completed" }, watchCtx), undefined, "Escape cannot restart an abandoned conversation");
await watcher.start(watchCtx, { deadlineMs: 10000, quietMs: 500 });
sampleCallback(observation(10, 1));
sampleCallback({ ...observation(2200, 2, "sample"), lastChange: 2100 });
await watchListeners.get("session_before_tree")();
sampleCallback(observation(4000, 4));
assert.equal(wakeMessages.length, 2, "stale branch callbacks cannot wake a switched conversation");
idle = true;
await watcher.start(watchCtx, { deadlineMs: 20000, quietMs: 500, mode: "settled" });
sampleCallback({ ...observation(4000, 1, "sample"), lastChange: 0 });
assert.equal(wakeMessages.length, 2, "initial idle cannot finish an operation not yet visibly started");
sampleCallback(observation(4100, 2));
sampleCallback({ ...observation(4400, 3, "sample"), lastChange: 4100 });
sampleCallback(observation(4500, 4));
sampleCallback({ ...observation(4900, 5, "sample"), lastChange: 4500 });
assert.equal(wakeMessages.length, 2, "resumed activity resets quiet tracking");
sampleCallback({ ...observation(5100, 6, "sample"), lastChange: 4500 });
await waitUntil(() => wakeMessages.length === 3);
assert.equal(wakeMessages[2].details.outcome, "settled");
assert.equal(wakeMessages[2].content.filter(part => part.type === "image").length, 1);
assert.equal(wakeMessages[2].details.frames[0].capture.timestamp, 5100, "settled evidence is the actual fresh terminal frame");
assert.equal(wakeMessages[2].details.sampling.quietDurationMs, 600);
const cameraCustomMessage = { role: "custom", ...wakeMessages[2] };
const customProjection = bridge.project([cameraCustomMessage]);
assert.ok(cameraCustomMessage.content.some(part => part.type === "image"), "the saved wake keeps the actual settled image");
assert.ok(customProjection.messages[0].content.some(part => part.type === "text" && part.text.includes("another model's interpretation")), "camera wakes reach the model as image references");
const faultyWatch = createCameraWatch({ on() {}, sendMessage(message) { wakeMessages.push(message); } }, watchController, {
	async acquire(_ctx, _controller, _input, callbacks) { callbacks.owner({ lease: { expiresAt: Date.now() + 1000 }, current() {}, async finish() {} }); callbacks.sample(observation(0, 0, "ready"), geometry); throw new Error("fixture disconnected"); },
});
await faultyWatch.start(watchCtx, { deadlineMs: 2000, mode: "settled" });
await waitUntil(() => wakeMessages.length === 4);
assert.equal(wakeMessages[3].details.outcome, "partial:fault", "disconnect cannot yield settled success");
assert.match(wakeMessages[3].details.failure, /disconnected/);
let releaseFails = true;
const releaseWatch = createCameraWatch({ on() {}, sendMessage(message) { wakeMessages.push(message); } }, watchController, {
	async acquire(_ctx, _controller, _input, callbacks) { callbacks.owner({ lease: { expiresAt: Date.now() + 1000 }, current() {}, async finish() { if (releaseFails) throw new Error("fixture release unconfirmed"); } }); callbacks.sample(observation(0, 0, "ready"), geometry); throw new Error("fixture stream ended"); },
});
await releaseWatch.start(watchCtx, { deadlineMs: 2000, mode: "settled" });
await waitUntil(() => wakeMessages.length === 5);
assert.equal(wakeMessages[4].details.outcome, "partial:fault");
await assert.rejects(releaseWatch.stop(), /release unconfirmed/, "stop cannot claim confirmed closure after a failure");
releaseFails = false;
await releaseWatch.stop();
let revoked = false;
const revokeWatch = createCameraWatch({ on() {}, sendMessage(message) { wakeMessages.push(message); } }, watchController, {
	async acquire(_ctx, _controller, _input, callbacks) {
		callbacks.owner({ lease: { expiresAt: Date.now() + 10000 }, current() { if (revoked) throw new Error("revoked"); }, cancel() {}, async finish() {} });
		callbacks.sample(observation(0, 0, "ready"), geometry);
		callbacks.sample(observation(10, 1), geometry);
		revoked = true;
		throw new Error("fixture revoked by settings");
	},
});
await revokeWatch.start(watchCtx, { deadlineMs: 10000 });
await waitUntil(() => wakeMessages.length === 6);
assert.equal(wakeMessages[5].details.outcome, "partial:revoked", "user revocation still wakes the model");
assert.equal(wakeMessages[5].content.filter(part => part.type === "image").length, 0, "no pixels are delivered after revocation");
assert.match(wakeMessages[5].details.failure, /revoked/);
watchImages.stop();
console.log("ok - camera metadata, project opt-in, persistent local consent, stale-dialog fences and owned cancellation/release (no hardware)");
} finally {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	rmSync(sandbox, { recursive: true, force: true });
}
