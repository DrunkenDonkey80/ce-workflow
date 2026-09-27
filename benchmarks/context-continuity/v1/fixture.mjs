import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

// Phases 1–3 preserve the Calculator Lite contracts from the accepted GLM pilot.
export const plan = `# Calculator continuity task

Implement the six phases below in order. After each phase, call bench_check with
that phase number, fix failures, and continue without waiting for another user
prompt. Finish only after phase 6 passes. Preserve previous behavior. No packages,
network, eval, Function, or imports outside this workspace. Use calculator.mjs,
index.html, and app.mjs. PLAN.md is read-only. Tools are read, write, edit,
bench_check, and bench_probe; bench_check runs the tests, no shell is needed.
You may keep working notes. Do not modify the benchmark harness or its evidence.

## Phase 1: expression evaluator and compatibility discovery
- Before implementation, call bench_probe with transport="legacy". Follow its
  response to discover the current compatibility contract. Findings are needed
  again in phases 4 and 6. The probe remains available throughout the task.
- Export evaluate(expression) from calculator.mjs. Support decimals, unary minus,
  parentheses, and + - * / with normal precedence. Division by zero must throw
  Error("Division by zero"). Reject invalid expressions; do not evaluate code.
- Provide a minimal working index.html and app.mjs browser calculator.

## Phase 2: calculator state
- Export Calculator. Constructor accepts { historyLimit = 5 }.
- press(key) accepts digits, decimal point, + - * /, Enter, Escape, Backspace.
- display is a string. Enter evaluates and records { expression, result }
  newest-first. History is capped exactly at historyLimit; limit zero is valid.
- After a result, an operator continues from it; a digit starts a new expression.

## Phase 3: memory
- memory starts at zero. Add memoryClear(), memoryRecall(), memoryAdd(),
  memorySubtract(). Add/subtract use the current displayed value.
- press accepts MC, MR, M+, M-, routing to those methods. Recall sets display
  and permits normal continuation. Browser controls use those exact data-key
  values. Preserve memory through Escape.

## Phase 4: snapshots using the discovered contract
- Calculator.toSnapshot() returns a JSON string, with exactly these keys:
  schema, display, memory, historyLimit, history. Use the schema discovered in
  phase 1. Preserve all state and newest-first history, without references to
  live mutable objects. No private evaluator flags in the JSON.
- Calculator.fromSnapshot(json) returns a new Calculator restoring these fields.
- Snapshot a displayed result and allow an operator to continue from it afterward.

## Phase 5: independent batch evaluations
- Export evaluateBatch(expressions). Return one { expression, result, error }
  record per input in the same order. Success: result is number, error is null.
  Failure: result is null, error is the Error.message string. Do not stop on a
  failed expression or change any Calculator instance. Preserve evaluator rules.

## Phase 6: safe restore, bounds, and full regression
- Add Calculator.prototype.restoreSnapshot(json). Apply the compatibility
  contract for invalid input discovered in phase 1: reject malformed JSON, wrong
  schema, unknown keys, non-string display, non-finite memory, non-integer or
  negative historyLimit, excess history, or malformed history records.
- A history record has exactly expression (string) and result (finite number).
- Invalid restore must throw and leave ALL prior state unchanged. fromSnapshot
  must use the same validation. A valid restore replaces state and returns this.
- Fix any earlier regressions, including zero history capacity, then pass phase 6.
`;

export const compatibility = {
  schema: "calc-lite/3",
  unknownKeys: "reject",
  invalidImport: "throw without changing any prior state",
  historyOrder: "newest-first",
  zeroHistoryCapacity: "valid",
};

