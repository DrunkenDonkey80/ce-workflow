import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { filteredContext, requestContextFilter, resetContextFilter } from "../../../extensions/work-models.ts";
import { compatibility } from "./fixture.mjs";

const fixture = fileURLToPath(new URL("./fixture.mjs", import.meta.url));
const text = (value) => typeof value === "string" ? value : JSON.stringify(value);
const hash = (value) => createHash("sha256").update(text(value)).digest("hex");
const result = (value) => ({ content: [{ type: "text", text: text(value) }], details: undefined });

export default function continuityBenchmark(pi) {
  let config, root, workspace, started, phase = 0, pendingCut = false, checkpoint = "", cutTime = 0;
  let calls = 0, turns = 0, cost = 0, cutCount = 0, legacy = 0, current = 0;
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
  const log = (event) => appendFileSync(path.join(root, "events.jsonl"), JSON.stringify({ at: Date.now(), ...event }) + "\n");
  const save = () => writeFileSync(path.join(root, "result.json"), JSON.stringify({
    ...config, phase, complete: phase === 6, cutCount, turns, calls, costUsd: cost,
    usage, elapsedMs: Date.now() - started, legacy, current,
  }, null, 2));
  const schema = (properties, required) => ({ type: "object", properties, required, additionalProperties: false });

  pi.on("session_start", (_event, ctx) => {
    workspace = path.resolve(ctx.cwd);
    root = path.dirname(workspace);
    config = JSON.parse(readFileSync(path.join(root, "case.json"), "utf8"));
    if (!['baseline', 'checkpoint'].includes(config.policy)) throw new Error("Unknown benchmark policy");
    if (ctx.model?.provider !== "zai" || ctx.model?.id !== "glm-5.3") throw new Error("Benchmark requires zai/glm-5.3");
    started = Date.now();
    resetContextFilter();
    log({ type: "start", model: `${ctx.model.provider}/${ctx.model.id}`, session: ctx.sessionManager.getSessionFile() });
    save();
  });
  pi.on("cache_warming_decision", () => ({ action: "stop" }));
  pi.on("tool_call", (event) => {
    calls += 1;
    const args = event.input ?? {};
    log({ type: "call", name: event.toolName, argsHash: hash(args), path: args.path, phase });
    if (["read", "write", "edit"].includes(event.toolName)) {
      const relative = path.relative(workspace, path.resolve(workspace, args.path ?? ""));
      const allowed = /^(calculator\.mjs|app\.mjs|index\.html|CHECKPOINT\.md|NOTES\.md|PLAN\.md)$/.test(relative);
      if (!allowed || (relative === "PLAN.md" && event.toolName !== "read"))
        return { block: true, reason: "Only task files in this workspace are accessible; PLAN.md is read-only." };
      if (event.toolName === "read") {
        try { log({ type: "read", path: relative, contentHash: hash(readFileSync(path.join(workspace, relative), "utf8")), phase }); }
        catch { /* The builtin tool reports a missing file. */ }
      }
    }
  });
  pi.on("message_end", (event) => {
    const m = event.message;
    if (m?.role !== "assistant") return;
    turns += 1;
    for (const key of Object.keys(usage)) usage[key] += m.usage?.[key] ?? 0;
    cost += m.usage?.cost?.total ?? 0;
    log({ type: "assistant", stopReason: m.stopReason, usage: m.usage, phase });
    save();
  });
  pi.on("turn_end", (_event, ctx) => {
    // Bench safety only: never reset on a cut. Abort after completed tool batches.
    if (turns >= 80 || calls >= 140 || cost >= 1.0 || Date.now() - started >= 12 * 60_000) {
      log({ type: "budget_stop", phase, turns, calls, cost });
      save();
      ctx.abort();
    }
  });
  pi.on("context", async (event, ctx) => {
    if (pendingCut) requestContextFilter(ctx);
    const projection = (await filteredContext(event, ctx))?.messages ?? event.messages;
    if (pendingCut) {
      const summary = projection.find(m => m.role === "compactionSummary");
      const kept = projection.find(m => m.role !== "compactionSummary");
      const applied = Boolean(summary) && projection.length < event.messages.length;
      if (applied) cutCount += 1;
      log({ type: "cut", phase, applied, before: event.messages.length, after: projection.length,
        keptAnchor: kept ? hash(kept) : null, summary: summary?.summary, checkpoint });
      pendingCut = false;
    }
    const messages = checkpoint ? [...projection, {
      role: "custom", customType: "benchmark-task-checkpoint", display: false,
      content: `Task checkpoint (agent-authored; claims are not verification):\n${checkpoint}\n\nHost-verified completed phase: ${phase}. Continue phase ${phase + 1} of 6 from PLAN.md.`,
      timestamp: cutTime,
    }] : projection;
    log({ type: "context", phase, messages: messages.length, chars: JSON.stringify(messages).length });
    return { messages };
  });
  pi.on("agent_settled", () => { log({ type: "settled", phase }); save(); });

  pi.registerTool({
    name: "bench_probe", label: "Probe compatibility", description: "Discover calculator snapshot compatibility using legacy or current transport. Read-only; available throughout the task.",
    parameters: schema({ transport: { type: "string", enum: ["legacy", "current"] } }, ["transport"]),
    async execute(_id, params) {
      if (params.transport === "legacy") {
        legacy += 1;
        log({ type: "probe", transport: "legacy", attempt: legacy, phase });
        return result({ supported: false, reason: "Legacy transport is retired; use transport=current. Do not retry legacy." });
      }
      current += 1;
      log({ type: "probe", transport: "current", attempt: current, phase });
      return result(compatibility);
    },
  });
  pi.registerTool({
    name: "bench_check", label: "Verify phase", description: "Run the independent cumulative tests for the next phase (1–6). On success advance to the next phase; fix failures before advancing. No shell needed.",
    parameters: schema({ phase: { type: "integer", minimum: 1, maximum: 6 } }, ["phase"]),
    async execute(_id, params) {
      if (params.phase !== phase + 1) return result({ passed: false, error: `Next phase is ${phase + 1}; do not repeat completed phases.` });
      if (!legacy || !current) return result({ passed: false, error: "Complete phase 1 compatibility discovery first." });
      let nextCheckpoint = "";
      if (config.policy === "checkpoint" && params.phase < 6) {
        try { nextCheckpoint = readFileSync(path.join(workspace, "CHECKPOINT.md"), "utf8"); }
        catch { return result({ passed: false, error: "Write CHECKPOINT.md before submitting this phase." }); }
        if (!nextCheckpoint.trim() || nextCheckpoint.length > 6_000)
          return result({ passed: false, error: "CHECKPOINT.md must contain 1–6000 characters." });
      }
      let checked;
      try { checked = JSON.parse(execFileSync(process.execPath, [fixture, "--grade", workspace, String(params.phase)], { encoding: "utf8", timeout: 10_000, maxBuffer: 100_000 })); }
      catch (error) {
        try { checked = JSON.parse(String(error.stdout)); }
        catch { checked = { passed: false, error: String(error.message).slice(0, 1000) }; }
      }
      log({ type: "check", phase: params.phase, ...checked });
      if (!checked.passed) return result(checked);
      phase = params.phase;
      pendingCut = phase < 6;
      checkpoint = nextCheckpoint;
      cutTime = Date.now();
      save();
      return result({ passed: true, completedPhase: phase, nextPhase: phase < 6 ? phase + 1 : null });
    },
  });
}
