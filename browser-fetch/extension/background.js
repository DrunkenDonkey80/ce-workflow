// Pi browser fetch (plan d8c5ace2): loads pages Pi approved in an inactive tab and returns their text and images.
// Pi decides every site; this worker enforces it with tab-scoped declarativeNetRequest rules (D6, D12).
const HOST = "pi.browser_fetch";
const LOAD_MS = 30_000, CHALLENGE_MS = 20_000, IMAGE_MS = 20_000, MAX_IMAGE = 8 * 1024 * 1024, MAX_TOTAL = 60 * 1024 * 1024, MAX_IMAGES = 30;
const CHALLENGE = /just a moment|attention required|checking your browser|verify you are human|ddos-guard|please wait while we verify/i;
// Searches (plan 71dc4da4 R4): one at a time per browser, spaced, and paused after a Google CAPTCHA (5 min, doubling to 1 h).
let SEARCH_GAP_MS = 2000;
const COOLDOWN_MS = 300_000, COOLDOWN_MAX = 3_600_000, SHEET_COLS = 6, CELL = 170;
const jobs = new Map();
let port, paused = false, nextRule = 100, searches = Promise.resolve(), lastSearch = 0, cooldown = 0, cooldownUntil = 0;

const send = message => { try { port?.postMessage(message); } catch {} };
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hostOf = url => { try { return new URL(url).hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, ""); } catch { return ""; } };
const sleep = ms => new Promise(done => setTimeout(done, ms));

function connect() {
	if (port) return;
	try { port = chrome.runtime.connectNative(HOST); } catch { port = undefined; return; }
	port.onMessage.addListener(onMessage);
	port.onDisconnect.addListener(() => {
		port = undefined;
		for (const id of [...jobs.keys()]) finish(id);
		closeAllControl();
	});
}

async function rules(job) {
	const allow = job.hosts.map((host, n) => ({
		id: job.base + 10 + n, priority: 2, action: { type: "allow" },
		condition: { tabIds: [job.tab], resourceTypes: ["main_frame"], regexFilter: `^https?://(www\\.)?${escape(host)}(:[0-9]+)?([/?#]|$)` },
	}));
	const add = [
		// every main-frame load in the agent tab is blocked unless its host was approved for this request
		{ id: job.base, priority: 1, action: { type: "block" }, condition: { tabIds: [job.tab], resourceTypes: ["main_frame"] } },
		...allow,
	];
	if (job.blocked.length) {
		add.push({ id: job.base + 1, priority: 3, action: { type: "block" }, condition: { tabIds: [job.tab], requestDomains: job.blocked } });
		add.push({ id: job.base + 2, priority: 3, action: { type: "block" }, condition: { tabIds: [-1], initiatorDomains: [chrome.runtime.id], requestDomains: job.blocked } });
	}
	await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIds(job), addRules: add });
	job.rules = add.map(rule => rule.id);
}
const ruleIds = job => job.rules ?? [];

function fail(id, error) {
	if (!jobs.has(id)) return;
	send({ type: "error", id, error });
	finish(id);
}
function finish(id) {
	const job = jobs.get(id);
	if (!job) return;
	jobs.delete(id);
	job.abort.abort();
	job.answer?.(false);
	if (job.tab !== undefined) chrome.tabs.remove(job.tab).catch(() => {});
	chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIds(job) }).catch(() => {});
}

async function onMessage(m) {
	if (["control-open", "act", "control-close"].includes(m.type) || (m.type === "cancel" && sessions.has(m.id))) return onControl(m); // browser_act (control.js)
	const job = jobs.get(m.id);
	if (m.type === "fetch") return m.download ? download(m) : m.extract ? queueSearch(m) : start(m);
	if (!job) return;
	if (m.type === "navigate-answer") {
		if (m.ok) { job.hosts = m.hosts; await rules(job); }
		job.answer?.(Boolean(m.ok));
	} else if (m.type === "images") downloadImages(job, m.list ?? []);
	else if (m.type === "done" || m.type === "cancel") finish(m.id);
}

function register(m) {
	if (paused) return send({ type: "error", id: m.id, error: "Paused by the user (the Pi browser fetch toolbar button)." });
	const job = { id: m.id, hosts: m.hosts ?? [], blocked: m.blocked ?? [], abort: new AbortController(), hops: 0, base: nextRule };
	nextRule = nextRule > 1_000_000 ? 100 : nextRule + 50;
	jobs.set(m.id, job);
	return job;
}

