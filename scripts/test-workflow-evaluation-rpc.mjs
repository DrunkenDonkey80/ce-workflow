#!/usr/bin/env node
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import {
	answerUiRequest,
	createJsonlParser,
	preflightRpcSample,
	runRpcSample,
} from "./workflow-evaluation-rpc.mjs";

const records = [];
const parser = createJsonlParser((record) => records.push(record));
parser.write(Buffer.from('{"type":"one","text":"a'));
parser.write(Buffer.from(' b"}\r\n{"type":"two"}\n'));
parser.end();
assert.deepEqual(records.map((item) => item.type), ["one", "two"]);
assert.equal(records[0].text, "a b");

const answers = { expected: { "pick mode": "Fast", "continue": "Yes", "name": "Ada", "details": "Line 1\nLine 2" } };
assert.deepEqual(answerUiRequest({ id: "1", method: "select", title: "Pick mode", options: ["Fast", "Safe"] }, answers).value, "Fast");
assert.equal(answerUiRequest({ id: "2", method: "confirm", title: "Continue?" }, answers).confirmed, true);
assert.equal(answerUiRequest({ id: "3", method: "input", title: "Name" }, answers).value, "Ada");
assert.equal(answerUiRequest({ id: "4", method: "editor", title: "Details" }, answers).value, "Line 1\nLine 2");
assert.equal(answerUiRequest({ id: "5", method: "input", title: "Unknown" }, answers), null);

const packageRoot = path.resolve(".");
assert.doesNotThrow(() => preflightRpcSample({ packageRoot, revision: "abc", expectedRevision: "abc", tools: ["read"], expectedTools: ["read"], trusted: true, isolation: "path" }));
assert.throws(() => preflightRpcSample({ packageRoot, revision: "abc", expectedRevision: "def", tools: ["read"], expectedTools: ["read"], trusted: true }));
assert.throws(() => preflightRpcSample({ packageRoot, revision: "abc", expectedRevision: "abc", tools: ["read", "write"], expectedTools: ["read"], trusted: true }));
assert.throws(() => preflightRpcSample({ packageRoot, revision: "abc", expectedRevision: "abc", tools: ["read"], expectedTools: ["read"], trusted: false, isolation: "path" }), /sandbox/);

function fakeProcess(events) {
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
			child.stdout.write(`${JSON.stringify({ type: "response", id: command.id, command: "get_commands", success: true, data: { commands: [{ name: "work-brainstorm", source: "extension", path: path.join(packageRoot, "extensions", "work-models.js") }] } })}\n`);
		} else if (command.type === "prompt") {
			for (const event of events) child.stdout.write(`${JSON.stringify(event)}\n`);
		} else if (command.type === "get_session_stats") {
			child.stdout.write(`${JSON.stringify({ type: "response", id: command.id, command: "get_session_stats", success: true, data: { toolCalls: 2, tokens: { total: 20 }, contextUsage: { tokens: 10 } } })}\n`);
		}
	});
	child.writes = writes;
	return child;
}

const events = [
	{ type: "agent_end", willRetry: false },
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
console.log("ok - workflow evaluation RPC fixtures");
