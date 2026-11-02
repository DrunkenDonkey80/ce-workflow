import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vmActExtension, { CLICK_SCRIPT, scancodes, vmAct, vmActTool } from "../extensions/vm-act.ts";

// Keys: modifiers pressed first, released in reverse; extended keys keep their e0 prefix.
assert.deepEqual(scancodes("alt+y"), ["38", "15", "95", "b8"]);
assert.deepEqual(scancodes("ctrl+shift+enter"), ["1d", "2a", "1c", "9c", "aa", "9d"]);
assert.deepEqual(scancodes("win+r"), ["e0", "5b", "13", "93", "e0", "db"]);
assert.deepEqual(scancodes("Tab  enter"), ["0f", "8f", "1c", "9c"]);
assert.throws(() => scancodes("alt+ü"), /Unknown key "ü". Valid: .*alt/);

let registered;
vmActExtension({ registerTool: (t) => { registered = t; } });
assert.equal(registered.exposure, "deferred", "on demand only (D-02)");
assert.equal(registered.name, vmActTool().name);

const dir = await mkdtemp(path.join(os.tmpdir(), "vm-act-test-")), agentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = dir; // no global settings
await mkdir(path.join(dir, ".pi"));
await writeFile(path.join(dir, ".pi", "settings.json"), JSON.stringify({ workOrchestrator: { vm: { vm: "S46", user: "Administrator", passwordEnv: "VM_TEST_PW" } } }));
await writeFile(path.join(dir, ".env"), "# test\nVM_TEST_PW=secret-pw\n");
try {
	const calls = [], seen = [];
	const fake = (results = {}) => async (args) => {
		calls.push(args);
		const pw = args.find(a => a.startsWith("--passwordfile="))?.slice(15);
		if (pw) seen.push({ file: pw, content: readFileSync(pw, "utf8") });
		return { code: 0, stdout: results[args[0]] ?? "", stderr: "" };
	};
	const act = (a, o = {}) => vmAct(a, { cwd: dir, run: fake(o.results), running: async () => o.running ?? ["S46"], sleep: async () => {} });

	assert.equal(await act({ action: "keys", keys: "alt+y" }), "Sent alt+y.");
	assert.deepEqual(calls.pop(), ["controlvm", "S46", "keyboardputscancode", "38", "15", "95", "b8"]);
	assert.equal(await act({ action: "type", textFromEnv: "VM_TEST_PW", vm: "Other" }), "Typed VM_TEST_PW (value not shown).");
	assert.deepEqual(calls.pop(), ["controlvm", "Other", "keyboardputstring", "secret-pw"]);

	// Guest run and copy: password only in a temp file that is gone afterwards.
	const out = await act({ action: "run", exe: "C:\\Windows\\System32\\whoami.exe", args: ["/groups"] });
	assert.match(out, /^Exit code 0\. Guest output is untrusted/);
	const runArgs = calls.pop();
	assert.deepEqual(runArgs.filter(a => !a.startsWith("--passwordfile=")), ["guestcontrol", "S46", "run", "--username=Administrator", "--exe=C:\\Windows\\System32\\whoami.exe", "--wait-stdout", "--wait-stderr", "--timeout=120000", "--", "C:\\Windows\\System32\\whoami.exe", "/groups"]);
	await act({ action: "copyto", source: "C:\\host\\a.msi", dest: "C:\\Temp\\fresh" });
	assert.deepEqual(calls.pop().filter(a => !a.startsWith("--passwordfile=")), ["guestcontrol", "S46", "copyto", "--username=Administrator", "--target-directory=C:\\Temp\\fresh", "C:\\host\\a.msi"]);
	assert.equal(seen.length, 2);
	for (const s of seen) { assert.equal(s.content, "secret-pw"); assert(!existsSync(s.file), "temp password file removed"); }
	assert(!calls.flat().includes("secret-pw") && !out.includes("secret-pw"));
	await assert.rejects(act({ action: "run", exe: "x", passwordEnv: "MISSING_PW_VAR" }), /MISSING_PW_VAR is not in .env/);

	// Restore (D-09): the configured running VM is powered off, waited for, restored and started.
	calls.length = 0;
	const restored = await act({ action: "snapshot", op: "restore", name: "clean" }, { results: { showvminfo: 'VMState="poweroff"\n' } });
	assert.match(restored, /^Powered it off .*Restored "clean" and started S46 headless\.$/);
	assert.deepEqual(calls.map(c => c.slice(0, 3).join(" ")), ["controlvm S46 poweroff", "showvminfo S46 --machinereadable", "snapshot S46 restore", "startvm S46 --type"]);
	// Another running VM: refused before any state-changing call.
	calls.length = 0;
	await assert.rejects(act({ action: "snapshot", op: "restore", name: "clean", vm: "Other" }, { running: ["S46", "Other"] }), /Other is running and is not workOrchestrator.vm/);
	assert.deepEqual(calls, []);
	// Not running: no poweroff, no note.
	assert.equal(await act({ action: "snapshot", op: "restore", name: "clean", vm: "Other" }, { running: [] }), 'Restored "clean" and started Other headless.');

	await act({ action: "snapshot", op: "take", name: "base" });
	assert.deepEqual(calls.pop(), ["snapshot", "S46", "take", "base"], "paused save, not --live");
	calls.length = 0;
	await act({ action: "usb", op: "attach", device: "{uuid-1}" });
	assert.deepEqual(calls.pop(), ["controlvm", "S46", "usbattach", "{uuid-1}"]);
	await assert.rejects(act({ action: "keys" }), /keys needs keys/);

	// Click: screenshot pixels (0-based) become 1-based COM coordinates; buttons and double map to events.
	const clicks = [];
	const click = (a) => vmAct(a, { cwd: dir, running: async () => ["S46"], click: async (plan) => { clicks.push(plan); return { code: 0, stdout: "", stderr: "" }; } });
	assert.equal(await click({ action: "click", x: 0, y: 10 }), "Clicked left at 0,10 in S46.");
	await click({ action: "click", x: 5, y: 6, button: "right", double: true });
	assert.deepEqual(clicks, [{ vm: "S46", x: 1, y: 11, buttons: 1, clicks: 1 }, { vm: "S46", x: 6, y: 7, buttons: 2, clicks: 2 }]);
	await assert.rejects(click({ action: "click", x: -1, y: 0 }), /click needs x and y/);
	assert.match(CLICK_SCRIPT, /LockMachine\(\$s,1\)[\s\S]*finally \{ \$s\.UnlockMachine\(\) \}/, "shared lock, always released");
} finally {
	if (agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = agentDir;
	await rm(dir, { recursive: true, force: true });
}
console.log("ok - vm_act");
