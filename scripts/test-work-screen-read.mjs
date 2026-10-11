import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { captureFile, decodePng, encodePng, processPng, screenRead, screenReadPlan, screenReadTool } from "../extensions/screen-read.ts";

const file = "C:/tmp/x.png";
assert.deepEqual(screenReadPlan({ target: "window" }, file), { region: undefined, maxEdge: 1024, file, op: "window", title: "", pid: 0, handle: 0, minimize: false, list: true });
assert.equal(screenReadPlan({ target: "window", window: { pid: 5 }, maxEdge: 9 }, file).maxEdge, 64);
assert.equal(screenReadPlan({ target: "window", window: { title: "x" }, maxEdge: 99999 }, file).list, false);
for (const region of [[0, 0, 1], [-1, 0, 1, 1], [0, 0, 0, 1], [0.5, 0, 1, 1]]) assert.throws(() => screenReadPlan({ target: "window", region }, file), /region/);
assert.deepEqual(screenReadPlan({ target: "browser", browser: { url: "http://x", selector: "#a", full: true, session: "s" } }, file).runs, [["--session", "s", "open", "http://x"], ["--session", "s", "screenshot", "#a", "C:/tmp/x-raw.png", "--full"]]);
assert.deepEqual(screenReadPlan({ target: "android", android: { device: "emu" } }, file).runs, [["screen", "capture", "--device=emu", "--output=C:/tmp/x-raw.png"]]);
assert.deepEqual(screenReadPlan({ target: "android", android: { device: "emu" } }, file).alt, { exe: "adb", runs: [["-s", "emu", "exec-out", "screencap", "-p"]] });
assert.throws(() => screenReadPlan({ target: "desktop" }, file), /target/);

// Non-Windows path: pure Node PNG decode (all five filters, RGB and RGBA), crop and downscale.
{
	const w = 4, h = 5, rgb = Buffer.from(Array.from({ length: w * h * 3 }, (_, i) => (i * 37 + (i >> 3) * 11) & 255));
	const stride = w * 3, raw = [];
	for (let y = 0; y < h; y++) {
		const row = [y]; // filter type y: 0 none, 1 sub, 2 up, 3 average, 4 paeth
		for (let x = 0; x < stride; x++) {
			const get = (yy, xx) => (yy < 0 || xx < 0 ? 0 : rgb[yy * stride + xx]);
			const a = get(y, x - 3), b = get(y - 1, x), c = get(y - 1, x - 3), p = a + b - c;
			const predict = [0, a, b, (a + b) >> 1, Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c][y];
			row.push((rgb[y * stride + x] - predict) & 255);
		}
		raw.push(...row);
	}
	const rgba = Buffer.from(encodePng(1, 1, Buffer.alloc(4)));
	const ihdr = rgba.indexOf("IHDR"); rgba[ihdr + 4 + 9] = 2; rgba.writeUInt32BE(w, ihdr + 4); rgba.writeUInt32BE(h, ihdr + 8);
	// rebuild with real data: swap the IDAT, CRCs are not checked by the decoder
	const head = rgba.subarray(0, rgba.indexOf("IDAT") - 4), idat = zlib.deflateSync(Buffer.from(raw)), len = Buffer.alloc(4); len.writeUInt32BE(idat.length);
	const png = Buffer.concat([head, len, Buffer.from("IDAT"), idat, Buffer.alloc(4), Buffer.from([0, 0, 0, 0]), Buffer.from("IEND"), Buffer.alloc(4)]);
	const decoded = decodePng(png);
	assert.deepEqual([decoded.width, decoded.height], [w, h]);
	for (let i = 0; i < w * h; i++) assert.deepEqual([...decoded.rgba.subarray(i * 4, i * 4 + 4)], [...rgb.subarray(i * 3, i * 3 + 3), 255], `pixel ${i} decodes through filter ${Math.floor(i / w)}`);
	const pixels = Buffer.alloc(4 * 4 * 4); for (let i = 0; i < 16; i++) pixels.writeUInt32BE(i < 8 ? 0x000000ff : 0xffffffff, i * 4);
	const half = processPng(encodePng(4, 4, pixels), undefined, 2);
	assert.deepEqual([half.width, half.height, half.sourceWidth, half.scale, half.uniform], [2, 2, 4, 0.5, false]);
	assert.deepEqual([...decodePng(half.png).rgba], [0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255], "area-average downscale");
	const crop = processPng(encodePng(4, 4, pixels), [1, 2, 2, 2], 1024);
	assert.deepEqual([crop.width, crop.height, crop.scale, crop.uniform], [2, 2, 1, true], "crop, no upscaling");
	assert.throws(() => processPng(encodePng(4, 4, pixels), [3, 3, 2, 2], 1024), /region must lie inside the 4x4/);
	assert.throws(() => decodePng(Buffer.from("nope")), /not a PNG/);
	await assert.rejects(screenRead(null, { target: "window" }, undefined, os.tmpdir(), "linux"), /needs Windows/);

	// Runner with a fake CLI (node itself) that writes the screenshot and leaves output in log files.
	const dir = await mkdtemp(path.join(os.tmpdir(), "screen-read-test-")), raw2 = path.join(dir, "x-raw.png"), out = path.join(dir, "x.png");
	try {
		const src = path.join(dir, "src.png");
		await writeFile(src, encodePng(4, 4, pixels));
		const shot = await captureFile({ exe: process.execPath, runs: [["-e", "console.log('opened')"], ["-e", `require('fs').copyFileSync(${JSON.stringify(src)}, ${JSON.stringify(raw2)})`]], raw: raw2, file: out, maxEdge: 2 });
		assert.deepEqual([shot.width, shot.height, shot.sourceWidth], [2, 2, 4]);
		assert.deepEqual([...decodePng(await readFile(out)).rgba].slice(0, 4), [0, 0, 0, 255]);
		await assert.rejects(readFile(raw2), /ENOENT/, "raw screenshot cleaned up");
		await assert.rejects(captureFile({ exe: process.execPath, runs: [["-e", "console.error('boom'); process.exit(3)"]], raw: raw2, file: out, maxEdge: 64 }), /failed:.*boom/);
		await assert.rejects(captureFile({ exe: "no-such-screen-cli", runs: [["x"]], raw: raw2, file: out, maxEdge: 64 }), /ENOENT/);
		// missing primary CLI: alt runs and its stdout becomes the screenshot (adb exec-out screencap -p)
		const viaAlt = await captureFile({ exe: "no-such-screen-cli", runs: [["x"]], raw: raw2, file: out, maxEdge: 64, alt: { exe: process.execPath, runs: [["-e", `process.stdout.write(require('fs').readFileSync(${JSON.stringify(src)}))`]] } });
		assert.deepEqual([viaAlt.width, viaAlt.sourceWidth], [4, 4]);
		await assert.rejects(captureFile({ exe: "no-such-screen-cli", runs: [["x"]], raw: raw2, file: out, maxEdge: 64, alt: { exe: process.execPath, runs: [["-e", "console.error('no device'); process.exit(1)"]] } }), /failed:.*no device/);
	} finally { await rm(dir, { recursive: true, force: true }); }
}

