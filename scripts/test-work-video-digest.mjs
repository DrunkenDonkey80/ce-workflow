#!/usr/bin/env node
// video_digest (plan 544351ec): pure helpers, the pipeline with a fake runner and model, and the checkout-only registration.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
	isYouTubeUrl, pickCaptionTrack, sentences, screenFrames, sampleInterval,
	digestFolder, digestOwner, keepTakeaways, batchArtifacts, finalArtifacts, mapLimit, keptFrames, renderDigest, digestVideo, NO_CAPTIONS, TAKEAWAYS,
} from "../extensions/video-digest.ts";

// URLs
assert(isYouTubeUrl("https://www.youtube.com/shorts/k2zgcTDq4aQ?feature=share"));
assert(isYouTubeUrl("https://www.youtube.com/watch?v=k2zgcTDq4aQ&t=3"));
assert(isYouTubeUrl("https://youtu.be/k2zgcTDq4aQ"));
assert(!isYouTubeUrl("https://vimeo.com/123456"));
assert(!isYouTubeUrl("file:///C:/video.mp4"));
assert(!isYouTubeUrl("https://www.youtube.com/@mattpocockuk"));

// Caption track: manual English first, else the original-language auto track, never a translation.
assert.deepEqual(pickCaptionTrack({ subtitles: { de: [], "en-GB": [] }, automatic_captions: { "en-orig": [] } }), { lang: "en-GB", auto: false });
assert.deepEqual(pickCaptionTrack({ language: "en-US", automatic_captions: { "ar-orig": [], en: [], "en-orig": [] } }), { lang: "en-orig", auto: true });
assert.deepEqual(pickCaptionTrack({ language: "de", automatic_captions: { "de-orig": [], en: [] } }), { lang: "de-orig", auto: true });
assert.equal(pickCaptionTrack({ automatic_captions: { en: [] } }), undefined);

// D-01 json3 → timed sentences. Unpunctuated track: split at pauses of 1.5 s or more.
const json3 = { events: [{ tStartMs: 0, dDurationMs: 99400 }, { tStartMs: 0, segs: [{ utf8: "A" }, { utf8: " lot of people" }] }, { tStartMs: 1670, segs: [{ utf8: "\n" }] }, { tStartMs: 12000, segs: [{ utf8: "ask me" }] }, { tStartMs: 31000, segs: [{ utf8: "when to grill" }] }] };
assert.deepEqual(sentences(json3), [{ t: 0, text: "A lot of people" }, { t: 12, text: "ask me" }, { t: 31, text: "when to grill" }]);
// Word offsets where present, the previous word's time where not; two sentences in one event; a caption gap.
assert.deepEqual(sentences({ events: [
	{ tStartMs: 1000, segs: [{ utf8: "Hello" }, { utf8: " world.", tOffsetMs: 500 }, { utf8: " This", tOffsetMs: 900 }, { utf8: " is" }] },
	{ tStartMs: 3000, aAppend: 1, segs: [{ utf8: "\n" }] },
	{ tStartMs: 5000, segs: [{ utf8: "fine." }] },
	{ tStartMs: 20000, segs: [{ utf8: "Next one? Yes!" }] },
] }), [{ t: 1, text: "Hello world." }, { t: 1.9, text: "This is fine." }, { t: 20, text: "Next one?" }, { t: 20, text: "Yes!" }]);
// Unpunctuated and no pause: split after 40 words.
const long = sentences({ events: [{ tStartMs: 0, segs: Array.from({ length: 45 }, (_, i) => ({ utf8: ` w${i}`, tOffsetMs: i * 100 })) }] });
assert.deepEqual(long.map((s) => [s.t, s.text.split(" ").length]), [[0, 40], [4, 5]]);

