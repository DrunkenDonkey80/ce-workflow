// Argument completions of slash commands get a "/" prefix (Pi's editor then fills and runs on Enter);
// applyCompletion still receives the real prefix. Other completions pass through unchanged.
import assert from "node:assert/strict";
import { enterRunsProvider } from "../extensions/enter-runs.ts";

let next, applied;
const base = {
	triggerCharacters: ["@"],
	getSuggestions: async () => next,
	applyCompletion: (lines, _line, col, item, prefix) => { applied = prefix; return { lines: [`${lines[0].slice(0, col - prefix.length)}${item.value} `], cursorLine: 0, cursorCol: 0 }; },
};
const provider = enterRunsProvider(base);
const suggest = async (text, result) => { next = result; return provider.getSuggestions([text], 0, text.length, {}); };

const argument = await suggest("/wo sett", { prefix: "sett", items: [{ value: "settings" }, { value: "setup" }] });
assert.equal(argument.prefix, "/sett", "argument completion looks like a command-name completion to the editor");
assert.deepEqual(provider.applyCompletion(["/wo sett"], 0, 8, argument.items[0], argument.prefix).lines, ["/wo settings "]);
assert.equal(applied, "sett", "the base provider gets the real prefix");
assert.equal((await suggest("/sett", { prefix: "/sett", items: [{ value: "settings" }] })).prefix, "/sett", "command names pass through");
assert.equal((await suggest("/plan3 convert @do", { prefix: "@do", items: [{ value: "@docs/a.md" }] })).prefix, "@do", "file references keep filling");
assert.equal((await suggest("/x sr", { prefix: "sr", items: [{ value: "src/" }] })).prefix, "sr", "directories keep filling");
assert.equal((await suggest("hello wor", { prefix: "wor", items: [{ value: "world" }] })).prefix, "wor", "chat text passes through");
assert.equal(await suggest("/wo zz", null), null);
assert.deepEqual(provider.triggerCharacters, ["@"]);
console.log("ok - enter runs slash-command argument completions");
