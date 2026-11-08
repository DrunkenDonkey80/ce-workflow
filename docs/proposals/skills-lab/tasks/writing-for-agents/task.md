# Task: writing-for-agents (write AGENTS.md, then replay a coding task)

Measures the document by what it does to a later agent, not by its length (Astra's condition).

- Source: DealFinder `27221be`, fresh-history copy, no setup patch. DealFinder has no AGENTS.md today.
- Skill: `productivity/writing-for-agents` (its `SKILL-MECHANICS.md` is in the skill dir).

## Phase 1 (the arm)

> Write `AGENTS.md` for this repository: what a coding agent needs to make changes here correctly and quickly. Change nothing else.
>
> Unattended run: no one will answer questions; decide yourself and say what you decided.

## Phase 2 (replay, identical for all arms, no skill)

A new fresh-history copy gets the phase-1 `AGENTS.md` (or none, for the control) and the fixture `tests/fixtures/laptopbg_list.html` (a synthetic product list page for a new Bulgarian refurbisher "Laptop.bg", built by SK-04 in the Izot card format with different class names). A fresh `pi -p` session on Sol, without any skill:

> Add Laptop.bg (https://laptop.bg/used-laptops) as a new Bulgarian refurbisher source. A saved list page is at `tests/fixtures/laptopbg_list.html`. It is a trusted shop like Kvant, Ardes and Izot.
>
> Unattended run: no one will answer questions; decide yourself and say what you decided.

Runs: 3 phase-1 runs per arm (A, B), 1 C; each written document is replayed once; plus 3 control replays with no AGENTS.md.

## Check (phase 2)

1. `python -m pytest -q` green.
2. Hidden acceptance test (SK-04 writes it with the fixture): the parser yields the fixture's ThinkPads with prices; `sync_bg` includes `laptopbg` with a fake client; `normalize` reads its spec bullets like the other shops; `pricing.SHOPS` and `report.SHOP_NAMES` contain it.

## Rubric

| # | Item | How |
|---|---|---|
| 1 | Replay hidden acceptance test passes | script |
| 2 | Replay updates every shop list (`normalize` shop tuple, `pricing.SHOPS`, `report.SHOP_NAMES`, `sync` fetch list and known-details map) | script (grep of final tree) |
| 3 | Replay adds a parser test from the fixture, no network | script (diff) |
| 4 | Replay R3 cost, tokens, turns, tool calls (lower is better at equal 1-3) | script |
| 5 | AGENTS.md states the test command, the offline-fixture rule and where shop/source lists live | judge (phase 1 output) |
| 6 | AGENTS.md has no no-op lines (generic advice that changes nothing for this repo) | judge (count) |
| 7 | AGENTS.md claims are true for the code (no invented commands or files) | judge |
