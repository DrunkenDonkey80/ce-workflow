import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	collectWorkFleet,
	fleetMessageTarget,
	fleetStatusSymbol,
	normalizeFleetState,
	groupWorkFleet,
	openWorkFleet,
	sendFleetMessage,
	transcriptEvents,
	WorkFleetComponent,
} from "../extensions/work-fleet.js";

const store = {
	items: {
		"Task-4": {
			id: "Task-4",
			title: "Task Four",
			status: "in_progress",
			updatedAt: "2026-01-01T00:00:00Z",
		},
		"Task-5": {
			id: "Task-5",
			title: "Task Five",
			status: "closed",
			updatedAt: "2026-01-02T00:00:00Z",
		},
	},
};
const tasks = groupWorkFleet(store, [
	{
		workflowRunId: "workflow-4",
		workItemId: "Task-4",
		runId: "run-4",
		asyncDir: "C:/tmp/run-4",
		cwd: "C:/repo",
		state: "running",
		updatedAt: 10,
		status: {},
		steps: [
			{ index: 0, agent: "ce-plan", status: "completed", lastActivityAt: 20 },
			{ index: 1, agent: "ce-review", status: "running", lastActivityAt: 10 },
		],
	},
	{
		workflowRunId: "workflow-5",
		workItemId: "Task-5",
		runId: "run-5",
		asyncDir: "C:/tmp/run-5",
		cwd: "C:/repo",
		state: "failed",
		updatedAt: 100,
		status: {},
		steps: [{ index: 0, agent: "ce-worker", status: "failed" }],
	},
]);

assert.equal(tasks.length, 2, "runs group under native work tasks");
assert.equal(
	tasks[0].id,
	"Task-4",
	"active tasks sort before newer terminal tasks",
);
assert.deepEqual(
	tasks[0].agents.map((agent) => agent.name),
	["ce-review", "ce-plan"],
	"active subagents sort first",
);
assert.equal(tasks[0].key, "task:Task-4", "task keys are stable");
assert.equal(
	tasks[0].agents[0].key,
	"agent:workflow-4:1",
	"subagent keys are stable",
);
assert.deepEqual(
	[
		"running",
		"queued",
		"needs_human",
		"paused",
		"completed",
		"stopped",
		"failed",
	].map(fleetStatusSymbol),
	["●", "◦", "?", "‖", "✓", "■", "✗"],
	"orchestrator and agent status symbols remain stable",
);
assert.equal(
	normalizeFleetState("waiting_usage_limit"),
	"paused",
	"usage waits remain visibly distinct from stopped runs",
);

const selected = tasks[0].agents[0];
assert.deepEqual(
	fleetMessageTarget(selected),
	{ id: "run-4", index: 1 },
	"message target uses the selected live child",
);
assert.equal(
	fleetMessageTarget(tasks[0].agents[1]),
	undefined,
	"terminal children cannot receive messages",
);

let request;
const listeners = new Map();
const pi = {
	events: {
		on(name, handler) {
			listeners.set(name, handler);
			return () => listeners.delete(name);
		},
		emit(name, payload) {
			assert.equal(name, "subagents:rpc:v1:request");
			request = payload;
			listeners.get(`subagents:rpc:v1:reply:${payload.requestId}`)?.({
				success: true,
				data: { state: "delivered" },
			});
		},
	},
};
await sendFleetMessage(pi, selected, "  please finish  ");
assert.equal(
	request.method,
	"steer",
	"messages use supported pi-subagents steering RPC",
);
assert.deepEqual(
	request.params,
	{ id: "run-4", index: 1, message: "please finish" },
	"steering targets only the selected subagent",
);

