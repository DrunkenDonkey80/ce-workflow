# Agent rules for specific kinds of work

AGENTS.md points here; read the section before doing that kind of work.

## Dialog UX Rule

Every ce-workflow prompt goes through ask_user (`extensions/ask-user/`), so
the terminal, the web and the hub draw one form: menus and checklists use
`showListDialog()`, Yes/No uses `askConfirm()`, free text uses `askText()`, and
few-action prompts pass `compact: true` (all in `extensions/ask-user/menu.ts`);
never call `ctx.ui.confirm/input/editor` directly. Every dialog shows one muted purpose
line directly below its title. Escape goes to the parent and closes only at the
root; Enter and Space toggle checklist rows without moving the cursor; parent
cursors survive submenu round trips; every model list supports keyboard
filtering. Every model picker uses `chooseModel()` in `extensions/work-models.ts`
(Pi-scoped models first, Tab toggles all models, like Pi's own picker); never
build one from plain `choose()` + `modelItems()`. Keep native UI fallbacks for
non-TUI modes.

## Video Review Tracking

Video ingestion lives in yt-ingest; ce-workflow review state lives in `docs/upstream/processed-videos.json`, keyed by YouTube ID. Before reviewing a batch, run `node "scripts/work-video-status.mjs" "<digest directory>"` to list only unprocessed digests. After review or an intentional skip, add the ID, title, `reviewed`/`skipped` status, `processedOn` date and `evidence` path (including the reason for a skip). Downloaded/seen is not reviewed, and reviewed does not mean every idea was adopted. Do not mark unfinished reviews or infer status from titles.

## Optimization Regression Rule

Never retain or describe a workflow optimization as successful from focused tests or fewer turns alone. Re-run the same end-to-end benchmark, aggregate every continuation session, and compare runtime, total provider tokens, cost, turns, and tool calls against the last accepted baseline. Revert the optimization when it causes a material overall regression; do not rationalize the regression from one improved submetric. Compare `results.json` files with `node scripts/compare-benchmark-runs.mjs <baseline> <candidate>`: it pairs runs by scenario and repetition and keeps failed or missing runs out of the totals.

## Compaction Mode in Tests Rule

Live tests and benchmarks run the `ultrafull` compaction mode (the coming default). Use `ultracompact` only in tests of behavior that exists only in that mode (rolling stripping, the reasoning-strip benchmark) and in tests that cover every mode.

## Compaction Model Fact Recall

On every new model release, and before changing the compaction model, run the planted-fact check: `node scripts/benchmark-compaction-recall-live.mjs --models "<provider/id>,<current compaction model>" --sizes "30000,80000,150000"` (models run in parallel; results in `.pi/compaction-recall/`). It plants 5 facts (failing check, decision, port, constraint, next step) at depths 0.1-0.9 of the 3 largest ce-workflow sessions and scores the real `compactMemory` checkpoint by exact token match. Compare recall per length and the cost; switch only on a clear win at an acceptable cost, and confirm with `scripts/compare-benchmark-runs.mjs` on the E2 task run that task outcomes do not regress. Baseline (2026-11, 9 runs each, medium thinking) before / after the prompt line that keeps open checks, decisions, constraints, exact values and next steps from any record: Luna 16% / 28% ($0.004/run, the default), Terra 16% / 60% ($0.08/run), Astra 6.2 0% / 93% ($0.33/run), Opus 5.5 71% / not rerun, Sonnet 5.5 17% / not rerun. Most loss is at 150 KB.

## Changelog screenshots

For a visible hub change, add a tight crop: `node hub/scripts/changelog-shot.mjs "<selector>" docs/changelog/<version>-<name>.png "<setup JS>"` (throwaway hub with a fake Pi; `--pad=N` keeps some surroundings, `--ask=<ask_user JSON>` shows a dialog, `--size=WxH` for tall ones): shoot the control and the dialog it opens, then put `![what it shows](docs/changelog/<file>.png)` lines right after that bullet.
