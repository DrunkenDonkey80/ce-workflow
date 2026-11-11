// Optional, host-only Astryx cache. Project manifests/configs never control this installer.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { confined, read, withPlanLock } from "./plan3-files.ts";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const asset = (name: string) => read(fileURLToPath(new URL(`./astryx-runtime/${name}`, import.meta.url)), 1_000_000);
function json(value: string, label: string) {
	try { return JSON.parse(value); } catch (cause) { throw new Error(`Invalid Astryx runtime ${label}.`, { cause }); }
}
const manifestText = asset("manifest.json"), lockText = asset("runtime-lock.json");
const manifest = json(manifestText, "manifest"), lock = json(lockText, "lock"), notices = json(asset("notices.json"), "notices");
if (lock.lockfileVersion !== 3 || JSON.stringify(lock.packages?.[""]?.dependencies) !== JSON.stringify(manifest.dependencies)) throw new Error("Astryx runtime manifest/lock mismatch.");
for (const [file, pkg] of Object.entries(lock.packages) as [string, any][]) {
	if (!file) continue;
	if (!/^node_modules\/(?:[@a-z0-9_.-]+\/)*[@a-z0-9_.-]+$/.test(file) || file.split("/").includes("..") || pkg.link || !/^https:\/\/registry\.npmjs\.org\//.test(pkg.resolved) || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(pkg.integrity)) throw new Error("Unreviewed Astryx dependency in the bundled lock.");
	const notice = notices.packages?.[file];
	if (notice?.version !== pkg.version || !notice.sources?.length || notice.sources.some(source => typeof source.text !== "string" || source.text.length < 100)) throw new Error(`Missing full notice for ${file}.`);
}
const noticeText = "# Astryx runtime third-party notices\n\n" + Object.values(notices.packages).map((pkg: any) => `## ${pkg.name}@${pkg.version}\n\n${pkg.sources.map(source => `Source: ${source.source ?? source.url}\n\n${source.text}`).join("\n\n")}\n`).join("\n");
export const astryxRuntimeFiles = Object.freeze({ "package.json": manifestText, "package-lock.json": lockText, "THIRD_PARTY_NOTICES.md": noticeText });
export const astryxRuntime = Object.freeze({ lockDigest: hash(lockText), versions: Object.freeze({ ...manifest.dependencies }) });
type Options = { agentDir?: string; signal?: AbortSignal; confirm?: (title: string, purpose: string) => Promise<boolean>; progress?: (message: string) => void };
type Run = (exe: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; signal?: AbortSignal }) => Promise<{ stdout: string }>;
const execute = promisify(execFile);
const runFile: Run = async (exe, args, options) => execute(exe, args, { ...options, encoding: "utf8", windowsHide: true, maxBuffer: 1_000_000 });

