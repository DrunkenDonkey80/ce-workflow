// Agents hand checks back to the user ("now run it", "open the app and click") although their tools can do them.
// An always-on rule says who owns verification; a one-shot agent_end nudge catches the handoff when the rule is ignored.
export const SELF_VERIFY = "**Verify it yourself (every session)**: after you implement or fix something, run the relevant checks yourself before reporting: tests and commands through bash; local web UI in a headless browser (agent-browser) with screen_read for how it looks; desktop apps with app_act; phones and simulators with mobile_act; installers with vm_act; external logged-in sites with browser_act (enable these through tools_enable). Reading the code or diff does not verify a UI change: use it the way the user would (click it in the headless browser or the app) and look at the result. Never end with instructions for the user to run, open, click or test something a tool can do; do it and report what you observed. When you cannot (missing permission, device, credential, or a physical or subjective judgment only the user can make), name that exact blocker after finishing every check you can. Respect planning-only, research-only and no-tests requests.";

// English only; the nudge itself tells the agent how to answer a false trigger in one line.
const HANDOFF = /\b(?:you can now|now you can|you(?: can| should| could| may| will need to| need to|'ll need to)|please|go ahead and|next,? (?:just )?|to (?:test|verify|check|try) (?:it|this|that),?|now (?:just )?)\s*(?:run|open|launch|start|test|try|check|verify|click|tap|navigate|visit|install)\b/i;
// "I haven't opened the page to confirm": honest, but the check was still left to the user.
const UNCHECKED = /\b(?:have not|haven't|did not|didn't|not yet)\s+(?:yet\s+|actually\s+)?(?:open(?:ed)?|run|ran|test(?:ed)?|launch(?:ed)?|click(?:ed)?|check(?:ed)?|verif(?:y|ied)|tr(?:y|ied)|confirm(?:ed)?)\b/i;

export const NUDGE = "Self-verify check: your last reply hands a run/open/test step to the user or says it was not checked. If a tool can do it (bash, a headless browser, screen_read, app_act, mobile_act, vm_act, browser_act via tools_enable), do it now and report what you observed. For a UI change a stubbed DOM, a mocked main loop or API-only requests are not enough: open the page in agent-browser (bash; a file:// URL works for a static page) or start the app and drive it with app_act, click the changed control and read the result. If you already did it, the user asked for instructions, or only the user can do it (permission, device, credential, subjective judgment), reply in one line saying which, without redoing work.";

const text = (message) => typeof message?.content === "string" ? message.content
	: (message?.content ?? []).filter((part) => part?.type === "text").map((part) => part.text).join("\n");

/** True when the run's final assistant text hands a check to the user or admits it was skipped. */
export function handsOff(messages) {
	const last = [...(messages ?? [])].reverse().find((message) => message?.role === "assistant");
	return !!last && last.stopReason !== "aborted" && last.stopReason !== "error" && (HANDOFF.test(text(last)) || UNCHECKED.test(text(last)));
}

/** skip(ctx) lets the caller exempt runs (planning, research) where handing steps over is the job. */
export function registerSelfVerify(pi, skip = (_ctx) => false) {
	let nudged = false; // one nudge per user prompt: the reply to it is never nudged again
	pi.on?.("agent_end", (event, ctx) => {
		if (nudged) { nudged = false; return; }
		if (event?.aborted || skip(ctx) || !handsOff(event?.messages)) return;
		nudged = true;
		pi.sendUserMessage(NUDGE, { expandPromptTemplates: false, deliverAs: "followUp" });
	});
}
