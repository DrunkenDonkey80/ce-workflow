#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const quiet =
	process.argv.includes("--quiet") ||
	process.env.WORK_ORCH_VERIFY_QUIET === "1";
const failures = [];

function check(label, ok, detail = "") {
	if (ok) {
		if (!quiet) console.log(`ok - ${label}`);
		return;
	}
	failures.push(`${label}${detail ? `: ${detail}` : ""}`);
	console.error(`FAIL - ${label}${detail ? `: ${detail}` : ""}`);
}

function read(rel) {
	return readFileSync(path.join(root, rel), "utf8");
}

function json(rel) {
	return JSON.parse(read(rel));
}

function frontmatter(text) {
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};
	return Object.fromEntries(
		match[1]
			.trim()
			.split(/\r?\n/)
			.map((line) => line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/))
			.filter(Boolean)
			.map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, "")]),
	);
}

const pkg = json("package.json");

check(
	"package name is pi-work-orchestrator",
	pkg.name === "pi-work-orchestrator",
);
check("package is ESM", pkg.type === "module");
check(
	"verify script exists",
	pkg.scripts?.verify === "node scripts/verify-package.mjs" &&
		pkg.scripts?.["verify:quiet"] === "node scripts/verify-package.mjs --quiet",
);
check("pi manifest exists", Boolean(pkg.pi));
check(
	"pi manifest exposes work-models extension file",
	Array.isArray(pkg.pi?.extensions) &&
		pkg.pi.extensions.includes("extensions/work-models.js"),
);
check(
	"pi manifest exposes skills",
	Array.isArray(pkg.pi?.skills) && pkg.pi.skills.includes("./skills"),
);
check(
	"pi manifest exposes prompts",
	Array.isArray(pkg.pi?.prompts) && pkg.pi.prompts.includes("./prompts"),
);
check(
	"pi manifest exposes subagent agents",
	Array.isArray(pkg.pi?.subagents?.agents) &&
		pkg.pi.subagents.agents.includes("./agents"),
);
check(
	"@earendil-works/pi-tui is not required",
	!pkg.peerDependencies?.["@earendil-works/pi-tui"],
);
check(
	"pi-subagents listed as peer dependency",
	Boolean(pkg.peerDependencies?.["pi-subagents"]),
);
check(
	"pi-compound-engineering listed as peer dependency",
	Boolean(pkg.peerDependencies?.["pi-compound-engineering"]),
);
check(
	"pi-ask-user listed as peer dependency",
	Boolean(pkg.peerDependencies?.["pi-ask-user"]) &&
		pkg.peerDependenciesMeta?.["pi-ask-user"]?.optional !== true,
);
check(
	"pi-intercom listed as optional peer dependency",
	Boolean(pkg.peerDependencies?.["pi-intercom"]) &&
		pkg.peerDependenciesMeta?.["pi-intercom"]?.optional === true,
);

for (const rel of ["extensions", "skills", "prompts", "agents", "README.md"]) {
	check(`manifest path exists: ${rel}`, existsSync(path.join(root, rel)));
}

