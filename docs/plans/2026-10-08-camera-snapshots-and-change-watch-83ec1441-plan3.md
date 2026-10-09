---
plan3: true
status: active
created: 2026-10-08
updated: 2026-10-08T21:35:27.873Z
started: 2026-10-08T20:25:28.314Z
---

# Camera snapshots and change-watch

## Original request

> Give the model visual access to a physical device it can operate, especially a printer printing, without repeatedly taking phone pictures and uploading them. Add explicit per-project camera opt-in, default OFF, and camera selection in project settings. Capture still images only, either one shot or a finite series with time between shots; never record video. Show a conspicuous red indicator while the camera is actually being used. Store images temporarily and remove older images after roughly a day.
>
> Request authorization with these choices: one shot or burst, one hour, current day, or 48 hours. The model can first take one full-size image, then specify what area it needs and request cropped subsequent images, with lower resolution for monitoring and more detail when reading text. Also support a bounded local change-watch: continually sample for changes such as an LED switching or a screen changing, retain the event frame, and let the model sleep until a meaningful change occurs instead of accumulating a huge number of images.
>
> Also capture when stuff stops changing: run a printout, wait for it to finish, then capture the image. This adds a settled-state capture use case alongside adaptive change capture.
>
> Capture this discussion as a Plan3 draft, including Opus/Astra's ideas and the remaining decisions. Do not implement product code, commit, push, or disturb the other session's unrelated work.

## Requirements and boundaries

- **R1 — Project opt-in:** Enable camera defaults OFF; an explicit project-only device picker is required. Ignore global camera values. Selection alone never opens or enables a camera; do not fall back to another device, especially a user-facing webcam.
- **R2 — Stills:** One still or a finite series with requested intervals; no audio or recorded video files. Continuous authorized local watch sampling is permitted, not video recording.
- **R3 — Visible access:** Unmistakable red actual-use indication, including warm-up and monitoring, distinct from enabled configuration or permission. Native acquisition is local-TUI-only, including saved grants; deny RPC, print and headless children before acquisition. Missing warning UI fails closed; losing the owning UI cancels acquisition. Source: Q-12 and D-20.
- **R4 — Authorization:** Direct human choices: one shot or burst, one hour, current day, or 48 hours. For watches the single-use choice names one bounded watch and shows its maximum duration. Persist fixed project/device-bound time grants across reload/restart, never restart hardware automatically. Current day ends at the displayed local calendar boundary, not rolling 24 hours. Denial grants nothing. Sources: Q-03, Q-05 and Q-06.
- **R5 — Temporary images:** Dedicated camera-owned storage outside the repository; code-owned cleanup after approximately 24 hours. Evicted tail data is deleted immediately. Shutdown delays cleanup until next startup; Windows is not assumed to clean it automatically. Provider copies and Pi session history are not erased by file deletion.
- **R6 — Model-directed crop and resolution:** Full-size overview followed by validated region and output-size requests; small monitoring images and detailed text crops. Distinguish full field of view from native resolution; never silently downgrade an explicitly requested full-size capture. Crop and downscale before saving and sending subsequent images; cropping limits shared content, not sensor field of view. No mandatory manual crop editor.
- **R7 — Adaptive multi-change watch:** Preserve several brief LED and screen states in a transaction shorter than two seconds without real-time model analysis. User starting targets: approximately 20 initial images (often five meaningful images), then at most one retained image per five seconds, then approximately one per minute, and approximately 30 seconds without qualifying change to stop. These are not measured guarantees. Elapsed-time stages, one early plus one final delivery, protected initial burst with rolling tail and final slot, and longer explicit grant-bounded requests are selected. Calibrate exact stage windows, thresholds, sampling rate and count and byte limits in CAM-02; do not reopen policy questions. Sources: Q-04 and Q-07 through Q-11.
- **R8 — Detection versus retention:** Keep fast detection and quiet tracking through sparse retention intervals. No retained image is not proof of stability. No per-sample model calls or unbounded saved stream. Deliver selected acquired frames with timestamps and order, not delayed replacement photographs. Generic visual change is evidence, not a verified semantic diagnosis.
- **R9 — Settled-state capture:** Same bounded engine, grants, crop and resolution, continuous detector, red WATCHING warning, expiry and cancellation and retention. Arm before the operation, return readiness, observe qualifying activity, then emit one fresh final still and wake after the requested quiet interval. The approximately 30-second example is not a universal value. Visual stability is not printer-job completion; use an existing printer-status API in the caller when necessary, without adding a printer controller.

### Safety and engineering contracts

