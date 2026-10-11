---
plan3: true
status: active
created: 2026-10-08
updated: 2026-10-11T10:19:06.248Z
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
- **R4 — Authorization:** Direct human choices: one shot or burst, one hour, current day, or 48 hours. For watches the single-use choice names one bounded watch and shows its maximum duration. Persist fixed project- and device-bound time grants across reload and restart, never restart hardware automatically. Current day ends at the displayed local calendar boundary, not rolling 24 hours. Denial grants nothing. Sources: Q-03, Q-05 and Q-06.
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
- The original planning-only implementation and device-access restriction was superseded by D-21; it never authorized live access. Preserve unrelated dirty work; commit locally per D-28 and never push. Historical planning restrictions and advisor dispositions are in (log).

## Requirements

- **R-camera** The Logi C310 HD WebCam (D-23) is connected and chosen by its enumerated identity in the native project Camera settings.
- **R-printer** A representative printer setup is visible to the selected camera for real printout trials.

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
- **D-23 — Use the Logi C310 HD WebCam for calibration and acceptance.** Source: Q-13 answer “there is a logi camera now - Logi C310 HD WebCam useit”. Metadata-only discovery during reconciliation found it present (PnP Camera class, status OK, VID 046D, PID 081B) with DirectShow video alternative name `@device_pnp_\\?\usb#vid_046d&pid_081b&mi_00#7&16e5c5aa&0&0000#{65e8773d-8f56-11d0-a3b9-00a0c9223196}\global`; no frames were acquired. Its separate microphone endpoint is never opened (R2). Selection still happens in native project settings, and every trial still needs direct local authorization.
- **D-24 — Real-time grant trials are narrowed.** Source: Q-14 Relax. CAM-10 real trials cover one shot or burst, one time grant with a reload, revocation and release; grant lifetimes, local midnight and DST rely on CAM-09 fake-clock tests.
- **D-25 — No reboot trial.** Source: Q-15 Relax. CAM-02 measures identity after unplug and reconnect and after a Pi restart; behavior across a Windows reboot stays an unverified, disclosed limitation.
- **D-26 — One workflow mode for targeted checks.** Source: Q-16 Relax. Targeted checks run once in the default mode; C-FULL runs with CE_WORKFLOW_ENABLED set to 0 and to 1 at phase boundaries and before completion.
- **D-27 — Camera-specific image integration only.** Source: Q-17 Relax. CAM-09 tests actual image return through native vision and one non-vision bridge path, manifest survival after stripping and honest unavailable pixels; other shared-pipeline eviction cases go to Backlog.
- **D-28 — Local commit after each verified step.** Source: Q-18 Relax. After each verified camera step, commit locally only that step's files with a message naming the step ID; never push. This supersedes only the automatic-commit clause of D-21 and the Non-goals; the no-push rule stays.
- **D-29 — Continue camera-specific implementation despite unrelated global-check failures.** Source: execution ask_user; selected “Continue camera; keep failures recorded”. Keep unrelated files untouched, use targeted camera checks, and retain the failing workflow-ON full verification as a completion blocker until resolved or explicitly accepted; this is not acceptance of completion or hardware qualification.
- **D-30 — Provisional still limits (assumed).** Source: D-22 permits reversible engineering defaults before calibration. Ordinary still capture uses one second of discarded warm-up, at most eight returned images, 16 million pixels per image, 4 MiB subprocess output per capture, 1024-pixel default overview edge and a ten-minute maximum declared burst deadline. Intervals are minimum waits after confirmed process closure; reopening and warm-up add latency, with no catch-up burst. FullSize requests the largest enumerated native mode and fails rather than silently reducing it; all limits remain unmeasured until CAM-02.
- **D-31 — Provisional detection and retention defaults (assumed).** Source: D-22 allows reversible engineering numbers before CAM-02. Continuous acquisition defaults to 320x180 RGB at 10 samples/s, tiles of eight pixels, six-level channel noise floor and 0.08 tile change threshold; three-second stale-sample and 15-second baseline-readiness ceilings. Adaptive retention anchors at first post-readiness change: first two seconds protect up to 20 ordered initial observations; the next stage ends at 60 seconds and saves at least five seconds apart, capped at 12 stage saves; later tail saves are at least a minute apart. Tail retains eight frames, plus one final slot. Whole-watch budgets: 256 lifetime saves and 64 MiB encoded lifetime bytes, 32 MiB resident bytes, with one count and 1 MiB reserved for final evidence. Filling these provisional budgets thins evidence but never disables fast detection. CAM-02 must calibrate observability, noise, CPU, storage and practical stage targets.




