import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { compactMemory, coreText, decodeMemory, gather } from '../extensions/work-compaction-memory.ts';
import { redactSecrets } from '../extensions/redact.ts';

const max = 10553; // The recorded Rewrite failure: a valid checkpoint missed this limit by 261 characters.
const messages = [
  { role: 'user', content: 'Keep human approval and do not mark unverified tests passed.' },
  { role: 'toolResult', toolName: 'bash', content: 'ORIGINAL-TRANSCRIPT-ONLY '.repeat(150) },
];
const facts = [
  { claim: 'Human approval is required.', status: 'decision', sources: ['saved:1'] },
  { claim: 'The stale-bid test remains unverified.', status: 'uncertain', sources: ['saved:2'] },
];
const checkpoint = 'Await approval; stale-bid test remains unverified.';
const previousSummary = coreText([]) + JSON.stringify({ checkpoint, knowledge: facts });
const generation = createHash('sha256').update(JSON.stringify(messages)).digest('hex').slice(0, 16);
const limit = coreText(gather(messages, [], generation)).length + max;
const draft = (size) => {
  const value = { checkpoint, knowledge: facts };
  value.checkpoint += ' '.repeat(size - JSON.stringify(value).length);
  assert.equal(JSON.stringify(value).length, size);
  return value;
};
const usage = { input: 100, output: 20, totalTokens: 120, cost: { total: 0.03, totalFromProvider: true } };
async function run(outcomes, overrides = {}) {
  const calls = [];
  const result = await compactMemory({ messages, previousSummary, limit, model: 'test/summary', currentModel: 'test/current',
    redact: text => redactSecrets(text, Infinity), ...overrides,
    registry: {
      find: (provider, id) => ({ provider, id, contextWindow: 200_000 }),
      streamSimple(selected, context, options) {
        const call = { model: selected.id, task: context.messages[0].content[0].text, options };
        calls.push(call);
        assert(calls.length <= outcomes.length, 'repair must not make an unbounded extra request');
        return { result: async () => {
          let outcome = outcomes[calls.length - 1];
          if (typeof outcome === 'function') outcome = await outcome(call);
          if (outcome instanceof Error) throw outcome;
          if (outcome?.stopReason) return { usage, ...outcome };
          return { content: [{ type: 'text', text: typeof outcome === 'string' ? outcome : JSON.stringify(outcome) }], stopReason: 'stop', usage };
        } };
      },
    },
  });
  return { result, calls };
}
const small = { checkpoint, knowledge: facts };
const repaired = await run([draft(max + 261), small]);
assert.deepEqual(repaired.calls.map(c => c.model), ['summary', 'summary'], 'size-only failure must shorten on the same model before fallback');
assert.equal(repaired.result.mode, 'hybrid');
assert.equal(repaired.result.model, 'test/summary');
assert.deepEqual(repaired.result.attempts.map(a => Boolean(a.repair)), [false, true]);
assert.match(repaired.result.attempts[0].error, /10814 > 10553/);
assert.equal(repaired.result.attempts[0].rejectedResponse.text, JSON.stringify(draft(max + 261)));
assert.equal(repaired.result.attempts[1].rejectedResponse, undefined);
assert.equal(repaired.result.usage.input, 200);
assert.equal(repaired.result.usage.output, 40);
assert.equal(repaired.result.usage.cost.total, 0.06);
assert.equal(repaired.result.usage.cost.totalFromProvider, true);
assert.deepEqual(repaired.result.knowledge, facts, 'decisions and uncertainty survive the repair');
assert.equal(decodeMemory(repaired.result.summary).tail, JSON.stringify(small));
assert.match(repaired.result.summary, /Keep human approval/);
const task = repaired.calls[1].task;
assert.match(task, /10814/);
assert.match(task, /10553/);
assert.match(task, /Target 7914 characters/);
assert.match(task, /untrusted/);
assert.match(task, /uncertainty/);
assert.match(task, /decisions/);
assert.match(task, /sources/);
assert.doesNotMatch(task, /ORIGINAL-TRANSCRIPT-ONLY/);
assert(repaired.calls[1].options.signal instanceof AbortSignal);
assert.equal(repaired.calls[1].options.cacheRetention, 'none');

// The exact limit is accepted; one character over gets one repair, with the same limit afterward.
assert.equal((await run([draft(max)])).calls.length, 1);
assert.equal((await run([draft(max + 1), draft(max)])).result.mode, 'hybrid');
const stillLarge = await run([draft(max + 1), draft(max + 1), small]);
assert.deepEqual(stillLarge.calls.map(c => c.model), ['summary', 'summary', 'current']);
assert(stillLarge.result.attempts[1].error);
assert.equal(stillLarge.result.usage.output, 60);
const allLarge = await run([draft(max + 1), draft(max + 1), draft(max + 1)]);
assert.equal(allLarge.result.mode, 'fallback');
assert.equal(allLarge.calls.length, 3, 'only one repair is allowed across both models');
assert.equal(decodeMemory(allLarge.result.summary).tail, JSON.stringify(small), 'failure retains the previous checkpoint');
assert.equal(allLarge.result.attempts.filter(a => a.repair).length, 1);

