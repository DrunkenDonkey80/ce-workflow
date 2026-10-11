import { deflateSync } from "node:zlib";
import type { createCameraImages } from "./work-camera-images.ts";

export function cameraRGBPNG(raw: Buffer, width: number, height: number) {
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 640 * 480 || raw.length !== width * height * 3) throw new Error("Invalid bounded RGB PNG geometry.");
	const chunk = (name: string, data: Buffer) => {
		const output = Buffer.alloc(data.length + 12); output.writeUInt32BE(data.length); output.write(name, 4, "ascii"); data.copy(output, 8);
		let crc = 0xffffffff;
		for (const byte of output.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
		output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, output.length - 4); return output;
	};
	const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
	const scanlines = Buffer.alloc(raw.length + height);
	for (let row = 0; row < height; row++) raw.copy(scanlines, row * (width * 3 + 1) + 1, row * width * 3, (row + 1) * width * 3);
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(scanlines, { level: 1 })), chunk("IEND", Buffer.alloc(0))]);
}
type Observation = { type: string; raw?: Buffer; sequence: number; receivedAt: number; lastMonotonic: number; lastChange: number };
export function createCameraRetention(images: ReturnType<typeof createCameraImages>, cwd: string) {
	const initial: ReturnType<typeof images.save>[] = [], tail: ReturnType<typeof images.save>[] = [];
	let final: ReturnType<typeof images.save> | undefined;
	let anchor = -1, lastSaved = -Infinity, savedCount = 0, savedBytes = 0, residentBytes = 0, replacements = 0, thinned = 0, dropped = 0;
	const stageSaves = [0, 0, 0];
	const maxFrameBytes = 1024 * 1024, maxResidentBytes = 32 * 1024 * 1024, maxTotalBytes = 64 * 1024 * 1024;
	const stats = () => ({ anchor, stageSaves: [...stageSaves], savedCount, savedBytes, residentBytes, replacements, thinned, dropped, limits: { initial: 20, tail: 8, final: 1, lifetimeSaves: 256, residentBytes: maxResidentBytes, lifetimeBytes: maxTotalBytes } });
	const existing = (frame: ReturnType<typeof images.save>) => ({ ...frame, availability: images.read(cwd, frame.id) ? "retained" : "unavailable" });
	function save(sample: Observation, geometry: { width: number; height: number } & Record<string, unknown>, target: "initial" | "tail" | "final") {
		if (!sample.raw) throw new Error("Retained observation has no actual pixels.");
		const png = cameraRGBPNG(sample.raw, geometry.width, geometry.height);
		const reserve = target === "final" ? 0 : maxFrameBytes;
		if (png.length > maxFrameBytes || savedCount >= (target === "final" ? 256 : 255) || savedBytes + png.length + reserve > maxTotalBytes) { dropped++; return; }
		if (target === "tail" && tail.length === 8) {
			const old = tail.shift()!; images.drop(cwd, old.id); residentBytes -= old.bytes; replacements++;
		}
		if (residentBytes + png.length + reserve > maxResidentBytes) { dropped++; return; }
		const frame = images.save(cwd, png, "png", { ...geometry, sequence: sample.sequence, timestamp: sample.receivedAt, retainedAs: target });
		savedCount++; savedBytes += png.length; residentBytes += png.length; lastSaved = sample.lastMonotonic;
		if (target === "final") final = frame; else if (target === "initial") initial.push(frame); else tail.push(frame);
		return frame;
	}
	return {
		stats,
		frames() { return [...initial, ...tail, ...(final ? [final] : [])].map(existing); },
		initial() { return initial.map(existing); },
		event(sample: Observation, geometry: { width: number; height: number } & Record<string, unknown>) {
			if (sample.type !== "change") return;
			if (anchor < 0) anchor = sample.lastMonotonic;
			const elapsed = sample.lastMonotonic - anchor, stage = elapsed < 2000 ? 0 : elapsed < 60000 ? 1 : 2;
			const interval = stage === 0 ? 0 : stage === 1 ? 5000 : 60000;
			const cap = stage === 0 ? 20 : stage === 1 ? 12 : 255;
			if (stageSaves[stage] >= cap || sample.lastMonotonic - lastSaved < interval) { thinned++; return; }
			const frame = save(sample, geometry, stage === 0 ? "initial" : "tail");
			if (frame) stageSaves[stage]++;
			return frame;
		},
		finish(sample: Observation, geometry: { width: number; height: number } & Record<string, unknown>) {
			if (final) return final;
			return save(sample, geometry, "final");
		},
	};
}
