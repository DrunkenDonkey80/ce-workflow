#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createJiti } from "jiti";

const { createCameraState, cameraProject, cameraRequestKey } = await createJiti(import.meta.url).import("../extensions/work-camera-state.ts");
const sandbox = mkdtempSync(join(tmpdir(), "work-camera-state-"));
const project = join(sandbox, "project");
const other = join(sandbox, "other");
const alias = join(sandbox, "alias");
const directory = join(sandbox, "private-camera-state");
const device = { id: "@device_pnp_printer", label: "Printer camera" };
const request = cameraRequestKey({ operation: "capture", count: 1 });
let time = Date.now();
const state = createCameraState({ directory, now: () => time });
mkdirSync(project); mkdirSync(other);
try {
	symlinkSync(project, alias, process.platform === "win32" ? "junction" : "dir");
	assert.equal(cameraProject(alias), cameraProject(project), "canonical aliases bind the same project");
	const pendingAliasScope = await state.revision(alias);
	rmSync(alias);
	symlinkSync(other, alias, process.platform === "win32" ? "junction" : "dir");
	await assert.rejects(state.issue(alias, device, { kind: "time", expiresAt: time + 10000 }, pendingAliasScope, request), /project changed/,
		"retargeting an alias while consent is pending cannot mint another project's grant");
	rmSync(alias);
	symlinkSync(project, alias, process.platform === "win32" ? "junction" : "dir");
	const revision = await state.revision(project);
	const once = await state.issue(project, device, { kind: "once", expiresAt: time + 10000 }, revision, request);
	assert.equal((await state.grant(alias, device)).id, once.id);
	assert.equal(await state.grant(other, device), undefined, "permission cannot transfer projects");
	assert.equal(await state.grant(project, { ...device, id: "@device_pnp_other" }), undefined, "permission cannot transfer devices");
	await assert.rejects(state.claim(project, device, once.id, cameraRequestKey("different request"), 1000), /another request/);
	assert.equal((await state.grant(project, device)).id, once.id, "wrong scope cannot consume the grant");
	const outcomes = await Promise.allSettled([
		state.claim(project, device, once.id, request, 1000),
		state.claim(project, device, once.id, request, 1000),
	]);
	assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1, "only one simultaneous claim succeeds");
	const lease = outcomes.find(result => result.status === "fulfilled").value;
	assert.equal(await state.grant(project, device), undefined, "one-use consent is consumed atomically");
	assert.equal(await state.validate(project, lease), time + 1000);
	await assert.rejects(state.validate(other, lease), /ownership/);
	await assert.rejects(state.worker(other, lease, process.pid), /ownership/);
	await state.release(other, lease);
	await state.validate(project, lease);
	await state.revoke(project);
	await assert.rejects(state.validate(project, lease), /revoked/);
	await state.release(project, lease);

	const oldRevision = await state.revision(project);
	await state.revoke(project);
	await assert.rejects(state.issue(project, device, { kind: "time", expiresAt: time + 10000 }, oldRevision, request), /approval was pending/);
	const timed = await state.issue(project, device, { kind: "time", expiresAt: time + 10000 }, await state.revision(project), request);
	const restarted = createCameraState({ directory, now: () => time });
	assert.equal((await restarted.grant(project, device)).id, timed.id, "time grant survives a fresh controller without starting hardware");
	const timedLease = await state.claim(project, device, timed.id, request, 500);
	const uppercase = { ...device, id: device.id.toUpperCase() };
	const otherGrant = await state.issue(other, uppercase, { kind: "time", expiresAt: time + 10000 }, await state.revision(other), request);
	await assert.rejects(state.claim(other, uppercase, otherGrant.id, request, 1000), /owned by another/, "device ownership is global and case-folded, not project-local");
	time += 501;
	await assert.rejects(state.validate(project, timedLease), /expired/);
	await state.release(project, timedLease);
	const secondLease = await state.claim(project, device, timed.id, request, 500);
	time--;
	await assert.rejects(state.validate(project, secondLease), /Clock moved backwards/);
	await state.release(project, secondLease);
	await state.revoke(project);
	time += 20000;
	assert.equal(await state.grant(other, uppercase), undefined, "expiry prunes permission instead of extending it");

	const file = join(directory, "state.json");
	const good = readFileSync(file, "utf8");
	writeFileSync(file, "not JSON");
	await assert.rejects(state.revision(project), /corrupt/);
	assert.equal(existsSync(join(directory, "state.lock")), false, "failed parsing releases the metadata mutex");
	writeFileSync(file, JSON.stringify({ ...JSON.parse(good), revisions: { wrong: "bad" } }));
	await assert.rejects(state.revision(project), /revocation record/);
	writeFileSync(file, " ".repeat(1024 * 1024 + 1));
	await assert.rejects(state.revision(project), /bounded size/);
	writeFileSync(file, good);
	writeFileSync(join(directory, "state.lock"), "forced-crash fixture");
	await assert.rejects(state.revision(project), /stale lock/);
	assert.equal(readFileSync(file, "utf8"), good, "stale-lock refusal cannot rewrite permission");
	rmSync(join(directory, "state.lock"));
	const forbidden = join(project, "..camera-state");
	await assert.rejects(createCameraState({ directory: forbidden }).revision(project), /outside the project/);
	assert.equal(existsSync(forbidden), false, "invalid storage does not create directories inside the project");
	const moved = await state.issue(project, device, { kind: "time", expiresAt: time + 5000 }, await state.revision(project), request);
	const cleanupLease = await state.claim(project, device, moved.id, request, 1000);
	rmSync(project, { recursive: true });
	await state.release(cleanupLease.project, cleanupLease);
	assert.equal(Object.keys(JSON.parse(readFileSync(file, "utf8")).leases).length, 0, "release works even if its project was removed");
	assert.deepEqual(readdirSync(directory), ["state.json"], "atomic writes leave no mutex/temp artifacts");

	// Two real processes race for the same one-use metadata grant; no camera/backend is involved.
	const atomicDir = join(sandbox, "cross-process-state");
	const atomic = createCameraState({ directory: atomicDir });
	const issued = await atomic.issue(other, device, { kind: "once", expiresAt: Date.now() + 30000 }, await atomic.revision(other), request);
	const module = resolve(import.meta.dirname, "../extensions/work-camera-state.ts");
	const code = `import { createJiti } from "jiti";
const { createCameraState } = await createJiti(import.meta.url).import(process.argv[1]);
const state = createCameraState({ directory: process.argv[2] });
try { await state.claim(process.argv[3], JSON.parse(process.argv[4]), process.argv[5], process.argv[6], 10000); console.log("claimed"); }
catch (error) { console.log("denied"); }`;
	const run = () => new Promise((done, fail) => execFile(process.execPath,
		["--input-type=module", "-e", code, module, atomicDir, other, JSON.stringify(device), issued.id, request],
		{ timeout: 10000 }, (error, stdout) => error ? fail(error) : done(stdout.trim())));
	const claimed = await Promise.all([run(), run()]);
	assert.equal(claimed.filter(value => value === "claimed").length, 1, "cross-process one-use permission has exactly one winner");
	assert.equal(await atomic.grant(other, device), undefined);
} finally { rmSync(sandbox, { recursive: true, force: true }); }
console.log("ok - camera persistent scope, atomic ownership, expiry/revocation, corrupt-store refusal and cross-process one-use claims (no hardware)");
