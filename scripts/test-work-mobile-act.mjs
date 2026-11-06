import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readdir } from "node:fs/promises";
import { alertText, assignRefs, gridDiff, gridOf, findProfile, flatten, line, matches, short, mobileAct, mobileActTool, MOBILECLI, resetSession, resolveDevice, swipePoints, visiblePoint, keyboard } from "../extensions/mobile-act.ts";

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

/** Fake mobilecli: `screens` is the sequence of dump ui results; `agent` says whether the helper app is installed; `launches`/`kills` say whether apps launch/terminate really change the app in front. */
function fake({ list = [SIM], screens = [home], agent = true, launches = true, kills = true } = {}) {
	const calls = [];
	let shown = 0;
	const f = { front: "com.apple.springboard" };
	const exec = async (command, args) => {
		calls.push([command, ...args]);
		if (command === "npm") return { code: 0, stdout: "added 2 packages" };
		if (args[0] === "devices") return ok({ devices: list });
		if (args[0] === "device" && args[1] === "info") return ok({ device: { screenSize: { width: 402, height: 874, scale: 3 } } });
		if (args[0] === "agent" && args[1] === "status") return agent ? ok({ version: "0.0.35" }) : { code: 1, stdout: JSON.stringify({ status: "error", error: "agent not installed" }) };
		if (args[0] === "apps" && args[1] === "foreground") return ok({ packageName: f.front });
		if (args[0] === "apps" && args[1] === "launch" && launches) f.front = args[2];
		if (args[0] === "apps" && args[1] === "terminate" && kills) f.front = "com.apple.springboard";
		if (args[0] === "dump") return ok({ elements: screens[Math.min(shown++, screens.length - 1)] });
		return ok({});
	};
	return { exec, calls, app: f, acts: () => calls.filter(c => c[1] === "io" || (c[1] === "apps" && c[2] !== "foreground") || c[0] === "npm" || (c[1] === "agent" && c[2] === "install")).map(c => c.slice(1).join(" ")) };
}
const opts = (extra = {}) => ({ sleep: async () => {}, ...extra });

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
		{ type: "android.widget.TextView", label: "11:15", identifier: "com.android.systemui:id/clock", rect: { x: 4, y: 4, width: 47, height: 16 } },
		{ type: "android.widget.TextView", label: "BELOT", rect: { x: 16, y: 14, width: 200, height: 34 } },
		{ type: "android.widget.Button", label: "", identifier: "com.x:id/go", rect: { x: 0, y: 100, width: 50, height: 50 } },
		{ type: "android.widget.EditText", label: "wifi", value: "wifi", rect: { x: 0, y: 200, width: 300, height: 50 } }] }];
	assert.deepEqual(assignRefs(undefined, flatten(android)).snap.elements.map(line), ['[e1] TextView "BELOT" @(16,14 200x34)', '[e2] Button "" #com.x:id/go @(0,100 50x50)', '[e3] EditText "" = "wifi" @(0,200 300x50)'], "Android: short types, bare layouts and status bar dropped");
	const ios = [{ type: "StaticText", label: "1:42\u202fPM", rect: { x: 37, y: 15, width: 34, height: 20 } }, { type: "Other", identifier: "3 of 3 Wi-Fi bars", rect: { x: 312, y: 19, width: 17, height: 12 } },
		{ type: "Image", label: "Silent Mode", rect: { x: 75, y: 17, width: 15, height: 17 } }, { type: "StaticText", label: "12:30 left", rect: { x: 10, y: 300, width: 80, height: 20 } }];
	assert.deepEqual(flatten(ios).map(e => e.label), ["12:30 left"], "iOS status bar dropped, the same text lower down kept");
	assert.deepEqual(swipePoints("down", { x: 0, y: 0, width: 100, height: 200 }), [50, 160, 50, 40], "down moves the finger up");
	assert.throws(() => swipePoints("sideways", { x: 0, y: 0, width: 1, height: 1 }), /direction/);
	assert.ok(existsSync(MOBILECLI), "the mobilecli npm dependency ships this platform's binary");
}

