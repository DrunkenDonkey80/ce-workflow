// H5-04 (D21): every prompt is one ask_user form in the page. Channel asks (ce-workflow hub-channel.ts) already carry
// ask_user data; Pi's plain RPC dialogs (Pi docs/rpc.md "Extension UI") are converted here. A form's askId is its RPC request id.
import type { RpcRecord } from "./rpc-client.ts";

type Form = Record<string, unknown> & { askId: string };
type Response = { value?: string; confirmed?: boolean; cancelled?: boolean };
const parse = (text: unknown) => { try { return JSON.parse(String(text)); } catch { return undefined; } };
const bad = (message: string) => Object.assign(new Error(message), { status: 400 });

/** The page form for an open dialog; undefined for channel traffic that is not a question. */
export function toForm(dialog: RpcRecord): Form | undefined {
	const askId = dialog.id as string, title = String(dialog.title ?? "");
	if (title.startsWith("pi-hub:")) {
		const data = title === "pi-hub:ask" && dialog.method === "input" ? parse(dialog.placeholder)?.data : undefined;
		return data && typeof data === "object" ? { ...data, askId } : undefined;
	}
	switch (dialog.method) {
		case "select": // strings only (F9: "● Settings — description"), so a filterable list of labels
			return { askId, kind: "list", title, purpose: "Choose an option to continue.", items: ((dialog.options ?? []) as string[]).map(option => ({ value: option, label: option })) };
		case "confirm": // the Yes/No compact card (H3-07)
			return { askId, kind: "list", compact: true, title, purpose: String(dialog.message ?? ""), items: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] };
		case "input":
			return { askId, question: title, ...(dialog.placeholder ? { context: String(dialog.placeholder) } : {}), options: [], allowFreeform: true };
		case "editor":
			return { askId, question: title, options: [], allowFreeform: true, initialText: String(dialog.prefill ?? "") };
	}
}

/** The RPC response for a page answer (prompts.ts payloads); throws 400 when it does not fit the dialog. */
export function toResponse(dialog: RpcRecord, answer: Record<string, unknown>): Response {
	if (String(dialog.title ?? "").startsWith("pi-hub:")) {
		if (answer.cancel === true) return { cancelled: true };
		// The page's askId is the request id; ask_user gets back its own askId, when it has one.
		const { target: _target, askId: _askId, ...rest } = answer, own = parse(dialog.placeholder)?.data?.askId;
		return { value: JSON.stringify({ ...rest, ...(own ? { askId: own } : {}) }) };
	}
	const cancelled = answer.cancel === true || answer.action === "back";
	switch (dialog.method) {
		case "select": {
			if (cancelled) return { cancelled: true };
			if (answer.action !== "select" || !(dialog.options as string[] ?? []).includes(answer.value as string)) throw bad("Not one of the options.");
			return { value: answer.value as string };
		}
		case "confirm": {
			if (cancelled) return { confirmed: false };
			if (answer.action !== "select" || !["yes", "no"].includes(answer.value as string)) throw bad("Answer Yes or No.");
			return { confirmed: answer.value === "yes" };
		}
		default: // input, editor
			if (cancelled) return { cancelled: true };
			if (typeof answer.text !== "string") throw bad("Write an answer.");
			return { value: answer.text };
	}
}
