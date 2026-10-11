// The oracle/advisor subagent runs on a /wo Settings → Plan models entry from another model family than the
// current one (Plan3's chooseAdvisors), set in code on every launch so settings changes apply immediately.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { chooseAdvisors } from "./plan3.ts";

const ORACLES = new Set(["oracle", "advisor"]);

export async function advisorModel(ctx) {
	const pick = (await chooseAdvisors(ctx))[0];
	return pick && `${pick.model}:${pick.thinking ?? "high"}`;
}

export default function advisor(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		const model = await advisorModel(ctx);
		const options = event.systemPromptOptions;
		if (!model || !options) return;
		options.promptGuidelines = [...(options.promptGuidelines ?? []),
			`Oracle/advisor subagents run on ${model} (/wo Settings → Plan models, another model family); a direct oracle launch gets it automatically, in workflow scripts pass model "${model}".`];
	});
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "subagent" || !ORACLES.has(String(event.input?.agent ?? "").toLowerCase())) return;
		const model = await advisorModel(ctx);
		if (model) event.input.model = model;
	});
}
