import { execFile, execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { dirname, join } from "node:path";
import { normalizeSourcePath, readConfinedFile } from "./work-compound-source.js";

export const EXTENSION_SCOUT_LEDGER = ".pi/work-extension-scout.json";
const DAY_MS = 24 * 60 * 60 * 1000;
const SCOUT_LIMIT = 3;
const FACT_LIMIT = 32 * 1024;
const SOURCE_LIMIT = 256 * 1024;
const FILE_LIMIT = 64 * 1024;
const FACT_CATEGORIES = ["capability", "quality", "maintenance", "dependency", "security", "overlap", "installVersusBorrow"];
const REVIEW_RECOMMENDATIONS = ["proceed", "defer", "reject"];
export const EXTENSION_SCOUT_REVISIT_POLICY = Object.freeze({
	"out-of-scope": { permanent: true, days: null, updateRequired: false },
	"weak-idea": { permanent: false, days: 180, updateRequired: true },
	duplicate: { permanent: false, days: 90, updateRequired: true },
	immature: { permanent: false, days: 30, updateRequired: true },
	"bad-implementation": { permanent: false, days: 30, updateRequired: true },
	unsafe: { permanent: false, days: 180, updateRequired: true },
	"insufficient-evidence": { permanent: false, days: 30, updateRequired: false },
});
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
		const rawTimestamp = attr(block, "data-package-date") || attr(time?.[1], "datetime") || text(time?.[2]);
		const timestamp = /^\d+$/.test(rawTimestamp) ? Number(rawTimestamp) : Date.parse(rawTimestamp);
		const name = decodeURIComponent(npmUrl.split("/package/")[1].replace(/\/$/, ""));
		const description = attr(block, "data-description") ?? text(block.match(/<(?:p|div)\b[^>]*class=["'][^"']*(?:description|packages-desc)[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|div)>/i)?.[1]);
		if (!name || !description || !Number.isFinite(timestamp) || !repositoryUrl)
			throw new Error(`pi.dev catalog entry is incomplete for ${name || npmUrl}`);
		return [{ name, description, timestamp: new Date(timestamp).toISOString(), npmUrl, repositoryUrl }];
	});
	if (!packages.length) throw new Error("pi.dev catalog parser found no extensions");
	return packages;
}

export async function collectRecentExtensionPage(page = 1, fetchFn = fetch, signal) {
	if (!Number.isInteger(page) || page < 1) throw new Error("extension catalog page is invalid");
	const response = await fetchFn(`https://pi.dev/packages?type=extension&sort=recent&page=${page}`, { signal });
	if (!response.ok) throw new Error(`pi.dev returned HTTP ${response.status}`);
	const html = await response.text();
	parseRecentExtensions(html);
	const links = html.replaceAll("&amp;", "&");
	return { page, html, hasNext: new RegExp(`[?&]page=${page + 1}(?:[&"'#]|$)`).test(links) };
}

export async function collectRecentExtensionPages(since, fetchFn = fetch, options = {}) {
	if (!Number.isFinite(Date.parse(since))) throw new Error("extension catalog cursor is invalid");
	return [(await collectRecentExtensionPage(options.page ?? 1, fetchFn, options.signal)).html];
}

export function readExtensionScoutLedger(cwd) {
	try {
		const parsed = JSON.parse(readFileSync(join(cwd, EXTENSION_SCOUT_LEDGER), "utf8"));
		return { version: 1, cursor: null, packages: {}, queue: [], currentRun: [], finalists: [], ...parsed };
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
		return { version: 1, cursor: null, packages: {}, queue: [], currentRun: [], finalists: [] };
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

export function updateExtensionScoutProgress(cwd, patch) {
	const ledger = readExtensionScoutLedger(cwd);
	const progress = { ...(ledger.progress ?? {}), ...patch, updatedAt: new Date().toISOString() };
	writeExtensionScoutLedger(cwd, { ...ledger, progress });
	return progress;
}

function mergeQueue(previous, additions) {
	const byName = new Map([...previous, ...additions].map((item) => [item.name, item]));
	return [...byName.values()].sort((a, b) => b.score - a.score || b.timestamp.localeCompare(a.timestamp) || a.name.localeCompare(b.name));
}

function revisitDue(record, now) {
	const decision = record?.decision;
	if (!decision) return true;
	if (decision.status === "proceed") return false;
	const policy = EXTENSION_SCOUT_REVISIT_POLICY[decision.reason];
	return Boolean(policy && !policy.permanent && Date.parse(decision.revisitAt) <= now.getTime());
}

export function parseExtensionReview(value) {
	const raw = typeof value === "string" ? value : JSON.stringify(value);
	if (Buffer.byteLength(raw, "utf8") > FACT_LIMIT) throw new Error("extension review exceeds 32 KiB");
	let parsed;
	try { parsed = typeof value === "string" ? JSON.parse(value) : value; }
	catch (error) { throw new Error(`extension review is malformed: ${error.message}`); }
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).some((key) => !["actionable", "recommendation", "reason", "rationale", "pov", "benefit", "costRisk"].includes(key)))
		throw new Error("extension review has an invalid shape");
	const result = Object.fromEntries(["reason", "rationale", "pov", "benefit", "costRisk"].map((key) => [key, text(parsed[key])]));
	if (typeof parsed.actionable !== "boolean" || !REVIEW_RECOMMENDATIONS.includes(parsed.recommendation) || Object.values(result).some((item) => !item || item.length > 1_000))
		throw new Error("extension review requires bounded actionable recommendation evidence");
	if (!(result.reason in EXTENSION_SCOUT_REVISIT_POLICY)) throw new Error("extension review reason is invalid");
	return { actionable: parsed.actionable, recommendation: parsed.recommendation, ...result };
}

function decisionRecord(status, reason, rationale, reviewedAt, sourceRevision) {
	const policy = EXTENSION_SCOUT_REVISIT_POLICY[reason];
	if (!REVIEW_RECOMMENDATIONS.includes(status) || !policy || !text(rationale)) throw new Error("extension decision is invalid");
	return {
		status, reason, rationale: text(rationale).slice(0, 1_000), decidedAt: reviewedAt, sourceRevision,
		revisitAt: policy.permanent ? null : new Date(Date.parse(reviewedAt) + policy.days * DAY_MS).toISOString(),
		updateRequired: policy.updateRequired,
	};
}

export async function reviewInspectedExtensions(cwd, options = {}) {
	if (typeof options.review !== "function" || typeof options.decide !== "function") throw new Error("extension reviewer and guided decision are required");
	options.signal?.throwIfAborted?.();
	const candidates = (options.candidates ?? readExtensionScoutLedger(cwd).finalists).slice(0, SCOUT_LIMIT);
	const pending = await Promise.all(candidates.map(async (candidate) => {
		options.signal?.throwIfAborted?.();
		const before = readExtensionScoutLedger(cwd);
		const record = before.packages[candidate.name];
		if (!record?.inspection?.ok) return { candidate, record, skip: true };
		try {
			const review = parseExtensionReview(await options.review({ name: candidate.name, revision: record.inspection.revision, facts: record.inspection.facts }));
			return { candidate, record, review };
		} catch (error) { return { candidate, record, error }; }
	}));
	options.signal?.throwIfAborted?.();
	const results = [];
	for (const item of pending) {
		if (item.skip) continue;
		const { candidate, record } = item;
		if (item.error && options.completeFailures !== true) {
			const before = readExtensionScoutLedger(cwd);
			writeExtensionScoutLedger(cwd, { ...before, lastError: `review ${candidate.name}: ${text(item.error.message).slice(0, 500)}` });
			throw new Error(`Extension finalist review failed for ${candidate.name}; candidate remains resumable: ${item.error.message}`);
		}
		const review = item.error ? {
			actionable: false, recommendation: "reject", reason: "insufficient-evidence",
			rationale: `Reviewer failed: ${text(item.error.message).slice(0, 500)}`,
			pov: "No reliable review was produced.", benefit: "None established.", costRisk: "Review must be retried before adoption.",
		} : item.review;
		const reviewedAt = new Date(options.now ?? Date.now()).toISOString();
		const prior = record.decision;
		const policy = EXTENSION_SCOUT_REVISIT_POLICY[prior?.reason];
		let choice = options.forceReview !== true && prior && policy?.updateRequired && prior.sourceRevision === record.inspection.revision
			? { status: prior.status, reason: prior.reason, rationale: "Revisit window elapsed but inspected source revision is unchanged." }
			: review.actionable ? await options.decide({ candidate, review }) : { status: "reject", reason: review.reason, rationale: review.rationale };
		if (!choice || !REVIEW_RECOMMENDATIONS.includes(choice.status)) throw new Error(`Extension decision cancelled for ${candidate.name}; candidate remains resumable`);
		const reason = choice.reason ?? review.reason;
		const rationale = text(choice.rationale ?? review.rationale);
		if (choice.status === "proceed" && options.reportOnly !== true) {
			if (choice.explicit !== true) throw new Error(`Explicit proceed is required before installing ${candidate.name}`);
			if (typeof options.install === "function") await options.install(candidate.name);
		}
		const latest = readExtensionScoutLedger(cwd);
		const packages = { ...latest.packages, [candidate.name]: { ...latest.packages[candidate.name], reviewedAt, review, decision: decisionRecord(choice.status, choice.reason ?? reason, choice.rationale ?? rationale, reviewedAt, record.inspection.revision) } };
		const queue = latest.queue.filter((entry) => entry.name !== candidate.name);
		const finalists = latest.finalists.filter((entry) => entry.name !== candidate.name);
		const next = { ...latest, packages, queue, finalists, currentRun: queue.slice(0, SCOUT_LIMIT), lastError: null };
		writeExtensionScoutLedger(cwd, next);
		results.push({ name: candidate.name, review, decision: packages[candidate.name].decision });
	}
	return { reviewed: results, ledger: readExtensionScoutLedger(cwd) };
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

function defaultClone(repositoryUrl, destination, home, signal) {
	return new Promise((resolve, reject) => execFile("git", ["-c", "submodule.recurse=false", "clone", "--quiet", "--depth", "1", "--no-recurse-submodules", "--", repositoryUrl, destination], {
		env: cloneEnvironment(home), timeout: 180_000, signal,
	}, (error) => error ? reject(error) : resolve()));
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
	options.signal?.throwIfAborted?.();
	const candidates = readExtensionScoutLedger(cwd).currentRun.slice(0, SCOUT_LIMIT);
	const attempts = await Promise.all(candidates.map(async (candidate) => {
		options.signal?.throwIfAborted?.();
		const quarantine = mkdtempSync(path.join(options.tempRoot ?? tmpdir(), "extension-source-"));
		const source = path.join(quarantine, "source");
		let outcome;
		let inaccessible = false;
		try {
			let repository;
			try { repository = new URL(candidate.repositoryUrl); } catch {}
			if (!repository || !["http:", "https:"].includes(repository.protocol) || !["github.com", "gitlab.com", "codeberg.org"].includes(repository.hostname.toLowerCase()))
				throw new Error("repository URL is not an allowed HTTP(S) forge URL");
			try { await (options.clone ?? defaultClone)(candidate.repositoryUrl, source, quarantine, options.signal); }
			catch (error) { if (options.signal?.aborted) throw error; inaccessible = true; throw error; }
			const revision = (await (options.git ?? defaultGit)(source, ["rev-parse", "HEAD"])).trim();
			if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error("cloned source revision is invalid");
			const files = inspectionFiles(source, options.git ?? defaultGit);
			const facts = parseExtensionInspectionFacts(await options.inspect({ name: candidate.name, revision, files }));
			outcome = { ok: true, revision, facts };
		} catch (error) {
			outcome = { ok: false, inaccessible, aborted: Boolean(options.signal?.aborted), error: text(error.message).slice(0, 500) };
		}
		try { await (options.cleanup ?? ((root) => rmSync(root, { recursive: true, force: true })))(quarantine); }
		catch (error) { outcome = { ...outcome, ok: false, error: `cleanup: ${text(error.message).slice(0, 480)}` }; }
		return { candidate, outcome };
	}));
	if (attempts.some(({ outcome }) => outcome.aborted)) options.signal?.throwIfAborted?.();
	const results = [];
	for (const { candidate, outcome } of attempts) {
		const ledger = readExtensionScoutLedger(cwd);
		const attemptedAt = new Date(options.now ?? Date.now()).toISOString();
		const inaccessibleDecision = (outcome.inaccessible || options.completeFailures) && !outcome.ok
			? decisionRecord("reject", "insufficient-evidence", `Source inspection failed: ${outcome.error}`, attemptedAt, null)
			: undefined;
		const packages = { ...ledger.packages, [candidate.name]: { ...ledger.packages[candidate.name], inspection: { ...outcome, attemptedAt }, ...(inaccessibleDecision ? { reviewedAt: attemptedAt, decision: inaccessibleDecision } : {}) } };
		const complete = outcome.ok || outcome.inaccessible || options.completeFailures;
		const queue = complete ? ledger.queue.filter((item) => item.name !== candidate.name) : ledger.queue;
		const currentRun = complete ? ledger.currentRun.filter((item) => item.name !== candidate.name) : ledger.currentRun;
		const finalists = outcome.ok ? mergeQueue(ledger.finalists, [candidate]).slice(0, SCOUT_LIMIT) : ledger.finalists;
		writeExtensionScoutLedger(cwd, { ...ledger, packages, queue, currentRun, finalists, lastError: outcome.ok ? null : `inspection ${candidate.name}: ${outcome.error}` });
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
		const pages = await options.collect({ since, page: options.page });
		discovered = (Array.isArray(pages) ? pages : [pages]).flatMap(parseRecentExtensions)
			.filter((item) => options.page ? true : Date.parse(item.timestamp) >= Date.parse(since));
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
		return item && revisitDue(packages[item.name], now) && decision.plausible === true && Number.isFinite(Number(decision.score))
			? [{ ...item, score: Number(decision.score), rationale: text(decision.rationale).slice(0, 300) }]
			: [];
	});
	const finalists = (ledger.finalists ?? []).slice(0, SCOUT_LIMIT);
	const retries = ledger.queue.filter((item) => revisitDue(packages[item.name], now));
	const retryNames = new Set(retries.map((item) => item.name));
	const additionsToTry = mergeQueue([], additions).filter((item) => !retryNames.has(item.name)).slice(0, SCOUT_LIMIT);
	const candidates = [...retries, ...additionsToTry];
	const capacity = Math.max(0, SCOUT_LIMIT - finalists.length);
	const currentRun = candidates.slice(0, capacity);
	const next = { ...ledger, version: 1, cursor: now.toISOString(), packages, queue: candidates, currentRun, finalists, lastError: null };
	writeExtensionScoutLedger(cwd, next);
	return { since, discovered: discovered.length, selected: currentRun, overflow: candidates.slice(capacity), ledger: next };
}
