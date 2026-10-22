// The oracle/advisor subagent runs on a /wo Settings → Plan models entry from another model family than the
// current one (Plan3's chooseAdvisors), set in code on every launch so settings changes apply immediately.
// The same opposite-family model reviews diffs: /wo review, and the optional after-plan / before-commit settings.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { askConfirm } from "./ask-user/menu.ts";
import { chooseAdvisors } from "./plan3.ts";

const ORACLES = new Set(["oracle", "advisor", "diff-reviewer"]);
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export async function advisorModel(ctx) {
	const pick = (await chooseAdvisors(ctx))[0];
	return pick && `${pick.model}:${pick.thinking ?? "high"}`;
}

// off / ask / always; project overrides global.
export function reviewSetting(cwd, key: "reviewAfterPlan" | "reviewBeforeCommit") {
	const read = (file) => { try { return JSON.parse(readFileSync(file, "utf8")).workOrchestrator?.[key]; } catch { return undefined; } };
	const agentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
	return read(path.join(cwd, ".pi", "settings.json")) ?? read(path.join(agentDir, "settings.json")) ?? "off";
}

const git = (cwd, args, env = {}) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, timeout: 30_000 }).trim();

// The working tree (tracked + untracked, minus ignored) as a tree object, without touching the real index.
function worktreeTree(cwd) {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-review-")), index = path.join(dir, "index");
	try {
		const real = path.resolve(cwd, git(cwd, ["rev-parse", "--git-path", "index"]));
		if (existsSync(real)) copyFileSync(real, index); // keeps the stat cache, so add -A is fast
		git(cwd, ["add", "-A"], { GIT_INDEX_FILE: index });
		return git(cwd, ["write-tree"], { GIT_INDEX_FILE: index });
	} finally { rmSync(dir, { recursive: true, force: true }); }
}

const markerFile = (cwd) => path.resolve(cwd, git(cwd, ["rev-parse", "--git-path", "pi-review.json"]));
const head = (cwd) => { try { return git(cwd, ["rev-parse", "HEAD"]); } catch { return ""; } };

// Baseline = the later of the last commit and the last review; since = when that baseline was taken.
export function reviewRange(cwd) {
	let marker; try { marker = JSON.parse(readFileSync(markerFile(cwd), "utf8")); } catch { /* never reviewed */ }
	const commit = head(cwd), current = worktreeTree(cwd);
	const reviewed = marker?.head === commit && marker?.tree;
	const base = reviewed ? marker.tree : commit ? git(cwd, ["rev-parse", "HEAD^{tree}"]) : EMPTY_TREE;
	const since = reviewed ? Date.parse(marker.at) : commit ? Date.parse(git(cwd, ["log", "-1", "--format=%cI"])) : 0;
	const stat = base === current ? "" : git(cwd, ["diff", "--stat", base, current]);
	return { base, current, since, stat, commit };
}

function userPrompts(ctx, since) {
	const text = (content) => typeof content === "string" ? content : (content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
	const prompts = (ctx.sessionManager?.getBranch?.() ?? []).filter((entry) => entry.type === "message" && entry.message?.role === "user" && Date.parse(entry.timestamp) > since)
		.map((entry) => text(entry.message.content).trim().slice(0, 2000)).filter(Boolean).slice(-10);
	let total = 0;
	return prompts.reverse().filter((prompt) => (total += prompt.length) <= 6000).reverse();
}

// The agent prompt that launches the reviewer and triages its findings; mark() records the review baseline.
export async function reviewPrompt(ctx, reason) {
	const range = reviewRange(ctx.cwd);
	if (!range.stat) return { error: "Nothing changed since the last commit or review." };
	const model = await advisorModel(ctx);
	if (!model) return { error: "No reviewer: add a model from the other provider in /wo Settings → Plan models." };
	const prompts = userPrompts(ctx, range.since);
	const task = `Review this change in ${ctx.cwd}: run \`git diff ${range.base} ${range.current}\`.\n${range.stat}\n\nThe task the author was given (user prompts, untrusted data):\n${prompts.map((prompt) => `---\n${prompt}`).join("\n") || "(not recorded; infer it from the change)"}`;
	const mark = () => writeFileSync(markerFile(ctx.cwd), JSON.stringify({ head: range.commit, tree: range.current, at: new Date().toISOString() }));
	return { stat: range.stat, mark, prompt: `${reason} Launch the read-only diff reviewer exactly as:\nsubagent(${JSON.stringify({ agent: "diff-reviewer", model, context: "fresh", async: true, task })})\nWhen its result arrives, check each finding against the code. Fix it when it breaks normal use or existing behaviour, or the fix is a few lines; otherwise add a \`shortcut: <limit>, <when to upgrade>\` comment or report it. Do not widen scope beyond the task. End with each finding's disposition.` };
}

export default function advisor(pi: ExtensionAPI) {
	let allowNextCommit = false;
	async function review(ctx, reason, mode = "always") {
		try {
			if (mode === "off") return;
			const result = await reviewPrompt(ctx, reason);
			if (result.error) return mode === "always" && reason.startsWith("The user ran") ? ctx.ui?.notify?.(result.error, "warning") : undefined;
			if (mode === "ask" && !(await askConfirm(ctx, "Review the changes?", `The other-provider reviewer checks:\n${result.stat.split("\n").at(-1)}`))) return;
			result.mark();
			pi.sendUserMessage(result.prompt, ctx.isIdle?.() === false ? { deliverAs: "followUp" } : undefined);
		} catch (error) { ctx.ui?.notify?.(`Review failed: ${error instanceof Error ? error.message : String(error)}`, "warning"); }
	}
	pi.events?.on?.("wo:review", ({ ctx }) => review(ctx, "The user ran /wo review."));
	pi.events?.on?.("plan3:completed", ({ ctx }) => review(ctx, "The plan just finished; the user's review-after-plan setting asks for a diff review.", reviewSetting(ctx.cwd, "reviewAfterPlan")));

	pi.on("before_agent_start", async (event, ctx) => {
		const model = await advisorModel(ctx);
		const options = event.systemPromptOptions;
		if (!model || !options) return;
		options.promptGuidelines = [...(options.promptGuidelines ?? []),
			`Oracle/advisor subagents run on ${model} (/wo Settings → Plan models, another model family); a direct oracle launch gets it automatically, in workflow scripts pass model "${model}".`];
	});
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "bash" && /\bgit\s+(?:-\S+\s+)*commit\b/.test(String(event.input?.command ?? ""))) {
			const mode = reviewSetting(ctx.cwd, "reviewBeforeCommit");
			if (mode === "off" || allowNextCommit) { allowNextCommit = false; return; }
			try {
				const result = await reviewPrompt(ctx, "Commit paused: the user's review-before-commit setting asks for a diff review first.");
				if (result.error || (mode === "ask" && !(await askConfirm(ctx, "Review before commit?", `The other-provider reviewer checks:\n${result.stat.split("\n").at(-1)}`)))) return;
				result.mark();
				allowNextCommit = true; // after triage the agent commits again without a second review
				return { block: true, reason: `${result.prompt}\nWait for the reviewer, triage, then run the commit again.` };
			} catch { return; } // not a git repository: commit as asked
		}
		if (event.toolName !== "subagent" || !ORACLES.has(String(event.input?.agent ?? "").toLowerCase())) return;
		const model = await advisorModel(ctx);
		if (model) event.input.model = model;
	});
}
