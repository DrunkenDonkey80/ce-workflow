# P3-14: real-hub Chromium interaction and transport check

Windows, 2026-11-11. **Loopback and physical Pixel 10a interaction checks passed; production paired remote lifecycle and Safari verification remain open.** This is not the paid generation benchmark or a complete device/accessibility certification.

## Reproduction and result

```sh
STUDY_DEPS="C:/Users/Flex/AppData/Local/Temp/pi-research-62ygWq/trial/node_modules" node --no-warnings "C:/SOFT/git/ce-workflow/hub/scripts/test-browser.mjs" --design-remote
```

The unchanged command completed with exit 0 in **358.0 seconds**. Its existing C4 assertions run first, followed by the optional probe against that fixture's owned browser and real hub. Fake Pi supplies session plumbing, not generated model output. The probe builds and serves an actual pinned Astryx/React app, using the approved host cache read-only. It verified that cache three times, refused installer approval, and downloaded **0 runtime bytes**.

Raw evidence: [remote-browser-results.json](remote-browser-results.json). Browser: Chromium **148.0.7778.97**, controlled through retained Playwright **1.65.0**. No packages or browsers were installed for this check.

| Measurement | Initial | Refinement |
| --- | ---: | ---: |
| Host build, including cache verification | 52.943 s | 50.063 s |
| Observed browser-visible phase | 26.559 s | 69.137 s |
| Completed prototype requests | 4 | 4 |
| Decoded prototype response bytes | 1,471,390 | 1,471,398 |
| Prototype upload bytes | 0 | 0 |
| Large bundle response elapsed | 17.995 s | 17.998 s |

Initial browser timing begins after its build; refinement timing includes its build. Do not add or compare these as identical timing boundaries. Byte totals are prototype responses only, not the full hub shell or wire bytes. Private `no-store` responses transfer again on refinement; local build caching does not mean browser runtime reuse.

## What passed

- Existing C4 HTML/session/device/screen/version/restore/clone/select regressions remain intact. These use fake Pi and include fixture-backed component lifecycle checks; they are not a physical remote-client or complete real-library lifecycle certification.
- The added real-library case exercises native required-field validation and keyboard focus containment in an open modal, stable-ID comments inside that modal, inline CSS editing, and Mark replay of the unsaved React draft/modal plus live CSS. Pixel assertions verify the restored state in the annotation image.
- An intentional syntax error preserves the previous live iframe and unsaved draft. Correcting back to identical source skips rebuilding. Successful refinement shows building status without replacing that last-good frame, then publishes and displays the new generation.
- Instrumented page/frame requests stay on the owned hub origin during ordinary pinned-runtime operation. Deliberate external image, stylesheet, font and fetch requests from the opaque child frame are all intercepted and aborted. HTTP and WebSocket deny handlers cover the instrumented context; no external WebSocket was deliberately attempted in this run.
- Real prototype responses retain their sandbox/form-navigation CSP and `private, no-store` policy through instrumentation. There are no instrumentation errors.

The companion [app-results.md](app-results.md) records real-cache source/snapshot/restore/clone/select tests and an isolated editable-export rebuild/render round-trip. That separate evidence is not mislabelled as additional browser interactions in this run.

## Timing and isolation limits

Responses are fetched from loopback, buffered, then fulfilled after **150 ms + upload bytes / 32 KiB/s + decoded body bytes / 64 KiB/s**. This covers opaque child frames and preserves policy headers, but models neither streaming nor a shared congested physical link. SSE, WebSockets and ranges remain unthrottled. Routing disables HTTP cache; byte accounting excludes compression and HTTP/TLS overhead. The separate host-side Mark renderer is outside this UI request trace.

Application service workers are blocked. Chromium also exposes `chrome-extension://nkeimhogjdpnpccoofpliimaahmaaome/thunk.js` on an owned blank page. A minimal blocked/allowed control proved that a web `/sw.js` worker appears only in allow mode. Only that exact browser-owned extension worker is exempted; any other worker fails the assertion. Its traffic and other browser-internal activity are outside the trace: this is not a machine-wide offline/network audit.

The failed attempts are not hidden: copied-cache builds hit the existing worker deadline; paused-route CDP calls stalled; an actionable fake update triggered fixture maintenance; the fresh context initially lacked authentication; and counting the browser-owned worker as an app worker caused a final false failure. The fixes changed test setup/instrumentation, not runtime pins, product deadlines or the interaction assertions. The updater regression now also asserts that UI-only metadata cannot trigger installation or maintenance; the screenshot fixture advertises no pending update sources.

