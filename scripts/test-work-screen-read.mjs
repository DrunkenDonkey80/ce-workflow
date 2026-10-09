import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { screenRead, screenReadPlan, screenReadTool } from "../extensions/screen-read.ts";

const file = "C:/tmp/x.png";
assert.deepEqual(screenReadPlan({ target: "window" }, file), { region: undefined, maxEdge: 1024, file, op: "window", title: "", pid: 0, handle: 0, minimize: false, list: true });
assert.equal(screenReadPlan({ target: "window", window: { pid: 5 }, maxEdge: 9 }, file).maxEdge, 64);
assert.equal(screenReadPlan({ target: "window", window: { title: "x" }, maxEdge: 99999 }, file).list, false);
for (const region of [[0, 0, 1], [-1, 0, 1, 1], [0, 0, 0, 1], [0.5, 0, 1, 1]]) assert.throws(() => screenReadPlan({ target: "window", region }, file), /region/);
assert.deepEqual(screenReadPlan({ target: "browser", browser: { url: "http://x", selector: "#a", full: true, session: "s" } }, file).runs, [["--session", "s", "open", "http://x"], ["--session", "s", "screenshot", "#a", "C:/tmp/x-raw.png", "--full"]]);
assert.deepEqual(screenReadPlan({ target: "android", android: { device: "emu" } }, file).runs, [["screen", "capture", "--device=emu", "--output=C:/tmp/x-raw.png"]]);
assert.throws(() => screenReadPlan({ target: "desktop" }, file), /target/);

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
}
console.log("ok - screen_read");
