// Agents that get stuck need an oracle model from another model family, but cannot read /scoped-models.
// Pick it in code each run: the first Pi-scoped model whose provider family differs from the current one.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const family = (provider = "") => provider.split("-")[0];

export function advisorModel(current, scoped) {
	const models = (scoped ?? []).map((entry) => entry?.model).filter(Boolean);
	const pick = models.find((model) => family(model.provider) !== family(current?.provider))
		?? models.find((model) => model.provider !== current?.provider || model.id !== current?.id);
	return pick && `${pick.provider}/${pick.id}`;
}

export default function advisor(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event, ctx) => {
		const model = advisorModel(ctx.model, ctx.scopedModels);
		const options = event.systemPromptOptions;
		if (!model || !options) return;
		options.promptGuidelines = [...(options.promptGuidelines ?? []),
			`When stuck and consulting an oracle or advisor, launch it with model "${model}:high": the first Pi-scoped model from another model family, chosen by code. Do not ask the user for the scoped model list.`];
	});
}