const skillEntry = read("skills/work-orchestrator/SKILL.md");
const skill = `${skillEntry}\n${read("skills/work-orchestrator/references/full-policy.md")}`;
const skillFm = frontmatter(skillEntry);
check(
	"skill frontmatter names work-orchestrator",
	skillFm.name === "work-orchestrator",
);
check(
	"compact skill stays below 8 KB",
	Buffer.byteLength(skillEntry) < 8000,
	`${Buffer.byteLength(skillEntry)} bytes`,
);
check(
	"skill states Beads source of truth",
	/Beads is (?:the )?(?:only )?durable work state/.test(skill),
);
check(
	"skill states git source of truth",
	/Git is the only code state/.test(skill),
);
for (const mode of [
	"init",
	"master",
	"ideate",
	"brainstorm",
	"usage",
	"roadmap",
	"migrate",
	"small",
	"med",
	"big",
	"debug",
	"auto",
	"resume",
	"add",
	"pause",
	"status",
]) {
	check(`skill defines mode: ${mode}`, skill.includes(`## Mode: ${mode}`));
}
for (const role of [
	"bead-migrator",
	"bead-planner",
	"bead-worker",
	"bead-reviewer",
	"bead-debugger",
	"bead-fixer",
	"bead-committer",
]) {
	check(`skill references role: ${role}`, skill.includes(role));
}
for (const phrase of [
	"bd where",
	"bd init --non-interactive --skip-agents",
	"bd ready --json",
	"Stop Conditions",
	"dirty",
	"manual changes",
	"master plan",
	"ce-plan",
	"ce-debug",
	"ce-compound mode:headless",
	"contact_supervisor",
	"Optional Intercom Coordination",
	"pi-intercom",
	"progress_update",
	"contact_supervisor` is unavailable",
	"Verification Contract",
	"verification contract",
	"real hardware",
	"Cost and Model Policy",
	"subagents.agentOverrides",
	"/work-models",
	"/work-context",
	"Pi's native/ultracompact auto-compaction remains responsible",
	"default opt-in trigger is 150k tokens",
	"brainstorm/plan",
	"auto-accept only skips final write-confirmation",
	"asking one question at a time until requirements are clear",
	"source brainstorm plus local plan path",
	"git branch --all --no-color --sort=-committerdate",
	"Git log is evidence, not truth",
	"unmerged or stale branches",
	"created date, last worked date",
	"bd list --type=epic --status=open --json",
	"active not-completed epics",
	"clean-boundary gate",
	"duplicate task Beads",
	"one executable Bead",
	"Work directly in the current session by default",
	"Do not call `subagent list` during a workflow",
	"do not substitute builtin roles",
	'outputMode: "file-only"',
	"full `bd show` epic JSON",
	"context:fresh",
	"bd children <epic-id> --json",
	"percent complete",
	"bead-planner` to compare the master plan",
	"do not run it as implementation work",
	"require the planner to close the planning Bead once executable children exist",
	"verify `bd ready --json` now shows the earliest executable slice",
	"bd dep add <later-id> <earlier-id>",
	"--parent <epic-id>",
	".pi-subagents/",
	"worktree hygiene gate",
	"git status --porcelain=v1 --untracked-files=all",
	"known-unrelated dirty allowlist",
	"Classify file names, not human diff/stat summaries",
	"stale intercom",
	"Live/Test Project Feedback Loop",
	"Repeat this gate after every child returns",
	"Skip an independent reviewer when acceptance is explicit",
	"coded execution policy",
	"Failure and Blocker Lifecycle",
	"Mode: report",
	"precomputed extension state for `small`, `med`, `big`, `master`, `migrate`, or `finish`",
	"tiny wall-clock limits",
	"at least 10 minutes",
	"failure artifact",
	"wo:debug-needed",
	"wo:blocked",
	"Launch exactly one `bead-reviewer` for high-risk",
	"review payoff when telemetry recorded it",
]) {
	check(`skill covers ${phrase}`, skill.includes(phrase));
}
check(
	"work-auto asks before big, master, migrate, or ambiguous work",
	/ask before starting/i.test(skill) &&
		/big, master, migrate, or ambiguous/i.test(skill),
);

const promptModes = {
	"work-init.md": "init",
	"work-plan.md": "master",
	"work-ideate.md": "ideate",
	"work-brainstorm.md": "brainstorm",
	"work-usage.md": "usage",
	"work-master.md": "master",
	"work-migrate.md": "migrate",
	"work-small.md": "small",
	"work-med.md": "med",
	"work-big.md": "big",
	"work-debug.md": "debug",
	"work-auto.md": "auto",
	"work-report.md": "report",
	"work-add.md": "add",
	"work-pause.md": "pause",
};

const promptFiles = readdirSync(path.join(root, "prompts")).filter((file) =>
	file.endsWith(".md"),
);
check(
	"exactly fifteen prompt templates",
	promptFiles.length === 15,
	promptFiles.join(", "),
);
for (const [file, mode] of Object.entries(promptModes)) {
	const rel = `prompts/${file}`;
	check(`prompt exists: ${file}`, existsSync(path.join(root, rel)));
	const text = read(rel);
	const fm = frontmatter(text);
	check(`prompt ${file} has description`, Boolean(fm.description));
	check(
		`prompt ${file} routes to shared skill`,
		text.includes("work-orchestrator"),
	);
	check(
		`prompt ${file} names mode ${mode}`,
		text.includes(`mode: \`${mode}\``),
	);
	check(`prompt ${file} preserves arguments`, text.includes("$ARGUMENTS"));
	check(`prompt ${file} stays thin`, text.split(/\r?\n/).length <= 16);
}

