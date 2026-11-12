#!/usr/bin/env node
// V-07 maintainer prototype: render pinned Astryx component examples into images and measure them.
// Uses only the already-installed pinned runtime (never installs) and a headless agent-browser session; never runs while browsing.
// Usage: node scripts/astryx-component-shots.mjs [outDir] [Component ...]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { runAstryx } = await jiti.import("../extensions/design-library.ts");
const { ensureDesignRuntime } = await jiti.import("../extensions/design-runtime.ts");
const [outArg, ...picked] = process.argv.slice(2);
const out = path.resolve(outArg ?? path.join(os.tmpdir(), "astryx-component-shots"));
const names = picked.length ? picked : ["Button", "Card", "TextInput", "Banner", "Badge"];
const runtime = () => ensureDesignRuntime({ confirm: async () => false }); // declined: a missing runtime fails instead of downloading
const session = `astryx-shots-${process.pid}`;
const browser = (...args) => execFileSync("agent-browser", ["--session", session, ...args], { encoding: "utf8", shell: process.platform === "win32", timeout: 60_000, input: args.includes("--stdin") ? browser.input : undefined });
const kb = bytes => `${(bytes / 1024).toFixed(1)} KB`;

const vendor = '@import "@astryxdesign/core/reset.css";\n@import "@astryxdesign/core/astryx.css";\n@import "@astryxdesign/theme-neutral/theme.css";\n';
const main = `import {createRoot} from "react-dom/client";\nimport {Theme} from "@astryxdesign/core/theme";\nimport {neutralTheme} from "@astryxdesign/theme-neutral/built";\nimport Example from "./Example.tsx";\ncreateRoot(document.getElementById("root")).render(<Theme theme={neutralTheme} mode="light"><div id="shot" style={{display:"inline-block",padding:24,minWidth:320,maxWidth:640,background:"var(--color-background, #fff)"}}><Example/></div></Theme>);\nrequestAnimationFrame(() => requestAnimationFrame(() => { window.shotReady = true; }));\n`;
const toWebp = quality => `(async () => { const img = new Image(); img.src = ${JSON.stringify("__PNG__")}; await img.decode(); const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext("2d").drawImage(img, 0, 0); return c.toDataURL("image/webp", ${quality}).split(",")[1]; })()`;

fs.mkdirSync(out, { recursive: true });
const rows = [];
try {
	browser("set", "viewport", "720", "560", "2");
	for (const name of names) try {
		const started = Date.now();
		const { value } = await runAstryx("libraryLookup", { catalog: "component", name, section: "examples" }, { runtime });
		const example = value?.data?.examples?.[0];
		if (!example?.code) { rows.push({ name, error: "no pinned example" }); continue; }
		const component = [...example.code.matchAll(/^function ([A-Z]\w*)\s*\(/gm)].at(-1)?.[1];
		if (!component) { rows.push({ name, error: "example has no top-level component" }); continue; }
		const sources = [["src/main.jsx", main], ["src/vendor.css", vendor], ["src/Example.tsx", `${example.code}\nexport default ${component};\n`]].map(([file, text]) => [file, Buffer.from(text).toString("base64")]);
		const built = (await runAstryx("bundleApp", { sources }, { runtime })).value;
		const dir = path.join(out, name);
		fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
		for (const [file, bytes] of built) fs.writeFileSync(path.join(dir, file), Buffer.from(bytes, "base64"));
		const css = built.some(([file]) => file === "assets/app.css") ? '<link rel="stylesheet" href="assets/app.css">' : "";
		fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="assets/astryx.css">${css}</head><body style="margin:0;background:#fff"><div id="root"></div><script src="assets/app.js"></script></body></html>`);
		const bundled = Date.now();
		browser("open", pathToFileURL(path.join(dir, "index.html")).href);
		browser("wait", "--fn", "window.shotReady === true");
		const png = path.join(out, `${name}.png`);
		browser("screenshot", "#shot", png);
		const shot = Date.now(), pngBytes = fs.readFileSync(png);
		browser.input = toWebp(0.8).replace("__PNG__", `data:image/png;base64,${pngBytes.toString("base64")}`);
		const webp = Buffer.from(JSON.parse(browser("--json", "eval", "--stdin")).data.result, "base64");
		fs.writeFileSync(path.join(out, `${name}.webp`), webp);
		rows.push({ name, example: example.label, width: pngBytes.readUInt32BE(16), height: pngBytes.readUInt32BE(20), png: pngBytes.length, webp: webp.length, bundleMs: bundled - started, shotMs: shot - bundled });
	} catch (error) { rows.push({ name, error: String(error.message).split("\n")[0].slice(0, 300) }); }
} finally { try { browser("close"); } catch {} }

fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(rows, null, 2));
for (const row of rows) console.log(row.error ? `${row.name}: ${row.error}` : `${row.name}: ${row.width}x${row.height} (2x) png ${kb(row.png)} webp ${kb(row.webp)}; build ${row.bundleMs} ms, render+shot ${row.shotMs} ms — "${row.example}"`);
const ok = rows.filter(row => !row.error);
if (ok.length) console.log(`average webp ${kb(ok.reduce((n, row) => n + row.webp, 0) / ok.length)}; images in ${out}`);
if (ok.length < names.length) process.exitCode = 1;
