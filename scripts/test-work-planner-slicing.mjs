#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const prompt = readFileSync(
	path.join(import.meta.dirname, "../agents/work-planner.md"),
	"utf8",
);

for (const requirement of [
	"implementation units as traceability boundaries, never as the default child shape",
	"A child may cover parts of several units",
	"do not mirror them as sequential work items",
	"smallest tracer bullet",
	"independently demonstrated or verified in one fresh context",
	"use expand-contract children",
	"acceptance owned and falsifiable",
	"fail before that child's change, pass after it",
	"assert an observable artifact or behavior",
	"reject and re-cut the proposed decomposition",
	"horizontal plan units map one-to-one to children",
	"prove an end-to-end behavior on its own",
])
	assert.ok(
		prompt.includes(requirement),
		`planner keeps slicing rule: ${requirement}`,
	);

process.stdout.write("ok - work planner slicing contract passes\n");
