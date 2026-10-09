# pi-work-orchestrator

Native Pi workflow package for staged software work through one filterable **Orchestrator** dialog.

For Orchestrator, the native work-item store at `.ce-workflow/work-items.json` is the only durable work state. Plan3 uses Markdown plans instead. Git is the only code state. Runtime logs, telemetry, locks, recovery files, exports, and backups stay ignored.

## Install

```bash
pi install /absolute/path/to/pi-work-orchestrator
pi install npm:pi-subagents
pi install npm:pi-ask-user
# Optional: pi install npm:pi-intercom
```

No tracker CLI is required for normal operation. Run **`/wo`** to open **Orchestrator**, then type to filter its actions. **Roadmaps** is first and initially selected; its picker remembers the last open roadmap or initiative. `/wo goal <objective>` starts an autonomous goal, `/wo pause` waits for the current tool boundary, and `/wo resume` continues the paused goal, workflow, or direct request. When explicitly invoked, `/wo monitor <session-id-or-name> [focus]` watches one exact pi-intercom session on a durable 10-minute cadence and wakes immediately for messages after binding its session ID; `/wo monitor status|pause|resume|stop|clear` controls it. For deterministic console recovery, `/wo resume-work <id>` bypasses goal-answer interpretation and resumes native work state directly. Choose **Compact: Ultracompact / Ultrafull compact / Native / Native 200k** in Settings; **F8** or `/wo compact` forces manual compaction in every mode.

The **`/wo` menu title** shows `ce-workflow v<package version> · build <source fingerprint>`, captured when the extension loads; its subtitle shows the loaded package path. The fingerprint covers the manifest and extension `.ts` files, including Plan3. Changing files on disk does not change the displayed stamp until `/reload`, so an old loaded runtime cannot masquerade as the newly edited build. No Git checkout is required.

Typed or dictated TUI input can use the strict start-of-line prefix **`orchestrator`**: `orchestrator list roadmaps`, `orchestrator resume work-3`, `orchestrator resume last`, `orchestrator status`, or `orchestrator compact`. `orchestrator 1` runs a currently displayed recommended action. The extension parses and handles this fixed grammar before the model sees it; unknown prefixed commands stop with usage help, while extension-authored messages cannot invoke this user command surface.

Ordinary chat requests stay direct: bare words such as `pause`, scout phrases, and numbered replies do not create work items or run workflow actions. ce-workflow orchestration starts only from an explicit `/wo` action or `orchestrator …` command.

**Research mode:** Press **Ctrl+R** or run `/research` to toggle persistent exploration mode (`/research on|off` sets it explicitly). `/research <question>` and `/ideate <topic>` turn it on and offer **None** (inline agent only), **Narrow** (first other available advisor in configured list order), or **Wide** (all other available advisors). Prefix either question/topic with `none`, `narrow`, or `wide` to select without asking. The inline model, disabled advisors, and unavailable models are excluded before selection; inherited model settings resolve to the inline model and are excluded too. With Astra/Opus/GLM configured, Wide on GLM uses Astra and Opus; Wide on another model uses all three. Orchestrator Research and Ideas do the same, and exploratory ideas stay in system temp rather than being captured as work items. A banner above the editor shows when it is active. The mode supplies temporary instructions for research, ideas, and plans without product implementation. Shell exploration, isolated dependency installs, archive extraction, and scratch scripts are allowed; keep their files in the system-temp research directory rather than the repository. Research is a plain on/off flag: all tools and writes stay available (the mode instructions say not to implement); only Git commit/push commands are blocked. This command guard is not a sandbox: opaque scripts and Git aliases must also obey the no-commit/no-push instructions. Early microcompaction and evidence stripping are bypassed; automatic compaction still runs once context reaches 90% of the model's window. The agent can save important findings with `research_note` into a session-specific system-temp notebook; `/research notes` shows its path, and `/research save <path>` copies it only when explicitly requested (never overwrites an existing file). Writing or updating a project plan is allowed without leaving research or asking separately. Mode state follows the session branch and stays active until you turn it off. If work is running or queued, Ctrl+R or `/research off` shows **RESEARCH STOPPING…** and keeps protection active until the agent settles; Ctrl+R again cancels the pending exit. Manual toggles never force compaction. After exit, subsequent work follows the selected normal compaction policy: Ultracompact defaults to 150k, Ultrafull compact defaults to 200k (both respect an explicitly configured threshold and smaller-model safety limits), Native 200k uses up to 200k with earlier triggering for proxy/output headroom, and Native leaves triggering to Pi. A context already above that threshold may compact on subsequent work. F8 remains available during research. Temp files can be cleared by the OS. Ctrl+R toggles research in the main editor; Pi's session-picker rename shortcut remains available inside the picker. Child sessions do not inherit research mode automatically.

**Manual-only research:** Ordinary file reads, debugging, and planning never require a research-mode transition. Only explicit user actions (`/research`, `/ideate`, Ctrl+R, or the corresponding Orchestrator actions) start research; the agent can record notes but cannot enter or leave the mode. Agent control and its tool have been removed; old `/research auto`, `/research auto on`, and `/research auto off` commands only report that removal. Research-only requests still end with an answer (and a project plan when useful), not implementation. If research is active when you want implementation, turn it off yourself. Saved research mode and notebooks still follow the session branch; legacy auto-permission flags are ignored.

**Image bridge:** Under `/wo → Settings`, choose a **Vision model** and explicitly select **Models without vision** (default: none). Only selected non-vision models receive `img-…` references instead of image pixels; they can call `process_image(image, question)` to ask the selected vision provider a specific question. All other models retain Pi's normal image handling, and the selected vision model is always trusted as vision-capable regardless of model metadata. The original image remains in the session; the description is labelled as another model's interpretation. Images leave your machine for the selected provider only when the tool is called. The bridge applies to the main session only; subagents keep Pi's normal image handling. Reattach or reread an expired image reference; the bridge retains up to 32 recent images per session.

