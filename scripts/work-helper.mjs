#!/usr/bin/env node
import { execFileSync, execSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
	isGeneratedBuildPath,
	isRuntimePath,
	tidyUntrackedFiles,
} from "./work-hygiene.mjs";

const cwd = process.cwd();
const [, , command, ...args] = process.argv;
const npmBd = path.join(
	process.env.APPDATA || "",
	"npm/node_modules/@beads/bd/bin/bd.js",
);
const bdBin =
	process.env.WORK_ORCH_BD_BIN ||
	(process.platform === "win32" && existsSync(npmBd) ? npmBd : "bd");
const gitBin = process.env.WORK_ORCH_GIT_BIN || "git";

function run(bin, argv, options = {}) {
	let executable = bin;
	let args = argv;
	let shell = false;
	if (/\.[cm]?js$/i.test(bin)) {
		executable = process.execPath;
		args = [bin, ...argv];
	} else if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(bin)) {
		shell = true;
	}
	return execFileSync(executable, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		shell,
		...options,
	});
}

function bd(argv) {
	return JSON.parse(run(bdBin, [...argv, "--json"]) || "[]");
}

function git(argv) {
	return run(gitBin, argv);
}

function gitStatusPaths() {
	const records = git([
		"status",
		"--porcelain=v1",
		"-z",
		"--untracked-files=all",
	])
		.split("\0")
		.filter(Boolean);
	const paths = [];
	for (let i = 0; i < records.length; i += 1) {
		const record = records[i];
		const code = record.slice(0, 2);
		paths.push(record.slice(3));
		if (/[RC]/.test(code) && records[i + 1]) paths.push(records[++i]);
	}
	return [...new Set(paths)].filter(Boolean);
}

function cleanupGeneratedInstructions() {
	for (const file of gitStatusPaths()) {
		if (!/(?:^|\/)AGENTS\.md$/i.test(file) || !existsSync(file)) continue;
		try {
			git(["ls-files", "--error-unmatch", "--", file]);
		} catch {
			const text = readFileSync(file, "utf8").trim();
			if (
				text.startsWith("<!-- BEGIN COMPOUND PI TOOL MAP -->") &&
				text.endsWith("<!-- END COMPOUND PI TOOL MAP -->")
			)
				rmSync(file);
		}
	}
}

function formatPendingFiles() {
	if (!args.includes("--immediate-format")) return [];
	const files = gitStatusPaths().filter(
		(file) =>
			!isRuntimePath(file) &&
			/\.(?:[cm]?[jt]sx?|jsonc?|css|scss|sass|vue|svelte|html?)$/i.test(file) &&
			existsSync(file),
	);
	if (!files.length) return [];
	const suffix = process.platform === "win32" ? ".cmd" : "";
	const candidates = [
		process.env.WORK_ORCH_FORMATTER_BIN,
		path.join(cwd, "node_modules", ".bin", `biome${suffix}`),
		path.join(
			os.homedir(),
			".pi-lens",
			"tools",
			"node_modules",
			".bin",
			`biome${suffix}`,
		),
	].filter(Boolean);
	const formatter = candidates.find(existsSync);
	if (!formatter) return [];
	run(formatter, ["format", "--write", ...files]);
	return files;
}