// Long labels, offscreen pages, retries and one gesture at a time (belot feedback).
{
	assert.equal(short("Read \u{10FBB7}".repeat(1) + "\u{10FBB7}".repeat(3000)), "Read \u{10FBB7}×3001");
	assert.equal(short("x".repeat(5) + "ab".repeat(60)), "xxxxx" + "ab".repeat(37) + "a…(+45)");
	const e = { ref: "e1", type: "Button", label: "Maps", value: "", id: "", frame: { x: 420, y: 100, width: 60, height: 60 } };
	assert.match(line(e, { x: 0, y: 0, width: 402, height: 874 }), /\) offscreen$/);
	assert.doesNotMatch(line({ ...e, frame: { ...e.frame, x: 20 } }, { x: 0, y: 0, width: 402, height: 874 }), /offscreen/);

	resetSession();
	const f = fake();
	let fails = 2;
	const slow = async (c, a) => a[0] === "dump" && fails-- > 0 ? { code: 1, stdout: JSON.stringify({ status: "error", error: "timed out waiting for WebDriverAgent to be ready" }) } : f.exec(c, a);
	assert.match(await mobileAct(slow, { action: "snapshot" }, opts()), /\[e1\]/, "two agent-start timeouts are retried");

	resetSession();
	let busy = 0, overlap = false;
	const gate = async (c, a) => {
		if (a[0] !== "io") return f.exec(c, a);
		if (busy++) overlap = true;
		await new Promise(res => setTimeout(res, 20));
		busy--;
		return ok({});
	};
	await Promise.all([1, 2, 3].map(() => mobileAct(gate, { action: "swipe", direction: "left", settleMs: 0 }, opts())));
	assert.equal(overlap, false, "parallel swipes run one after another");
}

// On-screen keyboard: found by its container ids; a hidden keyboard (below the screen) does not count.
{
	const el = (type, id, y, h) => ({ type, label: "", identifier: id, rect: { x: 0, y, width: 393, height: h } });
	const els = assignRefs(undefined, flatten([el("StaticText", "", 673, 44), el("Other", "SystemInputAssistantView", 516, 45), el("Other", "UIKeyboardLayoutStar Preview", 561, 233)])).snap.elements;
	assert.deepEqual(keyboard(els, 852), { index: 1, top: 516 }, "keyboard top and index");
	assert.equal(keyboard(assignRefs(undefined, flatten([el("Other", "SystemInputAssistantView", 852, 45)])).snap.elements, 852), undefined, "offscreen keyboard ignored");
}