## Open questions

### Blocking

None.

### Deferred

None.

## Resume context

State: active, 10/14 done. CAM-12 native ready/early/final wake and CAM-13 single settled capture are implemented, tested and locally committed (2a1a337, 1a4869c). Four camera tools registered. No hardware opened; no push.

No remaining runnable camera implementation. CAM-09 software integration is implemented and targeted checks pass, but required full workflow-ON gate fails in three unrelated suites: design-docs (old README heading), private-workflows (old extension inventory), wo-control (old commands). D-29 says preserve unrelated work; owner resolution or explicit acceptance is required. Full workflow-OFF verify passed; final ON run completed without timeout. Camera-caused exposure/count expectations were fixed and pass. Latest camera/state/settings/compaction and diff checks pass; LSP has missing SDK declarations, inconclusive and oversized coverage.

Next external actions: select/enable Logi C310 in native project Camera settings and directly authorize finite local-TUI calibration for CAM-02 and warning trials CAM-14; connect/position representative printer (R-printer off) for CAM-10. R-camera availability is not permission. Recheck the global gate after owner resolves/accepts the three failures. Keep hardware, sustained-load and live-provider qualification incomplete. Preserve unrelated Plan3/footer edits and generated sidecars; local commits only.

## Phases

### Phase 1 — Policy and project controls [think]

- [x] **CAM-01** Resolve source, backend, consent and watch policies; twelve applied answers establish D-08 through D-20 (log).
- [x] **CAM-03** Add project-only OFF-default settings, explicit selection and direct local consent with TUI gating; targeted synthetic checks passed (log).

### Phase 2 — Safe acquisition prerequisites [code]

- [x] **CAM-04** Scoped grants and short-lived IPC supervision implemented; synthetic cancellation, expiry, output bounds and abrupt parent-loss tests pass (log).
- [x] **CAM-06** Bounded owned image storage added with 24-hour startup, activity and timer expiry, immediate eviction and confined deletion (log).
- [x] **CAM-08** Camera warning widget gates acquisition, distinguishes ARMED, CAPTURING and WATCHING, and stays active through confirmed release (log).

### Phase 3 — Stills and continuous detector [code]

- [x] **CAM-05** Bounded still/burst and retained-frame recovery tools registered with native mode selection, pre-save crop/scale and durable manifests (log).
- [x] **CAM-07** Bounded continuous raw-frame acquisition and regional detector implemented, preserving actual ordered trigger frames and baseline readiness (log).

### Phase 4 — Adaptive retention and model wake [code]

- [x] **CAM-11** Elapsed-time adaptive retention, protected initial burst, rolling tail, reserved final slot and lifetime budgets implemented (log).
- [x] **CAM-12** Native ready-before-operation watch/stop tools, at-most-two wakeups and lifecycle-safe busy coalescing implemented (log).
- [x] **CAM-13** Settled-state watch mode emits one fresh final image after observed activity and uninterrupted visual quiet (log).

### Phase 5 — Software integration [code]

