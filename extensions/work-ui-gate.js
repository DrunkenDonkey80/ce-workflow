// UI-gate repair loop orchestration (plan-final.md §2.5, unit P2):
// bounded rounds with repair-recipe hints, lease serialization, and
// Strict-policy human escalation through the shared work-dialogs overlay.
// Deciding/editing stays with the orchestrator: the loop only measures,
// re-verifies, and reports.
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	statSync,
	writeSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { runGate } from "../scripts/ui-gate/gate.mjs";
import { occupiedWorkActionLease } from "./work-action-leases.js";
import { showListDialog } from "./work-dialogs.js";

const LOCK_STALE_MS = 5 * 60_000;
const LOCK_POLL_MS = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Serialize gate runs on the out dir (plan §2.5 "Concurrency: leases").
// One writer per gate out dir; a stale lock (>5 min) is reaped.
export async function withGateLease(outDir, fn) {
	mkdirSync(outDir, { recursive: true });
	const lockPath = path.join(outDir, ".gate-lock");
	for (;;) {
		try {
			const fd = openSync(lockPath, "wx");
			try {
				writeSync(fd, `${JSON.stringify({ pid: process.pid, at: Date.now() })}\n`);
			} finally {
				closeSync(fd);
			}
			break;
		} catch (error) {
			if (error?.code !== "EEXIST") throw error;
			try {
				if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
					rmSync(lockPath, { force: true });
					continue;
				}
			} catch {
				// raced away — retry below
			}
			await sleep(LOCK_POLL_MS);
		}
	}
	try {
		return await fn();
	} finally {
		rmSync(lockPath, { force: true });
	}
}

function readFindings(out) {
	const file = path.join(out, "findings.json");
	if (!existsSync(file)) return [];
	try {
		return JSON.parse(readFileSync(file, "utf8")).findings ?? [];
	} catch {
		return [];
	}
}

function viewerPaths(out, result) {
	const paths = [];
	for (const [viewport, artifacts] of Object.entries(result.artifacts ?? {})) {
		if (artifacts?.viewer)
			paths.push(path.join(out, viewport, "actual", artifacts.viewer));
		else if (artifacts && typeof artifacts === "object")
			for (const [state, stateArtifacts] of Object.entries(artifacts))
				if (stateArtifacts?.viewer)
					paths.push(
						path.join(out, viewport, state, "actual", stateArtifacts.viewer),
					);
	}
	return paths;
}

function mapDecision(pick) {
	const value = pick?.value ?? pick;
	return value === "approve"
		? "approved"
		: value === "iterate"
			? "iterate"
			: "stopped";
}

// Strict-policy escalation (plan §2.5): findings report + human approval
// through the shared dialog system, with the SVG/HTML side-by-side viewer
// as the content. Headless (no ctx/dialog) never auto-approves.
export async function defaultEscalation({ result, out, ctx = null, dialog }) {
	const viewers = viewerPaths(out, result);
	const options = {
		title: "UI gate — human approval",
		purpose: "Strict policy: the bounded repair loop did not converge.",
		subtitle: [
			`round ${result.round ?? "?"} · ${result.errors ?? "?"} errors · ${result.warnings ?? "?"} warnings`,
			"Side-by-side evidence: open the viewer HTML paths below.",
		],
		items: [
			{
				value: "approve",
				label: "Accept current state",
				description: "Record approval and finish the gate run",
			},
			{
				value: "iterate",
				label: "Run more rounds",
				description: "Continue the repair loop",
			},
			{
				value: "stop",
				label: "Stop",
				description: "Leave the findings open for the orchestrator",
			},
		],
		viewers,
	};
	if (dialog) return { decision: mapDecision(await dialog(options)), viewers };
	if (ctx && typeof ctx.ui?.custom === "function")
		return { decision: mapDecision(await showListDialog(ctx, options)), viewers };
	return { decision: "stopped", viewers };
}

