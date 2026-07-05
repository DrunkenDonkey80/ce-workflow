<!-- BEGIN COMPOUND PI TOOL MAP -->
## Compound Engineering (Pi compatibility)

This block is added by the pi-compound-engineering package.

Pi extensions used by skills shipped by this package:

- Required for full functionality: `pi-subagents` (by nicobailon) provides the `subagent` tool used by ce-compound, ce-code-review, ce-plan, ce-compound-refresh, and other parallel-agent skills.
- Recommended: `pi-ask-user` (by edlsh) provides the `ask_user` tool; skills fall back to numbered options in chat when it is missing.

Install with:
  pi install npm:pi-subagents
  pi install npm:pi-ask-user
<!-- END COMPOUND PI TOOL MAP -->

## Workflow Feedback Rule

When a live or disposable test project exposes a ce-workflow issue, do not only work around it. Before calling the run done, improve this project so the same failure class is less likely next time, or record a concrete follow-up if the fix is not safe to apply immediately.

## Code-First Workflow Rule

If project workflow behavior can be handled in code without losing functionality, prefer coded automation over prompt-only or manual process guidance.
