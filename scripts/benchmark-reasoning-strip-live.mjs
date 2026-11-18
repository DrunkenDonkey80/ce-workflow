#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
process.env.PI_WORK_PROJECT_MAP ??= "off"; // live runs never map unless a fixture opts in (PI_WORK_PROJECT_MAP=on)

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const value = (flag, fallback) => {
	const index = args.indexOf(flag);
	return index < 0 ? fallback : args[index + 1];
};
const model = value("--model", "zai/glm-5.3");
const repetitions = Number(value("--repetitions", "1"));
const matrix = value("--matrix", "reasoning");
const outputRoot = path.resolve(
	value(
		"--output",
		path.join(
			repo,
			".pi",
			"reasoning-strip-benchmark",
			new Date().toISOString().replaceAll(":", "-"),
		),
	),
);
const reasoningPolicies = [
	{ id: "R0", label: "control", value: "0" },
	{ id: "R1", label: "interaction", value: "interaction" },
	{ id: "R2", label: "aggressive", value: "aggressive" },
];
let rotations = [
	[0, 1, 2],
	[1, 2, 0],
	[2, 0, 1],
];
// Ultrafull checkpoints between phases, through ce-workflow, in both matrices that compare compaction.
const compacts = matrix === "compaction" || matrix === "compaction-model";

function npmRoot() {
	try {
		return execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
	} catch {
		return path.join(process.env.APPDATA ?? "", "npm", "node_modules");
	}
}

