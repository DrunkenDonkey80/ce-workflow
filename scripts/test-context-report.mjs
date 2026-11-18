#!/usr/bin/env node
// Self-check of the context report's owner split and ideas over a small fixture request.
import assert from "node:assert/strict";
import path from "node:path";
import { analyze, formatReport, OURS } from "./context-report.mjs";

const repoDir = path.resolve("fixture-repo");
const ours = { source: "../fixture-repo", baseDir: repoDir };
const lens = { source: "npm:pi-lens", baseDir: path.resolve("node_modules/pi-lens") };
const big = "x".repeat(2100);
const system = [
	"You are an agent.",
	"<tools>\n- read: Read files\n- rare_tool: Rare\n- lens_tool: Lens\n</tools>",
	"<rules>\n- Use rare_tool for rare things.\n- Keep it short.\n</rules>",
	`<project_context>\n<project_instructions path="${path.join(repoDir, "AGENTS.md")}">\n${big}\n</project_instructions>\n<project_instructions path="${path.resolve("elsewhere/CLAUDE.md")}">\n${big}\n</project_instructions>\n</project_context>`,
	`<skills>\n<skill>\n<name>our-skill</name>\n<location>${path.join(repoDir, "skills/a/SKILL.md")}</location>\n</skill>\n<skill>\n<name>ext-skill</name>\n<location>${path.resolve("node_modules/@x/ext/skills/ext/SKILL.md")}</location>\n</skill>\n</skills>`,
	`<locked-writes>\n${big}\n</locked-writes>`,
	`<ext>\n${big}\n</ext>`,
].join("\n\n");
const tools = [{ name: "read" }, { name: "rare_tool", description: big }, { name: "lens_tool", description: "rarely used" }, { name: "tools_enable" }, { name: "used_tool" }];
const all = [
	{ name: "read", source: { source: "builtin" } },
	{ name: "rare_tool", source: ours, promptGuidelines: ["Use rare_tool for rare things."] },
	{ name: "lens_tool", source: lens },
	{ name: "tools_enable", source: ours },
	{ name: "used_tool", source: ours },
];
const r = analyze({ system, tools, all }, { repoDir, sectionOwners: { "locked-writes": OURS }, rates: { rare_tool: 0.2, lens_tool: 0, tools_enable: 0, used_tool: 9 }, turns: 5000 });
const owner = (name) => r.parts.find((p) => p.name === name)?.owner;
assert.equal(owner(path.join(repoDir, "AGENTS.md")), OURS);
assert.notEqual(owner(path.resolve("elsewhere/CLAUDE.md")), OURS);
assert.equal(owner("our-skill"), OURS);
assert.equal(owner("ext-skill"), "npm:@x/ext");
assert.equal(owner("<locked-writes>"), OURS);
assert.equal(owner("<ext>"), "another extension");
assert.equal(owner("lens_tool"), "npm:pi-lens");
assert.equal(r.parts.filter((p) => p.kind === "tool prompt text" && p.name === "rare_tool").length, 2, "its tool-list line and its rule both count toward the tool");

const ideas = r.ideas.join("\n");
assert.match(ideas, /`rare_tool` is called 0\.2 times/, "a near-unused tool of ours is offered for tools_enable");
assert.doesNotMatch(ideas, /lens_tool|CLAUDE|<ext>/, "other owners are listed, not judged");
assert.doesNotMatch(ideas, /tools_enable`|used_tool/, "loaders and used tools stay");
assert.match(ideas, /AGENTS\.md/);
assert.match(ideas, /<locked-writes>/);

// Without enough history the rates are not used to suggest deferring.
assert.doesNotMatch(analyze({ system, tools, all }, { repoDir, rates: {}, turns: 10 }).ideas.join("\n"), /times per 1,000/);

const text = formatReport(r, "C:/x");
assert.match(text, /## By owner/);
assert.match(text, /\| rare_tool \| ce-workflow \(ours\) \|/);
console.log("context-report: ok");
