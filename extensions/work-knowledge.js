import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	statSync,
	truncateSync,
	writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const KNOWLEDGE_KINDS = Object.freeze([
	"fact",
	"environment",
	"procedure",
	"dead-end",
	"preference",
]);
export const KNOWLEDGE_SCOPES = Object.freeze(["project", "user"]);
export const KNOWLEDGE_AUTHORITIES = Object.freeze([
	"human",
	"verified",
	"observed",
	"inferred",
]);
export const KNOWLEDGE_CUSTOM_TYPE = "work-knowledge";
export const KNOWLEDGE_MAX_CLAIM_CHARS = 280;

const STOP_WORDS = new Set(
	"a an and are as at be before but by can did do does for from had has have how i if in into is it its me must no not now of on or our so still that the then this to use was we were what when where which who why will with you your again".split(
		" ",
	),
);
const SECRET_PATTERNS = [
	/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
	/\b(?:sk|rk|pk)-[a-z0-9_-]{16,}\b/i,
	/\b(?:ghp|github_pat)_[a-z0-9_]{16,}\b/i,
	/\bxox[bap]-[a-z0-9-]{16,}\b/i,
	/\bAKIA[0-9A-Z]{16}\b/,
	/\b(?:authorization\s*:\s*bearer|bearer)\s+[a-z0-9._~+/-]{12,}/i,
	/\b(?:api[_-]?key|access[_-]?token|password|passwd|secret)\s*[:=]\s*\S{8,}/i,
];
const MACHINE_MESSAGE_MARKERS = [
	/work-goal-continuation:/i,
	/<work_goal_objective>/i,
	/^Compaction is complete\. Resume the parent task now\b/i,
	/^ORCHESTRATOR_RUN_V1\b/i,
];
const cache = new Map();

function normalizeText(value) {
	return String(value ?? "")
		.replace(/\r\n?/g, "\n")
		.trim();
}

