#!/usr/bin/env node
// Minimal stand-in for `pi --mode rpc` used by hub tests. Speaks LF-delimited JSONL on stdin/stdout.
// Behaviour switches come from FAKE_PI (comma list): "crash-on-prompt", "slow-command", "split-output".
import fs from "node:fs";
import crypto from "node:crypto";
const flags = new Set((process.env.FAKE_PI ?? "").split(",").filter(Boolean));
const args = process.argv.slice(2);
const sessionArg = args[args.indexOf("--session") + 1];
const sessionFile = args.includes("--session") ? sessionArg : null;
let model = { provider: "fake", id: "fake-1" }, thinkingLevel = "low", streaming = false;
const messages = sessionFile && fs.existsSync(sessionFile)
	? fs.readFileSync(sessionFile, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).filter(e => e.type === "message").map(e => e.message)
	: [];
const pendingUi = new Map();
const out = value => {
	const line = Buffer.from(JSON.stringify(value) + "\n");
	if (!flags.has("split-output")) return process.stdout.write(line);
	// Split mid-record and inside multi-byte characters to test the reader's framing.
	for (let i = 0; i < line.length; i += 3) process.stdout.write(line.subarray(i, i + 3));
};
const save = message => { messages.push(message); if (sessionFile) fs.appendFileSync(sessionFile, JSON.stringify({ type: "message", message }) + "\n"); };
const ui = (method, fields) => new Promise(resolve => { const id = crypto.randomUUID(); pendingUi.set(id, resolve); out({ type: "extension_ui_request", id, method, ...fields }); });

async function handle(cmd) {
	const reply = (data, extra = {}) => out({ id: cmd.id, type: "response", command: cmd.type, success: true, ...(data === undefined ? {} : { data }), ...extra });
	switch (cmd.type) {
		case "get_state": return reply({ model, thinkingLevel, isStreaming: streaming, isCompacting: false, sessionFile, messageCount: messages.length, pendingMessageCount: 0 });
		case "get_messages": return reply({ messages });
		case "set_model": model = { provider: cmd.provider, id: cmd.modelId }; return reply(model);
		case "set_thinking_level": thinkingLevel = cmd.level; out({ type: "thinking_level_changed", level: cmd.level }); return reply();
		case "abort": streaming = false; return reply();
		case "prompt": {
			if (flags.has("crash-on-prompt")) process.exit(3);
			if (cmd.message.startsWith("/")) {
				// Extension commands answer only after the handler finishes (F6).
				if (cmd.message.startsWith("/ask")) { const value = await ui("input", { title: "pi-hub:ask", placeholder: cmd.message.slice(5) }); out({ type: "extension_ui_request", id: crypto.randomUUID(), method: "notify", message: `answer:${value ?? "<cancelled>"}` }); }
				if (flags.has("slow-command")) await new Promise(r => setTimeout(r, 300));
				return reply({ disposition: "handled" });
			}
			reply({ disposition: "started" });
			streaming = true;
			out({ type: "agent_start" });
			save({ role: "user", content: [{ type: "text", text: cmd.message }], timestamp: Date.now() });
			const answer = { role: "assistant", content: [{ type: "text", text: `echo: ${cmd.message}` }], timestamp: Date.now() };
			out({ type: "message_start", message: answer });
			out({ type: "message_end", message: answer });
			save(answer);
			streaming = false;
			out({ type: "agent_end", messages: [answer] });
			return;
		}
		default: return out({ id: cmd.id, type: "response", command: cmd.type, success: false, error: `Unknown command: ${cmd.type}` });
	}
}

out({ type: "extension_ui_request", id: crypto.randomUUID(), method: "setStatus", statusKey: "fake", statusText: "\u001b[31mready\u001b[39m" });
let buffer = "";
process.stdin.on("data", chunk => {
	buffer += chunk.toString("utf8");
	let index;
	while ((index = buffer.indexOf("\n")) >= 0) {
		const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
		if (!line.trim()) continue;
		const cmd = JSON.parse(line);
		if (cmd.type === "extension_ui_response") { pendingUi.get(cmd.id)?.(cmd.cancelled ? undefined : cmd.value); pendingUi.delete(cmd.id); continue; }
		void handle(cmd);
	}
});
process.stdin.on("end", () => process.exit(0));