const agentRules = {
	"bead-migrator.md": {
		name: "bead-migrator",
		forbidWrite: true,
		thinking: "high",
		must: [
			"must not edit source code",
			"must not edit source code, write files, stage files, commit, merge, rebase, checkout another branch, or delete branches",
			"Git log is evidence, not truth",
			"Create closed child Beads only when evidence is strong",
			"unmerged or stale branches",
			"--parent <epic-id>",
			"contact_supervisor` is unavailable",
		],
	},
	"bead-planner.md": {
		name: "bead-planner",
		forbidWrite: true,
		thinking: "high",
		must: [
			"must not edit source code",
			"create decision Beads",
			"master plan",
			"never create a duplicate Bead",
			"--parent <epic-id>",
			"do not leave a ready planning Bead competing with implementation Beads",
			"earliest executable slice first",
			"bd dep add <later-id> <earlier-id>",
			"if slice B must wait for slice A",
			"bd ready --json",
			"verification contract",
			"contact_supervisor` is unavailable",
		],
	},
	"bead-worker.md": {
		name: "bead-worker",
		requireWrite: true,
		thinking: "medium",
		must: [
			"Do not commit",
			"Do not close the Bead",
			"claim the assigned Bead",
			"same epic parent",
			"verification contract",
			"real hardware",
			"git status --porcelain=v1 --untracked-files=all",
			"known-unrelated dirty allowlist",
			"contact_supervisor` is unavailable",
		],
	},
	"bead-reviewer.md": {
		name: "bead-reviewer",
		forbidWrite: true,
		thinking: "medium",
		must: [
			"PASS",
			"FAIL",
			"read-only",
			"verification contract",
			"current scoped files/diff",
			"broad whole-repo review",
			"whitespace-only dirt",
			"contact_supervisor` is unavailable",
		],
	},
	"bead-debugger.md": {
		name: "bead-debugger",
		requireWrite: true,
		thinking: "high",
		must: [
			"ce-debug",
			"ce-compound mode:headless",
			"contact_supervisor",
			"progress_update",
			"same epic parent",
			"verification contract",
			"contact_supervisor` is unavailable",
		],
	},
	"bead-fixer.md": {
		name: "bead-fixer",
		requireWrite: true,
		thinking: "medium",
		must: [
			"Fix only reviewer-identified issues",
			"Do not commit",
			"Do not close the Bead",
			"verification contract",
			"contact_supervisor` is unavailable",
		],
	},
	"bead-committer.md": {
		name: "bead-committer",
		forbidWrite: true,
		thinking: "low",
		must: [
			"Close the Bead only after the commit exists",
			"no related dirty files remain",
			"verification contract",
			"hardware evidence",
			"<bead-id>: <summary>",
			"git status --porcelain=v1 --untracked-files=all",
			"known-unrelated dirty allowlist",
			"contact_supervisor` is unavailable",
		],
	},
	"bead-advisor.md": {
		name: "bead-advisor",
		forbidWrite: true,
		thinking: "xhigh",
		must: [
			"CLEAN",
			"CONCERNS",
			"read-only",
			"task-verification gate",
			"drift from the plan",
			"contact_supervisor` is unavailable",
		],
	},
	"bead-advisor-backup.md": {
		name: "bead-advisor-backup",
		forbidWrite: true,
		thinking: "medium",
		must: [
			"CLEAN",
			"CONCERNS",
			"read-only",
			"task-verification gate",
			"drift from the plan",
			"contact_supervisor` is unavailable",
		],
	},
};

for (const [file, rule] of Object.entries(agentRules)) {
	const rel = `agents/${file}`;
	check(`agent exists: ${file}`, existsSync(path.join(root, rel)));
	const text = read(rel);
	const fm = frontmatter(text);
	const tools = fm.tools ?? "";
	check(`agent ${file} has expected name`, fm.name === rule.name);
	check(
		`agent ${file} inherits project context`,
		fm.inheritProjectContext === "true",
	);
	if (rule.thinking) {
		check(
			`agent ${file} thinking is ${rule.thinking}`,
			fm.thinking === rule.thinking,
		);
	}
	check(
		`agent ${file} does not require unshipped skills`,
		!fm.skills,
		fm.skills ?? "",
	);
	if (rule.forbidWrite) {
		check(
			`agent ${file} omits edit/write tools`,
			!/\b(edit|write)\b/.test(tools),
			tools,
		);
	}
	if (rule.requireWrite) {
		check(
			`agent ${file} includes edit/write tools`,
			/\bedit\b/.test(tools) && /\bwrite\b/.test(tools),
			tools,
		);
	}
	for (const phrase of rule.must) {
		check(`agent ${file} says ${phrase}`, text.includes(phrase));
	}
}

