---
plan3: true
status: active
created: 2026-11-08
updated: 2026-11-08T16:02:53.735Z
reviewed: 2026-11-08
---

# video_digest v2: faster capture, no OCR, parallel Luna, per-sentence transcript

## Original request

User, 2026-11-08, after plan 544351ec (video_digest v1) was completed and archived:

> lets talk improvement:
> - fast run the video and capture ahead just the frames
> - skip identical frames
> - parallel start processing of the frames
> - parallel luna
> - test without ocr at all just skipping identical frames and run luna parallel on all leftovers, luna is very cheap
>
> also timing I think you have to use the time for each sentence, not cut in half a minute. this way you can match whats on screen with whats in the picture, be that text or block or code or something. you can then 'insert' it at the appropriate time in the video
> also keeping the distinct frames where the different text elements show so we can later view them in original

Follow-up answers: "1 per sentence because then we can have several images/texts tied to exactly what he is talking about"; JPEG frames committed with the digests: "yea"; "run measurements then make a plan3" (measurements are done, see Findings).

Also from VD-09 of plan 544351ec: the user found CPU usage high (Tesseract uses every core).

## Goal, requirements, and non-goals

Goal: the same digest quality in a fraction of the time and CPU, with the transcript and the visuals woven together by time.

Requirements:
- Capture: one ffmpeg pass over a 720p download produces the frames and the tiny thumbnails used for filtering.
- Filter: no Tesseract; frames are kept by a pixel check (screen content, not camera) plus deduplication that ignores moving regions (webcam, face).
- Luna: batches run in parallel; one final text-only call merges what separate batches found.
- Transcript: one line per sentence, each with its own [m:ss] timestamp.
- Visuals: each one is inserted right after the sentence being spoken when it first appears; several visuals can follow one sentence.
- Frames: the frames each visual was rebuilt from are saved as JPEG in the digest folder and linked under the visual, plus a YouTube link that jumps to that second.
- Unchanged: D-01 to D-13 of plan 544351ec still hold where not amended here (output folder, captions-missing behavior, Takeaways kept on rerun, trust-boundary validation of Luna replies, before/after for live edits, tool only in the ce-workflow checkout).

Non-goals:
- Streaming frames into Luna while ffmpeg still runs (ffmpeg takes about 8 s for a 16-minute video; nothing to gain).
- Keyframe-only decoding, smarter shot detection, or a learned classifier.
- Batch mode over playlists (still Backlog in plan 544351ec).

## Findings (measured 2026-11-08 on lraHlXpuhKs, 15:55, 955 frames)

Scripts and data in `%TEMP%\vdm` (throwaway): `dedupe2.cjs`, `flat.cjs`, `combo.cjs`, `luna.mjs`.

- Phase times of v1 (1080p path): yt-dlp download 5.0 s (61 MB); ffmpeg 1 fps to 1280 PNG 12.1 s; Tesseract over 955 frames 173.9 s on all cores; Luna 20 sequential calls about 350 s (inferred: the 552 s tool total minus the other phases).
- 720p: download 3.5 s (32 MB); one ffmpeg pass with `split` producing 720p frames plus 320x180 grayscale raw thumbnails 8.0 s. v1 scales to 1280x720 anyway, so 720p loses nothing.
- Frame size at 720p: PNG about 230 KB, JPEG `-q:v 3` about 57 KB.
- Plain pixel dedupe fails: the webcam corner and the talking head change every frame (929 of 955 kept). A mask of pixels that move often over the whole video masks nothing, because full-screen talking-head parts dilute it.
- Screen check works cleanly: share of flat 8x8 blocks (range of 4 grey levels or less) in the thumbnail is under 10% for all 155 camera frames and 30% or more for every screen frame; nothing in between. Threshold 20%.
- Windowed motion mask plus dedupe on screen frames (motion counted over plus or minus 5 s, a pixel masked when it moved in 2 or more of those pairs, mask grown by 2 px, a frame kept when 32 or more unmasked pixels differ by more than 20 grey levels from the last kept frame): 212 frames kept, 0.6 s of JS. Stricter settings keep 254 to 572.
- What still survives is real change: scrolling, hover popups, typing, the webcam window appearing (checked visually on six kept pairs). v1 OCR picked 194 candidates, so the Luna load is about the same without the 174 s of Tesseract.
- The `traceId` edit is kept both ways: before at 57 to 62 s, after at 104 to 115 s.
- Luna in parallel (10 JPEG frames per call, simplified prompt): 1 call 7.4 s; 4 at once 21.9 s wall; 8 at once 15.3 s; 9 at once 17.7 s; no rate-limit or other errors; 22 test calls cost $0.029.
- Captions: json3 auto captions carry word offsets (`tOffsetMs`) in 471 of 941 events; this video's `en-orig` text has 205 sentence ends in 18,000 characters, so sentences can be timed to the word.
- Estimate, unmeasured: v2 tool time on this video about 1.5 to 2 minutes (download 4 s, ffmpeg 8 s, filter 1 s, 22 Luna calls at 8 at once about 60 s, merge call about 20 s, captions about 10 s).