// A queued search is already a job, so pause, disconnect and cancel drop it before it navigates.
function queueSearch(m) {
	const job = register(m);
	if (!job) return;
	searches = searches.then(async () => {
		if (!jobs.has(m.id)) return;
		if (Date.now() < cooldownUntil) return fail(m.id, `Google showed a CAPTCHA; browser searches are paused until ${new Date(cooldownUntil).toLocaleTimeString()}.`);
		await sleep(Math.max(0, lastSearch + SEARCH_GAP_MS - Date.now()));
		if (!jobs.has(m.id)) return;
		try { await start(m, job); } finally { lastSearch = Date.now(); }
	});
}

// Download-only request (image_search save): no tab, Pi already checked every URL.
function download(m) {
	const job = register(m);
	if (job) downloadImages(job, Array.isArray(m.download) ? m.download : []);
}

async function start(m, job = register(m)) {
	if (!job) return;
	try {
		const tab = await chrome.tabs.create({ url: "about:blank", active: false });
		job.tab = tab.id;
		await rules(job);
		await chrome.tabs.update(tab.id, { url: m.url, muted: true });
		await settle(job, LOAD_MS, false);
		await settle(job, CHALLENGE_MS, true);
		if (!m.extract) await rendered(job);
		const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: job.tab }, func: m.extract === "web" ? extractWeb : m.extract === "images" ? extractImages : extract });
		if (!jobs.has(m.id)) return;
		if (m.extract) {
			if (result.captcha) {
				cooldown = Math.min(COOLDOWN_MAX, cooldown ? cooldown * 2 : COOLDOWN_MS);
				cooldownUntil = Date.now() + cooldown;
				throw new Error(`Google showed a CAPTCHA; browser searches are paused for ${cooldown / 60_000} minutes.`);
			}
			cooldown = 0;
			if (m.extract === "images") await sendSheet(job, result.results ?? []);
		}
		send({ type: "page", id: m.id, ...result });
		chrome.tabs.remove(job.tab).catch(() => {});
		job.tab = undefined;
	} catch (error) {
		fail(m.id, String(error?.message ?? error));
	}
}

// Wait until the tab finished loading an approved host (and, with `challenge`, until a bot check page cleared).
// Time spent waiting for Pi's approval of a redirect does not count.
async function settle(job, ms, challenge) {
	let deadline = Date.now() + ms;
	for (;;) {
		if (!jobs.has(job.id)) throw new Error("cancelled");
		if (job.waiting) deadline += 250;
		else {
			const tab = await chrome.tabs.get(job.tab);
			if (tab.status === "complete" && job.hosts.includes(hostOf(tab.url ?? ""))) {
				if (!challenge) return;
				const [{ result: title }] = await chrome.scripting.executeScript({ target: { tabId: job.tab }, func: () => `${document.title} ${document.querySelector("#challenge-form, #cf-challenge-running, script[src*='challenge-platform']") ? "challenge" : ""}` });
				if (!CHALLENGE.test(title) && !/challenge$/.test(title)) return;
			}
			if (Date.now() > deadline) throw new Error(challenge ? "The site's bot check did not clear within 20 s." : "The page did not load within 30 s.");
		}
		await sleep(250);
	}
}

// Single-page sites fill the page in by script after the load: wait until its text stops changing (at most 8 s).
async function rendered(job) {
	let last = -1, calm = 0;
	for (const until = Date.now() + 8000; Date.now() < until && jobs.has(job.id);) {
		const [{ result: size }] = await chrome.scripting.executeScript({ target: { tabId: job.tab }, func: textSize });
		calm = size > 0 && size === last ? calm + 1 : 0;
		if (calm >= 2) return;
		last = size;
		await sleep(300);
	}
}