- Turning OFF revokes grants, cancels work and releases hardware. Project or device changes never transfer permission. Validate configuration, device, expiry and owning UI immediately before acquisition and throughout watches.
- Bound counts, sampling rate, resolution, bytes, runtime and emitted events. Validate crop geometry, sizes and intervals at the tool boundary. Model arguments never supply executable paths, shell fragments, URLs, output paths or device fallbacks.
- Cancellation, expiry, timeout, shutdown and reload terminate owned acquisition. Keep the red indicator and ownership until release is confirmed; a UI flag is not hardware-close proof. Preserve blocked ownership and explicit retry on closure failure.
- Treat images as untrusted observations, never instructions or printer safety interlocks. Observation does not confer printer-control authority.
- Native consent is an application boundary, not an OS/process sandbox. Unrestricted shell and file tools can invoke FFmpeg or edit grants. Agent-directory storage and direct consent reduce accidental exposure but are not unforgeable. Permission issuance stays off the remote-answer bus; whole-agent sandboxing is outside scope, and a command regex is not enforcement.
- Return actual supported image content with a bounded manifest: capture frame ID, timestamp, device, geometry, resolution, sequence index, encoded bytes, source expiry and availability. Preserve manifests through trimming and compaction; metadata is not pixels. Recover only an existing unexpired retained source; never silently recapture missing history or mislabel a new authorized observation as recovery.
- Configured non-vision models use the existing vision bridge; disclose another model's interpretation. Bound batches within the 32-image cache with headroom, without enlarging the cache or bypassing payload trimming. Unrelated images, session changes and compaction can invalidate references. Capture frame IDs remain distinct from content hashes so repeated-looking states remain separate events.
- Use monotonic stage, quiet and deadline timing and fixed persisted consent expiry; clock changes must not extend access. Long grants do not extend photo TTL. Beyond 24 hours keep only metadata and references for already delivered initial frames, disclose unavailable pixels, and bound remaining tail and final data.
- Bound owned files, frame buffers and queued delivery payloads, not just returned lists. No unbounded warm-up or sample files. Stalled or disconnected streams, faults, aborts and expiry are explicit partial or terminal outcomes, never successful quiet events.
- No performance claims without the repository's matched end-to-end benchmark; downscaling and local sampling do not establish measured runtime, token or cost savings.

### Non-goals

- No recorded video or audio, live-preview server, broker daemon, remote monitoring service, automatic printer emergency stop, general surveillance or subscription framework, unbounded watch or provider call per sample.
- No mandatory manual crop-selection UI. No changes to Plan3 idea dialogs, advisor selection, progress footer or the other session's OpenDesign work.
- Initial scope: local Windows cameras and an existing compatible FFmpeg installation only. No network or cross-platform backend, bundled or downloaded FFmpeg or Windows-native helper without user-approved scope expansion.
- The original planning-only implementation and device-access restriction was superseded by D-21; it never authorized live access. Preserve unrelated dirty work and do not automatically commit or push. Historical planning restrictions and advisor dispositions are in (log).

## Decisions

