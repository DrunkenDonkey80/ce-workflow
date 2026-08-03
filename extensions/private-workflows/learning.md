# Private Learning-Capture Playbook

<!-- generated; source-closure-sha256: 03f388ee41470a3b970a63c52d062f2249fac794b704789e0e4822309aa8928f -->

## Eligibility and skip gate

Run only after a verified root-cause fix or eligible big-work completion. Capture a durable project-specific debugging, architecture, workflow, integration, or operational fact only when it is non-obvious and reusable. Skip routine implementation facts, unverified conclusions, secrets, transient incident data, and any learning key already recorded on the roadmap. Skipping is a successful gate outcome.

## Destination and deduplication

Search existing project instructions, executable configuration, and `docs/solutions/` before writing. Update the existing canonical location instead of duplicating it. Put direct procedures in executable configuration or project instructions; put non-obvious rationale and troubleshooting in `docs/solutions/`. Keep the artifact scoped, searchable, and free of session-only narration.

## Work-item key and handoff

Derive one stable lowercase hyphenated key. Check roadmap notes for `wo:learning:<key>=<artifact>`; if present, skip capture. After creating or updating the durable artifact, append that exact marker through the caller-provided work helper so future gates deduplicate it, then commit the artifact and marker through the coded finish path before roadmap closure. Report the destination, key, whether content was created, updated, or skipped, and the caller's exact next action.
