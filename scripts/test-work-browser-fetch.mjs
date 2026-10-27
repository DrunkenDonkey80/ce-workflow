// browser_fetch self-check (plan d8c5ace2): policy, URL checks, approvals, host round trip and the extension's logic with a fake chrome.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
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
const { checkUrl, privateIp, blockedList, readPolicy, updatePolicy, granted, grantKey, blockEntry, dnsCheck, fetchDir, DEFAULT_BLOCKED, extensionId } = bf;

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
		["https://vault.bitwarden.com/", /block list \(bitwarden\.com\)/], ["https://WWW.ABV.BG./", /block list \(abv\.bg\)/], ["not a url", /valid URL/],
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
	assert.deepEqual(readPolicy(), { blocked: [], grants: {} });
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

	// Install copies extension and host out of the package and registers the host per browser (D11).
	const calls = [], installed = await bf.install(async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0 }; }, path.join(agent, "install"));
	assert.equal(installed.id, "dmbpeaidhpenhihgngkgekaieninaapk");
	assert.ok(existsSync(path.join(installed.extension, "background.js")) && existsSync(path.join(agent, "install", "host", "host.mjs")));
	const hostManifest = JSON.parse(readFileSync(installed.manifest, "utf8"));
	assert.deepEqual([hostManifest.name, hostManifest.type, hostManifest.allowed_origins], ["pi.browser_fetch", "stdio", ["chrome-extension://dmbpeaidhpenhihgngkgekaieninaapk/"]]);
	assert.ok(existsSync(hostManifest.path));
	if (process.platform === "win32") assert.deepEqual(calls.map(call => call[2]), bf.BROWSER_KEYS.map(key => `HKCU\\Software\\${key}\\NativeMessagingHosts\\pi.browser_fetch`));
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
	const listeners = { message: [], disconnect: [], error: [], click: [] };
	const redirects = { "https://shop.test/go": "https://other.test/page", "https://shop.test/loop": "https://mail.google.com/" };
	const domainHit = (host, list) => list?.some(d => host === d || host.endsWith(`.${d}`));
	const decide = (tab, url) => {
		const host = hostOf(url);
		const hits = rules.filter(r => (!r.condition.tabIds || r.condition.tabIds.includes(tab)) && (!r.condition.resourceTypes || r.condition.resourceTypes.includes("main_frame"))
			&& (!r.condition.regexFilter || new RegExp(r.condition.regexFilter).test(url)) && (!r.condition.requestDomains || domainHit(host, r.condition.requestDomains)));
		hits.sort((a, b) => b.priority - a.priority);
		return hits[0]?.action.type ?? "allow";
	};
	const navigate = (tab, url) => {
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
			update: async (id, { url }) => { navigate(tabs.get(id), url); return tabs.get(id); },
			get: async id => { if (!tabs.has(id)) throw new Error("no tab"); return { ...tabs.get(id) }; },
			remove: async id => { tabs.delete(id); removed.push(id); },
			onRemoved: { addListener() {} },
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
		alarms: { create() {}, onAlarm: { addListener() {} } },
	};
	const fakeFetch = async (url, init) => {
		fetched.push({ url, credentials: init.credentials, redirect: init.redirect });
		const html = url.endsWith(".html");
		return new Response(html ? "<p>" : new Uint8Array([1, 2, 3]), { headers: { "content-type": html ? "text/html" : "image/png" } });
	};
	vm.runInNewContext(readFileSync(new URL("../browser-fetch/extension/background.js", import.meta.url), "utf8"),
		{ chrome, fetch: fakeFetch, AbortSignal, AbortController, setTimeout, clearTimeout, URL, btoa, console }, { filename: "background.js" });

	const dns = async host => [{ address: host === "private.test" ? "10.0.0.5" : "93.184.216.34" }];
	const quiet = { cwd: agent, hasUI: false };
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
function hostOf(url) { try { return new URL(url).hostname; } catch { return ""; } }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
