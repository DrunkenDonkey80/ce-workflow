#!/usr/bin/env node
import assert from "node:assert/strict";
import workModelsExtension, {
	executeOrchestratorAction,
} from "../extensions/work-models.js";
import { installWorkflowFixture } from "./work-command-fixture.mjs";

const fixture = installWorkflowFixture();
try {
	const commands = {};
	const tools = {};
	const sent = [];
	const notices = [];
	const branch = [];
	const hooks = {};
	const rpcListeners = new Map();
	let rpcRequest;
	const pi = {
		events: {
			on: (name, listener) => {
				rpcListeners.set(name, listener);
				return () => rpcListeners.delete(name);
			},
			emit: (_name, request) => {
				rpcRequest = request;
				rpcListeners.get(`subagents:rpc:v1:reply:${request.requestId}`)?.({
					success: true,
					data: { runId: "worker-run", asyncDir: "C:/tmp/worker-run" },
				});
			},
		},
		on: (name, handler) => {
			hooks[name] = handler;
		},
		registerCommand: (name, config) => {
			commands[name] = config;
		},
		registerTool: (config) => {
			tools[config.name] = config;
		},
		sendUserMessage: (message, options) =>
			sent.push({ source: "pi", message, options }),
	};
	workModelsExtension(pi);
	const invoke = (name, args, ctx) =>
		executeOrchestratorAction(name, args, ctx, pi);
	const ctx = {
		cwd: fixture.cwd,
		mode: "tui",
		getContextUsage: () => ({ tokens: 0 }),
		sessionManager: { getBranch: () => branch },
		sendUserMessage: async (message, options) =>
			sent.push({ source: "ctx", message, options }),
		ui: { notify: (message, level) => notices.push({ message, level }) },
	};

	fixture.reset("active", "unknown");
	await invoke("work-small", "Recover safely", ctx);
	assert.equal(fixture.logs().length, 0, "dirty preflight mutates nothing");
	assert.equal(sent.length, 1, "dirty preflight queries the LLM once");
	assert.match(sent[0].message, /WO_DIRTY_RECOVERY_V1/);
	assert.match(sent[0].message, /extensions\/work-models\.js/);
	assert.match(sent[0].message, /Apply recommendation and continue/);
	assert.match(sent[0].message, /Cancel for manual cleanup/);
	assert.match(sent[0].message, /Never discard, revert, reset, stash, force/);
	assert.match(sent[0].message, /allowMultiple=false/);
	assert.match(sent[0].message, /allowFreeform=false/);
	assert.match(sent[0].message, /allowComment=false/);
	assert.equal(sent[0].options.deliverAs, "followUp");

	const token = sent[0].message.match(/Recovery token: ([\w-]+)/)?.[1];
	assert.ok(token, "dirty recovery supplies an opaque continuation token");
	await assert.rejects(
		() =>
			tools.work_dirty_continue.execute(
				"unapproved",
				{ token },
				undefined,
				undefined,
				ctx,
			),
		/No matching ask_user approval/,
		"model-controlled input cannot substitute for user approval",
	);
	const approvalOptions = [
		{
			title: "Apply recommendation and continue",
			description:
				"extensions/work-models.js — stage and commit the intentional change",
		},
		{
			title: "Cancel for manual cleanup",
			description: "Make no changes",
		},
	];
	const askResult = (toolCallId, context, selections) => ({
		type: "message",
		message: {
			role: "toolResult",
			toolCallId,
			toolName: "ask_user",
			details: {
				question: "Apply the recommended Git cleanup?",
				context,
				options: approvalOptions,
				response: { kind: "selection", selections },
				cancelled: false,
			},
		},
	});
	branch.push(
		askResult("malformed-call", `Dirty recovery token: ${token} trailing`, [
			"Apply recommendation and continue",
			"Cancel for manual cleanup",
		]),
	);
	await assert.rejects(
		() =>
			tools.work_dirty_continue.execute(
				"malformed-approval",
				{ token },
				undefined,
				undefined,
				ctx,
			),
		/No matching ask_user approval/,
		"approval requires an exact token suffix and one Apply selection",
	);
	const approvalContext = `Exact file/action list.\nDirty recovery token: ${token}`;
	hooks.tool_call({
		toolCallId: "unsafe-call",
		toolName: "ask_user",
		input: {
			question: "Apply the recommended Git cleanup?",
			context: approvalContext,
			options: approvalOptions,
			allowMultiple: false,
			allowFreeform: false,
			allowComment: true,
		},
	});
	branch.push(
		askResult("unsafe-call", approvalContext, [
			"Apply recommendation and continue",
		]),
	);
	await assert.rejects(
		() =>
			tools.work_dirty_continue.execute(
				"unsafe-comment-approval",
				{ token },
				undefined,
				undefined,
				ctx,
			),
		/No matching ask_user approval/,
		"approval rejects a prompt that enabled comments",
	);
	hooks.tool_call({
		toolCallId: "safe-call",
		toolName: "ask_user",
		input: {
			question: "Apply the recommended Git cleanup?",
			context: approvalContext,
			options: approvalOptions,
			allowMultiple: false,
			allowFreeform: false,
			allowComment: false,
		},
	});
	await assert.rejects(
		() =>
			tools.work_dirty_continue.execute(
				"mismatched-tool-call",
				{ token },
				undefined,
				undefined,
				ctx,
			),
		/No matching ask_user approval/,
		"a safe call cannot reuse an earlier unsafe call's result",
	);
	branch.push(
		askResult("safe-call", approvalContext, [
			"Apply recommendation and continue",
		]),
	);
	await assert.rejects(
		() =>
			tools.work_dirty_continue.execute(
				"blocked",
				{ token },
				undefined,
				undefined,
				ctx,
			),
		/Blocking files remain dirty/,
		"approved continuation still refuses uncleared blockers",
	);
	assert.equal(sent.length, 1, "failed cleanup does not requeue work");

	process.env.WORK_FLOW_GIT_DIRTY = "clean";
	ctx.getContextUsage = () => ({ tokens: 40_000 });
	ctx.isIdle = () => false;
	let compactCalls = 0;
	ctx.compact = () => {
		compactCalls += 1;
	};
	let timeout;
	const result = await Promise.race([
		tools.work_dirty_continue.execute(
			"approved",
			{ token },
			undefined,
			undefined,
			ctx,
		),
		new Promise((_, reject) => {
			timeout = setTimeout(
				() => reject(new Error("dirty continuation deadlocked")),
				1_000,
			);
		}),
	]).finally(() => clearTimeout(timeout));
	assert.equal(
		compactCalls,
		0,
		"active tool continuation queues its follow-up without waiting on compaction",
	);
	assert.equal(
		result.terminate,
		true,
		"approved cleanup ends the analysis turn",
	);
	assert.equal(rpcRequest?.params?.agent, "work-worker");
	assert.match(rpcRequest?.params?.task ?? "", /Implementation scope: small/);
	assert.equal(
		sent.length,
		1,
		"worker launch does not fall back to inline follow-up",
	);
	assert.doesNotMatch(
		notices.at(-1)?.message ?? "",
		/Dirty files must be resolved/,
		"approved cleanup resumes the blocked action directly",
	);
	assert.ok(
		Object.values(fixture.store().items).some(
			(item) =>
				item.title === "Recover safely" && item.status === "in_progress",
		),
		"requeued clean command reaches normal work startup",
	);

	fixture.reset("active", "unknown");
	sent.length = 0;
	await invoke("work-resume", "E-1", ctx);
	assert.match(sent[0]?.message ?? "", /WO_DIRTY_RECOVERY_V1/);
	assert.ok(sent[0]?.message.includes("F7 → Resume work E-1"));

	process.stdout.write("dirty recovery: PASS\n");
} finally {
	fixture.cleanup();
}
