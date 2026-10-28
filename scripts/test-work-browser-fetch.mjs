import { fileURLToPath } from "node:url";
// browser_fetch self-check (plan d8c5ace2): policy, URL checks, approvals, host round trip and the extension's logic with a fake chrome.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, statSync, rmSync, writeFileSync, readFileSync, existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import vm from "node:vm";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";

delete process.env.PI_HUB; // a hub-hosted Pi routes dialogs to the hub; this test drives them locally
const agent = mkdtempSync(path.join(os.tmpdir(), "browser-fetch-test-"));
process.env.PI_CODING_AGENT_DIR = agent;
const bf = await import("../extensions/browser-fetch.ts");
const { checkUrl, privateIp, blockedList, readPolicy, updatePolicy, granted, controlUntil, grantKey, blockEntry, dnsCheck, fetchDir, DEFAULT_BLOCKED, extensionId } = bf;

try {
	// URL checks (D16, R1)
	const blocked = blockedList(readPolicy());
	for (const [url, why] of [
		["ftp://example.com/", /http and https/], ["data:text/html,x", /http and https/], ["http://user:pw@example.com/", /user name/],
		["http://localhost:8080/", /local network/], ["http://intranet/", /local network/], ["http://printer.local/", /local network/], ["http://a.localhost/", /local network/],
		["http://127.0.0.1/", /private/], ["http://0x7f.1/", /private/], ["http://2130706433/", /private/], ["http://10.1.2.3/", /private/], ["http://192.168.0.1/", /private/],
		["http://172.20.0.1/", /private/], ["http://169.254.169.254/latest", /private/], ["http://100.64.0.1/", /private/], ["http://0.0.0.0/", /private/],
		["http://[::1]/", /private/], ["http://[::]/", /private/], ["http://[::ffff:127.0.0.1]/", /private/], ["http://[0:0:0:0:0:ffff:7f00:1]/", /private/],
		["http://[::ffff:10.0.0.1]/", /private/], ["http://[fe80::1]/", /private/], ["http://[fd00::1]/", /private/], ["http://[64:ff9b::a00:1]/", /private/], ["http://[2002:c0a8:101::1]/", /private/],
		["https://mail.google.com/mail/u/0", /block list \(mail\.google\.com\)/], ["https://outlook.live.com/", /block list/], ["https://login.live.com/", /block list \(live\.com\)/],
		["https://vault.bitwarden.com/", /block list \(bitwarden\.com\)/], ["https://WWW.ABV.BG./", /block list \(abv\.bg\)/],
		["https://e-fibank.bg/login", /block list \(e-fibank\.bg\)/], ["https://www.paypal.com/signin", /block list \(paypal\.com\)/], ["https://dashboard.stripe.com/", /block list/], ["not a url", /valid URL/],
	]) assert.match(checkUrl(url, blocked).refused ?? "", why, url);
	for (const url of ["https://example.com/a?b=1", "http://8.8.8.8/", "http://[2606:4700::1111]/", "https://google.com/search?q=x", "https://notgmail.com/"]) assert.equal(checkUrl(url, blocked).refused, undefined, url);
	assert.equal(privateIp("::ffff:8.8.8.8"), false);
	assert.equal(grantKey("WWW.Example.COM."), "example.com");
	assert.equal(blockEntry("https://www.Shop.example/x"), "shop.example");
	assert.equal(blockEntry("nodot"), undefined);
	const fakeDns = table => async host => { if (!(host in table)) throw new Error("ENOTFOUND"); return table[host].map(address => ({ address })); };
	assert.match(await dnsCheck("rebind.test", fakeDns({ "rebind.test": ["93.184.216.34", "127.0.0.1"] })), /private address 127\.0\.0\.1/);
	assert.match(await dnsCheck("v6.test", fakeDns({ "v6.test": ["::ffff:192.168.1.1"] })), /private/);
	assert.equal(await dnsCheck("ok.test", fakeDns({ "ok.test": ["93.184.216.34"] })), undefined);
	assert.equal(await dnsCheck("gone.test", fakeDns({})), undefined, "unresolvable names are left to the browser");

	// Policy: grants with expiry, user block list, concurrent writers, corrupt file fails closed (D9, D14)
	assert.deepEqual(readPolicy(), { blocked: [], grants: {}, control: {} });
	await updatePolicy(p => { p.grants["example.com"] = { until: Date.now() + 3_600_000 }; p.grants["old.com"] = { until: Date.now() - 1 }; p.grants["always.com"] = { until: null }; p.blocked.push("evil.test"); });
	let policy = readPolicy();
	assert.ok(granted(policy, "www.example.com") && granted(policy, "always.com") && !granted(policy, "sub.example.com"), "grants match the exact host without www");
	assert.equal(policy.grants["old.com"], undefined, "expired grants pruned on write");
	assert.match(checkUrl("https://a.evil.test/", blockedList(policy)).refused, /evil\.test/);
	await Promise.all(Array.from({ length: 20 }, (_, n) => updatePolicy(p => { p.grants[`site${n}.com`] = { until: null }; })));
	assert.equal(Object.keys(readPolicy().grants).filter(host => host.startsWith("site")).length, 20, "concurrent writers lose nothing");
	// revoke seen by a separate process (fresh read per request)
	const { execFileSync } = await import("node:child_process");
	execFileSync(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(new URL("../extensions/browser-fetch.ts", import.meta.url).href)}); await m.updatePolicy(p => { delete p.grants["example.com"]; });`], { env: { ...process.env } });
	assert.equal(granted(readPolicy(), "example.com"), false, "revoke in another process applies here");
	// Control grants (plan 607b2518 P2-01): timed only, separate from read grants, pruned when expired.
	const soon = Date.now() + 600_000;
	await updatePolicy(p => { p.control["shop.test"] = { until: soon }; p.control["gone.test"] = { until: Date.now() - 1 }; });
	policy = readPolicy();
	assert.equal(controlUntil(policy, "www.shop.test"), soon);
	assert.equal(controlUntil(policy, "always.com"), undefined, "a read grant is not a control grant");
	assert.equal(granted(policy, "shop.test"), false, "a control grant is not a read grant");
	assert.equal(policy.control["gone.test"], undefined, "expired control grants pruned on write");
	writeFileSync(path.join(fetchDir(), "policy.json"), JSON.stringify({ blocked: [], grants: {}, control: { "x.test": { until: null } } }));
	assert.equal(controlUntil(readPolicy(), "x.test"), undefined, "control is never always");
	writeFileSync(path.join(fetchDir(), "policy.json"), JSON.stringify({ blocked: [], grants: {}, control: [] }));
	assert.match(readPolicy().corrupt, /unexpected shape/, "a malformed control map fails closed");
	writeFileSync(path.join(fetchDir(), "policy.json"), "{broken");
	policy = readPolicy();
	assert.match(policy.corrupt, /unreadable/);
	assert.equal(granted(policy, "always.com"), false, "corrupt policy grants nothing");
	await assert.rejects(updatePolicy(() => {}), /unreadable/, "corrupt policy is never overwritten");
	assert.equal(readFileSync(path.join(fetchDir(), "policy.json"), "utf8"), "{broken");
	rmSync(path.join(fetchDir(), "policy.json"));
	assert.ok(DEFAULT_BLOCKED.length > 20);
	console.log("policy ok");

	await roundTrip();
	console.log("round trip ok");

	await actPiSide();
	console.log("browser_act pi side ok");

	// Install points the browser at the package's extension, writes a launcher for the package host.mjs and registers it per browser.
	const tools = [], fakePi = { registerTool: tool => tools.push(tool.name) };
	bf.default(fakePi);
	assert.deepEqual(tools, [], "no tool before Install");
	const present = path.join(agent, "browsers", "helium"), absent = path.join(agent, "browsers", "chrome");
	mkdirSync(present, { recursive: true });
	const calls = [], installed = await bf.install(async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0 }; }, undefined, [present, absent]);
	bf.default(fakePi);
	assert.deepEqual(tools, ["browser_fetch"], "the tool appears once Install wrote the host manifest");
	(await import("../extensions/browser-act.ts")).default({ ...fakePi, on() {} });
	assert.deepEqual(tools, ["browser_fetch", "browser_act"], "browser_act registers on the same condition");
	assert.equal(installed.id, "dmbpeaidhpenhihgngkgekaieninaapk");
	const root = fileURLToPath(new URL("..", import.meta.url));
	assert.equal(installed.extension, path.join(root, "browser-fetch", "extension"), "the extension loads from the package itself");
	assert.ok(existsSync(path.join(installed.extension, "background.js")) && !existsSync(path.join(bf.fetchDir(), "extension")));
	assert.ok(readFileSync(JSON.parse(readFileSync(installed.manifest, "utf8")).path, "utf8").includes(path.join(root, "browser-fetch", "host.mjs")), "the launcher runs the package host");
	const hostManifest = JSON.parse(readFileSync(installed.manifest, "utf8"));
	assert.deepEqual([hostManifest.name, hostManifest.type, hostManifest.allowed_origins], ["pi.browser_fetch", "stdio", ["chrome-extension://dmbpeaidhpenhihgngkgekaieninaapk/"]]);
	assert.ok(existsSync(hostManifest.path));
	if (process.platform === "win32") assert.deepEqual(calls.map(call => call[2]), bf.BROWSER_KEYS.map(key => `HKCU\\Software\\${key}\\NativeMessagingHosts\\pi.browser_fetch`));
	else {
		assert.deepEqual([installed.registered, installed.failed], [[present], []], "only installed browsers get the manifest");
		assert.equal(readFileSync(path.join(present, "NativeMessagingHosts", "pi.browser_fetch.json"), "utf8"), readFileSync(installed.manifest, "utf8"));
		assert.ok(!existsSync(absent), "a missing browser folder is not created");
		assert.ok(statSync(hostManifest.path).mode & 0o111, "the launcher is executable");
		assert.match(readFileSync(hostManifest.path, "utf8"), /^#!\/bin\/sh\nexec "\/[^"]+" /, "the launcher runs node by absolute path (no PATH when a browser starts from Finder)");
	}
	console.log("install ok");
} finally {
	rmSync(agent, { recursive: true, force: true });
}

// Real host + real background.js in a VM with a fake chrome that enforces the session DNR rules, so a blocked
// navigation never "reaches" the fake network (requests[]).
async function roundTrip() {
	const { runHost, frames, frame } = await import("../browser-fetch/host.mjs");
	const pipe = process.platform === "win32" ? String.raw`\\.\pipe\pi-browser-fetch-test-` + randomUUID() : path.join(agent, "pipe.sock");
	process.env.PI_BROWSER_FETCH_PIPE = pipe;
	const imageDir = path.join(agent, "images"), toHost = new PassThrough(), fromHost = new PassThrough();
	const { server } = await runHost({ input: toHost, output: fromHost, pipe, imageDir });

	const requests = [], fetched = [], tabs = new Map(), removed = [];
	let rules = [], tabId = 1;
	const listeners = { message: [], disconnect: [], error: [], click: [], created: [], closedTab: [], detach: [], alarm: [], cdpEvent: [] };
	// browser_act fake page (plan 607b2518 P3-06): AX nodes with boxes; links navigate through the DNR rules, "opens" spawns a tab.
	const node = (id, role, name, tag, box, extra = {}) => ({ id, role, name, tag, box, ...extra });
	const pages = {
		"https://shop.test/act": [
			node(10, "button", "Delete item", "button", [10, 300, 80, 20]), node(11, "heading", "Shop", "h1", [10, 5, 100, 30]), node(12, "button", "Save", "button", [10, 50, 60, 20]),
			node(13, "textbox", "Password", "input", [10, 80, 100, 20], { type: "password" }), node(14, "link", "Away", "a", [10, 110, 40, 20], { href: "https://away.test/" }),
			node(15, "link", "Popup", "a", [60, 110, 40, 20], { opens: "https://pop.test/" }), node(16, "combobox", "Country", "select", [10, 140, 100, 20], { options: ["BG", "US"], value: "BG" }),
			node(17, "textbox", "Search", "input", [10, 170, 100, 20]), node(21, "button", "Ask", "button", [10, 200, 40, 20], { dialog: "confirm" }),
			node(22, "button", "Add image", "button", [10, 230, 60, 20], { chooser: 23 }), node(24, "button", "Photo", "input", [10, 260, 100, 20], { type: "file" }), node(18, "link", "Hidden menu", "a", undefined), node(19, "generic", "wrapper", "div", [0, 0, 800, 600]),
		],
		"https://away.test/": [node(20, "heading", "Away", "h1", [10, 5, 100, 30])],
	};
	const cdpLog = [], dialogsHandled = [], typed = [], uploaded = [], alarms = new Map(), attached = new Set();
	const nodesOf = tabId => pages[tabs.get(tabId)?.url] ?? [];
	const findNode = (tabId, id) => { const n = nodesOf(tabId).find(entry => entry.id === id); if (!n) throw new Error("No node with given id found"); return n; };
	const ax = n => ({ nodeId: String(n.id), ignored: n.role === "generic", role: { value: n.role }, name: { value: n.name }, backendDOMNodeId: n.id, ...(n.value ? { value: { value: n.value } } : {}) });
	const at = (tabId, x, y) => nodesOf(tabId).find(n => n.box && n.role !== "generic" && x >= n.box[0] && x <= n.box[0] + n.box[2] && y >= n.box[1] && y <= n.box[1] + n.box[3]);
	let focused, hang = false, intercept = false;
	const sendCommand = async ({ tabId }, method, params = {}) => {
		if (!attached.has(tabId)) throw new Error("Debugger is not attached to the tab");
		cdpLog.push(method);
		const objectNode = () => findNode(tabId, Number(String(params.objectId).slice(1)));
		switch (method) {
			case "Accessibility.getFullAXTree": return { nodes: nodesOf(tabId).map(ax) };
			case "Accessibility.getPartialAXTree": return { nodes: [ax(findNode(tabId, params.backendNodeId))] };
			case "DOM.getBoxModel": { const b = findNode(tabId, params.backendNodeId).box; if (!b) throw new Error("Could not compute box model."); const [x, y, w, h] = b; return { model: { border: [x, y, x + w, y, x + w, y + h, x, y + h] } }; }
			case "DOM.resolveNode": return { object: { objectId: `o${findNode(tabId, params.backendNodeId).id}` } };
			case "DOM.describeNode": return { node: { backendNodeId: objectNode().id } };
			case "DOM.getNodeForLocation": { const n = at(tabId, params.x, params.y); if (!n) throw new Error("No node found at given location"); return { backendNodeId: n.id }; }
			case "Page.handleJavaScriptDialog": dialogsHandled.push(params.accept); return {};
			case "Page.setInterceptFileChooserDialog": intercept = params.enabled; return {};
			case "DOM.setFileInputFiles": uploaded.push([params.backendNodeId, params.files]); return {};
			case "DOM.focus": focused = params.backendNodeId; return {};
			case "Input.insertText": typed.push([findNode(tabId, focused).name, params.text]); return {};
			case "Input.dispatchKeyEvent": if (params.type === "keyDown") typed.push([findNode(tabId, focused).name, params.key]); return {};
			case "Input.dispatchMouseEvent": {
				const n = params.type === "mouseReleased" && at(tabId, params.x, params.y);
				if (n) typed.push([n.name, "click"]);
				if (n?.chooser && intercept) listeners.cdpEvent.forEach(f => f({ tabId }, "Page.fileChooserOpened", { backendNodeId: n.chooser, mode: "selectMultiple" }));
				if (n?.dialog) listeners.cdpEvent.forEach(f => f({ tabId }, "Page.javascriptDialogOpening", { type: n.dialog, message: "Really?" }));
				if (n?.href) navigate(tabs.get(tabId), n.href);
				if (n?.opens) { const tab = { id: 900 + tabs.size, url: "", pendingUrl: n.opens, openerTabId: tabId, status: "loading" }; tabs.set(tab.id, tab); listeners.created.forEach(f => f(tab)); }
				return {};
			}
			case "Runtime.callFunctionOn": {
				const n = objectNode(), fn = params.functionDeclaration;
				if (fn.startsWith("function elementFacts")) return { result: { value: { tag: n.tag, type: n.type ?? "", autocomplete: "", isSubmit: false, formPayment: false, formSubmitNames: [] } } };
				if (fn.startsWith("function clickable")) return { result: { objectId: params.objectId } };
				if (fn.startsWith("function pickOption")) { const value = params.arguments[0].value; if (!n.options?.includes(value)) return { result: { value: `no option "${value}"` } }; n.value = value; return { result: { value: "" } }; }
				return { result: {} };
			}
			case "Runtime.evaluate": return { result: { value: params.expression.includes("iframe") ? ["https://ads.test/f"] : undefined } };
			case "Page.captureScreenshot": if (hang) return new Promise(() => {}); return { data: Buffer.from([137, 80, 78, 71]).toString("base64") };
			default: return {};
		}
	};

	const redirects = { "https://shop.test/go": "https://other.test/page", "https://shop.test/loop": "https://mail.google.com/" };
	const domainHit = (host, list) => list?.some(d => host === d || host.endsWith(`.${d}`));
	const decide = (tab, url) => {
		const host = hostOf(url);
		const hits = rules.filter(r => (!r.condition.tabIds || r.condition.tabIds.includes(tab)) && (!r.condition.resourceTypes || r.condition.resourceTypes.includes("main_frame"))
			&& (!r.condition.regexFilter || new RegExp(r.condition.regexFilter).test(url)) && (!r.condition.requestDomains || domainHit(host, r.condition.requestDomains)));
		hits.sort((a, b) => b.priority - a.priority);
		return hits[0]?.action.type ?? "allow";
	};
	const navigate = (tab, url, push = true) => {
		if (push) (tab.history ??= []).push(tab.url);
		for (let hop = url; ;) {
			if (decide(tab.id, hop) === "block") { Object.assign(tab, { url: hop, status: "complete" }); setTimeout(() => listeners.error.forEach(f => f({ tabId: tab.id, type: "main_frame", url: hop, error: "net::ERR_BLOCKED_BY_CLIENT" }))); return; }
			requests.push(hop);
			if (!redirects[hop]) { Object.assign(tab, { url: hop, status: hop.includes("slow.test") ? "loading" : "complete" }); return; }
			hop = redirects[hop];
		}
	};
	const chrome = {
		runtime: {
			id: "testextension",
			connectNative: () => {
				(async () => { for await (const m of frames(fromHost)) listeners.message.forEach(f => f(m)); })();
				return { postMessage: m => toHost.write(frame(m)), onMessage: { addListener: f => listeners.message.push(f) }, onDisconnect: { addListener: f => listeners.disconnect.push(f) } };
			},
			onStartup: { addListener() {} }, onInstalled: { addListener() {} },
		},
		tabs: {
			create: async ({ url }) => { const tab = { id: tabId++, url, status: "complete" }; tabs.set(tab.id, tab); return tab; },
			update: async (id, { url }) => { if (url) navigate(tabs.get(id), url); return tabs.get(id); },
			get: async id => { if (!tabs.has(id)) throw new Error("no tab"); return { ...tabs.get(id) }; },
			remove: async id => { tabs.delete(id); removed.push(id); },
			onRemoved: { addListener: f => listeners.closedTab.push(f) },
			onCreated: { addListener: f => listeners.created.push(f) },
			query: async () => [{ id: 0, windowId: 1, index: 0 }],
			group: async () => 7,
			goBack: async id => { const tab = tabs.get(id), previous = tab.history?.pop(); if (!previous) throw new Error("no history"); navigate(tab, previous, false); },
		},
		tabGroups: { query: async () => [], update: async () => {} },
		debugger: {
			attach: async ({ tabId }) => { attached.add(tabId); },
			detach: async ({ tabId }) => { attached.delete(tabId); },
			sendCommand,
			onDetach: { addListener: f => listeners.detach.push(f) },
			onEvent: { addListener: f => listeners.cdpEvent.push(f) },
		},
		scripting: {
			executeScript: async ({ target, func }) => {
				const tab = tabs.get(target.tabId), host = hostOf(tab.url);
				if (func.name !== "extract") return [{ result: `Shop ${host}` }];
				return [{ result: { url: tab.url, title: `Title ${host}`, text: `Hello from ${host}`, links: [{ text: "Next", href: `https://${host}/next` }],
					images: ["https://shop.test/a.jpg", "https://cdn.test/b.png", "https://mail.google.com/x.png", "http://127.0.0.1/y.png", "https://cdn.test/page.html"] } }];
			},
		},
		declarativeNetRequest: { updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => { rules = [...rules.filter(r => !removeRuleIds.includes(r.id)), ...addRules]; } },
		webRequest: { onErrorOccurred: { addListener: f => listeners.error.push(f) } },
		action: { onClicked: { addListener: f => listeners.click.push(f) }, setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
		storage: { local: { get: async () => ({}), set: async () => {} } },
		alarms: { create: (name, info) => { if (info?.when) alarms.set(name, info.when); }, clear: name => alarms.delete(name), onAlarm: { addListener: f => listeners.alarm.push(f) } },
	};
	const fakeFetch = async (url, init) => {
		fetched.push({ url, credentials: init.credentials, redirect: init.redirect });
		const html = url.endsWith(".html");
		return new Response(html ? "<p>" : new Uint8Array([1, 2, 3]), { headers: { "content-type": html ? "text/html" : "image/png" } });
	};
	const worker = vm.createContext({ chrome, fetch: fakeFetch, AbortSignal, AbortController, setTimeout, clearTimeout, URL, btoa, console });
	const load = name => vm.runInContext(readFileSync(new URL(`../browser-fetch/extension/${name}`, import.meta.url), "utf8"), worker, { filename: name });
	worker.importScripts = load;
	load("background.js");

	const dns = async host => [{ address: host === "private.test" ? "10.0.0.5" : "93.184.216.34" }];
	const quiet = { cwd: agent, hasUI: false };

	// browser_act through the real host and the real add-on code (control.js) with the fake debugger (P3-06).
	async function controlRoundTrip() {
		const act = await import("../extensions/browser-act.ts");
		const until = Date.now() + 600_000;
		await updatePolicy(p => { p.control["shop.test"] = { until }; });
		let picks = [];
		const ctx = { cwd: agent, hasUI: true, ui: { notify() {}, select: async (_title, labels) => { const want = picks.shift(); return want && labels.find(l => l.startsWith(want)); } } };
		const go = p => act.browserAct(ctx, p, undefined, { resolve: dns });
		const refOf = (snap, name) => snap.match(new RegExp(`\\[(e\\d+)\\] \\w+ "${name}"`))[1];
		const agentTab = () => [...tabs.values()].find(tab => attached.has(tab.id));
		try {
			assert.match(await go({ action: "open", url: "https://shop.test/act" }), /URL: https:\/\/shop\.test\/act/);
			const tab = agentTab();
			assert.ok(tab, "the debugger is attached to the agent tab (D4)");
			assert.equal([...alarms.entries()].find(([name]) => name.startsWith("control:"))[1], until, "the deadline alarm matches the grant (D20)");
			let snap = await go({ action: "snapshot" });
			const lines = snap.split("\n").filter(line => line.startsWith("["));
			assert.deepEqual(lines.slice(0, 3), ['[e1] heading "Shop" @(10,5 100x30)', '[e2] button "Save" @(10,50 60x20)', '[e3] textbox "Password" @(10,80 100x20)'], "sorted by position (D22)");
			assert.match(snap, /\[e\d+\] combobox "Country" = "BG"/);
			assert.match(snap, /\[frame\] https:\/\/ads\.test\/f/);
			assert.ok(!/Hidden menu|wrapper/.test(snap), "boxless and ignored nodes are dropped");
			// Click, type, select, password refusal, risky confirm.
			await go({ action: "click", ref: refOf(snap, "Save") }); // same page: the refs below stay valid
			await assert.rejects(go({ action: "type", ref: refOf(snap, "Password"), text: "hunter2" }), /password/);
			await go({ action: "type", ref: refOf(snap, "Search"), text: "shoes", submit: true });
			snap = await go({ action: "snapshot" });
			await go({ action: "select", ref: refOf(snap, "Country"), value: "US" });
			snap = await go({ action: "snapshot" });
			assert.match(snap, /combobox "Country" = "US"/);
			await assert.rejects(go({ action: "select", ref: refOf(snap, "Country"), value: "XX" }), /no option "XX"/);
			snap = await go({ action: "snapshot" });
			picks = ["Deny"];
			await assert.rejects(go({ action: "click", ref: refOf(snap, "Delete item") }), /did not allow/);
			picks = ["Allow this action"];
			await go({ action: "click", x: 20, y: 305 });
			assert.deepEqual(typed, [["Save", "click"], ["Search", "shoes"], ["Search", "Enter"], ["Delete item", "click"]], "only allowed actions reach the page");
			await assert.rejects(go({ action: "click", x: 700, y: 700 }), /Nothing at \(700, 700\)/);
			// Upload: only real images inside the project folder, each confirmed; a button's file picker is intercepted.
			mkdirSync(path.join(agent, "img"), { recursive: true });
			const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]), outside = path.join(os.tmpdir(), `outside-${randomUUID()}.png`);
			writeFileSync(path.join(agent, "img", "a.png"), png); writeFileSync(path.join(agent, "img", "fake.png"), "not an image"); writeFileSync(outside, png);
			snap = await go({ action: "snapshot" });
			const add = refOf(snap, "Add image"), image = realpathSync(path.join(agent, "img", "a.png"));
			await assert.rejects(go({ action: "upload", ref: add, files: [path.relative(agent, outside)] }), /outside the project folder/);
			rmSync(outside);
			await assert.rejects(go({ action: "upload", ref: add, files: ["img/fake.png"] }), /does not contain the image/);
			await assert.rejects(go({ action: "upload", ref: add, files: ["notes.txt"] }), /does not exist|not a PNG/);
			picks = ["Deny"];
			await assert.rejects(go({ action: "upload", ref: add, files: ["img/a.png"] }), /did not allow: upload 1 image/);
			picks = ["Allow this action"];
			await go({ action: "upload", ref: add, files: ["img/a.png"] });
			picks = ["Allow this action"];
			await go({ action: "upload", ref: refOf(snap, "Photo"), files: ["img/a.png"] });
			assert.deepEqual(uploaded, [[23, [image]], [24, [image]]], "the picker's input, then the file field, get the checked file");
			assert.equal(intercept, false, "the file picker is no longer intercepted afterwards");
			// D18: a link to another site is stopped before any request; approval needs a repeat, which then loads.
			snap = await go({ action: "snapshot" });
			picks = ["Allow control of away.test for 10 minutes"];
			assert.match(await go({ action: "click", ref: refOf(snap, "Away") }), /URL: https:\/\/shop\.test\/act[\s\S]*repeat the action/);
			assert.ok(!requests.includes("https://away.test/"), "the blocked navigation got no request");
			snap = await go({ action: "snapshot" });
			assert.match(await go({ action: "click", ref: refOf(snap, "Away") }), /URL: https:\/\/away\.test\//);
			assert.ok(requests.includes("https://away.test/"));
			assert.match(await go({ action: "back" }), /URL: https:\/\/shop\.test\/act/);
			// Page dialogs: confirm is cancelled and reported; beforeunload (leaving) is accepted.
			snap = await go({ action: "snapshot" });
			assert.match(await go({ action: "click", ref: refOf(snap, "Ask") }), /dialog, which was cancelled \(UNTRUSTED text\): confirm: Really\?/);
			listeners.cdpEvent.forEach(f => f({ tabId: tab.id }, "Page.javascriptDialogOpening", { type: "beforeunload", message: "" }));
			await sleep(20);
			assert.deepEqual(dialogsHandled, [false, true]);
			// D19: a spawned tab is closed and reported.
			snap = await go({ action: "snapshot" });
			const closedBefore = removed.length;
			assert.match(await go({ action: "click", ref: refOf(snap, "Popup") }), /new tab for https:\/\/pop\.test\/; it was closed/);
			assert.equal(removed.length, closedBefore + 1);
			// Scroll, stale ref, screenshot saved by the host (D10).
			assert.match(await go({ action: "scroll", direction: "down" }), /Done/);
			const shot = (await go({ action: "screenshot" })).match(/saved: (.+\.png)/)[1];
			assert.deepEqual([...readFileSync(shot)], [137, 80, 78, 71]);
			assert.ok(shot.startsWith(imageDir));
			// A hung CDP call (frozen tab) fails that action and frees the queue for the next one.
			vm.runInContext("ACT_MS = 300", worker);
			hang = true;
			await assert.rejects(go({ action: "screenshot" }), /did not respond within 0\.3 s/);
			hang = false;
			vm.runInContext("ACT_MS = 45_000", worker);
			assert.match(await go({ action: "snapshot" }), /\[e1\] heading "Shop"/);
			assert.ok(cdpLog.includes("Page.setWebLifecycleState"), "the tab is woken before acting");
			// D15: another socket cannot steer this session; its own session fails closed on changed facts (D16).
			const other = net.connect(pipe), answers = [];
			await new Promise(resolve => other.once("connect", resolve));
			other.setEncoding("utf8");
			other.on("data", chunk => answers.push(...chunk.trim().split("\n").map(line => JSON.parse(line))));
			const cdpBefore = cdpLog.length, sid = [...alarms.keys()].find(name => name.startsWith("control:")).slice(8);
			other.write(`${JSON.stringify({ type: "act", id: sid, seq: 1, action: "snapshot", hosts: ["shop.test"], blocked: [], until })}\n`);
			other.write(`${JSON.stringify({ type: "control-close", id: sid })}\n`);
			other.write(`${JSON.stringify({ type: "control-open", id: "other-1" })}\n`);
			other.write(`${JSON.stringify({ type: "act", id: "other-1", seq: 1, action: "open", url: "https://shop.test/act", hosts: ["shop.test"], blocked: [], until })}\n`);
			other.write(`${JSON.stringify({ type: "act", id: "other-1", seq: 2, action: "click", phase: "execute", x: 20, y: 55, facts: { name: "Save" }, hosts: ["shop.test"], blocked: [], until })}\n`);
			await sleep(1500);
			assert.ok(!answers.some(m => m.id === sid), "a foreign socket gets nothing for this session");
			assert.ok(tabs.has(tab.id), "a foreign control-close is ignored");
			assert.match(answers.find(m => m.id === "other-1" && m.seq === 2)?.error ?? "", /changed since it was checked/);
			assert.ok(cdpLog.length > cdpBefore);
			// The owner socket closing ends its session in the browser (D15).
			const otherTab = [...tabs.values()].find(t => attached.has(t.id) && t.id !== tab.id).id;
			other.destroy();
			await sleep(200);
			assert.ok(!tabs.has(otherTab) && !attached.has(otherTab), "disconnect closes the session's tab");
			// The deadline alarm, the pause button, the debugger bar and closing the tab each end control (D20, R15).
			const ends = [
				[() => listeners.alarm.forEach(f => f({ name: [...alarms.keys()].find(name => name.startsWith("control:")) })), /grant expired/],
				[async () => { for (const click of listeners.click) await click(); }, /paused/],
				[() => listeners.detach.forEach(f => f({ tabId: agentTab().id }, "target_closed")), /detached the debugger \(target_closed/],
				[() => listeners.closedTab.forEach(f => f(agentTab().id)), /agent tab was closed/],
			];
			for (const [end, why] of ends) {
				if (!agentTab()) await go({ action: "open", url: "https://shop.test/act" });
				const id = agentTab().id;
				await end();
				await sleep(100);
				assert.ok(!attached.has(id) && removed.includes(id), `${why}: tab closed and debugger detached`);
				await assert.rejects(go({ action: "snapshot" }), /no page is open/);
				assert.match(readFileSync(bf.logFile(), "utf8"), why);
				if (/paused/.test(String(why))) {
					await assert.rejects(go({ action: "open", url: "https://shop.test/act" }), /paused/i);
					for (const click of listeners.click) await click();
				}
			}
			assert.equal([...alarms.keys()].filter(name => name.startsWith("control:")).length, 0, "no deadline alarm outlives its session");
			// Pi closing the session closes the tab.
			await go({ action: "open", url: "https://shop.test/act" });
			const last = agentTab().id;
			act.closeSession();
			await sleep(100);
			assert.ok(!tabs.has(last), "control-close closes the tab");
		} finally {
			act.closeSession();
			await updatePolicy(p => { p.control = {}; });
		}
	}
	const run = (ctx, params, signal) => bf.browserFetch(ctx, params, signal, { resolve: dns });
	try {
		await updatePolicy(p => { p.grants["shop.test"] = { until: null }; });
		// Images: page host with cookies, other host without, blocked and private image hosts never fetched (Q-02, D10).
		const page = await run(quiet, { url: "https://www.shop.test/p", images: true });
		assert.equal(page.finalUrl, "https://www.shop.test/p");
		assert.match(page.text, /Hello from www\.shop\.test/);
		assert.deepEqual(fetched.map(f => [f.url, f.credentials, f.redirect]), [["https://shop.test/a.jpg", "include", "error"], ["https://cdn.test/b.png", "omit", "error"], ["https://cdn.test/page.html", "omit", "error"]]);
		assert.equal(page.images.length, 2);
		assert.equal(page.skipped, 3, "blocked host, private address and a non-image skipped");
		assert.deepEqual([...readFileSync(page.images[0].path)], [1, 2, 3]);
		assert.match(bf.formatResult(page, true), /^UNTRUSTED[\s\S]*Images saved \(2, 3 skipped\)/);
		assert.match(bf.formatResult(page, false), /set images: true/);
		assert.equal(removed.length, 1, "agent tab closed");

		// Redirect to an unapproved site without UI: refused, and the destination got no request (D12).
		await assert.rejects(run(quiet, { url: "https://shop.test/go" }), /redirect to https:\/\/other\.test\/page: not approved/);
		assert.ok(requests.includes("https://shop.test/go") && !requests.includes("https://other.test/page"), "denied redirect gets no request");
		// Redirect to a blocked site is refused even if asked.
		await assert.rejects(run(quiet, { url: "https://shop.test/loop" }), /block list/);
		assert.ok(!requests.some(url => url.includes("mail.google.com")));
		// Refused before any browser work: private DNS, block list.
		await assert.rejects(run(quiet, { url: "https://private.test/" }), /private address 10\.0\.0\.5/);
		await assert.rejects(run(quiet, { url: "https://mail.google.com/" }), /block list/);

		// Approval dialog (native list fallback): once, shared grants, deny, block (R2, D8, D13).
		let asked = 0, wait;
		const answer = label => ({ cwd: agent, hasUI: true, ui: { notify() {}, select: async (_title, labels) => { asked++; await wait; return labels.find(l => l.startsWith(label)); } } });
		const once = await run(answer("Allow this request once"), { url: "https://shop.test/go" });
		assert.equal(once.finalUrl, "https://other.test/page");
		assert.ok(requests.includes("https://other.test/page"));
		assert.equal(asked, 1);
		assert.equal(granted(readPolicy(), "other.test"), false, "allow once stores no grant");
		let release; wait = new Promise(r => { release = r; }); asked = 0;
		const both = Promise.all([run(answer("Allow new.test for 1 hour"), { url: "https://new.test/a" }), run(answer("Allow new.test for 1 hour"), { url: "https://new.test/b" })]);
		await new Promise(r => setTimeout(r, 50)); release(); await both;
		assert.equal(asked, 1, "parallel requests to one host share the question");
		assert.ok(readPolicy().grants["new.test"].until > Date.now() + 3_500_000);
		wait = new Promise(r => { release = r; }); asked = 0;
		const twice = Promise.all([run(answer("Allow this request once"), { url: "https://once.test/a" }), run(answer("Allow this request once"), { url: "https://once.test/b" })]);
		await new Promise(r => setTimeout(r, 50)); release(); await twice;
		assert.equal(asked, 2, "allow once is not reused by a concurrent request");
		wait = undefined;
		await assert.rejects(run(answer("Deny"), { url: "https://no.test/" }), /denied by the user/);
		await assert.rejects(run({ cwd: agent, hasUI: true, ui: { select: async () => undefined } }, { url: "https://no.test/" }), /denied/, "unanswered counts as deny");
		await assert.rejects(run(answer("Block no.test"), { url: "https://no.test/" }), /blocked by the user/);
		assert.ok(readPolicy().blocked.includes("no.test"));
		await assert.rejects(run(answer("Allow this request once"), { url: "https://no.test/" }), /block list/);

		// Cancel mid-request closes the tab; pause cancels the running request and refuses new ones (D15, R7).
		const controller = new AbortController(), closedBefore = removed.length;
		const slow = run(quiet, { url: "https://shop.test/slow.test" }, controller.signal);
		await sleep(300);
		controller.abort();
		await assert.rejects(slow, /cancelled/);
		await sleep(100);
		assert.equal(removed.length, closedBefore + 1, "cancel closes the agent tab");
		const paused = run(quiet, { url: "https://shop.test/slow.test" });
		await sleep(300);
		for (const click of listeners.click) await click();
		await assert.rejects(paused, /Paused by the user/);
		await assert.rejects(run(quiet, { url: "https://shop.test/p" }), /Paused by the user/);
		for (const click of listeners.click) await click();
		// A Pi that disconnects mid-request cancels it in the browser.
		const socket = net.connect(pipe), closedNow = removed.length;
		await new Promise(resolve => socket.once("connect", resolve));
		socket.write(`${JSON.stringify({ type: "fetch", id: "gone-1", url: "https://shop.test/slow.test", hosts: ["shop.test"], blocked: [] })}\n`);
		await sleep(300);
		socket.destroy();
		await sleep(200);
		assert.equal(removed.length, closedNow + 1, "disconnect cancels the request");
		const log = readFileSync(bf.logFile(), "utf8").trim().split("\n").map(line => JSON.parse(line));
		assert.ok(log.some(entry => entry.outcome === "ok" && entry.finalUrl === "https://other.test/page"));
		assert.ok(log.some(entry => entry.outcome === "refused" && /not approved/.test(entry.by)));

		await controlRoundTrip();
	} finally {
		toHost.end();
		await sleep(100);
		assert.equal(server.listening, false, "the host stops serving when the browser closes");
	}
	process.env.PI_BROWSER_FETCH_PIPE = `${pipe}-none`;
	await assert.rejects(run(quiet, { url: "https://shop.test/p" }), /browser is not connected/);
	assert.equal(extensionId(readFileSync(new URL("../browser-fetch/extension/manifest.json", import.meta.url), "utf8").match(/"key": "([^"]+)"/)[1]), "dmbpeaidhpenhihgngkgekaieninaapk");
	assert.ok(existsSync(imageDir));
}
// browser_act Pi side (plan 607b2518 P2-06) against a fake add-on on a test pipe: grants, blocks, D16 checks, D17 validation, D18/D19, log.
async function actPiSide() {
	const act = await import("../extensions/browser-act.ts");
	const pipe = process.platform === "win32" ? String.raw`\\.\pipe\pi-browser-act-test-` + randomUUID() : path.join(agent, "act.sock");
	process.env.PI_BROWSER_FETCH_PIPE = pipe;
	const got = [], sockets = [], facts = {
		e1: { tag: "button", role: "button", name: "Save" }, e2: { tag: "button", role: "button", name: "Delete repository" },
		e3: { tag: "input", role: "textbox", name: "Password", type: "password" }, e4: { tag: "input", role: "textbox", name: "Code", autocomplete: "one-time-code" },
		e5: { tag: "a", role: "link", name: "Elsewhere" }, e6: { tag: "a", role: "link", name: "Docs" }, e7: { tag: "input", role: "textbox", name: "Comment" },
		e9: { tag: "button", role: "button", name: "Next", isSubmit: true, formPayment: true },
	};
	let page = "https://shop.test/";
	const server = net.createServer(socket => {
		sockets.push(socket);
		let buffer = "";
		socket.on("data", chunk => {
			buffer += chunk;
			for (let end; (end = buffer.indexOf("\n")) >= 0;) {
				const line = buffer.slice(0, end);
				buffer = buffer.slice(end + 1);
				let m;
				try { m = JSON.parse(line); } catch { assert.fail(`Pi sent a malformed line: ${line}`); }
				got.push(m);
				if (m.type !== "act") continue;
				const reply = extra => socket.write(`${JSON.stringify({ type: "result", id: m.id, seq: m.seq, url: page, title: "T", ...extra })}\n`);
				if (m.action === "open") { page = m.url; reply(); }
				else if (m.action === "snapshot") reply({ items: [{ ref: "e1", role: "button", name: "Save", x: 1, y: 2, w: 3, h: 4 }, { ref: "e2", role: "button", name: "Delete repository", x: 1, y: 9, w: 3, h: 4 }, { ref: "e7", role: "textbox", name: "Comment", value: "hi", x: 1, y: 20, w: 3, h: 4 }], frames: ["https://ads.test/f"] });
				else if (m.phase === "inspect") reply({ facts: { ...(m.ref ? facts[m.ref] : { tag: "button", role: "button", name: "Pay now" }), url: page } });
				else if (m.action === "click" && m.ref === "e5") reply({ blocked: ["https://other.test/x"] });
				else if (m.action === "click" && m.ref === "e6") reply({ spawned: ["https://docs.test/"] });
				else if (m.action === "back") { page = "https://evil.test/"; reply(); }
				else if (m.action === "screenshot") reply({ path: "shot.png" });
				else reply();
			}
		});
	});
	await new Promise(resolve => server.listen(pipe, resolve));
	const dns = async () => [{ address: "93.184.216.34" }];
	let picks = [];
	const ctx = { cwd: agent, hasUI: true, ui: { notify() {}, select: async (_title, labels) => { const want = picks.shift(); return want && labels.find(l => l.startsWith(want)); } } };
	const run = (p, c = ctx) => act.browserAct(c, p, undefined, { resolve: dns });
	const executed = () => got.filter(m => m.phase === "execute").map(m => m.ref ?? `${m.x},${m.y}`);
	try {
		// D17 validation before anything reaches the browser.
		for (const [p, why] of [[{ action: "fly" }, /unknown action/], [{ action: "click" }, /ref, or x and y/], [{ action: "click", ref: "e1", x: 1, y: 2 }, /not both/],
			[{ action: "type", ref: "e1" }, /ref and text/], [{ action: "snapshot", url: "x" }, /does not take url/], [{ action: "scroll" }, /direction/], [{ action: "find" }, /query/]]) await assert.rejects(run(p), why);
		assert.equal(got.length, 0);
		await assert.rejects(run({ action: "snapshot" }), /no page is open/);
		// Blocked and local sites never ask; no grant without UI; denial; grant choices are 10/20/30 minutes only.
		await assert.rejects(run({ action: "open", url: "https://e-fibank.bg/" }), /block list/);
		await assert.rejects(run({ action: "open", url: "http://127.0.0.1/" }), /private/);
		await assert.rejects(run({ action: "open", url: "https://shop.test/" }, { cwd: agent, hasUI: false }), /not approved/);
		let labels;
		await assert.rejects(run({ action: "open", url: "https://shop.test/" }, { cwd: agent, hasUI: true, ui: { select: async (_t, l) => { labels = l; return "Deny"; } } }), /denied/);
		assert.deepEqual(labels, ["Allow control of shop.test for 10 minutes", "Allow control of shop.test for 20 minutes", "Allow control of shop.test for 30 minutes", "Deny"]);
		assert.equal(got.length, 0, "nothing reaches the browser before a grant");
		picks = ["Allow control of shop.test for 10 minutes"];
		assert.match(await run({ action: "open", url: "https://shop.test/" }), /URL: https:\/\/shop\.test\//);
		const until = readPolicy().control["shop.test"].until;
		assert.ok(until > Date.now() + 590_000 && until < Date.now() + 610_000);
		assert.deepEqual([got[0].type, got[1].action, got[1].until], ["control-open", "open", until], "the deadline travels with each action (D20)");
		// Parallel calls run in order: the snapshot sees the page the open went to.
		const [, early] = await Promise.all([run({ action: "open", url: "https://shop.test/two" }), run({ action: "snapshot" })]);
		assert.match(early, /URL: https:\/\/shop\.test\/two/);
		// Snapshot and find.
		const snap = await run({ action: "snapshot" });
		assert.match(snap, /^UNTRUSTED[\s\S]*\[e1\] button "Save" @\(1,2 3x4\)[\s\S]*\[e7\] textbox "Comment" = "hi"[\s\S]*\[frame\] https:\/\/ads\.test\/f/);
		assert.match(await run({ action: "find", query: "delete" }), /^\[e2\]/);
		assert.match(await run({ action: "find", query: "save", role: "link" }), /No element matches/);
		// D16/D23: safe click runs; risky asks and a denial never executes; password refused; risky point click asks.
		await run({ action: "click", ref: "e1" });
		picks = ["Deny"];
		await assert.rejects(run({ action: "click", ref: "e2" }), /did not allow: click "Delete repository"/);
		await assert.rejects(run({ action: "type", ref: "e3", text: "hunter2" }), /password or one-time-code/);
		await assert.rejects(run({ action: "type", ref: "e4", text: "123456" }), /password or one-time-code/);
		picks = ["Deny"];
		await assert.rejects(run({ action: "click", x: 900, y: 400 }), /Pay now/);
		picks = ["Deny"];
		await assert.rejects(run({ action: "click", ref: "e9" }), /payment form/);
		picks = ["Allow this action"];
		await run({ action: "click", ref: "e2" });
		assert.deepEqual(executed(), ["e1", "e2"], "only allowed actions reach execute");
		assert.equal(got.find(m => m.phase === "execute" && m.ref === "e2").facts.name, "Delete repository", "execute carries the inspected facts");
		await run({ action: "type", ref: "e7", text: "nice" });
		// D18: a blocked navigation asks for a grant on the new host and tells the agent to repeat; D19: spawned tab reported.
		picks = ["Allow control of other.test for 10 minutes"];
		assert.match(await run({ action: "click", ref: "e5" }), /user approved that site: repeat the action/);
		assert.ok(readPolicy().control["other.test"]);
		assert.match(await run({ action: "click", ref: "e6" }), /new tab for https:\/\/docs\.test\/; it was closed/);
		assert.ok(got.at(-1).hosts.includes("other.test"), "the approved host is allowed on the next action");
		assert.match(await run({ action: "screenshot" }), /saved: shot\.png/);
		assert.match(await run({ action: "find", query: "x" }), /No element matches/, "refs survive actions on the same page");
		await run({ action: "open", url: "https://shop.test/other" });
		await assert.rejects(run({ action: "find", query: "x" }), /no snapshot yet/, "refs expire when the page changes");
		// Revoked grant asks again; denial closes control.
		await updatePolicy(p => { delete p.control["shop.test"]; });
		picks = ["Deny"];
		await assert.rejects(run({ action: "snapshot" }), /denied/);
		await sleep(50);
		assert.equal(got.at(-1).type, "control-close");
		await assert.rejects(run({ action: "snapshot" }), /no page is open/);
		// Tab ending on an unapproved site closes control.
		await run({ action: "open", url: "https://other.test/" });
		await assert.rejects(run({ action: "back" }), /evil\.test\/, which was not approved; control was closed/);
		// The browser ending control (pause, deadline, tab closed) closes the session in Pi.
		await run({ action: "open", url: "https://other.test/" });
		const sid = got.at(-1).id;
		for (const socket of sockets) socket.write(`${JSON.stringify({ type: "closed", id: sid, reason: "paused by the user" })}\n`);
		await sleep(50);
		await assert.rejects(run({ action: "snapshot" }), /no page is open/);
		// Session end closes control (D20).
		const handlers = {}, tools = [];
		act.default({ registerTool: tool => tools.push(tool.name), on: (event, f) => { handlers[event] = f; } });
		await run({ action: "open", url: "https://other.test/" });
		handlers.session_shutdown();
		await sleep(50);
		assert.equal(got.at(-1).type, "control-close");
		// Log: every action, never typed text.
		const log = readFileSync(bf.logFile(), "utf8");
		assert.ok(!log.includes("hunter2") && !log.includes("nice") && !log.includes("123456"), "typed text is never logged");
		const acts = log.trim().split("\n").map(line => JSON.parse(line)).filter(e => e.tool === "browser_act");
		assert.ok(acts.some(e => e.action === "click" && e.name === "Delete repository" && e.by === "confirmed by the user" && e.outcome === "ok"));
		assert.ok(acts.some(e => e.outcome === "refused" && /password/.test(e.by)));
	} finally {
		act.closeSession();
		for (const socket of sockets) socket.destroy();
		server.close();
	}
	// D23 table cases.
	for (const [text, risky] of [["Save", false], ["Delete repository", true], ["Posts", true], ["Postal code help", false], ["Изпрати", true], ["Купи сега", true], ["Search", false], ["Check out", true], ["Ordering", true]])
		assert.equal(act.riskyWords(text), risky, text);
	assert.match(act.judge({ action: "type", ref: "e", text: "1" }, { tag: "input", role: "textbox", name: "Card", autocomplete: "cc-number", url: "" }).ask, /payment field/);
	assert.match(act.judge({ action: "type", ref: "e", text: "1", submit: true }, { tag: "input", role: "textbox", name: "Comment", formSubmitNames: ["Post comment"], url: "" }).ask, /Post comment/);
	assert.deepEqual(act.judge({ action: "select", ref: "e", value: "BG" }, { tag: "select", role: "combobox", name: "Country", url: "" }), {});
	assert.match(act.formatLines(Array.from({ length: 400 }, (_, n) => `[e${n}] button "${"x".repeat(30)}" @(1,1 1x1)`), "use find"), /\n\d+ more elements: use find$/);
}
function hostOf(url) { try { return new URL(url).hostname; } catch { return ""; } }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
