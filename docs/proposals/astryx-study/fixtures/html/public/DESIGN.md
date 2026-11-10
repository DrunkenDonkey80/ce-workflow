# Relay design system (prototype)

## Visual system
- Cool grey workspace with white surfaces and deep ink text; neutrals carry most of the screen.
- One accent: hi-vis signal yellow, always cased in ink. It appears on the **handoff line** (the signature) and the primary action.
- Bahnschrift (DIN-style signage face) for headings, the handoff line and counts; Segoe UI for body and data.
- Phone-first single column; at 760px and up the project list becomes a ruled, table-like list, not a grid of cards.

## Signature: the handoff line
A transit-style line in `--accent` with an ink casing. Each stop is a project in due-date order (evenly spaced, because it is a sequence, not a time scale). Labels alternate above and below so codenames stay legible at 360px. Stop markers use status shapes: filled dot = Active, half-filled = Review, hollow ring = Planned, ring with two bars = Paused. The legend under the line doubles as the derived status counts.

## Color tokens (`styles.css :root`)
| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | #edf0f3 | #13181f | page |
| `--surface` | #ffffff | #1b222b | panels, inputs |
| `--surface-sunk` | #e3e8ed | #232b36 | hover, skeletons, prototype chrome |
| `--ink` | #17202b | #e8ecf1 | text, selected segments |
| `--ink-muted` | #4f5b6b | #a9b3c0 | secondary text |
| `--line` / `--line-strong` | #c6ced8 / #77838f | #333d49 / #7d8996 | dividers / control borders |
| `--accent` | #f2c200 | #f2c200 | handoff line, primary button |
| `--on-accent` | #17202b | #17202b | text and casing on accent |
| `--focus` | #17202b | #f2c200 | 3px focus outline |
| `--danger` | #a3261b | #ff9c90 | field errors, error state |
| `--status-*` / `--status-*-tint` | green (Active), blue (Review), slate (Planned), amber #7a4a00 on #f6ecd8 (Paused) | lighter on dark tints (Paused #f0c98a on #3a2e1a) | status badges only |

Status is never color-only: every badge has a shape icon and the word.

## Type scale (1.25)
13 / 16 / 20 / 25 / 31 / 39 px (`--step--1` to `--step-4`). Body 16px, line-height 1.5. Headings 1.15. `text-wrap: balance` on headings, `pretty` on paragraphs.

## Spacing, radii, targets
- 4px rhythm: `--space-1`..`--space-7` = 4, 8, 12, 16, 24, 32, 48.
- Radii by hierarchy: panels 4px, controls 8px, status pills fully round.
- `--target` 44px minimum height for every button, link, field and segment.

## Components and states
- **Header**: brand mark + workspace name, team, Projects/Settings nav (`aria-current`), MC avatar. Under 420px the team line and nav icons hide.
- **Button**: default (outline) and primary (accent). Hover tint, `:active` 1px press, `:focus-visible` ring, `:disabled` 50% opacity.
- **Segmented radio group**: status filter (All/Active/Review/Planned/Paused) and the prototype state switcher. Checked = ink fill; focus ring inset.
- **Filter bar**: search (project or owner name), status segments, and an outline **Reset filters** button that is always visible (start-aligned under the segments on phone, third column on desktop).
- **Project row**: name (h3), owner, status badge, due date, Edit. Phone: name + Edit on top, meta wraps below. Desktop: five-column ruled row with an `aria-hidden` column header; `dt` labels stay for screen readers.
- **List states**: populated, filtered no-results (Clear search and filter), loading (spinner + label + 3 skeleton rows, `aria-busy`), empty (headline, one sentence, Reload project list), error (what happened, filters kept, Retry).
- **Edit dialog**: native `<dialog>` modal; name (required, error below field on blur/save), owner and status selects, native date input; Cancel / Save project. Focus is trapped, Escape and Cancel discard. The dialog scrolls inside the viewport, and the action row is sticky at its bottom edge (surface background, top divider) so Save and Cancel stay reachable when the form is taller than a phone screen.
- **Settings**: grouped panels; `role="switch"` checkboxes with visible On/Off and Light/Dark text; Save settings with a session-only acknowledgement.

## Motion
Dialog fades/slides 8px in 200ms; buttons and switches transition 150–200ms. `prefers-reduced-motion` removes animation and the skeleton pulse.