If startup prints `pi remove npm:pi-compound-engineering`, the retired legacy package is still installed. Run that recommendation yourself; ce-workflow never invokes a package manager for legacy removal. To remove its old managed block from an `AGENTS.md`, first run `node scripts/work-helper.mjs legacy-instructions-preview AGENTS.md`, inspect the exact `removed` and `result` bytes, then explicitly apply the returned token with `node scripts/work-helper.mjs legacy-instructions-apply AGENTS.md --confirm <token>`. Missing or malformed marker pairs never mutate the file.

## Optional Jev tools (experimental)

Under **`/wo → Settings → Optional Jev tools`**, explicitly enable uploads globally (every project without its own setting) or in project scope for one project. A project value overrides the global one in both directions, so a project can opt out of a global On. Default Off. Use native **`/login → OpenRouter`** for credentials—never put a key in settings. The panel shows configuration status, not a paid connectivity test. Default classifier: `openrouter/typesafe/jev-1.13`; no silent provider/model fallback. Requires Pi's native classifier/hidden-tool APIs, Node's `path.matchesGlob`, and `rg` for evidence search.

These are ordinary optional tools, available in direct sessions and Plan3, including codemode. No automatic calls, read replacement, work items, or per-turn prompts. Off hides both wrappers and guards execution; it does **not** disable Pi's separate native `models.classify()` API. Settings changes abort outstanding wrapper requests. `/reload` loads updated code.

- **`jev_triage`** accepts up to 32 independent `jobs`, each with `id`, `questions`, optional JSON `state`, and optional `sources: [{path, startLine?, endLine?}]`. Several sources in one job form an explicit cross-file bundle. Up to 32 questions share that single provider invocation.
- **`jev_evidence`** accepts explicit relative `scopes` (files/directories/globs), `unit: "file" | "window"`, optional `pattern` (literal by default, `regex: true` opt-in), and optional `questions`. It honors rg ignore rules, captures exact evidence locally, and returns bounded ranked excerpts. `rankQuestion` selects the ranking question; choice ranking also needs `rankChoice`. Without questions it does lexical retrieval only, without classifier calls.

Question example: `{"relevant":{"type":"bool","instructions":"Does this supplied source expose battery temperature?","criteria":{"true":"Exposes temperature","false":"Does not expose temperature in the supplied scope"}}}`. Native `choice` uses a label-to-description map; `score` uses ordered descriptions. Answers classify supplied evidence—they cannot extract arbitrary quotes, prove repository-wide absence, certify tests, or authorize actions. Bool 0.2/0.8 bands are uncalibrated. Read the cited source normally before editing or quoting; hidden classifier reads do not satisfy read-before-edit.

Sources leave the machine for OpenRouter/TypeSafe. Canonical containment, secret-path/content filters, binary rejection, and bounded reads reduce risk but do not certify arbitrary files as secret-free. No custom raw exchange logs; inline JSON still exists in the normal tool-call transcript. Source captures are capped at 256 KiB; invocation state **plus questions/envelope** at `min(24,000, floor(contextWindow × 0.75))` UTF-8 bytes. Narrow ranges/windows rather than treating a clipped prefix as complete. Evidence inventories are bounded (128 files, 32 classified candidates, 10 returned excerpts, 24,000 output bytes); incomplete scans, omissions and provider failures are explicit. Whole-file anchors do not invent matched line numbers. Hashes/excerpts refer to captured bytes, not a guarantee the file remains unchanged.

Concurrency is 4, with 30-second request and 120-second tool deadlines; no wrapper retries. Native usage is carried once at the enclosing tool-result level; missing usage is unknown, and reported cost is a catalog estimate, not billing. Exact search, LSP and compilers remain authoritative for their respective checks. **No performance improvement is claimed yet**: the paid, agent-choice AI-Wedge-derived comparison remains approval-gated.

Offline self-check: `node "scripts/test-jev-tools.mjs"`.

## Plan3

Plan3 is the primary planning/execution flow: one living Markdown plan per task in `docs/plans/` (`plan3: true` frontmatter), worked by the current agent and model. No work items, gates or automatic commits; statuses and checks are agent-reported.

