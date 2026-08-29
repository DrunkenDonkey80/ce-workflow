#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	createWorkItem,
	initStore,
	loadStore,
	saveStore,
} from "../extensions/work-store.js";

const helper = realpathSync(path.join(import.meta.dirname, "work-helper.mjs"));
const cwd = mkdtempSync(path.join(tmpdir(), "work-helper-contract-"));
const previousConfigDir = process.env.PI_CODING_AGENT_DIR;
const globalSettingsDir = mkdtempSync(
	path.join(tmpdir(), "work-helper-global-settings-"),
);
process.env.PI_CODING_AGENT_DIR = globalSettingsDir;
const previousFormatterBin = process.env.WORK_ORCH_FORMATTER_BIN;
const fixtureFormatter = path.join(globalSettingsDir, "formatter.mjs");
writeFileSync(fixtureFormatter, "#!/usr/bin/env node\n");
process.env.WORK_ORCH_FORMATTER_BIN = fixtureFormatter;
const runFrom = (root, ...args) =>
	execFileSync(process.execPath, [helper, ...args], {
		cwd: root,
		encoding: "utf8",
	});
const run = (...args) => runFrom(cwd, ...args);
const head = (root) =>
	execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim();
const failureFrom = (root, ...args) => {
	try {
		runFrom(root, ...args);
		assert.fail("command should fail");
	} catch (error) {
		if (!error.stdout) throw error;
		return JSON.parse(String(error.stdout)).error;
	}
};
const failure = (...args) => failureFrom(cwd, ...args);
const verifyArgs = [
	"--verify",
	`"${process.execPath}" -e "process.stdout.write('ok')"`,
	"--expect",
	"ok",
];

