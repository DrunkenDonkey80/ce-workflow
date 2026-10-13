// Route a blocking ask_user prompt to the intercom peer driving this session so
// a monitor can genuinely answer it (no cancel, no timeout workaround).
//
// The vendored ask_user emits ask:pending natively. Intercom forwarding still
// requires PI_ASK_USER_REMOTE_ANSWERS=1; browser answering is independent.
// Without pi-intercom there is no outbox listener and the prompt stays local.
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
	if (ask.questions) return [
		"This session is blocked on a batch of ask_user questions.",
		JSON.stringify({ questions: ask.questions, allowComment: ask.allowComment }),
		`Reply with exactly: ANSWER ${ask.askId}: {"answers":[{"status":"answered","response":{"kind":"selection","selections":["option title"]}},{"status":"skipped"}]}`,
		"Supply one answer per question in order; freeform response is {kind: freeform, text: answer}.",
	].join("\n");
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
	if (!/^(1|true|yes)$/i.test(process.env.PI_ASK_USER_REMOTE_ANSWERS ?? "") || typeof pi?.events?.on !== "function") return;
	const pending = new Map();
	let peerId = "";
	let requestSeq = 0;

	const forward = (ask) => {
		if (!peerId || (ask.remotePeerId && ask.remotePeerId !== peerId)) return;
		ask.remotePeerId = peerId;
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
		if (!ask?.askId || ask.kind === "list") return;
		const entry = { ...ask, remotePeerId: "" };
		pending.set(ask.askId, entry);
		forward(entry);
	});
	pi.events.on("ask:closed", ({ askId }) => pending.delete(askId));
	pi.on("session_shutdown", () => { pending.clear(); peerId = ""; });

	pi.on("message_end", (event) => {
		const message = event?.message;
		if (message?.customType !== "intercom_message") return;
		if (message.details?.message?.crossMachine || message.details?.crossMachine) return;
		const from = String(message.details?.from?.id ?? "").trim();
		if (!from || (pending.size && peerId && from !== peerId)) return;
		peerId = from;
		if (pending.size === 0) return;

		const match = ANSWER_PATTERN.exec(messageText(message));
		const ask = match ? pending.get(match[1]) : undefined;
		if (!ask || ask.remotePeerId !== from) {
			// A peer only just became reachable: retry the pending prompts.
			for (const entry of pending.values()) forward(entry);
			return;
		}

		const answer = match[2].trim();
		if (ask.questions) {
			let batch;
			try { batch = JSON.parse(answer); } catch { return; }
			if (!batch || !Array.isArray(batch.answers)) return;
			pi.events.emit("ask:answer", { askId: ask.askId, answers: batch.answers });
			return;
		}
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
