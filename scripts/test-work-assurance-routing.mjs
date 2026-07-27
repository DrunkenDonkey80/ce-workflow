#!/usr/bin/env node
import {
	mkdtempSync,
	readFileSync,
	readdirSync,
	writeFileSync,
	mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
	classifyShadowAssurance,
	workflowBehaviorFingerprint,
} from "../extensions/workflow-telemetry.js";
import { seedNativeStore } from "./work-command-fixture.mjs";

const { implementationExecutionPolicy, withCommandTelemetry } = await import(
	pathToFileURL(path.join(import.meta.dirname, "../extensions/work-models.js")).href
);

function assert(ok, message) {
	if (!ok) throw new Error(message);
}

const normal = classifyShadowAssurance({ title: "Update copy" });
assert(
	normal.suggestedAssurance === "normal" &&
		normal.suggestedRole === "work-worker" &&
		normal.warnings.includes("assurance-input-missing"),
	"missing canonical assurance remains normal with an explicit warning",
);

const hard = classifyShadowAssurance({
	title: "Authorization change",
	acceptance: "Preserve public API backward compatibility.",
	notes: 'wo:assurance {"version":1,"level":"normal","reasons":[]}',
});
assert(
	hard.suggestedAssurance === "high" &&
		hard.suggestedRole === "work-lead" &&
		hard.reasons.join(",") ===
			"public-api-protocol-compatibility,security-privacy-money" &&
		hard.warnings.includes("explicit-normal-overridden-by-hard-signal"),
	"canonical normal input cannot waive coded hard signals",
);

const explicitHigh = classifyShadowAssurance({
	title: "Routine edit",
	notes: 'wo:assurance {"version":1,"level":"high","reasons":["owner"]}',
});
assert(
	explicitHigh.requestedAssurance === "high" &&
		explicitHigh.reasons.join(",") === "explicit-assurance-high",
	"canonical v1 assurance can raise the deterministic floor without emitting free-form reasons",
);
assert(
	classifyShadowAssurance({ notes: "wo:assurance nope" }).warnings.includes(
		"assurance-input-malformed",
	),
	"malformed canonical input is explicit telemetry evidence",
);

const input = {
	source: { dirtySourceHash: "a".repeat(64) },
	settings: { workOrchestrator: { profile: "medium" } },
	prompts: { worker: "bounded writer" },
};
const fingerprint = workflowBehaviorFingerprint(input);
assert(
	fingerprint ===
		workflowBehaviorFingerprint({
			prompts: { worker: "bounded writer" },
			settings: { workOrchestrator: { profile: "medium" } },
			source: { dirtySourceHash: "a".repeat(64) },
		}) &&
	fingerprint !==
		workflowBehaviorFingerprint({
			...input,
			settings: { workOrchestrator: { profile: "high" } },
		}) &&
	fingerprint !==
		workflowBehaviorFingerprint({
			...input,
			prompts: { worker: "changed writer prompt" },
		}),
	"canonical source/settings/prompt fingerprints are stable and behavior-sensitive",
);

const cwd = mkdtempSync(path.join(tmpdir(), "work-assurance-routing-"));
mkdirSync(path.join(cwd, ".pi"), { recursive: true });
writeFileSync(
	path.join(cwd, ".pi", "settings.json"),
	JSON.stringify({
		workOrchestrator: { profile: "medium" },
		subagents: {
			agentOverrides: {
				"work-worker": { model: "provider-neutral-model", thinking: "medium" },
				"work-fixer": { model: "provider-neutral-model", thinking: "medium" },
			},
		},
	}),
);
seedNativeStore(cwd, [
	{
		id: "work-fixture",
		issue_type: "task",
		status: "open",
		title: "Concurrency recovery",
		acceptance: "A focused check proves crash recovery is idempotent.",
		notes: 'wo:assurance {"version":1,"level":"normal","reasons":[]}',
	},
]);
const storeFile = path.join(cwd, ".ce-workflow", "work-items.json");
const storeBefore = readFileSync(storeFile, "utf8");
const routeBefore = implementationExecutionPolicy({
	selectedWorkItem: { title: "Concurrency recovery", implementationScope: "medium" },
});
await withCommandTelemetry(
	"work-resume",
	"work-fixture",
	{ cwd, mode: "rpc", getContextUsage: () => undefined },
	async () => ({
		ok: true,
		action: "run-implementation",
		selectedWorkItem: { id: "work-fixture", type: "task" },
		handoffPrompt: "existing worker handoff",
	}),
);
const events = readdirSync(path.join(cwd, ".pi", "work-runs"))
	.filter((name) => name.endsWith(".jsonl"))
	.flatMap((name) =>
		readFileSync(path.join(cwd, ".pi", "work-runs", name), "utf8")
			.trim()
			.split(/\r?\n/)
			.map(JSON.parse),
	);
const decision = events.find(
	(event) => event.type === "command" && event.command === "work-resume",
);
assert(
	decision.version === 1 &&
		decision.mode === "rpc" &&
		decision.shadowAssurance.mode === "shadow" &&
		decision.shadowAssurance.suggestedAssurance === "high" &&
		decision.shadowAssurance.routedRole === "worker" &&
		decision.workflow.behaviorFingerprint,
	"RPC orchestration decisions emit mode, cohort identity, and shadow assurance",
);
assert(
	implementationExecutionPolicy({
		selectedWorkItem: { title: "Concurrency recovery", implementationScope: "medium" },
	}).kind === routeBefore.kind &&
		readFileSync(storeFile, "utf8") === storeBefore,
	"shadow classification changes neither routing nor WorkItem notes",
);

process.stdout.write("ok - shadow assurance routing fixtures\n");
