#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyCsvProject } from '../../workflow-evaluation/v1/projects/csv-expenses/acceptance/verify.mjs';

export async function verify(root) {
  const temp = mkdtempSync(path.join(tmpdir(), 'continuity-v2-grade-'));
  const checks = [];
  const check = (name, fn) => {
    try { fn(); checks.push({ name, passed: true }); }
    catch (error) { checks.push({ name, passed: false, error: String(error.message).slice(0, 1500) }); }
  };
  const input = path.join(temp, 'input.csv'), output = path.join(temp, 'report.txt');
  const put = (file, value) => writeFileSync(file, value);
  const run = (text, args = []) => {
    put(input, text);
    return spawnSync(process.execPath, [path.join(root, 'src/analyze.mjs'), input, output, ...args], { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 100000 });
  };
  const json = () => JSON.parse(readFileSync(output, 'utf8'));
  const csv = 'date,category,amount\n2026-01-01,Food,0.10\n2026-02-02,food,0.20\n2026-02-03,Travel,2.00\n';
  try {
    check('original-interface', () => {
      const original = verifyCsvProject(root);
      assert(original.passed, JSON.stringify(original.gates.filter(x => !x.passed)));
    });
    check('exact-json', () => {
      assert.equal(run(csv, ['--format', 'json']).status, 0);
      assert.deepEqual(json(), { version: 1, currency: 'USD', groups: [{ category: 'Food', cents: 30 }, { category: 'Travel', cents: 200 }], totalCents: 230, rows: 3 });
    });
    check('quoted-csv', () => {
      assert.equal(run('date,category,amount\r\n2024-02-29,"Meals, ""bad""",1.00\r\n', ['--format', 'json']).status, 0);
      assert.equal(json().groups[0].category, 'Meals, "bad"');
    });
    check('multiline-category', () => {
      assert.equal(run('date,category,amount\n2024-02-29,"Meals\nOffice",1.00\n').status, 0);
      assert.equal(readFileSync(output, 'utf8'), 'Meals\\nOffice: 1.00\nTotal: 1.00\nRows: 1\n');
    });
    check('inclusive-filter', () => {
      assert.equal(run(csv, ['--from', '2026-02-02', '--to', '2026-02-02', '--category', ' FOOD ', '--format', 'json']).status, 0);
      assert.equal(json().totalCents, 20); assert.equal(json().rows, 1);
    });
    check('monthly-group', () => {
      assert.equal(run(csv, ['--group', 'month', '--format', 'json']).status, 0);
      assert.deepEqual(json().groups, [{ category: '2026-01', cents: 10 }, { category: '2026-02', cents: 220 }]);
    });
    const aliases = path.join(temp, 'aliases.json');
    const budgets = path.join(temp, 'budgets.json');
    const extra = path.join(temp, 'extra.csv');
    check('one-step-alias-filter', () => {
      put(aliases, '{"food":"Dining","Dining":"Other"}');
      assert.equal(run(csv, ['--aliases', aliases, '--category', 'dining', '--format', 'json']).status, 0);
      assert.deepEqual(json().groups, [{ category: 'Dining', cents: 30 }]);
    });
    check('cross-file-dedupe-before-alias', () => {
      put(aliases, '{"Food":"Shared","Travel":"Shared"}');
      put(extra, 'date,category,amount\n2026-01-01,food,0.10\n2026-01-01,Travel,0.10\n');
      assert.equal(run(csv, ['--input', extra, '--aliases', aliases, '--dedupe', '--format', 'json']).status, 0);
      assert.equal(json().rows, 4); assert.equal(json().totalCents, 240);
    });
    check('budget-combination', () => {
      put(budgets, '{"2026-01":"0.10","2026-02":"2.19"}');
      assert.equal(run(csv, ['--group', 'month', '--budget', budgets, '--format', 'json']).status, 0);
      assert.deepEqual(json().overBudget, ['2026-02']);
      assert.equal(run(csv, ['--group', 'month', '--budget', budgets]).status, 0);
      assert(readFileSync(output, 'utf8').endsWith('Rows: 3\nOver budget: 2026-02\n'));
    });
    check('prototype-key-is-data', () => {
      put(aliases, '{"__proto__":"Mapped"}');
      assert.equal(run('date,category,amount\n2026-01-01,__proto__,1.00\n', ['--aliases', aliases, '--format', 'json']).status, 0);
      assert.deepEqual(json().groups, [{ category: 'Mapped', cents: 100 }]);
    });
    const failure = (name, text, args = [], status = 2) => check(name, () => {
      put(output, 'PREVIOUS GOOD REPORT\n');
      const result = run(text, args);
      assert.equal(result.status, status, result.stderr);
      assert.equal(readFileSync(output, 'utf8'), 'PREVIOUS GOOD REPORT\n');
      assert.equal(result.stderr.trim().split(/\r?\n/).length, 1);
      assert(result.stderr.trim());
    });
    failure('excluded-corruption-still-fails', csv + '2020-01-01,Food,NaN\n', ['--from', '2026-01-01']);
    failure('invalid-gregorian-date', 'date,category,amount\n2025-02-29,Food,1\n');
    failure('money-overflow', 'date,category,amount\n2026-01-01,A,90071992547409.91\n2026-01-02,B,0.01\n');
    failure('unterminated-quote', 'date,category,amount\n2026-01-01,"Food,1\n');
    failure('reject-unknown-option', csv, ['--unknown']);
    failure('reject-reversed-dates', csv, ['--from', '2026-02-01', '--to', '2026-01-01']);
    put(aliases, '{"Food":"A"," food ":"B"}');
    failure('alias-normalized-duplicate', csv, ['--aliases', aliases]);
    put(budgets, '{"Food":1}');
    failure('budget-requires-money-string', csv, ['--budget', budgets]);
    put(extra, 'date,category,amount\n2026-01-01,Oops,-1\n');
    failure('late-file-error-atomic', csv, ['--input', extra]);
    failure('missing-config-io-error', csv, ['--aliases', path.join(temp, 'missing.json')], 1);
    check('same-path-preserved', () => {
      put(input, csv);
      const result = spawnSync(process.execPath, [path.join(root, 'src/analyze.mjs'), input, input], { cwd: root, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 1); assert.equal(readFileSync(input, 'utf8'), csv);
    });
    check('same-extra-input-preserved', () => {
      put(output, csv);
      const result = run(csv, ['--input', output]);
      assert.equal(result.status, 1); assert.equal(readFileSync(output, 'utf8'), csv);
    });
    check('absent-output-stays-absent', () => {
      rmSync(output, { force: true });
      assert.equal(run('bad-header\n').status, 2); assert(!existsSync(output));
    });
    try {
      const { parseCsv } = await import(pathToFileURL(path.join(root, 'src/csv.mjs')).href);
      const source = 'a,b,c\r\n1,"x,y\n\"\"z\"\"",3\r\n';
      for (let split = 1; split < source.length; split++) {
        async function* chunks() { yield source.slice(0, split); yield source.slice(split); }
        const rows = [];
        for await (const row of parseCsv(chunks())) rows.push(row);
        assert.deepEqual(rows, [['a', 'b', 'c'], ['1', 'x,y\n"z"', '3']]);
      }
      checks.push({ name: 'stream-chunk-boundaries', passed: true });
    } catch (error) { checks.push({ name: 'stream-chunk-boundaries', passed: false, error: String(error.message) }); }
    return { passed: checks.every(c => c.passed), checks };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await verify(path.resolve(process.argv[2] ?? '.'));
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) { process.stderr.write(String(error.stack ?? error)); process.exitCode = 1; }
}