- [blocked] **CAM-09** Integrate both camera suites in GENERAL_TESTS and verify utility registration with legacy workflow OFF and ON.
  - Import camera utility through workModelsExtension independently of the legacy switch. package.json already loads work-models.ts and packages extensions; no third extension entry or new image dependency is needed. Modules remain .ts with .ts sibling specifiers; no legacy work_* tools.
  - Deterministic coverage: OFF and deny, selected-device no fallback, direct consent versus remote-answer or import refusal, persisted grants without restart, fixed midnight including timezone and DST, one-watch scope and deadline and atomic concurrency, corrupt, expired or wrong-scope state, request overrun, crop and bytes, revocation, abort, reload, session and tree cleanup, confined storage and all CAM-07, CAM-11, CAM-12 and CAM-13 obligations.
  - Exercise headless child, RPC and print requests with new and saved grants, missing or lost UI and cleanup outside TUI. Settings import and reset cannot enable or mint permission; clearing or changing configuration revokes or cancels without waiting for legacy workflow refresh. Remote ask:answer or intercom ANSWER events while consent is pending must not issue or extend grants.
  - Image integration (D-27): actual image return through native vision and one non-vision bridge path; manifests survive stripping; repeated-looking events keep distinct capture IDs; historical missing pixels are honest, never silently recaptured or treated as directly verified process_image interpretations.
  - Targeted checks: all C-* software checks. Full suite at every phase boundary and before completion; disclose inconclusive LSP coverage. Mock success is software evidence only, not physical and live-UI qualification.
  - note: Both camera suites added to GENERAL_TESTS; real workModelsExtension registration assertions cover all four camera tools with legacy workflow OFF and ON. Camera documentation added. Running final targeted software checks and both required full-suite modes; known unrelated global failures stay a completion blocker under D-29.
  - note: Software integration and camera-specific checks pass, including all four tool registrations with workflow OFF/ON, model-only consent exposure, custom-message native vision/explicit non-vision bridge, missing-source honesty, selected-device no fallback and saved-grant RPC/print/JSON denial. Both suites enter GENERAL_TESTS. Updated only camera-caused exposure/count expectations in compaction and goal tests. Full workflow-OFF verify passed; final workflow-ON verify completed with three unrelated failures retained under D-29: test-work-design-docs (old README heading), test-work-private-workflows (stale extension inventory), test-work-wo-control (stale command inventory). These need owner resolution or explicit acceptance; step cannot be verified complete while required global check fails.
  - check: node scripts/test-work-camera.mjs; node scripts/test-work-camera-state.mjs; node scripts/test-work-settings.mjs; node scripts/test-work-compaction-notifications.mjs; git diff --check: passed. Dialog/footer tests passed; full verify OFF passed; full verify ON after camera-count fix: exit 1, exactly three unrelated failures. Active LSP scripts: one confirmed clean, three inconclusive, goal file too large. Hardware not opened.

### Phase 6 — External qualification [think]

needs: R-camera, human

