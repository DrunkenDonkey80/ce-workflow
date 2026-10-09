// Idea proposals stay readable and resumable in the plan; choices are applied by code.
import { randomUUID } from "node:crypto";

const fields = {
	about: "What this is", benefits: "What you gain", drawbacks: "Drawbacks and risks",
	approach: "Implementation and affected files", cost: "Cost", recommendation: "Recommendation",
	sources: "Sources and agreement", requirement: "Proposed requirement", steps: "Proposed steps",
};
export const ideaSchema = {
	type: "object", additionalProperties: false, required: ["title", ...Object.keys(fields)],
	properties: {
		title: { type: "string", minLength: 1 },
		...Object.fromEntries(Object.keys(fields).map(key => [key, key === "steps"
			? { type: "array", minItems: 1, items: { type: "string", minLength: 1 } }
			: { type: "string", minLength: 1 }])),
	},
};
const quote = (text: string) => text.split(/\r?\n/).map(line => `> ${line}`).join("\n");
export function ideaBlock(idea) {
	if (!idea || typeof idea.title !== "string" || !idea.title.trim() || /[\r\n]/.test(idea.title)) throw new Error("Each idea needs a single-line title.");
	for (const key of Object.keys(fields)) {
		if (key === "steps") {
			if (!Array.isArray(idea.steps) || !idea.steps.length || idea.steps.some(step => typeof step !== "string" || !step.trim() || /[\r\n]/.test(step))) throw new Error("Each idea needs nonempty single-line steps.");
		} else if (typeof idea[key] !== "string" || !idea[key].trim()) throw new Error(`Each idea needs ${key} in full detail.`);
	}
	return `### IDEA-${randomUUID().slice(0, 8)} ${idea.title}\n\nStatus: pending\n\n${Object.entries(fields).map(([key, label]) => `#### ${label}\n\n${quote(key === "steps" ? idea.steps.map(step => `- ${step}`).join("\n") : idea[key])}`).join("\n\n")}`;
}
export function storedIdeas(body: string) {
	return body.split(/(?=^### IDEA-)/m).flatMap(block => {
		const match = block.match(/^### (IDEA-[0-9a-f]{8}) (.+)\n\nStatus: (pending|commented|answered|accepted|rejected)\b/);
		if (!match) return [];
		const field = (label: string) => {
			const start = block.indexOf(`#### ${label}\n\n`);
			if (start < 0) return "";
			const from = start + `#### ${label}\n\n`.length;
			const end = block.indexOf("\n#### ", from);
			return block.slice(from, end < 0 ? undefined : end).trim().split("\n").map(line => line.replace(/^> ?/, "")).join("\n");
		};
		return [{ id: match[1], title: match[2], status: match[3], block: block.trim(), recommendation: field(fields.recommendation), requirement: field(fields.requirement), steps: field(fields.steps).split("\n").filter(line => line.startsWith("- ")).map(line => line.slice(2)) }];
	});
}
export function ideaPopupContext(idea: { block: string }) {
	const heading = "#### What this is\n\n";
	const start = idea.block.indexOf(heading);
	if (start < 0) throw new Error("The saved idea is missing its explanation; repair it before reviewing.");
	return idea.block.slice(start + heading.length).trim()
		.replace(/^#### (.+)\n\n/gm, "**$1**\n")
		.replace(/^> ?/gm, "");
}
export function ideaOptions(idea: { recommendation: string }) {
	const recommended = idea.recommendation.trim().match(/^(Accept|Reject)\b/i)?.[1].toLowerCase();
	return [
		{ title: "Accept", description: "Add the proposed requirement and steps to the plan." },
		{ title: "Reject", description: "Record as rejected; add no work." },
	].map(option => ({ ...option, title: option.title + (option.title.toLowerCase() === recommended ? " (Recommended)" : "") }));
}
export function ideaResponse(response, optionTitles = ["Accept", "Reject"]) {
	if (response?.kind === "freeform" && typeof response.text === "string" && response.text.trim()) return "commented";
	const selection = response?.selections?.[0];
	const choice = typeof selection === "string" ? selection.replace(/ \(Recommended\)$/, "") : "";
	if (response?.kind !== "selection" || !Array.isArray(response.selections) || response.selections.length !== 1 || !optionTitles.includes(selection) || !["Accept", "Reject"].includes(choice) || (response.comment !== undefined && typeof response.comment !== "string")) throw new Error("ask_user returned an incompatible idea response; nothing was saved.");
	// A comment may condition or reverse the selected choice: never guess its intent.
	return response.comment?.trim() ? "commented" : choice === "Accept" ? "accepted" : "rejected";
}
export function decideIdea(lines, idea, status, response, append, add, changes?: { requirement?: string; steps?: string[] }) {
	const text = lines.join("\n");
	if (!/^---\nplan3: true\n/.test(text)) throw new Error("The selected file is no longer a Plan3 plan.");
	const heading = lines.findIndex(line => /^## Ideas$/i.test(line));
	const end = lines.findIndex((line, index) => index > heading && /^## /.test(line));
	const candidates = heading < 0 ? [] : storedIdeas(lines.slice(heading + 1, end < 0 ? undefined : end).join("\n").trim());
	const matching = candidates.filter(item => item.id === idea.id);
	const current = matching.length === 1 ? matching[0] : undefined;
	if (!current || current.block !== idea.block) throw new Error("The idea changed while being reviewed; its response was not applied. Review it again.");
	if (status === "accepted") {
		if (/^status: complete$/m.test(text)) throw new Error("Cannot add an idea to a complete plan; create a follow-up instead.");
		const requirement = changes?.requirement ?? current.requirement;
		const steps = changes?.steps ?? current.steps;
		if (!requirement.trim() || !steps.length || steps.some(step => typeof step !== "string" || !step.trim() || /[\r\n]/.test(step))) throw new Error("An accepted idea needs a requirement and single-line steps.");
		if (!lines.some(line => /^## Goal, requirements, and non-goals$/i.test(line))) lines.push("", "## Goal, requirements, and non-goals", "");
		append(lines, "Goal, requirements, and non-goals", `### ${current.id}: ${current.title}\n\n${quote(requirement)}`);
		add(lines, undefined, steps, `Accepted ${current.id}: ${current.title}`);
	}
	const updated = current.block.replace(/^Status: .+$/m, `Status: ${status}`)
		.replace(/^Response: .+\n?/m, "").replace(/^Status: .+$/m, line => `${line}\nResponse: ${JSON.stringify(response)}`);
	// Re-locate after adding steps/sections; preserving unrelated concurrent plan edits.
	const all = lines.join("\n").replace(current.block, updated);
	lines.splice(0, lines.length, ...all.split("\n"));
	if (["accepted", "rejected"].includes(status)) append(lines, "Decisions", `- ${current.id}: ${status} — ${current.title}. Source: user via Plan3 idea review; not independently verified. Response: ${JSON.stringify(response)}`);
	return { id: current.id, title: current.title, status, response };
}
