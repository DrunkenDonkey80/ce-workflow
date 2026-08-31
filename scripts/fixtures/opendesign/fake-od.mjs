import fs from "node:fs";
import readline from "node:readline";

const mode = process.env.FAKE_OD_MODE ?? "success";
const tools = [
	"create_project",
	"get_project",
	"start_run",
	"get_run",
	"cancel_run",
	"list_files",
	"get_artifact",
	"get_file",
];
let calls = 0;

function send(message) {
	const text = JSON.stringify(message);
	if (mode === "content-length") {
		process.stdout.write(
			`Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`,
		);
	} else if (mode === "split") {
		const line = `${text}\n`;
		const middle = Math.floor(line.length / 2);
		process.stdout.write(line.slice(0, middle));
		setTimeout(() => process.stdout.write(line.slice(middle)), 5);
	} else {
		process.stdout.write(`${text}\n`);
	}
}

function result(id, value) {
	send({ jsonrpc: "2.0", id, result: value });
}

function toolResult(id, value) {
	result(id, {
		content: [{ type: "text", text: JSON.stringify(value) }],
		structuredContent: value,
	});
}

function toolError(id, value) {
	result(id, {
		content: [{ type: "text", text: JSON.stringify(value) }],
		structuredContent: value,
		isError: true,
	});
}

if (["stderr", "stderr-exit"].includes(mode))
	process.stderr.write(
		"apiKey=sk-super-secret-value token=https://example.test/?token=private\n",
	);
if (mode === "oversized") process.stdout.write(`${"x".repeat(4096)}\n`);

const reader = readline.createInterface({
	input: process.stdin,
	crlfDelay: Infinity,
});
reader.on("line", (line) => {
	let message;
	try {
		message = JSON.parse(line);
	} catch {
		return;
	}
	if (message.id == null) return;
	if (mode === "hang") return;
	if (["exit", "stderr-exit"].includes(mode)) process.exit(3);
	if (mode === "malformed") {
		process.stdout.write("{broken\n");
		return;
	}
	if (message.method === "initialize") {
		result(message.id, {
			protocolVersion: "2025-03-26",
			serverInfo: {
				name: mode === "wrong-identity" ? "octal-dump" : "open-design",
				version: "0.2.0",
			},
			capabilities: { tools: {} },
		});
		return;
	}
	if (message.method === "tools/list") {
		result(message.id, {
			tools: (mode === "missing-tool"
				? tools.filter((name) => name !== "start_run")
				: tools
			).map((name) => ({ name })),
		});
		return;
	}
	if (message.method !== "tools/call") return;
	calls += 1;
	const name = message.params?.name;
	const args = message.params?.arguments ?? {};
	if (mode === "tool-error") {
		toolError(message.id, { message: "daemon unavailable token=secret" });
		return;
	}
	const marker = process.env.FAKE_OD_MARKER;
	if (
		marker &&
		((mode === "read-exit-once" && name === "get_run") ||
			(mode === "create-exit-once" && name === "create_project")) &&
		!fs.existsSync(marker)
	) {
		fs.writeFileSync(marker, "attempted");
		process.exit(4);
	}
	if (name === "create_project")
		toolResult(message.id, {
			project: { id: args.id },
			conversationId: "conversation-1",
		});
	else if (name === "get_project")
		toolResult(message.id, { project: { id: args.project, name: "Recovered" } });
	else if (name === "start_run")
		toolResult(message.id, {
			runId: "run-1",
			projectId: args.project,
			requestId: args.requestId,
			resumed: args.resume === true,
		});
	else if (name === "get_run")
		toolResult(message.id, {
			runId: args.runId,
			status: "succeeded",
			previewUrl: "https://example.test/preview",
			studioUrl: "https://example.test/studio",
			agentMessage: "Done",
		});
	else if (name === "cancel_run")
		toolResult(message.id, { runId: args.runId, canceled: true });
	else if (name === "list_files")
		toolResult(message.id, {
			files: [{ name: "DESIGN-HANDOFF.json", size: 10 }],
		});
	else if (name === "get_file")
		toolResult(message.id, { name: args.path, content: "{}" });
	else if (name === "get_artifact") toolResult(message.id, { files: [] });
});
