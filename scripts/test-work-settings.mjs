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

const previousConfigDir = process.env.PI_CODING_AGENT_DIR;
const globalDir = mkdtempSync(path.join(tmpdir(), "work-global-settings-"));
process.env.PI_CODING_AGENT_DIR = globalDir;
const cwd = mkdtempSync(path.join(tmpdir(), "work-settings-"));
try {
	mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	const settingsFile = () => path.join(cwd, ".pi", "settings.json");
	const globalSettingsFile = () => path.join(globalDir, "settings.json");
	const writeSettings = (settings) =>
		writeFileSync(settingsFile(), `${JSON.stringify(settings, null, "\t")}\n`);
	const writeGlobalSettings = (settings) =>
		writeFileSync(
			globalSettingsFile(),
			`${JSON.stringify(settings, null, "\t")}\n`,
		);
	const readSettings = () => JSON.parse(readFileSync(settingsFile(), "utf8"));
	const readGlobalSettings = () =>
		JSON.parse(readFileSync(globalSettingsFile(), "utf8"));

	// Package default stays off; a hidden user default enables every project,
	// while an explicit project false remains an escape hatch.
	assert(
		mod.workResumeSettingsForTest(cwd).selfImproving === false,
		"self improvement defaults off",
	);
	assert(!existsSync(settingsFile()), "no default source mutation");
	writeFileSync(
		path.join(globalDir, "settings.json"),
		JSON.stringify({
			workResume: { selfImprovingDefault: true },
			workOrchestrator: {
				profile: "high",
				advisorEnabled: {
					advisor: true,
					advisor2: true,
					advisor3: true,
				},
			},
			subagents: {
				agentOverrides: {
					"work-advisor-2": {
						model: "global-model",
						thinking: "high",
					},
				},
			},
		}),
	);
	assert(
		mod.workResumeSettingsForTest(cwd).selfImproving === true,
		"global hidden default enables self improvement",
	);
	writeSettings({
		workResume: { selfImproving: false },
		workOrchestrator: { advisorEnabled: { advisor2: false } },
		subagents: {
			agentOverrides: {
				"work-advisor-2": { thinking: "medium" },
			},
		},
	});
	assert(
		mod.workResumeSettingsForTest(cwd).selfImproving === false,
		"project setting can opt out of the global default",
	);
	const effective = mod.effectiveSettingsForTest(cwd);
	assert(
		mod.workOrchSettings(cwd).profile === "high" &&
			mod.workOrchSettings(cwd).advisorEnabled.advisor2 === false &&
			mod.workOrchSettings(cwd).advisorEnabled.advisor3 === true,
		"global workflow defaults merge with project overrides",
	);
	assert(
		effective.subagents.agentOverrides["work-advisor-2"].model ===
			"global-model" &&
			effective.subagents.agentOverrides["work-advisor-2"].thinking ===
				"medium",
		"nested project model settings override only selected global fields",
	);
	writeSettings({});
	writeFileSync(path.join(globalDir, "settings.json"), "{}\n");
	assert(
		mod.workOrchSettings(cwd).creativeMode === "ask",
		"creative sidecar defaults to one Quick/Wide question",
	);
	const creativeSettings = {};
	mod.setWorkOrchCreativeMode(creativeSettings, "auto");
	writeSettings(creativeSettings);
	assert(
		mod.workOrchSettings(cwd).creativeMode === "auto",
		"creative sidecar mode persists",
	);
	writeSettings({});

	// Verifier profiles merge by canonical model ID; project null tombstones win.
	writeGlobalSettings({
		workOrchestrator: {
			backgroundVerifiers: {
				"test/model-a": {
					operations: ["correctness", "test-gap"],
					thinking: "high",
				},
				"test/model-disabled": {
					operations: ["security"],
					thinking: "max",
				},
			},
		},
	});
	writeSettings({
		workOrchestrator: {
			backgroundVerifiers: {
				"test/model-a": { operations: ["security"], thinking: "low" },
				"test/model-b": {
					operations: ["performance"],
					thinking: "medium",
				},
				"test/model-disabled": null,
			},
		},
	});
	assert(
		JSON.stringify(mod.backgroundVerifierProfiles(cwd)) ===
			JSON.stringify([
				{ model: "test/model-a", operations: ["security"], thinking: "low" },
				{
					model: "test/model-b",
					operations: ["performance"],
					thinking: "medium",
				},
			]),
		"project verifier entries override by model and tombstones disable inherited profiles",
	);
	writeSettings({});
	writeGlobalSettings({});

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
	writeSettings({ workOrchestrator: { sliceExecutionMode: "inline" } });
	assert(
		!("sliceExecutionMode" in mod.workOrchSettings(cwd)),
		"legacy inline setting is ignored",
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
		readSettings().subagents.agentOverrides["work-worker"].thinking === "max",
		"worker effort max",
	);

	// Flip a boolean live; profile label is preserved.
	settings = readSettings();
	mod.setWorkOrchBoolean(settings, "advisorVerifyTask", false);
	mod.setWorkOrchBoolean(settings, "slicePlanBeforeWork", false);
	mod.setWorkOrchBoolean(settings, "slicePlanWithCePlan", false);
	mod.setWorkOrchReviewLevel(settings, "off");
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
	const invoke = (name, args, ctx) =>
		mod.executeOrchestratorAction(name, args, ctx, {});
	assert(!commands["work-models"], "redundant work-models command removed");

	const notices = [];
	const customUi = (actions, options = {}) => ({
		notify: (message, level) => notices.push({ message, level }),
		input: options.input ?? (async () => undefined),
		select: options.select ?? (async () => undefined),
		confirm: options.confirm ?? (async () => true),
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
						(id === "tui.select.cancel" && data === "escape") ||
						(id === "tui.editor.deleteCharBackward" && data === "backspace") ||
						(id === "tui.editor.deleteCharForward" && data === "delete"),
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
							line.includes("[accent]") && line.includes(action.expectInitial),
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
							(line) =>
								line.includes("[accent]") && line.includes(action.target),
						)
					)
						break;
					component.handleInput("down");
				}
				lines = component.render(140);
				assert(
					lines.some(
						(line) => line.includes("[accent]") && line.includes(action.target),
					),
					`missing settings choice ${action.target}\n${lines.join("\n")}`,
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
		ui: customUi([{ expectText: "Settings: Global", key: "escape" }]),
	};
	await invoke("work-settings", "", ctx);
	assert(notices.length === 0, "escape exits without notify");
	await invoke("work-settings", "", {
		...ctx,
		mode: "rpc",
		ui: {
			notify: ctx.ui.notify,
			select: async () => undefined,
		},
	});
	assert(notices.length === 0, "non-TUI settings fallback exits cleanly");

	// status reports the advisor slot and gates.
	await invoke("work-settings", "status", ctx);
	assert(
		notices.at(-1).message.includes("Work settings\n\nProfile"),
		"status is grouped and readable",
	);
	for (const phrase of [
		"› Advisor 1: model:inherit current",
		"› Advisor 2: model:none",
		"› Advisor 3: model:none",
		"creative sidecar: ask",
		"advisor usage for slice plans: all",
		"Planner writes slice plan before work",
		"Agent slice planner for messy/large slices",
		"ce-plan slice depth: Lightweight",
		"pre-commit review:",
		"implementation: configured Work model (isolated work-worker)",
		"CE-simplify-code before review",
		"CE-test-browser when diff touches UI",
		"self-improving workflow reporting",
		"new session between iterations",
	])
		assert(notices.at(-1).message.includes(phrase), `status lists ${phrase}`);
	assert(
		!notices.at(-1).message.includes("slice execution"),
		"status removes the retired inline/agent option",
	);
	assert(existsSync(settingsFile()), "settings file exists");

	let profileMenuVisits = 0;
	let profileChoices = [];
	await invoke("work-settings", "", {
		...ctx,
		mode: "rpc",
		ui: {
			notify: ctx.ui.notify,
			select: async (title, labels) => {
				if (title === "Settings: Global" && profileMenuVisits++ === 0)
					return labels.find((label) => label.startsWith("Profile:"));
				if (title === "Choose effort profile") profileChoices = labels;
				return undefined;
			},
		},
	});
	assert(
		profileChoices.every(
			(label) =>
				label.includes("Pros:") &&
				label.includes("Cons:") &&
				label.includes("Token/time consumption:") &&
				label.includes("Active settings:") &&
				label.includes("Work:") &&
				label.includes("Pre-commit review:"),
		),
		"profiles show their full settings instead of a truncated summary",
	);
	let creativeMenuVisits = 0;
	await invoke("work-settings", "", {
		...ctx,
		mode: "rpc",
		ui: {
			notify: ctx.ui.notify,
			select: async (title, labels) => {
				if (title === "Settings: Global" && creativeMenuVisits++ === 0)
					return labels.find((label) => label.startsWith("Creative sidecar:"));
				if (title === "Creative sidecar mode")
					return labels.find((label) => label.startsWith("Auto"));
				return undefined;
			},
		},
	});
	assert(
		readGlobalSettings().workOrchestrator.creativeMode === "auto",
		"settings UI persists automatic creative sidecars",
	);

	// Global opens first; project overrides are marked and removable in-place.
	writeGlobalSettings({ workOrchestrator: { advisorVerifyTask: true } });
	writeSettings({ workOrchestrator: { advisorVerifyTask: false } });
	let globalScopeRender = "";
	let projectScopeRender = "";
	let inheritedScopeRender = "";
	await invoke("work-settings", "", {
		...ctx,
		ui: customUi([
			{
				target: "Coded task-vs-plan checklist",
				expectText: "Settings: Global",
				key: "\t",
				capture: (lines) => {
					globalScopeRender = lines.join("\n");
				},
			},
			{
				expectInitial: "Coded task-vs-plan checklist",
				expectText: "Settings: Project",
				key: "delete",
				capture: (lines) => {
					projectScopeRender = lines.join("\n");
				},
			},
			{
				expectInitial: "Coded task-vs-plan checklist",
				key: "escape",
				capture: (lines) => {
					inheritedScopeRender = lines.join("\n");
				},
			},
		]),
	});
	assert(
		globalScopeRender.includes("*✓ on Coded task-vs-plan checklist") &&
			projectScopeRender.includes("*○ off Coded task-vs-plan checklist"),
		"local override marker is visible in both scopes",
	);
	assert(
		!inheritedScopeRender.includes("*✓ on Coded task-vs-plan checklist") &&
			mod.workOrchSettings(cwd).advisorVerifyTask === true &&
			!Object.hasOwn(
				readSettings().workOrchestrator ?? {},
				"advisorVerifyTask",
			),
		"Backspace clears only the selected project override",
	);
	assert(
		readGlobalSettings().workOrchestrator.advisorVerifyTask === true,
		"clearing a project override preserves the global value",
	);

	// Reopening an enum picker starts on the persisted value in either scope.
	writeGlobalSettings({
		workOrchestrator: { advisorUsageForSlicePlans: "all" },
	});
	writeSettings({
		workOrchestrator: { advisorUsageForSlicePlans: "first" },
	});
	let globalUsageChoices;
	await invoke("work-settings", "", {
		...ctx,
		ui: customUi(
			[
				{ target: "Advisor usage for slice plans ›", key: "enter" },
				{
					expectInitial: "Advisor usage for slice plans ›",
					key: "escape",
				},
			],
			{
				select: async (title, labels) => {
					if (title === "Advisor usage for slice plans") {
						globalUsageChoices = labels;
						return labels.find((label) => label.startsWith("None"));
					}
					return undefined;
				},
			},
		),
	});
	assert(
		globalUsageChoices?.[0]?.startsWith("●All"),
		`global enum picker opens on its persisted value: ${JSON.stringify(globalUsageChoices)}`,
	);
	assert(
		readGlobalSettings().workOrchestrator.advisorUsageForSlicePlans === "none",
		"global enum selection persists",
	);
	let projectUsageChoices;
	await invoke("work-settings", "", {
		...ctx,
		ui: customUi(
			[
				{ key: "\t" },
				{ target: "Advisor usage for slice plans ›", key: "enter" },
				{
					expectInitial: "Advisor usage for slice plans ›",
					key: "escape",
				},
			],
			{
				select: async (title, labels) => {
					if (title === "Advisor usage for slice plans") {
						projectUsageChoices = labels;
						return labels.find((label) => label.startsWith("All"));
					}
					return undefined;
				},
			},
		),
	});
	assert(
		projectUsageChoices?.[0]?.startsWith("●First"),
		"project enum picker opens on its persisted override",
	);
	assert(
		readSettings().workOrchestrator.advisorUsageForSlicePlans === "all",
		"project enum selection persists",
	);
	await invoke("work-settings", "", {
		...ctx,
		ui: customUi([
			{ target: "Coded task-vs-plan checklist", key: "enter" },
			{ expectInitial: "Coded task-vs-plan checklist", key: "escape" },
		]),
	});
	assert(
		readGlobalSettings().workOrchestrator.advisorVerifyTask === false &&
			!Object.hasOwn(
				readSettings().workOrchestrator ?? {},
				"advisorVerifyTask",
			),
		"global-first edits write only the global settings file",
	);

	const globalProfile = {};
	mod.applyProfile(globalProfile, "high");
	writeGlobalSettings(globalProfile);
	const projectProfile = {};
	mod.applyProfile(projectProfile, "low");
	mod.setWorkOrchReviewLevel(projectProfile, "full");
	writeSettings(projectProfile);
	await invoke("work-settings", "", {
		...ctx,
		ui: customUi([
			{ key: "\t" },
			{ target: "Profile:", key: "delete" },
			{ expectInitial: "Profile:", key: "escape" },
		]),
	});
	assert(
		mod.workOrchSettings(cwd).profile === "high" &&
			mod.workOrchSettings(cwd).advisorVerifyTask === true &&
			mod.workOrchSettings(cwd).codeReviewBeforeCommit === "full" &&
			!readSettings().subagents,
		"clearing a project profile restores global profile values but preserves changed gates",
	);

	writeSettings({
		workOrchestrator: { browserTestsOnUiDiff: false },
		workResume: { selfImproving: false },
		subagents: { agentOverrides: { "work-worker": { thinking: "low" } } },
	});
	await invoke("work-settings", "", {
		...ctx,
		ui: customUi([
			{ key: "\t" },
			{ target: "Clear project overrides", key: "enter" },
			{ expectInitial: "Clear project overrides", key: "escape" },
		]),
	});
	assert(
		!readSettings().workOrchestrator &&
			!readSettings().workResume &&
			!readSettings().subagents,
		"project reset removes workflow overrides only from the project",
	);
	writeGlobalSettings({
		workOrchestrator: { browserTestsOnUiDiff: false },
		workResume: { selfImproving: true },
		subagents: {
			agentOverrides: {
				"work-worker": { thinking: "low" },
				"other-agent": { thinking: "high" },
			},
		},
	});
	await invoke("work-settings", "", {
		...ctx,
		ui: customUi([
			{ target: "Reset global work settings", key: "enter" },
			{ expectInitial: "Reset global work settings", key: "escape" },
		]),
	});
	assert(
		!readGlobalSettings().workOrchestrator &&
			!readGlobalSettings().workResume &&
			!readGlobalSettings().subagents.agentOverrides["work-worker"] &&
			readGlobalSettings().subagents.agentOverrides["other-agent"].thinking ===
				"high",
		"global reset restores workflow defaults without deleting unrelated agents",
	);

	// Enter and Space both flip booleans, retain the cursor, and color state.
	mod.applyProfile((settings = readSettings()), "medium");
	writeSettings(settings);
	let enabledRender = "";
	let disabledRender = "";
	await invoke("work-settings", "", {
		...ctx,
		ui: customUi([
			{ expectText: "Settings: Global", key: "\t" },
			{
				target: "CE-test-browser when diff touches UI",
				key: " ",
				capture: (lines) => {
					enabledRender = lines.join("\n");
				},
			},
			{
				expectInitial: "CE-test-browser when diff touches UI",
				target: "Coded task-vs-plan checklist",
				key: "enter",
				capture: (lines) => {
					disabledRender = lines.join("\n");
				},
			},
			{ expectInitial: "Coded task-vs-plan checklist", key: "escape" },
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
	await invoke("work-settings", "", {
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
				{ expectText: "Settings: Global", key: "\t" },
				{ target: "Model Review:", key: "enter" },
				{
					expectInitial: "GPT 5.6 High",
					expectText: "Current: GPT 5.6 High",
					typeText: "5.6",
					target: "GPT 5.6 Mini",
					key: "enter",
					capture: (lines) => {
						filteredModels = lines.join("\n");
					},
				},
				{ expectInitial: "Model Review:", key: "escape" },
			],
			{
				select: async (_title, labels) =>
					labels.find((label) => label.startsWith("High")),
			},
		),
	});
	settings = readSettings();
	assert(
		["GPT 5.6 High", "GPT 5.6 Mini", "GPT 5.6 Codex"].every((name) =>
			filteredModels.includes(name),
		),
		"typing filters and keeps all matching models visible",
	);
	assert(!filteredModels.includes("Other Model"), "filter hides non-matches");
	assert(
		settings.subagents.agentOverrides["work-reviewer"].model ===
			"test/gpt-5.6-mini",
		"filtered model picker selects highlighted model",
	);
	assert(
		settings.subagents.agentOverrides["work-reviewer"].thinking === "high",
		"typed model flow still selects effort",
	);

	// Verifier UI uses the shared model/effort flow, starts with Test coverage
	// at High, and keeps the verifier list as the main submenu.
	writeGlobalSettings({});
	writeSettings({});
	const verifierModels = {
		getAvailable: async () => [
			{ provider: "test", id: "model-a" },
			{ provider: "test", id: "model-b" },
		],
	};
	const firstVerifierChecks = [
		"Model:",
		"Maintainability",
		"Security",
		"Add background verifier",
		"Model:",
		undefined,
	];
	const verifierEfforts = ["High", "High"];
	await invoke("work-settings", "", {
		...ctx,
		modelRegistry: verifierModels,
		ui: customUi(
			[
				{ target: "Background verifiers ›", key: "enter" },
				{ target: "test/model-a", key: "enter" },
				{ target: "test/model-b", key: "enter" },
				{ expectInitial: "Background verifiers ›", key: "escape" },
			],
			{
				select: async (title, labels) => {
					const wanted =
						title === "Background verifier checks"
							? firstVerifierChecks.shift()
							: verifierEfforts.shift();
					return labels.find((label) => label.includes(wanted));
				},
			},
		),
	});
	assert(
		JSON.stringify(mod.backgroundVerifierProfiles(cwd)) ===
			JSON.stringify([
				{
					model: "test/model-a",
					operations: ["maintainability", "security", "test-gap"],
					thinking: "high",
				},
				{
					model: "test/model-b",
					operations: ["test-gap"],
					thinking: "high",
				},
			]),
		`new verifier profiles default to Test coverage at High: ${JSON.stringify(mod.backgroundVerifierProfiles(cwd))}`,
	);
	const duplicateNoticeAt = notices.length;
	const duplicateSelections = ["test/model-b", "Model:", "High", undefined];
	await invoke("work-settings", "", {
		...ctx,
		modelRegistry: verifierModels,
		ui: customUi(
			[
				{ target: "Background verifiers ›", key: "enter" },
				{ target: "test/model-a", key: "enter" },
				{ expectInitial: "Background verifiers ›", key: "escape" },
			],
			{
				select: async (_title, labels) => {
					const wanted = duplicateSelections.shift();
					return labels.find((label) => label.includes(wanted));
				},
			},
		),
	});
	assert(
		notices
			.slice(duplicateNoticeAt)
			.some((notice) => notice.message.includes("already configured")),
		"duplicate verifier model selections are rejected",
	);
	assert(
		mod.backgroundVerifierProfiles(cwd).length === 2,
		"duplicate selection preserves both verifier profiles",
	);
	writeGlobalSettings({
		workOrchestrator: {
			backgroundVerifiers: {
				"retired/model": { operations: ["performance"], thinking: "low" },
			},
		},
	});
	writeSettings({});
	await invoke("work-settings", "status", ctx);
	assert(
		mod.backgroundVerifierProfiles(cwd)[0].model === "retired/model" &&
			notices.at(-1).message.includes("retired/model"),
		"an unavailable saved verifier remains visible without model remapping",
	);
	writeGlobalSettings({});

	// Every advisor model picker supports none and inherit; none skips effort.
	await invoke("work-settings", "", {
		...ctx,
		ui: customUi(
			[
				{ expectText: "Settings: Global", key: "\t" },
				{ target: "Model Advisor 2:", key: "enter" },
				{
					expectInitial: "None",
					expectText: "Current: None",
					target: "Use global model setting",
					key: "enter",
				},
				{ expectInitial: "Model Advisor 2:", key: "escape" },
			],
			{
				select: async (_title, labels) =>
					labels.find((label) => label.startsWith("High")),
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
	await invoke("work-settings", "", {
		...ctx,
		ui: customUi([
			{ expectText: "Settings: Global", key: "\t" },
			{ target: "Model Advisor 2:", key: "enter" },
			{
				expectInitial: "Use global model setting",
				target: "None",
				key: "enter",
			},
			{ expectInitial: "Model Advisor 2:", key: "escape" },
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
	settings.subagents = {
		agentOverrides: {
			"work-advisor": { model: "test/generator-a" },
			"work-advisor-2": { model: "test/generator-b" },
			"work-advisor-3": { model: "test/generator-c" },
		},
	};
	writeSettings(settings);
	assert(
		JSON.stringify(mod.divergentTaskModels(cwd)) ===
			JSON.stringify([
				"test/generator-a",
				"test/generator-b",
				"test/generator-c",
			]),
		"divergent branches reuse the configured advisor models",
	);
	const creativeStep = mod.creativeSidecarStep(cwd, "brainstorm artifact");
	assert(
		(creativeStep.match(/work-divergent/g) ?? []).length === 3 &&
			creativeStep.includes("async:true") &&
			creativeStep.includes("subagent_wait with all:true") &&
			creativeStep.includes("wo:divergent-analysis") &&
			creativeStep.includes("test/generator-c"),
		"creative sidecar launches three isolated model-assigned branches and preserves provenance",
	);
	const allAdvisors = mod.advisorCriticStep(cwd, "master plan", "all");
	for (const agent of ["work-advisor", "work-advisor-2", "work-advisor-3"])
		assert(allAdvisors.includes(agent), `parallel gate includes ${agent}`);
	assert(
		allAdvisors.includes("exactly one parallel subagent call") &&
			allAdvisors.includes("requirements/evidence auditor") &&
			allAdvisors.includes("builder/on-call critic") &&
			allAdvisors.includes("adversarial simplifier") &&
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
	assert(
		mod
			.divergentTaskModels(cwd)
			.every((model) => model === "__inherit_model__"),
		"same-model fallback still produces all three isolated branches",
	);
} finally {
	rmSync(cwd, { recursive: true, force: true });
	rmSync(globalDir, { recursive: true, force: true });
	if (previousConfigDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousConfigDir;
}

process.stdout.write("ok - work-settings behavior\n");