// Repair is for validated size errors, never malformed JSON, unknown citations or provider errors.
for (const failure of ['not JSON', { checkpoint: '', knowledge: [] },
  { checkpoint, knowledge: [{ ...facts[0], sources: ['invented'] }] },
  new Error('Memory budget exceeded: provider error, not our validator')]) {
  const r = await run([failure, small]);
  assert.deepEqual(r.calls.map(c => c.model), ['summary', 'current']);
  assert(!r.result.attempts.some(a => a.repair));
}
for (const stopReason of ['length', 'aborted', 'toolUse', 'error']) {
  const r = await run([{ stopReason, content: [{ type: 'text', text: JSON.stringify(draft(max + 1)) }] }, small]);
  assert.deepEqual(r.calls.map(c => c.model), ['summary', 'current'], `${stopReason} is not a size-only rejection`);
}
for (const failure of ['not JSON', new Error('Repair provider unavailable')]) {
  const r = await run([draft(max + 1), failure, small]);
  assert.deepEqual(r.calls.map(c => c.model), ['summary', 'summary', 'current']);
  assert.equal(r.result.mode, 'hybrid');
}
// Repair cannot drop facts or change their status/citations, even to another known citation.
for (const knowledge of [facts.slice(0, 1), [{ ...facts[0], sources: ['invented'] }, facts[1]],
  [facts[0], { ...facts[1], status: 'observed' }], [{ ...facts[0], sources: ['saved:2'] }, facts[1]]]) {
  const r = await run([draft(max + 1), { checkpoint, knowledge }, small]);
  assert.deepEqual(r.calls.map(c => c.model), ['summary', 'summary', 'current'], 'repair must reject changed fact metadata before falling back');
  assert(r.result.attempts[1].error, 'invalid repair must not be accepted');
}
const same = await run([draft(max + 1), draft(max + 1)], { currentModel: 'test/summary' });
assert.equal(same.result.mode, 'fallback');
assert.equal(same.calls.length, 2);
const fallbackRepair = await run(['not JSON', draft(max + 1), small]);
assert.deepEqual(fallbackRepair.calls.map(c => c.model), ['summary', 'current', 'current']);
assert.equal(fallbackRepair.result.mode, 'hybrid');

const controller = new AbortController();
await assert.rejects(run([draft(max + 1), ({ options }) => {
  controller.abort();
  assert(options.signal.aborted);
  return small;
}], { signal: controller.signal }), /cancelled/, 'cancelling repair never falls through to another model');
const secret = draft(max + 100);
secret.checkpoint = secret.checkpoint.replace(' '.repeat(26), ' token=diagnostic-secret-x ');
const redacted = await run([secret, small]);
assert.doesNotMatch(redacted.calls[1].task, /diagnostic-secret-x/);
assert.doesNotMatch(JSON.stringify(redacted.result.attempts), /diagnostic-secret-x/);
// Exercise the caller's actual notification path independently of unrelated context-hook tests.
const source = readFileSync(new URL('../extensions/work-models.ts', import.meta.url), 'utf8');
const start = source.indexOf('async function compactSessionMemory(');
const end = source.indexOf('\nfunction agentHandoff(', start);
assert(start >= 0 && end > start);
const notices = [];
let recovery = repaired.result;
const notify = vm.runInNewContext(`(${source.slice(start, end)})`, {
  compactionModelSettings: () => ({ model: 'test/summary', thinking: 'low' }),
  effectiveSummaryChars: () => limit, filesFromOps: () => ({ modified: [] }),
  knowledgeBlockForContext: () => '', COMPACTION_PROFILES: { FREEFORM: 'freeform' },
  agentHandoff: () => '', latestCompactionNote: () => '', asArray: value => value ?? [],
  NONE_MODEL: 'none', INHERIT_MODEL: 'inherit', currentModelId: () => 'test/current',
  compactMemory: async () => recovery,
});
const ctx = { ui: { notify: message => notices.push(message) } };
await notify(ctx, {}, { profile: 'freeform' }, {}, []);
assert.match(notices.at(-1), /shortened its checkpoint with test\/summary/);
assert.doesNotMatch(notices.at(-1), /current model/);
recovery = stillLarge.result;
await notify(ctx, {}, { profile: 'freeform' }, {}, []);
assert.match(notices.at(-1), /current model test\/current/);
recovery = allLarge.result;
await notify(ctx, {}, { profile: 'freeform' }, {}, []);
assert.match(notices.at(-1), /preserved-memory fallback/);
console.log('ok - compaction size repair, exact boundaries, bounded fallback, metadata/cost, cancellation, citations, preserved evidence and notifications');
