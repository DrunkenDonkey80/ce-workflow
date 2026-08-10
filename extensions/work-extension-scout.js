import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const EXTENSION_SCOUT_LEDGER = ".pi/work-extension-scout.json";
const DAY_MS = 24 * 60 * 60 * 1000;
const text = (value = "") => String(value).replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const attr = (html, name) => html.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1];

export function parseRecentExtensions(html) {
	if (typeof html !== "string" || !html.trim()) throw new Error("pi.dev catalog returned empty HTML");
	const blocks = html.match(/<(?:article|li)\b[\s\S]*?<\/(?:article|li)>/gi) ?? [];
	const packages = blocks.flatMap((block) => {
		const npmUrl = block.match(/href=["'](https:\/\/www\.npmjs\.com\/package\/[^"']+)["']/i)?.[1];
		if (!npmUrl) return [];
		const repositoryUrl = block.match(/href=["'](https?:\/\/(?:github|gitlab|codeberg)\.[^"']+)["']/i)?.[1];
		const time = block.match(/<time\b([^>]*)>([\s\S]*?)<\/time>/i);
		const timestamp = attr(time?.[1], "datetime") || text(time?.[2]);
		const name = decodeURIComponent(npmUrl.split("/package/")[1].replace(/\/$/, ""));
		const description = attr(block, "data-description") ?? text(block.match(/<(?:p|div)\b[^>]*class=["'][^"']*description[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|div)>/i)?.[1]);
		if (!name || !description || !timestamp || !repositoryUrl || Number.isNaN(Date.parse(timestamp)))
			throw new Error(`pi.dev catalog entry is incomplete for ${name || npmUrl}`);
		return [{ name, description, timestamp: new Date(timestamp).toISOString(), npmUrl, repositoryUrl }];
	});
	if (!packages.length) throw new Error("pi.dev catalog parser found no extensions");
	return packages;
}

export function readExtensionScoutLedger(cwd) {
	try {
		const parsed = JSON.parse(readFileSync(join(cwd, EXTENSION_SCOUT_LEDGER), "utf8"));
		return { version: 1, cursor: null, packages: {}, queue: [], currentRun: [], ...parsed };
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
		return { version: 1, cursor: null, packages: {}, queue: [], currentRun: [] };
	}
}

export function writeExtensionScoutLedger(cwd, ledger) {
	const file = join(cwd, EXTENSION_SCOUT_LEDGER);
	mkdirSync(dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		renameSync(temporary, file);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function mergeQueue(previous, additions) {
	const byName = new Map([...previous, ...additions].map((item) => [item.name, item]));
	return [...byName.values()].sort((a, b) => b.score - a.score || b.timestamp.localeCompare(a.timestamp) || a.name.localeCompare(b.name));
}

export async function runExtensionScout(cwd, options = {}) {
	const now = new Date(options.now ?? Date.now());
	const ledger = readExtensionScoutLedger(cwd);
	const since = ledger.cursor ?? new Date(now.getTime() - 30 * DAY_MS).toISOString();
	let discovered;
	try {
		const pages = await options.collect({ since });
		discovered = (Array.isArray(pages) ? pages : [pages]).flatMap(parseRecentExtensions).filter((item) => Date.parse(item.timestamp) >= Date.parse(since));
	} catch (error) {
		throw new Error(`Extension catalog failed; cursor unchanged at ${ledger.cursor ?? "initial"}: ${error.message}`);
	}
	const packages = { ...ledger.packages };
	for (const item of discovered) packages[item.name] = { ...packages[item.name], ...item, seenAt: now.toISOString() };
	let screened;
	try {
		screened = await options.screen(discovered.map(({ name, description, timestamp }) => ({ name, description, timestamp })));
		if (!Array.isArray(screened)) throw new Error("screen result must be an array");
	} catch (error) {
		writeExtensionScoutLedger(cwd, { ...ledger, packages, lastError: `model: ${error.message}` });
		throw new Error(`Extension screening failed; cursor unchanged at ${ledger.cursor ?? "initial"}: ${error.message}`);
	}
	const known = new Map(discovered.map((item) => [item.name, item]));
	const additions = screened.flatMap((decision) => {
		const item = known.get(decision.name);
		return item && decision.plausible === true && Number.isFinite(Number(decision.score))
			? [{ ...item, score: Number(decision.score), rationale: text(decision.rationale).slice(0, 300) }]
			: [];
	});
	const queue = mergeQueue(ledger.queue, additions);
	const next = { version: 1, cursor: now.toISOString(), packages, queue, currentRun: queue.slice(0, 10), lastError: null };
	writeExtensionScoutLedger(cwd, next);
	return { since, discovered: discovered.length, selected: next.currentRun, overflow: queue.slice(10), ledger: next };
}
