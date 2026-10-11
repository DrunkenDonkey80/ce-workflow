// The oracle model is the first Pi-scoped model from another provider family, injected as a prompt guideline.
import assert from "node:assert/strict";
import advisor, { advisorModel } from "../extensions/advisor-model.ts";

const m = (provider, id) => ({ model: { provider, id } });
const scoped = [m("openai-codex", "gpt-6-astra"), m("anthropic", "claude-opus-5-5"), m("openai-codex", "gpt-6.1-sol")];
assert.equal(advisorModel(scoped[1].model, scoped), "openai-codex/gpt-6-astra", "Opus -> Astra");
assert.equal(advisorModel(scoped[2].model, scoped), "anthropic/claude-opus-5-5", "Sol -> Opus");
assert.equal(advisorModel({ provider: "openai", id: "gpt-x" }, scoped), "anthropic/claude-opus-5-5", "openai and openai-codex are one family");
assert.equal(advisorModel(scoped[0].model, [scoped[0], scoped[2]]), "openai-codex/gpt-6.1-sol", "one family only: another model");
assert.equal(advisorModel(scoped[0].model, [scoped[0]]), undefined);
assert.equal(advisorModel(scoped[0].model, []), undefined, "no scoping: no guideline");

let handler;
advisor({ on: (_name, fn) => { handler = fn; } });
const event = { systemPromptOptions: { promptGuidelines: ["keep"] } };
handler(event, { model: scoped[1].model, scopedModels: scoped });
assert.equal(event.systemPromptOptions.promptGuidelines[0], "keep");
assert.match(event.systemPromptOptions.promptGuidelines[1], /model "openai-codex\/gpt-6-astra:high"/);
const bare = { systemPromptOptions: {} };
handler(bare, { model: scoped[0].model, scopedModels: [] });
assert.equal(bare.systemPromptOptions.promptGuidelines, undefined);
console.log("ok - advisor model picks the other model family");