let unsubscribeCalls = 0;
let clearedTimers = 0;
const clearTimeoutOriginal = globalThis.clearTimeout;
globalThis.clearTimeout = (timer) => {
	clearedTimers++;
	return clearTimeoutOriginal(timer);
};
try {
	await assert.rejects(
		sendFleetMessage(
			{
				events: {
					on() {
						return () => unsubscribeCalls++;
					},
					emit() {
						throw new Error("emit failed");
					},
				},
			},
			selected,
			"retry",
		),
		/emit failed/,
		"emit failures reject the RPC",
	);
} finally {
	globalThis.clearTimeout = clearTimeoutOriginal;
}
assert.equal(
	unsubscribeCalls,
	1,
	"emit failures unsubscribe the reply listener",
);
assert.equal(clearedTimers, 1, "emit failures clear the RPC timeout");

const fleetDir = mkdtempSync(join(tmpdir(), "work-fleet-"));
try {
	const pendingFile = join(
		fleetDir,
		".pi",
		"work-runs",
		"direct",
		"pending-direct.jsonl",
	);
	mkdirSync(join(fleetDir, ".pi", "work-runs", "direct"), { recursive: true });
	writeFileSync(pendingFile, '{"type":"pending","workflowRunId":"run"}\n');
	assert.deepEqual(
		collectWorkFleet(fleetDir, {
			readFile(file, encoding) {
				if (file === pendingFile) unlinkSync(file);
				return readFileSync(file, encoding);
			},
		}).rows,
		[],
		"a pending-run file removed during refresh produces an empty snapshot",
	);

	const supportSnapshot = collectWorkFleet(fleetDir, {
		orchestrator: {
			id: "goal-1",
			targetId: "Task-4",
			name: "Orchestrator · Task Four",
			state: "needs_human",
			updatedAt: 30,
			iteration: 2,
		},
		loadLanes: () => ({
			lanes: {
				prefetch: {
					id: "prefetch",
					workItemId: "Task-4",
					producer: "work-prefetch",
					laneKind: "successor-prefetch",
					state: "running",
					timestamps: { updatedAt: "2026-01-03T00:00:00Z" },
				},
			},
		}),
		loadVerifiers: () => ({
			batches: {
				batch: { id: "batch", workItemId: "Task-4" },
				background: { id: "background" },
			},
			jobs: {
				verifier: {
					id: "verifier",
					batchId: "batch",
					model: "zai/glm-5.2",
					status: "completed",
					createdAt: "2026-01-04T00:00:00Z",
				},
				"background-done": {
					id: "background-done",
					batchId: "background",
					model: "old-model",
					status: "completed",
				},
				"background-live": {
					id: "background-live",
					batchId: "background",
					model: "live-model",
					status: "running",
				},
			},
		}),
	});
	assert.equal(
		supportSnapshot.tasks[0].kind,
		"orchestrator",
		"the main-chat autonomous run is the Fleet root",
	);
	assert.equal(
		supportSnapshot.tasks[0].state,
		"waiting",
		"a human-decision root stays visible even while a child is running",
	);
	assert.deepEqual(
		supportSnapshot.tasks[0].agents.map((agent) => agent.name).sort(),
		[
			"Task-4 · Verifier · zai/glm-5.2",
			"Task-4 · work-prefetch",
			"Verifier · live-model",
		],
		"target agents and active unassociated work appear beneath the orchestrator",
	);

	const recentSnapshot = collectWorkFleet(fleetDir, {
		orchestrator: { id: "goal-2", state: "complete" },
		loadLanes: () => ({ lanes: {} }),
		loadVerifiers: () => ({
			batches: { batch: { id: "batch" } },
			jobs: Object.fromEntries(
				Array.from({ length: 25 }, (_, index) => [
					`job-${index}`,
					{
						id: `job-${index}`,
						batchId: "batch",
						model: `model-${index}`,
						status: "completed",
						createdAt: new Date(index * 1_000).toISOString(),
					},
				]),
			),
		}),
	});
	assert.equal(
		recentSnapshot.tasks[0].agents.length,
		20,
		"Fleet bounds recent finished agents",
	);

	mkdirSync(join(fleetDir, ".ce-workflow"), { recursive: true });
	writeFileSync(
		join(fleetDir, ".ce-workflow", "work-items.json"),
		JSON.stringify({
			schemaVersion: 1,
			metadata: {},
			items: {
				"work-3": {
					id: "work-3",
					title: "Misc",
					type: "epic",
					status: "closed",
					updatedAt: "2026-01-05T00:00:00Z",
					dependencies: [],
					labels: [],
					notes: [],
				},
			},
		}),
	);
	writeFileSync(
		join(fleetDir, ".pi", "work-orchestrator-state.json"),
		JSON.stringify({ lastEpicId: "work-3" }),
	);
	const completedSnapshot = collectWorkFleet(fleetDir, {
		loadLanes: () => ({ lanes: {} }),
		loadVerifiers: () => ({ batches: {}, jobs: {} }),
	});
	assert.equal(
		completedSnapshot.tasks[0].name,
		"Orchestrator · Misc",
		"Fleet retains the most recent completed roadmap root",
	);
	assert.equal(completedSnapshot.tasks[0].state, "completed");

	const sessionRoot = join(fleetDir, "session-root");
	const sessionArtifacts = join(sessionRoot, "subagent-artifacts");
	const sessionTranscript = join(
		sessionArtifacts,
		"session-run_work-worker_0_transcript.jsonl",
	);
	mkdirSync(sessionArtifacts, { recursive: true });
	writeFileSync(
		sessionTranscript,
		`${JSON.stringify({ recordType: "message", role: "assistant", text: "session artifact" })}\n`,
	);
	assert.deepEqual(
		transcriptEvents(
			{
				asyncDir: join(fleetDir, ".pi", "subagents", "async", "session-run"),
				cwd: fleetDir,
				index: 0,
				step: { transcriptPath: sessionTranscript },
			},
			{ sessionFile: join(sessionRoot, "parent-session.jsonl") },
		),
		[{ kind: "assistant", text: "session artifact", model: undefined }],
		"Fleet trusts transcripts in the current session-scoped pi-subagents artifact root",
	);
	const outsideDir = join(fleetDir, "forged-async-root");
	const outsideTranscript = join(outsideDir, "outside.jsonl");
	mkdirSync(outsideDir, { recursive: true });
	writeFileSync(
		outsideTranscript,
		`${JSON.stringify({ recordType: "message", role: "assistant", text: "outside" })}\n`,
	);
	assert.deepEqual(
		transcriptEvents(
			{
				asyncDir: outsideDir,
				cwd: fleetDir,
				index: 0,
				step: { transcriptPath: outsideTranscript },
			},
			{ sessionFile: join(sessionRoot, "parent-session.jsonl") },
		),
		[],
		"Fleet does not turn a persisted arbitrary asyncDir into a transcript trust root",
	);

	const output = join(fleetDir, "output-0.log");
	writeFileSync(output, "still running");
	assert.deepEqual(
		transcriptEvents(
			{ asyncDir: fleetDir, cwd: fleetDir, index: 0, step: {} },
			{
				readFile(file, encoding) {
					if (file === output) unlinkSync(file);
					return readFileSync(file, encoding);
				},
			},
		),
		[],
		"a validated fallback output removed before read produces no transcript",
	);
} finally {
	rmSync(fleetDir, { recursive: true, force: true });
}

