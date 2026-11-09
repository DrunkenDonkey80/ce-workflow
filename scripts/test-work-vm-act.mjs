import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import vmActExtension, { CLICK_SCRIPT, envName, parseSessions, parseStatus, plainClixml, scancodes, tileOrder, vmAct, vmActTool, vmLogin, winArg } from "../extensions/vm-act.ts";

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
assert.deepEqual(status("LogonUI 1\r\nexplorer 2"), { console: { name: "console", user: "S22New", id: 2, state: "Active" }, others: [{ name: "", user: "relAdmin", id: 1, state: "Disc" }], screen: "desktop", uac: false, policy: { admin: 0, user: 3, secure: 0 }, last: undefined, accounts: [] }, "LogonUI of a disconnected session does not count");
// Tile order (D-16): LastLoggedOnSAMUser, users with a session, the rest A to Z case-insensitive
const tiles = (last, qs = QS) => tileOrder(parseStatus(`#session\r\n${qs}#proc\r\nLogonUI 2\r\n#uac\r\n0 3 0\r\n#last\r\n${last}\r\n#users\r\nAdministrator\r\nrelAdmin\r\nS22New\r\nTest\r\nb\r\nA\r\n`));
assert.deepEqual(tiles("WIN11REL\\test"), ["Test", "relAdmin", "S22New", "A", "Administrator", "b"]);
assert.deepEqual(tiles("relAdmin", ""), ["relAdmin", "A", "Administrator", "b", "S22New", "Test"]);
assert.deepEqual(tiles("", ""), ["A", "Administrator", "b", "relAdmin", "S22New", "Test"]);
assert.equal(status("LogonUI 2").screen, "locked");
assert.equal(status("explorer 1").screen, "starting", "first sign-in: no LogonUI, no explorer yet (Getting things ready)");
assert.equal(status(`explorer 2
FirstLogonAnim 2`).screen, "starting", "first sign-in overlay over a running explorer (S04)");
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
	assert.match(out, /\nState unavailable: |\nS46 has no console session/, "state appended (D-10)");
	const runArgs = calls.find(c => c.includes("--exe=C:\\Windows\\System32\\whoami.exe"));
	assert.deepEqual(runArgs.filter(a => !a.startsWith("--passwordfile=")), ["guestcontrol", "S46", "run", "--username=Administrator", "--exe=C:\\Windows\\System32\\whoami.exe", "--wait-stdout", "--wait-stderr", "--timeout=120000", "--", "/groups"]);
	await act({ action: "copyto", source: "C:\\host\\a.msi", dest: "C:\\Temp\\fresh" });
	assert.deepEqual(calls.pop().filter(a => !a.startsWith("--passwordfile=")), ["guestcontrol", "S46", "copyto", "--username=Administrator", "--target-directory=C:\\Temp\\fresh\\", "C:\\host\\a.msi"]);
	assert.equal(seen.length, 4, "run, its state, mkdir, copyto");
	assert.deepEqual(calls.at(-1).slice(2, 4).concat(calls.at(-1).slice(-2)), ["mkdir", "--username=Administrator", "--parents", "C:\\Temp\\fresh"], "copyto makes the folder first");
	await act({ action: "copyto", source: "deploy/x.cmd", dest: "C:/Temp" });
	assert.equal(calls.pop().at(-1), path.resolve(dir, "deploy/x.cmd"), "copyto resolves a relative host path against cwd");
	for (const s of seen) { assert.equal(s.content, "secret-pw"); assert(!existsSync(s.file), "temp password file removed"); }
	assert(!calls.flat().includes("secret-pw") && !out.includes("secret-pw"));
	await assert.rejects(act({ action: "run", exe: "x", passwordEnv: "MISSING_PW_VAR" }), /MISSING_PW_VAR is not in .env/);
	// script: PowerShell text, encoded
	await act({ action: "run", script: "Get-Date | % { 'it''s' }" });
	const sc = calls.find(c => c.some(x => x.startsWith("--exe=") && x.includes("powershell.exe")) && c.includes("-EncodedCommand") && Buffer.from(c[c.length - 1], "base64").toString("utf16le").includes("it''s"));
	assert(sc, "script runs as powershell -EncodedCommand");
	await assert.rejects(act({ action: "run", script: "x", exe: "y" }), /exe or script, not both/);
	// D-15: VBoxManage exit 32 + guest code; 1-31 are VBoxManage's own errors
	const runCode = (code) => vmAct({ action: "run", exe: "x" }, { cwd: dir, running: async () => ["S46"], run: async () => ({ code, stdout: "", stderr: "VBoxManage: error: boom" }) });
	assert.match(await runCode(35), /^Exit code 3\./);
	assert.match(await runCode(0), /^Exit code 0\./);
	await assert.rejects(runCode(1), /VBoxManage failed \(1\): VBoxManage: error: boom/);
	assert.deepEqual(["a", "b c", 'q"x', "C:\\dir\\", ""].map(winArg), ["a", '"b c"', '"q\\"x"', "C:\\dir\\", '""']);
	assert.equal(winArg("C:\\my dir\\"), '"C:\\my dir\\\\"');

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
	await assert.rejects(vmAct({ action: "status" }, { cwd: os.tmpdir(), run: fake({ showvminfo: 'VMState="running"\n' }), running: async () => ["S46"] }), /as Administrator on S46: put its password in .env as VM_ADMIN_PASSWORD/);

	// account: .env first, password to the guest only as a copied file, host cleanup when the script fails or is cancelled
	const decode = (c) => Buffer.from(c[c.length - 1], "base64").toString("utf16le");
	const copied = [];
	const acct = (a, guest) => vmAct(a, { cwd: dir, running: async () => ["S46"], run: async (args) => {
		calls.push(args);
		if (args[2] === "copyto") copied.push(readFileSync(args[args.length - 1], "utf8"));
		return args[2] === "run" ? guest(args) : { code: 0, stdout: "", stderr: "" };
	} });
	assert.equal(envName("test.user-1"), "VM_TEST_USER_1_PASSWORD");
	calls.length = 0;
	const created = await acct({ action: "account", op: "create", user: "tester" }, () => ({ code: 0, stdout: "", stderr: "" }));
	assert.equal(created.split("\n")[0], "Created standard account tester; password in .env as VM_TESTER_PASSWORD (value not shown).");
	assert.match(readFileSync(path.join(dir, ".env"), "utf8"), /VM_TEST_PW=secret-pw\n# vm_act account tester on S46\nVM_TESTER_PASSWORD=tester\n$/);
	assert.deepEqual(calls.map(c => c[2]), ["copyto", "run", "run"], "create, then the state");
	assert.deepEqual(copied, ["tester"]);
	const script = decode(calls[1]);
	assert.match(script, /^\$secretFile='C:\\Windows\\Temp\\vm-act-[0-9a-f-]+\.txt'\n/);
	assert.match(script, /ReadAllText\(\$secretFile\); Remove-Item -LiteralPath \$secretFile[\s\S]*New-LocalUser[\s\S]*S-1-5-32-545/);
	assert(!existsSync(calls[0][calls[0].length - 1]), "host copy of the password removed");
	// Windows refused password = username: the .env line becomes the fallback
	await acct({ action: "account", op: "create", user: "tester", admin: true }, () => ({ code: 0, stdout: "FALLBACK\r\n", stderr: "" }));
	const env = readFileSync(path.join(dir, ".env"), "utf8");
	assert.equal(env.match(/VM_TESTER_PASSWORD=/g).length, 1);
	assert.equal(env.match(/# vm_act account tester/g).length, 1, "the old comment goes with the old line");
	assert.match(env, /VM_TESTER_PASSWORD=password\n$/);
	assert.match(decode(calls.at(-2)), /S-1-5-32-544/, "admin group");
	// script fails after the copy: the host removes the guest file, no password in the error
	calls.length = 0;
	await writeFile(path.join(dir, ".env"), "VM_TEST_PW=secret-pw\nVM_NEW_PW=n3w-secret\n");
	await assert.rejects(acct({ action: "account", op: "reset", user: "tester", passwordEnv: "VM_NEW_PW" }, () => ({ code: 33, stdout: "", stderr: "User tester was not found." })), e => /failed \(exit 1\): User tester was not found/.test(e.message) && !e.message.includes("n3w-secret"));
	assert.deepEqual(calls.map(c => c[2]), ["copyto", "run", "rm"]);
	assert.match(calls[2][calls[2].length - 1], /^C:\\Windows\\Temp\\vm-act-[0-9a-f-]+\.txt$/);
	assert.equal(copied.pop(), "n3w-secret");
	// cancelled run (the runner throws): still cleaned up
	calls.length = 0;
	await assert.rejects(acct({ action: "account", op: "reset", user: "tester", passwordEnv: "VM_NEW_PW" }, () => { throw new Error("The operation was aborted"); }), /aborted/);
	assert.deepEqual(calls.map(c => c[2]), ["copyto", "run", "rm"]);
	assert(!calls.flat().some(a => a.includes("n3w-secret")), "no password in any VBoxManage argument");
	// list, delete, disable; refusals before any call
	const listed = await acct({ action: "account" }, () => ({ code: 0, stdout: "Administrator|True|True|True\r\nGuest|False|False|False\r\n", stderr: "" }));
	assert.equal(listed, "Administrator: admin, enabled, has a profile\nGuest: standard, disabled, no profile");
	assert.equal(await acct({ action: "account", op: "delete", user: "tester" }, () => ({ code: 0, stdout: "PROFILE\r\n", stderr: "" })).then(r => r.split("\n")[0]), "Deleted tester and its profile.");
	assert.equal(await acct({ action: "account", op: "disable", user: "tester" }, () => ({ code: 0, stdout: "", stderr: "" })).then(r => r.split("\n")[0]), "Disabled tester.");
	calls.length = 0;
	await assert.rejects(acct({ action: "account", op: "delete", user: "administrator" }, () => ({})), /refuses administrator/);
	await assert.rejects(acct({ action: "account", op: "create", user: "bad name" }, () => ({})), /1 to 20 letters/);
	await assert.rejects(acct({ action: "account", op: "reset", user: "tester" }, () => ({})), /needs passwordEnv/);
	assert.deepEqual(calls, []);
	// .env tracked by git: create refuses before touching it
	const repo = await mkdtemp(path.join(os.tmpdir(), "vm-act-git-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	await assert.rejects(vmAct({ action: "account", op: "create", user: "tester" }, { cwd: repo, running: async () => ["S46"], run: async () => ({ code: 0, stdout: "", stderr: "" }) }), /not gitignored/);
	assert(!existsSync(path.join(repo, ".env")));
	await rm(repo, { recursive: true, force: true });
	await writeFile(path.join(dir, ".env"), "# test\nVM_TEST_PW=secret-pw\n");

	// session signin: keyboard path of D-16, poll status until the user's desktop
	const guestOut = (qs, procs, last = "relAdmin") => `#session\r\n${qs}#proc\r\n${procs}\r\n#uac\r\n0 3 0\r\n#last\r\n${last}\r\n#users\r\nAdministrator\r\nrelAdmin\r\nvmt1\r\n`;
	const CON = (u, id = 1) => `${QS.split("\r\n")[0]}\r\n console                   ${u.padEnd(24)}${String(id).padStart(3)}  Active                      \r\n`;
	const sess = (a, outs) => { let i = 0; calls.length = 0; return vmAct(a, { cwd: dir, running: async () => ["S46"], sleep: async () => {}, run: async (args) => { calls.push(args); return { code: 0, stdout: args[2] === "run" ? outs[Math.min(i++, outs.length - 1)] : "", stderr: "" }; } }); };
	await writeFile(path.join(dir, ".env"), "VM_TEST_PW=secret-pw\nVM_VMT1_PASSWORD=vmt1pw\n");
	const signed = await sess({ action: "session", op: "signin", user: "VMT1", passwordEnv: "VM_VMT1_PASSWORD" }, [guestOut(CON("relAdmin"), "LogonUI 1"), "", guestOut(CON("relAdmin"), "LogonUI 1"), guestOut(CON("relAdmin"), "LogonUI 1"), guestOut(CON("vmt1", 3), "explorer 3")]);
	assert.match(signed, /^Signed in as vmt1 \(console session 3\) after about 6 s\./);
	assert.match(Buffer.from(calls[1].at(-1), "base64").toString("utf16le"), /Get-Process LogonUI[\s\S]*tsdiscon \$_.SessionId/, "fresh LogonUI before the keys (S08)");
	const sent = calls.filter(c => c[2] !== "run" && c[0] === "controlvm");
	const keyCalls = sent.filter(c => c[2] === "keyboardputscancode").map(c => c.slice(3).join(" "));
	assert.deepEqual(keyCalls.slice(0, 3), [scancodes("shift").join(" "), scancodes("space").join(" "), scancodes("tab tab home down down enter").join(" ")], "relAdmin, Administrator, vmt1: two downs");
	assert.deepEqual(sent.filter(c => c[2] === "keyboardputstring").map(c => c[3]).join(""), "vmt1pw");
	assert.equal(keyCalls.at(-1), scancodes("enter").join(" "));
	// console user on the desktop: signin refuses, switch disconnects first
	await assert.rejects(sess({ action: "session", op: "signin", user: "vmt1", passwordEnv: "VM_VMT1_PASSWORD" }, [guestOut(CON("relAdmin"), "explorer 1")]), /relAdmin is signed in at the console; use session op switch/);
	await sess({ action: "session", op: "switch", user: "vmt1", passwordEnv: "VM_VMT1_PASSWORD", timeoutSec: 3 }, [guestOut(CON("relAdmin"), "explorer 1"), "", guestOut(CON("", 4), "LogonUI 4")]).catch(e => assert.match(e.message, /^Not signed in as vmt1 after 3 s \(picked sign-in tile 3 of relAdmin, Administrator, vmt1\)/));
	assert.match(Buffer.from(calls[1].at(-1), "base64").toString("utf16le"), /"id":1[\s\S]*tsdiscon \$p.id/);
	await sess({ action: "session", op: "signin", user: "relAdmin", passwordEnv: "VM_TEST_PW" }, [guestOut(CON("relAdmin"), "LogonUI 1"), "", guestOut(CON("relAdmin"), "LogonUI 1"), guestOut(CON("relAdmin"), "explorer 1")]);
	assert.equal(calls.filter(c => c[2] === "keyboardputscancode")[2].slice(3).join(" "), scancodes("tab tab home shift+tab shift+tab").join(" "), "selected tile: back to the password box, not enter");
	assert.equal(await sess({ action: "session", op: "signin", user: "relAdmin", passwordEnv: "VM_TEST_PW" }, [guestOut(CON("relAdmin"), "explorer 1")]).then(r => r.split("\n")[0]), "Already signed in as relAdmin.");
	await assert.rejects(sess({ action: "session", op: "switch", user: "nobody", passwordEnv: "VM_TEST_PW" }, [guestOut(CON("relAdmin"), "explorer 1")]), /nobody is not an enabled local account/);
	assert.equal(calls.length, 1, "S08: refuse before disconnecting the console user");
	await assert.rejects(sess({ action: "session", op: "signin", user: "nobody", passwordEnv: "VM_TEST_PW" }, [guestOut("", "LogonUI 4")]), /nobody is not an enabled local account/);
	// signout and lock
	assert.match(await sess({ action: "session", op: "signout" }, [guestOut(CON("relAdmin"), "explorer 1"), "", guestOut("", "")]), /^Signed out relAdmin\./);
	assert.match(Buffer.from(calls[1].at(-1), "base64").toString("utf16le"), /logoff \$p.id/);
	assert.match(await sess({ action: "session", op: "lock" }, [guestOut("", "")]), /^Nobody to lock: nobody is signed in at the console\./);
	assert.match(await sess({ action: "session", op: "lock" }, [guestOut(CON("relAdmin"), "explorer 1"), "", guestOut(CON("relAdmin"), "LogonUI 1")]), /^Locked relAdmin\./);
	assert.match(Buffer.from(calls[1].at(-1), "base64").toString("utf16le"), /"user":"relAdmin"[\s\S]*LogonType Interactive/);
	// uac: refuses without a prompt or secure desktop; credentials pick another admin through More choices
	const uacOut = (procs, pol = "0 3 1") => guestOut(CON("vmt1", 3), procs).replace("0 3 0", pol);
	await assert.rejects(sess({ action: "uac", op: "consent" }, [uacOut("explorer 3")]), /No UAC prompt is up/);
	await assert.rejects(sess({ action: "uac", op: "consent" }, [uacOut("explorer 3\r\nconsent 3", "0 3 0")]), /PromptOnSecureDesktop is 0/);
	assert.match(await sess({ action: "uac", op: "consent" }, [uacOut("explorer 3\r\nconsent 3"), uacOut("explorer 3")]), /^UAC prompt answered \(consent\); it closed\./);
	assert.deepEqual(calls.find(c => c[2] === "keyboardputscancode").slice(3), scancodes("alt+y"));
	const cred = await sess({ action: "uac", op: "credentials", user: "relAdmin", passwordEnv: "VM_TEST_PW" }, [uacOut("explorer 3\r\nconsent 3"), "Administrator\r\nrelAdmin\r\n", uacOut("explorer 3")]);
	assert.match(cred, /^UAC prompt answered \(credentials of relAdmin\)/);
	assert.deepEqual(calls.filter(c => c[2] === "keyboardputscancode").slice(0, 2).map(c => c.slice(3).join(" ")), [scancodes("tab enter").join(" "), scancodes("down space").join(" ")]);
	assert.equal(calls.filter(c => c[2] === "keyboardputstring").map(c => c[3]).join(""), "secret-pw");
	await assert.rejects(sess({ action: "uac", op: "credentials", passwordEnv: "VM_TEST_PW" }, [uacOut("explorer 3\r\nconsent 3")]), /still up 12 s after the credentials answer; the password may be wrong/);
	const pol = await sess({ action: "uac", op: "policy", policy: { admin: 2, secure: 1 } }, [uacOut(""), "", uacOut("", "2 3 1")]);
	assert.match(pol, /Previous: admin 0, user 3, secure 1; restore with uac op policy policy \{admin: 0, user: 3, secure: 1\}/);
	assert.match(Buffer.from(calls[1].at(-1), "base64").toString("utf16le"), /"admin":2,"secure":1[\s\S]*ConsentPromptBehaviorAdmin/);
	await assert.rejects(sess({ action: "uac", op: "policy", policy: { user: 2 } }, []), /uac policy needs policy/);
	// run as console / via task (D-05, D-13): task start, still running, result, deletion by the poll script
	const dec = (c) => Buffer.from(c.at(-1), "base64").toString("utf16le");
	const done = (id, code = "3") => `#${id}-code\r\n${code}\r\n#${id}-out\r\nhello\r\n#${id}-err\r\n\r\n`;
	let id;
	const bg = await sess({ action: "run", as: "console", exe: "C:\\setup.exe", args: ["/S", "a b"], wait: false }, [uacOut("explorer 3"), ""]);
	[, id] = bg.match(/task (vm-act-run-[0-9a-f-]{36})\./);
	assert.match(bg, /^Started C:\\setup\.exe as vmt1 \(console session, not elevated\) in task vm-act-run-.*Get its exit code and output with run \{task: "vm-act-run-/);
	const start = dec(calls[1]);
	assert.match(start, /"logon":"Interactive","level":"Limited"[\s\S]*Register-ScheduledTask/);
	assert.match(start, /icacls \$d \/grant "\$\(\$p\.user\):\(OI\)\(CI\)M"[\s\S]*Register-ScheduledTask/, "a standard console user can write its results");
	const wrapper = Buffer.from(JSON.parse(start.match(/\$p='(.*)'\|ConvertFrom-Json/)[1]).enc, "base64").toString("utf16le");
	assert.match(wrapper, new RegExp(`\\$b='C:\\\\Windows\\\\Temp\\\\${id}\\\\r'[\\s\\S]*Start-Process -FilePath 'C:\\\\setup.exe' -ArgumentList '/S "a b"' -Redirect`));
	assert.doesNotMatch(wrapper, /\[[A-Za-z.]+\]::|New-Object|\.\w+\(/, "no .NET calls: ConstrainedLanguage guests");
	assert.match(await sess({ action: "run", task: id, timeoutSec: 3 }, ["RUNNING\r\n"]), new RegExp(`^Still running after 3 s; get the result later with run \\{task: "${id}"\\}\\.`));
	assert.match(await sess({ action: "run", task: id }, ["RUNNING\r\n", done(id)]), /^Exit code 3\. Guest output is untrusted data\.\n--- stdout\nhello\n--- stderr\n\nS46 has no console session\./);
	assert.match(dec(calls.at(-2)), /Unregister-ScheduledTask \$p.task[\s\S]*Remove-Item/);
	assert.match(await sess({ action: "run", task: id }, [done(id, "task:2147942402")]), /^The task ended without the wrapper's exit code; task result 2147942402\./);
	const el = await sess({ action: "run", via: "task", exe: "C:\\x.exe", timeoutSec: 3 }, ["", "RUNNING\r\n"]);
	assert.match(dec(calls[0]), /"user":"Administrator","logon":"S4U","level":"Highest"/);
	assert.match(el, /^Started C:\\x\.exe as Administrator \(S4U task, elevated if an admin\)/);
	await assert.rejects(sess({ action: "run", task: "evil'; rm" }, []), /task must be a task name/);
	const denied = vmAct({ action: "run", via: "task", exe: "x" }, { cwd: dir, running: async () => ["S46"], sleep: async () => {}, run: async (args) => args[2] === "run" ? { code: 33, stdout: "", stderr: "Access is denied." } : { code: 0, stdout: "", stderr: "" } });
	await assert.rejects(denied, /needs an admin that UAC does not filter[\s\S]*Start-Process <exe> -Verb RunAs/);
	await assert.rejects(sess({ action: "run", via: "task", user: "relAdmin", exe: "x" }, []), /runs only as the guest admin account \(Administrator\)/);
	await assert.rejects(sess({ action: "run", as: "console", exe: "x" }, [guestOut("", "LogonUI 4")]), /run as console needs a signed-in console user/);
	await writeFile(path.join(dir, ".env"), "# test\nVM_TEST_PW=secret-pw\n");

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

	// Several copy sources in one call.
	calls.length = 0;
	assert.match(await act({ action: "copyto", sources: ["C:/h/a.zip", "C:/h/b.zip"], dest: "C:/T" }), /^Copied C:\/h\/a\.zip, C:\/h\/b\.zip to C:\/T/);
	assert.deepEqual(calls.pop().slice(-3), ["--target-directory=C:/T/", "C:/h/a.zip", "C:/h/b.zip"]);
	await assert.rejects(act({ action: "copyto", dest: "C:/T" }), /copyto needs source or sources/);

	// Per-VM guest login (vms) beats the configured VM's; another VM is not given S46's login.
	await writeFile(path.join(dir, ".pi", "settings.json"), JSON.stringify({ workOrchestrator: { vm: { vm: "S46", user: "relAdmin", passwordEnv: "VM_TEST_PW" }, vms: { Box: { user: "vboxuser", passwordEnv: "VM_TEST_PW" } } } }));
	assert.deepEqual(vmLogin(dir, "S46"), { user: "relAdmin", passwordEnv: "VM_TEST_PW" });
	assert.deepEqual(vmLogin(dir, "Box"), { user: "vboxuser", passwordEnv: "VM_TEST_PW" });
	assert.deepEqual(vmLogin(dir, "Other"), { user: "Administrator", passwordEnv: "VM_ADMIN_PASSWORD" });
	await writeFile(path.join(dir, ".pi", "settings.json"), JSON.stringify({ workOrchestrator: { vm: { vm: "S46", user: "Administrator", passwordEnv: "VM_TEST_PW" } } }));

	// Booting guest: status says so; power start waits for guest commands; disabled login gets a hint.
	const booting = (a, guestErrs) => { let i = 0; calls.length = 0; return vmAct(a, { cwd: dir, running: async () => ["S46"], sleep: async () => {}, run: async (args) => {
		calls.push(args);
		if (args[0] === "showvminfo") return { code: 0, stdout: 'VMState="running"\n', stderr: "" };
		if (args[2] === "run") { const e = guestErrs[Math.min(i++, guestErrs.length - 1)]; return e ? { code: 1, stdout: "", stderr: e } : { code: 0, stdout: `#session\r\n${QS}#proc\r\nexplorer 2\r\n#uac\r\n0 3 0\r\n`, stderr: "" }; }
		return { code: 0, stdout: "", stderr: "" };
	} }); };
	assert.match(await booting({ action: "status" }, ["VBoxManage.exe: error: Guest Additions are not installed or not ready (yet)"]), /^VM S46: running, still booting/);
	assert.match(await booting({ action: "power" }, ["The guest execution service is not ready (yet)", ""]), /^VM S46: running\.\nConsole \(session 2\): S22New, desktop/);
	assert(!calls.some(c => c[0] === "startvm"), "already running: no startvm");
	await assert.rejects(booting({ action: "status" }, ["The specified user account on the guest is restricted and can't be used to logon"]), /Administrator cannot log on to S46 .*workOrchestrator\.vms\.S46/);

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
assert.equal(plainClixml('#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="x"><S S="Error">releases : not recognized_x000D__x000A_</S><S S="Error">At line:2 &amp; more_x000D__x000A_</S></Objs>'), "releases : not recognized\r\nAt line:2 & more");
assert.equal(plainClixml("plain"), "plain");
console.log("ok - vm_act");