- **D-01 — Camera capability is explicit and project-local, default OFF.** Source: user request for project settings and camera selection. Rationale: a tool must not silently turn on unrelated cameras or obtain global background access.
- **D-02 — Stills, not recorded video.** Source: original user request. The user subsequently requested constant change readings; that revises the scope to permit continuous local sampling for a watch, while retaining the prohibition on recording a video stream. Warm-up/sensor streaming must not be misrepresented as video-file recording or as no camera access.
- **D-03 — Authorization offers one shot/burst, one hour, current day, and 48 hours.** Source: user request plus applied Q-03/Q-05/Q-06. Current day means end of the local calendar day; time permission persists until expiry across reload/restart, without restarting hardware. Single-use watch permission is explicitly labeled one bounded watch with a shown maximum duration. The earlier advisor question about permission versus a popup for every frame is superseded by this grant-menu requirement.
- **D-04 — Crop and resolution are tool-requestable after an overview.** Source: latest user request. Rationale: only send the part and detail needed, rather than huge repetitive photographs; monitor motion with small images and read text with a detailed crop. A persistent user-drawn crop setting was Opus's optional idea, not the selected interface.
- **D-05 — Add local change-triggered sampling and model wake-up.** Source: latest user request. This supersedes the earlier agent/Opus suggestion to exclude motion-triggered capture. No recorded video or per-sample model analysis is implied.
- **D-06 — Red visibility is a requirement, not decoration.** Source: user request for a research-like activity indicator; both advisors agreed. Whether the implementation uses a research-style widget or fixes footer styling is an implementation seam, not an approved product change made during this discussion.
- **D-08 — Local Windows camera first.** Source: applied Q-01 selection. Explicit device selection remains required; no network-camera or cross-platform expansion is approved. This is a scope decision, not a camera compatibility test.
- **D-09 — Existing FFmpeg only.** Source: applied Q-02 selection. Detect the installed backend and fail clearly if absent/incompatible; do not auto-install, download or bundle it. A metadata-only check during reconciliation found FFmpeg 9.0.2 with DirectShow support on this machine; that does not verify a particular camera or any capture pipeline.
- **D-10 — Persist time permission, never implicitly restart a watch.** Source: applied Q-03 selection and its displayed option. Preserve unexpired scope-bound grants, but shutdown/reload stops and releases owned hardware; a later explicit request is needed to resume acquisition.
- **D-11 — Adaptive multi-event capture supersedes the first-event stop proposal.** Source: applied Q-04 freeform, preserved verbatim below. Capture short multi-state transactions locally and thin retained frames during prolonged change. Preserve the example targets (approximately 20 initial frames, then five-second/minute spacing, approximately 30 seconds quiet). Applied Q-08 through Q-11 subsequently settle the stage/budget/wake/runtime policies in D-16 through D-19; their exact numerical calibration is not yet verified. It is not approval to save every sensor frame or record video.
- **D-12 — Explicit one-watch permission is allowed.** Source: applied Q-05 selection. In a watch request, the single-use option must name the bounded watch and show its requested maximum duration; it must not disguise continuous access as a single photo.
- **D-13 — Current day ends at local midnight.** Source: applied Q-06 selection. Compute/display the next local calendar boundary at consent and persist that fixed instant; do not silently turn this into rolling 24-hour permission.
- **D-14 — Fast LED-oriented sampling is selected.** Source: applied Q-07 selection. Camera FPS, exposure, minimum observable state duration and long-running CPU/backpressure still require measurement. The answer chose a profile, not a verified numerical sampling rate. Applied Q-11 later authorizes longer explicitly requested grant-bounded runtime under D-19, not an unlimited watch or a demonstrated sustained-load capability.
- **D-15 — Add settled-state capture using the existing watch engine.** Source: user's request to capture when things stop changing, such as photographing a printout after it finishes. This mode emits one settled image/wake, not the adaptive multi-change batches discussed in Q-08/Q-09/Q-10. Proposed safeguard: for an operation started after watch readiness, observe qualifying activity before starting the finish/quiet trigger, so an initially idle printer is not mistaken for a completed print. Camera evidence can establish visual stability, not job success; use an already available printer-completed status in the caller when necessary, without adding a printer-specific controller to the camera tool.
- **D-16 — Elapsed-time retention stages.** Source: applied Q-08 selection. Stage progression follows calibrated elapsed time from the first qualifying post-readiness activity, not retained-frame counts. An exhausted stage image cap stops additional saves in that stage; it does not accelerate promotion or restart another unlimited burst. Fast detection/quiet tracking stays active throughout.
- **D-17 — Fast-transaction batch plus final batch.** Source: applied Q-09 selection. Adaptive mode produces at most one bounded early batch after its fast phase and one final batch/summary at quiet or terminal outcome; no periodic/per-image model wake. If the watch ends before the early batch is delivered, coalesce available evidence into one correctly labeled final delivery. Preserve chronological frame identities and do not reattach already delivered frames merely because they remain in the protected burst. Settled-state mode still produces only its final image. Parent abort/session-change policies must prevent a stale camera callback from restarting a deliberately stopped conversation.
- **D-18 — Bounded initial burst and rolling tail.** Source: applied Q-10 selection. Preserve initial transaction evidence, replace older sparse tail frames within count/byte caps, reserve a final-state slot, and continue local detection until quiet/deadline rather than stopping merely because the retention slots fill. Delete evicted managed tail files and release their memory; merely omitting them from a result while leaving every file on disk does not satisfy the budget. Report replaced/thinned/dropped frames. The example 20 initial + 10 tail + one final is a proposed numerical default, not a separately selected total.
- **D-19 — Longer grant-bounded requests.** Source: applied Q-11 selection. Each watch has an explicitly requested/displayed deadline bounded by remaining consent and a declared implementation hard maximum; continuing motion cannot extend it. A one-watch grant has its displayed scope/deadline and is consumed once; it is not reusable timed permission. Quiet can end the job earlier. Persistent time permission never automatically resumes hardware, and long-running capability remains subject to real sustained-load checks.
- **D-20 — TUI-only camera access, including saved grants.** Source: applied Q-12 selection. Only an eligible local TUI with usable consent/active-warning UI may open hardware through the native camera capability. RPC, print and headless child sessions cannot acquire merely because the project/device has saved permission or their parent has a TUI. Existing time grants may remain stored until their fixed expiry, but cannot bypass the mode gate or auto-resume hardware. Loss of the owning eligible UI must cancel/release active acquisition and invalidate pending callbacks; metadata/retention cleanup and release must still work outside TUI. No non-TUI camera client/proxy is added. This settles product scope, not live camera permission or verified UI/backend behavior.
- **D-21 — Execute the approved plan in the current agent/model.** Source: user's current Plan3 execute/resume request, superseding D-07 and the historical planning-turn non-goals/resume restrictions only for implementation. Preserve all settled camera policies and unrelated dirty work; no legacy work/goal/background-verifier orchestration, automatic commit/push or additional delegation. This execution request does not select a physical camera or replace CAM-02's explicit device-specific access/foreground-warning requirement. CAM-01 readback remains supported by twelve preserved applied answers/D-08 through D-20; no implementation or hardware check is implied by that checked box.
- **D-22 — Implement first; defer hardware checks.** Source: user selected “Implement first; defer hardware checks” in the execution handshake after current FFmpeg/PnP discovery found no accessible camera. Rationale: deliver OFF-default code and deterministic synthetic checks without waiting for a connected camera. This explicitly relaxes CAM-02's calibration-before-implementation ordering, not the permission, visible-warning, storage-before-acquisition or fail-closed device rules. Limits are provisional engineering defaults, never described as measured; CAM-02, live UI verification and CAM-10 remain incomplete until actual evidence is available. This is not permission to open a camera, not approval of non-TUI camera use, and not acceptance of final completion without the deferred checks.

