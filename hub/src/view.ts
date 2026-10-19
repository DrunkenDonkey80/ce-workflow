// H5-02: the browser's session view. ce-workflow's own chat and activity mirrors (D14) run here, fed by RPC events
// instead of extension hooks. History comes from get_messages; chat older than the last compaction from the JSONL (F3).
import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { createActivityMirror } from "../../extensions/plan3-web.ts";
import { checkIn, createChatMirror } from "./chat.ts";
import type { RpcRecord } from "./rpc-client.ts";

type Row = { id: string; role: string; text: string };
type Page = { rows: Row[]; more: boolean };
const PAGE = 20;
const MAX_CLIENTS = 8;

/** A row id is `<role>_<message timestamp>[_n]` (createChatMirror in chat.ts); 0 when it carries no timestamp. */
const stamp = (id: string) => { const value = Number(/^[a-z]+_(\d+)(?:_\d+)?$/.exec(id)?.[1]); return value > 1e11 ? value : 0; };

/** Message entries of the session's current branch, oldest first. Read-only; the hub never writes a session file. */
export async function branchMessages(file: string): Promise<{ type: "message"; message: any }[]> {
	// shortcut: reads the whole file per request (29 MB ≈ 0.2 s); index line offsets if paging ever feels slow.
	const entries = (await readFile(file, "utf8")).split("\n").flatMap(line => { try { return line ? [JSON.parse(line)] : []; } catch { return []; } });
	const byId = new Map(entries.filter(entry => typeof entry?.id === "string").map(entry => [entry.id, entry]));
	let branch = entries;
	if (byId.size) { // a tree session: walk from the newest entry to the root
		branch = [];
		for (let entry = entries.findLast(item => byId.has(item?.id)); entry; entry = byId.get(entry.parentId)) branch.unshift(entry);
	}
	return branch.filter(entry => entry?.type === "message" && entry.message);
}

/** Rows built by a throwaway mirror, so file rows look exactly like live ones. */
function rowsOf(entries: { type: "message"; message: any }[]) {
	const mirror = createChatMirror({ on() {} }, () => {});
	mirror.hydrate({ sessionManager: { getBranch: () => entries } });
	return mirror;
}

export class SessionView {
	readonly clients = new Set<ServerResponse>();
	private readonly handlers = new Map<string, ((event: unknown, ctx?: unknown) => void)[]>();
	private readonly chat: ReturnType<typeof createChatMirror>;
	private readonly activity: ReturnType<typeof createActivityMirror>;
	private queue: Record<"steering" | "followUp", string[]> = { steering: [], followUp: [] };
	private sequence = 0;
	hydrated = false;
	private readonly session: { file: () => string | undefined; idle: () => boolean; viewers?: (count: number) => void; forms?: () => Record<string, unknown>[] };

