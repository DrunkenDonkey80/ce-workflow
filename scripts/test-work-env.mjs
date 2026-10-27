// /wo env: the variable names are picked from the last reply; the permanent write (non-Windows) replaces, quotes and keeps the rest.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { envNamesFromText, parseEnvLines, setPermanent } from "../extensions/work-env.ts";

const reply = "Go to https://sketchfab.com/signup.\nOpen Settings → Password & API and copy the API token. Save it as a Windows user environment variable named SKETCHFAB_TOKEN. Don't paste it into chat.\nThe plan stays a DRAFT_STATE note.";
assert.deepEqual(envNamesFromText(reply), ["SKETCHFAB_TOKEN"], "a name in a sentence about a variable wins over other UPPER_SNAKE words");
assert.deepEqual(envNamesFromText("Run with NODE_ENV set."), ["NODE_ENV"], "falls back to any UPPER_SNAKE word");
assert.deepEqual(envNamesFromText("Nothing here, just HTTP and API."), [], "no underscore, no guess");

assert.deepEqual(envNamesFromText("Set SHOP_USER and SHOP_PASSWORD as environment variables. Keep SHOP_USER private."), ["SHOP_USER", "SHOP_PASSWORD"], "every asked-for name, once");
assert.deepEqual(parseEnvLines("# login\nSHOP_USER = bob\n\nexport SHOP_PASSWORD=\"a=b c\"\r\nKEY=\nODD"), [{ name: "SHOP_USER", value: "bob" }, { name: "SHOP_PASSWORD", value: "a=b c" }, { name: "KEY", value: "" }, { name: "ODD", value: "" }], ".env lines: comments, export, quotes, = in values; empty values stay for the caller to refuse");
if (process.platform !== "win32") {
	const home = mkdtempSync(path.join(os.tmpdir(), "wo-env-"));
	try {
		writeFileSync(path.join(home, ".profile"), "PATH=$PATH:/x\nexport KEY_A='old'\n");
		assert.equal(await setPermanent("KEY_A", "it's new", home), "~/.profile");
		assert.equal(readFileSync(path.join(home, ".profile"), "utf8"), "PATH=$PATH:/x\nexport KEY_A='it'\\''s new'\n");
	} finally { rmSync(home, { recursive: true, force: true }); }
}
console.log("work-env ok");
