import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { assignRefs, findProfile, flatten, line, mobileAct, mobileActTool, onPath, resetSession, resolveDevice, swipePoints } from "../extensions/mobile-act.ts";

const run = promisify(execFile);
const SIM = { id: "SIM-1", name: "iPhone 17", platform: "ios", type: "simulator", state: "online", version: "26.0" };
const OLD = { id: "SIM-2", name: "iPhone 17", platform: "ios", type: "simulator", state: "offline", version: "27.0" };
const AIR = { id: "SIM-3", name: "iPhone Air", platform: "ios", type: "simulator", state: "offline", version: "26.0" };
const PHONE = { id: "0000-REAL", name: "Lorenz’s iPhone", platform: "ios", type: "real", state: "online", version: "27.0" };
const PIXEL = { id: "emulator-5554", name: "Pixel", platform: "android", type: "emulator", state: "online", version: "15" };
const ok = (data) => ({ code: 0, stdout: JSON.stringify({ status: "ok", data }) });
const btn = (label, id, y, extra = {}) => ({ type: "Button", label, identifier: id, rect: { x: 16, y, width: 370, height: 48 }, ...extra });
const home = [
	{ type: "Other", label: "TITLE", identifier: "title", rect: { x: 16, y: 76, width: 234, height: 33 } },
	btn("Local game", "play", 369, { children: [{ type: "StaticText", label: "Local game", rect: { x: 161, y: 385, width: 81, height: 16 } }] }),
	{ type: "TextField", label: "Room code", value: "AB12", rect: { x: 16, y: 500, width: 200, height: 40 } },
	{ type: "Other", rect: { x: 0, y: 0, width: 10, height: 10 } },
	btn("⚙, Settings", "nav_settings", 546),
];

/** Fake mobilecli: `screens` is the sequence of dump ui results; `agent` says whether the helper app is installed. */
function fake({ list = [SIM], screens = [home], agent = true } = {}) {
	const calls = [];
	let shown = 0;
	const exec = async (command, args) => {
		calls.push([command, ...args]);
		if (command === "npm") return { code: 0, stdout: "added 2 packages" };
		if (args[0] === "devices") return ok({ devices: list });
		if (args[0] === "device" && args[1] === "info") return ok({ device: { screenSize: { width: 402, height: 874, scale: 3 } } });
		if (args[0] === "agent" && args[1] === "status") return agent ? ok({ version: "0.0.35" }) : { code: 1, stdout: JSON.stringify({ status: "error", error: "agent not installed" }) };
		if (args[0] === "dump") return ok({ elements: screens[Math.min(shown++, screens.length - 1)] });
		return ok({});
	};
	return { exec, calls, acts: () => calls.filter(c => c[1] === "io" || c[1] === "apps" || c[0] === "npm" || (c[1] === "agent" && c[2] === "install")).map(c => c.slice(1).join(" ")) };
}
const opts = (extra = {}) => ({ hasCli: () => true, sleep: async () => {}, ...extra });

// Flattening: containers without labels vanish, a button's own text child is not repeated; no [disabled] flag (D10).
{
	const els = assignRefs(undefined, flatten(home)).snap.elements;
	assert.deepEqual(els.map(line), [
		'[e1] Other "TITLE" #title @(16,76 234x33)',
		'[e2] Button "Local game" #play @(16,369 370x48)',
		'[e3] TextField "Room code" = "AB12" @(16,500 200x40)',
		'[e4] Button "⚙, Settings" #nav_settings @(16,546 370x48)',
	]);
	const android = [{ type: "android.widget.FrameLayout", identifier: "com.x:id/root", rect: { x: 0, y: 0, width: 360, height: 640 }, children: [
		{ type: "android.widget.TextView", label: "11:15", identifier: "com.x:id/clock", rect: { x: 4, y: 4, width: 47, height: 16 } },
		{ type: "android.widget.Button", label: "", identifier: "com.x:id/go", rect: { x: 0, y: 100, width: 50, height: 50 } },
		{ type: "android.widget.EditText", label: "wifi", value: "wifi", rect: { x: 0, y: 200, width: 300, height: 50 } }] }];
	assert.deepEqual(assignRefs(undefined, flatten(android)).snap.elements.map(line), ['[e1] TextView "11:15" #com.x:id/clock @(4,4 47x16)', '[e2] Button "" #com.x:id/go @(0,100 50x50)', '[e3] EditText "" = "wifi" @(0,200 300x50)'], "Android: short types, bare layouts dropped");
	assert.deepEqual(swipePoints("down", { x: 0, y: 0, width: 100, height: 200 }), [50, 160, 50, 40], "down moves the finger up");
	assert.throws(() => swipePoints("sideways", { x: 0, y: 0, width: 1, height: 1 }), /direction/);
	assert.equal(onPath("node"), true);
	assert.equal(onPath("surely-not-a-binary-xyz"), false);
}

