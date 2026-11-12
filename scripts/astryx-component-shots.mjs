#!/usr/bin/env node
// Maintainer script, part of every Astryx pin update (V-09): render one picture per component into
// extensions/astryx-runtime/previews/components/ plus components.json keyed by the pin's lockDigest.
// test-work-design.mjs fails when that lockDigest no longer matches the pin, so a pin update reruns this.
// Uses only the already-installed pinned runtime (never installs) and a headless agent-browser session.
// Example choice (V-08): scripts/astryx-examples/<Name>.jsx wins, otherwise the first pinned example.
// Usage: node scripts/astryx-component-shots.mjs [--out <dir>] [Component ...]   (names: a trial run, nothing bundled)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { ensureDesignRuntime } = await jiti.import("../extensions/design-runtime.ts");
const { libraryLookup } = await jiti.import("../extensions/design-lookup.ts");
const { bundleApp } = await jiti.import("../extensions/design-app.ts");
let catalog;
try { catalog = JSON.parse(fs.readFileSync(new URL("../extensions/astryx-runtime/catalog.json", import.meta.url), "utf8")); }
catch (cause) { throw new Error("extensions/astryx-runtime/catalog.json is unreadable; restore it before rendering.", { cause }); }
const args = process.argv.slice(2), outAt = args.indexOf("--out");
const picked = args.filter((_, i) => outAt < 0 || (i !== outAt && i !== outAt + 1));
const bundled = new URL("../extensions/astryx-runtime/previews/components/", import.meta.url);
const out = outAt >= 0 ? path.resolve(args[outAt + 1]) : picked.length ? path.join(os.tmpdir(), "astryx-component-shots") : bundled.pathname.replace(/^\/([A-Z]:)/, "$1");
const names = picked.length ? picked : Object.values(catalog.groups).flat().map(item => item.name);
const BUDGET = 1.5 * 1024 * 1024; // V-07 decision: 2x webp, ~1.5 MB for all components
const runtime = await ensureDesignRuntime({ confirm: async () => false }); // declined: a missing runtime fails instead of downloading
const session = `astryx-shots-${process.pid}`;
// The binary itself, not the npm .cmd shim: a shell would split arguments such as `wait --fn` scripts.
const agentBrowser = process.platform === "win32" ? path.join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe") : "agent-browser";
const browser = (input, ...rest) => execFileSync(agentBrowser, ["--session", session, ...rest], { encoding: "utf8", timeout: 120_000, input });
const kb = bytes => `${(bytes / 1024).toFixed(1)} KB`;

