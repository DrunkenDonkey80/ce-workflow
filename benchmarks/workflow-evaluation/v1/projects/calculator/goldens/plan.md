# Themed Calculator Implementation Plan

## Slice 1: Behavior and keyboard

Implement calculator state in `app.js` for digits, decimals, sign, four operators, equals, clear, chained operations, and recoverable division by zero. Bind buttons and keyboard through one action dispatcher. Verify pointer and keyboard arithmetic plus error recovery.

## Slice 2: Theme, accessibility, and presentation

Build the semantic button grid and display, accessible labels, visible focus, responsive CSS, theme tokens, and persisted theme toggle. Verify reload persistence, console cleanliness, keyboard activation, and a full-page screenshot at 390 by 844.

Verification: run the hidden browser acceptance adapter and retain its structured results and screenshot reference.
