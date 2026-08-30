#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	closeWorkItem,
	createWorkItem,
	initStore,
} from "../extensions/work-store.js";
import {
	fileArtifact,
	inferVerificationContract,
	inlineResultArtifact,
	validateExecutableVerificationContract,
	validateVerificationContract,
	verificationContractStatus,
	verificationProofRecord,
	verificationWaiverRecord,
} from "../extensions/work-verification-contract.js";

const operation = (command, value = "0") => ({
	command,
	timeoutMs: 10_000,
	expectedExit: 0,
	assertions: [{ target: "exit", operator: "equals", value }],
});
const browser = inferVerificationContract(
	"Verify browser interaction, responsive screenshot, accessibility, and console cleanliness.",
	"browser acceptance",
	{ command: "node test.mjs" },
);
assert.deepEqual(
	browser.required.map(({ capability, proof }) => `${capability}:${proof}`),
	["command:test", "browser:interaction", "browser:visual", "browser:logs"],
);
validateExecutableVerificationContract(browser);
assert.throws(
	() =>
		validateExecutableVerificationContract(
			inferVerificationContract("test the result"),
		),
	/operation is required/,
);
assert.throws(
	() =>
		validateVerificationContract({
			version: 1,
			required: [
				{
					id: "x",
					capability: "browser",
					proof: "visual",
					source: "one",
				},
				{
					id: "x",
					capability: "command",
					proof: "test",
					source: "two",
				},
			],
		}),
	/duplicated/,
);

const cwd = mkdtempSync(path.join(os.tmpdir(), "work-verification-contract-"));
try {
	writeFileSync(path.join(cwd, "screen.png"), "screen-v1");
	writeFileSync(path.join(cwd, "console.log"), "clean");
	const revision = "workspace-sha256:revision-1";
	const adapter = (capability) => ({
		type: "adapter",
		id: `test-${capability}`,
		version: "1",
		capability,
	});
	const item = {
		verificationContract: browser,
		verificationRevision: revision,
		evidence: [
			verificationProofRecord(browser, "check", {
				targetRevision: revision,
				issuer: adapter("command"),
				operation: browser.required[0].operation,
				artifacts: [inlineResultArtifact("result", "tests passed")],
			}),
			verificationProofRecord(browser, "browser-interaction", {
				targetRevision: revision,
				issuer: adapter("browser"),
				artifacts: [inlineResultArtifact("result", "flows passed")],
			}),
			verificationProofRecord(browser, "browser-visual", {
				targetRevision: revision,
				issuer: adapter("browser"),
				artifacts: [fileArtifact(cwd, "screenshot", "screen.png")],
				inspection: {
					by: "goal",
					summary: "Hierarchy, spacing, focus, and responsive layout are coherent.",
				},
			}),
			verificationProofRecord(browser, "browser-logs", {
				targetRevision: revision,
				issuer: adapter("browser"),
				artifacts: [fileArtifact(cwd, "log", "console.log")],
			}),
		],
	};
	assert.equal(verificationContractStatus(item, { cwd }).ok, true);
	assert.throws(
		() =>
			verificationProofRecord(browser, "browser-interaction", {
				targetRevision: revision,
				issuer: { type: "goal", id: "self" },
				artifacts: [inlineResultArtifact("result", "claimed")],
			}),
		/coded adapter|trusted browser issuer/,
	);
	writeFileSync(path.join(cwd, "screen.png"), "screen-v2");
	assert.deepEqual(verificationContractStatus(item, { cwd }).stale, [
		"browser-visual",
	]);
	item.evidence.push(
		verificationProofRecord(browser, "browser-visual", {
			status: "BLOCKED",
			blocker: {
				code: "browser-unavailable",
				resumeAction: "Install Chromium and resume the same item.",
			},
		}),
	);
	assert.deepEqual(verificationContractStatus(item, { cwd }).blocked, [
		"browser-visual",
	]);

	const separate = {
		version: 1,
		required: [
			{
				id: "tests",
				capability: "command",
				proof: "test",
				source: "tests",
				artifacts: ["result"],
				operation: operation("node tests.mjs"),
			},
			{
				id: "output",
				capability: "command",
				proof: "output",
				source: "output",
				artifacts: ["result"],
				operation: operation("node report.mjs"),
			},
		],
	};
	const oneProof = {
		verificationContract: separate,
		verificationRevision: revision,
		evidence: [
			verificationProofRecord(separate, "tests", {
				targetRevision: revision,
				issuer: adapter("command"),
				artifacts: [inlineResultArtifact("result", "ok")],
			}),
		],
	};
	assert.deepEqual(verificationContractStatus(oneProof).missing, ["output"]);
	assert.equal(
		verificationContractStatus({}, { requireContract: true }).ok,
		false,
	);

	const inspection = {
		version: 1,
		required: [
			{
				id: "inspect",
				capability: "inspection",
				proof: "approval",
				source: "acceptance",
				artifacts: ["result"],
			},
		],
	};
	const store = initStore(cwd);
	createWorkItem(store, {
		id: "work-0",
		type: "task",
		status: "in_progress",
		title: "Legacy executable",
	});
	assert.throws(
		() => closeWorkItem(store, "work-0", {}, { cwd }),
		/without a verification contract/,
	);
	createWorkItem(store, {
		id: "work-open",
		type: "task",
		status: "open",
		title: "Open close bypass",
	});
	assert.throws(
		() => closeWorkItem(store, "work-open", {}, { cwd }),
		/without a verification contract/,
	);
	createWorkItem(store, {
		id: "work-1",
		type: "task",
		status: "in_progress",
		title: "Guarded close",
		verificationContract: inspection,
		verificationRevision: revision,
	});
	assert.throws(() => closeWorkItem(store, "work-1", {}, { cwd }), /incomplete/);
	const decision = {
		kind: "human-decision",
		id: "decision-1",
		source: "user",
		approved: true,
		proofIds: ["inspect"],
	};
	store.items["work-1"].evidence.push(decision);
	store.items["work-1"].verificationWaivers = [
		verificationWaiverRecord(inspection, "inspect", {
			targetRevision: revision,
			authority: {
				type: "human",
				id: "user",
				decisionId: "decision-1",
			},
			rationale: "User explicitly accepted inspection-only closure.",
		}),
	];
	assert.equal(verificationContractStatus(store.items["work-1"]).ok, true);
	assert.equal(closeWorkItem(store, "work-1", {}, { cwd }).status, "closed");
} finally {
	rmSync(cwd, { recursive: true, force: true });
}

console.log("work verification contracts: PASS");