## Open questions

### Blocking

None.

### Deferred

- **Q-13** Which actual connected local Windows camera will be selected for the deferred physical calibration and acceptance?
  - Context: Current FFmpeg 9.0.2 supports DirectShow, but list_devices reported no discoverable video devices and Windows present Camera/Image inventory returned empty output (exit 1). D-22 explicitly permits implementation first, not completion without CAM-02/CAM-10 evidence. Device identity, warm-up/exposure/FPS, brief-state recovery, driver release, live red warning and representative printer behavior remain unavailable. No frames were acquired. Source: execution discovery and D-22; native project camera controls implemented in CAM-03.
  - Recommendation: Connect the intended printer-facing camera and select its enumerated alternative identity in the native project Camera submenu, then authorize bounded foreground calibration through direct local UI. A Plan3 answer is readiness/target information only, never a live camera grant.
  - Option: Select the printer-facing camera — connect it, choose its actual DirectShow identity in project settings and arrange the pending real-camera/printer trials.
  - Option: Specify another local Windows camera — identify the actual device/setup so availability can be checked; native selection/consent and all physical/live-UI checks still apply, with no network-camera scope expansion.

## Resume context

Checkpoint: active; CAM-01 and CAM-03 done; CAM-04 WIP. D-22 permits provisional implementation, not waived physical and live-UI qualification. Q-13 is deferred target readiness, not camera permission. No acquisition tools are registered and no frames were acquired. Preserve unrelated dirty work using Git as baseline.

Next: finish CAM-04's finite supervised FFmpeg backend using controller lease, guard, attachStop and worker; pin the existing executable and test subprocess cancellation, failure and parent loss with synthetic fixtures. Closure must be confirmed before ownership release. Then CAM-06 storage and CAM-08 warning precede CAM-05 registration. Controller/state helper are wired; persistent consent and mock ownership/close tests passed (log), not hardware evidence. Camera suites still need GENERAL_TESTS integration.

Active blockers: no discoverable physical camera; CAM-02 and CAM-10 await selected hardware and direct foreground permission; CAM-14 awaits live eligible TUI and theme verification. Fixed-expiry grants never restart acquisition. Metadata crash locks fail closed; remove only with all Pi stopped. Host SDK declaration warning and incomplete LSP coverage remain recorded in (log).

## Phases

### Phase 1 — Policy and project controls

- [x] **CAM-01** Resolve source, backend, consent and watch policies; twelve applied answers establish D-08 through D-20 (log).
- [x] **CAM-03** Add project-only OFF-default settings, explicit selection and direct local consent with TUI gating; targeted synthetic checks passed (log).

### Phase 2 — Safe acquisition prerequisites

- [wip] **CAM-04** Finish scoped grants and supervised ownership, atomic one-use claims, expiry, revocation and cancellation with confirmed backend release.
  - Implemented: camera-only state store is wired into the controller; canonical project and exact-device grants, fixed expiry, revocation fencing, bounded corrupt-store refusal, exclusive case-folded device ownership and atomic one-use claims. Controller and mock closure checks passed (log); actual FFmpeg supervision remains unfinished.
  - Store grants under PI_CODING_AGENT_DIR or the default `C:\Users\Flex\.pi\agent`, outside repository or exportable settings. Validate schema, scope and fixed expiry; use atomic cross-session consumption, revocation and ownership. Store construction and settings-only edits allocate no resources when unused.
  - Pending approvals bind canonical project and revision plus synchronous assertApproval inside the exclusive lock; alias retargeting, generation, settings or signal changes or interrupted lock waits cannot mint consent. Metadata restore cannot enumerate or acquire; unsupported modes cannot use saved grants or consume single-use permission. Cleanup and release outside TUI must not delete a valid time grant merely because that mode cannot use it.
  - Existing handle: lease and signal, guard(), attachStop(async callback), worker(workerPid, childPid), finish(). A requestKey must identify a unique native invocation and normalized parameters, not a reusable summary. Deadlines cannot grow during popup dwell; expired requests cannot persist new consent. Once access begins, consume one-use even on failure; no unlimited retry.
  - Exact next work: resolve and pin existing FFmpeg; supervised argument-vector process with no shell, audio, network or fallback. Test cancellation, faults and parent loss using synthetic subprocess fixtures. A Node IPC supervisor that stops on parent disconnect is an option, not a broker, service or dependency. Wait for close callback before releasing lease; failed close retains ownership for explicit retry.
  - Register session_shutdown, session_before_switch, session_before_fork and tree navigation cleanup and generation invalidation; session_start restores metadata only. Disable, reload and project/device changes cancel work and suppress obsolete wakes.
  - State helper: observed backward-clock refusal, 1 MiB schema bound, exclusive state.lock and atomic replacement and process identity fields. Crash-left metadata lock fails closed; remove only with all Pi stopped. Do not reuse legacy work-action-leases.
  - Targeted checks: C-CAMERA, C-STATE, C-SETTINGS, C-DIALOGS, C-LSP and C-DIFF; subprocess fixtures never open a camera.
