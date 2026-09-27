# Expense analyzer: a long maintenance task

Deliver a dependency-free local Node.js expense analysis CLI from the existing seed. Finish the whole plan autonomously in this session. This is a realistic coding workload, not a token-filling exercise: never print large files, repeat tests, or generate filler merely to lengthen the run. Stop when the product is complete, even if the context threshold has not been reached. No network, packages, delegation, Git operations, or changes outside this disposable workspace. PLAN.md and .pi are read-only. Use read/write/edit for files; bench_test runs your test suite or external acceptance. Return your final report as the final answer, not an external output file.

Work through the milestones in order, testing as you go. Ordinary working notes are allowed but no mandatory checkpoint format or injected next-phase cursor exists. Add real regression tests under test/; bench_test(suite="tests") runs the existing package's node --test command. bench_test(suite="acceptance") runs immutable external CLI checks; it never edits your code or advances a phase. The seed's test/analyze.test.mjs deliberately calls assert.fail as a scaffold marker: replace that placeholder with real tests. Do not weaken real tests you have established. Keep a brief record of actual test evidence, failed approaches, and unfinished work. Finish by running both suites and checking every requirement against the code. Report remaining gaps honestly.

## Permanent compatibility requirements

The original interface remains `node src/analyze.mjs <input.csv> <report.txt>`. Default input schema is exactly `date,category,amount`. Default reports contain case-insensitively sorted category lines, followed by `Total: <money>` and `Rows: <count>`, each line ending in LF. Category merging is case-insensitive, preserving the first spelling. Empty and header-only input produce `Total: 0.00\nRows: 0\n`. A malformed row means exit 2 and exactly one useful diagnostic on stderr. I/O failures mean exit 1. Never publish a partial report. No dependencies, eval, or Function constructors.

Important early product decision: the old draft said "delete output before parsing". That approach was rejected because it destroys a user's last good report. Preserve existing output bytes on every failure; when no output existed, leave no report on failure. Use a sibling temporary file and atomic rename on success, with cleanup on errors. Input and output resolving to the same path is an I/O error; leave input untouched. This decision still applies to JSON, streaming, budget, and multi-file modes later in this plan.

## 1. Repair the seed and establish compatibility

Read the seed, run its tests, and implement parser/validation and aggregation/report modules rather than mixing everything in the CLI. Pass existing acceptance before adding optional features. Use real Gregorian dates (leap years included), trimmed non-empty categories, and non-negative decimal amounts with at most two fractional digits. A UTF-8 BOM and LF/CRLF are accepted. Blank lines are ignored. Header names/order must be exact. Diagnostics name the logical row. Preserve existing package/test behavior.

## 2. Exact money and deterministic ordering

Parse money as integer cents, never accumulating floating-point currency. Require every amount and aggregate to remain within Number.MAX_SAFE_INTEGER cents. Reject signs, exponent notation, NaN, Infinity, surrounding amount whitespace, and more than two decimals. Format two decimals in reports. Sort normalized categories by code-point order (not machine locale); use the first trimmed spelling as label. Add regression tests for 0.10 + 0.20, zero, maximum safe cents, and overflow across rows.

## 3. A real CSV parser

Support quoted fields, embedded commas, doubled quotes, and embedded newlines in quoted categories. Accept CRLF across chunk boundaries. Reject unterminated quotes, quotes inside unquoted cells, text after closing quotes except comma/newline, and wrong column count. Embedded newlines are represented as escaped \\n in text labels, with backslashes escaped first and CR escaped as \\r. JSON preserves the actual category characters. Do not just split on commas or physical lines. Test trailing newlines and EOF immediately after a closing quote.

## 4. Atomic publication and error taxonomy

Implement the permanent no-data-loss contract for existing and absent targets. Validate CLI arguments before touching output. Missing input, output directory, missing output parent, identical input/output, or failed writes are exit 1; malformed CSV/data is exit 2. Usage/unknown option errors are exit 2. No stack trace or success chatter. A late malformed record must not replace the last good report. Exercise both success and failure with temporary directories in tests.

## 5. Filters without hiding corrupt data

Add `--from YYYY-MM-DD`, `--to YYYY-MM-DD`, and repeatable `--category NAME` after the two positional paths. Dates are inclusive; category matching is trimmed/case-insensitive and multiple category options are ORed. Reject invalid bounds or from > to. Parse and validate EVERY input record before filtering it: an excluded corrupt record still fails the command. Rows counts selected records only. Empty selection is a valid empty report.

