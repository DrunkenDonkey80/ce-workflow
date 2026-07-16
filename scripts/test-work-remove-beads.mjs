#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
	existsSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const { migrateLegacyBeads, detectWorkStoreState, MigrationError } =
	await import("../extensions/legacy-beads-migration.js");
const { buildWorkRemoveBeadsState } = await import(
	"../extensions/work-models.js"
);
const dirs = [];
const repo = () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "ce-migrate-"));
	dirs.push(dir);
	return dir;
};
const writeExport = (dir, records) => {
	mkdirSync(path.join(dir, ".beads"), { recursive: true });
	const file = path.join(dir, "legacy.jsonl");
	writeFileSync(file, records.map(JSON.stringify).join("\n") + "\n");
	return file;
};
// Sanitized from the real `bd export` shape: parents are typed dependency edges.
const records = [
	{
		_type: "issue",
		id: "ce-1",
		issue_type: "epic",
		status: "open",
		title: "Epic",
		description: "Plan work",
		acceptance_criteria: "All checks pass",
		spec_id: "docs/plans/x.md",
		created_at: "2026-01-01",
		updated_at: "2026-01-02",
		labels: ["wo:plan"],
		notes:
			"history\nwo:idea source-path=docs/brainstorms/x.md\nwo:review PASS\nwo:verify-check PASS\ncreated by /work-big",
		comments: [{ body: "comment" }],
		priority: 1,
		owner: "me",
	},
	{
		_type: "issue",
		id: "ce-1.1",
		issue_type: "task",
		status: "in_progress",
		title: "Task",
		dependencies: [
			{ issue_id: "ce-1.1", depends_on_id: "ce-1", type: "parent-child" },
			{
				issue_id: "ce-1.1",
				depends_on_id: "ce-0",
				type: "blocks",
				metadata: "{}",
			},
		],
		created_at: "2026-01-01",
		updated_at: "2026-01-03",
		started_at: "2026-01-02",
		close_reason: "proof",
		custom: "kept",
	},
	{
		id: "ce-0",
		issue_type: "bug",
		status: "closed",
		title: "Bug",
		created_at: "2026-01-01",
		updated_at: "2026-01-02",
	},
	{
		id: "ce-1.2",
		issue_type: "decision",
		status: "blocked",
		title: "Decision",
		parent_id: "ce-1",
		created_at: "2026-01-01",
		updated_at: "2026-01-02",
	},
	{
		id: "ce-1.3",
		issue_type: "idea",
		status: "open",
		title: "Idea",
		parent_id: "ce-1",
		created_at: "2026-01-01",
		updated_at: "2026-01-02",
	},
];
try {
	// Full mapping, explicit export needs no bd, preserves fields and creates validated backup.
	const dir = repo();
	const source = writeExport(dir, records);
	writeFileSync(path.join(dir, ".beads", "runtime.lock"), "ignored");
	const roleOverrides = Object.fromEntries(
		[
			"advisor",
			"advisor-backup",
			"committer",
			"debugger",
			"fixer",
			"migrator",
			"planner",
			"reviewer",
			"worker",
		].map((role) => [
			`bead-${role}`,
			{ model: `${role}-model`, fallback: "fallback", thinking: "high" },
		]),
	);
	writeFileSync(
		path.join(dir, ".pi-settings.json"),
		JSON.stringify({ subagents: { agentOverrides: roleOverrides } }),
	);
	const result = migrateLegacyBeads(dir, {
		exportPath: source,
		settingsPath: path.join(dir, ".pi-settings.json"),
	});
	assert.equal(result.action, "migrated");
	assert.equal(detectWorkStoreState(dir).state, "native");
	const store = JSON.parse(
		readFileSync(path.join(dir, ".ce-workflow", "work-items.json")),
	);
	assert.deepEqual(Object.keys(store.items), [
		"ce-0",
		"ce-1",
		"ce-1.1",
		"ce-1.2",
		"ce-1.3",
	]);
	assert.equal(store.items["ce-1.1"].parentId, "ce-1");
	assert.deepEqual(store.items["ce-1.1"].dependencies, ["ce-0"]);
	assert.deepEqual(
		store.items["ce-1.1"].dependencyEdges.map(({ toId, type }) => ({
			toId,
			type,
		})),
		[
			{ toId: "ce-1", type: "parent-child" },
			{ toId: "ce-0", type: "blocks" },
		],
	);
	assert.equal(store.items["ce-1.1"].legacy.custom, "kept");
	assert.match(store.items["ce-1"].notes.join("\n"), /history/);
	assert.equal(store.items["ce-1"].acceptance, "All checks pass");
	assert.equal(store.items["ce-1"].documentLinks.spec, "docs/plans/x.md");
	assert.equal(
		store.items["ce-1"].ideaLineage["source-path"],
		"docs/brainstorms/x.md",
	);
	assert.equal(store.items["ce-1"].executionMode, "agent");
	assert.equal(store.items["ce-1"].reviewResult, "PASS");
	assert.equal(store.items["ce-1"].verificationSummary.result, "PASS");
	const migratedSettings = JSON.parse(
		readFileSync(path.join(dir, ".pi-settings.json")),
	).subagents.agentOverrides;
	for (const role of [
		"advisor",
		"advisor-backup",
		"committer",
		"debugger",
		"fixer",
		"migrator",
		"planner",
		"reviewer",
		"worker",
	]) {
		assert.equal(migratedSettings[`work-${role}`].model, `${role}-model`);
		assert(!(`bead-${role}` in migratedSettings));
	}
	assert(existsSync(result.backup.manifest));
	assert(
		!JSON.parse(readFileSync(result.backup.manifest)).files.some((entry) =>
			entry.path.endsWith(".lock"),
		),
	);
	assert(!existsSync(path.join(dir, ".beads")));
	assert.equal(
		migrateLegacyBeads(dir, { exportPath: source }).action,
		"already-migrated",
	);
	// The registered command accepts a legacy JSONL workspace without needing bd.
	const commandDir = repo();
	mkdirSync(path.join(commandDir, ".beads"), { recursive: true });
	writeFileSync(
		path.join(commandDir, ".beads", "issues.jsonl"),
		JSON.stringify(records[0]) + "\n",
	);
	assert.equal(buildWorkRemoveBeadsState(commandDir).action, "migrated");

	// Embedded workspace uses exporter rather than a potentially stale supplied export; without it it fails safely.
	const embedded = repo();
	const stale = writeExport(embedded, records);
	mkdirSync(path.join(embedded, ".beads", "embeddeddolt"), { recursive: true });
	assert.throws(
		() =>
			migrateLegacyBeads(embedded, {
				exportPath: stale,
				exporter: () => records,
			}),
		/fresh export/,
	);
	assert.equal(
		migrateLegacyBeads(embedded, { exporter: () => records }).action,
		"migrated",
	);
	const missing = repo();
	writeExport(missing, records);
	mkdirSync(path.join(missing, ".beads", "embeddeddolt"), { recursive: true });
	const oldBd = process.env.WORK_ORCH_BD_BIN;
	process.env.WORK_ORCH_BD_BIN = path.join(missing, "missing-bd.exe");
	try {
		assert.throws(
			() => migrateLegacyBeads(missing),
			(e) => e instanceof MigrationError && e.category === "export",
		);
	} finally {
		if (oldBd === undefined) delete process.env.WORK_ORCH_BD_BIN;
		else process.env.WORK_ORCH_BD_BIN = oldBd;
	}
	assert(existsSync(path.join(missing, ".beads")));

	// Invalid records / source changes fail before publication.
	for (const bad of [
		[{ ...records[0], issue_type: "weird" }],
		[{ ...records[0], parent_id: "none" }],
		[{ ...records[0], dependencies: ["missing"] }],
		[{ ...records[0] }, { ...records[0] }],
	]) {
		const d = repo();
		const s = writeExport(d, bad);
		assert.throws(
			() => migrateLegacyBeads(d, { exportPath: s }),
			MigrationError,
		);
		assert(!existsSync(path.join(d, ".ce-workflow", "work-items.json")));
	}
	const changed = repo();
	const changedSource = writeExport(changed, records);
	assert.throws(
		() =>
			migrateLegacyBeads(changed, {
				exportPath: changedSource,
				onBeforePublish: () => writeFileSync(changedSource, "{}\n"),
			}),
		/changed/,
	);
	assert(existsSync(path.join(changed, ".beads")));

	// Any interruption retains a valid source or matching recoverable native result; rerun converges.
	for (const boundary of [
		"export",
		"candidate",
		"publish",
		"backup",
		"settings",
		"cleanup",
	]) {
		const d = repo();
		const s = writeExport(d, records);
		assert.throws(
			() => migrateLegacyBeads(d, { exportPath: s, interruptAt: boundary }),
			MigrationError,
		);
		assert.match(
			migrateLegacyBeads(d, { exportPath: s }).action,
			/^(migrated|already-migrated)$/,
		);
	}

	// A corrupt copied backup prevents publication and cleanup.
	const corruptBackup = repo();
	const corruptSource = writeExport(corruptBackup, records);
	assert.throws(
		() =>
			migrateLegacyBeads(corruptBackup, {
				exportPath: corruptSource,
				onBeforeBackupVerify: (backup) =>
					writeFileSync(path.join(backup, "export.jsonl"), "{truncated"),
			}),
		(e) => e instanceof MigrationError && e.category === "backup",
	);
	assert(
		!existsSync(path.join(corruptBackup, ".ce-workflow", "work-items.json")),
	);
	assert(existsSync(path.join(corruptBackup, ".beads")));

	// Divergent native and legacy never overwrite; unrelated dirt is untouched.
	const divergent = repo();
	const divergentSource = writeExport(divergent, records);
	mkdirSync(path.join(divergent, ".ce-workflow"), { recursive: true });
	writeFileSync(
		path.join(divergent, ".ce-workflow", "work-items.json"),
		JSON.stringify({ schemaVersion: 1, metadata: {}, items: {} }),
	);
	assert.throws(
		() => migrateLegacyBeads(divergent, { exportPath: divergentSource }),
		/divergent/,
	);
	const dirty = repo();
	const dirtySource = writeExport(dirty, records);
	writeFileSync(path.join(dirty, ".gitignore"), ".pi/\nlegacy.jsonl\n");
	writeFileSync(path.join(dirty, "product.txt"), "manual");
	writeFileSync(path.join(dirty, "untracked.txt"), "untouched");
	execFileSync("git", ["init"], { cwd: dirty, stdio: "ignore" });
	const beforeStatus = execFileSync(
		"git",
		["status", "--porcelain=v1", "--untracked-files=all"],
		{ cwd: dirty, encoding: "utf8" },
	);
	migrateLegacyBeads(dirty, { exportPath: dirtySource });
	assert.equal(readFileSync(path.join(dirty, "product.txt"), "utf8"), "manual");
	assert.equal(
		readFileSync(path.join(dirty, "untracked.txt"), "utf8"),
		"untouched",
	);
	const afterStatus = execFileSync(
		"git",
		["status", "--porcelain=v1", "--untracked-files=all"],
		{ cwd: dirty, encoding: "utf8" },
	);
	assert(afterStatus.includes(".ce-workflow/work-items.json"));
	assert(!afterStatus.includes(".pi/"));
	assert(
		beforeStatus.includes("product.txt") && afterStatus.includes("product.txt"),
	);
	const concurrent = repo();
	const concurrentSource = writeExport(concurrent, records);
	assert.throws(
		() =>
			migrateLegacyBeads(concurrent, {
				exportPath: concurrentSource,
				onBeforePublish: () =>
					writeFileSync(
						path.join(concurrent, ".beads", "config.yaml"),
						"changed",
					),
			}),
		/migration-owned path changed/,
	);
	assert(existsSync(path.join(concurrent, ".beads")));
	console.log("work-remove-beads tests passed");
} finally {
	for (const dir of dirs)
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 50,
		});
}
