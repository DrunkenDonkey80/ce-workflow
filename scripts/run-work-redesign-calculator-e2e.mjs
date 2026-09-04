#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const sourceRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const valueAfter = (name) => {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
};
const mode = valueAfter("--mode");
const evidenceRoot = valueAfter("--evidence-root");
if (mode !== "live" || !evidenceRoot)
	throw new Error(
		"Usage: run-work-redesign-calculator-e2e.mjs --mode live --evidence-root <durable-path> [--prepare-only]",
	);
const runId = `calculator-redesign-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const runRoot = path.resolve(evidenceRoot, runId);
const workspace = path.join(runRoot, "workspace");
const evidence = path.join(runRoot, "evidence");
mkdirSync(evidence, { recursive: true });
cpSync(
	path.join(
		sourceRoot,
		"benchmarks/workflow-evaluation/v1/projects/calculator/seed",
	),
	workspace,
	{ recursive: true },
);
mkdirSync(path.join(workspace, ".pi"), { recursive: true });
let openDesignCommand;
try {
	openDesignCommand = JSON.parse(
		readFileSync(path.join(sourceRoot, ".pi/settings.json"), "utf8"),
	).workOrchestrator?.openDesignCommand;
} catch {}
for (const [key, value] of Object.entries(openDesignCommand?.env ?? {}))
	if (
		/(?:token|secret|password|credential|api[_-]?key)/i.test(key) ||
		/(?:bearer\s|sk-[A-Za-z0-9]|token=|password=|api[_-]?key=)/i.test(
			String(value),
		)
	)
		throw new Error(
			`OpenDesign command env ${key} looks credential-bearing; configure it outside the retained live workspace`,
		);
const workOrchestrator = {
	visualDesignWorkflow: "required",
	designReviewProof: "strict",
};
if (openDesignCommand) workOrchestrator.openDesignCommand = openDesignCommand;
writeFileSync(
	path.join(workspace, ".pi/settings.json"),
	JSON.stringify({ workOrchestrator }, null, 2),
);
for (const args of [
	["init", "-q"],
	["config", "user.email", "ce-workflow@example.invalid"],
	["config", "user.name", "ce-workflow acceptance"],
	["add", "."],
	["commit", "-qm", "calculator seed"],
]) {
	const git = spawnSync("git", args, { cwd: workspace, encoding: "utf8" });
	if (git.status !== 0) throw new Error(`git ${args[0]} failed: ${git.stderr}`);
}
const launch = {
	version: 1,
	runId,
	workspace,
	evidence,
	prompt: "Create a kids-like calculator design that features bright colors.",
	status: "prepared",
};
writeFileSync(
	path.join(runRoot, "launch.json"),
	JSON.stringify(launch, null, 2),
);
if (process.argv.includes("--prepare-only")) {
	process.stdout.write(`${JSON.stringify(launch)}\n`);
	process.exit(0);
}
const instruction = [
	"Run `/wo redesign Create a kids-like calculator design that features bright colors.` through the public workflow.",
	"Personally Preview/Capture all three candidates and select one; later approve the refined design; after implementation and automated fidelity gates, accept or reject the final side-by-side result.",
	`Retain the plan's complete evidence contract under ${evidence}. Do not report PASS until report.json records passed=true and the final human receipt is current.`,
].join("\n");
const run = spawnSync(
	process.env.PI_COMMAND ?? "pi",
	[
		"--extension",
		path.join(sourceRoot, "extensions/work-models.js"),
		instruction,
	],
	{ cwd: workspace, stdio: "inherit", timeout: 7_200_000 },
);
if (run.error) throw run.error;
if (run.status !== 0)
	throw new Error(
		`live calculator redesign was blocked (pi exit ${run.status})`,
	);
let report;
try {
	report = JSON.parse(readFileSync(path.join(evidence, "report.json"), "utf8"));
} catch (error) {
	throw new Error("live run ended without retained evidence/report.json", {
		cause: error,
	});
}
if (
	report.passed !== true ||
	report.prompt !== launch.prompt ||
	report.finalFidelityAcceptance !== "accepted"
)
	throw new Error("live calculator redesign report is incomplete or rejected");
process.stdout.write(
	`${JSON.stringify({ ...launch, status: "passed", report: path.join(evidence, "report.json") })}\n`,
);