// Stable refs: unchanged elements keep refs, equal keys match the nearest frame, new ones get fresh refs.
{
	const first = assignRefs(undefined, flatten(home));
	const moved = [home[0], { ...home[2], value: "ZZ" }, btn("Local game", "play", 380), btn("Local game", "play", 700), btn("Online", "online", 600)];
	const { snap, added, removed, changed } = assignRefs(first.snap, flatten(moved));
	assert.deepEqual(snap.elements.map(e => e.ref), ["e1", "e3", "e2", "e5", "e6"]);
	assert.deepEqual(added.map(e => e.ref), ["e5", "e6"]);
	assert.deepEqual(removed.map(e => e.ref), ["e4"]);
	assert.deepEqual(changed.map(e => e.ref), ["e3", "e2"], "value and frame changes");
}

// Devices: the only online one by default; names prefer the online device; ambiguity explains itself.
{
	const list = [SIM, OLD, AIR, PIXEL];
	assert.equal((await resolveDevice(fake({ list: [SIM, OLD] }).exec, undefined, true)).id, "SIM-1");
	await assert.rejects(resolveDevice(fake({ list }).exec, undefined, true), /Several devices are online; pass device:\nSIM-1 iPhone 17 \(ios simulator 26.0\)\nemulator-5554/);
	assert.equal((await resolveDevice(fake({ list }).exec, "iPhone 17", true)).id, "SIM-1", "duplicate name -> the online one");
	await assert.rejects(resolveDevice(fake({ list: [OLD, { ...OLD, id: "SIM-9" }] }).exec, "iPhone 17", true), /Several devices are named "iPhone 17"; pass the id/);
	await assert.rejects(resolveDevice(fake({ list }).exec, "iPhone Air", true), /offline; boot it first/);
	await assert.rejects(resolveDevice(fake({ list }).exec, "Nokia", true), /No device "Nokia"/);
}

