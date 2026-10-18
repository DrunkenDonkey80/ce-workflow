// Chat rows and check-in snapshots for the page, built from the session's RPC events
// (moved from ce-workflow plan3-web.ts in plan 0db155f7 H9-01).
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

// Thinking and tool calls travel as collapsed blocks (like Pi's terminal); a tool result joins its call's block.
type ChatBlock = { type: "thinking"; text: string } | { type: "tool"; id: string; name: string; title: string; args: string; result?: string; error?: boolean; diff?: string };
type ChatRow = { id: string; role: string; text: string; streaming: boolean; truncated?: boolean; excerpt?: boolean; brief?: boolean; error?: string; blocks?: ChatBlock[] };
// Thinking/tool blocks as titles only (brief); the page fetches the full row when one opens.
const briefBlocks = (blocks: ChatBlock[]) => blocks.map(block => block.type === "thinking" ? { ...block, text: "" } : { ...block, args: "", ...(block.result === undefined ? {} : { result: "" }), ...(block.diff === undefined ? {} : { diff: "" }) });
// Cuts never split a surrogate pair.
const head = (text: string, length: number) => text.length > length ? text.slice(0, length).replace(/[\ud800-\udbff]$/, "") : text;
const tail = (text: string, length: number) => text.length > length ? text.slice(-length).replace(/^[\udc00-\udfff]/, "") : text;
// Check-in rows (D20): at most 2 KB of text (excerpt) and brief blocks.
function excerptRow(row: ChatRow): ChatRow {
	return { ...row, text: head(row.text, 2000), ...(row.text.length > 2000 ? { excerpt: true } : {}), ...(row.blocks?.length ? { blocks: briefBlocks(row.blocks), brief: true } : {}) };
}
/** Calls `flush(key)` at most every `ms` per key; `now` flushes at once (final updates). */
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
const clip = (text: string, limit: number) => text.length > limit ? text.slice(0, limit) + "\n\u2026 truncated" : text;
/** One-line tool label: the name plus its most telling argument (path, command, query or the first text). */
function toolTitle(name: string, args: Record<string, unknown>) {
	const value = ["path", "file", "command", "query", "url", "question", "action", "agent"].map(key => args?.[key]).find(item => typeof item === "string") ?? Object.values(args ?? {}).find(item => typeof item === "string");
	const line = String(value ?? "").split("\n").find(item => item.trim())?.trim() ?? "";
	return (name + " " + (line.length > 90 ? line.slice(0, 89) + "\u2026" : line)).trim();
}
export function createChatMirror(pi, publish: (event: string, data: unknown) => void) {
	const rows: ChatRow[] = [], active = new Map<string, string>(), sent = new Map<string, { length: number; blocks: string }>();
	let next = 0;
	// Live stream (D20/D21): `{ id, offset, text }` appends; blocks travel brief and only when they change.
	// shortcut: assumes streamed text only grows (a shorter text resends from offset 0); hash the prefix if rewrites appear.
	const stream = coalescer(id => {
		const row = rows.find(item => item.id === id);
		if (!row) return void sent.delete(id);
		const last = sent.get(id), offset = last && row.text.length >= last.length ? last.length : 0;
		const blocks = row.blocks?.length ? briefBlocks(row.blocks) : [], json = JSON.stringify(blocks);
		publish("delta", { id, role: row.role, offset, text: row.text.slice(offset), streaming: row.streaming, ...(row.truncated ? { truncated: true } : {}), ...(row.error ? { error: row.error } : {}), ...(json !== last?.blocks ? { blocks } : {}) });
		sent.set(id, { length: row.text.length, blocks: json });
		for (const key of sent.keys()) if (!rows.some(item => item.id === key)) sent.delete(key);
	});
	const put = (message, streaming: boolean, emit = true, start = false) => {
		if (message?.role === "toolResult") {
			const row = rows.findLast(item => item.blocks?.some(block => block.type === "tool" && block.id === message.toolCallId));
			const block = row?.blocks.find(item => item.type === "tool" && item.id === message.toolCallId);
			if (!block || block.type !== "tool") return;
			block.result = clip((Array.isArray(message.content) ? message.content : []).map(part => part?.type === "text" ? part.text : part?.type === "image" ? "[image]" : "").join("\n"), 4000);
			if (message.isError) block.error = true;
			// Pi's edit tool: "+12 line" / "-12 line" / " 12 line" rows, coloured like the terminal.
			if (typeof message.details?.diff === "string") block.diff = clip(message.details.diff, 8000);
			if (emit) stream.push(row.id, true);
			return;
		}
		if (!["user", "assistant"].includes(message?.role)) return;
		const role = message.role;
		const base = typeof message.timestamp === "number" ? `${role}_${message.timestamp}` : `${role}_${++next}`;
		let id = active.get(role) ?? base;
		if (start) {
			id = base;
			for (let suffix = 2; rows.some(row => row.id === id); suffix++) id = `${base}_${suffix}`;
		}
		active.set(role, id);
		const content = typeof message.content === "string" ? message.content : (Array.isArray(message.content) ? message.content.map(part => part?.type === "text" && typeof part.text === "string" ? part.text : part?.type === "image" ? "[image]" : "").filter(Boolean).join("\n") : "");
		// shortcut: keep 100 recent rows / 512 KB; each row is capped at 64k chars, show truncation in the UI.
		const index = rows.findIndex(item => item.id === id), results = new Map((rows[index]?.blocks ?? []).flatMap(block => block.type === "tool" && block.result !== undefined ? [[block.id, block]] : []));
		const blocks: ChatBlock[] = (Array.isArray(message.content) ? message.content : []).flatMap(part => part?.type === "thinking" && part.thinking?.trim() ? [{ type: "thinking" as const, text: clip(part.thinking, 4000) }]
			: part?.type === "toolCall" ? [{ type: "tool" as const, id: String(part.id), name: String(part.name), title: toolTitle(String(part.name), part.arguments), args: clip(JSON.stringify(part.arguments ?? {}, null, 1), 2000), ...(part.name === "write" && typeof part.arguments?.content === "string" ? { diff: clip(part.arguments.content.split("\n").map(line => "+" + line).join("\n"), 8000) } : {}), ...(results.has(part.id) ? { result: results.get(part.id).result, ...(results.get(part.id).error ? { error: true } : {}), ...(results.get(part.id).diff === undefined ? {} : { diff: results.get(part.id).diff }) } : {}) }] : []);
		const row: ChatRow = { id, role, text: content.slice(0, 64_000), streaming, ...(content.length > 64_000 ? { truncated: true } : {}), ...(typeof message.errorMessage === "string" ? { error: message.errorMessage.slice(0, 4000) } : {}), ...(blocks.length ? { blocks } : {}) };
		if (index < 0) rows.push(row); else rows[index] = row;
		while (rows.length > 100 || Buffer.byteLength(JSON.stringify(rows)) > 512_000) rows.shift();
		if (emit) stream.push(id, !streaming);
		if (!streaming) active.delete(role);
	};
	pi.on("input", event => { publish("input", { text: typeof event.text === "string" ? event.text.slice(0, 64_000) : "", source: event.source, streamingBehavior: event.streamingBehavior }); });
	pi.on("message_start", event => put(event.message, true, true, true));
	pi.on("message_update", event => put(event.message, true));
	pi.on("message_end", event => put(event.message, false));
	return {
		snapshot: () => structuredClone(rows),
		/** The `count` rows before `before` (default: newest) as excerpts, and whether older rows exist. */
		page(before?: string, count = 20) {
			const end = before ? rows.findIndex(row => row.id === before) : rows.length;
			if (end < 0) throw fail(404, "Unknown chat row.");
			return { rows: rows.slice(Math.max(0, end - count), end).map(excerptRow), more: end > count };
		},
		row(id: string) {
			const row = rows.find(item => item.id === id);
			if (!row) throw fail(404, "Unknown chat row.");
			return structuredClone(row);
		},
		reset: () => { rows.length = 0; active.clear(); sent.clear(); stream.clear(); next = 0; },
		hydrate(ctx) {
			const live = structuredClone(rows);
			rows.length = 0;
			for (const entry of (ctx.sessionManager?.getBranch?.() ?? []).filter(entry => entry.type === "message").slice(-100)) put(entry.message, false, false, true);
			for (const row of live) {
				const index = rows.findIndex(item => item.id === row.id);
				if (index < 0) rows.push(row); else rows[index] = row;
			}
			while (rows.length > 100 || Buffer.byteLength(JSON.stringify(rows)) > 512_000) rows.shift();
			active.clear();
			for (const row of rows) if (row.streaming) active.set(row.role, row.id);
		},
	};
}

