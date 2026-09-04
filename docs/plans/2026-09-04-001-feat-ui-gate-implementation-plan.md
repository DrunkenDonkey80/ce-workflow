# UI Gate — Implementation Plan (master roadmap seed)

```yaml
status: implementation-ready
type: master-plan
created: 2026-09-04
source: .pi/ui-gate-plan/plan-final.md (final v2 — reconciled through two adversarial review rounds: opus-review.md, opus-review-2.md; all load-bearing claims source-verified 2026-09-04)
roadmap-shape: P0 → P1 → P2 → P3 → P3.5 → P4 (sequential; P4 rows are independent of each other)
```

## Goal capsule

**Problem.** Model generation against a visual target does not converge without measurement between attempts (observed: 20+ retries, positions never correct). Current design verification is prompt-only ("inspect clipping/overlap" in `skills/work-design-handoff/SKILL.md`), and `validateDesignFidelityEvidence` numbers in `extensions/work-design.js` are self-reported by the agent being checked.

**Thesis.** Measure, don't vibe; geometry over pixels; determinism first, VLM second — advisory by default; blocking only via per-project opt-in and only for ordinal/categorical rules (Tier 3); code-first.

**Product.** A deterministic UI validity + design-fidelity gate with a bounded repair loop: a zero-dependency capture script measures the UI, deterministic rules + a fidelity matcher produce findings, the orchestrator repairs against stable finding ids, and unplanned platforms degrade along an explicit ladder instead of silently losing coverage. The gate produces the exact numbers `validateDesignFidelityEvidence` already demands — measured, not self-reported.

**Closed decisions (2026-09-04).**

1. Capture mechanism: **self-report + `--dump-dom`** on the existing `chrome-headless-shell` from the `ms-playwright` cache (pattern: `scripts/fixtures/capabilities/run-browser-smoke.mjs`). Zero dependencies, one code path, most deterministic. Fallback ladder if a page defeats it (CSP, exotic emulation): raw CDP (`Runtime.evaluate`, `Emulation.setDeviceMetricsOverride` — still zero deps) → Playwright as first runtime dependency only as last resort.
2. Round cap: **3**, early stop after 1 non-improving round, policy-configurable; telemetry decides the long-term default. (Tier 3 cap 2.)
3. Anchors: advisory in P1 (warn on `anchor-missing`), fail-closed once anchor scaffolding lands in new projects.

## Product contract

### Requirements (traced from source §0–§6; each maps to exactly one implementation unit)

