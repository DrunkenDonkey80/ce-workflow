// latestModel picks the highest-versioned available model of a family for one provider.
import assert from "node:assert/strict";
const { latestModel } = await import("../extensions/latest-model.ts");

const ids = ["gpt-5.6-luna", "gpt-6-luna", "gpt-5.10-luna", "gpt-6-luna-mini", "gpt-6.1-sol", "gpt-6-sol"];
const registry = { getAvailable: async () => [...ids.map((id) => ({ provider: "openai-codex", id })), { provider: "other", id: "gpt-9-luna" }] };
assert.equal((await latestModel(registry, "openai-codex", "luna"))?.id, "gpt-6-luna", "6 beats 5.10 and 5.6; -mini and other providers ignored");
assert.equal((await latestModel(registry, "openai-codex", "sol"))?.id, "gpt-6.1-sol", "6.1 beats 6");
assert.equal(await latestModel(registry, "openai-codex", "terra"), undefined, "unknown family");
assert.equal(await latestModel(undefined, "openai-codex", "luna"), undefined, "no registry");
console.log("latest-model self-checks passed");
