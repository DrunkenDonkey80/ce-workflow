// Anthropic OAuth (Claude Code) serves extension tools as `mcp__pi__<name>` and resolves inline
// tool_removal references by that name, but registers inline tool_addition definitions unprefixed,
// so a session that ever added then removed a tool gets 400 tool_reference_unresolved on every turn.
// Prefixing the added definition matches the server; tool calls still come back unprefixed.
// shortcut: workaround for the Pi 1.5.2 / pi-ai payload, drop once Pi prefixes inline additions itself.
const CLAUDE_CODE_TOOLS = new Set(["Read", "Write", "Edit", "Bash", "Grep", "Glob", "AskUserQuestion", "EnterPlanMode", "ExitPlanMode", "KillShell", "NotebookEdit", "Skill", "Task", "TaskOutput", "TodoWrite", "WebFetch", "WebSearch"]);

export function prefixInlineToolAdditions(payload: any): any {
	if (!payload?.betas?.includes?.("oauth-2025-04-20") || !Array.isArray(payload.messages)) return payload;
	for (const message of payload.messages) {
		if (message?.role !== "system" || !Array.isArray(message.content)) continue;
		for (const block of message.content) {
			const definition = block?.type === "tool_addition" ? block.tool?.definition : undefined;
			const name = definition?.name;
			if (typeof name === "string" && !CLAUDE_CODE_TOOLS.has(name) && !name.startsWith("mcp__")) definition.name = `mcp__pi__${name}`;
		}
	}
	return payload;
}
