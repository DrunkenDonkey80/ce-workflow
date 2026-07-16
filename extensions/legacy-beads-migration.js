import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	openSync,
	closeSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import {
	saveStore,
	storePath,
	validateStore,
	WorkStoreError,
} from "./work-store.js";

const TYPES = new Set(["epic", "task", "bug", "decision", "idea"]);
const STATUSES = new Set([
	"open",
	"in_progress",
	"closed",
	"blocked",
	"planned",
]);
const ROLE_KEYS = [
	"advisor",
	"advisor-backup",
	"committer",
	"debugger",
	"fixer",
	"migrator",
	"planner",
	"reviewer",
	"worker",
];

export class MigrationError extends Error {
	constructor(category, message, details = {}) {
		super(message);
		this.name = "MigrationError";
		this.category = category;
		Object.assign(this, details);
	}
}
const fail = (category, message, details) => {
	throw new MigrationError(category, message, details);
};
const nativePath = (cwd) => storePath(cwd);
const beadsPath = (cwd) => path.join(cwd, ".beads");
const migrationDir = (cwd) => path.join(cwd, ".pi", "work-migrations");
const hash = (value) =>
	createHash("sha256")
		.update(
			typeof value === "string" || Buffer.isBuffer(value)
				? value
				: JSON.stringify(value),
		)
		.digest("hex");
const stable = (value) =>
	value && typeof value === "object" && !Array.isArray(value)
		? Object.fromEntries(
				Object.entries(value)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([k, v]) => [k, stable(v)]),
			)
		: Array.isArray(value)
			? value.map(stable)
			: value;
const persistent = (file) =>
	!/(^|[/\\])(?:lock|socket|sockets|tmp|temp|[^/\\]*\.lock)([/\\]|$)/i.test(
		file,
	) && !/\.sock$/i.test(file);

