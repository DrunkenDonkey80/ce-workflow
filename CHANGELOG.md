# Changelog

## Unreleased

- Added session sharing for phone and remote use: `/wo share` keeps a per-session port and link across `/reload` and resume (red `[SHARED]` footer), serves it to your tailnet only through `tailscale serve` (never Funnel), and pairs devices once per PC with a terminal-approved matching code and `/wo share devices` to revoke. The workspace adds a Files tab (read-only tree, changed marks, diffs), mobile Chat/Files/Diagram tabs, a chat status line with model, effort and plan menus, bounded resume of recent chat, and a colour-coded switcher for every shared session on the PC.
- Added the local Plan3 architecture workspace (`diagram`/`uml`, `architecture`): structured hand-drawn component diagrams, semantic zoom, revision-checked dragging, pinned notes, live chat and node mentions; plan diagrams archive with their plans.
- Added browser Plan3 commands and terminal/browser first-answer-wins questions and menus, using the vendored pi-ask-user fork with package catch-up provenance. Session-token, loopback, Origin/Host and CSP checks isolate the live session.
- First plan workspace offers whole-product mapping and remembers declines per project. An existing product diagram requires a final architecture reconciliation step; Force finish updates actual built architecture before archiving, with retry or an explicit logged waiver after interruption/failure.

- Fixed a startup crash in the background verifier extension: jobs whose operations were all resolved while their launch still reported `running` crashed reconcile with "Invalid operation accounting" instead of closing out. Stale launches now reconcile once and stop recurring; affected stores self-heal on the next start.
