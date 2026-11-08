#!/usr/bin/env node
// video_digest (plan 544351ec): pure helpers, the pipeline with a fake runner and model, and the checkout-only registration.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
	isYouTubeUrl, pickCaptionTrack, captionLines, captionParagraphs, ocrTokens, similarity, selectCandidates, sampleInterval,
	digestFolder, digestOwner, keepTakeaways, mergeArtifacts, renderDigest, digestVideo, NO_CAPTIONS, TAKEAWAYS,
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

// json3 → [m:ss] paragraphs of about 30 s.
const json3 = { events: [{ tStartMs: 0, dDurationMs: 99400 }, { tStartMs: 0, segs: [{ utf8: "A" }, { utf8: " lot of people" }] }, { tStartMs: 1670, segs: [{ utf8: "\n" }] }, { tStartMs: 12000, segs: [{ utf8: "ask me" }] }, { tStartMs: 31000, segs: [{ utf8: "when to grill" }] }] };
const lines = captionLines(json3);
assert.deepEqual(lines, [{ t: 0, text: "A lot of people" }, { t: 12, text: "ask me" }, { t: 31, text: "when to grill" }]);
assert.equal(captionParagraphs(lines), "[0:00] A lot of people ask me\n\n[0:31] when to grill");

// OCR TSV → tokens per frame; low confidence dropped, numbers and symbols kept.
const words = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const tsv = (pages) => ["level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
	...pages.flatMap((tokens, p) => [`1\t${p + 1}\t0\t0\t0\t0\t0\t0\t608\t1080\t-1\t`, ...tokens.map((t, i) => `5\t${p + 1}\t1\t1\t1\t${i + 1}\t0\t0\t9\t9\t${t === "blurry" ? 40 : 91}\t${t}`)])].join("\n");
assert.deepEqual(ocrTokens(tsv([["const", "x", "=", "42;", "blurry"], []]), 3), [["const", "x", "=", "42;"], [], []]);

