# Task: prototype (deal alert policy with hidden state traps)

- Source: DealFinder `27221be`, fresh-history copy, no setup patch.
- Skill: `engineering/prototype` (its `LOGIC.md` and `UI.md` are in the skill dir).
- The trap: `scan` deletes all candidates and reinserts them as `provisional` every run; `verify` then marks survivors `verified` (`dealfinder/sync.py`). A policy keyed on "became verified" alerts the same deal every cycle. A runnable model of scan/verify cycles exposes this before production code.

## Prompt

> Add deal alerts. After each scan and verify, DealFinder should tell me about deals worth my attention:
> - alert a new verified deal once;
> - alert it again when its margin grows by at least €20;
> - never alert provisional candidates;
> - a candidate that disappears and comes back within 3 days is not new;
> - a verified candidate that verify drops gets no alert.
>
> Put the policy in `dealfinder/alerts.py` as `alerts(previous_state, candidates, now) -> (alert_list, new_state)`, where `previous_state` is None on the first run, `candidates` are rows of the `candidates` table as dicts (including `listing_id`, `margin_eur` and `state`), each alert is a dict with at least `listing_id` and `reason`, and `new_state` is JSON-serializable. Wire it into the `scan`/`verify` CLI flow so alerts are printed.
>
> Unattended run: no one will answer questions; decide yourself and say what you decided.

## Deliberate ambiguities (not in the hidden test; judged)

- G1: "grows by €20" since the last alert or since the last scan?
- G2: a candidate gone more than 3 days that was alerted before: new again?
- G3: margin shrinks and later recovers: alert on recovery?

## Check

1. `python -m pytest -q` green.
2. Hidden scenario test `hidden_test_alerts.py`: first verified appearance alerts once; same state next cycle does not; provisional never alerts; a verified → provisional → verified cycle at the same margin does not re-alert; disappear-and-return within 3 days does not alert as new; +€25 margin alerts, +€10 does not; a dropped candidate yields no alert.

## Rubric

| # | Item | How |
|---|---|---|
| 1 | Hidden scenario test passes | script |
| 2 | Full suite passes | script |
| 3 | A runnable model of the policy (script, test table or state simulation) was run before the first edit to production `dealfinder/` files | script (event stream) plus judge |
| 4 | The scan-resets-to-provisional trap is named before or during design, not only after a failing test | judge |
| 5 | G1-G3: each ambiguity named with the decision taken (score 0-3) | judge |
| 6 | Prototype code is not left in the production tree, or is clearly marked throwaway | script (diff paths) plus judge |
| 7 | Decisions recorded in the final message or a doc | judge |