- [ ] **CAM-06** Add owned temporary image storage, confined deletion and approximately 24-hour startup, activity and timer cleanup.
  - Storage must work before native acquisition. Delete only camera-generated owned files; no repository photos or scratch scripts. Explain shutdown cleanup delay and provider and session-history limits. Tail eviction deletes immediately; long watches do not exempt burst files from TTL.
  - Targeted checks: C-CAMERA, C-STATE, C-LSP and C-DIFF; test expiry, confined deletion, corrupt or missing files and bounded disk/memory.
- [ ] **CAM-08** Implement red CAPTURING and WATCHING warning tied to actual acquisition and confirmed release, with distinct ARMED state.
  - Camera-specific widget uses semantic error coloring and explicit CAMERA CAPTURING and WATCHING text. Research is a layout example, not red coloring; a setStatus string can be stripped or dimmed by the footer and is insufficient. Fail closed before acquisition if UI is missing; owning UI loss cancels work. Keep warning during warm-up and failed release. Live rendering qualification is CAM-14.
  - Targeted checks: C-CAMERA, C-FOOTER, C-DIALOGS, C-LSP and C-DIFF; cover new and saved grants, denied modes and lost UI.

### Phase 3 — Stills and continuous detector

- [ ] **CAM-05** Implement bounded single or burst capture, validated interval/crop and resolution and actual-image delivery with durable availability manifests.
  - Depends on CAM-03, CAM-04, CAM-06 and CAM-08; no native capture opens or saves before consent, storage and active warning work. Use provisional bounded defaults under D-22 until CAM-02 calibration.
  - Prefer enumerated DirectShow alternative identity over ambiguous friendly name/index. Detect required build and device features; missing/changed identity fails closed. Warm up exposure and focus without saving warm-up frames. For ordinary spaced shots, release between captures; document reopening latency and interval semantics and prevent catch-up bursts.
  - Crop and resize before persistence and delivery. Preserve requested full-size and detail and per-frame identity and manifest through native vision, trimming and non-vision routing; explicitly report unavailable/partial historical evidence.
  - Targeted checks: C-CAMERA, C-STATE, C-SETTINGS, C-LSP and C-DIFF; synthetic timing overruns, geometry/bytes, image stripping and bridge eviction.
- [ ] **CAM-07** Implement bounded continuous acquisition and fast regional change detection with readiness, actual-frame identity and noise handling.
  - Continuously open authorized acquisition is needed for brief transactions; reopening for each flash is insufficient. Readiness follows warm-up and baseline, before the caller operates the device. Separate acquisition and detection from CAM-11 retention and CAM-12 delivery; no model calls here.
  - Compare region or tiles rather than assuming a whole-frame scene threshold finds small LEDs. Use bounded buffers or pre-event queue if needed. Keep original triggering frames, capture order and on, off, then on returns; global deduplication must not erase events. Routine samples are discarded.
  - Provisional sampling, exposure and backpressure limits require CAM-02 measurement; disclose drops and minimum observable state duration. A sub-two-second transaction does not prove every state is observable. Fresh fast samples reset quiet tracking even through minute-spaced saves; stalls are faults, not stability. Noise and debounce must not suppress intended brief states.
  - Targeted checks: C-CAMERA, C-STATE, C-LSP and C-DIFF; timestamped fast-state, noise, exposure, stall and gradual-change fixtures.

### Phase 4 — Adaptive retention and model wake

- [ ] **CAM-11** Implement elapsed-time adaptive retention, protected initial burst, rolling tail and final slot and whole-watch count and byte limits.
  - Stages anchor to first qualifying post-readiness activity. Filling a stage cap stops saves, not stage-clock advancement or a fresh unlimited burst. Keep approximate user targets explicit; document provisional stage windows and caps and calibrate in CAM-02.
  - Detection and quiet tracking stays fast during five-second and minute retention. Keep chronological acquired event frames, replace and delete old tail data, reserve final evidence and report thinning, replacements and drops. Continue detection until quiet or deadline despite full retention slots.
  - Bound disk files, bytes, buffers and queued payloads. Simulated watches beyond 24 hours honor photo TTL; retain only metadata for previously delivered initial evidence and do not reattach expired pixels.
  - Targeted checks: C-CAMERA, C-STATE, C-LSP and C-DIFF; fake-clock stages, caps versus time, tail eviction, quiet reset and long-watch TTL.
