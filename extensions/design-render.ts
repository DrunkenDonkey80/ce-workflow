// design-render (D3, D13): renders one screen of a design folder headless at a size and returns a PNG plus a report
// (overflow, too-wide elements, page errors, console errors, failed resources). Callers: design look and reference
// (design.ts) and the hub's Mark (designshot). Every capture uses its own agent-browser session, closed afterwards, so
// overlapping captures never share a page or viewport; the folder is served on a short-lived 127.0.0.1 port under the
// same sandbox CSP as the hub's preview (SANDBOX_CSP), so scripts behave as they do in the preview.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { processPng } from "./screen-read.ts";

/** The preview's sandbox: an opaque origin (no allow-same-origin), so page scripts run but cannot read the server. */
export const SANDBOX_CSP = (origin: string) => `sandbox allow-scripts allow-popups allow-pointer-lock allow-downloads; default-src ${origin} https: data: blob: 'unsafe-inline' 'unsafe-eval'`;

// The render-state (S06): what to show. folder is absolute (a design folder or a history version); width and height already
// carry the rotation; hash is the deck slide (location.hash); styleEdits are the preview's live, unsaved inline edits.
export type RenderState = { folder: string; screen?: string; width: number; height: number; hash?: string; styleEdits?: { selector: string; styles: Record<string, string> }[]; element?: string; full?: boolean; maxEdge?: number };
export type RenderReport = { viewport: string; scrollWidth: number; overflow: boolean; wide: string[]; errors: string[]; console: string[]; failed: string[]; missing?: string };
export type Rendered = { png: Buffer; width: number; height: number; report: RenderReport };

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".mp4": "video/mp4", ".webm": "video/webm" };

