// Fixed prebuilt-component recipe: parse source in a child, never import project code/config on the host.
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { astryxRuntime, astryxRuntimeFiles } from "./design-runtime.ts";
import { runAstryx, type LibraryOptions } from "./design-library.ts";

export const APP_FILE = "APP.json";
export const appRecipe = Object.freeze({ schema: 1, framework: "astryx", recipe: "astryx-prebuilt-v1", ...astryxRuntime });
const loaders = { ".js": "jsx", ".jsx": "jsx", ".ts": "ts", ".tsx": "tsx", ".css": "css", ".json": "json", ".html": "text", ".svg": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".webp": "dataurl", ".woff2": "dataurl" };
const safe = (name: string) => /^src\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(name) && !name.split("/").some(part => part === "." || part === ".." || part === "node_modules");
export function appSources(files: Map<string, Buffer>) {
	const sources = [...files].filter(([name]) => name.startsWith("src/" )).sort(([a], [b]) => a.localeCompare(b));
	if (!sources.length || sources.length > 512 || sources.reduce((n, [, bytes]) => n + bytes.length, 0) > 8 * 1024 * 1024) throw new Error("App source must contain 1–512 files and at most 8 MiB.");
	for (const [name] of sources) if (!safe(name) || !loaders[path.posix.extname(name)]) throw new Error(`Unsupported app source path: ${name}.`);
	if (!files.has("src/main.jsx") || !files.has("src/vendor.css")) throw new Error("App needs src/main.jsx and src/vendor.css.");
	return sources.map(([name, bytes]) => [name, bytes.toString("base64")]);
}
export function assertAppRecipe(files: Map<string, Buffer>) {
	const bytes = files.get(APP_FILE);
	if (!bytes || bytes.length > 4096) throw new Error("Missing or oversized APP.json build recipe.");
	let recipe; try { recipe = JSON.parse(bytes.toString()); } catch { throw new Error("Invalid APP.json build recipe."); }
	if (JSON.stringify(recipe) !== JSON.stringify(appRecipe)) throw new Error("App recipe/version/lock differs from the reviewed pin; automatic upgrades and project build scripts are refused.");
	for (const [name, text] of Object.entries(astryxRuntimeFiles)) if (!files.get(name)?.equals(Buffer.from(text))) throw new Error(`App ${name} differs from the reviewed runtime; restore its pinned copy.`);
}
/** Worker entry. Virtual source imports see only the supplied table; package imports see only the verified host cache. */
export async function bundleApp(directory: string, input: { sources: string[][] }) {
	if (!input || !Array.isArray(input.sources) || input.sources.some(row => !Array.isArray(row) || row.length !== 2 || row.some(value => typeof value !== "string"))) throw new Error("Invalid app source table.");
	const files = new Map(input.sources.map(([name, bytes]) => [name, Buffer.from(bytes, "base64")]));
	if (files.size !== input.sources.length) throw new Error("Duplicate app source path.");
	appSources(files);
	const cache = fs.realpathSync(path.join(directory, "node_modules"));
	const insideCache = (file: string) => { const rel = path.relative(cache, fs.realpathSync(file)); if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Package import escapes the pinned runtime."); };
	const { build } = await import(pathToFileURL(path.join(cache, "esbuild/lib/main.js")).href);
	const outdir = path.join(directory, "app-output");
	const result = await build({
		absWorkingDir: directory, entryPoints: [{ in: "src/main.jsx", out: "app" }, { in: "src/vendor.css", out: "astryx" }], outdir,
		bundle: true, write: false, format: "iife", platform: "browser", minify: true, jsx: "automatic", tsconfigRaw: {},
		define: { "process.env.NODE_ENV": '"production"' }, legalComments: "none", logLevel: "silent", metafile: true,
		assetNames: "[name]-[hash]", loader: Object.fromEntries(Object.entries(loaders).filter(([, value]) => value === "dataurl")),
		plugins: [{ name: "confined-design-source", setup(build) {
			build.onResolve({ filter: /.*/ }, async args => {
				if (args.pluginData === "cache-resolution") return;
				if (args.kind === "url-token" && args.path.startsWith("data:")) return { path: args.path, external: true };
				if (/[:\\\x00-\x1f]/.test(args.path) || path.isAbsolute(args.path) || args.path.startsWith("//")) throw new Error("App imports must be local source or pinned packages, never URLs, absolute paths or Node builtins.");
				if (args.kind === "entry-point" || args.namespace === "design-source" && args.path.startsWith(".")) {
					const name = args.kind === "entry-point" ? args.path : path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path));
					const found = [name, ...[".js", ".jsx", ".ts", ".tsx", ".json", "/index.js", "/index.jsx"].map(ext => name + ext)].find(key => safe(key) && files.has(key));
					if (!found) throw new Error(`Missing confined app source: ${name}.`);
					return { path: found, namespace: "design-source" };
				}
				const resolved = await build.resolve(args.path, { resolveDir: args.namespace === "design-source" ? directory : args.resolveDir, kind: args.kind, pluginData: "cache-resolution" });
				if (resolved.errors.length) return { errors: resolved.errors };
				if (resolved.external || resolved.namespace !== "file") throw new Error("External package imports are refused.");
				insideCache(resolved.path);
				return { path: resolved.path };
			});
			build.onLoad({ filter: /.*/, namespace: "design-source" }, args => ({ contents: files.get(args.path), loader: loaders[path.posix.extname(args.path)] }));
		} }],
	});
	if (Object.values(result.metafile.outputs).some((out: any) => out.imports.some(imp => imp.external && !imp.path.startsWith("data:")))) throw new Error("App bundle retained an external runtime dependency.");
	if (result.outputFiles.reduce((n, file) => n + file.contents.length, 0) > 8 * 1024 * 1024) throw new Error("App output exceeds 8 MiB.");
	return result.outputFiles.map(file => ["assets/" + path.relative(outdir, file.path).split(path.sep).join("/"), Buffer.from(file.contents).toString("base64")]);
}
export async function buildApp(files: Map<string, Buffer>, options: LibraryOptions = {}) {
	assertAppRecipe(files);
	const sources = appSources(files), { value } = await runAstryx("bundleApp", { sources }, options);
	if (!Array.isArray(value) || value.some(row => !Array.isArray(row) || row.length !== 2 || !/^assets\/[a-zA-Z0-9_-]+\.(?:js|css|svg|png|jpg|jpeg|webp|woff2)$/.test(row[0]) || typeof row[1] !== "string")) throw new Error("Invalid app build output.");
	const output = new Map<string, Buffer>(value.map(([name, bytes]) => [name, Buffer.from(bytes, "base64")]));
	if (!output.has("assets/app.js") || !output.has("assets/astryx.css")) throw new Error("App build omitted its required local bundles.");
	if (!output.has("assets/app.css")) output.set("assets/app.css", Buffer.alloc(0));
	const published = new Map<string, Buffer>(), links: Record<string, string> = {};
	for (const [name, bytes] of output) {
		const final = name.replace(/\.(js|css)$/, `-${createHash("sha256").update(bytes).digest("hex")}.$1`);
		links[name] = final; published.set(final, bytes);
	}
	for (const [name, bytes] of files) if (/^src\/screens\/[\w.-]+\.html?$/.test(name)) {
		let html = bytes.toString();
		for (const [token, asset] of Object.entries({ appScript: "assets/app.js", appStyle: "assets/app.css", vendorStyle: "assets/astryx.css" })) {
			if (!html.includes(`{{${token}}}`)) throw new Error(`${name} needs {{${token}}} so HTML and bundles stay matched.`);
			html = html.replaceAll(`{{${token}}}`, links[asset]);
		}
		published.set(path.posix.basename(name), Buffer.from(html));
	}
	if (!published.has("index.html")) throw new Error("App needs src/screens/index.html.");
	return published;
}