function finishTask() {
	const id = args[0];
	const message = option("--message");
	const maxFiles = Number(
		option("--max-files", command === "finish-small" ? 2 : 8),
	);
	if (!id || !message || !Number.isInteger(maxFiles) || maxFiles < 1)
		throw new Error(
			"usage: finish-task <bead-id> --max-files <n> --message <summary> [--verify <command> --expect <stdout> | --json <file> --equals <path=value>] [--immediate-format] [--reviewed] [--push]",
		);
	cleanupGeneratedInstructions();
	const formatted = formatPendingFiles();
	const stagedBefore = git(["diff", "--cached", "--name-only"])
		.split(/\r?\n/)
		.filter(Boolean);
	const unexpectedStaged = stagedBefore.filter(
		(file) => !file.replaceAll("\\", "/").startsWith(".beads/"),
	);
	if (unexpectedStaged.length)
		throw new Error(
			`refusing pre-staged files: ${unexpectedStaged.join(", ")}`,
		);
	if (stagedBefore.length) git(["restore", "--staged", "--", ...stagedBefore]);

	const verify = option("--verify");
	const jsonFile = option("--json");
	if (!verify && !jsonFile)
		throw new Error("finish-task requires --verify or --json");
	let verificationResult;
	let verificationCommand;
	let output;
	try {
		if (jsonFile) {
			verificationCommand = `json-assert ${jsonFile}`;
			const failures = jsonAssertionFailures(jsonFile);
			if (failures.length) throw new Error(failures.join("; "));
			output = "all JSON assertions passed";
		} else if (verify) {
			verificationCommand = verify;
			output = execSync(verify, {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}).trim();
			const expected = option("--expect");
			if (expected !== undefined && output !== expected)
				throw new Error(
					`expected ${JSON.stringify(expected)}, got ${JSON.stringify(output)}`,
				);
		}
	} catch (error) {
		run(bdBin, [
			"update",
			id,
			"--append-notes",
			`wo:verify-check FAIL\nCommand: ${verificationCommand}\n${String(error.stderr ?? error.message ?? error).slice(-500)}`,
		]);
		throw new Error(`verification failed: ${verificationCommand}`);
	}
	if (verificationCommand) {
		verificationResult = {
			command: verificationCommand,
			status: "PASS",
			output: output.slice(-500),
		};
		run(bdBin, [
			"update",
			id,
			"--append-notes",
			`wo:verify-check PASS\nCommand: ${verificationCommand}\nOutput: ${output.slice(-500)}`,
		]);
	}
	const tidy = tidyUntrackedFiles({ cwd, gitBin });
	if (tidy.unrecognized.length)
		throw new Error(
			`untracked files need a decision before commit (add, gitignore, or remove):\n` +
				tidy.unrecognized.map((file) => `  - ${file}`).join("\n") +
				`\nResolve each, then re-run finish-task.`,
		);
	const changed = gitStatusPaths().filter(
		(file) => !isRuntimePath(file) && !isGeneratedBuildPath(file),
	);
	if (!changed.length) throw new Error("no related changes to commit");
	const implementationFiles = changed.filter(
		(file) =>
			!file.replaceAll("\\", "/").startsWith(".beads/") &&
			file.replaceAll("\\", "/") !== ".gitignore",
	);
	if (implementationFiles.length > maxFiles)
		throw new Error(
			`scope exceeds ${maxFiles} implementation files: ${implementationFiles.join(", ")}`,
		);
	const task = one(bd(["show", id]));
	const taskText = `${titleOf(task)}\n${notesOf(task)}\n${field(task, "acceptance", "acceptance_criteria") ?? ""}`;
	const evidenceOnly =
		/evidence[- ](?:only|capture)|\b(?:record|capture|probe|verify|test|try)\b/i.test(
			taskText,
		);
	const reviewReasons = [];
	const sensitivePaths = implementationFiles.filter((file) =>
		/(?:^|\/)(?:migrations?|schema|auth|security|permissions?|payments?|billing|secrets?|deploy|infra)(?:\/|\.|$)|\.github\/workflows\//i.test(
			file.replaceAll("\\", "/"),
		),
	);
	if (sensitivePaths.length)
		reviewReasons.push(`sensitive paths: ${sensitivePaths.join(", ")}`);
	if (
		/\b(?:auth(?:entication|orization)?|permission|credential|secret|payment|billing|migration|schema|database|destructive|production|deploy|release|breaking|concurren(?:cy|t)|race condition|thread safety|crypt|security|firmware flash)\b/i.test(
			taskText,
		)
	)
		reviewReasons.push("sensitive task contract");
	const numstat = git(["diff", "--numstat", "--", ...implementationFiles]);
	let changedLines = numstat
		.split(/\r?\n/)
		.filter(Boolean)
		.reduce((sum, line) => {
			const [added, removed] = line.split("\t");
			return sum + (Number(added) || 0) + (Number(removed) || 0);
		}, 0);
	const untracked = new Set(
		git(["ls-files", "--others", "--exclude-standard"])
			.split(/\r?\n/)
			.filter(Boolean),
	);
	for (const file of implementationFiles.filter((item) => untracked.has(item)))
		if (existsSync(file))
			changedLines += readFileSync(file, "utf8").split(/\r?\n/).length;
	if (changedLines > 300)
		reviewReasons.push(`large diff: ${changedLines} lines`);
	const uiFiles = implementationFiles.filter((file) =>
		/\.(?:tsx|jsx|css|scss|html|vue|svelte)$/i.test(file),
	);
	if (
		uiFiles.length &&
		/\b(?:ui|visual|browser|screenshot|interaction)\b/i.test(taskText)
	)
		reviewReasons.push(`UI acceptance: ${uiFiles.join(", ")}`);
	if (
		!evidenceOnly &&
		/\b(?:hardware|firmware|device|live evidence|real[- ]world)\b/i.test(
			taskText,
		)
	)
		reviewReasons.push("hardware/live-evidence contract");
	if (reviewReasons.length) {
		if (!args.includes("--reviewed"))
			throw new Error(
				`independent review required for ${reviewReasons.join("; ")}`,
			);
		if (!/(?:wo:review|review(?: result)?):?\s*PASS\b/i.test(notesOf(task)))
			throw new Error("--reviewed requires durable wo:review PASS evidence");
	}
	git(["add", "-A", "--", ...changed]);
	const staged = git(["diff", "--cached", "--name-only"])
		.split(/\r?\n/)
		.filter(Boolean);
	if (!staged.length)
		throw new Error("no staged changes after filtering runtime files");
	const headBefore = git(["rev-parse", "HEAD"]).trim();
	let closed = false;
	try {
		git(["commit", "-m", `${id}: ${message}`]);
		run(bdBin, [
			"close",
			id,
			"--reason",
			"Completed by coded inline work path",
		]);
		closed = true;
		const closeChanges = gitStatusPaths().filter(
			(file) => !isRuntimePath(file),
		);
		if (
			closeChanges.some(
				(file) => !file.replaceAll("\\", "/").startsWith(".beads/"),
			)
		)
			throw new Error(
				`non-Beads files changed during close: ${closeChanges.join(", ")}`,
			);
		if (closeChanges.length) {
			git(["add", "-A", "--", ...closeChanges]);
			git(["commit", "--amend", "--no-edit"]);
		}
		const remaining = gitStatusPaths().filter((file) => !isRuntimePath(file));
		if (remaining.length)
			throw new Error(`related files remain dirty: ${remaining.join(", ")}`);
	} catch (error) {
		if (closed) {
			try {
				run(bdBin, ["reopen", id]);
			} catch {
				// Preserve the original failure; Beads notes still show the attempted close.
			}
		}
		git(["reset", "--mixed", headBefore]);
		throw new Error(
			`finalization rolled back before close: ${error.message ?? error}`,
		);
	}
	let push = "skipped";
	if (args.includes("--push")) {
		try {
			git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
			git(["push"]);
			push = "passed";
		} catch (error) {
			push = /upstream/i.test(String(error.stderr ?? error.message ?? error))
				? "skipped-no-upstream"
				: "failed";
		}
	}
	return {
		status: "PASS",
		bead_id: id,
		commit: git(["rev-parse", "--short", "HEAD"]).trim(),
		files: staged,
		verification: verificationResult,
		formatted,
		push,
		clean: true,
	};
}