/** agent-browser's native binary (the npm .cmd/.ps1 shims cannot be spawned without a shell); undefined when not installed. */
export function agentBrowser() {
	const name = `agent-browser-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
	for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
		for (const file of [path.join(dir, "node_modules", "agent-browser", "bin", name), path.join(dir, "..", "lib", "node_modules", "agent-browser", "bin", name)]) if (fs.existsSync(file)) return file;
		if (process.platform !== "win32" && fs.existsSync(path.join(dir, "agent-browser"))) return path.join(dir, "agent-browser");
	}
	return undefined;
}

/** Serves folder on 127.0.0.1 under the preview's CSP; 404s are recorded as failed resources. */
async function serve(folder: string) {
	const root = fs.realpathSync(folder), failed: string[] = [];
	const server = http.createServer((request, response) => {
		const relative = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname).replace(/^\/+/, "");
		const file = path.resolve(root, relative), inside = path.relative(root, file);
		let real = "";
		try { real = fs.realpathSync(file); } catch { /* missing */ }
		if (!real || inside.startsWith("..") || path.isAbsolute(inside) || path.relative(root, real).startsWith("..") || !fs.statSync(real).isFile()) {
			failed.push(`404 ${relative}`);
			response.writeHead(404, { "content-type": "text/plain" });
			return response.end("not found");
		}
		response.writeHead(200, { "content-type": MIME[path.extname(real).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store", "content-security-policy": SANDBOX_CSP(origin), "access-control-allow-origin": "*" });
		fs.createReadStream(real).on("error", () => response.destroy()).pipe(response);
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return { origin, failed, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

// Runs in the page: applies the live edits, marks the target element, and measures overflow and broken images.
const PAGE_SCRIPT = (state: RenderState) => `(async () => {
	const edits = ${JSON.stringify(state.styleEdits ?? [])}, target = ${JSON.stringify(state.element ?? "")};
	for (const edit of edits) for (const el of document.querySelectorAll(edit.selector)) for (const [k, v] of Object.entries(edit.styles)) el.style.setProperty(k, String(v));
	await (document.fonts ? document.fonts.ready : Promise.resolve());
	await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
	let missing = "";
	if (target) {
		let el = null;
		try { el = document.querySelector('[data-id="' + CSS.escape(target.replace(/^@/, "")) + '"]') || document.querySelector(target); } catch {}
		if (el) { el.setAttribute("data-design-look", ""); el.scrollIntoView({ block: "center" }); } else missing = target;
	}
	const vw = document.documentElement.clientWidth, name = el => el.dataset.id ? "@" + el.dataset.id : el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.classList[0] ? "." + el.classList[0] : "");
	const wide = [...document.body.querySelectorAll("*")].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== "fixed"; }).slice(0, 10).map(el => name(el) + " " + Math.round(el.getBoundingClientRect().right) + "px");
	const broken = [...document.images].filter(img => img.complete && !img.naturalWidth).map(img => "image " + img.getAttribute("src"));
	return JSON.stringify({ scrollWidth: document.documentElement.scrollWidth, vw, wide, broken, missing });
})()`;

type Step = { command: string[]; success: boolean; error: string | null; result: any };
function run(exe: string, args: string[], timeout = 90_000) {
	return new Promise<string>((resolve, reject) => {
		const child = spawn(exe, args, { windowsHide: true, timeout, stdio: ["ignore", "pipe", "pipe"] });
		let out = "", err = "";
		child.stdout.on("data", chunk => { out += chunk; });
		child.stderr.on("data", chunk => { err += chunk; });
		child.on("error", reject);
		child.on("close", code => code === 0 || out.trim().startsWith("[") ? resolve(out) : reject(new Error(`agent-browser ${args.slice(2, 4).join(" ")} failed: ${(err || out).trim().slice(-800)}`)));
	});
}

/**
 * One isolated headless visit: viewport, open, the page script (its JSON string result is parsed), errors, console and a
 * screenshot (of [data-design-look] when element, else the viewport or full page). The session is always closed.
 */
async function visit(url: string, width: number, height: number, script: string, shot: { element?: boolean; full?: boolean; tolerate?: (page) => boolean } = {}) {
	const exe = agentBrowser();
	if (!exe) throw new Error("agent-browser is not installed (npm i -g agent-browser); design rendering needs it.");
	if (!(width >= 200 && width <= 4000 && height >= 200 && height <= 4000)) throw new Error("width and height must be 200 to 4000 pixels.");
	const session = `design-${crypto.randomBytes(6).toString("hex")}`, dir = fs.mkdtempSync(path.join(os.tmpdir(), "design-render-")), file = path.join(dir, "shot.png").split(path.sep).join("/");
	try {
		const out = await run(exe, ["--session", session, "--json", "batch", "--bail",
			`set viewport ${width} ${height}`, `open ${url}`, `eval -b ${Buffer.from(script).toString("base64")}`, "errors", "console",
			`screenshot ${shot.element ? "[data-design-look] " : ""}${file}${shot.full && !shot.element ? " --full" : ""}`]);
		let steps: Step[];
		try { steps = JSON.parse(out); } catch { throw new Error(`agent-browser returned no result: ${out.slice(0, 300)}`); }
		const failedStep = steps.find(step => !step.success);
		let page;
		try { page = JSON.parse(steps[2]?.result?.result ?? "{}"); } catch { page = {}; }
		if (failedStep && !(failedStep.command[0] === "screenshot" && shot.tolerate?.(page))) throw new Error(`agent-browser ${failedStep.command.slice(0, 2).join(" ")}: ${failedStep.error}`);
		const png = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
		return { steps, page, png };
	} finally {
		await run(exe, ["--session", session, "close"], 20_000).catch(() => {});
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/** Renders state headless and returns the PNG (scaled to maxEdge, default 1024) plus the report. */
export async function renderDesign(state: RenderState): Promise<Rendered> {
	const width = Math.round(state.width), height = Math.round(state.height);
	const screen = state.screen ?? "index.html";
	if (!/^[\w.-]+\.html?$/.test(screen)) throw new Error(`screen must be an HTML file directly in the design folder: ${screen}`);
	if (!fs.existsSync(path.join(state.folder, screen))) throw new Error(`${screen} does not exist in the design.`);
	const server = await serve(state.folder);
	const hash = state.hash ? `#${encodeURIComponent(state.hash.replace(/^#/, ""))}` : "";
	try {
		const { steps, page, png } = await visit(`${server.origin}/${encodeURIComponent(screen)}${hash}`, width, height, PAGE_SCRIPT(state), { element: !!state.element, full: state.full, tolerate: page => !!page.missing });
		const report: RenderReport = {
			viewport: `${width}×${height}`, scrollWidth: page.scrollWidth, overflow: page.scrollWidth > page.vw + 1, wide: page.wide ?? [],
			errors: (steps[3]?.result?.errors ?? []).map(item => String(item.text).split("\n")[0]).slice(0, 20),
			console: (steps[4]?.result?.messages ?? []).filter(item => ["error", "warning"].includes(item.type)).map(item => `${item.type}: ${item.text}`).slice(0, 20),
			failed: [...new Set([...server.failed, ...page.broken ?? []])].slice(0, 20),
			...page.missing && { missing: `no element ${page.missing} (give a data-id or a CSS selector)` },
		};
		if (page.missing || !png) return { png: Buffer.alloc(0), width: 0, height: 0, report }; // no element, no picture: the report says why
		const image = processPng(png, undefined, state.maxEdge ?? 1024);
		return { png: image.png, width: image.width, height: image.height, report };
	} finally { await server.close(); }
}

// D4 device presets, shared by design look and the hub preview. Desktop is the panel width in the preview, 1440 here.
export const PRESETS: Record<string, [number, number]> = { "Phone small": [360, 800], Phone: [390, 844], "Phone large": [430, 932], Foldable: [600, 960], Tablet: [820, 1180], Laptop: [1366, 768], Desktop: [1440, 900], Slide: [1920, 1080] };
/** "Tablet", "tablet landscape", "390x844" -> [width, height]. */
export function presetSize(name: string): [number, number] {
	const text = String(name ?? "").trim(), size = text.match(/^(\d{3,4})\s*[x×]\s*(\d{3,4})$/);
	if (size) return [Number(size[1]), Number(size[2])];
	const landscape = /\s+landscape$/i.test(text), base = text.replace(/\s+(landscape|portrait)$/i, "").toLowerCase();
	const found = Object.entries(PRESETS).find(([key]) => key.toLowerCase() === base);
	if (!found) throw new Error(`Unknown preset ${name}; use ${Object.keys(PRESETS).join(", ")} (optionally "landscape") or WIDTHxHEIGHT.`);
	return landscape ? [found[1][1], found[1][0]] : found[1];
}

