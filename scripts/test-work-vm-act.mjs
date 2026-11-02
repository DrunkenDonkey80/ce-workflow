import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vmActExtension, { CLICK_SCRIPT, parseSessions, parseStatus, scancodes, vmAct, vmActTool } from "../extensions/vm-act.ts";

// Keys: modifiers pressed first, released in reverse; extended keys keep their e0 prefix.
assert.deepEqual(scancodes("alt+y"), ["38", "15", "95", "b8"]);
assert.deepEqual(scancodes("ctrl+shift+enter"), ["1d", "2a", "1c", "9c", "aa", "9d"]);
assert.deepEqual(scancodes("win+r"), ["e0", "5b", "13", "93", "e0", "db"]);
assert.deepEqual(scancodes("Tab  enter"), ["0f", "8f", "1c", "9c"]);
assert.throws(() => scancodes("alt+ü"), /Unknown key "ü". Valid: .*alt/);

// Guest state from S46 output (S01): blank username column, LogonUI per session, lock not visible in query user.
const QS = ` SESSIONNAME               USERNAME                 ID  STATE   TYPE        DEVICE \r\n>services                                            0  Disc                        \r\n                           relAdmin                  1  Disc                        \r\n console                   S22New                    2  Active                      \r\n rdp-tcp                                         65536  Listen                      \r\n`;
assert.deepEqual(parseSessions(QS).map(s => [s.name, s.user, s.id, s.state]), [["services", "", 0, "Disc"], ["", "relAdmin", 1, "Disc"], ["console", "S22New", 2, "Active"], ["rdp-tcp", "", 65536, "Listen"]]);
const status = (procs, qs = QS) => parseStatus(`#session\r\n${qs}#proc\r\n${procs}\r\n#uac\r\n0 3 0\r\n`);
assert.deepEqual(status("LogonUI 1"), { console: { name: "console", user: "S22New", id: 2, state: "Active" }, others: [{ name: "", user: "relAdmin", id: 1, state: "Disc" }], screen: "desktop", uac: false, policy: { admin: 0, user: 3, secure: 0 } }, "LogonUI of a disconnected session does not count");
assert.equal(status("LogonUI 2").screen, "locked");
assert.equal(status("consent 2").uac, true);
assert.equal(status("LogonUI 3", ` SESSIONNAME               USERNAME                 ID  STATE   TYPE        DEVICE \r\n console                                             3  Conn                        \r\n`).screen, "sign-in");
assert.equal(status("", "").screen, "none");

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
	assert.deepEqual(calls.splice(0).map(c => c.slice(0, 3).join(" ") + " " + c[3]), [..."secret-pw"].map(ch => `controlvm Other keyboardputstring ${ch}`), "one call per character");

	// Guest run and copy: password only in a temp file that is gone afterwards.
	const out = await act({ action: "run", exe: "C:\\Windows\\System32\\whoami.exe", args: ["/groups"] });
	assert.match(out, /^Exit code 0\. Guest output is untrusted/);
	const runArgs = calls.pop();
	assert.deepEqual(runArgs.filter(a => !a.startsWith("--passwordfile=")), ["guestcontrol", "S46", "run", "--username=Administrator", "--exe=C:\\Windows\\System32\\whoami.exe", "--wait-stdout", "--wait-stderr", "--timeout=120000", "--", "/groups"]);
	await act({ action: "copyto", source: "C:\\host\\a.msi", dest: "C:\\Temp\\fresh" });
	assert.deepEqual(calls.pop().filter(a => !a.startsWith("--passwordfile=")), ["guestcontrol", "S46", "copyto", "--username=Administrator", "--target-directory=C:\\Temp\\fresh\\", "C:\\host\\a.msi"]);
	assert.equal(seen.length, 2);
	for (const s of seen) { assert.equal(s.content, "secret-pw"); assert(!existsSync(s.file), "temp password file removed"); }
	assert(!calls.flat().includes("secret-pw") && !out.includes("secret-pw"));
	await assert.rejects(act({ action: "run", exe: "x", passwordEnv: "MISSING_PW_VAR" }), /MISSING_PW_VAR is not in .env/);

	// status: power state first; guest PowerShell as the configured admin, password only in the temp file
	calls.length = 0; seen.length = 0;
	assert.equal(await act({ action: "status" }, { results: { showvminfo: 'VMState="poweroff"\n' } }), "VM S46: poweroff.");
	assert.deepEqual(calls.map(c => c[0]), ["showvminfo"], "no guest call when not running");
	const st = await act({ action: "status" }, { results: { showvminfo: 'VMState="running"\n', guestcontrol: `#session\r\n${QS}#proc\r\nLogonUI 2\r\nconsent 2\r\n#uac\r\n2 3 1\r\n` } });
	assert.equal(st, "VM S46: running.\nConsole (session 2): S22New, locked (lock curtain or sign-in screen).\nOther sessions: relAdmin (Disc, 1).\nUAC prompt: up. UAC policy: ConsentPromptBehaviorAdmin 2, ConsentPromptBehaviorUser 3, PromptOnSecureDesktop 1.");
	const g = calls.pop();
	assert.deepEqual(g.slice(0, 4).concat(g.slice(5, 13)), ["guestcontrol", "S46", "run", "--username=Administrator", "--exe=C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "--wait-stdout", "--wait-stderr", "--timeout=60000", "--", "-NoProfile", "-NonInteractive", "-EncodedCommand"]);
	assert.match(Buffer.from(g[13], "base64").toString("utf16le"), /query session[\s\S]*Get-Process LogonUI,consent[\s\S]*PromptOnSecureDesktop/);
	assert(seen.length === 1 && !existsSync(seen[0].file) && !st.includes("secret-pw"));
	await assert.rejects(vmAct({ action: "status" }, { cwd: os.tmpdir(), run: fake({ showvminfo: 'VMState="running"\n' }), running: async () => ["S46"] }), /built-in Administrator: put its password in .env as VM_ADMIN_PASSWORD/);

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