- `/plan3 <request>` creates a draft, turns research mode on and plans (no product code). If an open plan looks like the same request (word overlap ≥ 0.5), it offers **Resume that plan**, **Merge as follow-up** (appends the request to its Amendments and plans again) or **Create new anyway**.
- `/plan3 write [topic]` (aliases: `/plan3 planify [topic]`, `/plan3 create [topic]`) captures the discussion already in this chat into a new draft and turns research mode on, **without Plan3's pre-compaction** or the duplicate-plan resume/merge detour. The agent saves settled requirements, decisions, rejected options, examples, references and known results before investigating gaps; it does not restart research. An optional topic selects which discussion to capture. `/plan3 finish` remains the ready/compact handoff; native context-limit protection still applies.
- `/plan3 convert "C:/path/to/existing-plan.md"` imports an existing text plan (relative paths work too) into a **separate draft**, keeping the original unchanged. Passing an existing `.md` path directly, with or without quotes, does the same when its filename contains `plan` (case-insensitive); explicit subcommands still take priority. Code saves the full source snapshot to the plan's sidecar log (`docs/plans/logs/<id>.md`) before any agent turn, so the plan never carries it; no pre-compaction or duplicate-plan routing. The conversion applies the same lean-plan rules as **Optimize** (below). A dedicated conversion prompt preserves scope, settled decisions, progress and evidence, reviews against the current repo, and asks about genuine gaps rather than replanning from scratch. Imported completion claims remain source-reported, not newly verified; the copy stays draft/blocked until `/plan3 finish`. Already-Plan3 files can be re-converted the same way. Plans converted before the sidecar log may still hold an `Imported plan` section; its historical placeholders do not block finishing.
- While actively planning a draft/blocked plan, exact bare words **`finish`**, **`done`**, **`resolve`**, **`ideas`**, **`review`**, **`ideas all`** and **`review all`** run the matching `/plan3` action. They stop working as shortcuts once planning finishes. Ordinary sentences (such as “review the code”), image inputs and extension-injected messages remain normal input.
- `/plan3 ideas [all] [focus]` — read-only, fresh-context advisors propose ideas while the current agent writes its own independently. The agent collects every advisor's result, merges overlaps with source attribution, and supplies full explanations: what each idea does, benefits/examples, drawbacks/risks, implementation/files, cost, recommendation, and proposed requirements/steps. Code saves them in **Ideas**, then opens **one fully expanded, scrollable `ask_user` popup per idea**, with **Accept**, **Reject**, optional comments and custom text always available. The matching button shows **(Recommended)** when the stored recommendation explicitly begins with Accept or Reject; neutral/unclear recommendations receive no badge. The badge is advice, never an automatic decision. Idea popups use 98% width and all available height minus one-row margins, omit duplicated titles/status/context labels, and put section text directly under compact headings; the saved plan retains the full records. Plain acceptance immediately adds the requirement, steps and a Decision in code; rejection is recorded without adding work. Any custom text or selection with a comment is saved as **commented**, not silently accepted: one subsequent agent pass interprets intent, answers questions and records accepted/rejected/answered dispositions. Answered is not approval. Cancel leaves the remaining ideas pending; `/plan3 ideas select` resumes saved pending/answered ideas and reconciles comments without rerunning advisors. `/plan3 finish` refuses unsettled ideas.
- `/plan3 review [all]` — the advisor reviews the plan against the repository; the current agent validates each finding, applies accepted corrections and records every disposition in Amendments.
- `/plan3 resolve [id]` opens the **actual `ask_user` popup and custom-response editor directly, before any model turn**, using a small adapter for the loaded pi-ask-user 0.16.x package. Stored Open questions, context, recommendations and options are supplied without restarting research: Blocking first, then Deferred. Questions explicitly marked `  - Independent: yes` share reviewable batches of 2–4; older/unmarked questions are asked singly rather than assuming independence. Submitted answers move to Decisions in code, preserving their stored context and labeling them user-supplied, not independently verified. Cancelled batches, skipped/kept-open items and changed questions remain open. After the popups, one agent handoff reconciles submitted answers and needed plan changes; complete plans are not reopened. **Discuss with agent** leaves its question open and starts discussion after the submitted popup instead of asking the remaining questions first. Missing/incompatible packages produce a clear error, never another pre-popup thinking prompt. Open items are top-level bullets, or prose that is not None or a placeholder. The planning hint includes `/plan3 resolve (N open)`, the `plan3` tool reports `openQuestions`, `/plans3` offers **Resolve open questions (N)**, and execution replies end with `Next: /plan3 resolve`.
- `/plan3 finish` (or `done`) checks the plan in code (original request, no placeholders, Blocking = None, at least one step), marks it **ready**, turns research off, compacts above 20k tokens and makes it the current plan. Planning replies end with `Next: /plan3 ideas · /plan3 review · /plan3 finish`; the agent cannot set ready itself while planning.
- `/resume3` continues the current plan; `/resume3 <id|filename|path>` picks another. Draft/blocked plans resume planning with research on; ready/active plans execute with research off. Repo paths named in the plan that changed in Git since its last update are listed for re-checking first. Execution receives a compact **resume packet** instead of an instruction to reread the whole plan and its sources. The packet holds constraint sections in full (request, goal, decisions, open questions, validation, checks, resume context), one line per step, and the full current step. It lists omitted sections with their sizes, which the agent fetches on demand. The prompt says to continue to the next runnable step after each verified one, and to stop only for a required user decision or action, a prerequisite that blocks *all* remaining work, completion, cancellation or a hard limit. Marking a step done requires a one-line `summary`: the step shrinks to that line, and their notes and checks move to the sidecar log. The `plan3 checkpoint` action (and any section write to Resume context) replaces the single current checkpoint, and old text moves to the log. `next` closes the step actually finished: it needs `id` when several are wip, and it starts a new step only when none is wip. Steps under `## Backlog` never count. Tool results warn about open plans over 40 KB.
- `/plans3` (or `/plan3` alone) lists plans: current first, then open plans by last update, then complete ones, each with done/total, a progress bar and timing (`active 3d · touched 2h ago`). A plan opens **View** (open its Markdown file in the OS default app, including archived plans; no agent turn), **Resume**, **Optimize** (open plans; also `/plan3 optimize [id]`): code first appends the full plan to the sidecar log, then the agent rewrites it as a lean current work document. The rewrite keeps one checkpoint, one-line done steps and active decisions only, splits implementation from VM/hardware/human qualification, moves out-of-scope work to Backlog and adds a Checks section; no product code or checks run. After that agent turn, code verifies that every prior step and decision ID still appears and that open questions and status are unchanged, then reports the size before and after; a failure points to the snapshot. Other actions: **Force finish** (complete now, unfinished steps listed in Amendments) or **Delete** (confirmed). When the legacy store has unfinished roadmaps/tasks, a **Convert legacy work (N)** row writes them as Plan3 plans (closed → `[x]`, in progress → `[wip]`, blocked → `[blocked]`, deferred → Deferred questions; `source: work:<id>`); the old store is never modified.

**Frontend design:** the package includes the pinned Anthropic `frontend-design` skill with its Apache-2.0 license and [provenance](skills/frontend-design/UPSTREAM.md); no separate install is needed on each computer. Pi advertises its description and loads the full guidance only when needed. Planning consults it for new or substantially redesigned web UI and records the chosen direction, reused tokens/components and skill reference—not the skill text. Execution uses it as needed without reopening settled design choices. Explicit briefs and existing design systems win; routine fixes preserve existing UI, and native/TUI work follows platform/project conventions. Capture/conversion remains preservation-first. `/skill:frontend-design` loads it explicitly. Legacy workflow skills remain hidden by default.

Only the `/resume3` execution prompt includes test/build guidance; planning, capture, question resolution and advisor prompts do not. Execution prefers bounded native runner concurrency for independent suites/build jobs, with isolated output paths/filenames and respected dependencies. Shared hardware/resources or uncertain independence remain sequential. Await every result and report failures/unavailable checks; never weaken required checks or count stale results. Rerun affected checks after fixes and ensure required validation covers the final relevant code/input state, without unjustified repeat runs or new orchestration solely for parallelism. This guidance does not automatically rewrite test runners or establish a performance improvement.

