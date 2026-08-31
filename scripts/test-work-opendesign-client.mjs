import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	OpenDesignClient,
	OpenDesignError,
	callOpenDesignTool,
	openDesignPayloadDigest,
	reconcileCreatedProject,
	redactOpenDesignText,
	resolveOpenDesignCommand,
	validateStartRecovery,
} from "../extensions/opendesign-client.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ce-opendesign-client-"));
const fake = path.resolve(
	new URL("./fixtures/opendesign/fake-od.mjs", import.meta.url).pathname.replace(
		/^\/(?:[A-Za-z]:)/,
		(value) => value.slice(1),
	),
);
const command = (mode, extraEnv = {}) => ({
	command: process.execPath,
	args: [fake],
	env: { FAKE_OD_MODE: mode, ...extraEnv },
});
const rejects = async (promise, category) => {
	await assert.rejects(
		promise,
		(failure) =>
			failure instanceof OpenDesignError && failure.category === category,
	);
};

try {
	const bin = path.join(root, "bin");
	fs.mkdirSync(bin);
	const od = path.join(bin, process.platform === "win32" ? "od.cmd" : "od");
	fs.writeFileSync(
		od,
		process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n",
	);
	if (process.platform !== "win32") fs.chmodSync(od, 0o755);
	const discovered = resolveOpenDesignCommand({
		env: { PATH: bin, PATHEXT: ".CMD;.EXE" },
		platform: process.platform,
	});
	assert.equal(discovered.command, od);
	assert.deepEqual(discovered.args, ["mcp"]);
	const windows = resolveOpenDesignCommand({
		env: { PATH: bin, PATHEXT: ".CMD;.EXE" },
		platform: "win32",
	});
	assert.match(windows.command, /od\.cmd$/i);
	assert.equal(
		resolveOpenDesignCommand({
			commandSpec: { command: process.execPath, args: [fake] },
		}).source,
		"configured",
	);
	assert.throws(
		() =>
			resolveOpenDesignCommand({
				commandSpec: { command: path.join(root, "missing") },
			}),
		(failure) => failure.category === "executable-missing",
	);
	assert.throws(
		() =>
			resolveOpenDesignCommand({
				commandSpec: {
					command: process.execPath,
					args: ["--api-key=secret-value"],
				},
			}),
		(failure) => failure.category === "credentials-forbidden",
	);

	for (const mode of ["success", "split"]) {
		const result = await callOpenDesignTool({
			command: command(mode),
			tool: "get_run",
			args: { runId: "run-1" },
			timeoutMs: 1_000,
		});
		assert.equal(result.status, "succeeded", `${mode} framing works`);
	}
	await rejects(
		callOpenDesignTool({
			command: command("content-length"),
			tool: "get_run",
			args: { runId: "run-1" },
			timeoutMs: 1_000,
			retryRead: false,
		}),
		"protocol-error",
	);
	await rejects(
		callOpenDesignTool({
			command: command("wrong-identity"),
			tool: "get_run",
			args: { runId: "run-1" },
			timeoutMs: 1_000,
			retryRead: false,
		}),
		"identity-mismatch",
	);
	await rejects(
		callOpenDesignTool({
			command: command("missing-tool"),
			tool: "start_run",
			args: { project: "p", requestId: crypto.randomUUID() },
			timeoutMs: 1_000,
		}),
		"tool-missing",
	);
	await rejects(
		callOpenDesignTool({
			command: command("malformed"),
			tool: "get_run",
			args: { runId: "run-1" },
			timeoutMs: 1_000,
			retryRead: false,
		}),
		"protocol-error",
	);
	await rejects(
		callOpenDesignTool({
			command: command("oversized"),
			tool: "get_run",
			args: { runId: "run-1" },
			timeoutMs: 1_000,
			maxMessageBytes: 1_024,
			retryRead: false,
		}),
		"message-too-large",
	);
	await rejects(
		callOpenDesignTool({
			command: command("hang"),
			tool: "get_run",
			args: { runId: "run-1" },
			timeoutMs: 40,
			retryRead: false,
		}),
		"timeout",
	);
	await rejects(
		callOpenDesignTool({
			command: command("exit"),
			tool: "start_run",
			args: { project: "p", requestId: crypto.randomUUID() },
			timeoutMs: 1_000,
		}),
		"process-exit",
	);
	await rejects(
		callOpenDesignTool({
			command: command("tool-error"),
			tool: "get_run",
			args: { runId: "run-1" },
			timeoutMs: 1_000,
			retryRead: false,
		}),
		"tool-failed",
	);

	try {
		await callOpenDesignTool({
			command: command("stderr-exit"),
			tool: "start_run",
			args: { project: "p", requestId: crypto.randomUUID() },
			timeoutMs: 1_000,
		});
		assert.fail("stderr-exit must fail");
	} catch (failure) {
		assert.equal(failure.category, "process-exit");
		assert.doesNotMatch(JSON.stringify(failure.details), /super-secret|private/);
	}
	assert.equal(
		redactOpenDesignText(
			"apiKey=sk-abcdefghijklmnop https://x.test/?token=private",
		).includes("private"),
		false,
	);

	const controller = new AbortController();
	const pending = callOpenDesignTool({
		command: command("hang"),
		tool: "get_run",
		args: { runId: "run-1" },
		timeoutMs: 2_000,
		signal: controller.signal,
		retryRead: false,
	});
	setTimeout(() => controller.abort(), 20);
	await rejects(pending, "canceled");

	const marker = path.join(root, "read-once");
	const retried = await callOpenDesignTool({
		command: command("read-exit-once", { FAKE_OD_MARKER: marker }),
		tool: "get_run",
		args: { runId: "run-1" },
		timeoutMs: 1_000,
	});
	assert.equal(
		retried.status,
		"succeeded",
		"safe read retries once in a fresh process",
	);

	const projectMarker = path.join(root, "project-once");
	const recovered = await reconcileCreatedProject({
		command: command("create-exit-once", { FAKE_OD_MARKER: projectMarker }),
		projectId: "project-1",
		createArgs: { id: "project-1", name: "Demo" },
		timeoutMs: 1_000,
	});
	assert.equal(
		recovered.project.id,
		"project-1",
		"lost create is read-reconciled without replay",
	);

	const original = {
		project: "project-1",
		prompt: "Design a password reset without exposing secrets",
		requestId: crypto.randomUUID(),
	};
	assert.deepEqual(validateStartRecovery(original, { ...original }), original);
	assert.equal(
		openDesignPayloadDigest(original),
		openDesignPayloadDigest({
			requestId: original.requestId,
			prompt: original.prompt,
			project: original.project,
		}),
	);
	assert.throws(
		() => validateStartRecovery(original, { ...original, prompt: "Changed" }),
		(failure) => failure.category === "mutation-mismatch",
	);
	assert.throws(
		() => validateStartRecovery(original, { ...original, resume: true }),
		(failure) => failure.category === "confirmation-required",
	);
	assert.equal(
		validateStartRecovery(
			original,
			{ ...original, resume: true },
			{ resumeConfirmed: true },
		).resume,
		true,
	);

	const client = new OpenDesignClient(command("success"), { timeoutMs: 1_000 });
	await client.connect();
	const created = await client.callTool("create_project", {
		id: "p",
		name: "Demo",
	});
	const started = await client.callTool("start_run", original);
	const canceled = await client.callTool("cancel_run", { runId: "run-1" });
	assert.equal(created.conversationId, "conversation-1");
	assert.equal(started.runId, "run-1");
	assert.equal(canceled.canceled, true);
	client.close();

	process.stdout.write("work-opendesign-client tests passed\n");
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
