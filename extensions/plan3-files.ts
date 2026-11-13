import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { releaseSessionLock, takeSessionLock } from "./session-lock.ts";

type Plan = { id: string; file: string };
const queues = new Map<string, Promise<unknown>>();
export async function withPlanLock<T>(file: string, change: () => T | Promise<T>): Promise<T> {
	const key = planLockKey(file);
	const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => acrossProcesses(file, change));
	queues.set(key, next);
	try { return await next; } finally { if (queues.get(key) === next) queues.delete(key); }
}
function planLockKey(file: string) {
	let resolved = path.resolve(file);
	try { resolved = fs.realpathSync(resolved); }
	catch (error) { if (error.code !== "ENOENT") throw error; }
	return resolved.toLowerCase();
}
// Nonblocking for tool preflight: waiting here can deadlock siblings that have not executed yet.
export function tryPlanLock(file: string): (() => void) | undefined {
	const key = planLockKey(file);
	const dir = path.join(os.tmpdir(), "plan3-locks");
	fs.mkdirSync(dir, { recursive: true });
	const base = path.join(dir, crypto.createHash("sha256").update(key).digest("hex").slice(0, 32));
	const { info } = takeSessionLock(base, "plan3", false);
	if (info) return () => releaseSessionLock(base, info);
}
// Pi sessions and the hub share the same lock; native Edit/Write reserve it during preflight.
async function acrossProcesses<T>(file: string, change: () => T | Promise<T>): Promise<T> {
	const deadline = Date.now() + 10_000;
	let release;
	while (!(release = tryPlanLock(file))) {
		if (Date.now() > deadline) throw new Error("The plan or diagram is being saved by another operation; try again.");
		await new Promise(resolve => setTimeout(resolve, 20));
	}
	try { return await change(); } finally { release(); }
}
/** A project-relative path that cannot escape the project or pass through a symlink. */
export function confined(cwd: string, relative: string) {
	if (!relative || path.isAbsolute(relative) || relative.includes("\\") || relative.split("/").some(part => !part || part === "." || part === ".." || part.trim() !== part || part.endsWith(".") || /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(part) || /[:\x00-\x1f]/.test(part))) throw new Error("Path escapes the project.");
	let current = path.resolve(cwd);
	for (const part of relative.split("/")) {
		current = path.join(current, part);
		let stat;
		try { stat = fs.lstatSync(current); } catch (error) { if (error.code !== "ENOENT") throw error; }
		if (stat?.isSymbolicLink()) throw new Error("Path cannot traverse a symlink.");
	}
	return current;
}
export function read(file: string, max = 512_000) {
	const stat = fs.lstatSync(file);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max) throw new Error("Expected a bounded regular file.");
	return fs.readFileSync(file, "utf8");
}
/** The start of a regular file, for header checks that must not depend on how big the file has grown. */
export function head(file: string, bytes = 16_384) {
	const stat = fs.lstatSync(file);
	if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Expected a regular file.");
	const fd = fs.openSync(file, "r");
	try { const buffer = Buffer.alloc(Math.min(bytes, stat.size)); return buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, 0)).toString("utf8"); } finally { fs.closeSync(fd); }
}
export function atomic(file: string, value: string | Buffer) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const temp = `${file}.${crypto.randomUUID()}.tmp`;
	try { fs.writeFileSync(temp, value, { flag: "wx", mode: 0o600 }); fs.renameSync(temp, file); }
	finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
export async function movePlanWithDiagram(cwd: string, from: string, to: string) {
	const checked = (file: string) => {
		const relative = path.relative(path.resolve(cwd), path.resolve(file)).replaceAll("\\", "/");
		if (!/^docs\/plans\/(?:done\/)?[^/]+\.md$/.test(relative)) throw new Error("Plan move escapes docs/plans.");
		return confined(cwd, relative);
	};
	const source = checked(from), destination = checked(to);
	if (source === destination) return;
	const sibling = (file: string) => file.replace(/\.md$/, ".diagram.json");
	return withPlanLock(source, () => withPlanLock(sibling(source), () => {
		const files = [[source, destination]];
		const oldDiagram = confined(cwd, path.relative(cwd, sibling(source)).replaceAll("\\", "/"));
		const newDiagram = confined(cwd, path.relative(cwd, sibling(destination)).replaceAll("\\", "/"));
		if (fs.existsSync(destination) || fs.existsSync(newDiagram)) throw new Error("Plan/diagram move destination already exists; nothing overwritten.");
		read(source, 1_000_000);
		if (fs.existsSync(oldDiagram)) { read(oldDiagram, 1_000_000); files.push([oldDiagram, newDiagram]); }
		fs.mkdirSync(path.dirname(destination), { recursive: true });
		const linked: string[][] = [];
		try {
			// Hard links reserve both destinations without overwriting; unlink only after both exist.
			for (const pair of files) { fs.linkSync(pair[0], pair[1]); linked.push(pair); }
			for (const pair of files) fs.unlinkSync(pair[0]);
		} catch (cause) {
			for (const pair of linked) if (!fs.existsSync(pair[0])) fs.linkSync(pair[1], pair[0]);
			throw new Error("Plan/diagram move failed; original files preserved (destination copies may remain).", { cause });
		}
	}));
}
export function stablePlanId(cwd: string, plan: Plan) {
	if (/^[a-f0-9]{8}$/.test(plan.id)) return plan.id;
	const diagramFile = confined(cwd, path.relative(cwd, plan.file.replace(/\.md$/, ".diagram.json")).replaceAll("\\", "/"));
	if (!fs.existsSync(diagramFile)) return crypto.randomUUID().slice(0, 8);
	let diagram;
	try { diagram = JSON.parse(read(diagramFile, 1_000_000)); } catch (cause) { throw new Error(`Cannot read the plan diagram: ${diagramFile}`, { cause }); }
	if (diagram.version !== 1 || diagram.kind !== "plan" || typeof diagram.plan !== "string" || !/^[a-f0-9]{8}$/.test(diagram.plan)) throw new Error("Hand-named plan diagram needs a stable owner id.");
	return diagram.plan;
}