## Decisions

- **D-01 Per-sentence timestamps.** Every transcript sentence is its own line with a [m:ss] timestamp; visuals go right after the sentence being spoken when they first appear, so several visuals can tie to one sentence. Source: user 2026-11-08 ("1 per sentence ...").
- **D-02 Frames kept as JPEG in the repo.** Source frames are saved as JPEG next to `digest.md` and committed with it. Source: user 2026-11-08 ("yea").
- **D-03 Measure first, then plan.** Done; numbers in Findings. Source: user 2026-11-08.
- **D-04 720p and one ffmpeg pass (agent proposal, from measurement).** Download `bv*[height<=720]/b`; one ffmpeg run writes `-q:v 3` JPEG frames at 1 fps (or the D-08 interval of plan 544351ec) and the 320x180 gray thumbnails through `split`. Rationale: same pixels Luna sees today, half the data, no 1280 PNG step.
- **D-05 Pixel filter replaces the OCR candidate step (agent proposal, from measurement; Tesseract removal settled in D-08).** Screen check plus windowed motion mask plus dedupe with the Findings thresholds (flat share 20%, window 5 s, 2 hits, grow 2 px, 32 px, 20 grey levels). It amends D-11 and D-13 of plan 544351ec: every distinct screen state is kept, so the first (before) state of a live edit survives without special handling.
- **D-06 Parallel Luna at 8 calls at once (agent proposal).** Measured up to 9 without errors. Each batch gets its frames and the nearby transcript, not the artifacts of other batches.
- **D-07 One final text-only merge call (agent proposal).** Parallel batches cannot see each other, so a last Luna call gets every batch's artifacts (text and frame labels, no images) and returns the merged list: duplicates joined, scrolled parts combined, Before and After paired. The reply passes the same validation as `mergeArtifacts` today (trust boundary). If the merge call fails, the unmerged artifacts are written in time order with a one-line note in the digest, so no work is lost.
- **D-08 Drop Tesseract entirely (was Q-01).** Remove `ocrTokens`, `similarity`, `selectCandidates`, the `tesseract` dependency entry, its install hint and their tests; the pixel filter of D-05 is the only frame filter. Rationale: 212 frames versus 194 OCR candidates in 0.6 s instead of 174 s on all cores, one fewer install. Risk: measured on one Matt Pocock video only; V2-08 checks another channel's video. Source: user via ask_user /plan3 resolve 2026-11-08.
- **D-09 Up to 12 frames per visual (was Q-02).** Each visual keeps the distinct frames it cites as JPEG, at most 12: first and last always, the rest evenly spread. Expected about 1 to 5 MB per 16-minute video at about 57 KB per frame (estimate). Source: user via ask_user /plan3 resolve 2026-11-08.


## Open questions

### Blocking

None.

### Deferred

None recorded.

## Relevant files and approach

- `C:\SOFT\git\ce-workflow\extensions\video-digest.ts`: `digestVideo` (download, ffmpeg, Tesseract, sequential Luna loop at about lines 286 to 333), `captionLines` and `captionParagraphs` (30 s paragraphs, to be replaced), `ocrTokens`, `similarity`, `selectCandidates` (removed per D-08), `mergeArtifacts` (validation reused by the merge call), `renderDigest` (separate Visuals section, to be interleaved), `batchPrompt`, `lunaModel`, the dependency list (`tesseract` entry).
- `C:\SOFT\git\ce-workflow\scripts\test-work-video-digest.mjs`: unit and pipeline tests with an injected runner and model.
- `C:\SOFT\git\ce-workflow\README.md` and `C:\SOFT\git\ce-workflow\CHANGELOG.md`: tool docs and the Tesseract requirement.
- `C:\SOFT\git\ce-workflow\extensions\work-models.ts` line about 3764: registers the tool only in the maintenance checkout; untouched, but it is why C2 must run in `C:\SOFT\git\ce-workflow` itself, not a worktree.
- Approach: new pure helpers `screenFrames(thumbs, width, height, interval)` (D-05) and `sentences(json3)` (D-01), each unit-tested with small synthetic inputs; a small `mapLimit`-style loop for D-06; `renderDigest` walks sentences and inserts artifacts by start time.

