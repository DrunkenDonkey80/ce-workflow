# CSV Expense Analyzer Requirements

## Goal

Build a dependency-free Node.js CLI that validates expense CSV input and writes a deterministic category summary.

## Requirements

- Invoke as `node src/analyze.mjs <input.csv> <report.txt>`.
- Accept only `date,category,amount`; validate ISO dates, non-empty trimmed categories, and non-negative two-decimal amounts.
- Fail malformed rows atomically with exit 2; fail I/O with exit 1.
- Group categories case-insensitively, preserve first spelling, sort deterministically, and format two-decimal totals.
- Support empty/header-only inputs.
- Implement and verify parser and report slices separately using Node built-ins.

## Success

Valid fixtures match exact reports; invalid input leaves no partial output; tests pass without dependency installation.
