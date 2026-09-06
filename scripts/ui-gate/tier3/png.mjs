#!/usr/bin/env node
// Zero-dependency PNG codec for the UI gate (plan-final.md §2.7 tier 3
// probes + P4 histogram colour): decode 8-bit non-interlaced PNGs and
// encode RGBA via node:zlib. Only what the gate needs — no exotic formats.
import { deflateSync, inflateSync } from "node:zlib";

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n += 1) {
	let c = n;
	for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	CRC_TABLE[n] = c;
}

function crc32(bytes) {
	let crc = -1;
	for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ -1) >>> 0;
}

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function decodePng(buffer) {
	if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47)
		throw new Error("not a PNG (bad signature)");
	let offset = 8;
	let header = null;
	const idat = [];
	while (offset + 12 <= buffer.length) {
		const length = buffer.readUInt32BE(offset);
		const type = buffer.toString("ascii", offset + 4, offset + 8);
		const data = buffer.subarray(offset + 8, offset + 8 + length);
		if (type === "IHDR") {
			header = {
				width: data.readUInt32BE(0),
				height: data.readUInt32BE(4),
				bitDepth: data[8],
				colorType: data[9],
				interlace: data[12],
			};
		} else if (type === "IDAT") idat.push(data);
		else if (type === "IEND") break;
		offset += 12 + length;
	}
	if (!header) throw new Error("PNG missing IHDR");
	const bytesPerPixel = CHANNELS[header.colorType];
	if (
		header.bitDepth !== 8 ||
		!bytesPerPixel ||
		header.interlace !== 0 ||
		!header.width ||
		!header.height
	)
		throw new Error(
			`unsupported PNG (bitDepth ${header.bitDepth}, colorType ${header.colorType}, interlace ${header.interlace})`,
		);
	const stride = header.width * bytesPerPixel;
	const raw = inflateSync(Buffer.concat(idat));
	const out = new Uint8Array(header.width * header.height * 4);
	const row = (y) => y * stride;
	let previous = null;
	for (let y = 0; y < header.height; y += 1) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const current = new Uint8Array(stride);
		for (let x = 0; x < stride; x += 1) {
			const left = x >= bytesPerPixel ? current[x - bytesPerPixel] : 0;
			const up = previous ? previous[x] : 0;
			const upLeft =
				x >= bytesPerPixel && previous ? previous[x - bytesPerPixel] : 0;
			let value = line[x];
			if (filter === 1) value += left;
			else if (filter === 2) value += up;
			else if (filter === 3) value += Math.floor((left + up) / 2);
			else if (filter === 4) {
				const p = left + up - upLeft;
				const pa = Math.abs(p - left);
				const pb = Math.abs(p - up);
				const pc = Math.abs(p - upLeft);
				value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
			} else if (filter !== 0) throw new Error(`unknown PNG filter ${filter}`);
			current[x] = value & 0xff;
		}
		previous = current;
		for (let x = 0; x < header.width; x += 1) {
			const source = x * bytesPerPixel;
			const target = (y * header.width + x) * 4;
			if (bytesPerPixel === 1) {
				out[target] = out[target + 1] = out[target + 2] = current[source];
				out[target + 3] = 255;
			} else if (bytesPerPixel === 3) {
				out[target] = current[source];
				out[target + 1] = current[source + 1];
				out[target + 2] = current[source + 2];
				out[target + 3] = 255;
			} else if (bytesPerPixel === 2) {
				out[target] = out[target + 1] = out[target + 2] = current[source];
				out[target + 3] = current[source + 1];
			} else {
				out[target] = current[source];
				out[target + 1] = current[source + 1];
				out[target + 2] = current[source + 2];
				out[target + 3] = current[source + 3];
			}
		}
	}
	return { width: header.width, height: header.height, data: out };
}

function chunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const body = Buffer.concat([
		Buffer.from(type, "ascii"),
		data,
	]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([length, body, crc]);
}

export function encodePng({ width, height, data }) {
	if (data.length !== width * height * 4)
		throw new Error("encodePng expects RGBA data sized width*height*4");
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y += 1) {
		raw[y * (stride + 1)] = 0; // filter None
		Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(
			raw,
			y * (stride + 1) + 1,
		);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw, { level: 6 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

// Labeled 10×10 grid copy (tier 3 cross-check): lines drawn on a copy of
// the screenshot; row/column labels ride in the prompt by convention
// (rows 0–9 top→bottom, columns A–J left→right).
export function composeGrid(image, { cols = 10, rows = 10 } = {}) {
	const data = new Uint8Array(image.data);
	const line = [255, 0, 180];
	for (let col = 1; col < cols; col += 1) {
		const x = Math.floor((col * image.width) / cols);
		for (let y = 0; y < image.height; y += 1) {
			const target = (y * image.width + x) * 4;
			data[target] = line[0];
			data[target + 1] = line[1];
			data[target + 2] = line[2];
			data[target + 3] = 255;
		}
	}
	for (let row = 1; row < rows; row += 1) {
		const y = Math.floor((row * image.height) / rows);
		for (let x = 0; x < image.width; x += 1) {
			const target = (y * image.width + x) * 4;
			data[target] = line[0];
			data[target + 1] = line[1];
			data[target + 2] = line[2];
			data[target + 3] = 255;
		}
	}
	return { width: image.width, height: image.height, data };
}

export function scaleToLongestEdge(image, longest = 1536) {
	const edge = Math.max(image.width, image.height);
	if (edge <= longest) return { image, scale: 1 };
	const scale = longest / edge;
	const width = Math.max(1, Math.round(image.width * scale));
	const height = Math.max(1, Math.round(image.height * scale));
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y += 1)
		for (let x = 0; x < width; x += 1) {
			const source =
				(Math.floor(y / scale) * image.width + Math.floor(x / scale)) * 4;
			const target = (y * width + x) * 4;
			data[target] = image.data[source];
			data[target + 1] = image.data[source + 1];
			data[target + 2] = image.data[source + 2];
			data[target + 3] = image.data[source + 3];
		}
	return { image: { width, height, data }, scale };
}

export const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
