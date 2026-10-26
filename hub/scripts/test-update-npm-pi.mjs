// An npm-installed Pi (no agent/install/current-version, pi.cmd or bin/pi on PATH): the update check reads Pi's version
// from the package the hub loads its SDK from. Uses this machine's Pi package and asks pi.dev, like the real check.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { piPackage } from "../src/pi-sdk.ts";
import { findUpdates } from "../src/update-check.ts";

const real = piPackage();
const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-npm-pi-")), agent = path.join(root, "agent"), bin = path.join(root, "bin");
fs.mkdirSync(agent);
fs.mkdirSync(path.join(bin, "node_modules", "@earendil-works"), { recursive: true });
fs.symlinkSync(real, path.join(bin, "node_modules", "@earendil-works", "pi-coding-agent"), "junction");
fs.writeFileSync(path.join(bin, "pi.cmd"), "");
process.env.PATH = bin + path.delimiter + process.env.PATH;
try {
	assert.equal(piPackage(agent), path.join(bin, "node_modules", "@earendil-works", "pi-coding-agent"));
	const found = await findUpdates(agent);
	assert(found.pi === null || /^\d+\.\d+\.\d+/.test(found.pi.current), JSON.stringify(found.pi));
	console.log("ok - update check with an npm-installed Pi");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