function npmCli() {
	const root = path.dirname(process.execPath);
	const npm = createRequire(import.meta.url).resolve("npm/package.json", { paths: [root, path.resolve(root, "../lib"), ...(process.env.PATH ?? "").split(path.delimiter).filter(dir => path.isAbsolute(dir))] });
	return path.join(path.dirname(npm), "bin/npm-cli.js");
}
function installedPackages(directory: string) {
	const matches = (list: string[] | undefined, value: string) => !list || (!list.includes(`!${value}`) && (list.every(item => item.startsWith("!")) || list.includes(value) || list.includes("any")));
	const installed: [string, any][] = [];
	for (const [file, pkg] of Object.entries(lock.packages) as [string, any][]) {
		if (!file || !matches(pkg.os, process.platform) || !matches(pkg.cpu, process.arch)) continue;
		const actual = json(read(confined(directory, `${file}/package.json`)), file);
		if (actual.name !== file.split("node_modules/").at(-1) || actual.version !== pkg.version) throw new Error(`Astryx cache has the wrong package: ${file}.`);
		installed.push([file, pkg]);
	}
	return installed;
}
function inventory(directory: string) {
	const digest = createHash("sha256");let bytes = 0, count = 0;
	function walk(relative = "") {
		for (const name of fs.readdirSync(path.join(directory, relative)).sort()) {
			const file = relative ? `${relative}/${name}` : name;
			if (file === "receipt.json") continue;
			const target = path.join(directory, file), stat = fs.lstatSync(target);
			if (stat.isSymbolicLink()) throw new Error("Astryx cache cannot contain symlinks.");
			if (stat.isDirectory()) { walk(file); continue; }
			if (!stat.isFile() || stat.size > 64 * 1024 * 1024 || ++count > 50_000 || (bytes += stat.size) > 512 * 1024 * 1024) throw new Error("Astryx cache exceeds its bounded file inventory.");
			digest.update(JSON.stringify([file, stat.size, hash(fs.readFileSync(target))]));
		}
	}
	walk();return { digest: digest.digest("hex"), bytes, count };
}
function verify(directory: string) {
	for (const [file, expected] of [["package.json", manifestText], ["package-lock.json", lockText], ["THIRD_PARTY_NOTICES.md", noticeText]]) if (read(confined(directory, file), 1_000_000) !== expected) throw new Error(`Astryx cache ${file} does not match the reviewed runtime.`);
	installedPackages(directory);
	return inventory(directory);
}
function archiveBytes(directory: string, installed: [string, any][]) {
	let bytes = 0;
	for (const integrity of new Set(installed.map(([, pkg]) => pkg.integrity as string))) {
		const hex = Buffer.from(integrity.slice(7), "base64").toString("hex");
		const archive = confined(directory, `.npm-cache/_cacache/content-v2/sha512/${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex.slice(4)}`);
		const stat = fs.lstatSync(archive);
		if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Missing verified package archive byte count.");
		bytes += stat.size;
	}
	return bytes; // compressed package payloads, not TLS/HTTP overhead or metadata
}

