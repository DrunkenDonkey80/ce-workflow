import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	EXTENSION_SCOUT_LEDGER,
	EXTENSION_SCOUT_REVISIT_POLICY,
	inspectQueuedExtensions,
	parseExtensionInspectionFacts,
	parseExtensionReview,
	parseRecentExtensions,
	readExtensionScoutLedger,
	reviewInspectedExtensions,
	runExtensionScout,
	writeExtensionScoutLedger,
} from "../extensions/work-extension-scout.js";

function assert(value, message) {
	if (!value) throw new Error(message);
	console.log(`ok - ${message}`);
}

const entry = (name, description, timestamp, repo = `https://github.com/acme/${name}`) => `<article><a href="https://www.npmjs.com/package/${name}">${name}</a><p class="description">${description}</p><time datetime="${timestamp}">recent</time><a href="${repo}">repository</a></article>`;
const html = (entries) => `<main>${entries.join("\n")}</main>`;
const sample = parseRecentExtensions(html([entry("pi-useful", "Useful &amp; safe", "2026-01-20T12:00:00Z")]));
assert(sample[0].name === "pi-useful" && sample[0].description === "Useful & safe", "extracts package name and description");
assert(sample[0].timestamp === "2026-01-20T12:00:00.000Z" && sample[0].npmUrl.endsWith("/pi-useful") && sample[0].repositoryUrl.endsWith("/pi-useful"), "extracts timestamp, npm URL, and repository URL");