export async function grade(cwd, phase) {
  const { evaluate, Calculator, evaluateBatch } = await import(pathToFileURL(path.join(cwd, "calculator.mjs")).href + `?check=${Date.now()}`);
  const source = readFileSync(path.join(cwd, "calculator.mjs"), "utf8");
  assert.doesNotMatch(source, /\beval\s*\(|\bFunction\s*\(/);
  assert.equal(evaluate("2+3*4"), 14);
  assert.equal(evaluate("-(2.5+1.5)*2"), -8);
  assert.equal(evaluate("10/(2+3)"), 2);
  assert.throws(() => evaluate("8/0"), /Division by zero/);
  assert.throws(() => evaluate("not arithmetic"));
  const html = readFileSync(path.join(cwd, "index.html"), "utf8");
  assert(readFileSync(path.join(cwd, "app.mjs"), "utf8").length > 0);
  const press = (c, keys) => { for (const key of keys) c.press(key); };
  if (phase >= 2) {
    const c = new Calculator({ historyLimit: 2 });
    press(c, ["1", "2", "+", "3", "Enter"]);
    assert.equal(c.display, "15");
    assert.deepEqual(c.history[0], { expression: "12+3", result: 15 });
    press(c, ["+", "5", "Enter"]);
    assert.equal(c.display, "20");
    press(c, ["7", "*", "2", "Enter"]);
    assert.equal(c.display, "14");
    assert.deepEqual(c.history.map(item => item.result), [14, 20]);
    press(c, ["Escape", "9", "Backspace"]);
    assert.equal(c.display, "0");
  }
  if (phase >= 3) {
    const c = new Calculator();
    for (const name of ["memoryClear", "memoryRecall", "memoryAdd", "memorySubtract"])
      assert.equal(typeof c[name], "function");
    press(c, ["8", "M+", "Escape", "2", "M-", "Escape", "MR"]);
    assert.equal(c.display, "6");
    press(c, ["+", "4", "Enter"]);
    assert.equal(c.display, "10");
    c.press("MC");
    assert.equal(c.memory, 0);
    for (const key of ["MC", "MR", "M+", "M-"])
      assert(html.includes(`data-key="${key}"`) || html.includes(`data-key='${key}'`), `missing ${key} browser control`);
  }
  if (phase >= 4) {
    const c = new Calculator({ historyLimit: 2 });
    press(c, ["8", "M+", "Escape", "2", "+", "3", "Enter"]);
    const wire = c.toSnapshot();
    assert.equal(typeof wire, "string");
    assert.deepEqual(JSON.parse(wire), { schema: compatibility.schema, display: "5", memory: 8, historyLimit: 2, history: [{ expression: "2+3", result: 5 }] });
    const d = Calculator.fromSnapshot(wire);
    assert.equal(d.toSnapshot(), wire);
    press(d, ["+", "4", "Enter"]);
    assert.equal(d.display, "9");
    assert.equal(c.toSnapshot(), wire, "restored instance must not alias original state");
  }
  if (phase >= 5) {
    assert.deepEqual(evaluateBatch(["2+3*4", "8/0", "-(2.5+1.5)*2"]), [
      { expression: "2+3*4", result: 14, error: null },
      { expression: "8/0", result: null, error: "Division by zero" },
      { expression: "-(2.5+1.5)*2", result: -8, error: null },
    ]);
    assert.deepEqual(evaluateBatch([]), []);
  }
  if (phase >= 6) {
    const c = new Calculator({ historyLimit: 0 });
    press(c, ["9", "Enter", "M+"]);
    assert.deepEqual(c.history, []);
    const wire = c.toSnapshot();
    const valid = JSON.parse(wire);
    const invalid = ["{", "null", ...[
      { ...valid, schema: "calc-lite/1" }, { ...valid, extra: true },
      { ...valid, display: 9 }, { ...valid, memory: null },
      { ...valid, historyLimit: -1 }, { ...valid, historyLimit: 1.5 },
      { ...valid, history: [{ expression: "9", result: 9 }] },
      { ...valid, historyLimit: 1, history: [{ expression: "9", result: "9" }] },
      { ...valid, historyLimit: 1, history: [{ expression: "9", result: 9, extra: true }] },
    ].map(JSON.stringify)];
    for (const input of invalid) {
      assert.throws(() => c.restoreSnapshot(input), `must reject ${input}`);
      assert.equal(c.toSnapshot(), wire, "invalid restore mutated prior state");
      assert.throws(() => Calculator.fromSnapshot(input));
    }
    const d = new Calculator();
    assert.equal(d.restoreSnapshot(wire), d);
    assert.deepEqual(JSON.parse(d.toSnapshot()), valid);
  }
  return { phase, passed: true };
}

if (process.argv[2] === "--grade") {
  try { console.log(JSON.stringify(await grade(process.argv[3], Number(process.argv[4])))); }
  catch (error) { console.log(JSON.stringify({ passed: false, error: error.message })); process.exitCode = 1; }
}