- [ ] **CAM-12** Implement ready-before-operation, one fast-phase batch plus final delivery, native wake and bounded busy-session coalescing.
  - At most two logical adaptive deliveries; no wakes for sparse tail frames. Early quiet or termination coalesces available evidence into one labeled final delivery. Preserve chronological frame IDs; never reattach already delivered initial frames solely because the burst remains protected.
  - Return model idle without busy polling. Use supported Pi message and lifecycle APIs, not legacy work items, goals or background verifiers. Bind jobs/callbacks to owning session and lifecycle generation; deliberately aborted/switched conversations must not restart through stale callbacks.
  - Stop/release on quiet, deadline, revoke, abort or failure. Requested and displayed deadline is bounded by consent expiry and declared hard maximum; continuing motion cannot extend it. Retention budget filling alone does not stop detection under D-18. Expiry, fault and abort are partial or terminal outcomes, not quiet success.
  - Targeted checks: C-CAMERA, C-STATE, C-LSP and C-DIFF; busy queues, early termination, no duplicate attachments and stale, session and branch callbacks.
- [ ] **CAM-13** Add settled-state mode to the bounded watcher: readiness, observed activity, fresh-sample quiet interval and one final image and wake.
  - Initial idle cannot finish an operation not yet visibly started. Qualifying activity starts quiet tracking; meaningful or gradual cumulative change resets it. Fresh valid samples are required throughout the requested interval; stalls, timeout, disconnect and revocation do not yield settled success.
  - Discard routine samples; retain the actual fresh final frame with validated crop and resolution. Report visual stability with region, timestamps and quiet duration, not job completion. Paused or jammed or invisible printer activity can look stable; caller-side existing status confirmation adds no new camera/printer authority.
  - Targeted checks: C-CAMERA, C-STATE, C-LSP and C-DIFF; initial-idle, resumed activity, cumulative drift, faults, final identity and bounded resources.

### Phase 5 — Software integration

- [ ] **CAM-09** Integrate both camera suites in GENERAL_TESTS and verify utility registration with legacy workflow OFF and ON.
  - Import camera utility through workModelsExtension independently of the legacy switch. package.json already loads work-models.ts and packages extensions; no third extension entry or new image dependency is needed. Modules remain .ts with .ts sibling specifiers; no legacy work_* tools.
  - Deterministic coverage: OFF and deny, selected-device no fallback, direct consent versus remote-answer or import refusal, persisted grants without restart, fixed midnight including timezone and DST, one-watch scope and deadline and atomic concurrency, corrupt, expired or wrong-scope state, request overrun, crop and bytes, revocation, abort, reload, session and tree cleanup, confined storage and all CAM-07, CAM-11, CAM-12 and CAM-13 obligations.
  - Exercise headless child, RPC and print requests with new and saved grants, missing/lost UI and cleanup outside TUI. Settings import and reset cannot enable or mint permission; clearing or changing configuration revokes/cancels without waiting for legacy workflow refresh. Remote ask:answer or intercom ANSWER events while consent is pending must not issue/extend grants.
  - Image integration: native vision and configured non-vision delivery; at least 64 KiB images after two successful responses; all-image compaction; source eviction or TTL; bridge-cache eviction by unrelated images; repeated-looking events with distinct capture IDs. Manifests survive; historical missing pixels are honest, never silently recaptured or treated as directly verified process_image interpretations.
  - Targeted checks: all C-* software checks. Full suite at every phase boundary and before completion; disclose inconclusive LSP coverage. Mock success is software evidence only, not physical and live-UI qualification.

### Phase 6 — External qualification

- [blocked] **CAM-02** Calibrate identity, still/crop capability, warm-up, exposure, FPS, brief-state recovery, driver release and sustained load on hardware.
  - Prerequisite: connected selected local Windows camera (Q-13), explicit device-specific human calibration permission and conspicuous foreground warning until release.
  - D-22 defers calibration ordering, not acceptance. Existing FFmpeg 9.0.2/dshow metadata and failed device discovery are recorded in (log); no frames were acquired. Define measured numerical limits, reconnect/reboot/driver identity behavior, shortest detectable state, lag/drops and crop geometry; do not infer compatibility from backend types or an OS/app lock.
  - Targeted checks: C-BACKEND, C-DISCOVERY and bounded direct-UI camera trials; document measured limits and unsupported timing.