// Overlapped elements: tap the visible strip of a fanned card, not the neighbour on top of its center.
{
	const card = (x) => ({ type: "Image", label: `c${x}`, identifier: "", rect: { x, y: 700, width: 120, height: 170 } });
	const els = assignRefs(undefined, flatten([card(10), card(46), card(82), { type: "Other", label: "table", rect: { x: 0, y: 0, width: 400, height: 900 } }])).snap.elements;
	const [x0, y0] = visiblePoint(els[0], els), [x1] = visiblePoint(els[1], els), [x2] = visiblePoint(els[2], els);
	assert.ok(x0 >= 10 && x0 < 46 && y0 > 700 && y0 < 870, `first card in its own strip: ${x0}`);
	assert.ok(x1 >= 46 && x1 < 82, `middle card in its strip: ${x1}`);
	assert.equal(x2, 142, "top card: center");
	assert.deepEqual(visiblePoint(els[3], els), [200, 450], "different type never covers");
	assert.deepEqual(matches(els, "#nope"), []);
	assert.deepEqual(matches(els, "c4").map(e => e.label), ["c46"], "partial match");
	assert.deepEqual(matches([...els, { ...els[0], label: "c4", ref: "e9" }], "C4").map(e => e.label), ["c4"], "exact beats partial");
	assert.deepEqual(matches([{ ...els[0], label: "On line game" }], "Online game").length, 1, "OCR-split words still match");
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
	assert.match(await mobileAct(f.exec, { action: "launch", appId: "com.demo" }, opts()), /^Launched com\.demo; it is in front\.\nDone\. The screen changed:\nUNTRUSTED[^\n]*\n[^\n]*app in front: com\.demo\n\n\[e1\]/, "launch checks the app in front and returns its first screen");
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

// Checking what really happened: launch/relaunch verify the app in front, another app in front and alerts head the result (Viktor feedback).
{
	resetSession();
	const stuck = fake({ launches: false });
	await assert.rejects(mobileAct(stuck.exec, { action: "launch", appId: "com.demo" }, opts()), /launch did not bring com\.demo to the front: com\.apple\.springboard is in front/);
	resetSession();
	const immortal = fake({ kills: false });
	immortal.app.front = "com.demo";
	await assert.rejects(mobileAct(immortal.exec, { action: "relaunch", appId: "com.demo" }, opts()), /apps terminate did not close com\.demo: it is still in front/);
	assert.deepEqual(immortal.acts(), ["apps terminate com.demo --device SIM-1"], "no launch after a failed terminate");

	resetSession();
	const f = fake({ screens: [home, home] });
	f.app.front = "com.demo";
	assert.match(await mobileAct(f.exec, { action: "snapshot" }, opts()), /^UNTRUSTED[^\n]*\niPhone 17 402x874 points \(tap coordinates use points\), app in front: com\.demo\n/);
	f.app.front = "com.apple.mobilesafari";
	assert.match(await mobileAct(f.exec, { action: "tap", ref: "e1" }, opts()), /^APP CHANGED: com\.apple\.mobilesafari is in front now, not com\.demo \(did it close or crash\?\)\nDone\. The screen changed:/, "same elements, other app: still flagged, full screen");

	const alert = { type: "Alert", label: "Connection Error!", rect: { x: 50, y: 300, width: 300, height: 200 }, children: [
		{ type: "StaticText", label: "Connection Error!", rect: { x: 60, y: 310, width: 280, height: 20 } },
		{ type: "StaticText", label: "Pinpad failed to connect", rect: { x: 60, y: 340, width: 280, height: 40 } },
		{ type: "Button", label: "OK", rect: { x: 60, y: 450, width: 280, height: 40 } }] };
	const withAlert = fake({ screens: [home, [...home, alert]] });
	resetSession();
	await mobileAct(withAlert.exec, { action: "snapshot" }, opts());
	assert.match(await mobileAct(withAlert.exec, { action: "tap", ref: "e2" }, opts()), /^ALERT on screen \(untrusted app text\): "Connection Error!" \| "Pinpad failed to connect" \| "OK"\nDone\. Changes/);
	assert.equal(alertText(assignRefs(undefined, flatten(home)).snap.elements), "", "no alert, no line");
	const dialog = [{ type: "android.widget.TextView", label: "Error", identifier: "android:id/alertTitle", rect: { x: 0, y: 100, width: 300, height: 30 } },
		{ type: "android.widget.Button", label: "OK", identifier: "android:id/button1", rect: { x: 0, y: 200, width: 100, height: 40 } }];
	assert.equal(alertText(assignRefs(undefined, flatten(dialog)).snap.elements), 'ALERT on screen (untrusted app text): "Error" | "OK"');

	// A real iPhone whose helper will not start: no 3x60 s of retries, and a diagnosis.
	resetSession();
	const dead = fake({ list: [PHONE] });
	let dumps = 0, locked = false, stops = 0, staleUntilStop = false, healthy = false, screenText = "";
	const wda = async (c, a) => {
		if (c === "xcrun") return a.includes("lockState") ? { code: 0, stdout: `• passcodeRequired: ${locked}\n` } : { code: 0 };
		if (a[0] === "daemon") { stops++; if (staleUntilStop) healthy = true; return { code: 0 }; }
		if (a[0] === "dump" && !healthy) { dumps++; return { code: 1, stdout: JSON.stringify({ status: "error", error: "failed to start agent: timed out waiting for WebDriverAgent to be ready" }) }; }
		return dead.exec(c, a);
	};
	const po = () => opts({ ocr: async () => screenText ? [{ text: screenText, x: 0, y: 0, w: 1, h: 0.1 }] : [] });
	await assert.rejects(mobileAct(wda, { action: "snapshot" }, po()), /WebDriverAgent to be ready\nThe helper app \(com\.mobilenext\.devicekit-iosUITests\.xctrunner\) probably crashes as it starts[^]*devicectl device capture screenshot --device 0000-REAL/);
	assert.equal(dumps, 2, "real iPhone: no agent-start retries, one more try after the daemon restart");
	assert.equal(stops, 1, "the stale daemon is restarted");
	locked = true;
	await assert.rejects(mobileAct(wda, { action: "snapshot" }, po()), /Lorenz’s iPhone is locked or waiting for its passcode/);
	locked = false;

	// The iOS "Enable UI Automation" passcode prompt after a restart blocks the helper: named, and no daemon restart.
	screenText = "Enter iPhone Passcode for “XCTest” Enable UI Automation";
	stops = 0;
	await assert.rejects(mobileAct(wda, { action: "snapshot" }, po()), /Lorenz’s iPhone shows "Enter iPhone Passcode for “XCTest” Enable UI Automation": iOS asks for the passcode once after each restart/);
	assert.equal(stops, 0);

	// A daemon whose link to the helper went stale: restarted, and the call goes through.
	screenText = "";
	stops = 0; staleUntilStop = true; resetSession();
	assert.match(await mobileAct(wda, { action: "snapshot" }, po()), /^\(Restarted the mobilecli daemon: its link to the helper on Lorenz’s iPhone had gone stale\. Other devices reconnect on their next call\.\)\nUNTRUSTED/);
	assert.equal(stops, 1);
}

// Test loops (Viktor torture run): guarded waits, checkpoints, crash watch, breaker.
{
	const dir = await mkdtemp(path.join(os.tmpdir(), "mobile-act-cp-")), reports = path.join(dir, "reports");
	await run("mkdir", ["-p", reports]);
	const o = (extra = {}) => opts({ dir, reportsDir: reports, ...extra });
	const alert = { type: "Alert", label: "Connection Error!", rect: { x: 50, y: 300, width: 300, height: 200 }, children: [{ type: "Button", label: "OK", rect: { x: 60, y: 450, width: 280, height: 40 } }] };
	const connected = [...home, { type: "StaticText", label: "Beep upon scan", rect: { x: 16, y: 600, width: 200, height: 20 } }];

	// failOn and alerts are checked before success; the breaker then refuses input until resume.
	resetSession();
	let f = fake({ screens: [home, [...connected, alert]] });
	await assert.rejects(mobileAct(f.exec, { action: "wait", query: "Beep upon scan", failOnAlert: true }, o()), e => {
		assert.match(e.message, /^STOPPED: wait for "Beep upon scan": ALERT on screen \(untrusted app text\): "Connection Error!" \| "OK"\nSaved the screen to (.+)\nBreaker on: iPhone 17 takes no launches/);
		assert.ok(existsSync(path.join(e.message.match(/Saved the screen to (.+)/)[1], "screen.txt")), "evidence saved");
		return true;
	});
	await assert.rejects(mobileAct(f.exec, { action: "tap", ref: "e1" }, o()), /BREAKER ON for iPhone 17, which stopped on: wait for "Beep upon scan": ALERT/);
	assert.equal(f.acts().filter(a => a.startsWith("io")).length, 0, "no tap while the breaker is on");
	assert.match(await mobileAct(f.exec, { action: "list" }, o()), /SIM-1 ONLINE BREAKER ON iPhone 17/);
	assert.match(await mobileAct(f.exec, { action: "snapshot" }, o()), /ALERT on screen/, "reading still works");
	assert.match(await mobileAct(f.exec, { action: "resume" }, o()), /^Breaker off for iPhone 17; it had stopped on: wait for "Beep upon scan"/);
	assert.match(await mobileAct(f.exec, { action: "tap", ref: "e1", settleMs: 0 }, o()), /^Done\.$/);

	resetSession();
	f = fake({ screens: [[...home, { type: "StaticText", label: "Connection Error: init failed", rect: { x: 0, y: 700, width: 300, height: 20 } }]] });
	await assert.rejects(mobileAct(f.exec, { action: "wait", query: "Beep upon scan", failOn: ["Connection Error"] }, o()), /STOPPED: wait for "Beep upon scan": "Connection Error" is on screen/);

	resetSession();
	f = fake({ screens: [home] });
	f.app.front = "com.apple.mobilesafari";
	await assert.rejects(mobileAct(f.exec, { action: "wait", query: "Beep upon scan", expectApp: "com.datecs.LibDemo" }, o()), /STOPPED: wait for "Beep upon scan": com\.apple\.mobilesafari is in front, not com\.datecs\.LibDemo/);

	// A guarded timeout stops too; an unguarded one is a plain error.
	resetSession();
	f = fake({ screens: [home] });
	await assert.rejects(mobileAct(f.exec, { action: "wait", query: "#nope", timeoutMs: 0, expectApp: "com.apple.springboard" }, o()), /STOPPED: wait for "#nope": Timed out after 0 ms/);
	resetSession();
	await assert.rejects(mobileAct(f.exec, { action: "wait", query: "#nope", timeoutMs: 0 }, o()), /Timed out after 0 ms waiting for "#nope" to appear\.$/);
	assert.match(await mobileAct(f.exec, { action: "tap", ref: "e1", settleMs: 0 }, o()), /^Done\.$/, "no breaker after an unguarded wait");

	// stableMs: a match that flickers away starts over.
	resetSession();
	f = fake({ screens: [connected, home, connected, connected, connected, connected, connected] });
	const slow = { sleep: ms => new Promise(res => setTimeout(res, ms / 30)) };
	assert.match(await mobileAct(f.exec, { action: "wait", query: "#play", stableMs: 15 }, o(slow)), /appeared after/);
	resetSession();
	f = fake({ screens: [connected, home, connected, connected, connected, connected, connected] });
	await mobileAct(f.exec, { action: "wait", query: "Beep upon scan", stableMs: 15 }, o(slow));
	assert.ok(f.calls.filter(c => c[1] === "dump").length >= 4, "held over several reads after the flicker");

	// Checkpoints: saved on first use, then compared by type, label and id; values, positions and ignored elements do not count.
	resetSession();
	const moved = home.map(n => ({ ...n, value: n.value ? "ZZ99" : n.value, rect: { ...n.rect, y: n.rect.y + 5 } }));
	f = fake({ screens: [connected, [...moved, { type: "StaticText", label: "Beep upon scan", rect: { x: 0, y: 610, width: 200, height: 20 } }], home, [...connected, alert]] });
	f.app.front = "com.datecs.LibDemo";
	assert.match(await mobileAct(f.exec, { action: "checkpoint", name: "connected" }, o()), /^Saved checkpoint "connected" as the good state on iPhone 17: 5 elements, com\.datecs\.LibDemo in front\.[^]*\nCrash watch on for com\.datecs\.LibDemo \(0 earlier crash reports\)/);
	assert.match(await mobileAct(f.exec, { action: "checkpoint", name: "connected" }, o()), /^Checkpoint "connected" matches its good state: 5 elements, com\.datecs\.LibDemo in front\.$/);
	await assert.rejects(mobileAct(f.exec, { action: "checkpoint", name: "connected" }, o()), /STOPPED: checkpoint "connected" differs from its good state:\nUNTRUSTED[^\n]*\n- StaticText "Beep upon scan" \(missing\)\nSaved/);
	await mobileAct(f.exec, { action: "resume" }, o());
	await assert.rejects(mobileAct(f.exec, { action: "checkpoint", name: "connected" }, o()), /\+ Alert "Connection Error!" \(new\)\n\+ Button "OK" \(new\)/);
	await mobileAct(f.exec, { action: "resume" }, o());
	f.app.front = "com.apple.springboard";
	await assert.rejects(mobileAct(f.exec, { action: "checkpoint", name: "connected", ignore: ["Connection Error", "OK"] }, o()), /differs from its good state:\ncom\.apple\.springboard is in front, not com\.datecs\.LibDemo\nSaved/, "ignored elements leave only the app change");
	await mobileAct(f.exec, { action: "resume" }, o());
	assert.match(await mobileAct(f.exec, { action: "checkpoint", name: "connected", save: true }, o()), /^Saved checkpoint "connected"/, "save replaces the good state");

	// Visual grid: averages below the status bar, and a changed tile is reported where it is.
	const img = { width: 32, height: 40, rgba: Buffer.alloc(32 * 40 * 4, 255) };
	const g = gridOf(img, 0.2);
	assert.equal(g.length, 16 * 16 * 3);
	assert.ok(g.every(v => v === 255));
	for (let y = 8; y < 10; y++) for (let x = 0; x < 2; x++) img.rgba.fill(0, (y * 32 + x) * 4, (y * 32 + x) * 4 + 3);
	assert.deepEqual(gridDiff(g, gridOf(img, 0.2)), [[0, 0]], "the status bar rows above 20% are not in the grid; the first tile below is");
	resetSession();
	f = fake({ screens: [home] });
	let colors = g;
	const vo = o({ grid: async () => colors });
	assert.match(await mobileAct(f.exec, { action: "checkpoint", name: "colors", visual: true }, vo), /a 16x16 color grid/);
	assert.match(await mobileAct(f.exec, { action: "checkpoint", name: "colors" }, vo), /same colors/, "a saved grid is compared without visual: true");
	colors = g.map((v, i) => i === 3 * 17 ? 0 : v);
	await assert.rejects(mobileAct(f.exec, { action: "checkpoint", name: "colors" }, vo), /colors changed in 1 of 256 grid tiles, within @\(25,111 25x51\)/);

	// Crash watch on a simulator: a new report of the app stops the run and is copied next to the saved screen.
	resetSession();
	f = fake({ screens: [home] });
	f.app.front = "com.datecs.LibDemo";
	await writeFile(path.join(reports, "LibraryDemo-old.ips"), '{"app_name":"LibraryDemo","bundleID":"com.datecs.LibDemo"}\n{}');
	assert.match(await mobileAct(f.exec, { action: "checkpoint", name: "crash" }, o()), /Crash watch on for com\.datecs\.LibDemo \(1 earlier crash reports\)/);
	await writeFile(path.join(reports, "Other-new.ips"), '{"app_name":"Other","bundleID":"com.other"}\n{}');
	assert.match(await mobileAct(f.exec, { action: "checkpoint", name: "crash" }, o()), /matches/, "other apps' crashes do not count");
	await writeFile(path.join(reports, "LibraryDemo-new.ips"), '{"app_name":"LibraryDemo","bundleID":"com.datecs.LibDemo"}\n{}');
	await assert.rejects(mobileAct(f.exec, { action: "checkpoint", name: "crash" }, o()), e => {
		assert.match(e.message, /differs from its good state:\nNEW CRASH REPORT: LibraryDemo-new\.ips\nSaved/);
		assert.ok(existsSync(path.join(e.message.match(/Saved the screen to (.+)/)[1], "LibraryDemo-new.ips")), "crash report copied");
		return true;
	});

	// Crash watch on a real iPhone: devicectl lists the crash logs, file names start with the app's executable.
	resetSession();
	const phone = fake({ list: [PHONE], screens: [home] });
	phone.app.front = "com.datecs.LibDemo";
	let logs = ["LibraryDemo-2026-10-19.ips", "Belot-2026-11-03.ips", "JetsamEvent-1.ips"];
	const real = async (c, a) => {
		if (c !== "xcrun") return phone.exec(c, a);
		const out = a[a.indexOf("--json-output") + 1];
		if (a.includes("apps")) await writeFile(out, JSON.stringify({ result: { apps: [{ url: "file:///private/var/containers/Bundle/Application/X/LibraryDemo.app/" }] } }));
		if (a.includes("files")) await writeFile(out, JSON.stringify({ result: { files: logs.map(name => ({ name })) } }));
		return { code: 0 };
	};
	assert.match(await mobileAct(real, { action: "checkpoint", name: "real" }, o()), /Crash watch on for com\.datecs\.LibDemo \(1 earlier crash reports\)/);
	logs = [...logs, "LibraryDemo.cpu_resource-2026-11-04.ips", "Belot-2026-11-04.ips"];
	await assert.rejects(mobileAct(real, { action: "checkpoint", name: "real" }, o()), /NEW CRASH REPORT: LibraryDemo\.cpu_resource-2026-11-04\.ips\nSaved/);
	await rm(dir, { recursive: true, force: true });
}

// Query, OCR fallback, wait and relaunch.
{
	resetSession();
	const bids = [{ text: "Pass", x: 0.1, y: 0.8, w: 0.1, h: 0.02 }, { text: "1:42", x: 0.1, y: 0.01, w: 0.1, h: 0.02 }];
	const screens = [home, home, home, home, [home[0]], [home[0]]];
	const f = fake({ screens });
	const o = opts({ ocr: async () => bids });
	await mobileAct(f.exec, { action: "tap", query: "#nav_settings", settleMs: 0 }, o);
	await mobileAct(f.exec, { action: "tap", query: "pass", settleMs: 0 }, o);
	await assert.rejects(mobileAct(f.exec, { action: "tap", query: "#missing" }, o), /Nothing on screen matches "#missing"/);
	assert.match(await mobileAct(f.exec, { action: "ocr" }, o), /\[t1\] Text "Pass" @\(40,699 40x17\)$/, "OCR in points, status text dropped");
	await mobileAct(f.exec, { action: "tap", ref: "t1", settleMs: 0 }, o);
	assert.match(await mobileAct(f.exec, { action: "wait", query: "Local game" }, o), /^"Local game" appeared after/);
	assert.match(await mobileAct(f.exec, { action: "wait", query: "Local game", gone: true, timeoutMs: 1 }, o), /is gone/);
	const empty = fake({ screens: [[]] });
	await assert.rejects(mobileAct(empty.exec, { action: "wait", query: "Never", timeoutMs: 0 }, opts({ ocr: async () => [] })), /Timed out after 0 ms waiting for "Never" to appear/);
	assert.match(await mobileAct(fake({ screens: [home] }).exec, { action: "wait", stableMs: 0 }, opts()), /^Screen stable after/, "wait without query: until the screen stops changing");
	if (process.platform !== "darwin") {
		const noOcr = fake({ screens: [[]] });
		await assert.rejects(mobileAct(noOcr.exec, { action: "wait", query: "Never", timeoutMs: 0 }, opts()), /Timed out/);
		assert.ok(!noOcr.calls.some(c => c[1] === "screenshot"), "no screenshot for an OCR that cannot run here");
	}
	await mobileAct(f.exec, { action: "relaunch", appId: "com.demo" }, o);
	const d = "--device SIM-1";
	assert.deepEqual(f.acts(), [`io tap 201,570 ${d}`, `io tap 60,708 ${d}`, `io tap 60,708 ${d}`, `apps terminate com.demo ${d}`, `apps launch com.demo ${d}`]);
	assert.ok(f.calls.some(c => c[1] === "screenshot"), "OCR takes a screenshot");
}

// D5 installs: mobilecli is a bundled dependency; simulator agent automatic; real iPhone agent only after Yes.
{
	resetSession();
	const f = fake();
	await mobileAct(f.exec, { action: "list" }, opts());
	assert.deepEqual(f.calls.map(c => c[0]), [MOBILECLI], "runs the bundled binary, never npm install");

	resetSession();
	const sim = fake({ agent: false });
	await assert.rejects(mobileAct(sim.exec, { action: "tap", x: 1, y: 1 }, opts({ confirm: async () => assert.fail("no question for a simulator") })), /Installed the mobilecli helper on iPhone 17; this closed the open app\. Launch your app again/);
	assert.deepEqual(sim.acts().filter(a => !a.startsWith("apps foreground")), ["agent install --device SIM-1"], "no tap on the home screen the install left behind");
	await mobileAct(sim.exec, { action: "snapshot" }, opts());
	assert.equal(sim.calls.filter(c => c[1] === "agent" && c[2] === "install").length, 1, "installed once");

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
		await assert.rejects(mobileAct(async (c, a) => c === "security" ? sec(c, a) : agent.exec(c, a), { action: "snapshot" }, opts({ confirm: async () => true, profileDirs: [dir] })), /Installed the mobilecli helper/);
		assert.deepEqual(agent.acts().filter(a => !a.startsWith("apps foreground")), [`agent install --device 0000-REAL --provisioning-profile ${path.join(dir, "d.mobileprovision")}`]);
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

// Live: only with the bundled mobilecli and one online simulator with its agent; reads only, never taps.
if (existsSync(MOBILECLI)) {
	resetSession();
	const exec = async (command, args, { timeout }) => run(command, args, { timeout, maxBuffer: 64 << 20 }).then(r => ({ code: 0, ...r }), e => ({ code: e.code ?? 1, stdout: e.stdout, stderr: e.stderr || e.message }));
	const sims = (await resolveDevice(exec, undefined, true).then(d => [d], () => []));
	const sim = sims.find(d => d.type === "simulator");
	const agent = sim && await run(MOBILECLI, ["agent", "status", "--device", sim.id]).then(() => true, () => false);
	if (agent) {
		const snap = await mobileAct(exec, { action: "snapshot", device: sim.id }, { confirm: async () => false });
		assert.match(snap, /^UNTRUSTED[^]*\n\[e1\] /, "live snapshot lists elements");
		console.log(`live ${sim.name}: ${snap.split("\n").length - 3} elements`);
	} else console.log("live check skipped: needs exactly one online simulator with the mobilecli agent");
} else console.log("live check skipped: no mobilecli binary for this platform");
console.log("mobile_act ok");
