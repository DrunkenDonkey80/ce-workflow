import assert from "node:assert/strict";
import { barSlots, hubsIconSvg } from "../web/icons.ts";

const n = (counts) => Object.entries(counts).flatMap(([state, k]) => Array(k).fill(state));
const short = (states) => barSlots(states).map(s => s[0] + s[1]).join(" ");
assert.equal(short(n({ working: 2, unseen: 1, waiting: 1 })), "wa wo wo un", "1 red, 2 orange, 1 green");
assert.equal(short(n({ working: 2, unseen: 1, waiting: 2 })), "wa wa wo un", "questions take the spare segment first");
assert.equal(short(n({ working: 2, unseen: 2, waiting: 2 })), "wa wa wo un");
assert.equal(short(n({ working: 3 })), "wo wo wo", "one segment per session up to 4");
assert.equal(short(n({ working: 9 })), "wo wo wo wo");
assert.equal(short(n({ working: 5, unseen: 1, waiting: 1, scheduled: 1 })), "wa wo un sc", "every state keeps one segment");
assert.equal(short(["working", "working", "working", "unseen", "unseen"]), "wo wo un un", "finished beats working for a spare segment");
assert.equal(barSlots([]).length, 0);
const svg = hubsIconSvg([{ icon: "pc", states: n({ working: 2, waiting: 1 }) }, { icon: "pc", states: [] }]);
assert.equal((svg.match(/fill="#ffd43b"/g) ?? []).length, 2, "two working sessions draw two yellow segments");
console.log("icons ok");
