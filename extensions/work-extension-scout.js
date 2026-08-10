import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { dirname, join } from "node:path";
import { normalizeSourcePath, readConfinedFile } from "./work-compound-source.js";

export const EXTENSION_SCOUT_LEDGER = ".pi/work-extension-scout.json";
const DAY_MS = 24 * 60 * 60 * 1000;
const FACT_LIMIT = 32 * 1024;
const SOURCE_LIMIT = 256 * 1024;
const FILE_LIMIT = 64 * 1024;
const FACT_CATEGORIES = ["capability", "quality", "maintenance", "dependency", "security", "overlap", "installVersusBorrow"];
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

export function parseExtensionInspectionFacts(value) {
	const raw = typeof value === "string" ? value : JSON.stringify(value);
	if (Buffer.byteLength(raw, "utf8") > FACT_LIMIT) throw new Error("inspection facts exceed 32 KiB");
	let parsed;
	try { parsed = typeof value === "string" ? JSON.parse(value) : value; }
	catch (error) { throw new Error(`inspection facts are malformed: ${error.message}`); }
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).some((key) => !FACT_CATEGORIES.includes(key)))
		throw new Error("inspection facts have an invalid shape");
	const facts = {};
	for (const category of FACT_CATEGORIES) {
		if (!Array.isArray(parsed[category]) || parsed[category].length > 20)
			throw new Error(`inspection facts require a bounded ${category} array`);
		facts[category] = parsed[category].map((fact) => {
			if (!fact || typeof fact !== "object" || Array.isArray(fact) || typeof fact.claim !== "string" || typeof fact.evidence !== "string")
				throw new Error(`inspection ${category} facts require claim and evidence strings`);
			const claim = text(fact.claim);
			const evidence = text(fact.evidence);
			if (!claim || !evidence || claim.length > 500 || evidence.length > 500)
				throw new Error(`inspection ${category} fact is empty or over limit`);
			return { claim, evidence };
		});
	}
	return facts;
}

function cloneEnvironment(home) {
	const env = { HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" };
	for (const key of ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "TMP", "TEMP"]) if (process.env[key]) env[key] = process.env[key];
	return env;
}

function defaultClone(repositoryUrl, destination, home) {
	execFileSync("git", ["-c", "submodule.recurse=false", "clone", "--quiet", "--depth", "1", "--no-recurse-submodules", "--", repositoryUrl, destination], {
		env: cloneEnvironment(home), stdio: ["ignore", "ignore", "pipe"], timeout: 180_000,
	});
}

function defaultGit(root, args) {
	return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
}

function inspectionFiles(root, git = defaultGit) {
	const records = git(root, ["ls-files", "-s", "-z"]).split("\0").filter(Boolean);
	if (!records.length || records.length > 2_000) throw new Error("tracked source file count is empty or over limit");
	const allowed = new Set();
	for (const record of records) {
		const tab = record.indexOf("\t");
		if (tab < 0) throw new Error("malformed tracked source entry");
		const [mode, , stage] = record.slice(0, tab).split(" ");
		const relative = normalizeSourcePath(record.slice(tab + 1));
		if (stage !== "0" || mode === "120000") throw new Error(`source symlink or unmerged entry rejected: ${relative}`);
		if (!['100644', '100755'].includes(mode)) throw new Error(`unsupported source entry mode ${mode}: ${relative}`);
		allowed.add(relative);
	}
	const selected = [...allowed].filter((name) => /^(?:package\.json|readme(?:\.[^/]*)?|licen[cs]e(?:\.[^/]*)?|extensions\/[^/]+\.(?:js|mjs|cjs|ts)|src\/[^/]+\.(?:js|mjs|cjs|ts))$/i.test(name)).sort();
	let total = 0;
	return selected.map((name) => {
		const stat = lstatSync(path.join(root, ...name.split("/")));
		if (stat.size > FILE_LIMIT) throw new Error(`inspection file exceeds 64 KiB: ${name}`);
		const bytes = readConfinedFile(root, name, allowed);
		total += bytes.length;
		if (total > SOURCE_LIMIT) throw new Error("inspection source exceeds 256 KiB");
		return { path: name, content: bytes.toString("utf8") };
	});
}

export async function inspectQueuedExtensions(cwd, options = {}) {
	if (typeof options.inspect !== "function") throw new Error("extension source inspector is required");
	const initial = readExtensionScoutLedger(cwd);
	const candidates = initial.currentRun.slice(0, 10);
	const results = [];
	for (const candidate of candidates) {
		const quarantine = mkdtempSync(path.join(options.tempRoot ?? tmpdir(), "extension-source-"));
		const source = path.join(quarantine, "source");
		let outcome;
		try {
			let repository;
			try { repository = new URL(candidate.repositoryUrl); } catch {}
			if (!repository || !["http:", "https:"].includes(repository.protocol) || !["github.com", "gitlab.com", "codeberg.org"].includes(repository.hostname.toLowerCase()))
				throw new Error("repository URL is not an allowed HTTP(S) forge URL");
			await (options.clone ?? defaultClone)(candidate.repositoryUrl, source, quarantine);
			const revision = (await (options.git ?? defaultGit)(source, ["rev-parse", "HEAD"])).trim();
			if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error("cloned source revision is invalid");
			const files = inspectionFiles(source, options.git ?? defaultGit);
			const facts = parseExtensionInspectionFacts(await options.inspect({ name: candidate.name, revision, files }));
			outcome = { ok: true, revision, facts };
		} catch (error) {
			outcome = { ok: false, error: text(error.message).slice(0, 500) };
		}
		try { await (options.cleanup ?? ((root) => rmSync(root, { recursive: true, force: true })))(quarantine); }
		catch (error) { outcome = { ok: false, error: `cleanup: ${text(error.message).slice(0, 480)}` }; }
		const ledger = readExtensionScoutLedger(cwd);
		const packages = { ...ledger.packages, [candidate.name]: { ...ledger.packages[candidate.name], inspection: { ...outcome, attemptedAt: new Date(options.now ?? Date.now()).toISOString() } } };
		const queue = outcome.ok ? ledger.queue.filter((item) => item.name !== candidate.name) : ledger.queue;
		const currentRun = outcome.ok ? ledger.currentRun.filter((item) => item.name !== candidate.name) : ledger.currentRun;
		writeExtensionScoutLedger(cwd, { ...ledger, packages, queue, currentRun, lastError: outcome.ok ? null : `inspection ${candidate.name}: ${outcome.error}` });
		results.push({ name: candidate.name, ...outcome });
	}
	return { inspected: results, ledger: readExtensionScoutLedger(cwd) };
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
