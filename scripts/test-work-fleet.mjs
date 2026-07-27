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
	groupWorkFleet,
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
	["running", "queued", "completed", "stopped", "failed"].map(
		fleetStatusSymbol,
	),
	["●", "◦", "✓", "■", "✗"],
	"status symbols remain stable",
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
assert.equal(unsubscribeCalls, 1, "emit failures unsubscribe the reply listener");
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
	() => {},
	{ refreshMs: 60_000 },
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
component.dispose();

process.stdout.write("ok - work fleet fixtures pass\n");
