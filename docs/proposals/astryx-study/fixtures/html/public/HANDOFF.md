# Relay prototype handoff

## Files
- `index.html` + `app.js`: dashboard (overview, handoff line, project list, edit dialog, prototype state switcher).
- `settings.html` + `settings.js`: workspace name, notifications switch, appearance switch.
- `styles.css`: shared tokens and components (see `DESIGN.md`).
- No external assets, fonts or network calls. Fonts are local system faces (Bahnschrift, Segoe UI) with system fallbacks.

## Behavior notes
- All state is in memory. Edits and settings reset on reload or navigation; the UI says so in the edit dialog and on Settings.
- Counts, "Due next", "Waiting for review", the summary sentence and the handoff line are derived from the six sample projects and update after Save.
- Search matches project name or owner name (case-insensitive substring) and combines with the status filter (All/Active/Review/Planned/Paused). The visible "Reset filters" button and the no-results "Clear search and filter" button both clear search and status and return focus to search.
- Paused is a fourth status in the filter, edit form, badges, handoff-line markers and counts. No sample project starts Paused, so its count is 0 until a project is edited to Paused.
- On phones the edit dialog scrolls internally and its Save/Cancel row is sticky at the bottom, so both stay on screen even with the long Fjord title and the name error showing.
- The list keeps its fixed sample order; the handoff line sorts by due date. A project with no due date shows "No due date" and sorts last.
- After Save, focus returns to that row's Edit button. If the edit hides the row under the current filter, focus moves to the results line and the save note says it is hidden.
- The edit dialog title and the Edit button's accessible name use the full project name.
- The state switcher (`data-design-chrome`) is prototype chrome, not product UI. It controls only the project list area; the overview stays populated by design.
- The appearance switch applies immediately on the Settings page only; the dashboard always opens in light mode because nothing persists.

## Inspectable ids
Required ids are present in the rendered DOM: `project-search`, `status-filter` (options `status-filter-all|active|review|planned|paused`), `reset-filters`, `state-switcher`, `project-list`, `project-<id>` and `edit-<id>` rows/buttons, `edit-project-dialog`, `project-name`, `project-owner`, `project-status`, `project-due`, `save-project`, `cancel-project`, `workspace-name`, `notifications`, `appearance`, `save-settings`. `notifications` and `appearance` are on the `<input role="switch">` itself; the clickable label wrappers are `notifications-switch` and `appearance-switch`.

## Known gaps
- Bahnschrift exists on Windows; on other systems headings fall back to DIN Alternate or the system sans, which loses some of the signage character.
- Handoff-line labels use the first word of each name and truncate past 7.5rem; full names are read by screen readers and shown in the list.
- No real "today", so the overview does not mark overdue work.