## Physical Android follow-up

The same C4 prefix plus C11 probe passed on an operator-approved **Pixel 10a, Android 17, Chrome 157.0.8103.46**, screen 412×924 CSS pixels, using actual touch activation. Existing Playwright 1.65.0 attached through wireless ADB CDP to an owned incognito context. Only the test fixture used an ADB reverse tunnel; this does **not** verify production Tailscale HTTPS, pairing or first-use remote provisioning. Existing user tabs were not reused. Owned contexts and temporary fixture mappings were closed after the check.

Use the reproduction command above with `C11_DEVICE_CDP_URL` set to an existing local ADB Chrome forward and `C11_DEVICE_SERIAL` set to the explicitly approved connected device. The probe creates/removes only its fixture port's reverse mapping and refuses to replace an existing mapping. No device/browser/package installation or runtime download was needed.

Raw evidence: [android-browser-results.json](android-browser-results.json). Post-fix initial/refinement builds were **40.780 / 45.879 s**; visible phases **27.077 / 65.588 s**, with the same differing timing boundaries as above. Prototype totals were **1,471,390 / 1,471,398 decoded bytes** across four requests each. Large bundle fulfilments took **18.182 / 18.318 s** under the same response-delay model. These are verification timings, not a performance improvement or a physical-link bandwidth measurement.

The real-library form/focus, modal pin, CSS edit, React draft/CSS Mark replay, last-good preservation, refinement and nested external-request gates all passed again. The Android toolbar now additionally asserts complete, single-line labels, viewport containment and at least **44×44 CSS-pixel** targets. Screenshots were inspected: [toolbar and preview](screenshots/android-studio.png), [comment controls](screenshots/android-comment-control.png), [comment dialog](screenshots/android-comment-dialog.png), [Mark replay](screenshots/android-mark-replay.png).

The first phone screenshots exposed a genuine product bug despite passing interaction assertions: flex controls shrank and inherited title word-breaking, stacking `Comment` into seven lines and pushing other controls out of the viewer. A new C4 check failed against that CSS before the fix. The scoped toolbar fix wraps whole controls and keeps touch-sized targets; unchanged assertions then passed at 320×800, 390×844, 844×390 and 390×844 with 2× UI zoom, followed by the physical Android check. This is UI zoom, **not** a browser text-only accessibility setting or physical device rotation test. The original screenshot remains [here](screenshots/android-comment-control-before.png).

One intervening rerun stopped before the toolbar test on an existing live-tool timer assertion: elapsed time advanced from 1:05 to 1:06 during earlier browser calls. That assertion now freezes only its owned page's `Date.now` and restores it immediately afterward; the exact 1:05 formatting assertion is unchanged. The original C4 plus physical C11 command then passed.

## Transport-cost investigation and decision

The roughly 1.47 MB repeated transfer is material on this slow response model. Read-only inspection of `hub/src/explore.ts` confirms a fresh random capability in `viewPage`, capability removal in `unview`, confinement/permission checks in `sendExplored`, and `private, no-store` responses. `extensions/design-build.ts` publishes complete immutable generations. A content hash on disk alone does not provide reusable, revocable browser caching across these capability URLs.

A possible follow-up is stable vendor chunks with private capability-scoped URLs and mandatory authorization/revalidation. It would require explicit revocation, owner/session isolation, restored-version and publication-invalidation tests, plus the same end-to-end generation benchmark. Those mechanisms are not implemented or asserted safe here. **No transport optimization was adopted:** retain the current security boundary and label the optional foundation experimental, not faster or bandwidth-efficient. No focused timing result substitutes for P3-15.

## Still unverified / release gates

- A controllable physically remote client exercising first-use consent, download progress/failure and warm reuse, plus the complete session lifecycle from that client. The earlier approved Windows cold-host provisioning test is separate evidence, not this remote flow.
- Real Safari, physical orientation/date-control coverage, mixed-input hardware and assistive technology. The verified Android interaction subset and Chromium layout checks do not substitute for these.
- P3-15 is now complete: [product-results.md](product-results.md) records all three product-wired arms and their continuation accounting. Its independent acceptance result is 298/300, not fully green. No further paid runs are authorized.
- This run does not certify every component, arbitrary app draft, enlarged-text state, network topology or production accessibility requirement.

These gaps keep P3-14/P3-16 open. The integration is optional and must not be released as universally validated or as a measured optimization.
