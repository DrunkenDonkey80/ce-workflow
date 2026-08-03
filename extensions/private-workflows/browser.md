# Private Affected-UI Browser Playbook

<!-- generated; source-closure-sha256: 0426e38f0c4247b1eaebed5a1fa82a13fd5722faa164e47765f975920b596cab -->

## Affected UI selection

Use only the caller-supplied UI diff and acceptance contract. Map changed routes, pages, components, views, templates, and styles to the smallest runnable affected pages and user flows. Do not test unrelated pages or infer backend-only coverage from a UI-looking filename. If the project has no runnable web frontend or the affected surface cannot execute, append `wo:browser NOOP` with the observed reason.

## Browser verification

Start the documented local app when safe, use the available browser driver, and exercise the smallest non-destructive path for each affected flow, including the relevant failure state and console/network evidence. Preserve user data and restore any toggle or value changed by the check. Append `wo:browser PASS` with affected pages, commands/tools, and concise observed evidence only when every required check passes.

## Waiver and failure

Only an explicit evidence-only user waiver may replace runnable required evidence; append `wo:browser WAIVED` with the user's reason. Tool unavailability, a blocking UI failure, or incomplete evidence is not an implicit waiver: record the exact failure and stop. Without PASS, NOOP, or explicit WAIVED evidence, coded commit and close remain blocked. Do not stage, commit, close work items, simplify code, or perform the code-review gate.
