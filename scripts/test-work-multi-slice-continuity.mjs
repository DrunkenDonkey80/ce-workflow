#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWorkItem, initStore, readyWorkItems, updateWorkItem } from "../extensions/work-store.js";
import { verificationContractStatus, verificationProofRecord } from "../extensions/work-verification-contract.js";

const cwd = mkdtempSync(path.join(os.tmpdir(), "work-multi-slice-"));
const store = initStore(cwd);
const epic = createWorkItem(store, { type: "epic", title: "Mixed roadmap", description: "Stable product capsule", acceptance: "All slices preserve the capsule." });
const contract = (id, capability = "command") => ({ version: 1, required: [{ id, capability, proof: capability === "browser" ? "visual" : "test", source: `${id} acceptance`, ...(capability === "command" ? { operation: { command: "node --version", expectedExit: 0, assertions: [{ target: "exit", operator: "equals", value: "0" }] } } : {}) }] });
const first = createWorkItem(store, { type: "task", parentId: epic.id, title: "First", implementationScope: { outcome: "core", files: ["src/core.js"], surfaces: [], discoveryAllowed: false, nonGoals: [] }, verificationContract: contract("core") });
const proof = verificationProofRecord(first.verificationContract, "core", { status: "PASS", targetRevision: "revision-1", issuer: { type: "adapter", capability: "command", id: "fixture", version: "1" }, operation: { command: "node --version" } });
updateWorkItem(store, first.id, { status: "closed", verificationRevision: "revision-1", evidence: [proof] });
const blocked = createWorkItem(store, { type: "task", parentId: epic.id, title: "Browser blocked", dependencies: [first.id], verificationContract: contract("browser", "browser") });
updateWorkItem(store, blocked.id, { status: "blocked", evidence: [{ kind: "verification-proof", id: "browser", capability: "browser", proof: "visual", status: "BLOCKED", blocker: { code: "browser-unavailable", resumeAction: "Install browser provider." } }] });
const independent = createWorkItem(store, { type: "task", parentId: epic.id, title: "Independent CLI", dependencies: [first.id], implementationScope: { outcome: "report", files: ["src/report.js"], surfaces: ["cli"], discoveryAllowed: false, nonGoals: ["browser"] }, verificationContract: contract("report") });
assert.deepEqual(readyWorkItems(store).map((item) => item.id), [independent.id]);
assert.equal(store.items[epic.id].description, "Stable product capsule");
assert.equal(store.items[independent.id].implementationScope.nonGoals[0], "browser");
assert.deepEqual(verificationContractStatus(store.items[first.id], { revision: "revision-2" }).stale, ["core"], "later-slice revision invalidates prior accepted proof for deterministic rerun");
rmSync(cwd, { recursive: true, force: true });
console.log("multi-slice continuity and affected proof: PASS");