The current plan is the session branch's last plan if still open, else the most recently updated open plan. Except for `/plan3 write` and `/plan3 convert`, switching to another plan with more than 20k context tokens compacts first; a failed compaction sends nothing. The footer shows a work-tools marker, an eight-cell progress bar and completion percentage before the counts: `🛠️ P3 [██░░░░░░] 27% 4/15 · S05`. Percentage reflects completed steps, not elapsed time; plans without steps show 0%.

The agent updates plans with the `plan3` tool: `get`, `title` (renames the file, keeping its 8-hex id), `status` (complete is refused while steps are open and moves the plan to `docs/plans/done/`), `step` (`pending|wip|done|failed|blocked`, optional `note`/`check` lines), `next` (completes the wip step, opens the next), `section` (append or replace), `add` (next free IDs after a step, e.g. JEV-15 → JEV-16, plus an Amendments entry), `ideas` (save/review detailed proposals), and `idea` (reconcile a saved commented response with a rationale). Prose is written with write/edit.

**Plan models** (`/wo → Settings → Plan3 → Plan models`, setting `workOrchestrator.plan3.models`): an ordered list of `{model, thinking}`. The advisor is the first available entry from another model family than the current one (family = first dash token of the model id), so on Opus it picks Astra and on Astra it picks Opus; `all` instead selects every available configured model except the **exact current provider/model**, including same-family models (e.g. Astra from Sol), deduplicated by model. The command announces selected advisors and exclusions; the agent launches them in parallel and must report every result or failure before selection. No eligible entry → the current agent works alone and says so. Running `/plan3 ideas|review` is the only delegation Plan3 authorizes.

Planning prompts require self-contained questions with this Markdown layout (older plain questions still allow direct free-text answers):

```markdown
### Blocking

- **Q-01** Which format should we use?
  - Context: Existing consumers read CSV; changing format requires migration.
  - Recommendation: Keep CSV to avoid migration.
  - Option: Keep CSV — No consumer changes needed.
  - Option: Use JSON — Easier nesting, but all consumers must change.
```

Self-check: `node "scripts/test-work-plan3.mjs"`.

## Legacy workflow switch

The Orchestrator below is legacy and **off unless enabled**: `/wo → Settings → Workflow (legacy orchestration)` (setting `workOrchestrator.workflow.enabled`, unset = off; the toggle reloads the session). `CE_WORKFLOW_ENABLED=1|0` overrides it. While off, `/wo` is a Utilities menu (Settings, usage, telemetry and scout; Context guard and Catch up packages appear only in the ce-workflow checkout, whether the legacy workflow is on or off), `/wo compact|fact` still work, `/wo plan [args]`, `/wo plans` and `/wo resume [plan]` run `/plan3`, `/plans3` and `/resume3`, `/wo settings|telemetry|usage` (plus `catch-up|context` in this checkout and `scout` when enabled) open those menu actions directly, and F8, research, Jev, vision, footer and compaction are unchanged; workflow actions, goals/monitor/resume/design, Fleet and F9, `work_*` tools, legacy agents/skills/settings, internal continuation commands, background verifiers and the Direct-request prompt are hidden. Saved legacy goals and action leases are not resumed while off. Only utility agents (`plan3-advisor`, `context-knowledge-discoverer`) stay discoverable; use the native `oracle` for ordinary advisory work. `scripts/verify-package.mjs` reads the same switch and prints `skip - <script> (workflow disabled)` for workflow-only tests.

While off, **Catch up packages** (run from this repository) checks only the packages ce-workflow still uses: pi-coding-agent, pi-subagents, pi-ask-user, pi-intercom and pi-lens. When any of them moved past its last reviewed version, it writes a Plan3 plan and starts planning it. The plan has a review-targets table (last reviewed → target, plus a CHANGELOG excerpt covering every intermediate release), review rules that require researching unfamiliar features before grading them, a decisions JSON block, and final steps that run `npm run verify:quiet` and then `node scripts/work-catch-up-record.mjs <plan id>`. The recorder writes exactly the planned target versions and decisions into `extensions/work-catch-up-baseline.json`, all or nothing, and refuses a missing, ungraded or unverified decision. An open catch-up plan is resumed instead of being duplicated.

## Orchestrator actions

| Action | Native behavior |
| --- | --- |
| **Initialize workspace** | Creates the native store when absent. |
| **Plan** | Creates or resumes a plan roadmap. |
| **Small task**, **Medium task**, **Large task**, **Auto-route task** | Classifies and creates one scoped work item. |
| **Resume work**, **Status**, **Blocker report**, **Roadmaps** | Resume starts the extension-owned autonomous loop for the selected target; the other actions inspect or manage native state. Roadmaps also prepares initiative child plans and converts standalone roadmaps into initiatives. |
| **Add work**, **Debug**, **Checkpoint and pause**, **Finish work item** | Mutates, checkpoints, or finalizes a native work item. |
| **Brainstorm**, **Ideas**, **Usage report**, **Telemetry** | Manages ideas and local reports. |
| **Settings**, **Context guard**, **Autonomous goal** | Choose Compact: Ultracompact (default, usually 150k), Ultrafull compact, Native, or Native 200k. |
| **Catch up packages** | Reviews changed monitored Pi/plugin releases and automatically adopts every viable feature; rejected or package-owned changes are recorded as no-action. |
| **Improve orchestrator** | Validates and deduplicates new reports, then executes all open self-improvement work in the configured source checkout. |
| **Migrate legacy workspace** | Performs the one-way migration for a detected former workflow workspace. |

Ordinary task actions use one durable `Misc` roadmap when no current roadmap is selected. When another roadmap is current, the UI asks whether new work belongs there or in `Misc`. Dedicated planning, brainstorming, and migration actions still create their own roadmaps. Untargeted **Resume work** falls back to ready `Misc` work and leaves an empty `Misc` idle. A resumable target runs autonomously until its requested scope completes or a real decision, limit, error, or explicit stop pauses it; an explicit child WorkItem ID limits the loop to that item, and questions use the main chat UI.