| # | Requirement | Unit |
|---|---|---|
| R1 | Capture script `scripts/ui-gate/capture.mjs --profile web-chromium --target <url> --viewport <v> --state <s> --out <dir>`; artifacts per cell under `.pi/work-artifacts/ui-gate/<work>/<round>/`: `screenshot.png`, `geometry.json`, `meta.json` (hashes, dpr, latency) | P0 |
| R2 | Determinism harness: animation/transition/`scroll-behavior` suppression, `document.fonts.ready`, every `img.decode()`, DPR pinning, double-capture **byte-identity** of `geometry.json` (fixed-precision rounding), mismatching elements → quarantine list excluded from findings. **Precondition for every convergence claim.** | P0 |
| R3 | Validity rules R1–R5 deterministic: clipped-text (horizontal overflow ∧ fixed-height/clamp; intent from `getComputedStyle`), interactive-overlap (>5% of smaller box, allowlist), occluded-content (`elementFromPoint` centre + 4 inset corners, ancestor-multiplied opacity), offscreen-essential (anchor/testid outside viewport without affordance), scroll-trap. Repo-local allowlist file in P0. | P0 |
| R4 | Finding shape: `{id: sha256(rule+matchKey+viewport+state), rule, severity, measured, threshold, element:{matchKey, anchorId}, evidence:{svgOverlayPath, neighborRects}, viewport, state}` — rect excluded from the id hash. | P0 |
| R5 | Cheap checks in P0: content assertions from `handoff.content` (right screen/state; doubles as R8 discriminator); token-snapping + alignment invariants (sibling gaps snap to `tokens.spacing` within 1px; spec-flush edges flush within 2px — no spec needed); geometry baseline drift with `--accept-baseline`. | P0 |
| R6 | Evidence: SVG overlays + 30-line HTML side-by-side viewer, zero deps (replaces PNG rendering). | P0 |
| R7 | Telemetry: `ui_gate_round {round, findingsByRule, vlmCalls, tokens, captureTier, measuredBy, wallMs, converged}` via the existing `work-models.js` telemetry path (no standalone `workflow-telemetry.js` exists); defaults set from data. | P0 |
| R8 | Fidelity spec = the **approved candidate HTML artifact** (already hashed, already rendered) captured with the same profile → persisted as hash-bound `design/elements.json` sidecar declared in `assets[]`, optional `elementsRef` pointer in the v2 handoff. One capture path for spec and actual. | P1 |
| R9 | Matching: `data-ce-el` anchor lookup first (`Map.get`; `anchor-missing` its own trivially repairable finding class); greedy cascade fallback (exact text → normalized text → role+ordinal). Unmatched on either side → findings. | P1 |
| R10 | Per-element acceptance: IoU as assignment cost only; acceptance = center offset ≤ `max(4px, 0.02×containerWidth)` + size ratio + alignment invariants (spec-flush edges flush within 2px) + computed colour vs nearest `roleColors` token + text presence per state. Normalization: uniform scale by width; `y` anchored to nearest `requiredRegion`. | P1 |
| R11 | Structural: order topology; declarative optional `screens[].layoutAssertions` per viewport. | P1 |
| R12 | Region fallback: no `elements[]` → `requiredRegions` presence + non-overlap only. | P1 |
| R13 | Output: produce `validateDesignFidelityEvidence`'s `geometryDeltas`, `typographyDeltas` (≤0.15 scale), `responsive.{reflow,noHorizontalOverflow,visibleFocus,contrast}`, `regions` — measured. Gate-derived `visualEvaluation` scores emitted only on the validated 0–4 scale; evaluator prompts state the scale. | P1 |
| R14 | Handoff compatibility: **no v3**; `DESIGN_HANDOFF_VERSION` untouched; optional-only additions (`layoutAssertions`, `elementsRef`, `screens[].invariants`); `responsiveRules` stays a string list; sidecar via existing `.json`-in-`assets[]` rules (64-entry cap, `validateDesignArtifactRelativePath`). | P1 |
| R15 | Repair loop extension `work-ui-gate`: trigger = `inferVerificationContract` UI classification or explicit action; round = capture → validate+match → findings → scoped fix tasks with per-rule repair-recipe hints → re-verify targeted ids + cheap full validity pass. | P2 |
| R16 | Round success predicate: iff every targeted id resolved AND no new equal-or-higher-severity finding; count tiebreaker; cap 3, early stop after 1 non-improving; own round counter (`repairAttempts` untouched). | P2 |
| R17 | Concurrency via `work-action-leases`; escalation = findings report + Strict-policy human approval through shared `extensions/work-dialogs.js` overlay with SVG/HTML side-by-side content; existing `proof_required → implementation_active → proof_required` state machine suffices. | P2 |
| R18 | CI cheap-mode: hash render-affecting files (styles/templates/components/tokens); unchanged fingerprint → reuse last verdict; geometry-only mode (no image capture) for machine-only checks. | P3 |
| R19 | Hardening rules: R6 focus-visible (`:focus-visible` style delta after programmatic focus), R7 min-target-size (≥24px desktop / 44px mobile, per-element exceptions), R8 state-coverage (every declared state captured; pairwise non-degenerate via geometry hash; state copy present). Acceptance script navigates; gate asserts. Computed WCAG contrast. | P3 |
| R20 | Tier 3 VLM geometry bridge with the full hard-rule protocol (below). | P3.5 |
| R21 | Native captures: Android (`adb exec-out screencap -p` + `uiautomator dump` XML → bounds/text/clickable; emulator fixture with seeded defect), Windows native (UIA tree dump via PowerShell/.NET, OS built-in), Python GUIs (toolkit introspection: `winfo_*` / `QWidget.geometry()` / `GetRect()` via ~30-line debug-mode self-report helper). | P4 |
| R22 | Proof taxonomy unchanged: proof = `{capability: "browser"|"desktop", proof: "visual", artifacts}`; the gate is an`operation.command` in the `run-*-smoke.mjs` shape; one proof per (target, capability); cell matrix inside the payload; 32-proof ceiling; split across proofs if >900 s. | P0/P1 |

### Tier 3 protocol (R20, in full — binding)