function one(value) {
	return Array.isArray(value) ? value[0] : value;
}

function arr(value) {
	return Array.isArray(value) ? value : value == null ? [] : [value];
}

function field(issue, ...names) {
	for (const name of names) if (issue?.[name] != null) return issue[name];
}

function idOf(issue) {
	return field(issue, "id", "ID") ?? "";
}

function titleOf(issue) {
	return field(issue, "title", "summary", "name") ?? "";
}

function typeOf(issue) {
	return field(issue, "issue_type", "type") ?? "";
}

function statusOf(issue) {
	return field(issue, "status", "state") ?? "";
}

function labelsOf(issue) {
	return arr(field(issue, "labels", "tags"));
}

function parentOf(issue) {
	return field(issue, "parent", "parent_id", "epic_id") ?? "";
}

function notesOf(issue) {
	const notes = field(issue, "notes", "description", "body") ?? "";
	return typeof notes === "string" ? notes : JSON.stringify(notes ?? "");
}

function depsOf(issue) {
	return arr(field(issue, "dependencies", "deps", "blocked_by"))
		.map((dep) =>
			typeof dep === "string"
				? dep
				: field(dep, "id", "depends_on_id", "blocked_by_id"),
		)
		.filter(Boolean);
}

function summary(issue, notesTail = 2000) {
	return {
		id: idOf(issue),
		title: titleOf(issue),
		status: statusOf(issue),
		issue_type: typeOf(issue),
		priority: issue?.priority,
		labels: labelsOf(issue),
		parent: parentOf(issue),
		dependencies: depsOf(issue),
		updated_at: field(issue, "updated_at", "updatedAt"),
		notes_tail: notesOf(issue).slice(-notesTail),
	};
}