export function detectWorkStoreState(cwd = process.cwd()) {
	const native = existsSync(nativePath(cwd));
	const legacy = existsSync(beadsPath(cwd));
	return {
		state:
			native && legacy
				? "mixed"
				: native
					? "native"
					: legacy
						? "legacy"
						: "uninitialized",
		native,
		legacy,
	};
}
function lock(cwd) {
	const file = path.join(migrationDir(cwd), "migration.lock");
	mkdirSync(path.dirname(file), { recursive: true });
	let fd;
	try {
		fd = openSync(file, "wx");
		writeFileSync(fd, `${process.pid}\n`);
	} catch (cause) {
		fail(
			cause?.code === "EEXIST" ? "locked" : "write",
			`Migration lock unavailable: ${file}`,
		);
	}
	return () => {
		closeSync(fd);
		try {
			unlinkSync(file);
		} catch (e) {
			if (e?.code !== "ENOENT") throw e;
		}
	};
}
function listFiles(dir, base = dir, files = []) {
	for (const name of readdirSync(dir)) {
		const absolute = path.join(dir, name);
		const rel = path.relative(base, absolute).replaceAll("\\", "/");
		const stat = statSync(absolute);
		if (stat.isDirectory()) listFiles(absolute, base, files);
		else if (persistent(rel)) files.push(rel);
	}
	return files.sort();
}
function sourceIdentity(cwd, exportPath) {
	if (exportPath) return hash(readFileSync(path.resolve(cwd, exportPath)));
	const legacy = beadsPath(cwd);
	if (existsSync(legacy))
		return hash(
			listFiles(legacy).map((rel) => [
				rel,
				hash(readFileSync(path.join(legacy, rel))),
			]),
		);
	return "";
}
function hasEmbeddedDatabase(cwd) {
	return existsSync(path.join(beadsPath(cwd), "embeddeddolt"));
}
function resolveExporter() {
	const override = process.env.WORK_ORCH_BD_BIN;
	const bin = override || "bd";
	if (process.platform === "win32") {
		const dirs = override
			? [path.dirname(path.resolve(override))]
			: (process.env.PATH ?? "").split(path.delimiter);
		for (const dir of dirs) {
			const candidate = path.join(
				dir,
				"node_modules",
				"@beads",
				"bd",
				"bin",
				"bd.js",
			);
			if (existsSync(candidate))
				return { command: process.execPath, prefix: [candidate] };
		}
	}
	return { command: bin, prefix: [] };
}
function parseExport(text) {
	const trimmed = text.trim();
	if (!trimmed) fail("export", "Legacy exporter returned no records");
	try {
		const parsed = JSON.parse(trimmed);
		if (Array.isArray(parsed)) return parsed;
		if (Array.isArray(parsed.issues)) return parsed.issues;
	} catch {}
	const records = [];
	for (const line of trimmed.split(/\r?\n/)) {
		try {
			records.push(JSON.parse(line));
		} catch {
			fail("export", "Legacy export contains malformed JSONL");
		}
	}
	return records;
}
function exportRecords(cwd, options) {
	if (hasEmbeddedDatabase(cwd)) {
		if (options.exportPath)
			fail(
				"export",
				"An embedded Beads database requires a fresh export, not a supplied JSONL file",
			);
		if (options.exporter) return options.exporter();
		const { command, prefix } = resolveExporter();
		try {
			return parseExport(
				execFileSync(command, [...prefix, "export"], {
					cwd,
					encoding: "utf8",
					timeout: 30000,
					stdio: ["ignore", "pipe", "pipe"],
				}),
			);
		} catch (cause) {
			fail(
				"export",
				`Fresh legacy export failed; leave .beads intact and install the legacy exporter: ${cause.message}`,
			);
		}
	}
	if (options.exporter) return options.exporter();
	const exportPath =
		options.exportPath ??
		[
			path.join(beadsPath(cwd), "issues.jsonl"),
			path.join(beadsPath(cwd), "export.jsonl"),
		].find(existsSync);
	if (!exportPath)
		fail(
			"export",
			"Legacy workspace has no embedded database; supply an explicit JSONL export",
		);
	return parseExport(readFileSync(path.resolve(cwd, exportPath), "utf8"));
}
function relationships(record) {
	const raw =
		record.dependencies ?? record.depends_on ?? record.dependency_ids ?? [];
	if (!Array.isArray(raw))
		fail("parity", `Invalid dependencies for ${record.id}`);
	const edges = raw.map((entry) => {
		const source = typeof entry === "string" ? {} : entry;
		const toId =
			typeof entry === "string"
				? entry
				: (source?.depends_on_id ?? source?.id ?? source?.dependency_id);
		const fromId = source?.issue_id ?? record.id;
		const type = source?.type ?? "blocks";
		if (
			typeof toId !== "string" ||
			!toId ||
			fromId !== record.id ||
			typeof type !== "string" ||
			!type
		)
			fail("parity", `Invalid dependency for ${record.id}`);
		return {
			fromId,
			toId,
			type,
			...(source?.created_at ? { createdAt: source.created_at } : {}),
			...(source?.created_by ? { createdBy: source.created_by } : {}),
			...(source?.metadata !== undefined ? { metadata: source.metadata } : {}),
		};
	});
	const parentEdges = edges.filter((edge) => edge.type === "parent-child");
	if (parentEdges.length > 1)
		fail("parity", `Multiple parents for ${record.id}`);
	const explicitParent = record.parent_id ?? record.parentId;
	if (
		explicitParent &&
		parentEdges[0] &&
		explicitParent !== parentEdges[0].toId
	)
		fail("parity", `Conflicting parents for ${record.id}`);
	const parentId = explicitParent ?? parentEdges[0]?.toId;
	return {
		edges,
		parentId,
		dependencies: edges
			.filter((edge) => /^blocks?$/i.test(edge.type) && edge.toId !== parentId)
			.map((edge) => edge.toId),
	};
}
function notes(record) {
	const out = [];
	for (const value of [record.notes, record.comments]) {
		if (value === undefined || value === null) continue;
		if (Array.isArray(value))
			out.push(
				...value.map((item) =>
					typeof item === "string" ? item : JSON.stringify(item),
				),
			);
		else out.push(typeof value === "string" ? value : JSON.stringify(value));
	}
	return out;
}
function recognizedFields(record, durableNotes) {
	const text = durableNotes.join("\n");
	const ideaLineage = {};
	for (const match of text.matchAll(/^\s*wo:idea(?:\s+|:)(.*)$/gim))
		for (const part of match[1].split(/\s+/)) {
			const [key, ...value] = part.split("=");
			if (key && value.length)
				ideaLineage[key.replaceAll("_", "-")] = value
					.join("=")
					.replace(/^["']|["']$/g, "");
		}
	const review = [
		...text.matchAll(/(?:wo:review|review(?: result)?):?\s*(PASS|FAIL)\b/gi),
	]
		.at(-1)?.[1]
		?.toUpperCase();
	const verification = /wo:verify-check\s+(PASS|FAIL)\b/i
		.exec(text)?.[1]
		?.toUpperCase();
	let executionMode = record.executionMode ?? record.execution_mode;
	if (!executionMode)
		executionMode = /wo:execution-agent|created by \/work-big|big slice/i.test(
			text,
		)
			? "agent"
			: /wo:execution-inline|created by \/work-med/i.test(text)
				? "inline-medium"
				: /created by \/work-small/i.test(text)
					? "inline-small"
					: "auto";
	return {
		executionMode,
		...(Object.keys(ideaLineage).length ? { ideaLineage } : {}),
		...(review ? { reviewResult: review } : {}),
		...(verification
			? { verificationSummary: { result: verification, source: "legacy-note" } }
			: {}),
	};
}
function mapRecords(records) {
	if (!Array.isArray(records) || !records.length)
		fail("export", "Legacy export has no workflow records");
	const items = {};
	for (const record of records) {
		if (!record || typeof record !== "object")
			fail("parity", "Legacy export has malformed record");
		const id = record.id;
		const type = record.issue_type ?? record.type;
		const status = record.status;
		if (typeof id !== "string" || !id || items[id])
			fail("parity", `Invalid or duplicate legacy record ID: ${id}`);
		if (!TYPES.has(type))
			fail("parity", `Unsupported legacy record type for ${id}: ${type}`);
		if (!STATUSES.has(status))
			fail("parity", `Unsupported legacy record status for ${id}: ${status}`);
		const relationship = relationships(record);
		const durableNotes = notes(record);
		const closeEvidence = record.close_reason ?? record.closeReason;
		const links = {
			...(record.spec_id ? { spec: record.spec_id } : {}),
			...(record.design !== undefined ? { design: record.design } : {}),
			...(record.document_links ?? record.documentLinks ?? {}),
		};
		const item = {
			id,
			type,
			status,
			title: String(record.title ?? ""),
			createdAt: record.created_at ?? record.createdAt ?? "",
			updatedAt: record.updated_at ?? record.updatedAt ?? "",
			...((record.started_at ?? record.startedAt)
				? { startedAt: record.started_at ?? record.startedAt }
				: {}),
			...((record.closed_at ?? record.closedAt)
				? { closedAt: record.closed_at ?? record.closedAt }
				: {}),
			dependencies: relationship.dependencies,
			dependencyEdges: relationship.edges,
			labels: Array.isArray(record.labels) ? [...record.labels] : [],
			notes: durableNotes,
			evidence: [],
			...(relationship.parentId ? { parentId: relationship.parentId } : {}),
			...(record.description !== undefined
				? { description: record.description }
				: {}),
			...((record.acceptance_criteria ?? record.acceptance)
				? { acceptance: record.acceptance_criteria ?? record.acceptance }
				: {}),
			...(record.owner !== undefined ? { owner: record.owner } : {}),
			...(record.priority !== undefined ? { priority: record.priority } : {}),
			...(Object.keys(links).length
				? { documentLinks: structuredClone(links) }
				: {}),
			...recognizedFields(record, durableNotes),
			legacy: structuredClone(record),
		};
		if (closeEvidence) item.evidence.push({ closeEvidence });
		items[id] = item;
	}
	const store = {
		schemaVersion: 1,
		metadata: { migratedFrom: "beads", migration: {} },
		items,
	};
	try {
		validateStore(store);
	} catch (cause) {
		if (cause instanceof WorkStoreError) fail("parity", cause.message);
		throw cause;
	}
	return store;
}
function copyBackup(cwd, exportText, fingerprint, options) {
	const dir = path.join(
		migrationDir(cwd),
		`legacy-${fingerprint.slice(0, 12)}`,
	);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	if (existsSync(beadsPath(cwd)))
		cpSync(beadsPath(cwd), path.join(dir, ".beads"), {
			recursive: true,
			filter: (source) => persistent(path.relative(beadsPath(cwd), source)),
		});
	writeFileSync(path.join(dir, "export.jsonl"), exportText);
	const files = listFiles(dir).map((rel) => ({
		path: rel,
		sha256: hash(readFileSync(path.join(dir, rel))),
	}));
	const manifest = { sourceFingerprint: fingerprint, files };
	const manifestPath = path.join(dir, "manifest.json");
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
	if (options.onBeforeBackupVerify) options.onBeforeBackupVerify(dir);
	for (const entry of files)
		if (hash(readFileSync(path.join(dir, entry.path))) !== entry.sha256)
			fail("backup", `Legacy backup verification failed: ${entry.path}`);
	parseExport(readFileSync(path.join(dir, "export.jsonl"), "utf8"));
	return { dir, manifest: manifestPath };
}
function migrateSettings(cwd, settingsPath) {
	const file = settingsPath ?? path.join(cwd, ".pi", "settings.json");
	if (!existsSync(file)) return false;
	let settings;
	try {
		settings = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		fail("settings", `Migration-owned settings are invalid: ${file}`);
	}
	const overrides = settings.subagents?.agentOverrides;
	if (!overrides) return false;
	let changed = false;
	for (const role of ROLE_KEYS) {
		const old = `bead-${role}`,
			next = `work-${role}`;
		if (overrides[old] !== undefined) {
			if (
				overrides[next] !== undefined &&
				JSON.stringify(overrides[next]) !== JSON.stringify(overrides[old])
			)
				fail("settings", `Conflicting role override keys: ${old}, ${next}`);
			overrides[next] = overrides[old];
			delete overrides[old];
			changed = true;
		}
	}
	if (changed) writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
	return changed;
}
export function migrateLegacyBeads(cwd = process.cwd(), options = {}) {
	const release = lock(cwd);
	try {
		const initial = detectWorkStoreState(cwd);
		if (initial.state === "uninitialized")
			fail("missing", "No legacy Beads workspace was detected");
		const candidate = path.join(
			path.dirname(nativePath(cwd)),
			".work-items.candidate.json",
		);
		const settingsFile =
			options.settingsPath ?? path.join(cwd, ".pi", "settings.json");
		const identity = (file) =>
			existsSync(file) ? hash(readFileSync(file)) : "missing";
		const ownedBefore = {
			legacy: existsSync(beadsPath(cwd)) ? sourceIdentity(cwd) : "missing",
			native: identity(nativePath(cwd)),
			settings: identity(settingsFile),
		};
		let records;
		let exportText;
		let sourceFingerprint;
		if (initial.state === "native") return { action: "already-migrated" };
		records = exportRecords(cwd, options);
		exportText =
			records.map((record) => JSON.stringify(record)).join("\n") + "\n";
		const store = mapRecords(records);
		sourceFingerprint = hash(stable(store.items));
		if (existsSync(candidate)) {
			try {
				const pending = JSON.parse(readFileSync(candidate, "utf8"));
				if (
					pending.metadata?.migration?.sourceFingerprint !== sourceFingerprint
				)
					fail(
						"recovery-required",
						`A divergent migration candidate already exists: ${candidate}`,
					);
				rmSync(candidate, { force: true });
			} catch (cause) {
				if (cause instanceof MigrationError) throw cause;
				fail(
					"recovery-required",
					`Unreadable migration candidate: ${candidate}`,
				);
			}
		}
		if (initial.state === "mixed") {
			const native = JSON.parse(readFileSync(nativePath(cwd), "utf8"));
			if (native.metadata?.migration?.sourceFingerprint !== sourceFingerprint)
				fail(
					"recovery-required",
					"Native and legacy work stores are divergent; neither was overwritten",
				);
		}
		if (options.interruptAt === "export")
			fail("interrupted", "Interrupted after export");
		store.metadata.migration = {
			sourceFingerprint,
			recordCount: records.length,
			exportedAt: new Date().toISOString(),
		};
		const before = sourceIdentity(cwd, options.exportPath);
		if (options.onBeforePublish) options.onBeforePublish();
		if (
			before !== sourceIdentity(cwd, options.exportPath) ||
			ownedBefore.legacy !==
				(existsSync(beadsPath(cwd)) ? sourceIdentity(cwd) : "missing") ||
			ownedBefore.native !== identity(nativePath(cwd)) ||
			ownedBefore.settings !== identity(settingsFile)
		)
			fail(
				"parity",
				"A migration-owned path changed during migration; native candidate was not published",
			);
		const backup = copyBackup(cwd, exportText, sourceFingerprint, options);
		if (options.interruptAt === "backup")
			fail("interrupted", "Interrupted after backup");
		try {
			saveStore(cwd, store, {
				interruptAt:
					options.interruptAt === "candidate" ? "candidate" : undefined,
			});
		} catch (cause) {
			if (cause instanceof WorkStoreError) fail(cause.category, cause.message);
			throw cause;
		}
		if (options.interruptAt === "candidate")
			fail("interrupted", "Interrupted after candidate write");
		if (options.interruptAt === "publish")
			fail("interrupted", "Interrupted after native publish");
		migrateSettings(cwd, options.settingsPath);
		if (options.interruptAt === "settings")
			fail("interrupted", "Interrupted after settings migration");
		rmSync(beadsPath(cwd), { recursive: true, force: true });
		if (options.interruptAt === "cleanup")
			fail("interrupted", "Interrupted after legacy cleanup");
		return { action: "migrated", store: nativePath(cwd), backup };
	} finally {
		release();
	}
}
