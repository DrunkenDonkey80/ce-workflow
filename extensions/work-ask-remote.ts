// Tell the intercom peer driving this session that it now waits on its user (ask_user), so the peer is not left
// guessing. The peer can wait for the answer or, only when the user told it to control this session, answer it
// through the hub with session_dialog. A reply sent over intercom would only arrive after the question closes.
// Without pi-intercom there is no outbox listener and nothing is sent.

function forwardMessage(ask, self) {
	const questions = ask.questions ?? [ask];
	const lines = questions.flatMap((question, index) => [
		questions.length > 1 ? `Question ${index + 1}: ${question.question}` : question.question,
		...(question.options ?? []).map((option) => `- ${option?.title ?? ""}`),
	]);
	return [
		`Session ${self} is waiting for its user to answer:`,
		...lines,
		"",
		`Usually just wait: session_dialog {action: "wait", session: "${self}"} messages you once it is answered. Answer it yourself (session_dialog action "answer", which shows you the answer shape) ONLY when the user told you to control or fix that session: it is the user's question.`,
	].join("\n");
}

export function registerRemoteAskAnswers(pi) {
	if (typeof pi?.events?.on !== "function") return;
	let peerId = "", self = "";
	let requestSeq = 0;

	pi.on("session_start", (_event, ctx) => { self = ctx?.sessionManager?.getSessionId?.() ?? ""; });
	pi.events.on("ask:pending", (ask) => {
		if (!ask?.askId || ask.kind === "list" || !peerId || !self) return;
		pi.events.emit("intercom:outbox-request", {
			version: 1,
			requestId: `work-ask-${ask.askId}-${++requestSeq}`,
			extensionId: "pi-work-orchestrator",
			extensionName: "work-orchestrator",
			to: peerId,
			message: forwardMessage(ask, self),
		});
	});
	pi.on("session_shutdown", () => { peerId = ""; });
	// The driving peer: whoever sent the last local intercom message, until the user types again.
	pi.on("input", (event) => { if (event?.source !== "extension") peerId = ""; });
	pi.on("message_end", (event) => {
		const message = event?.message;
		if (message?.customType !== "intercom_message") return;
		if (message.details?.message?.crossMachine || message.details?.crossMachine) return;
		const from = String(message.details?.from?.id ?? "").trim();
		if (from) peerId = from;
	});
}
