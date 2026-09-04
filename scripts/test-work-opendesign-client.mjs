import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import {
	OpenDesignClient,
	OpenDesignError,
	callOpenDesignTool,
	closePersistentOpenDesignClients,
	openDesignPayloadDigest,
	reconcileCreatedProject,
	redactOpenDesignText,
	resolveOpenDesignCommand,
	validateOpenDesignToolCall,
	validateStartRecovery,
} from "../extensions/opendesign-client.js";
import { designLifecycleTelemetry } from "../extensions/work-design.js";
import { designReviewChoices } from "../extensions/work-models.js";

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
	const gitBin = path.join(root, "Git", "usr", "bin");
	fs.mkdirSync(gitBin, { recursive: true });
	fs.writeFileSync(path.join(gitBin, "od.exe"), "not OpenDesign");
	const appData = path.join(root, "AppData", "Roaming");
	const openDesignRoot = path.join(appData, "Open Design");
	const activeRoot = path.join(openDesignRoot, "en", "active");
	const packagedExe = path.join(activeRoot, "Open Design.exe");
	const packagedCli = path.join(
		activeRoot,
		"resources",
		"app",
		"prebundled",
		"daemon",
		"daemon-cli.mjs",
	);
	fs.mkdirSync(path.dirname(packagedCli), { recursive: true });
	fs.writeFileSync(packagedExe, "OpenDesign");
	fs.writeFileSync(packagedCli, "// MCP CLI");
	fs.writeFileSync(
		path.join(activeRoot, "resources", "open-design-config.json"),
		JSON.stringify({ namespace: "release-stable-win" }),
	);
	const installDir = path.join(
		openDesignRoot,
		"launcher",
		"channels",
		"stable",
		"namespaces",
		"release-stable-win",
	);
	fs.mkdirSync(installDir, { recursive: true });
	const launcherExe = path.join(root, "Open Design Launcher.exe");
	fs.writeFileSync(launcherExe, "OpenDesign launcher");
	fs.writeFileSync(
		path.join(installDir, "install.json"),
		JSON.stringify({ launchPath: launcherExe }),
	);
	const installed = resolveOpenDesignCommand({
		env: { APPDATA: appData, PATH: gitBin, PATHEXT: ".EXE" },
		platform: "win32",
	});
	assert.equal(installed.source, "installed");
	assert.equal(installed.command, packagedExe);
	assert.deepEqual(installed.args, [packagedCli, "mcp"]);
	assert.equal(installed.env.OD_MCP_BOOTSTRAP_COMMAND, launcherExe);
	assert.equal(installed.env.OD_MCP_BOOTSTRAP_ARGS, "[]");
	assert.equal(installed.env.ELECTRON_RUN_AS_NODE, "1");
	assert.throws(
		() =>
			resolveOpenDesignCommand({
				env: { PATH: gitBin, PATHEXT: ".EXE" },
				platform: "win32",
			}),
		(failure) => failure.category === "executable-collision",
	);
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
	const brief = await callOpenDesignTool({
		command: command("success"),
		tool: "collect_brief",
		args: { artifactType: "product-prototype" },
		timeoutMs: 1_000,
	});
	assert.deepEqual(
		brief.questionForm.questions.map((question) => question.id),
		["platform", "scope", "fidelity"],
	);
	const referenceBytes = Buffer.from("reference");
	const referenceContent = referenceBytes.toString("base64");
	const referenceHash = crypto
		.createHash("sha256")
		.update(referenceBytes)
		.digest("hex");
	const uploaded = await callOpenDesignTool({
		command: command("success"),
		tool: "write_file",
		args: {
			project: "project-1",
			path: `references/${referenceHash}.png`,
			content: referenceContent,
			encoding: "base64",
		},
		timeoutMs: 1_000,
	});
	assert.equal(uploaded.size, 9);
	assert.throws(
		() =>
			validateOpenDesignToolCall("write_file", {
				project: "project-1",
				path: "../source.png",
				content: referenceContent,
				encoding: "base64",
			}),
		(failure) => failure.category === "invalid-input",
	);
	assert.throws(
		() =>
			validateOpenDesignToolCall("write_file", {
				project: "project-1",
				path: `references/${"a".repeat(64)}.png`,
				content: referenceContent,
				encoding: "base64",
			}),
		(failure) => failure.category === "invalid-input",
	);
	assert.throws(
		() =>
			validateOpenDesignToolCall("write_file", {
				project: "project-1",
				path: `references/${"a".repeat(64)}.png`,
				content: Buffer.alloc(700_001).toString("base64"),
				encoding: "base64",
			}),
		(failure) => failure.category === "invalid-input",
	);
	const sandboxed = await callOpenDesignTool({
		command: command("report-cwd"),
		tool: "get_project",
		args: { project: "project-1" },
		timeoutMs: 1_000,
	});
	assert.notEqual(path.resolve(sandboxed.project.name), process.cwd());
	assert.match(path.basename(sandboxed.project.name), /^ce-opendesign-/);
	const persistentPids = [];
	for (const project of ["persistent-1", "persistent-2"]) {
		const response = await callOpenDesignTool({
			command: command("report-pid"),
			keepAlive: true,
			tool: "get_project",
			args: { project },
			timeoutMs: 1_000,
		});
		persistentPids.push(response.project.name);
	}
	assert.equal(
		persistentPids[0],
		persistentPids[1],
		"keepAlive reuses one MCP process so background runs survive tool calls",
	);
	closePersistentOpenDesignClients();
	const ipcPath =
		process.platform === "win32"
			? `\\\\.\\pipe\\ce-opendesign-${process.pid}-${Date.now()}`
			: path.join(root, "daemon.sock");
	const ipcServer = createServer((socket) => {
		let request = "";
		socket.on("data", (chunk) => {
			request += chunk.toString("utf8");
			if (!request.includes("\n")) return;
			assert.deepEqual(JSON.parse(request.split("\n", 1)[0]), { type: "status" });
			socket.end(
				`${JSON.stringify({ ok: true, result: { url: "http://127.0.0.1:54321" } })}\n`,
			);
		});
	});
	await new Promise((resolve, reject) => {
		ipcServer.once("error", reject);
		ipcServer.listen(ipcPath, resolve);
	});
	try {
		const attached = await callOpenDesignTool({
			command: command("report-daemon-url", {
				OD_SIDECAR_IPC_PATH: ipcPath,
			}),
			tool: "get_project",
			args: { project: "project-1" },
			timeoutMs: 1_000,
		});
		assert.equal(
			attached.project.name,
			"http://127.0.0.1:54321",
			"the MCP proxy pins a registered daemon URL instead of bootstrapping a replacement",
		);
	} finally {
		await new Promise((resolve) => ipcServer.close(resolve));
	}
	const bootstrapIpcPath =
		process.platform === "win32"
			? `\\\\.\\pipe\\ce-opendesign-bootstrap-${process.pid}-${Date.now()}`
			: path.join(root, "daemon-bootstrap.sock");
	const bootstrapScript = path.join(root, "fake-bootstrap.mjs");
	const bootstrapPidFile = path.join(root, "fake-bootstrap.pid");
	const bootstrapTraceFile = path.join(root, "bootstrap-trace.jsonl");
	fs.writeFileSync(
		bootstrapScript,
		`import fs from "node:fs";
import { createServer } from "node:net";
fs.writeFileSync(process.env.FAKE_BOOTSTRAP_PID_FILE, String(process.pid));
const server = createServer((socket) => {
  let request = "";
  socket.on("data", (chunk) => {
    request += chunk.toString("utf8");
    if (!request.includes("\\n")) return;
    socket.end(JSON.stringify({ ok: true, result: { url: "http://127.0.0.1:54323" } }) + "\\n");
  });
});
server.listen(process.env.FAKE_BOOTSTRAP_IPC);
`,
	);
	let bootstrapPid;
	try {
		const attached = await callOpenDesignTool({
			command: {
				...command("report-daemon-binding", {
					FAKE_BOOTSTRAP_IPC: bootstrapIpcPath,
					FAKE_BOOTSTRAP_PID_FILE: bootstrapPidFile,
					OD_MCP_BOOTSTRAP_ARGS: JSON.stringify([bootstrapScript, "--headless"]),
					OD_MCP_BOOTSTRAP_COMMAND: process.execPath,
					OD_SIDECAR_IPC_PATH: bootstrapIpcPath,
					WORK_ORCH_OPENDESIGN_TRACE_FILE: bootstrapTraceFile,
				}),
				source: "installed",
			},
			tool: "get_project",
			args: { project: "project-1" },
			timeoutMs: 2_000,
		});
		const binding = JSON.parse(attached.project.name);
		assert.equal(binding.url, "http://127.0.0.1:54323");
		assert.deepEqual(binding.args, ["--daemon-url", "http://127.0.0.1:54323"]);
		const traceEvents = fs
			.readFileSync(bootstrapTraceFile, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		assert(
			traceEvents.some(
				(event) =>
					event.event === "connect.plan" &&
					event.daemonUrlSource === "bootstrap-before-mcp" &&
					event.daemonUrl === "http://127.0.0.1:54323",
			),
			"the packaged daemon is ready and explicitly pinned before MCP starts",
		);
		bootstrapPid = Number(fs.readFileSync(bootstrapPidFile, "utf8"));
	} finally {
		if (Number.isInteger(bootstrapPid)) process.kill(bootstrapPid);
	}
	const delayedIpcPath =
		process.platform === "win32"
			? `\\\\.\\pipe\\ce-opendesign-delayed-${process.pid}-${Date.now()}`
			: path.join(root, "daemon-delayed.sock");
	const traceFile = path.join(root, "opendesign-trace.jsonl");
	let delayedIpcRequests = 0;
	const delayedIpcServer = createServer((socket) => {
		let request = "";
		socket.on("data", (chunk) => {
			request += chunk.toString("utf8");
			if (!request.includes("\n")) return;
			delayedIpcRequests += 1;
			if (delayedIpcRequests === 1) socket.end("not-json\n");
			else
				socket.end(
					`${JSON.stringify({ ok: true, result: { url: "http://127.0.0.1:54322" } })}\n`,
				);
		});
	});
	await new Promise((resolve, reject) => {
		delayedIpcServer.once("error", reject);
		delayedIpcServer.listen(delayedIpcPath, resolve);
	});
	try {
		const bootstrapped = await callOpenDesignTool({
			command: command("report-daemon-url", {
				OD_SIDECAR_IPC_PATH: delayedIpcPath,
				WORK_ORCH_OPENDESIGN_TRACE_FILE: traceFile,
			}),
			tool: "get_project",
			args: { project: "project-1" },
			timeoutMs: 1_000,
		});
		assert.equal(bootstrapped.project.name, "");
		assert.equal(
			delayedIpcRequests,
			2,
			"a bootstrapped MCP connection captures the registered daemon URL after initialization",
		);
	} finally {
		await new Promise((resolve) => delayedIpcServer.close(resolve));
	}
	const cachedDaemon = await callOpenDesignTool({
		command: command("report-daemon-url", {
			OD_SIDECAR_IPC_PATH: delayedIpcPath,
			WORK_ORCH_OPENDESIGN_TRACE_FILE: traceFile,
		}),
		tool: "get_project",
		args: { project: "project-1" },
		timeoutMs: 1_000,
	});
	assert.equal(
		cachedDaemon.project.name,
		"http://127.0.0.1:54322",
		"later MCP processes reuse the exact daemon URL captured by the first connection",
	);
	const traceEvents = fs
		.readFileSync(traceFile, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert(
		traceEvents.some(
			(event) =>
				event.event === "connect.plan" &&
				event.daemonUrlSource === "bootstrap" &&
				event.ipcPath === delayedIpcPath,
		),
	);
	assert(
		traceEvents.some(
			(event) =>
				event.event === "connect.ready" &&
				event.registeredDaemonUrl === "http://127.0.0.1:54322",
		),
	);
	assert(
		traceEvents.some(
			(event) =>
				event.event === "connect.plan" &&
				event.daemonUrlSource === "cache" &&
				event.daemonUrl === "http://127.0.0.1:54322",
		),
	);
	let fetches = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		fetches += 1;
		throw new Error("OpenDesign URLs must stay inert");
	};
	let untrustedUrls;
	try {
		untrustedUrls = await callOpenDesignTool({
			command: command("untrusted-urls"),
			tool: "get_run",
			args: { runId: "run-1" },
			timeoutMs: 1_000,
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.equal(fetches, 0, "returned URLs are never fetched automatically");
	assert.equal(
		untrustedUrls.previewUrl,
		"https://example.test/preview?token=super-secret",
	);
	assert.equal(untrustedUrls.studioUrl, "");
	assert.doesNotMatch(untrustedUrls.agentMessage, /super-secret/);
	const urlProjection = JSON.stringify({
		choices: designReviewChoices({ state: "review_ready", ...untrustedUrls }),
		telemetry: designLifecycleTelemetry({
			state: "review_ready",
			policy: "required",
			...untrustedUrls,
		}),
	});
	assert.doesNotMatch(
		urlProjection,
		/super-secret|javascript:|token=super-secret/,
	);
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
	const recoveredToolFailure = await reconcileCreatedProject({
		command: command("create-tool-error"),
		projectId: "project-2",
		createArgs: { id: "project-2", name: "Demo" },
		timeoutMs: 1_000,
	});
	assert.equal(
		recoveredToolFailure.project.id,
		"project-2",
		"create tool failures reconcile an already-created project by id",
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
