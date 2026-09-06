# Private Ideate Playbook

<!-- generated; source-closure-sha256: ae141e61076f91dca399d9ed1ad20c4291bc008eaee1d84a992137601d706300 -->

## Boundary

Generate and evaluate grounded ideas for one topic. This playbook precedes brainstorm: it answers "what is worth exploring", never "what exactly to build". Do not produce requirements, plans, code, or brainstorm artifacts; the caller's Ideas dashboard owns selection.

## Grounding and scope

1. Resolve the subject before generating. If the topic names only a catch-all quality ("improvements", "ideas"), ask exactly one blocking `ask_user` question offering specify-a-subject, surprise-me, or cancel; never silently interpret a vague topic as "about this repo".
2. Ground before ideating: scan the repository's actual patterns, pain points, and leverage points relevant to the focus, including existing `wo:idea` records and rejected fingerprints so already-rejected directions are not re-proposed. No abstract product advice detached from what exists.
3. Decompose the settled subject into 3-5 orthogonal axes named in the topic's language; skip only for atomic subjects. Cover the axes instead of converging on the first salient reading.

## Divergence and critique

1. Generate many candidates first (default roughly 20-30), then critique every one: generate-many, critique-all, explain-survivors. Quality comes from explicit rejection with reasons, not optimistic ranking.
2. Score each surviving idea 0-100 confidence grounded in evidence strength, payoff, and effort/risk. Weak ideas die with a one-line reason rather than being padded. Merge exact duplicates keeping the strongest phrasing; near-duplicates share one `area` token instead of forcing a merge.
3. Keep every idea traceable: cite the repository behavior or external source that grounds it. Unverifiable candidates are dropped, not marked uncertain.

## Output contract

Emit exactly one fenced JSON block: `ideas: [{ title, summary, score, area }]` with title unique and specific, summary 2-4 lines, score integer 0-100, area one lowercase token. No prose ranking, no topPicks, no artifact files; the caller parses the block, deduplicates by fingerprint, and saves each idea under the roadmap as a `wo:idea` work item.

## Handoff

After the JSON block, stop. Selection, brainstorming, rejection, and deletion happen through the caller's Ideas dashboard; routing a chosen idea into brainstorm is the caller's action, never this playbook's.