/**
 * Check-in packet (D20/D21): newest row excerpts, running tools, whole dialogs up to 16 KB (larger ones brief,
 * fetched via /api/dialog) and a thinking tail, within 64 KB encoded. The diagram loads separately.
 */
export function checkIn(chat: { page: () => { rows: ChatRow[]; more: boolean } }, live, asks: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
	const page = chat.page(), bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
	const dialogs = asks.map(ask => bytes(ask) <= 16_000 ? ask : { askId: ask.askId, kind: ask.kind, brief: true, title: head(String(ask.title ?? ask.question ?? "Answer questions"), 200) });
	const snapshot = { ...extra, dialogs, chat: page.rows, more: page.more, activity: { ...live, thinking: tail(live.thinking, 2000), thinkingLength: live.thinking.length, queue: live.queue.slice(-20).map(item => ({ ...item, text: head(item.text, 500) })), tools: live.tools.filter(tool => tool.state === "running") } };
	while (snapshot.chat.length > 1 && bytes(snapshot) > 64_000) { snapshot.chat.shift(); snapshot.more = true; }
	// shortcut: only many dialogs near 16 KB can still pass 64 KB; brief them all if that ever shows up.
	if (bytes(snapshot) > 64_000) snapshot.activity.tools = snapshot.activity.tools.map(({ args: _args, progress: _progress, ...tool }) => tool);
	return snapshot;
}