Commands (referenced by steps):
- C1: `node scripts/test-work-video-digest.mjs`
- C2 (Git Bash, in `C:/SOFT/git/ce-workflow`, one video at a time, never two in parallel): `timeout 3600 pi -p --mode json "digest <url>" > "$TEMP/<name>.jsonl"`, then `node "$TEMP/vdstats.cjs" "$TEMP/<name>.jsonl"`.
  - `vdstats.cjs` (scratch, updated in V2-00) takes one or more JSONL files (all continuations of one run) and prints: session wall time (first to last message timestamp), turns, tool calls, assistant input, output, cache-read and cache-write tokens and cost, the `video_digest` tool time, and Luna usage from the tool result details; total tokens and cost are session plus Luna.
  - Compaction mode: the AGENTS.md rule asks for ultrafull. No mode is configured here, so the default is ultracompact (`contextSettings` in `extensions/work-models.ts`); runs of this size (under 10 turns, under 200K context) do not compact, so the mode does not apply. Each run's JSONL is checked for compaction events; if one appears, rerun with `workOrchestrator.context.mode` set to `ultrafull`.
- C3: lens diagnostics (LSP) on `extensions/video-digest.ts`.

## Phases

### Phase 0: Baseline [code]

- [x] **V2-00** v1 baseline recorded sequentially at 8f948a2: short wall 73 s, tool 52.7 s, 4 turns, 3 tools, 141,758 tokens, $0.3703 (Luna 1 call $0.0010, 6 candidates, 1 artifact); 16-min wall 513 s, tool 498.5 s, 4 turns, 3 tools, 414,163 tokens, $0.1290 (Luna 20 calls 262,478 in / 10,588 out $0.0315, 194 candidates, 8 artifacts); 0 compactions; session cost swings with prompt cache (short wrote 67.5K cache, long only 9.9K).

### Phase 1: Capture and filter [code]

- [x] **V2-01** 720p download (bv*[height<=720]/b) and one ffmpeg pass writing q3 JPEG frames plus 320x180 gray raw thumbnails; Luna gets image/jpeg.
- [x] **V2-02** screenFrames() (flat-block screen check, motion window in seconds with at least 1 frame, masked dedupe) replaces Tesseract; OCR helpers, the tesseract program entry and their tests removed.

### Phase 2: Parallel Luna and merge [code]

- [ ] **V2-03** Run batches of 10 frames with at most 8 Luna calls at once (D-06); progress shows done of total.
  - Each batch starts from an empty artifact list; its artifact ids get a batch prefix (`b3-a1`) so ids never collide across batches.
  - Every artifact, text or image, carries a validated `frames` list of its batch's labels; unknown or path-like labels are dropped (trust boundary, as `mergeArtifacts` does for `frame` today). The prompt asks for the cited frames of every artifact, not only images.
  - A failed or cancelled call stops new scheduling; the pipeline waits for every running call to settle before the `finally` cleanup removes the frames. User cancellation throws "Video digest cancelled." and writes nothing; a failed batch fails the run with its error, as today.
  - Check: C1 with an injected model recording the peak calls in flight (at most 8), colliding local ids from two batches, text artifacts with frame lists, cancellation during batches, one failing call while others run (no later call starts, cleanup after all settle), and usage totals.
- [ ] **V2-04** Add the final text-only merge call with validation and the fail-soft fallback (D-07).
  - Input: all batch artifacts with their prefixed ids, times and markdown, no images. Reply: the complete final list, each item naming the batch ids it replaces (`from`). The final list replaces the batch list; a batch artifact named by no `from` stays as is, so nothing is lost silently. Frame lists of merged items are the union of their sources, then deduplicated and sorted by time.
  - An unusable reply (invalid JSON, unknown `from` ids, invalid items) keeps the batch artifacts for every item that failed validation; a reply that fails as a whole, or a failed call, writes the batch artifacts in time order plus a one-line note. User cancellation during the merge throws, as in V2-03, instead of writing the fallback.
  - Check: C1 cases for duplicates merged, a scrolled artifact combined across batches, an unrelated artifact surviving, frame-list union, a malformed reply, a failed merge call (fallback plus note) and cancellation during the merge (no digest written).

### Phase 3: Transcript and rendering [code]