## Optional Plan3 design

Use `/plan3 design [plan]` (or `/wo plan design [plan]`) only when you want visual exploration. Normal Plan3 planning and `frontend-design` stay unchanged. Substantial UI may suggest the command, never force a provider run. OpenDesign executable settings remain reachable under `/wo → Settings → Utility tools` with the legacy workflow disabled.

The current single-direction flow is: settle the brief and actual production component/token mapping in the current agent → **Commission one direction** → **Check / recover** → inspect Preview/Studio and the local handoff → native human **Approve displayed revision** → reconcile the same plan's steps and `DES-*` checks → `/plan3 finish` again. Approval does not execute product code. Review summaries and recorded current-UI audits are advisory, not visual or behavioral proof. Provider questions go into the plan's Blocking questions; `/plan3 resolve` saves native user answers before continuation. Revision, canceled/failed replacement, recharge, and abandonment require explicit native choices; checking never polls or silently starts a replacement. Generate, inspect and edit in the native OpenDesign application. Plan3 does not open browser Preview/Studio windows. A direct app handoff sends the settled idea and stops; it does not automatically import exports, approve a design or reconcile the plan. Launch/show the native app before sending a new request, not over an active headless run.

After inspecting/editing and **saving** in the native app, run `/plan3 design finish [plan-id]` (also `/wo plan design finish [plan-id]` or **Finish from OpenDesign** in the design menu). It exports the plan-bound project's saved HTML page and a native PNG into a new `native-exports/<snapshot-id>/` folder, with provenance and SHA-256 hashes in `DESIGN-HANDOFF.json`. Multiple HTML pages require your selection; one page is exported per finish. It does not launch a browser, restart the app, or generate a replacement. Windows Auto discovers the running packaged sidecar through launcher metadata and the official SDK, not an obsolete alias/pipe; an explicitly configured CLI/local `OD_DAEMON_URL` is honored and ambiguous running apps require configuration.

The command asks for **human approval of the exported revision**, then sends the current agent to reconcile the **same** draft plan; `/plan3 finish` remains the separate ready boundary before implementation. Cancel/headless mode leaves the snapshot unapproved. A new collection invalidates old approval; failed/partial exports cannot be approved. Frozen HTML/PNG hashes, original brief, scope and existing reference hashes are checked before execution and work offline. Export is not desktop/mobile/behavior/accessibility verification, and prototype code remains reference-only.

Tracked snapshots live at the plan's stable `docs/designs/<date>-plan3-<id>/` pointer; raw mutation payloads remain ignored in `.pi/designs/plan3-<id>.json`. Unanswered questions or changed scope/artifacts block approval and execution. An approved, reconciled snapshot works offline/fresh clone without an OpenDesign process; live native edits are adopted only through another explicit `/plan3 design finish`; legacy structured handoffs use explicit sync. Changed/new authority requires reapproval. Missing/corrupt pending runtime requires recovery or explicit abandonment, never an invented request. Reference images require user-authorized transfer and actual inspection, are inspiration-only, and never become licensed production assets. No eligible isolated public-page screenshot capability is currently configured: supply an image instead. Windows capture is limited to the selected application window/relative crop, never desktop/monitor; hidden/GPU freshness is not guaranteed.

Three-direction exploration and final live-provider acceptance remain unfinished until the required real single-direction calculator checkpoint. Fake-provider and simulated native-dialog tests are not real visual approval.

## Legacy optional OpenDesign workflow

Visual design is **Off by default**. Enable **Auto** or **Required for UI** under `/wo → Settings → Visual design`; choose Standard or Strict review proof there. Configure the OpenDesign launch command only through that Settings entry, using the command/args/env JSON spec shown by OpenDesign Settings. Do not point it at `/usr/bin/od` until confirming that binary is OpenDesign—other packages commonly own that name. No API key belongs in ce-workflow settings.

When enabled for substantial UI work, `/wo redesign <objective>`, `/wo design …`, and `/wo resume` audit, commission, review, synchronize, and approve a design before implementation. Redesign intake extracts UI-specific facts from the objective, asks only unresolved audience/device/tone/reference/fidelity/accessibility questions in the main UI, and may use OpenDesign's bounded brief form. A quoted local PNG/JPEG/WebP reference is validated, copied durably, and uploaded into the isolated OpenDesign project; prompts explicitly separate principles to borrow from details not to copy. OpenDesign may contact its configured provider and network; ce-workflow uses only its local stdio MCP surface and never logs or stores provider credentials. On Windows, an installed OpenDesign bootstrap opens the normal visible desktop rather than a headless owner so the human can watch, inspect, and edit the design. Preview and Studio remain the normal human review surfaces. **Auto** can fall back to a validated text-only handoff when OpenDesign is unavailable; **Required for UI** blocks until recovery or an explicit waiver. Strict additionally requires final human visual approval.

Runtime state is local under `.pi/designs/`; validated brief, handoff, approval, and licensed reference artifacts live under `docs/designs/<owner>/`. Approval is pinned to exact hashes and becomes stale after remote or manual authority changes. Handoff v2 records explicit desktop/mobile/game target variants and preview routes or artifacts; synchronization rejects missing required target coverage. Generated prototype code is reference-only and is never imported or executed.

Troubleshooting: use `/wo design answer <id>` when OpenDesign requests clarification, `/wo design candidates <id>` to inspect and select one of three directions, `/wo design sync <id>` for stale or changed output, `/wo design revise <id>` for rejected direction or a recorded implementation deviation, and `/wo design approve <id>` only after review. A missing executable or protocol failure returns a resumable action rather than replaying a mutation. Offline package tests use a fake stdio peer; a real provider smoke is optional and may incur provider charges.

## Context compaction

In **Settings → Compact**, choose:

- **Ultracompact** (default): existing early compaction, evidence stripping, and code-first/hybrid summaries. Its usual threshold is 150k; smaller model windows reduce it safely. Code-first profiles preserve a direct request, native work-resume state, or an autonomous goal.
- **Ultrafull compact**: the same code-first evidence selection and configured **Compaction model** as Ultracompact, but the summary is saved as a real Pi compaction checkpoint, not a transient context cut. It retains Pi's configured recent tail (normally 20k) verbatim, keeping tool calls and results together. There is no rolling payload/thinking stripping before or after the checkpoint. Automatic checkpoints default to 200k after tools finish, safely reduced for smaller model windows. An explicitly configured `workOrchestrator.context.compactAtTokens` overrides this default (`/wo context set 200000` sets it to 200k). Existing Compaction model **None** remains code-only; selecting a model enables the existing hybrid summarizer and fallback. Requires Pi 0.99.1+.
- **Native**: Pi's normal compaction threshold and native summary. No Ultracompact summaries, rolling cuts, or payload/thinking stripping. Legacy Context guard Off now selects this mode too.
- **Native 200k**: Native behavior plus a forced checkpoint by 200k context tokens, lowered to leave proxy/output headroom (about 171k for a 272k advertised window). It uses Pi's own native summary generator and supported `turn_end` checkpoint entries after tool execution, without calling the aborting manual-compaction API during a live turn. Oversized native summarization requests—including manual/native safety compaction—are split using Pi's normal serialization and merged through its native summary prompt. Each request has a two-minute deadline; failure leaves the original transcript intact. Requires Pi 0.99.1+.

**Research suspends automatic Ultrafull checkpoints and the forced 200k trigger**, just as it suspends Ultracompact filtering; native context-limit protection remains. **F8 always forces compaction**, including in research. When busy in Ultrafull, a native mode, or research, F8 queues a checkpoint for the next completed-tool boundary. Settings can be global or project-specific; `/wo context ultracompact|ultrafull|native|native-200k` selects the project mode and `/wo context status` shows it.

Short reusable facts can be stored explicitly with `/wo fact add`, found with `/wo fact search`, and browsed newest-first with filtering and deletion via `/wo fact show`. Project facts stay in ignored `.ce-workflow/local/knowledge.jsonl`; user facts use `~/.pi/agent/knowledge/claims.jsonl`. Relevant live claims are injected as bounded untrusted data on ordinary turns, native compaction, and active microcompact filtering. Stale, superseded, rejected, unrelated, or secret-shaped claims are not injected. The model-facing `knowledge` tool can record only observed/inferred claims and cannot alter human/verified claims. An optional model-and-effort **Knowledge discoverer** in `/wo → Settings` can inspect removed context asynchronously and store a bounded set of durable claims; it is off by default and never blocks compaction.

The lightweight modes' summary size is a rolling target, not a license to clip protected chronological user requests or the prior checkpoint. Their local fallback can exceed that target to preserve those records. Oversized hybrid model requests skip the provider and retain local memory instead of entering ACP's preflight summarization loop; exceptionally large verbatim user history may still require native semantic summarization to fit the active context.

Do not install another automatic compaction extension into the same Pi profile. Native modes use Pi's native summary generator; Ultracompact and Ultrafull use the selected code-first or hybrid formatter. Ultrafull is an alternative for comparison, not a verified fix for post-compaction looping. The optional Knowledge discoverer remains separate.

Role agents are `work-planner`, `work-worker`, `work-reviewer`,
`work-fixer`, `work-debugger`, `work-committer`, `work-migrator`, the
tool-free `work-divergent` generator, and three configurable advisor roles:
`work-advisor`, `work-advisor-2`, and `work-advisor-3`. Configured advisors
review completed brainstorm and plan artifacts in parallel. During autonomous
Resume, the active project goal owns each routine WorkItem from claim through implementation, proof,
correction, and coded finalization; it does not fracture that window into a
fresh `work-worker`. Specialists remain available for coded planning, debug,
review, or fix exceptions. They use `scripts/work-helper.mjs` native helpers
for compact summaries, initiative hierarchy, preview/apply, children, ready,
claim, note, label, capability proof, and blocker operations.

## Creative sidecar

`/wo → Settings` → **Creative sidecar** supports **Off**, **Ask** (default), and
**Auto**. Ask offers Quick or Wide for direct brainstorms, large tasks, and new
master plans; Auto chooses Wide without another prompt. Wide runs three fresh,
mutually isolated `work-divergent` branches under fixed cognitive frames, forms
the ordinary baseline independently, then merges only constraint-compatible
candidates before the configured advisors critique the result. Generator
branches use the dedicated **Brainstorm / Ideate** model selection; with
Inherit configured, all three still run as separate contexts on the current
model. When the optional `chatgpt_consult` tool is installed, that menu and the
Advisor 1–3 menus also offer **ChatGPT Web**. The creative selection uses
isolated temporary chats for brainstorming and ideation, while advisor
selections use persistent advisor mode for critique. Existing
`wo:divergent-analysis` provenance is reused instead of regenerating it.

## Background verifiers

`/wo → Settings` → **Background verifiers** configures zero, one, or many profiles. New profiles start as **Model: [Inherit: High]** with **Test coverage** enabled; Inherit is stored as-is and resolves to the active session model only when a verifier is launched. Each profile has one unique model identity, independent checks, and a thinking effort. Global profiles apply by default; project profiles override a matching model, and a project removal is a tombstone that disables an inherited profile. Removing the last check disables that profile.

Every normal commit or checkpoint snapshots the selected scope and schedules each enabled profile asynchronously. `/wo → Analyze` uses one main menu to select checks, verifier models, and an immutable scope: current changes, last commit, whole project, or repository-relative paths/globs. Verifiers read only that immutable snapshot; they never write code or affect the active checkout.

