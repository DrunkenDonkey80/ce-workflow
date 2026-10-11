import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const TTL = 24 * 60 * 60 * 1000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Frame = { version: 1; id: string; createdAt: number; expiresAt: number; bytes: number; format: "png" | "jpg" };
// Only matching, validated camera manifests authorize deletion; corrupt entries fail closed.
export function createCameraImages({ directory = join(tmpdir(), "ce-workflow-camera-images"), now = Date.now, maxFiles = 64, maxBytes = 64 * 1024 * 1024 } = {}) {
	if (!Number.isSafeInteger(maxFiles) || maxFiles <= 0 || maxFiles > 64 || !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 64 * 1024 * 1024) throw new Error("Invalid camera storage budget.");
	const root = resolve(directory);
	let timer: ReturnType<typeof setInterval> | undefined;
	function outside(cwd: string) {
		const project = realpathSync(cwd);
		let ancestor = root;
		const parts: string[] = [];
		while (!existsSync(ancestor)) { parts.unshift(basename(ancestor)); ancestor = dirname(ancestor); }
		const canonical = join(realpathSync(ancestor), ...parts);
		for (const destination of [root, canonical]) {
			const path = relative(project, destination);
			if (!path || !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`)) throw new Error("Camera images must be outside the project.");
		}
		if (existsSync(root) && (lstatSync(root).isSymbolicLink() || relative(root, canonical) !== "")) throw new Error("Camera image directory must not be redirected.");
	}
	function file(id: string, extension: string) { if (!UUID.test(id)) throw new Error("Invalid camera frame identity."); return join(root, `camera-${id}.${extension}`); }
	function manifest(id: string): Frame | undefined {
		const path = file(id, "json");
		if (!existsSync(path)) return;
		if (!lstatSync(path).isFile() || lstatSync(path).size > 4096) throw new Error("Invalid camera frame manifest.");
		let frame: Frame;
		try { frame = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("Corrupt camera frame manifest."); }
		if (!frame || frame.version !== 1 || frame.id !== id || !Number.isSafeInteger(frame.createdAt) || frame.createdAt < 0 ||
			frame.expiresAt !== frame.createdAt + TTL || !Number.isSafeInteger(frame.bytes) || frame.bytes <= 0 || frame.bytes > maxBytes ||
			!["png", "jpg"].includes(frame.format)) throw new Error("Invalid camera frame manifest.");
		return frame;
	}
	function remove(frame: Frame) {
		const image = file(frame.id, frame.format);
		if (existsSync(image) && !lstatSync(image).isFile()) throw new Error("Camera image is redirected or not a regular file.");
		rmSync(image, { force: true }); rmSync(file(frame.id, "json"), { force: true });
	}
	function locked<T>(cwd: string, action: () => T): T {
		outside(cwd); mkdirSync(root, { recursive: true, mode: 0o700 }); outside(cwd);
		const lock = join(root, "images.lock");
		let fd: number;
		try { fd = openSync(lock, "wx", 0o600); } catch { throw new Error("Camera image storage is busy or crash-locked; acquisition refused."); }
		try { return action(); } finally { closeSync(fd); rmSync(lock); }
	}
	function sweep() {
		const time = now();
		if (!Number.isSafeInteger(time) || time < 0) throw new Error("Invalid camera image clock.");
		for (const name of readdirSync(root)) {
			const match = name.match(/^camera-([a-f0-9-]+)\.json$/);
			if (!match || !UUID.test(match[1])) continue;
			const frame = manifest(match[1]);
			if (frame && (frame.expiresAt <= time || !existsSync(file(frame.id, frame.format)))) remove(frame);
		}
	}
	const store = {
		cleanup(cwd: string) { outside(cwd); if (existsSync(root)) locked(cwd, sweep); },
		start(cwd: string, onError: (error: unknown) => void) {
			store.cleanup(cwd);
			if (!timer && existsSync(root)) { timer = setInterval(() => { try { store.cleanup(cwd); } catch (error) { onError(error); } }, 60000); timer.unref(); }
		},
		stop() { clearInterval(timer); timer = undefined; },
		save(cwd: string, data: Buffer, format: "png" | "jpg") {
			if (!Buffer.isBuffer(data) || !data.length || data.length > maxBytes || !["png", "jpg"].includes(format)) throw new Error("Invalid bounded camera image.");
			return locked(cwd, () => {
				sweep();
				let count = 0, bytes = 0;
				for (const name of readdirSync(root)) {
					if (!/^camera-[a-f0-9-]+\.(png|jpg)$/.test(name)) continue;
					const info = lstatSync(join(root, name));
					if (!info.isFile()) throw new Error("Camera storage contains a redirected image.");
					count++; bytes += info.size;
				}
				if (count >= maxFiles || bytes + data.length > maxBytes) throw new Error("Camera image storage budget exhausted.");
				const createdAt = now();
				const frame: Frame = { version: 1, id: randomUUID(), createdAt, expiresAt: createdAt + TTL, bytes: data.length, format };
				const image = file(frame.id, format);
				// Manifest first: a crash during the image write still leaves its owned TTL record.
				writeFileSync(file(frame.id, "json"), JSON.stringify(frame), { flag: "wx", mode: 0o600 });
				try { writeFileSync(image, data, { flag: "wx", mode: 0o600 }); }
				catch (error) { remove(frame); throw error; }
				return frame;
			});
		},
		drop(cwd: string, id: string) { locked(cwd, () => { const frame = manifest(id); if (frame) remove(frame); }); },
		read(cwd: string, id: string) {
			return locked(cwd, () => {
				sweep(); const frame = manifest(id);
				if (!frame) return;
				const path = file(id, frame.format);
				if (!existsSync(path)) return;
				const stat = lstatSync(path);
				if (!stat.isFile() || stat.size !== frame.bytes) throw new Error("Camera source is corrupt or redirected.");
				return { frame, data: readFileSync(path) };
			});
		},
	};
	return store;
}