if (process.platform === "win32") {
	const exec = async (command, args, options) => {
		try { const { stdout, stderr } = await promisify(execFile)(command, args, { ...options, maxBuffer: 1 << 24 }); return { code: 0, stdout, stderr }; }
		catch (error) { return { code: error.code ?? 1, killed: error.killed, stdout: error.stdout, stderr: error.stderr }; }
	};
	const title = `screen-read-test-${process.pid}`;
	// A minimized test window: capture must render it without restoring it on screen.
	const form = `Add-Type -AssemblyName System.Windows.Forms; $f=New-Object Windows.Forms.Form; $f.Text='${title}'; $f.Width=600; $f.Height=400; $f.BackColor='LightBlue'; $l=New-Object Windows.Forms.Label; $l.Text='HELLO'; $l.Font=New-Object Drawing.Font('Arial',40); $l.AutoSize=$true; $l.BackColor='Orange'; $f.Controls.Add($l); $f.WindowState='Minimized'; [Windows.Forms.Application]::Run($f)`;
	const child = spawn("powershell.exe", ["-NoProfile", "-Command", form], { stdio: "ignore" });
	try {
		let found = [];
		for (let i = 0; i < 40 && !found.length; i++) {
			await new Promise(resolve => setTimeout(resolve, 500));
			found = (await screenRead(exec, { target: "window" })).matches.filter(w => w.title === title);
		}
		assert.equal(found.length, 1, "test window listed");
		assert.equal(found[0].minimized, true);
		const shot = await screenRead(exec, { target: "window", window: { pid: child.pid }, maxEdge: 256 });
		assert.equal(shot.window.minimized, true);
		assert.equal(shot.uniform, false, "minimized window rendered real content");
		assert.ok(shot.sourceWidth >= 400 && shot.sourceWidth <= 1000, `frame trimmed to the window, got ${shot.sourceWidth}`);
		assert.equal(Math.max(shot.width, shot.height), 256);
		const zoom = await screenRead(exec, { target: "window", window: { pid: child.pid }, region: [0, 0, 100, 50] });
		assert.deepEqual([zoom.width, zoom.height, zoom.scale], [100, 50, 1]);
		assert.equal(zoom.window.minimized, true, "window re-minimized after the first capture");
		await assert.rejects(screenRead(exec, { target: "window", window: { pid: child.pid }, region: [0, 0, 5000, 5000] }), /region must lie inside/);
		const tool = screenReadTool(exec);
		const result = await tool.execute("t", { target: "window", window: { pid: child.pid }, maxEdge: 128 });
		assert.equal(result.content[1].type, "image");
		assert.match(result.content[0].text, /source/);
	} finally {
		child.kill();
	}
	// Live, only when an emulator/device is attached: android CLI, then the adb fallback with android hidden from PATH.
	const adb = await exec("adb", ["devices"], { timeout: 15_000 }).catch(() => ({}));
	if (/\tdevice\b/.test(adb.stdout ?? "")) {
		const cli = await screenRead(exec, { target: "android", maxEdge: 128 });
		assert.equal(cli.uniform, false);
		const saved = process.env.PATH;
		process.env.PATH = saved.split(";").filter(p => !/AndroidCLI/i.test(p)).join(";");
		try {
			const viaAdb = await screenRead(exec, { target: "android", maxEdge: 128 });
			assert.deepEqual([viaAdb.sourceWidth, viaAdb.sourceHeight], [cli.sourceWidth, cli.sourceHeight], "adb fallback captures the same screen");
			const linux = await screenRead(null, { target: "android", maxEdge: 128 }, undefined, undefined, "linux");
			assert.deepEqual([linux.sourceWidth, linux.sourceHeight], [cli.sourceWidth, cli.sourceHeight], "Node path adb fallback");
		} finally { process.env.PATH = saved; }
	}
}
console.log("ok - screen_read");
