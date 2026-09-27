#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import observe from './observe.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const seed = path.join(repo, 'benchmarks/workflow-evaluation/v1/projects/csv-expenses/seed');
const sha = content => createHash('sha256').update(content).digest('hex');
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const settings = {
  compaction: { enabled: true, keepRecentTokens: 30000 },
  workOrchestrator: { context: { enabled: true, autoCompact: true, compactAtTokens: 150000, keepRecentTokens: 30000, maxSummaryChars: 12000 }, knowledgeDiscoverer: { enabled: false, model: 'none' } },
};
function prepare(root) {
  if (existsSync(root)) throw new Error('Refusing to overwrite an existing experiment');
  const cwd = path.join(root, 'workspace');
  cpSync(seed, cwd, { recursive: true });
  mkdirSync(path.join(cwd, '.pi'), { recursive: true });
  save(path.join(cwd, '.pi/settings.json'), settings);
  cpSync(path.join(here, 'PLAN.md'), path.join(cwd, 'PLAN.md'));
  const sources = ['extensions/work-models.ts', 'extensions/work-compaction.js', ...['PLAN.md', 'observe.mjs', 'verify.mjs', 'run.mjs'].map(f => 'benchmarks/context-continuity/v2/' + f)];
  const manifest = { createdAt: new Date().toISOString(), cwd, model: 'zai/glm-5.3:high', settings,
    sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    hashes: Object.fromEntries(sources.map(f => [f, sha(readFileSync(path.join(repo, f)))])),
    protectedHashes: Object.fromEntries(['PLAN.md', 'package.json', '.pi/settings.json'].map(f => [f, sha(readFileSync(path.join(cwd, f)))])),
    scope: 'One long coding baseline, 14 serial milestones in one session. Full production extension and natural 150k trigger, 30k retained tail. No forced cuts or pinned checkpoints, no new optimization. No claim of threshold coverage unless observed. UI/background automation unavailable by child allowlist; knowledge sidecar and cache warming disabled.',
    caps: { activeMinutes: 90, estimatedUsd: 8, hostMinutes: 100, note: 'Cooperative caps after tool batches; in-flight requests can exceed cost cap. Outer deadline is a hard safety limit. Do not restart incomplete runs silently.' },
  };
  save(path.join(root, 'manifest.json'), manifest);
  return manifest;
}
function report(root) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const result = JSON.parse(readFileSync(path.join(root, 'result.json'), 'utf8'));
  const events = readFileSync(path.join(root, 'events.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  const entries = readFileSync(result.session, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  const assistants = entries.filter(e => e.type === 'message' && e.message?.role === 'assistant').map(e => e.message);
  const reads = events.filter(e => e.type === 'read');
  const independent = spawnSync(process.execPath, [path.join(here, 'verify.mjs'), manifest.cwd], { encoding: 'utf8', timeout: 120000, maxBuffer: 2_000_000 });
  const local = spawnSync(process.execPath, ['--test'], { cwd: manifest.cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 2_000_000 });
  const value = {
    manifest, result, settled: events.some(e => e.type === 'settled'),
    sourcesUnchanged: Object.entries(manifest.hashes).every(([f, h]) => sha(readFileSync(path.join(repo, f))) === h),
    protectedInputsUnchanged: Object.entries(manifest.protectedHashes).every(([f, h]) => sha(readFileSync(path.join(manifest.cwd, f))) === h),
    persistedUsage: { turns: assistants.length, totalTokens: assistants.reduce((n, m) => n + (m.usage?.totalTokens ?? 0), 0), cost: assistants.reduce((n, m) => n + (m.usage?.cost?.total ?? 0), 0) },
    persistedNativeCompactions: entries.filter(e => e.type === 'compaction').length,
    repeatedUnchangedReads: reads.length - new Set(reads.map(e => `${e.path}:${e.contentHash}`)).size,
    failedCheckCalls: events.filter(e => e.type === 'check' && !e.passed).length,
    blockedCalls: events.filter(e => e.type === 'blocked').length,
    budgetStops: events.filter(e => e.type === 'budget_stop'),
    independent: { passed: independent.status === 0, stdout: independent.stdout, stderr: independent.stderr, error: independent.error?.message },
    localTests: { passed: local.status === 0, stdout: local.stdout, stderr: local.stderr, error: local.error?.message },
    interpretation: 'Descriptive single-run baseline only. Provider usage totals are not window size. Count actual cuts and distinguish pre-cut usage from outgoing context; no improvement/promotion claim without the same end-to-end comparison.',
  };
  save(path.join(root, 'report.json'), value);
  return value;
}
function selfTest() {
  const root = mkdtempSync(path.join(tmpdir(), 'continuity-v2-selfcheck-'));
  try {
    const runRoot = path.join(root, 'case');
    const { cwd } = prepare(runRoot);
    const hooks = new Map(), tools = new Map();
    observe({ on: (name, fn) => hooks.set(name, fn), registerTool: tool => tools.set(tool.name, tool) });
    const ctx = { cwd, model: { provider: 'zai', id: 'glm-5.3' }, sessionManager: { getSessionFile: () => 'selfcheck-only' }, getContextUsage: () => ({ tokens: 150001 }) };
    hooks.get('session_start')({}, ctx);
    assert(hooks.get('tool_call')({ toolName: 'write', input: { path: '../outside' } }).block);
    assert(hooks.get('tool_call')({ toolName: 'write', input: { path: '.pi/settings.json' } }).block);
    assert.equal(hooks.get('tool_call')({ toolName: 'edit', input: { path: 'test/analyze.test.mjs' } }), undefined, 'replace the intentional seed failure with real tests');
    assert.equal(hooks.get('tool_call')({ toolName: 'write', input: { path: 'src/csv.mjs' } }), undefined);
    const kept = { role: 'user', content: 'Keep the original plan', timestamp: 1 };
    assert.equal(hooks.get('context')({ messages: [kept] }, ctx), undefined, 'observer never forces a cut at threshold');
    const compacted = { messages: [{ role: 'compactionSummary', summary: 'summary' }, kept] };
    hooks.get('context')(compacted, ctx);
    hooks.get('context')(compacted, ctx);
    hooks.get('agent_settled')();
    assert.equal(JSON.parse(readFileSync(path.join(runRoot, 'result.json'), 'utf8')).cuts, 1, 'unchanged anchor not counted twice');
    assert(tools.has('bench_test'));
    hooks.get('message_end')({ message: { role: 'assistant', usage: { totalTokens: 7, cost: { total: 8 } } } });
    const resumedHooks = new Map();
    observe({ on: (name, fn) => resumedHooks.set(name, fn), registerTool: () => {} });
    let aborted = false;
    const resumedCtx = { ...ctx, sessionManager: { getSessionFile: () => 'selfcheck-resumed' }, abort: () => { aborted = true; } };
    resumedHooks.get('session_start')({}, resumedCtx);
    resumedHooks.get('context')(compacted, resumedCtx);
    resumedHooks.get('turn_end')({}, resumedCtx);
    const cumulative = JSON.parse(readFileSync(path.join(runRoot, 'result.json'), 'utf8'));
    assert.equal(cumulative.turns, 1); assert.equal(cumulative.usage.totalTokens, 7);
    assert.equal(cumulative.cost, 8); assert.equal(cumulative.cuts, 1);
    assert(aborted, 'retained resume must not reset the experiment safety budget');
    const broken = spawnSync(process.execPath, [path.join(here, 'verify.mjs'), cwd], { encoding: 'utf8', timeout: 120000 });
    assert.equal(broken.status, 1, broken.stderr);
    const checks = JSON.parse(broken.stdout);
    assert.equal(checks.passed, false);
    assert(checks.checks.length >= 24);
    process.stdout.write('ok - long continuity harness: protected paths, observer-only threshold, distinct anchors, broken seed rejected by external checks\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
try {
  const [mode, directory] = process.argv.slice(2);
  if (mode === '--self-test') selfTest();
  else if (mode === '--prepare' && directory) process.stdout.write(JSON.stringify(prepare(path.resolve(directory)), null, 2) + '\n');
  else if (mode === '--report' && directory) {
    const value = report(path.resolve(directory));
    process.stdout.write(JSON.stringify({ result: value.result, settled: value.settled, independentPassed: value.independent.passed, testsPassed: value.localTests.passed, sourcesUnchanged: value.sourcesUnchanged, protectedInputsUnchanged: value.protectedInputsUnchanged, report: path.resolve(directory, 'report.json') }, null, 2) + '\n');
  } else throw new Error('Usage: --self-test | --prepare <new-directory> | --report <directory>');
} catch (error) { process.stderr.write(String(error.stack ?? error) + '\n'); process.exitCode = 1; }
