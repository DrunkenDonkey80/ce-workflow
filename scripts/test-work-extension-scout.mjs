import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	EXTENSION_SCOUT_LEDGER,
	parseRecentExtensions,
	readExtensionScoutLedger,
	runExtensionScout,
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

	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = path.join(cwd, "agent");
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(path.join(agentDir, "settings.json"), "{}\n");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	const { executeOrchestratorAction } = await import(`../extensions/work-models.js?scout=${Date.now()}`);
	const unavailable = await executeOrchestratorAction("work-extension-scout", "", { cwd, ui: { notify() {} } }, {});
	assert(unavailable === false, "command is unavailable unless self-improving is enabled");
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
} finally {
	rmSync(cwd, { recursive: true, force: true });
}

console.log("work extension scout fixtures passed");