// D-05 pixel filter on synthetic 64x32 gray thumbnails.
let seed = 7;
const noise = () => (seed = (seed * 1103515245 + 12345) % 2147483648) % 256;
const W = 64, H = 32;
const screen = ({ line = 0, corner = false, camera = false } = {}) => {
	const f = new Uint8Array(W * H).fill(40);
	for (let p = 0; p < f.length; p++) {
		const x = p % W, y = Math.floor(p / W);
		if (camera || (corner && x >= 48 && y < 16)) f[p] = noise(); // a camera shot, or a moving webcam corner
		else if (line && y === 20 && x < 40) f[p] = line; // one edited line of 40 pixels
	}
	return f;
};
const film = (frames) => Buffer.concat(frames.map((f) => Buffer.from(f)));
const s0 = screen({ corner: true });
assert.deepEqual(screenFrames(film([
	s0, s0, screen({ corner: true }), screen({ corner: true }), // 0 kept; an exact repeat and webcam-only changes dropped
	screen({ line: 200, corner: true }), screen({ line: 200, corner: true }), screen({ line: 200, corner: true }), // 4 the edit kept
	screen({ line: 200, corner: true }), screen({ line: 200, corner: true }), screen({ line: 200, corner: true }),
	screen({ camera: true }), // 10 camera shot dropped
]), W, H, 1), [0, 4]);
// Vertical videos skip the camera check: a camera shot after a screen is kept for Luna to judge.
const still = screen({ camera: true });
assert.deepEqual(screenFrames(film([screen(), still, still]), W, H, 1, false), [0, 1]);
assert.deepEqual(screenFrames(film([screen(), still, still]), W, H, 1), [0]);
// The motion window is in seconds: at 1 s a line edited twice within 4 s counts as motion; at 12 s apart both states are kept.
const twice = film([screen(), screen(), screen({ line: 200 }), screen({ line: 200 }), screen({ line: 200 }), screen({ line: 200 }), screen({ line: 120 }), screen({ line: 120 })]);
assert.deepEqual(screenFrames(twice, W, H, 1), [0]);
assert.deepEqual(screenFrames(twice, W, H, 12), [0, 2, 6]);

// D-08 sampling.
assert.equal(sampleInterval(1199), 1);
assert.equal(sampleInterval(1200), 1);
assert.equal(sampleInterval(1201), 1201 / 1200);
assert(Math.ceil(4 * 3600 / sampleInterval(4 * 3600)) <= 1200);

