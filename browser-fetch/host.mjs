// Pi browser fetch native host (plan d8c5ace2 D5): started by the browser for the extension (stdio, 4-byte length frames),
// it serves a local pipe that Pi sessions connect to (newline JSON) and relays requests by id. Images are saved here.
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_FRAME = 64 * 1024 * 1024, MAX_IMAGE = 8 * 1024 * 1024;
const MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/svg+xml": "svg", "image/bmp": "bmp" };

export async function* frames(stream) {
	let pending = Buffer.alloc(0), length;
	for await (const chunk of stream) {
		pending = Buffer.concat([pending, chunk]);
		for (;;) {
			if (length === undefined) {
				if (pending.length < 4) break;
				length = pending.readUInt32LE();
				pending = pending.subarray(4);
				if (!length || length > MAX_FRAME) throw new Error("Native message too large");
			}
			if (pending.length < length) break;
			const raw = pending.subarray(0, length);
			pending = pending.subarray(length);
			length = undefined;
			let message;
			try { message = JSON.parse(raw.toString("utf8")); } catch { continue; }
			if (message && typeof message === "object" && !Array.isArray(message)) yield message;
		}
	}
}
export function frame(message) {
	const data = Buffer.from(JSON.stringify(message)), size = Buffer.alloc(4);
	size.writeUInt32LE(data.length);
	return Buffer.concat([size, data]);
}

export function runHost({ input = process.stdin, output = process.stdout, pipe = process.env.PI_BROWSER_FETCH_PIPE || (process.platform === "win32" ? "\\\\.\\pipe\\pi-browser-fetch" : path.join(os.tmpdir(), "pi-browser-fetch.sock")), imageDir = path.join(os.tmpdir(), "pi-browser-fetch") } = {}) {
	const owners = new Map(), sockets = new Set(); // request id -> Pi socket; all Pi sockets
	const toBrowser = message => output.write(frame(message));
	const toPi = (socket, message) => { if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`); };
	// Old image folders go after a day; the agent reads them right after the fetch.
	try { for (const name of readdirSync(imageDir)) { const dir = path.join(imageDir, name); if (Date.now() - statSync(dir).mtimeMs > 86_400_000) rmSync(dir, { recursive: true, force: true }); } } catch {}

	const server = net.createServer(socket => {
		const mine = new Set();
		sockets.add(socket);
		let buffer = "";
		socket.setEncoding("utf8");
		socket.on("data", chunk => {
			buffer += chunk;
			if (buffer.length > 4 * 1024 * 1024) return socket.destroy();
			for (let end; (end = buffer.indexOf("\n")) >= 0;) {
				const line = buffer.slice(0, end);
				buffer = buffer.slice(end + 1);
				let message;
				try { message = JSON.parse(line); } catch { continue; }
				if (typeof message?.id !== "string" || !/^[\w-]{1,64}$/.test(message.id)) continue;
				const owner = owners.get(message.id);
				if (owner !== undefined && owner !== socket) continue; // only the requester steers its request or control session
				if (message.type === "fetch" || message.type === "control-open") { owners.set(message.id, socket); mine.add(message.id); }
				else if (owner === undefined) continue;
				if (message.type === "done" || message.type === "control-close") { owners.delete(message.id); mine.delete(message.id); }
				toBrowser(message);
			}
		});
		socket.on("error", () => {});
		// D15: a Pi that disconnects cancels its requests.
		socket.on("close", () => { sockets.delete(socket); for (const id of mine) { owners.delete(id); toBrowser({ type: "cancel", id }); } });
	});

	const saveImage = message => {
		const owner = owners.get(message.id);
		const extension = MIME[String(message.mime).split(";")[0].trim().toLowerCase()];
		const data = typeof message.data === "string" ? Buffer.from(message.data, "base64") : Buffer.alloc(0);
		if (!owner || !extension || !data.length || data.length > MAX_IMAGE || !Number.isSafeInteger(message.n)) return;
		const dir = path.join(imageDir, message.id), file = path.join(dir, `${String(message.n).padStart(2, "0")}.${extension}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(file, data);
		toPi(owner, { type: "image", id: message.id, url: message.url, path: file, bytes: data.length });
	};

	// browser_act screenshots (plan 607b2518 D10): saved like images, the path goes to Pi instead of the pixels.
	const saveShot = ({ png, ...message }) => {
		const owner = owners.get(message.id), data = Buffer.from(png, "base64");
		if (!owner) return;
		if (!data.length || data.length > MAX_FRAME || !Number.isSafeInteger(message.seq)) return toPi(owner, { type: "error", id: message.id, seq: message.seq, error: "The screenshot was empty or too large." });
		const dir = path.join(imageDir, message.id), file = path.join(dir, `shot-${String(message.seq).padStart(3, "0")}.png`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(file, data);
		toPi(owner, { ...message, path: file });
	};

	const reading = (async () => {
		for await (const message of frames(input)) {
			if (message.type === "image") saveImage(message);
			else if (message.type === "result" && typeof message.png === "string") saveShot(message);
			else if (typeof message.id === "string" && owners.has(message.id)) toPi(owners.get(message.id), message);
		}
	})();
	const closeAll = error => {
		for (const [id, socket] of owners) toPi(socket, { type: "error", id, error });
		owners.clear();
		server.close();
		for (const socket of sockets) socket.end();
	};
	reading.then(() => closeAll("The browser closed."), err => closeAll(`Browser link failed: ${err.message}`));

	return new Promise((resolve, reject) => {
		const listen = () => server.listen(pipe, () => resolve({ server, reading }));
		server.once("error", error => {
			// A socket file left by a crashed host (not Windows pipes): remove it once if nobody answers.
			if (error.code !== "EADDRINUSE" || process.platform === "win32") return reject(error);
			const probe = net.connect(pipe);
			probe.once("connect", () => { probe.destroy(); reject(error); });
			probe.once("error", () => { rmSync(pipe, { force: true }); server.once("error", reject); listen(); });
		});
		listen();
	});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { reading } = await runHost();
		await reading.catch(() => {});
	} catch (error) {
		// Another browser's host already serves the pipe; this one has nothing to do.
		process.stdout.write(frame({ type: "busy", error: error.message }));
	}
	process.exit(0);
}
