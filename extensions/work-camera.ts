import { execFile } from "node:child_process";
import { showListDialog } from "./work-dialogs.ts";
import { cameraProject, cameraRequestKey, createCameraState } from "./work-camera-state.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type CameraDevice = { id: string; label: string };
type ProjectSettings = {
	workOrchestrator?: { camera?: { enabled?: unknown; device?: { id?: unknown; label?: unknown } }; [key: string]: unknown };
	[key: string]: unknown;
};

// Permission controls only; acquisition is added after ownership, storage and warning safeguards.
export function cameraSettings(settings: ProjectSettings): { enabled: boolean; device?: CameraDevice } {
	const camera = settings?.workOrchestrator?.camera;
	const device = camera?.device;
	if (typeof device?.id !== "string" || typeof device.label !== "string" ||
		!/^@device_[a-z]+_/i.test(device.id) || device.id.length > 2048 || /[\x00-\x1f\x7f":]/.test(device.id) ||
		!device.label.length || device.label.length > 256 || /[\x00-\x1f\x7f]/.test(device.label)) return { enabled: false };
	return { enabled: camera?.enabled === true, device: { id: device.id, label: device.label } };
}

export function parseDshowDevices(stderr: string): CameraDevice[] {
	const devices: CameraDevice[] = [];
	let label;
	for (const line of stderr.split(/\r?\n/)) {
		const named = line.match(/"(.*)" \((video|audio)\)/);
		if (named) label = named[2] === "video" ? named[1].replace(/[\x00-\x1f\x7f]/g, "").slice(0, 256) : undefined;
		const alternative = line.match(/Alternative name "([^"]+)"/);
		if (label && alternative) {
			const device = { id: alternative[1], label };
			if (cameraSettings({ workOrchestrator: { camera: { device } } }).device &&
				!devices.some(item => item.id === device.id)) devices.push(device);
			label = undefined;
		}
	}
	return devices;
}

