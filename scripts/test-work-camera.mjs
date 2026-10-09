#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
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
const ctx = { cwd: projectDir, mode: "tui", hasUI: true, ui: {
	workDialogsNative: true,
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
await assert.rejects(restarted.permission({ ...ctx, mode: "rpc" }), /local TUI/);
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
let confirmClosed;
owned.attachStop(() => new Promise(done => { confirmClosed = done; }));
const shutdown = listeners.get("session_shutdown")();
assert.equal(owned.signal.aborted, true, "shutdown aborts the owner before waiting for hardware release");
await assert.rejects(controller.lease(ctx, request("Overlap")), /already owns/);
assert.equal(typeof confirmClosed, "function");
confirmClosed();
await shutdown;
await assert.rejects(owned.guard(), /cancelled|changed/);
const retry = await controller.lease(ctx, request("Release failure"));
let stops = 0;
retry.attachStop(async () => { if (++stops === 1) throw new Error("Backend still open"); });
await assert.rejects(retry.finish(), /Backend still open/);
await assert.rejects(controller.lease(ctx, request("Cannot steal failed release")), /already owns/);
await retry.finish();
assert.equal(stops, 2, "failed closure retains ownership and allows an explicit cleanup retry");
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
console.log("ok - camera metadata, project opt-in, persistent local consent, stale-dialog fences and owned cancellation/release (no hardware)");
} finally {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	rmSync(sandbox, { recursive: true, force: true });
}