- [ ] **V2-05** Build timed sentences from json3 word offsets (D-01).
  - Split at `.`, `?` and `!`; for captions without punctuation, also split at a pause of 1.5 s or more or after 40 words (agent proposal).
  - Word time: event `tStartMs` plus the segment's `tOffsetMs`; a segment without an offset takes the previous word's time, or the event start for the first segment. A sentence's time is its first word's time; several sentences in one event each get their own time.
  - Check: C1 with a json3 fixture mixing events with and without offsets, two sentences in one event, a caption gap, and an unpunctuated track.
- [ ] **V2-06** Interleave visuals after the sentence spoken at their start; save cited frames as JPEG and link them plus a YouTube `t=` link (D-02, D-09).
  - At most 12 frames per visual from its `frames` list (V2-03, V2-04): first and last always, the rest evenly spread; each saved as `frames/<m-ss>.jpg`, shared when two visuals cite the same frame.
  - Placement: a visual goes after the last sentence starting at or before its start; one starting before the first sentence goes before it; one after the last sentence goes at the end; a visual inside a caption gap goes after the sentence before the gap.
  - Captions missing: visuals only, in time order, with the existing note. Takeaways still kept on rerun.
  - Check: C1 render snapshot with leading, trailing and gap visuals, two visuals after one sentence, the 12-frame cap and links that point at written JPEG files.
- [ ] **V2-07** Update README and CHANGELOG (Unreleased): no Tesseract (D-08), faster runs, per-sentence transcript, kept frames.

### Phase 4: Calibrate [think]

- [ ] **V2-08** Rerun both v1 videos and one video from another channel with C2; compare against the V2-00 baseline.
  - Accept for both v1 videos: no visual of the v1 digest missing (`traceId` before and after included), Mermaid labels quoted, every frame link resolves; tool time at most half of V2-00 on the 16-minute video and not above V2-00 on the short; total tokens and cost (session plus Luna) not more than 1.5 times V2-00; turns and tool calls not above V2-00 plus one. Otherwise tune thresholds or revert per the repo's optimization regression rule.
  - Accept for the other channel's video: the digest has its on-screen code or diagrams (checked against a few sampled frames) and the screen check did not drop them.
  - Ask with numbers then if the other channel's video shows the screen check or the thresholds do not generalize.
- [ ] **V2-09** [human] User reviews a new digest with per-sentence timestamps and kept frames.

## Global validation

- C1 passes; C3 shows no new diagnostics in `extensions/video-digest.ts`.
- V2-08 numbers recorded against V2-00 with the C2 procedure: session wall time, tool time, total provider tokens (session plus Luna, including cache-write), cost, turns and tool calls (optimization regression rule in AGENTS.md).
- No `video-digest-*` folders left in `%TEMP%` after the runs.

## Resume context

Draft, reviewed; all six advisor findings dispositioned in Amendments; no open questions. Next: the user runs /plan3 finish, then V2-00 (v1 baseline before any code change). v1 plan 544351ec is archived in docs/plans/done; its decisions still apply unless amended here. Measurement scripts are throwaway in %TEMP%\vdm.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.

- 2026-11-08 review (plan3-advisor, gpt-6-astra high), each finding checked against `extensions/video-digest.ts`:
  - Finding 1, merge semantics: accepted. `mergeArtifacts` updates by id and keeps omitted items (lines about 151 to 182), and parallel batches would each start at `a1`. V2-03 now prefixes ids per batch; V2-04 defines the final list with `from` ids, survival of unnamed items and the fallback.
  - Finding 2, frame provenance: accepted. `Artifact` has one optional `file`, text artifacts drop `frame`, and the prompt asks for a frame only for images. V2-03 adds a validated `frames` list for every artifact; V2-04 unions it; V2-06 picks up to 12 from it.
  - Finding 3, motion window units: accepted. The measurement script used 5 frame indices at 1 fps while D-05 says 5 seconds; `sampleInterval` reaches 12 s for long videos. V2-02 converts seconds to frames with a minimum of 1 and adds a 12 s fixture; `screenFrames` gets the interval.
  - Finding 4, cancellation and cleanup with parallel calls: accepted. The `finally` removes frames while workers could still run. V2-03 and V2-04 now settle running calls before cleanup, stop scheduling on failure and never write the fallback after a user cancel.
  - Finding 5, benchmark evidence: accepted in part. C2 now uses Git Bash syntax, aggregates all continuations, cache-write tokens, Luna usage and wall time; new V2-00 records a sequential v1 baseline because the VD-08 runs were parallel and incomplete; V2-08 has numeric acceptance for both videos. Rejected: switching to ultrafull up front, since these runs stay far below any compaction threshold; the JSONL is checked for compaction instead.
  - Finding 6, sentence timing and placement: accepted. V2-05 defines word times for segments without offsets; V2-06 defines leading, trailing and gap placement, with tests.