/** Minimal functional foundation; the design agent replaces its content with the actual brief. */
export function appStarter(title: string) {
	const htmlTitle = title.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
	return new Map<string, Buffer>(Object.entries({
		...astryxRuntimeFiles,
		[APP_FILE]: JSON.stringify(appRecipe, null, 2) + "\n",
		"src/screens/index.html": `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlTitle}</title><link rel="stylesheet" href="{{vendorStyle}}"><link rel="stylesheet" href="{{appStyle}}"></head><body><div id="root" data-page="index"></div><script defer src="{{appScript}}"></script></body></html>\n`,
		"src/styles.css": `:root{font-family:system-ui,sans-serif;color:#242424;background:#fafafa}body{margin:0}.starter{max-width:48rem;margin:0 auto;padding:clamp(1.25rem,5vw,4rem)}h1{font-size:clamp(1.75rem,4vw,3rem);line-height:1.15}p{line-height:1.6;max-width:65ch}.astryx-button{font-family:inherit}@media(pointer:coarse){.astryx-button{min-width:44px;min-height:44px}}\n`,
		"src/vendor.css": '@import "@astryxdesign/core/reset.css";\n@import "@astryxdesign/core/astryx.css";\n@import "@astryxdesign/theme-neutral/theme.css";\n',
		"src/main.jsx": `import "./styles.css";\nimport {createRoot} from "react-dom/client";\nimport {Theme} from "@astryxdesign/core/theme";\nimport {neutralTheme} from "@astryxdesign/theme-neutral/built";\nimport {App} from "./App.jsx";\nlet ready;\nwindow.designReady = new Promise(resolve => { ready = resolve; });\nconst root = document.getElementById("root");\ncreateRoot(root).render(<Theme theme={neutralTheme} mode="light"><App page={root.dataset.page} onReady={ready}/></Theme>);\n`,
		"src/App.jsx": `import {useState, useLayoutEffect} from "react";\nimport {flushSync} from "react-dom";\nimport {Button} from "@astryxdesign/core/Button";\nexport function App({page, onReady}) {\n  const [started, setStarted] = useState(false);\n  useLayoutEffect(() => {\n    window.designPreview = {\n      capture: () => ({started}),\n      restore(value) {\n        if (!value || typeof value !== "object" || Object.keys(value).length !== 1 || typeof value.started !== "boolean") throw Error("Unsupported starter state");\n        flushSync(() => setStarted(value.started));\n      },\n      states: {initial: {started: false}, started: {started: true}}\n    };\n    onReady();\n  }, [started, onReady]);\n  return <main className="starter" data-id="main">\n    <h1 data-id="page-heading">{${JSON.stringify(title)}}</h1>\n    <p data-id="starter-status" role="status">{started ? "Ready for your design." : "Pinned components are ready. Replace this starter with the design brief."}</p>\n    <Button label={started ? "Reset starter" : "Try component"} onClick={() => setStarted(!started)} data-id="starter-action"/>\n  </main>;\n}\n`,
	}).map(([name, text]) => [name, Buffer.from(text)]));
}