const failedListeners = new Map();
const tuiKeyInputs = {
	escape: ["\x1b", "\x1b[27u"],
	enter: ["\r", "\x1b[13u"],
	backspace: ["\x1b[127u"],
	up: ["\x1b[57419u"],
	down: ["\x1b[57420u"],
	x: ["\x1b[120u"],
};
let fleetClosed = 0;
const component = new WorkFleetComponent(
	{ terminal: { rows: 24 }, requestRender() {} },
	{
		fg: (_color, text) => text,
		bg: (_color, text) => text,
		bold: (text) => text,
	},
	process.cwd(),
	{
		events: {
			on(name, handler) {
				failedListeners.set(name, handler);
				return () => failedListeners.delete(name);
			},
			emit(_name, payload) {
				failedListeners.get(`subagents:rpc:v1:reply:${payload.requestId}`)?.({
					success: false,
					error: { message: "stale run" },
				});
			},
		},
	},
	() => {
		fleetClosed += 1;
	},
	{
		refreshMs: 60_000,
		matchesKey: (data, key) => tuiKeyInputs[key]?.includes(data) ?? data === key,
		decodeKittyPrintable: (data) => (data === "\x1b[122u" ? "z" : undefined),
	},
);
component.snapshot = { tasks, rows: [selected] };
component.editor = {
	targetKey: selected.key,
	text: "cancel this",
	sending: false,
};
component.handleEditorInput("\r");
component.handleEditorInput("\x1b");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(
	component.editor,
	undefined,
	"Escape safely dismisses an editor while steering settles",
);

