#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	recordKnowledge,
	searchKnowledge,
} from "../extensions/work-knowledge.js";

let fixture;
try {
	fixture = JSON.parse(
		readFileSync(
			path.join(
				import.meta.dirname,
				"../benchmarks/session-knowledge/v1/retrieval-cases.json",
			),
			"utf8",
		),
	);
} catch (error) {
	throw new Error("The session-knowledge retrieval fixture is invalid.", {
		cause: error,
	});
}
const root = mkdtempSync(path.join(tmpdir(), "ce-knowledge-retrieval-"));
const userPath = path.join(root, "user.jsonl");
const projects = new Map();
const optionsFor = (project) => {
	if (!projects.has(project)) {
		const cwd = path.join(root, project);
		mkdirSync(cwd, { recursive: true });
		projects.set(project, {
			cwd,
			options: {
				projectPath: path.join(cwd, "knowledge.jsonl"),
				userPath,
			},
		});
	}
	return projects.get(project);
};

try {
	for (const claim of fixture.claims) {
		const { cwd, options } = optionsFor(
			claim.scope === "user" ? "workflow" : claim.project,
		);
		recordKnowledge(
			cwd,
			{
				...claim,
				scope: claim.scope ?? "project",
			},
			{ ...options, allowedAuthorities: [claim.authority] },
		);
	}

	let hits = 0;
	let needed = 0;
	let reciprocalRanks = 0;
	let positiveQueries = 0;
	let returned = 0;
	let unrelated = 0;
	const traces = [];
	for (const testCase of fixture.queries) {
		const { cwd, options } = optionsFor(testCase.project);
		const results = searchKnowledge(cwd, testCase.text, {
			...options,
			limit: 5,
		});
		const ids = results.map((record) => record.id);
		const expected = new Set(testCase.expected);
		traces.push({
			project: testCase.project,
			expected: [...expected],
			results: results.map(({ id, score }) => ({ id, score })),
		});
		needed += expected.size;
		hits += ids.filter((id) => expected.has(id)).length;
		returned += ids.length;
		unrelated += ids.filter((id) => !expected.has(id)).length;
		if (expected.size) {
			positiveQueries += 1;
			const first = ids.findIndex((id) => expected.has(id));
			if (first >= 0) reciprocalRanks += 1 / (first + 1);
		}
	}
	const recall = hits / needed;
	const mrr = reciprocalRanks / positiveQueries;
	const unrelatedRate = unrelated / Math.max(1, returned);
	assert.ok(recall >= 0.9, `held-out top-5 recall was ${recall.toFixed(3)}`);
	assert.ok(mrr >= 0.85, `held-out MRR was ${mrr.toFixed(3)}`);
	assert.ok(
		unrelatedRate <= 0.1,
		`unrelated retrieval rate was ${unrelatedRate.toFixed(3)}: ${JSON.stringify(traces)}`,
	);
	process.stdout.write(
		`knowledge held-out retrieval: recall=${recall.toFixed(3)} mrr=${mrr.toFixed(3)} unrelated=${unrelatedRate.toFixed(3)}\n`,
	);
} finally {
	rmSync(root, { recursive: true, force: true });
}
