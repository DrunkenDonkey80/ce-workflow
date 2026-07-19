#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");

function run(root, input, output) {
	return spawnSync(process.execPath, [path.join(root, "src", "analyze.mjs"), input, output], { cwd: root, encoding: "utf8", timeout: 10_000 });
}

function gate(name, passed, detail = "") { return { name, passed, detail }; }
function normalizedText(file) { return readFileSync(file, "utf8").replace(/\r\n/g, "\n"); }

export function verifyCsvProject(root) {
	const temp = mkdtempSync(path.join(os.tmpdir(), "ce-csv-acceptance-"));
	const gates = [];
	try {
		const output = path.join(temp, "report.txt");
		const valid = run(root, path.join(fixtures, "valid.csv"), output);
		const expected = normalizedText(path.join(fixtures, "expected-report.txt"));
		gates.push(gate("valid-report", valid.status === 0 && existsSync(output) && normalizedText(output) === expected, valid.stderr));

		const malformedOutput = path.join(temp, "malformed-report.txt");
		const malformed = run(root, path.join(fixtures, "malformed.csv"), malformedOutput);
		gates.push(gate("malformed-atomic", malformed.status === 2 && !existsSync(malformedOutput) && /row|date|malformed|invalid/i.test(malformed.stderr), malformed.stderr));

		for (const [name, text] of [["empty", ""], ["header-only", "date,category,amount\n"]]) {
			const input = path.join(temp, `${name}.csv`);
			const target = path.join(temp, `${name}.txt`);
			writeFileSync(input, text);
			const result = run(root, input, target);
			gates.push(gate(name, result.status === 0 && readFileSync(target, "utf8") === "Total: 0.00\nRows: 0\n", result.stderr));
		}

		for (const [name, text] of [
			["unsupported-header", "date,category,amount,note\n"],
			["invalid-amount", "date,category,amount\n2026-01-01,Food,-1\n"],
		]) {
			const input = path.join(temp, `${name}.csv`);
			const target = path.join(temp, `${name}.txt`);
			writeFileSync(input, text);
			const result = run(root, input, target);
			gates.push(gate(name, result.status === 2 && !existsSync(target), result.stderr));
		}

		const missing = run(root, path.join(temp, "missing.csv"), path.join(temp, "missing.txt"));
		gates.push(gate("missing-input", missing.status === 1, missing.stderr));
		const unwritable = run(root, path.join(fixtures, "valid.csv"), temp);
		gates.push(gate("output-error", unwritable.status === 1 && existsSync(temp), unwritable.stderr));
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
	return { project: "csv-expenses", passed: gates.every((item) => item.passed), gates };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const root = path.resolve(process.argv[2] ?? ".");
	const result = verifyCsvProject(root);
	console.log(JSON.stringify(result));
	process.exitCode = result.passed ? 0 : 1;
}