	constructor(session: SessionView["session"]) {
		this.session = session;
		const pi = { on: (name: string, handler: (event: unknown) => void) => { this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]); } };
		this.chat = createChatMirror(pi, this.publish);
		this.activity = createActivityMirror(pi, this.publish);
	}

	readonly publish = (event: string, value: any) => {
		// D11: no file watcher; the Files tab refreshes after tools that can change files.
		if (event === "tool" && ["write", "edit", "bash"].includes(value?.name) && value.state !== "running") this.publish("files", {});
		const frame = `id: ${++this.sequence}\nevent: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
		for (const client of this.clients) {
			client.write(frame);
			if (client.writableLength > 8_000_000) { this.clients.delete(client); client.destroy(); } // a stalled page reconnects with a fresh snapshot
		}
	};

	private emit(name: string, event: unknown) { for (const handler of this.handlers.get(name) ?? []) handler(event, this.ctx); }
	private get ctx() { return { isIdle: this.session.idle, hasPendingMessages: () => this.queue.steering.length + this.queue.followUp.length > 0 }; }

	/** One RPC event. Names differ from the extension hooks the mirrors listen to; the rest pass through unchanged. */
	feed(event: RpcRecord) {
		if (event.type === "compaction_start") return this.emit("session_before_compact", event);
		if (event.type === "compaction_end") return this.emit(event.aborted || event.errorMessage ? "session_compact_failed" : "session_compact", event);
		if (event.type === "queue_update") {
			// RPC reports whole queues; the mirror wants one `input` per newly queued message.
			for (const kind of ["steering", "followUp"] as const) {
				const before = [...this.queue[kind]], next: string[] = Array.isArray(event[kind]) ? event[kind] : [];
				for (const text of next) { const at = before.indexOf(text); if (at >= 0) before.splice(at, 1); else this.emit("input", { text, source: "rpc", streamingBehavior: kind === "steering" ? "steer" : "followUp" }); }
				this.queue[kind] = next;
			}
			return;
		}
		this.emit(event.type, event); // F4: the chat mirror only keeps user/assistant rows, so the stored system message never reaches a page
	}

	/** First browser: fill the chat from `get_messages` (live) or the session file (parked). */
	async hydrate(messages?: unknown[]) {
		if (this.hydrated) return;
		const entries = messages ? messages.map(message => ({ type: "message" as const, message })) : await this.fileEntries();
		this.chat.hydrate({ sessionManager: { getBranch: () => entries } });
		// The file only grows, so once older chat exists it stays offered.
		this.olderInFile = await this.hasOlder((this.chat.snapshot() as Row[])[0]?.id);
		this.hydrated = true;
	}
	private olderInFile = false;

	private async hasOlder(id: string | undefined) {
		const oldest = stamp(id ?? "");
		return oldest > 0 && (await this.fileEntries()).some(entry => entry.message.timestamp < oldest && ["user", "assistant"].includes(entry.message.role));
	}

	private async fileEntries() {
		const file = this.session.file();
		try { return file ? await branchMessages(file) : []; } catch { return []; }
	}

	snapshot(extra: Record<string, unknown> = {}) {
		const value = checkIn(this.chat, this.activity.snapshot(this.ctx), this.session.forms?.() ?? [], extra);
		return { ...value, more: value.more || this.olderInFile };
	}

	/** SSE as in ce-workflow: a `snapshot` frame first, then live frames; a reconnect simply gets a new snapshot. */
	attach(response: ServerResponse, extra: Record<string, unknown> = {}) {
		if (this.clients.size >= MAX_CLIENTS) throw Object.assign(new Error("Too many workspace connections."), { status: 429 });
		const initial = `retry: 1000\nid: ${++this.sequence}\nevent: snapshot\ndata: ${JSON.stringify(this.snapshot(extra))}\n\n`;
		response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
		response.write(initial);
		this.clients.add(response);
		this.session.viewers?.(this.clients.size);
		response.on("close", () => { this.clients.delete(response); this.session.viewers?.(this.clients.size); });
	}

	/** `rows?before=`: the hub's buffer first, then older rows from the session file (F3). */
	async page(before?: string): Promise<Page> {
		const buffered = this.chat.snapshot() as Row[];
		if (!before || buffered.some(row => row.id === before)) {
			const page = this.chat.page(before, PAGE) as Page;
			if (page.rows.length || !before) return page.more ? page : { ...page, more: await this.hasOlder(page.rows[0]?.id) };
		} // nothing buffered before it: continue in the file
		const at = stamp(before);
		if (!at) throw Object.assign(new Error("Unknown chat row."), { status: 404 });
		const older = (await this.fileEntries()).filter(entry => entry.message.timestamp < at);
		const page = rowsOf(older.slice(-100)).page(undefined, PAGE) as Page;
		return { rows: page.rows, more: page.more || older.length > 100 };
	}

	/** One whole row (the page asks for it after an excerpt or a stream gap). */
	async row(id: string): Promise<Row> {
		try { return this.chat.row(id); } catch { /* not buffered: an older row from the file */ }
		const at = stamp(id);
		if (!at) throw Object.assign(new Error("Unknown chat row."), { status: 404 });
		const entries = (await this.fileEntries()).filter(entry => entry.message.timestamp <= at);
		try { return rowsOf(entries.slice(-100)).row(id); } catch { throw Object.assign(new Error("Unknown chat row."), { status: 404 }); }
	}

	close() { for (const client of this.clients) client.end(); this.clients.clear(); }
}