// Runs in the page.
function textSize() { return document.body?.innerText.length ?? 0; }
// Runs in the page.
function extract() {
	const abs = value => { try { const url = new URL(value, location.href); return /^https?:$/.test(url.protocol) ? url.href : ""; } catch { return ""; } };
	const best = srcset => (srcset ?? "").split(",").map(part => part.trim().split(/\s+/)).filter(([url]) => url).sort((a, b) => (parseFloat(b[1]) || 1) - (parseFloat(a[1]) || 1))[0]?.[0];
	const images = [];
	for (const meta of document.querySelectorAll("meta[property='og:image'], meta[name='twitter:image']")) images.push(abs(meta.content));
	for (const img of document.images) {
		if (img.complete && img.naturalWidth && img.naturalWidth < 64 && img.naturalHeight < 64) continue; // icons and pixels
		images.push(abs(best(img.srcset) || img.currentSrc || img.src || img.dataset.src || ""));
	}
	for (const source of document.querySelectorAll("picture source[srcset]")) images.push(abs(best(source.srcset)));
	const links = [];
	const seen = new Set();
	for (const a of document.links) {
		const href = abs(a.href);
		if (!href || seen.has(href) || links.length >= 300) continue;
		seen.add(href);
		links.push({ text: (a.innerText || a.title || "").replace(/\s+/g, " ").trim().slice(0, 100), href });
	}
	return { url: location.href, title: document.title, text: (document.body?.innerText ?? "").slice(0, 200_000), links, images: [...new Set(images.filter(Boolean))].slice(0, 100) };
}

// Runs in the page (plan 71dc4da4 D9): raw candidates only; Pi normalizes them.
// Each page function is serialized alone by executeScript, so the CAPTCHA test is repeated in both.
function extractWeb() {
	const captcha = location.pathname.startsWith("/sorry/") || /unusual traffic from your computer/i.test(document.body?.innerText ?? "") || Boolean(document.querySelector("#captcha-form, iframe[src*='recaptcha']"));
	const results = [];
	for (const h3 of document.querySelectorAll("#search a h3, #rso a h3")) {
		const a = h3.closest("a");
		// the result block: the largest ancestor that holds no other result title
		let block = a;
		while (block.parentElement && !/^(rso|search)$/.test(block.parentElement.id) && block.parentElement.querySelectorAll("h3").length === 1) block = block.parentElement;
		results.push({ href: a.href, title: h3.innerText, lines: block.innerText.split("\n").map(line => line.trim()).filter(Boolean).slice(0, 20) });
	}
	return { url: location.href, title: document.title, captcha, results };
}
function extractImages() {
	const captcha = location.pathname.startsWith("/sorry/") || /unusual traffic from your computer/i.test(document.body?.innerText ?? "") || Boolean(document.querySelector("#captcha-form, iframe[src*='recaptcha']"));
	const scripts = [...document.scripts].map(script => script.textContent).join("\n"), results = [], seen = new Set();
	for (const tile of document.querySelectorAll("[data-docid]")) {
		const docid = tile.dataset.docid;
		if (!docid || seen.has(docid) || results.length >= 30) continue;
		seen.add(docid);
		const img = tile.querySelector("img"), at = scripts.indexOf(docid);
		// originals sit in inline scripts as ["url",height,width] after the tile's docid; Google's own thumbnails are skipped
		let original;
		if (at >= 0) {
			const triple = /\["(https?:\/\/[^"]+)",(\d+),(\d+)\]/g;
			triple.lastIndex = at;
			for (let m; (m = triple.exec(scripts)) && m.index < at + 5000;) if (!/\.gstatic\.com|\.google\./.test(m[1])) { original = [m[1], Number(m[2]), Number(m[3])]; break; }
		}
		const page = tile.dataset.lpage || tile.querySelector("[data-lpage]")?.dataset.lpage || tile.closest("[data-lpage]")?.dataset.lpage || "";
		results.push({ docid, page, thumb: img?.currentSrc || img?.src || "", original, lines: tile.innerText.split("\n").map(line => line.trim()).filter(Boolean).slice(0, 4) });
	}
	return { url: location.href, title: document.title, captcha, results };
}