// Actions map to mobilecli calls; each returns the change list after settleMs.
{
	resetSession();
	const settings = [home[0], btn("Language", "language", 200), home[2], btn("⚙, Settings", "nav_settings", 546)];
	const f = fake({ screens: [home, settings, settings] });
	assert.match(await mobileAct(f.exec, { action: "list" }, opts()), /^SIM-1 ONLINE iPhone 17 \(ios simulator 26.0\)/);
	await assert.rejects(mobileAct(f.exec, { action: "tap", ref: "e4" }, opts()), /No snapshot yet/);
	const snap = await mobileAct(f.exec, { action: "snapshot" }, opts());
	assert.match(snap, /^UNTRUSTED app content/);
	assert.match(snap, /iPhone 17 402x874 points/);
	assert.equal(await mobileAct(f.exec, { action: "find", query: "room" }, opts()), '[e3] TextField "Room code" = "AB12" @(16,500 200x40)');
	const tap = await mobileAct(f.exec, { action: "tap", ref: "e4" }, opts());
	assert.match(tap, /^Done\. Changes \(\+ added, - removed, ~ changed\):\nUNTRUSTED/);
	assert.match(tap, /\+ \[e5\] Button "Language" #language/);
	assert.match(tap, /- \[e2\] Button "Local game"/);
	assert.doesNotMatch(tap, /nav_settings/, "unchanged elements are not repeated");
	assert.equal(await mobileAct(f.exec, { action: "tap", ref: "e5" }, opts()), "Done. No visible change.");
	await mobileAct(f.exec, { action: "tap", x: 10.4, y: 20, settleMs: 0 }, opts());
	await mobileAct(f.exec, { action: "longpress", ref: "e5", durationMs: 1500, settleMs: 0 }, opts());
	await mobileAct(f.exec, { action: "type", ref: "e5", text: "XY", submit: true, settleMs: 0 }, opts());
	await mobileAct(f.exec, { action: "swipe", direction: "down", settleMs: 0 }, opts());
	assert.equal(await mobileAct(f.exec, { action: "button", button: "home", settleMs: 0 }, opts()), "Done.");
	assert.match(await mobileAct(f.exec, { action: "launch", appId: "com.demo" }, opts()), /Launched com.demo/);
	const d = "--device SIM-1";
	assert.deepEqual(f.acts(), [
		`io tap 201,570 ${d}`, `io tap 201,224 ${d}`, `io tap 10,20 ${d}`, `io longpress 201,224 --duration 1500 ${d}`,
		`io tap 201,224 ${d}`, `io fill XY ${d}`, `io keys enter ${d}`, `io swipe 201,699,201,175 ${d}`, `io button HOME ${d}`, `apps launch com.demo ${d}`,
	]);
	assert.equal(f.calls.filter(c => c[1] === "agent").length, 1, "agent status is checked once per device per session");
	assert.equal(f.calls.filter(c => c[1] === "devices").length, 3, "list, one resolve, one more after the failed tap dropped the cached device");
	await assert.rejects(mobileAct(f.exec, { action: "tap", ref: "e99" }, opts()), /Unknown ref e99/);
	await assert.rejects(mobileAct(f.exec, { action: "tap" }, opts()), /needs ref, or x and y/);
	await assert.rejects(mobileAct(f.exec, { action: "launch" }, opts()), /needs appId/);
	const failing = async (c, a) => a[0] === "io" ? { code: 1, stdout: JSON.stringify({ status: "error", error: "device not found: SIM-1" }) } : f.exec(c, a);
	await assert.rejects(mobileAct(failing, { action: "button", button: "home" }, opts()), /mobilecli io button failed: device not found: SIM-1/);
	const full = fake({ screens: [home, [btn("Other screen", "x", 100), btn("More", "y", 200), btn("Yet more", "z", 300)]] });
	resetSession();
	await mobileAct(full.exec, { action: "snapshot" }, opts());
	assert.match(await mobileAct(full.exec, { action: "tap", ref: "e1" }, opts()), /^Done\. The screen changed:\nUNTRUSTED[^]*\[e5\] Button "Other screen"/, "mostly new screen -> full list");
}

// D5 installs: mobilecli only after Yes; simulator agent automatic; real iPhone agent only after Yes.
{
	resetSession();
	const f = fake();
	const asked = [];
	const no = opts({ hasCli: () => false, confirm: async (t) => (asked.push(t), false) });
	await assert.rejects(mobileAct(f.exec, { action: "list" }, no), /mobilecli is not installed\. Install it with: npm install -g mobilecli/);
	assert.deepEqual(asked, ["Install mobilecli?"]);
	await assert.rejects(mobileAct(f.exec, { action: "list" }, opts({ hasCli: () => false })), /Install it with: npm install -g mobilecli/, "no UI: command only");
	assert.deepEqual(f.acts(), [], "nothing installed without a Yes");
	await mobileAct(f.exec, { action: "list" }, opts({ hasCli: () => false, confirm: async () => true }));
	assert.deepEqual(f.acts(), ["install -g mobilecli"]);

	resetSession();
	const sim = fake({ agent: false });
	await mobileAct(sim.exec, { action: "snapshot" }, opts({ confirm: async () => assert.fail("no question for a simulator") }));
	assert.deepEqual(sim.acts(), ["agent install --device SIM-1"]);

	resetSession();
	const real = fake({ list: [PHONE], agent: false });
	await assert.rejects(mobileAct(real.exec, { action: "snapshot" }, opts({ confirm: async () => false })), /not on Lorenz’s iPhone\. Install it with: mobilecli agent install --device 0000-REAL/);
	await assert.rejects(mobileAct(real.exec, { action: "snapshot" }, opts()), /not on Lorenz’s iPhone/, "no UI: never installs on a phone");
	assert.deepEqual(real.acts(), []);
	await assert.rejects(mobileAct(real.exec, { action: "snapshot" }, opts({ confirm: async () => true, profileDirs: [] })), /No development provisioning profile for Lorenz’s iPhone[^]*wildcard App ID \(TEAMID\.\*\)/);
	assert.deepEqual(real.acts(), [], "no profile: nothing installed");
	{
		const dir = await mkdtemp(path.join(os.tmpdir(), "mobile-act-")), now = Date.parse("2026-01-01");
		const plist = (appId, { udid = "0000-REAL", expires = "2027-01-01T00:00:00Z", dev = true } = {}) => `<plist><dict><key>ExpirationDate</key>\n<date>${expires}</date><key>Entitlements</key><dict><key>application-identifier</key>\n<string>${appId}</string>${dev ? "<key>get-task-allow</key>\n<true/>" : ""}</dict><key>ProvisionedDevices</key><array><string>${udid}</string></array></dict></plist>`;
		const files = { "a.mobileprovision": plist("T.*", { udid: "OTHER" }), "b.mobileprovision": plist("T.*", { expires: "2025-01-01T00:00:00Z" }), "c.mobileprovision": plist("T.*", { dev: false }), "d.mobileprovision": plist("T.*"), "e.mobileprovision": plist("T.com.mobilenext.devicekit-iosUITests.xctrunner"), "x.txt": "" };
		for (const [n, body] of Object.entries(files)) await writeFile(path.join(dir, n), body);
		const sec = async (_c, a) => ({ code: 0, stdout: await readFile(a[3], "utf8") });
		assert.equal(await findProfile(sec, "0000-REAL", undefined, [dir], now), path.join(dir, "e.mobileprovision"), "exact App ID beats wildcard");
		await rm(path.join(dir, "e.mobileprovision"));
		assert.equal(await findProfile(sec, "0000-REAL", undefined, [dir, "/nope"], now), path.join(dir, "d.mobileprovision"), "skips other device, expired, non-development");
		const agent = fake({ list: [PHONE], agent: false });
		await mobileAct(async (c, a) => c === "security" ? sec(c, a) : agent.exec(c, a), { action: "snapshot" }, opts({ confirm: async () => true, profileDirs: [dir] }));
		assert.deepEqual(agent.acts(), [`agent install --device 0000-REAL --provisioning-profile ${path.join(dir, "d.mobileprovision")}`]);
		await rm(dir, { recursive: true });
	}
	resetSession();
	const pixel = fake({ list: [PIXEL], agent: false });
	await mobileAct(pixel.exec, { action: "button", button: "back", settleMs: 0 }, opts());
	assert.deepEqual(pixel.acts(), ["io button BACK --device emulator-5554"], "Android needs no agent check");

	const tool = mobileActTool(f.exec);
	assert.equal(tool.name, "mobile_act");
	assert.ok(tool.parameters.properties.action.enum.includes("longpress"));
}

// Live: only with mobilecli on PATH and one online simulator with its agent; reads only, never taps.
if (onPath("mobilecli")) {
	resetSession();
	const exec = async (command, args, { timeout }) => run(command, args, { timeout, maxBuffer: 64 << 20 }).then(r => ({ code: 0, ...r }), e => ({ code: e.code ?? 1, stdout: e.stdout, stderr: e.stderr || e.message }));
	const sims = (await resolveDevice(exec, undefined, true).then(d => [d], () => []));
	const sim = sims.find(d => d.type === "simulator");
	const agent = sim && await run("mobilecli", ["agent", "status", "--device", sim.id]).then(() => true, () => false);
	if (agent) {
		const snap = await mobileAct(exec, { action: "snapshot", device: sim.id }, { confirm: async () => false });
		assert.match(snap, /^UNTRUSTED[^]*\n\[e1\] /, "live snapshot lists elements");
		console.log(`live ${sim.name}: ${snap.split("\n").length - 3} elements`);
	} else console.log("live check skipped: needs exactly one online simulator with the mobilecli agent");
} else console.log("live check skipped: mobilecli is not on PATH");
console.log("mobile_act ok");
