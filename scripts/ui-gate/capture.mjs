#!/usr/bin/env node
// UI gate capture — deterministic web profile (plan-final.md §2.1).
// Zero dependencies: chrome-headless-shell from the ms-playwright cache,
// a local injecting HTTP server, --dump-dom self-reported geometry.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const VIEWPORTS = {
	desktop: { width: 1280, height: 800 },
	tablet: { width: 768, height: 1024 },
	mobile: { width: 390, height: 844 },
};
const MIME = {
	".html": "text/html",
	".css": "text/css",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".txt": "text/plain",
};

function arg(name) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function headlessShell() {
	const cache = path.join(
		process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
		"ms-playwright",
	);
	const version = readdirSync(cache)
		.filter((name) => /^chromium_headless_shell-/.test(name))
		.sort()
		.at(-1);
	if (!version)
		throw new Error(
			"chrome-headless-shell is unavailable; run playwright install chromium",
		);
	return path.join(
		cache,
		version,
		"chrome-headless-shell-win64",
		"chrome-headless-shell.exe",
	);
}

// Page-side measurement script: suppresses animation, settles fonts/images,
// then self-reports normalized geometry into a JSON script node for --dump-dom.
const PAGE_SCRIPT = `(function(){
'use strict';
var style=document.createElement('style');
style.textContent='*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}';
document.documentElement.prepend(style);
function r2(v){return Math.round(v*100)/100}
var INTERACTIVE={A:1,BUTTON:1,INPUT:1,SELECT:1,TEXTAREA:1,SUMMARY:1};
function interactive(el){return !!INTERACTIVE[el.tagName]||el.hasAttribute('onclick')||/^(button|link|tab|checkbox|radio|switch|option|menuitem)$/.test(el.getAttribute('role')||'')||el.hasAttribute('tabindex')}
function color(c){var m=/rgba?\\(([^)]+)\\)/.exec(c);if(!m)return c;var p=m[1].split(',').map(parseFloat);if((p[3]===undefined?1:p[3])<=0)return 'transparent';return '#'+p.slice(0,3).map(function(v){return Math.round(v).toString(16).padStart(2,'0')}).join('')}
function opacity(el){var o=1;for(var n=el;n&&n.nodeType===1;n=n.parentElement){o*=parseFloat(getComputedStyle(n).opacity||'1')}return r2(Math.min(1,o))}
function text(el){var t='';for(var i=0;i<el.childNodes.length;i++){var n=el.childNodes[i];if(n.nodeType===3)t+=(n.textContent||'').trim()+' '}return t.replace(/\\s+/g,' ').trim().slice(0,200)}
function measure(){
Promise.resolve().then(async function(){
try{await document.fonts.ready}catch(e){}
try{await Promise.all(Array.prototype.slice.call(document.images).map(function(i){return i.decode().catch(function(){})}))}catch(e){}
var byEl=new Map(),elements=[],SKIP={SCRIPT:1,STYLE:1,LINK:1,META:1,NOSCRIPT:1};
function walk(el,p){
if(elements.length>=4000)return;
byEl.set(el,p);
if(!SKIP[el.tagName]){
var cs=getComputedStyle(el),vis=cs.display!=='none'&&cs.visibility!=='hidden'&&parseFloat(cs.opacity||'1')>0.01;
var b=el.getBoundingClientRect();
if(vis&&b.width>0&&b.height>0){
elements.push({key:p,parent:p.replace(/\\/[^/]+$/,'')||null,anchor:el.getAttribute('data-ce-el')||null,testId:el.getAttribute('data-testid')||null,tag:el.tagName,role:el.getAttribute('role')||null,text:text(el),rect:{x:r2(b.x),y:r2(b.y),width:r2(b.width),height:r2(b.height)},interactive:interactive(el),effectiveOpacity:opacity(el),styles:{color:color(cs.color),backgroundColor:color(cs.backgroundColor),fontSize:r2(parseFloat(cs.fontSize)),fontWeight:String(cs.fontWeight),display:cs.display,position:cs.position,overflow:cs.overflow,textOverflow:cs.textOverflow,lineClamp:String(cs.webkitLineClamp),zIndex:cs.zIndex},overflow:{scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}});
}}
var i=0;for(var c=el.firstElementChild;c;c=c.nextElementSibling){walk(c,p+'/'+i);i++}
}
var idx=0;for(var c=document.documentElement.firstElementChild;c;c=c.nextElementSibling){walk(c,String(idx));idx++}
for(var j=0;j<elements.length;j++){
var rec=elements[j];if(!rec.interactive&&!rec.anchor&&!rec.testId)continue;
var target=null;byEl.forEach(function(v,e){if(v===rec.key)target=e});
if(!target)continue;
var b=target.getBoundingClientRect(),pts={center:[b.x+b.width/2,b.y+b.height/2],tl:[b.x+2,b.y+2],tr:[b.x+b.width-2,b.y+2],bl:[b.x+2,b.y+b.height-2],br:[b.x+b.width-2,b.y+b.height-2]};
rec.hits={};for(var name in pts){var hit=document.elementFromPoint(pts[name][0],pts[name][1]);rec.hits[name]=hit?(byEl.get(hit)||'__unrecorded__'):null}
}
var focusVisible=false;
var fi=elements.findIndex(function(e){return e.interactive});
if(fi>=0){var fel=null;byEl.forEach(function(v,e){if(v===elements[fi].key)fel=e});
if(fel){try{fel.focus();var fcs=getComputedStyle(fel);focusVisible=fcs.outlineStyle!=='none'&&parseFloat(fcs.outlineWidth||'0')>0||fcs.boxShadow!=='none';fel.blur()}catch(e){}}}
var root=document.documentElement;
var payload={version:1,document:{scrollWidth:root.scrollWidth,scrollHeight:root.scrollHeight,innerWidth:window.innerWidth,innerHeight:window.innerHeight,htmlOverflow:getComputedStyle(root).overflowY,bodyOverflow:document.body?getComputedStyle(document.body).overflowY:'visible',focusVisible:focusVisible},elements:elements,text:(document.body?document.body.innerText:'').replace(/\\s+/g,' ').trim().slice(0,20000)};
var node=document.createElement('script');
node.type='application/json';node.id='ce-ui-gate-geometry';
node.textContent=JSON.stringify(payload).replace(/</g,'\\\\u003c');
document.documentElement.append(node);
document.documentElement.dataset.ceUiGate='ready';
});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',measure);else measure();
})();`;

