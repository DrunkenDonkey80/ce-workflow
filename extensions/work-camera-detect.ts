import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { cameraCaptureRequest, cameraModes, cameraStillArgs } from "./work-camera-capture.ts";
import { cameraRequestKey } from "./work-camera-state.ts";
import { discoverCameras } from "./work-camera.ts";
import { resolveCameraFFmpeg, runCameraProcess } from "./work-camera-process.ts";
import type { createCameraController } from "./work-camera.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type DetectionOptions = { width: number; height: number; fps?: number; threshold?: number; tileSize?: number; noise?: number; staleMs?: number; settleMs?: number; maxSettleMs?: number };
const channelMeans = (raw: Buffer) => { const sums = [0, 0, 0]; for (let index = 0; index < raw.length; index++) sums[index % 3] += raw[index]; return sums.map(sum => sum / (raw.length / 3)); };
// Live Logi C310 (CAM-02): auto-exposure kept drifting ~7 s after the first frame, so readiness waits for a stable picture.
export function createCameraDetector({ width, height, fps = 10, threshold = 0.08, tileSize = 8, noise = 6, staleMs = 3000, settleMs = 2000, maxSettleMs = 10000 }: DetectionOptions) {
	if (![width, height, tileSize, noise, staleMs, settleMs, maxSettleMs].every(Number.isSafeInteger) || width < 1 || height < 1 || width * height > 640 * 480 || tileSize < 1 || tileSize > 64 || noise < 0 || noise > 32 || staleMs < 500 || staleMs > 30000 || settleMs < 0 || maxSettleMs < settleMs || maxSettleMs > 14000 || !Number.isFinite(fps) || fps < 1 || fps > 30 || !Number.isFinite(threshold) || threshold <= 0 || threshold > 1) throw new Error("Invalid bounded camera detector parameters.");
	let baseline: Buffer | undefined, sequence = 0, lastMonotonic = -1, lastChange = -1, delayedSamples = 0, firstMonotonic = -1;
	let anchor: { raw: Buffer; means: number[]; monotonic: number } | undefined;
	const tilesChanged = (raw: Buffer, reference: Buffer, limit: number) => {
		let maxChange = 0, changedTiles = 0, tiles = 0;
		for (let y = 0; y < height; y += tileSize) for (let x = 0; x < width; x += tileSize) {
			let difference = 0, channels = 0;
			for (let row = y; row < Math.min(y + tileSize, height); row++) for (let col = x; col < Math.min(x + tileSize, width); col++) for (let channel = 0; channel < 3; channel++) {
				const index = (row * width + col) * 3 + channel, delta = Math.abs(raw[index] - reference[index]);
				if (delta > noise) difference += delta;
				channels++;
			}
			const change = difference / (channels * 255); maxChange = Math.max(maxChange, change); if (change >= limit) changedTiles++; tiles++;
		}
		return { maxChange, changedTiles, tiles };
	};
	const stats = () => ({ sequence, lastMonotonic, lastChange, delayedSamples, requestedFps: fps, minimumIdealStateMs: 1000 / fps, observability: "Receipt gaps only: driver buffering, exposure and dropped sensor states are not measurable here. Sampling cannot guarantee every brief state." });
	return {
		stats,
		assertFresh(monotonic: number) { if (lastMonotonic >= 0 && monotonic - lastMonotonic > staleMs) throw new Error("Camera samples stalled; this is a fault, not stability."); },
		frame(raw: Buffer, receivedAt: number, monotonic: number) {
			if (raw.length !== width * height * 3 || !Number.isFinite(monotonic) || monotonic < lastMonotonic || !Number.isSafeInteger(receivedAt) || receivedAt < 0) throw new Error("Invalid ordered camera sample.");
			if (lastMonotonic >= 0 && monotonic - lastMonotonic > staleMs) throw new Error("Camera samples stalled before the next frame; not a quiet interval.");
			if (lastMonotonic >= 0) delayedSamples += Math.max(0, Math.floor((monotonic - lastMonotonic) * fps / 1000) - 1);
			lastMonotonic = monotonic; sequence++;
			if (!baseline) {
				if (firstMonotonic < 0) firstMonotonic = monotonic;
				const means = channelMeans(raw);
				// Any global mean step of a full level or a half-threshold tile change restarts the stability window.
				const previous = anchor;
				if (!previous || means.some((mean, channel) => Math.abs(mean - previous.means[channel]) >= 1) || tilesChanged(raw, previous.raw, threshold / 2).changedTiles) anchor = { raw: Buffer.from(raw), means, monotonic };
				const settled = monotonic - anchor.monotonic >= settleMs;
				if (!settled && monotonic - firstMonotonic < maxSettleMs) return { type: "warming", raw: Buffer.from(raw), receivedAt, ...stats() };
				baseline = Buffer.from(raw); lastChange = monotonic;
				return { type: "ready", raw: Buffer.from(raw), receivedAt, settled, warmupMs: monotonic - firstMonotonic, ...stats() };
			}
			const { maxChange, changedTiles, tiles } = tilesChanged(raw, baseline, threshold);
			if (changedTiles) {
				// Keep the last qualifying baseline so gradual drift accumulates rather than disappearing.
				baseline = Buffer.from(raw); lastChange = monotonic;
				return { type: "change", raw: Buffer.from(raw), receivedAt, maxChange, changedTiles, possibleExposureShift: changedTiles / tiles >= 0.9, ...stats() };
			}
			return { type: "sample", raw: Buffer.from(raw), receivedAt, maxChange, ...stats() };
		},
	};
}
export function cameraRawFrames(width: number, height: number, onFrame: (frame: Buffer, receivedAt: number) => void) {
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 640 * 480) throw new Error("Invalid camera raw-frame bound.");
	const frame = Buffer.alloc(width * height * 3); let filled = 0;
	return {
		push(chunk: Buffer, receivedAt: number) {
			let offset = 0;
			while (offset < chunk.length) {
				const bytes = Math.min(frame.length - filled, chunk.length - offset);
				chunk.copy(frame, filled, offset, offset + bytes); offset += bytes; filled += bytes;
				if (filled === frame.length) { onFrame(frame, receivedAt); filled = 0; }
			}
		},
		finish() { if (filled) throw new Error("Camera stream ended with a partial frame."); },
	};
}
export async function runCameraAcquisition(ctx: ExtensionContext, controller: ReturnType<typeof createCameraController>, input: Partial<DetectionOptions> & { crop?: { x: number; y: number; width: number; height: number }; deadlineMs: number; summary: string }, callbacks: { owner: (owner: Awaited<ReturnType<typeof controller.lease>>) => void; sample: (sample: ReturnType<ReturnType<typeof createCameraDetector>["frame"]>, geometry: Record<string, unknown>) => void }, signal?: AbortSignal, { resolveFFmpeg = resolveCameraFFmpeg, devices = discoverCameras, run = runCameraProcess } = {}) {
	if (ctx.mode !== "tui" || ctx.hasUI !== true) throw new Error("Continuous camera acquisition requires local TUI.");
	if (!Number.isSafeInteger(input.deadlineMs) || input.deadlineMs < 2000 || input.deadlineMs > 172800000) throw new Error("Invalid continuous camera deadline.");
	const width = input.width ?? 320, height = input.height ?? 180;
	const detector = createCameraDetector({ ...input, width, height });
	const selected = controller.settings(ctx).device;
	if (!controller.settings(ctx).enabled || !selected) throw new Error("Project camera is OFF or not selected.");
	const executable = await resolveFFmpeg();
	if (!(await devices()).some(device => device.id === selected.id)) throw new Error("Selected camera identity changed; no fallback.");
	controller.images.prepare(ctx.cwd);
	controller.images.start(ctx.cwd, error => { try { ctx.ui.notify(String(error), "error"); } catch { console.error("Camera cleanup failed."); } });
	const owner = await controller.lease(ctx, { summary: input.summary, deadlineMs: input.deadlineMs, requestKey: cameraRequestKey({ invocation: randomUUID(), input }), watch: true }, signal);
	let guard: ReturnType<typeof setInterval> | undefined;
	try {
		callbacks.owner(owner);
		const options = await run(owner, executable, ["-hide_banner", "-nostdin", "-f", "dshow", "-list_options", "true", "-i", `video=${selected.id}`], { durationMs: 10000, maxBytes: 256 * 1024, allowNonzero: true, keepLease: true });
		const mode = cameraModes(options.stderr)[0];
		if (!mode || mode.width * mode.height > 16000000 || mode.fps < (input.fps ?? 10)) throw new Error("Native camera mode unavailable or cannot supply the requested sampling rate; no simulated frames.");
		const plan = cameraStillArgs(selected.id, mode, cameraCaptureRequest({ crop: input.crop, width, height }));
		const geometry = { sourceWidth: mode.width, sourceHeight: mode.height, width, height, crop: plan.crop, device: selected.id, fps: input.fps ?? 10, timestampBasis: "complete RGB frame received locally; not sensor exposure time" };
		const frames = cameraRawFrames(width, height, (raw, receivedAt) => callbacks.sample(detector.frame(raw, receivedAt, performance.now()), geometry));
		let staleError: unknown;
		const startingAt = performance.now();
		guard = setInterval(() => { try { if (!detector.stats().sequence && performance.now() - startingAt > 15000) throw new Error("Camera stalled before baseline readiness."); detector.assertFresh(performance.now()); } catch (error) { staleError ??= error; void owner.finish().catch(() => {}); } }, 100);
		const args = plan.args.slice(0, plan.args.indexOf("-frames:v"));
		args[args.indexOf("-loglevel") + 1] = "error";
		args[args.indexOf("-vf") + 1] += `,fps=${input.fps ?? 10}`;
		args.push("-fps_mode", "passthrough", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1");
		try { await run(owner, executable, args, { durationMs: input.deadlineMs, maxBytes: 4 * 1024 * 1024, keepLease: true, onData: (data, timestamp) => frames.push(data, timestamp) }); frames.finish(); if (!detector.stats().sequence) throw new Error("Camera stream ended before baseline readiness."); }
		catch (error) { throw staleError ?? error; }
	} finally { clearInterval(guard); await owner.finish(); }
}
