import { randomUUID } from "node:crypto";
import { cameraRequestKey, cameraProject } from "./work-camera-state.ts";
import { discoverCameras } from "./work-camera.ts";
import { resolveCameraFFmpeg, runCameraProcess } from "./work-camera-process.ts";
import { PHONE_CAMERA, phoneShot } from "./work-camera-phone.ts";
import { processPng } from "./screen-read.ts";
import type { createCameraController } from "./work-camera.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type Crop = { x: number; y: number; width: number; height: number };
type Request = { count?: number; intervalMs?: number; fullSize?: boolean; crop?: Crop; width?: number; height?: number; deadlineMs?: number; lockAt?: { x: number; y: number } };
export function cameraCaptureRequest(input: Request) {
	const count = input.count ?? 1, intervalMs = input.intervalMs ?? 1000;
	const deadlineMs = input.deadlineMs ?? Math.min(600000, count * 20000 + (count - 1) * intervalMs);
	if (!Number.isSafeInteger(count) || count < 1 || count > 8 || !Number.isSafeInteger(intervalMs) || intervalMs < 0 || intervalMs > 60000 ||
		!Number.isSafeInteger(deadlineMs) || deadlineMs < 2000 || deadlineMs > 600000 || (count - 1) * intervalMs >= deadlineMs) throw new Error("Invalid bounded camera count, interval or deadline.");
	if (input.fullSize !== undefined && typeof input.fullSize !== "boolean") throw new Error("Invalid full-size flag.");
	if (input.crop && (!Object.values(input.crop).every(Number.isSafeInteger) || input.crop.x < 0 || input.crop.y < 0 || input.crop.width <= 0 || input.crop.height <= 0)) throw new Error("Invalid crop geometry.");
	if ((input.width === undefined) !== (input.height === undefined) || input.width !== undefined && (!Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height) || input.width < 1 || input.height! < 1 || input.width * input.height! > 16000000)) throw new Error("Output size requires bounded integer width and height.");
	if (input.fullSize && input.width !== undefined) throw new Error("Full-size capture cannot also request a downscaled output.");
	if (input.lockAt && (!Number.isSafeInteger(input.lockAt.x) || !Number.isSafeInteger(input.lockAt.y) || input.lockAt.x < 0 || input.lockAt.y < 0)) throw new Error("Invalid lockAt point.");
	return { ...input, count, intervalMs, deadlineMs, fullSize: input.fullSize ?? false };
}
export function cameraModes(text: string) {
	const modes: { width: number; height: number; fps: number; kind: string; format: string }[] = [];
	for (const line of text.split(/\r?\n/)) {
		const format = line.match(/(pixel_format|vcodec)=([a-z0-9_]+)/i);
		if (!format) continue;
		for (const match of line.matchAll(/s=(\d+)x(\d+)\s+fps=([\d.]+)/g)) {
			const width = Number(match[1]), height = Number(match[2]), fps = Number(match[3]);
			if (width > 0 && height > 0 && Number.isFinite(fps) && fps > 0) modes.push({ width, height, fps: Math.min(30, fps), kind: format[1], format: format[2] });
		}
	}
	return modes.sort((a, b) => b.width * b.height - a.width * a.height || b.fps - a.fps);
}
export function cameraStillArgs(device: string, mode: ReturnType<typeof cameraModes>[number], request: ReturnType<typeof cameraCaptureRequest>) {
	const crop = request.crop ?? { x: 0, y: 0, width: mode.width, height: mode.height };
	if (crop.x + crop.width > mode.width || crop.y + crop.height > mode.height) throw new Error("Crop is outside the native frame.");
	let width = request.width ?? crop.width, height = request.height ?? crop.height;
	if (!request.fullSize && request.width === undefined && Math.max(width, height) > 1024) {
		const ratio = 1024 / Math.max(width, height); width = Math.max(1, Math.round(width * ratio)); height = Math.max(1, Math.round(height * ratio));
	}
	if (width > crop.width || height > crop.height || width * height > 16000000) throw new Error("Camera output cannot upscale or exceed its pixel bound.");
	const filters = ["setpts=PTS-STARTPTS", "select=gte(t\\,1)", `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}:exact=1`];
	if (width !== crop.width || height !== crop.height) filters.push(`scale=${width}:${height}`);
	return { width, height, crop, args: ["-hide_banner", "-nostdin", "-loglevel", "info", "-f", "dshow", "-video_size", `${mode.width}x${mode.height}`, "-framerate", String(mode.fps), mode.kind === "vcodec" ? "-vcodec" : "-pixel_format", mode.format, "-i", `video=${device}`, "-an", "-sn", "-dn", "-vf", filters.join(","), "-frames:v", "1", "-c:v", "png", "-pix_fmt", "rgb24", "-f", "image2pipe", "pipe:1"] };
}
export function cameraPNGSize(data: Buffer) {
	if (data.length < 33 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || data.toString("ascii", 12, 16) !== "IHDR" || data.toString("ascii", data.length - 8, data.length - 4) !== "IEND") throw new Error("Camera did not return a complete PNG still.");
	const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
	if (!width || !height || width * height > 16000000) throw new Error("Camera image exceeds its pixel bound.");
	return { width, height };
}
const delay = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
	if (signal.aborted) return reject(new Error("Camera capture cancelled."));
	const abort = () => { clearTimeout(timer); reject(new Error("Camera capture cancelled.")); };
	const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
	signal.addEventListener("abort", abort, { once: true });
});
export function createCameraCapture(controller: ReturnType<typeof createCameraController>, { resolveFFmpeg = resolveCameraFFmpeg, devices = discoverCameras, run = runCameraProcess, shot = phoneShot } = {}) {
	return {
		async capture(ctx: ExtensionContext, input: Request, signal?: AbortSignal) {
			if (ctx.mode !== "tui" || ctx.hasUI !== true || typeof ctx.ui?.setWidget !== "function" || typeof ctx.ui?.theme?.fg !== "function") throw new Error("Camera capture requires eligible local TUI warning UI.");
			const request = cameraCaptureRequest(input);
			const selected = controller.settings(ctx);
			if (!selected.enabled || !selected.device) throw new Error("Project camera is OFF or not selected.");
			const phone = PHONE_CAMERA.exec(selected.device.id)?.[1];
			if (request.lockAt && !phone) throw new Error("lockAt needs a phone camera: it long-presses the Camera app's viewfinder.");
			const executable = phone ? "" : await resolveFFmpeg();
			if (!(await devices()).some(device => device.id === selected.device!.id)) throw new Error("Selected camera identity changed or is unavailable; no fallback.");
			controller.images.prepare(ctx.cwd);
			controller.images.start(ctx.cwd, error => { try { ctx.ui.notify(String(error), "error"); } catch { console.error("Camera image cleanup failed."); } });
			const owner = await controller.lease(ctx, { summary: `Capture ${request.count} still(s), ${request.fullSize ? "native detail" : "bounded overview"}; crop ${request.crop ? JSON.stringify(request.crop) : "full field of view"}; output ${request.width ? `${request.width}x${request.height}` : request.fullSize ? "native" : "maximum edge 1024"}; minimum delay after each released capture ${request.intervalMs} ms`, deadlineMs: request.deadlineMs, requestKey: cameraRequestKey({ invocation: randomUUID(), request }) }, signal);
			const frames: ReturnType<typeof controller.images.save>[] = [];
			let outcome = "captured", failure = "";
			try {
				let grab: (sequence: number) => Promise<ReturnType<typeof controller.images.save>>;
				if (phone) {
					owner.attachStop(async () => {}); // nothing to close: the Camera app stays open, and frames are read only during a capture
					await owner.begin();
					// shortcut: an explicit width/height only bounds the longest edge here (the crop keeps its aspect), fine for viewing.
					const maxEdge = request.fullSize ? 16000 : request.width ? Math.max(request.width, request.height!) : 1024;
					grab = async sequence => {
						const { png, receivedAt } = await shot(phone, { signal: owner.signal, lockAt: sequence ? undefined : request.lockAt });
						const out = processPng(png, request.crop && [request.crop.x, request.crop.y, request.crop.width, request.crop.height], maxEdge);
						return controller.images.save(ctx.cwd, out.png, "png", { device: selected.device!.id, timestamp: receivedAt, timestampBasis: "screenshot of the phone's Camera app viewfinder received locally, not sensor exposure time", sequence, sourceWidth: out.sourceWidth, sourceHeight: out.sourceHeight, crop: request.crop ?? { x: 0, y: 0, width: out.sourceWidth, height: out.sourceHeight }, width: out.width, height: out.height });
					};
				} else {
					const options = await run(owner, executable, ["-hide_banner", "-nostdin", "-f", "dshow", "-list_options", "true", "-i", `video=${selected.device.id}`], { durationMs: 10000, maxBytes: 256 * 1024, keepLease: true, allowNonzero: true });
					const mode = cameraModes(options.stderr)[0];
					if (!mode || mode.width * mode.height > 16000000) throw new Error("Native camera mode unavailable or exceeds the pixel limit; no silent downgrade.");
					const plan = cameraStillArgs(selected.device.id, mode, request);
					grab = async sequence => {
						const observation = await run(owner, executable, plan.args, { durationMs: 15000, maxBytes: 4 * 1024 * 1024, keepLease: true });
						const geometry = cameraPNGSize(observation.stdout);
						if (geometry.width !== plan.width || geometry.height !== plan.height) throw new Error("Camera output geometry differs from the request.");
						return controller.images.save(ctx.cwd, observation.stdout, "png", { device: selected.device!.id, timestamp: observation.receivedAt, timestampBasis: "encoded frame first received locally, not sensor exposure time", sequence, sourceWidth: mode.width, sourceHeight: mode.height, crop: plan.crop, ...geometry });
					};
				}
				for (let sequence = 0; sequence < request.count; sequence++) {
					if (sequence) await delay(request.intervalMs, owner.signal);
					await owner.guard();
					frames.push(await grab(sequence));
				}
			} catch (error) { if (!frames.length) throw error; outcome = "partial"; failure = String(error); }
			finally { await owner.finish(); }
			return { outcome, failure, frames, project: cameraProject(ctx.cwd), intervalMeaning: phone ? "wait between phone screenshots; each screenshot adds its own transfer time" : "minimum wait after process closure; reopening and warm-up add latency; no catch-up bursts", provisional: "one-second warm-up and numerical bounds await calibration" };
		},
		recover(ctx: ExtensionContext, id: string) { return controller.images.read(ctx.cwd, id); },
	};
}
