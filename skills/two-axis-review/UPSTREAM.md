# Two-axis review provenance

Adapted from Matt Pocock's `code-review` skill in [mattpocock/skills](https://github.com/mattpocock/skills/tree/4ae2317/skills/engineering/code-review).

- Author: Matt Pocock and contributors.
- Pinned revision: `4ae2317`.
- License: MIT; the complete upstream license is retained unchanged in [LICENSE.txt](LICENSE.txt).
- Changes: renamed to `two-axis-review`; dropped the issue-tracker setup (`/setup-matt-pocock-skills`) in favour of a spec search that includes the Plan3 plan; subagents run only when the user has authorized delegation, otherwise the two axes are reviewed one after the other with separate notes; uncommitted changes and unrelated edits are named explicitly. The smell baseline, briefs and report format are unchanged in substance.
- Evidence: in the ce-workflow skills lab (docs/proposals/skills-lab/results.md) the skill found 8 of 9 planted defects versus 5.5 to 6 without it, at about 2.9 times the cost of a plain review.