const cwd = mkdtempSync(path.join(tmpdir(), "extension-scout-"));
try {
	const entries = Array.from({ length: 13 }, (_, index) => entry(`pi-${index}`, `Workflow helper ${index}`, `2026-01-${String(10 + index).padStart(2, "0")}T00:00:00Z`));
	let requestedSince;
	const first = await runExtensionScout(cwd, {
		now: "2026-02-01T00:00:00Z",
		collect: ({ since }) => { requestedSince = since; return [html(entries.slice(0, 7)), html(entries.slice(7))]; },
		screen: async (items) => items.map((item, index) => ({ name: item.name, plausible: true, score: 100 - index, rationale: "metadata suggests workflow value" })),
	});
	assert(requestedSince === "2026-01-02T00:00:00.000Z", "initial successful scan covers 30 days");
	assert(first.selected.length === 10 && first.overflow.length === 3, "caps current run at 10 and durably retains overflow");
	assert(Object.keys(first.ledger.packages).length === 13 && first.ledger.queue.length === 13, "atomic ledger preserves every seen package and ordered queue");

	await runExtensionScout(cwd, {
		now: "2026-02-02T00:00:00Z",
		collect: ({ since }) => { requestedSince = since; return html([entry("pi-0", "Updated helper", "2026-02-01T12:00:00Z")]); },
		screen: async () => [{ name: "pi-0", plausible: true, score: 200, rationale: "updated" }],
	});
	assert(requestedSince === "2026-02-01T00:00:00.000Z" && readExtensionScoutLedger(cwd).queue.length === 13, "later scan starts at cursor and deduplicates durable queue");

	const cursor = readExtensionScoutLedger(cwd).cursor;
	let failed = false;
	try {
		await runExtensionScout(cwd, {
			now: "2026-02-03T00:00:00Z",
			collect: async () => html([entry("pi-seen-on-failure", "Maybe useful", "2026-02-02T12:00:00Z")]),
			screen: async () => { throw new Error("model offline"); },
		});
	} catch (error) { failed = /cursor unchanged/.test(error.message); }
	const afterModelFailure = readExtensionScoutLedger(cwd);
	assert(failed && afterModelFailure.cursor === cursor && afterModelFailure.packages["pi-seen-on-failure"], "model failure is visible, preserves seen metadata, and does not advance cursor");

	for (const collect of [async () => { throw new Error("catalog offline"); }, async () => "<html>changed</html>"]) {
		failed = false;
		try { await runExtensionScout(cwd, { now: "2026-02-04T00:00:00Z", collect, screen: async () => [] }); }
		catch (error) { failed = /cursor unchanged/.test(error.message); }
		assert(failed && readExtensionScoutLedger(cwd).cursor === cursor, "catalog/parser failure is visible and leaves cursor unchanged");
	}
	assert(!readFileSync(path.join(cwd, EXTENSION_SCOUT_LEDGER), "utf8").includes("instructions"), "screening ledger contains decisions, not executable metadata instructions");

	const facts = Object.fromEntries(["capability", "quality", "maintenance", "dependency", "security", "overlap", "installVersusBorrow"].map((category) => [category, [{ claim: `${category} claim`, evidence: "package.json" }]]));
	assert(parseExtensionInspectionFacts(JSON.stringify(facts)).security[0].evidence === "package.json", "accepts bounded evidence-backed inspection facts");
	for (const invalid of ["not json", JSON.stringify({ ...facts, capability: Array(21).fill(facts.capability[0]) }), JSON.stringify({ ...facts, extra: [] }), "x".repeat(33 * 1024)]) {
		let rejected = false;
		try { parseExtensionInspectionFacts(invalid); } catch { rejected = true; }
		assert(rejected, "rejects malformed, unknown, or over-limit inspection facts");
	}

	const sourceRepo = path.join(cwd, "source-repo");
	mkdirSync(sourceRepo);
	execFileSync("git", ["init", "-q"], { cwd: sourceRepo });
	writeFileSync(path.join(sourceRepo, "package.json"), JSON.stringify({ name: "safe-source", scripts: { install: "node install.js", test: "node test.js", build: "node build.js" } }));
	writeFileSync(path.join(sourceRepo, "README.md"), "# safe source\n");
	writeFileSync(path.join(sourceRepo, "install.js"), "require('node:fs').writeFileSync('EXECUTED', 'bad')\n");
	execFileSync("git", ["add", "."], { cwd: sourceRepo });
	execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "fixture"], { cwd: sourceRepo });
	const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: sourceRepo, encoding: "utf8" }).trim();
	const candidate = { name: "safe-source", repositoryUrl: "https://github.com/acme/safe-source", score: 100, timestamp: "2026-02-02T00:00:00.000Z" };
	writeExtensionScoutLedger(cwd, { version: 1, cursor, packages: { "safe-source": candidate }, queue: [candidate], currentRun: [candidate] });
	let quarantinePath;
	const inspected = await inspectQueuedExtensions(cwd, {
		now: "2026-02-05T00:00:00Z",
		clone: (_url, destination) => execFileSync("git", ["clone", "--quiet", "--depth", "1", "--no-recurse-submodules", "--", sourceRepo, destination]),
		cleanup: (root) => { quarantinePath = root; rmSync(root, { recursive: true, force: true }); },
		inspect: async (payload) => {
			assert(payload.revision === sourceRevision && payload.files.some((file) => file.path === "package.json"), "shallow quarantine records revision and supplies allowed inert file text");
			assert(!existsSync(path.join(sourceRepo, "EXECUTED")), "inspection does not run installs, scripts, builds, tests, or source");
			return facts;
		},
	});
	assert(inspected.inspected[0].ok && inspected.ledger.queue.length === 0, "successful inspection durably completes only its queue entry");
	assert(quarantinePath && !existsSync(quarantinePath), "disposable source quarantine is cleaned after inspection");
	assert(inspected.ledger.packages["safe-source"].inspection.revision === sourceRevision, "durably records the inspected source revision");
	assert(!existsSync(path.join(sourceRepo, "EXECUTED")), "source execution remains disabled after cleanup");

	const tampered = { ...candidate, name: "tampered-remote", repositoryUrl: "ext::sh -c touch% /tmp/owned" };
	writeExtensionScoutLedger(cwd, { version: 1, cursor, packages: { [tampered.name]: tampered }, queue: [tampered], currentRun: [tampered] });
	let cloneCalled = false;
	const tamperedResult = await inspectQueuedExtensions(cwd, {
		clone: () => { cloneCalled = true; },
		inspect: async () => facts,
	});
	assert(!tamperedResult.inspected[0].ok && !cloneCalled && tamperedResult.ledger.queue.length === 1 && tamperedResult.ledger.currentRun.length === 1, "tampered remote-helper URL is rejected before clone and remains resumable");

	async function rejectedSource(record, label) {
		const item = { ...candidate, name: label };
		writeExtensionScoutLedger(cwd, { version: 1, cursor, packages: { [label]: item }, queue: [item], currentRun: [item] });
		let inspectorCalled = false;
		const result = await inspectQueuedExtensions(cwd, {
			clone: (_url, destination) => { mkdirSync(destination, { recursive: true }); },
			git: (_root, args) => args[0] === "rev-parse" ? sourceRevision : record,
			inspect: async () => { inspectorCalled = true; return facts; },
		});
		assert(!result.inspected[0].ok && !inspectorCalled && result.ledger.queue.length === 1, `${label} fails closed and remains resumable`);
	}
	await rejectedSource(`100644 ${"a".repeat(40)} 0\t../outside.json\0`, "traversal");
	await rejectedSource(`120000 ${"a".repeat(40)} 0\tREADME.md\0`, "symlink");

	const malformed = { ...candidate, name: "malformed-facts" };
	writeExtensionScoutLedger(cwd, { version: 1, cursor, packages: { [malformed.name]: malformed }, queue: [malformed], currentRun: [malformed] });
	const malformedResult = await inspectQueuedExtensions(cwd, {
		clone: (_url, destination) => { mkdirSync(destination, { recursive: true }); writeFileSync(path.join(destination, "package.json"), "{}\n"); },
		git: (_root, args) => args[0] === "rev-parse" ? sourceRevision : `100644 ${"a".repeat(40)} 0\tpackage.json\0`,
		inspect: async () => "not json",
	});
	assert(!malformedResult.inspected[0].ok && malformedResult.ledger.currentRun.length === 1, "malformed Luna output is visible and leaves the queue entry resumable");

	const cleanup = { ...candidate, name: "cleanup-failure" };
	writeExtensionScoutLedger(cwd, { version: 1, cursor, packages: { [cleanup.name]: cleanup }, queue: [cleanup], currentRun: [cleanup] });
	const cleanupResult = await inspectQueuedExtensions(cwd, {
		clone: (_url, destination) => { mkdirSync(destination, { recursive: true }); writeFileSync(path.join(destination, "package.json"), "{}\n"); },
		git: (_root, args) => args[0] === "rev-parse" ? sourceRevision : `100644 ${"a".repeat(40)} 0\tpackage.json\0`,
		inspect: async () => facts,
		cleanup: (root) => { rmSync(root, { recursive: true, force: true }); throw new Error("locked"); },
	});
	assert(!cleanupResult.inspected[0].ok && /cleanup/.test(cleanupResult.ledger.lastError) && cleanupResult.ledger.queue.length === 1, "cleanup failure fails closed, remains visible, and preserves the queue entry");

	const review = { actionable: true, recommendation: "proceed", reason: "insufficient-evidence", rationale: "Bounded rationale", pov: "Adopt a concrete capability", benefit: "Less manual work", costRisk: "Low, package-scoped risk" };
	assert(parseExtensionReview(review).recommendation === "proceed", "accepts bounded finalist reviewer output");
	for (const invalid of ["not json", { ...review, recommendation: "install" }, { ...review, extra: true }, { ...review, rationale: "x".repeat(1_001) }]) {
		let rejected = false;
		try { parseExtensionReview(invalid); } catch { rejected = true; }
		assert(rejected, "rejects malformed, unknown, or over-limit finalist reviews");
	}

	const finalist = { ...candidate, name: "finalist" };
	writeExtensionScoutLedger(cwd, { version: 1, cursor, packages: { finalist: { ...finalist, inspection: { ok: true, revision: sourceRevision, facts } } }, queue: [], currentRun: [], finalists: [finalist] });
	let reviewFailed = false;
	try { await reviewInspectedExtensions(cwd, { review: async () => "not json", decide: async () => null }); }
	catch (error) { reviewFailed = /remains resumable/.test(error.message); }
	assert(reviewFailed && readExtensionScoutLedger(cwd).finalists.length === 1, "malformed reviewer output fails visibly and leaves the finalist resumable");

	let installed = 0;
	let prompted = 0;
	await reviewInspectedExtensions(cwd, {
		now: "2026-03-01T00:00:00Z",
		review: async () => review,
		decide: async () => { prompted += 1; return { status: "proceed", reason: "insufficient-evidence", rationale: "Actor chose proceed", explicit: true }; },
		install: async (name) => { installed += name === "finalist" ? 1 : 0; },
	});
	assert(prompted === 1 && installed === 1 && readExtensionScoutLedger(cwd).packages.finalist.decision.status === "proceed", "actionable finalist prompts once and explicit proceed gates installation");

	const gated = { ...finalist, name: "install-gated" };
	writeExtensionScoutLedger(cwd, { version: 1, cursor, packages: { [gated.name]: { ...gated, inspection: { ok: true, revision: sourceRevision, facts } } }, queue: [], currentRun: [], finalists: [gated] });
	let gatedFailure = false;
	try {
		await reviewInspectedExtensions(cwd, { review: async () => review, decide: async () => ({ status: "proceed", reason: "insufficient-evidence", rationale: "not explicit" }), install: async () => { installed += 1; } });
	} catch (error) { gatedFailure = /Explicit proceed/.test(error.message); }
	assert(gatedFailure && installed === 1 && readExtensionScoutLedger(cwd).finalists.length === 1, "installation never runs without explicit proceed and the finalist stays resumable");

	for (const [reason, expected] of Object.entries({ "out-of-scope": null, "weak-idea": 180, duplicate: 90, immature: 30, "bad-implementation": 30, unsafe: 180, "insufficient-evidence": 30 })) {
		const item = { ...finalist, name: `reason-${reason}` };
		writeExtensionScoutLedger(cwd, { version: 1, cursor, packages: { [item.name]: { ...item, inspection: { ok: true, revision: sourceRevision, facts } } }, queue: [], currentRun: [], finalists: [item] });
		const result = await reviewInspectedExtensions(cwd, {
			now: "2026-03-01T00:00:00Z",
			review: async () => ({ ...review, actionable: false, recommendation: "reject", reason }),
			decide: async () => { throw new Error("non-actionable review must not prompt"); },
		});
		const decision = result.ledger.packages[item.name].decision;
		assert(decision.reason === reason && decision.revisitAt === (expected === null ? null : new Date(Date.parse("2026-03-01T00:00:00Z") + expected * 86400000).toISOString()) && decision.updateRequired === EXTENSION_SCOUT_REVISIT_POLICY[reason].updateRequired, `${reason} enforces its exact permanent/window/update policy without prompting`);
	}

	const inaccessible = { ...candidate, name: "inaccessible-source" };
	writeExtensionScoutLedger(cwd, { version: 1, cursor, packages: { [inaccessible.name]: inaccessible }, queue: [inaccessible], currentRun: [inaccessible], finalists: [] });
	const inaccessibleResult = await inspectQueuedExtensions(cwd, { now: "2026-03-01T00:00:00Z", clone: async () => { throw new Error("forge unavailable"); }, inspect: async () => facts });
	assert(inaccessibleResult.ledger.packages[inaccessible.name].decision.reason === "insufficient-evidence" && inaccessibleResult.ledger.queue.length === 0, "inaccessible source is durably classified as insufficient-evidence");

	const overflowFinalists = Array.from({ length: 11 }, (_, index) => ({ ...finalist, name: `overflow-${index}` }));
	writeExtensionScoutLedger(cwd, { version: 1, cursor, packages: Object.fromEntries(overflowFinalists.map((item) => [item.name, { ...item, inspection: { ok: true, revision: sourceRevision, facts } }])), queue: [], currentRun: [], finalists: overflowFinalists });
	const reviewOptions = { review: async () => ({ ...review, actionable: false, recommendation: "reject", reason: "out-of-scope" }), decide: async () => null };
	const firstFinalistBatch = await reviewInspectedExtensions(cwd, reviewOptions);
	const secondFinalistBatch = await reviewInspectedExtensions(cwd, reviewOptions);
	assert(firstFinalistBatch.reviewed.length === 10 && secondFinalistBatch.reviewed.length === 1 && secondFinalistBatch.ledger.finalists.length === 0, "durable finalist overflow continues on a later invocation");

	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = path.join(cwd, "agent");
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(path.join(agentDir, "settings.json"), "{}\n");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	const { executeOrchestratorAction } = await import(`../extensions/work-models.js?scout=${Date.now()}`);
	const unavailable = await executeOrchestratorAction("work-extension-scout", "", { cwd, ui: { notify() {} } }, {});
	assert(unavailable === false, "command is unavailable unless self-improving is enabled");

	writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ workResume: { selfImproving: true } }));
	const previousFetch = globalThis.fetch;
	let scoutMenuLabel = "";
	const notifications = [];
	globalThis.fetch = async () => ({ ok: false, status: 503 });
	try {
		await executeOrchestratorAction("work-menu", "", {
			cwd,
			ui: {
				notify(message) { notifications.push(message); },
				select(_title, labels) {
					scoutMenuLabel = labels.find((label) => label.includes("Scout Pi extensions")) ?? "";
					return scoutMenuLabel;
				},
			},
		}, {});
	} finally {
		globalThis.fetch = previousFetch;
	}
	assert(Boolean(scoutMenuLabel) && notifications.some((message) => message.includes("pi.dev returned HTTP 503")), "enabled F7 scout action is exposed and dispatches through the scout flow");
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
} finally {
	rmSync(cwd, { recursive: true, force: true });
}

console.log("work extension scout fixtures passed");
