// Route a blocking ask_user prompt to the intercom peer driving this session so
// a monitor can genuinely answer it (no cancel, no timeout workaround).
//
// Requires pi-ask-user patched by scripts/patch-ask-user-remote-answer.mjs and
// PI_ASK_USER_REMOTE_ANSWERS=1: without that, `ask:pending` never fires and this
// is inert. Without pi-intercom the outbox event has no listener, so the ask
// simply stays local. The local human can always answer first either way.
const ANSWER_PATTERN = /\bANSWER\s+([0-9a-fA-F-]{36})\s*:\s*([\s\S]+)/;
const MULTI_SEPARATOR = " | ";

function messageText(message) {
	const body = message?.details?.bodyText;
	if (typeof body === "string") return body;
	const content = message?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => (typeof part === "string" ? part : (part?.text ?? "")))
		.join("\n");
}

function forwardMessage(ask) {
	const options = (ask.options ?? [])
		.map((option, index) => `${index + 1}. ${option?.title ?? ""}`)
		.join("\n");
	return [
		"This session is blocked on ask_user and accepts a remote answer.",
		"",
		ask.question,
		ask.context ? `\nContext:\n${ask.context}` : "",
		options ? `\nOptions:\n${options}` : "",
		"",
		`Reply with exactly: ANSWER ${ask.askId}: <${options ? "option title" : "answer"}${ask.allowMultiple ? ", joined by ' | ' for several" : ""}${ask.allowFreeform ? " or free text" : ""}>`,
	]
		.filter((line) => line !== "")
		.join("\n");
}

export function registerRemoteAskAnswers(pi) {
	if (typeof pi?.events?.on !== "function") return; // test harnesses without an event bus
	const pending = new Map();
	let peerId = "";
	let requestSeq = 0;

	const forward = (ask) => {
		if (!peerId) return;
		pi.events.emit("intercom:outbox-request", {
			version: 1,
			requestId: `work-ask-${ask.askId}-${++requestSeq}`,
			extensionId: "pi-work-orchestrator",
			extensionName: "work-orchestrator",
			to: peerId,
			message: forwardMessage(ask),
		});
	};

	pi.events.on("ask:pending", (ask) => {
		if (!ask?.askId) return;
		pending.set(ask.askId, ask);
		forward(ask);
	});
	pi.events.on("ask:answered", () => pending.clear());
	pi.events.on("ask:cancelled", () => pending.clear());

	pi.on("message_end", (event) => {
		const message = event?.message;
		if (message?.customType !== "intercom_message") return;
		const from = String(message.details?.from?.id ?? "").trim();
		if (from) peerId = from;
		if (pending.size === 0) return;

		const match = ANSWER_PATTERN.exec(messageText(message));
		const ask = match ? pending.get(match[1]) : undefined;
		if (!ask) {
			// A peer only just became reachable: retry the pending prompts.
			for (const entry of pending.values()) forward(entry);
			return;
		}

		pending.delete(ask.askId);
		const answer = match[2].trim();
		const selections =
			ask.allowMultiple && answer.includes(MULTI_SEPARATOR)
				? answer
						.split(MULTI_SEPARATOR)
						.map((part) => part.trim())
						.filter(Boolean)
				: undefined;
		// pi-ask-user validates this against the same options the human sees.
		pi.events.emit(
			"ask:answer",
			selections
				? { askId: ask.askId, selections }
				: { askId: ask.askId, text: answer },
		);
	});
}
