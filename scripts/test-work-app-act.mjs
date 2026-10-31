import assert from "node:assert/strict";
import { appAct, appActTool, hotkey, parseKeys, resetSession, risky, toElements } from "../extensions/app-act.ts";

const frame = (y, w = 100) => ({ x: 10, y, width: w, height: 20 });
const node = (role, extra, path, y) => ({ role, subrole: "", title: "", desc: "", value: "", id: "", frame: frame(y), path, ...extra });

// Elements: static text shows its text, made-up ids hidden, containers, splitters and invisible items dropped.
const els = toElements([
	node("AXWindow", { title: "Archives" }, [], 0),
	node("AXGroup", { id: "_NS:12" }, [0], 10),
	node("AXStaticText", { value: "Products" }, [0, 0], 20),
	node("AXButton", { title: "Distribute App", id: "_NS:14" }, [1], 30),
	node("AXButton", { subrole: "AXCloseButton" }, [2], 40),
	node("AXSplitter", { value: "245" }, [3], 50),
	node("AXButton", { frame: { x: 0, y: 0, width: 0, height: 0 } }, [4], 0),
	node("AXCheckBox", { title: "Strip", value: "1", disabled: true }, [5], 60),
], "Archives");
assert.deepEqual(els.map(e => [e.type, e.label, e.value, e.id]), [["Window", "Archives", "", ""], ["StaticText", "Products", "", ""], ["Button", "Distribute App", "", ""], ["Button", "CloseButton", "", ""], ["CheckBox", "Strip", "1", ""]]);
assert.equal(els[4].disabled, true);
assert.deepEqual(els[2].ax, { role: "AXButton", title: "Distribute App", desc: "", id: "_NS:14" }, "raw attributes go back to the helper for its check");

// Keys and hotkeys.
assert.deepEqual(parseKeys("cmd+shift+k"), { code: 40, flags: 0x100000 | 0x20000 });
assert.deepEqual(parseKeys("Escape"), { code: 53, flags: 0 });
assert.throws(() => parseKeys("hyper+k"), /modifier/);
assert.throws(() => parseKeys("cmd+ü"), /Unknown key/);
assert.equal(hotkey("B", 0, 0), "cmd+b");
assert.equal(hotkey("B", 1 | 2, 0), "option+shift+cmd+b");
assert.equal(hotkey("0", 4 | 8, 0), "ctrl+0", "8 means no command key");
assert.equal(hotkey(String.fromCharCode(0xf708), 1 | 8, 0), "shift+f5");
assert.equal(hotkey("", 0, 100), "cmd+left");
assert.equal(hotkey("", 0, 0), "");
assert(risky("Upload") && risky("Distribute") && risky("Move to Trash") && !risky("Validate App") && !risky("Next"));

// A fake helper: one window whose button opens a sheet.
let sheet = false;
const calls = [];
const tree = () => ({ window: "Archives", windows: ["Archives"], front: false, nodes: [
	node("AXButton", { title: "Distribute App" }, [0], 10),
	node("AXButton", { title: "Upload" }, [1], 40),
	node("AXTextField", { desc: "Name", value: "Belot" }, [2], 70),
	...sheet ? [node("AXButton", { title: "Cancel" }, [3], 100)] : [],
] });
const helper = async req => {
	calls.push(req);
	if (req.op === "apps") return { apps: [{ name: "Xcode", bundle: "com.apple.dt.Xcode", pid: 42, front: false }] };
	if (req.op === "tree") return tree();
	if (req.op === "menus") return { items: [{ path: ["Product", "Build"], enabled: false, char: "B", mods: 0, glyph: 0, mark: false }, { path: ["Product", "Scheme", "Belot"], enabled: true, char: "", mods: 0, glyph: 0, mark: true }] };
	if (req.op === "press") { sheet = true; return tree(); }
	if (req.op === "menu" || req.op === "type" || req.op === "key") return tree();
	throw new Error("unexpected op " + req.op);
};
const asked = [];
const o = { helper, confirm: async title => (asked.push(title), true) };

assert.match(await appAct(null, { action: "apps" }, o), /Xcode \(com\.apple\.dt\.Xcode, pid 42\)/);
await assert.rejects(appAct(null, { action: "snapshot", app: "Xcode" }, { helper }), /no dialog to ask/);
await assert.rejects(appAct(null, { action: "snapshot", app: "Xcode" }, { helper, confirm: async () => false }), /did not allow/);

const snap = await appAct(null, { action: "snapshot", app: "Xcode" }, o);
assert.match(snap, /UNTRUSTED/);
assert.match(snap, /\[e1\] Button "Distribute App"/);
assert.match(snap, /app is in the background/);
assert.deepEqual(asked, ["Let the agent read and operate Xcode?"], "the app is allowed once per session");
await appAct(null, { action: "snapshot", app: "Xcode" }, o);
assert.equal(asked.length, 1);

// press by query: sends the path and raw attributes, returns only what changed.
const pressed = await appAct(null, { action: "press", app: "Xcode", query: "Distribute App" }, o);
assert.deepEqual(calls.at(-1).path, [0]); assert.equal(calls.at(-1).expect.title, "Distribute App"); assert.equal(calls.at(-1).win, "Archives");
assert.match(pressed, /^Done\. Changes/); assert.match(pressed, /\+ \[e4\] Button "Cancel"/);
assert.equal(asked.at(-1), 'Press "Distribute App" in Xcode?', "distribute asks: the sheet's Distribute button uploads at once");

// Risky buttons ask each time; a No stops the press.
const before = calls.length;
await assert.rejects(appAct(null, { action: "press", app: "Xcode", ref: "e2" }, { ...o, confirm: async () => false }), /did not allow pressing "Upload"/);
assert.equal(calls.length, before, "a refused press sends nothing");
await appAct(null, { action: "press", app: "Xcode", ref: "e2" }, o);
assert.equal(asked.at(-1), 'Press "Upload" in Xcode?');

// type into a field by ref; key and menu pass through.
await appAct(null, { action: "type", app: "Xcode", ref: "e3", text: "Hello", submit: true }, o);
assert.deepEqual([calls.at(-1).op, calls.at(-1).text, calls.at(-1).submit, calls.at(-1).expect.desc], ["type", "Hello", true, "Name"]);
assert.equal(await appAct(null, { action: "key", app: "Xcode", keys: "cmd+b", settleMs: 0 }, o), "Done.");
assert.deepEqual([calls.at(-1).code, calls.at(-1).flags], [11, 0x100000]);
const menus = await appAct(null, { action: "menus", app: "Xcode" }, o);
assert.match(menus, /Product > Build {2}\[cmd\+b\] {2}\(disabled\)/); assert.match(menus, /Product > Scheme > Belot {2}✓/);
assert.match(await appAct(null, { action: "menus", app: "Xcode", query: "scheme" }, o), /^.*\n1 menu items/);
await appAct(null, { action: "menu", app: "Xcode", path: "Product > Build" }, o);
assert.deepEqual(calls.at(-1).path, ["Product", "Build"]);
await assert.rejects(appAct(null, { action: "press", app: "Xcode", ref: "e99" }, o), /Unknown ref/);
await assert.rejects(appAct(null, { action: "press", app: "Xcode", query: "Nothing here" }, o), /Nothing in the last snapshot/);

resetSession();
await assert.rejects(appAct(null, { action: "find", app: "Xcode", query: "x" }, o), /No snapshot yet/);
assert.equal(appActTool(() => {}).name, "app_act");
console.log("app-act ok");