Value = **coverage honesty**, not precision: "no capture profile → surface invisible" becomes "coarse categorical signal + telemetry counter ranking which capture profile to write next".

1. **Categorical findings only — no numeric correction vectors.** Category + evidence overlay + qualitative repair hint; severity from category. Stops measurement noise being laundered into code edits.
2. **Never produces `validateDesignFidelityEvidence` fields.** `geometryDeltas`/`typographyDeltas`/`responsive.*` unset for Tier-3-only platforms; proof records capability-degraded; fidelity stays human/advisory.
3. **Closed-set, text-anchored protocol.** One call per (screen, viewport, state) cell; anchors from handoff (`requiredRegions` ≤32 + `content` strings); exactly one entry per anchor `status: found|not-found|uncertain`; volunteered extras dropped; "not-found" first-class. Coordinates: integers 0–1000, origin top-left. Structured output; one retry on schema failure → `vlm-unparseable` → cell BLOCKED.
4. **Deterministic verification chain replaces double-pass** (same-model agreement is theater against systematic VLM bias): (i) grid cross-check — labeled 10×10-grid copy in the same call, rect center must fall in declared cell; (ii) pixel probe — eroded-interior edge/ink variance above background floor (flat = hallucination → quarantine); (iii) edge-snap refinement — ±10%-band gradient search per edge; VLM rect is a region *proposal*; target ±2px on high-contrast widgets, record `refined`; (iv) text plausibility — aspect ratio vs string length. Escalation on probe failure: crop-and-re-ask (crop-relative coordinates). Self-reported confidence routing-only. Optional second pass must be a different model family, rationale stated.
5. **Hysteresis.** Schmitt trigger (fire at `T`, clear below `0.7·T`) + diff-gated resolution (a finding that "resolves" without a UI-surface fingerprint change is noise). **Tier 3 round cap 2**, early stop after 1 non-improving round.
6. **Budget.** ≤8 VLM calls/round including retries; default matrix = changed screens (§2.6 fingerprint) × primary viewport × `ready` state (typically 1–3 cells); one screenshot per call, ≤1.5 Mpx, longest edge ≤1536; never batch the matrix into one context; beyond-cap cells → `capture-budget-exceeded` → BLOCKED, never silently clean.
7. **Degradation is BLOCKED, not pass.** Quarantine rate >30% per cell → BLOCKED (capability-degraded).
8. **Region-level fidelity only** (presence, containment, non-overlap, ordering). Per-element fidelity requires the same renderer on both sides.
9. **Rule whitelist**: `region-not-verified` (merged missing/misplaced), `region-out-of-place` (threshold from calibration, start 8% of width; no numeric vector in the finding), `gross-overlap` (>25% of smaller box), `off-canvas`, `ordering-violation` (per `layoutAssertions` — the tier's best check), `color-token-mismatch` (deterministic histogram on eroded central 50%; >1 mode above 15% of pixels → colour quarantined). **OFF**: R1 clipped-text (advisory-only, never blocking), R6, R7, per-element offsets, typography deltas, computed contrast.
10. **Blocking policy**: advisory by default; blocking requires explicit per-project opt-in with named justification; even then only ordinal/categorical rules — never a metric delta.
11. **Spec side**: OD HTML candidate stays deterministic via the web profile. VLM-extracted spec geometry advisory-only, full stop (text-anchoring identifies, does not authorize a position); spec-side VLM output contributes ordinal/containment facts only. Never reuse `workflow-visual-evaluator` as the measurement model (blinding contract).
12. **Calibration precondition** (gate before enabling on any platform): on the repo's DOM-ground-truth web surfaces — ≥95% of requested anchors localized within configured tolerance; ≤2% false `region-missing` on clean surfaces; published p50/p95 center error; tolerances set at measured p99, not guessed.
13. **Finding ids**: spec-side handoff ids only; `measuredBy` excluded from the id hash alongside rect. **Auto-upgrade** = `--accept-baseline` re-acceptance event: first deterministic round after upgrade records a new baseline and reports advisory-only for one round.
14. **Determinism exemption**: Tier 3 cells exempt from byte-identity; substitute a distance-band predicate (same anchor re-measured must agree within the Tier 3 tolerance band).

### Degradation ladder (platform principle)

The universal core is the architecture (normalized boxes+text → deterministic rules → bounded repair), not any single capture flag. Any UI that can emit a machine-readable layout description is gateable; anything that cannot reports BLOCKED (capability-missing), never a fake pixel verdict.

1. Platform box tree (DOM / UIA / uiautomator / toolkit introspection) → full deterministic gate, tight tolerances.
2. Cooperative self-report hook (engine/toolkit debug dump) → full deterministic gate.
3. VLM geometry bridge (Tier 3, above).
4. No screenshot at all → BLOCKED (no profile), human visual approval covers the gap — today's status quo, but visible in the contract.

Platform matrix: web P0 (full); Electron/Tauri/CEF cheap add on the CDP rung; Android P4; iOS unplanned (needs macOS); RN/Flutter unplanned (app must cooperate); Windows native P4 (UIA, un-cut on recurring targets); Python GUIs P4; games out of scope without an engine hook (documented stance: pixel-only refused by design; the lazy game integration is one dump function in a debug build emitting `geometry.json`).

### Acceptance contracts

| Contract | Source of truth | Must-match | Must-not regress | Proof | Approver |
|---|---|---|---|---|---|
| AC1 Handoff compatibility | `work-design.js` `validateDesignHandoff` whitelist rebuild, `DESIGN_HANDOFF_VERSION=2`, `boundedJson` 256 000 | Optional-only additions; sidecar via `assets[]` `.json` rules; invariants under `screens[]` | Version bump; new required keys; any existing v2 handoff rejected | `scripts/test-work-design.mjs` + `scripts/test-work-design-fidelity.mjs` green on existing fixtures (`handoff-valid.json`, `handoff-invalid.json`) | repo verify gate |
| AC2 Adapter I/O | `work-capability-adapters.js` (`timeout ≤900 s`, `maxBuffer 2 MB`, last-stdout-line `JSON.parse`) | Exactly one compact JSON line printed last; findings as file artifacts; matrix split if >900 s | stdout carrying findings; new proof kind/capability/adapter | adapter tests + smoke runs through the real spawn path | repo verify gate |
| AC3 Deterministic capture | `browser-calculator.html` + candidate/launcher artifacts | `geometry.json` byte-identical across 10 consecutive double-captures | flaky quarantine list on stable pages | determinism harness run, archived output | implementer + owner review |
| AC4 Benchmark recall | seeded-defect fixtures `defects-validity.json`, `defects-fidelity.json` (to be created) | 100% recall P0 / P1 respectively; zero findings on every clean existing HTML surface | false-positive storm on clean surfaces | acceptance scripts `scripts/ui-gate/accept-*.mjs` | repo verify gate |
| AC5 Calibration gate (Tier 3) | DOM-ground-truth web surfaces | ≥95% anchor localization; ≤2% false `region-missing`; published p50/p95 center error; tolerances at p99 | enabling Tier 3 on any platform before the report exists | `scripts/ui-gate/calibrate-<platform>.mjs` report artifact | owner review |
| AC6 Blinding | `agents/workflow-visual-evaluator.md` contract | evaluator stays blinded whole-image; no Tier-3 writes to `validateDesignFidelityEvidence` fields | reusing the evaluator as measurement model; laundered estimates in contract fields | code review + tests asserting fields unset under Tier 3 | owner review |
| AC7 Score scale | `work-design.js:1572` `score < 3 \|\| score > 4` (deliberate 4-point scale) | gate-derived `visualEvaluation` scores on 0–4; evaluator prompts state the scale | raising the bound to 5; 5-point-scale prompts | test fixtures max 4 + prompt assertions | repo verify gate |

## Planning contract — implementation units

### P0 — Deterministic web validity

- **Goal.** `capture.mjs` + determinism harness + rules R1–R5 + finding format + cheap checks + SVG evidence + telemetry: the measured foundation every later phase trusts.
- **Files.** New: `scripts/ui-gate/capture.mjs`, `scripts/ui-gate/validity-rules.mjs`, `scripts/ui-gate/overlays.mjs` (SVG + 30-line HTML viewer), `scripts/ui-gate/allowlist.json` (repo-local), `scripts/fixtures/ui-gate/defects-validity.json`, `scripts/test-ui-gate-validity.mjs`. Reuses: `scripts/fixtures/capabilities/run-browser-smoke.mjs` (headless-shell launch pattern), `scripts/fixtures/capabilities/browser-calculator.html`, telemetry path in `extensions/work-models.js`.
- **Approach.** Headless-shell `--dump-dom` + `--screenshot=`; injected page script suppresses animations/transitions/`scroll-behavior`, awaits `document.fonts.ready` + every `img.decode()`, pins `deviceScaleFactor`, self-reports normalized geometry into a `<script type="application/json">` node. Rules consume `geometry.json` only. CDP fallback is an explicit decision point, not a default.
- **Test scenarios.** (a) byte-identity ×10 on `browser-calculator.html`; (b) each seeded defect class in `defects-validity.json` fires its rule exactly; (c) clean surfaces → zero findings; (d) allowlist suppresses a whitelisted overlap; (e) token/alignment invariant catches a 3px sibling-gap drift; (f) content assertion fails on placeholder copy.
- **Verification.** `node scripts/test-ui-gate-validity.mjs` green; determinism run archived; telemetry line lands with `ui_gate_round` fields.
- **Acceptance (source §3 P0).** Byte-stable across 10 consecutive runs; zero findings on every existing HTML surface in the repo; 100% recall on `defects-validity.json`.

### P1 — Fidelity from approved candidate

- **Goal.** Spec side = candidate HTML captured with the same profile; matcher + acceptance + contract-field production; measured `validateDesignFidelityEvidence`.
- **Files.** New: `scripts/ui-gate/spec-capture.mjs`, `scripts/ui-gate/fidelity-matcher.mjs`, `scripts/ui-gate/contract-evidence.mjs`, `scripts/fixtures/ui-gate/defects-fidelity.json`, `scripts/test-ui-gate-fidelity.mjs`. Modified: `extensions/work-design.js` — `designHandoffContractPrompt` gains optional `layoutAssertions`/`elementsRef` wording (required key set unchanged).
- **Approach.** Anchor-first matching (`Map.get` on `data-ce-el`), greedy cascade fallback; per-element acceptance per R10; structural order topology + `layoutAssertions`; region fallback; emit `geometryDeltas`/`typographyDeltas`/`responsive.*`/`regions` measured.
- **Test scenarios.** (a) wrong-position / wrong-size / wrong-colour / missing-region / anchor-missing seeded defects each fire (100% recall); (b) clean variant passes with zero deltas beyond thresholds; (c) handoff with `elementsRef` accepted, handoff without it still valid (AC1); (d) emitted scores ≤ 4 (AC7); (e) candidate renders in the same profile (validate week 1 — risk below).
- **Verification.** `node scripts/test-ui-gate-fidelity.mjs` green; `scripts/test-work-design.mjs` + `scripts/test-work-design-fidelity.mjs` still green (AC1).
- **Acceptance (source §3 P1).** 100% recall on `defects-fidelity.json`; clean variant passes.

### P2 — Repair loop

- **Goal.** `work-ui-gate` extension driving bounded, monotone convergence with recipe hints and human escalation.
- **Files.** New: `extensions/work-ui-gate.js`, repair-recipe table (`scripts/ui-gate/repair-recipes.json`). Modified: `extensions/work-models.js` (telemetry event wiring), escalation content via `extensions/work-dialogs.js`, leases via existing `work-action-leases`.
- **Approach.** Round flow per R15; success predicate per R16 (stable ids, per-id monotonicity, count tiebreaker); own round counter in the gate run record; re-verify targeted ids + cheap full validity pass each round; escalation dialog shows SVG/HTML side-by-side (source §0.13).
- **Test scenarios.** (a) seeded defects repaired within 3 rounds with monotone telemetry; (b) round 2 non-improving → early stop; (c) rect-only change does not renumber a finding id; (d) Strict-policy escalation renders through `work-dialogs.js`; (e) concurrent gate runs serialize on leases.
- **Verification.** `node scripts/test-ui-gate-repair.mjs` (new) green; existing verify gate green.
- **Acceptance (source §3 P2).** Seeded defects repaired within 3 rounds with monotone telemetry.

### P3 — Hardening

- **Goal.** CI cheap-mode + fingerprint, geometry-only mode, R6 focus-visible, R7 min-target-size, R8 state-coverage, computed WCAG contrast.
- **Files.** New: `scripts/ui-gate/fingerprint.mjs`, state-navigation acceptance helper; extensions to rules/matcher; tests.
- **Approach.** Hash render-affecting globs (styles/templates/components/tokens; include token/component/style globs — risk below); unchanged fingerprint → reuse last verdict with telemetry on reuse; R8: acceptance script navigates states, gate asserts non-degenerate geometry hashes + state copy presence.
- **Test scenarios.** (a) unchanged fingerprint reuses verdict in <5 s; (b) token change invalidates; (c) R6/R7 seeded defects fire; (d) state with degenerate geometry flagged; (e) contrast 4.4:1 flagged at 4.5:1 threshold.
- **Verification.** `node scripts/test-ui-gate-hardening.mjs` (new) green.
- **Acceptance.** Source §3 P3 (cheap-mode + fingerprint, computed contrast/focus, R6–R8 working on fixtures).

### P3.5 — VLM geometry bridge (Tier 3)

- **Goal.** The full binding protocol of the product contract (items 1–14), gated behind the calibration precondition.
- **Files.** New: `scripts/ui-gate/tier3/measure.mjs` (closed-set protocol + verification chain), `scripts/ui-gate/tier3/probes.mjs` (grid cross-check, pixel probe, edge-snap, text plausibility), `scripts/ui-gate/tier3/rules-whitelist.mjs`, `scripts/ui-gate/tier3/hysteresis.mjs`, `scripts/ui-gate/calibrate-web.mjs` + report artifact, `scripts/test-ui-gate-tier3.mjs`. Modified: telemetry (`vlmCalls`, `tokens`, `captureTier`, `measuredBy`), repair loop (Tier 3 round cap 2, advisory-first policy).
- **Approach.** Model calls live inside the capture script (one compact JSON line last — AC2). Confidence routing-only; crop-and-re-ask escalation; BLOCKED on quarantine >30%, schema-unparseable, budget-exceeded.
- **Test scenarios.** (a) hallucinated rect over flat background quarantined by pixel probe; (b) grid-cell mismatch quarantined; (c) edge-snap refines a high-contrast widget to ±2px; (d) budget cap emits `capture-budget-exceeded` → BLOCKED; (e) calibration harness on `browser-calculator.html` produces the report; (f) no `validateDesignFidelityEvidence` field populated under Tier 3 (AC6).
- **Verification.** `node scripts/test-ui-gate-tier3.mjs` green; calibration report artifact exists and meets AC5 before the tier is enabled anywhere.
- **Acceptance (source §3 P3.5).** Calibration gate: ≥95% localization, ≤2% false `region-missing`, published p50/p95, tolerances at measured p99.

### P4 — Native captures (three independent rows)

- **Goal.** Android, Windows UIA, Python GUI capture profiles normalizing into the same `geometry.json`.
- **Files.** New: `scripts/ui-gate/profiles/android.mjs` (`adb exec-out screencap -p` + `uiautomator dump` XML → bounds/text/clickable), `scripts/ui-gate/profiles/win-uia.mjs` (PowerShell/.NET UIA dump — zero deps), `scripts/ui-gate/profiles/pygui.mjs` (tkinter/Qt/wx introspection helper, ~30 lines, debug-mode self-report), histogram colour sampler for off-web surfaces, emulator fixture with seeded defect; per-profile tests.
- **Approach.** Each row is independently shippable; colours off-web via histogram modes (web uses `getComputedStyle` — exact, deterministic). Capability probe + retry + tolerant parse for uiautomator flake.
- **Test scenarios.** (a) Android emulator fixture: seeded overlap defect fires R2; (b) WinUI tree dump normalizes to `geometry.json` and passes the gate on a fixture app; (c) tkinter helper self-report round-trips.
- **Verification.** Per-profile test scripts green (emulator-gated rows skip gracefully when no device — recorded, not silently passed).
- **Acceptance.** Source §3 P4: native profiles produce full-gate coverage on their fixture targets.

## Scope boundaries

**Non-goals / cuts (all deliberate, source §0.9 + §4):**

| Cut | Reason |
|---|---|
| VLM numeric bbox **spec** derivation | Manufactures plausible-wrong numbers that then drive automated edits (measurement-side use is Tier 3, bound above) |
| Tolerance auto-tuning (old P5) | Gate silently widens its own thresholds exactly when the codebase degrades |
| Screenshot-only Windows | UIA un-cut to P4 on recurring targets; screenshot-only still runs zero rules |
| `zOrder` handoff field | Undecidable from design data; `elementFromPoint` answers the real question |
| PNG overlay rendering | SVG+HTML viewer: zero deps, diffable, better in review dialog |
| Hungarian assignment | Residual unmatched set is ~3 elements |
| Web pixel colour sampling | `getComputedStyle` is exact and deterministic (histogram modes only off-web) |
| `ui-gate` proof kind / new adapters / handoff v3 | All expressible today; bumps break existing handoffs |
| Games (Unity/Unreal/canvas) without an engine hook | Pixel-only refused by design; documented stance — one dump function in a debug build emits `geometry.json` |
| iOS native, React Native / Flutter captures | Unplanned (needs macOS / app cooperation); ladder + BLOCKED semantics cover them honestly |

## Risks (source §5, verbatim mitigations)

| Risk | Mitigation |
|---|---|
| Self-report geometry script vs page CSP/parity | Fixture-first; CDP fallback path pre-planned |
| Candidate HTML renderable in same profile (Opus ~0.75 confidence) | Validate in P1 week 1; `validateReferenceCaptureReceipt` evidence suggests yes |
| Threshold constants (4px/2%/2px) uncalibrated | Calibrate against calculator benchmark in P0/P1 |
| uiautomator flake (P4) | Capability probe + retry + tolerant parse |
| Fingerprint misses indirect render inputs | Include token/component/style globs; telemetry on verdict reuse |
| Capture matrix exceeds 900 s adapter ceiling | Split across proofs; cheap-mode skips unchanged cells |
| VLM rect-precision tail (est. p95 60–80 px vs thresholds) | Calibration gate at measured p99; deterministic probes + edge-snap mandatory before any finding fires |
| Tier 3 noise-driven edits / false convergence | Categorical findings only (no correction vectors); Schmitt trigger + diff-gated resolution; cap 2; BLOCKED on degradation |

## Open questions

**Blocking:** none — every material decision closed through two adversarial review rounds (2026-09-04).

**Deferred (each has a default and a decision point, none blocks the roadmap start):**

1. Tier 3 measurement model selection (which model / CLI wiring inside the capture script; optional different-family second pass) — decide at P3.5 start; default: the repo's current strongest multimodal model via subprocess, confidence routing-only.
2. Threshold calibration constants (`max(4px, 0.02×W)`, 1px/2px invariants, 8% Tier 3 start) — measured against the calculator benchmark in P0/P1; Tier 3 tolerances at measured p99.
3. Anchor fail-closed rollout — after anchor scaffolding lands in new projects; P1 ships advisory-only.

## Verification contract

- Every unit ships with a `scripts/test-ui-gate-*.mjs` runnable standalone and wired into `scripts/verify-package.mjs` (the repo's canonical gate: `npm run verify` / `node scripts/verify-package.mjs`).
- Acceptance contracts AC1–AC7 above are the cross-phase invariants; AC1/AC2/AC4/AC7 are enforced by tests, AC3/AC5/AC6 by archived artifacts + owner review.
- No phase may weaken an earlier phase's green state; regressions fail the gate, not a review note.

## Definition of done

P0–P3.5 complete when: verify gate green end-to-end; all acceptance fixtures at 100% recall with zero clean-surface findings; determinism and calibration artifacts archived; telemetry event live with real data. P4 rows complete independently per their fixtures. The gate is wired into the workflow via `inferVerificationContract` classification and explicit action, produces measured `validateDesignFidelityEvidence`, and every unplanned platform reports honestly (ladder tier or BLOCKED) — never a fake verdict.

## Sources

- `.pi/ui-gate-plan/plan-final.md` — final v2 plan (authoritative source for this artifact)
- `.pi/ui-gate-plan/opus-review.md`, `.pi/ui-gate-plan/opus-review-2.md` — adversarial reviews (claims source-verified 2026-09-04)
- `extensions/work-design.js` — handoff whitelist/validation (`validateDesignHandoff`, `designHandoffContractPrompt`, `validateDesignFidelityEvidence`, 0–4 scale at :1572)
- `extensions/work-capability-adapters.js` — spawn contract (900 s / 2 MB / last-line JSON)
- `scripts/fixtures/capabilities/run-browser-smoke.mjs`, `browser-calculator.html` — headless-shell pattern and ground-truth fixture
- `extensions/work-models.js` — telemetry path
- `extensions/work-dialogs.js`, `work-action-leases` — escalation and concurrency
- `agents/workflow-visual-evaluator.md` — blinding contract
