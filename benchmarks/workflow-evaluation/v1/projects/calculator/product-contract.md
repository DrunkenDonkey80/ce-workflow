# Themed Calculator Contract V1

Build a dependency-free single-page calculator in `index.html`, `app.js`, and `styles.css`.

- Support digits, decimal, add, subtract, multiply, divide, equals, clear, and sign toggle through pointer and keyboard input.
- Chained operations evaluate left-to-right. Division by zero shows `Error`; the next digit or clear recovers without an uncaught error.
- Every interactive control has an accessible name, keyboard activation, and visible focus.
- A labeled theme toggle switches light/dark CSS tokens and stores the choice in `localStorage` under `calculator-theme`; reload restores it.
- The page remains usable at 390 by 844 CSS pixels and produces a full-page PNG screenshot at that exact viewport.
- Browser console errors, missing screenshots, wrong viewport, or missing persistence fail acceptance.
- Work is split into behavior/keyboard and theme/accessibility/presentation slices.
