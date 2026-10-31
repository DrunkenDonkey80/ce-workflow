// browser_act control sessions (plan 607b2518 D15-D20), loaded into the background worker after background.js.
// Pi decides every grant and safety rule; this file drives one agent tab per session through chrome.debugger (D4)
// and keeps it inside the hosts Pi allowed with the same tab-scoped declarativeNetRequest rules as fetch jobs (D18).
const sessions = new Map();
let nextControlRule = 2_000_000;
let ACT_MS = 45_000; // below Pi's 60 s wait; a hung CDP call must not wedge the session queue
const KEEP = new Set(["button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "listbox", "option", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "switch", "slider", "spinbutton", "treeitem", "heading"]);
// D19: links and forms that would open a new tab load in the agent tab instead, where the navigation rules apply.
const SAME_TAB = `(() => {
	window.open = url => { if (url) location.href = new URL(url, location.href).href; return null; };
	const fix = event => { const el = event.target?.closest?.("a[target], area[target], form[target]"); if (el) el.target = "_self"; };
	addEventListener("click", fix, true); addEventListener("submit", fix, true);
})();`;

// Runs on the target element (this): the facts Pi judges (D16, D23).
function elementFacts() {
	const el = this.nodeType === 1 ? this : this.parentElement;
	const form = el.form || el.closest("form");
	const label = e => (e.getAttribute("aria-label") || e.innerText || e.value || e.title || "").replace(/\s+/g, " ").trim().slice(0, 80);
	const submits = form ? [...form.querySelectorAll("button:not([type]), button[type=submit], input[type=submit], input[type=image]")] : [];
	return {
		tag: el.tagName.toLowerCase(), type: el.getAttribute("type") ? el.type : "", autocomplete: el.getAttribute("autocomplete") || "",
		isSubmit: Boolean(form) && (el.tagName === "BUTTON" ? !el.getAttribute("type") || el.type === "submit" : el.tagName === "INPUT" && ["submit", "image"].includes(el.type)),
		formPayment: Boolean(form?.querySelector("[autocomplete^='cc-'], [autocomplete*=' cc-']")),
		formSubmitNames: submits.map(label).filter(Boolean).slice(0, 5),
	};
}
// Runs on the hit-tested node of a point click: the clickable element around it.
function clickable() {
	const el = this.nodeType === 1 ? this : this.parentElement;
	return el.closest("a[href], button, input, select, textarea, summary, label, [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=option], [role=switch], [contenteditable='true'], [contenteditable='']") || el;
}
function pickOption(value) {
	if (this.tagName !== "SELECT") return "not a dropdown; use click for checkboxes and radios";
	const option = [...this.options].find(o => o.value === value) || [...this.options].find(o => o.text.trim().toLowerCase() === value.trim().toLowerCase());
	if (!option) return `no option "${value}"; options: ${[...this.options].map(o => o.text.trim()).slice(0, 30).join(", ")}`;
	this.value = option.value;
	this.dispatchEvent(new Event("input", { bubbles: true }));
	this.dispatchEvent(new Event("change", { bubbles: true }));
	return "";
}

const cdp = (s, method, params = {}) => chrome.debugger.sendCommand({ tabId: s.tab }, method, params);
const call = async (s, objectId, fn, args = [], byValue = true) => (await cdp(s, "Runtime.callFunctionOn", { objectId, functionDeclaration: fn.toString(), arguments: args.map(value => ({ value })), returnByValue: byValue })).result;

async function onControl(m) {
	if (m.type === "control-open") {
		if (paused) return send({ type: "closed", id: m.id, reason: "paused by the user (the Pi browser fetch toolbar button)" });
		if (!sessions.has(m.id)) sessions.set(m.id, { id: m.id, hosts: [], blocked: [], base: nextControlRule, queue: Promise.resolve(), refs: new Map(), stopped: [], spawned: [], dialogs: [] });
		nextControlRule = nextControlRule > 9_000_000 ? 2_000_000 : nextControlRule + 50;
		return;
	}
	const s = sessions.get(m.id);
	if (!s) return m.type === "act" && send({ type: "error", id: m.id, seq: m.seq, error: "No control session: open a page first." });
	if (m.type === "control-close" || m.type === "cancel") return endSession(m.id);
	if (m.type !== "act") return;
	// One action at a time per session, in arrival order.
	s.queue = s.queue.then(async () => {
		const timeout = sleep(ACT_MS).then(() => { throw new Error(`The page did not respond within ${ACT_MS / 1000} s (frozen or busy tab); try again or take a screenshot.`); });
		try { send({ type: "result", id: m.id, seq: m.seq, ...await Promise.race([act(s, m), timeout]) }); }
		catch (error) { send({ type: "error", id: m.id, seq: m.seq, error: String(error?.message ?? error) }); }
	});
}

async function act(s, m) {
	if (s.reattaching) await s.reattaching;
	if (!sessions.has(s.id)) throw new Error("Browser control ended.");
	if (paused) { endSession(s.id, "paused by the user (the Pi browser fetch toolbar button)"); throw new Error("Paused by the user."); }
	// D20: the deadline travels with every action; the alarm closes the tab even when Pi goes quiet.
	if (!(m.until > Date.now())) throw new Error("No live control grant for this site.");
	s.until = m.until;
	chrome.alarms.create(`control:${s.id}`, { when: m.until });
	s.hosts = Array.isArray(m.hosts) ? m.hosts : [];
	s.blocked = Array.isArray(m.blocked) ? m.blocked : [];
	if (s.tab === undefined) {
		if (m.action !== "open") throw new Error("No page is open.");
		await openTab(s);
	}
	await rules(s);
	// Background tabs get frozen or throttled; wake this one before acting.
	await cdp(s, "Page.setWebLifecycleState", { state: "active" }).catch(() => {});
	const before = (await chrome.tabs.get(s.tab)).url;
	switch (m.action) {
		case "open":
			s.refs.clear();
			await chrome.tabs.update(s.tab, { url: m.url });
			return await after(s, 30_000, before);
		case "snapshot": return await snapshot(s);
		case "scroll":
			if (m.ref) await cdp(s, "DOM.scrollIntoViewIfNeeded", { backendNodeId: ref(s, m.ref) });
			else await cdp(s, "Runtime.evaluate", { expression: `scrollBy(0, ${m.direction === "up" ? -1 : 1} * innerHeight * 0.8)` });
			return await page(s);
		case "back":
			s.refs.clear();
			await chrome.tabs.goBack(s.tab).catch(() => { throw new Error("There is no previous page."); });
			return await after(s, 30_000, before);
		case "screenshot": {
			const shot = await cdp(s, "Page.captureScreenshot", { format: "png" });
			return { ...await page(s), png: shot.data }; // the host saves it and replaces png with path (D10)
		}
		case "click": case "type": case "select": case "upload": {
			const target = await resolve(s, m);
			const facts = await factsOf(s, target);
			if (m.phase === "inspect") return { ...await page(s), facts };
			// D16: execute only what Pi judged; anything that changed since inspect fails closed.
			const keys = ["node", "tag", "type", "autocomplete", "isSubmit", "formPayment", "role", "name", "url"];
			if (!m.facts || keys.some(key => JSON.stringify(m.facts[key]) !== JSON.stringify(facts[key])))
				throw new Error("The element changed since it was checked; take a new snapshot.");
			if (m.action === "upload") await upload(s, m, target, facts); else await perform(s, m, target);
			const done = await after(s, 10_000, before);
			if (done.url !== before) s.refs.clear(); // same page: refs stay, each target is rechecked above
			return done;
		}
	}
	throw new Error(`Unknown action ${m.action}.`);
}

async function openTab(s) {
	const [current] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
	const tab = await chrome.tabs.create({ url: "about:blank", active: false, ...(current ? { windowId: current.windowId, index: current.index + 1 } : {}) });
	s.tab = tab.id;
	await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
	// D1: a background tab, so it never interrupts the user, in a "Pi" group they can click to watch; a failed group only costs findability.
	try {
		const [group] = await chrome.tabGroups.query({ title: "Pi", windowId: tab.windowId });
		const id = await chrome.tabs.group({ tabIds: [tab.id], ...(group ? { groupId: group.id } : {}) });
		if (!group) await chrome.tabGroups.update(id, { title: "Pi", color: "blue" });
	} catch (error) { console.warn("Pi tab group:", error); }
	await attach(s);
}
async function attach(s) {
	await chrome.debugger.attach({ tabId: s.tab }, "1.3");
	s.inflight = new Map();
	await cdp(s, "Page.enable");
	await cdp(s, "Network.enable").catch(() => {}); // only to know when the page stops loading data
	await cdp(s, "Page.addScriptToEvaluateOnNewDocument", { source: SAME_TAB });
	await cdp(s, "Emulation.setFocusEmulationEnabled", { enabled: true }); // still gets focus and input after the user switches away
}
/** Chrome swapped the tab's page (a new process, a prerendered page) and dropped the debugger: attach again to the same or replacing tab. */
function reattach(s, why) {
	s.reattaching ??= (async () => {
		await sleep(300);
		const tab = await chrome.tabs.get(s.tab).catch(() => undefined);
		if (!tab) return endSession(s.id, "ended: the agent tab was closed");
		try { await attach(s); s.refs.clear(); }
		catch (error) { endSession(s.id, `ended: the browser dropped its debugger connection to the tab (${why}; this was not the user) and attaching again failed: ${error?.message ?? error}`); }
	})().finally(() => { s.reattaching = undefined; });
	return s.reattaching;
}
/** Wait until the page has had no new or open requests for a moment (open ones older than 5 s, like long polls, do not count). */
async function quiet(s, ms) {
	const until = Date.now() + ms;
	let calm = 0;
	while (Date.now() < until && sessions.has(s.id)) {
		const now = Date.now(), busy = [...(s.inflight?.values() ?? [])].some(at => now - at < 5000);
		calm = busy ? 0 : calm + 1;
		if (calm >= 3) return;
		await sleep(150);
	}
}

const ref = (s, name) => {
	const node = s.refs.get(name);
	if (!node) throw new Error(`Unknown ref ${name}: take a new snapshot.`);
	return node.backendNodeId;
};
/** The element an action targets, as a backend node id (D16): a snapshot ref, or the clickable element under a point. */
async function resolve(s, m) {
	if (m.ref) {
		const backendNodeId = ref(s, m.ref);
		const found = await cdp(s, "DOM.resolveNode", { backendNodeId }).catch(() => undefined);
		if (!found?.object?.objectId) throw new Error(`Ref ${m.ref} is no longer on the page: take a new snapshot.`);
		return { backendNodeId, objectId: found.object.objectId };
	}
	await cdp(s, "DOM.getDocument", { depth: 0 });
	const hit = await cdp(s, "DOM.getNodeForLocation", { x: Math.round(m.x), y: Math.round(m.y) }).catch(() => undefined);
	if (!hit) throw new Error(`Nothing at (${m.x}, ${m.y}).`);
	const { object } = await cdp(s, "DOM.resolveNode", { backendNodeId: hit.backendNodeId });
	const el = await call(s, object.objectId, clickable, [], false);
	const { node } = await cdp(s, "DOM.describeNode", { objectId: el.objectId });
	return { backendNodeId: node.backendNodeId, objectId: el.objectId, point: { x: m.x, y: m.y } };
}
async function factsOf(s, target) {
	const facts = (await call(s, target.objectId, elementFacts)).value;
	const { nodes } = await cdp(s, "Accessibility.getPartialAXTree", { backendNodeId: target.backendNodeId, fetchRelatives: false }).catch(() => ({ nodes: [] }));
	const ax = nodes.find(n => n.backendDOMNodeId === target.backendNodeId) ?? nodes[0];
	const tab = await chrome.tabs.get(s.tab);
	return { ...facts, node: target.backendNodeId, role: String(ax?.role?.value ?? facts.tag), name: String(ax?.name?.value ?? "").replace(/\s+/g, " ").trim().slice(0, 80), url: tab.url };
}

async function perform(s, m, target) {
	if (m.action === "select") {
		const problem = (await call(s, target.objectId, pickOption, [String(m.value)])).value;
		if (problem) throw new Error(problem);
		return;
	}
	if (m.action === "type") {
		await cdp(s, "DOM.focus", { backendNodeId: target.backendNodeId });
		await call(s, target.objectId, function () { if (typeof this.select === "function") this.select(); else if (this.isContentEditable) getSelection().selectAllChildren(this); });
		await cdp(s, "Input.insertText", { text: String(m.text) }); // replaces the selected text
		if (m.submit) for (const type of ["keyDown", "keyUp"]) await cdp(s, "Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, ...(type === "keyDown" ? { text: "\r" } : {}) });
		return;
	}
	let { x, y } = target.point ?? {};
	if (!target.point) {
		await cdp(s, "DOM.scrollIntoViewIfNeeded", { backendNodeId: target.backendNodeId });
		const q = (await cdp(s, "DOM.getBoxModel", { backendNodeId: target.backendNodeId })).model.border;
		x = (q[0] + q[4]) / 2; y = (q[1] + q[5]) / 2;
	}
	// Trusted input events (D4): sites that ignore scripted click() still see a real click.
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp(s, "Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: type === "mouseMoved" ? 0 : 1 });
}

/** Hands Pi's checked files to a file field, or to the file picker its button opens (intercepted, so no system dialog appears). */
async function upload(s, m, target, facts) {
	const files = Array.isArray(m.files) ? m.files.map(String) : [];
	const set = backendNodeId => cdp(s, "DOM.setFileInputFiles", { files, backendNodeId }).catch(error => {
		throw new Error(/not allowed/i.test(error.message) ? "The browser refused the files: turn on \"Allow access to file URLs\" for Pi browser fetch in chrome://extensions → Details." : error.message);
	});
	if (facts.tag === "input" && facts.type === "file") return await set(target.backendNodeId);
	await cdp(s, "Page.setInterceptFileChooserDialog", { enabled: true });
	try {
		const opened = new Promise(done => { s.chooser = done; });
		await perform(s, { action: "click" }, target);
		const chooser = await Promise.race([opened, sleep(3000)]);
		if (!chooser?.backendNodeId) throw new Error("That click opened no file picker; pick the page's upload button or file field.");
		if (chooser.mode === "selectSingle" && files.length > 1) throw new Error("This picker takes one file; upload them one at a time.");
		await set(chooser.backendNodeId);
	} finally {
		s.chooser = undefined;
		await cdp(s, "Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {});
	}
}

/** Accessibility-tree snapshot (D22): visible interactive elements and headings with boxes, sorted by position. */
async function snapshot(s) {
	await quiet(s, 5000); // single-page sites fill in after the load; skeletons otherwise
	const { nodes } = await cdp(s, "Accessibility.getFullAXTree");
	await cdp(s, "DOM.getDocument", { depth: 0 });
	const picked = nodes.filter(n => !n.ignored && KEEP.has(n.role?.value) && n.backendDOMNodeId);
	const items = [];
	for (let i = 0; i < picked.length; i += 50) {
		items.push(...await Promise.all(picked.slice(i, i + 50).map(async n => {
			const q = await cdp(s, "DOM.getBoxModel", { backendNodeId: n.backendDOMNodeId }).then(r => r.model.border, () => undefined);
			if (!q || q[2] - q[0] < 1 || q[5] - q[1] < 1) return;
			const props = Object.fromEntries((n.properties ?? []).map(p => [p.name, p.value?.value]));
			const item = { backendNodeId: n.backendDOMNodeId, role: n.role.value, name: String(n.name?.value ?? "").replace(/\s+/g, " ").trim().slice(0, 80), x: Math.round(q[0]), y: Math.round(q[1]), w: Math.round(q[2] - q[0]), h: Math.round(q[5] - q[1]) };
			const value = String(n.value?.value ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
			if (value && value !== item.name) item.value = value;
			if (props.checked !== undefined) item.checked = props.checked === true || props.checked === "true";
			return item;
		})));
	}
	const visible = items.filter(Boolean).sort((a, b) => a.y - b.y || a.x - b.x);
	s.refs = new Map(visible.map((item, n) => [`e${n + 1}`, item]));
	const frames = (await cdp(s, "Runtime.evaluate", { expression: "[...document.querySelectorAll('iframe')].map(f => f.src).filter(src => /^https?:/.test(src)).slice(0, 20)", returnByValue: true })).result.value ?? [];
	return { ...await page(s), items: visible.map(({ backendNodeId, ...item }, n) => ({ ref: `e${n + 1}`, ...item })), frames };
}

async function page(s) {
	const tab = await chrome.tabs.get(s.tab);
	return { url: tab.url, title: tab.title ?? "" };
}
/** After a navigating action: wait for the load, undo a blocked navigation's error page, report what was stopped (D18, D19). */
async function after(s, ms, before) {
	await sleep(400);
	// Single-page sites change the URL with script after a fetch, not a load; give that a moment.
	const tab = () => chrome.tabs.get(s.tab).catch(() => ({ url: before, status: "loading" })); // mid-swap the tab id can be gone for a moment
	for (const wait = Date.now() + 1500; Date.now() < wait && sessions.has(s.id) && (await tab()).url === before;) await sleep(150);
	const until = Date.now() + ms;
	while (Date.now() < until && sessions.has(s.id) && (await tab()).status !== "complete") await sleep(200);
	if (s.reattaching) await s.reattaching;
	if (!sessions.has(s.id)) throw new Error("Browser control ended during the action.");
	if (s.stopped.length) {
		const tab = await chrome.tabs.get(s.tab);
		if (s.stopped.includes(tab.url)) { await chrome.tabs.goBack(s.tab).catch(() => {}); await sleep(400); }
	}
	return { ...await page(s), blocked: s.stopped.splice(0), spawned: s.spawned.splice(0), dialogs: s.dialogs.splice(0) };
}

function endSession(id, reason) {
	const s = sessions.get(id);
	if (!s) return;
	sessions.delete(id);
	chrome.alarms.clear(`control:${id}`);
	if (s.tab !== undefined) {
		chrome.debugger.detach({ tabId: s.tab }).catch(() => {});
		chrome.tabs.remove(s.tab).catch(() => {});
	}
	chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIds(s) }).catch(() => {});
	if (reason) send({ type: "closed", id, reason });
}
function closeAllControl(reason) { for (const id of [...sessions.keys()]) endSession(id, reason); }
const sessionOf = tabId => [...sessions.values()].find(s => s.tab === tabId);

chrome.webRequest.onErrorOccurred.addListener(details => {
	const s = sessionOf(details.tabId);
	if (s && details.type === "main_frame" && /BLOCKED_BY_CLIENT/.test(details.error)) s.stopped.push(details.url); // never replayed (D18)
}, { urls: ["<all_urls>"], types: ["main_frame"] });
// shortcut: a tab opened by the agent tab despite SAME_TAB may send one request before it is closed; block it with CDP auto-attach if that matters.
chrome.tabs.onCreated.addListener(tab => {
	const s = tab.openerTabId === undefined ? undefined : sessionOf(tab.openerTabId);
	if (!s) return;
	s.spawned.push(tab.pendingUrl || tab.url || "");
	chrome.tabs.remove(tab.id).catch(() => {});
});
// Page dialogs block a hidden tab: leaving the page is the agent's own request, anything else is cancelled and reported.
// shortcut: confirm() is always cancelled, so sites that confirm with a native dialog cannot be completed; accept it after a D16 approval if needed.
chrome.debugger.onEvent.addListener((source, method, params) => {
	const s = sessionOf(source.tabId);
	if (s && method === "Network.requestWillBeSent") return s.inflight?.set(params.requestId, Date.now());
	if (s && (method === "Network.loadingFinished" || method === "Network.loadingFailed")) return s.inflight?.delete(params.requestId);
	if (s && method === "Page.fileChooserOpened") return s.chooser?.(params);
	if (!s || method !== "Page.javascriptDialogOpening") return;
	const accept = params.type === "beforeunload";
	if (!accept) s.dialogs.push(`${params.type}: ${String(params.message ?? "").slice(0, 300)}`);
	cdp(s, "Page.handleJavaScriptDialog", { accept }).catch(() => {});
});
// A replaced tab (prerender, instant pages) keeps the session under its new id.
chrome.tabs.onReplaced?.addListener((added, removedId) => { const s = sessionOf(removedId); if (s) { s.tab = added; reattach(s, "the tab was replaced"); } });
chrome.tabs.onRemoved.addListener(async tabId => {
	await sleep(100); // a replacement reports onReplaced around the same time
	const s = sessionOf(tabId);
	if (s) endSession(s.id, "ended: the agent tab was closed");
});
chrome.debugger.onDetach.addListener((source, reason) => {
	const s = sessionOf(source.tabId);
	if (!s) return;
	if (reason === "canceled_by_user") endSession(s.id, "ended: the user pressed Cancel on the browser's debugging bar");
	else reattach(s, reason); // target_closed: Chrome swapped the page, the tab is usually still there
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name.startsWith("control:")) endSession(alarm.name.slice(8), "ended: the control grant expired"); });
chrome.action.onClicked.addListener(() => { if (paused) closeAllControl("paused by the user (the Pi browser fetch toolbar button)"); });
