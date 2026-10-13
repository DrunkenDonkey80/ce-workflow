import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface RemoteQuestion {
	question: string;
	context?: string;
	options: { title: string; description?: string }[];
	allowMultiple: boolean;
	allowFreeform: boolean;
}
export type RemoteResponse = { kind: "selection"; selections: string[]; comment?: string } | { kind: "freeform"; text: string };
export type RemoteBatchAnswer = { status: "skipped" } | { status: "answered"; response: RemoteResponse };

export function remoteResponse(payload: unknown, question: RemoteQuestion, allowComment: boolean): RemoteResponse | undefined {
	if (!payload || typeof payload !== "object") return;
	const value = payload as { selections?: unknown; text?: unknown; comment?: unknown };
	if (value.comment !== undefined && (!allowComment || typeof value.comment !== "string" || value.comment.length > 16_000)) return;
	const requested = value.selections ?? (typeof value.text === "string" ? [value.text] : undefined);
	if (!Array.isArray(requested) || !requested.length || requested.some(item => typeof item !== "string" || item.length > 16_000) || (requested.length > 1 && !question.allowMultiple)) return;
	const selected = requested.map(item => question.options.find(option => option.title.trim().toLowerCase() === item.trim().toLowerCase())?.title);
	if (selected.every(item => item !== undefined)) {
		const response: RemoteResponse = { kind: "selection", selections: [...new Set(selected)] };
		if (typeof value.comment === "string" && value.comment.trim()) response.comment = value.comment.trim();
		return response;
	}
	if (question.allowFreeform && requested.length === 1 && requested[0].trim()) return { kind: "freeform", text: requested[0].trim() };
}

export function remoteBatch(payload: unknown, questions: RemoteQuestion[], allowComment: boolean): RemoteBatchAnswer[] | undefined {
	if (!payload || typeof payload !== "object" || !("answers" in payload) || !Array.isArray(payload.answers) || payload.answers.length !== questions.length) return;
	const answers: RemoteBatchAnswer[] = [];
	for (const [index, entry] of payload.answers.entries()) {
		if (!entry || typeof entry !== "object") return;
		if (entry.status === "skipped") { answers.push({ status: "skipped" }); continue; }
		if (entry.status !== "answered") return;
		const response = remoteResponse(entry.response?.kind === "freeform" ? { text: entry.response.text } : entry.response, questions[index], allowComment);
		if (!response) return;
		answers.push({ status: "answered", response });
	}
	return answers;
}

export interface RemoteListPrompt {
	kind: "list"; title: string; purpose: string;
	items: { value: string; label: string; description?: string; heading?: boolean; disabled?: boolean; enabled?: boolean; rowAction?: boolean }[];
	currentValue?: string; multi?: { selected: string[]; requireOne?: boolean };
	spaceAction?: boolean; rowAction?: boolean; tabAction?: boolean;
}

// The native popup and authenticated local browser race; remote answers close the losing UI by aborting its signal.
export async function raceRemoteAsk<T>(pi: ExtensionAPI, subject: RemoteQuestion & { allowComment: boolean } | { questions: RemoteQuestion[]; allowComment: boolean } | RemoteListPrompt, signal: AbortSignal | undefined, timeout: number | undefined,
	decode: (payload: unknown) => T | undefined, run: (signal: AbortSignal) => Promise<T | null>): Promise<T | null> {
	if (signal?.aborted) return null;
	const askId = randomUUID(), local = new AbortController();
	let settled = false, resolve!: (value: T | null) => void, reject!: (reason: unknown) => void;
	const result = new Promise<T | null>((yes, no) => { resolve = yes; reject = no; });
	const finish = (value: T | null) => { if (settled) return; settled = true; resolve(value); local.abort(); };
	const abort = () => finish(null);
	const dispose = pi.events.on("ask:answer", (payload: unknown) => {
		if (settled || !payload || typeof payload !== "object" || !("askId" in payload) || payload.askId !== askId) return;
		if ("cancel" in payload && payload.cancel === true) { finish(null); return; }
		const value = decode(payload);
		if (value !== undefined) finish(value);
	});
	signal?.addEventListener("abort", abort, { once: true });
	const timer = timeout && timeout > 0 ? setTimeout(abort, timeout) : undefined;
	try {
		Promise.resolve().then(() => settled ? null : run(local.signal)).then(finish, error => {
			if (!settled) { settled = true; reject(error); local.abort(); }
		});
		pi.events.emit("ask:pending", { ...subject, askId });
		return await result;
	} finally {
		settled = true;
		local.abort();
		dispose();
		signal?.removeEventListener("abort", abort);
		if (timer !== undefined) clearTimeout(timer);
		pi.events.emit("ask:closed", { askId });
	}
}