// 1. One source per component: hand-written, else the pinned CLI's own block template (<Name>Showcase first,
// then any template whose doc says exampleFor <Name>), else the first pinned lookup example.
const blocks = path.join(runtime.directory, "node_modules/@astryxdesign/cli/assets/templates/blocks/components");
const usable = code => !/\bstylex\./.test(code) && [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].every(([, spec]) => /^(react|react-dom|lucide-react|@astryxdesign\/core)(\/|$)/.test(spec));
const templates = new Map(), usedBy = new Map();
for (const folder of fs.existsSync(blocks) ? fs.readdirSync(blocks) : []) for (const file of fs.readdirSync(path.join(blocks, folder))) {
	if (!file.endsWith(".doc.mjs")) continue;
	const target = fs.readFileSync(path.join(blocks, folder, file), "utf8").match(/exampleFor:\s*['"](\w+)['"]/)?.[1];
	const tsx = path.join(blocks, folder, file.replace(/\.doc\.mjs$/, ".tsx"));
	if (target && fs.existsSync(tsx)) templates.set(target, [...templates.get(target) ?? [], tsx].sort((a, b) => Number(b.endsWith(`${target}Showcase.tsx`)) - Number(a.endsWith(`${target}Showcase.tsx`))));
	// Sub-parts (DropdownMenuSubMenu, DropdownMenuRadioItem) rarely have their own template: any template that renders them, later.
	if (fs.existsSync(tsx)) for (const part of new Set([...fs.readFileSync(tsx, "utf8").matchAll(/<([A-Z]\w*)\b/g)].map(match => match[1]))) if (part !== target) usedBy.set(part, [...usedBy.get(part) ?? [], tsx]);
}
// A hand-written example may picture several parts: a "// pictures: TableRow TableCell" line in it.
const shared = new Map();
for (const file of fs.existsSync(new URL("./astryx-examples/", import.meta.url)) ? fs.readdirSync(new URL("./astryx-examples/", import.meta.url)) : []) {
	const code = fs.readFileSync(new URL(`./astryx-examples/${file}`, import.meta.url), "utf8");
	for (const part of code.match(/^\/\/ pictures: (.+)$/m)?.[1].trim().split(/\s+/) ?? []) shared.set(part, code);
}
const sources = new Map(), rows = new Map();
for (const name of names) {
	const own = new URL(`./astryx-examples/${name}.jsx`, import.meta.url);
	if (fs.existsSync(own)) { sources.set(name, { code: fs.readFileSync(own, "utf8"), label: "hand-written" }); continue; }
	if (shared.has(name)) { sources.set(name, { code: shared.get(name), label: "hand-written, shared" }); continue; }
	const template = (templates.get(name) ?? []).find(file => usable(fs.readFileSync(file, "utf8")));
	if (template) { sources.set(name, { code: fs.readFileSync(template, "utf8"), label: `template ${path.basename(template, ".tsx")}` }); continue; }
	const user = (usedBy.get(name) ?? []).find(file => usable(fs.readFileSync(file, "utf8")) && new RegExp(`<${name}\\b`).test(fs.readFileSync(file, "utf8")));
	if (user) { sources.set(name, { code: fs.readFileSync(user, "utf8"), label: `used in template ${path.basename(user, ".tsx")}` }); continue; }
	const example = (await libraryLookup(runtime.directory, { catalog: "component", name, section: "examples" }).catch(() => undefined))?.data?.examples?.[0];
	const component = example?.code && [...example.code.matchAll(/^function ([A-Z]\w*)\s*\(/gm)].at(-1)?.[1];
	if (component && /from\s+['"]\./.test(example.code)) rows.set(name, { name, error: "pinned example imports its own local files" });
	// bundleApp has no StyleX compiler, and one uncompiled stylex.create call stops the whole page.
	else if (component && /\bstylex\./.test(example.code)) rows.set(name, { name, error: "pinned example needs the StyleX compiler" });
	else if (component) sources.set(name, { code: `${example.code}\nexport default ${component};\n`, label: example.label });
	else rows.set(name, { name, error: example?.code ? "pinned example has no top-level component" : "no pinned example" });
}

// Every pinned theme gets one picture of the same small screen (ThemeSample.jsx), in the same bundle.
const THEMES = catalog.themes.map(theme => theme.slug), SAMPLE = "ThemeSample";
sources.set(SAMPLE, { code: fs.readFileSync(new URL("./astryx-examples/ThemeSample.jsx", import.meta.url), "utf8"), label: "theme sample" });

// 2. One bundle for all of them; an example that does not compile is dropped and the rest rebuilt.
const vendor = `@import "@astryxdesign/core/reset.css";\n@import "@astryxdesign/core/astryx.css";\n${THEMES.map(slug => `@import "@astryxdesign/theme-${slug}/theme.css";\n`).join("")}`;
const main = list => `import {Component} from "react";\nimport {createRoot} from "react-dom/client";\nimport {flushSync} from "react-dom";\nimport {Theme} from "@astryxdesign/core/theme";\n${THEMES.map(slug => `import {${slug}Theme} from "@astryxdesign/theme-${slug}/built";\n`).join("")}const themes = {${THEMES.map(slug => `${slug}: ${slug}Theme`).join(", ")}};\n${list.map((name, i) => `import E${i} from "./examples/${name}.tsx";`).join("\n")}\nconst all = {${list.map((name, i) => `${JSON.stringify(name)}: E${i}`).join(", ")}};\nclass Guard extends Component { state = {error: null}; static getDerivedStateFromError(error) { return {error}; } render() { if (this.state.error) { window.shotError = String(this.state.error.message || this.state.error); return null; } return this.props.children; } }\nconst root = createRoot(document.getElementById("root"));\nwindow.show = (name, theme = "neutral") => { window.shotError = null; const Example = all[name]; flushSync(() => root.render(<Theme theme={themes[theme]} mode="light"><div id="shot" key={name + theme} style={name === "ThemeSample" ? {display:"inline-block",padding:32,width:520,background:"var(--color-background-body)"} : {display:"inline-block",padding:24,minWidth:320,maxWidth:640,background:"#fff"}}><Guard><Example/></Guard></div></Theme>)); return new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => done(window.shotError), 150)))); };\n`;
let list = [...sources.keys()], built;
for (let attempt = 0; !built && list.length; attempt++) {
	const files = [["src/main.jsx", main(list)], ["src/vendor.css", vendor], ...list.map(name => [`src/examples/${name}.tsx`, sources.get(name).code])];
	try { built = await bundleApp(runtime.directory, { sources: files.map(([file, text]) => [file, Buffer.from(text).toString("base64")]) }); }
	catch (error) {
		const broken = [...new Set([...String(error.message).matchAll(/src\/examples\/(\w+)\.tsx/g)].map(match => match[1]))];
		if (!broken.length || attempt > 40) throw error;
		for (const name of broken) rows.set(name, { name, error: `does not compile: ${String(error.message).split("\n").find(line => line.includes(name))?.slice(0, 200)}` });
		list = list.filter(name => !broken.includes(name));
	}
}
const page = fs.mkdtempSync(path.join(os.tmpdir(), "astryx-shots-"));
fs.mkdirSync(path.join(page, "assets"));
for (const [file, bytes] of built ?? []) fs.writeFileSync(path.join(page, file), Buffer.from(bytes, "base64"));
fs.writeFileSync(path.join(page, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="assets/astryx.css">${fs.existsSync(path.join(page, "assets/app.css")) ? '<link rel="stylesheet" href="assets/app.css">' : ""}</head><body style="margin:0;background:#fff"><div id="root"></div><script src="assets/app.js"></script></body></html>`);

// 3. Picture each one (2x), as webp q0.8 encoded by the same headless Chromium.
// crop: [x, y, w, h] in CSS pixels of a viewport shot (2x); none for an element shot.
const toWebp = (png, crop) => `(async () => { const img = new Image(); img.src = "data:image/png;base64,${png.toString("base64")}"; await img.decode(); const [x, y, w, h] = ${JSON.stringify(crop?.map(n => Math.round(n * 2)) ?? null)} ?? [0, 0, img.naturalWidth, img.naturalHeight]; const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, x, y, w, h, 0, 0, w, h); return c.toDataURL("image/webp", 0.8).split(",")[1]; })()`;
// Components whose showcase is only a trigger until used: open them first, then picture the trigger plus what opened.
const OPEN = { Tooltip: "hover", HoverCard: "hover", InfoTip: "hover", TopNavMenu: "click", TopNavMegaMenu: "click", BaseTypeahead: "click", ContextMenu: "contextmenu", ContextMenuItem: "contextmenu" };
for (const name of ["BottomSheet", "BottomSheetSwitcher", "Drawer", "DrawerHeader", "DropdownMenu", "DropdownMenuDivider", "DropdownMenuGroup", "DropdownMenuItem", "DropdownMenuSubMenu", "Lightbox", "MobileNav", "MoreMenu", "Popover", "TabMenu"]) OPEN[name] = "click";
// A menu trigger (aria-haspopup) wins over the first button, so TabMenu opens "More" instead of selecting a tab.
const markTrigger = "(() => { const shot = document.getElementById('shot'); (shot.querySelector('[aria-haspopup]:not([aria-haspopup=false])') ?? shot.querySelector('button, [role=button], a[href], img, input'))?.setAttribute('data-shot-trigger', ''); })()";
const TRIGGER = "[data-shot-trigger]";
const contextMenu = "(() => { const r = document.getElementById('shot').getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2; document.elementFromPoint(x, y).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 })); })()";
// Union of the picture and everything outside #root (portals) or in the top layer, clamped to the viewport.
const openedBox = "new Promise(done => setTimeout(() => { const parts = [document.getElementById('shot'), ...[...document.body.children].filter(el => el.id !== 'root' && el.tagName !== 'SCRIPT').flatMap(el => [el, ...el.querySelectorAll('*')]), ...document.querySelectorAll(':popover-open, :popover-open *, dialog[open], dialog[open] *')]; let [l, t, r, b] = [Infinity, Infinity, -Infinity, -Infinity]; for (const el of parts) { const box = el.getBoundingClientRect(); if (!box.width || !box.height || getComputedStyle(el).visibility === 'hidden') continue; l = Math.min(l, box.left); t = Math.min(t, box.top); r = Math.max(r, box.right); b = Math.max(b, box.bottom); } l = Math.max(0, l); t = Math.max(0, t); done([l, t, Math.min(innerWidth, r) - l, Math.min(innerHeight, b) - t]); }, 700))";
fs.mkdirSync(out, { recursive: true });
const SWATCHES = [["Background", "--color-background-body"], ["Card", "--color-background-card"], ["Text", "--color-text-primary"], ["Muted text", "--color-text-secondary"], ["Accent", "--color-accent"], ["Border", "--color-border"], ["Success", "--color-success"], ["Warning", "--color-warning"], ["Error", "--color-error"]];
const images = new Map(), themeImages = new Map(), themeColors = new Map(), shotPng = path.join(page, "shot.png");
try {
	browser(undefined, "set", "viewport", "720", "900", "2");
	browser(undefined, "open", pathToFileURL(path.join(page, "index.html")).href);
	try { browser(undefined, "wait", "--fn", "typeof window.show === 'function'"); }
	catch (error) { throw new Error(`The picture page did not start: ${browser(undefined, "errors")}`.slice(0, 1500), { cause: error }); }
	for (const name of list.filter(name => name !== SAMPLE)) {
		const failed = JSON.parse(browser(`window.show(${JSON.stringify(name)})`, "--json", "eval", "--stdin")).data.result;
		// Examples link remote photos the offline page cannot load: a grey stand-in beats a broken-image icon.
		browser("(async () => { const imgs = [...document.querySelectorAll('#shot img')]; for (let i = 0; i < 30 && !imgs.every(img => img.complete); i++) await new Promise(r => setTimeout(r, 100)); for (const img of imgs) if (!img.naturalWidth) { img.alt = ''; img.srcset = ''; img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"4\" height=\"3\"><rect width=\"4\" height=\"3\" fill=\"#d9dde3\"/></svg>'); } await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); })()", "eval", "--stdin");
		const box = JSON.parse(browser("(() => { const r = document.getElementById('shot').getBoundingClientRect(); return [r.width, r.height]; })()", "--json", "eval", "--stdin")).data.result;
		if (failed) { rows.set(name, { name, error: `crashes when rendered: ${String(failed).slice(0, 200)}` }); continue; }
		// 24 px padding each side: anything taller drew something (StatusDot rows are ~10 px).
		if (box[1] <= 50) { rows.set(name, { name, error: `renders empty on its own (overlay, portal or interaction-only); add scripts/astryx-examples/${name}.jsx` }); continue; }
		let crop;
		if (OPEN[name]) {
			browser(undefined, "set", "viewport", "720", "480", "2"); // a full-screen sheet or drawer becomes a landscape card, not a 1800 px tower
			if (OPEN[name] === "contextmenu") browser(contextMenu, "eval", "--stdin"); else { browser(markTrigger, "eval", "--stdin"); browser(undefined, OPEN[name], TRIGGER); }
			crop = JSON.parse(browser(openedBox, "--json", "eval", "--stdin")).data.result;
			browser(undefined, "screenshot", shotPng);
		} else browser(undefined, "screenshot", "#shot", shotPng);
		const png = fs.readFileSync(shotPng), webp = Buffer.from(JSON.parse(browser(toWebp(png, crop), "--json", "eval", "--stdin")).data.result, "base64");
		if (OPEN[name]) { browser(undefined, "press", "Escape"); browser(undefined, "mouse", "move", "700", "470"); browser(undefined, "set", "viewport", "720", "900", "2"); }
		images.set(name, webp);
		rows.set(name, { name, example: sources.get(name).label + (OPEN[name] ? `, opened by ${OPEN[name]}` : ""), width: crop ? Math.round(crop[2] * 2) : png.readUInt32BE(16), height: crop ? Math.round(crop[3] * 2) : png.readUInt32BE(20), webp: webp.length });
	}
	// Theme fonts only now (Google Fonts, as each theme's fonts.css says), so component pictures stay neutral-font.
	if (!list.includes(SAMPLE)) throw new Error(`${SAMPLE}.jsx did not compile: ${rows.get(SAMPLE)?.error}`);
	const fonts = THEMES.flatMap(slug => [...fs.readFileSync(path.join(runtime.directory, `node_modules/@astryxdesign/theme-${slug}/fonts.css`), "utf8").matchAll(/@import url\('(https:\/\/fonts\.googleapis\.com\/[^']+)'\)/g)].map(match => match[1]));
	browser(`(() => { for (const href of ${JSON.stringify(fonts)}) document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href })); })()`, "eval", "--stdin");
	for (const slug of THEMES) {
		const failed = JSON.parse(browser(`window.show("${SAMPLE}", ${JSON.stringify(slug)}).then(async error => { await document.fonts.ready; return error; })`, "--json", "eval", "--stdin")).data.result;
		if (failed) throw new Error(`The ${slug} theme sample crashed: ${failed}`);
		browser(undefined, "screenshot", "#shot", shotPng);
		const png = fs.readFileSync(shotPng), webp = Buffer.from(JSON.parse(browser(toWebp(png), "--json", "eval", "--stdin")).data.result, "base64");
		themeImages.set(slug, webp);
		// The swatches theme cards show beside the picture: each token resolved to a plain hex through a probe element.
		themeColors.set(slug, JSON.parse(browser(`(() => { const probe = document.getElementById("shot").appendChild(document.createElement("i")), hex = n => Math.round(n * 255).toString(16).padStart(2, "0"); const out = Object.fromEntries(${JSON.stringify(SWATCHES)}.map(([name, token]) => { probe.style.color = "var(" + token + ")"; const ctx = new OffscreenCanvas(1, 1).getContext("2d"); ctx.fillStyle = getComputedStyle(document.getElementById("shot")).backgroundColor; ctx.fillRect(0, 0, 1, 1); ctx.fillStyle = getComputedStyle(probe).color; ctx.fillRect(0, 0, 1, 1); const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data; return [name, "#" + [r, g, b].map(v => hex(v / 255)).join("")]; })); probe.remove(); return out; })()`, "--json", "eval", "--stdin")).data.result);
		console.log(`theme ${slug}: ${png.readUInt32BE(16)}x${png.readUInt32BE(20)} webp ${kb(webp.length)}`);
	}
} finally { try { browser(undefined, "close"); } catch {} if (!process.env.KEEP_PAGE) fs.rmSync(page, { recursive: true, force: true }); else console.log(page); }

// 4. Write: the trial folder, or the bundle (stale pictures removed) with its manifest.
// Bundle files are named by content hash, so parts sharing one example (TableRow, TableCell) ship one file.
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const unique = new Map([...images.values()].map(bytes => [sha(bytes), bytes]));
const total = [...unique.values()].reduce((n, bytes) => n + bytes.length, 0);
if (!picked.length && total > BUDGET) throw new Error(`Component pictures total ${kb(total)}, over the ${kb(BUDGET)} budget; nothing was written.`);
if (!picked.length) for (const file of fs.readdirSync(out)) if (file.endsWith(".webp")) fs.rmSync(path.join(out, file));
if (picked.length) for (const [name, bytes] of [...images, ...[...themeImages].map(([slug, bytes]) => [`theme-${slug}`, bytes])]) fs.writeFileSync(path.join(out, `${name}.webp`), bytes);
else {
	for (const [hash, bytes] of [...unique, ...[...themeImages.values()].map(bytes => [sha(bytes), bytes])]) fs.writeFileSync(path.join(out, `${hash}.webp`), bytes);
	// Inspect shows usage and props with no runtime installed (V-10), so they are bundled beside the pictures.
	const docs = {};
	for (const name of names) {
		const section = async part => (await libraryLookup(runtime.directory, { catalog: "component", name, section: part }).catch(() => undefined))?.data;
		const usage = (await section("usage"))?.usage, props = await section("props");
		docs[name] = { description: usage?.description, practices: usage?.bestPractices?.map(item => ({ do: item.guidance, text: item.description })), props: Array.isArray(props) ? props.map(({ name: prop, type, default: fallback, required, description }) => ({ name: prop, type, default: fallback, required, description })) : [] };
	}
	fs.writeFileSync(path.join(out, "docs.json"), `${JSON.stringify({ lockDigest: catalog.lockDigest, docs })}\n`);
	fs.writeFileSync(path.join(out, "components.json"), `${JSON.stringify({ lockDigest: catalog.lockDigest, version: catalog.version, images: Object.fromEntries([...images].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, sha(bytes)])), themes: Object.fromEntries([...themeImages].map(([slug, bytes]) => [slug, sha(bytes)])), colors: Object.fromEntries(themeColors) }, null, 1)}\n`);
}
for (const name of names) { const row = rows.get(name); console.log(row.error ? `- ${name}: ${row.error}` : `${name}: ${row.width}x${row.height} webp ${kb(row.webp)} (${row.example})`); }
console.log(`${images.size}/${names.length} pictured, ${kb(total)} total; ${out}`);
