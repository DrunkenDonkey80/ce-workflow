#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, fstatSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initStore, loadStore, mutateStore } from "../extensions/work-store.js";

const { cleanupImprovementReportBundles, submitImprovementReport } = await import("../extensions/work-improvement-reporting.js");
const { default: workModelsExtension } = await import("../extensions/work-models.js");
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const root = mkdtempSync(path.join(tmpdir(), "work-improvement-reporting-"));
const source = path.join(root, "source");
const consumer = path.join(root, "consumer");
mkdirSync(path.join(source, "extensions"), { recursive: true });
mkdirSync(path.join(consumer, ".pi", "work-runs"), { recursive: true });
execFileSync("git", ["init", "--quiet"], { cwd: source });
writeFileSync(path.join(source, ".gitignore"), ".pi/\n.pi-subagents/\n");
writeFileSync(path.join(source, "package.json"), JSON.stringify({ name: "pi-work-orchestrator", version: "1.2.3" }));
writeFileSync(path.join(source, "extensions", "work-models.js"), "export {};\n");
initStore(source);
const log = path.join(consumer, ".pi", "work-runs", "run.jsonl");
const secondLog = path.join(consumer, ".pi", "work-runs", "tool.jsonl");
writeFileSync(log, "{\"event\":\"SECRET_RAW_LOG_MARKER\"}\n");
writeFileSync(secondLog, "{\"tool\":\"read\"}\n");
try {
	const report = {
		observation: "Tool visibility was stale",
		expectedBehavior: "The active tool set should update",
		impact: "The producer cannot report workflow friction",
		logs: [log, secondLog],
		producer: "fixture-project",
		workflowId: "wf-fixture",
	};
	const result = await submitImprovementReport({
		cwd: consumer,
		packageRoot: source,
		settings: { workImprovement: { sourceCheckout: source } },
		report,
	});
	assert(result.taskId && result.epicId && existsSync(result.bundlePath), "report returns durable task and bundle");
	const store = loadStore(source);
	assert(store.items[result.epicId].title === "Self-improving", "creates exact epic");
	assert(store.items[result.taskId].parentId === result.epicId, "creates epic child");
	assert(!JSON.stringify(store.items[result.taskId]).includes(log), "tracked task excludes absolute source path");
	assert(!JSON.stringify(store.items[result.taskId]).includes("SECRET_RAW_LOG_MARKER"), "tracked task excludes raw log content");
	const manifest = JSON.parse(readFileSync(path.join(result.bundlePath, "manifest.json"), "utf8"));
	assert(manifest.files.length === 2 && manifest.files[0].source === log, "manifest retains complete source provenance");
	assert(readFileSync(path.join(result.bundlePath, manifest.files[0].file), "utf8") === readFileSync(log, "utf8"), "first log is copied completely");
	assert(readFileSync(path.join(result.bundlePath, manifest.files[1].file), "utf8") === readFileSync(secondLog, "utf8"), "second log is copied completely");
	if (process.platform !== "win32") {
		assert((statSync(result.bundlePath).mode & 0o777) === 0o700, "bundle is owner-only");
		assert((statSync(path.join(result.bundlePath, "manifest.json")).mode & 0o777) === 0o600, "manifest is owner-only");
	}
	assert(execFileSync("git", ["check-ignore", "-q", "--", ".pi/self-improvement-reports"], { cwd: source }).toString() === "", "bundle destination is ignored");

	const submit = (nextReport, extra = {}) => submitImprovementReport({
		cwd: consumer,
		packageRoot: source,
		settings: { workImprovement: { sourceCheckout: source } },
		report: nextReport,
		...extra,
	});
	const second = await submit({ ...report, observation: "Same report" });
	assert(second.taskId !== result.taskId, "each call creates one distinct task");
	const relative = await submit({ ...report, observation: "Relative log", logs: [path.relative(consumer, log)] });
	assert(relative.taskId, "relative evidence paths resolve from the consumer project");
	const boundedResult = await submit({
		...report,
		observation: `  ${"x".repeat(800)}\u0000  `,
		expectedBehavior: "expected\nbehavior",
		impact: "impact\tvalue",
		producer: `../${"producer".repeat(20)}`,
		workflowId: "workflow".repeat(30),
	});
	const boundedTask = loadStore(source).items[boundedResult.taskId];
	const provenance = boundedTask.evidence[0];
	assert(boundedTask.title.length <= 155 && !/[\x00\t]/.test(boundedTask.description), "tracked report text is bounded and sanitized");
	assert(provenance.producer.length <= 80 && !/[\\/]/.test(provenance.producer), "producer provenance is safe and bounded");
	assert(provenance.workflowId.length <= 120, "workflow provenance is bounded");
	mutateStore(source, (next) => { next.items[result.taskId].status = "closed"; });
	cleanupImprovementReportBundles(source);
	assert(!existsSync(result.bundlePath), "closed report cleanup removes its evidence bundle");
	const reportRoot = path.join(source, ".pi", "self-improvement-reports");
	const stale = path.join(reportRoot, "stale-orphan");
	const fresh = path.join(reportRoot, "fresh-orphan");
	mkdirSync(stale);
	mkdirSync(fresh);
	const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
	utimesSync(stale, old, old);
	cleanupImprovementReportBundles(source);
	assert(!existsSync(stale) && existsSync(fresh), "cleanup removes only stale unreferenced bundles");

	rmSync(path.join(source, ".ce-workflow", "work-items.json"));
	initStore(source);
	let queued = 0;
	let releaseQueued;
	let queueTail = Promise.resolve();
	const bothQueued = new Promise((resolve) => { releaseQueued = resolve; });
	const concurrentQueue = async (_file, mutation) => {
		queued += 1;
		if (queued === 2) releaseQueued();
		await bothQueued;
		const previous = queueTail;
		let release;
		queueTail = new Promise((resolve) => { release = resolve; });
		await previous;
		try {
			return mutation();
		} finally {
			release();
		}
	};
	const concurrent = await Promise.all([
		submit({ ...report, observation: "Concurrent A" }, { withFileMutationQueue: concurrentQueue }),
		submit({ ...report, observation: "Concurrent B" }, { withFileMutationQueue: concurrentQueue }),
	]);
	assert(concurrent[0].taskId !== concurrent[1].taskId, "concurrent submissions create distinct tasks");
	assert(concurrent[0].epicId === concurrent[1].epicId, "concurrent submissions create one active epic");
	assert(
		Object.values(loadStore(source).items).filter((item) => item.type === "epic").length === 1,
		"parallel first submissions create exactly one epic",
	);
	const cleanupFailure = await submit({ ...report, observation: "Cleanup failure" }, {
		_cleanupBundles: () => { throw new Error("injected cleanup failure"); },
	});
	assert(cleanupFailure.taskId, "retention failure does not block report intake");

	const beforeFailures = Object.values(loadStore(source).items).filter((item) => item.type === "task").length;
	writeFileSync(path.join(root, "outside.log"), "outside\n");
	for (const [candidate, message] of [
		[path.join(consumer, ".pi", "work-runs", "missing.log"), "missing evidence"],
		[path.join(consumer, ".pi", "work-runs"), "directory evidence"],
	]) {
		await submit({ ...report, logs: [candidate] }).then(
			() => assert(false, `${message} must fail`),
			(error) => assert(/evidence/.test(error.message), `${message} fails clearly`),
		);
	}
	await submit({ ...report, logs: [path.join(root, "outside.log")] }).then(
		() => assert(false, "unrelated evidence must fail"),
		(error) => assert(/approved evidence root/.test(error.message), "unrelated evidence fails clearly"),
	);
	const outsideDir = path.join(root, "outside-dir");
	const linkedDir = path.join(consumer, ".pi", "work-runs", "linked");
	mkdirSync(outsideDir);
	writeFileSync(path.join(outsideDir, "secret.log"), "secret\n");
	symlinkSync(outsideDir, linkedDir, process.platform === "win32" ? "junction" : "dir");
	if (process.platform !== "win32") {
		const linkedFile = path.join(consumer, ".pi", "work-runs", "linked-file.log");
		symlinkSync(log, linkedFile, "file");
		await submit({ ...report, logs: [linkedFile] }).then(
			() => assert(false, "direct symlink evidence must fail"),
			(error) => assert(/symlink/.test(error.message), "direct symlink fails clearly"),
		);
	}
	await submit({ ...report, logs: [path.join(linkedDir, "secret.log")] }).then(
		() => assert(false, "symlinked parent evidence must fail"),
		(error) => assert(/symlink/.test(error.message), "symlinked parent fails clearly"),
	);
	let capturedFd;
	await submit({ ...report, observation: "Setup failure", logs: [log] }, {
		_beforeCopy: ([input]) => { capturedFd = input.fd; throw new Error("injected setup failure"); },
	}).then(
		() => assert(false, "setup failure must not report success"),
		(error) => assert(/injected setup failure/.test(error.message), "setup failure propagates clearly"),
	);
	let descriptorClosed = false;
	try {
		fstatSync(capturedFd);
	} catch (error) {
		descriptorClosed = error?.code === "EBADF";
	}
	assert(descriptorClosed, "setup failure closes accepted evidence descriptors");
	const oversized = path.join(consumer, ".pi", "work-runs", "oversized.log");
	writeFileSync(oversized, Buffer.alloc(4 * 1024 * 1024 + 1));
	await submit({ ...report, logs: [oversized] }).then(
		() => assert(false, "oversized evidence must fail"),
		(error) => assert(/exceeds/.test(error.message), "oversized evidence fails clearly"),
	);
	const growing = path.join(consumer, ".pi", "work-runs", "growing.log");
	writeFileSync(growing, "before\n");
	await submit({ ...report, logs: [growing] }, {
		_beforeCopy: () => writeFileSync(growing, "before\nafter\n"),
	}).then(
		() => assert(false, "growing evidence must fail"),
		(error) => assert(/changed/.test(error.message), "growing evidence fails clearly"),
	);
	const rewritten = path.join(consumer, ".pi", "work-runs", "rewritten.log");
	writeFileSync(rewritten, "alpha\n");
	await submit({ ...report, logs: [rewritten] }, {
		_beforeCopy: () => writeFileSync(rewritten, "omega\n"),
	}).then(
		() => assert(false, "same-size rewritten evidence must fail"),
		(error) => assert(/changed/.test(error.message), "same-size rewritten evidence fails clearly"),
	);
	await submit({ ...report, observation: "Rename failure" }, {
		_renameBundle: () => { throw new Error("injected rename failure"); },
	}).then(
		() => assert(false, "rename failure must not report success"),
		(error) => assert(/injected rename failure/.test(error.message), "rename failure propagates clearly"),
	);
	await submit({ ...report, observation: "No-op rename" }, { _renameBundle: () => {} }).then(
		() => assert(false, "no-op rename must not create a task"),
		(error) => assert(/finalized/.test(error.message), "no-op rename fails the complete-bundle check"),
	);
	const sourcePi = path.join(source, ".pi");
	const savedPi = path.join(source, ".pi-safe");
	const escapedPi = path.join(root, "escaped-pi");
	renameSync(sourcePi, savedPi);
	mkdirSync(escapedPi);
	symlinkSync(escapedPi, sourcePi, process.platform === "win32" ? "junction" : "dir");
	try {
		await submit({ ...report, observation: "Unsafe destination" }).then(
			() => assert(false, "symlinked destination must fail"),
			(error) => assert(/destination.*symlink/i.test(error.message), "symlinked destination fails clearly"),
		);
	} finally {
		rmSync(sourcePi, { recursive: true, force: true });
		renameSync(savedPi, sourcePi);
	}
	const movedLog = `${log}.moved`;
	renameSync(log, movedLog);
	renameSync(movedLog, log);
	await submit({ ...report, observation: "Store failure" }, {
		withFileMutationQueue: async () => { throw new Error("injected store failure"); },
	}).then(
		() => assert(false, "store failure must not report success"),
		(error) => assert(/injected store failure/.test(error.message), "store failure propagates clearly"),
	);
	assert(
		Object.values(loadStore(source).items).filter((item) => item.type === "task").length === beforeFailures,
		"failed submissions do not create tasks",
	);

	const tools = {};
	const hooks = {};
	let activeTools = ["unrelated_tool"];
	workModelsExtension({
		on: (name, handler) => { hooks[name] = handler; },
		registerTool: (tool) => { tools[tool.name] = tool; },
		registerCommand: () => {},
		getActiveTools: () => activeTools,
		setActiveTools: (next) => { activeTools = next; },
	});
	writeFileSync(path.join(consumer, ".pi", "settings.json"), JSON.stringify({ workResume: { selfImproving: true }, workImprovement: { sourceCheckout: source } }));
	await hooks.session_start({}, { cwd: consumer, ui: { notify() {}, setStatus() {}, setTitle() {} } });
	assert(activeTools.includes("unrelated_tool") && activeTools.includes("work_report_improvement"), "enabled reporting adds only its tool");
	const toolResult = await tools.work_report_improvement.execute("call", report, undefined, undefined, { cwd: consumer, sessionManager: { getSessionId: () => "session-fixture" } });
	assert(toolResult.details.taskId && toolResult.details.epicId && toolResult.details.bundle, "tool returns bounded task, epic, and bundle details");
	writeFileSync(path.join(consumer, ".pi", "settings.json"), JSON.stringify({ workResume: { selfImproving: false }, workImprovement: { sourceCheckout: source } }));
	await hooks.session_start({}, { cwd: consumer, ui: { notify() {}, setStatus() {}, setTitle() {} } });
	assert(activeTools.includes("unrelated_tool") && !activeTools.includes("work_report_improvement"), "disabled reporting removes only its tool");
	await tools.work_report_improvement.execute("stale", report, undefined, undefined, { cwd: consumer }).then(
		() => assert(false, "stale invocation must fail"),
		(error) => assert(/disabled/.test(error.message), "stale invocation fails closed"),
	);
	console.log("ok - work improvement reporting fixtures pass");
} finally {
	rmSync(root, { recursive: true, force: true });
}
