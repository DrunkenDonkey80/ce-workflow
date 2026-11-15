---
plan3: true
status: complete
created: 2026-11-15
updated: 2026-11-15T07:45:39.503Z
started: 2026-11-15T07:26:38.827Z
---

# Lean pi-lens defaults across Hub and terminal Pi

## Original request

> Automatically apply a combined lean pi-lens policy on every updated Hub machine, including terminal Pi. User chose: disable Kotlin, retain TypeScript with 2-minute eligible-server idle eviction; disable automatic formatting, both autofix mechanisms, automatic tests and read expansion; retain lightweight tools/read guard. Preserve unrelated settings, handle custom global config paths, avoid disrupting live sessions, test rollout. No push or remote deployment authorized; no claims of net performance improvement without matched end-to-end benchmark.

## Goal, requirements, and non-goals

Apply a consistent lean pi-lens configuration automatically on machines running the updated Hub and terminal Pi with CE installed. Keep TypeScript semantic diagnostics while disabling Kotlin; retain structural tools and the read guard. Disable automatic formatting, pipeline autofix, actionable-warning autofix, automatic tests and read expansion. Reduce eligible language-server idle retention from 20 minutes to 2 minutes. Preserve unrelated configuration and never overwrite malformed files. Do not kill live servers, push, or deploy to other machines in this task. Do not claim a net performance gain without a matched end-to-end benchmark.

## Decisions

- User selected “Disable Kotlin; keep TypeScript with shorter idle retention” and “Whole machine, including terminal Pi” in ask_user on November 15.
- User rejected blanket TypeScript/all-LSP disabling in favor of preserving useful semantic checks. Active memory can still be high; idle eviction is not a hard memory ceiling.
- Installed pi-lens 4.5.0 docs say eligible servers can use PI_LENS_LSP_IDLE_EVICT_MS=120000; TypeScript is eligible, Kotlin is not. Existing processes require a safe lifecycle transition, not blind termination.
- Global config path precedence: explicit PI_LENS_CONFIG_PATH, existing ~/.pi-lens/config.json, then existing PI_CODING_AGENT_DIR/extensions/pi-lens.json, otherwise the canonical default. Project mutation settings can override machine defaults; verify how this affects the promised policy.
- Existing CE work-lens-format.ts asks once about formatting only; extend or replace this mechanism rather than add a parallel policy layer.
- Applying code on every machine means adoption on updated Hub startup. Remote rollout itself is outside this unpushed local change.
- Native Pi-loader probe verified installed pi-lens 4.5.0: TypeScript selected with and without the policy; Kotlin selected with empty control but disabled-by-config with the policy; all configured keys recognized with no invalid/unknown records. Standalone MCP entry cannot resolve Pi's bundled peer dependencies on this installation; native extension loading works without changing installed packages.
- Existing/adopted or ephemeral server roots may retain pi-lens's separate shorter idle windows (normally 60 seconds). The 120000 value governs eligible regular idle roots; not a hard memory cap.
- Test and screenshot fixtures that start Hub/CE now select a temporary PI_LENS_CONFIG_PATH so startup cannot rewrite the user's global config. Existing unrelated lint findings in the native-smoke fixture were deferred, not fixed.


## Open questions

None. Verified the idle environment value is read when timers are scheduled; actual native Pi extension loading sets it to 120000. No user decision remains.

## Relevant files and approach

- C:/SOFT/git/ce-workflow/extensions/work-lens-format.ts: existing config writer and startup dialog.
- C:/SOFT/git/ce-workflow/extensions/work-models.ts: calls registerLensFormatCheck at extension registration.
- C:/SOFT/git/ce-workflow/hub/src/hub.ts: startup before SessionHost launches Pi children.
- C:/SOFT/git/ce-workflow/scripts/test-work-lens-format.mjs: existing focused self-check to extend.
- C:/Users/Flex/.pi/agent/npm/node_modules/pi-lens/docs/{configuration,settings,environment-variables,lsp-idle-eviction}.md: inspected configuration references.
- C:/Users/Flex/AppData/Local/Temp/pi-lens-local-audit-2026-11-15.md: observational baseline, not a benchmark. 109 core pipeline spans median 4.7s; three TypeScript trees ~3.2 GiB working set in one sample.

## Phases

### Phase 1: Verify configuration lifecycle [think]

Determine when pi-lens reads idle settings and how startup applies policy without overwriting unrelated settings or disrupting sessions.

### Phase 2: Implement and verify automatic defaults [code]

Use the existing configuration helper and startup integration, focused tests, and a disposable real Pi probe.
- [x] **P3-01** Verified config precedence and dynamic idle timer; TypeScript evicts, Kotlin does not.
- [x] **P3-02** Shared lean defaults replace the format popup; Hub and terminal startup apply them with safe config merging.
- [x] **P3-03** Applied local policy and verified native Pi loading, configuration provenance, targeted tests and mutation sensitivity.


## Global validation

Extend and run node "scripts/test-work-lens-format.mjs". Select the smallest existing Hub startup check after inspecting its isolation. Probe changed TypeScript files with lens_diagnostics source=lsp scope=paths. Verify configuration with a disposable real Pi process if supported. Do not run the full suite or claim runtime/token/cost improvements from unit checks; matched end-to-end benchmarking is required before such a claim.

## Resume context

Complete locally. Shared startup helper applies approved global policy and two-minute regular idle env; updated Hub/CE starts propagate it. Native Pi-loader and targeted checks passed; provenance evidence Temp/pi-lens-policy-live-result.json. Real C:/Users/Flex/.pi-lens/config.json now contains policy with widget preserved. No active servers killed or sessions restarted, no commit/push/deployment, no benchmark or measured savings claim. LSP zero returned errors but 14/15 files inconclusive; two pre-existing native-smoke lint findings deferred. Test-only environment isolation added to Hub and terminal fixtures. Other dirty work in repository is untouched.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
- 2026-11-15: Added P3-01, P3-02, P3-03 as the first steps: Implementation checklist for the user's selected policy.
