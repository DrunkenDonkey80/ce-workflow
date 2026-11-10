# Relay design system (prototype)

Relay is a calm field-operations workspace. Its one deliberate signature is the **relay rail**: the six due dates as hand-off stops on a single track, with the first one due filled in the accent. Everything else stays quiet: ruled rows instead of a card grid, neutral surfaces and status colour only where status is shown.

Built on Astryx core 0.7.12 with the neutral theme 0.7.12. Relay overrides the theme's colour and font tokens in `styles.css` (unlayered rules, so they win over Astryx's cascade layers).

## Colour tokens

Every token is a `light-dark()` pair; the Astryx `Theme` mode sets `color-scheme`, so one set of names serves both modes.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--relay-body` | #edf0ee | #121715 | Page background (cool mineral grey, not cream) |
| `--relay-surface` | #fafbfa | #1a201e | Header, overview, list, dialog, settings form |
| `--relay-ink` | #18211e | #e6ece9 | Primary text |
| `--relay-ink-muted` | #4a5652 | #a3afaa | Labels, meta text (6.7:1 on body in light) |
| `--relay-line` | #cdd5d1 | #313a37 | Row rules, panel borders |
| `--relay-line-strong` | #788581 | #6f7b77 | Rail track, rail stop rings, prototype outline (3.7:1 on surface in both modes) |
| `--accent` | #0e5a6b | #7cc6d6 | Petrol. Current nav tab, next rail stop, primary buttons |
| `--on-accent` | #f4f9f9 | #0e1a1d | Text on accent |
| `--accent-wash` | #dcebee | #1d3a41 | Just-saved row flash |
| `--status-active` / `--status-review` / `--status-planned` / `--status-paused` | Astryx success text / warning text / ink-muted / info text | | Status shapes only |

Mapped onto Astryx tokens: `--color-background-body/surface/card/popover`, `--color-text-primary/secondary`, `--color-border`, `--color-border-emphasized`, `--color-accent`, `--color-text-accent`, `--color-icon-accent`, `--color-on-accent`, `--color-accent-muted`.

Accent budget: on the dashboard the accent appears in the current nav tab and the next rail stop. Primary buttons only appear inside the dialog and the empty/no-results states.

## Type

- Display: Bahnschrift (Windows DIN signage face), falling back to DIN Alternate, Segoe UI Variable Display, system-ui. Used for h1–h2, dates, counts and the rail.
- Text: Segoe UI Variable Text / Segoe UI / -apple-system / system-ui. Body and controls.
- Scale 1.25 on 16 px: `--step--1` 13, `--step-0` 16, `--step-1` 20, `--step-2` 25, `--step-3` 31, `--step-4` 39.
- Body line height 1.5, headings 1.0–1.25 with `text-wrap: balance`; paragraphs `text-wrap: pretty`.
- No all-caps labels, no monospace labels.

## Spacing, radii, targets

- 4/8 px rhythm: 4, 8, 12, 16, 20, 24, 32, 48, 64.
- `--radius-panel` 12 px (overview, list, settings form); `--radius-control` 8 px (prototype chrome). Astryx controls keep their own radii.
- `--target` 44 px: on phone layouts (`max-width: 759px` or `max-height: 500px` for landscape) every button, segment, field, switch hit area and the date picker button is at least 44×44.

## Layout

- Header: brand (Relay mark, workspace name, team) + nav (Projects, Settings) + avatar. Phone: nav drops to its own row of 44 px tabs.
- Dashboard: title, overview band (Due first | Waiting for review | status counts, then the relay rail), projects section (heading + live count, search + status filter, list), prototype state switcher at the end.
- List: under 760 px each row is the name with its Edit button, then a wrapping meta line (owner, status, due). From 760 px it becomes a ruled five-column grid with a visual column header (owner, status, due, action).
- Settings: one surface split into Workspace, Notifications, Appearance groups, then the save row. Max width 760 px.

## Components and states

| Part | Built from | States |
| --- | --- | --- |
| Header nav | Native links | default, hover, focus-visible ring, current (`aria-current`, accent underline) |
| Search | Astryx `TextInput` type search, clear button; matches project or owner name | empty, typed, cleared |
| Reset filters | Astryx `Button` ghost, after the status filter | clears search and status, focuses search |
| Status filter | Astryx `SegmentedControl` (radio group) | All / Active / Review / Planned / Paused |
| Status badge | Astryx `Badge` (green / yellow / neutral / blue) + shape icon | full, half, empty circle, pause bars: never colour alone |
| Project row | Native `li` + `h3` + Astryx `Button` | default, just-saved flash (off with reduced motion), long names wrap |
| Edit dialog | Astryx `Dialog` (purpose form; the dialog scrolls and its footer is sticky so Save/Cancel stay visible on short screens), `DialogHeader`, `Layout`, `TextInput`, `Selector` ×2, `DateInput` | open, name error (detached message, `aria-invalid`), saving closes |
| List states | Astryx `Skeleton` + `Spinner`, `EmptyState`, `Banner` | populated, loading, empty (one action), error (Retry), no results (clear search and filter) |
| Overview | Native `dl`/`ol` | populated; a one-line note in loading/empty/error |
| Settings | Astryx `TextInput`, `Switch` ×2, `Button` | required error, saved acknowledgement (`role=status`) |
| State switcher | Astryx `SegmentedControl` size sm in a dashed `data-design-chrome` box | Populated / Loading / Empty / Error |

Focus: Astryx components draw their own focus rings; native links use a 2 px accent outline with 2 px offset.

Motion: only the 1.6 s fade of the just-saved row and Astryx's own transitions; `prefers-reduced-motion: reduce` removes the row fade.
