#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import extension from "../benchmarks/context-continuity/v1/extension.mjs";
import { plan, grade } from "../benchmarks/context-continuity/v1/fixture.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const load = (file) => JSON.parse(readFileSync(file, "utf8"));
const save = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
const settings = {
  compaction: { enabled: false, keepRecentTokens: 1200 },
  workOrchestrator: { context: { enabled: true, autoCompact: false, compactAtTokens: 150000, keepRecentTokens: 1200, maxSummaryChars: 12000 }, knowledgeDiscoverer: { enabled: false } },
};
const common = "Implement every phase in PLAN.md, in order, in this disposable workspace. Start with phase 1 and continue autonomously through phase 6. Use bench_check after each phase; fix failures before proceeding. Do not stop to ask for another prompt. All implementation and notes must stay in this workspace. The plan and compatibility findings remain available to read again if needed. No delegation, shell, packages, or network. Report only what the checks actually verified.";
const checkpointInstruction = " Before each phase submission (1–5), write or update CHECKPOINT.md (maximum 6000 characters): objective and hard constraints; compatibility discoveries and rejected approaches; completed work with actual evidence; current work and exact next action. These are concise operational notes, not private reasoning. The harness pins your latest checkpoint after each cut. Do not invent evidence or copy the whole transcript.";
const workflow = `const results = [];
for (const item of args.cases) {
  const run = await runs.run(item.id, {
    label: "Test GLM " + item.policy + " repetition " + item.repetition,
    agent: args.agent, model: "zai/glm-5.3:high", context: "fresh",
    cwd: item.cwd, task: item.task, timeoutMs: 780000,
    output: item.id + ".md", acceptance: false,
  });
  results.push({ id: item.id, ...run });
  if (!run.ok) return { stopped: true, reason: "Child failure; no execution-mode fallback", results };
}
return { results };
`;

function scaffold(root, config) {
  const cwd = path.join(root, "workspace");
  mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  save(path.join(root, "case.json"), config);
  save(path.join(cwd, ".pi", "settings.json"), settings);
  writeFileSync(path.join(cwd, "PLAN.md"), plan);
  return cwd;
}

function prepare(root) {
  if (existsSync(root)) throw new Error("Refusing to overwrite an existing benchmark run");
  mkdirSync(root, { recursive: true });
  const cases = [];
  for (let repetition = 1; repetition <= 3; repetition++) {
    const order = repetition % 2 ? ["baseline", "checkpoint"] : ["checkpoint", "baseline"];
    for (const policy of order) {
      const id = `r${repetition}-${policy}`;
      const cwd = scaffold(path.join(root, id), { id, policy, repetition });
      cases.push({ id, policy, repetition, cwd, task: common + (policy === "checkpoint" ? checkpointInstruction : "") });
    }
  }
  const sourceFiles = ["extensions/work-models.ts", "extensions/work-compaction.js", "benchmarks/context-continuity/v1/extension.mjs", "benchmarks/context-continuity/v1/fixture.mjs", "scripts/benchmark-context-continuity.mjs"];
  const manifest = {
    createdAt: new Date().toISOString(), model: "zai/glm-5.3", thinking: "high", root,
    gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    sources: Object.fromEntries(sourceFiles.map(file => [file, sha(readFileSync(path.join(repo, file)))])),
    planHash: sha(plan), settings, cases,
    limits: { maxTurnsPerCase: 80, maxToolCallsPerCase: 140, maxAccountedUsdPerCase: 1, maxActiveMinutesPerCase: 12, hostDeadlineMinutesPerCase: 13, note: "Usage stops occur at completed tool boundaries; an in-flight request may exceed a usage cap. No auto recovery or retries of failed benchmark cases." },
    scope: "Forced-cut behavioral pilot: production filter functions, 1200-token retained tail, 12000-character summary, five requested cuts during one uninterrupted six-phase run. NOT a natural 150k/200k or overnight benchmark. Checkpoint is an experimental agent-authored file pinned request-locally; no production changes.",
  };
  save(path.join(root, "manifest.json"), manifest);
  writeFileSync(path.join(root, "workflow.js"), workflow);
  process.stdout.write(JSON.stringify({ root, manifest: path.join(root, "manifest.json"), cases: cases.map(({ id, cwd }) => ({ id, cwd })) }, null, 2) + "\n");
}

