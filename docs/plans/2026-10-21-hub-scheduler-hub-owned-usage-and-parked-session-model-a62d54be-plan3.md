---
plan3: true
status: ready
created: 2026-10-21
updated: 2026-10-21T11:59:56.527Z
reviewed: 2026-10-21
---

# Hub scheduler, hub-owned usage and parked-session model

## Original request

User requests, in order (2026-10-21):

> soo can we make a scheduler too that you can fire one off timer or periodic ones? it will be new state of the stuff, not working actively but not idle either, we have to define some light gray? dunno, in case of parked session that needs to wake at specific time it will be unparked and sent that message, compaction rules apply i.e. compact before sending if cache expired etc

> lets remove that compact before sending message, assume always yes. as for the check we can have 2 variants indeed - a llm message that spends a turn, which is valid for some tasks if it needs to analyze with llm periodically some stuff, or preferable - a command/script to run that can result either to continue monitoring, cancel the timer or an llm message that will be sent, this way the agent will wake up when needed. command/script based ticks will not resume parked session, only if real message is needed there.

> (on the agent's three proposals) 1. agreed 2. agreed 3. agreed

> also lets add something else - current usage comes from some status line. can we instead move that whole thing into the hub, so it always returns the current usage regardless of the parked state of the session. we dont need the statusline in the ce-wf anymore - if it means duplicating code, it can go alongside the settings for it and the hub to return nice structured json data for you to display. also remember the model parked session had so you know what you will be typing to, now it is a guess, also can change it even if parked - will be used when unparked. also unpark automatically when starting typing in the edit box, if possible that is

Origin: the user asked an agent to "run a timer every few minutes to check"; Pi has no between-turn timer, so the agent kept one turn open and polled.

## Goal, requirements, and non-goals

Goal: hub sessions can be woken on a schedule or by a cheap script check, and the hub (not a live session) owns usage data and each session's model, so parked sessions show correct information.

Requirements:
- **Timers per hub session:** one-off (in N minutes or at a time) and repeating (every N minutes), each with list and cancel.
- **Message timer:** each tick sends a fixed message to the agent (a full model turn). For checks that need the model's judgement.
- **Script timer (preferred):** each tick the hub runs a command; the agent is only involved when the command asks for it. Protocol (user agreed):
  - exit 0 with no output: keep watching;
  - printed output: becomes the message to the agent, and the timer ends (the agent sets a new one if it wants);
  - exit code 3: cancel the timer silently;
  - 3 failures in a row (other non-zero exits, timeouts): send the error to the agent and stop.
- Script ticks never resume a parked session; only a message that must be delivered resumes it.
- A delivered message to a parked session resumes it first, then sends; cold-cache compaction applies automatically (shipped in 0.1.58, see Decisions).
- **New session state "scheduled":** an idle session with a pending timer shows a light-grey row with a clock countdown, e.g. "⏰ 3:40" (user agreed).
- **Usage in the hub:** the hub reads Claude and Codex usage itself and returns structured JSON whether or not any session is live. The web page displays it from there.
- ce-workflow's terminal usage status line goes away; its settings move to the hub alongside the moved code.
- **Parked model:** the hub remembers each session's model and thinking level, shows them for parked sessions, and lets the user change them while parked; the change is applied when the session resumes.
- **Unpark on typing:** typing in a parked session's chat box resumes it automatically, so it is (nearly) ready when the message is sent.

Non-goals:
- Timers for terminal Pi windows outside the hub (the hub cannot send to them).
- Starting new sessions from a timer; timers only target existing hub sessions.
- A general cron or calendar UI; the agent sets timers through a tool, the page only shows and cancels them.

## Decisions

- **D1 Cold-cache compaction is automatic** (user, 2026-10-21: "remove that compact before sending message, assume always yes"). Done in ce-workflow 0.1.58 (commit 7d29a6d): `compactColdCache` in extensions/work-models.ts compacts without asking for interactive and rpc (hub and web) messages; our own resend is source "extension", so it never loops. Scheduled sends go through the same path.
  - Correction (review, 2026-10-21, verified in code): 0.1.58 covers terminal and direct rpc prompts only. Hub page messages reach Pi as the /pi-hub command and are then resent by plan3-web.ts line 42 through pi.sendUserMessage (source "extension"), which compactColdCache skips (work-models.ts line 2228). So hub and web messages are not compacted yet; S-14 fixes that path, and scheduled sends use it.
- **D2 Two timer kinds, script preferred** (user). Rationale: a message tick is a full model turn; past the 5-minute cache lifetime each tick re-reads the whole context uncached. A script tick costs no tokens.
- **D3 Script protocol and failure rule** as listed in Requirements (agent proposal, user agreed 1 and 2).
- **D4 "Scheduled" state with countdown** (agent proposal, user agreed 3).
- **D5 Script ticks never resume parked sessions** (user).
- **D6 The terminal usage status line is removed from ce-workflow** (user: "we dont need the statusline in the ce-wf anymore"). Accepted drawback: a terminal Pi window, or a PC without the hub running, shows no Claude or Codex usage in its footer.
- **D7 Usage code moves, not duplicated** (user: "if it means duplicating code, it can go alongside the settings for it"): the fetch and pool-reading logic moves from extensions/subscription-footer.ts into the hub with its settings.
- Agent proposals the user has not contradicted (not separately confirmed):
  - Timers persist in the hub data folder and survive a hub restart; a one-off timer that came due while the hub was down fires once on start.
  - A message tick is skipped while the session is busy, so repeats never stack; a one-off message waits and is delivered as a follow-up.
  - Script commands run in the session's folder through the platform shell, with a per-tick timeout of 60 s; output is trimmed and capped (for example 4 KB) before it becomes a message.
  - The agent sets timers with a ce-workflow `schedule` tool that calls the hub CLI; outside the hub (`PI_HUB` unset) the tool refuses with a clear message.
- **D8 Repeating-timer limits** (user chose the recommended limits, Q-01): minimum interval 1 minute for both kinds; message timers need an end (until a time or a maximum run count, default 12 runs); script timers stop after 24 hours unless renewed.
- **D9 Claude pool actions run without a session** (user, Q-02: "Everything in the hub"). User constraint: controlling Claude accounts is global, not per session; the hub must not edit claudeex's files directly, and pi-provider-claude-ex must keep working on its own in a plain Pi process. How the hub calls it is Q-05.
- **D10 Parked model list = Pi settings' scoped models** (user, Q-03: "Settings scoped models only"). The hub reads enabledModels from Pi's settings for parked sessions. Agent addition (error handling, not scope): if the stored model fails to apply on resume, the chat says so and the session keeps its previous model.
- **D11 Timer ticks show in the session row only** (user, Q-04): countdown and last-run time in the row; the chat shows only delivered scheduled messages, marked as scheduled.
- **D12 The hub calls claudeex through new cpool commands** (user, Q-05): "cpool view --json" and "cpool action <act> <label> [value] --json", thin wrappers over poolView and poolAction, run by the hub as a separate process from claudeex's package folder. The hub never imports claudeex code or edits its files.
  - Why ce-workflow has pool code today (user asked): plan3.ts is the hub's bridge inside each Pi. The hub page's Claude accounts window calls /api/pool, and the hub forwards it to a live session (plan3.ts HUB_CALLS and HUB_READS, lines 2041-2043); that session asks claudeex over the claude-pool:web event (line 762). Plan3 itself never uses the pool. After D12 the hub answers /api/pool itself, and this bridge code is removed from plan3.ts (S-08).
- **D13 The hub runs cpool daemon while it runs** (user, Q-06), and stops it on exit. Verified: claudeex sessions skip their own background sweep while a daemon is alive (pi-provider-claude-ex index.ts line 134, if (!daemonAlive())), so the daemon is the single refresher and sessions do not double-poll.
- **D14 Codex and other usage credentials come from Pi's SDK ModelRegistry in the hub** (user, Q-07). Refresh and auth.json handling stay Pi's own. Unverified: that ModelRegistry refreshes an expired Codex token and locks auth.json like a running Pi; S-07 starts with a short probe, and if it fails the plan comes back for a decision.
- **D15 Timers follow the conversation** (user, Q-08): bound to the Pi session id; /new and unstar cancel that session's timers, with a note on the page; opening the session in a terminal pauses them (script ticks keep running, deliveries wait) until the hub gets it back.
  - Clarified for the user: /new keeps the same hub entry, place and name, and only swaps in a fresh conversation (hub/src/sessions.ts newSession keeps the record id and updates only sessionFile). That matches the user's expectation, so the plan does not change /new. Timers are cancelled because they were set for the old conversation's work.
  - Unstar is the session menu's remove from the sidebar: it deletes the hub entry and keeps the Pi session file, so the session goes back to Recents (hub/src/api.ts lines 132-134, D18 of the hub plan). A session with timers is gone from the hub, so its timers go too.

## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

- hub/src/hub.ts, hub/src/api.ts, hub/src/registry.ts, hub/src/cli.ts: session host, page API, session records, `pi-hub` CLI (already has `parked` and `wake`). New: hub/src/scheduler.ts, hub/src/usage.ts.
- hub/web/app.ts: session rows, status bar usage, model picker, chat box.
- extensions/subscription-footer.ts (1436 lines): today's usage polling (Codex every 120 s, Claude every 30 min, leader and follower lock across Pi processes, pool reads, backoff). Source of the Codex usage code to move; then deleted from ce-workflow with its settings and wiring.
- extensions/plan3.ts lines 762-848: today calls claudeex poolView and poolAction inside a live session for /api/pool; replaced by the hub call (D12).
- C:/SOFT/git/pi-provider-claude-ex (separate repo, user-owned): commands.ts poolView and poolAction, bin/cpool.ts CLI with cross-process locks, pool.ts daemonAlive and runDaemon.
- extensions/hub-command.ts: `hubCli()` bridge used by the new `schedule` tool; `intercomParkedSessions` already resumes parked sessions for intercom.
- extensions/hub-channel.ts: `hubActive()` (`PI_HUB=1`).
- Approach for the model (revised after review): the hub stores model and thinking level per session record from get_state of every live session (at start, after each model or thinking change, and when a terminal hands the session back), independent of an open page. For a session never live under this hub it builds them branch-aware with the Pi SDK (SessionManager plus buildSessionContext, exported by @earendil-works/pi-coding-agent), not a last-line scan; registry.ts readSessionSummary (lines 105-127) exposes neither today. The parked picker resolves enabledModels with the SDK resolveModelScope against ModelRegistry (patterns can be globs and carry thinking suffixes); models only an extension provides cannot resolve there and are shown unavailable. With no scoped models or none resolvable, the picker shows only the stored model and says so; it never falls back to all models (D10).
- Approach for unpark on typing: the first keystroke in a parked session's chat box calls the resume endpoint once (debounced). Every delivery (page send, scheduler, intercom wake) awaits one shared per-session readiness promise in hub/src/sessions.ts (S-15), because resume() returns early once the child is in the live map, before get_state finishes (sessions.ts lines 108-143).

## Phases

### Phase 1: Hub scheduler core [code]
- [x] **S-01** hub/src/scheduler.ts: persisted timers (timers.json), 5 s tick in hub.ts, message/script kinds with D3 protocol, D8 limits, D15 lifecycle checked per tick, follow-up delivery to busy agents.
- [x] **S-14** Hub/web page messages now run cold-cache compaction: plan3-web emits wo:cold-cache, work-models startColdCompact compacts and resends once (source extension, never re-checked).
- [x] **S-15** Live.ready in hub/src/sessions.ts: resume, prompt and call wait for the one start; api.ts call() resumes through it; a failed start rejects every waiter.
- [x] **S-02** `pi-hub schedule add|list|cancel` (session from --session or PI_HUB_SESSION, now set for hub-started Pi) over new hub routes /api/sessions/<id>/timers and /api/timers/<id>/cancel; timerInput validates the body.
- [x] **S-03** hub/scripts/test-scheduler.mjs: fake clock + fake-pi; validation, D5 no-resume, output wake, exit 3, failure rule/reset, busy skip, follow-up, D15 terminal/new/unstar, persistence, real runScript.

### Phase 2: Agent tool and page state [code]
- [x] **S-04** `schedule` tool (hub-command.ts scheduleTool: add/list/cancel via `pi-hub schedule`), registered only when PI_HUB_SESSION is set; execute still refuses without it.
- [x] **S-05** Hub "scheduled" tone (idle live session with timers), row timers list with a 1 s "⏰ m:ss" countdown (tooltip: kind, label, last run), Cancel ⏰ items in the session menu via session action cancel-timer (own session only).
- [ ] **S-06** Mark delivered scheduled messages in the chat; tests (C1, C2).

### Phase 3: Usage owned by the hub [code]
- [ ] **S-07** Move usage fetching and pool reading into hub/src/usage.ts with its settings; serve /api/usage from the hub itself.
  - Credentials come from Pi SDK ModelRegistry in the hub (D14), verified first with a short refresh probe; today they come from a live session (subscription-footer.ts lines 1152-1158).
  - Keep identity-bound cache invalidation and secret-free JSON; test with no Pi children, expired credentials, logout and account switch.
  - Keep the existing backoff and poll intervals; the hub is the single poller, so the cross-process lock goes away.
- [ ] **S-13** In pi-provider-claude-ex: add cpool view --json and cpool action (D12), with a test; claudeex still works without the hub.
  - Make cpool daemon exclusive: a second daemon refuses to start (runDaemon in pool.ts line 736 takes no lock today).
  - The hub stops only a daemon it started; test an existing standalone daemon, hub restart and daemon failure.
- [ ] **S-08** Point hub/web/app.ts usage bars and windows at the hub endpoint; serve the pool through cpool.
  - Pool view and actions through cpool (D12); remove the /api/pool bridge from plan3.ts.
  - Start and stop cpool daemon with the hub (D13).
- [ ] **S-09** Remove subscription-footer.ts and its settings and wiring from ce-workflow; update README and tests (C2).
  - Move extensions/subscription-footer-UPSTREAM.md (MIT notice, required by scripts/verify-package.mjs line 53) with the code to the hub and update that check.
  - Migrate the parser, backoff and security tests for the moved code instead of deleting them.

### Phase 4: Parked model and unpark on typing [code]
- [ ] **S-10** Store model and thinking level per hub session; show them for parked sessions; model list from Pi settings scoped models (D10).
  - Branch-aware reading and scope resolution as in Relevant files and approach; test divergent branches, globs, thinking suffixes and unresolvable models.
- [ ] **S-11** Allow changing model and thinking while parked; apply on resume through RPC before the first message.
  - Applied inside the S-15 readiness promise, so no message can arrive first.
- [ ] **S-12** Resume a parked session on the first keystroke in its chat box (debounced, once); tests (C1).

### Phase 5: Live check [think]
- [ ] **H-01** On the real hub: a script timer that waits for a file, a one-off message to a parked session, usage with all sessions parked, a parked model change, typing to unpark.
### P-ARCH [code] Product architecture

- [ ] **ARCH-RECONCILE** Reconcile the product architecture diagram with this plan's actual changes.
  - Compare actual code and git history; update through plan3_diagram target product, or mark done with no architecture change.
  - Changed plan elements: none flagged; inspect actual implementation.


## Backlog

- Timers that target terminal Pi windows through intercom.
- A page UI for creating timers by hand.

## Global validation

- C1: `npm test` from hub/ (runs node --test "scripts/test-*.mjs", hub/package.json line 15).
- C2: targeted ce-workflow scripts for touched code, e.g. `node scripts/test-work-hub-command.mjs`; run with `PI_HUB` unset (inside a hub session the variable leaks into hand-run tests).
- Before push only: `npm run verify:quiet` (known unrelated failure: test-work-screen-read.mjs crashes in the android CLI while two Android devices are attached).
- Acceptance: with every session parked, the page shows current usage and each session's model; a script timer resumes nothing until its command prints; a message timer to a parked session resumes it and the reply arrives.

## Resume context

Draft, no open questions. D14 (Codex credentials via Pi SDK ModelRegistry; S-07 probes refresh first) and D15 (timers follow the Pi session id: cancel on /new and unstar, pause in terminal) settled 2026-10-21. Known gap fixed by S-14: 0.1.58 does not compact hub or web messages yet. No product code written for this plan. Next: the user runs /plan3 finish.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
- 2026-10-21: Added S-13 after S-07: D9 (user, Q-02): pool actions must run without a session and without the hub editing claudeex files; needs a small claudeex change.
- 2026-10-21: Added S-14, S-15 after S-01: Plan review 2026-10-21: findings 1 and 2 (verified in plan3-web.ts line 42, work-models.ts line 2228, sessions.ts lines 108-143).
- 2026-10-21 review (plan3-advisor, Astra; each finding checked against the code):
  - 1 accepted: hub and web sends skip cold-cache compaction (plan3-web.ts line 42 resends with source extension; work-models.ts line 2228 skips it). D1 note corrected, S-14 added, S-01 uses it with follow-up delivery.
  - 2 accepted: resume() returns early before get_state completes (sessions.ts lines 108-143). S-15 adds a shared readiness promise; S-11 applies parked changes inside it.
  - 3 accepted: the moved fetcher has no credentials without a session (subscription-footer.ts lines 1152-1158). Q-07 opened; S-07 sub-bullets added.
  - 4 accepted: readSessionSummary exposes no model, and a last-line scan ignores branches. Approach now uses get_state for live sessions and the SDK's branch-aware SessionManager otherwise.
  - 5 accepted: enabledModels holds patterns, not models. Approach resolves them with the SDK resolveModelScope and never falls back to all models (keeps D10).
  - 6 accepted: timer lifecycle across /new, unstar and terminal was undefined. Q-08 opened; S-01 sub-bullet added.
  - 7 accepted: runDaemon takes no exclusive lock. S-13 now makes the daemon exclusive and the hub stops only its own.
  - 8 accepted: verify-package.mjs line 53 requires subscription-footer-UPSTREAM.md. S-09 moves it and migrates the tests.
  - 9 accepted: C1 pointed at hub/hub/scripts; now npm test from hub/.
- 2026-10-21: Added final architecture reconciliation because a product diagram exists.
- S-04 (execution): the schedule tool is registered only in hub-started Pi (PI_HUB_SESSION, now set by the hub for each child) instead of being present everywhere and refusing; saves its schema in every non-hub session. Its execute still refuses without PI_HUB_SESSION. Scheduled sends use a direct RPC prompt (source rpc, compacted by 0.1.58's input hook) rather than the page's /pi-hub path.
