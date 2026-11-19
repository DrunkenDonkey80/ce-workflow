#!/usr/bin/env node
// Blind judge for the landing/pricing design scenarios of benchmark-self-verify-live.mjs (plan f01355e6 X13-X14).
// node scripts/judge-design-extras.mjs <runA/results.json> <runB/results.json> [--model ID] [--output DIR]
// Copies every page under a random name, asks the judge model (no tools, no arm info) which checklist items each page has,
// then prints must-have and extras rates and line counts per run. key.json maps names back to runs.
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const value = (flag, fallback) => { const i = args.indexOf(flag); return i < 0 ? fallback : args[i + 1]; };
const runs = args.filter((a, i) => a.endsWith(".json") && !args[i - 1]?.startsWith("--"));
if (runs.length < 1) throw new Error("usage: judge-design-extras.mjs <results.json>... [--model ID] [--output DIR]");
const model = value("--model", "anthropic/claude-opus-5-5");
const out = path.resolve(value("--output", path.join(path.dirname(runs[0]), "..", "..", "design-judge")));
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

function judge(file, list) {
	const items = [...list.must, ...list.extras].map((item, i) => `${i + 1}. ${item}`).join("\n");
	const prompt = `The attached file is one web page's source. For each item below, answer whether the page clearly has it (judge from the code: markup, CSS, script). Reply with only a JSON array of ${list.must.length + list.extras.length} booleans in item order.\n\n${items}`;
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [launcher, "-p", "--model", model, "--thinking", "low", "--no-extensions", ...provider, "--no-tools", "--no-skills",
			"--no-context-files", "--no-prompt-templates", "--no-session", `@${file}`, prompt], { cwd: path.dirname(file), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
		let text = "";
		child.stdout.on("data", (c) => { text += c; });
		child.stderr.on("data", () => {});
		child.on("exit", () => {
			const verdict = text.match(/\[[\s\S]*?\]/)?.[0];
			try { const parsed = JSON.parse(verdict); if (parsed.length === list.must.length + list.extras.length) return resolve(parsed); } catch {}
			reject(new Error(`unparsable verdict for ${file}: ${text.slice(0, 300)}`));
		});
	});
}

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
const queue = [...pages].sort(() => Math.random() - 0.5);
await Promise.all(Array.from({ length: 4 }, async () => {
	for (let page; (page = queue.shift());) {
		const list = CHECKLISTS[page.scenario];
		const verdict = await judge(path.join(out, page.name), list);
		page.must = verdict.slice(0, list.must.length);
		page.extras = verdict.slice(list.must.length);
		console.log(page.name, JSON.stringify({ must: page.must.filter(Boolean).length, extras: page.extras.filter(Boolean).length }));
	}
}));
writeFileSync(path.join(out, "verdicts.json"), JSON.stringify(pages, null, 2));
const rate = (rows, key) => { const all = rows.flatMap((r) => r[key]); return `${all.filter(Boolean).length}/${all.length} (${Math.round(100 * all.filter(Boolean).length / all.length)}%)`; };
for (const run of runs) for (const scenario of Object.keys(CHECKLISTS)) {
	const rows = pages.filter((p) => p.run === run && p.scenario === scenario);
	if (rows.length) console.log(`${run} ${scenario}: must ${rate(rows, "must")}, extras ${rate(rows, "extras")}, lines ${rows.map((r) => r.lines).join("/")}`);
}
console.log(`verdicts: ${path.join(out, "verdicts.json")}`);
