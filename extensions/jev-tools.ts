import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, matchesGlob, relative, resolve } from "node:path";
import { showListDialog } from "./work-dialogs.ts";

export const JEV_MODEL = "openrouter/typesafe/jev-1.13";
export const JEV_LIMITS = Object.freeze({ jobs: 32, questions: 32, concurrency: 4, requestMs: 30000, overallMs: 120000, bytes: 24000, fileBytes: 262144, outputBytes: 24000 });
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const size = value => Buffer.byteLength(JSON.stringify(value));
const hash = value => createHash("sha256").update(value).digest("hex");
const idOK = value => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
const textOK = value => typeof value === "string" && value.trim() && value.length <= 2000;
const probability = value => Number.isFinite(value) && value >= 0 && value <= 1;
function requireThat(ok, message) { if (!ok) throw new Error(message); }
function keys(value, allowed) { return Object.keys(value).every(key => allowed.includes(key)); }

export function jevSettings(project) {
	const value = project?.workOrchestrator?.jev;
	return { enabled: value?.enabled === true, model: typeof value?.model === "string" ? value.model : JEV_MODEL, compactionNote: value?.compactionNote === true };
}
export function jevStatus(project, registry) {
	const settings = jevSettings(project);
	const supported = ["getModelOfType", "classify", "getProviderAuthStatus"].every(key => typeof registry?.[key] === "function");
	const model = supported && settings.model.startsWith("openrouter/") ? registry.getModelOfType("classifier", "openrouter", settings.model.slice(11)) : undefined;
	const configured = supported && registry.getProviderAuthStatus("openrouter")?.configured === true;
	return { ...settings, supported, configured, modelObject: model,
		status: !supported ? "Unsupported Pi API" : !settings.enabled ? "Off" : !model || !configured ? "Enabled but unconfigured" : "Ready" };
}