export function discoverCameras(): Promise<CameraDevice[]> {
	if (process.platform !== "win32") return Promise.reject(new Error("Camera capture currently requires Windows and an existing FFmpeg with DirectShow."));
	return new Promise<CameraDevice[]>((resolve, reject) => {
		execFile("ffmpeg", ["-hide_banner", "-nostdin", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
			{ timeout: 15000, maxBuffer: 256 * 1024, windowsHide: true }, (error, _stdout, stderr) => {
				// FFmpeg exits nonzero after listing the dummy input; that alone is not discovery failure.
				if (error && (error.killed || error.code === "ENOENT" || error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"))
					return reject(new Error("Camera enumeration failed: existing FFmpeg unavailable, timed out or exceeded its output limit."));
				const devices = parseDshowDevices(stderr);
				if (!devices.length) return reject(new Error("No accessible DirectShow video camera found. Connect a camera and check Windows permissions/driver support; no fallback camera was selected."));
				resolve(devices);
			});
	});
}

function requireLocalUI(ctx: ExtensionContext) {
	if (ctx?.mode !== "tui" || ctx.hasUI !== true || !ctx.ui)
		throw new Error("Camera controls require the local TUI. Saved permission does not authorize RPC, print or headless camera use.");
}

export function cameraGrantExpiry(kind: string, now: number, deadlineMs: number) {
	if (kind === "once") return now + deadlineMs;
	if (kind === "hour") return now + 60 * 60 * 1000;
	if (kind === "48h") return now + 48 * 60 * 60 * 1000;
	if (kind === "day") {
		const midnight = new Date(now);
		midnight.setHours(24, 0, 0, 0);
		return midnight.getTime();
	}
	throw new Error("Unknown camera permission scope.");
}

export function createCameraController(pi: Pick<ExtensionAPI, "on">, { readProjectSettings, writeProjectSettings, listDevices = discoverCameras }: {
	readProjectSettings: (cwd: string) => ProjectSettings;
	writeProjectSettings: (cwd: string, settings: ProjectSettings) => void;
	listDevices?: () => Promise<CameraDevice[]>;
}) {
	let generation = 0;
	const state = createCameraState();
	let acquiring = false;
	let active: { cancel: () => void; finish: () => Promise<void> } | undefined;
	const controller = {
		settings(ctx: Pick<ExtensionContext, "cwd">) { return cameraSettings(readProjectSettings(ctx.cwd)); },
		async invalidate(ctx?: Pick<ExtensionContext, "cwd">) {
			generation++;
			active?.cancel();
			try { if (ctx && state.present()) await state.revoke(ctx.cwd); }
			finally { await active?.finish(); }
		},
		async permission(ctx: ExtensionContext) {
			requireLocalUI(ctx);
			const epoch = generation;
			const scope = cameraProject(ctx.cwd);
			const current = controller.settings(ctx);
			if (!current.enabled || !current.device) return;
			const grant = await state.grant(scope, current.device);
			requireLocalUI(ctx);
			const after = controller.settings(ctx);
			if (generation !== epoch || cameraProject(ctx.cwd) !== scope || !after.enabled || after.device?.id !== current.device.id)
				throw new Error("Camera settings/session changed while permission was checked.");
			return grant ? { ...grant, device: current.device } : undefined;
		},
		async lease(ctx: ExtensionContext, request: { summary: string; watch?: boolean; deadlineMs: number; requestKey: string }, signal?: AbortSignal) {
			requireLocalUI(ctx);
			if (!Number.isSafeInteger(request.deadlineMs) || request.deadlineMs <= 0 || request.deadlineMs > 48 * 60 * 60 * 1000 || !/^[a-f0-9]{64}$/.test(request.requestKey))
				throw new Error("Invalid bounded camera deadline/request scope.");
			if (acquiring || active) throw new Error("This session already owns or is requesting camera access.");
			const epoch = generation;
			const requestedUntil = Date.now() + request.deadlineMs;
			const requestedUntilMonotonic = performance.now() + request.deadlineMs;
			const scope = cameraProject(ctx.cwd);
			const device = controller.settings(ctx).device;
			const assertCurrent = () => {
				requireLocalUI(ctx);
				const settings = controller.settings(ctx);
				if (signal?.aborted || generation !== epoch || cameraProject(ctx.cwd) !== scope || !settings.enabled || !device || settings.device?.id !== device.id)
					throw new Error("Camera request was cancelled or its settings/session changed.");
			};
			acquiring = true;
			try {
				assertCurrent();
				let grant = await controller.permission(ctx);
				if (!grant || grant.kind === "once" && grant.request !== request.requestKey) grant = await controller.choosePermission(ctx, request, signal);
				if (!grant) throw new Error("Camera access denied.");
				assertCurrent();
				const remaining = Math.min(request.deadlineMs, requestedUntil - Date.now());
				if (!Number.isSafeInteger(remaining) || remaining <= 0) throw new Error("Camera request deadline expired while authorization was pending.");
				const lease = await state.claim(scope, grant.device, grant.id, request.requestKey, remaining);
				try { assertCurrent(); } catch (error) { await state.release(scope, lease); throw error; }
				const abort = new AbortController();
				const monotonicDeadline = Math.min(requestedUntilMonotonic, performance.now() + Math.max(0, lease.expiresAt - Date.now()));
				let stop: (() => Promise<void>) | undefined;
				let finishing: Promise<void> | undefined;
				let timer: ReturnType<typeof setTimeout>;
				const owner = {
					lease, signal: abort.signal,
					cancel() { abort.abort(); },
					attachStop(callback: () => Promise<void>) {
						if (abort.signal.aborted || stop) throw new Error("Camera owner was cancelled or already has a backend.");
						stop = callback;
					},
					async guard() {
						assertCurrent();
						if (abort.signal.aborted || performance.now() >= monotonicDeadline) throw new Error("Camera ownership expired or was cancelled.");
						await state.validate(scope, lease);
						assertCurrent();
						if (abort.signal.aborted) throw new Error("Camera ownership was cancelled.");
					},
					worker(workerPid: number, childPid = 0) { return state.worker(scope, lease, workerPid, childPid); },
					finish(): Promise<void> {
						abort.abort(); clearTimeout(timer);
						if (!finishing) finishing = (async () => {
							// The backend callback must confirm hardware/process closure before metadata ownership is released.
							await stop?.();
							await state.release(scope, lease);
							signal?.removeEventListener("abort", interrupted);
							if (active === owner) active = undefined;
						})().catch(error => { finishing = undefined; throw error; });
						return finishing;
					},
				};
				const interrupted = () => { void owner.finish().catch(error => {
					try { ctx.ui.notify(String(error), "error"); }
					catch { console.error("Camera cleanup failed and local UI is unavailable; ownership retained."); }
				}); };
				active = owner;
				timer = setTimeout(interrupted, Math.max(0, monotonicDeadline - performance.now()));
				timer.unref();
				signal?.addEventListener("abort", interrupted, { once: true });
				if (signal?.aborted) interrupted();
				return owner;
			} finally { acquiring = false; }
		},
		async menu(ctx: ExtensionContext) {
			requireLocalUI(ctx);
			for (;;) {
				const epoch = generation;
				const cwd = ctx.cwd;
				const projectScope = cameraProject(cwd);
				const current = controller.settings(ctx);
				const pick = await showListDialog(ctx, {
					title: "Camera: Project only",
					purpose: "Choose the camera explicitly; enabling it is not permission to capture.",
					cursorKey: "work-camera-settings", forceCustom: true, selectOnSpace: true,
					items: [
						{ value: "enabled", label: `Camera: ${current.enabled ? "ON" : "OFF"}`, disabled: !current.device, description: current.device ? "Default OFF · disable revokes access · actual capture requires separate permission" : "Select a camera first; never defaults to a laptop webcam" },
						{ value: "device", label: `Selected camera: ${current.device?.label ?? "None"}`, description: "Enumerate names only; selecting a device does not acquire frames" },
						{ value: "revoke", label: "Revoke camera permission / stop", description: "Keep the selected device; no automatic restart" },
					],
				});
				if (!pick) return;
				if (pick.item.value === "revoke") { await controller.invalidate(ctx); continue; }
				let device = current.device;
				if (pick.item.value === "device") {
					let devices;
					try { devices = await listDevices(); }
					catch (error) { ctx.ui.notify(error instanceof Error ? error.message : "Camera enumeration failed.", "error"); continue; }
					const selected = await showListDialog(ctx, {
						title: "Select project camera", purpose: "Choose the exact DirectShow identity; selection does not open it.",
						cursorKey: "work-camera-device", forceCustom: true, currentValue: device?.id,
						items: devices.map(item => ({ value: item.id, label: item.label, description: item.id })),
					});
					if (!selected) continue;
					device = devices.find(item => item.id === selected.item.value);
					if (!device) throw new Error("Selected camera is no longer available.");
				}
				requireLocalUI(ctx);
				if (generation !== epoch || ctx.cwd !== cwd || cameraProject(ctx.cwd) !== projectScope) throw new Error("Camera session changed; settings were not modified.");
				const revokedEpoch = generation + 1;
				await controller.invalidate(ctx);
				requireLocalUI(ctx);
				if (generation !== revokedEpoch || ctx.cwd !== cwd || cameraProject(ctx.cwd) !== projectScope) throw new Error("Camera session changed; settings were not modified.");
				const settings = readProjectSettings(ctx.cwd);
				settings.workOrchestrator ??= {};
				settings.workOrchestrator.camera = { enabled: pick.item.value === "enabled" ? !current.enabled : false, device };
				writeProjectSettings(ctx.cwd, settings);
			}
		},
		async choosePermission(ctx: ExtensionContext, { summary, watch = false, deadlineMs, requestKey = cameraRequestKey({ summary, watch, deadlineMs }) }: { summary: string; watch?: boolean; deadlineMs: number; requestKey?: string }, signal?: AbortSignal) {
			requireLocalUI(ctx);
			const current = controller.settings(ctx);
			if (!current.enabled || !current.device) throw new Error("Project camera is OFF or has no valid selected device.");
			const device = current.device;
			if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > 48 * 60 * 60 * 1000)
				throw new Error("Camera request requires a bounded deadline of at most 48 hours.");
			const epoch = generation;
			const cwd = ctx.cwd;
			const scope = await state.revision(cwd);
			const assertApproval = () => {
				requireLocalUI(ctx);
				const after = controller.settings(ctx);
				if (signal?.aborted || generation !== epoch || ctx.cwd !== cwd || cameraProject(ctx.cwd) !== scope.project || !after.enabled || after.device?.id !== device.id)
					throw new Error("Camera settings/session changed while permission was pending; no permission issued.");
			};
			assertApproval();
			const now = Date.now();
			const labels = { once: watch ? "One bounded watch" : "One shot / declared burst", hour: "One hour", day: "Current local calendar day", "48h": "48 hours" };
			const choices = (Object.keys(labels) as (keyof typeof labels)[]).map(kind => ({
				value: kind,
				label: labels[kind],
				description: `Expires ${new Date(cameraGrantExpiry(kind, now, deadlineMs)).toString()} · request ends no later than ${new Date(Math.min(now + deadlineMs, cameraGrantExpiry(kind, now, deadlineMs))).toString()}`,
			}));
			const choice = await showListDialog(ctx, {
				title: `Camera permission: ${device.label}`,
				purpose: "Images go to the model/provider; temp cleanup cannot erase provider/session copies.",
				subtitle: [device.id, summary], cursorKey: "work-camera-permission", forceCustom: true,
				descriptionMaxLines: 8,
				items: [{ value: "deny", label: "Deny camera access", description: "No permission issued" }, ...choices],
			});
			if (!choice || choice.item.value === "deny") return;
			assertApproval();
			const expiresAt = cameraGrantExpiry(choice.item.value, now, deadlineMs);
			if (Math.min(expiresAt, now + deadlineMs) <= Date.now()) throw new Error("Displayed camera permission/request expired before approval.");
			const grant = await state.issue(cwd, device, { kind: choice.item.value === "once" ? "once" : "time", expiresAt }, scope, requestKey, assertApproval);
			return { ...grant, device };
		},
	};
	for (const event of ["session_shutdown", "session_before_switch", "session_before_fork", "session_before_tree", "session_tree"] as const)
		pi.on(event, () => controller.invalidate());
	return controller;
}
