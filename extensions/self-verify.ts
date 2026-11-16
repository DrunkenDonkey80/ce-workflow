// Agents hand checks back to the user ("now run it", "open the app and click") although their tools can do them.
// Verification stays in the standing instructions; it never queues an automatic follow-up.
export const SELF_VERIFY = "**Verify it yourself (every session)**: after you implement or fix something, run the relevant checks yourself before reporting: tests and commands through bash; local web UI in a headless browser (agent-browser) with screen_read for how it looks; desktop apps with app_act; phones and simulators with mobile_act; installers with vm_act; external logged-in sites with browser_act (enable these through tools_enable). Reading the code or diff does not verify a UI change: use it the way the user would (click it in the headless browser or the app) and look at the result. Never end with instructions for the user to run, open, click or test something a tool can do; do it and report what you observed. When you cannot (missing permission, device, credential, or a physical or subjective judgment only the user can make), name that exact blocker after finishing every check you can. Respect planning-only, research-only and no-tests requests.";

// English-only scoring for the live benchmark; these patterns do not drive session behavior.
const HANDOFF = /\b(?:you can now|now you can|you(?: can| should| could| may| will need to| need to|'ll need to)|please|go ahead and|next,? (?:just )?|to (?:test|verify|check|try) (?:it|this|that),?|now (?:just )?)\s*(?:run|open|launch|start|test|try|check|verify|click|tap|navigate|visit|install)\b/i;
// "I haven't opened the page to confirm": honest, but the check was still left to the user.
const UNCHECKED = /\b(?:have not|haven't|did not|didn't|not yet)\s+(?:yet\s+|actually\s+)?(?:open(?:ed)?|run|ran|test(?:ed)?|launch(?:ed)?|click(?:ed)?|check(?:ed)?|verif(?:y|ied)|tr(?:y|ied)|confirm(?:ed)?)\b/i;

const text = (message) => typeof message?.content === "string" ? message.content
	: (message?.content ?? []).filter((part) => part?.type === "text").map((part) => part.text).join("\n");

/** True when the run's final assistant text hands a check to the user or admits it was skipped. */
export function handsOff(messages) {
	const last = [...(messages ?? [])].reverse().find((message) => message?.role === "assistant");
	return !!last && last.stopReason !== "aborted" && last.stopReason !== "error" && (HANDOFF.test(text(last)) || UNCHECKED.test(text(last)));
}
