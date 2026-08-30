#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import {
	closeSync,
	mkdirSync,
	openSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(
	process.env.WORK_FIXTURE_ROOT ?? path.resolve(import.meta.dirname, "../../.."),
);
const sdk =
	process.env.ANDROID_HOME ??
	path.join(os.homedir(), "AppData", "Local", "Android", "Sdk");
const adb = path.join(sdk, "platform-tools", "adb.exe");
const emulatorBin = path.join(sdk, "emulator", "emulator.exe");
const gradleRoot = path.join(
	os.homedir(),
	".gradle",
	"wrapper",
	"dists",
	"gradle-8.11.1-bin",
);
const gradleDir = readdirSync(gradleRoot).at(0);
const gradle = path.join(
	gradleRoot,
	gradleDir,
	"gradle-8.11.1",
	"bin",
	"gradle.bat",
);
const project = path.join(import.meta.dirname, "android");
const out = path.join(root, ".pi", "work-artifacts", "android-smoke");
mkdirSync(out, { recursive: true });
const build = spawnSync(
	process.env.ComSpec ?? "cmd.exe",
	[
		"/d",
		"/s",
		"/c",
		`${gradle} --no-daemon --project-cache-dir ${path.join(out, "gradle-cache")} :app:assembleDebug`,
	],
	{
		cwd: project,
		env: { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk },
		encoding: "utf8",
		timeout: 600_000,
	},
);
if (build.status !== 0)
	throw new Error(`Android build failed: ${build.stderr || build.stdout}`);
const listed = spawnSync(adb, ["devices"], { encoding: "utf8" }).stdout;
let serial =
	process.env.WORK_ANDROID_SERIAL ??
	/^((?:emulator)-\d+)\s+device$/m.exec(listed)?.[1];
let emulator;
let emulatorLog;
let ownsEmulator = false;
if (!serial) {
	const port = process.env.WORK_ANDROID_PORT ?? "5580";
	serial = `emulator-${port}`;
	emulatorLog = openSync(path.join(out, "emulator.log"), "w");
	emulator = spawn(
		emulatorBin,
		[
			"-avd",
			process.env.WORK_ANDROID_AVD ?? "Belot_API26",
			"-port",
			port,
			"-no-snapshot-save",
			"-no-audio",
			"-no-boot-anim",
		],
		{ stdio: ["ignore", emulatorLog, emulatorLog] },
	);
	ownsEmulator = true;
}
const runAdb = (args, options = {}) =>
	spawnSync(adb, ["-s", serial, ...args], {
		encoding: "utf8",
		timeout: 60_000,
		...options,
	});
let booted = false;
try {
	const deadline = Date.now() + 420_000;
	while (Date.now() < deadline) {
		const probe = runAdb(["shell", "getprop", "sys.boot_completed"]);
		if (probe.status === 0 && probe.stdout.trim() === "1") {
			booted = true;
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 3000));
	}
	if (!booted) throw new Error("Android emulator boot timeout");
	const apk = path.join(
		project,
		"app",
		"build",
		"outputs",
		"apk",
		"debug",
		"app-debug.apk",
	);
	if (runAdb(["install", "-r", apk]).status !== 0)
		throw new Error("APK install failed");
	runAdb([
		"shell",
		"am",
		"start",
		"-W",
		"-n",
		"dev.ceworkflow.capability/.MainActivity",
	]);
	runAdb(["shell", "input", "tap", "180", "300"]);
	await new Promise((resolve) => setTimeout(resolve, 1000));
	const screenshot = runAdb(["exec-out", "screencap", "-p"], {
		encoding: null,
		maxBuffer: 8 * 1024 * 1024,
	});
	if (screenshot.status !== 0) throw new Error("Android screenshot failed");
	writeFileSync(path.join(out, "android.png"), screenshot.stdout);
	const logs = runAdb(["logcat", "-d", "-t", "300"]);
	writeFileSync(path.join(out, "logcat.txt"), logs.stdout);
	if (/FATAL EXCEPTION.*dev\.ceworkflow\.capability/s.test(logs.stdout))
		throw new Error("fixture crashed");
} finally {
	if (booted)
		runAdb(["shell", "am", "force-stop", "dev.ceworkflow.capability"]);
	if (ownsEmulator) {
		runAdb(["emu", "kill"]);
		emulator.kill();
		closeSync(emulatorLog);
	}
}
process.stdout.write(
	JSON.stringify({
		artifacts: {
			screenshot: ".pi/work-artifacts/android-smoke/android.png",
			log: ".pi/work-artifacts/android-smoke/logcat.txt",
		},
		cleanup: {
			ok: true,
			app: "force-stopped",
			emulator: ownsEmulator ? "stopped" : "retained-preexisting",
		},
		serial,
		package: "dev.ceworkflow.capability",
	}),
);
