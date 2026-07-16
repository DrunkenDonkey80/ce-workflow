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
const { assert, installWorkflowFixture, seedNativeStore } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "./work-command-fixture.mjs")),
	).href
);

const cwd = mkdtempSync(path.join(tmpdir(), "work-usage-"));
const now = Date.now();
seedNativeStore(cwd, [
	{ id: "E-1", issue_type: "epic", status: "in_progress", title: "Active epic" },
]);
try {
	recordWorkTelemetry(cwd, {
		id: "agent-html",
		timestamp: now,
		type: "agent",
		mode: "resume",
		action: "<review>&fix",
		epicId: "E-1",
		workItemId: "TASK-1",
		durationMs: 90_000,
		usage: { totalTokens: 1234, input: 1000, output: 234, cost: 0.01 },
		context: { after: { tokens: 9000 } },
		tools: [
			{
				name: "subagent",
				subagents: ["work", "reviewer"],
				subagentDetails: [
					{
						agent: "reviewer",
						status: "completed",
						durationMs: 61_000,
						tokens: 42_000,
						input: 40_000,
						output: 2_000,
						cost: 0.42,
						toolCount: 9,
						turns: 3,
						model: "example/reviewer",
					},
				],
			},
			{ name: "read" },
			{ name: "read" },
			{ name: "bash" },
		],
		review: {
			scope: "workItem TASK-1",
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
		workItemId: "TASK-2",
		durationMs: 500,
	});
	recordWorkTelemetry(cwd, {
		id: "other-epic",
		timestamp: now + 2,
		type: "agent",
		mode: "big",
		action: "plan",
		epicId: "E-2",
		workItemId: "PLAN-1",
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
	assert(
		explicit.rows.length === 1,
		"usage report excludes self-report and empty no-usage events",
	);
	assert(
		explicit.summary.unknownTokens === 0,
		"empty rows do not inflate unknown token counts",
	);
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
	assert(
		html.includes('id="modal"'),
		"usage report includes popup detail frame",
	);
	assert(
		html.includes("detail-box"),
		"usage report includes row detail content",
	);
	assert(
		html.includes("New subagent runs also record child tokens"),
		"usage report explains new subagent detail capture",
	);
	assert(html.includes("workItem TASK-1"), "usage report shows review scope");
	assert(html.includes("1m 30s"), "usage report formats readable durations");
	assert(html.includes("read(2), bash(1)"), "usage report groups tool calls");
	assert(
		html.includes("reviewer(1), work(1)"),
		"usage report groups subagent types",
	);
	assert(
		html.includes("Subagent usage"),
		"usage report summarizes subagent usage",
	);
	assert(html.includes("42000"), "usage report summarizes subagent tokens");
	assert(
		html.includes("example/reviewer"),
		"usage report shows per-subagent model/tokens details",
	);
	assert(
		html.includes("kind-agent"),
		"usage report colors rows by operation type",
	);
	assert(
		html.includes("dataset.dir==='asc'?'desc':'asc'"),
		"usage report toggles reverse sort on repeated column clicks",
	);
	assert(
		html.includes("PASS / 0 findings / fixer no"),
		"usage report shows review payoff evidence",
	);
	assert(
		renderWorkUsageText(explicit).includes(explicit.path),
		"text prints report path",
	);

	const openFlag = buildWorkUsageState(cwd, "epic E-1 --open");
	assert(openFlag.open === true, "usage --open records browser intent");
	assert(
		openFlag.filter.scope === "epic" && openFlag.filter.value === "E-1",
		"usage --open is stripped before telemetry scope parsing",
	);

	const jsonl = buildWorkUsageState(cwd, "epic E-1 --jsonl --open");
	assert(
		jsonl.format === "jsonl" && !jsonl.path,
		"jsonl usage skips html file",
	);
	assert(jsonl.open === false, "jsonl usage ignores browser open");
	const jsonlRows = renderWorkUsageText(jsonl).split(/\r?\n/).map(JSON.parse);
	assert(
		jsonlRows[0].type === "summary" && jsonlRows[1].type === "row",
		"jsonl usage renders machine-readable rows",
	);

	const all = buildWorkUsageState(cwd, "all");
	assert(all.rows.length === 2, "all scope excludes empty and self events");
	const workItem = buildWorkUsageState(cwd, "workItem TASK-1");
	assert(
		workItem.rows.length === 1 && workItem.rows[0].task === "TASK-1",
		"workItem scope isolates one task",
	);

	const fixture = installWorkflowFixture({ native: true });
	try {
		fixture.reset("active");
		seedNativeStore(cwd, [
			{ id: "E-1", issue_type: "epic", status: "in_progress", title: "Active epic" },
		]);
		const byDefault = buildWorkUsageState(cwd, "");
		assert(
			byDefault.ok &&
				byDefault.filter.scope === "epic" &&
				byDefault.filter.value === "E-1",
			"blank usage defaults to one active epic",
		);
		fixture.reset("ambiguous");
		seedNativeStore(cwd, [
			{ id: "E-1", issue_type: "epic", status: "in_progress", title: "Active epic" },
			{ id: "E-2", issue_type: "epic", status: "in_progress", title: "Second epic" },
		]);
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
		assert(
			messages.some((message) => message.includes("Browser not opened")),
			"registered command does not open browser unless requested",
		);
	} finally {
		fixture.cleanup();
	}
} finally {
	rmSync(cwd, { recursive: true, force: true });
}

console.log("ok - work-usage behavior");
