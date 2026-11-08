// Plan3 finish: offer the plan's settled terms and ADR candidates for GLOSSARY.md and docs/adr/ (proposal 2026-11-08 §5).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ADR = /^- \*\*(D-\d+) ([^*]+?)\.?\*\* (.+?) ?\(ADR candidate\)/;
const TERM = /^- \*\*([^*]+?)\*\*:\s*(.+?)(?:\s*Avoid:\s*(.+?))?\s*$/;
export const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const body = (text, name) => {
	const lines = text.split(/\r?\n/), start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${name}`.toLowerCase());
	if (start < 0) return [];
	const end = lines.findIndex((line, i) => i > start && /^## /.test(line));
	return lines.slice(start + 1, end < 0 ? undefined : end);
};
// GLOSSARY.md entries: "**Term**:" (definition inline or on the following lines, optional _Avoid_ line) up to a blank line.
function glossaryEntries(lines) {
	const entries = new Map();
	lines.forEach((line, start) => {
		const head = line.match(/^\*\*([^*]+?)\*\*:\s*(.*)$/);
		if (!head) return;
		let end = start + 1;
		while (end < lines.length && lines[end].trim() && !/^(\*\*|## )/.test(lines[end])) end++;
		const definition = [head[2], ...lines.slice(start + 1, end).filter((rest) => !/^_Avoid_:/.test(rest))].join(" ").replace(/\s+/g, " ").trim();
		entries.set(head[1].trim().toLowerCase(), { start, end, definition });
	});
	return entries;
}
const termBlock = (term) => [`**${term.term}**:`, term.definition, ...(term.avoid ? [`_Avoid_: ${term.avoid}`] : [])];
const adrFiles = (dir) => existsSync(dir) ? readdirSync(dir).filter((name) => /^\d{4}-.*\.md$/.test(name)) : [];

// Terms missing from GLOSSARY.md (or defined differently there: old holds that definition) and ADR candidates not exported yet; other "(ADR candidate)" lines are not exportable.
export function docCandidates(cwd, planText, planId) {
	const glossary = glossaryEntries(existsSync(path.join(cwd, "GLOSSARY.md")) ? readFileSync(path.join(cwd, "GLOSSARY.md"), "utf8").split(/\r?\n/) : []);
	const terms = body(planText, "Glossary").flatMap((line) => {
		const match = line.match(TERM);
		if (!match) return [];
		const term = { term: match[1].trim(), definition: match[2].trim(), avoid: match[3]?.trim().replace(/\.$/, "") }, old = glossary.get(term.term.toLowerCase())?.definition;
		return old === undefined ? [term] : old === term.definition ? [] : [{ ...term, old }];
	});
	const dir = path.join(cwd, "docs", "adr");
	const exported = adrFiles(dir).map((name) => readFileSync(path.join(dir, name), "utf8")).join("\n");
	const adrs = [], skipped = [];
	for (const line of body(planText, "Decisions").filter((candidate) => candidate.includes("(ADR candidate)"))) {
		const match = line.match(ADR);
		if (!match || !match[2].trim() || !match[3].trim()) skipped.push(line.trim());
		else if (!exported.includes(`Source: Plan3 plan ${planId}, ${match[1]}.`)) adrs.push({ id: match[1], title: match[2].trim(), body: match[3].trim() });
	}
	return { terms, adrs, skipped };
}

// Writes only the picked items: GLOSSARY.md and docs/adr/ are created lazily; returns the written paths.
export function writeDocs(cwd, planId, candidates, picked) {
	const written = [];
	const terms = candidates.terms.filter((term) => picked.includes(`term:${term.term}`));
	if (terms.length) {
		const file = path.join(cwd, "GLOSSARY.md");
		const lines = (existsSync(file) ? readFileSync(file, "utf8") : `# ${path.basename(cwd)}\n\n## Language`).trimEnd().split(/\r?\n/);
		// Redefinitions replace their entry in place, bottom-up so earlier ranges stay valid; new terms are appended.
		const entries = glossaryEntries(lines), entry = (term) => entries.get(term.term.toLowerCase());
		for (const term of terms.filter(entry).sort((a, b) => entry(b).start - entry(a).start)) lines.splice(entry(term).start, entry(term).end - entry(term).start, ...termBlock(term));
		const added = terms.filter((term) => !entry(term));
		let at = lines.findIndex((line) => /^## Language\s*$/.test(line));
		if (at < 0) at = lines.push("", "## Language") - 1;
		let end = lines.findIndex((line, i) => i > at && /^## /.test(line));
		if (end < 0) end = lines.length;
		while (end > at + 1 && !lines[end - 1].trim()) end--;
		if (added.length) lines.splice(end, 0, ...added.flatMap((term) => ["", ...termBlock(term)]), ...(end < lines.length ? [""] : []));
		writeFileSync(file, `${lines.join("\n")}\n`);
		written.push(file);
	}
	const dir = path.join(cwd, "docs", "adr");
	for (const adr of candidates.adrs.filter((candidate) => picked.includes(`adr:${candidate.id}`))) {
		mkdirSync(dir, { recursive: true });
		const number = Math.max(0, ...adrFiles(dir).map((name) => Number(name.slice(0, 4)))) + 1;
		const file = path.join(dir, `${String(number).padStart(4, "0")}-${slug(adr.title)}.md`);
		writeFileSync(file, `# ${adr.title}\n\n${adr.body}\n\nSource: Plan3 plan ${planId}, ${adr.id}.\n`);
		written.push(file);
	}
	return written;
}
