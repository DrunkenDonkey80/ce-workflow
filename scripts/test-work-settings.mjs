#!/usr/bin/env node
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
	mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const mod = await import(
	pathToFileURL(path.join(import.meta.dirname, "../extensions/work-models.js"))
		.href
);

function assert(ok, message) {
	if (!ok) throw new Error(message);
}

const cwd = mkdtempSync(path.join(tmpdir(), "work-settings-"));
try {
	mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	const settingsFile = () => path.join(cwd, ".pi", "settings.json");
	const writeSettings = (settings) =>
		writeFileSync(settingsFile(), `${JSON.stringify(settings, null, "\t")}\n`);
	const readSettings = () => JSON.parse(readFileSync(settingsFile(), "utf8"));

	// Autonomous improvement remains opt-in and has no implicit source setting.
	assert(
		mod.workResumeSettingsForTest?.(cwd)?.selfImproving !== true,
		"self improvement defaults off",
	);
	assert(!existsSync(settingsFile()), "no default source mutation");

	// Default (no settings) resolves to medium profile.
	assert(
		mod.workOrchSettings(cwd).profile === "medium",
		"default profile medium",
	);
	assert(
		mod.workOrchSettings(cwd).advisorEnabled.advisor === true &&
			mod.workOrchSettings(cwd).advisorEnabled.advisor2 === false &&
			mod.workOrchSettings(cwd).advisorEnabled.advisor3 === false,
		"medium defaults to one inherited advisor",
	);
	assert(
		mod.workOrchSettings(cwd).advisorUsageForSlicePlans === "first",
		"medium uses first advisor on slice plans",
	);
	assert(
		mod.workOrchSettings(cwd).advisorVerifyTask === true,
		"medium advisor verify",
	);
	assert(
		mod.workOrchSettings(cwd).slicePlanBeforeWork === true,
		"medium slice planning",
	);
	assert(
		mod.workOrchSettings(cwd).slicePlanWithCePlan === false,
		"medium inline slice planning",
	);
	assert(
		mod.workOrchSettings(cwd).slicePlanCeDepth === "Lightweight",
		"medium lightweight slice depth",
	);
	assert(
		mod.workOrchSettings(cwd).codeReviewBeforeCommit === "light",
		"medium light review",
	);
	assert(
		mod.workOrchSettings(cwd).sliceExecutionMode === "inline",
		"medium inline slice execution",
	);
	assert(
		mod.workOrchSettings(cwd).simplifyBeforeReview === false,
		"medium no simplify",
	);
	assert(
		mod.workOrchSettings(cwd).browserTestsOnUiDiff === true,
		"medium browser tests on ui diff",
	);

	// Apply max profile: effort + gates copied onto current, models preserved.
	let settings = {};
	mod.applyProfile(settings, "max");
	writeSettings(settings);
	const max = mod.workOrchSettings(cwd);
	assert(max.profile === "max", "profile max");
	assert(
		max.advisorUsageForSlicePlans === "all",
		"max uses all configured advisors on slice plans",
	);
	assert(max.advisorVerifyTask === true, "max advisor verify");
	assert(max.codeReviewBeforeCommit === "full", "max full review");
	assert(max.slicePlanWithCePlan === true, "max agent slice planner available");
	assert(max.slicePlanCeDepth === "Deep", "max ce-plan deep");
	assert(max.simplifyBeforeReview === true, "max simplify");
	assert(max.browserTestsOnUiDiff === true, "max browser tests");
	for (const agent of ["work-advisor", "work-advisor-2", "work-advisor-3"])
		assert(
			readSettings().subagents.agentOverrides[agent].thinking === "high",
			`${agent} effort high`,
		);
	assert(
		readSettings().subagents.agentOverrides["work-worker"].thinking === "xhigh",
		"worker effort xhigh",
	);

	// Flip a boolean live; profile label is preserved.
	settings = readSettings();
	mod.setWorkOrchBoolean(settings, "advisorVerifyTask", false);
	mod.setWorkOrchBoolean(settings, "slicePlanBeforeWork", false);
	mod.setWorkOrchBoolean(settings, "slicePlanWithCePlan", false);
	mod.setWorkOrchReviewLevel(settings, "off");
	mod.setWorkOrchSliceExecution(settings, "agent");
	writeSettings(settings);
	assert(
		mod.workOrchSettings(cwd).advisorVerifyTask === false,
		"flipped verify off",
	);
	assert(
		mod.workOrchSettings(cwd).slicePlanBeforeWork === false,
		"flipped slice planning off",
	);
	assert(
		mod.workOrchSettings(cwd).slicePlanWithCePlan === false,
		"flipped ce-plan per slice off",
	);
	assert(
		mod.workOrchSettings(cwd).codeReviewBeforeCommit === "off",
		"flipped review off",
	);
	assert(
		mod.workOrchSettings(cwd).sliceExecutionMode === "agent",
		"flipped slice execution to agent",
	);
	assert(
		mod.workOrchSettings(cwd).profile === "max",
		"profile retained after flip",
	);
	assert(
		readSettings().workOrchestrator.profile === "max",
		"explicit profile stored",
	);

	mod.applyProfile((settings = readSettings()), "high");
	writeSettings(settings);
	assert(
		mod.workOrchSettings(cwd).slicePlanWithCePlan === true,
		"high enables agent slice planner",
	);
	assert(
		mod.workOrchSettings(cwd).slicePlanCeDepth === "Standard",
		"high slice-plan standard when agent planner is enabled",
	);

	// Apply low profile: critic and verify off.
	mod.applyProfile((settings = readSettings()), "low");
	writeSettings(settings);
	const low = mod.workOrchSettings(cwd);
	assert(
		low.advisorUsageForSlicePlans === "none",
		"low skips advisors on slice plans",
	);
	assert(low.advisorVerifyTask === false, "low no advisor verify");
	assert(low.slicePlanBeforeWork === true, "low lightweight slice planning");
	assert(low.slicePlanWithCePlan === false, "low no ce-plan per slice");
	assert(low.slicePlanCeDepth === "Lightweight", "low ce-plan depth unused");
	assert(low.codeReviewBeforeCommit === "off", "low no review");
	assert(low.simplifyBeforeReview === false, "low no simplify");
	assert(low.browserTestsOnUiDiff === false, "low no browser tests");

	// Override slice-plan advisor usage explicitly.
	mod.setWorkOrchAdvisorSliceUsage((settings = readSettings()), "all");
	writeSettings(settings);
	assert(
		mod.workOrchSettings(cwd).advisorUsageForSlicePlans === "all",
		"explicit slice-plan advisor usage",
	);

	const commands = {};
	mod.default({
		on: () => {},
		registerCommand: (name, config) => {
			commands[name] = config;
		},
	});
	assert(!commands["work-models"], "redundant work-models command removed");

	const notices = [];
	const customUi = (actions, options = {}) => ({
		notify: (message, level) => notices.push({ message, level }),
		input: options.input ?? (async () => undefined),
		select: options.select ?? (async () => undefined),
		custom: async (factory) => {
			let result;
			let closed = false;
			const component = factory(
				{ requestRender() {} },
				{
					fg: (color, text) => `[${color}]${text}[/${color}]`,
					bold: (text) => text,
				},
				{
					matches: (data, id) =>
						(id === "tui.select.up" && data === "up") ||
						(id === "tui.select.down" && data === "down") ||
						(id === "tui.select.confirm" && data === "enter") ||
						(id === "tui.select.cancel" && data === "escape"),
				},
				(value) => {
					result = value;
					closed = true;
				},
			);
			const action = actions.shift();
			assert(action, "unexpected settings render");
			let lines = component.render(140);
			if (action.expectInitial)
				assert(
					lines.some(
						(line) =>
							line.includes("> ") && line.includes(action.expectInitial),
					),
					`cursor did not stay on ${action.expectInitial}`,
				);
			if (action.expectText)
				assert(
					lines.some((line) => line.includes(action.expectText)),
					`missing ${action.expectText}`,
				);
			for (const character of action.typeText ?? "")
				component.handleInput(character);
			if (action.target) {
				for (let guard = 0; guard < 100; guard += 1) {
					lines = component.render(140);
					if (
						lines.some(
							(line) => line.includes("> ") && line.includes(action.target),
						)
					)
						break;
					component.handleInput("down");
				}
				lines = component.render(140);
				assert(
					lines.some(
						(line) => line.includes("> ") && line.includes(action.target),
					),
					`missing settings choice ${action.target}`,
				);
			}
			action.capture?.(lines);
			component.handleInput(action.key);
			assert(closed, `settings action ${action.key} did not close selector`);
			return result;
		},
	});
	const ctx = {
		cwd,
		model: { provider: "p", id: "m" },
		modelRegistry: { getAvailable: async () => [] },
		ui: customUi([{ key: "escape" }]),
	};
	await commands["work-settings"].handler("", ctx);
	assert(notices.length === 0, "escape exits without notify");
	await commands["work-settings"].handler("", {
		...ctx,
		mode: "rpc",
		ui: {
			notify: ctx.ui.notify,
			select: async (_title, labels) =>
				labels.find((label) => label.startsWith("done")),
		},
	});
	assert(notices.length === 0, "non-TUI settings fallback exits cleanly");

	// status reports the advisor slot and gates.
	await commands["work-settings"].handler("status", ctx);
	assert(
		notices.at(-1).message.includes("Work settings\n\nProfile"),
		"status is grouped and readable",
	);
	for (const phrase of [
		"› advisor: model:inherit current",
		"› advisor 2: model:none",
		"› advisor 3: model:none",
		"advisor usage for slice plans: all",
		"planner writes slice plan before work",
		"agent slice planner for messy/large slices",
		"ce-plan slice depth: Lightweight",
		"pre-commit review:",
		"ce-simplify-code before review",
		"ce-test-browser when diff touches UI",
		"self-improving workflow fixes",
		"new session between iterations",
	])
		assert(notices.at(-1).message.includes(phrase), `status lists ${phrase}`);
	assert(existsSync(settingsFile()), "settings file exists");

	// Enter and Space both flip booleans, retain the cursor, and color state.
	mod.applyProfile((settings = readSettings()), "medium");
	writeSettings(settings);
	let enabledRender = "";
	let disabledRender = "";
	await commands["work-settings"].handler("", {
		...ctx,
		ui: customUi([
			{
				target: "ce-test-browser when diff touches UI",
				key: " ",
				capture: (lines) => {
					enabledRender = lines.join("\n");
				},
			},
			{
				expectInitial: "ce-test-browser when diff touches UI",
				target: "coded task-vs-plan checklist",
				key: "enter",
				capture: (lines) => {
					disabledRender = lines.join("\n");
				},
			},
			{ expectInitial: "coded task-vs-plan checklist", key: "escape" },
		]),
	});
	assert(
		mod.workOrchSettings(cwd).browserTestsOnUiDiff === false &&
			mod.workOrchSettings(cwd).advisorVerifyTask === false,
		"Space and Enter flip booleans",
	);
	assert(enabledRender.includes("[success]"), "enabled options render green");
	assert(disabledRender.includes("[dim]"), "disabled options render dim");

	// Model picker starts on the current model and filters its visible list live.
	settings = readSettings();
	settings.subagents ??= {};
	settings.subagents.agentOverrides ??= {};
	settings.subagents.agentOverrides["work-reviewer"] = {
		model: "test/gpt-5.6-high",
		thinking: "xhigh",
	};
	writeSettings(settings);
	let filteredModels = "";
	await commands["work-settings"].handler("", {
		...ctx,
		modelRegistry: {
			getAvailable: async () => [
				{ provider: "test", id: "other", name: "Other Model" },
				{ provider: "test", id: "gpt-5.6-high", name: "GPT 5.6 High" },
				{ provider: "test", id: "gpt-5.6-mini", name: "GPT 5.6 Mini" },
				{ provider: "test", id: "gpt-5.6-codex", name: "GPT 5.6 Codex" },
			],
		},
		ui: customUi(
			[
				{ target: "review ›", key: "enter" },
				{
					expectInitial: "test/gpt-5.6-high",
					expectText: "Current: test/gpt-5.6-high",
					typeText: "5.6",
					target: "test/gpt-5.6-mini",
					key: "enter",
					capture: (lines) => {
						filteredModels = lines.join("\n");
					},
				},
				{ expectInitial: "review ›", key: "escape" },
			],
			{
				select: async (_title, labels) =>
					labels.find((label) => label.startsWith("high")),
			},
		),
	});
	settings = readSettings();
	assert(
		["gpt-5.6-high", "gpt-5.6-mini", "gpt-5.6-codex"].every((id) =>
			filteredModels.includes(id),
		),
		"typing filters and keeps all matching models visible",
	);
	assert(!filteredModels.includes("test/other"), "filter hides non-matches");
	assert(
		settings.subagents.agentOverrides["work-reviewer"].model ===
			"test/gpt-5.6-mini",
		"filtered model picker selects highlighted model",
	);
	assert(
		settings.subagents.agentOverrides["work-reviewer"].thinking === "high",
		"typed model flow still selects effort",
	);

	// Every advisor model picker supports none and inherit; none skips effort.
	await commands["work-settings"].handler("", {
		...ctx,
		ui: customUi(
			[
				{ target: "advisor 2 ›", key: "enter" },
				{
					expectInitial: "none",
					expectText: "Current: none",
					target: "inherit current control-session model",
					key: "enter",
				},
				{ expectInitial: "advisor 2 ›", key: "escape" },
			],
			{
				select: async (_title, labels) =>
					labels.find((label) => label.startsWith("high")),
			},
		),
	});
	settings = readSettings();
	assert(
		mod.workOrchSettings(cwd).advisorEnabled.advisor2 === true &&
			!settings.subagents.agentOverrides["work-advisor-2"].model &&
			settings.subagents.agentOverrides["work-advisor-2"].thinking === "high",
		"advisor 2 can inherit the current model at high effort",
	);
	await commands["work-settings"].handler("", {
		...ctx,
		ui: customUi([
			{ target: "advisor 2 ›", key: "enter" },
			{
				expectInitial: "inherit current control-session model",
				target: "none",
				key: "enter",
			},
			{ expectInitial: "advisor 2 ›", key: "escape" },
		]),
	});
	assert(
		mod.workOrchSettings(cwd).advisorEnabled.advisor2 === false,
		"advisor none disables its run slot",
	);

	settings = readSettings();
	settings.workOrchestrator.advisorEnabled = {
		advisor: true,
		advisor2: true,
		advisor3: true,
	};
	writeSettings(settings);
	const allAdvisors = mod.advisorCriticStep(cwd, "master plan", "all");
	for (const agent of ["work-advisor", "work-advisor-2", "work-advisor-3"])
		assert(allAdvisors.includes(agent), `parallel gate includes ${agent}`);
	assert(
		allAdvisors.includes("exactly one parallel subagent call") &&
			allAdvisors.includes("never invoke ce-doc-review") &&
			allAdvisors.includes("one focused re-review by work-advisor") &&
			allAdvisors.includes("Never start a recursive review loop"),
		"parallel synthesis and bounded first-advisor re-review are explicit",
	);
	const firstAdvisor = mod.advisorCriticStep(cwd, "slice plan", "first");
	assert(
		firstAdvisor.includes("work-advisor") &&
			!firstAdvisor.includes("work-advisor-2"),
		"first runs only the first configured advisor",
	);
	assert(
		mod.advisorCriticStep(cwd, "slice plan", "none") === "",
		"none skips slice-plan advisors",
	);
	settings.workOrchestrator.advisorEnabled = {
		advisor: false,
		advisor2: false,
		advisor3: false,
	};
	writeSettings(settings);
	assert(
		mod.advisorCriticStep(cwd, "master plan") === "",
		"all advisor slots set to none skip artifact review",
	);
} finally {
	rmSync(cwd, { recursive: true, force: true });
}

process.stdout.write("ok - work-settings behavior\n");
