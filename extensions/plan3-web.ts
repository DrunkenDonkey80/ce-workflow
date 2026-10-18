// What Pi itself serves to pi-control-hub's page (plan 0db155f7): page-call errors and targets, chat forwarding,
// and the live activity whose compacting/subagent state the hub cannot see from RPC events.
import { createHash, randomUUID } from "node:crypto";
import { diagramChatMessage, type Diagram } from "./plan3-diagram.ts";

export type WebTarget = { kind: "product" } | { kind: "plan"; id: string };
export class WebError extends Error {
	status: number;
	constructor(status: number, message: string) { super(message); this.status = status; }
}
export function webTarget(value: unknown): WebTarget {
	if (value === "product") return { kind: "product" };
	if (typeof value === "string" && /^[a-f0-9]{8}$/.test(value)) return { kind: "plan", id: value };
	throw new WebError(400, "Name the displayed stable plan id or product target.");
}

function coalescer(flush: (key: string) => void, ms = 250) {
	const timers = new Map<string, { at: number; timer?: ReturnType<typeof setTimeout> }>();
	const run = (key: string) => { const entry = timers.get(key); clearTimeout(entry?.timer); timers.set(key, { at: Date.now() }); flush(key); };
	return {
		push(key: string, now = false) {
			const entry = timers.get(key);
			if (now || !entry || Date.now() - entry.at >= ms) return run(key);
			entry.timer ??= setTimeout(() => run(key), ms - (Date.now() - entry.at));
		},
		clear() { for (const entry of timers.values()) clearTimeout(entry.timer); timers.clear(); },
	};
}

const terminalCommands = new Set(["settings", "model", "thinking", "scoped-models", "login", "logout", "llama", "new", "resume", "name", "session", "tree", "fork", "clone", "compact", "import", "copy", "export", "share", "bug", "trust", "hotkeys", "changelog", "quit"]);
export function forwardDiagramChat(pi, ctx, diagram: Diagram | { diagram: Diagram; ids?: string[] }[], message: unknown, comments: unknown, publish: (event: string, value: unknown) => void) {
	const contextual = diagramChatMessage(diagram, message, comments);
	const prepared = contextual.mentions.length || (Array.isArray(comments) && comments.length) ? contextual : { message: (message as string).trim(), mentions: [], unknownMentions: [] };
	const command = prepared.message.startsWith("/");
	const name = command ? prepared.message.slice(1).split(/\s/, 1)[0] : "";
	if (terminalCommands.has(name)) throw new WebError(400, `/${name}: terminal only.`);
	// Built-in /reload cannot run from sendUserMessage; /wo reload calls ctx.reload() and the page reconnects.
	if (name === "reload") prepared.message = "/wo reload";
	const queued = !ctx.isIdle();
	try {
		const pending = pi.sendUserMessage(prepared.message, { expandPromptTemplates: command, ...(queued ? { deliverAs: "followUp" } : {}) });
		// SDK declaration says void, but live probe found a promise that settles only after the run.
		void Promise.resolve(pending).catch(error => publish("error", { message: `Message not delivered: ${error instanceof Error ? error.message : String(error)}` }));
	} catch (error) {
		publish("error", { message: `Message not delivered: ${error instanceof Error ? error.message : String(error)}` });
		throw error;
	}
	return { queued, mentions: prepared.mentions, unknownMentions: prepared.unknownMentions };
}

