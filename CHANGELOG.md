# Changelog

## Unreleased

- Fixed a startup crash in the background verifier extension: jobs whose operations were all resolved while their launch still reported `running` crashed reconcile with "Invalid operation accounting" instead of closing out. Stale launches now reconcile once and stop recurring; affected stores self-heal on the next start.
