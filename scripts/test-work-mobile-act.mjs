import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { flatten, line, listSims, resolveSim, mobileAct, mobileActTool, swipePoints } from "../extensions/mobile-act.ts";
import { screenRead } from "../extensions/screen-read.ts";

const run = promisify(execFile);
const A = "AAAA-1", B = "BBBB-2";
const devices = (bootedB = false) => JSON.stringify({ devices: {
	"com.apple.CoreSimulator.SimRuntime.iOS-26-0": [{ udid: A, name: "iPhone 17", state: "Booted" }, { udid: B, name: "iPhone Air", state: bootedB ? "Booted" : "Shutdown" }],
	"com.apple.CoreSimulator.SimRuntime.watchOS-26-0": [{ udid: "W", name: "Watch", state: "Booted" }],
} });
const tree = [{ type: "Application", AXLabel: "Demo", frame: { x: 0, y: 0, width: 402, height: 874 }, children: [
	{ type: "Group", frame: { x: 0, y: 0, width: 402, height: 874 }, children: [
		{ type: "Heading", AXLabel: "TITLE", AXUniqueId: "title", frame: { x: 16, y: 76, width: 234, height: 33 } },
		{ type: "Button", AXLabel: "Local game", AXUniqueId: "play", frame: { x: 16, y: 369, width: 370, height: 48 }, children: [
			{ type: "StaticText", AXLabel: "Local game", frame: { x: 161, y: 385, width: 81, height: 16 } }] },
		{ type: "TextField", AXLabel: "Room code", AXValue: "AB12", enabled: false, frame: { x: 16, y: 500, width: 200, height: 40 } },
		{ type: "Group", frame: { x: 0, y: 0, width: 10, height: 10 } },
	] }] }];

function fakeExec(bootedB = false) {
	const calls = [];
	const exec = async (command, args) => {
		calls.push([command, ...args]);
		if (args[0] === "simctl" && args[1] === "list") return { code: 0, stdout: devices(bootedB) };
		if (args[0] === "simctl" && args[1] === "launch") return { code: 0, stdout: "com.demo: 4242\n" };
		if (command === "axe" && args[0] === "describe-ui") return { code: 0, stdout: JSON.stringify(tree) };
		return { code: 0, stdout: "" };
	};
	return { exec, calls };
}

// Flattening: containers without labels vanish, a button's own text child is not repeated.
{
	const { elements, screen } = flatten(tree);
	assert.deepEqual(screen, { x: 0, y: 0, width: 402, height: 874 });
	assert.deepEqual(elements.map(line), [
		'[e1] Application "Demo" @(0,0 402x874)',
		'[e2] Heading "TITLE" #title @(16,76 234x33)',
		'[e3] Button "Local game" #play @(16,369 370x48)',
		'[e4] TextField "Room code" = "AB12" [disabled] @(16,500 200x40)',
	]);
	assert.deepEqual(swipePoints("down", { x: 0, y: 0, width: 100, height: 200 }), [50, 160, 50, 40], "down moves the finger up");
	assert.deepEqual(swipePoints("right", { x: 0, y: 0, width: 100, height: 200 }), [80, 100, 20, 100]);
	assert.throws(() => swipePoints("sideways", { x: 0, y: 0, width: 1, height: 1 }), /direction/);
}

// Device resolution: the only booted iOS simulator by default; ambiguous or unknown devices explain themselves.
{
	assert.equal((await resolveSim(fakeExec().exec, undefined, true)).udid, A, "watchOS runtimes are ignored");
	await assert.rejects(resolveSim(fakeExec(true).exec, undefined, true), /Several simulators are booted; pass device:\nAAAA-1 iPhone 17 \(iOS 26.0\)/);
	assert.equal((await resolveSim(fakeExec(true).exec, "iPhone Air", true)).udid, B);
	await assert.rejects(resolveSim(fakeExec().exec, "iPhone Air", true), /Shutdown; boot it first/);
	await assert.rejects(resolveSim(fakeExec().exec, "Pixel", true), /No available iOS simulator/);
	await assert.rejects(mobileAct(fakeExec().exec, { action: "list" }, undefined, "linux"), /needs macOS/);
}