- [blocked] **CAM-14** Qualify live red camera warning, settings and consent UI and research and footer coexistence under the active theme.
  - Prerequisite: eligible local TUI with selected camera and direct human authorization for actual-use and release trials.
  - Verify CAPTURING and WATCHING is conspicuously red during warm-up and use and until confirmed release, including failed release; ARMED is distinct. Check purpose, device, request and expiry summaries, options, revocation, research and widgets and unsupported-mode denial. Loss of owning UI stops acquisition while cleanup/release remains available.
  - Targeted checks: live shared-UI trials plus C-FOOTER and C-DIALOGS; retain screenshots/observations and limitations in (log).
- [blocked] **CAM-10** Run real-camera, provider and printer acceptance for stills, crops, grants, adaptive transactions, settled capture and release/retention.
  - Prerequisite: calibrated selected camera and representative printer setup, live eligible TUI and explicit direct human trial authorization.
  - Demonstrate no repeated phone uploads: actual image return to active vision provider, monitoring resolution versus readable text crop, single or burst declared count, all lifetimes, restart and midnight behavior, one-watch scope, busy, reconnect, expiry and release and no automatic restart.
  - Arm and confirm readiness before operation; capture chronological short LED and screen states, continuing change and quiet stop with measured minimum state duration. Demonstrate detection versus retention versus wake cadence, thinning, budgets and partial outcomes, early and final batches and no per-sample calls. Disclose missed or dropped states and sustained-load limits, never claim guaranteed recovery.
  - Printout: readiness, visible activity then one stable-result image; separately test pause or fault and say visually stable, not job completed. If available, existing caller-side printer completion plus a still gives stronger evidence without new integration.
  - Verify OFF opens nothing; A never captures B; disable or expiry releases before warning clears; no video or audio, unbounded files or TTL exception. Do not claim mocks prove physical behavior or complete the plan without deferred qualification evidence or explicit limitation acceptance.
  - Targeted checks: real device, provider and printer trials, CAM-02 limits and CAM-14 observations; full software suite before completion.

## Checks

Canonical software environment: Windows PowerShell, working directory `C:\SOFT\git\ce-workflow`; existing Node and npm. Run each targeted command with `$env:CE_WORKFLOW_ENABLED = '0'` and then `'1'`. Commands below are relative to that exact directory; no hardware access is part of the software suite.

| ID | Canonical command or evidence source |
| --- | --- |
| C-CAMERA | `node "scripts/test-work-camera.mjs"` |
| C-STATE | `node "scripts/test-work-camera-state.mjs"` |
| C-SETTINGS | `node "scripts/test-work-settings.mjs"` |
| C-DIALOGS | `node "scripts/test-work-dialogs.mjs"` |
| C-PLAN3 | `node "scripts/test-work-plan3.mjs"` |
| C-FOOTER | `node "scripts/test-work-subscription-footer.mjs"` |
| C-REMOTE | `node "scripts/test-work-ask-remote.mjs"` |
| C-FULL | `npm run verify` (runs `scripts\verify-package.mjs`; both camera suites must enter GENERAL_TESTS) |
| C-DIFF | `git diff --check` |
| C-LSP | Active LSP probes on changed `.ts` and test paths; record missing host declarations, push-only or inconclusive results and probe-size limits. No CLI equivalent was recorded. |
| C-BACKEND | `where.exe ffmpeg; ffmpeg -hide_banner -version; ffmpeg -hide_banner -devices` (metadata, not physical compatibility) |
| C-DISCOVERY | `ffmpeg -hide_banner -nostdin -list_devices true -f dshow -i dummy`; `powershell -NoProfile -Command "Get-PnpDevice -PresentOnly -Class Camera,Image -ErrorAction SilentlyContinue \| Select-Object Status,Class,FriendlyName \| ConvertTo-Json -Compress"` (device discovery, not live capture consent) |

Run C-FULL in both workflow modes plus C-DIFF at phase boundaries and before completion. Add shared regression checks when their seams change. C-BACKEND/C-DISCOVERY use the same Windows working directory and existing installed FFmpeg; live camera commands require the selected identity, finite trial bounds and direct authorization specified by qualification steps, not invented universal capture commands.

Recorded current evidence: targeted camera, state, settings and dialogs checks plus diff check passed on the controller and helper state (log). Mock closure and two-process metadata claims are not FFmpeg release evidence. Camera suites are not yet in GENERAL_TESTS. Camera.ts has a missing host SDK declaration warning; state/test probes had zero findings but some push-only results were inconclusive, and work-models exceeds the 5000-line probe cap. Hardware, live red UI, provider routing and watch acceptance remain pending. Historical unrelated Plan3 checks and advisor completion are not camera evidence.

## References

All product paths are under `C:\SOFT\git\ce-workflow`; inspect relevant current sections only when their owning steps require them. Resume from the checkpoint, not by rereading all references.