function injectHtml(html) {
	const probe = /<head(\s[^>]*)?>/i;
	if (probe.test(html))
		return html.replace(
			probe,
			(match) => `${match}<script>${PAGE_SCRIPT}</script>`,
		);
	return `<script>${PAGE_SCRIPT}</script>${html}`;
}

async function startServer(target) {
	const isFile = !/^https?:\/\//i.test(target);
	let origin = null;
	let pathname = null;
	if (!isFile) {
		try {
			const parsed = new URL(target);
			origin = parsed.origin;
			pathname = `${parsed.pathname}${parsed.search}`;
		} catch {
			throw new Error(`invalid target URL: ${target}`);
		}
	}
	const baseDir = isFile ? path.dirname(path.resolve(target)) : null;
	const server = http.createServer((request, response) => {
		const pathname = decodeURIComponent(new URL(request.url, "http://x").pathname);
		const finish = (status, body, type) => {
			response.writeHead(status, {
				"content-type": type ?? "application/octet-stream",
				"cache-control": "no-store",
			});
			response.end(body);
		};
		if (isFile) {
			const file = path.resolve(baseDir, `.${path.sep}${pathname}`);
			if (
				!file.startsWith(baseDir + path.sep) ||
				!statSync(file, { throwIfNoEntry: false })?.isFile()
			)
				return finish(404, "not found", "text/plain");
			const body = readFileSync(file);
			const type = MIME[path.extname(file).toLowerCase()] ?? "text/plain";
			return finish(
				200,
				type === "text/html" ? injectHtml(body.toString("utf8")) : body,
				type,
			);
		}
		const upstream = (origin.startsWith("https:") ? https : http).request(
			`${origin}${request.url}`,
			{ method: "GET" },
			(up) => {
				const chunks = [];
				up.on("data", (chunk) => chunks.push(chunk));
				up.on("end", () => {
					const type = String(up.headers["content-type"] ?? "");
					const body = Buffer.concat(chunks);
					finish(
						up.statusCode ?? 502,
						/html/i.test(type)
							? injectHtml(body.toString("utf8"))
							: body,
						type || undefined,
					);
				});
			},
		);
		upstream.on("error", () => finish(502, "upstream error", "text/plain"));
		upstream.end();
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	const root = isFile
		? `http://127.0.0.1:${port}/${path.basename(target)}`
		: `http://127.0.0.1:${port}${pathname}`;
	return { server, root };
}

function extractGeometry(dom, label) {
	const match = /<script type="application\/json" id="ce-ui-gate-geometry">([\s\S]*?)<\/script>/.exec(
		dom,
	);
	if (!match)
		throw new Error(
			`geometry self-report missing from ${label} dump (CSP or script failure)`,
		);
	try {
		return JSON.parse(match[1].replaceAll("\\u003c", "<"));
	} catch (error) {
		throw new Error(
			`malformed geometry self-report from ${label}: ${error instanceof Error ? error.message : error}`,
		);
	}
}

function run(chromium, args, timeout) {
	return new Promise((resolve, reject) => {
		const child = spawn(chromium, args, {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(
			() => child.kill(),
			timeout,
		);
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve(stdout);
			else
				reject(
					new Error(
						`chrome-headless-shell failed (exit ${code}): ${stderr || stdout}`,
				),
			);
		});
	});
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export async function captureCell({
	target,
	viewport: viewportName,
	state = "ready",
	out,
	geometryOnly = false,
	timeoutMs = 120_000,
}) {
	const viewport = VIEWPORTS[viewportName];
	if (!viewport) throw new Error(`unknown viewport ${viewportName}`);
	const chromium = headlessShell();
	mkdirSync(out, { recursive: true });
	const { server, root } = await startServer(target);
	const started = Date.now();
	const common = [
		"--headless",
		"--no-sandbox",
		"--disable-gpu",
		"--hide-scrollbars",
		"--force-device-scale-factor=1",
		`--window-size=${viewport.width},${viewport.height}`,
		"--virtual-time-budget=10000",
	];
	try {
		const dumps = [
			await run(chromium, [...common, "--dump-dom", root], timeoutMs),
			await run(chromium, [...common, "--dump-dom", root], timeoutMs),
		];
		const geometries = dumps.map((dom, index) =>
			extractGeometry(dom, `run ${index + 1}`),
		);
		const canonical = geometries.map((geo) => JSON.stringify(geo));
		const byteIdentical = canonical[0] === canonical[1];
		const quarantined = [];
		if (!byteIdentical) {
			const left = new Map(geometries[0].elements.map((el) => [el.key, el]));
			for (const el of geometries[1].elements) {
				const other = left.get(el.key);
				if (!other || JSON.stringify(other) !== JSON.stringify(el))
					quarantined.push(el.key);
			}
			for (const el of geometries[0].elements)
				if (!geometries[1].elements.some((other) => other.key === el.key))
					quarantined.push(el.key);
		}
		const geometry = {
			version: 1,
			profile: "web-chromium",
			target,
			viewport: { name: viewportName, ...viewport },
			state,
			document: geometries[1].document,
			elements: geometries[1].elements,
			text: geometries[1].text,
		};
		const geometryJson = `${JSON.stringify(geometry, null, 1)}\n`;
		writeFileSync(path.join(out, "geometry.json"), geometryJson);
		let screenshot;
		if (!geometryOnly) {
			screenshot = path.join(out, "screenshot.png");
			await run(
				chromium,
				[...common, `--screenshot=${screenshot}`, root],
				timeoutMs,
			);
		}
		const meta = {
			profile: "web-chromium",
			target,
			viewport: { name: viewportName, ...viewport },
			state,
			dpr: 1,
			runs: 2,
			byteIdentical,
			quarantined,
			captureTier: "deterministic",
			measuredBy: "web-chromium",
			latencyMs: Date.now() - started,
			geometrySha256: sha256(geometryJson),
			...(screenshot
				? { screenshotSha256: sha256(readFileSync(screenshot)) }
				: {}),
		};
		writeFileSync(path.join(out, "meta.json"), `${JSON.stringify(meta, null, 1)}\n`);
		return {
			ok: true,
			cell: { profile: "web-chromium", viewport: viewportName, state, target },
			byteIdentical,
			quarantined,
			artifacts: {
				geometry: "geometry.json",
				meta: "meta.json",
				...(screenshot ? { screenshot: "screenshot.png" } : {}),
			},
		};
	} finally {
		server.close();
	}
}

const isDirect =
	process.argv[1] &&
	path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirect) {
	const target = arg("--target");
	const viewportName = arg("--viewport");
	const out = arg("--out");
	const state = arg("--state") ?? "ready";
	if (!target || !viewportName || !out) {
		process.stderr.write(
			"Usage: capture.mjs --profile web-chromium --target <url-or-file> --viewport <desktop|tablet|mobile> --state <state> --out <dir> [--geometry-only]\n",
		);
		process.exitCode = 1;
	} else {
		try {
			const result = await captureCell({
				target,
				viewport: viewportName,
				state,
				out,
				geometryOnly: process.argv.includes("--geometry-only"),
			});
			process.stdout.write(`${JSON.stringify(result)}\n`);
		} catch (error) {
			process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
			process.exitCode = 1;
		}
	}
}
