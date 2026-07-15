# Themed Calculator Requirements

## Goal

Build a dependency-free responsive calculator with reliable arithmetic, keyboard support, accessible controls, and persistent light/dark themes.

## Requirements

- Support digits, decimal, four arithmetic operators, equals, clear, sign, chaining, and recoverable division-by-zero behavior.
- Pointer and keyboard paths must expose the same operations without uncaught console errors.
- Label controls, show focus, and support keyboard activation.
- Persist the theme under `calculator-theme` and restore it after reload.
- Remain usable and capture a full-page PNG at 390 by 844 CSS pixels.
- Implement and verify behavior/keyboard and theme/accessibility/presentation as separate slices.

## Success

All interactions pass browser acceptance, theme persists after reload, accessibility basics pass, and exact-viewport screenshot evidence is retained.
