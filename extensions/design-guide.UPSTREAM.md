# Design guide provenance

`design-guide.md` is a short adaptation of craft rules from [OpenDesign](https://github.com/nexu-io/open-design) (nexu-io/open-design), pinned at commit `07a86b104`.

- Author: Open Design contributors. License: Apache-2.0; the complete upstream license is retained unchanged in [design-guide.LICENSE.txt](design-guide.LICENSE.txt). This guide keeps its Apache-2.0 terms, independently of ce-workflow's MIT license.
- Sources: `craft/anti-ai-slop.md`, `craft/color.md`, `craft/typography.md`, `craft/state-coverage.md`, `craft/accessibility-baseline.md`, `craft/animation-discipline.md` (some of these are themselves adapted by OpenDesign from refero_skill, MIT), and `apps/daemon/src/prompts/official-system.ts` (inspectable ids, content rules, one verification pass). The deck framework is written for ce-workflow after `packages/contracts/src/prompts/deck-framework.ts`, with the slide in `location.hash` instead of localStorage, which throws in the sandboxed preview.
- Changes: condensed and reworded; `data-od-id` became `data-id`; OpenDesign's linter, tools, TodoWrite and file-naming rules were dropped; ce-workflow's design folder, `design look`, `generate_image` and the Tweaks message contract were added.

Updates are reviewed source changes through catch-up (docs/upstream/open-design.md), not automatic fetches.