component.snapshot = { tasks, rows: tasks[0].agents };
component.selected = 0;
component.handleInput("\x1b[57420u");
assert.equal(component.selected, 1, "Kitty arrow keys navigate Fleet");
component.handleInput("\x1b[57419u");
assert.equal(component.selected, 0, "Kitty arrow keys navigate back");
component.handleInput("\x1b[120u");
assert.equal(
	component.expandedTools,
	true,
	"Kitty printable keys toggle tools",
);
component.handleInput("\x1b[13u");
assert.ok(component.editor, "Kitty Enter opens the message editor");
component.handleEditorInput("\x1b[122u");
assert.equal(component.editor.text, "z", "Kitty printable keys type messages");
component.editor.text = "ab";
component.handleEditorInput("\x1b[127u");
assert.equal(component.editor.text, "a", "Kitty Backspace edits the message");
component.handleEditorInput("\x1b[27u");
assert.equal(
	component.editor,
	undefined,
	"Kitty Escape closes the message editor",
);
component.handleInput("\x1b[27u");
assert.equal(fleetClosed, 1, "Kitty Escape closes Fleet");
component.dispose();

let legacyClosed = 0;
const legacyComponent = new WorkFleetComponent(
	{ terminal: { rows: 24 }, requestRender() {} },
	{
		fg: (_color, text) => text,
		bg: (_color, text) => text,
		bold: (text) => text,
	},
	process.cwd(),
	{ events: { on: () => () => {}, emit() {} } },
	() => {
		legacyClosed += 1;
	},
	{ refreshMs: 60_000 },
);
legacyComponent.snapshot = { tasks, rows: tasks[0].agents };
legacyComponent.handleInput("\x1b[B");
assert.equal(
	legacyComponent.selected,
	1,
	"legacy arrow keys still navigate Fleet",
);
legacyComponent.handleInput("X");
assert.equal(
	legacyComponent.expandedTools,
	true,
	"legacy uppercase shortcuts still work",
);
legacyComponent.handleInput("\x1b");
assert.equal(legacyClosed, 1, "legacy Escape still closes Fleet");
legacyComponent.dispose();

let openedComponent;
await openWorkFleet(
	{
		cwd: process.cwd(),
		mode: "tui",
		ui: {
			custom(factory) {
				openedComponent = factory(
					{ terminal: { rows: 24 }, requestRender() {} },
					{
						fg: (_color, text) => text,
						bg: (_color, text) => text,
						bold: (text) => text,
					},
					undefined,
					() => {},
				);
			},
		},
	},
	{},
	{ refreshMs: 60_000 },
);
openedComponent.snapshot = { tasks, rows: tasks[0].agents };
openedComponent.handleInput("\x1b[B");
assert.equal(
	openedComponent.selected,
	1,
	"Fleet opener works without a standalone pi-tui package",
);
openedComponent.dispose();

process.stdout.write("ok - work fleet fixtures pass\n");
