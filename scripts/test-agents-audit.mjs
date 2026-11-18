// AGENTS.md audit: when it is due, which model proposals survive, and that only still-matching picks are written.
import assert from "node:assert/strict";
import { applyRecommendations, auditDue, fileHashes, proposeRecommendations, validRecommendations } from "../extensions/agents-audit.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-11-20T12:00:00Z");
const files = [{ path: "C:/repo/AGENTS.md", content: "Use bash.\nNEVER push.\nUse bash.\nBe short." }];
const hashes = fileHashes(files);

assert.equal(auditDue({}, files, now), true, "never audited: due");
assert.equal(auditDue({ lastRun: new Date(now - 4 * DAY).toISOString(), files: {} }, files, now), false, "changed but only 4 days: not yet");
assert.equal(auditDue({ lastRun: new Date(now - 5 * DAY).toISOString(), files: hashes }, files, now), false, "5 days but unchanged: skipped");
assert.equal(auditDue({ lastRun: new Date(now - 5 * DAY).toISOString(), files: hashes }, [{ ...files[0], content: "x" }], now), true, "5 days and changed: due");
assert.equal(auditDue({ lastRun: new Date(now - 6 * DAY).toISOString(), files: hashes }, [...files, { path: "C:/CLAUDE.md", content: "y" }], now), true, "a newly loaded file counts as changed");

const rec = (r) => ({ file: "c:/REPO/agents.md", title: "t", reason: "r", newText: "", ...r });
assert.deepEqual(validRecommendations({ recommendations: [
	rec({ oldText: "NEVER push.\n", newText: "Never push.\n", title: "calm the shouting" }),
	rec({ oldText: "Use bash.\n" }), // twice in the file: ambiguous
	rec({ oldText: "not in the file" }),
	rec({ file: "C:/other.md", oldText: "Be short." }),
	rec({ oldText: "Be short.", reason: " " }),
] }, files), [{ file: "C:/repo/AGENTS.md", oldText: "NEVER push.\n", newText: "Never push.\n", title: "calm the shouting", reason: "r" }], "keeps only unique text in a loaded file, with a reason; maps the path to the loaded one");
assert.deepEqual(validRecommendations("nonsense", files), [], "a malformed reply proposes nothing");

const disk = { "C:/a.md": "keep\n$& stays\ndrop me\n", "C:/b.md": "edited meanwhile" };
const { applied, skipped } = applyRecommendations(
	[{ file: "C:/a.md", oldText: "drop me\n", newText: "$& kept literally\n", title: "a", reason: "r" }, { file: "C:/b.md", oldText: "original", newText: "", title: "b", reason: "r" }],
	(f) => disk[f] ?? "", (f, t) => { disk[f] = t; });
assert.equal(disk["C:/a.md"], "keep\n$& stays\n$& kept literally\n", "replacement text is literal");
assert.deepEqual([applied.map((r) => r.title), skipped.map((r) => r.title)], [["a"], ["b"]], "a pick whose text changed since the audit is skipped, not guessed");

const reply = "```json\n" + JSON.stringify({ recommendations: [rec({ oldText: "Be short." })] }) + "\n```";
let seen;
const recs = await proposeRecommendations(files, { system: "SYS", tools: [] }, async (system, user) => { seen = JSON.parse(user); return reply; });
assert.equal(recs.length, 1, "fenced JSON is accepted");
assert.equal(seen.systemPrompt, "SYS", "the model sees the whole blank-session prompt for cross-file duplicates");
console.log("agents-audit ok");
