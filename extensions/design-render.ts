// design-render (D3, D13): renders one screen of a design folder headless at a size and returns a PNG plus a report
// (overflow, too-wide elements, page errors, console errors, failed resources). Callers: design look and reference
// (design.ts) and the hub's Mark (designshot). Every capture uses its own agent-browser session, closed afterwards, so
// overlapping captures never share a page or viewport; the folder is served on a short-lived 127.0.0.1 port under the
// same design sandbox CSP as the hub's preview (DESIGN_CSP), so scripts behave as they do in the preview.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { processPng } from "./screen-read.ts";
import { designStateJson, type DesignJson } from "./design-state.ts";

/** The preview's sandbox: an opaque origin (no allow-same-origin), so page scripts run but cannot read the server. */
export const SANDBOX_CSP = (origin: string) => `sandbox allow-scripts allow-popups allow-pointer-lock allow-downloads; default-src ${origin} https: data: blob: 'unsafe-inline' 'unsafe-eval'`;
/** Local submit handlers need permission; native form navigation stays forbidden, including popup targets. */
export const DESIGN_CSP = (origin: string) => `${SANDBOX_CSP(origin).replace("sandbox ", "sandbox allow-forms ")}; form-action 'none'`;

// The render-state (S06): what to show. folder is absolute (a design folder or a history version); width and height already
// carry the rotation; hash is the deck slide (location.hash); styleEdits are the preview's live, unsaved inline edits.
export type RenderState = { folder: string; screen?: string; width: number; height: number; hash?: string; input?: "mouse" | "touch"; reducedMotion?: boolean; pageState?: DesignJson; state?: string; styleEdits?: { selector: string; styles: Record<string, string> }[]; element?: string; full?: boolean; maxEdge?: number };
export type RenderReport = { state?: { restored: true }; viewport: string; observedViewport: string; input: { requested: "mouse" | "touch"; requestedReducedMotion: boolean; touchPoints: number | null; coarse: boolean | null; reducedMotion: boolean | null }; readiness: { settled: boolean; ignoredAnimations: number; elapsedMs: number; error?: string }; scrollWidth: number; overflow: boolean; wide: string[]; errors: string[]; console: string[]; failed: string[]; missing?: string };
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
			if (relative !== "favicon.ico") failed.push(`404 ${relative}`); // browsers ask for it unprompted
			response.writeHead(404, { "content-type": "text/plain" });
			return response.end("not found");
		}
		response.writeHead(200, { "content-type": MIME[path.extname(real).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store", "content-security-policy": DESIGN_CSP(origin), "access-control-allow-origin": "*" });
		fs.createReadStream(real).on("error", () => response.destroy()).pipe(response);
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return { origin, failed, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

// Authored async work opts in via designReady; the host deadline also covers navigation and hung page JavaScript.
const SETTLE_SCRIPT = `(async () => {
	if (document.visibilityState !== "visible") throw new Error("Render page is hidden");
	await window.designReady;
	const ignored = new Set();
	let last = "", stable = 0;
	while (stable < 3) {
		await document.fonts.ready;
		await Promise.all([...document.images].map(async img => {
			img.loading = "eager";
			if (!img.complete) await new Promise(resolve => { img.addEventListener("load", resolve, { once: true }); img.addEventListener("error", resolve, { once: true }); });
			if (img.naturalWidth) await img.decode().catch(() => {});
		}));
		await Promise.all(document.getAnimations().filter(animation => {
			if (animation.effect?.getTiming().iterations === Infinity) { ignored.add(animation); return false; }
			return animation.playState === "running" || animation.pending;
		}).map(animation => animation.finished.catch(() => {})));
		await new Promise(resolve => requestAnimationFrame(resolve));
		const layout = JSON.stringify([document.documentElement.scrollWidth, document.documentElement.scrollHeight, ...[...document.querySelectorAll("body, body *")].map(el => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })]);
		stable = layout === last ? stable + 1 : 0;
		last = layout;
	}
	return { readiness: { settled: true, ignoredAnimations: ignored.size }, observedViewport: innerWidth + "×" + innerHeight,
		input: { touchPoints: navigator.maxTouchPoints, coarse: matchMedia("(pointer: coarse)").matches, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches } };
})()`;

// Runs in the page: applies the live edits, marks the target element, and measures overflow and broken images.
const PAGE_SCRIPT = (state: RenderState) => `(async () => {
	await window.designReady;
	const stateJson = ${designStateJson.toString()}, named = ${JSON.stringify(state.state)}, replay = ${state.pageState !== undefined || state.state !== undefined};
	if (replay) {
		const api = window.designPreview;
		if (typeof api?.capture !== "function" || typeof api?.restore !== "function") throw new Error("This page does not support state replay (window.designPreview).");
		if (named !== undefined && (!api.states || !Object.prototype.hasOwnProperty.call(api.states, named))) throw new Error("The named design state is not declared.");
		const expected = stateJson(named === undefined ? ${state.pageState === undefined ? "undefined" : designStateJson(state.pageState)} : api.states[named]);
		let actual;
		try { await api.restore(JSON.parse(expected)); actual = await window.designPreview.capture(); } catch { throw new Error("Design state replay failed."); }
		if (stateJson(actual) !== expected) throw new Error("Design state acknowledgement does not match.");
	}
	const edits = ${JSON.stringify(state.styleEdits ?? [])}, target = ${JSON.stringify(state.element ?? "")};
	for (const edit of edits) for (const el of document.querySelectorAll(edit.selector)) for (const [k, v] of Object.entries(edit.styles)) el.style.setProperty(k, String(v));
	let missing = "";
	if (target) {
		let el = null;
		try { el = document.querySelector('[data-id="' + CSS.escape(target.replace(/^@/, "")) + '"]') || document.querySelector(target); } catch {}
		if (el) { el.setAttribute("data-design-look", ""); el.scrollIntoView({ block: "center" }); } else missing = target;
	}
	const settled = await ${SETTLE_SCRIPT};
	const vw = document.documentElement.clientWidth, name = el => el.dataset.id ? "@" + el.dataset.id : el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.classList[0] ? "." + el.classList[0] : "");
	const wide = [...document.body.querySelectorAll("*")].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== "fixed"; }).slice(0, 10).map(el => name(el) + " " + Math.round(el.getBoundingClientRect().right) + "px");
	const broken = [...document.images].filter(img => img.complete && !img.naturalWidth).map(img => "image " + img.getAttribute("src"));
	return JSON.stringify({ ...settled, state: replay ? { restored: true } : undefined, scrollWidth: document.documentElement.scrollWidth, vw, wide, broken, missing });
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

/** Select the page that the native screenshot command will capture. */
export function selectRenderTarget(targets: { type: string; url: string; attached: boolean; targetId: string }[]) {
	const pages = targets.filter(target => target.type === "page" && target.attached && target.url === "about:blank");
	if (pages.length !== 1) throw new Error(`Render page is ambiguous (${pages.length} candidates)`);
	return pages[0];
}

/** A session-owned CDP connection with one host deadline; closing it rejects and clears every pending wait. */
async function renderCdp(url: string, deadline: number) {
	if (!/^ws:\/\/127\.0\.0\.1:\d+\//.test(url)) throw new Error("agent-browser returned a non-local CDP endpoint");
	const socket = new WebSocket(url);
	let seq = 0, closed = false;
	const pending = new Map<number | string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
	const close = () => { if (closed) return; closed = true; for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error("Render CDP closed")); } pending.clear(); socket.close(); };
	const wait = (key: number | string, label = String(key)) => new Promise<any>((resolve, reject) => {
		const timer = setTimeout(() => { pending.delete(key); reject(new Error(`Render readiness timed out (5-second total budget): ${label}`)); }, Math.max(1, deadline - Date.now()));
		pending.set(key, { resolve, reject, timer });
	});
	socket.addEventListener("message", event => {
		let reply;
		try { reply = JSON.parse(String(event.data)); } catch { return; }
		const key = reply.id ?? reply.method, job = pending.get(key);
		if (!job) return;
		pending.delete(key); clearTimeout(job.timer);
		if (reply.error) job.reject(new Error(reply.error.message)); else job.resolve(reply.result);
	});
	socket.addEventListener("close", close, { once: true });
	try {
		const opened = wait("open");
		socket.addEventListener("open", () => { const job = pending.get("open"); if (job) { pending.delete("open"); clearTimeout(job.timer); job.resolve(undefined); } }, { once: true });
		socket.addEventListener("error", () => close(), { once: true });
		await opened;
		const send = (method: string, params = {}, sessionId?: string) => {
			const id = ++seq, result = wait(id, method);
			try { socket.send(JSON.stringify({ id, method, params, ...sessionId ? { sessionId } : {} })); } catch { close(); }
			return result;
		};
		return { send, wait, close };
	} catch (error) { close(); throw error; }
}

/** One isolated visit; input is set before navigation, readiness is bounded, and no failed settle returns a picture. */
async function visit(url: string, width: number, height: number, script: string, shot: { element?: boolean; full?: boolean; input?: "mouse" | "touch"; reducedMotion?: boolean; tolerate?: (page) => boolean } = {}) {
	const exe = agentBrowser();
	if (!exe) throw new Error("agent-browser is not installed (npm i -g agent-browser); design rendering needs it.");
	if (!(width >= 200 && width <= 4000 && height >= 200 && height <= 4000)) throw new Error("width and height must be 200 to 4000 pixels.");
	if (shot.input !== undefined && shot.input !== "mouse" && shot.input !== "touch") throw new Error("input must be mouse or touch");
	if (shot.reducedMotion !== undefined && typeof shot.reducedMotion !== "boolean") throw new Error("reducedMotion must be a boolean");
	const session = `design-${crypto.randomBytes(6).toString("hex")}`, dir = fs.mkdtempSync(path.join(os.tmpdir(), "design-render-")), file = path.join(dir, "shot.png").split(path.sep).join("/");
	let cdp: Awaited<ReturnType<typeof renderCdp>> | undefined;
	try {
		const batch = async (commands: string[]) => {
			const out = await run(exe, ["--session", session, "--json", "batch", "--bail", ...commands], 20_000);
			let steps: Step[];
			try { steps = JSON.parse(out); } catch { throw new Error(`agent-browser returned no result: ${out.slice(0, 300)}`); }
			return steps;
		};
		const setup = await batch([`set viewport ${width} ${height}`, "open", "get cdp-url"]);
		const badSetup = setup.find(step => !step.success);
		if (badSetup) throw new Error(`agent-browser setup: ${badSetup.error}`);
		const started = Date.now();
		let page: any;
		try {
			cdp = await renderCdp(setup.find(step => step.command[0] === "get")?.result?.cdpUrl, started + 5000);
			const { targetInfos } = await cdp.send("Target.getTargets");
			const target = selectRenderTarget(targetInfos);
			const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
			await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
			await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: shot.input === "touch", ...shot.input === "touch" ? { maxTouchPoints: 1 } : {} }, sessionId);
			await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: shot.reducedMotion ? "reduce" : "no-preference" }] }, sessionId);
			await cdp.send("Page.enable", {}, sessionId);
			await Promise.all([cdp.wait("Page.domContentEventFired"), cdp.send("Page.navigate", { url }, sessionId).then(result => { if (result.errorText) throw new Error(result.errorText); })]);
			const evaluated = await cdp.send("Runtime.evaluate", { expression: script, awaitPromise: true, returnByValue: true }, sessionId);
			if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.exception?.description ?? evaluated.exceptionDetails.text);
			page = JSON.parse(evaluated.result.value);
			page.readiness.elapsedMs = Date.now() - started;
			if (page.observedViewport !== `${width}×${height}` || page.input.coarse !== (shot.input === "touch") || (page.input.touchPoints > 0) !== (shot.input === "touch") || page.input.reducedMotion !== !!shot.reducedMotion) throw new Error("Requested viewport/input did not match the observed page");
		} catch (error) {
			page = { ...page, readiness: { settled: false, ignoredAnimations: page?.readiness?.ignoredAnimations ?? 0, elapsedMs: Date.now() - started, error: String(error) } };
		}
		// CDP emulation is connection-scoped: keep it attached until the actual screenshot is saved.
		const steps = await batch(["errors", "console", ...page.readiness.settled ? [`screenshot ${shot.element ? "[data-design-look] " : ""}${file}${shot.full && !shot.element ? " --full" : ""}`] : []]);
		const failedStep = steps.find(step => !step.success);
		if (failedStep && !(failedStep.command[0] === "screenshot" && shot.tolerate?.(page))) throw new Error(`agent-browser ${failedStep.command.slice(0, 2).join(" ")}: ${failedStep.error}`);
		return { steps, page, png: fs.existsSync(file) ? fs.readFileSync(file) : undefined };
	} finally {
		cdp?.close();
		await run(exe, ["--session", session, "close"], 3000).catch(() => {});
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/** Renders state headless and returns the PNG (scaled to maxEdge, default 1024) plus the report. */
export async function renderDesign(state: RenderState): Promise<Rendered> {
	if (state.pageState !== undefined) designStateJson(state.pageState);
	if (state.state !== undefined && (typeof state.state !== "string" || !/^[\w-]{1,80}$/.test(state.state))) throw new Error("Invalid named design state.");
	if (state.pageState !== undefined && state.state !== undefined) throw new Error("Choose a captured or named design state, not both.");
	const width = Math.round(state.width), height = Math.round(state.height);
	const screen = state.screen ?? "index.html";
	if (!/^(?:[\w-][\w.-]*\/)*[\w.-]+\.html?$/.test(screen)) throw new Error(`screen must be an HTML file in the design folder: ${screen}`); // subfolders allowed, never ..
	if (!fs.existsSync(path.join(state.folder, screen))) throw new Error(`${screen} does not exist in the design.`);
	const server = await serve(state.folder);
	const hash = state.hash ? `#${encodeURIComponent(state.hash.replace(/^#/, ""))}` : "";
	try {
		const { steps, page, png } = await visit(`${server.origin}/${screen.split("/").map(encodeURIComponent).join("/")}${hash}`, width, height, PAGE_SCRIPT(state), { element: !!state.element, full: state.full, input: state.input, reducedMotion: state.reducedMotion, tolerate: page => !!page.missing });
		const report: RenderReport = {
			state: page.state, viewport: `${width}×${height}`, observedViewport: page.observedViewport ?? "unavailable", readiness: page.readiness,
			input: { requested: state.input ?? "mouse", requestedReducedMotion: !!state.reducedMotion, touchPoints: page.input?.touchPoints ?? null, coarse: page.input?.coarse ?? null, reducedMotion: page.input?.reducedMotion ?? null }, scrollWidth: page.scrollWidth, overflow: page.scrollWidth > page.vw + 1, wide: page.wide ?? [],
			errors: (steps.find(step => step.command[0] === "errors")?.result?.errors ?? []).map(item => String(item.text).split("\n")[0]).slice(0, 20),
			console: (steps.find(step => step.command[0] === "console")?.result?.messages ?? []).filter(item => ["error", "warning"].includes(item.type)).map(item => `${item.type}: ${item.text}`).slice(0, 20),
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
	const settled = await ${SETTLE_SCRIPT};
	const pick = { body: "body", h1: "h1", h2: "h2", h3: "h3", link: "a", button: "button, .btn, [class*=button], a[class*=btn]", nav: "nav, header", card: "[class*=card], article", input: "input, textarea", footer: "footer" };
	const props = ["color", "background-color", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "padding", "margin", "gap", "border-radius", "box-shadow", "border"];
	const elements = {};
	for (const [key, sel] of Object.entries(pick)) { const el = document.querySelector(sel); if (!el) continue; const cs = getComputedStyle(el); elements[key] = Object.fromEntries(props.map(p => [p, cs.getPropertyValue(p)]).filter(([, v]) => v && v !== "none" && v !== "normal" && v !== "0px" && v !== "rgba(0, 0, 0, 0)")); }
	const count = (values) => Object.entries(values.reduce((m, v) => (m[v] = (m[v] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([v, n]) => v + " (" + n + ")");
	const all = [...document.body.querySelectorAll("*")].slice(0, 3000).map(el => getComputedStyle(el));
	return JSON.stringify({ ...settled, title: document.title, text: (document.body.innerText || "").length,
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
	const unsettled = [desktop, phone].map(shot => shot.page.readiness.error).filter(Boolean);
	if (!desktop.png || !phone.png || !page.text || page.text < 50 || BLOCKED.test(page.title ?? "")) return { blocked: `${unsettled.length ? `Reference rendering did not settle: ${[...new Set(unsettled)].join("; ")}` : `The page came back empty or behind a bot check (${page.title || "no title"})`}. Use browser_fetch with images: true on ${url}, and save the screenshots and your measured notes into ${folder}.` };
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
		`${report.viewport} requested, ${report.observedViewport} observed; ${report.input.requested} requested, touch points ${report.input.touchPoints ?? "unknown"}, coarse ${report.input.coarse ?? "unknown"}; reduced motion ${report.input.requestedReducedMotion} requested, ${report.input.reducedMotion ?? "unknown"} observed.`,
		report.readiness.settled ? `Settled in ${report.readiness.elapsedMs}ms; ignored ${report.readiness.ignoredAnimations} infinite animation(s).` : `Not settled: ${report.readiness.error}`,
		report.state?.restored ? "Declared page state restored and acknowledged." : "",
		report.missing,
		report.overflow ? `horizontal overflow: page is ${report.scrollWidth}px wide in ${report.viewport}` : "",
		report.wide.length ? `wider than the viewport: ${report.wide.join(", ")}` : "",
		...report.errors.map(line => `page error: ${line}`), ...report.console.map(line => `console ${line}`), ...report.failed.map(line => `failed: ${line}`),
	].filter(Boolean);
	return lines.length ? lines.join("\n") : `${report.viewport}: no overflow, no errors`;
}