Ordinary completion verification keeps its compact raw-finding triage: at the next `/wo → Resume work`, validate each completed group, record accepted, rejected, or stale with a reason, then fix and verify accepted findings. Manual **Analyze** results instead enter `/wo → Analysis findings`, grouped by category. Model-recommended findings start as dark `[auto on]`; rejected suggestions start as dark `[auto off]`. Space switches either to the brighter manual `[on]` or `[off]` state, while Enter shows the full description, evidence, and model reasoning and offers discussion in chat. **Accept approved** creates only enabled findings as tasks under a new `Analysis [datetime]` roadmap, then removes those findings from the inbox. **Discard all** retains the rest in gray and suppresses equivalent findings in later analyses. No executable work is created before approval, and Resume surfaces unresolved analysis first. Running and failed jobs never block a resume. Commits made only for accepted verifier fixes do not schedule another verifier batch.

`/wo → Status` exposes `not-configured`, `queued/running`, `failed/orphaned`, `completed-awaiting-triage`, or `fully-triaged`. Durable state, recovery copies, and private raw runtime reports live under `.ce-workflow/work-runs/verifiers/`; use `/wo → Status` to recover after interruption and `/wo → Resume work` to triage when reports complete. Late valid reports from acknowledgement-timeout/orphaned launches remain recoverable. A triaged group stays out of later resumes unless explicitly reopened.

Verifier source text and reports are untrusted data. The `work-background-verifier` role is isolated to checkpoint read/list/find/grep tools: no writes, shell, network, credentials, commits, or agent launches. Its advice is attributable and advisory; it neither replaces nor satisfies the required foreground review and finish gates. Verification is checkpoint-scoped, not a whole-repository patrol.

## Read-only lanes

Current-task discovery and debug can use bounded read-only lanes. Their versioned envelopes and recovery state live under `.ce-workflow/work-runs/read-only-lanes/`; `/wo → Status` reports lane kind, WorkItem, generation, checkpoint/HEAD, lifecycle, resource claims, age, reason, and concurrency/waste metrics. Same-key lanes serialize locally, while independent keys may overlap up to the configured bound. Results promote only when their generation and before/after HEAD, source, untracked-file, and WorkItem-store fingerprints still match. Cancelled, stale, late, mutation-producing, or dead-local-runner results are discarded, failed, or orphaned and never attributed as a writer commit or used to queue committed-scope verifiers.

Finish may split one authoritative `--verify` command into repeated trusted `--verify-shard` JSON declarations. Each declaration names an id, exact command, optional `dependsOn`, `resourceKeys`, and repository-relative generated `outputs`; the authoritative command must equal the declared commands joined in order with ` && `. Only the finish invocation's repository-lock owner runs these nonmutating shards in the primary checkout. Dependency, resource, and overlapping output claims serialize; independent claims overlap within the bound. Immutable background review still uses the existing verifier checkpoint workspace and remains advisory to the foreground review policy.

Shard results join in declaration order into the exact version-1 finish manifest with command, exit status, bounded output hash/tail, real and virtual timing, claims, base HEAD, source fingerprint, and gate/schema versions. Admission requires the same invocation, schema, gate, command set, HEAD, fingerprint, required PASS set, and ordered checkpoint-review evidence. Missing, duplicate, stale, late, forged, mutated, or non-PASS evidence fails closed and cannot commit or close; ordinary finish without declarations retains the authoritative serial-command fallback and its single compact `wo:verify-check` note.

`/wo → Settings → Performance tweaks` contains global-only switches for parallel/sequential read-only lanes, verification shards, background verifiers, and advisors. Verification defaults to sequential; read-only lanes, background verifiers, and advisors default to parallel. `WORK_ORCH_SERIAL=1` temporarily forces every performance path to sequential/off without changing saved settings. These controls do not disable background-verifier recovery or all-findings resume triage. `finish-task`, `finish-small`, and coded **Finish work item** hold the repository mutation boundary for their complete invocation, including verification; competing lanes cannot enter the primary checkout. These PID/resource locks are intentionally single-host. Do not share one checkout between hosts without an external lock service.

## Workflow rules

- One executable work item remains each deterministic execution boundary; **Resume work** continues across those boundaries autonomously.
- Use `/wo → Checkpoint and pause` to persist a checkpoint, then `/wo → Resume work <roadmap-id>` in a fresh session.
- Press **F9** for Fleet: the main-chat orchestrator is the root, with active and recent finished specialists, successor-prefetch lanes, and background verifiers beneath it. Fleet distinguishes running, queued, waiting-for-decision, paused, completed, stopped, and failed states.
- `/wo → Status` and `/wo → Blocker report` are deterministic local projections; do not edit the store by hand during normal use.
- Initiatives aggregate child progress and route explicit execution through their durable child order. Planning a child returns to the `/wo` menu instead of starting implementation; execution consumes the prepared prefix and pauses at the first child that needs planning. Initiative close cannot be forced past unresolved coverage, stale source/plan lineage, or open children. /wo previews complete hierarchy and coverage before its confirmation mints the single-use apply receipt.
- An implementation-ready plan with a validated JSON `implementationUnits` manifest materializes those WorkItems directly; headings alone do not assert readiness, and Resume does not launch a second planner.
- Every materialized WorkItem carries a capability-driven verification contract. Capabilities are per item (`inspection`, `command`, `service`, `browser`, `desktop`, `android`, `device`, `macos`, `ios`, or `manual`), so mixed repositories need no global application type.
- Finish requires every declared proof plus any required review before the store item closes. Browser, desktop, and Android visual proof is revision-bound to a retained screenshot and a recorded goal/human inspection; unavailable required capabilities block rather than degrade to PASS.
- Manual changes are classified before writer work starts. No parallel writers, automatic branch checkout, or push automation.
- Real hardware or product proof is not replaced by mocks without approval.

## Legacy migration

For a repository with the former tracker workspace, use only:

```text
/wo → Migrate legacy workspace
```

The migration command is idempotent, validates export parity, keeps an ignored backup, migrates role settings, and stops safely on lock, source-change, corruption, or recovery errors. Normal commands stop and point to this command until migration completes. The migration boundary is the only packaged code that can invoke the legacy exporter.

## Explicit workflow maintenance