function eventsFor(root) {
  const file = path.join(root, "events.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
}
function median(values) {
  if (!values.length || values.some(value => !Number.isFinite(value))) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
}

async function report(root) {
  const manifest = load(path.join(root, "manifest.json"));
  const results = [];
  for (const item of manifest.cases) {
    const directory = path.dirname(item.cwd);
    const events = eventsFor(directory);
    const file = path.join(directory, "result.json");
    if (!existsSync(file)) { results.push({ id: item.id, policy: item.policy, missing: true }); continue; }
    const result = load(file);
    const checks = events.filter(event => event.type === "check");
    const reads = events.filter(event => event.type === "read");
    const distinctReads = new Set(reads.map(event => `${event.path}:${event.contentHash}`));
    const failures = checks.filter(event => !event.passed);
    const distinctFailures = new Set(failures.map(event => `${event.phase}:${event.error}`));
    const cuts = events.filter(event => event.type === "cut");
    let independent;
    try {
      // Separate process avoids module-cache contamination between runs and bounds generated code.
      independent = JSON.parse(execFileSync(process.execPath, [path.join(repo, "benchmarks/context-continuity/v1/fixture.mjs"), "--grade", item.cwd, "6"], { encoding: "utf8", timeout: 10000 }));
    } catch (error) { independent = { passed: false, error: String(error.stdout ?? error.message).slice(0, 2000) }; }
    const start = events.find(event => event.type === "start");
    let persistedTotals = null;
    if (start?.session && existsSync(start.session)) {
      const entries = readFileSync(start.session, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
      const messages = entries.filter(entry => entry.type === "message" && entry.message?.role === "assistant").map(entry => entry.message);
      persistedTotals = { turns: messages.length, tokens: messages.reduce((sum, m) => sum + (m.usage?.totalTokens ?? 0), 0), costUsd: messages.reduce((sum, m) => sum + (m.usage?.cost?.total ?? 0), 0) };
    }
    results.push({ ...result, session: start?.session, independent, persistedTotals,
      cutsValid: cuts.length === 5 && cuts.every(cut => cut.applied) && new Set(cuts.map(cut => cut.keptAnchor)).size === 5,
      evidenceComplete: Boolean(events.some(event => event.type === "settled")) && persistedTotals?.turns === result.turns && persistedTotals?.tokens === result.usage.totalTokens,
      failedChecks: failures.length, repeatedFailures: failures.length - distinctFailures.size,
      repeatedUnchangedReads: reads.length - distinctReads.size,
      planReads: reads.filter(event => event.path === "PLAN.md").length,
      repeatedLegacyProbes: Math.max(0, result.legacy - 1), compatibilityRediscoveries: Math.max(0, result.current - 1),
    });
  }
  const summary = {};
  for (const policy of ["baseline", "checkpoint"]) {
    const rows = results.filter(row => row.policy === policy);
    summary[policy] = { runs: rows.length, complete: rows.filter(row => row.complete && row.independent?.passed).length,
      validEvidence: rows.every(row => row.cutsValid && row.evidenceComplete),
      medians: Object.fromEntries(["elapsedMs", "turns", "calls", "costUsd", "failedChecks", "repeatedFailures", "repeatedUnchangedReads", "compatibilityRediscoveries", "repeatedLegacyProbes"].map(key => [key, median(rows.map(row => row[key]))])),
      totalTokensMedian: median(rows.map(row => row.usage?.totalTokens)),
    };
  }
  const report = { manifest, results, summary, productionRecommendation: "Do not promote from this pilot alone. Require same accepted end-to-end benchmark and bounded natural-threshold test. Repeated unchanged reads are a proxy, not proven wasted work." };
  save(path.join(root, "report.json"), report);
  process.stdout.write(JSON.stringify({ root, summary, report: path.join(root, "report.json") }, null, 2) + "\n");
}

async function selfTest() {
  const root = mkdtempSync(path.join(tmpdir(), "continuity-selfcheck-"));
  try {
    for (const policy of ["baseline", "checkpoint"]) {
      const caseRoot = path.join(root, policy);
      const cwd = scaffold(caseRoot, { policy, id: policy, repetition: 0 });
      const hooks = new Map(), tools = new Map();
      extension({ on: (name, fn) => hooks.set(name, fn), registerTool: tool => tools.set(tool.name, tool) });
      const ctx = { cwd, model: { provider: "zai", id: "glm-5.3", contextWindow: 1000000 }, sessionManager: { getSessionFile: () => null, getBranch: () => [] }, abort: () => { throw new Error("unexpected abort"); } };
      hooks.get("session_start")({}, ctx);
      assert(hooks.get("tool_call")({ toolName: "write", input: { path: "../case.json" } }).block);
      assert(hooks.get("tool_call")({ toolName: "edit", input: { path: "PLAN.md" } }).block);
      assert.match(tools.get("bench_check").description, /cumulative/);
      const probe = tools.get("bench_probe");
      await probe.execute("p1", { transport: "legacy" });
      await probe.execute("p2", { transport: "current" });
      // Deliberately minimal phase-1 test double, never copied to live benchmark workspaces.
      writeFileSync(path.join(cwd, "calculator.mjs"), `export function evaluate(s) { if(s==='8/0') throw Error('Division by zero'); const r={'2+3*4':14,'-(2.5+1.5)*2':-8,'10/(2+3)':2}; if(!(s in r)) throw Error('Invalid'); return r[s]; }`);
      writeFileSync(path.join(cwd, "index.html"), "<html></html>");
      writeFileSync(path.join(cwd, "app.mjs"), "// fixture");
      writeFileSync(path.join(cwd, "CHECKPOINT.md"), "Objective: calculator. Discovered schema calc-lite/3. Legacy rejected. Next: phase 2.");
      assert.equal((await grade(cwd, 1)).passed, true);
      assert.equal(JSON.parse((await tools.get("bench_check").execute("c1", { phase: 1 })).content[0].text).passed, true);
      const messages = [{ role: "user", content: "Implement all six phases in PLAN.md", timestamp: 1 }];
      for (let i = 0; i < 50; i++) {
        messages.push({ role: "assistant", content: [{ type: "toolCall", id: `call-${i}`, name: "read", arguments: { path: "PLAN.md" } }], timestamp: i * 2 + 2 });
        messages.push({ role: "toolResult", toolCallId: `call-${i}`, toolName: "read", content: [{ type: "text", text: `result ${i}: ` + "read-only archived evidence ".repeat(60) }], timestamp: i * 2 + 3 });
      }
      const projected = (await hooks.get("context")({ messages }, ctx)).messages;
      assert(projected.length < messages.length);
      assert.equal(projected.filter(m => m.role === "compactionSummary").length, 1);
      assert.equal(projected.filter(m => m.customType === "benchmark-task-checkpoint").length, policy === "checkpoint" ? 1 : 0);
      const calls = new Set(projected.flatMap(m => Array.isArray(m.content) ? m.content.filter(p => p.type === "toolCall").map(p => p.id) : []));
      for (const m of projected) if (m.role === "toolResult") assert(calls.has(m.toolCallId), "orphan tool result");
      assert.equal(eventsFor(caseRoot).find(e => e.type === "cut").applied, true);
      assert.equal(JSON.parse((await tools.get("bench_check").execute("repeat", { phase: 1 })).content[0].text).passed, false);
      await assert.rejects(grade(cwd, 6));
    }
    process.stdout.write("ok - continuity harness: real filter, pairing, checkpoint isolation, phase gates, path boundary, failing grader\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
}

try {
  const [mode, root] = process.argv.slice(2);
  if (mode === "--self-test") await selfTest();
  else if (mode === "--prepare" && root) prepare(path.resolve(root));
  else if (mode === "--report" && root) await report(path.resolve(root));
  else throw new Error("Usage: --self-test | --prepare <new-output-directory> | --report <output-directory>");
} catch (error) { process.stderr.write(String(error.stack ?? error) + "\n"); process.exitCode = 1; }
