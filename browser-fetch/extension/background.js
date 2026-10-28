// Pi browser fetch (plan d8c5ace2): loads pages Pi approved in an inactive tab and returns their text and images.
// Pi decides every site; this worker enforces it with tab-scoped declarativeNetRequest rules (D6, D12).
const HOST = "pi.browser_fetch";
const LOAD_MS = 30_000, CHALLENGE_MS = 20_000, IMAGE_MS = 20_000, MAX_IMAGE = 8 * 1024 * 1024, MAX_TOTAL = 60 * 1024 * 1024, MAX_IMAGES = 30;
const CHALLENGE = /just a moment|attention required|checking your browser|verify you are human|ddos-guard|please wait while we verify/i;
const jobs = new Map();
let port, paused = false, nextRule = 100;

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
	if (m.type === "fetch") return start(m);
	if (!job) return;
	if (m.type === "navigate-answer") {
		if (m.ok) { job.hosts = m.hosts; await rules(job); }
		job.answer?.(Boolean(m.ok));
	} else if (m.type === "images") downloadImages(job, m.list ?? []);
	else if (m.type === "done" || m.type === "cancel") finish(m.id);
}

async function start(m) {
	if (paused) return send({ type: "error", id: m.id, error: "Paused by the user (the Pi browser fetch toolbar button)." });
	const job = { id: m.id, hosts: m.hosts ?? [], blocked: m.blocked ?? [], abort: new AbortController(), hops: 0, base: nextRule };
	nextRule = nextRule > 1_000_000 ? 100 : nextRule + 50;
	jobs.set(m.id, job);
	try {
		const tab = await chrome.tabs.create({ url: "about:blank", active: false });
		job.tab = tab.id;
		await rules(job);
		await chrome.tabs.update(tab.id, { url: m.url, muted: true });
		await settle(job, LOAD_MS, false);
		await settle(job, CHALLENGE_MS, true);
		const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: job.tab }, func: extract });
		if (!jobs.has(m.id)) return;
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
			let text = "";
			for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
			total += bytes.length;
			send({ type: "image", id: job.id, n: ++n, url, mime, data: btoa(text) });
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
