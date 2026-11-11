# C4: real request-prefix audit

## Scope and verdict

Captured one real Sol-high and one Opus-high request from **native async Pi children**, with ambient extensions, project instructions and skills inherited, asking only for `OK`. Both completed with zero tool calls. This is a useful inventory of prefix weight, **not an exact capture of an ordinary interactive session**: native children add their own instruction/output wrapper and have a slightly different tool surface.

**Verdict: audit complete; change nothing yet.** Tool definitions dominate the captured bytes. Test any proposed deferral against the same end-to-end workload before adoption; size alone cannot establish an improvement.

Evidence is local at `C:/SOFT/git/skills-lab/c4/`: `capture.ts`, both `.payload.json` and `.meta.json` files, `summarize.mjs`, `sizes.json`, and the two receipts. Workflow `1bc0a5d3-1fcf-4512-bf0f-3e38fb71035b`; native child IDs `ed4269ab-54ff-4b97-a6b8-c4f7a6096df8` and `b56d13fc-294a-42cf-afd0-f7aad1d4532c`. ce-workflow HEAD at capture: `fef8912c2fd9220c0424a2f344a56d00d0cc882e`, with an already dirty working tree. No payloads or credentials were added to the repository.

## Request sizes

Bytes below are compact JSON serialization of the captured provider payload, not pretty-printed file size, HTTP wire size, or exact tokenizer output.

| Item | Sol | Opus |
|---|---:|---:|
| Total serialized request bytes | 90,551 | 90,883 |
| Serialized system instructions | 31,998 | 32,180 |
| System text alone, UTF-8 | 31,328 | 31,386 |
| Individual tool definitions, summed | 57,722 | 57,702 |
| Number of tool definitions | 40 | 41 |
| Reported input tokens including cached input | 18,538 | 33,891 |
| Reported output tokens | 5 | 115 |
| Reported total provider tokens | 18,543 | 34,006 |
| Estimated request cost | $0.037126 | $0.171751 |

Sol sends tools in an `input` item of type `additional_tools`, not a top-level `tools` field. Its `input` is 58,255 bytes including the short task. Opus's top-level `tools` array is 57,744 bytes; its messages are 532 bytes. The remaining fields and structural JSON bytes are itemized in `sizes.json`. The script asserts that all top-level field-value bytes plus structural bytes equal the entire serialized payload exactly.

The observed whole-request ratios are 4.885 bytes per reported input token for Sol and 2.682 for Opus. They are **rough calibration only**, not a valid exact conversion for each tool or section: provider token accounting, schema formatting, hidden overhead and tokenizer behavior differ. Do not interpret the differing input counts as a quality or model-efficiency result. Opus input consists of 4 uncached tokens and 33,887 cache-write tokens; cache writes are included, not discarded. Both requests together used 52,549 reported provider tokens and an estimated $0.208877. No compactions or retries were present in these one-turn captures.

## Largest individual tool schemas

| Tool | Sol bytes | Opus bytes | Owning area |
|---|---:|---:|---|
| `plan3` | 4,452 | 4,422 | ce-workflow planning |
| `intercom` | 4,330 | 4,329 | pi-intercom |
| `ask_user` | 4,116 | 4,166 | ce-workflow shared dialogs |
| `resolve-library-id` | 2,939 | 2,938 | Context7 |
| `schedule` | 2,814 | 2,827 | ce-workflow hub |
| `lens_diagnostics` | 2,623 | 2,636 | pi-lens |
| `module_report` | 2,332 | 2,331 | pi-lens |
| `plan3_diagram` | 2,058 | 2,028 | ce-workflow diagrams |
| `camera_watch` | 1,812 | 1,782 | ce-workflow camera |
| `symbol_search` | 1,741 | 1,740 | pi-lens |
| `codemode` | 1,738 | 1,622 | Pi coding tools |
| `query-docs` | 1,714 | 1,713 | Context7 |
| `tools_enable` | 1,697 | 1,710 | ce-workflow optional tools |
| `camera_capture` | 1,402 | 1,372 | ce-workflow camera |
| `read_enclosing` | 1,349 | 1,348 | pi-lens |

Ownership is a navigation aid based on the installed tool map, not a claim that an entire package can be removed without consequences. The machine-readable table retains every schema, not only the largest fifteen.

## Largest system-text sections

The heading-based splitter is approximate; it does not invent package provenance for unlabeled blocks.

| Heading bucket | Bytes |
|---|---:|
| Preamble, including base rules and child framing | 9,656 Sol; 9,714 Opus |
| Skills catalogue | 9,261 |
| Ponytail “The smallest complete change” | 2,066 |
| Historical `[git]` context bucket | 1,710 |
| Version Before Push Rule | 1,171 |
| Dialog UX Rule | 902 |
| When Stuck | 793 |
| Global Instructions | 728 |
| Fast Commit-and-Push Rule | 682 |

These are contiguous text buckets split at headings, not exact instruction-source boundaries. A heading can contain a closing tag or following unlabeled text. Exact raw evidence is retained locally for a later source-aware audit.

## Candidate experiments, not approved removals

1. **Defer situational camera and diagram schemas until enabled.** Their sizes are visible and they are not needed in most coding turns. A discovery tool must remain available, and discovery failures must count against quality.
2. **Consider lazy Context7 activation.** The two listed schemas total about 4.65 KB. Documentation lookup must remain reliable; deleting the reminder or losing lookup behavior would invalidate the saving.
3. **Review stale context separately from safety rules.** The historical git-memory bucket is sizable, but age alone is not permission to delete user context. Do not strip project safety, accessibility or concurrency instructions merely to improve the byte count.
4. **Keep frequently used planning, dialog and code-navigation tools available unless an A/B proves otherwise.** They rank large but are central to this workflow; moving their cost elsewhere can regress task completion.

No schema, system prompt, skill catalogue, safety rule or user setting was changed by this audit.

## Validation

`node "C:/SOFT/git/skills-lab/c4/summarize.mjs"` completed: two captures parsed, exact serialized-byte reconciliation passed, nested Sol tool schemas included, provider usage read from the real native session files, and zero tool calls confirmed. Per-section token counts were deliberately not fabricated.
