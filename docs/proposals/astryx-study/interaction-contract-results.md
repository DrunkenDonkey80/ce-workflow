# P3-07 interaction contract

Verified 2026-11-11 on Windows, Chromium through the installed agent-browser. No downloads or paid generation.

- `node --no-warnings docs/proposals/astryx-study/probes/input-contract.mjs`: passes twice consecutively. HTTP-served opaque DESIGN_CSP iframe, production bridge; same 820×1180 viewport with trusted mouse versus touch. Observed child capability changes and 28px versus 44px targets; Tab/Shift-Tab containment, Escape/focus return, native validation, native date parsing/validity, failed Save with draft retention, Retry, Cancel, reduced-motion style and reachable 44px actions at 360×360. Fixture assets are inline; parent/child interaction-window network tracing sees no external requests.
- `node --no-warnings scripts/test-work-design.mjs`: PASS, 61.2s. Includes shared fixture target-height checks for fine/coarse pointers and guide coverage. Existing settled-image and Mark regressions remain green.
- `node --no-warnings hub/scripts/test-browser.mjs --keep-browser`: PASS, 161.5s; browser closed afterward. Real hub-served opaque frame validates keyboard focus, Escape, Save validation/retry/draft retention, Cancel and focus return. Existing modal pins/comments, popovers, Mark and deck checks remain green.
- `node --no-warnings hub/scripts/test-explore.mjs`: PASS, 9.1s.
- `node --no-warnings hub/scripts/test-api.mjs`: PASS, 16.7s; existing absent temporary Pi SDK warning remains.
- Active LSP batch over five changed files: no reported errors, one confirmed clean and four unconfirmed (one timed out, three silent/push-only). This is not a clean bill of health.

## Red-to-green evidence

The first harness sent emulation to the parent only. A diagnostic run found an isolated child target; after enabling touch, parent capability was coarse/touch=1 while the child stayed fine/touch=0. Sending emulation to both targets fixes this test-setup error, without changing production sandbox policy or disabling isolation.

A trusted mouse click initially landed on the parent after resize (parent pointer counter=1; child modal remained closed). Waiting two animation frames before the fixture replies with its rectangles makes the click land in the child (parent counter=0; modal open, focused and active element inside). The counter and capability assertions remain; no retries, sleeps or focus-emulation override hide the failures. One read-only oracle advised; parent independently reproduced both causes and validated the fix.

## Limits

Chromium emulation is not Safari, real touch hardware, assistive technology, an OS date-picker interaction or arbitrary generated-app accessibility coverage. Those claims are not made; P3-16 retains hardware/Safari verification.
