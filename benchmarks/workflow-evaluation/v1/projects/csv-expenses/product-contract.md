# CSV Expense Analyzer Contract V1

The CLI is invoked as `node src/analyze.mjs <input.csv> <report.txt>`.

- Input must have exactly the header `date,category,amount`.
- Dates use `YYYY-MM-DD`; categories are trimmed and non-empty; amounts are finite non-negative decimals with at most two fractional digits.
- Empty and header-only files are valid and produce an empty report.
- Any malformed row fails the whole command with exit code 2, writes one diagnostic to stderr, and leaves no report file.
- Missing or unreadable input and unwritable output fail with exit code 1 and no partial report.
- Successful reports sort categories case-insensitively, format money with two decimals, and end with category lines followed by `Total: <amount>` and `Rows: <count>`.
- No dependencies are allowed. Work must be split into parser/validation and aggregation/report slices, with tests for each.