export function validateQuestions(questions) {
	requireThat(object(questions) && Object.keys(questions).length > 0 && Object.keys(questions).length <= 32, "Supply 1–32 typed questions.");
	for (const [id, q] of Object.entries(questions)) {
		requireThat(idOK(id) && object(q) && keys(q, ["type", "instructions", "criteria"]) && textOK(q.instructions),
			`Invalid question "${String(id).slice(0, 40)}": allowed keys are type, instructions, criteria (choice options go in criteria as {label: description}).`);
		const c = q.criteria;
		if (q.type === "bool") requireThat(object(c) && Object.keys(c).length === 2 && textOK(c.true) && textOK(c.false), "Bool criteria require true and false descriptions.");
		else if (q.type === "choice") requireThat(object(c) && Object.keys(c).length >= 2 && Object.keys(c).length <= 32 && Object.entries(c).every(([label, description]) => idOK(label) && textOK(description)), "Choice requires 2–32 declared labels and descriptions.");
		else if (q.type === "score") requireThat(Array.isArray(c) && c.length >= 2 && c.length <= 32 && c.every(textOK), "Score requires 2–32 ordered descriptions.");
		else throw new Error("Use native bool, choice, or score questions; exact extraction needs ordinary read/search.");
	}
}
function validateJson(value, depth = 0) {
	requireThat(depth <= 16, "JSON exceeds depth 16.");
	if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
	requireThat(object(value) || Array.isArray(value), "State must contain JSON values only.");
	for (const [key, child] of Object.entries(value)) {
		requireThat(!["__proto__", "constructor", "prototype"].includes(key), "Unsafe JSON key.");
		validateJson(child, depth + 1);
	}
}
const forbiddenPath = /(^|\/)(?:\.git|\.pi|\.sessions|sessions|node_modules|build|dist|coverage|\.gradle|\.cache|\.idea|\.next|vendor|target)(\/|$)|(^|\/)(?:\.env[^/]*|auth\.json|settings\.json|credentials[^/]*|id_rsa[^/]*|id_ed25519[^/]*|local\.properties|google-services\.json)$|\.(?:pem|key|p12|pfx|jks|keystore|crt|cer|der)$/i;
const secret = /-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----|\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{20,})|\b(?:api[_-]?key|access[_-]?token|password|secret)\b["']?\s*[:=]\s*["'][^"'\s]{8,}["']|\bBearer\s+[A-Za-z0-9._-]{16,}/i;
function safePath(path) {
	requireThat(typeof path === "string" && path.length > 0 && path.length <= 1000 && !/[\x00-\x1f]/.test(path), "Invalid source path.");
	const normalized = path.replaceAll("\\", "/");
	requireThat(!normalized.split("/").includes("..") && !normalized.startsWith("//") && !/[:]/.test(normalized.replace(/^[A-Za-z]:\//, "")), "Traversal/device paths are not allowed.");
	requireThat(!forbiddenPath.test(normalized), "Excluded sensitive/generated path.");
	return normalized;
}
function contained(root, path) {
	const rel = relative(root, path).replaceAll("\\", "/");
	requireThat(rel && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel), "Source is outside the project.");
	safePath(rel);
	return rel;
}
export async function captureSource(cwd, source) {
	const raw = safePath(source.path);
	const root = await realpath(cwd);
	const requested = resolve(root, raw);
	contained(root, requested);
	const absolutePath = await realpath(requested);
	const path = contained(root, absolutePath);
	const handle = await open(absolutePath, "r");
	try {
		const before = await handle.stat();
		requireThat(before.isFile() && before.size <= JEV_LIMITS.fileBytes, "Not a regular bounded file; narrow the source.");
		const buffer = Buffer.alloc(before.size + 1);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const after = await handle.stat();
		const atPath = await stat(absolutePath);
		requireThat(before.dev === atPath.dev && before.ino === atPath.ino && bytesRead === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && await realpath(requested) === absolutePath, "Source changed during capture; reread.");
		const bytes = buffer.subarray(0, bytesRead);
		requireThat(!bytes.includes(0), "Binary/NUL source excluded.");
		let content;
		try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error("Non-UTF8 source excluded."); }
		requireThat(!secret.test(content), "Potential secret-bearing source excluded.");
		const lines = content.split(/\r?\n/);
		const startLine = source.startLine ?? 1;
		const endLine = source.endLine ?? lines.length;
		requireThat(Number.isInteger(startLine) && Number.isInteger(endLine) && startLine >= 1 && endLine >= startLine && endLine <= lines.length, "Source range is outside the captured file.");
		const supplied = source.startLine !== undefined || source.endLine !== undefined ? "range" : "file";
		if (supplied === "range") content = lines.slice(startLine - 1, endLine).join("\n");
		return { content, anchor: { path, absolutePath, supplied, ...(supplied === "range" ? { startLine, endLine } : {}), sha256: hash(content), fileSha256: hash(bytes) } };
	} finally { await handle.close(); }
}
function validateJobs(jobs) {
	requireThat(Array.isArray(jobs) && jobs.length > 0 && jobs.length <= 32, "Supply 1–32 jobs.");
	const ids = new Set();
	for (const job of jobs) {
		requireThat(object(job) && keys(job, ["id", "questions", "state", "sources"]) && idOK(job.id) && !ids.has(job.id), "Job IDs must be valid and unique.");
		ids.add(job.id);
		validateQuestions(job.questions);
		if (job.state !== undefined) validateJson(job.state);
		requireThat(size(job) <= 24000, "Job JSON is too large; split it.");
		requireThat(!secret.test(JSON.stringify(job)), "Potential secret-bearing input excluded.");
		if (job.sources !== undefined) {
			requireThat(Array.isArray(job.sources) && job.sources.length <= 32, "At most 32 explicit sources per job.");
			for (const source of job.sources) {
				requireThat(object(source) && keys(source, ["path", "startLine", "endLine"]), "Invalid source.");
				safePath(source.path);
				for (const key of ["startLine", "endLine"]) if (source[key] !== undefined) requireThat(Number.isInteger(source[key]) && source[key] >= 1, "Invalid inclusive source range.");
				requireThat(source.endLine === undefined || source.endLine >= (source.startLine ?? 1), "Invalid inclusive source range.");
			}
		}
	}
}
function cleanAnswers(answers, questions) {
	requireThat(object(answers) && Object.keys(answers).length === Object.keys(questions).length, "Malformed classifier answers.");
	const out = {};
	for (const [id, q] of Object.entries(questions)) {
		const a = answers[id];
		requireThat(a?.type === q.type, "Malformed classifier answer type.");
		if (a.type === "bool") {
			requireThat(probability(a.probability), "Malformed classifier probability.");
			out[id] = { type: a.type, probability: a.probability, band: a.probability <= 0.2 ? "unlikely" : a.probability >= 0.8 ? "likely" : "uncertain" };
		} else if (a.type === "score") {
			requireThat(Number.isFinite(a.score) && a.score >= 0 && a.score <= q.criteria.length - 1 && probability(a.confidence), "Malformed classifier score.");
			out[id] = { type: a.type, score: a.score, confidence: a.confidence };
		} else {
			requireThat(Object.hasOwn(q.criteria, a.choice) && probability(a.confidence) && object(a.probabilities) && Object.keys(a.probabilities).length === Object.keys(q.criteria).length && Object.keys(q.criteria).every(key => probability(a.probabilities[key])), "Malformed classifier choice.");
			out[id] = { type: a.type, choice: a.choice, confidence: a.confidence, probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, a.probabilities[key]])) };
		}
	}
	return out;
}
const usageKeys = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"];
function cleanUsage(usage) {
	if (!usage || !usageKeys.every(key => Number.isFinite(usage[key]) && usage[key] >= 0)) return undefined;
	const out = Object.fromEntries(usageKeys.map(key => [key, usage[key]]));
	if (usage.cost && [...usageKeys.filter(key => key !== "totalTokens"), "total"].every(key => Number.isFinite(usage.cost[key]) && usage.cost[key] >= 0)) out.cost = Object.fromEntries(["input", "output", "cacheRead", "cacheWrite", "total"].map(key => [key, usage.cost[key]]));
	return out;
}
function addUsage(total, usage) {
	for (const key of usageKeys) total[key] += usage[key];
	if (!usage.cost) delete total.cost;
	else if (total.cost) for (const key of Object.keys(total.cost)) total.cost[key] += usage.cost[key];
}
// Race locally as well as passing the signal: an older provider may ignore cancellation.
async function abortable(promise, signal) {
	let listener;
	try {
		return await Promise.race([promise, new Promise((_, reject) => {
			listener = () => reject(new Error("cancelled"));
			if (signal.aborted) listener(); else signal.addEventListener("abort", listener, { once: true });
		})]);
	} finally { signal.removeEventListener("abort", listener); }
}
export async function runTriage({ jobs, cwd, registry, model, signal, guard = () => {} }) {
	validateJobs(jobs); // Whole request validated before any file read or provider call.
	const overall = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(JEV_LIMITS.overallMs)]);
	const budget = Math.min(JEV_LIMITS.bytes, Math.floor(model.contextWindow * 0.75));
	requireThat(Number.isFinite(budget) && budget > 1024, "Classifier context limit unavailable.");
	let next = 0, calls = 0, unknownUsage = 0;
	const results = jobs.map(job => ({ id: job.id, status: "not-started" }));
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	async function worker() {
		while (next < jobs.length && !overall.aborted) {
			const index = next++, job = jobs[index];
			let invoked = false, accounted = false;
			try {
				guard();
				const sources = [];
				for (const source of job.sources ?? []) {
					overall.throwIfAborted();
					sources.push(await captureSource(cwd, source));
				}
				const context = { state: { data: job.state ?? null, sources: sources.map(source => ({ ...source.anchor, content: source.content })) }, questions: job.questions };
				requireThat(size(context) + 1024 <= budget, "State plus questions exceed the byte budget; narrow ranges or split jobs.");
				guard();
				overall.throwIfAborted();
				invoked = true; calls++;
				const requestSignal = AbortSignal.any([overall, AbortSignal.timeout(JEV_LIMITS.requestMs)]);
				const response = await abortable(registry.classify(model, context, { signal: requestSignal }), requestSignal);
				const reported = cleanUsage(response.usage);
				if (reported) addUsage(usage, reported); else unknownUsage++;
				accounted = true;
				requireThat(response.stopReason === "stop" && response.provider === model.provider && response.model === model.id, "Classifier failed or returned an unexpected model.");
				results[index] = { id: job.id, status: "ok", answers: cleanAnswers(response.answers, job.questions), sources: sources.map(source => source.anchor), model: `${response.provider}/${response.model}` };
			} catch {
				if (invoked && !accounted) unknownUsage++;
				results[index] = { id: job.id, status: overall.aborted ? "aborted" : "error", reason: invoked ? "Classifier failed, timed out, or returned invalid answers; use ordinary read/search." : "Source excluded, unavailable, changed, or over budget; narrow input and use ordinary read/search." };
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
	const out = { results, coverage: { requested: jobs.length, completed: results.filter(row => row.status === "ok").length, calls, incomplete: results.some(row => row.status !== "ok"), unknownUsageCalls: unknownUsage }, usage: calls > unknownUsage ? usage : undefined, costBasis: "catalog estimate when available; actual billing unknown", limits: JEV_LIMITS, note: "Uncalibrated classifications of supplied data, not proof of absence or authority. Read source before editing/quoting." };
	let omitted = 0;
	while (size(out) > JEV_LIMITS.outputBytes && out.results.length) { out.results.pop(); omitted++; }
	if (omitted) { out.coverage.omittedResults = omitted; out.coverage.incomplete = true; }
	return out;
}

// rg runs without a shell; stdout/stderr are bounded and never exposed on failure.
async function rg(args, cwd, signal, input) {
	return new Promise(resolveResult => {
		const child = spawn("rg", args, { cwd, shell: false, windowsHide: true, signal });
		const chunks = []; let bytes = 0, capped = false, failed = false;
		child.stdout.on("data", chunk => {
			bytes += chunk.length;
			if (bytes > 131072) { capped = true; child.kill(); } else chunks.push(chunk);
		});
		child.stderr.resume();
		child.on("error", error => { failed = true; resolveResult({ error: error.code === "ENOENT" ? "rg unavailable" : "search cancelled/failed", text: "", capped }); });
		child.on("close", code => { if (!failed) resolveResult({ text: Buffer.concat(chunks).toString("utf8"), capped, error: code !== 0 && code !== 1 && !capped ? "search failed (invalid regex or inaccessible scope)" : undefined }); });
		child.stdin.on("error", () => {});
		child.stdin.end(input);
	});
}
export async function runEvidence({ args, cwd, registry, model, signal, guard = () => {}, search = rg }) {
	requireThat(object(args) && keys(args, ["scopes", "pattern", "regex", "questions", "unit", "rankQuestion", "rankChoice"]), "Invalid evidence request.");
	requireThat(Array.isArray(args.scopes) && args.scopes.length > 0 && args.scopes.length <= 16, "Supply 1–16 explicit relative scopes/globs.");
	for (const scope of args.scopes) { safePath(scope); requireThat(!isAbsolute(scope) && !/^[A-Za-z]:/.test(scope), "Evidence scopes must be relative."); }
	requireThat(["file", "window"].includes(args.unit), "Choose file or window evidence units.");
	requireThat(args.pattern === undefined || (typeof args.pattern === "string" && args.pattern.length <= 500 && !/[\r\n\0]/.test(args.pattern)), "Use a bounded single-line pattern.");
	requireThat(args.regex === undefined || typeof args.regex === "boolean", "regex must be boolean.");
	requireThat(args.unit !== "window" || Boolean(args.pattern), "Window evidence requires a search pattern.");
	if (args.questions !== undefined) validateQuestions(args.questions);
	const rankQuestion = args.rankQuestion ?? Object.keys(args.questions ?? {})[0];
	if (args.rankQuestion !== undefined) requireThat(Object.hasOwn(args.questions ?? {}, args.rankQuestion), "Unknown ranking question.");
	const rankType = args.questions?.[rankQuestion]?.type;
	if (args.rankChoice !== undefined) requireThat(rankType === "bool" ? ["true", "false"].includes(args.rankChoice) : rankType === "choice" && Object.hasOwn(args.questions[rankQuestion].criteria, args.rankChoice), "Unknown ranking choice.");
	requireThat(!secret.test(JSON.stringify(args)), "Potential secret-bearing query excluded.");
	guard();
	const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(JEV_LIMITS.overallMs)]);
	const root = await realpath(cwd);
	const files = new Set(), skipped = [];
	let enumerationIncomplete = false, omittedFiles = 0;
	const scopes = args.scopes.map(scope => scope.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, ""));
	for (const scope of scopes) if (!/[*?{}\[\]]/.test(scope) && scope !== ".") contained(root, await realpath(resolve(root, scope)));
	// Include globs override rg's ignore rules; filter its normal inventory locally instead.
	deadline.throwIfAborted();
	const found = await search(["--files", "--hidden", "-g", "!.git", "-g", "!node_modules", "-g", "!.pi", "--", "."], root, deadline);
	if (found.error) throw new Error(found.error);
	enumerationIncomplete ||= found.capped;
	const listed = found.text.split(/\r?\n/);
	if (found.capped) listed.pop();
	for (const raw of listed.filter(Boolean)) {
		const path = raw.replaceAll("\\", "/").replace(/^\.\//, "");
		if (!scopes.some(scope => scope === "." || path === scope || path.startsWith(`${scope}/`) || matchesGlob(path, scope))) continue;
		if (files.has(path)) continue;
		if (files.size < 128) files.add(path); else omittedFiles++;
	}
	const candidates = [];
	let scannedFiles = 0, matchedUnits = 0, candidateOmissions = 0;
	for (const path of [...files].sort()) {
		if (deadline.aborted) break;
		let source;
		try { source = await captureSource(root, { path }); }
		catch { skipped.push({ path, reason: "excluded/unavailable/oversize/changed" }); continue; }
		scannedFiles++;
		const lines = source.content.split(/\r?\n/);
		let matches = [];
		if (args.pattern) {
			const found = await search(["--json", "--max-count", "129", ...(args.regex ? [] : ["--fixed-strings"]), "--", args.pattern, "-"], root, deadline, source.content);
			if (found.error) throw new Error(found.error);
			enumerationIncomplete ||= found.capped;
			for (const line of found.text.split(/\r?\n/).filter(Boolean)) {
				let event; try { event = JSON.parse(line); } catch { enumerationIncomplete = true; continue; }
				if (event.type === "match") matches.push(event.data.line_number);
			}
			if (!matches.length) continue;
			if (matches.length >= 129) enumerationIncomplete = true;
		}
		const ranges = args.unit === "file" ? [null] : matches.map(line => [Math.max(1, line - 3), Math.min(lines.length, line + 3)]);
		for (const range of ranges) {
			matchedUnits++;
			if (candidates.length >= 32) { candidateOmissions++; continue; }
			const content = range ? lines.slice(range[0] - 1, range[1]).join("\n") : source.content;
			const anchor = { ...source.anchor, ...(range ? { supplied: "range", startLine: range[0], endLine: range[1], sha256: hash(content) } : {}) };
			const id = `c${hash(JSON.stringify(anchor)).slice(0, 24)}`;
			if (candidates.some(candidate => candidate.id === id)) continue;
			if (Buffer.byteLength(content) > 16000) { skipped.push({ path, reason: "candidate too large; narrow to a matching window" }); continue; }
			candidates.push({ id, anchor, content });
		}
	}
	let classified;
	if (args.questions && candidates.length && !deadline.aborted) classified = await runTriage({
		jobs: candidates.map(candidate => ({ id: candidate.id, questions: args.questions, state: { source: candidate.anchor, content: candidate.content } })),
		cwd: root, registry, model, signal: deadline, guard,
	});
	const answers = new Map(classified?.results.map(row => [row.id, row]));
	const results = candidates.flatMap(candidate => {
		const answer = answers.get(candidate.id);
		if (args.questions && answer?.status !== "ok") return [];
		const ranked = answer?.answers?.[rankQuestion];
		let rank = 0;
		if (ranked?.type === "bool") rank = args.rankChoice === "false" ? 1 - ranked.probability : ranked.probability;
		if (ranked?.type === "score") rank = ranked.score / (args.questions[rankQuestion].criteria.length - 1);
		if (ranked?.type === "choice" && args.rankChoice) rank = ranked.probabilities[args.rankChoice];
		const { absolutePath: _absolutePath, ...anchor } = candidate.anchor;
		return [{ id: candidate.id, ...anchor, excerpt: candidate.content, ...(answer ? { answers: answer.answers } : {}), rank }];
	}).sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
	const out = { results: results.slice(0, 10), skipped, failures: classified?.results.filter(row => row.status !== "ok") ?? [],
		coverage: { enumeratedFiles: files.size, scannedFiles, matchedUnits, omittedFiles, candidateOmissions, omittedResults: Math.max(0, results.length - 10), calls: classified?.coverage.calls ?? 0, unknownUsageCalls: classified?.coverage.unknownUsageCalls ?? 0,
			incomplete: enumerationIncomplete || omittedFiles > 0 || candidateOmissions > 0 || skipped.length > 0 || deadline.aborted || classified?.coverage.incomplete === true },
		usage: classified?.usage, limits: { ...JEV_LIMITS, enumerated: 128, classified: 32, excerpts: 10 },
		note: "Evidence from captured bytes; reread before editing/quoting. Ranking uses the first/selected bool or score question, or rankChoice; otherwise stable ID order. Zero matches is lexical scope evidence, not semantic absence. Costs are catalog estimates, actual billing unknown." };
	while (size(out) > 23000 && out.results.length) { out.results.pop(); out.coverage.omittedResults++; }
	let omittedSkips = 0;
	while (size(out) > 23000 && out.skipped.length) { out.skipped.pop(); omittedSkips++; }
	if (omittedSkips) out.coverage.omittedSkips = omittedSkips;
	if (out.coverage.omittedResults) out.coverage.incomplete = true;
	return out;
}

