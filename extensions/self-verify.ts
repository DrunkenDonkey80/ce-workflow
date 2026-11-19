// Agents hand checks back to the user ("now run it", "open the app and click") although their tools can do them.
// Checking stays the agent's call, but checks go through tools, not the user (soft wording won the soft-1 A/B on Opus 5.5).
// It never queues an automatic follow-up.
export const SELF_VERIFY = "**Check with your tools, not the user (every session)**: whether a change needs checking is your call. When you want something checked, or you are about to tell the user to run, open, click or test something, do it yourself with the tools: tests and commands through bash; local web UI in a headless browser (agent-browser) with screen_read; desktop apps with app_act; phones and simulators with mobile_act; installers with vm_act; external logged-in sites with browser_act (enable these through tools_enable). Ask the user to check something only when no tool can (missing permission, device, credential, or a physical or subjective judgment only they can make), and name that exact reason. Respect planning-only, research-only and no-tests requests.";

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
