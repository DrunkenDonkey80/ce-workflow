// browser_fetch self-check (plan d8c5ace2): policy, URL checks, approvals, host round trip and the extension's logic with a fake chrome.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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
} finally {
	rmSync(agent, { recursive: true, force: true });
}
