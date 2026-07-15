# CSV Expense Analyzer Implementation Plan

## Slice 1: Parse and validate

Create `src/analyze.mjs` argument and CSV parsing with exact-header, ISO-date, category, and decimal validation. Add focused tests for valid, empty, header-only, and malformed files. The command must remove any output before reporting validation failure.

Verification: parser tests prove malformed rows exit 2 and leave no output.

## Slice 2: Aggregate and render

Group categories case-insensitively while preserving first spelling, sort categories, format money, and atomically write the report. Add tests for repeated categories, decimal totals, output ordering, missing input, and output errors.

Verification: `node --test` passes and the hidden acceptance command matches the exact report fixture.
