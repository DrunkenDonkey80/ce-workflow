import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const grader = fileURLToPath(new URL('./verify.mjs', import.meta.url));
const legacy = fileURLToPath(new URL('../../workflow-evaluation/v1/projects/csv-expenses/acceptance/verify.mjs', import.meta.url));
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

// Loaded AFTER the real production extension: observe its outgoing projection,
// never request a cut, replace context, pin notes, or send continuation prompts.
export default function observe(pi) {
  let cwd, root, started, session, previousAnchor, cuts = 0, turns = 0, calls = 0, cost = 0, peakReportedContext = 0;
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
  const log = event => appendFileSync(path.join(root, 'events.jsonl'), JSON.stringify({ at: Date.now(), ...event }) + '\n');
  const save = () => writeFileSync(path.join(root, 'result.json'), JSON.stringify({ session, previousAnchor, cuts, turns, calls, cost, usage, peakReportedContext, elapsedMs: Date.now() - started }, null, 2));
  pi.on('session_start', (_event, ctx) => {
    cwd = path.resolve(ctx.cwd); root = path.dirname(cwd); started = Date.now();
    session = ctx.sessionManager.getSessionFile();
    // Retained-child continuations keep the experiment's counters and safety
    // budget. Exclude the parent's review interval from active runtime.
    let prior;
    try { prior = JSON.parse(readFileSync(path.join(root, 'result.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (prior) {
      started -= prior.elapsedMs;
      ({ cuts, turns, calls, cost, peakReportedContext, previousAnchor } = prior);
      Object.assign(usage, prior.usage);
    }
    if (ctx.model?.provider !== 'zai' || ctx.model?.id !== 'glm-5.3') throw new Error('Long benchmark requires zai/glm-5.3');
    log({ type: 'start', cwd, session, continuedFrom: prior?.session, cumulativeAtStart: prior ? { turns, calls, cost, usage: { ...usage }, elapsedMs: prior.elapsedMs } : null, model: `${ctx.model.provider}/${ctx.model.id}`, settingsHash: hash(readFileSync(path.join(cwd, '.pi/settings.json'), 'utf8')) });
    save();
  });
  pi.on('cache_warming_decision', () => ({ action: 'stop' }));
  pi.on('context', (event, ctx) => {
    const reportedTokens = ctx.getContextUsage?.()?.tokens ?? null;
    peakReportedContext = Math.max(peakReportedContext, reportedTokens ?? 0);
    const summary = event.messages.find(m => m.role === 'compactionSummary');
    const kept = event.messages.find(m => m.role !== 'compactionSummary');
    const anchor = summary && kept ? hash({ role: kept.role, timestamp: kept.timestamp, toolCallId: kept.toolCallId, callIds: Array.isArray(kept.content) ? kept.content.filter(p => p.type === 'toolCall').map(p => p.id) : [] }) : null;
    if (anchor && anchor !== previousAnchor) {
      cuts += 1;
      log({ type: 'cut', anchor, previousAnchor, reportedTokens, summary: summary.summary });
      previousAnchor = anchor;
    }
    log({ type: 'context', reportedTokens, messages: event.messages.length, chars: JSON.stringify(event.messages).length, anchor });
  });
  pi.on('tool_call', event => {
    calls += 1;
    const args = event.input ?? {};
    log({ type: 'call', name: event.toolName, path: args.path, argsHash: hash(args) });
    if (!['read', 'write', 'edit'].includes(event.toolName)) return;
    const relative = path.relative(cwd, path.resolve(cwd, args.path ?? '')).replaceAll('\\', '/');
    const inTask = /^(src|test)\//.test(relative) || ['package.json', 'PLAN.md', 'README.md', 'NOTES.md'].includes(relative);
    const protectedFile = ['package.json', 'PLAN.md'].includes(relative);
    if (!inTask || relative.split('/').includes('..') || (protectedFile && event.toolName !== 'read')) {
      log({ type: 'blocked', name: event.toolName, path: args.path });
      return { block: true, reason: 'Only src/, test/, README.md and NOTES.md are writable. PLAN.md/package.json are read-only. Return the final report as your final answer.' };
    }
    if (event.toolName === 'read') {
      try { log({ type: 'read', path: relative, contentHash: hash(readFileSync(path.join(cwd, relative), 'utf8')) }); }
      catch { /* The builtin tool reports missing files. */ }
    }
  });
  pi.on('tool_execution_end', event => {
    if (event.isError || event.result?.isError) log({ type: 'tool_error', name: event.toolName, result: event.result });
  });
  pi.on('message_end', event => {
    const m = event.message;
    if (m?.role !== 'assistant') return;
    turns += 1;
    for (const key of Object.keys(usage)) usage[key] += m.usage?.[key] ?? 0;
    cost += m.usage?.cost?.total ?? 0;
    log({ type: 'assistant', usage: m.usage, stopReason: m.stopReason }); save();
  });
  pi.on('turn_end', (_event, ctx) => {
    // A generous experiment safety cap, evaluated only after tool batches finish.
    if (cost >= 8 || Date.now() - started >= 90 * 60_000) {
      log({ type: 'budget_stop', cost, turns, calls }); save(); ctx.abort();
    }
  });
  pi.on('session_compact', event => log({ type: 'native_compact', event }));
  pi.on('agent_settled', () => { log({ type: 'settled' }); save(); });
  pi.registerTool({
    name: 'bench_test', label: 'Run product checks',
    description: 'Run existing local tests (node --test), original compatibility acceptance, or full long-task acceptance. inventory lists task source and test files. No phase advancement or automatic next-step prompt.',
    parameters: { type: 'object', properties: { suite: { type: 'string', enum: ['tests', 'original', 'acceptance', 'inventory'] } }, required: ['suite'], additionalProperties: false },
    async execute(_id, params) {
      if (params.suite === 'inventory') {
        const files = ['package.json', 'PLAN.md'];
        for (const dir of ['src', 'test']) for (const item of readdirSync(path.join(cwd, dir), { recursive: true, withFileTypes: true })) if (item.isFile()) files.push(path.relative(cwd, path.join(item.parentPath, item.name)));
        return { content: [{ type: 'text', text: JSON.stringify(files) }], details: undefined };
      }
      const args = params.suite === 'tests' ? ['--test'] : [params.suite === 'original' ? legacy : grader, cwd];
      const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 90000, maxBuffer: 2_000_000 });
      const evidence = { type: 'check', suite: params.suite, passed: result.status === 0, status: result.status, error: result.error?.message, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
      log(evidence);
      const rendered = JSON.stringify(evidence);
      return { content: [{ type: 'text', text: rendered.length > 14000 ? rendered.slice(0, 7000) + '\n[output truncated]\n' + rendered.slice(-7000) : rendered }], details: { passed: evidence.passed } };
    },
  });
}
