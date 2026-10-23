// The annotator's pure parts: marker numbering and the notes text that goes into the chat.
import assert from "node:assert/strict";
import { legend, nextNumber } from "../web/annotate.ts";

const marker = (n, text = "") => ({ kind: "marker", color: "#e03131", n, at: [0, 0], text });
assert.equal(nextNumber([]), 1);
assert.equal(nextNumber([marker(1), marker(3), { kind: "rect", color: "#000", a: [0, 0], b: [5, 5] }]), 2, "fills the first gap");
assert.equal(nextNumber(Array.from({ length: 99 }, (_, i) => marker(i + 1))), 0, "all 99 taken");
assert.equal(legend([marker(5, " cut off "), marker(2, "wrong colour"), marker(3)]), "(2) wrong colour\n(5) cut off", "sorted, trimmed, empty notes skipped");
console.log("annotate ok");