// One situation per call: own state + files + command output, assembled by code. Command output reaches Jev, never the model.
const ASK_BYTES = 64000; // ~20k tokens of Jev's 32k window, leaving room for questions.
export async function runAsk({ args, cwd, registry, model, signal, runCommand }) {
	requireThat(object(args) && keys(args, ["questions", "state", "paths", "command"]), "Invalid jev_ask request.");
	validateQuestions(args.questions);
	if (args.state !== undefined) { validateJson(args.state); requireThat(JSON.stringify(args.state).length <= 8000, "state is over 8000 chars; pass paths or a command instead of pasting content."); }
	requireThat(args.paths === undefined || (Array.isArray(args.paths) && args.paths.length <= 20), "At most 20 paths.");
	requireThat(args.command === undefined || (typeof args.command === "string" && args.command.trim() && args.command.length <= 2000), "Invalid command.");
	requireThat(args.state !== undefined || args.paths?.length || args.command, "Supply state, paths, or a command.");
	requireThat(!secret.test(JSON.stringify(args)), "Potential secret-bearing input excluded.");
	const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(JEV_LIMITS.overallMs)]);
	const state = {}, parts = [];
	if (args.state !== undefined) { state.state = args.state; parts.push({ name: "state", bytes: size(args.state) }); }
	for (const path of args.paths ?? []) {
		let source;
		try { source = await captureSource(cwd, { path }); } catch (error) { throw new Error(`${path}: ${error.message}`); }
		(state.files ??= {})[source.anchor.path] = source.content;
		parts.push({ name: `files[${source.anchor.path}]`, bytes: size(source.content), sha256: source.anchor.fileSha256 });
	}
	let output;
	if (args.command) {
		deadline.throwIfAborted();
		const ran = await runCommand(args.command, deadline);
		const text = String(ran.output).slice(-200000);
		output = { exitCode: ran.exitCode, bytes: Buffer.byteLength(text), truncated: ran.truncated === true || text.length < String(ran.output).length };
		state.output = { command: args.command, exit_code: ran.exitCode, output: text };
		parts.push({ name: "output", bytes: size(state.output) });
		requireThat(!secret.test(text), "Command output may contain secrets; not sent.");
	}
	const total = parts.reduce((sum, part) => sum + part.bytes, 0);
	if (total + size(args.questions) > ASK_BYTES) {
		const budget = ASK_BYTES - size(args.questions), groups = [];
		for (const part of [...parts].sort((a, b) => b.bytes - a.bytes)) {
			const group = groups.find(g => g.bytes + part.bytes <= budget);
			if (group) { group.bytes += part.bytes; group.names.push(part.name); } else groups.push({ bytes: part.bytes, names: [part.name] });
		}
		throw new Error(`State is ${total} bytes; the limit per call is ${budget}. Parts: ${parts.map(p => `${p.name}=${p.bytes}`).join(", ")}. ` +
			`Split into calls: ${groups.map(g => `[${g.names.join(", ")}]${g.bytes > budget ? " (too big alone: narrow it, e.g. one test file or | tail -n 200)" : ""}`).join(" ")}.`);
	}
	deadline.throwIfAborted();
	const requestSignal = AbortSignal.any([deadline, AbortSignal.timeout(JEV_LIMITS.requestMs)]);
	const response = await abortable(registry.classify(model, { state, questions: args.questions }, { signal: requestSignal }), requestSignal);
	const usage = cleanUsage(response.usage);
	if (response.stopReason !== "stop" || response.provider !== model.provider || response.model !== model.id) return { error: "Classifier failed or returned an unexpected model; decide without Jev.", parts, ...(output ? { output } : {}), usage };
	return { answers: cleanAnswers(response.answers, args.questions), parts, ...(output ? { output } : {}), usage,
		note: "Uncalibrated classification of the assembled state. Command output went only to Jev; rerun the command yourself if you need its text." };
}

