// pi-lens auto-format: ask once where pi-lens is in use, store the answer in its config, Escape decides nothing.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { lensConfigFile, lensFormatUndecided, registerLensFormatCheck } from "../extensions/work-lens-format.ts";

const home = mkdtempSync(path.join(os.tmpdir(), "wo-lens-")), file = lensConfigFile(home);
const config = () => JSON.parse(readFileSync(file, "utf8"));
async function start(pick, hasUI = true) {
	let start, shown = 0;
	registerLensFormatCheck({ on: (name, fn) => { if (name === "session_start") start = fn; } }, file, async () => { shown++; return pick; });
	start({}, { hasUI });
	await new Promise(resolve => setTimeout(resolve, 0));
	return shown;
}
try {
	assert.equal(lensFormatUndecided(file), false, "no pi-lens directory: never asks");
	assert.equal(await start({ value: "off" }), 0);
	mkdirSync(path.dirname(file));
	assert.equal(await start({ value: "off" }, false), 0, "no UI: never asks");
	assert.equal(await start(undefined), 1, "Escape");
	assert.equal(lensFormatUndecided(file), true, "Escape leaves it undecided");
	writeFileSync(file, JSON.stringify({ tests: { enabled: false } }));
	assert.equal(await start({ value: "off" }), 1);
	assert.deepEqual(config(), { tests: { enabled: false }, format: { enabled: false } }, "other keys kept");
	assert.equal(await start({ value: "off" }), 0, "decided: never asks again");
	writeFileSync(file, "{}");
	await start({ value: "on" });
	assert.deepEqual(config(), { format: { enabled: true } }, "keep is stored too");
	console.log("pi-lens format check passed");
} finally { rmSync(home, { recursive: true, force: true }); }
