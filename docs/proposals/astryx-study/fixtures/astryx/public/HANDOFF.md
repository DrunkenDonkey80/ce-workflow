# Relay prototype handoff

Interactive design prototype, not production software. No backend, login, network or persistence: all state lives in memory and resets on reload or navigation (the preview origin is opaque, so storage is unavailable by design).

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | Projects dashboard |
| `settings.html` | Workspace settings |
| `styles.css` | All Relay custom rules and token overrides |
| `assets/app.js` | One IIFE bundle (React 19.3.1 + Astryx core 0.7.12 + app code); reads `#root[data-page]` to pick the screen |
| `assets/astryx.css` | Astryx reset, component CSS and neutral theme CSS, concatenated |
| `LICENSES.txt` | Notices for every package in the bundle |
| `DESIGN.md` | Tokens, type, layout, components and states |

Editable source lives outside `public/`: `src/*.jsx` and `src/vendor.css`. Rebuild with `node build.mjs` from the project folder (esbuild, IIFE, minified, `NODE_ENV=production`); it also regenerates `LICENSES.txt`. Nothing loads from the network; fonts are local system fonts.

## Behaviour

- **Header**: Projects and Settings links on both screens; the current one has `aria-current="page"`.
- **Overview**: derived from the project data. "Due first" is the earliest due date; "Waiting for review" counts Review projects and its button sets the filter to Review; status counts and total; the relay rail lists all due dates in order. Editing a project re-derives all of it. In the Loading, Empty and Error prototype states the overview shows a one-line note instead of numbers.
- **Search and filter**: search matches project name or owner name, case-insensitive, trimmed; status filter is All/Active/Review/Planned/Paused; they combine. A visible "Reset filters" button (`reset-filters`) beside the filter clears both and focuses search. No sample project starts as Paused, so the Paused count starts at 0 and filtering Paused shows the no-results state until a project is edited to Paused. A live status line reads "Showing n of 6". No results shows one action, "Clear search and filter", which resets both and focuses search.
- **Edit dialog** (Astryx Dialog, `purpose="form"`): name (required), owner (fixed list of the five team members), status (fixed list, now including Paused), due date (Astryx DateInput: typed date or calendar popover on fine pointers, the OS picker on touch). Save writes the row, flashes it, announces "Saved changes to …" and returns focus to the Edit button. Cancel and Escape discard the draft and return focus to the opener. A blank name keeps the dialog open, shows "Enter a project name. It can’t be blank." under the field, sets `aria-invalid`, focuses the field and keeps every other edit. Validation runs on save and the error clears as soon as text is typed; blur validation was dropped because it stole the focus move back to the field. Astryx contains Tab/Shift+Tab inside the dialog. When the form is taller than the viewport the dialog scrolls and its footer (`edit-project-actions`) sticks to the bottom, so Save and Cancel stay visible. The header close button was left out on purpose: its focus tooltip took the first Escape press, so Escape did not close the dialog in one press.
- **Prototype state switcher** (`data-design-chrome`, end of the dashboard): Populated, Loading (spinner + "Loading Field operations projects…" + skeleton rows), Empty (one action "Check again", returns to populated), Error ("Projects didn't load", why, that search and filter are kept, "Retry" returns to populated). Header, search and filter stay usable in every state.
- **Settings**: workspace name (required, starts as Relay, error on blank), Project updates switch, Dark appearance switch (previews immediately on this page), Save settings. Saving shows "Settings saved for this session. They reset when you reload or leave this page." and updates the header name. The intro says nothing is sent to a server. Because state is in memory, dark mode and the new name do not carry over to the dashboard.

## Inspectability (`data-id`)

Required ids and where they land in the DOM:

- `project-search`: the search `<input>` itself.
- `status-filter`: a `role="group"` wrapper holding the visible "Status" label and the Astryx radio group; segments are `status-filter-all|active|review|planned|paused`.
- `state-switcher`: the `data-design-chrome` aside; segments `state-populated|loading|empty|error`.
- `project-list`: the list area wrapper in every state (`data-state` says which); rows are inside it.
- Rows `project-atlas` … `project-fjord` (`li`), with `project-<id>-name|owner|status|due`; Edit buttons `edit-atlas` … `edit-fjord`.
- `edit-project-dialog`: the native `<dialog>`. `project-name` and `project-due` are the `<input>`s; `project-owner` and `project-status` are the Selector combobox `<button>`s; `save-project`, `cancel-project` are the buttons.
- `workspace-name`: the `<input>`. `notifications` and `appearance`: Astryx puts these on the Switch field wrapper; the `input[role="switch"]` is inside it. `save-settings`: the button.

`reset-filters` and `count-paused` were added in the refinement. Other ids cover regions, headings, overview parts, rail stops and state views (`list-loading`, `list-empty`, `list-error`, `list-no-results`, `clear-filters`, `error-retry`, `empty-check-again`, `show-review-queue`, …).

## Astryx usage notes

- Theme: `<Theme theme={neutralTheme} mode="light|dark">` from `@astryxdesign/core/theme` and `@astryxdesign/theme-neutral/built`.
- Relay retunes tokens instead of swizzling components. Phone touch-target rules (44 px) live in `styles.css` under `@media (max-width: 759px), (max-height: 500px)`, because Astryx only enlarges hit areas for coarse pointers.
- `data-*` props pass through Astryx components: onto the input for TextInput and DateInput, the trigger for Selector, the button for Button and SegmentedControlItem, the `<dialog>` for Dialog, and the field wrapper for Switch.

## Known gaps

- Owner and status use Astryx Selector (an ARIA combobox and listbox), not a native `<select>`, so automation must click the option rather than call `selectOption`.
- DateInput shows "Nov 18, 2026" style in the field while rows use "18 Nov 2026".
- No create or delete project flow (out of scope).
- Bahnschrift is a Windows font; macOS/iOS fall back to DIN Alternate or the system UI face, which softens the signature type.
