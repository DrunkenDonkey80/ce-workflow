#!/usr/bin/env node
// Minimal stand-in for `pi --mode rpc` used by hub tests. Speaks LF-delimited JSONL on stdin/stdout.
// Behaviour switches come from FAKE_PI (comma list): "crash-on-prompt", "slow-command", "split-output", "no-hub",
// "slow-start" (the first get_state answers after 300 ms), "fail-start" (get_state fails),
// "compacted" (get_messages returns only the last 3 messages, like after a compaction, F3).
// FAKE_PI_HUB_URL: /pi-hub calls are POSTed there as {endpoint, data} and its {ok, value | status, error} is the answer.
// `/hubask [ms] [json]`: a channel ask with that ask_user data (default {q:"?"}).
import crypto from "node:crypto";
import fs from "node:fs";
const flags = new Set((process.env.FAKE_PI ?? "").split(",").filter(Boolean));
const args = process.argv.slice(2);
const sessionArg = args[args.indexOf("--session") + 1];
let sessionFile = args.includes("--session") ? sessionArg : `${process.cwd()}/fake-${crypto.randomUUID()}.jsonl`;
// Like Pi, a new session file starts with its header (the session id intercom uses).
const header = () => { if (!fs.existsSync(sessionFile)) fs.writeFileSync(sessionFile, JSON.stringify({ type: "session", id: crypto.randomUUID(), cwd: process.cwd() }) + "\n"); };
header();
let sessionName = args.includes("--name") ? args[args.indexOf("--name") + 1] : undefined;
let model = { provider: "fake", id: "fake-1" }, thinkingLevel = "low", streaming = false; const queued = [];
const messages = fs.existsSync(sessionFile)
	? fs.readFileSync(sessionFile, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).filter(e => e.type === "message").map(e => e.message)
	: [];
const pendingUi = new Map();
let started = false;
const out = value => {
	const line = Buffer.from(JSON.stringify(value) + "\n");
	if (!flags.has("split-output")) return process.stdout.write(line);
	// Split mid-record and inside multi-byte characters to test the reader's framing.
	for (let i = 0; i < line.length; i += 3) process.stdout.write(line.subarray(i, i + 3));
};
const save = message => { messages.push(message); fs.appendFileSync(sessionFile, JSON.stringify({ type: "message", message }) + "\n"); };
const ui = (method, fields) => new Promise(resolve => { const id = crypto.randomUUID(); pendingUi.set(id, resolve); out({ type: "extension_ui_request", id, method, ...fields }); });

