#!/usr/bin/env node
// Offline diagnostics only. Never loads the live extension, calls a model, or edits a session.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { contentText, contextFilterCutIndex, formatCompactionSummary } from '../../extensions/work-compaction.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
const text = message => contentText(message.content);
const user = content => ({ role: 'user', content });
const assistant = content => ({ role: 'assistant', content });
const pair = (id, name, args, content, isError = false) => [
  assistant([{ type: 'toolCall', id, name, arguments: args }]),
  { role: 'toolResult', toolCallId: id, toolName: name, content, isError },
];
const format = (messages, previousSummary = '') => formatCompactionSummary({
  preparation: { messagesToSummarize: messages, previousSummary },
  currentMessages: messages,
});

function unwrapRequest(value) {
  // Match only the captured transport envelope, never arbitrary "continue" messages.
  return value.replace(/^Task: You are reviving a previous subagent conversation\.\r?\n\r?\nOriginal run: [^\r\n]+\r?\nOriginal agent: [^\r\n]+\r?\nOriginal session file: [^\r\n]+\r?\n\r?\nUse the stored session context as background\. Answer the orchestrator's follow-up below\. Do not assume the original child session is still running\.\r?\n\r?\nFollow-up:\r?\n/, '');
}

function excerpt(value, limit = 1800) {
  const full = String(value ?? '');
  if (full.length <= limit) return { text: full };
  const marker = '\n[excerpt: recover full output from the source]\n';
  const side = Math.floor((limit - marker.length) / 2);
  return { text: full.slice(0, side) + marker + full.slice(-side), omittedChars: full.length - 2 * side, sha256: hash(full) };
}

// An evidence INPUT for a possible LLM, NOT a finished summary or semantic merge.
// Full user text survives here. Under a real input budget, overflow must be explicit;
// this diagnostic does not silently clip instructions or pretend to resolve conflicts.
function gather(messages, previous = [], generation = 'capture') {
  const records = [...previous];
  const calls = new Map();
  for (const message of messages)
    for (const part of Array.isArray(message.content) ? message.content : [])
      if (part.type === 'toolCall') calls.set(part.id, part);
  for (const [index, message] of messages.entries()) {
    const source = `${generation}:${index}`;
    if (records.some(record => record.source === source)) continue;
    const value = text(message);
    if (message.role === 'user' && value) {
      records.push({ source, kind: 'user-request', text: unwrapRequest(value) });
    } else if (message.role === 'assistant' && value) {
      records.push({ source, kind: 'assistant-claim-not-verification', text: value });
    } else if (message.role === 'toolResult') {
      const call = calls.get(message.toolCallId);
      const tool = message.toolName ?? call?.name;
      const failed = Boolean(message.isError || message.error);
      const args = ['read', 'write', 'edit'].includes(tool)
        ? Object.fromEntries(['path', 'offset', 'limit'].filter(key => call?.arguments?.[key] !== undefined).map(key => [key, call.arguments[key]]))
        : call?.arguments;
      const record = { source, kind: 'tool-result', tool, arguments: args, failed };
      if (['read', 'write', 'edit'].includes(tool) && !failed) {
        records.push({ ...record, kind: 'file-reference', result: 'Tool reported success; source contents omitted, not summarized.' });
      } else if (tool === 'bench_test') {
        let parsed;
        try { parsed = JSON.parse(value); } catch { /* Keep unrecognized/truncated output verbatim below. */ }
        if (parsed?.type === 'check' && typeof parsed.passed === 'boolean') {
          const counts = Object.fromEntries([...String(parsed.stdout).matchAll(/^[ℹ#]\s+(tests|pass|fail)\s+(\d+)\s*$/gm)].map(match => [match[1], Number(match[2])]));
          records.push({ ...record, kind: 'observed-check', suite: parsed.suite, passed: parsed.passed, status: parsed.status, counts,
            ...(parsed.passed ? {} : { stdout: excerpt(parsed.stdout), stderr: excerpt(parsed.stderr) }),
            scope: 'Historical result at this source, not verification of subsequent changes.' });
        } else if (!Array.isArray(parsed)) records.push({ ...record,
          ...(typeof message.details?.passed === 'boolean' ? { passed: message.details.passed } : {}), result: excerpt(value) });
        // A successful inventory is recoverable from disk; no need for its full listing.
      } else if (value || failed) records.push({ ...record, result: excerpt(value) });
    }
  }
  return records;
}

function qualityCases(background) {
  const cases = [];
  const record = (name, messages, probe, generations = 1) => {
    let summary = '', packet = [];
    const rounds = [];
    for (let generation = 0; generation < generations; generation++) {
      // Later generations receive ONLY the previous compacted state and new evidence.
      // Replaying original instructions here would conceal cumulative retention loss.
      const delta = generation === 0 ? messages : [assistant(`Maintenance checkpoint ${generation}; no new user decision.`)];
      summary = format(delta, summary);
      packet = gather(delta, packet, `${name}:${generation}`);
      rounds.push({ generation: generation + 1, production: probe(summary), evidenceInput: probe(JSON.stringify(packet)), summaryChars: summary.length });
    }
    cases.push({ name, rounds, summary, packet });
  };
  record('early-user-constraint', [user('USER-CORE: never publish a partial report.'), ...background], value => value.includes('USER-CORE'), 5);
  record('approved-decision', [...background, ...pair('approved', 'ask_user', { question: 'Choose rollout' }, 'DECISION-CORE: user selected safe rollout; keep atomic replacement.')], value => value.includes('DECISION-CORE'), 5);
  record('markdown-in-user-request', [...background, user('Implement compatibility.\n## Compatibility\nMARKDOWN-CORE: preserve CRLF behavior.')], value => value.includes('MARKDOWN-CORE'), 5);
  const long = 'Preserve these product requirements:\n' + 'Maintain compatibility and validate inputs.\n'.repeat(65)
    + 'MIDDLE-CORE: never round monetary values through floating point.\n' + 'Keep error handling and atomic replacement.\n'.repeat(65);
  record('middle-of-long-request', [...background, user(long)], value => value.includes('MIDDLE-CORE'));
  const noise = Array.from({ length: 12 }, (_, i) => pair(`read-${i}`, 'read', { path: `src/part-${i}.mjs` }, 'readable source')).flat();
  record('semantic-test-failure', [...background, ...pair('failed-test', 'bench_test', { suite: 'tests' }, JSON.stringify({ type: 'check', suite: 'tests', passed: false, status: 1, stdout: 'FAILURE-CORE: late CSV error is row 1, expected row 3', stderr: '' })), ...noise], value => value.includes('FAILURE-CORE'));
  record('revised-instruction', [...background, user('REVISION-OLD: output CSV only.'), user('REVISION-NEW: replace the CSV-only requirement; output JSON only. Keep atomic publication.')], value => value.includes('REVISION-NEW'), 5);
  record('transport-envelope', background, value => !value.includes('You are reviving a previous subagent conversation'));
  record('structured-suite-identity', pair('known-check', 'bench_test', { suite: 'tests' }, JSON.stringify({ type: 'check', suite: 'tests', passed: true, status: 0, stdout: 'ℹ tests 126\nℹ pass 126\nℹ fail 0\n', stderr: '' })), value => value.includes('126') && value.includes('tests'));
  return cases;
}

function selfTest() {
  const source = [...pair('read-a', 'read', { path: 'src/a.mjs' }, 'FILE-PAYLOAD-NOT-NEEDED'),
    assistant([{ type: 'thinking', thinking: 'PRIVATE-REASONING' }]), user('NEVER-DROP-USER'),
    ...pair('fail-a', 'edit', { path: 'src/a.mjs', edits: [{ oldText: 'OLD-SOURCE-PAYLOAD', newText: 'NEW-SOURCE-PAYLOAD' }] }, 'UNRESOLVED-FAILURE', true)];
  const frozen = JSON.stringify(source);
  const packet = gather(source);
  assert.equal(JSON.stringify(source), frozen);
  assert.equal(JSON.stringify(gather(source, packet)), JSON.stringify(packet), 'same source cannot be duplicated');
  assert(!JSON.stringify(packet).includes('FILE-PAYLOAD-NOT-NEEDED'));
  assert(!JSON.stringify(packet).includes('PRIVATE-REASONING'));
  assert(!JSON.stringify(packet).includes('SOURCE-PAYLOAD'));
  const longOutput = 'begin ' + 'x'.repeat(4000) + ' end';
  assert(excerpt(longOutput).omittedChars > 0);
  assert.equal(excerpt(longOutput).sha256, hash(longOutput));
  assert(excerpt(longOutput).text.length <= 1800);
  assert(JSON.stringify(packet).includes('NEVER-DROP-USER'));
  assert(packet.some(r => r.tool === 'edit' && r.failed === true && r.kind === 'tool-result'));
  const updated = gather([user('New instruction: allow a local commit but no push.')], packet, 'later');
  assert(JSON.stringify(updated).includes('NEVER-DROP-USER'));
  assert.equal(unwrapRequest('Follow-up:\nOrdinary user text.'), 'Follow-up:\nOrdinary user text.');
  const cases = qualityCases([user('Build the original CLI and retain compatibility.')]);
  assert.equal(cases.length, 8);
  assert(cases.every(c => c.rounds.every(r => r.evidenceInput)), 'evidence gathering must not discard the fixture facts');
  console.log('ok - offline replay harness: no input mutation, provenance, incremental carry, failure visibility, no reasoning/file payload replay');
}

async function replay(root, output) {
  const resultPath = path.join(root, 'result.json');
  const resultSource = readFileSync(resultPath, 'utf8');
  const result = JSON.parse(resultSource);
  const eventSource = readFileSync(path.join(root, 'events.jsonl'), 'utf8');
  const events = eventSource.trim().split(/\r?\n/).map(JSON.parse);
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const config = manifest.settings.workOrchestrator.context;
  const formatterSource = readFileSync(new URL('../../extensions/work-compaction.ts', import.meta.url));
  assert.equal(hash(formatterSource), manifest.hashes['extensions/work-compaction.ts'], 'Replay requires the captured formatter version');
  // Same SDK session projection used by scripts/audit-payload-strip.mjs.
  let globalRoot;
  try { globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim(); }
  catch { globalRoot = path.join(process.env.APPDATA ?? '', 'npm', 'node_modules'); }
  const pi = await import(pathToFileURL(path.join(globalRoot, '@earendil-works/pi-coding-agent/dist/index.js')));
  const sessionSource = readFileSync(result.session, 'utf8');
  const entries = pi.parseSessionEntries(sessionSource);
  const captures = [];
  for (const event of events.filter(e => e.type === 'cut')) {
    const nextAssistant = entries.find(e => e.type === 'message' && e.message?.role === 'assistant' && Date.parse(e.timestamp) >= event.at);
    assert(nextAssistant?.parentId, 'Cannot find the request following the observed cut');
    const messages = pi.buildSessionContext(entries, nextAssistant.parentId).messages;
    const cut = contextFilterCutIndex(messages, config.keepRecentTokens, config.keepRecentTokens);
    assert(cut, 'No cut reconstructed');
    const removed = messages.slice(0, cut);
    const previousSummary = removed.findLast(m => m.role === 'compactionSummary')?.summary;
    const summary = formatCompactionSummary({ preparation: { messagesToSummarize: removed, previousSummary }, currentMessages: messages, maxSummaryChars: config.maxSummaryChars });
    assert.equal(summary, event.summary, 'Historical reconstruction differs: do not call an approximate replay exact');
    const packet = gather(removed);
    captures.push({ at: event.at, exact: true, requestParentId: nextAssistant.parentId, messages: messages.length, removedMessages: removed.length,
      keptMessages: messages.length - cut, summaryChars: summary.length, summaryBytes: Buffer.byteLength(summary),
      packetChars: JSON.stringify(packet).length, summary, packet, qualityCases: qualityCases(removed) });
  }
  assert(captures.length, 'No recorded cuts to replay');
  const report = {
    scope: 'Offline exact historical replay plus adversarial synthetic mutations. No LLM calls. Evidence packets are unbounded diagnostic inputs, NOT validated summaries or a production memory policy. Presence checks do not establish comprehension, semantic conflict resolution, or end-to-end improvement.',
    source: { root, session: result.session, sessionSha256: hash(sessionSource), eventsSha256: hash(eventSource), formatterSha256: hash(formatterSource) },
    captures,
  };
  // Refuse existing destinations: never overwrite captured evidence or an earlier report.
  mkdirSync(output);
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  for (const [i, capture] of captures.entries()) {
    writeFileSync(path.join(output, `cut-${i + 1}-production.md`), capture.summary + '\n');
    writeFileSync(path.join(output, `cut-${i + 1}-evidence-input.json`), JSON.stringify(capture.packet, null, 2) + '\n');
  }
  assert.equal(readFileSync(result.session, 'utf8'), sessionSource, 'Session changed during replay');
  assert.equal(readFileSync(path.join(root, 'events.jsonl'), 'utf8'), eventSource, 'Capture changed during replay');
  assert.equal(readFileSync(resultPath, 'utf8'), resultSource, 'Result changed during replay');
  console.log(JSON.stringify({ output, captures: captures.map(c => ({ exact: c.exact, summaryChars: c.summaryChars, summaryBytes: c.summaryBytes, packetChars: c.packetChars, checks: c.qualityCases.map(q => ({ name: q.name, production: q.rounds.map(r => r.production), evidenceInput: q.rounds.map(r => r.evidenceInput) })) })) }, null, 2));
}

export { gather, format, user, assistant, pair };

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) try {
  const [mode, root, output] = process.argv.slice(2);
  if (mode === '--self-test') selfTest();
  else if (mode === '--replay' && root && output) await replay(path.resolve(root), path.resolve(output));
  else throw new Error('Usage: --self-test | --replay <captured-experiment-root> <new-output-directory>');
} catch (error) { console.error(error.stack ?? error); process.exitCode = 1; }
