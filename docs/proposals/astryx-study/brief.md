# Relay: a project dashboard for a distributed delivery team

Build an interactive app design, not production software. A project lead checks work and makes small updates from a phone while away from their desk. The desktop screen should support scanning without becoming a wall of identical cards.

Deliver `public/index.html` (dashboard) and `public/settings.html`, shared `public/styles.css`, local scripts/assets, plus `public/DESIGN.md` and `public/HANDOFF.md`. Keep source/build scripts outside public. One HTML file per screen; no backend, login, real network or persistence. All assets must work with external network requests blocked. The preview has an opaque sandbox origin: localStorage/sessionStorage/cookies are unavailable. State is intentionally in memory and resets on navigation/reload.

## Content (fixed sample data, do not invent business metrics)
Workspace: Relay. Team: Field operations. Signed in as Maya Chen (MC).
Columns/attributes: project name, owner, status, due date.
- atlas: Atlas mobile rollout | Maya Chen | Active | 18 Nov 2026
- beacon: Beacon accessibility audit | Sam Okafor | Review | 20 Nov 2026
- cedar: Cedar partner portal | Lina Park | Active | 24 Nov 2026
- delta: Delta incident playbook | Arun Shah | Planned | 27 Nov 2026
- ember: Ember release checklist | Jo Rivera | Review | 30 Nov 2026
- fjord: Fjord field-research synthesis and next-quarter recommendations | Maya Chen | Planned | 04 Dec 2026

Use the data to derive any counts. Overview should make the current work and next action clear; no fake charts. Visual direction: calm, legible professional workspace with one deliberate visual signature; not a generic marketing hero. Color/type/layout choices are yours. Use available local/system fonts and simple inline SVG where needed.

## Required behavior
- Header, overview, project list and visible navigation to Settings and back.
- Search projects by name; status filter All/Active/Review/Planned. Filters combine, results update, and no-results has a useful way back.
- Each project has an Edit button. Open a modal with project name (required), owner (fixed list), status (fixed list), and due date. Save updates the visible row and derived counts. Cancel and Escape discard edits and return focus to the opener. Blank name produces an adjacent error while retaining input. Trap keyboard focus within the modal. Use a real date input or an equally accessible component.
- Settings page: workspace name (required, initially Relay), notification switch, light/dark appearance switch, and Save settings with visible acknowledgement. No false implication of server persistence.
- A small prototype state switcher, marked `data-design-chrome`, exposes Populated/Loading/Empty/Error for the project-list area. Loading is legible; Empty has one helpful action; Error explains the failure and has Retry returning to populated. Keep navigation usable in all states.
- Work at 360, 390, 820 and 1440px widths plus 844×390 landscape. No horizontal page overflow. Phone targets at least 44×44px; no hover-only controls. Long project names and reduced motion must work.
- Semantic labels/headings, visible focus, color contrast, keyboard support, no color-only status. Honor the two supplied craft guides, but this brief wins on conflicts.

## Inspectability contract (for our design studio)
Give every meaningful region, heading, row, button and field a stable unique `data-id` in the rendered DOM. These required IDs are part of the app contract (other IDs are up to you):
- `project-search`, `status-filter`, `state-switcher`, `project-list`
- rows `project-atlas`, `project-beacon`, etc.; edit buttons `edit-atlas`, `edit-beacon`, etc.
- `edit-project-dialog`, `project-name`, `project-owner`, `project-status`, `project-due`, `save-project`, `cancel-project`
- `workspace-name`, `notifications`, `appearance`, `save-settings`
If a library puts an ID on a field wrapper, its named input must be inside that wrapper. The ID must not exist only on a React fragment. No global test hooks needed.

## Process and checks
Read `frontend-design.md`, `design-guide.md`, and `TREATMENT.md`. State the visual system in 3–5 lines, then build the entire first pass. Do not seek more requirements; the brief is complete. Do not add pages/features beyond this scope.

You have the same local Chromium/Playwright and the existing studio renderDesign renderer as the other arm. Run `node "../look.mjs"` from your own cwd after building; it saves phone/desktop screenshots and reports under your own `checks/`. Read those images, correct reported defects, and perform a small interaction self-check using the provided Playwright installation. Do not endlessly re-render. Record commands actually run and limitations in `CHECKS.md` at your cwd. Never claim a test passed from inspection alone.

Boundary: write only within your own cwd. Read only your own fixture/tooling, the supplied parent look.mjs, and the explicitly provided installed dependency paths. No sibling-arm inspection, prior research reports, repository changes, git operations, network research, delegation or external agent CLI. This is an approved temporary research fixture, not permission to change product code. Stop and report setup/tool failures rather than silently changing the experiment. Use double quotes around shell paths and arguments containing spaces/shell metacharacters.

At the end, give a short completion report with output paths, checks, and known gaps. Do not perform the later refinement yet.