- [wip] **CAM-02** Calibrate identity, still and crop capability, warm-up, exposure, FPS, brief-state recovery, driver release and sustained load on hardware.
  - Prerequisite: Logi C310 HD WebCam (D-23) selected in project settings, explicit device-specific human calibration permission and conspicuous foreground warning until release.
  - D-22 defers calibration ordering, not acceptance. Existing FFmpeg 9.0.2 dshow metadata and failed device discovery are recorded in (log); no frames were acquired. Define measured numerical limits, identity after unplug and reconnect and after a Pi restart (D-25), driver release, shortest detectable state, lag, drops and crop geometry; do not infer compatibility from backend types or an OS or app lock.
  - Targeted checks: C-BACKEND, C-DISCOVERY and bounded direct-UI camera trials; document measured limits and unsupported timing.
  - note: Logi C310 discovered by metadata only; needs project selection and direct calibration authorization.
  - note: User chose calibration now via ask_user. FFmpeg 9.0.2 and exact Logi C310 video identity confirmed by metadata-only enumeration; no frames acquired. Scheduling approval is not acquisition consent. Next user /reload and explicit native project camera selection/enablement; every actual trial still needs native consent and visible warning. Budget 20–30 minutes plus any longer sustained-load qualification.
  - note: Live Logi C310 trials (user-consented, local TUI): fullSize still 1280x720 PNG 578 KiB; native mode is 1280x720 (not 16 Mpx). Crop 560x340 from native source 77 KiB: 25/15 mil labels legible, 10 mil labels marginal/blurred at ~1 m — model-directed crop helps but C310 optics cap small-text reading; barcodes not decoded by model. Scaled 3-shot burst 320x180 ~66-70 KiB each, requested 2s interval yielded ~4.3s actual spacing (≈2.3s reopen+1s warm-up overhead per shot). Settled watch: ready returned before operation, 10 fps sampled, 0 delayed samples, activity then 3.1s quiet produced one final 320x180 frame and native wake; ~8.3s total from readiness. Successive opens succeeded, implying release between shots. Pending: unplug/reconnect identity, Pi restart identity, shortest detectable state, sustained load.
  - check: camera_capture fullSize; crop {280,180,560,340}; count 3 interval 2000 320x180; camera_watch settled quietMs 3000 deadline 60000: all succeeded on @device_pnp_...vid_046d&pid_081b...\global.
  - note: Same-port unplug/reconnect: DirectShow alternative name unchanged (7&16e5c5aa&0&0000); capture on the saved identity succeeded after reconnect. Windows re-enumeration window observed: immediately after reconnect, dshow and PnP listed no C310 for several seconds. The absent-device refusal was not exercised live (device returned before the capture). Different-port identity, Pi restart identity, shortest detectable state and sustained load still pending.
  - check: ffmpeg -list_devices dshow before/after replug; PnP VID_046D query (only C548 receiver during window); camera_capture 320x180 succeeded on unchanged identity.
  - note: Different-port reconnect: C310 composite exposes a fixed USB serial (USB\VID_046D&PID_081B\LOGI_C310_HD_WEBCAM), so the interface ID and DirectShow alternative name stay unchanged (7&16e5c5aa&0&0000) across ports. Saved selection continued working on the new port. Risk: two identical C310 units share that serial string; Windows may then derive port-based IDs, so duplicate-unit identity is unverified. Re-enumeration took >20s after the port change. Live absent-device refusal verified: while unenumerated, camera_capture returned "No accessible DirectShow video camera found ... no fallback camera was selected."
  - check: ffmpeg dshow list empty twice (incl. after 15s); camera_capture refused with no fallback; PnP showed same instance IDs; dshow list then same alternative name; camera_capture 320x180 succeeded.
  - note: Live defect found: two untouched-scene adaptive watches both raised a false "initial" change at sample 67/69 (~7 s after first-frame baseline), then quiet ended the 10-min sustained run after ~12 s. Cause hypothesis: C310 auto-exposure still drifting after the 1 s warm-up. Fix 9bf6897: readiness now waits for 2 s stable picture (channel-mean step ≥1 level or half-threshold tile change restarts window), capped at 10 s with baselineSettled:false; ready reports warmupMs; wakes now surface lastChange {maxChange, changedTiles, possibleExposureShift}. Synthetic tests pass; live retest after /reload pending. Sustained-load still unmeasured.
  - check: node scripts/test-work-camera.mjs: ok; git diff --check clean. Live: watches a8f390c8 and c9963781 false initial at seq 67/69.
- [blocked] **CAM-14** Qualify live red camera warning, settings and consent UI and research and footer coexistence under the active theme.
  - Prerequisite: eligible local TUI with selected camera and direct human authorization for actual-use and release trials.
  - Verify CAPTURING and WATCHING is conspicuously red during warm-up and use and until confirmed release, including failed release; ARMED is distinct. Check purpose, device, request and expiry summaries, options, revocation, research and widgets and unsupported-mode denial. Loss of owning UI stops acquisition while cleanup and release remain available.
  - Targeted checks: live shared-UI trials plus C-FOOTER and C-DIALOGS; retain screenshots, observations and limitations in (log).
- [blocked] **CAM-10** Run real-camera, provider and printer acceptance for stills, crops, grants, adaptive transactions, settled capture and release and retention.
  - needs: R-printer
  - Prerequisite: calibrated selected camera and representative printer setup, live eligible TUI and explicit direct human trial authorization.
  - Demonstrate no repeated phone uploads: actual image return to active vision provider, monitoring resolution versus readable text crop, single or burst declared count, one time grant with a reload, revocation (D-24), one-watch scope, busy, reconnect, expiry and release and no automatic restart.
  - Arm and confirm readiness before operation; capture chronological short LED and screen states, continuing change and quiet stop with measured minimum state duration. Demonstrate detection versus retention versus wake cadence, thinning, budgets and partial outcomes, early and final batches and no per-sample calls. Disclose missed or dropped states and sustained-load limits, never claim guaranteed recovery.
  - Printout: readiness, visible activity then one stable-result image; separately test pause or fault and say visually stable, not job completed. If available, existing caller-side printer completion plus a still gives stronger evidence without new integration.
  - Verify OFF opens nothing; A never captures B; disable or expiry releases before warning clears; no video or audio, unbounded files or TTL exception. Do not claim mocks prove physical behavior or complete the plan without deferred qualification evidence or explicit limitation acceptance.
  - Targeted checks: real device, provider and printer trials, CAM-02 limits and CAM-14 observations; full software suite before completion.

