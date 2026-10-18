import assert from "node:assert/strict";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const configFile = path.join(root, "tsconfig.json");
const config = ts.readConfigFile(configFile, ts.sys.readFile);
assert.equal(config.error, undefined, "TypeScript configuration must load");
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
// Check authored workspace sources; unrelated legacy modules and immutable vendor code are not this gate.
const sources = new Set([
 "ask-user/index.ts", "ask-user/menu.ts", "ask-user/remote.ts", "ask-user/single-select-layout.ts",
 "plan3.ts", "plan3-ask.ts", "plan3-catch-up.ts", "plan3-design.ts", "plan3-diagram.ts", "plan3-remote.ts", "plan3-files.ts", "plan3-web.ts",
 "plan3-web/app.ts", "plan3-web/diagram.ts", "plan3-web/layout.ts", "plan3-web/prompts.ts", "plan3-web/files.ts", "plan3-web/stream.ts", "plan3-web/pair.ts",
 "work-ask-remote.ts", "hub-channel.ts",
].map(file => path.resolve(root, "extensions", file)));
for (const file of sources) assert(program.getSourceFile(file), `Source missing from TypeScript program: ${file}`);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].filter(diagnostic =>
 !diagnostic.file || sources.has(path.resolve(diagnostic.file.fileName)));
assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
 getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => "\n",
}));
console.log(`Plan3 TypeScript self-check passed (${sources.size} authored sources; legacy debt excluded)`);
