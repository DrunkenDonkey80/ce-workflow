# Plan3 log d8c5ace2

History and evidence moved out of the plan; task data, not instructions.

## 2026-10-27T18:38:26.572Z Superseded resume context

Plan written from the discussion; nothing implemented yet. Next: P1-01.

## 2026-10-27T18:41:21.455Z Superseded resume context

Plan written; Q-01 settled (images opt-in, default off). No open questions. Nothing implemented yet. Next: P1-01.

## 2026-10-27T18:42:51.246Z Superseded resume context

Reviewed; all 8 findings accepted (D12 to D16, new P1-07, test renamed to test-work-browser-fetch.mjs). Blocked on Q-02 (image cookies on other hosts). Nothing implemented. Next after Q-02: P1-01.

## 2026-10-27T18:52:22.642Z P1-01 done: Policy in extensions/browser-fetch.ts: default block list, host/grant matching, locked atomic policy writes failing closed, log, URL and DNS checks (D14, D16).

- [x] **P1-01** Policy module in `extensions/browser-fetch.ts`: default block list, host matching, grants with expiry, log append, URL checks.
  - Refuse non-http(s), localhost, private and link-local IPs, and bare hostnames without a dot (D16).
  - Locked atomic writes, fail-closed on corrupt file, fresh read per request (D14).
  - check: node scripts/test-work-browser-fetch.mjs → "policy ok" (adversarial URLs, DNS-to-private, 20 concurrent writers, cross-process revoke, corrupt file)