const extensionSource = read("extensions/work-models.js");
check(
	"extension exposes bundled role agents to pi-subagents",
	extensionSource.includes("PI_SUBAGENT_EXTRA_AGENT_DIRS") &&
		extensionSource.includes("exposeBundledSubagentAgents") &&
		extensionSource.includes('"agents"'),
);
for (const phrase of [
	'registerCommand("work-models"',
	"ctx.modelRegistry.getAvailable",
	"subagents",
	"agentOverrides",
	"bead-migrator",
	"bead-planner",
	"bead-worker",
	"bead-debugger",
	"bead-reviewer",
	"bead-committer",
	"bead-advisor",
	"bead-advisor-backup",
	'registerCommand("work-init"',
	'registerCommand("work-plan"',
	'registerCommand("work-status"',
	'registerCommand("work-report"',
	'registerCommand("work-roadmap"',
	'registerCommand("work-telemetry"',
	'registerCommand("work-ideate"',
	'registerCommand("work-brainstorm"',
	'registerCommand("work-usage"',
	'registerCommand("work-resume"',
	'registerCommand("work-menu"',
	'pi.registerShortcut?.("f7"',
	'pi.registerShortcut?.("f8"',
	'registerCommand("work-catch-up"',
	"work-catch-up-baseline.json",
	'registerCommand("work-pause"',
	'registerCommand("work-small"',
	'registerCommand("work-med"',
	'registerCommand("work-big"',
	'registerCommand("work-master"',
	'registerCommand("work-migrate"',
	'registerCommand("work-finish"',
	'registerCommand("work-debug"',
	'registerCommand("work-add"',
	'registerCommand("work-auto"',
	'registerCommand("work-context"',
	"buildWorkReport",
	"buildWorkRoadmapState",
	"renderWorkRoadmapText",
	"buildWorkTelemetry",
	"buildWorkTelemetryState",
	"recordWorkTelemetry",
	"buildWorkResumeState",
	"buildWorkIdeateState",
	"buildWorkBrainstormState",
	"buildWorkUsageState",
	"renderWorkIdeateText",
	"renderWorkBrainstormText",
	"renderWorkUsageText",
	"reviewTelemetry",
	"reviewPayoff",
	"Review scope default",
	"buildWorkflowIntakeState",
	"buildWorkPauseState",
	"buildWorkDebugState",
	"buildWorkAddState",
	"buildWorkAutoState",
	"buildWorkSmallState",
	"buildWorkMedState",
	"buildWorkBigState",
	"buildWorkInitState",
	"buildWorkPlanState",
	"buildWorkMasterState",
	"buildWorkMigrateState",
	"buildWorkFinishState",
	"workOrchSettings",
	"applyProfile",
	"advisorCriticStep",
	"advisorVerifyStep",
	"advisor backup",
	"slicePlanBeforeWork",
	"slicePlanWithCePlan",
	"slicePlanCeDepth",
	"cePlanSliceStep",
	"planReference",
	"codeReviewBeforeCommitStep",
	"simplifyBeforeReviewStep",
	"browserTestsOnUiDiffStep",
	"advisor (critic)",
	'registerCommand("work-settings"',
	"ROLE_TIMEOUT_GUIDANCE",
	"Closure rule: worker/reviewer/fixer/debugger roles leave Beads open",
	"handleWorkResumeCommand",
	"renderWorkReportJson",
	"noteExcerpts",
	"session_before_compact",
	"instantSummary",
	"ctx.getContextUsage",
	"tool_execution_start",
	"agent_end",
	"WORK_GOAL_RETRYABLE_RE",
	"WORK_GOAL_NON_RETRYABLE_RE",
	"parseTokenBudget",
	"BEAD_TITLE_MAX",
	"appendOriginalBeadTitle",
	"budget_limited",
	"isContradictoryWorkGoalCompletion",
	"workGoalRecovery",
	"ctx.compact",
	"buildWorkStatus",
	"planned ahead",
	"Progress: ${done.length}/${slices.length}",
	"CONFIG_DIR_NAME",
	"ctx.ui.select",
	"choose(ctx",
]) {
	check(`extension covers ${phrase}`, extensionSource.includes(phrase));
}