type ToolActivity = { id: string; name: string; state: string; parent?: string; args?: string; progress?: string; result?: string; startedAt?: number; durationMs?: number };
type SubagentActivity = { id: string; label: string; model?: string; state: string; turns?: number; tools?: number; tool?: string };
// pi-subagents' public status RPC; undefined when it is not loaded or does not answer.
function subagentRuns(pi): Promise<{ runs: any[]; fleet: any[] } | undefined> {
	if (!pi.events?.on || !pi.events?.emit) return Promise.resolve(undefined);
	return new Promise(resolve => {
		const requestId = randomUUID();
		let off;
		const done = (value?: { runs: any[]; fleet: any[] }) => { clearTimeout(timer); off?.(); resolve(value); };
		const timer = setTimeout(() => done(), 2000);
		off = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, reply => done(reply?.success && Array.isArray(reply.data?.asyncSnapshot?.runs) ? { runs: reply.data.asyncSnapshot.runs, fleet: Array.isArray(reply.data.fleet?.entries) ? reply.data.fleet.entries : [] } : undefined));
		pi.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method: "status", params: {} });
	});
}
export function createActivityMirror(pi, publish: (event: string, value: unknown) => void) {
	const tools: ToolActivity[] = [], queued: { id: string; digest: string; text: string; delivery: string }[] = [];
	let working = false, compacting = false, thinking = "", error = "", interrupted = false, sequence = 0, dialog = "";
	// Background subagents outlive the parent's run, so the page stays busy until they finish too.
	let subagents: SubagentActivity[] = [], subagentTimer: ReturnType<typeof setTimeout> | undefined, polling = false;
	const digest = (text: string) => createHash("sha256").update(text).digest("hex");
	const textOf = message => typeof message?.content === "string" ? message.content : (message?.content ?? []).filter(part => part?.type === "text").map(part => part.text).join("\n");
	const brief = (value: unknown) => {
		try {
			const text = typeof value === "string" ? value : JSON.stringify(value, (_key, item) => item?.type === "image" ? { type: "image", note: "Image omitted from activity" } : item) ?? "";
			return text.length > 16_000 ? text.slice(0, 16_000) + "\n… truncated" : text;
		} catch { return "[Unserializable tool data]"; }
	};
	// Tool results are { content: [{ type: "text", text }] }: show their text, not escaped JSON.
	const resultText = (value: unknown) => Array.isArray((value as { content?: unknown })?.content)
		? brief((value as { content: { type?: string; text?: string }[] }).content.map(part => part?.type === "text" ? part.text ?? "" : part?.type === "image" ? "[image]" : "").filter(Boolean).join("\n"))
		: brief(value);
	const snapshot = ctx => {
		const hasPendingMessages = ctx?.hasPendingMessages?.();
		if (hasPendingMessages === false) queued.length = 0;
		return { hasPendingMessages, working: ctx?.isIdle ? !ctx.isIdle() : working, compacting, subagents: structuredClone(subagents), dialog, thinking, error, interrupted, queueExact: false, queue: queued.map(({ id, text, delivery }) => ({ id, text, delivery })), tools: structuredClone(tools) };
	};
	// Live activity (D20): state without tools/thinking; tools travel as single changed rows, thinking as deltas.
	const emit = () => { const { tools: _tools, thinking: _thinking, ...state } = snapshot(undefined); publish("activity", state); };
	let thinkingSent = 0;
	const thoughts = coalescer(() => { const offset = thinking.length >= thinkingSent ? thinkingSent : 0; publish("thinking", { offset, text: thinking.slice(offset) }); thinkingSent = thinking.length; });
	const tool = (event, patch: Partial<ToolActivity>) => {
		if (typeof event.toolCallId !== "string" || typeof event.toolName !== "string") return;
		const index = tools.findIndex(row => row.id === event.toolCallId);
		const row = { ...(tools[index] ?? { state: "running" }), id: event.toolCallId, name: event.toolName, ...(event.parentToolCallId ? { parent: event.parentToolCallId } : {}), ...patch };
		if (index < 0) tools.push(row); else tools[index] = row;
		// shortcut: latest 50 tool rows / 512 KB, text-only snapshots; native custom renderers stay in the terminal.
		while (tools.length > 50 || Buffer.byteLength(JSON.stringify(tools)) > 512_000) tools.shift();
		publish("tool", row);
	};
	// Each run starts a fresh tool list; finished calls stay in the chat rows.
	pi.on("agent_start", () => { tools.length = 0; working = true; interrupted = false; thinking = ""; error = ""; thoughts.push("thinking", true); emit(); });
	pi.on("agent_settled", event => {
		working = false; interrupted = Boolean(event.aborted); queued.length = 0;
		for (const row of tools) if (row.state === "running") { row.state = interrupted ? "interrupted" : "settled"; publish("tool", row); }
		emit();
	});
	pi.on("message_start", event => {
		if (event.message?.role === "user") {
			const index = queued.findIndex(item => item.digest === digest(textOf(event.message)));
			if (index >= 0) queued.splice(index, 1);
			emit();
		}
	});
	pi.on("message_update", event => {
		if (event.message?.role !== "assistant") return;
		const content = event.message.content ?? [];
		thinking = content.filter(part => part.type === "thinking").map(part => part.thinking ?? "[redacted thinking]").join("\n").slice(0, 64_000);
		if (event.assistantMessageEvent?.type?.startsWith("thinking_")) thoughts.push("thinking");
	});
	pi.on("message_end", event => { if (event.message?.errorMessage) { error = brief(event.message.errorMessage); emit(); } });
	pi.on("input", event => {
		if (!event.streamingBehavior || typeof event.text !== "string") return;
		queued.push({ id: `queued_${++sequence}`, digest: digest(event.text), text: brief(event.text), delivery: event.streamingBehavior });
		while (queued.length > 100 || Buffer.byteLength(JSON.stringify(queued)) > 512_000) queued.shift();
		emit();
	});
	pi.on("tool_execution_start", event => tool(event, { state: "running", startedAt: Date.now(), args: brief(event.args) }));
	pi.on("tool_execution_update", event => tool(event, { progress: resultText(event.partialResult) }));
	pi.on("tool_execution_end", event => {
		const startedAt = tools.find(row => row.id === event.toolCallId)?.startedAt;
		tool(event, { state: event.isError ? "error" : "done", result: resultText(event.result), durationMs: event.durationMs ?? (startedAt === undefined ? undefined : Date.now() - startedAt) });
	});
	// Any blocking terminal dialog; the page hides it while a bridged ask_user/Plan3 dialog is open there.
	pi.on("ui_prompt_start", event => { dialog = brief(event.title || `${event.kind} prompt`).slice(0, 200); emit(); });
	pi.on("ui_prompt_end", () => { dialog = ""; emit(); });
	pi.on("session_before_compact", () => { compacting = true; emit(); });
	pi.on("session_compact", () => { compacting = false; emit(); });
	pi.on("session_compact_failed", event => { compacting = false; error = brief(event.errorMessage ?? (event.aborted ? "Compaction cancelled" : "Compaction failed")); emit(); });
	const offs = [pi.events?.on?.("wo:compacting", event => { compacting = Boolean(event?.active); emit(); })];
	// Poll pi-subagents only while its runs are active; lifecycle events and session start (re)arm it.
	const pollSubagents = async () => {
		if (polling) return;
		polling = true; clearTimeout(subagentTimer); subagentTimer = undefined;
		try {
			const status = await subagentRuns(pi);
			if (status) {
				// The async snapshot has no model; the fleet rows do, keyed by agent name.
				const modelOf = (label: string) => { const agents = label.split(", "), ids = [...new Set(status.fleet.filter(entry => agents.includes(entry?.agent) && typeof entry.model === "string").map(entry => entry.model.replace(/:[a-z]+$/, "")))]; return ids.length ? ids.map(id => modelNames.get(id) ?? id.split("/").pop()).join(", ") : undefined; };
				const next = status.runs.filter(run => run?.state === "running" || run?.state === "queued").map(run => { const label = String(run.label ?? "subagent"), model = modelOf(label); return { id: String(run.id), label, ...(model ? { model } : {}), state: run.state, turns: run.activity?.turnCount, tools: run.activity?.toolCount, tool: run.activity?.currentTool }; });
				if (JSON.stringify(next) !== JSON.stringify(subagents)) { subagents = next; emit(); }
			}
		} finally { polling = false; }
		if (subagents.length) { subagentTimer = setTimeout(pollSubagents, 3000); subagentTimer.unref?.(); }
	};
	// The started event can precede pi-subagents registering the job, so look a moment later.
	const soon = () => { clearTimeout(subagentTimer); subagentTimer = setTimeout(pollSubagents, 300); subagentTimer.unref?.(); };
	for (const name of ["subagent:async-started", "subagent:async-complete", "subagent:child-status"]) offs.push(pi.events?.on?.(name, soon));
	// Friendly model names ("GPT-6 Astra") from the session's registry.
	let modelNames = new Map<string, string>();
	pi.on("session_start", (_event, ctx) => { soon(); Promise.resolve(ctx?.modelRegistry?.getAvailable?.()).then(list => { if (Array.isArray(list)) modelNames = new Map(list.map(model => [`${model.provider}/${model.id}`, model.name ?? model.id])); }).catch(() => {}); });
	return { snapshot, dispose: () => { clearTimeout(subagentTimer); for (const off of offs) off?.(); }, reset: () => {
		subagents = []; soon(); tools.length = 0; queued.length = 0; working = false; compacting = false; dialog = ""; thinking = ""; thinkingSent = 0; thoughts.clear(); error = ""; interrupted = false; sequence = 0; } };
}
