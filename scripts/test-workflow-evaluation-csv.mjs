#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCsvProject } from "../benchmarks/workflow-evaluation/v1/projects/csv-expenses/acceptance/verify.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const project = path.join(root, "benchmarks", "workflow-evaluation", "v1", "projects", "csv-expenses");
const temp = mkdtempSync(path.join(os.tmpdir(), "ce-csv-fixture-"));
const good = String.raw`#!/usr/bin/env node
import { readFileSync, writeFileSync, rmSync } from "node:fs";
const [input, output] = process.argv.slice(2);
try {
  rmSync(output, { force: true });
  const text = readFileSync(input, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line, index, all) => line.length || index < all.length - 1);
  if (lines.length && lines.shift() !== "date,category,amount") throw Object.assign(new Error("invalid header"), { code: 2 });
  const groups = new Map(); let total = 0; let rows = 0;
  for (const [index, line] of lines.entries()) {
    if (!line) continue;
    const cells = line.split(",");
    const category = cells[1]?.trim();
    const amountText = cells[2];
    if (cells.length !== 3 || !/^\d{4}-\d{2}-\d{2}$/.test(cells[0]) || !category || !/^\d+(?:\.\d{1,2})?$/.test(amountText)) throw Object.assign(new Error("invalid row " + (index + 2)), { code: 2 });
    const date = new Date(cells[0] + "T00:00:00Z");
    if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== cells[0]) throw Object.assign(new Error("invalid date row " + (index + 2)), { code: 2 });
    const amount = Number(amountText); const key = category.toLowerCase(); const current = groups.get(key) ?? { label: category, amount: 0 };
    current.amount += amount; groups.set(key, current); total += amount; rows += 1;
  }
  const linesOut = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })).map((item) => item.label + ": " + item.amount.toFixed(2));
  linesOut.push("Total: " + total.toFixed(2), "Rows: " + rows);
  writeFileSync(output, linesOut.join("\n") + "\n");
} catch (error) { console.error(error.message); process.exitCode = error.code === 2 ? 2 : 1; }
`;

try {
	const seed = path.join(project, "seed");
	const goodRoot = path.join(temp, "good");
	cpSync(seed, goodRoot, { recursive: true });
	writeFileSync(path.join(goodRoot, "src", "analyze.mjs"), good);
	const before = createHash("sha256").update(readFileSync(path.join(project, "product-contract.md"))).digest("hex");
	assert.equal(verifyCsvProject(goodRoot).passed, true, "known-good implementation passes hidden acceptance");
	const after = createHash("sha256").update(readFileSync(path.join(project, "product-contract.md"))).digest("hex");
	assert.equal(after, before, "acceptance does not mutate hidden authority");

	const brokenRoot = path.join(temp, "broken");
	cpSync(goodRoot, brokenRoot, { recursive: true });
	writeFileSync(path.join(brokenRoot, "src", "analyze.mjs"), good.replace("current.amount += amount", "current.amount = amount"));
	assert.equal(verifyCsvProject(brokenRoot).passed, false, "aggregation defect fails acceptance");

	const plan = readFileSync(path.join(project, "goldens", "plan.md"), "utf8");
	assert.match(plan, /Slice 1[\s\S]*Slice 2/);
	const approval = JSON.parse(readFileSync(path.join(project, "goldens", "approval.json"), "utf8"));
	const sha = (name) =>
		createHash("sha256")
			.update(readFileSync(path.join(project, "goldens", name), "utf8").replace(/\r\n/g, "\n"))
			.digest("hex");
	assert.equal(approval.brainstormSha, sha("brainstorm.md"));
	assert.equal(approval.planSha, sha("plan.md"));
	process.stdout.write("ok - CSV workflow evaluation project fixtures\n");
} finally {
	rmSync(temp, { recursive: true, force: true });
}