// Actions map to simctl and AXe calls in points, with refs from the last snapshot.
{
	const { exec, calls } = fakeExec();
	assert.match(await mobileAct(exec, { action: "list" }, undefined, "darwin"), /^AAAA-1 BOOTED iPhone 17 \(iOS 26.0\)\nBBBB-2 iPhone Air/);
	await assert.rejects(mobileAct(exec, { action: "tap", ref: "e3" }, undefined, "darwin"), /No snapshot yet/);
	const snap = await mobileAct(exec, { action: "snapshot" }, undefined, "darwin");
	assert.match(snap, /^UNTRUSTED app content/);
	assert.match(snap, /iPhone 17 402x874 points/);
	assert.match(snap, /\[e3\] Button "Local game" #play/);
	assert.equal(await mobileAct(exec, { action: "find", query: "room" }, undefined, "darwin"), '[e4] TextField "Room code" = "AB12" [disabled] @(16,500 200x40)');
	calls.length = 0;
	await mobileAct(exec, { action: "tap", ref: "e3" }, undefined, "darwin");
	await mobileAct(exec, { action: "tap", x: 10.123, y: 20 }, undefined, "darwin");
	await mobileAct(exec, { action: "type", ref: "e4", text: "XY", submit: true }, undefined, "darwin");
	await mobileAct(exec, { action: "swipe", direction: "down" }, undefined, "darwin");
	await mobileAct(exec, { action: "button", button: "home" }, undefined, "darwin");
	assert.match(await mobileAct(exec, { action: "launch", bundleId: "com.demo" }, undefined, "darwin"), /Launched com.demo: 4242/);
	const acts = calls.filter(c => c[0] === "axe" || c[2] === "launch");
	const u = ["--udid", A];
	assert.deepEqual(acts, [
		["axe", "tap", "-x", "201", "-y", "393", ...u],
		["axe", "tap", "-x", "10.12", "-y", "20", ...u],
		["axe", "tap", "-x", "116", "-y", "520", "--post-delay", "0.3", ...u],
		["axe", "type", "XY", ...u],
		["axe", "key", "40", ...u],
		["axe", "swipe", "--start-x", "201", "--start-y", "699.2", "--end-x", "201", "--end-y", "174.8", ...u],
		["axe", "button", "home", ...u],
		["xcrun", "simctl", "launch", "--terminate-running-process", A, "com.demo"],
	]);
	await assert.rejects(mobileAct(exec, { action: "tap", ref: "e99" }, undefined, "darwin"), /Unknown ref e99/);
	await assert.rejects(mobileAct(exec, { action: "tap" }, undefined, "darwin"), /needs ref, or x and y/);
	await assert.rejects(mobileAct(exec, { action: "launch" }, undefined, "darwin"), /needs bundleId/);
	const missing = async (command, args) => command === "axe" ? { code: 127, stderr: "spawn axe ENOENT" } : { code: 0, stdout: devices() };
	await assert.rejects(mobileAct(missing, { action: "snapshot" }, undefined, "darwin"), /AXe is not installed: brew tap cameroncooke\/axe/);
	const failing = async (command, args) => command === "axe" ? { code: 1, stderr: "No element found matching label" } : { code: 0, stdout: devices() };
	await assert.rejects(mobileAct(failing, { action: "button", button: "home" }, undefined, "darwin"), /axe button home failed: No element found/);
	let tries = 0;
	const flaky = async (command, args) => command !== "axe" ? { code: 0, stdout: devices() } : ++tries === 1 ? { code: 1, stderr: "Error: Timed out creating the simulator remote automation session" } : { code: 0, stdout: "" };
	assert.equal(await mobileAct(flaky, { action: "button", button: "home" }, undefined, "darwin"), "Done. Take a snapshot to see the screen now.");
	assert.equal(tries, 2, "one retry after an automation-session timeout");
	const tool = mobileActTool(exec);
	assert.equal(tool.name, "mobile_act");
	assert.deepEqual((await tool.execute("1", { action: "button", button: "lock" })).content[0].text, "Done. Take a snapshot to see the screen now.");
}

// Live: only on macOS with AXe and a booted simulator; reads only, never boots, launches or taps.
if (process.platform === "darwin") {
	const exec = async (command, args, { timeout }) => run(command, args, { timeout, maxBuffer: 64 << 20 }).then(r => ({ code: 0, ...r }), e => ({ code: e.code ?? 1, stdout: e.stdout, stderr: e.stderr || e.message }));
	const hasAxe = await run("axe", ["--version"]).then(() => true, () => false);
	const booted = hasAxe ? (await listSims(exec).catch(() => [])).find(s => s.state === "Booted") : undefined;
	if (booted) {
		const snap = await mobileAct(exec, { action: "snapshot", device: booted.udid }, undefined, "darwin");
		assert.match(snap, /\[e1\] Application "/, "live snapshot lists the foreground app");
		const shot = await screenRead(null, { target: "ios", ios: { device: booted.udid }, maxEdge: 256 });
		assert.ok(shot.height === 256 && shot.sourceHeight > 1000, `live iOS screenshot ${shot.width}x${shot.height} of ${shot.sourceWidth}x${shot.sourceHeight}`);
		console.log(`live ${booted.name}: ${snap.split("\n").length - 3} elements, screenshot ${shot.sourceWidth}x${shot.sourceHeight}`);
	} else console.log("live check skipped: needs AXe and a booted simulator");
}
console.log("mobile_act ok");
