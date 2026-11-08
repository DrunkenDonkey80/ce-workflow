# Diagnosing bugs provenance

Adapted from Matt Pocock's `diagnosing-bugs` skill in [mattpocock/skills](https://github.com/mattpocock/skills/tree/4ae2317/skills/engineering/diagnosing-bugs).

- Author: Matt Pocock and contributors.
- Pinned revision: `4ae2317`.
- License: MIT; the complete upstream license is retained unchanged in [LICENSE.txt](LICENSE.txt).
- Changes: shortened to about half (same six phases and completion criteria); the `scripts/hitl-loop.template.sh` helper is not vendored, a human-in-the-loop run is described in one sentence instead; "do not edit beyond the fix" added to phase 5, the slip the lab saw most without the skill.
- Evidence: in the ce-workflow skills lab (docs/proposals/skills-lab/results.md) forced runs ranked 1 to 3 of 7 at about 1.6 times the cost; the unforced run loaded it on its own and scored full marks at baseline cost, so it ships model-invoked only.
