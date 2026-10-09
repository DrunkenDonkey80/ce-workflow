import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { normalizeOpenDesignCommandSpec, redactOpenDesignText } from "./opendesign-client.ts";

const exec = promisify(execFile);
export const nativeFileHash = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
export function nativeFileName(name: string) {
	if (typeof name !== "string" || name.length > 300 || name.startsWith("-") || /%(?:2e|2f|5c|00|3a)/i.test(name) || !/\.html?$/i.test(name) || name.includes("\\") || name.split("/").some(part => !part || part === "." || part === ".." || /[:\x00-\x1f]/.test(part) || part.trim() !== part || part.endsWith(".") || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part))) throw new Error("Select a safe project-relative HTML file.");
	return name;
}
function loopback(value: string) {
	let url: URL;
	try { url = new URL(value); } catch { throw new Error("Native export requires a valid local OpenDesign daemon URL."); }
	if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Native export requires the selected local OpenDesign daemon.");
	return url.origin;
}
const token = (value: string) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
function installed(env: NodeJS.ProcessEnv) {
	const root = path.join(env.APPDATA ?? path.join(env.USERPROFILE ?? os.homedir(), "AppData", "Roaming"), "Open Design", "launcher", "channels");
	const candidates: any[] = [];
	if (!fs.existsSync(root)) return candidates;
	for (const channel of fs.readdirSync(root).filter(token)) {
		const namespaces = path.join(root, channel, "namespaces");
		if (!fs.existsSync(namespaces)) continue;
		for (const namespace of fs.readdirSync(namespaces).filter(token)) {
			try {
				const runtime = JSON.parse(fs.readFileSync(path.join(namespaces, namespace, "runtime.json"), "utf8"));
				if (runtime.schemaVersion !== 1 || runtime.channel !== channel || runtime.namespace !== namespace || !token(runtime.active?.version)) continue;
				const payload = path.join(namespaces, namespace, "versions", runtime.active.version, "payload");
				const cli = path.join(payload, "resources", "app", "prebundled", "daemon", "daemon-cli.mjs");
				const sdk = path.join(payload, "resources", "app", "node_modules", "@open-design", "sidecar", "dist", "index.mjs");
				if (fs.existsSync(cli) && fs.existsSync(sdk)) candidates.push({ command: env.OD_NODE_BIN ?? process.execPath, args: [cli], env: {}, sdk, stamp: { channel, namespace, source: "packaged", mode: "runtime", app: "daemon" } });
			} catch { /* An incomplete installation is not a running native endpoint. */ }
		}
	}
	return candidates;
}
async function bytes(response: Response, max: number) {
	if (!response.ok) throw new Error(`OpenDesign export read failed (HTTP ${response.status}); check project access and the running app.`);
	const reader = response.body?.getReader();
	if (!reader) throw new Error("OpenDesign returned an empty response.");
	const chunks: Buffer[] = []; let size = 0;
	try {
		for (;;) {
			const next = await reader.read(); if (next.done) break;
			size += next.value.length;
			if (size > max) throw new Error("OpenDesign export response is too large.");
			chunks.push(Buffer.from(next.value));
		}
		return Buffer.concat(chunks);
	} finally { await reader.cancel().catch(() => {}); }
}
export async function nativeExportClient(commandSpec?: any) {
	const configured = commandSpec ? normalizeOpenDesignCommandSpec(commandSpec) : undefined;
	let command: any, base: string;
	const address = configured?.env?.OD_DAEMON_URL ?? process.env.OD_DAEMON_URL;
	const selectedBase = address ? loopback(address) : undefined;
	if (configured && selectedBase) {
		command = { ...configured, args: configured.args.filter(value => value !== "mcp") };
		base = selectedBase;
	} else {
		let candidates = installed(process.env);
		if (configured) {
			// A configured packaged CLI may name an old alias: match its namespace, never a different app.
			const cli = configured.args.find(value => value.endsWith("daemon-cli.mjs"));
			if (!cli) throw new Error("Native finish needs a packaged OpenDesign CLI or a configured CLI with OD_DAEMON_URL.");
			let config;
			try { config = JSON.parse(fs.readFileSync(path.resolve(path.dirname(cli), "../../..", "open-design-config.json"), "utf8")); }
			catch { throw new Error("Cannot read the configured OpenDesign namespace; check its packaged CLI path."); }
			candidates = candidates.filter(candidate => candidate.stamp.namespace === config.namespace);
		}
		const running: any[] = [];
		for (const candidate of candidates) {
			try {
				const sdk = await import(pathToFileURL(candidate.sdk).href);
				const status = await sdk.getSidecarStatus(candidate.stamp, { timeoutMs: 1500 });
				const endpoint = loopback(status.url);
				if (status.pid > 0 && (!selectedBase || selectedBase === endpoint)) running.push({ ...candidate, base: endpoint });
			} catch { /* No bootstrap, protocol guessing, restart or new generation. */ }
		}
		if (running.length !== 1) throw new Error(running.length ? "More than one native OpenDesign is running; configure the desired CLI and local OD_DAEMON_URL." : "Open the native OpenDesign app first; native finish does not restart it or generate a replacement.");
		command = configured ? { ...configured, args: configured.args.filter(value => value !== "mcp") } : running[0]; base = running[0].base;
	}
	const env = { ...process.env, ...command.env };
	const headers = env.OD_TOOL_TOKEN ? { authorization: `Bearer ${env.OD_TOOL_TOKEN}` } : {};
	const get = async (route: string, max = 128_000) => bytes(await fetch(`${base}${route}`, { headers, redirect: "error", signal: AbortSignal.timeout(15_000) }), max);
	return {
		async json(route: string) {
			const data = await get(route);
			try { return JSON.parse(data.toString("utf8")); }
			catch { throw new Error("OpenDesign returned invalid export metadata JSON."); }
		},
		file: (project: string, name: string) => get(`/api/projects/${encodeURIComponent(project)}/files/${name.split("/").map(encodeURIComponent).join("/")}`, 2_000_000),
		async export(project: string, name: string, format: "html" | "image", target: string) {
			if (fs.existsSync(target)) throw new Error("Refusing to overwrite a native design snapshot.");
			const args = [...command.args, "export", name, "--project", project, "--format", format, "--out", target, "--daemon-url", base, "--json", ...(format === "image" ? ["--page", "--image-format", "png"] : [])];
			try {
				const result = await exec(command.command, args, { env, timeout: 90_000, maxBuffer: 128_000, windowsHide: true });
				const receipt = JSON.parse(result.stdout);
				if (receipt.ok !== true || path.resolve(receipt.path ?? "") !== path.resolve(target)) throw new Error("Native CLI returned an invalid export receipt.");
			} catch (error) { throw new Error(`OpenDesign native export failed: ${redactOpenDesignText(error.stderr || error.message, 500)}`); }
		}
	};
}
export function inspectNativeExport(file: string, format: "html" | "image") {
	const stat = fs.lstatSync(file);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.size < (format === "html" ? 100 : 33) || stat.size > (format === "html" ? 2_000_000 : 8_000_000)) throw new Error("Native export must be a nonempty bounded regular file.");
	const data = fs.readFileSync(file);
	if (format === "image" && (!data.readUInt32BE(16) || !data.readUInt32BE(20) || data.readUInt32BE(16) * data.readUInt32BE(20) > 32_000_000)) throw new Error("Native PNG dimensions are empty or too large.");
	if (format === "html" ? !/<html[\s>]/i.test(data.toString("utf8")) : !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Native export has an invalid HTML/PNG signature.");
	return { bytes: data.length, sha256: nativeFileHash(data) };
}
