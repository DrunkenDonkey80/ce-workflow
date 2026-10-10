import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { showListDialog } from "./work-dialogs.ts";

// Night mode: unattended Plan3 execution. Continues at Pi's settle boundary until the plan is done,
// nothing is runnable, two continues change nothing, or the user cancels.
const ENTRY = "plan3-night";
const RETRY_AFTER_MS = 30 * 60_000;
export const NIGHT_MESSAGE = `NIGHT MODE: no human will answer until the user returns. Keep working on the current Plan3 plan without stopping until it is complete or no runnable step is left.

- Questions: never wait for an answer. If a human must decide, add it to the plan as a Deferred question for /plan3 resolve and continue with other runnable work. If you need an answer now and the choice is easy to change later, pick the best option, continue, and still record a Deferred question with full context, the options, what you picked and why, and how to reverse it.
- Steps that need the user (their presence, a physical action, approval or authorization): mark [human] with what is needed and move on. Steps needing something that does not exist yet (a VM, device, signer or account): mark [blocked] with the prerequisite. Stop only when every remaining step is [human], [blocked] or done.
- Never: reboot, shut down, sleep or log off this computer; reboot or power off devices; push; deploy; delete user data; touch credentials; spend money; or run anything that could stall the session or wait for interactive input. If a step needs one of these, block it with the reason.
- Work at the smallest depth that meets each step's acceptance; extra hardening goes to Backlog. Commit locally after each verified step.
- Keep long-running commands bounded with timeouts; never start a process that waits forever.
- Before stopping, write one plan3 checkpoint that says what was done and what is waiting for the user.`;
export const OFF_MESSAGE = "NIGHT MODE OFF: the user is back. Normal rules apply again: ask the user when a decision is needed. [human] steps are runnable again: ask with ask_user before doing each one.";
const ASK_BLOCK = "Night mode: no human is available and this question was not shown. Record it in the plan as a Deferred question for /plan3 resolve. If the answer is needed now and easy to change later, pick the best option and record what you picked, why and how to reverse it; otherwise mark the step [human] and continue with other runnable work.";
// shortcut: word match on the shell text; scripts that power off internally are not caught, upgrade to an OS policy if that matters.
const POWER = /(?:^|[\s;&|(`"'])(?:shutdown(?:\.exe)?|Restart-Computer|Stop-Computer|logoff|psshutdown|reboot|poweroff|halt)(?=$|[\s;&|)`"'])|powrprof|SetSuspendState|systemctl\s+(?:reboot|poweroff|halt|suspend|hibernate)/i;

export const nightMessage = (rules = "") => rules.trim() ? `${NIGHT_MESSAGE}\n\nProject rules (.pi/night.md):\n${rules.trim()}` : NIGHT_MESSAGE;
export function nightBlockReason(event) {
	if (event.toolName === "ask_user") return ASK_BLOCK;
	if (["bash", "hypa_shell"].includes(event.toolName) && POWER.test(String(event.input?.command ?? "")))
		return "Night mode blocks reboot, shutdown, sleep and logoff commands. Mark the step [human] with the reason and continue with other runnable work.";
	return "";
}

const git = promisify(execFile);
const STATS = ":(exclude,glob)**/*.stats.json"; // Plan3 telemetry changes every turn; it is not progress.
async function fingerprint(cwd, file) {
	const out = (args) => git("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 }).then((result) => result.stdout, () => "");
	const parts = await Promise.all([out(["rev-parse", "HEAD"]), out(["status", "--porcelain", "--", ".", STATS]), out(["diff", "HEAD", "--", ".", STATS]), readFile(file, "utf8").catch(() => "")]);
	return createHash("sha256").update(parts.join("\0")).digest("hex");
}

// Windows sleep would end the run; a hidden PowerShell holds ES_CONTINUOUS|ES_SYSTEM_REQUIRED and exits with Pi.
function keepAwake() {
	// shortcut: Windows only; add caffeinate/systemd-inhibit when night mode runs elsewhere.
	if (process.platform !== "win32") return undefined;
	const script = `$t=Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);' -Name P -Namespace W -PassThru; [void]$t::SetThreadExecutionState([uint32]2147483649); while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { Start-Sleep 30 }`;
	const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore", windowsHide: true });
	child.on("error", () => {});
	return child;
}

export const stopCheckMessage = (plan) => !plan.wip.length && !plan.next
	? `Plan3: you stopped while "${plan.title}" has [human] steps (${plan.human.join(", ")}) and the user is here. Ask with ask_user whether to do ${plan.human[0]} now (what you need, how long it takes, your recommendation); on yes mark it wip and do it with the user, on no or later leave it [human]. If the user already declined or asked you to stop, say so in one line and stop.`
	: `Plan3: you stopped while "${plan.title}" still has runnable work (next: ${plan.wip[0] ?? plan.next}). If there is a real reason (a decision only the user can make, a physical action, a blocker for all remaining runnable work, or the user asked you to stop or asked something else), say it in one line and stop. Otherwise continue with the next step now; a checkpoint or finished step is not a reason to stop.`;

export function createNight(pi, { listPlans, currentPlan, resume, research, executingPlan, tagging }) {
	let night = null; // { plan, rules, fp, stalls, paused?, complete? }
	let baseline; // Outside night mode: fingerprint when the /resume3 run started or was last nudged.
	let awake, retry;
	const rulesFile = (cwd) => path.join(cwd, ".pi", "night.md");
	const readRules = (cwd) => readFile(rulesFile(cwd), "utf8").then((text) => text.trim(), () => "");
	const persist = () => pi.appendEntry?.(ENTRY, night ? { plan: night.plan, rules: night.rules, paused: night.paused, complete: night.complete } : { off: true });
	const release = () => { awake?.kill(); awake = undefined; clearTimeout(retry); retry = undefined; };
	function banner(ctx) {
		const label = !night ? undefined : night.complete ? "NIGHT COMPLETE · Alt+N to clear" : night.paused ? `NIGHT PAUSED: ${night.paused} · Alt+N to turn off` : "NIGHT MODE · Alt+N to stop";
		if (ctx.mode === "tui") ctx.ui?.setWidget?.(ENTRY, label ? [ctx.ui.theme?.fg?.(night.paused || night.complete ? "warning" : "accent", `━━ ${label} ━━`) ?? `━━ ${label} ━━`] : undefined);
		else if (label) ctx.ui?.notify?.(label, "info");
	}
	function stop(ctx, reason, complete = false) {
		night = { ...night, paused: complete ? undefined : reason, complete };
		release();
		persist();
		banner(ctx);
		ctx.ui?.notify?.(complete ? "Night mode: the plan is complete." : `Night mode paused: ${reason}.`, complete ? "info" : "warning");
	}
	const message = (content, options) => pi.sendMessage?.({ customType: ENTRY, content, display: true }, options);

	async function on(ctx) {
		const plan = currentPlan(ctx, await listPlans(ctx.cwd));
		if (!plan || plan.status === "draft" || (plan.status === "blocked" && !plan.started))
			return ctx.ui.notify("Night mode needs a Plan3 plan ready for execution; finish planning first.", "warning");
		let rules = await readRules(ctx.cwd);
		while (ctx.hasUI) {
			const pick = await showListDialog(ctx, {
				title: "Night mode", purpose: "Work on the plan unattended; human questions become plan questions.", cursorKey: "plan3-night", descriptionMaxLines: 6,
				items: [
					{ value: "on", label: ctx.isIdle() ? "Turn on and resume" : "Turn on", description: plan.title },
					{ value: "edit", label: rules.trim() ? "Edit project rules" : "Add project rules", description: rules.trim() || "None yet; saved to .pi/night.md" },
					...(rules.trim() ? [{ value: "bare", label: "Turn on without project rules", description: "This time only; .pi/night.md stays" }] : []),
				],
			});
			if (!pick) return;
			if (pick.value === "bare") rules = "";
			if (pick.value !== "edit") break;
			const edited = await ctx.ui.editor("Night mode rules for this project", rules);
			if (edited === undefined) continue;
			rules = edited.trim();
			if (rules) await mkdir(path.dirname(rulesFile(ctx.cwd)), { recursive: true }).then(() => writeFile(rulesFile(ctx.cwd), `${rules}\n`));
			else await unlink(rulesFile(ctx.cwd)).catch(() => {});
		}
		research(ctx, false);
		night = { plan: plan.id, rules, fp: await fingerprint(ctx.cwd, plan.file), stalls: 0 };
		release();
		awake = keepAwake();
		persist();
		banner(ctx);
		if (ctx.isIdle()) await resume(ctx, plan, `\n\n${nightMessage(rules)}`);
		else message(nightMessage(rules), { deliverAs: "steer" });
	}
	function off(ctx) {
		// A pause usually means everything left needs the user, so the off note matters most then.
		const back = night && !night.complete;
		night = null;
		release();
		persist();
		banner(ctx);
		if (back) message(OFF_MESSAGE, { deliverAs: ctx.isIdle() ? "nextTurn" : "steer" });
	}
	const toggle = (ctx) => night ? off(ctx) : on(ctx);

	pi.registerShortcut?.("alt+n", { description: "Toggle Plan3 night mode", handler: (ctx) => toggle(ctx) });
	pi.registerCommand("night", {
		description: "Plan3 night mode: work unattended until the plan is done (/night on|off)",
		handler: async (args, ctx) => {
			const want = args.trim().toLowerCase();
			if (want === "on" ? !night : want === "off" ? night : true) await toggle(ctx);
		},
	});
	pi.on?.("tool_call", (event) => {
		if (!night || night.paused || night.complete) return;
		const reason = nightBlockReason(event);
		if (reason) return { block: true, reason };
	});
	const runPlan = async (ctx) => {
		const id = executingPlan?.(ctx);
		return id ? (await listPlans(ctx.cwd)).find((plan) => plan.id === id) : undefined;
	};
	pi.on?.("agent_start", async (_event, ctx) => {
		const plan = !night && await runPlan(ctx);
		baseline = plan ? await fingerprint(ctx.cwd, plan.file) : undefined;
	});
	// Outside night mode, a /resume3 run that did work and stops with runnable steps left gets one
	// "is there a reason?" continue; a stop after no new work (the reason reply, a chat answer) settles.
	async function stopCheck(event, ctx) {
		if (baseline === undefined || event.outcome !== "completed" || event.continue) return;
		const plan = await runPlan(ctx);
		if (!plan || plan.status === "complete" || (!plan.next && !plan.wip.length && !plan.human.length)) return;
		const fp = await fingerprint(ctx.cwd, plan.file);
		if (fp === baseline) return;
		baseline = fp;
		return { entries: [{ type: "custom_message", customType: "plan3-stop-check", content: stopCheckMessage(plan), display: true }], continue: true };
	}
	pi.on?.("agent_before_settle", async (event, ctx) => {
		if (tagging?.()) return; // The tagging run ends on its own; plan3 starts execution after it.
		if (!night) return stopCheck(event, ctx);
		if (night.paused || night.complete) return;
		if (event.outcome === "aborted") return stop(ctx, "cancelled");
		if (event.outcome === "error") {
			// Pi already retried; quota and outages recover later, so try again without counting a stall.
			clearTimeout(retry);
			retry = setTimeout(() => night && !night.paused && message(nightMessage(night.rules), { triggerTurn: true }), RETRY_AFTER_MS);
			retry.unref?.();
			return;
		}
		const plan = (await listPlans(ctx.cwd)).find((candidate) => candidate.id === night.plan);
		if (!plan || plan.status === "complete" || (plan.total && plan.done === plan.total)) return stop(ctx, "", true);
		if (!plan.next && !plan.wip.length) return stop(ctx, "every remaining step is blocked or needs you");
		const fp = await fingerprint(ctx.cwd, plan.file);
		night.stalls = fp === night.fp ? night.stalls + 1 : 0;
		night.fp = fp;
		if (night.stalls >= 2) return stop(ctx, "two continues changed nothing");
		return { entries: [{ type: "custom_message", customType: ENTRY, content: nightMessage(night.rules), display: true }], continue: true };
	});
	return {
		// /reload keeps night mode: restore the banner and keep-awake; continuation resumes at the next settle.
		async restore(ctx) {
			const saved = ctx.sessionManager?.getBranch?.().findLast((entry) => entry.type === "custom" && entry.customType === ENTRY)?.data;
			release();
			night = saved?.plan ? { plan: saved.plan, rules: saved.rules ?? "", paused: saved.paused, complete: saved.complete, stalls: 0, fp: "" } : null;
			if (night && !night.paused && !night.complete) awake = keepAwake();
			banner(ctx);
		},
		shutdown: release,
	};
}
