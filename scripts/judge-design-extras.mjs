#!/usr/bin/env node
// Blind judge for the landing/pricing design scenarios of benchmark-self-verify-live.mjs (plan f01355e6 X13-X14).
// node scripts/judge-design-extras.mjs <runA/results.json> <runB/results.json> [--model ID] [--output DIR]
// Copies every page under a random name, asks the judge model (no tools, no arm info) which checklist items each page has,
// then prints per run the pages with every must-have (pages are the unit of the interval), extras as descriptive
// item counts, judge errors apart, and line counts. key.json maps names back to runs.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { judgeWithRetry, parseArray, rate, runChild } from "./judge-common.mjs";

const args = process.argv.slice(2);
const value = (flag, fallback) => { const i = args.indexOf(flag); return i < 0 ? fallback : args[i + 1]; };
const runs = args.filter((a, i) => a.endsWith(".json") && !args[i - 1]?.startsWith("--"));
const model = value("--model", "anthropic/claude-opus-5-5");
const launcher = path.join(os.homedir(), ".pi", "agent", "bin", "pi-launcher.js");
const providerExtension = path.join(os.homedir(), ".pi", "agent", "git", "github.com", "DrunkenDonkey80", "pi-provider-claude-ex", "index.ts");
const provider = model.startsWith("anthropic/") && existsSync(providerExtension) ? ["--extension", providerExtension] : [];

// Must-haves are what the prompt states; extras are what such a page usually has without being asked.
export const CHECKLISTS = {
	landing: {
		file: "index.html",
		must: ["hero with the product name and a one-line value proposition", "a primary call to action", "explains what the product does"],
		extras: ["navigation bar", "features section with at least 3 items", "how-it-works steps", "social proof (testimonials, logos or numbers)",
			"pricing or plan teaser", "FAQ", "closing call-to-action section", "footer with links", "hover or focus styles",
			"responsive layout (viewport meta plus media queries or fluid grid)", "product visual (mockup, illustration or screenshot)", "signup form or app-store buttons"],
	},
	pricing: {
		file: "pricing.html",
		must: ["Free, Family and Pro plans with prices", "a feature list per plan", "a call to action per plan"],
		extras: ["recommended plan visually highlighted", "monthly/annual billing toggle", "feature comparison table", "FAQ", "navigation or header",
			"footer", "hover or focus styles", "responsive layout (viewport meta plus media queries or fluid grid)",
			"trust note (no card needed, cancel anytime or guarantee)", "contact sales, enterprise or custom option", "billing unit made clear (per month, per family)"],
	},
};

// One judge call per page, with a deadline and one retry; the reply must be a boolean per checklist item.
function judge(file, list) {
	const n = list.must.length + list.extras.length;
	const items = [...list.must, ...list.extras].map((item, i) => `${i + 1}. ${item}`).join("\n");
	const prompt = `The attached file is one web page's source. For each item below, answer whether the page clearly has it (judge from the code: markup, CSS, script). Reply with only a JSON array of ${n} booleans in item order.\n\n${items}`;
	return judgeWithRetry(() => runChild(process.execPath, [launcher, "-p", "--model", model, "--thinking", "low", "--no-extensions", ...provider, "--no-tools", "--no-skills",
		"--no-context-files", "--no-prompt-templates", "--no-session", `@${file}`, prompt], { cwd: path.dirname(file) }), (reply) => parseArray(reply, n, (v) => typeof v === "boolean"));
}

// Four pages at a time; a page whose judge still fails after the retry gets judgeError and the rest keep scoring.
export async function scorePages(pages, judgePage) {
	const queue = [...pages].sort(() => Math.random() - 0.5);
	await Promise.all(Array.from({ length: 4 }, async () => {
		for (let page; (page = queue.shift());) {
			const list = CHECKLISTS[page.scenario];
			const verdict = await judgePage(page, list);
			if (verdict.error) { page.judgeError = verdict.error; console.log(page.name, "judge error:", verdict.error); continue; }
			page.must = verdict.value.slice(0, list.must.length);
			page.extras = verdict.value.slice(list.must.length);
			console.log(page.name, JSON.stringify({ must: page.must.filter(Boolean).length, extras: page.extras.filter(Boolean).length }));
		}
	}));
}

// Pages are the unit: the interval is over pages with every must-have; extras stay a descriptive item count.
export function summarize(rows) {
	const scored = rows.filter((r) => !r.judgeError), errors = rows.length - scored.length;
	const extras = scored.flatMap((r) => r.extras);
	return `must-haves all met on ${rate(scored.filter((r) => r.must.every(Boolean)).length, scored.length, "pages")}, extras ${extras.filter(Boolean).length}/${extras.length} items `
		+ `(per page ${scored.map((r) => r.extras.filter(Boolean).length).join("/") || "-"})${errors ? `, judge error on ${errors} page(s) (unscored)` : ""}, lines ${rows.map((r) => r.lines).join("/")}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
if (runs.length < 1) throw new Error("usage: judge-design-extras.mjs <results.json>... [--model ID] [--output DIR]");
const out = path.resolve(value("--output", path.join(path.dirname(runs[0]), "..", "..", "design-judge")));
mkdirSync(out, { recursive: true });
const pages = runs.flatMap((run) => JSON.parse(readFileSync(run, "utf8")).results.filter((r) => CHECKLISTS[r.scenario] && r.dir)
	.map((r) => ({ run, scenario: r.scenario, repetition: r.repetition, source: path.join(r.dir, CHECKLISTS[r.scenario].file) }))
	.filter((p) => existsSync(p.source)));
for (const page of pages) {
	page.name = `page-${randomBytes(4).toString("hex")}.html`;
	copyFileSync(page.source, path.join(out, page.name));
	page.lines = readFileSync(page.source, "utf8").split("\n").length;
}
writeFileSync(path.join(out, "key.json"), JSON.stringify(pages, null, 2));
await scorePages(pages, (page, list) => judge(path.join(out, page.name), list));
writeFileSync(path.join(out, "verdicts.json"), JSON.stringify(pages, null, 2));
for (const run of runs) for (const scenario of Object.keys(CHECKLISTS)) {
	const rows = pages.filter((p) => p.run === run && p.scenario === scenario);
	if (rows.length) console.log(`${run} ${scenario}: ${summarize(rows)}`);
}
console.log(`verdicts: ${path.join(out, "verdicts.json")}`);
}
