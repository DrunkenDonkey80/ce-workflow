#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const skill = fs.readFileSync("skills/work-design-handoff/SKILL.md", "utf8");
const readme = fs.readFileSync("README.md", "utf8");
const credentialValue =
	/\b(?:sk|od)-[A-Za-z0-9._-]{12,}|\bBearer\s+[A-Za-z0-9._-]{8,}|[?&](?:token|key|secret)=[^\s&]+|(?:api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}/i;

for (const marker of [
	"adds no command, provider call, or orchestration loop",
	"prototype code as reference only",
	"wo:design-deviation",
	"Never include credentials, provider keys, prompts, token-bearing URLs",
])
	assert.ok(
		skill.includes(marker),
		`design handoff skill is missing: ${marker}`,
	);
assert.doesNotMatch(skill, credentialValue);

for (const marker of [
	"## Optional OpenDesign workflow",
	"Off by default",
	"/usr/bin/od",
	"may contact its configured provider and network",
	"text-only handoff",
	"Troubleshooting:",
	"fake stdio peer",
	"provider charges",
])
	assert.ok(readme.includes(marker), `README is missing: ${marker}`);

process.stdout.write("work-design package/docs tests passed\n");