// D-11/D-13 candidate selection.
const code = words(20, "tok");
const fixed = [...code.slice(0, 19), "43"]; // one changed token, a number
const scrollA = words(20, "line"), scrollB = [...words(10, "line").map((_, i) => `line${i + 10}`), ...words(10, "more")];
const pages = [
	["so", "the", "idea", "is"], // 0 caption-only: dropped
	code, code, code, // 1-3 exact repeats → keep 1 (before)
	fixed, // 4 corrected line: same run, kept as the after state
	[...fixed.slice(0, 18), "x", "43"], // 5 another edit in the run: replaces 4 as the last state
	scrollA, scrollB, // 6, 7 overlapping scroll positions: both kept
];
assert(similarity(code, fixed) > 0.9 && similarity(scrollA, scrollB) < 0.5);
assert.deepEqual(selectCandidates(pages), [1, 5, 6, 7]);

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

	// D-12 merge and validation.
	const frames = new Map([["0:11", "/tmp/f0012.png"], ["0:57", "/tmp/f0058.png"]]);
	const state = [{ id: "a1", start: 11, end: 20, title: "Flow", kind: "text", markdown: "```mermaid\nA-->B\n```" }, { id: "a2", start: 30, end: 40, title: "Code", kind: "text", markdown: "x" }];
	const reply = JSON.stringify({ artifacts: [
		{ id: "a1", start: 11, end: 57, title: "Flow", kind: "text", markdown: "```mermaid\nA-->B-->C\n```" }, // update by id
		{ start: 57, end: 57, title: "UI", kind: "image", markdown: "dark editor", frame: "0:57" }, // new image
		{ start: 1, end: 2, title: "Bad", kind: "image", markdown: "x", frame: "C:\\Windows\\win.ini" }, // a path
		{ start: 1, end: 2, title: "Bad", kind: "image", markdown: "x", frame: "9:99" }, // unknown label
		{ start: 1, end: 500, title: "Bad", kind: "text", markdown: "x" }, // beyond the duration
		{ start: 5, end: 2, title: "Bad", kind: "text", markdown: "x" }, // reversed
		{ start: 1, end: 2, title: "Bad", kind: "script", markdown: "x" }, // unknown kind
	] });
	const merged = mergeArtifacts(state, `Sure:\n\`\`\`json\n${reply}\n\`\`\``, frames, 97);
	assert.equal(merged.dropped, 5);
	assert.deepEqual(merged.artifacts.map((a) => [a.id, a.end, a.file]), [["a1", 57, undefined], ["a2", 40, undefined], ["a3", 57, "/tmp/f0058.png"]]);
	assert.match(merged.artifacts[0].markdown, /A-->B-->C/);
	assert.equal(state[0].end, 20, "the input state is not mutated");
	assert.deepEqual(mergeArtifacts(state, "no json here", frames, 97), { artifacts: state, dropped: 1, invalidReply: true });

	// D-07 rendering.
	const page = renderDigest({ id: "vid", title: "T", url: "u", duration: 97 }, "", [{ id: "a1", start: 11, end: 57, title: "Flow", kind: "text", markdown: "m" }]);
	assert.match(page, /^<!-- video_digest: vid -->/);
	assert(page.includes(NO_CAPTIONS) && page.includes("### [0:11–0:57] Flow") && /Untrusted source material/.test(page));

	// Pipeline with a fake runner and model.
	const tmpRoot = path.join(root, "tmp");
	mkdirSync(tmpRoot);
	const project = path.join(root, "project");
	const arg = (args, flag) => args[args.indexOf(flag) + 1];
	const fake = ({ missing, failing, captions = true, pageTokens, onCall } = {}) => {
		const calls = [];
		const exec = async (command, args, options) => {
			calls.push([command, ...args]);
			onCall?.(command, args, options);
			const name = /yt-dlp/.test(command) ? "yt-dlp" : /ffmpeg/.test(command) ? "ffmpeg" : "tesseract";
			if (name === missing || name === failing && args[0] !== "--version" && args[0] !== "-version") return { code: 1, stderr: `${name} failed` };
			if (args[0] === "--version" || args[0] === "-version") return { code: 0, stdout: "1.0" };
			if (name === "yt-dlp" && args.includes("--write-info-json")) {
				const info = { id: "k2zgcTDq4aQ", title: "When should you NOT use /grill-me?", channel: "Matt Pocock", duration: 97, upload_date: "20261016", language: "en-US", webpage_url: "https://www.youtube.com/watch?v=k2zgcTDq4aQ", automatic_captions: captions ? { "en-orig": [] } : {} };
				writeFileSync(path.join(path.dirname(arg(args, "-o")), "v.info.json"), JSON.stringify(info));
			} else if (name === "yt-dlp" && args.includes("--sub-langs")) writeFileSync(path.join(path.dirname(arg(args, "-o")), `v.${arg(args, "--sub-langs")}.json3`), JSON.stringify(json3));
			else if (name === "yt-dlp") writeFileSync(path.join(path.dirname(arg(args, "-o")), "video.mp4"), "");
			else if (name === "ffmpeg") {
				pageTokens.forEach((_, i) => writeFileSync(path.join(path.dirname(args[args.indexOf("-q:v") + 2]), `f${String(i + 1).padStart(4, "0")}.jpg`), "jpg"));
				writeFileSync(args.at(-1), Buffer.alloc(pageTokens.length * 320 * 180));
			}
			else writeFileSync(`${args[1]}.tsv`, tsv(pageTokens));
			return { code: 0, stdout: "" };
		};
		return { exec, calls };
	};
	const tmpEmpty = () => assert.deepEqual(readdirSync(tmpRoot), [], "the temp dir is removed");
	const distinct = Array.from({ length: 12 }, (_, i) => words(10, `p${i}w`)); // 12 candidates → 2 batches
	const prompts = [];
	const model = async (content) => {
		prompts.push(content);
		const labels = content.filter((part) => part.type === "text" && part.text.startsWith("Frame ")).map((part) => part.text.slice(6, -1));
		assert(content.filter((part) => part.type === "image").length === labels.length && labels.length <= 10);
		const artifacts = prompts.length === 1
			? [{ start: 0, end: 9, title: "Flow", kind: "text", markdown: "```mermaid\nA-->B\n```" }, { start: 2, end: 3, title: "Code", kind: "text", markdown: "```ts\nx\n```" }]
			: [{ id: "a1", start: 0, end: 11, title: "Flow", kind: "text", markdown: "```mermaid\nA-->B-->C\n```" }];
		return { text: JSON.stringify({ artifacts }), usage: { input: 100, output: 10, cost: { total: 0.01 } } };
	};

	// Missing Tesseract fails before any download.
	const noOcr = fake({ missing: "tesseract", pageTokens: distinct });
	await assert.rejects(digestVideo({ url: "https://youtu.be/k2zgcTDq4aQ", cwd: project, exec: noOcr.exec, model, tmpRoot }), /tesseract is not installed.*winget install/);
	assert(!noOcr.calls.some((call) => call.includes("--write-info-json")), "nothing is downloaded");

	// Full run: two batches, an artifact spanning both is updated, the earlier unrelated one survives.
	const ok = fake({ pageTokens: distinct });
	const result = await digestVideo({ url: "https://www.youtube.com/shorts/k2zgcTDq4aQ", cwd: project, exec: ok.exec, model, tmpRoot });
	tmpEmpty();
	assert.equal(result.calls, 2);
	assert.equal(result.candidates, 12);
	assert.match(prompts[1][0].text, /"id":"a1"/, "the second batch sees earlier artifacts with ids");
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
	assert(digest.includes("[0:00] A lot of people ask me") && digest.includes("Captions: en-orig (auto)"));
	assert.equal(digestOwner(path.dirname(digestFile)), "k2zgcTDq4aQ");

	// Rerun keeps the agent's takeaways and rewrites the generated sections.
	writeFileSync(digestFile, `${digest}\n${TAKEAWAYS}\n\n- Plan3 already sizes requests.\n`);
	prompts.length = 0;
	const rerun = await digestVideo({ url: "https://www.youtube.com/shorts/k2zgcTDq4aQ", cwd: project, exec: fake({ captions: false, pageTokens: distinct }).exec, model, tmpRoot });
	digest = readFileSync(digestFile, "utf8");
	assert(rerun.keptTakeaways && digest.includes("- Plan3 already sizes requests.") && digest.split(TAKEAWAYS).length === 2);
	// No captions: visuals still digested, with the note (D-07).
	assert(digest.includes(NO_CAPTIONS) && digest.includes("A-->B-->C") && rerun.transcriptChars === 0);
	tmpEmpty();

	// Failures and cancellation remove the temp dir.
	await assert.rejects(digestVideo({ url: "https://youtu.be/k2zgcTDq4aQ", cwd: project, exec: fake({ failing: "ffmpeg", pageTokens: distinct }).exec, model, tmpRoot }), /ffmpeg could not sample frames/);
	tmpEmpty();
	await assert.rejects(digestVideo({ url: "https://youtu.be/k2zgcTDq4aQ", cwd: project, exec: fake({ pageTokens: distinct }).exec, model: async () => { throw new Error("Luna failed (error)."); }, tmpRoot }), /Luna failed/);
	tmpEmpty();
	const controller = new AbortController();
	const aborting = fake({ pageTokens: distinct, onCall: (_command, args) => { if (args.includes("-f")) controller.abort(); } });
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
