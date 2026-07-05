#!/usr/bin/env node
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const {
	buildWorkTelemetry,
	buildWorkTelemetryState,
	default: workModelsExtension,
	recordWorkTelemetry,
} = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);
const { installWorkflowFixture } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "work-command-fixture.mjs")),
	).href
);

function assert(ok, message) {
	if (!ok) throw new Error(message);
}

const cwd = mkdtempSync(path.join(tmpdir(), "work-telemetry-"));
const now = Date.now();
try {
	recordWorkTelemetry(cwd, {
		id: "cmd-small",
		timestamp: now,
		type: "command",
		command: "work-small",
		action: "run-implementation",
		epicId: "E-1",
		beadId: "TASK-1",
		durationMs: 120,
		context: { after: { tokens: 1200 } },
	});
	recordWorkTelemetry(cwd, {
		id: "agent-worker",
		timestamp: now + 1,
		type: "agent",
		mode: "resume",
		action: "run-implementation",
		epicId: "E-1",
		beadId: "TASK-1",
		durationMs: 420_000,
		usage: { input: 9000, output: 2000, totalTokens: 11_000, cost: 0.15 },
		context: { before: { tokens: 1200 }, after: { tokens: 18_000 } },
		tools: [{ name: "subagent", runId: "worker-1", durationMs: 390_000 }],
	});
	recordWorkTelemetry(cwd, {
		id: "agent-review",
		timestamp: now + 2,
		type: "agent",
		mode: "resume",
		action: "review",
		epicId: "E-1",
		beadId: "TASK-1",
		durationMs: 180_000,
		usage: { input: 7000, output: 1000, totalTokens: 8000, cost: 0.09 },
		context: { after: { tokens: 24_000 } },
		tools: [{ name: "subagent", runId: "reviewer-1", durationMs: 170_000 }],
	});
	recordWorkTelemetry(cwd, {
		id: "agent-compound",
		timestamp: now + 3,
		type: "agent",
		mode: "debug",
		action: "compound",
		epicId: "E-1",
		beadId: "TASK-1",
		durationMs: 60_000,
		usage: { input: 3000, output: 600, totalTokens: 3600, cost: 0.04 },
		tools: [{ name: "ce-compound", durationMs: 55_000 }],
	});
	recordWorkTelemetry(cwd, {
		id: "agent-commit",
		timestamp: now + 4,
		type: "agent",
		mode: "finish",
		action: "commit",
		epicId: "E-1",
		beadId: "TASK-1",
		durationMs: 30_000,
		usage: { input: 1500, output: 300, totalTokens: 1800, cost: 0.02 },
	});
	recordWorkTelemetry(cwd, {
		id: "cmd-big",
		timestamp: now + 5,
		type: "command",
		command: "work-big",
		action: "run-planner",
		epicId: "E-1",
		beadId: "PLAN-1",
		durationMs: 250,
		context: { after: { tokens: 1300 } },
	});
	recordWorkTelemetry(cwd, {
		id: "agent-planner",
		timestamp: now + 6,
		type: "agent",
		mode: "big",
		action: "run-planner",
		epicId: "E-1",
		beadId: "PLAN-1",
		durationMs: 300_000,
		usage: { input: 6000, output: 1200, totalTokens: 7200, cost: 0.08 },
		context: { after: { tokens: 15_000 } },
	});

	const text = buildWorkTelemetry(cwd, "today");
	assert(text.includes("Work telemetry: today"), "text renders today summary");
	assert(text.includes("work-small"), "text includes work-small command phase");
	assert(text.includes("work-big"), "text includes work-big command phase");
	assert(text.includes("TASK-1"), "text groups by task bead");
	assert(text.includes("24000"), "text reports max context tokens");

	const epic = buildWorkTelemetryState(cwd, "epic E-1");
	assert(epic.events === 7, "epic filter includes all synthetic events");
	assert(epic.totals.tokens === 31_600, "epic totals agent token usage");
	assert(
		epic.byPhase.some((row) => row.key === "agent/resume/review"),
		"phase summary includes review agent",
	);
	assert(
		epic.byPhase.some((row) => row.key === "agent/debug/compound"),
		"phase summary includes compound agent",
	);
	assert(
		epic.byPhase.some((row) => row.key === "agent/finish/commit"),
		"phase summary includes commit agent",
	);

	const bead = JSON.parse(buildWorkTelemetry(cwd, "bead TASK-1 --json"));
	assert(bead.events === 5, "bead filter isolates one task");
	assert(bead.byBead[0].key === "TASK-1", "bead JSON groups by selected bead");
	assert(bead.files.length === 1, "json reports backing telemetry file");

	const fixture = installWorkflowFixture();
	try {
		const commands = {};
		workModelsExtension({
			on: () => {},
			registerCommand: (name, config) => {
				commands[name] = config;
			},
		});
		const sent = [];
		await commands["work-small"].handler("Add tiny thing", {
			cwd,
			getContextUsage: () => ({ tokens: 2222 }),
			sendUserMessage: async (message, options) =>
				sent.push({ message, options }),
			ui: { notify: () => {} },
		});
		const commandSummary = buildWorkTelemetryState(cwd, "bead TASK-NEW-1");
		assert(commandSummary.events === 1, "extension command writes telemetry");
		assert(
			commandSummary.byPhase[0].key === "command/work-small/run-implementation",
			"extension command records command/action phase",
		);
		assert(sent.length === 1, "instrumented command still queues handoff");
		assert(
			fixture
				.logs()
				.some(
					(entry) =>
						entry.op === "update" && entry.notes.includes("telemetry:"),
				),
			"instrumented command appends compact telemetry note to Bead",
		);
	} finally {
		fixture.cleanup();
	}
} finally {
	rmSync(cwd, { recursive: true, force: true });
}

console.log("ok - work telemetry behavior");
