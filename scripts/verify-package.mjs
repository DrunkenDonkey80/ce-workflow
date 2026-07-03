#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];

function check(label, ok, detail = "") {
	if (ok) {
		console.log(`ok - ${label}`);
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
	pkg.scripts?.verify === "node scripts/verify-package.mjs",
);
check("pi manifest exists", Boolean(pkg.pi));
check(
	"pi manifest exposes extensions",
	Array.isArray(pkg.pi?.extensions) &&
		pkg.pi.extensions.includes("./extensions"),
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
	"@earendil-works/pi-tui listed as peer dependency",
	Boolean(pkg.peerDependencies?.["@earendil-works/pi-tui"]),
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
	"pi-intercom listed as optional peer dependency",
	Boolean(pkg.peerDependencies?.["pi-intercom"]) &&
		pkg.peerDependenciesMeta?.["pi-intercom"]?.optional === true,
);

for (const rel of ["extensions", "skills", "prompts", "agents", "README.md"]) {
	check(`manifest path exists: ${rel}`, existsSync(path.join(root, rel)));
}

const skill = read("skills/work-orchestrator/SKILL.md");
const skillFm = frontmatter(skill);
check(
	"skill frontmatter names work-orchestrator",
	skillFm.name === "work-orchestrator",
);
check(
	"skill states Beads source of truth",
	/Beads is the only durable work state/.test(skill),
);
check(
	"skill states git source of truth",
	/Git is the only code state/.test(skill),
);
for (const mode of [
	"master",
	"migrate",
	"small",
	"med",
	"big",
	"debug",
	"auto",
	"resume",
	"continue",
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
	"bd prime",
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
	"brainstorm/plan",
	"auto-accept plan creation",
	"source brainstorm plus local plan path",
	"git branch --all --no-color --sort=-committerdate",
	"Git log is evidence, not truth",
	"unmerged or stale branches",
	"created date, last worked date",
	"bd list --type=epic --status=open --json",
	"active not-completed epics",
	"clean-boundary gate",
	"duplicate task Beads",
	"--parent <epic-id>",
	".pi-subagents/",
]) {
	check(`skill covers ${phrase}`, skill.includes(phrase));
}
check(
	"work-auto asks before big, master, migrate, or ambiguous work",
	/ask before starting/i.test(skill) &&
		/big, master, migrate, or ambiguous/i.test(skill),
);

const promptModes = {
	"work-master.md": "master",
	"work-migrate.md": "migrate",
	"work-small.md": "small",
	"work-med.md": "med",
	"work-big.md": "big",
	"work-debug.md": "debug",
	"work-auto.md": "auto",
	"work-resume.md": "resume",
	"work-continue.md": "continue",
	"work-add.md": "add",
	"work-status.md": "status",
	"work-pause.md": "pause",
};

const promptFiles = readdirSync(path.join(root, "prompts")).filter((file) =>
	file.endsWith(".md"),
);
check(
	"exactly twelve prompt templates",
	promptFiles.length === 12,
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
			"claim the assigned Bead",
			"same epic parent",
			"verification contract",
			"real hardware",
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

const extension = read("extensions/work-models.js");
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
	"CONFIG_DIR_NAME",
	"SelectList",
	"decodeKittyPrintable",
	"itemMatchesFilter",
	"filter: ${filter",
]) {
	check(`extension covers ${phrase}`, extension.includes(phrase));
}

const readme = read("README.md");
for (const phrase of [
	"pi install",
	"/work-master",
	"/work-migrate",
	"/work-small",
	"/work-debug",
	"/work-resume",
	"/work-continue",
	"/work-models",
	"pi-subagents",
	"pi-compound-engineering",
	"pi-ask-user",
	"pi-intercom",
	"bd init",
	"Master plan epics",
	"Migrating existing projects",
	"created date, last worked date",
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
	"subagents.agentOverrides",
	"Blank model means",
	"No custom dashboard",
	"No push automation",
	"No parallel writers",
	"No automatic branch checkout",
	"No mandatory `pi-intercom`",
]) {
	check(`README mentions ${phrase}`, readme.includes(phrase));
}

const ignored = read(".gitignore");
check(".gitignore excludes .pi-subagents", ignored.includes(".pi-subagents/"));

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

console.log("\nAll package checks passed.");
