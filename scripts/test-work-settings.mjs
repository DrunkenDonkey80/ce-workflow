#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const mod = await import(pathToFileURL(path.join(import.meta.dirname, "../extensions/work-models.ts")).href);

function assert(ok, message) {
	if (!ok) throw new Error(message);
}

// Terminal dialogs under test: a hub-launched parent Pi must not route them to the hub channel.
delete process.env.PI_HUB;
const previousConfigDir = process.env.PI_CODING_AGENT_DIR;
const previousAskUserContextExpanded = process.env.PI_ASK_USER_CONTEXT_EXPANDED;
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

	const commands = {};
	delete process.env.PI_ASK_USER_CONTEXT_EXPANDED;
	mod.default({
		on: () => {},
		registerCommand: (name, config) => {
			commands[name] = config;
		},
		registerShortcut: () => {},
		registerTool: () => {},
		events: { on: () => {}, emit: () => {} },
	});
	assert(process.env.PI_ASK_USER_CONTEXT_EXPANDED === "true", "ask_user context starts expanded by default");
	// Same ctx object each call: the footer controller tracks ownership by identity.
	const invoke = (_name, args, ctx) => commands.wo.handler(`settings${args ? ` ${args}` : ""}`, Object.assign(ctx, { hasUI: true }));

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
			// Yes/No prompts use ask_user's compact view; answer them with the scripted confirm.
			const first = component.render(140);
			if (first.at(-1)?.includes("[ Yes ]")) {
				component.handleInput((await (options.confirm ?? (async () => true))()) ? "enter" : "escape");
				return result;
			}
			const action = actions.shift();
			assert(action, "unexpected settings render");
			let lines = component.render(140);
			if (action.expectInitial)
				assert(
					lines.some(
						(line) =>
							line.includes("[accent]") && line.includes(action.expectInitial),
					),
					`cursor did not stay on ${action.expectInitial}\n${lines.join("\n")}`,
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
	const ctx = {
		cwd,
		model: { provider: "p", id: "m" },
		modelRegistry: { getAvailable: async () => [] },
		ui: customUi([{ expectText: "Settings: Global", key: "escape" }]),
	};
	await invoke("work-settings", "", ctx);
	assert(notices.length === 0, "escape exits without notify");

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
			{ target: "Xhigh", key: "enter" },
			{ target: "Alternative vision model:", key: "enter" },
			{ target: "Text Only", key: "enter" },
			{ key: "escape" },
			{ key: "escape" },
		]),
	});
	assert(visionChoices.includes("Vision Test") && visionChoices.includes("Text Only"), "vision picker trusts the selected model");
	assert(/Current model/.test(visionChoices) && /None/.test(visionChoices), "vision picker offers None (images in context) and Current model");
	assert(mod.visionModelSettings(cwd) === "test/vision:xhigh", "selected vision model and effort persist");
	assert(mod.visionAltModelSettings(cwd) === "__none_model__", "escaping the effort step saves nothing");
	// Set scoped models: typing searches, Enter checks, Esc clears the search, then saves; the pickers list it before Pi restarts.
	let scopedRows = "";
	await invoke("work-settings", "", {
		...ctx,
		modelRegistry: { getAvailable: async () => [{ provider: "test", id: "text-only", name: "Text Only" }, { provider: "test", id: "vision", name: "Vision Test" }] },
		ui: customUi([
			{ target: "Set scoped models: all", key: "enter" },
			{ typeText: "vis", target: "Vision Test", key: "enter", afterKeys: ["escape", "escape"], capture: lines => { scopedRows = lines.join("\n"); } },
			{ expectText: "Set scoped models: 1", key: "escape" },
		]),
	});
	assert(scopedRows.includes("Vision Test") && !scopedRows.includes("Text Only"), "typing filters the scoped checklist");
	assert(JSON.stringify(JSON.parse(readFileSync(globalSettingsFile(), "utf8")).enabledModels) === "[\"test/vision\"]", "scoped models persist as Pi enabledModels");
	delete globalThis[Symbol.for("ce-workflow.scoped-models")];

	// Mapping agent: None by default, model+effort in one value, project None wins, clear inherits both.
	const NONE = "__none_model__";
	const mappingCtx = (actions) => ({ ...ctx, modelRegistry: { getAvailable: async () => [{ provider: "test", id: "text-only", name: "Text Only" }] }, ui: customUi(actions) });
	assert(mod.mappingModelSettings(cwd) === NONE, "mapping agent defaults to None, never the session model");
	await invoke("work-settings", "", mappingCtx([
		{ target: "Mapping agent:", key: "enter" },
		{ target: "Text Only", key: "enter" },
		{ key: "escape" },
		{ key: "escape" },
	]));
	assert(mod.mappingModelSettings(cwd) === NONE && !JSON.parse(readFileSync(globalSettingsFile(), "utf8")).workOrchestrator?.mappingModel,
		"escaping the mapping effort step saves nothing");
	await invoke("work-settings", "", mappingCtx([
		{ target: "Mapping agent:", key: "enter" },
		{ target: "Text Only", key: "enter" },
		{ target: "High", key: "enter" },
		{ expectText: "Mapping agent: [Text Only", key: "escape" },
	]));
	assert(mod.mappingModelSettings(cwd) === "test/text-only:high", "global mapping model and effort persist as one value");
	{
		// P3-06: live tests and benchmarks default PI_WORK_PROJECT_MAP=off, so a global mapping model never runs in them.
		const saved = process.env.PI_WORK_PROJECT_MAP;
		const checkout = mkdtempSync(path.join(tmpdir(), "work-map-scope-"));
		execFileSync("git", ["init", "-q"], { cwd: checkout });
		delete process.env.PI_WORK_PROJECT_MAP;
		assert(mod.projectMapScope(checkout)?.model === "test/text-only:high", "a global mapping model maps a Git checkout");
		process.env.PI_WORK_PROJECT_MAP = "off";
		try { assert(mod.projectMapScope(checkout) === undefined, "PI_WORK_PROJECT_MAP=off disables mapping despite a configured model"); }
		finally { if (saved === undefined) delete process.env.PI_WORK_PROJECT_MAP; else process.env.PI_WORK_PROJECT_MAP = saved; rmSync(checkout, { recursive: true, force: true }); }
		const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
		for (const name of readdirSync(scriptsDir).filter((file) => /^(benchmark-.*-live|.*-lab|test-work-microcompact-agent)\.mjs$/.test(file))) {
			const text = readFileSync(path.join(scriptsDir, name), "utf8");
			if (/\bspawn\(/.test(text) && /cli\.js|launcher|piCli/.test(text)) assert(text.includes('process.env.PI_WORK_PROJECT_MAP ??= "off"'), `${name} spawns Pi and must default PI_WORK_PROJECT_MAP=off`);
		}
	}
	await invoke("work-settings", "", mappingCtx([
		{ key: "\t" },
		{ target: "Mapping agent:", key: "enter" },
		{ target: "None", key: "enter" },
		{ key: "escape" },
	]));
	assert(mod.mappingModelSettings(cwd) === NONE && JSON.parse(readFileSync(settingsFile(), "utf8")).workOrchestrator.mappingModel === NONE,
		"project None overrides a global mapping model");
	// Another session writes while the menu is open; clearing the override must not restore the menu snapshot.
	await invoke("work-settings", "", mappingCtx([
		{ key: "\t" },
		{ target: "Mapping agent:", key: "delete", capture: () => writeSettings({ theme: "concurrent", workOrchestrator: { mappingModel: NONE } }) },
		{ key: "escape" },
	]));
	const clearedProject = JSON.parse(readFileSync(settingsFile(), "utf8"));
	assert(clearedProject.theme === "concurrent" && !clearedProject.workOrchestrator, "clearing the override keeps a concurrent write");
	assert(mod.mappingModelSettings(cwd) === "test/text-only:high", "clearing the project override inherits global model and effort together");
	for (const bad of ["garbage", "test/text-only", "test/text-only:ultra", "has space/m:low", 42, null])
		assert(mod.mappingModelSettings(cwd, { workOrchestrator: { mappingModel: bad } }) === NONE, `malformed mapping value ${bad} fails closed to None`);
	writeGlobalSettings({});
	// Return to default so subsequent settings assertions remain independent.
	writeSettings({});
	writeGlobalSettings({});
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
			) === beforeProject,
		"quoted file path replaces only the selected project file",
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
} finally {
	rmSync(cwd, { recursive: true, force: true });
	rmSync(globalDir, { recursive: true, force: true });
	if (previousConfigDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousConfigDir;
	if (previousAskUserContextExpanded === undefined) delete process.env.PI_ASK_USER_CONTEXT_EXPANDED;
	else process.env.PI_ASK_USER_CONTEXT_EXPANDED = previousAskUserContextExpanded;
}

process.stdout.write("ok - work-settings behavior\n");