// The repair loop (plan §2.5 + §0.7 monotonicity): capture → rules+match →
// applyFix (orchestrator) → re-verify. Cap and early stop live in the gate;
// this loop honors them and escalates under Strict policy.
export async function runUiGateRepairLoop({
	actual,
	spec = null,
	viewports = ["desktop"],
	state = "ready",
	out,
	handoffFile = null,
	allowlistFile = null,
	policy = "advisory",
	maxRounds = 3,
	profile = "web",
	tier3Model = null,
	applyFix = null,
	escalate = null,
	cwd = null,
	leaseCheck = false,
}) {
	if (leaseCheck && cwd && occupiedWorkActionLease(cwd))
		throw new Error(
			"ui-gate deferred: a mutable action lease is occupied for this repository",
		);
	let result = null;
	const rounds = [];
	// Plan §2.7: Tier 3 round cap 2 — noisier measurements, shorter leash.
	const effectiveMaxRounds =
		profile === "vlm" ? Math.min(maxRounds, 2) : maxRounds;
	for (let round = 1; round <= effectiveMaxRounds; round += 1) {
		result = await withGateLease(out, () =>
			runGate({
				actual,
				spec,
				viewports,
				state,
				out,
				handoffFile,
				allowlistFile,
				round,
				maxRounds: effectiveMaxRounds,
				profile,
				tier3Model,
			}),
		);
		rounds.push({
			round: result.round,
			errors: result.errors,
			warnings: result.warnings,
			total: result.total,
			converged: result.converged,
			earlyStop: result.earlyStop,
		});
		if (result.converged || result.earlyStop || round === maxRounds) break;
		const applied = applyFix
			? await applyFix({ round, out, findings: readFindings(out) })
			: false;
		if (!applied) break;
	}
	let escalation = null;
	if (result && !result.converged && policy === "strict")
		escalation = escalate
			? await escalate({ result, out })
			: await defaultEscalation({ result, out });
	return { ...result, rounds, escalation };
}

function parseCommandArgs(args) {
	const tokens = String(args ?? "")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	const parsed = { viewports: [] };
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token.startsWith("--")) continue;
		const value = tokens[index + 1];
		if (token === "--viewport") parsed.viewports.push(value);
		else if (token === "--max-rounds") parsed.maxRounds = Number(value);
		else if (token === "--actual") parsed.actual = value;
		else if (token === "--spec") parsed.spec = value;
		else if (token === "--out") parsed.out = value;
		else if (token === "--state") parsed.state = value;
		else if (token === "--handoff") parsed.handoff = value;
		else if (token === "--policy") parsed.policy = value;
		index += 1;
	}
	return parsed;
}

// Explicit-action trigger (plan §2.5). Runs the loop for the operator and
// hands the findings back to the session as one compact summary.
export async function uiGateCommand(args, ctx) {
	const parsed = parseCommandArgs(args);
	if (!parsed.actual || !parsed.out) {
		ctx.ui.notify?.(
			"usage: /ui-gate --actual <file-or-url> --out <dir> [--spec <file>] [--viewport name]… [--state s] [--handoff f] [--policy advisory|strict] [--max-rounds n]",
			"error",
		);
		return;
	}
	const resolveFrom = (value) => (value ? path.resolve(ctx.cwd, value) : value);
	let result;
	try {
		result = await runUiGateRepairLoop({
			actual: resolveFrom(parsed.actual),
			spec: resolveFrom(parsed.spec),
			viewports: parsed.viewports.length ? parsed.viewports : ["desktop"],
			state: parsed.state ?? "ready",
			out: resolveFrom(parsed.out),
			handoffFile: resolveFrom(parsed.handoff),
			policy: parsed.policy ?? "advisory",
			maxRounds: parsed.maxRounds ?? 3,
			leaseCheck: true,
			cwd: ctx.cwd,
			escalate:
				parsed.policy === "strict"
					? ({ result: current, out }) =>
							defaultEscalation({ result: current, out, ctx })
					: null,
		});
	} catch (error) {
		ctx.ui.notify?.(`ui-gate failed: ${error.message}`, "error");
		return;
	}
	const findingsPath = path.join(resolveFrom(parsed.out), "findings.json");
	ctx.ui.notify?.(
		`ui-gate: round ${result.round}, errors ${result.errors}, warnings ${result.warnings}${result.escalation ? `, escalation ${result.escalation.decision}` : ""} — ${findingsPath}`,
		result.ok ? "info" : "warn",
	);
	ctx.sendMessage?.({
		message: `UI gate run finished: round ${result.round}, errors ${result.errors}, warnings ${result.warnings}, converged ${result.converged}. Findings (with repair-recipe hints): ${findingsPath}. Fix the reported elements, then re-run /ui-gate.`,
	});
}

export function registerWorkUiGate(pi) {
	if (typeof pi?.registerCommand !== "function") return;
	pi.registerCommand("ui-gate", {
		description:
			"Run the UI gate repair loop (capture → rules → fidelity → bounded repair)",
		handler: async (args, ctx) => uiGateCommand(args, ctx),
	});
}
