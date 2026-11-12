import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// Runaway-run allowance (Haystack's step budget with a last-steps reminder, plan b71bab2b D-03..D-06):
// counts model turns without progress since the last human message, reminds once, then blocks tool calls.
// Progress: a successful edit, write or plan3 call, or a changed working tree (checked every CHECK_EVERY turns).
const ENTRY = "run-budget";
export const DEFAULT_TURNS = 150;
export const REMIND_BEFORE = 10;
const CHECK_EVERY = 25;
const PROGRESS_TOOLS = new Set(["edit", "write", "plan3", "ast_grep_replace"]);

const readJson = (file) => {
	try { return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}; } catch { return {}; }
};
// `runBudget.turns` in .pi/settings.json, else in the global Pi settings; 0 turns the allowance off.
export function budgetLimit(cwd, env = process.env) {
	const global = path.join(env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent"), "settings.json");
	const value = readJson(path.join(cwd, ".pi", "settings.json")).runBudget?.turns ?? readJson(global).runBudget?.turns;
	return Number.isInteger(value) && value >= 0 ? value : DEFAULT_TURNS;
}

export const reminderText = (left, limit) => `Run budget: ${left} of ${limit} turns left without progress (no edit, write, plan3 update or file change since the last human message). Stop exploring: finish the current step, or write a plan3 checkpoint saying what is stuck and why, then end your reply.`;
export const blockText = (limit) => `Run budget reached: ${limit} turns without progress since the last human message. Tools are blocked until the user writes. End your reply now with one short summary of what is stuck and what you need.`;

export function createRunBudget(pi, { limit = budgetLimit, fingerprint }) {
	let state = { turns: 0, reminded: false };
	let saved = 0;
	let fp = "";
	const persist = () => { saved = state.turns; pi.appendEntry?.(ENTRY, { ...state }); };
	const reset = () => {
		// shortcut: a reset is saved only when the saved count was not already 0, so a reload can lose up to 9 idle turns.
		state = { turns: 0, reminded: false };
		fp = "";
		if (saved) persist();
	};
	const exhausted = (ctx) => { const max = limit(ctx.cwd); return max > 0 && state.turns >= max; };

	pi.on?.("input", (event) => {
		// shortcut: rpc counts as human (hub chat and buttons); a hub timer prompt sent over rpc also resets the count.
		if (event.source === "interactive" || event.source === "rpc") reset();
	});
	pi.on?.("turn_end", async (event, ctx) => {
		const max = limit(ctx.cwd);
		if (!max) return;
		if ((event.toolResults ?? []).some((r) => PROGRESS_TOOLS.has(r.toolName) && !r.isError)) return reset();
		state.turns += 1;
		const checkNow = state.turns === 1 || state.turns % CHECK_EVERY === 0 || state.turns === max - REMIND_BEFORE || state.turns === max;
		if (checkNow && fingerprint) {
			const now = await fingerprint(ctx.cwd);
			if (fp && now !== fp) return reset();
			fp = now;
		}
		if (!state.reminded && state.turns >= max - REMIND_BEFORE && state.turns < max) {
			state.reminded = true;
			persist();
			pi.sendMessage?.({ customType: ENTRY, content: reminderText(max - state.turns, max), display: true }, { deliverAs: "steer" });
		} else if (state.turns === max) {
			persist();
			ctx.ui?.notify?.(`Run budget reached: ${max} turns without progress. Tools are blocked until you write.`, "warning");
		} else if (state.turns % 10 === 0) persist();
	});
	pi.on?.("tool_call", (_event, ctx) => {
		if (exhausted(ctx)) return { block: true, reason: blockText(limit(ctx.cwd)) };
	});
	return {
		// Compaction and reload keep the count: it lives in the session branch, not in memory only.
		restore(ctx) {
			const data = ctx.sessionManager?.getBranch?.().findLast((entry) => entry.type === "custom" && entry.customType === ENTRY)?.data;
			state = { turns: Number(data?.turns) || 0, reminded: Boolean(data?.reminded) };
			saved = state.turns;
			fp = "";
		},
		exhausted,
		turns: () => state.turns,
	};
}