## 6. Structured output

Add `--format text|json` (default text). JSON is exactly `{ "version": 1, "currency": "USD", "groups": [{"category": "Food", "cents": 123}], "totalCents": 123, "rows": 1 }`, with groups in the same deterministic order. No extra keys. JSON numbers represent integer cents. End JSON with LF. Retain the same atomic failure behavior. Add tests that parse the JSON, not just snapshot whitespace.

## 7. Monthly grouping

Add `--group category|month` (default category). Monthly groups use YYYY-MM as their category label, ascending, and sum selected rows by month. Keep the same text and JSON schema. Group boundaries come from validated civil dates, not the host timezone. Test December/January, leap day, filters, and empty groups.

## 8. Immutable category aliases

Add `--aliases PATH`, a UTF-8 JSON object mapping source category names to canonical labels, e.g. {"groceries":"Food","cafe":"Food"}. Keys and values must be non-empty strings after trimming; keys are matched case-insensitively, with normalized duplicate keys rejected. Reject non-object/array/null/empty values and non-string values with exit 2. Missing alias file is exit 1. Apply one mapping step ONLY (no chaining); do not mutate the map. Aliases apply before category filters and grouping. Rows not in the map keep their original category. Report canonical values using their trimmed spelling.

## 9. Deterministic de-duplication

Add `--dedupe` to count an identical (date, normalized ORIGINAL category, cents) tuple once across all inputs. Without this flag every row counts. Alias merging is not deduplication: distinct original categories mapped to the same alias must remain distinct. Keep first occurrence order for label selection. Validate every duplicate row normally. Document that the dedupe set is O(unique rows), and keep it opt-in.

## 10. Multiple files as one transaction

Add repeatable `--input PATH` after positional paths. Process the positional input first, then extra files in option order. Every file has its own header and logical row numbers; errors identify the source filename. Aggregate, filter, alias, and dedupe across the combined stream. A failure in the last input preserves an existing report. No partial per-file publication. Reject output matching ANY input, not only the first.

## 11. Bounded input streaming

Refactor file reading to incremental UTF-8 decoding and CSV parsing; do not read entire CSV files or accumulate all records. Keep one logical record plus aggregates (and optional dedupe set) in memory. A quoted record may span chunks. Use the same parser semantics in unit tests and CLI. Expose `parseCsv(chunks)` from `src/csv.mjs` as an async generator accepting an async iterable of decoded strings and yielding arrays of cells; it includes the header and ignores blank logical rows. Splitting a Unicode scalar is the file decoder's job. Test splitting every character boundary in a small quoted sample and running a large real generated input with a bounded number of categories. Do not print the large input.

## 12. Budget reporting

Add `--budget PATH`, a JSON object mapping normalized final group labels to non-negative decimal money STRINGS. Use the same strict exact-money rules, reject normalized duplicate keys and non-string values. Missing file is exit 1, malformed config exit 2. Only groups present in the selected report are evaluated. Add JSON key `overBudget` ONLY when a budget file was requested; it is an ordered array of group labels whose sum strictly exceeds their matching limit (equal is not over). In text mode append `Over budget: <escaped-label>` lines AFTER Rows, in group order. Still write a successful report and exit 0; this is advisory, not an error. Monthly grouping can have YYYY-MM budget keys. Budget/config errors preserve prior output.

## 13. Integration and adversarial regression pass

Test cross-feature combinations, not only happy paths: alias -> filter -> month grouping -> budgets; dedupe across files; corrupt excluded rows; bad alias/budget types; quoted multiline category; invalid date after many valid rows; safe-integer overflow after aggregation; same output as an extra input; existing output after each error class. Ensure config strings such as '__proto__' are treated as data, not prototype assignments. Failure of an async stream must close file handles and clean temporary files. No unhandled rejection or partial report. Preserve all original default-interface acceptance tests.

## 14. Operator documentation and final verification

README.md must describe invocation, exact output schemas, exit codes, atomic replacement, all options, inclusive filters, one-step aliases, original-category dedupe identity, streaming memory limits, and reproducible local test commands. Record benchmark-discovered workflow friction separately from product bugs in NOTES.md, grounded in actual events rather than guesses. Run both suites, inspect the final source tree for accidental dependencies and dead code, and give a concise completion report with tests and any limitations. Do not change the harness, lower the context threshold, force compaction, or keep working merely to consume the time budget.
