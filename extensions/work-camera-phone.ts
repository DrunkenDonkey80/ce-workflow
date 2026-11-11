// iPhones and iPads as the project camera (macOS): the Camera app's viewfinder, read as screenshots through mobile_act's helper
// (USB through mobilecli, Wi-Fi through the CoreDevice tunnel). A phone on a stand over the hardware under test is the camera.
import { execFile } from "node:child_process";
import { cameraShot, listDevices } from "./mobile-act.ts";
import { decodePng, processPng } from "./screen-read.ts";

type Crop = { x: number; y: number; width: number; height: number };
export const PHONE_CAMERA = /^ios-([0-9A-Fa-f-]{8,64})$/;
const exec = (command: string, args: string[], { timeout, signal }: { timeout: number; signal?: AbortSignal }) =>
	new Promise<{ code: number; killed?: boolean; stdout: string; stderr: string }>(resolve => execFile(command, args, { timeout, signal, maxBuffer: 64 << 20 },
		(error: any, stdout, stderr) => resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, killed: error?.killed, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") })));

/** Real iPhones and iPads that are online (USB or Wi-Fi), as camera identities `ios-<udid>` (no colon: FFmpeg ids forbid it). Empty off macOS. */
export async function phoneCameras(list = () => listDevices(exec)) {
	if (process.platform !== "darwin") return [];
	return (await list()).filter(d => d.platform === "ios" && d.type === "real" && d.state === "online")
		.map(d => ({ id: `ios-${d.id}`, label: `${d.name} (Camera app)`.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 256) }));
}

/** One viewfinder frame from the phone; lockAt (screenshot pixels) locks focus and exposure there first. */
export const phoneShot = (udid: string, o: { signal?: AbortSignal; lockAt?: { x: number; y: number } }) => cameraShot(exec, udid, o);

/** A phone frame as the RGB raw the change detector reads: cropped, then scaled down to fit maxEdge. */
export function phoneRaw(png: Buffer, crop: Crop | undefined, maxEdge: number) {
	const out = processPng(png, crop && [crop.x, crop.y, crop.width, crop.height], maxEdge), { rgba } = decodePng(out.png);
	const raw = Buffer.alloc(out.width * out.height * 3);
	for (let i = 0, j = 0; j < raw.length; i += 4, j += 3) rgba.copy(raw, j, i, i + 3);
	return { raw, width: out.width, height: out.height, sourceWidth: out.sourceWidth, sourceHeight: out.sourceHeight };
}
