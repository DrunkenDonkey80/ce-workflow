#!/usr/bin/env node
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import {
	answerUiRequest,
	createJsonlParser,
	lexicallyContained,
	preflightRpcSample,
	reconcileWorkflowTelemetry,
	runRpcSample,
	terminationPlan,
} from "./workflow-evaluation-rpc.mjs";

const records = [];
const parser = createJsonlParser((record) => records.push(record));
parser.write(Buffer.from('{"type":"one","text":"a'));
parser.write(Buffer.from('\\u2028b"}\r\n{"type":"two"}\n'));
parser.end();
assert.deepEqual(records.map((item) => item.type), ["one", "two"]);
assert.equal(records[0].text, "a\u2028b");
assert.equal(lexicallyContained("C:\\fixture", "C:\\fixture\\child", path.win32), true);
assert.equal(lexicallyContained("C:\\fixture", "C:\\other", path.win32), false);
assert.equal(lexicallyContained("/fixture", "/fixture/child", path.posix), true);
assert.equal(lexicallyContained("/fixture", "/other", path.posix), false);
assert.deepEqual(terminationPlan("win32", 42), { command: "taskkill", args: ["/PID", "42", "/T", "/F"] });
assert.deepEqual(terminationPlan("linux", 42), { signal: "SIGTERM" });

const answers = { expected: { "pick mode": "Fast", "continue": "Yes", "name": "Ada", "details": "Line 1\nLine 2" }, fallback: { "empty input": "Allowed" } };
assert.deepEqual(answerUiRequest({ id: "1", method: "select", title: "Pick mode", options: ["Fast", "Safe"] }, answers).value, "Fast");
assert.equal(answerUiRequest({ id: "2", method: "confirm", title: "Continue?" }, answers).confirmed, true);
assert.equal(answerUiRequest({ id: "3", method: "input", title: "Name" }, answers).value, "Ada");
assert.equal(answerUiRequest({ id: "4", method: "editor", title: "Details" }, answers).value, "Line 1\nLine 2");
assert.equal(answerUiRequest({ id: "5", method: "input", title: "Unknown" }, answers), null);
assert.equal(answerUiRequest({ id: "6", method: "input", title: "Empty input" }, answers).unexpected, true);
assert.equal(answerUiRequest({ id: "7", method: "input", title: "Unknown\n\nContext:\nContinue with the fixture." }, answers), null);
const flexibleAnswers = { expected: { "primary user|intended user": ["Developer", "Individual"] } };
assert.equal(answerUiRequest({ id: "8", method: "input", title: "Who is the intended user?" }, flexibleAnswers).value, "Developer");
assert.equal(answerUiRequest({ id: "9", method: "select", title: "Choose the primary user", options: ["Individual", "Team"] }, flexibleAnswers).value, "Individual");

const packageRoot = path.resolve(".");
assert.doesNotThrow(() => preflightRpcSample({ packageRoot, revision: "abc", expectedRevision: "abc", tools: ["read"], expectedTools: ["read"], trusted: true, isolation: "path" }));
assert.throws(() => preflightRpcSample({ packageRoot, revision: "abc", expectedRevision: "def", tools: ["read"], expectedTools: ["read"], trusted: true }));
assert.throws(() => preflightRpcSample({ packageRoot: path.join(packageRoot, "missing-revision"), revision: "local", expectedRevision: "local", tools: ["read"], expectedTools: ["read"], trusted: true, isolation: "path" }));
assert.throws(() => preflightRpcSample({ packageRoot, revision: "abc", expectedRevision: "abc", tools: ["read", "write"], expectedTools: ["read"], trusted: true }));
assert.throws(() => preflightRpcSample({ packageRoot, revision: "abc", expectedRevision: "abc", tools: ["read"], expectedTools: ["read"], trusted: false, isolation: "path" }), /sandbox/);
assert.throws(() => preflightRpcSample({ packageRoot, revision: "abc", expectedRevision: "abc", tools: ["read"], expectedTools: ["read"], trusted: false, isolation: "os" }), /sandbox command/);
assert.doesNotThrow(() => preflightRpcSample({ packageRoot, revision: "abc", expectedRevision: "abc", tools: ["read"], expectedTools: ["read"], trusted: false, isolation: "os", sandboxCommand: { command: "sandbox", args: [] } }));
assert.equal(reconcileWorkflowTelemetry([{ type: "command", workflowRunId: "wf-1" }, { type: "workflow-complete", workflowRunId: "wf-1" }]).workflowRunId, "wf-1");
assert.throws(() => reconcileWorkflowTelemetry([{ type: "workflow-complete", workflowRunId: "wf-1" }, { type: "workflow-complete", workflowRunId: "wf-1" }]), /exactly once/);
assert.deepEqual(reconcileWorkflowTelemetry([{ type: "workflow-complete", workflowRunId: "wf-1" }, { type: "workflow-complete", workflowRunId: "wf-2" }]).workflowRunIds, ["wf-1", "wf-2"]);

