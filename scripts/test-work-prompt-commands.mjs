import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let pkg;
try {
	pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
} catch (error) {
	throw new Error("Unable to read package manifest", { cause: error });
}
const names = ["idea", "simple", "complicated"];
assert.deepEqual(pkg.pi.prompts, names.map((name) => `./prompts/${name}.md`));
assert.ok(pkg.files.includes("prompts/"), "npm package must carry prompt templates");
for (const name of names) {
	const text = readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), "utf8");
	assert.match(text, /^---\r?\n[\s\S]*?description: .+\r?\n[\s\S]*?---\r?\n/);
	assert.match(text, /\$@/, `${name} must forward the full user request`);
	assert.match(text, /\/wo/, `${name} must not silently run Orchestrator`);
}
assert.match(readFileSync(new URL("../prompts/idea.md", import.meta.url), "utf8"), /do not write a plan or implement/i);
assert.match(readFileSync(new URL("../prompts/simple.md", import.meta.url), "utf8"), /this invocation authorizes implementation/i);
assert.match(readFileSync(new URL("../prompts/complicated.md", import.meta.url), "utf8"), /No source edits before the user approves/i);
console.log("Portable /idea, /simple, /complicated package templates verified");
