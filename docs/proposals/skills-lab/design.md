# Skills lab: experiment design (plan 79614d24, SK-03)

Question per skill: does loading the upstream skill make Sol 6.1 do the task better, at what cost? Shortlist from `docs/proposals/2026-11-08-mattpocock-skills-review.md` "Final shortlist": diagnosing-bugs, tdd, code-review, retro, writing-for-agents, prototype. One task file each in `tasks/`; planning requests for SK-06 and PC-09 in `tasks/planning-requests.md`.

## Codebase

All code tasks use DealFinder (`C:\SOFT\git\DealFinder` at `27221be`; export at `C:\SOFT\git\skills-lab\df-base`): Python, 119 tests in about 4 s, offline fixtures, no live network needed. Astra proposed Plan3 fixtures instead; rejected for the code tasks because lab sessions load ce-workflow from the live checkout, so an agent editing a Plan3 copy would run beside the very extension it edits, and the TypeScript suite is slower. The retro task uses the photobook-01 rework session, the one saved session with a written list of known friction.

Every run gets a **fresh-history copy**: `git archive 27221be` into a new folder, the task's setup patch applied, one `git init` + commit "DealFinder". No upstream history, so `git log -p` cannot reveal a planted bug.

## Arms (D-03, Q-02, D-04)

Same model `openai-codex/gpt-6.1-sol`, thinking `high`, same copy, same prompt body, same tools; only the skill differs.

| Arm | Command shape | Runs |
|---|---|---|
| A off | `pi -p --mode json --model openai-codex/gpt-6.1-sol:high "<prompt>"` | 3 |
| B forced | `... --skill <skill dir> [--skill <dependency dir>] "/skill:<name> <prompt>"` | 3 |
| C unforced | `... --skill <skill dir> [deps] "<prompt>"` (the model decides whether to read it) | 1 |

- retro has `disable-model-invocation: true`, so it has no C run.
- writing-for-agents is two-phase (see its task file): each written document is replayed once by a fresh skill-free session.
- Every prompt ends with the same line in all arms: "Unattended run: no one will answer questions; decide yourself and say what you decided." (`pi -p` has no ask_user UI.)
- Failed and timed-out runs are kept and scored, never rerun silently. Timeout: 60 min per run.

## Environment (identical, recorded per run)

Pi version (`pi --version`, 1.5.0 at design time), model id, the user's global extensions as installed (ce-workflow live checkout, ponytail, pi-subagents, pi-lens), compaction mode `ultrafull`, global `AGENTS.md` files that Pi loads for `C:\SOFT\git\skills-lab\runs\...` (user `~/.pi/agent/AGENTS.md` and `C:\SOFT\git\AGENTS.md`). The runner writes these into each result line. A Pi or model update between runs of one skill voids that skill's batch.

## Runner (SK-04)

`node scripts/skills-lab.mjs <run> --task <name> --arm off,forced[,unforced] --reps N` builds each run in `C:\SOFT\git\skills-lab\runs\<run>\<task>-<arm>-<rep>` (fresh history from `git archive`, or `git clone` for retro), with its own session dir, up to 5 at a time, and appends one line per run to `results.jsonl`: environment, metrics (lab-metrics.mjs), `skillRead` (a read of the skill file; forced runs get it inline, so it matters for unforced), `outside` (tool calls naming other lab paths, e.g. a sibling run; the judge reviews them), check results and diff stat. Hidden tests are copied in only for the check and removed after. Task config is `tasks/<name>/lab.json` (`source`+`sha` or `copy`, `skill`, `deps`, `prompt` with `{base}`, `inputs`, `setupPatch`, `changePatch`, `checks`). `--no-pi` sets up and checks only: on the untouched base every hidden test fails and every suite passes (validated `fixture-01`).

## Pi adaptations of upstream wording (applied by flags, never by editing the skill text)

| Skill | Upstream wording | Pi handling |
|---|---|---|
| tdd | "call the Skill tool with codebase-design" | B and C also get `--skill .../engineering/codebase-design` |
| retro | "Call the Skill tool with writing-for-agents" | B also gets `--skill .../productivity/writing-for-agents` |
| code-review | issue tracker "should have been provided", `/setup-matt-pocock-skills` | The prompt passes the spec path (its step 2.2) and the fixed point; no tracker |
| code-review | "parallel sub-agents" | All arms' prompts say "You may use subagents" so authorization is equal (global AGENTS.md delegates only when asked). Subagent sessions count in the metrics |
| prototype | "commit it to a throwaway branch ... pointer on the implementation issue" | Allowed in the throwaway copy; no issue exists, so the pointer goes in the final message |
| diagnosing-bugs | `scripts/hitl-loop.template.sh` | Available as part of the skill dir; Git Bash runs it |

## Metrics (R3, per run)

Wall time, provider tokens (input, output, cache read, cache write), cost, turns, tool calls; **all sessions of the run aggregated**, including subagent sessions (`subagent-artifacts`) and continuations. Plus the task's check result (hidden acceptance test, full suite). Parsed from the `--mode json` event stream by the shared metrics parser (SK-04/SK-05).

## Rubric and scoring

Each task file lists rubric items, each marked **script** (decided by a command on the final tree, the diff or the event stream) or **judge** (decided by reading the transcript or report). Items are pass/fail; a task's quality score is the share of items passed, with the hidden acceptance test reported separately.

## Judge protocol (SK-08)

- Judge: read-only `reviewer` on `openai-codex/gpt-6-astra:high`, one call per skill, all 6 or 7 runs of that skill in one bundle.
- Blind: runs get random labels; transcripts are reduced to tool calls, tool outputs (truncated) and assistant text, with `/skill:` lines, skill file reads and the skill's name and distinctive headings redacted. Script results are attached, arm-free.
- The judge scores every judge item per run with a one-line quote or path as evidence, then ranks the runs on overall outcome quality. Labels are unmasked only after the judge returns.
- Verdict per skill: **adopt** when B beats A on the hidden test or the rubric median without a material cost regression (AGENTS.md Optimization Regression Rule: cost, tokens, turns and tool calls all compared); **reject** when B is not better or costs materially more for the same quality; **inconclusive** when the 3 runs per arm overlap. C shows whether the description alone triggers the skill (did the run read the SKILL.md?).

## Planning requests (SK-06 baseline, PC-09 candidate)

Five requests on DealFinder `27221be`, in `tasks/planning-requests.md`, run through `scripts/rework-lab.mjs` with `--request-file`. Endpoints:

| Request | Kind | Endpoint |
|---|---|---|
| P1 new shop source | hack vs prefactor | first planning turn (`--plan-only`), and one end-to-end run (plan, finish, execute to complete, then the full suite) |
| P2 Polish market | hack vs prefactor | first planning turn |
| P3 per-source quick-sale cut | hack vs prefactor | first planning turn |
| T tiny CLI text | tiny | end to end (the candidate should skip the plan: `tiny` outcome) |
| F alerts and dashboard | foggy | first planning turn |

Planning rubric (judge, on the plan file and first-turn transcript): sizing matches the kind (Tiny/Plan/Map once PC lands, plain plan in the baseline); hack-vs-prefactor requests name the scattered shop/currency/cut lists and weigh a prefactor against the small patch in Decisions; questions come in prerequisite-ordered rounds with recommendations; foggy request separates what is decided from fog. Plus R3 metrics for the whole planning session.

## Out of scope

No skill is installed into ce-workflow by this lab; adoption forms are proposed at SK-09. No live eBay, OLX or photo checks: all tasks stay offline.
