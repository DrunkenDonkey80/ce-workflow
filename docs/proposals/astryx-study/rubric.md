# Frozen comparison rubric

Frozen before agent launch. One pair, qualitative pilot; do not generalize superiority from one random sample. Both initial and refined outputs are retained. Do not fix an arm after scoring or discard its failed attempts.

## Functional checklist (report individual pass/fail/blocked, not an opaque aggregate)
- Loads dashboard/settings without page errors or missing local assets with external requests blocked.
- Six specified rows initially; name search, combined status filter and no-results recovery.
- Edit modal opens, saves updates/counts, validates blank names with input retained; Cancel and Escape discard changes; opener gets focus back and Tab stays inside.
- Settings required name, notification control, appearance change and visible save acknowledgement.
- Loading/Empty/Error/Populated states and Retry recovery.
- Refined only: Paused filter/edit option; owner-name search case-insensitive; Reset filters clears both.
- IDs are stable/unique and correspond to actual meaningful DOM nodes.

## Responsive/accessibility
At 360×800, 390×844, 820×1180, 1440×900 and 844×390: no page overflow, readable long name, visible reachable actions. Desktop mouse and phone coarse pointer are separate contexts. Check representative targets >=44×44 on phones, focus visibility, modal keyboard cycle, named controls, headings/landmarks, reduced motion. Report which checks are automatic versus visual. No WCAG-compliance claim without a complete audit; no AT/Safari/real-device claim.

## Visual judgment (each 1–5, with concrete screenshot evidence)
- Hierarchy and scanability: find active work and the next action.
- Consistency: typography/spacing/colors/states feel like one app.
- Phone adaptation: reflow and reading/action priority, not just shrinking desktop.
- Craft/distinctiveness: deliberate identity without decorative noise.
- State quality: modal/error/empty/settings are as considered as the main dashboard.
1 = unusable/major defects; 2 = multiple significant weaknesses; 3 = competent ordinary prototype; 4 = strong with minor gaps; 5 = unusually polished and complete. Scores are parent judgment, not independent/blinded study; use neutral A/B labels when inspecting screenshots but disclose known implementation.

## Studio compatibility
Use actual DESIGN_BRIDGE and SANDBOX_CSP. Verify comment pick ID/text, inspector styles, modal picks/pin visibility. Reuse actual renderDesign for screenshots/reports. Treat transient Mark state, version/build source ownership, and export reproducibility as explicit capabilities/gaps; do not claim full live remote-studio E2E from a sandbox harness.

## Efficiency
Per arm: initial plus refinement wall elapsed and summed active durations; all provider input/output/cacheRead/cacheWrite/total tokens, turns, tool calls and reported cost. Deduplicate retained-resume transcript prefixes. If reported cost is absent/zero pricing unavailable, say unknown. Record model and thinking as actually used, configured ultrafull and whether compaction occurred. Separate preinstalled dependency setup, parent evaluation overhead and network/download overhead from agent generation. Include output bytes/gzip and build duration where measured. Never call an optimization successful just because it reduces one metric.

## Decision gate
Recommend adopt/optional/defer/reject for specific features, with benefit, evidence, remote-workflow cost and a verification gate. A component option can be useful without beating vanilla HTML on every metric. Material overall regression bars describing it as a successful optimization; preserve current studio as baseline. Implementation waits for user-controlled research mode exit.
