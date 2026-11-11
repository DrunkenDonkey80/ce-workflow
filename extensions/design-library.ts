// Shared, bounded public-API worker for the optional pinned host runtime.
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { astryxRuntime, ensureDesignRuntime } from "./design-runtime.ts";

type Runtime = { directory: string; lockDigest: string; versions: Record<string, string> };
export type LibraryOptions = {
	confirm?: (title: string, purpose: string) => Promise<boolean>;
	progress?: (message: string) => void;
	signal?: AbortSignal;
	runtime?: () => Promise<Runtime>;
};
const lookups = new Map<string, any>();

export async function runAstryx(method: "themePalette" | "libraryLookup" | "bundleApp", input, options: LibraryOptions = {}) {
	options.signal?.throwIfAborted();
	const runtime = options.runtime ? await options.runtime() : await ensureDesignRuntime(options);
	options.signal?.throwIfAborted();
	if (runtime.lockDigest !== astryxRuntime.lockDigest || Object.entries(astryxRuntime.versions).some(([name, version]) => runtime.versions[name] !== version)) throw new Error("Astryx runtime version/lock does not match the reviewed pin.");
	const key = method === "libraryLookup" ? JSON.stringify([runtime.lockDigest, runtime.directory, input]) : undefined;
	if (key && lookups.has(key)) return { runtime, value: structuredClone(lookups.get(key)) };
	const worker = fileURLToPath(new URL({ themePalette: "./design-theme.ts", libraryLookup: "./design-lookup.ts", bundleApp: "./design-app.ts" }[method], import.meta.url));
	const jiti = createRequire(import.meta.url).resolve("jiti");
	const bootstrap = `require(${JSON.stringify(jiti)}).createJiti(${JSON.stringify(worker)}, {fsCache:false}).import(${JSON.stringify(worker)}).then(m=>m[${JSON.stringify(method)}](process.argv[1],JSON.parse(require('node:fs').readFileSync(0,'utf8')))).then(value=>process.stdout.write(JSON.stringify(value))).catch(error=>{console.error(String(error.message).slice(0,600));process.exitCode=1;});`;
	const value: any = await new Promise((resolve, reject) => {
		const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(npm_config_|astryx_|esbuild_|node_options$|node_path$)/i.test(name)));
		const child = execFile(process.execPath, ["-e", bootstrap, runtime.directory], { cwd: runtime.directory, env, shell: false, windowsHide: true, timeout: method === "bundleApp" ? 60_000 : 20_000, maxBuffer: method === "bundleApp" ? 16 * 1024 * 1024 : 128 * 1024, signal: options.signal }, (error, stdout, stderr) => {
			if (error) return reject(new Error(`Astryx ${method === "themePalette" ? "theme generation" : method === "bundleApp" ? "app build" : "lookup"} failed: ${String(stderr || error.message).slice(0, 600)}`, { cause: error }));
			try { resolve(JSON.parse(stdout)); } catch (cause) { reject(new Error("Astryx returned an invalid public API response.", { cause })); }
		});
		// A worker that exits early reports its failure through execFile, not an unhandled EPIPE.
		child.stdin!.on("error", () => {});
		child.stdin!.end(JSON.stringify(input));
	});
	options.signal?.throwIfAborted();
	if (key) {
		if (lookups.size >= 32) lookups.delete(lookups.keys().next().value!);
		lookups.set(key, structuredClone(value));
	}
	return { runtime, value };
}
