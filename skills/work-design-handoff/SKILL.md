---
name: work-design-handoff
description: Preserve an approved visual-design handoff while planning or implementing design-linked UI work. Load only when a coded work handoff names approved design artifacts or DES-* criteria.
---

# Work Design Handoff

Use only the approved design authority named by the coded handoff. This skill adds no command, provider call, or orchestration loop.

## Read

Read the named brief, handoff, and approval files. Confirm their hashes match the work item before implementation. Treat the handoff as product and visual authority; treat OpenDesign prototype code as reference only.

## Plan

- Map every assigned `DES-*` criterion to implementation work and verification.
- Preserve its screen, state, and viewport scope.
- Preserve shared reuse, non-introduction, asset, provenance, and license constraints.
- Use the repository's declared browser operation for interaction, visual, accessibility, and log proof.
- Require final human visual approval only when the coded policy is Strict.

## Implement

Implement the simplest product code that satisfies the assigned criteria. Reuse existing components and tokens. Do not copy, import, or execute generated prototype code, and do not fetch remote assets.

If approved behavior or direction cannot be preserved, stop the affected work and record `wo:design-deviation <reason>`. Resume only after revision, synchronization, reapproval, and `wo:design-deviation-resolved`.

## Verify

Capture every required fidelity cell at the approved handoff hash and current target revision. Inspect hierarchy/signature, tokens, required regions and content, responsive reflow, visible states, clipping/overlap, focus, and reduced motion. Do not require raw pixel equality.

Never include credentials, provider keys, prompts, token-bearing URLs, or design content in telemetry or notes beyond the approved bounded artifact links and criterion IDs.