## Checks

Canonical software environment: Windows PowerShell, working directory `C:\SOFT\git\ce-workflow`; existing Node and npm. Targeted commands run once in the default mode; C-FULL runs with `$env:CE_WORKFLOW_ENABLED = '0'` and then `'1'` (D-26). Commands below are relative to that exact directory; no hardware access is part of the software suite.

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

Run C-FULL in both workflow modes plus C-DIFF at phase boundaries and before completion. Add shared regression checks when their seams change. C-BACKEND and C-DISCOVERY use the same Windows working directory and existing installed FFmpeg; live camera commands require the selected identity, finite trial bounds and direct authorization specified by qualification steps, not invented universal capture commands.

Recorded current evidence: targeted camera/state/settings, dialogs/footer, compaction integration and diff checks pass. Both camera suites are in GENERAL_TESTS; full workflow-OFF verify passed, and final workflow-ON verify completed with three unrelated failures (OpenDesign README markers, private-workflow extension inventory, /wo command inventory). Camera-caused exposure/count expectations were repaired and pass. CAM-09 remains blocked by that required global gate under D-29. Native and configured non-vision custom-message projection are synthetic evidence only. Active LSP has missing host SDK declarations, inferred-any/style hints, push-only inconclusive results and oversized work-models/goal-test coverage. Hardware, live red UI, provider/printer routing and release qualification remain pending. No hardware was opened.

## References

All product paths are under `C:\SOFT\git\ce-workflow`; inspect relevant current sections only when their owning steps require them. Resume from the checkpoint, not by rereading all references.

| Reference | Steps and use |
| --- | --- |
| `extensions\work-camera.ts`; `extensions\work-camera-state.ts`; `scripts\test-work-camera.mjs`; `scripts\test-work-camera-state.mjs` | CAM-04 through CAM-13: project controls, ownership and deterministic fixtures; four camera tools registered independently of the legacy switch. Capture/process/worker/images/detect/retain/watch/tools siblings implement bounded acquisition and evidence delivery. |
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

- Shared image-pipeline hardening deferred by D-27: 64 KiB images after two successful responses, all-image compaction, source eviction or TTL and bridge-cache eviction by unrelated images.
- Camera identity across a Windows reboot (D-25).
- Cross-platform or network-camera support, packaged/downloaded FFmpeg or Windows-native helpers require separate scope approval.
- Whole-agent sandboxing, general monitoring infrastructure and unrelated Plan3/OpenDesign work are outside this delivery.

## Amendments

- Prior reconciliation, review dispositions, submitted answers and execution checks live in (log); Q-01 through Q-12 are settled, not outstanding questions. D-07 is superseded by D-21; the historical no-camera-implementation planning restriction is not current execution scope. All other recorded decision IDs remain active with their recorded meaning.
- CAM-08 → CAM-08 + CAM-14: split software warning implementation from required blocked live UI and theme qualification. CAM-08 remains open; no qualification was waived or marked done. CAM-03's already recorded synthetic implementation completion is unchanged; its deferred live menu and consent verification is assigned to CAM-14.
- CAM-02 → CAM-02; CAM-10 → CAM-10: move existing hardware calibration and real acceptance to the final qualification phase under D-22. Physical prerequisites no longer keep authorized software implementation open; both qualification steps remain blocked.
- Reconcile pass: Q-13 to Q-18 answered as D-23 to D-28; CAM-02, CAM-09, CAM-10, Checks and Non-goals updated to match. CAM-02 marker [blocked] → [human] because the camera now exists and only user selection and authorization remain.
- Optimize pass: phase tags added (Phase 1 and Phase 6 [think], Phases 2 to 5 [code]); R-camera and R-printer requirements with needs lines added for Phase 6; Q-14 to Q-18 flag over-strict checks for /plan3 resolve. No step ID changed, split or merged.
- CAM-01 through CAM-13 retain stable IDs; no steps merged. CAM-04 remains WIP and existing completion evidence is unchanged. Status stays active. Prior history is in (log).