// Level-7 advisor, warning only: never compacts, only appends a chat-visible entry the model never sees.
export const COMPACTION_QUESTIONS = {
	switched_gears: { type: "bool", instructions: "Is `current_request` a different task from `previous_work`?", criteria: { true: "A new feature, a different file area, a different goal, or an unrelated question", false: "The same task continuing, a follow up, a fix to what was just done" } },
	at_boundary: { type: "bool", instructions: "Did `recent_turn` finish a unit of work?", criteria: { true: "Tests passed, a commit was made, a summary was given, or a question was asked of the user", false: "Mid task, more steps clearly remain" } },
	needs_history: { type: "score", instructions: "How much of `previous_work` does the next step need?", criteria: ["None; the new work stands alone", "Some references, a file name or a decision", "Most of it; the work continues directly from it"] },
	mid_operation: { type: "bool", instructions: "Is the agent in the middle of a multi step edit whose partial state only exists in the conversation?", criteria: { true: "Half applied changes, a plan being executed step by step, an unfinished refactor", false: "A clean point, nothing half done" } },
};
const RANK = { notice: 1, recommend: 2, request: 3 };
export const usageTier = percent => (percent >= 85 ? "request" : percent >= 70 ? "recommend" : percent >= 50 ? "notice" : undefined);
export function compactionVerdict(answers) {
	if (answers.mid_operation.probability > 0.6) return { show: false, reason: "mid operation" };
	if (answers.switched_gears.probability > 0.7) return { show: true, reason: "The task changed." };
	if (answers.at_boundary.probability > 0.6 && answers.needs_history.score < 1) return { show: true, reason: "The last turn finished a unit of work and the next step needs little earlier context." };
	return { show: false, reason: "same work continuing" };
}
const messageText = message => (typeof message?.content === "string" ? message.content : (message?.content ?? []).filter(part => part.type === "text").map(part => part.text).join("\n"));
const clip = (text, n) => (text.length > n ? `…${text.slice(-(n - 1))}` : text);
export function compactionState(entries, turnMessage, toolResults) {
	const users = [], compaction = entries.findLast(entry => entry.type === "compaction");
	for (const entry of entries) if (entry.type === "message" && entry.message?.role === "user") users.push(messageText(entry.message));
	return {
		current_request: clip(users.at(-1) ?? "", 2000),
		previous_work: clip([compaction?.summary ? `Summary: ${compaction.summary}` : "", ...users.slice(-9, -1)].filter(Boolean).join("\n---\n"), 6000),
		recent_turn: clip(messageText(turnMessage), 2000),
		tools_this_turn: (toolResults ?? []).map(result => result.toolName).filter(Boolean).slice(0, 32),
	};
}