function xmlEscape(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function hasSecret(value) {
	return SECRET_PATTERNS.some((pattern) => pattern.test(String(value ?? "")));
}

function validateClaim(value) {
	const claim = normalizeText(value);
	if (!claim) throw new Error("Knowledge claim is required.");
	if (claim.length > KNOWLEDGE_MAX_CLAIM_CHARS)
		throw new Error(
			`Knowledge claim exceeds ${KNOWLEDGE_MAX_CLAIM_CHARS} characters.`,
		);
	if (/\n/.test(claim))
		throw new Error("Knowledge claims must be one declarative line.");
	if (hasSecret(claim))
		throw new Error("Knowledge claim looks like a secret and was not stored.");
	if ((claim.match(/\b[A-Za-z_][A-Za-z0-9_]*=\S+/g) ?? []).length >= 2)
		throw new Error("Raw environment dumps cannot be stored as knowledge.");
	return claim;
}

function stringList(values, label) {
	if (values === undefined || values === null) return [];
	const list = Array.isArray(values) ? values : [values];
	if (list.length > 20) throw new Error(`${label} has too many values.`);
	return [
		...new Set(list.map((value) => normalizeText(value)).filter(Boolean)),
	].map((value) => {
		if (value.length > 500 || /[\0\r\n]/.test(value) || hasSecret(value))
			throw new Error(`${label} contains an invalid or secret value.`);
		const normalized = value.replaceAll("\\", "/");
		if (
			label.includes("path") &&
			(isAbsolute(value) || /^(?:\.\.?\/|\/|[A-Za-z]:)/.test(normalized))
		)
			throw new Error(`${label} must contain project-relative paths.`);
		return normalized;
	});
}

function validateSource(source) {
	if (!source) return undefined;
	const result = {};
	for (const key of ["sessionId", "gitRevision", "writeBucket"]) {
		const value = normalizeText(source[key]);
		if (!value) continue;
		if (value.length > 160 || /[\0\r\n]/.test(value))
			throw new Error(`source.${key} is invalid.`);
		result[key] = value;
	}
	const eventIds = stringList(source.eventIds, "source.eventIds");
	if (eventIds.length) result.eventIds = eventIds;
	return Object.keys(result).length ? result : undefined;
}

function confinedPath(cwd, value) {
	const root = resolve(cwd);
	const absolute = resolve(root, value);
	const rel = relative(root, absolute);
	if (!rel || rel === ".") return absolute;
	if (
		rel === ".." ||
		rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
		isAbsolute(rel)
	)
		throw new Error("Knowledge binding must stay inside the project.");
	return absolute;
}

function validateBinding(binding, cwd) {
	if (!binding) return undefined;
	const path = normalizeText(binding.path);
	const sha256 = normalizeText(binding.sha256 ?? binding.hash).toLowerCase();
	if (!path || !/^[a-f0-9]{64}$/.test(sha256))
		throw new Error("Knowledge binding requires path and a SHA-256 hash.");
	if (!cwd) throw new Error("Knowledge binding requires a project directory.");
	confinedPath(cwd, path);
	return { path: path.replaceAll("\\", "/"), sha256 };
}

export function knowledgePaths(cwd, options = {}) {
	const userRoot =
		options.userRoot ??
		process.env.PI_CODING_AGENT_DIR ??
		join(homedir(), ".pi", "agent");
	return {
		project:
			options.projectPath ??
			join(
				resolve(cwd ?? process.cwd()),
				".ce-workflow",
				"local",
				"knowledge.jsonl",
			),
		user: options.userPath ?? join(userRoot, "knowledge", "claims.jsonl"),
	};
}

function eventId(prefix) {
	return `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function withLedgerLock(path, action) {
	const lockPath = `${path}.lock`;
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const deadline = Date.now() + 2_000;
	let fd;
	for (;;) {
		try {
			fd = openSync(lockPath, "wx", 0o600);
			writeSync(fd, String(process.pid), undefined, "utf8");
			fsyncSync(fd);
			break;
		} catch (error) {
			const lockExists = existsSync(lockPath);
			const windowsContention =
				error?.code === "EPERM" ||
				(["EACCES", "EBUSY"].includes(error?.code) && lockExists);
			if (error?.code !== "EEXIST" && !windowsContention) throw error;
			try {
				const owner = Number(readFileSync(lockPath, "utf8"));
				if (owner && owner !== process.pid) process.kill(owner, 0);
			} catch (ownerError) {
				if (ownerError?.code === "ESRCH" || ownerError?.code === "ENOENT") {
					rmSync(lockPath, { force: true });
					continue;
				}
			}
			if (Date.now() >= deadline) throw new Error(`Timed out locking ${path}.`);
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
		}
	}
	try {
		return action();
	} finally {
		if (fd !== undefined) closeSync(fd);
		rmSync(lockPath, { force: true });
	}
}

function repairTornTail(path) {
	if (!existsSync(path)) return;
	const data = readFileSync(path);
	if (!data.length || data.at(-1) === 10) return;
	const lastNewline = data.lastIndexOf(10);
	const tail = data
		.subarray(lastNewline + 1)
		.toString("utf8")
		.replace(/^\uFEFF/, "");
	try {
		if (validLoadedRow(JSON.parse(tail))) {
			const fd = openSync(path, "a", 0o600);
			try {
				writeSync(fd, "\n", undefined, "utf8");
				fsyncSync(fd);
			} finally {
				closeSync(fd);
			}
			return;
		}
	} catch {
		// An invalid unterminated row is a torn tail and is discarded below.
	}
	truncateSync(path, lastNewline < 0 ? 0 : lastNewline + 1);
}

function appendJsonLine(path, value, shouldAppend = () => true) {
	return withLedgerLock(path, () => {
		repairTornTail(path);
		if (!shouldAppend()) return false;
		const line = `${JSON.stringify(value)}\n`;
		const fd = openSync(path, "a", 0o600);
		try {
			writeSync(fd, line, undefined, "utf8");
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		cache.clear();
		return true;
	});
}

const RECORD_KEYS = new Set([
	"id",
	"op",
	"recordedAt",
	"claim",
	"kind",
	"scope",
	"authority",
	"paths",
	"symbols",
	"source",
	"binding",
	"expiresAt",
	"supersedes",
]);
const REJECT_KEYS = new Set(["id", "op", "recordedAt", "target", "reason"]);

function validLoadedRow(row) {
	if (!row || typeof row !== "object" || Array.isArray(row)) return false;
	let allowed = null;
	if (row.op === "record") allowed = RECORD_KEYS;
	else if (row.op === "reject") allowed = REJECT_KEYS;
	if (
		!allowed ||
		typeof row.id !== "string" ||
		!/^[a-z][a-z0-9-]{2,80}$/.test(row.id) ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(row.recordedAt) ||
		Object.keys(row).some((key) => !allowed.has(key))
	)
		return false;
	if (row.op === "reject")
		return (
			typeof row.target === "string" &&
			/^[a-z][a-z0-9-]{2,80}$/.test(row.target) &&
			typeof row.reason === "string" &&
			row.reason.length <= 280 &&
			!/[\r\n\0]/.test(row.reason) &&
			!hasSecret(row.reason)
		);
	const sourceKeys = Object.keys(row.source ?? {});
	const bindingKeys = Object.keys(row.binding ?? {});
	return Boolean(
		KNOWLEDGE_KINDS.includes(row.kind) &&
			KNOWLEDGE_SCOPES.includes(row.scope) &&
			KNOWLEDGE_AUTHORITIES.includes(row.authority) &&
			typeof row.claim === "string" &&
			Array.isArray(row.paths) &&
			row.paths.length <= 20 &&
			row.paths.every(
				(value) => typeof value === "string" && !/[\r\n\0]/.test(value),
			) &&
			Array.isArray(row.symbols) &&
			row.symbols.length <= 20 &&
			row.symbols.every(
				(value) => typeof value === "string" && !/[\r\n\0]/.test(value),
			) &&
			(!row.source || Array.isArray(row.source.eventIds ?? [])) &&
			!hasSecret(
				[
					row.claim,
					...(row.paths ?? []),
					...(row.symbols ?? []),
					row.source?.sessionId,
					row.source?.gitRevision,
					row.source?.writeBucket,
					...(row.source?.eventIds ?? []),
					row.binding?.path,
				].join("\n"),
			) &&
			row.claim.length <= KNOWLEDGE_MAX_CLAIM_CHARS &&
			!/\r|\n|[\0-\x08\x0B\x0C\x0E-\x1F]/.test(row.claim) &&
			sourceKeys.every((key) =>
				["sessionId", "gitRevision", "writeBucket", "eventIds"].includes(key),
			) &&
			bindingKeys.every((key) => ["path", "sha256"].includes(key)),
	);
}

function readRows(path, scope) {
	if (!existsSync(path)) return [];
	const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
	const lines = text.split(/\r?\n/);
	const rows = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line) continue;
		let row;
		try {
			row = JSON.parse(line);
		} catch (error) {
			if (index === lines.length - 1 && !text.endsWith("\n")) continue;
			throw new Error(`Invalid knowledge ledger row ${path}:${index + 1}.`, {
				cause: error,
			});
		}
		if (!validLoadedRow(row))
			throw new Error(`Invalid knowledge ledger record ${path}:${index + 1}.`);
		rows.push({
			...row,
			scope: row.scope ?? scope,
			_path: path,
			_line: index + 1,
		});
	}
	return rows;
}

function fileFingerprint(path) {
	if (!existsSync(path)) return "missing";
	const stat = statSync(path);
	return `${stat.size}:${stat.mtimeMs}`;
}

export function knowledgeFingerprint(cwd, options = {}) {
	const paths = knowledgePaths(cwd, options);
	return createHash("sha256")
		.update(`${fileFingerprint(paths.project)}|${fileFingerprint(paths.user)}`)
		.digest("hex")
		.slice(0, 16);
}

export function knowledgeWriteCount(cwd, writeBucket, options = {}) {
	const bucket = normalizeText(writeBucket);
	if (!bucket) return 0;
	const paths = knowledgePaths(cwd, options);
	return [
		...readRows(paths.project, "project"),
		...readRows(paths.user, "user"),
	].filter((row) => row.op === "record" && row.source?.writeBucket === bucket)
		.length;
}

function recordFingerprint(record) {
	return createHash("sha256")
		.update(
			JSON.stringify({
				claim: normalizeText(record.claim).toLowerCase(),
				kind: record.kind,
				scope: record.scope,
				paths: [...(record.paths ?? [])].sort(),
				symbols: [...(record.symbols ?? [])].sort(),
			}),
		)
		.digest("hex");
}

function bindingStatus(record, cwd) {
	if (!record.binding) return "live";
	try {
		const path = confinedPath(cwd, record.binding.path);
		if (!existsSync(path)) return "stale";
		const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
		return digest === record.binding.sha256 ? "live" : "stale";
	} catch {
		return "stale";
	}
}

export function resolveKnowledge(cwd, options = {}) {
	const paths = knowledgePaths(cwd, options);
	const rows = [
		...readRows(paths.user, "user"),
		...readRows(paths.project, "project"),
	].sort(
		(a, b) =>
			String(a.recordedAt ?? "").localeCompare(String(b.recordedAt ?? "")) ||
			Number(a._line ?? 0) - Number(b._line ?? 0),
	);
	const records = new Map();
	const rejected = new Map();
	const superseded = new Set();
	for (const row of rows) {
		if (row.op === "record" && row.id) {
			records.set(String(row.id), row);
			if (row.supersedes) superseded.add(String(row.supersedes));
		} else if (row.op === "reject" && row.target) {
			rejected.set(String(row.target), row);
		}
	}
	const rejectionFor = (record) => {
		const visited = new Set();
		let current = record;
		while (current && !visited.has(String(current.id))) {
			visited.add(String(current.id));
			const rejection = rejected.get(String(current.id));
			if (rejection) return rejection;
			current = current.supersedes
				? records.get(String(current.supersedes))
				: null;
		}
		return undefined;
	};
	const now = Date.parse(options.now ?? new Date().toISOString());
	return [...records.values()].map((record) => {
		let status = "live";
		const rejection = rejectionFor(record);
		if (rejection) status = "rejected";
		else if (superseded.has(String(record.id))) status = "superseded";
		else if (
			record.expiresAt &&
			Number.isFinite(Date.parse(record.expiresAt)) &&
			Date.parse(record.expiresAt) <= now
		)
			status = "expired";
		else status = bindingStatus(record, cwd);
		return {
			...record,
			status,
			rejection,
			fingerprint: recordFingerprint(record),
		};
	});
}

function targetPath(cwd, scope, options) {
	if (!KNOWLEDGE_SCOPES.includes(scope))
		throw new Error(
			`Knowledge scope must be one of: ${KNOWLEDGE_SCOPES.join(", ")}.`,
		);
	return knowledgePaths(cwd, options)[scope];
}

export function recordKnowledge(cwd, input, options = {}) {
	if (hasSecret(JSON.stringify(input ?? {})))
		throw new Error("Knowledge input looks like a secret and was not stored.");
	const kind = input.kind ?? "fact";
	const scope = input.scope ?? "project";
	const authority = input.authority ?? "observed";
	if (!KNOWLEDGE_KINDS.includes(kind))
		throw new Error(
			`Knowledge kind must be one of: ${KNOWLEDGE_KINDS.join(", ")}.`,
		);
	if (!KNOWLEDGE_AUTHORITIES.includes(authority))
		throw new Error("Unsupported knowledge authority.");
	if (
		options.allowedAuthorities &&
		!options.allowedAuthorities.includes(authority)
	)
		throw new Error(
			"This caller cannot assign the requested knowledge authority.",
		);
	const record = {
		id: input.id ?? eventId("k"),
		op: "record",
		recordedAt: input.recordedAt ?? new Date().toISOString(),
		claim: validateClaim(input.claim),
		kind,
		scope,
		authority,
		paths: stringList(input.paths, "paths"),
		symbols: stringList(input.symbols, "symbols"),
		source: validateSource(input.source),
		binding: validateBinding(input.binding, cwd),
		expiresAt: input.expiresAt || undefined,
		supersedes: input.supersedes || undefined,
	};
	if (record.expiresAt && !Number.isFinite(Date.parse(record.expiresAt)))
		throw new Error("expiresAt must be a valid timestamp.");
	if (record.supersedes) {
		const target = resolveKnowledge(cwd, options).find(
			(item) => item.id === record.supersedes,
		);
		if (!target)
			throw new Error(`Knowledge claim ${record.supersedes} was not found.`);
		if (target.status !== "live")
			throw new Error(`Knowledge claim ${record.supersedes} is no longer live.`);
		if (target.scope !== scope)
			throw new Error("A correction must use the same scope as its target.");
	}
	let duplicate;
	const appended = appendJsonLine(
		targetPath(cwd, scope, options),
		record,
		() => {
			const resolved = resolveKnowledge(cwd, options);
			if (record.supersedes) {
				const target = resolved.find((item) => item.id === record.supersedes);
				if (target?.status !== "live")
					throw new Error(`Knowledge claim ${record.supersedes} is no longer live.`);
				return true;
			}
			duplicate = resolved.find(
				(item) =>
					item.status === "live" && item.fingerprint === recordFingerprint(record),
			);
			return !duplicate;
		},
	);
	return { record: duplicate ?? record, deduplicated: !appended };
}

export function correctKnowledge(cwd, id, input, options = {}) {
	const changes = Object.fromEntries(
		Object.entries(input ?? {}).filter(([, value]) => value !== undefined),
	);
	const target = resolveKnowledge(cwd, options).find((item) => item.id === id);
	if (!target) throw new Error(`Knowledge claim ${id} was not found.`);
	if (
		options.actor === "model" &&
		["human", "verified"].includes(target.authority)
	)
		throw new Error(
			"Model-authored corrections cannot supersede trusted claims.",
		);
	return recordKnowledge(
		cwd,
		{
			...target,
			...changes,
			id: changes.id,
			op: "record",
			scope: target.scope,
			authority:
				options.actor === "model"
					? (changes.authority ?? "observed")
					: (changes.authority ?? target.authority),
			supersedes: id,
			recordedAt: changes.recordedAt,
		},
		options,
	);
}

export function rejectKnowledge(cwd, id, reason = "", options = {}) {
	const target = resolveKnowledge(cwd, options).find((item) => item.id === id);
	if (!target) throw new Error(`Knowledge claim ${id} was not found.`);
	if (
		options.actor === "model" &&
		["human", "verified"].includes(target.authority)
	)
		throw new Error("Model-authored rejection cannot remove a trusted claim.");
	if (target.status === "rejected")
		return { event: target.rejection, deduplicated: true };
	const cleanReason = normalizeText(reason);
	if (hasSecret(cleanReason))
		throw new Error("Rejection reason looks like a secret and was not stored.");
	if (cleanReason.length > 280 || /\n/.test(cleanReason))
		throw new Error(
			"Rejection reason must be one line of at most 280 characters.",
		);
	const event = {
		id: eventId("e"),
		op: "reject",
		recordedAt: new Date().toISOString(),
		target: id,
		reason: cleanReason,
	};
	let existing;
	const appended = appendJsonLine(
		targetPath(cwd, target.scope, options),
		event,
		() => {
			existing = resolveKnowledge(cwd, options).find((item) => item.id === id);
			return existing?.status !== "rejected";
		},
	);
	return {
		event: appended ? event : existing?.rejection,
		deduplicated: !appended,
	};
}

function tokens(value) {
	return [
		...new Set(
			String(value ?? "")
				.toLowerCase()
				.match(/[a-z0-9]+/g)
				?.map((token) => {
					if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
					return token;
				})
				.filter((token) => token.length > 1 && !STOP_WORDS.has(token)) ?? [],
		),
	];
}

function queryValues(values) {
	let list = [];
	if (Array.isArray(values)) list = values;
	else if (values) list = [values];
	return [...new Set(list)]
		.map((value) => normalizeText(value).replaceAll("\\", "/"))
		.filter((value) => value && value.length <= 500 && !/[\0\r\n]/.test(value));
}

function normalizedQuery(query) {
	if (typeof query === "string") return { text: query, paths: [], symbols: [] };
	return {
		text: normalizeText(query?.text),
		paths: queryValues(query?.paths),
		symbols: queryValues(query?.symbols),
	};
}

function authorityRank(value) {
	return { human: 4, verified: 3, observed: 2, inferred: 1 }[value] ?? 0;
}

export function searchKnowledge(cwd, query, options = {}) {
	const normalized = normalizedQuery(query);
	const records = resolveKnowledge(cwd, options);
	const candidates = options.includeInactive
		? records
		: records.filter((record) => record.status === "live");
	const queryTokens = tokens(
		`${normalized.text} ${normalized.paths.join(" ")} ${normalized.symbols.join(" ")}`,
	);
	if (
		!queryTokens.length &&
		!normalized.paths.length &&
		!normalized.symbols.length
	)
		return [];
	const documentFrequency = new Map();
	for (const record of candidates)
		for (const token of tokens(
			`${record.claim} ${(record.paths ?? []).join(" ")} ${(record.symbols ?? []).join(" ")}`,
		))
			documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
	const count = Math.max(1, candidates.length);
	return candidates
		.map((record) => {
			const recordTokens = new Set(
				tokens(
					`${record.claim} ${(record.paths ?? []).join(" ")} ${(record.symbols ?? []).join(" ")}`,
				),
			);
			const lexical = queryTokens
				.filter((token) => recordTokens.has(token))
				.reduce(
					(sum, token) =>
						sum +
						Math.log((count + 1) / ((documentFrequency.get(token) ?? 0) + 1)) +
						1,
					0,
				);
			const symbol = normalized.symbols.find((value) =>
				(record.symbols ?? []).some(
					(item) => item.toLowerCase() === value.toLowerCase(),
				),
			);
			const path = normalized.paths.find((value) =>
				(record.paths ?? []).some((item) => {
					const expected = item.toLowerCase();
					const actual = value.toLowerCase();
					return actual === expected || actual.endsWith(`/${expected}`);
				}),
			);
			const overlap = queryTokens.filter((token) => recordTokens.has(token));
			let score = 0;
			if (overlap.length >= 2 || symbol || path)
				score = lexical + (symbol ? 30 : 0) + (path ? 20 : 0);
			let matched = "";
			if (symbol) matched = `symbol:${symbol}`;
			else if (path) matched = `path:${path}`;
			else if (score) matched = `lexical:${overlap.slice(0, 3).join(",")}`;
			return { ...record, score, matched };
		})
		.filter((record) => record.score >= Number(options.scoreFloor ?? 1))
		.sort(
			(a, b) =>
				b.score - a.score ||
				authorityRank(b.authority) - authorityRank(a.authority) ||
				String(b.recordedAt).localeCompare(String(a.recordedAt)) ||
				String(a.id).localeCompare(String(b.id)),
		)
		.slice(0, Math.min(5, Math.max(1, Number(options.limit ?? 3))));
}

export function renderKnowledge(results, options = {}) {
	const maxChars = Math.min(
		1_200,
		Math.max(200, Number(options.maxChars ?? 1_200)),
	);
	const safe = results.filter((record) => !hasSecret(record.claim)).slice(0, 5);
	if (!safe.length) return "";
	const lines = [];
	for (const record of safe) {
		const line = `- [${xmlEscape(record.id)}|${xmlEscape(record.authority)}|${xmlEscape(record.status)}|matched:${xmlEscape(record.matched || "explicit")}] ${xmlEscape(record.claim)}`;
		if (lines.length && lines.join("\n").length + line.length + 80 > maxChars)
			break;
		lines.push(line);
	}
	return lines.length
		? `<durable-knowledge untrusted="true">\n${lines.join("\n")}\n</durable-knowledge>`
		: "";
}

export function queryKnowledge(cwd, query, options = {}) {
	const normalized = normalizedQuery(query);
	const fingerprint = knowledgeFingerprint(cwd, options);
	const key = createHash("sha256")
		.update(
			JSON.stringify({
				cwd: resolve(cwd),
				fingerprint,
				normalized,
				limit: options.limit,
				minute: Math.floor(
					Date.parse(options.now ?? new Date().toISOString()) / 60_000,
				),
			}),
		)
		.digest("hex");
	if (cache.has(key)) return cache.get(key);
	const result = searchKnowledge(cwd, normalized, options);
	cache.set(key, result);
	return result;
}

export function isMachineAuthoredUserText(value) {
	const text = normalizeText(value);
	return MACHINE_MESSAGE_MARKERS.some((pattern) => pattern.test(text));
}

function messageText(value) {
	if (!value) return "";
	if (typeof value === "string") return value;
	if (Array.isArray(value))
		return value.map(messageText).filter(Boolean).join("\n");
	if (typeof value === "object")
		return messageText(value.text ?? value.content ?? value.message);
	return "";
}

export function buildKnowledgeQuery({
	messages = [],
	target,
	files,
	explicit = "",
} = {}) {
	const actualUser = messages
		.filter((message) => String(message?.role ?? "").toLowerCase() === "user")
		.map((message) =>
			normalizeText(messageText(message.content ?? message.message)),
		)
		.filter((text) => text && !isMachineAuthoredUserText(text))
		.at(-1);
	const paths = [...(files?.read ?? []), ...(files?.modified ?? [])];
	const symbols = [];
	for (const message of messages.slice(-40)) {
		for (const part of Array.isArray(message?.content) ? message.content : []) {
			if (part?.type !== "toolCall") continue;
			if (part.arguments?.path) paths.push(String(part.arguments.path));
			if (part.arguments?.symbol) symbols.push(String(part.arguments.symbol));
		}
	}
	return {
		text: [explicit, actualUser, target?.title, target?.description]
			.filter(Boolean)
			.join("\n"),
		paths: [
			...new Set(paths.map((value) => String(value).replaceAll("\\", "/"))),
		],
		symbols: [...new Set(symbols)],
	};
}

export function clearKnowledgeCache() {
	cache.clear();
}