async function handle(cmd) {
	const reply = (data, extra = {}) => out({ id: cmd.id, type: "response", command: cmd.type, success: true, ...(data === undefined ? {} : { data }), ...extra });
	switch (cmd.type) {
		case "get_state":
			if (flags.has("fail-start")) return out({ id: cmd.id, type: "response", command: cmd.type, success: false, error: "fake start failure" });
			if (flags.has("slow-start") && !started) { started = true; await new Promise(r => setTimeout(r, 300)); }
			return reply({ model, thinkingLevel, isStreaming: streaming, isCompacting: false, sessionFile, sessionName, messageCount: messages.length, pendingMessageCount: 0 });
		case "get_messages": return reply({ messages: flags.has("compacted") ? messages.slice(-3) : messages });
		case "get_commands": return reply({ commands: flags.has("no-hub") ? [] : [{ name: "pi-hub", source: "extension" }] });
		case "get_available_models": return reply({ models: [{ provider: "fake", id: "fake-1", name: "Fake One" }, { provider: "fake", id: "fake-2", name: "Fake Two" }] });
		case "get_session_stats": return reply({ sessionFile, contextUsage: { percent: 42, tokens: 84000, contextWindow: 200000 } });
		case "set_model":
			if (cmd.provider === "nokey") return out({ id: cmd.id, type: "response", command: "set_model", success: false, error: "No API key for nokey" });
			model = { provider: cmd.provider, id: cmd.modelId, name: cmd.modelId }; return reply(model);
		case "set_thinking_level": thinkingLevel = cmd.level; out({ type: "thinking_level_changed", level: cmd.level }); return reply();
		case "abort": if (streaming) { streaming = false; out({ type: "agent_settled", aborted: true }); } return reply();
		case "steer": case "follow_up": queued.push(cmd.message); out({ type: "queue_update", steering: [...queued], followUp: [] }); return reply();
		case "clear_queue": { const taken = queued.splice(0); out({ type: "queue_update", steering: [], followUp: [] }); return reply({ steering: taken, followUp: [] }); }
		// Like Pi in RPC: a new session falls back to the default model and thinking level.
		case "new_session": sessionFile = `${process.cwd()}/fake-${crypto.randomUUID()}.jsonl`; model = { provider: "fake", id: "fake-1" }; thinkingLevel = "low"; header(); messages.length = 0; return reply({ cancelled: false });
		// Like Pi: fork from a user message starts a new file holding only what came before it.
		case "get_fork_messages": return reply({ messages: messages.flatMap((m, at) => m.role === "user" ? [{ entryId: String(at), text: m.content.map(p => p.text ?? "").join("") }] : []) });
		case "fork": {
			const at = Number(cmd.entryId), text = messages[at].content.map(p => p.text ?? "").join(""), kept = messages.slice(0, at);
			sessionFile = `${process.cwd()}/fake-${crypto.randomUUID()}.jsonl`; header(); messages.length = 0; kept.forEach(save);
			return reply({ text, cancelled: false });
		}
		case "set_session_name": sessionName = cmd.name; return reply();
		case "prompt": {
			if (flags.has("crash-on-prompt")) process.exit(3);
			if (cmd.message.startsWith("/")) {
				// Extension commands answer only after the handler finishes (F6).
				if (cmd.message.startsWith("/ask")) { const value = await ui("input", { title: "pi-hub:ask", placeholder: cmd.message.slice(5) }); out({ type: "extension_ui_request", id: crypto.randomUUID(), method: "notify", message: `answer:${value ?? "<cancelled>"}` }); }
				if (cmd.message.startsWith("/hubask")) {
					// Mirrors ce-workflow hub-channel.ts ask(): marker input, JSON placeholder, Pi-side timeout, then `closed`.
					const [, delay, json] = /^\/hubask ?(\d*) ?(.*)$/s.exec(cmd.message);
					const askId = crypto.randomUUID(), ms = Number(delay) || 0, data = json ? JSON.parse(json) : { q: "?" };
					const requestId = crypto.randomUUID();
					const value = await new Promise(resolve => {
						pendingUi.set(requestId, resolve);
						out({ type: "extension_ui_request", id: requestId, method: "input", title: "pi-hub:ask", placeholder: JSON.stringify({ id: askId, data }), timeout: ms || undefined });
						if (ms) setTimeout(() => { pendingUi.delete(requestId); resolve(undefined); }, ms);
					});
					out({ type: "extension_ui_request", id: crypto.randomUUID(), method: "setStatus", statusKey: "pi-hub:closed", statusText: JSON.stringify({ id: askId }) });
					out({ type: "extension_ui_request", id: crypto.randomUUID(), method: "notify", message: `answer:${value ?? "<cancelled>"}` });
				}
				// Mirrors ce-workflow plan3.ts /pi-hub: answers by id; "/api/fail" errors, anything else echoes.
				if (cmd.message.startsWith("/pi-hub ")) {
					const call = JSON.parse(cmd.message.slice(8));
					const result = process.env.FAKE_PI_HUB_URL ? await (await fetch(process.env.FAKE_PI_HUB_URL, { method: "POST", body: JSON.stringify({ endpoint: call.endpoint, data: call.data }) })).json()
						: call.endpoint === "/api/fail" ? { ok: false, status: 404, error: "Displayed plan no longer exists." } : { ok: true, value: { endpoint: call.endpoint, data: call.data } };
					out({ type: "extension_ui_request", id: crypto.randomUUID(), method: "setStatus", statusKey: "pi-hub:result", statusText: JSON.stringify({ id: call.id, ...result }) });
				}
				// Mirrors ce-workflow plan3.ts publishHub(): `/state <json>` publishes pi-hub:state.
				// Mirrors plan3.ts plan3:diagram-changed under the hub: `/diagram <json>` publishes pi-hub:diagram.
				// `/dialog <method> <json fields>`: a plain RPC dialog as other extensions raise; the notify carries the raw response.
				if (cmd.message.startsWith("/dialog ")) {
					const [, method, fields] = /^\/dialog (\w+) (.*)$/.exec(cmd.message);
					const response = await new Promise(resolve => { const id = crypto.randomUUID(); resolve.raw = true; pendingUi.set(id, resolve); out({ type: "extension_ui_request", id, method, ...JSON.parse(fields) }); });
					const { type: _t, id: _i, ...rest } = response;
					out({ type: "extension_ui_request", id: crypto.randomUUID(), method: "notify", message: `dialog:${JSON.stringify(rest)}` });
				}
				if (cmd.message.startsWith("/diagram ")) out({ type: "extension_ui_request", id: crypto.randomUUID(), method: "setStatus", statusKey: "pi-hub:diagram", statusText: cmd.message.slice(9) });
				// Mirrors plan3.ts "Start work in a new session": an extension command replaces the session in-process.
				if (cmd.message === "/switch") { sessionFile = `${process.cwd()}/fake-${crypto.randomUUID()}.jsonl`; header(); messages.length = 0; }
				if (cmd.message.startsWith("/state ")) out({ type: "extension_ui_request", id: crypto.randomUUID(), method: "setStatus", statusKey: "pi-hub:state", statusText: cmd.message.slice(7) });
				if (flags.has("slow-command")) await new Promise(r => setTimeout(r, 300));
				return reply({ disposition: "handled" });
			}
			reply({ disposition: "started" });
			streaming = true;
			out({ type: "agent_start" });
			if (cmd.message === "hold") return; // stays working until abort
			const user = { role: "user", content: [{ type: "text", text: cmd.message }], timestamp: Date.now() };
			out({ type: "message_start", message: user });
			out({ type: "message_end", message: user });
			save(user);
			const system = { role: "system", content: "SYSTEM PROMPT ".repeat(100), timestamp: Date.now() }; // F4: real Pi sends this too
			out({ type: "message_start", message: system });
			out({ type: "message_end", message: system });
			const answer = { role: "assistant", content: [{ type: "text", text: `echo: ${cmd.message}` }], timestamp: Date.now() };
			out({ type: "message_start", message: { ...answer, content: [{ type: "text", text: "echo" }] } });
			out({ type: "message_update", message: { ...answer, content: [{ type: "text", text: "echo" }] }, assistantMessageEvent: { type: "text_delta" } });
			out({ type: "message_end", message: answer });
			save(answer);
			streaming = false;
			out({ type: "agent_end", messages: [answer] });
			out({ type: "agent_settled", aborted: false });
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
		if (cmd.type === "extension_ui_response") { const resolve = pendingUi.get(cmd.id); pendingUi.delete(cmd.id); resolve?.(resolve.raw ? cmd : cmd.cancelled ? undefined : cmd.value); continue; }
		void handle(cmd);
	}
});
process.stdin.on("end", () => process.exit(0));
