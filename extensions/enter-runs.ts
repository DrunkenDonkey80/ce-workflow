// Pi's editor runs a slash command on Enter only when the completion prefix starts with "/"
// (command names); an argument completion (/wo sett, /plan3 con) just fills the line and needs
// a second Enter. This autocomplete wrapper reports argument completions with a "/" prefix so
// Enter fills and runs; each item remembers the real prefix for applyCompletion. Tab still only fills.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const REAL_PREFIX = Symbol("enterRunsPrefix");

export function enterRunsProvider(current) {
	return {
		get triggerCharacters() { return current.triggerCharacters; },
		shouldTriggerFileCompletion: current.shouldTriggerFileCompletion?.bind(current),
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const result = await current.getSuggestions(lines, cursorLine, cursorCol, options);
			const before = (lines[cursorLine] ?? "").slice(0, cursorCol).trimStart();
			const argument = cursorLine === 0 && /^\/\S+\s/.test(before) && result?.items?.length && !/^[/@]/.test(result.prefix);
			// Directories keep filling so the path can continue.
			if (!argument || result.items.some((item) => String(item.value).endsWith("/"))) return result;
			return { ...result, prefix: `/${result.prefix}`, items: result.items.map((item) => ({ ...item, [REAL_PREFIX]: result.prefix })) };
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(lines, cursorLine, cursorCol, item, item?.[REAL_PREFIX] ?? prefix);
		},
	};
}

export default function enterRuns(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.addAutocompleteProvider?.(enterRunsProvider);
	});
}
