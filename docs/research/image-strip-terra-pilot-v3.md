# Terra rolling-image removal pilot

Date: 2026-09-15
Model: `openai-codex/gpt-5.6-terra`, thinking off

Anthropic Sonnet 5 and Opus 5 both advertised image input but their live probes were blocked by the workspace extra-usage limit. Terra then passed a pixel-level probe by reading `COBALT-731` and three triangles from a generated PNG.

## Design

Two image sizes were crossed with rolling removal on/off. Each arm ran three times in rotated order. Reasoning, giant-result, stale-read, and duplicate stripping were disabled. Provider-request instrumentation counted image payloads without retaining them.

- Small: 480×320, 22,591-byte PNG.
- Large: 2000×1333, 73,395-byte PNG.
- Reuse-required scenario: after the normal grace period, ask a previously unreported visual question; the rolling arm must re-read. Re-read once in both arms immediately before compaction, then ask another unseen visual question after compaction.
- Spent-image scenario: finish using the image, then execute three text-only requests.

All 24 runs returned every expected visual/text answer. No assistant or tool failures occurred.

## Results

Values are medians of three runs.

### Image is needed again

| Size | Rolling | Runtime s | Reads | Uncached input | Cache-read | Total tokens | Cost USD |
|---|---|---:|---:|---:|---:|---:|---:|
| small | off | 18.781 | 3 | 9,015 | 32,768 | 41,977 | 0.026912 |
| small | on | 25.080 | 4 | 11,500 | 35,328 | 47,113 | 0.033418 |
| large | off | 20.557 | 3 | 23,795 | 38,912 | 62,988 | 0.057940 |
| large | on | 20.376 | 4 | 26,316 | 38,400 | 64,993 | 0.063396 |

Rolling on versus off:

- Small: runtime +33.54%, tokens +12.24%, cost +24.18%.
- Large: runtime -0.88%, tokens +3.18%, cost +9.42%.

The extra re-read makes rolling removal a loss when later visual work needs the pixels. The penalty narrows for the large image because dropping repeated large payloads offsets part of that re-read.

### Image is finished

| Size | Rolling | Runtime s | Reads | Uncached input | Cache-read | Total tokens | Cost USD |
|---|---|---:|---:|---:|---:|---:|---:|
| small | off | 11.645 | 1 | 3,885 | 25,600 | 29,560 | 0.013790 |
| small | on | 10.402 | 1 | 6,428 | 22,528 | 29,024 | 0.018178 |
| large | off | 13.044 | 1 | 10,676 | 33,792 | 44,545 | 0.029034 |
| large | on | 11.403 | 1 | 10,398 | 24,576 | 35,044 | 0.026611 |

Rolling on versus off:

- Small: runtime -10.67%, tokens -1.81%, **cost +31.82%**.
- Large: runtime -12.58%, tokens -21.33%, **cost -8.35%**.

This validates the size-dependent hypothesis for an image that is genuinely finished: rolling removal was worthwhile for the large image, but small-image cache invalidation cost more than the payload saved.

### Extract once, retain a complete text record

The model first wrote `VISUAL_RECORD CODE=COBALT-731; TRIANGLES=3; BADGE=ORBIT; CIRCLE=AMBER`, then answered three later visual questions using only that text. All 12 runs passed with exactly one image read.

| Size | Rolling | Runtime s | Reads | Uncached input | Cache-read | Total tokens | Cost USD |
|---|---|---:|---:|---:|---:|---:|---:|
| small | off | 13.727 | 1 | 5,648 | 24,576 | 30,307 | 0.017207 |
| small | on | 11.638 | 1 | 6,237 | 23,552 | 29,866 | 0.018432 |
| large | off | 13.101 | 1 | 14,565 | 30,720 | 45,387 | 0.036498 |
| large | on | 12.460 | 1 | 10,185 | 25,600 | 35,886 | 0.026702 |

Rolling on versus off:

- Small: runtime -15.22%, tokens -1.46%, **cost +7.12%**.
- Large: runtime -4.89%, **tokens -20.93%, cost -26.84%**.

This is the cleanest positive result: comprehensive retained text eliminated every re-read, and removing large pixels produced a substantial token and cost win. Small-image cache invalidation still outweighed its tiny token saving.

## Compaction boundary

The implementation was changed so a completed compaction strips every image that existed at that boundary, independent of the rolling setting and grace age. It covers both user-attached and tool-result images without mutating stored session messages.

All 12 reuse-required runs compacted successfully with a fresh image in the retained tail. In every run, wire counts for the post-compaction question were `[0, 1]`: the first request contained no image, then the model re-read the recoverable source and the next request contained one. Rolling-off runs had accumulated two image payloads immediately before compaction; both disappeared.

## Implemented strategy

1. At the 150k ultracompact boundary, remove every prior image from outgoing context regardless of age or rolling configuration.
2. Keep images below 64 KiB cache-stable until that boundary.
3. For images at least 64 KiB, attach a deterministic instruction asking the model to retain a concise task-relevant visual record, preserve that assistant text, and roll out only the pixels after the existing grace window.
4. `STRIP_IMAGES=0` disables rolling removal; `STRIP_IMAGES=all` remains available for the all-size benchmark policy.

The 64 KiB gate deliberately uses actual compressed payload bytes: it is the smallest implementation matching this experiment. Pixel-dimension parsing remains unnecessary until real mixed-format sessions show misclassification.

## Evidence

- Reuse-required results: `C:\SOFT\git\ce-workflow\.pi\image-strip-terra-pilot-v3\results.json`
- Spent-image results: `C:\SOFT\git\ce-workflow\.pi\image-strip-terra-pilot-v3-spent\results.json`
- Extract-once results: `C:\SOFT\git\ce-workflow\.pi\image-strip-terra-pilot-v3-extract\results.json`
- Every run directory contains its generated PNG, session, RPC stream, debug trace, and wire metadata.