function artifact(prefix, ext, content) {
	const dir = path.join(cwd, ".pi", "work-runs", "helper");
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${prefix}-${Date.now().toString(36)}.${ext}`);
	writeFileSync(file, String(content ?? ""));
	return file;
}

function print(value) {
	console.log(JSON.stringify(value, null, 2));
}

function capText(text, bytes = 10000) {
	if (text.length <= bytes) return { text, truncated: false };
	const half = Math.max(400, Math.floor((bytes - 80) / 2));
	return {
		text: `${text.slice(0, half)}\n… truncated ${text.length - half * 2} chars …\n${text.slice(-half)}`,
		truncated: true,
	};
}

function option(name, fallback = undefined) {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : fallback;
}

function positional() {
	const out = [];
	for (let i = 0; i < args.length; i += 1) {
		if (args[i].startsWith("--")) {
			i += 1;
			continue;
		}
		out.push(args[i]);
	}
	return out;
}

function termScore(issue, terms) {
	const haystack =
		`${titleOf(issue)}\n${labelsOf(issue).join(" ")}\n${notesOf(issue).slice(-2000)}`.toLowerCase();
	return terms.reduce(
		(sum, term) => sum + (haystack.includes(term) ? 1 : 0),
		0,
	);
}

function jsonPath(object, key) {
	return key.split(".").reduce((value, part) => value?.[part], object);
}

function jsonAssertionFailures(file) {
	const data = JSON.parse(readFileSync(file, "utf8"));
	const failures = [];
	for (const key of String(option("--required", "")).split(",").filter(Boolean))
		if (jsonPath(data, key) == null) failures.push(`missing ${key}`);
	for (let i = 1; i < args.length; i += 1) {
		if (args[i] === "--equals") {
			const [key, expected] = String(args[++i]).split("=", 2);
			if (String(jsonPath(data, key)) !== expected)
				failures.push(`${key} != ${expected}`);
		} else if (args[i] === "--forbid-string") {
			const forbidden = args[++i];
			if (JSON.stringify(data).includes(forbidden))
				failures.push(`forbidden string ${forbidden}`);
		}
	}
	return failures;
}

try {
	if (command === "bd-summary") {
		const issue = one(bd(["show", args[0]]));
		print(summary(issue));
	} else if (command === "bd-children-summary") {
		print(
			bd(["children", args[0]]).map((issue) => ({
				...summary(issue, 300),
				notes_tail: undefined,
			})),
		);
	} else if (command === "bd-ready-summary") {
		const epic = args[0];
		print(
			bd(["ready"])
				.filter((issue) => !epic || parentOf(issue) === epic)
				.map((issue) => ({
					id: idOf(issue),
					title: titleOf(issue),
					status: statusOf(issue),
					issue_type: typeOf(issue),
					parent: parentOf(issue),
					dependencies: depsOf(issue),
				})),
		);
	} else if (command === "blocker-search") {
		const [epic, ...queryParts] = args;
		const terms = queryParts
			.join(" ")
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((term) => term.length >= 4);
		const matches = bd(["children", epic])
			.filter((issue) => statusOf(issue) !== "closed")
			.filter(
				(issue) =>
					/bug|decision/.test(typeOf(issue)) ||
					labelsOf(issue).some((label) => /blocked|debug|follow/.test(label)) ||
					/blocked/i.test(notesOf(issue)),
			)
			.map((issue) => ({
				score: termScore(issue, terms),
				...summary(issue, 500),
			}))
			.filter((issue) => issue.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, Number(option("--limit", 5)));
		print({ status: matches.length ? "found" : "missing", matches });
	} else if (command === "search-summary" || command === "scan-capability") {
		const [query, ...paths] = positional();
		const max = String(option("--max", 80));
		const bytes = Number(option("--bytes", 10000));
		const rgArgs = [
			"-n",
			"-i",
			"-m",
			max,
			query,
			...(paths.length ? paths : ["."]),
		];
		let raw = "";
		let exitCode = 0;
		try {
			raw = run("rg", rgArgs);
		} catch (error) {
			raw = String(error.stdout ?? "");
			exitCode = Number(error.status ?? 1);
		}
		const fullLogPath =
			raw.length > bytes ? artifact(command, "txt", raw) : undefined;
		const lines = raw.split(/\r?\n/).filter(Boolean);
		const byFile = {};
		for (const line of lines) {
			const file = line.split(":", 1)[0] || "<unknown>";
			byFile[file] = (byFile[file] ?? 0) + 1;
		}
		const capped = capText(raw, bytes);
		print({
			status: lines.length
				? "found"
				: command === "scan-capability"
					? "missing"
					: "PASS",
			exit_code: exitCode,
			query,
			match_count: lines.length,
			matches_by_file: byFile,
			evidence_lines: lines.slice(0, 30),
			truncated: capped.truncated,
			summary: capped.text,
			full_log_path: fullLogPath,
		});
	} else if (command === "finish-small" || command === "finish-task") {
		print(finishTask());
	} else if (command === "ensure-no-staged") {
		const allowBeads = args.includes("--allow-beads");
		const staged = git(["diff", "--cached", "--name-only"])
			.split(/\r?\n/)
			.filter(Boolean);
		const allowed = allowBeads
			? staged.filter(
					(file) =>
						file === ".beads/issues.jsonl" || file.startsWith(".beads/"),
				)
			: [];
		if (allowed.length) git(["restore", "--staged", ...allowed]);
		const remaining = git(["diff", "--cached", "--name-only"])
			.split(/\r?\n/)
			.filter(Boolean);
		print({
			status: remaining.length ? "FAIL" : "PASS",
			unstaged: allowed,
			remaining_staged: remaining,
		});
	} else if (command === "bd-claim") {
		print(
			summary(one(bd(["update", args[0], "--status", "in_progress"])), 300),
		);
	} else if (command === "bd-note") {
		const [id, noteArg] = args;
		const note = existsSync(noteArg)
			? readFileSync(noteArg, "utf8")
			: args.slice(1).join(" ");
		print(summary(one(bd(["update", id, "--append-notes", note])), 500));
	} else if (command === "bd-block") {
		const task = args[0];
		const blocker = option("--by");
		if (!task || !blocker)
			throw new Error("usage: bd-block <task-id> --by <blocker-id>");
		run(bdBin, ["dep", "add", task, blocker]);
		print({ status: "PASS", task, blocker });
	} else if (command === "bd-label") {
		const id = args[0];
		const argv = ["update", id];
		for (let i = 1; i < args.length; i += 1) {
			if (args[i] === "--add") argv.push("--add-label", args[++i]);
			else if (args[i] === "--remove") argv.push("--remove-label", args[++i]);
		}
		print(summary(one(bd(argv)), 300));
	} else if (command === "bootstrap-plan-epic") {
		const [rel] = positional();
		if (!rel) throw new Error("usage: bootstrap-plan-epic <plan-path>");
		const modUrl = pathToFileURL(
			path.join(import.meta.dirname, "..", "extensions", "work-models.js"),
		).href;
		const bridge = `(async () => {
			const { bootstrapPlanEpic } = await import(${JSON.stringify(modUrl)});
			const s = bootstrapPlanEpic(${JSON.stringify(cwd)}, ${JSON.stringify(rel)});
			const slim = {
				ok: !!s.ok,
				action: s.action,
				epic_id: s.epic?.id ?? null,
				epic_title: s.epic?.title ?? null,
				planning_id: s.selectedBead?.id ?? null,
				open_questions: s.open_questions ?? [],
				message: s.message ?? "",
				nextAction: s.nextAction ?? "",
			};
			process.stdout.write(JSON.stringify(slim));
		})();`;
		let raw = "";
		try {
			raw = run(process.execPath, ["--input-type=module", "-e", bridge]);
		} catch (error) {
			raw = String(error.stdout ?? "");
			if (!raw) throw error;
		}
		const parsed = JSON.parse(raw || "{}");
		print(parsed);
		if (parsed.action !== "run-planner") process.exitCode = 1;
	} else if (command === "json-assert") {
		const failures = jsonAssertionFailures(args[0]);
		print({
			status: failures.length ? "FAIL" : "PASS",
			failed_assertions: failures,
		});
		if (failures.length) process.exitCode = 1;
	} else {
		console.error(
			"usage: work-helper <bd-summary|bd-children-summary|bd-ready-summary|blocker-search|search-summary|scan-capability|finish-task|finish-small|ensure-no-staged|bd-claim|bd-note|bd-block|bd-label|bootstrap-plan-epic|json-assert> ...",
		);
		process.exitCode = 2;
	}
} catch (error) {
	print({
		status: "FAIL",
		error: error instanceof Error ? error.message : String(error),
	});
	process.exitCode = process.exitCode || 1;
}