try {
	const store = initStore(cwd);
	createWorkItem(store, {
		id: "E-1",
		type: "epic",
		status: "open",
		title: "Roadmap",
	});
	createWorkItem(store, {
		id: "PLAN-1",
		type: "task",
		status: "closed",
		title: "Planning container",
		parentId: "E-1",
		labels: ["wo:planning"],
	});
	createWorkItem(store, {
		id: "TASK-1",
		type: "task",
		status: "open",
		title: "Update authentication checks",
		parentId: "PLAN-1",
		description: "Review the implementation contract.",
		design: "Keep the change bounded.",
		acceptance: "Verification must print ok.",
		evidence: [{ kind: "worker", result: "focused tests passed" }],
	});
	saveStore(cwd, store);
	writeFileSync(path.join(cwd, "note.txt"), "bounded note file\n");
	assert.match(
		failure("work-summary", "TASK-1", "--reviewedd", "--full"),
		/unknown option: --reviewedd/,
		"unknown options cannot consume a following flag",
	);
	assert.match(
		failure(
			"finish-task",
			"TASK-1",
			"--verify",
			verifyArgs[1],
			"--expect",
		),
		/missing value for --expect/,
		"a trailing value option cannot disable a finish gate",
	);
	assert.match(
		failure("finish-task", "TASK-1", "--message", "--push"),
		/missing value for --message/,
		"a value option cannot consume a following flag",
	);
	assert.match(
		JSON.parse(run("work-note", "TASK-1", "--note-file", "note.txt")).notes_tail,
		/bounded note file/,
		"work-note reads a repository-contained note file",
	);
	assert.match(
		JSON.parse(run("work-note", "TASK-1", "--reviewed literal note"))
			.notes_tail,
		/--reviewed literal note/,
		"work-note treats option-looking note text as opaque",
	);
	writeFileSync(path.join(cwd, "..notes.txt"), "dot-prefixed note file\n");
	assert.match(
		JSON.parse(run("work-note", "TASK-1", "--note-file", "..notes.txt"))
			.notes_tail,
		/dot-prefixed note file/,
		"work-note accepts a contained basename beginning with two dots",
	);
	assert.match(
		failure("work-note", "TASK-1", "--note-file", path.join(cwd, "note.txt")),
		/repository-contained file up to 1 MiB/,
		"work-note rejects absolute note-file paths",
	);
	writeFileSync(
		path.join(cwd, "oversized-note.txt"),
		"x".repeat(1024 * 1024 + 1),
	);
	assert.match(
		failure("work-note", "TASK-1", "--note-file", "oversized-note.txt"),
		/repository-contained file up to 1 MiB/,
		"work-note rejects oversized note files",
	);
	rmSync(path.join(cwd, "note.txt"));
	rmSync(path.join(cwd, "..notes.txt"));
	rmSync(path.join(cwd, "oversized-note.txt"));

	const summary = JSON.parse(run("work-summary", "TASK-1"));
	assert.equal(summary.description, "Review the implementation contract.");
	assert.equal(summary.acceptance, "Verification must print ok.");
	assert.equal(summary.evidence_tail[0].result, "focused tests passed");
	assert.deepEqual(
		JSON.parse(run("work-ready-summary", "E-1")).map((item) => item.id),
		["TASK-1"],
		"ready summaries include executable grandchildren",
	);
	writeFileSync(
		path.join(cwd, "assertion.json"),
		'{"status":"ok","--forbid-string":"present"}\n',
	);
	assert.match(
		failure("json-assert", "assertion.json", "--required", "--forbid-string"),
		/missing value for --required, --forbid-string/,
		"value options cannot consume following value options",
	);
	assert.match(
		failure("json-assert", "assertion.json", "--forbid-string"),
		/missing value for --forbid-string/,
		"json-assert rejects a missing --forbid-string value",
	);
	for (const [args, expected] of [
		[["--required", "missing"], "missing missing"],
		[["--equals", "status=NO"], "status != NO"],
		[["--equals", "status"], "invalid --equals status"],
		[["--forbid-string", "ok"], "forbidden string ok"],
	]) {
		let failure;
		try {
			run("json-assert", "assertion.json", ...args);
		} catch (error) {
			failure = JSON.parse(String(error.stdout));
		}
		assert.deepEqual(failure?.failed_assertions, [expected]);
	}
	rmSync(path.join(cwd, "assertion.json"));

	const agentsFile = path.join(cwd, "AGENTS.md");
	const beginMarker = "<!-- BEGIN COMPOUND PI TOOL MAP -->";
	const endMarker = "<!-- END COMPOUND PI TOOL MAP -->";
	const validInstructions = `before\n${beginMarker}\nlegacy\n${endMarker}\nafter\n`;
	writeFileSync(agentsFile, validInstructions);
	const legacyPreview = JSON.parse(
		run("legacy-instructions-preview", "AGENTS.md"),
	);
	assert.equal(legacyPreview.status, "preview");
	assert.equal(legacyPreview.result, "before\nafter\n");
	assert.equal(
		JSON.parse(
			run("legacy-instructions-apply", "AGENTS.md", "--confirm", "stale"),
		).reason,
		"confirmation-mismatch",
	);
	assert.equal(
		readFileSync(agentsFile, "utf8"),
		validInstructions,
		"a stale confirmation leaves AGENTS.md unchanged",
	);
	assert.equal(
		JSON.parse(
			run(
				"legacy-instructions-apply",
				"AGENTS.md",
				"--confirm",
				legacyPreview.confirmation,
			),
		).status,
		"applied",
	);
	assert.equal(readFileSync(agentsFile, "utf8"), "before\nafter\n");
	for (const [text, reason] of [
		[`prefix ${beginMarker}\n${endMarker}\n`, "malformed-markers"],
		[
			`${beginMarker}\n${endMarker}\n${beginMarker}\n${endMarker}\n`,
			"duplicated-markers",
		],
		[`${endMarker}\n${beginMarker}\n`, "reversed-markers"],
	]) {
		writeFileSync(agentsFile, text);
		assert.equal(
			JSON.parse(run("legacy-instructions-preview", "AGENTS.md")).reason,
			reason,
		);
	}
	rmSync(agentsFile);

	execFileSync("git", ["init"], { cwd, stdio: "ignore" });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
	execFileSync("git", ["config", "user.name", "Test"], { cwd });
	writeFileSync(path.join(cwd, "source.js"), "export default false;\n");
	writeFileSync(path.join(cwd, ".gitignore"), "node_modules/\n");
	writeFileSync(path.join(cwd, "format"), "process.exit(0);\n");
	execFileSync("git", ["add", "-A"], { cwd });
	execFileSync("git", ["commit", "-m", "initial"], { cwd, stdio: "ignore" });

	const stagedStoreFile = path.join(cwd, ".ce-workflow", "guard.json");
	const stagedSourceFile = path.join(cwd, "guard-source.js");
	writeFileSync(stagedStoreFile, "{}\n");
	writeFileSync(stagedSourceFile, "export {};\n");
	execFileSync("git", ["add", ".ce-workflow/guard.json", "guard-source.js"], {
		cwd,
	});
	assert.deepEqual(
		JSON.parse(run("ensure-no-staged", "--allow-work-store")),
		{
			status: "FAIL",
			unstaged: [".ce-workflow/guard.json"],
			remaining_staged: ["guard-source.js"],
		},
		"ensure-no-staged unstages only work-store files",
	);
	execFileSync("git", ["reset", "--", "guard-source.js"], { cwd });
	rmSync(stagedStoreFile);
	rmSync(stagedSourceFile);
	assert.equal(
		JSON.parse(run("ensure-no-staged", "--allow-work-store")).status,
		"PASS",
		"ensure-no-staged passes after allowed and source paths are clear",
	);

	writeFileSync(path.join(cwd, "source.js"), "export default true;\n");
	writeFileSync(path.join(cwd, ".gitignore"), "node_modules/\nlocal-cache/\n");
	mkdirSync(path.join(cwd, ".ce-workflow", "work-runs", "verifiers"), {
		recursive: true,
	});
	writeFileSync(
		path.join(cwd, ".ce-workflow", "work-runs", "verifiers", "state.json"),
		"{}\n",
	);
	const mutationLock = path.join(
		cwd,
		".ce-workflow",
		"work-runs",
		"repository-mutation.lock",
	);
	const invalidFinishFile = (option, file) =>
		failure(
			"finish-task",
			"TASK-1",
			"--max-files",
			"2",
			"--message",
			"reject undeclared path",
			...verifyArgs,
			option,
			file,
		);
	assert.match(
		invalidFinishFile("--implementation-file", path.join(cwd, "source.js")),
		/invalid implementation file/,
		"absolute implementation paths are rejected",
	);
	const outsideImplementation = path.join(
		path.dirname(cwd),
		`${path.basename(cwd)}-outside.js`,
	);
	try {
		writeFileSync(outsideImplementation, "export default 'outside';\n");
		assert.match(
			invalidFinishFile(
				"--implementation-file",
				`../${path.basename(outsideImplementation)}`,
			),
			/invalid implementation file/,
			"parent escapes are rejected even when the target exists",
		);
	} finally {
		rmSync(outsideImplementation, { force: true });
	}
	assert.match(
		invalidFinishFile(
			"--implementation-file",
			".ce-workflow/work-runs/verifiers/state.json",
		),
		/invalid implementation file/,
		"workflow runtime paths cannot be declared as implementation files",
	);
	mkdirSync(path.join(cwd, "docs", "evidence", "TASK-1"), {
		recursive: true,
	});
	const wrongEvidence = "docs/evidence/TASK-1/unsafe.js";
	writeFileSync(path.join(cwd, wrongEvidence), "export default true;\n");
	assert.match(
		invalidFinishFile("--evidence-file", wrongEvidence),
		/invalid evidence file/,
		"evidence files reject executable extensions",
	);
	rmSync(path.join(cwd, wrongEvidence));
	assert.match(
		invalidFinishFile("--evidence-file", "source.js"),
		/invalid evidence file/,
		"evidence files must stay under the task-owned evidence prefix",
	);
	assert.match(
		failure(
			"finish-task",
			"TASK-1",
			"--max-files",
			"2",
			"--message",
			"reject malformed verifier",
			"--verify",
			'"bash',
		),
		/unmatched shell quote/,
		"malformed verifier commands fail before taking the repository lock",
	);
	assert.equal(existsSync(mutationLock), false);
	assert.match(
		failure(
			"finish-task",
			"TASK-1",
			"--max-files",
			"2",
			"--message",
			"reject competing verification modes",
			"--verify",
			verifyArgs[1],
			"--verify-shard",
			JSON.stringify({ id: "only", command: verifyArgs[1] }),
			"--json",
			"missing.json",
		),
		/--verify cannot be combined with --json/,
		"command and JSON verification cannot bypass one another",
	);
	assert.equal(
		existsSync(mutationLock),
		false,
		"competing verification modes fail before taking the repository lock",
	);
	assert.match(
		failure(
			"finish-task",
			"TASK-1",
			"--max-files",
			"2",
			"--message",
			"reject interactive verifier",
			"--verify",
			"bash",
		),
		/bare interactive shell/,
		"bare interactive verifier shells fail before taking the repository lock",
	);
	assert.equal(existsSync(mutationLock), false);
	const previousTimeout = process.env.WORK_ORCH_VERIFY_TIMEOUT_MS;
	try {
		process.env.WORK_ORCH_VERIFY_TIMEOUT_MS = "100";
		const hangingVerification = `"${process.execPath}" -e "setInterval(() => {}, 1000)"`;
		assert.match(
			failure(
				"finish-task",
				"TASK-1",
				"--max-files",
				"2",
				"--message",
				"bound hanging verifier",
				"--verify",
				hangingVerification,
			),
			/verification timed out after 100ms/,
			"hanging verifier commands are terminated at the configured timeout",
		);
		const shardStartedAt = Date.now();
		assert.match(
			failure(
				"finish-task",
				"TASK-1",
				"--max-files",
				"2",
				"--message",
				"bound hanging verifier shard",
				"--verify",
				hangingVerification,
				"--verify-shard",
				JSON.stringify({ id: "hanging", command: hangingVerification }),
			),
			/Required verification shard hanging did not pass/,
			"a timed-out required shard blocks finalization",
		);
		assert.ok(
			Date.now() - shardStartedAt < 5_000,
			"the hanging shard returns within the configured timeout budget",
		);
	} finally {
		if (previousTimeout === undefined)
			delete process.env.WORK_ORCH_VERIFY_TIMEOUT_MS;
		else process.env.WORK_ORCH_VERIFY_TIMEOUT_MS = previousTimeout;
	}
	assert.equal(
		existsSync(mutationLock),
		false,
		"timed-out verification releases the repository lock",
	);
	assert.match(
		failure(
			"finish-task",
			"TASK-1",
			"--max-files",
			"2",
			"--message",
			"reject nonempty verification output",
			"--verify",
			`"${process.execPath}" -e "process.stdout.write('not-empty')"`,
			"--expect",
			"",
		),
		/verification failed/,
		"an empty --expect still asserts empty verification output",
	);
	const handoff = failure(
		"finish-task",
		"TASK-1",
		"--max-files",
		"2",
		"--message",
		"scope finalization",
		...verifyArgs,
	);
	assert.match(
		handoff,
		/Review only: "\.gitignore", "source\.js"|Review only: "source\.js", "\.gitignore"/,
	);
	const canonicalReviewRoot = JSON.stringify(realpathSync(cwd));
	assert.ok(
		handoff.includes(`Execution repository: ${canonicalReviewRoot}`) &&
			handoff.includes(
				`git -C ${canonicalReviewRoot} rev-parse --show-toplevel`,
			) &&
			handoff.includes("Summary command (from execution repository):"),
		"same-root review handoffs pin and verify the execution repository",
	);
	assert.match(
		handoff,
		/work-note "TASK-1" --append-notes "wo:review PASS/,
		"review handoffs provide the exact supported verdict command",
	);
	assert.match(handoff, /work-summary "TASK-1".*notes_tail/);
	assert.match(handoff, /Do not use --body or shell redirection to nul\/NUL/);
	assert.doesNotMatch(handoff, /work-runs/);
	assert.match(
		loadStore(cwd).items["TASK-1"].notes.join("\n"),
		/wo:review-scope/,
		"the coded handoff persists its exact review scope",
	);

	const reviewed = loadStore(cwd);
	const scopeNote = reviewed.items["TASK-1"].notes.find((note) =>
		note.startsWith("wo:review-scope "),
	);
	reviewed.items["TASK-1"].notes = reviewed.items["TASK-1"].notes.map((note) =>
		note === scopeNote ? 'wo:review-scope {"files":"source.js"}' : note,
	);
	saveStore(cwd, reviewed);
	const malformedScope = failure(
		"finish-task",
		"TASK-1",
		"--max-files",
		"2",
		"--message",
		"scope finalization",
		...verifyArgs,
		"--reviewed",
	);
	assert.match(
		malformedScope,
		/invalid persisted wo:review-scope .*expected files and fingerprint/,
	);
	assert.doesNotMatch(malformedScope, /iterable/);
	reviewed.items["TASK-1"].notes = reviewed.items["TASK-1"].notes.filter(
		(note) => !note.startsWith("wo:review-scope "),
	);
	reviewed.items["TASK-1"].notes.push("wo:review PASS - scoped diff approved");
	saveStore(cwd, reviewed);
	assert.match(
		failure(
			"finish-task",
			"TASK-1",
			"--max-files",
			"2",
			"--message",
			"scope finalization",
			...verifyArgs,
			"--reviewed",
		),
		/requires a persisted wo:review-scope/,
	);
	const scoped = loadStore(cwd);
	scoped.items["TASK-1"].notes.push(scopeNote);
	saveStore(cwd, scoped);
	assert.match(
		failure(
			"finish-task",
			"TASK-1",
			"--max-files",
			"2",
			"--message",
			"scope finalization",
			...verifyArgs,
			"--reviewed",
		),
		/durable wo:review PASS evidence/,
		"a PASS before the latest review scope is stale",
	);
	const freshlyReviewed = loadStore(cwd);
	freshlyReviewed.items["TASK-1"].notes.push(
		"wo:review PASS - latest scoped diff approved",
	);
	saveStore(cwd, freshlyReviewed);
	writeFileSync(
		path.join(cwd, "source.js"),
		"export default 'changed after review';\n",
	);
	assert.match(
		failure(
			"finish-task",
			"TASK-1",
			"--max-files",
			"2",
			"--message",
			"scope finalization",
			...verifyArgs,
			"--reviewed",
		),
		/reviewed file content changed/,
		"same-path content changes invalidate prior review",
	);
	writeFileSync(path.join(cwd, "source.js"), "export default true;\n");
	writeFileSync(path.join(cwd, "extra.js"), "export default true;\n");
	assert.match(
		failure(
			"finish-task",
			"TASK-1",
			"--max-files",
			"3",
			"--message",
			"scope finalization",
			...verifyArgs,
			"--reviewed",
		),
		/review scope changed/,
	);
	rmSync(path.join(cwd, "extra.js"));
	const previousFormatter = process.env.WORK_ORCH_FORMATTER_BIN;
	let finished;
	try {
		process.env.WORK_ORCH_FORMATTER_BIN = process.execPath;
		finished = JSON.parse(
			run(
				"finish-task",
				"TASK-1",
				"--max-files",
				"2",
				"--message",
				"scope finalization",
				...verifyArgs,
				"--immediate-format",
				"--reviewed",
			),
		);
	} finally {
		if (previousFormatter === undefined)
			delete process.env.WORK_ORCH_FORMATTER_BIN;
		else process.env.WORK_ORCH_FORMATTER_BIN = previousFormatter;
	}
	assert.equal(finished.status, "PASS");
	assert.deepEqual(
		finished.formatted.sort(),
		["source.js"],
		"immediate-format reports the formatter-eligible changed files",
	);
	assert.doesNotMatch(
		execFileSync("git", ["show", "--pretty=", "--name-only", "HEAD"], {
			cwd,
			encoding: "utf8",
		}),
		/work-runs/,
		"workflow runtime files never enter the task commit",
	);

	const ownedFileStore = loadStore(cwd);
	createWorkItem(ownedFileStore, {
		id: "TASK-OWNED",
		type: "task",
		status: "open",
		title: "Commit a declared implementation file",
		acceptance: "The declared task-owned file is reviewed and committed.",
	});
	saveStore(cwd, ownedFileStore);
	writeFileSync(path.join(cwd, "owned-new.js"), "export default 'owned';\n");
	const ownedFinished = JSON.parse(
		run(
			"finish-task",
			"TASK-OWNED",
			"--max-files",
			"1",
			"--message",
			"commit declared implementation",
			...verifyArgs,
			"--implementation-file",
			"owned-new.js",
		),
	);
	assert.equal(ownedFinished.status, "PASS");
	assert.match(
		execFileSync("git", ["show", "--pretty=", "--name-only", "HEAD"], {
			cwd,
			encoding: "utf8",
		}),
		/^owned-new\.js$/m,
		"the accepted declared implementation file is committed",
	);

	const storeOnly = loadStore(cwd);
	createWorkItem(storeOnly, {
		id: "TASK-EMPTY",
		type: "task",
		status: "open",
		title: "Close already committed verifier tracking",
		acceptance: "Store-only completion; no production behavior changes.",
	});
	saveStore(cwd, storeOnly);
	const storeOnlyFinished = JSON.parse(
		run(
			"finish-task",
			"TASK-EMPTY",
			"--max-files",
			"1",
			"--message",
			"finish store-only tracking",
			...verifyArgs,
			"--push",
		),
	);
	assert.equal(storeOnlyFinished.status, "PASS");
	assert.equal(
		storeOnlyFinished.push,
		"skipped-no-upstream",
		"same-root push skips cleanly when no upstream is configured",
	);
	const closedStoreOnly = loadStore(cwd).items["TASK-EMPTY"];
	assert.equal(closedStoreOnly.status, "closed");
	assert.equal(
		closedStoreOnly.notes.some((note) => note.startsWith("wo:review-scope ")),
		false,
		"store-only completion never emits an empty review scope",
	);

	const pushRemote = mkdtempSync(path.join(tmpdir(), "work-helper-push-"));
	try {
		execFileSync("git", ["init", "--bare", "-q"], { cwd: pushRemote });
		execFileSync("git", ["remote", "add", "origin", pushRemote], { cwd });
		const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
			cwd,
			encoding: "utf8",
		}).trim();
		execFileSync("git", ["push", "-u", "origin", `HEAD:refs/heads/${branch}`], {
			cwd,
			stdio: "ignore",
		});
		const pushStore = loadStore(cwd);
		createWorkItem(pushStore, {
			id: "TASK-PUSH",
			type: "task",
			status: "open",
			title: "Push finalized metadata",
			acceptance: "The finalized commit reaches the configured upstream.",
		});
		saveStore(cwd, pushStore);
		const pushed = JSON.parse(
			run(
				"finish-task",
				"TASK-PUSH",
				"--max-files",
				"1",
				"--message",
				"push finalized metadata",
				...verifyArgs,
				"--push",
			),
		);
		assert.equal(pushed.push, "passed");
		assert.equal(
			execFileSync("git", ["rev-parse", `refs/heads/${branch}`], {
				cwd: pushRemote,
				encoding: "utf8",
			}).trim(),
			head(cwd),
			"same-root push updates the configured upstream",
		);
		execFileSync("git", ["remote", "remove", "origin"], { cwd });
	} finally {
		rmSync(pushRemote, { recursive: true, force: true });
	}

	writeFileSync(path.join(cwd, "residual.js"), "export default false;\n");
	const residualStore = loadStore(cwd);
	createWorkItem(residualStore, {
		id: "TASK-2",
		type: "task",
		status: "open",
		title: "Update authentication residual",
		notes: [
			'wo:review-scope ["residual.js"]',
			'wo:review FAIL {"findings":["residual A","residual B"]}',
			"wo:fix PASS - targeted fixes",
			"wo:review PASS - targeted re-review",
			'wo:review-scope ["residual.js"]',
			"wo:fix PASS - residual ownership fix",
		],
	});
	saveStore(cwd, residualStore);
	execFileSync("git", ["add", "residual.js", ".ce-workflow/work-items.json"], {
		cwd,
	});
	execFileSync("git", ["commit", "-m", "residual baseline"], {
		cwd,
		stdio: "ignore",
	});
	writeFileSync(path.join(cwd, "residual.js"), "export default true;\n");
	assert.match(
		failure(
			"finish-task",
			"TASK-2",
			"--max-files",
			"1",
			"--message",
			"refresh residual review scope",
			...verifyArgs,
		),
		/Review only:/,
		"legacy review scope is refreshed with a content fingerprint",
	);
	assert.match(
		failure(
			"finish-task",
			"TASK-2",
			"--max-files",
			"1",
			"--message",
			"finish residual fixes",
			...verifyArgs,
			"--reviewed",
		),
		/verified residual fix/,
		"generic fixer PASS does not disposition targeted re-review findings",
	);
	const dispositionStore = loadStore(cwd);
	const residualDisposition =
		'wo:residual-fix PASS {"dispositions":[{"finding":"residual A","fix":"guard added","evidence":"focused test A passed"},{"finding":"residual B","fix":"scope check added","evidence":"focused test B passed"}]}';
	dispositionStore.items["TASK-2"].notes.push(residualDisposition);
	saveStore(cwd, dispositionStore);
	writeFileSync(path.join(cwd, "residual.js"), "export default 2;\n");
	assert.match(
		failure(
			"finish-task",
			"TASK-2",
			"--max-files",
			"1",
			"--message",
			"reject stale residual disposition",
			...verifyArgs,
		),
		/Review only:/,
		"same-path content changes invalidate a residual disposition",
	);
	const refreshedResidualStore = loadStore(cwd);
	refreshedResidualStore.items["TASK-2"].notes.push(residualDisposition);
	saveStore(cwd, refreshedResidualStore);
	assert.match(
		failure(
			"finish-task",
			"TASK-2",
			"--max-files",
			"1",
			"--message",
			"reject unreviewed residual scope",
			...verifyArgs,
			"--reviewed",
		),
		/durable wo:review PASS evidence/,
		"an old residual disposition cannot authorize a fresh production scope",
	);
	const reviewedResidualStore = loadStore(cwd);
	reviewedResidualStore.items["TASK-2"].notes.push(
		"wo:review PASS - refreshed content approved",
	);
	saveStore(cwd, reviewedResidualStore);
	const residualFinished = JSON.parse(
		run(
			"finish-task",
			"TASK-2",
			"--max-files",
			"1",
			"--message",
			"finish reviewed residual fixes",
			...verifyArgs,
			"--reviewed",
		),
	);
	assert.equal(residualFinished.status, "PASS");

	mkdirSync(path.join(cwd, "docs"), { recursive: true });
	writeFileSync(path.join(cwd, "docs", "mechanical.js"), "// old wording\n");
	const mechanicalStore = loadStore(cwd);
	createWorkItem(mechanicalStore, {
		id: "TASK-3",
		type: "task",
		status: "open",
		title: "Update an authentication source comment",
		notes: [
			'wo:review-scope ["docs/mechanical.js"]',
			"wo:review FAIL - source comment date is missing",
			"wo:fix PASS - comment corrected and docs check passed",
			"ordinary prose note\nwo:review PASS - embedded marker",
		],
	});
	saveStore(cwd, mechanicalStore);
	execFileSync(
		"git",
		["add", "docs/mechanical.js", ".ce-workflow/work-items.json"],
		{
			cwd,
		},
	);
	execFileSync("git", ["commit", "-m", "mechanical baseline"], {
		cwd,
		stdio: "ignore",
	});
	writeFileSync(path.join(cwd, "docs", "mechanical.js"), "// dated wording\n");
	assert.match(
		failure(
			"finish-task",
			"TASK-3",
			"--max-files",
			"1",
			"--message",
			"--reviewed",
			...verifyArgs,
		),
		/missing value for --message/,
		"a boolean option cannot be consumed as a value",
	);
	assert.match(
		failure(
			"finish-task",
			"TASK-3",
			"--max-files",
			"1",
			"--message",
			"--verify",
			...verifyArgs,
		),
		/missing value for --message, --verify/,
		"a value option cannot shadow the real verification option",
	);
	assert.match(
		failure(
			"finish-task",
			"TASK-3",
			"--max-files",
			"1",
			"--message",
			"refresh mechanical scope",
			...verifyArgs,
		),
		/Review only:/,
		"a valid invocation persists the current review scope",
	);
	const multilineReviewStore = loadStore(cwd);
	multilineReviewStore.items["TASK-3"].notes.push(
		"wo:review FAIL\nunrelated text",
		'wo:residual-fix PASS {"dispositions":[{"finding":"unrelated text","fix":"not applicable","evidence":"not applicable"}]}',
	);
	saveStore(cwd, multilineReviewStore);
	assert.match(
		failure(
			"finish-task",
			"TASK-3",
			"--max-files",
			"1",
			"--message",
			"reject embedded review marker",
			...verifyArgs,
			"--reviewed",
		),
		/requires durable wo:review PASS/,
		"review protocol markers and FAIL payloads embedded in multiline notes are ignored",
	);
	saveStore(cwd, mechanicalStore);
	const mechanicalDispositionStore = loadStore(cwd);
	const mechanicalDisposition =
		'wo:mechanical-fix PASS {"dispositions":[{"finding":"source comment date is missing","fix":"added the required date","evidence":"documentation check passed"}]}';
	mechanicalDispositionStore.items["TASK-3"].notes.push(mechanicalDisposition);
	saveStore(cwd, mechanicalDispositionStore);
	writeFileSync(
		path.join(cwd, "docs", "mechanical.js"),
		"// changed after disposition\n",
	);
	assert.match(
		failure(
			"finish-task",
			"TASK-3",
			"--max-files",
			"1",
			"--message",
			"reject stale mechanical disposition",
			...verifyArgs,
		),
		/Review only:/,
		"same-path content changes invalidate a mechanical disposition",
	);
	const refreshedMechanicalStore = loadStore(cwd);
	refreshedMechanicalStore.items["TASK-3"].notes.push(mechanicalDisposition);
	saveStore(cwd, refreshedMechanicalStore);
	const mechanicalFinished = JSON.parse(
		run(
			"finish-task",
			"TASK-3",
			"--max-files",
			"1",
			"--message",
			"finish mechanical fix",
			...verifyArgs,
			"--reviewed",
		),
	);
	assert.equal(mechanicalFinished.status, "PASS");

	writeFileSync(path.join(cwd, "sharded.js"), "export default false;\n");
	const shardStore = loadStore(cwd);
	createWorkItem(shardStore, {
		id: "TASK-4",
		type: "task",
		status: "open",
		title: "Run declared finish shards",
		acceptance: "The exact declared verification command set passes.",
	});
	saveStore(cwd, shardStore);
	execFileSync("git", ["add", "sharded.js", ".ce-workflow/work-items.json"], {
		cwd,
	});
	execFileSync("git", ["commit", "-m", "shard baseline"], {
		cwd,
		stdio: "ignore",
	});
	writeFileSync(path.join(cwd, "sharded.js"), "export default true;\n");
	writeFileSync(
		path.join(globalSettingsDir, "settings.json"),
		`${JSON.stringify({ workPerformance: { parallelVerification: false } })}\n`,
	);
	const shardA = `${JSON.stringify(process.execPath)} -e "require('fs').mkdirSync('build-shard',{recursive:true});require('fs').appendFileSync('build-shard/order.txt','a\\n')"`;
	const shardB = `${JSON.stringify(process.execPath)} -e "require('fs').appendFileSync('build-shard/order.txt','b\\n')"`;
	assert.match(
		failure(
			"finish-task",
			"TASK-4",
			"--max-files",
			"1",
			"--message",
			"reject ignored shards",
			"--json",
			"missing.json",
			"--verify-shard",
			JSON.stringify({ id: "a", command: shardA }),
		),
		/--verify-shard requires --verify/,
		"shard declarations cannot be ignored by JSON-only verification",
	);
	assert.match(
		failure(
			"finish-task",
			"TASK-4",
			"--max-files",
			"1",
			"--message",
			"reject ambiguous expectation",
			"--verify",
			shardA,
			"--verify-shard",
			JSON.stringify({ id: "a", command: shardA }),
			"--expect",
			"ok",
		),
		/--expect cannot be combined with --verify-shard/,
		"sharded verification rejects the scalar stdout expectation",
	);
	const failedShardOutput = "./build-shard/failed.txt";
	const failingShard = `${JSON.stringify(process.execPath)} ${JSON.stringify(helper)} work-note TASK-4 --append-notes "note written during failed shard" && ${JSON.stringify(process.execPath)} -e "require('fs').mkdirSync('build-shard',{recursive:true});require('fs').writeFileSync('${failedShardOutput}','failed');process.exit(1)"`;
	assert.match(
		failure(
			"finish-task",
			"TASK-4",
			"--max-files",
			"1",
			"--message",
			"reject failed shard",
			"--verify",
			failingShard,
			"--verify-shard",
			JSON.stringify({
				id: "failing",
				command: failingShard,
				outputs: [failedShardOutput],
			}),
		),
		/verification failed/,
	);
	const failedShardNotes = loadStore(cwd).items["TASK-4"].notes;
	assert(failedShardNotes.includes("note written during failed shard"));
	assert.equal(
		failedShardNotes.filter((note) => note.startsWith("wo:verify-check FAIL"))
			.length,
		1,
		"failed shards leave one durable verification record",
	);
	assert.equal(
		existsSync(path.join(cwd, failedShardOutput)),
		false,
		"failed shard outputs absent before launch are removed",
	);

	const shardedFinished = JSON.parse(
		run(
			"finish-task",
			"TASK-4",
			"--max-files",
			"1",
			"--message",
			"finish declared shards",
			"--verify",
			`${shardA} && ${shardB}`,
			"--verify-shard",
			JSON.stringify({
				id: "a",
				command: shardA,
				outputs: ["build-shard/order.txt"],
			}),
			"--verify-shard",
			JSON.stringify({
				id: "b",
				command: shardB,
				dependsOn: ["a"],
				outputs: ["build-shard/order.txt"],
			}),
		),
	);
	assert.equal(shardedFinished.status, "PASS");
	assert.deepEqual(
		shardedFinished.verification.shards.map(({ id, status }) => ({
			id,
			status,
		})),
		[
			{ id: "a", status: "PASS" },
			{ id: "b", status: "PASS" },
		],
		"finish admits one fresh ordered shard manifest",
	);
	assert.equal(
		loadStore(cwd).items["TASK-4"].notes.filter((note) =>
			note.startsWith("wo:verify-check PASS"),
		).length,
		1,
		"finish writes one compact verification PASS note",
	);
	assert.equal(loadStore(cwd).items["TASK-4"].status, "closed");

	const subdirectoryStore = loadStore(cwd);
	createWorkItem(subdirectoryStore, {
		id: "TASK-SUBDIR",
		type: "task",
		status: "open",
		title: "Update subdirectory documentation",
		acceptance: "Documentation-only completion.",
	});
	writeFileSync(path.join(cwd, "subdirectory.md"), "before\n");
	saveStore(cwd, subdirectoryStore);
	execFileSync(
		"git",
		["add", "subdirectory.md", ".ce-workflow/work-items.json"],
		{
			cwd,
		},
	);
	execFileSync("git", ["commit", "-m", "subdirectory baseline"], {
		cwd,
		stdio: "ignore",
	});
	writeFileSync(path.join(cwd, "subdirectory.md"), "after\n");
	const nestedCwd = path.join(cwd, "nested-cwd");
	mkdirSync(nestedCwd);
	writeFileSync(path.join(cwd, ".git", "info", "exclude"), "nested-cwd/\n");
	symlinkSync(
		path.join(cwd, ".ce-workflow"),
		path.join(nestedCwd, ".ce-workflow"),
		process.platform === "win32" ? "junction" : "dir",
	);
	const subdirectoryFinished = JSON.parse(
		runFrom(
			nestedCwd,
			"finish-small",
			"TASK-SUBDIR",
			"--message",
			"finish from a repository subdirectory",
			...verifyArgs,
		),
	);
	assert.equal(subdirectoryFinished.status, "PASS");
	assert.equal(
		subdirectoryFinished.executionRepositoryRoot,
		realpathSync(cwd),
		"finish resolves repository-relative paths from the canonical Git root",
	);

	const cwdAlias = `${cwd}-alias`;
	symlinkSync(cwd, cwdAlias, process.platform === "win32" ? "junction" : "dir");
	assert.match(
		failureFrom(cwdAlias, "finish-small"),
		/usage: finish-task/,
		"an aliased cwd without --execution-root acquires the same-root lock once",
	);
	rmSync(cwdAlias, { recursive: true, force: true });

	const ownerRoot = mkdtempSync(path.join(tmpdir(), "work-helper-owner-"));
	const executionRoot = mkdtempSync(
		path.join(tmpdir(), "work-helper-execution-"),
	);
	for (const root of [ownerRoot, executionRoot]) {
		execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
		execFileSync("git", ["config", "user.email", "test@example.com"], {
			cwd: root,
		});
		execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
	}
	const crossStore = initStore(ownerRoot);
	createWorkItem(crossStore, {
		id: "CROSS-1",
		type: "task",
		status: "open",
		title: "Update companion repository",
	});
	saveStore(ownerRoot, crossStore);
	execFileSync("git", ["add", ".ce-workflow/work-items.json"], {
		cwd: ownerRoot,
	});
	execFileSync("git", ["commit", "-m", "owner baseline"], {
		cwd: ownerRoot,
		stdio: "ignore",
	});
	writeFileSync(
		path.join(executionRoot, "source.js"),
		"export default false;\n",
	);
	execFileSync("git", ["add", "source.js"], { cwd: executionRoot });
	execFileSync("git", ["commit", "-m", "execution baseline"], {
		cwd: executionRoot,
		stdio: "ignore",
	});
	writeFileSync(path.join(executionRoot, "source.js"), "export default true;\n");
	const crossFinished = JSON.parse(
		runFrom(
			ownerRoot,
			"finish-small",
			"CROSS-1",
			"--execution-root",
			executionRoot,
			"--message",
			"finish companion change",
			...verifyArgs,
		),
	);
	const closedCross = loadStore(ownerRoot).items["CROSS-1"];
	assert.equal(closedCross.status, "closed");
	assert.equal(closedCross.executionRepositoryRoot, realpathSync(executionRoot));
	assert.equal(closedCross.executionCommit, crossFinished.executionCommit);
	assert.equal(crossFinished.commit, crossFinished.executionCommit.slice(0, 7));
	assert.notEqual(crossFinished.ownerCommit, crossFinished.executionCommit);
	assert.equal(
		execFileSync("git", ["show", "--pretty=", "--name-only", "HEAD"], {
			cwd: ownerRoot,
			encoding: "utf8",
		}).trim(),
		".ce-workflow/work-items.json",
		"tracked owner metadata gets a separate store-only commit",
	);

	const reviewStore = loadStore(ownerRoot);
	createWorkItem(reviewStore, {
		id: "CROSS-REVIEW",
		type: "task",
		status: "open",
		title: "Update authentication in companion repository",
	});
	saveStore(ownerRoot, reviewStore);
	writeFileSync(path.join(executionRoot, "source.js"), "review these bytes\n");
	const ownerBeforeReview = head(ownerRoot);
	const executionBeforeReview = head(executionRoot);
	const crossReviewHandoff = failureFrom(
		ownerRoot,
		"finish-small",
		"CROSS-REVIEW",
		"--execution-root",
		executionRoot,
		"--message",
		"request companion review",
		...verifyArgs,
	);
	const canonicalExecutionRoot = JSON.stringify(realpathSync(executionRoot));
	const canonicalOwnerRoot = JSON.stringify(realpathSync(ownerRoot));
	assert.ok(
		crossReviewHandoff.includes(
			`Execution repository: ${canonicalExecutionRoot}`,
		),
	);
	assert.ok(
		crossReviewHandoff.includes(
			`Run file-inspection and repository preflight commands with ${canonicalExecutionRoot} as the current working directory.`,
		),
	);
	assert.ok(
		crossReviewHandoff.includes(
			`Run helper summary and note commands with ${canonicalOwnerRoot} as the current working directory.`,
		),
	);
	assert.ok(
		crossReviewHandoff.includes(
			`Summary command (from owner repository): cd ${canonicalOwnerRoot} && node ${JSON.stringify(helper)} work-summary CROSS-REVIEW`,
		),
	);
	assert.ok(
		crossReviewHandoff.includes(
			`Verdict command: cd ${canonicalOwnerRoot} && node ${JSON.stringify(helper)} work-note "CROSS-REVIEW"`,
		),
	);
	assert.ok(
		crossReviewHandoff.includes(
			`Verdict postcondition: rerun cd ${canonicalOwnerRoot} && node ${JSON.stringify(helper)} work-summary "CROSS-REVIEW"`,
		),
	);
	assert.ok(
		!crossReviewHandoff.includes(
			`Summary command (from execution repository): node ${JSON.stringify(helper)} work-summary CROSS-REVIEW`,
		),
	);
	assert.ok(
		crossReviewHandoff.includes(
			`Finish retry option: --execution-root ${canonicalExecutionRoot}`,
		),
	);
	assert.equal(
		head(ownerRoot),
		ownerBeforeReview,
		"review handoff does not commit the owner repository",
	);
	assert.equal(
		head(executionRoot),
		executionBeforeReview,
		"review handoff does not commit the execution repository",
	);
	execFileSync("git", ["restore", "source.js"], { cwd: executionRoot });

	const executionStore = initStore(executionRoot);
	createWorkItem(executionStore, {
		id: "OTHER-STORE",
		type: "task",
		status: "open",
		title: "Execution repository work",
	});
	saveStore(executionRoot, executionStore);
	execFileSync("git", ["add", ".ce-workflow/work-items.json"], {
		cwd: executionRoot,
	});
	execFileSync("git", ["commit", "-m", "execution store baseline"], {
		cwd: executionRoot,
		stdio: "ignore",
	});
	const foreignStoreOwner = loadStore(ownerRoot);
	createWorkItem(foreignStoreOwner, {
		id: "CROSS-FOREIGN-STORE",
		type: "task",
		status: "open",
		title: "Refuse a foreign work store",
	});
	saveStore(ownerRoot, foreignStoreOwner);
	writeFileSync(path.join(executionRoot, "source.js"), "must not commit\n");
	const changedExecutionStore = loadStore(executionRoot);
	changedExecutionStore.items["OTHER-STORE"].title = "Changed execution work";
	saveStore(executionRoot, changedExecutionStore);
	const ownerBeforeForeignStore = head(ownerRoot);
	const executionBeforeForeignStore = head(executionRoot);
	assert.match(
		failureFrom(
			ownerRoot,
			"finish-small",
			"CROSS-FOREIGN-STORE",
			"--execution-root",
			executionRoot,
			"--message",
			"reject foreign store",
			...verifyArgs,
		),
		/refusing changed \.ce-workflow\/work-items\.json in distinct execution repository/,
	);
	assert.equal(
		head(ownerRoot),
		ownerBeforeForeignStore,
		"foreign store refusal does not commit the owner repository",
	);
	assert.equal(
		head(executionRoot),
		executionBeforeForeignStore,
		"foreign store refusal does not commit the execution repository",
	);
	execFileSync("git", ["restore", "source.js", ".ce-workflow/work-items.json"], {
		cwd: executionRoot,
	});

	const pushStore = loadStore(ownerRoot);
	createWorkItem(pushStore, {
		id: "CROSS-PUSH",
		type: "task",
		status: "open",
		title: "Reject companion push",
	});
	saveStore(ownerRoot, pushStore);
	writeFileSync(
		path.join(executionRoot, "source.js"),
		"push must not commit;\n",
	);
	const ownerBeforePush = head(ownerRoot);
	const executionBeforePush = head(executionRoot);
	assert.match(
		failureFrom(
			ownerRoot,
			"finish-small",
			"CROSS-PUSH",
			"--execution-root",
			executionRoot,
			"--message",
			"reject companion push",
			...verifyArgs,
			"--push",
		),
		/distinct-root --push is not supported/,
	);
	assert.equal(
		head(ownerRoot),
		ownerBeforePush,
		"push refusal occurs before an owner commit",
	);
	assert.equal(
		head(executionRoot),
		executionBeforePush,
		"push refusal occurs before an execution commit",
	);
	assert.equal(loadStore(ownerRoot).items["CROSS-PUSH"].status, "open");
	execFileSync("git", ["restore", "source.js"], { cwd: executionRoot });

	const rollbackStore = loadStore(ownerRoot);
	createWorkItem(rollbackStore, {
		id: "CROSS-ROLLBACK",
		type: "task",
		status: "open",
		title: "Roll back companion finalization",
	});
	saveStore(ownerRoot, rollbackStore);
	writeFileSync(path.join(ownerRoot, "unrelated.txt"), "owner dirt\n");
	writeFileSync(path.join(executionRoot, "source.js"), "retryable bytes\n");
	const executionBeforeRollback = head(executionRoot);
	assert.match(
		failureFrom(
			ownerRoot,
			"finish-small",
			"CROSS-ROLLBACK",
			"--execution-root",
			executionRoot,
			"--message",
			"exercise companion rollback",
			...verifyArgs,
		),
		/finalization rolled back before close: non-work-store files changed during close/,
	);
	assert.equal(
		head(executionRoot),
		executionBeforeRollback,
		"post-execution failure restores the execution HEAD",
	);
	assert.equal(loadStore(ownerRoot).items["CROSS-ROLLBACK"].status, "open");
	assert.equal(
		execFileSync("git", ["diff", "--cached", "--name-only"], {
			cwd: executionRoot,
			encoding: "utf8",
		}).trim(),
		"",
		"retryable implementation bytes are left unstaged",
	);
	assert.equal(
		execFileSync("git", ["diff", "--", "source.js"], {
			cwd: executionRoot,
			encoding: "utf8",
		}).includes("retryable bytes"),
		true,
	);
	rmSync(path.join(ownerRoot, "unrelated.txt"));
	execFileSync("git", ["restore", "source.js"], { cwd: executionRoot });

	const ignoredOwnerRoot = mkdtempSync(
		path.join(tmpdir(), "work-helper-ignored-owner-"),
	);
	const ignoredExecutionRoot = mkdtempSync(
		path.join(tmpdir(), "work-helper-ignored-execution-"),
	);
	for (const root of [ignoredOwnerRoot, ignoredExecutionRoot]) {
		execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
		execFileSync("git", ["config", "user.email", "test@example.com"], {
			cwd: root,
		});
		execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
	}
	writeFileSync(path.join(ignoredOwnerRoot, ".gitignore"), ".ce-workflow/\n");
	execFileSync("git", ["add", ".gitignore"], { cwd: ignoredOwnerRoot });
	execFileSync("git", ["commit", "-m", "ignored owner baseline"], {
		cwd: ignoredOwnerRoot,
		stdio: "ignore",
	});
	const ignoredStore = initStore(ignoredOwnerRoot);
	createWorkItem(ignoredStore, {
		id: "CROSS-IGNORED",
		type: "task",
		status: "open",
		title: "Update companion with local owner store",
	});
	saveStore(ignoredOwnerRoot, ignoredStore);
	writeFileSync(path.join(ignoredExecutionRoot, "source.js"), "before\n");
	execFileSync("git", ["add", "source.js"], { cwd: ignoredExecutionRoot });
	execFileSync("git", ["commit", "-m", "ignored execution baseline"], {
		cwd: ignoredExecutionRoot,
		stdio: "ignore",
	});
	writeFileSync(path.join(ignoredExecutionRoot, "source.js"), "after\n");
	const ignoredOwnerHead = head(ignoredOwnerRoot);
	const ignoredFinished = JSON.parse(
		runFrom(
			ignoredOwnerRoot,
			"finish-task",
			"CROSS-IGNORED",
			"--execution-root",
			ignoredExecutionRoot,
			"--max-files",
			"1",
			"--message",
			"finish ignored companion",
			...verifyArgs,
		),
	);
	assert.equal(ignoredFinished.ownerCommit, null);
	assert.equal(
		loadStore(ignoredOwnerRoot).items["CROSS-IGNORED"].status,
		"closed",
	);
	assert.equal(
		head(ignoredOwnerRoot),
		ignoredOwnerHead,
		"ignored owner store remains durable without a metadata commit",
	);

	const generatedRoot = mkdtempSync(
		path.join(tmpdir(), "work-helper-generated-dirt-"),
	);
	execFileSync("git", ["init"], { cwd: generatedRoot, stdio: "ignore" });
	execFileSync("git", ["config", "user.email", "test@example.com"], {
		cwd: generatedRoot,
	});
	execFileSync("git", ["config", "user.name", "Test"], {
		cwd: generatedRoot,
	});
	mkdirSync(path.join(generatedRoot, ".gradle"), { recursive: true });
	writeFileSync(path.join(generatedRoot, ".gradle", "cache.bin"), "before\n");
	writeFileSync(path.join(generatedRoot, "source.js"), "before\n");
	const generatedStore = initStore(generatedRoot);
	createWorkItem(generatedStore, {
		id: "GENERATED-DIRT",
		type: "task",
		status: "open",
		title: "Preserve generated dirt",
	});
	saveStore(generatedRoot, generatedStore);
	execFileSync("git", ["add", "."], { cwd: generatedRoot });
	execFileSync("git", ["commit", "-m", "generated baseline"], {
		cwd: generatedRoot,
		stdio: "ignore",
	});
	writeFileSync(path.join(generatedRoot, ".gradle", "cache.bin"), "after\n");
	writeFileSync(path.join(generatedRoot, "source.js"), "after\n");
	const generatedFinished = JSON.parse(
		runFrom(
			generatedRoot,
			"finish-task",
			"GENERATED-DIRT",
			"--max-files",
			"1",
			"--message",
			"preserve generated dirt",
			...verifyArgs,
		),
	);
	assert.equal(generatedFinished.clean, true);
	assert.equal(
		loadStore(generatedRoot).items["GENERATED-DIRT"].status,
		"closed",
	);
	assert.deepEqual(
		execFileSync("git", ["status", "--short"], {
			cwd: generatedRoot,
			encoding: "utf8",
		})
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line && !line.includes(".pi/")),
		["M .gradle/cache.bin"],
		"tracked generated dirt remains unstaged and does not block close",
	);
	assert.doesNotMatch(
		execFileSync("git", ["show", "--pretty=", "--name-only", "HEAD"], {
			cwd: generatedRoot,
			encoding: "utf8",
		}),
		/\.gradle/,
		"generated dirt is not included in the task commit",
	);

	for (const root of [
		ownerRoot,
		executionRoot,
		ignoredOwnerRoot,
		ignoredExecutionRoot,
		generatedRoot,
	])
		rmSync(root, { recursive: true, force: true });

	console.log("ok - work helper contract");
} finally {
	if (previousConfigDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousConfigDir;
	if (previousFormatterBin === undefined)
		delete process.env.WORK_ORCH_FORMATTER_BIN;
	else process.env.WORK_ORCH_FORMATTER_BIN = previousFormatterBin;
	rmSync(cwd, { recursive: true, force: true });
	rmSync(globalSettingsDir, { recursive: true, force: true });
}