const readme = read("README.md");
for (const phrase of [
	"pi install",
	"/work-init",
	"/work-plan",
	"/work-ideate",
	"/work-brainstorm",
	"/work-usage",
	"/work-master",
	"/work-migrate",
	"/work-small",
	"/work-debug",
	"/work-add",
	"/work-pause",
	"/work-auto",
	"/work-finish",
	"Extension command: resolves/reuses or creates a debug Bead",
	"Extension command: creates one child Bead",
	"Extension command: creates one planning Bead",
	"Extension command: normalizes migration sources",
	"Extension command: checks PASS review",
	"Extension command: appends a deterministic checkpoint",
	"deterministically classifies obvious debug/master/big/small work",
	"/work-report",
	"/work-roadmap",
	"/work-telemetry",
	"/work-resume",
	"/work-catch-up",
	"work-catch-up-baseline.json",
	"--tokens 100k",
	"retryable provider/context-error recovery",
	"contradictory completion summaries",
	"/work-models",
	"/work-settings",
	"/work-context",
	"Context management",
	"does not pre-prompt compact normal chats by default",
	"no extra LLM call",
	"pi-subagents",
	"pi-compound-engineering",
	"pi-ask-user",
	"pi-intercom",
	"bd init",
	"Master plan epics",
	"Migrating existing projects",
	"Git log is evidence, not truth",
	"unmerged/stale branches",
	"ce-plan",
	"ce-debug",
	"ce-compound",
	"Start-to-completion example",
	"Insert work mid-flow",
	"Pause, stop, and resume",
	"Optional intercom coordination",
	"contact_supervisor",
	"Verification contracts",
	"real hardware",
	"Model and effort tuning",
	"Effort profiles",
	"subagents.agentOverrides",
	"Blank model means",
	"fresh Pi session",
	"wo:execution-agent",
	"exact package roles",
	"Routine work stays in the current session",
	"required specialist cannot start",
	"MSYS_NO_PATHCONV=1",
	"percent complete",
	"No custom dashboard",
	"No push automation",
	"No parallel writers",
	"No automatic branch checkout",
	"No mandatory `pi-intercom`",
	"Live/test feedback loop",
	"failure artifact",
	"blocked/debug-needed",
	"git status --porcelain=v1 --untracked-files=all",
	"Known-unrelated dirty files",
	"stale intercom",
	"npm run verify:quiet",
	"avoid raw epic JSON",
	".pi/work-runs/*.jsonl",
	"review scope/payoff",
	"make the tuning visible",
	"advisor backup",
	"slice plan before work",
	"coded; planner only when messy",
	"self-improvement is off by default",
	"Roadmap epics are not auto-closed",
]) {
	check(`README mentions ${phrase}`, readme.includes(phrase));
}

const ignored = read(".gitignore");
check(".gitignore excludes .pi-subagents", ignored.includes(".pi-subagents/"));

for (const script of [
	"test-work-report.mjs",
	"test-work-resume.mjs",
	"test-work-ideate.mjs",
	"test-work-brainstorm.mjs",
	"test-work-usage.mjs",
	"test-work-roadmap.mjs",
	"test-work-models.mjs",
	"test-work-settings.mjs",
	"test-work-intake.mjs",
	"test-work-pause.mjs",
	"test-work-debug.mjs",
	"test-work-add.mjs",
	"test-work-auto.mjs",
	"test-work-goal.mjs",
	"test-work-start-finish.mjs",
	"test-work-telemetry.mjs",
	"test-work-improvement-analyzer.mjs",
	"test-work-optimization-helpers.mjs",
	"test-windows-bd-shim.mjs",
]) {
	try {
		execFileSync(process.execPath, [`scripts/${script}`], {
			cwd: root,
			stdio: quiet ? "pipe" : "inherit",
		});
		check(`${script} fixture behavior passes`, true);
	} catch (error) {
		check(
			`${script} fixture behavior passes`,
			false,
			error instanceof Error ? error.message : String(error),
		);
	}
}

for (const rel of [
	"agents",
	"extensions",
	"prompts",
	"skills/work-orchestrator",
]) {
	check(`${rel} is a directory`, statSync(path.join(root, rel)).isDirectory());
}

if (failures.length) {
	console.error(`\n${failures.length} verification check(s) failed:`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}

console.log(
	quiet ? "ok - package checks passed" : "\nAll package checks passed.",
);
