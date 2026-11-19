// Offline self-check of the planted-fact recall scorer: a perfect summary scores 100%, an empty one 0%, and facts land
// at their depths in the transcript slice without reaching the protected (verbatim-kept) user records.
import assert from "node:assert/strict";
import { DEPTHS, FACTS, plant, score } from "./benchmark-compaction-recall-live.mjs";
import { compactMemory } from "../extensions/work-compaction-memory.ts";

const transcript = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: [{ type: "text", text: `turn ${i} ${"x".repeat(400)}` }], timestamp: i }));
const planted = plant(transcript, 40_000);
assert.ok(planted.length < transcript.length + FACTS.length, "plant cuts the transcript to the requested size");
const slice = planted.length - FACTS.length;
FACTS.forEach((fact, i) => {
	const at = planted.findIndex((m) => m.content[0].text === fact.text);
	assert.ok(Math.abs(at - (DEPTHS[i] * slice + i)) <= 1, `fact ${i} sits at depth ${DEPTHS[i]} (index ${at} of ${planted.length})`);
	assert.notEqual(planted[at].role, "user", "planted facts must not be user requests, which compaction keeps verbatim");
});
assert.equal(score(FACTS.map((f) => f.text).join("\n")).recall, 1, "perfect summary scores 100%");
assert.equal(score("").recall, 0, "empty summary scores 0%");
assert.equal(score(FACTS[0].text.toUpperCase()).recall, 1 / FACTS.length, "match is case-insensitive and per fact");

// The model-free compactMemory path ('cleaned') keeps local records, so the planted facts are reachable in its input.
const cleaned = await compactMemory({ messages: planted, limit: 200_000 });
assert.equal(score(cleaned.summary).recall, 1, "planted facts reach compactMemory's records");
console.log("compaction recall self-check passed");