// D-09/D-10 folders.
const root = mkdtempSync(path.join(os.tmpdir(), "video-digest-test-"));
try {
	const base = path.join(root, "docs", "research", "videos");
	const none = () => undefined;
	assert.equal(digestFolder(base, "20261016", "When should you NOT use /grill-me?", "k2zgcTDq4aQ", none), path.join(base, "2026-10-16-when-should-you-not-use-grill-me"));
	const escape = digestFolder(base, "20261016", "../../../etc/passwd", "id1", none);
	assert(escape.startsWith(base + path.sep) && path.basename(escape) === "2026-10-16-etc-passwd");
	assert.equal(path.basename(digestFolder(base, "", "x", "id1", none, new Date("2026-11-08T10:00:00Z"))), "2026-11-08-x");
	assert.equal(path.basename(digestFolder(base, "20261016", "Same", "id1", () => "id1")), "2026-10-16-same");
	assert.equal(path.basename(digestFolder(base, "20261016", "Same", "id2", () => "id1")), "2026-10-16-same-id2");
	assert.equal(digestFolder(base, "20261016", "a".repeat(200), "id1", none).length - base.length - 12, 60);
	assert.equal(keepTakeaways(undefined, "# New\n"), "# New\n");
	assert.equal(keepTakeaways(`# Old\n\n${TAKEAWAYS}\n\n- adopt X\n\n## Later\n`, "# New\n"), `# New\n\n${TAKEAWAYS}\n\n- adopt X\n`);

	// D-12 batch validation (V2-03): labels resolve only through the batch map, ids get the batch prefix.
	const frames = new Map([["0:11", 11], ["0:57", 57]]);
	const reply = JSON.stringify({ artifacts: [
		{ start: 11, end: 57, title: "Flow", kind: "text", markdown: "```mermaid\nA-->B-->C\n```", frames: ["0:57", "0:11", "C:\\Windows\\win.ini", "9:99", 3] }, // text with cited frames, bad labels dropped
		{ start: 57, end: 57, title: "UI", kind: "image", markdown: "dark editor", frame: "0:57" }, // image
		{ start: 1, end: 2, title: "Bad", kind: "image", markdown: "x", frame: "C:\\Windows\\win.ini" }, // a path
		{ start: 1, end: 2, title: "Bad", kind: "image", markdown: "x", frame: "9:99" }, // unknown label
		{ start: 1, end: 500, title: "Bad", kind: "text", markdown: "x" }, // beyond the duration
		{ start: 5, end: 2, title: "Bad", kind: "text", markdown: "x" }, // reversed
		{ start: 1, end: 2, title: "Bad", kind: "script", markdown: "x" }, // unknown kind
	] });
	const parsed = batchArtifacts(`Sure:\n\`\`\`json\n${reply}\n\`\`\``, frames, 97, "b2");
	assert.equal(parsed.dropped, 5);
	assert.deepEqual(parsed.artifacts.map((a) => [a.id, a.frames, a.frame]), [["b2-a1", [11, 57], undefined], ["b2-a2", [57], 57]]);
	assert.deepEqual(batchArtifacts("no json here", frames, 97, "b1"), { artifacts: [], dropped: 1, invalidReply: true });
	// Colliding local ids from two batches stay distinct.
	const one = JSON.stringify({ artifacts: [{ id: "a1", start: 1, end: 2, title: "T", kind: "text", markdown: "m" }] });
	assert.notEqual(batchArtifacts(one, frames, 97, "b1").artifacts[0].id, batchArtifacts(one, frames, 97, "b2").artifacts[0].id);

	// D-07 final merge (V2-04): from replaces named sources, unnamed ones survive, frames are unioned.
	const batch = [
		{ id: "b1-a1", start: 10, end: 20, title: "File top", kind: "text", markdown: "```ts\nconst a = 1;\n```", frames: [10, 12] },
		{ id: "b1-a2", start: 15, end: 16, title: "Unrelated", kind: "text", markdown: "list", frames: [15] },
		{ id: "b2-a1", start: 30, end: 40, title: "File bottom", kind: "text", markdown: "```ts\nconst b = 2;\n```", frames: [30, 12] },
		{ id: "b3-a1", start: 50, end: 50, title: "Dup", kind: "text", markdown: "```ts\nconst b = 2;\n```", frames: [50] },
	];
	const at = (index) => `0:${String(index).padStart(2, "0")}`;
	const final = finalArtifacts(batch, JSON.stringify({ artifacts: [
		{ from: ["b1-a1", "b2-a1", "b3-a1"], start: 10, end: 50, title: "File", kind: "text", markdown: "```ts\nconst a = 1;\nconst b = 2;\n```" }, // scrolled file plus a duplicate
		{ from: ["b9-a9"], start: 1, end: 2, title: "Bad", kind: "text", markdown: "x" }, // unknown source
		{ from: ["b1-a2"], start: 1, end: 2, title: "Bad", kind: "image", markdown: "x", frame: "0:99" }, // frame outside its sources
		{ start: 1, end: 2, title: "Bad", kind: "text", markdown: "x" }, // no from
	] }), 97, at);
	assert.equal(final.dropped, 3);
	assert.deepEqual(final.artifacts.map((a) => [a.id, a.title, a.frames]), [["m1", "File", [10, 12, 30, 50]], ["b1-a2", "Unrelated", [15]]]);
	assert.deepEqual(finalArtifacts(batch, "not json", 97, at), { artifacts: batch, dropped: 0, invalidReply: true });

	// D-06 parallel runner: at most 8 at once; a failure stops scheduling and waits for running calls.
	let active = 0, peak = 0;
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	assert.deepEqual(await mapLimit([...Array(20).keys()], 8, async (n) => { peak = Math.max(peak, ++active); await sleep(5); active--; return n * 2; }), [...Array(20).keys()].map((n) => n * 2));
	assert.equal(peak, 8);
	const started = [];
	let settled = 0;
	await assert.rejects(mapLimit([...Array(20).keys()], 4, async (n, _i, callSignal) => {
		started.push(n);
		if (n === 1) { await sleep(2); throw new Error("Luna failed (error)."); }
		await new Promise((resolve) => { const t = setTimeout(resolve, 50); callSignal.addEventListener("abort", () => { clearTimeout(t); resolve(); }); });
		settled++;
	}), /Luna failed/);
	assert.deepEqual(started, [0, 1, 2, 3], "no call starts after the failure");
	assert.equal(settled, 3, "running calls settled before the rejection");
	const cancel = new AbortController();
	await assert.rejects(mapLimit([...Array(20).keys()], 4, async (n) => { if (n === 2) cancel.abort(); await sleep(2); }, cancel.signal), /cancelled/);

	// D-07 rendering.
	// D-01 placement: before the first sentence, after the last sentence at or before the start (gaps too), at the end.
	const visual = (title, start, extra = {}) => ({ id: title, start, end: start, title, kind: "text", markdown: `md ${title}`, frames: [], ...extra });
	const woven = renderDigest({ id: "vid", title: "T", url: "u", duration: 97 }, [{ t: 5, text: "One." }, { t: 10, text: "Two." }, { t: 40, text: "Three." }],
		[visual("Trail", 50), visual("Gap", 20), visual("B", 8), visual("A", 6), visual("Lead", 1), visual("UI", 10, { kind: "image", frames: [10, 12], frame: 12 })], 2);
	const order = [...woven.matchAll(/^(\[\d:\d\d\] \w+\.|### \S+ \w+)/gm)].map((m) => m[1].replace(/^### \S+ /, ""));
	assert.deepEqual(order, ["Lead", "[0:05] One.", "A", "B", "[0:10] Two.", "UI", "Gap", "[0:40] Three.", "Trail"]);
	assert(woven.includes("[▶ 0:20 on YouTube](https://www.youtube.com/watch?v=vid&t=20s)"));
	assert(woven.includes("![UI](frames/0-24.jpg)") && woven.includes("frames [0:20](frames/0-20.jpg) [0:24](frames/0-24.jpg)"), "frame times use the sampling interval");
	// D-09: at most 12 frames, first and last kept, evenly spread; an image's own frame always.
	const many = { frames: [...Array(30).keys()] };
	const picks = keptFrames(many);
	assert(picks.length === 12 && picks[0] === 0 && picks[11] === 29);
	assert(keptFrames({ ...many, frame: 1 }).includes(1));
	const page = renderDigest({ id: "vid", title: "T", url: "u", duration: 97 }, [], [{ id: "a1", start: 11, end: 57, title: "Flow", kind: "text", markdown: "m", frames: [] }]);
	assert.match(page, /^<!-- video_digest: vid -->/);
	assert(page.includes(NO_CAPTIONS) && page.includes("### [0:11–0:57] Flow") && /Untrusted source material/.test(page));

	// Pipeline with a fake runner and model.
	const tmpRoot = path.join(root, "tmp");
	mkdirSync(tmpRoot);
	const project = path.join(root, "project");
	const arg = (args, flag) => args[args.indexOf(flag) + 1];
	const fake = ({ missing, failing, captions = true, thumbs = typing, onCall, flaky = 0 } = {}) => {
		const calls = [];
		const exec = async (command, args, options) => {
			calls.push([command, ...args]);
			onCall?.(command, args, options);
			const name = /yt-dlp/.test(command) ? "yt-dlp" : "ffmpeg";
			if (name === missing || name === failing && args[0] !== "--version" && args[0] !== "-version") return { code: 1, stderr: `${name} failed` };
			if (args[0] === "--version" || args[0] === "-version") return { code: 0, stdout: "1.0" };
			if (name === "yt-dlp" && args.includes("--write-info-json")) {
				const info = { id: "k2zgcTDq4aQ", title: "When should you NOT use /grill-me?", channel: "Matt Pocock", duration: 97, upload_date: "20261016", language: "en-US", webpage_url: "https://www.youtube.com/watch?v=k2zgcTDq4aQ", automatic_captions: captions ? { "en-orig": [] } : {} };
				writeFileSync(path.join(path.dirname(arg(args, "-o")), "v.info.json"), JSON.stringify(info));
			} else if (name === "yt-dlp" && args.includes("--sub-langs")) writeFileSync(path.join(path.dirname(arg(args, "-o")), `v.${arg(args, "--sub-langs")}.json3`), JSON.stringify(json3));
			else if (name === "yt-dlp" && flaky-- > 0) return { code: 1, stderr: "HTTP Error 403: Forbidden" };
			else if (name === "yt-dlp") writeFileSync(path.join(path.dirname(arg(args, "-o")), "video.mp4"), "");
			else if (name === "ffmpeg") {
				for (let i = 0; i < thumbs.length / (320 * 180); i++) writeFileSync(path.join(path.dirname(args[args.indexOf("-q:v") + 2]), `f${String(i + 1).padStart(4, "0")}.jpg`), "jpg");
				writeFileSync(args.at(-1), thumbs);
			}
			return { code: 0, stdout: "" };
		};
		return { exec, calls };
	};
	const tmpEmpty = () => assert.deepEqual(readdirSync(tmpRoot), [], "the temp dir is removed");
	// 12 distinct screen states (a line typed per second) → 2 batches.
	const typing = Buffer.concat(Array.from({ length: 12 }, (_, i) => {
		const f = Buffer.alloc(320 * 180, 40);
		for (let p = 0; p < f.length; p++) if (Math.floor(p / 320) < 10 + i * 8 && p % 320 < 100 && Math.floor(p / 320) % 8 === 2) f[p] = 200;
		return f;
	}));
	const prompts = [];
	const usage = { input: 100, output: 10, cost: { total: 0.01 } };
	const fakeModel = (merge = async () => ({ text: JSON.stringify({ artifacts: [{ from: ["b1-a1", "b2-a1"], start: 0, end: 11, title: "Flow", kind: "text", markdown: "```mermaid\nA-->B-->C\n```" }] }), usage })) => async (content, callSignal) => {
		prompts.push(content);
		if (content.length === 1) return merge(content, callSignal); // the text-only merge call
		const labels = content.filter((part) => part.type === "text" && part.text.startsWith("Frame ")).map((part) => part.text.slice(6, -1));
		assert(content.filter((part) => part.type === "image").length === labels.length && labels.length <= 10);
		const artifacts = labels[0] === "0:00"
			? [{ start: 0, end: 9, title: "Flow", kind: "text", markdown: "```mermaid\nA-->B\n```", frames: ["0:01", "0:03"] }, { start: 2, end: 3, title: "Code", kind: "text", markdown: "```ts\nx\n```", frames: ["0:02"] }]
			: [{ id: "a1", start: 10, end: 11, title: "Flow", kind: "text", markdown: "```mermaid\nA-->B-->C\n```", frames: ["0:11"] }];
		return { text: JSON.stringify({ artifacts }), usage };
	};
	const model = fakeModel();

	// A missing program fails before any download; Tesseract is no longer needed (D-08).
	const noFfmpeg = fake({ missing: "ffmpeg" });
	await assert.rejects(digestVideo({ url: "https://youtu.be/k2zgcTDq4aQ", cwd: project, exec: noFfmpeg.exec, model, tmpRoot }), /ffmpeg is not installed.*winget install/);
	assert(!noFfmpeg.calls.some((call) => call.includes("--write-info-json")), "nothing is downloaded");
	assert(!noFfmpeg.calls.some((call) => /tesseract/.test(call[0])));

	// Full run: two parallel batches, then the merge joins the artifact spanning both; the unrelated one survives.
	const ok = fake();
	const result = await digestVideo({ url: "https://www.youtube.com/shorts/k2zgcTDq4aQ", cwd: project, exec: ok.exec, model, tmpRoot });
	tmpEmpty();
	assert.equal(result.calls, 3);
	assert.equal(result.usage.input, 300);
	assert.equal(result.candidates, 12);
	assert(prompts.slice(0, 2).every((content) => !/b1-a1|already rebuilt/.test(content[0].text)), "batches do not see each other's artifacts");
	assert(prompts[2].length === 1 && prompts[2][0].text.includes('"id":"b1-a1"') && prompts[2][0].text.includes('"id":"b2-a1"'));
	assert(!ok.calls.some((call) => call.includes("--write-subs") || call.includes("en")), "only the original-language track is requested");
	// D-04: 720p download, one ffmpeg pass writing JPEG frames plus gray thumbnails.
	assert(ok.calls.some((call) => call.includes("bv*[height<=720]/b")));
	const ffCall = ok.calls.find((call) => /ffmpeg/.test(call[0]) && call[1] !== "-version");
	assert.match(ffCall[ffCall.indexOf("-filter_complex") + 1], /fps=1\/1,split=2.*scale=320:180,format=gray/);
	assert(ffCall.includes("-q:v") && /f%04d\.jpg$/.test(ffCall[ffCall.indexOf("-q:v") + 2]) && ffCall.at(-1).endsWith("thumbs.gray") && ffCall.includes("rawvideo"));
	assert.equal(prompts[0].find((part) => part.type === "image").mimeType, "image/jpeg");
	const digestFile = path.join(project, "docs", "research", "videos", "2026-10-16-when-should-you-not-use-grill-me", "digest.md");
	assert.equal(result.file, digestFile);
	let digest = readFileSync(digestFile, "utf8");
	assert(digest.includes("A-->B-->C") && digest.includes("```ts\nx\n```") && !digest.includes("A-->B\n"));
	assert(digest.includes("[0:00] A lot of people\n") && digest.includes("[0:12] ask me") && digest.includes("Captions: en-orig (auto)"));
	assert.equal(digestOwner(path.dirname(digestFile)), "k2zgcTDq4aQ");
	// D-02: every frame link points at a written JPEG; the merged visual keeps the frames of both batches.
	const links = [...digest.matchAll(/\(frames\/([\d-]+\.jpg)\)/g)].map((m) => m[1]);
	assert(links.includes("0-01.jpg") && links.includes("0-11.jpg") && links.every((name) => existsSync(path.join(path.dirname(digestFile), "frames", name))));
	assert.equal(result.framesKept, 4);

	// Rerun keeps the agent's takeaways and rewrites the generated sections.
	writeFileSync(digestFile, `${digest}\n${TAKEAWAYS}\n\n- Plan3 already sizes requests.\n`);
	prompts.length = 0;
	const rerun = await digestVideo({ url: "https://www.youtube.com/shorts/k2zgcTDq4aQ", cwd: project, exec: fake({ captions: false }).exec, model, tmpRoot });
	digest = readFileSync(digestFile, "utf8");
	assert(rerun.keptTakeaways && digest.includes("- Plan3 already sizes requests.") && digest.split(TAKEAWAYS).length === 2);
	// No captions: visuals still digested, with the note (D-07).
	assert(digest.includes(NO_CAPTIONS) && digest.includes("A-->B-->C") && rerun.transcriptChars === 0);
	tmpEmpty();

	// Failures and cancellation remove the temp dir.
	await assert.rejects(digestVideo({ url: "https://youtu.be/k2zgcTDq4aQ", cwd: project, exec: fake({ failing: "ffmpeg" }).exec, model, tmpRoot }), /ffmpeg could not sample frames/);
	tmpEmpty();
	// A transient 403 on the download is retried once from the page URL (fresh format URLs); two in a row fail with yt-dlp's error.
	const flaky = fake({ flaky: 1 });
	await digestVideo({ url: "https://youtu.be/k2zgcTDq4aQ", cwd: project, exec: flaky.exec, model, tmpRoot });
	const downloads = flaky.calls.filter((call) => call.includes("bv*[height<=720]/b"));
	assert(downloads.length === 2 && downloads[0].includes("--load-info-json") && !downloads[1].includes("--load-info-json") && downloads[1].at(-1) === "https://youtu.be/k2zgcTDq4aQ");
	tmpEmpty();
	await assert.rejects(digestVideo({ url: "https://youtu.be/k2zgcTDq4aQ", cwd: project, exec: fake({ flaky: 2 }).exec, model, tmpRoot }), /could not download the video: HTTP Error 403/);
	tmpEmpty();
	await assert.rejects(digestVideo({ url: "https://youtu.be/k2zgcTDq4aQ", cwd: project, exec: fake().exec, model: async () => { throw new Error("Luna failed (error)."); }, tmpRoot }), /Luna failed/);
	tmpEmpty();
	// A failed or unusable merge keeps the batch artifacts, with a note.
	for (const merge of [async () => { throw new Error("Luna failed (length)."); }, async () => ({ text: "sorry", usage })]) {
		await digestVideo({ url: "https://youtu.be/k2zgcTDq4aQ", cwd: project, exec: fake().exec, model: fakeModel(merge), tmpRoot });
		digest = readFileSync(digestFile, "utf8");
		assert(digest.includes("A-->B\n") && digest.includes("A-->B-->C") && /> The merge (call failed \(Luna failed \(length\)\.\)|reply was unusable); visuals from separate batches are listed unmerged\./.test(digest));
		tmpEmpty();
	}
	// Cancel during the batches or the merge: no digest written, temp removed after every call settles.
	for (const during of ["batch", "merge"]) {
		const stopper = new AbortController();
		rmSync(digestFile, { force: true });
		const cancelling = fakeModel(async () => { stopper.abort(); throw new Error("Video digest cancelled."); });
		const cancelModel = during === "merge" ? cancelling : async (_content, callSignal) => { stopper.abort(); await sleep(5); assert(callSignal.aborted); throw new Error("Video digest cancelled."); };
		await assert.rejects(digestVideo({ url: "https://youtu.be/k2zgcTDq4aQ", cwd: project, exec: fake().exec, model: cancelModel, signal: stopper.signal, tmpRoot }), /cancelled/);
		assert(!existsSync(digestFile), `no digest after a cancel during the ${during}`);
		tmpEmpty();
	}
	const controller = new AbortController();
	const aborting = fake({ onCall: (_command, args) => { if (args.includes("-f")) controller.abort(); } });
	await assert.rejects(digestVideo({ url: "https://youtu.be/k2zgcTDq4aQ", cwd: project, exec: aborting.exec, model, signal: controller.signal, tmpRoot }), /cancelled/);
	assert(!aborting.calls.some((call) => /ffmpeg/.test(call[0]) && call[1] !== "-version"), "nothing runs after the abort");
	tmpEmpty();
} finally {
	rmSync(root, { recursive: true, force: true });
}

// D-01: registered deferred and listed by tools_enable only in the ce-workflow checkout (real session_start, fresh module each).
const repo = path.resolve(import.meta.dirname, "..");
for (const [cwd, tag, expected] of [[repo, "repo", true], [os.tmpdir(), "other", false]]) {
	const mod = await import(`${pathToFileURL(path.join(repo, "extensions", "work-models.ts")).href}?${tag}`);
	const tools = new Map(), hooks = new Map();
	mod.default({
		on: (name, handler) => hooks.set(name, handler), registerCommand() {}, registerShortcut() {}, registerTool: (tool) => tools.set(tool.name, tool),
		events: { on() {}, emit() {} }, getAllTools: () => [...tools.values()], exec: async () => ({ code: 0 }), getActiveTools: () => [], setActiveTools() {}, appendEntry() {},
	});
	await hooks.get("session_start")({ reason: "startup" }, { cwd, hasUI: false, sessionManager: { getBranch: () => [], getEntries: () => [] }, ui: { notify() {}, setStatus() {} } });
	assert.equal(tools.get("video_digest")?.exposure, expected ? "deferred" : undefined, cwd);
	assert.equal(!!tools.get("tools_enable")?.description.includes("- video_digest:"), expected, cwd);
}
console.log("video-digest: ok");
