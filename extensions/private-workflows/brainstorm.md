# Private Brainstorm Playbook

<!-- generated; source-closure-sha256: e5a85c21ed9030811e50541aa66350c88de77cf69c9b26d779466a3caad64002 -->

## Boundary

Explore and settle **what** to build. Do not implement, debug, review code, or plan implementation. Keep one coherent outcome in scope and treat speculative follow-ons as non-goals.

## Dialogue

1. Read the full request and any already-settled decisions before asking anything.
2. Inspect the repository only enough to avoid contradicting existing product behavior and conventions.
3. Classify the request as lightweight, standard, or deep; match ceremony to ambiguity and consequence.
4. Ask exactly one focused question per `ask_user` call until actors, desired outcome, boundaries, success criteria, and important failure behavior are clear. After each answer, continue this workflow in the same assistant turn unless the user cancels or a required answer remains unresolved; do not emit a status-only response or wait for a user-authored continuation. Prefer a blocking single-select question with 3–4 real options when choosing one direction; use an open question when options would steer the answer. Never silently skip clarification for broad, important, or underspecified work.
5. Act as a thinking partner: surface materially different options, challenge assumptions, explain trade-offs, and recommend the smallest approach that delivers the outcome. Keep libraries, schemas, endpoints, file layouts, and other implementation choices out unless they materially change product behavior.
6. Before writing, summarize the proposed scope, non-goals, key decisions, risks, and remaining unknowns. Obtain confirmation when unresolved choices would materially change the artifact. If a required decision remains unresolved, stop without inventing it.

## Artifact

Write one requirements-only Markdown artifact below `docs/brainstorms/`. Preserve concise source context and include, as applicable: problem and goal; actors; requirements; user-visible flows and failure behavior; options and decision; non-goals; risks; acceptance examples; and genuinely open questions. Right-size the sections rather than filling a template mechanically. Do not start planning or implementation.

After the file exists, end the final response with exactly:

`Brainstorm saved: <absolute path>`

Do not append a planning menu or any other text after that line.
