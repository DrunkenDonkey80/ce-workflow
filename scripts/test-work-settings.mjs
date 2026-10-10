#!/usr/bin/env node
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
	mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const mod = await import(
	pathToFileURL(path.join(import.meta.dirname, "../extensions/work-models.ts"))
		.href
);

function assert(ok, message) {
	if (!ok) throw new Error(message);
}

const previousConfigDir = process.env.PI_CODING_AGENT_DIR;
const previousWorkflow = process.env.CE_WORKFLOW_ENABLED;
const previousAgentDirs = process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS;
// Most of this suite exercises legacy settings; the off surface is tested separately below.
process.env.CE_WORKFLOW_ENABLED = "1";
const previousSerial = process.env.WORK_ORCH_SERIAL;
const previousAskUserContextExpanded = process.env.PI_ASK_USER_CONTEXT_EXPANDED;
const globalDir = mkdtempSync(path.join(tmpdir(), "work-global-settings-"));
process.env.PI_CODING_AGENT_DIR = globalDir;
delete process.env.WORK_ORCH_SERIAL;
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

	// The loaded build stamp works without Git and changes when extension source changes.
	const buildDir = path.join(cwd, "build-stamp");
	mkdirSync(path.join(buildDir, "extensions"), { recursive: true });
	writeFileSync(path.join(buildDir, "package.json"), JSON.stringify({ version: "1.2.3" }));
	writeFileSync(path.join(buildDir, "extensions", "plan3.ts"), "export default 1;\n");
	const firstBuild = mod.workflowBuildLabelForTest(buildDir);
	assert(/^ce-workflow v1\.2\.3 · build [0-9a-f]{8}$/.test(firstBuild), "stamp includes version and source fingerprint");
	assert(mod.workflowBuildLabelForTest(buildDir) === firstBuild, "unchanged sources produce the same stamp");
	writeFileSync(path.join(buildDir, "extensions", "plan3.ts"), "export default 2;\n");
	assert(mod.workflowBuildLabelForTest(buildDir) !== firstBuild, "Plan3-only edits change the build stamp");
	assert(mod.workflowBuildLabelForTest(path.join(cwd, "missing-package")) === "ce-workflow · build unavailable", "missing metadata cannot break the menu");
	assert(/^ce-workflow v.+ · build [0-9a-f]{8}$/.test(mod.loadedWorkflowBuildLabelForTest), "loaded package captures a build stamp");

	// Package default stays off; a hidden user default enables every project,
	// while an explicit project false remains an escape hatch.
	assert(
		mod.workResumeSettingsForTest(cwd).selfImproving === false,
		"self improvement defaults off",
	);
	assert(
		mod.workResumeSettingsForTest(cwd).goalThinkingLevel === "inherit",
		"autonomous goals inherit the current effort by default",
	);
	assert(
		mod.workOrchSettings(cwd).reviewPolicy === "risk-based",
		"existing settings migrate to risk-based production review",
	);
	assert(
		mod.workOrchSettings(cwd).visualDesignWorkflow === "off" &&
			!mod.workOrchSettings(cwd).openDesignCommand &&
			mod.workOrchSettings(cwd).designReviewProof === "standard",
		"visual design settings default to Off, Auto executable, and Standard proof",
	);
	assert(
		JSON.stringify(mod.workPerformanceSettings(cwd)) ===
			JSON.stringify({
				parallelReadOnlyLanes: true,
				parallelVerification: false,
				parallelBackgroundVerifiers: true,
				parallelAdvisors: true,
			}),
		"performance defaults are conservative where model bursts can compound",
	);
	assert(!existsSync(settingsFile()), "no default source mutation");
	assert(mod.compactionModeSettings(cwd) === "ultracompact", "existing settings default to Ultracompact");
	const nativeMode = {};
	mod.setCompactionMode(nativeMode, "native");
	assert(!nativeMode.compaction, "mode selection never rewrites Pi's native settings");
	writeGlobalSettings(nativeMode);
	assert(mod.compactionModeSettings(cwd) === "native", "global native mode is inherited");
	writeSettings({ workOrchestrator: { context: { enabled: true } } });
	assert(mod.compactionModeSettings(cwd) === "ultracompact", "legacy project On overrides a global native mode");
	writeSettings({ workOrchestrator: { context: { enabled: false } } });
	assert(mod.compactionModeSettings(cwd) === "native", "legacy project Off fully disables Ultracompact");
	mod.setCompactionMode(nativeMode, "native-200k");
	writeSettings(nativeMode);
	assert(mod.compactionModeSettings(cwd) === "native-200k", "project native-200k overrides global mode");
	mod.setCompactionMode(nativeMode, "ultrafull");
	writeSettings(nativeMode);
	assert(mod.compactionModeSettings(cwd) === "ultrafull", "Ultrafull is a persisted project mode");
	assert(nativeMode.workOrchestrator.context.enabled && nativeMode.workOrchestrator.context.autoCompact,
		"Ultrafull enables early checkpoint triggers without rewriting native compaction settings");
	assert(!nativeMode.compaction, "Ultrafull leaves Pi's retained-tail settings intact");
	writeGlobalSettings(nativeMode);
	writeSettings({});
	assert(mod.compactionModeSettings(cwd) === "ultrafull", "Ultrafull can be inherited globally");
	mod.setCompactionMode(nativeMode, "ultracompact");
	writeGlobalSettings(nativeMode);
	writeSettings({ workOrchestrator: { context: { enabled: false } } });
	assert(mod.compactionModeSettings(cwd) === "native", "legacy project Off overrides global Ultracompact");
	let invalidMode = false;
	try { mod.setCompactionMode({}, "typo"); } catch { invalidMode = true; }
	assert(invalidMode, "invalid modes cannot be persisted");
	writeGlobalSettings({});
	writeSettings({});
	const compactionDefault = mod.compactionModelSettings(cwd);
	assert(compactionDefault.model === "__none_model__", "compaction defaults to cleaned code with no model");
	const compactionSettings = { workKnowledge: { discoverer: { model: "old/model" } } };
	mod.setCompactionModel(compactionSettings, { model: "test/summary", thinking: "high" });
	assert(!compactionSettings.workKnowledge, "saving compaction removes the retired discoverer setting");
	writeGlobalSettings(compactionSettings);
	assert(mod.compactionModelSettings(cwd).model === "test/summary", "global compaction model selects hybrid");
	const compactionOverride = {};
	mod.setCompactionModel(compactionOverride, compactionDefault);
	writeSettings(compactionOverride);
	assert(mod.compactionModelSettings(cwd).model === compactionDefault.model, "project None overrides a global hybrid model");
	writeGlobalSettings({});
	writeSettings({ workKnowledge: { discoverer: { model: "old/model" } } });
	assert(mod.compactionModelSettings(cwd).model === compactionDefault.model, "legacy knowledge settings cannot enable model calls");
	writeSettings({});
	process.env.WORK_ORCH_SERIAL = "1";
	assert(
		Object.values(mod.workPerformanceSettings(cwd)).every(
			(value) => value === false,
		),
		"WORK_ORCH_SERIAL forces every performance path to serial or off",
	);
	delete process.env.WORK_ORCH_SERIAL;
	writeSettings({
		workPerformance: {
			prepareNextCandidate: true,
			parallelVerification: true,
		},
	});
	assert(
		!("prepareNextCandidate" in mod.workPerformanceSettings(cwd)) &&
			mod.workPerformanceSettings(cwd).parallelVerification === false,
		"retired prefetch and project performance overrides are ignored",
	);
	writeSettings({ workOrchestrator: { serialReadOnlyLanes: true } });
	assert(
		mod.workPerformanceSettings(cwd).parallelReadOnlyLanes === false,
		"legacy project serial-lane settings remain a safe compatibility fallback",
	);
	writeGlobalSettings({
		workPerformance: { parallelReadOnlyLanes: true },
	});
	assert(
		mod.workPerformanceSettings(cwd).parallelReadOnlyLanes === true,
		"an explicit global performance switch replaces the legacy project fallback",
	);
	writeSettings({});
	writeFileSync(
		path.join(globalDir, "settings.json"),
		JSON.stringify({
			workResume: {
				selfImprovingDefault: true,
				goalThinkingLevel: "medium",
			},
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
		mod.workResumeSettingsForTest(cwd).selfImproving === false,
		"legacy global self-improvement defaults stay disabled",
	);
	assert(
		mod.workResumeSettingsForTest(cwd).goalThinkingLevel === "medium",
		"global settings can lower autonomous-goal main effort",
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
		"legacy project self-improvement flags stay disabled",
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
			effective.subagents.agentOverrides["work-advisor-2"].thinking === "medium",
		"nested project model settings override only selected global fields",
	);
	writeSettings({});
	writeFileSync(path.join(globalDir, "settings.json"), "{}\n");
	const reviewAllSettings = {};
	mod.setWorkOrchReviewPolicy(reviewAllSettings, "review-all");
	writeGlobalSettings(reviewAllSettings);
	assert(
		mod.workOrchSettings(cwd).reviewPolicy === "review-all",
		"global Review All applies to projects without an override",
	);
	writeSettings({ workOrchestrator: { reviewPolicy: "risk-based" } });
	assert(
		mod.workOrchSettings(cwd).reviewPolicy === "risk-based",
		"project production-review policy overrides the global selection",
	);
	writeSettings({});
	writeFileSync(path.join(globalDir, "settings.json"), "{}\n");
	assert(
		mod.workOrchSettings(cwd).creativeMode === "ask",
		"creative sidecar defaults to one Quick/Wide question",
	);
	const legacyAdvisorResearchSettings = {};
	assert(
		mod.setWorkOrchBoolean(
			legacyAdvisorResearchSettings,
			"preBrainstormAdvisors",
			true,
		) === false && legacyAdvisorResearchSettings.workOrchestrator === undefined,
		"retired pre-brainstorm advisor settings are ignored",
	);
	const creativeSettings = {};
	mod.setWorkOrchCreativeMode(creativeSettings, "auto");
	writeSettings(creativeSettings);
	assert(
		mod.workOrchSettings(cwd).creativeMode === "auto",
		"creative sidecar mode persists",
	);
	writeSettings({
		subagents: {
			agentOverrides: {
				"bead-worker": { model: "test/terra", thinking: "medium" },
				"bead-advisor": { model: "test/opus", thinking: "xhigh" },
				"bead-advisor-backup": {
					model: "test/sol",
					thinking: "high",
				},
			},
		},
	});
	const legacyEffective = mod.effectiveSettingsForTest(cwd);
	assert(
		legacyEffective.subagents.agentOverrides["work-worker"].model ===
			"test/terra" &&
			legacyEffective.subagents.agentOverrides["work-advisor"].model ===
				"test/opus" &&
			legacyEffective.subagents.agentOverrides["work-advisor-2"].model ===
				"test/sol",
		"legacy bead role overrides feed the current work role slots",
	);
	assert(
		mod.workOrchSettings(cwd).advisorEnabled.advisor2 === true &&
			mod
				.advisorCriticStep(cwd, "brainstorm artifact", "all")
				.includes("work-advisor-2"),
		"a legacy advisor backup keeps the configured multi-model brainstorm critic enabled",
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
		mod.workOrchSettings(cwd).modelStrategy === "main-first",
		"model strategy defaults compatibly to main-first",
	);
	assert(
		mod.workOrchSettings(cwd).advisorEnabled.advisor === true &&
			mod.workOrchSettings(cwd).advisorEnabled.advisor2 === false &&
			mod.workOrchSettings(cwd).advisorEnabled.advisor3 === false,
		"medium defaults to one inherited advisor",
	);
	assert(
		mod.workOrchSettings(cwd).advisorVerifyTask === true,
		"medium advisor verify",
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
		![
			"advisorUsageForSlicePlans",
			"slicePlanBeforeWork",
			"slicePlanWithCePlan",
			"slicePlanCeDepth",
			"simplifyBeforeReview",
		].some((key) => key in mod.workOrchSettings(cwd)),
		"retired orchestration settings are absent",
	);
	assert(
		mod.workOrchSettings(cwd).browserTestsOnUiDiff === true,
		"medium browser tests on ui diff",
	);

	// Every shipped profile keeps the mutable Lead at high effort.
	for (const profile of ["low", "medium", "high", "max"]) {
		const profileSettings = {};
		mod.applyProfile(profileSettings, profile);
		assert(
			profileSettings.subagents.agentOverrides["work-lead"].thinking === "high",
			`${profile} profile keeps Lead effort high`,
		);
	}

	// Apply max profile: effort + gates copied onto current, models preserved.
	let settings = {};
	mod.applyProfile(settings, "max");
	writeSettings(settings);
	const max = mod.workOrchSettings(cwd);
	assert(max.profile === "max", "profile max");
	assert(max.advisorVerifyTask === true, "max advisor verify");
	assert(max.codeReviewBeforeCommit === "full", "max full review");
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
	assert(
		readSettings().subagents.agentOverrides["work-lead"].thinking === "high",
		"every effort profile pins Lead to high effort",
	);

	// Flip a boolean live; profile label is preserved.
	settings = readSettings();
	mod.setWorkOrchBoolean(settings, "advisorVerifyTask", false);
	assert(
		mod.setWorkOrchBoolean(settings, "slicePlanBeforeWork", false) === false &&
			mod.setWorkOrchBoolean(settings, "slicePlanWithCePlan", false) === false,
		"retired slice-plan toggles cannot be restored",
	);
	mod.setWorkOrchReviewLevel(settings, "off");
	writeSettings(settings);
	assert(
		mod.workOrchSettings(cwd).advisorVerifyTask === false,
		"flipped verify off",
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

	// Apply low profile: critic and verify off.
	settings = readSettings();
	mod.applyProfile(settings, "low");
	writeSettings(settings);
	const low = mod.workOrchSettings(cwd);
	assert(low.advisorVerifyTask === false, "low no advisor verify");
	assert(low.codeReviewBeforeCommit === "off", "low no review");
	assert(low.browserTestsOnUiDiff === false, "low no browser tests");

	const commands = {};
	delete process.env.PI_ASK_USER_CONTEXT_EXPANDED;
	mod.default({
		on: () => {},
		getAllTools: () => [{ name: "chatgpt_consult" }],
		registerCommand: (name, config) => {
			commands[name] = config;
		},
		registerTool: () => {},
	});
	assert(
		process.env.PI_ASK_USER_CONTEXT_EXPANDED === "true",
		"ask_user context starts expanded by default",
	);
	const invoke = (name, args, ctx) =>
		mod.executeOrchestratorAction(name, args, ctx, {});
	assert(!commands["work-models"], "redundant work-models command removed");

	const notices = [];
	const customUi = (actions, options = {}) => ({
		notify: (message, level) => notices.push({ message, level }),
		editor: options.editor,
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
			for (const key of action.preKeys ?? []) component.handleInput(key);
			for (const character of action.typeText ?? "")
				component.handleInput(character);
			if (action.target) {
				for (let guard = 0; guard < 100; guard += 1) {
					lines = component.render(140);
					if (
						lines.some(
							(line) => line.includes("[accent]") && line.includes(action.target),
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
			for (const key of action.afterKeys ?? []) component.handleInput(key);
			assert(closed, `settings action ${action.key} did not close selector`);
			return result;
		},
	});
	let modelRows = "";
	const ctx = {
		cwd,
		model: { provider: "p", id: "m" },
		modelRegistry: { getAvailable: async () => [] },
		ui: customUi([
			{
				expectText: "Settings: Global",
				key: "escape",
				capture: (lines) => {
					modelRows = lines.join("\n");
				},
			},
		]),
	};
	await invoke("work-settings", "", ctx);
	assert(notices.length === 0, "escape exits without notify");
	assert(
		modelRows.includes(
			"[text]Model Plan / Migration: [Inherit: High] ›[/text]",
		) &&
			modelRows.includes(
				"[text]Model Brainstorm / Ideate: [Inherit: High] ›[/text]",
			) &&
			modelRows.includes("[muted]   -> Backup: [None] ›[/muted]") &&
			modelRows.includes("[text]Model Work: [Inherit: Medium] ›[/text]"),
		"task model rows are white with indented light-gray backups",
	);
	await invoke("work-settings", "", {
		...ctx,
		mode: "rpc",
		ui: {
			notify: ctx.ui.notify,
			select: async () => undefined,
		},
	});
	assert(notices.length === 0, "non-TUI settings fallback exits cleanly");
	let visionChoices = "";
	await invoke("work-settings", "", {
		...ctx,
		modelRegistry: { getAvailable: async () => [
			{ provider: "test", id: "text-only", name: "Text Only", input: ["text"] },
			{ provider: "test", id: "vision", name: "Vision Test", input: ["text", "image"] },
		] },
		ui: customUi([
			{ target: "Vision model:", key: "enter" },
			{ target: "Vision Test", key: "enter", capture: lines => { visionChoices = lines.join("\n"); } },
			{ target: "Models without vision:", key: "enter" },
			{ target: "Text Only", key: "enter", afterKeys: ["escape"] },
			{ key: "escape" },
		]),
	});
	assert(visionChoices.includes("Vision Test") && visionChoices.includes("Text Only"), "vision picker trusts the selected model");
	assert(mod.visionModelSettings(cwd) === "test/vision", "selected vision model persists");
	assert(JSON.stringify(mod.nonVisionModelsSettings(cwd)) === JSON.stringify(["test/text-only"]), "explicit non-vision checklist persists");
	// Return to default so subsequent settings assertions remain independent.
	writeSettings({});

	// status reports the advisor slot and gates.
	await invoke("work-settings", "status", ctx);
	assert(
		notices.at(-1).message.includes("Work settings\n\nProfile"),
		"status is grouped and readable",
	);
	for (const phrase of [
		"model strategy: main-first",
		"› Lead / Resolution: Main model:inherit current • effort:high • Backup:none",
		"› Advisor 1: Main model:inherit current",
		"› Advisor 2: Main model:none",
		"› Advisor 3: Main model:none",
		"creative sidecar: ask",
		"workflow: off",
		"OpenDesign executable: Auto",
		"review proof: standard",
		"pre-commit review:",
		"implementation: configured Work model (isolated work-worker)",
		"Private browser checks when diff touches UI",
		"Performance tweaks (global)",
		"sequential verification shards",
		"parallel background verifiers",
		"parallel advisors",
		"new session between iterations",
	])
		assert(notices.at(-1).message.includes(phrase), `status lists ${phrase}`);
	assert(
		![
			"slice execution",
			"slice plan",
			"simplification",
			"prepare next candidate",
			"self-improving workflow reporting",
		].some((phrase) => notices.at(-1).message.toLowerCase().includes(phrase)),
		"status omits retired orchestration settings",
	);
	assert(existsSync(settingsFile()), "settings file exists");

	const chooseDesignSetting = async (row, submenu, option, input) => {
		let mainVisits = 0;
		return invoke("work-settings", "", {
			...ctx,
			mode: "rpc",
			ui: {
				notify: ctx.ui.notify,
				input,
				select: async (title, labels) => {
					if (title === "Settings: Global" && mainVisits++ === 0)
						return labels.find((label) => label.includes(row));
					if (title === submenu)
						return labels.find((label) => label.includes(option));
				},
			},
		});
	};
	await chooseDesignSetting(
		"Visual design workflow:",
		"Visual design workflow",
		"Auto",
	);
	await chooseDesignSetting(
		"OpenDesign executable:",
		"OpenDesign executable",
		"Configure command spec",
		async () =>
			JSON.stringify({
				command: "od",
				args: ["mcp"],
				env: { OD_HOST: "local" },
			}),
	);
	await chooseDesignSetting(
		"Design review proof:",
		"Design review proof",
		"Strict",
	);
	let designSettings = readGlobalSettings().workOrchestrator;
	assert(
		designSettings.visualDesignWorkflow === "auto" &&
			designSettings.designReviewProof === "strict" &&
			designSettings.openDesignCommand.command === "od" &&
			designSettings.openDesignCommand.env.OD_HOST === "local",
		"global visual design settings persist a validated structured command spec",
	);

	const projectDesignBase = readSettings().workOrchestrator;
	writeSettings({
		...readSettings(),
		workOrchestrator: {
			...projectDesignBase,
			visualDesignWorkflow: "required",
		},
	});
	assert(
		mod.workOrchSettings(cwd).visualDesignWorkflow === "required" &&
			mod.workOrchSettings(cwd).designReviewProof === "strict" &&
			mod.workOrchSettings(cwd).openDesignCommand.command === "od",
		"project workflow override inherits global launch and proof settings",
	);
	writeSettings({ ...readSettings(), workOrchestrator: projectDesignBase });
	assert(
		mod.workOrchSettings(cwd).visualDesignWorkflow === "auto",
		"clearing the project workflow override restores the global value",
	);

	const designNoticeCount = notices.length;
	await chooseDesignSetting(
		"OpenDesign executable:",
		"OpenDesign executable",
		"Configure command spec",
		async () =>
			JSON.stringify({ command: "od", env: { API_KEY: "do-not-store" } }),
	);
	designSettings = readGlobalSettings().workOrchestrator;
	assert(
		designSettings.openDesignCommand.env.OD_HOST === "local" &&
			notices
				.slice(designNoticeCount)
				.every(({ message }) => !message.includes("do-not-store")),
		"credential-bearing command specs are rejected without logging or persistence",
	);

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

	let performanceBefore = "";
	let performanceAfter = "";
	await invoke("work-settings", "", {
		...ctx,
		ui: customUi([
			{ target: "Performance tweaks", key: "enter" },
			{
				target: "Verification shards",
				expectText: "Performance tweaks: Global",
				key: "enter",
				capture: (lines) => {
					performanceBefore = lines.join("\n");
				},
			},
			{
				expectInitial: "Verification shards",
				expectText: "Performance tweaks: Global",
				key: "escape",
				capture: (lines) => {
					performanceAfter = lines.join("\n");
				},
			},
			{
				expectInitial: "Performance tweaks",
				expectText: "Settings: Global",
				key: "escape",
			},
		]),
	});
	assert(
		performanceBefore.includes("→ sequential Verification shards") &&
			performanceAfter.includes("⇉ parallel Verification shards") &&
			readGlobalSettings().workPerformance.parallelVerification === true &&
			!readSettings().workPerformance,
		"performance submenu toggles global settings only and retains its cursor",
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
		/\[local\].* on Coded task-vs-plan checklist/s.test(globalScopeRender) &&
			/\[local\].* off Coded task-vs-plan checklist/s.test(projectScopeRender),
		"portable local override marker is visible in both scopes",
	);
	assert(
		!/\[local\].* on Coded task-vs-plan checklist/s.test(inheritedScopeRender) &&
			mod.workOrchSettings(cwd).advisorVerifyTask === true &&
			!Object.hasOwn(readSettings().workOrchestrator ?? {}, "advisorVerifyTask"),
		"Backspace clears only the selected project override",
	);
	assert(
		readGlobalSettings().workOrchestrator.advisorVerifyTask === true,
		"clearing a project override preserves the global value",
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
			!Object.hasOwn(readSettings().workOrchestrator ?? {}, "advisorVerifyTask"),
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
		workPerformance: { prepareNextCandidate: true },
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
			!readGlobalSettings().workPerformance &&
			!readGlobalSettings().subagents.agentOverrides["work-worker"] &&
			readGlobalSettings().subagents.agentOverrides["other-agent"].thinking ===
				"high",
		"global reset restores workflow defaults without deleting unrelated agents",
	);

	// Enter and Space both flip booleans, retain the cursor, and color state.
	settings = readSettings();
	mod.applyProfile(settings, "medium");
	writeSettings(settings);
	let enabledRender = "";
	let disabledRender = "";
	await invoke("work-settings", "", {
		...ctx,
		ui: customUi([
			{ expectText: "Settings: Global", key: "\t" },
			{
				target: "Private browser checks when diff touches UI",
				key: " ",
				capture: (lines) => {
					enabledRender = lines.join("\n");
				},
			},
			{
				expectInitial: "Private browser checks when diff touches UI",
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
		scopedModels: [
			{
				model: {
					provider: "test",
					id: "gpt-5.6-high",
					name: "GPT 5.6 High",
				},
				thinkingLevel: "xhigh",
			},
			{
				model: {
					provider: "test",
					id: "gpt-5.6-codex",
					name: "GPT 5.6 Codex",
				},
			},
		],
		ui: customUi(
			[
				{ expectText: "Settings: Global", key: "\t" },
				{ target: "Model Review:", key: "enter" },
				{
					expectInitial: "GPT 5.6 High",
					expectText: "Showing 2 models scoped by Pi.",
					preKeys: ["tab"],
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
		"Tab switches from Pi-scoped models to the filterable full model list",
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
	await invoke("work-settings", "", {
		...ctx,
		ui: customUi([
			{ expectText: "Settings: Global", key: "\t" },
			{ target: "Model Advisor 2:", key: "enter" },
			{
				expectInitial: "None",
				target: "ChatGPT Web",
				key: "enter",
			},
			{ expectInitial: "Model Advisor 2: [ChatGPT Web]", key: "escape" },
		]),
	});
	assert(
		mod.workOrchSettings(cwd).advisorEnabled.advisor2 === true &&
			readSettings().workOrchestrator.advisorSources.advisor2 === "chatgpt-web",
		"installed ChatGPT Web is selectable as an advisor source",
	);
	await invoke("work-settings", "", {
		...ctx,
		ui: customUi([
			{ expectText: "Settings: Global", key: "\t" },
			{ target: "Model Brainstorm / Ideate:", key: "enter" },
			{ target: "ChatGPT Web", key: "enter" },
			{ key: "escape" },
		]),
	});
	assert(
		readSettings().workOrchestrator.creativeSource === "chatgpt-web",
		"brainstorm and ideate have a dedicated ChatGPT Web source selector",
	);

	settings = readSettings();
	delete settings.workOrchestrator.advisorSources;
	delete settings.workOrchestrator.creativeSource;
	settings.workOrchestrator.advisorEnabled = {
		advisor: true,
		advisor2: true,
		advisor3: true,
	};
	settings.subagents = {
		agentOverrides: {
			"work-divergent": { model: "test/generator-b" },
			"work-advisor": { model: "test/generator-a" },
			"work-advisor-2": { model: "test/generator-b" },
			"work-advisor-3": { model: "test/generator-c" },
		},
	};
	writeSettings(settings);
	assert(
		JSON.stringify(mod.divergentTaskModels(cwd)) ===
			JSON.stringify(["test/generator-a", "test/generator-b", "test/generator-c"]),
		"divergent branches reuse the configured advisor models",
	);
	const creativeStep = mod.creativeSidecarStep(cwd, "brainstorm artifact");
	const creativeKeys = creativeStep.match(/"key":"divergent-\d+"/g) ?? [];
	assert(
		(creativeStep.match(/work-divergent/g) ?? []).length === 3 &&
			creativeStep.includes("workflow:true") &&
			creativeStep.includes("runs.all") &&
			creativeKeys.length === 3 &&
			new Set(creativeKeys).size === 3 &&
			!creativeStep.includes("tasks mode") &&
			creativeStep.includes("async:true") &&
			creativeStep.includes("bg_wait with all:true") &&
			creativeStep.includes("wo:divergent-analysis") &&
			creativeStep.includes("test/generator-b"),
		"creative sidecar uses unique stable-key workflow:true branches and preserves provenance",
	);
	settings.workOrchestrator.advisorSources = { advisor2: "chatgpt-web" };
	settings.workOrchestrator.creativeSource = "chatgpt-web";
	writeSettings(settings);
	const chatgptCreative = mod.creativeSidecarStep(cwd, "brainstorm artifact");
	const chatgptAdvisor = mod.advisorCriticStep(cwd, "brainstorm artifact");
	const chatgptIdeate = mod.ideateSidecarStep(cwd, "ideation artifact");
	assert(
		(chatgptCreative.match(/work-divergent/g) ?? []).length === 0 &&
			(chatgptCreative.match(/mode:"temp"/g) ?? []).length === 1 &&
			chatgptCreative.includes("chatgpt_consult") &&
			chatgptCreative.includes('mode:"temp"') &&
			chatgptAdvisor.includes("call chatgpt_consult directly") &&
			chatgptAdvisor.includes('mode:"advisor"') &&
			chatgptIdeate.includes("chatgpt_consult") &&
			chatgptIdeate.includes('mode:"temp"'),
		"ChatGPT Web replaces only its selected advisor branch in brainstorm, critique, and ideate prompts",
	);
	delete settings.workOrchestrator.advisorSources;
	delete settings.workOrchestrator.creativeSource;
	writeSettings(settings);
	const researchPrompt = mod.researchHandoffPrompt(cwd, "Which path is best?");
	assert(
		researchPrompt.includes("ask_user") &&
			researchPrompt.includes("configured advisor slots") &&
			researchPrompt.includes("research_note") &&
			!researchPrompt.includes("workflowScript"),
		"research offers configured read-only advisors and records temp findings",
	);
	assert(["None (", "Narrow (", "Wide ("].every(choice => researchPrompt.includes(choice)),
		"headless research offers all three advisor modes");
	for (const [advisors, currentModel, availableModels, expected] of [
		["none", "test/control", null, []],
		["narrow", "test/control", null, ["test/generator-a"]],
		["narrow", "test/generator-a", null, ["test/generator-b"]],
		["narrow", "test/control", ["test/generator-c"], ["test/generator-c"]],
		["wide", "test/generator-c", null, ["test/generator-a", "test/generator-b"]],
		["wide", "test/control", null, ["test/generator-a", "test/generator-b", "test/generator-c"]],
		["wide", "test/generator-a", ["test/generator-a", "test/generator-c"], ["test/generator-c"]],
		["wide", "test/control", [], []],
	]) {
		const prompt = mod.researchHandoffPrompt(cwd, "Compare alternatives", { advisors, currentModel, availableModels });
		const slots = JSON.parse(prompt.match(/Slots: (\[[^\n]+?\])\. Wait/)?.[1] ?? "[]");
		assert(JSON.stringify(slots.map(slot => slot.model)) === JSON.stringify(expected),
			`${advisors} uses eligible configured advisors in list order, excluding ${currentModel}`);
		assert(!prompt.includes("ask_user"), "explicit advisor modes do not ask again");
		if (advisors === "none") assert(!prompt.includes("subagents_enable"), "None never delegates");
	}
	settings.subagents.agentOverrides["work-advisor"].model = "__inherit_model__";
	writeSettings(settings);
	const inheritedResearch = mod.researchHandoffPrompt(cwd, "Compare alternatives", { advisors: "narrow", currentModel: "test/control" });
	assert(inheritedResearch.includes('"model":"test/generator-b"') && !inheritedResearch.includes('"model":"test/control"'),
		"an inherited inline model is skipped before Narrow selects its advisor");
	settings.subagents.agentOverrides["work-advisor"].model = "test/generator-a";
	writeSettings(settings);
	const healthTargets = mod.selectedAgentHealthTargets(
		cwd,
		"test/control",
		"brainstorm",
	);
	assert(
		JSON.stringify(healthTargets.map((target) => target.model)) ===
			JSON.stringify(["test/generator-b"]),
		"brainstorm health checks only the dedicated creative model",
	);
	const healthNotices = [];
	const healthWidgets = [];
	const healthCtx = {
		cwd,
		hasUI: true,
		mode: "rpc",
		model: { provider: "test", id: "control" },
		modelRegistry: {
			find: (provider, id) => ({ provider, id }),
			complete: async (model) => {
				if (model.id === "generator-b")
					throw new Error("No API key or login is available");
				return {
					stopReason: "stop",
					content: [{ type: "text", text: "HI" }],
				};
			},
		},
		ui: {
			notify: (message, level) => healthNotices.push({ message, level }),
			setWidget: (key, value) => healthWidgets.push({ key, value }),
			select: async (_title, labels) =>
				labels.find((label) => label.includes("Continue without")),
		},
	};
	const health = await mod.brainstormAgentHealthPreflight(healthCtx);
	assert(
		health.proceed &&
			JSON.stringify(health.offlineModels) ===
				JSON.stringify(["test/generator-b"]) &&
			healthNotices.some(
				(notice) =>
					notice.level === "warning" &&
					notice.message.includes("No API key or login is available"),
			),
		"brainstorm preflight reports login failures and can continue without them",
	);
	assert(
		healthWidgets.some(
			({ value }) => value?.[0] === "Checking agents... (0/1)",
		) &&
			healthWidgets.some(
				({ value }) => value?.[0] === "Checking agents... (1/1)",
			) &&
			healthWidgets.at(-1)?.value === undefined,
		"brainstorm preflight shows and clears live per-agent progress",
	);
	assert(
		healthNotices.some(
			({ message }) => message === "Agent check complete (1/1).",
		),
		"brainstorm preflight reports completion before opening the prompt",
	);
	const secretResult = await mod.probeAgentModel(
		{
			...healthCtx,
			modelRegistry: {
				...healthCtx.modelRegistry,
				complete: async () => ({
					stopReason: "error",
					errorMessage: "gateway token=secret-value-123456 failed",
				}),
			},
		},
		{ model: "test/generator-a", roles: ["Advisor 1"] },
		20,
	);
	assert(
		!secretResult.ok &&
			secretResult.reason.includes("[redacted]") &&
			!secretResult.reason.includes("secret-value"),
		"provider errors are redacted before the health report",
	);
	let timeoutSignal;
	const timeoutResult = await mod.probeAgentModel(
		{
			...healthCtx,
			modelRegistry: {
				...healthCtx.modelRegistry,
				complete: async (_model, _context, options) => {
					timeoutSignal = options.signal;
					return new Promise(() => {});
				},
			},
		},
		{ model: "test/generator-a", roles: ["Advisor 1"] },
		5,
	);
	assert(
		!timeoutResult.ok &&
			timeoutResult.reason.includes("timed out") &&
			timeoutSignal.aborted,
		"health probes abort and report a bounded timeout",
	);
	const offlineHandoff = mod.brainstormHandoffPrompt(
		{
			artifact: "",
			idea: { id: "I-1", title: "Idea" },
			epic: { id: "E-1", title: "Epic" },
		},
		cwd,
		"wide",
		{
			offlineModels: health.offlineModels,
			currentModel: "test/control",
		},
	);
	assert(
		(offlineHandoff.match(/work-divergent/g) ?? []).length === 0 &&
			!offlineHandoff.includes("work-advisor-2"),
		"continuing excludes the failed creative model and advisor launches",
	);
	const allAdvisors = mod.advisorCriticStep(cwd, "master plan", "all");
	for (const agent of ["work-advisor", "work-advisor-2", "work-advisor-3"])
		assert(allAdvisors.includes(agent), `parallel gate includes ${agent}`);
	assert(
		allAdvisors.includes("exactly one parallel subagent call") &&
			allAdvisors.includes("workflow:true") && allAdvisors.includes("using runs.all") &&
			!allAdvisors.includes("tasks mode") &&
			allAdvisors.includes("requirements/evidence auditor") &&
			allAdvisors.includes("builder/on-call critic") &&
			allAdvisors.includes("adversarial simplifier") &&
			allAdvisors.includes("never invoke ce-doc-review") &&
			allAdvisors.includes("one focused re-review by work-advisor") &&
			allAdvisors.includes("Never start a recursive review loop"),
		"parallel synthesis and bounded first-advisor re-review are explicit",
	);
	const sequentialAdvisorSettings = readGlobalSettings();
	mod.setWorkPerformanceBoolean(
		sequentialAdvisorSettings,
		"parallelAdvisors",
		false,
	);
	writeGlobalSettings(sequentialAdvisorSettings);
	assert(
		mod
			.advisorCriticStep(cwd, "master plan", "all")
			.includes("one at a time with separate context:fresh single-agent calls"),
		"advisor setting switches the prompt to sequential launches",
	);
	mod.setWorkPerformanceBoolean(
		sequentialAdvisorSettings,
		"parallelAdvisors",
		true,
	);
	writeGlobalSettings(sequentialAdvisorSettings);
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
		mod.divergentTaskModels(cwd).every((model) => model === "__inherit_model__"),
		"same-model fallback still produces all three isolated branches",
	);
	assert(
		JSON.stringify(
			mod
				.selectedAgentHealthTargets(cwd, "test/control", "brainstorm")
				.map((target) => target.model),
		) === JSON.stringify(["test/generator-b"]),
		"disabled advisors do not affect the dedicated creative model",
	);
	settings.workOrchestrator.backgroundVerifiers = {
		__inherit_model__: {
			operations: ["correctness"],
			thinking: "low",
		},
	};
	writeSettings(settings);
	const inheritedVerifierTargets = mod.selectedAgentHealthTargets(
		cwd,
		"test/control",
	);
	assert(
		!inheritedVerifierTargets.some(
			(target) => target.model === "__inherit_model__",
		) &&
			inheritedVerifierTargets.some(
				(target) =>
					target.model === "test/control" &&
					target.roles.includes("Background verifier"),
			),
		"inherited background verifiers resolve to the current model",
	);

	// Subscription footer is global-only, default-off, cancelable, and live-applied.
	writeGlobalSettings({});
	writeSettings({
		workOrchestrator: { subscriptionFooter: { enabled: true, incidents: true } },
	});
	assert(
		JSON.stringify(mod.subscriptionFooterSettingsForTest()) ===
			JSON.stringify({
				enabled: false,
				incidents: false,
				ownershipNoticeAcknowledged: false,
			}),
		"subscription footer defaults off and ignores contradictory project settings",
	);
	const footerCalls = [];
	let confirmations = 0;
	const footerCtx = { ...ctx, mode: "tui", hasUI: true };
	const useFooterCtx = (actions, confirm = true) => {
		footerCtx.ui = {
			...customUi(actions, {
				confirm: async () => {
					confirmations += 1;
					return confirm;
				},
			}),
			setFooter: (factory) => footerCalls.push(factory),
		};
		return footerCtx;
	};
	await invoke(
		"work-settings",
		"",
		useFooterCtx(
			[
				{ target: "Subscription footer (global only)", key: "enter" },
				{ target: "Subscription footer", key: "enter" },
				{ expectInitial: "Subscription footer", key: "escape" },
				{ expectInitial: "Subscription footer (global only)", key: "escape" },
			],
			false,
		),
	);
	assert(
		confirmations === 1 && !mod.subscriptionFooterSettingsForTest().enabled,
		"canceling the ownership warning writes nothing and installs nothing",
	);
	assert(footerCalls.length === 0, "canceled enable does not install a footer");

	await invoke(
		"work-settings",
		"",
		useFooterCtx([
			{ target: "Subscription footer (global only)", key: "enter" },
			{ target: "Subscription footer", key: "enter" },
			{
				expectInitial: "Subscription footer",
				target: "Provider incident markers",
				key: "enter",
			},
			{ expectInitial: "Provider incident markers", key: "escape" },
			{ expectInitial: "Subscription footer (global only)", key: "escape" },
		]),
	);
	assert(
		mod.subscriptionFooterSettingsForTest().enabled &&
			mod.subscriptionFooterSettingsForTest().incidents &&
			mod.subscriptionFooterSettingsForTest().ownershipNoticeAcknowledged,
		"confirmed enable persists both global defaults and the one-time acknowledgement",
	);
	assert(
		confirmations === 2 && typeof footerCalls.at(-1) === "function",
		"first confirmed enable warns once and installs immediately",
	);

	await invoke(
		"work-settings",
		"",
		useFooterCtx([
			{ target: "Subscription footer (global only)", key: "enter" },
			{ target: "Subscription footer", key: "enter" },
			{ expectInitial: "Subscription footer", key: "escape" },
			{ expectInitial: "Subscription footer (global only)", key: "escape" },
		]),
	);
	assert(
		confirmations === 2 &&
			!mod.subscriptionFooterSettingsForTest().enabled &&
			footerCalls.at(-1) === undefined &&
			notices.at(-1).message.includes("/reload"),
		"disable does not warn again, applies live, and explains footer restoration",
	);

	// Export/import operates on the selected raw file, never merged defaults.
	writeGlobalSettings({
		theme: "dark",
		workOrchestrator: { creativeMode: "ask" },
	});
	writeSettings({ workOrchestrator: { creativeMode: "off" } });
	const beforeImport = readFileSync(globalSettingsFile(), "utf8");
	let copied;
	await mod.exportSettings(
		{
			...ctx,
			ui: customUi([{ expectText: "Export settings: Global", key: "escape" }]),
		},
		"global",
		async (content) => {
			copied = content;
		},
	);
	assert(
		copied === beforeImport &&
			notices.at(-1).message.includes("copied to clipboard") &&
			notices.at(-1).message.includes(globalSettingsFile()),
		"export copies exact global JSON and reports the absolute path",
	);
	await mod.exportSettings(
		{
			...ctx,
			ui: customUi([{ key: "escape" }]),
		},
		"project",
		async () => {
			throw new Error("clipboard unavailable");
		},
	);
	assert(
		notices.at(-1).message.includes("Could not read or copy") &&
			notices.at(-1).message.includes(settingsFile()),
		"clipboard failure still shows the project file path",
	);

	const imported =
		'{\n  "workOrchestrator": { "creativeMode": "auto" },\n  "theme": "light",\n  "custom": "Unicode: 日本語 🚀"\n}';
	await invoke("work-settings", "", {
		...ctx,
		ui: customUi(
			[
				{ target: "Import settings", key: "enter" },
				{ expectText: "Replace global settings?", key: "enter" },
				{ expectInitial: "Import settings", key: "escape" },
			],
			{ editor: async () => imported },
		),
	});
	const backups = (dir) =>
		readdirSync(dir).filter((name) => name.endsWith(".bak"));
	assert(
		readFileSync(globalSettingsFile(), "utf8") === imported &&
			readFileSync(path.join(globalDir, backups(globalDir)[0]), "utf8") ===
				beforeImport &&
			/settings\.json\.\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z\./.test(
				backups(globalDir)[0],
			),
		"pasted JSON replaces the full file after preserving a timestamped exact backup",
	);
	assert(
		mod.workOrchSettings(cwd).creativeMode === "off" &&
			notices.some(
				({ message }) =>
					message.includes("Imported settings:") && message.includes("/reload"),
			),
		"import preserves project overrides and explains reload behavior",
	);

	const sourceFile = path.join(cwd, "2026 imported settings.json");
	writeFileSync(sourceFile, imported);
	const beforeProject = readFileSync(settingsFile(), "utf8");
	await invoke("work-settings", "", {
		...ctx,
		ui: customUi(
			[
				{ key: "\t" },
				{ target: "Import settings", key: "enter" },
				{ expectText: "Replace project settings?", key: "enter" },
				{ expectInitial: "Import settings", key: "escape" },
			],
			{ editor: async () => `"${sourceFile}"` },
		),
	});
	assert(
		readFileSync(settingsFile(), "utf8") === imported &&
			readFileSync(
				path.join(cwd, ".pi", backups(path.join(cwd, ".pi"))[0]),
				"utf8",
			) === beforeProject &&
			mod.workOrchSettings(cwd).creativeMode === "auto",
		"quoted file path replaces only the selected project file and workflow reads update live",
	);

	const importContext = (input, key = "enter") => ({
		...ctx,
		ui: customUi([{ key }], { input: async () => input }),
	});
	await mod.importSettings(importContext(path.basename(sourceFile)), "global");
	await mod.importSettings(importContext(`"${globalSettingsFile()}"`), "global");
	assert(
		backups(globalDir).length === 3 &&
			readFileSync(sourceFile, "utf8") === imported,
		"relative numeric-leading paths and self-import work without clobbering earlier backups or the source",
	);

	for (const input of [
		undefined,
		"",
		"   ",
		"[]",
		"null",
		"true",
		"42",
		'{"secret":"DO-NOT-ECHO",',
		'{"__proto__":{"polluted":true}}',
		"missing-settings.json",
	]) {
		await mod.importSettings(importContext(input), "global");
		assert(
			readFileSync(globalSettingsFile(), "utf8") === imported &&
				backups(globalDir).length === 3,
			"empty, invalid, unsafe, or missing imports leave the current file and backups untouched",
		);
	}
	assert(
		!notices.some(({ message }) => message.includes("DO-NOT-ECHO")),
		"invalid JSON errors never echo pasted secrets",
	);
	await mod.importSettings(importContext("{}", "escape"), "global");
	assert(
		readFileSync(globalSettingsFile(), "utf8") === imported &&
			backups(globalDir).length === 3,
		"canceling confirmation does not write settings or a backup",
	);
	writeFileSync(sourceFile, "not JSON");
	await mod.importSettings(importContext(sourceFile), "global");
	assert(
		readFileSync(globalSettingsFile(), "utf8") === imported &&
			backups(globalDir).length === 3,
		"invalid file contents are rejected before backup or replacement",
	);

	// Existing corrupt settings are recoverable too; missing files aren't materialized by export.
	writeFileSync(settingsFile(), "broken original");
	await mod.importSettings(importContext("{}"), "project");
	assert(
		backups(path.join(cwd, ".pi")).some(
			(name) =>
				readFileSync(path.join(cwd, ".pi", name), "utf8") === "broken original",
		),
		"import preserves even a corrupt previous file verbatim",
	);
	rmSync(settingsFile());
	await mod.exportSettings(
		{ ...ctx, ui: customUi([{ key: "escape" }]) },
		"project",
		async () => {
			throw new Error("must not copy a missing file");
		},
	);
	assert(
		!existsSync(settingsFile()) &&
			notices.at(-1).message.includes("No settings file exists"),
		"export of an absent scope reports its path without creating a file",
	);
	await mod.importSettings(importContext("{}"), "project");
	assert(
		readFileSync(settingsFile(), "utf8") === "{}" &&
			notices.at(-1).message.includes("No previous file"),
		"first import creates settings without pretending a backup exists",
	);
	assert(
		!readdirSync(globalDir).some((name) => name.endsWith(".tmp")),
		"successful imports leave no temporary files",
	);

	// Legacy workflow switch: unset = off; the Settings row persists it and reloads.
	delete process.env.CE_WORKFLOW_ENABLED;
	writeSettings({});
	writeGlobalSettings({});
	assert(!mod.workflowEnabled(cwd), "unset workflow switch is off");
	let reloads = 0;
	let workflowVisits = 0;
	await invoke("work-settings", "", {
		...ctx,
		mode: "rpc",
		reload: async () => {
			reloads += 1;
		},
		ui: {
			notify: ctx.ui.notify,
			select: async (title, labels) =>
				title === "Settings: Global" && workflowVisits++ === 0
					? labels.find((label) => label.includes("Workflow (legacy orchestration)"))
					: undefined,
		},
	});
	assert(
		readGlobalSettings().workOrchestrator.workflow.enabled === true &&
			reloads === 1 &&
			mod.workflowEnabled(cwd),
		"workflow row persists the switch and reloads the runtime",
	);
	// Plan3 second-opinion list: add, reorder, remove persist in order.
	const planScript = [
		["Settings: Global", "Plan3 → Plan models"],
		["Plan models", "Add model"], ["Plan model: choose model", "gpt-6-astra"], ["Plan model: choose effort", "High —"],
		["Plan models", "Add model"], ["Plan model: choose model", "claude-opus-5-5"], ["Plan model: choose effort", "High —"],
		["Plan models", "Add model"], ["Plan model: choose model", "glm-5.3"], ["Plan model: choose effort", "Low —"],
		["Plan models", "2."], ["Plan model", "Move up"],
		["Plan models", "3."], ["Plan model", "Remove"],
	];
	await invoke("work-settings", "", {
		...ctx,
		mode: "rpc",
		modelRegistry: { getAvailable: async () => [
			{ provider: "openai-codex", id: "gpt-6-astra", name: "gpt-6-astra" },
			{ provider: "anthropic", id: "claude-opus-5-5", name: "claude-opus-5-5" },
			{ provider: "zai", id: "glm-5.3", name: "glm-5.3" },
		] },
		ui: {
			notify: ctx.ui.notify,
			select: async (title, labels) => {
				const step = planScript[0];
				if (!step || step[0] !== title) return undefined;
				planScript.shift();
				return labels.find((label) => label.includes(step[1]));
			},
		},
	});
	assert(
		planScript.length === 0 &&
			JSON.stringify(readGlobalSettings().workOrchestrator.plan3.models) ===
				JSON.stringify([
					{ model: "anthropic/claude-opus-5-5", thinking: "high" },
					{ model: "openai-codex/gpt-6-astra", thinking: "high" },
				]),
		`plan models add/reorder/remove persist (${JSON.stringify(planScript[0])})`,
	);
	const effortScript = [["Settings: Global", "Plan3 → Coding effort: same as session"], ["Plan3 coding effort", "Medium —"], ["Settings: Global", "Plan3 → Coding model: same as session"], ["Plan3 coding model", "glm-5.3"]];
	await invoke("work-settings", "", {
		...ctx,
		mode: "rpc",
		modelRegistry: { getAvailable: async () => [{ provider: "zai", id: "glm-5.3", name: "glm-5.3" }] },
		ui: {
			notify: ctx.ui.notify,
			select: async (title, labels) => {
				const step = effortScript[0];
				if (!step || step[0] !== title) return undefined;
				effortScript.shift();
				return labels.find((label) => label.includes(step[1]));
			},
		},
	});
	assert(
		effortScript.length === 0 &&
			readGlobalSettings().workOrchestrator.plan3.codingEffort === "medium" &&
			readGlobalSettings().workOrchestrator.plan3.codingModel === "zai/glm-5.3" &&
			readGlobalSettings().workOrchestrator.plan3.models.length === 2,
		`coding effort and model persist beside plan models (${JSON.stringify(effortScript[0])})`,
	);
	const loadExtension = () => {
		const loaded = { commands: {}, tools: {}, shortcuts: {}, hooks: {}, events: { on: () => {}, emit: () => {} } };
		mod.default({
			getActiveTools: () => [],
			setActiveTools: () => {},
			getThinkingLevel: () => "medium",
			setThinkingLevel: () => {},
			on: (name, handler) => { (loaded.hooks[name] ??= []).push(handler); },
			events: loaded.events,
			registerCommand: (name, config) => {
				loaded.commands[name] = config;
			},
			registerTool: (tool) => {
				loaded.tools[tool.name] = tool;
			},
			registerShortcut: (name, config) => {
				loaded.shortcuts[name] = config;
			},
			appendEntry: () => {},
			sendUserMessage: () => {},
			sendMessage: () => {},
		});
		return loaded;
	};
	process.env.CE_WORKFLOW_ENABLED = "0";
	const legacyDir = path.resolve(import.meta.dirname, "../agents");
	const utilityDir = path.resolve(import.meta.dirname, "../utility-agents");
	const unrelatedDir = path.join(cwd, "my-agents");
	process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS = [unrelatedDir, legacyDir].join(path.delimiter);
	const off = loadExtension();
	assert(
		process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS === [unrelatedDir, utilityDir].join(path.delimiter),
		"workflow off removes stale legacy scan root, keeps utilities and unrelated roots",
	);
	assert(
		JSON.stringify(off.hooks.resources_discover[0]()) === "{}",
		"workflow off advertises no legacy skills",
	);
	assert(!Object.keys(off.commands).some(name => name.startsWith("__orchestrator-")),
		"workflow off hides internal goal/monitor commands");
	assert(!/goal|pause|Orchestrator/.test(off.commands.wo.description) && /\/wo plan/.test(off.commands.wo.description),
		"workflow off command description advertises only Plan3 and utilities");
	const blocked = await off.hooks.tool_call[0]({ toolName: "subagent", input: { agent: "work-advisor" } }, { cwd });
	assert(blocked?.block && /off/.test(blocked.reason) && /oracle/.test(blocked.reason) && !/wo resume/.test(blocked.reason),
		"stale work-advisor calls explain off state and normal advisor, not disabled resume");
	assert(!mod.workSubagentToolCall({ toolName: "subagent", input: { agent: "context-knowledge-discoverer" } }, { cwd }),
		"active knowledge utility is not misclassified as legacy orchestration");
	const offCtx = { ...ctx, mode: "print", sessionManager: {
		getSessionId: () => "off-session",
		getBranch: () => [{ type: "custom", customType: "work-goal-state", data: {
			goal: { id: "old-goal", objective: "Old legacy objective", status: "active", resumeOnSessionStart: true },
		} }],
	} };
	for (const handler of off.hooks.session_start) await handler({}, offCtx);
	const previousChildAgent = process.env.PI_SUBAGENT_CHILD_AGENT;
	process.env.PI_SUBAGENT_CHILD_AGENT = "work-advisor";
	try {
		let result;
		for (const handler of off.hooks.before_agent_start) {
			const out = await handler({ prompt: "Hello", systemPrompt: "Base prompt" }, offCtx);
			if (out) result = out;
		}
		assert(result?.systemPrompt === "Base prompt", "off ignores saved legacy goals and stale child identity");
		const stillBlocked = await off.hooks.tool_call[0]({ toolName: "subagent", input: { agent: "work-advisor" } }, offCtx);
		assert(stillBlocked?.block, "stale identity cannot authorize legacy roles while off");
		await off.hooks.agent_settled[0]({}, offCtx);
	} finally {
		if (previousChildAgent === undefined) delete process.env.PI_SUBAGENT_CHILD_AGENT;
		else process.env.PI_SUBAGENT_CHILD_AGENT = previousChildAgent;
	}
	let offSettings = [];
	await invoke("work-settings", "", { ...ctx, mode: "rpc", ui: {
		notify: ctx.ui.notify,
		select: async (_title, labels) => { offSettings = labels; return undefined; },
	} });
	assert(offSettings.some(label => label.includes("Plan3")) && offSettings.some(label => label.includes("OpenDesign executable:")) &&
		!offSettings.some(label => /Model Advisor|Profile:|Model strategy:|Background verifiers|autonomous-goal|Visual design workflow|Design review proof|pre-commit review/.test(label)),
		"workflow off settings keep Plan3/OpenDesign launch and hide inactive role/gate/design controls");
	assert(!offSettings.some(label => label.includes("Camera (project only)")), "camera controls are never a global setting");
	const beforeGlobalCamera = readGlobalSettings();
	writeGlobalSettings({ ...beforeGlobalCamera, workOrchestrator: { ...beforeGlobalCamera.workOrchestrator,
		camera: { enabled: true, device: { id: "@device_pnp_global", label: "Global camera" } },
	} });
	writeSettings({});
	let projectCameraRender = "";
	await off.commands.wo.handler("settings", { ...ctx, mode: "tui", hasUI: true, ui: customUi([
		{ key: "\t" },
		{ target: "Camera (project only)", key: "enter", capture: lines => { projectCameraRender = lines.join("\n"); } },
		{ expectText: "Camera: Project only", key: "escape" },
		{ expectInitial: "Camera (project only)", key: "escape" },
	]) });
	assert(projectCameraRender.includes("Camera (project only): OFF") && !projectCameraRender.includes("Global camera"),
		"camera submenu works with legacy workflow OFF, defaults OFF and ignores global camera values");
	writeGlobalSettings(beforeGlobalCamera);
	const beforeOffLaunch = readGlobalSettings();
	await chooseDesignSetting("OpenDesign executable:", "OpenDesign executable", "Configure command spec", async () => JSON.stringify({ command: process.execPath, args: ["mcp"] }));
	assert(readGlobalSettings().workOrchestrator.openDesignCommand.command === process.execPath,
		"OpenDesign launch spec is editable without enabling legacy workflow");
	writeGlobalSettings(beforeOffLaunch);
	assert(
		!off.shortcuts.f9 &&
			off.shortcuts.f8 &&
			!Object.keys(off.tools).some((name) => name.startsWith("work_")) &&
			off.tools.knowledge,
		"workflow off registers no F9 and no work_* tools but keeps utilities",
	);
	let offMenuTitle = "";
	let offMenuLabels = [];
	assert(!off.shortcuts.f7, "F7 is removed; /wo opens the menu");
	await off.commands.wo.handler("", { ...offCtx, mode: "rpc", ui: {
		notify: ctx.ui.notify,
		select: async (title, labels) => { offMenuTitle = title; offMenuLabels = labels; return undefined; },
	} });
	assert(offMenuTitle === `Utilities — ${mod.loadedWorkflowBuildLabelForTest}`, "/wo shows the loaded build, including in the native dialog fallback");
	assert(offMenuLabels.length && offMenuLabels.every(label => ["Telemetry", "Usage report", "Settings", "Scout Pi extensions"].some(name => label.includes(name))), "other projects keep only general utility actions");
	const menuLabelsAt = async menuCwd => {
		let labels = [];
		await off.commands.wo.handler("", { ...offCtx, cwd: menuCwd, mode: "rpc", ui: {
			notify: ctx.ui.notify,
			select: async (_title, choices) => { labels = choices; return undefined; },
		} });
		return labels;
	};
	const maintenanceNames = ["Context guard", "Catch up packages"];
	for (const enabled of ["0", "1"]) {
		process.env.CE_WORKFLOW_ENABLED = enabled;
		const here = await menuLabelsAt(path.resolve(import.meta.dirname, ".."));
		const elsewhere = enabled === "0" ? offMenuLabels : await menuLabelsAt(cwd);
		assert(maintenanceNames.every(name => here.some(label => label.includes(name))), `ce-workflow shows maintenance with workflow=${enabled}`);
		assert(!maintenanceNames.some(name => elsewhere.some(label => label.includes(name))), `other projects hide maintenance with workflow=${enabled}`);
	}
	process.env.CE_WORKFLOW_ENABLED = "0";
	assert(
		JSON.stringify(off.commands.wo.getArgumentCompletions("").map(({ value }) => value)) === '["compact","plan","plans","settings","telemetry","usage","resume","fact"]',
		"workflow off completes only Plan3 and utility /wo subcommands; other projects never see catch-up/context",
	);
	const plan3Calls = [];
	off.events.emit = (name, data) => plan3Calls.push([name, data.name, data.args]);
	for (const sub of ["plan finish", "plans", "resume abc"]) await off.commands.wo.handler(sub, { cwd, ui: { notify() {} } });
	assert(JSON.stringify(plan3Calls) === JSON.stringify([["plan3:command", "plan3", "finish"], ["plan3:command", "plans3", ""], ["plan3:command", "resume3", "abc"]]), "/wo plan|plans|resume forward to Plan3 while the workflow is off");
	let woSettings = [];
	await off.commands.wo.handler("settings", { ...ctx, mode: "rpc", ui: { notify: ctx.ui.notify, select: async (_title, labels) => { woSettings = labels; return undefined; } } });
	assert(woSettings.some(label => label.includes("Plan3")), "/wo settings opens Settings directly");
	const catchUpNotices = [];
	await off.commands.wo.handler("catch-up", { cwd, ui: { notify: (message) => catchUpNotices.push(message) } });
	assert(catchUpNotices.at(-1)?.includes("Workflow is off") && !/catch-up|checkout/.test(catchUpNotices.at(-1)), "/wo catch-up does not exist outside the ce-workflow checkout");
	for (const handler of off.hooks.session_start) await handler({}, { ...offCtx, cwd: path.resolve(import.meta.dirname, "..") });
	const here = off.commands.wo.getArgumentCompletions("").map(({ value }) => value);
	for (const handler of off.hooks.session_start) await handler({}, offCtx);
	assert(here.includes("catch-up") && here.includes("context"), "the ce-workflow checkout completes catch-up/context");
	const offNotices = [];
	await off.commands.wo.handler("goal ship it", { cwd, ui: { notify: (message) => offNotices.push(message) } });
	assert(offNotices.at(-1)?.includes("Workflow is off"), "/wo goal is refused while the workflow is off");
	assert(await off.hooks.input[0]({ text: "orchestrator: work-resume" }, { cwd }) === undefined,
		"workflow off does not intercept legacy automation input");
	let statusText = "";
	await invoke("work-settings", "status", { cwd, ui: { notify: message => { statusText = message; } } });
	assert(statusText.includes("Workflow: off") && !statusText.includes("Role models") && !statusText.includes("Gates"),
		"workflow off text status does not advertise inactive orchestration");
	process.env.CE_WORKFLOW_ENABLED = "1";
	const on = loadExtension();
	assert(on.shortcuts.f9 && on.tools.work_goal_complete, "workflow on restores F9 and work_* tools");
	assert(process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS.split(path.delimiter).includes(legacyDir),
		"workflow on restores legacy role discovery");
	assert(on.hooks.resources_discover[0]().skillPaths[0] === path.resolve(import.meta.dirname, "../skills"),
		"workflow on restores legacy skills");
	if (previousWorkflow === undefined) delete process.env.CE_WORKFLOW_ENABLED;
	else process.env.CE_WORKFLOW_ENABLED = previousWorkflow;
} finally {
	rmSync(cwd, { recursive: true, force: true });
	rmSync(globalDir, { recursive: true, force: true });
	if (previousWorkflow === undefined) delete process.env.CE_WORKFLOW_ENABLED;
	else process.env.CE_WORKFLOW_ENABLED = previousWorkflow;
	if (previousAgentDirs === undefined) delete process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS;
	else process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS = previousAgentDirs;
	if (previousConfigDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousConfigDir;
	if (previousSerial === undefined) delete process.env.WORK_ORCH_SERIAL;
	else process.env.WORK_ORCH_SERIAL = previousSerial;
	if (previousAskUserContextExpanded === undefined)
		delete process.env.PI_ASK_USER_CONTEXT_EXPANDED;
	else process.env.PI_ASK_USER_CONTEXT_EXPANDED = previousAskUserContextExpanded;
}

process.stdout.write("ok - work-settings behavior\n");
