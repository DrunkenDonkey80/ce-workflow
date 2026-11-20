---
plan3: true
status: ready
created: 2026-11-20
updated: 2026-11-20T17:02:59.555Z
reviewed: 2026-11-20
started: 2026-11-20T16:56:31.811Z
---

# Plan retro follow-ups: step retros, local improvement requests, hub counter

## Original request

> The user's comment when keeping the plan-finish retro with Opus 5.5 (plan 5e4d224a, UB-06, D-11):
> "it is nice we are adding such a step to use the metrics BUT few items to consider:
> - review per plan step (option, maybe lighter?), background so it does not interfere with the work going on, my point is that this is a single plan of say 10 steps, if you catch issue with that early like repeated tests or bad shell commands or something that could have been script instead of 20 agent calls, etc, that will benefit the whole plan moving forward. MAYBE that needs metrics per plan slice, not just generic?
> - the outcome of the analyzer can be: plan rule forward, just for this work, project rule (agents.md?), ready to run scripts so further plans/work benefit, or a generic ce-workflow improvements. I think these are best to be added as github requests alongside all the data that is needed for the thing to be considered - project metrics or the steps that failed and command, but no sensitive data or full paths!, etc, silent. not sure a tool is needed or generic github post will suffice
> - ce-wf button that shows the number of unprocessed such improvement requests and a /plan3 to analyze them"
>
> Earlier in the same scoring round: "the idea about async prompts that the work continues behind them, probably more than one is interesting". The user then chose "Build UB-07 now, new draft plan for the rest", so this plan holds all four follow-ups.

## Goal, requirements, and non-goals

Goal: catch execution problems while a plan is still running, and turn every retro finding into something that acts: a rule, a script, or a local improvement request.

- R1 Step retro: optional (setting, default on, D-09), lighter, in the background; never blocks or interrupts the running work. Uses metrics of that step's slice, not only plan-wide totals.
- R2 Routing: each finding gets one scope: (a) forward rule for this plan only, (b) project rule (AGENTS.md), (c) ready-to-run script for this project, (d) generic ce-workflow improvement.
- R3 Requests: written as local files with the data needed to judge them (metrics, failed step, the command shape), redacted (no secrets, no full paths, no user names), deduplicated, under a gitignored ce-workflow folder in the project. "Silent" = no popup per request. Nothing is posted; the user forwards ce-workflow requests by hand (D-03).
- R4 Hub button: shows the number of unprocessed improvement requests; clicking it starts a /plan3 that analyzes them.
- Non-goals: no change to the finish retro's model or cap (D-11); no automatic edits of AGENTS.md or code from a finding (every adoption still goes through the user); no pushing, no GitHub issues or other network posting (D-03); async questions (separate plan, D-06).

## Decisions

- **D-01 Finish retro stays as built.** Opus 5.5, at most 3 cited recommendations per side, after archive (5e4d224a D-06, D-11). Step retros reuse `planDigest`, `retroPrompt` and `parseRetro` rather than a second prompt family. Source: agent, from 5e4d224a.
- **D-02 This is a planning-only draft.** Nothing is built here until the user runs /plan3 finish and starts it. Source: user ("new draft plan for the rest").
- **D-03 Requests stay local; no GitHub.** Every request is a file in the project's gitignored ce-workflow folder; on remote hubs they pile up there too and the user sends the ce-workflow ones by hand. This keeps the global "nothing may leave the machine" rule intact. Source: user, Q-01 "Local only", comment: "for remote hubs pile these as ce-wf improvement requests under the gitignored cewf dir and then the user will manually send them to me".
- **D-04 Step retros only on signal steps, on Opus 5.5.** A step gets a retro only when its slice shows a signal (proposed thresholds: a command repeated 3+ times, 3+ failed tool calls, or over 30 min; tune in RF-02); other steps get none. Source: user, Q-02 "Signal-triggered, Opus 5.5"; thresholds are the agent's proposal.
- **D-05 Forward rules: plan Decisions plus one steer at the next step boundary.** A "this plan only" finding is appended to the running plan's Decisions as a work rule and sent once as a steer when the next step starts, never mid-step. Source: user, Q-03.
- **D-06 Async questions get their own plan.** Out of scope here; a separate /plan3 draft covers it. Source: user, Q-04 "Own plan".
- **D-07 No model-facing tool for requests; code writes them.** Routing happens in code right after a retro reply is parsed, so the agent never needs to file anything: the retro reply gains a `scope` per item (plan, project, script, ce-workflow), and code writes one Markdown file per non-plan item with the cited digest lines, step, metrics and command shape, redacted, with a dedupe key (scope + normalized advice). A tool would only add a schema to every session for something no agent calls. Source: agent, decided at the user's request in Q-05 ("decide on your own if a small tool ... or an agent description is enough").
- **D-08 Hub counter: per project plus a ce-workflow total.** Each project's hub page counts its own unprocessed requests (all scopes); the ce-workflow project also shows the total of ce-workflow-scope requests across this hub's local projects. The /plan3 analysis reads the same set. Remote hubs are not pulled (D-03). Source: user, Q-06 "Per project plus ce-workflow total".
- **D-09 Step retros have a setting, default on.** A /wo Settings switch "Step retros"; off means a qualifying step makes zero model calls. The finish retro is not affected. Source: user, Q-07 "Setting, default on".
- **D-10 A request counts as processed when its analysis starts.** Clicking the hub button moves the pending files to `requests/done/` and the /plan3 analysis reads those moved files; an abandoned analysis does not bring them back (the files stay in `done/`). Source: user, Q-08 "Processed when the analysis starts"; the move to `done/` is the agent's implementation of it.

## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

- `extensions/plan3-stats.ts`: `createStats` (per-step rows, `onStep`), `recordCommand` (plan-wide command table), `planDigest`, `retroPrompt`, `parseRetro`, `finishRetro`, `RETRO_MODEL`.
- `extensions/plan3.ts`: `retroAfterArchive` (finish retro hook). Step completion has two paths: `action: "step"` with mark done and `action: "next"` (`:1853-1865`), which completes one step and starts the next in one mutation; the step retro triggers from both.
- Request folder: `.ce-workflow/local/` is already gitignored in this repo (`.gitignore`) and holds `knowledge.jsonl` (`extensions/work-knowledge.ts:157-160`). Other projects' `.gitignore` files are not verified to cover it, so the requests folder writes its own `.gitignore` containing `*` (agent proposal). Proposed path: `.ce-workflow/local/requests/<scope>-<key>.md`.
- Hub button: built in, following the Catch up button precedent (`hub/web/app.ts:2702-2709`, shown only where it applies, reads an endpoint), not a static `project_commands` label (`hub/src/commands.ts`).
- `docs/plans/logs/<id>.stats.json`, `<id>.md`: where step slices and retro output live.
- Approach (agent proposal): keep the plan-wide command table as is and add separate per-step counts, so a step digest uses only that step's commands and that step's log lines; route parsed items per D-05 and D-07; the finish retro (`finishRetro`) routes its items the same way, minus the plan scope.

## Phases

### Phase 1: Decisions [think]

- [x] **RF-01** Q-01 to Q-05 settled as D-03 to D-07; Q-06 left for RF-04
  - Local requests only, signal-step Opus retros, Decisions plus next-step steer, async questions in own plan, code writes requests without a tool.

### Phase 2: Step slices and step retro [code]

- [x] **RF-02** Step slices (commands per step, multi-wip activity counted as "(ambiguous)"), background Opus 5.5 step retro on signal steps from both step done and next, scope-tagged advice; plan rules go to Decisions and steer once at the next step start; /wo Settings Step retros toggle (default on).

### Phase 3: Routing and requests [code]

- [ ] **RF-03** Scope per item in the retro reply; code writes redacted, deduplicated request files under `.ce-workflow/local/requests/` (D-03, D-07), finish retro too
  - Evidence comes from the canonical digest line the citation matched, redacted, never the model's citation text; advice and command shapes are redacted too (`commandShape` can keep a path or user name).
  - Check: fixture items with a secret, a full path and a user name in advice, citation and command shape come out redacted; the same item twice writes one file; the folder carries its own `.gitignore`; the writer makes no network call.

### Phase 4: Hub counter [code]

- [ ] **RF-04** Hub button with the unprocessed request count (D-08) that starts a /plan3 analysis of those files; processed on start (D-10)
  - The badge and the analysis read the same pending-file selection.
  - Check: `node hub/scripts/test-browser.mjs` (or the narrowest hub test): two sessions in one folder count it once; a second local project adds only its ce-workflow-scope items to the ce-workflow total; starting the analysis moves the counted files to `done/` and drops the count to zero; the click starts the prompt; changelog screenshot.

## Global validation

- `node scripts/test-work-plan3-stats.mjs`, `node scripts/test-work-plan3.mjs`, and the hub test touched by RF-04.

## Resume context

Reviewed (plan3-advisor 5b2c96f9, findings in Amendments). All questions answered: Q-01 to Q-08 recorded as D-03 to D-10; RF-01 done; no open questions. Next: RF-02 once the user runs /plan3 finish and starts work. Async questions belong in their own plan (D-06), not yet drafted. Nothing built.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.

- 2026-11-20: GitHub issues replaced by local request files (D-03); async questions removed to their own plan (D-06); RF-02 to RF-04 narrowed to D-03 to D-07; Q-06 added for the hub counter scope.
- 2026-11-20: Q-06 answered as D-08; RF-04 points to it.
- 2026-11-20: Review by plan3-advisor (Astra 6.2 high, run 5b2c96f9), each finding checked against the code:
  - 1 Blocking, `next` completes a step without the `step` handler (`extensions/plan3.ts:1853-1865`), and a late reply cannot steer at the start of a step already running: accepted. RF-02 triggers from both paths; the steer goes out at the first step start after the reply, never into a running step. This keeps D-05 ("steer at next step", never mid-step).
  - 2 Major, plan-wide command rows (`recordCommand`, `plan3-stats.ts:58`) cannot be split by step afterwards: accepted. Separate per-step counts, multi-wip activity ambiguous, 2+1 split test added.
  - 3 Major, plan scope must exist in RF-02, and the finish retro (after archive) has no next step: accepted. Reply contract moved into RF-02; finish retro rejects plan scope.
  - 4 Major, `commandShape` can keep a path or user name and `parseRetro` accepts citations with extra text: accepted. Evidence comes from the matched digest line, redacted. Partly rejected: redacting before the Opus call is not added; the finish retro already sends the same digest under D-11, and D-03 is about posting, not model calls. The check now says the writer makes no network call.
  - 5 Major, nothing defines processed: accepted as Q-08 (new acceptance needs your decision); the hub button follows the Catch up precedent; same-selection and two-session tests added.
  - 6 Minor, "optional" has no off switch: accepted as Q-07 (blocking: changes RF-02's acceptance).
- 2026-11-20: Q-07 answered as D-09 (setting, default on) and Q-08 as D-10 (processed when the analysis starts); R1, RF-02 and RF-04 point to them; status back to draft.