| Reference | Steps and use |
| --- | --- |
| `extensions\work-camera.ts`; `extensions\work-camera-state.ts`; `scripts\test-work-camera.mjs`; `scripts\test-work-camera-state.mjs` | CAM-04 through CAM-13: implemented project controls/controller and state helper and deterministic fixtures; acquisition tools remain unregistered. |
| `extensions\work-models.ts` settingsPath/readSettings/readEffectiveSettings; workSettingsLoop/chooseWorkSetting; owns/hasProjectOverride/clearProjectOverride; UTILITY_SETTING_KINDS; exportSettings/importSettings | CAM-03, CAM-04, CAM-09: project-only rows with workflow OFF, ignore global values, import/reset invalidations. Camera row was appended to preserve cursor mapping; old line 29050 is extensionScoutProjectContext, not settings. |
| `extensions\work-dialogs.ts` showListDialog | CAM-04, CAM-08, CAM-14: native direct local camera UI with muted purpose line; never showAskDialog/ask_user or a non-TUI fallback for camera consent. |
| `extensions\work-ask-remote.ts` registerRemoteAskAnswers | CAM-09: optional intercom ask:pending/ask:answer route cannot issue or extend grants. |
| `extensions\work-models.ts` imagePayloadBytes/largeImagePart/stripProcessedPayloads/imageDropPlaceholder; `extensions\work-vision.ts` createVisionBridge | CAM-05, CAM-09, CAM-11, CAM-12: 64 KiB/two-successful-response stripping, compaction, 32-image content-hash cache and truthful frame manifests/recovery. |
| `extensions\subscription-footer.ts` install/render; `extensions\work-models.ts` showResearchContext and session lifecycle hooks | CAM-04, CAM-08, CAM-12, CAM-14: ANSI stripping/dim status, layout not red coloring, local TUI gating and shutdown/switch/fork/tree callback invalidation. |
| `package.json`; `scripts\verify-package.mjs` test discovery and GENERAL_TESTS; shared scripts named in Checks | CAM-09: imported utility registration and both camera suites in workflow-OFF verification; discovery alone is insufficient. |
| https://ffmpeg.org/ffmpeg-devices.html#dshow | CAM-02, CAM-04, CAM-05: DirectShow alternative names and duplicates; reconnect/driver identity stability still needs measurement. |
| https://ffmpeg.org/ffmpeg-all.html (select and scdet); Context7 `/websites/ffmpeg_documentation` | CAM-02, CAM-07, CAM-11: per-input-frame metadata and selection, not reliable small-LED detection guarantees. |
| https://learn.microsoft.com/en-us/uwp/api/windows.media.capture.mediacapture.capturephototostoragefileasync?view=winrt-26100; primary Windows privacy, driver-indicator and photo API pages in web artifact `mv005oh9h236z3` | CAM-02, CAM-14: consulted background; Windows-native helper was not selected. |
| `docs/plans/logs/83ec1441.md` — (log) | All steps: full pre-optimize plan, twelve applied raw Q-01 through Q-12 answers, advisor outputs and dispositions, historical amendments and evidence. Opus/Astra advice is not approval or hardware verification. |

Opus's retained recommendations: distinct OFF/ARMED/CAPTURING states, exact identity and no fallback, timestamps and actual images. Timed authorization and model-directed crops replace its different menu and optional manual crop; its blanket motion exclusion was rejected by the user's later request. Astra's retained recommendations: supervised cancellation, ownership, release between ordinary spaced shots, real red warning and bounded actual-image delivery. Parent's first-event stop and slow one-sample-per-second proposal were not selected. Continuous watchers have a different visibly active acquisition lifetime; all advice provenance stays in (log).

## Backlog

- Cross-platform or network-camera support, packaged/downloaded FFmpeg or Windows-native helpers require separate scope approval.
- Whole-agent sandboxing, general monitoring infrastructure and unrelated Plan3/OpenDesign work are outside this delivery.

## Amendments

- Prior reconciliation, review dispositions, submitted answers and execution checks live in (log); Q-01 through Q-12 are settled, not outstanding questions. D-07 is superseded by D-21; the historical no-camera-implementation planning restriction is not current execution scope. All other recorded decision IDs remain active with their recorded meaning.
- CAM-08 → CAM-08 + CAM-14: split software warning implementation from required blocked live UI and theme qualification. CAM-08 remains open; no qualification was waived or marked done. CAM-03's already recorded synthetic implementation completion is unchanged; its deferred live menu and consent verification is assigned to CAM-14.
- CAM-02 → CAM-02; CAM-10 → CAM-10: move existing hardware calibration and real acceptance to the final qualification phase under D-22. Physical prerequisites no longer keep authorized software implementation open; both qualification steps remain blocked.
- CAM-01 through CAM-13 retain stable IDs; no steps merged. CAM-04 remains WIP and existing completion evidence is unchanged. Status stays active; Blocking remains None and Q-13 remains Deferred. Prior history is in (log).
