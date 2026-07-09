<!-- BEGIN COMPOUND PI TOOL MAP -->
## Compound Engineering (Pi compatibility)

This block is added by the pi-compound-engineering package.

Pi extensions used by skills shipped by this package:

- Required for full functionality: `pi-subagents` (by nicobailon) provides the `subagent` tool used by ce-compound, ce-code-review, ce-plan, ce-compound-refresh, and other parallel-agent skills.
- Required for workflow prompts: `pi-ask-user` (by edlsh) provides the `ask_user` tool so blocking user decisions use the interactive prompt path.

Install with:
  pi install npm:pi-subagents
  pi install npm:pi-ask-user
<!-- END COMPOUND PI TOOL MAP -->

## Workflow Feedback Rule

When a live or disposable test project exposes a ce-workflow issue, do not only work around it. Before calling the run done, improve this project so the same failure class is less likely next time, or record a concrete follow-up if the fix is not safe to apply immediately.

## Code-First Workflow Rule

If project workflow behavior can be handled in code without losing functionality, prefer coded automation over prompt-only or manual process guidance.

## Continuous Workflow Optimization Rule

Always look for ways to make ce-workflow faster, quieter, more autonomous, and cheaper in tokens/context. Use existing telemetry to spot waste in command flow, role selection, subagent handoffs, retries, output volume, and verification gates. If better telemetry would make the next improvement obvious, add the smallest structured signal needed. When you see a safe improvement to extension behavior, implement and verify it before moving on.
