import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { compactMemory, coreText, decodeMemory } from '../extensions/work-compaction-memory.ts';
import { redactSecrets } from '../extensions/redact.ts';

const facts = [
  { claim: 'Human approval is required.', status: 'decision', sources: ['saved:1'] },
  { claim: 'The stale-bid test remains unverified.', status: 'uncertain', sources: ['saved:2'] },
];
const previous = { checkpoint: 'Await approval; stale-bid test remains unverified.', knowledge: facts };
const previousSummary = coreText([]) + JSON.stringify(previous);
const usage = { input: 100, output: 20, totalTokens: 120, cost: { total: 0.03, totalFromProvider: true } };
async function run(outcome, overrides = {}) {
  const calls = [];
  const result = await compactMemory({ messages: [], previousSummary, limit: 8000,
    model: 'test/summary', currentModel: 'test/current', redact: text => redactSecrets(text, Infinity),
    registry: {
      find: (provider, id) => ({ provider, id, contextWindow: 200_000 }),
      streamSimple(model, context, options) {
        calls.push({ model, task: context.messages[0].content[0].text, options });
        return { result: async () => {
          const value = typeof outcome === 'function' ? outcome(options) : outcome;
          if (value instanceof Error) throw value;
          return { usage, stopReason: 'stop', content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], ...(value?.stopReason ? value : {}) };
        } };
      },
    }, ...overrides,
  });
  return { result, calls };
}
function sized(size) {
  const draft = structuredClone(previous);
  draft.checkpoint += ' '.repeat(size - JSON.stringify(draft).length);
  return draft;
}
// Exact former boundary and recorded failure sizes: accept without truncating or regenerating.
for (const size of [8001, 8000, 11413, 17000]) {
  const { result, calls } = await run(sized(size));
  assert.equal(calls.length, 1, 'valid oversized checkpoint must use one model call total');
  assert.equal(result.mode, 'hybrid', 'valid oversized checkpoint must be accepted');
  assert.equal(result.model, 'test/summary');
  assert.equal(decodeMemory(result.summary).tail, JSON.stringify(sized(size)));
  assert.deepEqual(result.knowledge, facts);
  assert.equal(result.usage.totalTokens, usage.totalTokens);
  assert.deepEqual(result.usage.cost, usage.cost);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].rejectedResponse, undefined);
  assert(calls[0].options.signal instanceof AbortSignal);
  assert.equal(calls[0].options.cacheRetention, 'none');
  assert.match(calls[0].task, /Target 8000 characters/);
  assert.doesNotMatch(calls[0].task, /hard maximum/);
}
for (const failure of ['not JSON', { checkpoint: '', knowledge: [] },
  { checkpoint: 'x', knowledge: [{ ...facts[0], sources: ['invented'] }] },
  { checkpoint: 'x', knowledge: [{ ...facts[0], status: 'verified' }] },
  new Error('Provider unavailable'),
  ...['length', 'aborted', 'toolUse', 'error'].map(stopReason => ({ stopReason, content: [{ type: 'text', text: JSON.stringify(previous) }] }))]) {
  const { result, calls } = await run(failure);
  assert.equal(calls.length, 1, 'invalid output must not trigger another model call');
  assert.equal(result.mode, 'fallback');
  assert.equal(decodeMemory(result.summary).tail, JSON.stringify(previous));
  assert.deepEqual(result.knowledge, []);
  assert.equal(result.attempts.length, 1);
  assert(result.attempts[0].error);
  if (!(failure instanceof Error)) assert(result.attempts[0].rejectedResponse);
}
const controller = new AbortController();
await assert.rejects(run(() => { controller.abort(); return previous; }, { signal: controller.signal }), /cancelled/);
const secret = await run('not JSON: token=diagnostic-secret-value');
assert.doesNotMatch(JSON.stringify(secret.result), /diagnostic-secret-value/);
assert.match(secret.result.attempts[0].rejectedResponse.text, /\[REDACTED\]/);
// Exercise the actual caller without unrelated context hooks: success is silent; local fallback warns.
const source = readFileSync(new URL('../extensions/work-models.ts', import.meta.url), 'utf8');
const start = source.indexOf('async function compactSessionMemory(');
const end = source.indexOf('\nfunction agentHandoff(', start);
assert(start >= 0 && end > start);
const notices = [];
let recovery = (await run(sized(11413))).result;
const notify = vm.runInNewContext(`(${source.slice(start, end)})`, {
  compactionModelSettings: () => ({ model: 'test/summary', thinking: 'low' }),
  effectiveSummaryChars: () => 8000, filesFromOps: () => ({ modified: [] }),
  knowledgeBlockForContext: () => '', COMPACTION_PROFILES: { FREEFORM: 'freeform' },
  agentHandoff: () => '', latestCompactionNote: () => '', asArray: value => value ?? [],
  NONE_MODEL: 'none', INHERIT_MODEL: 'inherit', currentModelId: () => 'test/current',
  compactMemory: async () => recovery,
});
const ctx = { ui: { notify: message => notices.push(message) } };
await notify(ctx, {}, { profile: 'freeform' }, {}, []);
assert.equal(notices.length, 0);
recovery = (await run('not JSON')).result;
await notify(ctx, {}, { profile: 'freeform' }, {}, []);
assert.match(notices.at(-1), /preserved-memory fallback/);
console.log('ok - one compaction call, soft size target, exact output, validation, fallback, cancellation and notifications');