Ordinary project work never activates self-improvement reporting, injects improvement duties, or exposes `work_report_improvement`; legacy `workResume.selfImproving` settings are ignored. Maintenance starts only from an explicit user action: `/wo → Improve orchestrator`, `/wo monitor`, or `/wo → Catch up packages`. The monitor retains its bounded decision and safe-reload gates, and improve/catch-up continue through the normal work-goal lifecycle; none of these paths starts automatically during project development.

Extension scouting is gated off by default, including its menus and persisted progress display. Set `CE_WORK_EXTENSION_SCOUT=1` before starting or reloading Pi to re-enable it.

## Workflow evaluation harness

The standalone harness compares one declared workflow factor against immutable calculator and CSV-expenses bundles. Work-stage samples finalize native items in `.ce-workflow/work-items.json`; the harness does not require a tracker CLI. The deterministic adoption replay (`node scripts/run-work-slice-benchmarks.mjs`) records three calculator and CSV pairs, quality, runtime, novel/cached context, provider-token totals, ownership, verifier use, and specialist counts in `benchmarks/work-slice-adoption.json`; changes below 10% are reported as noise.

Run the directly usable diagnostic descriptor from the package root:

```bash
node scripts/workflow-evaluation.mjs benchmarks/workflow-evaluation/v1/experiments/smoke.example.json
```

Every invocation uses `node scripts/workflow-evaluation.mjs <descriptor.json>` and prints retained artifact paths such as `evidencePath` and, when applicable, `reportPath` under a new operating-system temporary directory. Disposable sample workspaces are removed; the source checkout and versioned bundles must remain unchanged.

| Mode | Authority |
| --- | --- |
| `smoke` | One pair for fast failure detection. Always non-decision-grade. |
| `calibration` | Three unchanged pairs that establish noise and per-project/stage budgets without weakening fixed quality or cost floors. |
| `decision` | Three alternating fresh pairs with blinded scoring. Requires a matching calibration and fresh SHA-bound human golden approval. |
| `golden-update` | Records generated artifact hashes and acceptance evidence; it mutates approval records only after explicit human approval. |
| `sentinel` | Runs both projects through actual brainstorm → plan → work handoffs without golden substitution. Requires current approvals and calibration for all six project-stage combinations. |

The frozen model-role campaign lives in
`benchmarks/workflow-evaluation/v1/experiments/model-role-campaign.example.json`.
Its companion `role-smoke.example.json` is always non-decision-grade: one
retained diagnostic pair per exact role/model/effort arm may block only that
arm for wiring, capability, provenance, or harness failure. Smoke never ranks
candidates or promotes one because another provider is unavailable. Campaign,
pricing, seed, budgets, retry policy, approved endpoints, payload visibility,
evaluator identities, and 30-day evidence expiry must be fingerprinted before
the first paid sample. Provider credentials remain in host provider clients and
live smoke requires explicit billing authorization.

`role-calibration.example.json` freezes three unchanged pairs per applicable
project/role cell. Incumbent and finalist calibrations bind the exact bundle,
role map, prompt/tools/context, evaluator panel, seed, price table, endpoint,
rubric, and runtime fingerprints. Decisions use the conservative maximum of
both records; a missing finalist record returns `needs-more-evidence`, while a
stale or tampered record fails closed. Calibration evidence is explicitly
non-decision-grade and never enters decision aggregation.

`role-decisions/u8.example.json` freezes the U8 confirmatory matrix for
brainstorm, planner, migrator, and advisor-backup. Every contrast requires three
alternating pairs, exact identity and telemetry, two-sided calibration, and
agreement from both blinded evaluators. Unavailable, disagreement, stale, or
insufficient evidence can only produce unavailable, no-winner, or
`needs-more-evidence`; U8 never changes defaults, and committer remains the
configured deterministic control.

`role-decisions/u9.example.json` applies the same fail-closed protocol to worker,
fixer, debugger, and reviewer cases. Product behavior, verification, repository
finalization, and source immutability are hard gates checked before cost; U9
reuses U8 committer evidence and does not change defaults.

`critique-decisions/u10.example.json` freezes the shared-high 2x3 critic
factorial, declared effort cells, fixed reviser, signed empty controls, and the
optional balanced dual-critic interaction. Writer/reviser samples require real
writable fixtures; missing calibration, consumption, or valid lifecycle evidence
returns `needs-more-evidence` and cannot change defaults.

The completed U8-U10 campaign authorized no integrated mapping, so U11 retains
provider-neutral defaults and does not synthesize live sentinels or presets. A
future mapping must have fresh evidence, complete shared-role coverage, exact
observed identities, evaluator agreement, and both real project sentinels before
it becomes eligible for explicit adoption.

The other files in `benchmarks/workflow-evaluation/v1/experiments/` are starting templates. Replace every `replace-with-*` value with a retained path before running them. Missing provider credentials, evaluator access, browser capability, provenance, telemetry, calibration, or approval fails closed and cannot become passing or decision-grade evidence. Sentinel runs are mandatory for handoff, artifact, routing, finalization, default-behavior, extension, prompt, skill, agent, or otherwise non-narrow changes; documentation, benchmark-fixture, and focused test-only changes are narrow.

Candidate extensions execute with full process permissions. Path containment and fresh disposable roots protect benchmark integrity but are **not a hostile-code sandbox**. Only run trusted candidates with `"trusted": true`; untrusted candidates require `"isolation": "os"` plus an external `sandboxCommand`. Reports sanitize credential-like fields and authority-resource paths; hidden contracts, unshown answer-bank data, unselected goldens, evaluator labels, and undeclared environment differences are never exposed to the tested workflow.

CI gating, dashboards, and a `/work-*` UI wrapper remain deferred until local calibration proves the standalone harness reliable and affordable.

## Smoke checks

A clean native smoke needs no legacy executable or workspace:

```bash
node scripts/test-work-store.mjs
node scripts/test-work-store-performance.mjs
node scripts/test-work-start-finish.mjs
npm run verify
```

A legacy migration smoke is covered by:

```bash
node scripts/test-work-remove-beads.mjs
node scripts/test-work-remove-beads-windows.mjs
```

`npm pack --dry-run` verifies the publish surface. `npm run verify:quiet` is the compact package gate.
