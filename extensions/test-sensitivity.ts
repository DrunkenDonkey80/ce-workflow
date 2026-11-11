import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const TEST_SENSITIVITY = "**Test sensitivity (every project)**: for each nontrivial behavior change, keep a focused regression test and prove it detects a plausible bug, not just that it passes. Genuine failing-before-fix and passing-after-fix evidence from the same test counts; otherwise use test_sensitivity for one targeted mutation in a disposable source copy. Select a meaningful production-code change (invert a guard, drop validation, move a protected read, alter a boundary), never damage tests or insert an unconditional failure. Use the project's existing focused command, not a full mutation sweep. For concurrent state, control the competing write with barriers rather than sleeps; cover exact boundaries when relevant. A survivor means strengthen the test or explain why the mutant is equivalent, then retry the meaningful check. Syntax/import errors, timeouts and unrelated failures are not caught bugs: inspect the failing assertion. Report the test, mutation or original bug, red/green evidence and any remaining gap before calling the work verified. Never mutate the shared working tree to obtain this proof. Documentation-only changes need no mutation; respect explicit no-tests requests, missing hardware and unavailable safe isolation, and state the unverified gap instead of inventing success. During planning, put this check in the relevant implementation step; do not execute it in research-only work.";

const hash = data => createHash("sha256").update(data).digest("hex");
const inside = (root, file) => {
	const relative = path.relative(root, file);
	return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
function local(root, name) {
	if (typeof name !== "string" || !name || path.isAbsolute(name) || name.split(/[\\/]/).some(part => part === ".." || part.toLowerCase() === ".git")) throw new Error("Use a relative project path without .. or .git");
	const file = path.resolve(root, name);
	if (!inside(root, file)) throw new Error("Path must be inside the project");
	return file;
}
const output = result => `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
const green = result => result.code === 0 && !result.killed && !result.truncated;
const infrastructureFailure = /SyntaxError:|Cannot find module|ERR_MODULE_NOT_FOUND|ModuleNotFoundError:|command not found|Test suite failed to run|error TS\d+:|No test files found/i;

// The copy isolates our mutation, not arbitrary test programs: commands must use disposable local fixtures.
export async function runSensitivity(cwd, input, exec, signal) {
	if (!input.oldText || input.oldText === input.newText || typeof input.newText !== "string") throw new Error("Provide a nonempty, changing exact replacement");
	if (typeof input.expectedFailure !== "string" || !input.expectedFailure.trim()) throw new Error("Name the specific assertion failure expected from this mutant");
	if (!input.command || !Array.isArray(input.args) || input.args.some(arg => typeof arg !== "string")) throw new Error("Use an existing test executable and its argument array");
	const timeout = input.timeoutMs ?? 120_000;
	if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120_000) throw new Error("timeoutMs must be 1–120000 per run");
	signal?.throwIfAborted();
	cwd = await realpath(cwd);
	const git = async args => {
		const result = await exec("git", args, { cwd, signal, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
		if (!green(result)) throw new Error(`Git snapshot unavailable: ${output(result).slice(-2000)}`);
		return result.stdout;
	};
	const root = await realpath((await git(["rev-parse", "--show-toplevel"])).trim());
	const source = local(cwd, input.file.replace(/^@/, ""));
	if (!inside(root, await realpath(source))) throw new Error("Mutation target resolves outside the repository");
	const target = path.relative(root, source);
	const dependencies = [...new Set(input.dependencyDirs ?? [])].map(name => local(root, name));
	for (const dir of dependencies) {
		if (dir === source || inside(dir, source)) throw new Error("Cannot mutate a shared dependency");
		if (!(await lstat(dir)).isDirectory() && !(await lstat(dir)).isSymbolicLink()) throw new Error("Dependencies must be directories");
		if ((await git(["-C", root, "ls-files", "--cached", "--", dir])).trim()) throw new Error("Cannot share a dependency directory containing tracked source");
	}
	const names = [...new Set((await git(["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--full-name"])).split("\0").filter(Boolean))].sort();
	if (names.length > 20_000) throw new Error("Snapshot exceeds 20000 files; use the project's own isolated sensitivity check");
	const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "pi-test-sensitivity-"));
	const scratch = path.join(evidenceDir, "source");
	const runs = [], manifest = [];
	const report = { status: "inconclusive", file: target, command: input.command, args: input.args, expectedFailure: input.expectedFailure, evidenceDir, runs, sourceHash: "", mutantHash: "", snapshotHash: "", reason: "" };
	try {
		await mkdir(scratch);
		let bytes = 0;
		for (const name of names) {
			signal?.throwIfAborted();
			const from = local(root, name);
			if (dependencies.some(dir => from === dir || inside(dir, from))) continue;
			let info;
			try { info = await lstat(from); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
			if (!info.isFile() || !inside(root, await realpath(from))) throw new Error(`Snapshot needs a regular in-repository file: ${name}`);
			bytes += info.size;
			if (bytes > 512 * 1024 * 1024) throw new Error("Snapshot exceeds 512 MiB; use the project's own isolated sensitivity check");
			const to = local(scratch, name);
			await mkdir(path.dirname(to), { recursive: true });
			await copyFile(from, to);
			manifest.push([name, hash(await readFile(to))]);
		}
		for (const dir of dependencies) {
			const to = local(scratch, path.relative(root, dir));
			await mkdir(path.dirname(to), { recursive: true });
			await symlink(await realpath(dir), to, "junction");
		}
		const file = local(scratch, target), original = await readFile(file, "utf8");
		if (original.split(input.oldText).length !== 2) throw new Error("oldText must match exactly once in the captured source");
		const mutated = original.replace(input.oldText, () => input.newText);
		report.sourceHash = hash(original); report.mutantHash = hash(mutated); report.snapshotHash = hash(JSON.stringify(manifest));
		const run = async phase => {
			signal?.throwIfAborted();
			const start = Date.now();
			const result = await exec(input.command, input.args, { cwd: path.join(scratch, path.relative(root, cwd)), signal, timeout, maxBuffer: 1024 * 1024 });
			const text = output(result), log = path.join(evidenceDir, `${phase}.log`);
			await writeFile(log, text);
			runs.push({ phase, code: result.code, killed: Boolean(result.killed), truncated: Boolean(result.truncated), elapsedMs: Date.now() - start, log, tail: text.slice(-4000) });
			return result;
		};
		const baseline = await run("baseline");
		if (!green(baseline)) { report.reason = "Baseline is not green; no mutation attempted"; return report; }
		if (output(baseline).includes(input.expectedFailure)) { report.reason = "Failure marker already occurs in passing output; choose a specific failing assertion"; return report; }
		if (await readFile(file, "utf8") !== original) throw new Error("Baseline command changed the mutation target");
		await writeFile(file, mutated);
		let mutant;
		try { mutant = await run("mutant"); } finally { await writeFile(file, original); }
		const restored = await run("restored");
		if (!green(restored)) { report.reason = "Restored test is not green"; return report; }
		for (const [name, digest] of manifest) {
			if (hash(await readFile(local(scratch, name))) !== digest) throw new Error(`Test command changed captured source: ${name}`);
		}
		if (green(mutant)) { report.status = "survived"; report.reason = "Mutant passed; strengthen the test or justify equivalence"; }
		else if (mutant.code === 1 && !mutant.killed && !mutant.truncated && !infrastructureFailure.test(output(mutant)) && output(mutant).includes(input.expectedFailure)) {
			report.status = "caught"; report.reason = "Green baseline, expected failing assertion under mutation, green restored run. Inspect the assertion's relevance; this is not proof against other bugs.";
		} else report.reason = "Mutant did not produce the declared assertion failure; infrastructure errors and other failures do not count";
		return report;
	} catch (error) {
		report.status = "inconclusive"; report.reason = String(error.message ?? error);
		return report;
	} finally {
		try { await rm(scratch, { recursive: true, force: true, maxRetries: 3 }); }
		catch (error) { report.status = "inconclusive"; report.reason += `; scratch cleanup failed: ${error.message}`; }
		await writeFile(path.join(evidenceDir, "result.json"), JSON.stringify(report, null, 2));
	}
}

export function registerTestSensitivity(pi) {
	pi.registerTool({
		name: "test_sensitivity",
		label: "Test sensitivity",
		description: "Check one meaningful production-code mutation using an existing local test executable. Copies current Git tracked and nonignored untracked files (including dirty edits), not Git metadata; never patches the original. Runs green baseline → mutant → restored. Select a specific failing assertion marker absent from passing output, not a test name. No syntax errors, test edits, unconditional throws, live services or destructive test commands. Source isolation is not an OS sandbox; optional dependency directories are shared. Missing ignored fixtures or unsupported layouts remain inconclusive. Review the assertion before claiming the bug is caught.",
		promptSnippet: "Prove a focused test catches a deliberate bug in a disposable source copy",
		parameters: { type: "object", properties: {
			file: { type: "string", description: "Production source file relative to current project directory" },
			oldText: { type: "string", minLength: 1 }, newText: { type: "string" },
			command: { type: "string", minLength: 1, description: "Existing test executable, no shell interpolation" },
			args: { type: "array", items: { type: "string" }, maxItems: 100 },
			expectedFailure: { type: "string", minLength: 1, description: "Specific assertion failure text, not merely a test name or generic exit status" },
			dependencyDirs: { type: "array", items: { type: "string" }, maxItems: 8, description: "Optional installed dependency directories relative to Git root (e.g. node_modules); linked, not copied. Must contain no tracked source." },
			timeoutMs: { type: "integer", minimum: 1, maximum: 120000, description: "Per test run, default 120000" },
		}, required: ["file", "oldText", "newText", "command", "args", "expectedFailure"], additionalProperties: false },
		async execute(_id, input, signal, _update, ctx) {
			const result = await runSensitivity(ctx.cwd, input, (command, args, options) => pi.exec(command, args, options), signal);
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result, isError: result.status !== "caught" };
		},
	});
}
