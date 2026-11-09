# OpenDesign: what we took and where it lives

Upstream: [nexu-io/open-design](https://github.com/nexu-io/open-design) (Apache-2.0). Ported at commit `07a86b1` (2026-11-09) in plan `docs/plans/2026-11-09-own-design-studio-in-the-hub-drop-opendesign-pi-designs-dire-a5cf234d-plan3.md`. ce-workflow no longer runs OpenDesign; its design studio lives in the hub (`extensions/design.ts`, `hub/web/design-view.ts`).

`/wo → Catch up packages` watches this repository (entry `nexu-io/open-design` in `extensions/work-catch-up-baseline.json`). OpenDesign commits many times a day, so the diff covers only these review paths:

- `craft/`, `skills/`, `design-templates/`
- `apps/daemon/src/prompts/`
- `apps/web/src/runtime/comment-bridge.ts`, `apps/web/src/comments.ts`, `apps/web/src/runtime/exports.ts`

Review new craft rules, skills and prompt ideas against the table below and offer each finding as an idea. New design systems need no catch-up: `design systems` fetches them from main on demand (`refresh: true` for the newest list).

## Ported

| Upstream | What we took | Where it lives here |
|---|---|---|
| `craft/anti-ai-slop.md`, `color.md`, `typography.md`, `state-coverage.md`, `accessibility-baseline.md`, `animation-discipline.md` | Craft rules, condensed | `extensions/design-guide.md` (provenance in `design-guide.UPSTREAM.md`) |
| `apps/web/src/runtime/exports.ts` viewport matrix | Device presets | `PRESETS` in `extensions/design-render.ts`, `DEVICES` in `hub/web/design-view.ts` |
| Deck skill (1920×1080 stage, hash position) | Deck framework | "Decks" in `extensions/design-guide.md`; deck controls in `hub/web/design-view.ts` |
| `skills/brand-extract` method | Measured site style | `captureSite` in `extensions/design-render.ts` (`design reference`) |
| `exports.ts` `buildDesignHandoffContent` | Handoff checklist | `handoff()` in `extensions/design.ts` (HANDOFF.md at select) |
| `comment-bridge.ts`, `comments.ts` | Element picks, numbered pins, element names in chat lines | `hub/src/design-bridge.ts`, `hub/web/design-view.ts` |
| `design-systems/` | On-demand library | `design systems` in `extensions/design.ts` (fetched into `.pi/designs/systems/`) |

## Not taken

| Upstream | Why |
|---|---|
| The OpenDesign app, daemon and MCP tools | Replaced by the hub studio (one writer: the design session's own agent) |
| `edit-mode/source-patches.ts` | A second writer; Keep lines go through the chat instead |
| PDF export of decks | User decision: HTML decks only |
