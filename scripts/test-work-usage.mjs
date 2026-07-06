#!/usr/bin/env node
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const {
	buildWorkUsageState,
	default: workModelsExtension,
	recordWorkTelemetry,
	renderWorkUsageText,
} = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);
const { assert, installWorkflowFixture } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "./work-command-fixture.mjs")),
	).href
);

const cwd = mkdtempSync(path.join(tmpdir(), "work-usage-"));
const now = Date.now();
try {
	recordWorkTelemetry(cwd, {
		id: "agent-html",
		timestamp: now,
		type: "agent",
		mode: "resume",
		action: "<review>&fix",
		epicId: "E-1",
		beadId: "TASK-1",
		durationMs: 90_000,
		usage: { totalTokens: 1234, input: 1000, output: 234, cost: 0.01 },
		context: { after: { tokens: 9000 } },
		tools: [{ name: "subagent" }],
		review: {
			scope: "bead TASK-1",
			outcome: "PASS",
			findings: 0,
			fixer: false,
		},
	});
	recordWorkTelemetry(cwd, {
		id: "missing",
		timestamp: now + 1,
		type: "command",
		command: "work-small",
		action: "run",
		epicId: "E-1",
		beadId: "TASK-2",
		durationMs: 500,
	});
	recordWorkTelemetry(cwd, {
		id: "other-epic",
		timestamp: now + 2,
		type: "agent",
		mode: "big",
		action: "plan",
		epicId: "E-2",
		beadId: "PLAN-1",
		durationMs: 700,
		usage: { totalTokens: 77 },
	});
	recordWorkTelemetry(cwd, {
		id: "self",
		timestamp: now + 3,
		type: "command",
		command: "work-usage",
		action: "usage-report",
		epicId: "E-1",
		durationMs: 1,
	});

	const explicit = buildWorkUsageState(cwd, "epic E-1");
	assert(explicit.ok, "explicit epic usage succeeds");
	assert(existsSync(explicit.path), "usage report file is written");
	assert(explicit.rows.length === 2, "usage report excludes self-report event");
	assert(explicit.summary.unknownTokens === 1, "missing token data is tracked");
	const html = readFileSync(explicit.path, "utf8");
	assert(
		html.includes("&lt;review&gt;&amp;fix"),
		"usage report escapes telemetry text",
	);
	assert(
		html.includes("unknown"),
		"usage report renders unknown for missing data",
	);
	assert(html.includes("filter rows"), "usage report includes filter UI");
	assert(html.includes("bead TASK-1"), "usage report shows review scope");
	assert(
		html.includes("PASS / 0 findings / fixer no"),
		"usage report shows review payoff evidence",
	);
	assert(
		renderWorkUsageText(explicit).includes(explicit.path),
		"text prints report path",
	);

	const all = buildWorkUsageState(cwd, "all");
	assert(all.rows.length === 3, "all scope includes all non-self events");
	const bead = buildWorkUsageState(cwd, "bead TASK-1");
	assert(
		bead.rows.length === 1 && bead.rows[0].task === "TASK-1",
		"bead scope isolates one task",
	);

	const fixture = installWorkflowFixture();
	try {
		fixture.reset("active");
		const byDefault = buildWorkUsageState(cwd, "");
		assert(
			byDefault.ok &&
				byDefault.filter.scope === "epic" &&
				byDefault.filter.value === "E-1",
			"blank usage defaults to one active epic",
		);
		fixture.reset("ambiguous");
		const ambiguous = buildWorkUsageState(cwd, "");
		assert(
			!ambiguous.ok && ambiguous.candidates.length === 2,
			"blank usage stops on ambiguous active epics",
		);

		const commands = {};
		workModelsExtension({
			on: () => {},
			registerCommand: (name, config) => {
				commands[name] = config;
			},
		});
		const messages = [];
		await commands["work-usage"].handler("epic E-1", {
			cwd,
			getContextUsage: () => ({ tokens: 3333 }),
			ui: { notify: (message) => messages.push(message) },
		});
		assert(
			messages.some((message) => message.includes("Work usage report:")),
			"registered command notifies report path",
		);
	} finally {
		fixture.cleanup();
	}
} finally {
	rmSync(cwd, { recursive: true, force: true });
}

console.log("ok - work-usage behavior");