// One numbered grid of the thumbnails (D7); only Google's own thumbnails or inline data are fetched, without cookies.
async function sendSheet(job, results) {
	if (!results.length) return;
	try {
		const canvas = new OffscreenCanvas(SHEET_COLS * CELL, Math.ceil(results.length / SHEET_COLS) * CELL), g = canvas.getContext("2d");
		g.fillStyle = "#fff";
		g.fillRect(0, 0, canvas.width, canvas.height);
		const safe = results.map(({ thumb }) => /^(data:image\/|https:\/\/[\w-]+\.gstatic\.com\/)/.test(thumb ?? "") ? thumb : "");
		const draw = async (thumb, n) => {
			if (thumb) try {
				const response = await fetch(thumb, { credentials: "omit", signal: AbortSignal.any([job.abort.signal, AbortSignal.timeout(IMAGE_MS)]) });
				const bitmap = await createImageBitmap(await response.blob()), scale = Math.min((CELL - 8) / bitmap.width, (CELL - 8) / bitmap.height);
				const w = bitmap.width * scale, h = bitmap.height * scale;
				g.drawImage(bitmap, (n % SHEET_COLS) * CELL + (CELL - w) / 2, Math.floor(n / SHEET_COLS) * CELL + (CELL - h) / 2, w, h);
			} catch { /* a missing thumbnail leaves its cell blank, numbers never shift */ }
		};
		await Promise.all(safe.map((thumb, n) => draw(thumb, n)));
		g.font = "bold 26px sans-serif";
		results.forEach((_, n) => {
			const x = (n % SHEET_COLS) * CELL, y = Math.floor(n / SHEET_COLS) * CELL;
			g.fillStyle = "#000c";
			g.fillRect(x + 2, y + 2, n >= 9 ? 46 : 32, 34);
			g.fillStyle = "#ff0";
			g.fillText(String(n + 1), x + 7, y + 29);
		});
		const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
		if (jobs.has(job.id)) send({ type: "image", id: job.id, n: 0, url: "contact-sheet", mime: "image/png", data: base64(bytes) });
	} catch (error) { console.warn("Pi contact sheet:", error); } // the numbered list still works without it
}
function base64(bytes) {
	let text = "";
	for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(text);
}

// Cross-site navigations are blocked by the rules above; the error names the URL, which Pi then checks (D12).
chrome.webRequest.onErrorOccurred.addListener(async details => {
	const job = [...jobs.values()].find(entry => entry.tab === details.tabId);
	if (!job || details.type !== "main_frame" || !/BLOCKED_BY_CLIENT/.test(details.error)) return;
	if (job.waiting) return;
	job.waiting = true;
	try {
		const ok = await new Promise(resolve => { job.answer = resolve; send({ type: "navigate", id: job.id, url: details.url }); });
		job.answer = undefined;
		if (ok && jobs.has(job.id)) await chrome.tabs.update(job.tab, { url: details.url });
		else fail(job.id, `Navigation to ${details.url} was not approved.`);
	} finally { job.waiting = false; }
}, { urls: ["<all_urls>"], types: ["main_frame"] });

async function downloadImages(job, list) {
	let total = 0, n = 0, skipped = 0;
	for (const { url, cookies } of list) {
		if (!jobs.has(job.id)) return;
		if (n >= MAX_IMAGES || total >= MAX_TOTAL) { skipped++; continue; }
		const timeout = AbortSignal.timeout(IMAGE_MS);
		try {
			// Q-02: Pi sets cookies only for the page's own host; redirects are refused instead of followed unchecked.
			const response = await fetch(url, { credentials: cookies ? "include" : "omit", redirect: "error", signal: AbortSignal.any([job.abort.signal, timeout]) });
			const mime = response.headers.get("content-type") ?? "";
			const limit = Math.min(MAX_IMAGE, MAX_TOTAL - total);
			if (!response.ok || !mime.startsWith("image/") || Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); skipped++; continue; }
			const bytes = new Uint8Array(await response.arrayBuffer());
			if (!bytes.length || bytes.length > limit) { skipped++; continue; }
			total += bytes.length;
			send({ type: "image", id: job.id, n: ++n, url, mime, data: base64(bytes) });
		} catch { skipped++; }
	}
	if (jobs.has(job.id)) send({ type: "images-done", id: job.id, skipped });
}

// R7: the toolbar button pauses all agent browsing (D15 cancels what is running).
async function showPaused() {
	await chrome.action.setBadgeText({ text: paused ? "II" : "" });
	await chrome.action.setBadgeBackgroundColor({ color: "#b00020" });
	await chrome.action.setTitle({ title: paused ? "Pi browser fetch: paused (click to resume)" : "Pi browser fetch: on (click to pause)" });
}
chrome.action.onClicked.addListener(async () => {
	paused = !paused;
	await chrome.storage.local.set({ paused });
	if (paused) for (const id of [...jobs.keys()]) fail(id, "Paused by the user (the Pi browser fetch toolbar button).");
	await showPaused();
});
chrome.tabs.onRemoved.addListener(tabId => {
	const job = [...jobs.values()].find(entry => entry.tab === tabId);
	if (job) fail(job.id, "The agent tab was closed.");
});

// The open native port keeps this worker alive; the alarm reconnects after the host or worker went away.
chrome.storage.local.get("paused").then(value => { paused = Boolean(value.paused); showPaused(); });
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.alarms.create("reconnect", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(connect);
connect();
importScripts("control.js");