// D6: what a site really uses, measured from computed styles of its main elements (method: OD skills/brand-extract).
const STYLE_SCRIPT = `(async () => {
	await (document.fonts ? document.fonts.ready : Promise.resolve());
	const pick = { body: "body", h1: "h1", h2: "h2", h3: "h3", link: "a", button: "button, .btn, [class*=button], a[class*=btn]", nav: "nav, header", card: "[class*=card], article", input: "input, textarea", footer: "footer" };
	const props = ["color", "background-color", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "padding", "margin", "gap", "border-radius", "box-shadow", "border"];
	const elements = {};
	for (const [key, sel] of Object.entries(pick)) { const el = document.querySelector(sel); if (!el) continue; const cs = getComputedStyle(el); elements[key] = Object.fromEntries(props.map(p => [p, cs.getPropertyValue(p)]).filter(([, v]) => v && v !== "none" && v !== "normal" && v !== "0px" && v !== "rgba(0, 0, 0, 0)")); }
	const count = (values) => Object.entries(values.reduce((m, v) => (m[v] = (m[v] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([v, n]) => v + " (" + n + ")");
	const all = [...document.body.querySelectorAll("*")].slice(0, 3000).map(el => getComputedStyle(el));
	return JSON.stringify({ title: document.title, text: (document.body.innerText || "").length,
		colors: count(all.map(s => s.color)), backgrounds: count(all.map(s => s.backgroundColor).filter(v => v !== "rgba(0, 0, 0, 0)")),
		fonts: count(all.map(s => s.fontFamily)), sizes: count(all.map(s => s.fontSize)), radii: count(all.map(s => s.borderRadius).filter(v => v !== "0px")),
		shadows: count(all.map(s => s.boxShadow).filter(v => v !== "none")), spacing: count(all.flatMap(s => [s.paddingTop, s.paddingLeft, s.gap]).filter(v => v && v !== "0px" && v !== "normal")), elements });
})()`;
const BLOCKED = /just a moment|attention required|access denied|verify you are human|captcha|cloudflare/i;

/** D6: Desktop and Phone screenshots plus STYLE.md of a site into folder; blocked tells the caller to use browser_fetch instead. */
export async function captureSite(url: string, folder: string) {
	if (!/^https?:\/\//i.test(url) || /\s/.test(url)) throw new Error("reference needs an http(s) URL.");
	const [desktop, phone] = await Promise.all([visit(url, ...PRESETS.Desktop, STYLE_SCRIPT), visit(url, ...PRESETS.Phone, STYLE_SCRIPT)]);
	const page = desktop.page;
	if (!page.text || page.text < 50 || BLOCKED.test(page.title ?? "")) return { blocked: `The page came back empty or behind a bot check (${page.title || "no title"}). Use browser_fetch with images: true on ${url}, and save the screenshots and your measured notes into ${folder}.` };
	fs.mkdirSync(folder, { recursive: true });
	fs.writeFileSync(path.join(folder, "desktop.png"), desktop.png!);
	fs.writeFileSync(path.join(folder, "phone.png"), phone.png!);
	const list = (label: string, items: string[]) => items?.length ? `- ${label}: ${items.join(", ")}` : "";
	const style = [`# ${page.title || url}`, "", `Measured from ${url} on ${new Date().toISOString().slice(0, 10)} (computed styles, counts in brackets). Borrow style and structure; never logos, brand marks or copy.`, "",
		"## Tokens", "", list("Text colors", page.colors), list("Backgrounds", page.backgrounds), list("Font families", page.fonts), list("Font sizes", page.sizes), list("Spacing", page.spacing), list("Radii", page.radii), list("Shadows", page.shadows), "",
		"## Elements", "", ...Object.entries(page.elements ?? {}).map(([key, values]) => `- ${key}: ${Object.entries(values as Record<string, string>).map(([k, v]) => `${k} ${v}`).join("; ")}`), "",
		"Screenshots: desktop.png (1440×900), phone.png (390×844).", ""].filter(line => line !== undefined).join("\n").replace(/\n{3,}/g, "\n\n");
	fs.writeFileSync(path.join(folder, "STYLE.md"), style);
	return { files: ["desktop.png", "phone.png", "STYLE.md"], title: page.title };
}

/** One line per finding, or "no overflow, no errors". */
export function reportText(report: RenderReport) {
	const lines = [
		report.missing,
		report.overflow ? `horizontal overflow: page is ${report.scrollWidth}px wide in ${report.viewport}` : "",
		report.wide.length ? `wider than the viewport: ${report.wide.join(", ")}` : "",
		...report.errors.map(line => `page error: ${line}`), ...report.console.map(line => `console ${line}`), ...report.failed.map(line => `failed: ${line}`),
	].filter(Boolean);
	return lines.length ? lines.join("\n") : `${report.viewport}: no overflow, no errors`;
}