/** Only callers with an explicit host approval UI can provision a cold cache. Warm use runs no installer/registry command. */
export async function ensureDesignRuntime(options: Options = {}, run: Run = runFile) {
	const [major, minor] = process.versions.node.split(".").map(Number);
	if (major < 22 || (major === 22 && minor < 13)) throw new Error("Astryx tooling requires Node 22.13.0 or newer; HTML designs remain available.");
	options.signal?.throwIfAborted();
	const agent = options.agentDir ?? process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
	const relative = `cache/design-runtimes/astryx/${astryxRuntime.lockDigest}/${process.platform}-${process.arch}`;
	return withPlanLock(path.resolve(agent, relative), async () => {
		options.signal?.throwIfAborted();
		const directory = confined(agent, relative), started = Date.now();
		let corrupt = false;
		if (fs.existsSync(directory)) {
			try {
				const receipt = JSON.parse(read(confined(directory, "receipt.json"), 64_000)), files = verify(directory);
				if (receipt.schema !== 1 || receipt.lockDigest !== astryxRuntime.lockDigest || receipt.platform !== process.platform || receipt.arch !== process.arch || receipt.fileDigest !== files.digest || receipt.footprintBytes !== files.bytes || receipt.fileCount !== files.count) throw new Error("Astryx receipt/inventory mismatch.");
				return { directory, cold: false, downloadBytes: 0, elapsedMs: Date.now() - started, footprintBytes: files.bytes, ...astryxRuntime };
			} catch { corrupt = true; }
		}
		const approved = await options.confirm?.("Install the optional Astryx runtime?", `${corrupt ? "The cached runtime failed verification; replace it only after a complete new install. " : ""}Download the reviewed pinned Astryx 0.7.12 dependencies on this host. Package scripts stay disabled; remote clients install nothing. HTML and decks do not need this download.`);
		options.signal?.throwIfAborted();
		if (!approved) throw new Error("Astryx runtime installation declined or approval unavailable; HTML designs remain available.");
		const stage = confined(agent, `${relative}.stage-${randomUUID()}`), previous = confined(agent, `${relative}.previous-${randomUUID()}`), installStart = Date.now();
		const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(npm_config_|node_options$|node_path$|node_tls_reject_unauthorized$)/i.test(key)));
		try {
			fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
			for (const [file, content] of [["package.json", manifestText], ["package-lock.json", lockText], ["THIRD_PARTY_NOTICES.md", noticeText], [".user-npmrc", ""], [".global-npmrc", ""]]) fs.writeFileSync(path.join(stage, file), content, { flag: "wx" });
			options.progress?.("Downloading pinned Astryx dependencies; package scripts are disabled.");
			try {
				await run(process.execPath, [npmCli(), "ci", "--ignore-scripts=true", "--bin-links=false", "--audit=false", "--fund=false", "--update-notifier=false", "--include=optional", "--include=peer", "--registry=https://registry.npmjs.org/", "--fetch-retries=0", `--cache=${path.join(stage, ".npm-cache")}`, `--userconfig=${path.join(stage, ".user-npmrc")}`, `--globalconfig=${path.join(stage, ".global-npmrc")}`], { cwd: stage, env, timeout: 300_000, signal: options.signal });
			} catch (error) {
				options.signal?.throwIfAborted();
				const code = error instanceof Error && "stderr" in error ? String(error.stderr).match(/\bnpm (?:error|ERR!) code ([A-Z0-9_]{1,40})\b/)?.[1] : undefined;
				throw new Error(`Pinned Astryx installation failed (${code ?? "INSTALL_FAILED"}: offline, registry unavailable or package verification failed). No partial runtime was activated; HTML designs remain available.`);
			}
			options.signal?.throwIfAborted();options.progress?.("Verifying exact packages, full notices and the native builder.");
			const installed = installedPackages(stage), downloadBytes = archiveBytes(stage, installed);
			const binary = confined(stage, `node_modules/@esbuild/${process.platform}-${process.arch}/${process.platform === "win32" ? "esbuild.exe" : "bin/esbuild"}`);
			const version = await run(binary, ["--version"], { cwd: stage, env, timeout: 10_000, signal: options.signal });
			if (version.stdout.trim() !== manifest.dependencies.esbuild) throw new Error("Pinned native builder verification failed; install scripts will not be enabled.");
			fs.rmSync(path.join(stage, ".npm-cache"), { recursive: true, force: true });
			fs.unlinkSync(path.join(stage, ".user-npmrc"));fs.unlinkSync(path.join(stage, ".global-npmrc"));
			const files = verify(stage), elapsedMs = Date.now() - installStart;
			const receipt = { schema: 1, lockDigest: astryxRuntime.lockDigest, platform: process.platform, arch: process.arch, fileDigest: files.digest, fileCount: files.count, footprintBytes: files.bytes, downloadBytes, installElapsedMs: elapsedMs };
			fs.writeFileSync(path.join(stage, "receipt.json"), JSON.stringify(receipt) + "\n", { flag: "wx", mode: 0o600 });
			options.signal?.throwIfAborted();
			if (fs.existsSync(directory)) fs.renameSync(directory, previous);
			try { fs.renameSync(stage, directory); }
			catch (error) { if (fs.existsSync(previous)) fs.renameSync(previous, directory); throw error; }
			if (fs.existsSync(previous)) fs.rmSync(previous, { recursive: true, force: true });
			options.progress?.(`Astryx ready: ${downloadBytes} package payload bytes downloaded, ${files.bytes} bytes installed in ${elapsedMs} ms.`);
			return { directory, cold: true, downloadBytes, elapsedMs, footprintBytes: files.bytes, ...astryxRuntime };
		} finally { fs.rmSync(stage, { recursive: true, force: true }); }
	}).catch(error => {
		options.signal?.throwIfAborted();
		// shortcut: another process waits ten seconds on the shared lock; extend it if cold-install busy retries become common.
		if (error instanceof Error && error.message === "The plan or diagram is being saved by another process; try again.") throw new Error("Astryx runtime is busy in another host session. Retry after it finishes; HTML designs remain available.");
		throw error;
	});
}
