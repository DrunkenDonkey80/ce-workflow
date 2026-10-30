// ce-workflow updates running sessions in place. When package.json on disk carries another version than the one this
// runtime loaded (a release in the developer checkout, or the hub downloading one) and that version has held for a
// minute (a download is finished), the session runs /wo reload at its first quiet moment: right after a run ends, between
// two plan steps or after a compaction inside a run (the run stops at the next turn end and continues after the reload),
// or, under the hub, after 2 idle minutes.
// Pi itself cannot reload; the hub restarts for that when every session is idle.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDialogs } from "./ask-user/menu.ts";
import { hubActive, publish } from "./hub-channel.ts";

const PACKAGE = fileURLToPath(new URL("../package.json", import.meta.url));
export const readVersion = (file = PACKAGE) => { try { return String(JSON.parse(readFileSync(file, "utf8")).version ?? ""); } catch { return ""; } };
export const LOADED_VERSION = readVersion();
// globalThis outlives the reload, this module's state does not: what the new runtime says and sends first.
const CARRY = Symbol.for("ce-workflow.self-update");
type Carry = { from: string; resume?: string };

export function registerSelfUpdate(pi, { packageFile = PACKAGE, loaded = LOADED_VERSION, now = Date.now, every = 60_000, stableMs = 60_000, idleMs = 120_000 } = {}) {
	let seen = "", seenAt = 0, boundary = false, stopped = "", lastActivity = now(), ctxRef = null, timer;
	/** The newer version once it has held for stableMs, else "". */
	const ready = () => {
		const disk = readVersion(packageFile);
		if (!disk || disk === loaded) { seen = ""; return ""; }
		if (disk !== seen) { seen = disk; seenAt = now(); }
		return now() - seenAt >= stableMs ? disk : "";
	};
	const quiet = ctx => {
		const info = { subagents: 0, compacting: false }; pi.events?.emit?.("plan3:busy-info", info);
		try { return !info.subagents && !info.compacting && !openDialogs() && ctx.isIdle() && !ctx.hasPendingMessages(); } catch { return false; } // a stale ctx
	};
	const reload = (ctx, version, resume?: string) => {
		globalThis[CARRY] = { from: loaded, ...resume && { resume } } satisfies Carry;
		const text = `ce-workflow ${version} is installed; reloading onto it.`;
		ctx.ui?.notify?.(text, "info"); publish(ctx.ui, "notice", { text });
		pi.sendUserMessage("/wo reload", { expandPromptTemplates: true });
	};

	pi.on("session_start", (event, ctx) => {
		ctxRef = ctx; lastActivity = now();
		clearInterval(timer);
		// Watches in every mode (a version counts once it has held); reloads from here only under the hub, where nobody types.
		timer = setInterval(() => {
			const version = ready();
			if (version && hubActive() && ctxRef && now() - lastActivity >= idleMs && quiet(ctxRef)) reload(ctxRef, version);
		}, every);
		timer.unref?.();
		const carry = globalThis[CARRY] as Carry | undefined;
		if (event.reason !== "reload" || !carry) return;
		delete globalThis[CARRY];
		const text = `ce-workflow updated: ${carry.from} → ${loaded}.`;
		ctx.ui?.notify?.(text, "info"); publish(ctx.ui, "notice", { text });
		// After the reload command returns, so the new run does not start inside it.
		if (carry.resume) setTimeout(() => pi.sendUserMessage(carry.resume), 0);
	});
	pi.on("session_shutdown", () => { clearInterval(timer); ctxRef = null; });
	pi.on("agent_start", () => { lastActivity = now(); });
	pi.on("input", () => { lastActivity = now(); });
	// A finished plan step: the one boundary inside a long run where stopping loses nothing.
	pi.on("tool_result", event => {
		if (event.toolName === "plan3" && !event.isError && (event.input?.action === "next" || (event.input?.action === "step" && event.input?.mark === "done"))) boundary = true;
	});
	// A compaction mid-run: the model already works from a summary, so stopping after the next turn loses next to nothing.
	// An idle /compact is not a boundary: it would stop the next prompt after one turn.
	pi.on("session_compact", (_event, ctx) => { try { if (!ctx.isIdle()) boundary = true; } catch { /* a stale ctx */ } });
	pi.on("turn_end", (_event, ctx) => {
		if (!boundary) return;
		boundary = false;
		const version = ready();
		const info = { subagents: 0, compacting: false }; pi.events?.emit?.("plan3:busy-info", info);
		if (!version || info.subagents || info.compacting || openDialogs() || ctx.hasPendingMessages?.()) return;
		stopped = version;
		ctx.abort();
	});
	pi.on("agent_settled", (_event, ctx) => {
		ctxRef = ctx; lastActivity = now();
		const version = stopped || ready();
		const resume = stopped ? `ce-workflow was updated to ${version} and reloaded; the run was stopped on purpose at a turn boundary (a finished plan step or a compaction). Continue where you left off.` : undefined;
		stopped = ""; boundary = false;
		if (version && (resume || quiet(ctx))) reload(ctx, version, resume);
	});
}