function fakeProcess(events, options = {}) {
	const child = new EventEmitter();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.stdin = new PassThrough();
	child.kill = () => child.emit("exit", null, "SIGTERM");
	const writes = [];
	child.stdin.on("data", (data) => {
		let command;
		try {
			command = JSON.parse(data.toString());
		} catch (error) {
			child.emit("error", error);
			return;
		}
		writes.push(command);
		if (command.type === "get_commands") {
			const commands = options.commands ?? [{ name: "work-brainstorm", source: "extension", path: path.join(packageRoot, "extensions", "work-models.js") }];
			child.stdout.write(`${JSON.stringify({ type: "response", id: command.id, command: "get_commands", success: true, data: { commands } })}\n`);
		} else if (command.type === "get_state") {
			child.stdout.write(`${JSON.stringify({ type: "response", id: command.id, command: "get_state", success: true, data: { model: { provider: "fixture", id: "fixture" }, thinkingLevel: "medium" } })}\n`);
		} else if (command.type === "prompt") {
			for (const event of events) {
				if (event === "__exit") child.emit("exit", 2, null);
				else child.stdout.write(typeof event === "string" ? `${event}\n` : `${JSON.stringify(event)}\n`);
			}
		} else if (command.type === "get_session_stats") {
			const stats = options.stats ?? { toolCalls: 2, tokens: { total: 20 }, contextUsage: { tokens: 10 } };
			child.stdout.write(`${JSON.stringify({ type: "response", id: command.id, command: "get_session_stats", success: true, data: stats })}\n`);
		}
	});
	child.writes = writes;
	return child;
}

const events = [
	{ type: "agent_end", willRetry: true },
	{ type: "auto_retry_start", attempt: 1 },
	{ type: "auto_compaction_start" },
	{ type: "extension_ui_request", id: "q1", method: "confirm", title: "Continue?" },
	{ type: "agent_settled" },
];
const child = fakeProcess(events);
const result = await runRpcSample({
	packageRoot,
	revision: "abc",
	expectedRevision: "abc",
	tools: ["read"],
	expectedTools: ["read"],
	trusted: true,
	isolation: "path",
	stage: "brainstorm",
	prompt: "/work-brainstorm fixture",
	answers,
	timeoutMs: 1000,
	spawnProcess: () => child,
});
assert.equal(result.status, "completed");
assert.equal(result.questions.length, 1);
assert.ok(child.writes.some((item) => item.type === "extension_ui_response" && item.confirmed));
assert.ok(child.writes.some((item) => item.type === "get_session_stats"));

const unanswerable = fakeProcess([{ type: "extension_ui_request", id: "q2", method: "input", title: "Unknown" }]);
const failed = await runRpcSample({ packageRoot, revision: "abc", expectedRevision: "abc", tools: ["read"], expectedTools: ["read"], trusted: true, isolation: "path", stage: "brainstorm", prompt: "x", answers, timeoutMs: 1000, spawnProcess: () => unanswerable });
assert.equal(failed.status, "failed");
assert.equal(failed.failure, "unanswerable-question");
const escaping = fakeProcess([{ type: "tool_execution_start", toolName: "write", args: { path: "../escape.txt" } }]);
const blocked = await runRpcSample({ packageRoot, workspaceRoot: packageRoot, revision: "abc", expectedRevision: "abc", tools: ["write"], expectedTools: ["write"], trusted: true, isolation: "path", stage: "brainstorm", prompt: "x", answers, timeoutMs: 1000, spawnProcess: () => escaping });
assert.equal(blocked.failure, "forbidden-write");
const dependencyScript = path.join(packageRoot, "scripts", "repo-profile-cache.py");
const dependencyRead = fakeProcess([{ type: "tool_execution_start", toolName: "bash", args: { command: `python "${dependencyScript}"` } }, { type: "agent_settled" }]);
const allowedDependencyRead = await runRpcSample({ packageRoot, sourceRoot: path.join(packageRoot, "source-only"), bundleRoot: path.join(packageRoot, "bundle-only"), workspaceRoot: path.join(path.dirname(packageRoot), "fixture-workspace"), dependencyRoots: [packageRoot], revision: "abc", expectedRevision: "abc", tools: ["bash"], expectedTools: ["bash"], trusted: true, isolation: "path", stage: "brainstorm", prompt: "x", answers, timeoutMs: 1000, spawnProcess: () => dependencyRead });
assert.equal(allowedDependencyRead.status, "completed");
const classify = (processFixture, timeoutMs = 1000, signal) => runRpcSample({ packageRoot, revision: "abc", expectedRevision: "abc", tools: ["read"], expectedTools: ["read"], trusted: true, isolation: "path", stage: "brainstorm", prompt: "x", answers, timeoutMs, signal, spawnProcess: () => processFixture });
async function expectFailure(processFixture, expected, timeoutMs) {
	const classified = await classify(processFixture, timeoutMs);
	assert.equal(classified.failure, expected);
}
const duplicateCommands = [
	{ name: "work-brainstorm", source: "extension", path: path.join(packageRoot, "extensions", "work-models.js") },
	{ name: "work-brainstorm", source: "extension", path: path.join(packageRoot, "extensions", "work-models.js") },
];
await expectFailure(fakeProcess([], { commands: duplicateCommands }), "resource-provenance");
await expectFailure(fakeProcess([], { commands: [{ name: "work-brainstorm", source: "extension", path: path.join(path.dirname(packageRoot), "ambient.js") }] }), "resource-provenance");
await expectFailure(fakeProcess([{ type: "extension_error", error: "fixture" }]), "extension-error");
await expectFailure(fakeProcess([{ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "provider fixture" } }]), "provider-error");
await expectFailure(fakeProcess(["{malformed"]), "malformed-rpc");
await expectFailure(fakeProcess(["__exit"]), "process-exit");
await expectFailure(fakeProcess([{ type: "agent_settled" }], { stats: { contextUsage: { tokens: 10 } } }), "missing-usage");
await expectFailure(fakeProcess([]), "timeout", 20);
const controller = new AbortController();
const aborted = classify(fakeProcess([]), 1000, controller.signal);
controller.abort();
const abortedResult = await aborted;
assert.equal(abortedResult.failure, "aborted");
process.stdout.write("ok - workflow evaluation RPC fixtures\n");