export const JEV_GUIDELINES = [
	"Use jev_evidence instead of reading many files to find which files or snippets matter: broad scope globs (code and docs), a literal or regex pattern, unit \"window\", and several typed questions in one call.",
	"jev_evidence excerpts and line ranges are exact local captures: cite them directly instead of rereading; read whole files only where the excerpts are not enough.",
	"Use jev_triage to ask many typed questions about JSON or explicit file ranges in one call instead of reading them yourself.",
	"Jev classifier answers are probabilistic hints, not extraction or proof of absence; reread before editing.",
	'Example: jev_evidence({scopes:["src/**/*.kt"],unit:"window",pattern:"battery",questions:{reads:{type:"bool",instructions:"Does this code read battery data from the device?",criteria:{true:"reads it",false:"unrelated"}}}})',
];
const sourceSchema = { type: "object", additionalProperties: false, required: ["path"], properties: { path: { type: "string" }, startLine: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 1 } } };
const questionsSchema = { type: "object", description: "1–32 native bool/choice/score questions keyed by ID; each has instructions and criteria (bool: true/false descriptions; choice: label map; score: ordered descriptions)." };
// ponytail: jev_ask is off by default (user, 2026-10-06: files only until it has a use case); `{ ask: true }` re-enables it for experiments.
// readProject(cwd) returns effective settings: global workOrchestrator.jev overridden by the project's.
export function createJevTools(pi, readProject, register = tool => pi.registerTool(tool), { ask = false } = {}) {
	let current, signature, registered = false, ledger = { calls: 0, cost: 0 }, noted = 0, advising, pending = Promise.resolve();
	const active = new Set();
	const spend = usage => { if (usage) { ledger.calls++; ledger.cost += usage.cost?.total ?? 0; } };
	function guard(ctx) {
		const status = jevStatus(readProject(ctx.cwd), ctx.modelRegistry);
		requireThat(status.status === "Ready", "Jev is off/unconfigured/unsupported. Enable it in Settings (global or project) and use /login → OpenRouter.");
		return status;
	}
	const tool = {
		name: "jev_triage", label: "Jev triage",
		promptSnippet: "Ask up to 32 typed yes/no/choice/score questions about JSON or file ranges in one cheap classifier call",
		description: "Optional typed classification of JSON or explicit source bundles. Independent jobs share questions within each call. Not extraction/proof; hidden reads do not satisfy read-before-edit.",
		parameters: { type: "object", additionalProperties: false, required: ["jobs"], properties: { jobs: { type: "array", minItems: 1, maxItems: 32, items: { type: "object", additionalProperties: false, required: ["id", "questions"], properties: { id: { type: "string" }, questions: questionsSchema, state: {}, sources: { type: "array", maxItems: 32, items: sourceSchema } } } } } },
		outputSchema: { type: "object" },
		async execute(_id, args, signal, _update, ctx) {
			const status = guard(ctx);
			const controller = new AbortController(); active.add(controller);
			try {
				const result = await runTriage({ jobs: args.jobs, cwd: ctx.cwd, registry: ctx.modelRegistry, model: status.modelObject, signal: AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]), guard: () => guard(ctx) });
				const { usage, ...visible } = result;
				spend(usage);
				return { content: [{ type: "text", text: JSON.stringify(visible) }], structuredContent: visible, details: visible, ...(usage ? { usage } : {}) };
			} finally { active.delete(controller); }
		},
	};
	const evidenceTool = {
		...tool, name: "jev_evidence", label: "Jev evidence",
		promptSnippet: "Search many files and rank each match with a cheap classifier; returns path/line excerpts",
		promptGuidelines: JEV_GUIDELINES,
		description: "Optional repository evidence retrieval: explicit relative scopes/globs, literal pattern (regex opt-in), file/window units and optional typed questions. Returns locally captured anchors/excerpts, not generated quotes. Reread before editing.",
		parameters: { type: "object", additionalProperties: false, required: ["scopes", "unit"], properties: {
			scopes: { type: "array", minItems: 1, maxItems: 16, items: { type: "string" } }, unit: { type: "string", enum: ["file", "window"] }, pattern: { type: "string", maxLength: 500 }, regex: { type: "boolean" }, questions: questionsSchema, rankQuestion: { type: "string" }, rankChoice: { type: "string" },
		} },
		async execute(_id, args, signal, _update, ctx) {
			const status = guard(ctx);
			const controller = new AbortController(); active.add(controller);
			try {
				const result = await runEvidence({ args, cwd: ctx.cwd, registry: ctx.modelRegistry, model: status.modelObject, signal: AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]), guard: () => guard(ctx) });
				const { usage, ...visible } = result;
				spend(usage);
				return { content: [{ type: "text", text: JSON.stringify(visible) }], structuredContent: visible, details: visible, ...(usage ? { usage } : {}) };
			} finally { active.delete(controller); }
		},
	};
	const askTool = {
		...tool, name: "jev_ask", label: "Jev ask",
		promptSnippet: "Run a command (tests, git diff) or gather files/state and get typed Jev judgments without the output entering your context",
		promptGuidelines: [
			"Use jev_ask for judgments, not lookups: run the tests and classify the failure (code bug vs test bug vs environment) before choosing a fix; score a git diff's risk before committing; decide bug vs expected behavior for a report; decide whether a request is clear enough to plan.",
			"Prefer jev_ask's command or paths over pasting content; command output goes only to Jev. Not for exact lookups, counting, or grep.",
		],
		description: "Optional one-situation classification. Code assembles your state, up to 20 files, and a command's output (run through Pi's bash tool; output is sent to Jev, never returned to you) and asks typed bool/choice/score questions in one call. Over budget it refuses with a split. Answers are hints; reread before editing.",
		parameters: { type: "object", additionalProperties: false, required: ["questions"], properties: {
			questions: questionsSchema, state: { description: "Your own short state: text or JSON (≤8000 chars). Not for pasting files or output." },
			paths: { type: "array", maxItems: 20, items: { type: "string" }, description: "Repo files for code to read into files[path]." },
			command: { type: "string", maxLength: 2000, description: "Command run via the bash tool; its output goes into output for Jev only." },
		} },
		async execute(_id, args, signal, _update, ctx) {
			const status = guard(ctx);
			const controller = new AbortController(); active.add(controller);
			try {
				const result = await runAsk({ args, cwd: ctx.cwd, registry: ctx.modelRegistry, model: status.modelObject, signal: AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]),
					async runCommand(command, commandSignal) {
						requireThat(typeof ctx.executeTool === "function", "Commands need Pi's executeTool support.");
						const outcome = await ctx.executeTool("bash", { command, timeout: 60 }, { signal: commandSignal });
						const ran = outcome?.result?.structuredContent;
						if (!Number.isFinite(ran?.exit_code)) throw new Error(`Command did not complete (blocked, timed out, or bash unavailable): ${messageText(outcome?.result).trim().split(/\r?\n/).at(-1)?.slice(0, 200) ?? ""}`);
						return { exitCode: ran.exit_code, output: ran.output, truncated: ran.truncated };
					} });
				const { usage, ...visible } = result;
				spend(usage);
				return { content: [{ type: "text", text: JSON.stringify(visible) }], structuredContent: visible, details: visible, ...(visible.error ? { isError: true } : {}), ...(usage ? { usage } : {}) };
			} finally { active.delete(controller); }
		},
	};
	const tools = () => (ask ? [tool, evidenceTool, askTool] : [tool, evidenceTool]);
	async function advise(event, ctx, tier, percent) {
		const status = jevStatus(readProject(ctx.cwd), ctx.modelRegistry);
		const controller = new AbortController(); active.add(controller);
		const record = { tier, percent: Math.round(percent), show: false };
		try {
			const state = compactionState(ctx.sessionManager.getBranch(), event.message, event.toolResults);
			if (secret.test(JSON.stringify(state))) { record.reason = "skipped: possible secret in conversation"; return; }
			const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(JEV_LIMITS.requestMs)]);
			const response = await abortable(ctx.modelRegistry.classify(status.modelObject, { state, questions: COMPACTION_QUESTIONS }, { signal }), signal);
			record.cost = cleanUsage(response.usage)?.cost?.total;
			requireThat(response.stopReason === "stop", "Classifier failed.");
			record.answers = cleanAnswers(response.answers, COMPACTION_QUESTIONS);
			Object.assign(record, compactionVerdict(record.answers));
			if (record.show) noted = RANK[tier];
		} catch (error) { record.reason = `error: ${error.message}`; }
		finally { active.delete(controller); pi.appendEntry("jev-compaction-note", record); }
	}
	function refresh(ctx = current) {
		if (!ctx) return;
		current = ctx;
		const status = jevStatus(readProject(ctx.cwd), ctx.modelRegistry);
		const next = `${ctx.cwd}:${status.enabled && status.supported}:${status.model}`;
		if (next === signature) return;
		for (const controller of active) controller.abort();
		signature = next;
		if (status.enabled && status.supported) {
			for (const definition of tools()) register({ ...definition, exposure: "direct" });
			registered = true;
		} else if (registered) for (const definition of tools()) register({ ...definition, exposure: "hidden" });
	}
	for (const event of ["session_start", "session_switch", "before_agent_start"]) pi.on(event, (_event, ctx) => refresh(ctx));
	pi.on("session_shutdown", () => { for (const controller of active) controller.abort(); });
	pi.on("agent_start", () => { ledger = { calls: 0, cost: 0 }; noted = 0; });
	pi.on("agent_end", (event, ctx) => {
		if (!ledger.calls || !ctx.hasUI) return;
		const agent = (event.messages ?? []).reduce((sum, m) => sum + (m.role === "assistant" ? m.usage?.cost?.total ?? 0 : 0), 0);
		ctx.ui.notify(`Jev: ${ledger.calls} call${ledger.calls === 1 ? "" : "s"}, $${ledger.cost.toFixed(4)}${agent > 0 && ledger.cost > 0 ? `; the agent's own spend was ${Math.round(agent / ledger.cost)}× that` : ""}.`, "info");
	});
	pi.on("turn_end", (event, ctx) => {
		const status = jevStatus(readProject(ctx.cwd), ctx.modelRegistry);
		const percent = ctx.getContextUsage?.()?.percent;
		const tier = Number.isFinite(percent) ? usageTier(percent) : undefined;
		// One classifier call per turn at most, only above 50% and only when a higher tier could still be shown. Not awaited: never delays the agent.
		if (!status.compactionNote || status.status !== "Ready" || !tier || advising || RANK[tier] <= noted) return;
		advising = true;
		pending = advise(event, ctx, tier, percent).finally(() => { advising = false; });
	});
	pi.registerEntryRenderer?.("jev-compaction-note", entry => {
		const data = entry.data;
		if (!data?.show) return undefined;
		const lead = { notice: "Consider compacting", recommend: "Compaction recommended", request: "Please compact soon" }[data.tier];
		const text = `⚠ Jev: ${lead} — context ${data.percent}% full. ${data.reason} (/compact; this note is not sent to the model)`;
		return { render: width => { const w = Math.max(10, width - 1); return Array.from({ length: Math.ceil(text.length / w) }, (_, i) => text.slice(i * w, (i + 1) * w)); }, invalidate() {} };
	});
	return { refresh, pendingAdvice: () => pending, async panel(ctx, scope, readScope, writeScope) {
		// Each scope stores its own flags; a project value overrides the global one.
		const where = scope === "global" ? "globally (projects without their own setting)" : "for this project (overrides global)";
		let cursor;
		for (;;) {
			const status = jevStatus(readProject(ctx.cwd), ctx.modelRegistry);
			const own = readScope(ctx.cwd).workOrchestrator?.jev ?? {};
			const flag = (key) => typeof own[key] === "boolean" ? (own[key] ? "On" : "Off") : "inherited";
			const selected = await showListDialog(ctx, {
				title: "Optional Jev tools", purpose: "Source uploads to OpenRouter/TypeSafe; ordinary tools stay available. Project overrides global.", currentValue: cursor,
				items: [
					{ value: "enabled", label: `Jev tools (${scope}): ${flag("enabled")} · here: ${status.status}`, description: `Toggle ${where}. Model: ${status.model}` },
					{ value: "compactionNote", label: `Compaction note (${scope}): ${flag("compactionNote")} · here: ${status.compactionNote ? "On" : "Off"}`, description: "Above 50% context, Jev judges whether the work moved on and shows a warning note. Never compacts. Sends recent conversation text." },
					{ value: "login", label: `OpenRouter: ${status.configured ? "configured (not live-tested)" : "not configured"}`, description: "Use native /login → OpenRouter. Never paste a key into settings." },
				],
			});
			if (!selected) return;
			cursor = selected.value;
			if (cursor === "login") { ctx.ui.notify("Use /login → OpenRouter for credentials.", "info"); continue; }
			const next = !status[cursor]; // flip what is in effect here, stored in this scope
			if (next && !(await ctx.ui.confirm?.(cursor === "enabled" ? `Enable Jev ${where}?` : `Enable the Jev compaction note ${where}?`,
				cursor === "enabled" ? "Selected source ranges/JSON will be uploaded to OpenRouter/TypeSafe. Secret filters are not a guarantee. No automatic calls."
					: "Above 50% context, recent user requests and the last assistant turn are uploaded to OpenRouter/TypeSafe each turn. It only shows a note; it never compacts."))) continue;
			const settings = readScope(ctx.cwd); settings.workOrchestrator ??= {};
			settings.workOrchestrator.jev = { ...(settings.workOrchestrator.jev ?? {}), [cursor]: next };
			writeScope(ctx.cwd, settings); refresh(ctx);
		}
	} };
}