// BENCH_PI_CLI: the offline self-check swaps in a fake RPC Pi (scripts/test-benchmark-compaction-model.mjs).
// Pi installs into ~/.pi/agent/install/releases/<version>; older installs live in the npm global root.
const releases = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".pi", "agent", "install", "releases");
const piCli = process.env.BENCH_PI_CLI ?? [
	...(existsSync(releases) ? readdirSync(releases) : [])
		.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
		.map((version) => path.join(releases, version, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js")),
	path.join(npmRoot(), "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js"),
].find(existsSync);
if (!piCli) throw new Error("Pi CLI not found");
const providerExtension = value("--provider-extension", path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".pi", "agent", "git", "github.com", "DrunkenDonkey80", "pi-provider-claude-ex", "index.ts"));
const extension = path.join(repo, "extensions", "work-models.ts");
const wireProbe = path.join(repo, "scripts", "reasoning-wire-probe.mjs");
let policies = reasoningPolicies;
if (matrix === "compaction") {
	const oldRoot = path.join(outputRoot, "before-today");
	mkdirSync(oldRoot, { recursive: true });
	const archive = path.join(oldRoot, "repo.tar");
	writeFileSync(
		archive,
		execFileSync("git", ["archive", "--format=tar", "HEAD^"], {
			cwd: repo,
			maxBuffer: 100 * 1024 * 1024,
		}),
	);
	execFileSync("tar", ["--force-local", "-xf", "repo.tar", "-C", "."], {
		cwd: oldRoot,
	});
	policies = [
		{
			id: "C0",
			label: "current-ultracompact",
			value: "aggressive",
			extension,
		},
		{
			id: "C1",
			label: "before-today-ultracompact",
			value: "1",
			extension: path.join(oldRoot, "extensions", "work-models.ts"),
		},
		{ id: "C2", label: "native-pi-compaction", value: "0" },
	];
} else if (matrix === "compaction-model") {
	// Luna vs Terra as the ultrafull summarizer; same scenario, one results file per arm, order alternates.
	policies = [
		{ id: "L", label: "luna-ultrafull", value: "0", extension, compactionModel: "openai-codex/gpt-6-luna" },
		{ id: "T", label: "terra-ultrafull", value: "0", extension, compactionModel: "openai-codex/gpt-6.1-terra" },
	];
	rotations = [
		[0, 1],
		[1, 0],
	];
} else if (matrix !== "reasoning") {
	throw new Error(`unknown matrix: ${matrix}`);
}

const spec = `# Calculator Lite

Implement each phase only when requested. Preserve earlier behavior.

## Phase 1
- calculator.mjs exports evaluate(expression).
- Support decimals, unary minus, parentheses, and + - * / with normal precedence.
- Division by zero throws Error("Division by zero").
- Do not use eval or Function.
- Provide a minimal index.html and app.mjs calculator UI.

## Phase 2
- Export Calculator.
- Constructor accepts { historyLimit = 5 }.
- press(key) accepts digits, decimal point, + - * /, Enter, Escape, Backspace.
- display is a string. Enter evaluates and records { expression, result } newest-first.
- History is capped exactly at historyLimit.
- After a result, an operator continues from it; a digit starts a new expression.

## Phase 3
- Add memoryClear(), memoryRecall(), memoryAdd(), and memorySubtract().
- memory starts at zero. Add/subtract use the current displayed value.
- press(key) accepts MC, MR, M+, and M- and routes them to those methods.
- Recall places the memory value in display and allows normal continuation.
- Add matching MC, MR, M+, and M- browser controls using those exact data-key values.
`;

const test = `import assert from "node:assert/strict";
import * as calculatorModule from "./calculator.mjs";

const { Calculator, evaluate } = calculatorModule;
const phase = Number(process.argv[2] ?? 3);
assert.equal(evaluate("2+3*4"), 14);
assert.equal(evaluate("-(2.5+1.5)*2"), -8);
assert.equal(evaluate("10/(2+3)"), 2);
assert.throws(() => evaluate("8/0"), /Division by zero/);
const source = await import("node:fs").then(fs => fs.readFileSync("calculator.mjs", "utf8"));
assert.doesNotMatch(source, /\\beval\\s*\\(|\\bFunction\\s*\\(/);

if (phase >= 2) {
  const calculator = new Calculator({ historyLimit: 2 });
  for (const key of ["1", "2", "+", "3", "Enter"]) calculator.press(key);
  assert.equal(calculator.display, "15");
  assert.deepEqual(calculator.history[0], { expression: "12+3", result: 15 });
  for (const key of ["+", "5", "Enter"]) calculator.press(key);
  assert.equal(calculator.display, "20");
  for (const key of ["7", "*", "2", "Enter"]) calculator.press(key);
  assert.equal(calculator.display, "14");
  assert.equal(calculator.history.length, 2);
  assert.deepEqual(calculator.history.map(item => item.result), [14, 20]);
  calculator.press("Escape");
  calculator.press("9");
  calculator.press("Backspace");
  assert.equal(calculator.display, "0");
}

if (phase >= 3) {
  const calculator = new Calculator();
  for (const method of ["memoryClear", "memoryRecall", "memoryAdd", "memorySubtract"])
    assert.equal(typeof calculator[method], "function");
  for (const key of ["8", "M+", "Escape", "2", "M-", "Escape", "MR"])
    calculator.press(key);
  assert.equal(calculator.display, "6");
  for (const key of ["+", "4", "Enter"]) calculator.press(key);
  assert.equal(calculator.display, "10");
  calculator.press("MC");
  assert.equal(calculator.memory, 0);
  const html = await import("node:fs").then(fs => fs.readFileSync("index.html", "utf8"));
  for (const key of ["MC", "MR", "M+", "M-"])
    assert(html.includes(\`data-key="\${key}"\`) || html.includes(\`data-key='\${key}'\`), \`missing browser control \${key}\`);
}
console.log("ok phase", phase);
`;

const prompts = [
	"Implement Phase 1 from SPEC.md. Inspect the files, make the smallest correct implementation, and run `node test.mjs 1`. Do not implement later phases yet.",
	"Implement Phase 2 from SPEC.md while preserving Phase 1. Update the browser controls too, then run `node test.mjs 2`.",
	"Implement Phase 3 from SPEC.md while preserving all prior behavior. Run `node test.mjs 3` and fix any failures.",
];

function scaffold(cwd, policy) {
	mkdirSync(cwd, { recursive: true });
	if (compacts) {
		const settings = { compaction: { enabled: false, keepRecentTokens: 2_000 } };
		if (policy.compactionModel) {
			// A terse foreground (Opus) finishes phase 1 under a 2k tail, and Pi then refuses: "Nothing to compact".
			settings.compaction.keepRecentTokens = 500;
			settings.workOrchestrator = { context: { mode: "ultrafull", compactionModel: policy.compactionModel } };
		}
		mkdirSync(path.join(cwd, ".pi"), { recursive: true });
		writeFileSync(path.join(cwd, ".pi", "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
	}
	writeFileSync(path.join(cwd, "SPEC.md"), spec);
	writeFileSync(path.join(cwd, "test.mjs"), test);
	writeFileSync(
		path.join(cwd, "package.json"),
		'{"name":"calculator-lite","private":true,"type":"module"}\n',
	);
	execFileSync("git", ["init", "-q", "-b", "master"], { cwd });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run(policy, repetition, sequence) {
	const cwd = path.join(
		outputRoot,
		`rep-${repetition + 1}-${sequence + 1}-${policy.id}-${policy.label}`,
	);
	scaffold(cwd, policy);
	const sessionDir = path.join(cwd, "sessions");
	const wireProbeOutput = path.join(cwd, "wire-probe.jsonl");
	const piArgs = [
		piCli,
		"--mode",
		"rpc",
		"--session-dir",
		sessionDir,
		"--model",
		model,
		"--thinking",
		"high",
		"--tools",
		"read,bash,edit,write",
		"--no-extensions",
	];
	const selectedExtension =
		policy.extension ?? (matrix === "reasoning" ? extension : null);
	if (selectedExtension) piArgs.push("--extension", selectedExtension);
	// Anthropic runs need the user's OAuth pool provider: --no-extensions would leave a revoked auth.json token.
	if (model.startsWith("anthropic/") && existsSync(providerExtension)) piArgs.push("--extension", providerExtension);
	piArgs.push("--extension", wireProbe, "-a");
	const child = spawn(process.execPath, piArgs, {
		cwd,
		env: {
			...process.env,
			STRIP_THINKING: policy.value,
			STRIP_IMAGES: "0",
			STRIP_GIANT_RESULTS: "0",
			STRIP_SUPERSEDED_READS: "0",
			STRIP_DUPLICATES: "0",
			STRIP_DEBUG: "1",
			REASONING_WIRE_PROBE: wireProbeOutput,
		},
		stdio: ["pipe", "pipe", "pipe"],
	});
	const events = [];
	let stdout = "";
	let stderr = "";
	let buffer = "";
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
		buffer += chunk;
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			try {
				events.push(JSON.parse(line));
			} catch {}
		}
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	const started = Date.now();
	const checkpointResults = [];
	try {
		for (const [promptIndex, prompt] of prompts.entries()) {
			const settledBefore = events.filter(
				(event) => event.type === "agent_settled",
			).length;
			child.stdin.write(
				`${JSON.stringify({ type: "prompt", message: prompt })}\n`,
			);
			const deadline = Date.now() + 600_000;
			while (
				events.filter((event) => event.type === "agent_settled").length <=
				settledBefore
			) {
				if (child.exitCode !== null)
					throw new Error(`pi exited ${child.exitCode}: ${stderr.slice(-2000)}`);
				if (Date.now() > deadline) throw new Error("phase timed out");
				const refused = events.find((event) => event.type === "response" && event.command === "prompt" && event.success === false);
				if (refused) throw new Error(`pi refused ${refused.command}: ${refused.error}`);
				await sleep(250);
			}
			if (compacts && promptIndex < prompts.length - 1) {
				const responsesBefore = events.filter(
					(event) => event.type === "response" && event.command === "compact",
				).length;
				child.stdin.write(
					`${JSON.stringify({ type: "compact", customInstructions: `Phase ${promptIndex + 1} is complete and verified. Preserve its implemented behavior, files, test evidence, and the next requested phase.` })}\n`,
				);
				const deadline = Date.now() + 600_000;
				while (
					events.filter(
						(event) => event.type === "response" && event.command === "compact",
					).length <= responsesBefore
				) {
					if (child.exitCode !== null)
						throw new Error(`pi exited ${child.exitCode}: ${stderr.slice(-2000)}`);
					if (Date.now() > deadline)
						throw new Error("checkpoint compaction timed out");
					await sleep(250);
				}
				checkpointResults.push(
					events
						.filter(
							(event) => event.type === "response" && event.command === "compact",
						)
						.at(-1),
				);
			}
		}
	} finally {
		child.kill();
		writeFileSync(path.join(cwd, "rpc.stdout.jsonl"), stdout);
		writeFileSync(path.join(cwd, "rpc.stderr.log"), stderr);
	}
	let verification = "pass";
	let verificationOutput = "";
	try {
		verificationOutput = execFileSync(process.execPath, ["test.mjs", "3"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		verification = "fail";
		verificationOutput = `${error.stdout ?? ""}${error.stderr ?? ""}`;
	}
	const sessionFile = readdirSync(sessionDir)
		.filter((name) => name.endsWith(".jsonl"))
		.map((name) => path.join(sessionDir, name))[0];
	const entries = [];
	for (const line of readFileSync(sessionFile, "utf8").split(/\r?\n/)) {
		if (!line) continue;
		try {
			entries.push(JSON.parse(line));
		} catch {
			throw new Error(`malformed session line in ${sessionFile}`);
		}
	}
	const assistant = entries
		.filter(
			(entry) => entry.type === "message" && entry.message?.role === "assistant",
		)
		.map((entry) => entry.message);
	const usageMessages = [
		...assistant,
		...entries
			.filter((entry) => entry.type === "compaction" && entry.usage)
			.map((entry) => ({ usage: entry.usage })),
	];
	const usage = usageMessages.reduce(
		(sum, message) => {
			for (const key of [
				"input",
				"output",
				"cacheRead",
				"cacheWrite",
				"reasoning",
				"totalTokens",
			])
				sum[key] += message.usage?.[key] ?? 0;
			sum.costUsd += message.usage?.cost?.total ?? 0;
			return sum;
		},
		{
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			reasoning: 0,
			totalTokens: 0,
			costUsd: 0,
		},
	);
	const strips = [...stderr.matchAll(/thinking=(\d+)->(\d+)/g)].map((match) => ({
		before: Number(match[1]),
		after: Number(match[2]),
	}));
	const wireRequests = [];
	for (const line of readFileSync(wireProbeOutput, "utf8").split(/\r?\n/)) {
		if (!line) continue;
		try {
			wireRequests.push(JSON.parse(line));
		} catch {
			throw new Error(`malformed wire-probe line in ${wireProbeOutput}`);
		}
	}
	const wireReasoning = wireRequests.map(
		(request) => request.fields.reasoning_content?.count ?? 0,
	);
	const compactionEntries = entries.filter((entry) => entry.type === "compaction");
	return {
		scenario: "calculator-lite",
		policy: policy.id,
		label: policy.label,
		passed: verification === "pass",
		repetition: repetition + 1,
		sequence: sequence + 1,
		verification,
		verificationOutput: verificationOutput.trim().slice(-1000),
		compactions: compactionEntries.length,
		// Ultrafull puts usage on the compaction entry and the model in details; already counted in usage above.
		compactionModels: compactionEntries.map((entry) => entry.details?.compactionModel ?? null),
		compactionCostUsd: compactionEntries.reduce((sum, entry) => sum + (entry.usage?.cost?.total ?? 0), 0),
		compactionTokens: compactionEntries.reduce((sum, entry) => sum + (entry.usage?.totalTokens ?? 0), 0),
		checkpointCompactionsSucceeded: checkpointResults.filter(
			(result) => result?.success,
		).length,
		elapsedMs: Date.now() - started,
		turns: assistant.length,
		toolCalls: assistant.reduce(
			(sum, message) =>
				sum +
				(message.content ?? []).filter((part) => part?.type === "toolCall").length,
			0,
		),
		thinkingPartsStored: assistant.reduce(
			(sum, message) =>
				sum +
				(message.content ?? []).filter((part) => part?.type === "thinking").length,
			0,
		),
		contextsWithReasoningRemoved: strips.filter(
			(item) => item.after < item.before,
		).length,
		maxThinkingPartsRemoved: Math.max(
			0,
			...strips.map((item) => item.before - item.after),
		),
		wireRequests: wireRequests.length,
		wireRequestsWithReasoning: wireReasoning.filter(Boolean).length,
		wireReasoningFieldCounts: wireReasoning,
		usage,
		cwd,
		sessionFile,
	};
}

mkdirSync(outputRoot, { recursive: true });
const results = [];
for (let repetition = 0; repetition < repetitions; repetition++) {
	const order = rotations[repetition % rotations.length];
	for (let sequence = 0; sequence < order.length; sequence++) {
		const policy = policies[order[sequence]];
		process.stderr.write(
			`[reasoning-benchmark] repetition ${repetition + 1}, ${policy.id} ${policy.label}\n`,
		);
		const result = await run(policy, repetition, sequence);
		results.push(result);
		writeFileSync(
			path.join(outputRoot, "results.json"),
			`${JSON.stringify({ model, matrix, repetitions, results }, null, 2)}\n`,
		);
		// One file per arm with a shared scenario, so compare-benchmark-runs pairs L and T by repetition.
		if (matrix === "compaction-model")
			writeFileSync(
				path.join(outputRoot, `results-${policy.id}.json`),
				`${JSON.stringify({ model, matrix, repetitions, results: results.filter((r) => r.policy === policy.id) }, null, 2)}\n`,
			);
	}
}
process.stdout.write(
	`${JSON.stringify({ model, matrix, repetitions, outputRoot, results }, null, 2)}\n`,
);
if (results.some((result) => result.verification !== "pass"))
	process.exitCode = 1;
