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

	// Default (no settings) resolves to medium profile.
	assert(
		mod.workOrchSettings(cwd).profile === "medium",
		"default profile medium",
	);
	assert(
		mod.workOrchSettings(cwd).critic.brainstorm === true,
		"medium critic brainstorm",
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
		mod.workOrchSettings(cwd).slicePlanWithCePlan === true,
		"medium ce-plan per slice",
	);
	assert(
		mod.workOrchSettings(cwd).slicePlanCeDepth === "Lightweight",
		"medium ce-plan lightweight",
	);
	assert(
		mod.workOrchSettings(cwd).codeReviewBeforeCommit === false,
		"medium no code review",
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
	assert(max.critic.plan === true, "max critic plan");
	assert(max.advisorVerifyTask === true, "max advisor verify");
	assert(max.codeReviewBeforeCommit === true, "max code review");
	assert(max.slicePlanWithCePlan === true, "max ce-plan per slice");
	assert(max.slicePlanCeDepth === "Deep", "max ce-plan deep");
	assert(max.simplifyBeforeReview === true, "max simplify");
	assert(max.browserTestsOnUiDiff === true, "max browser tests");
	assert(
		readSettings().subagents.agentOverrides["bead-advisor"].thinking ===
			"xhigh",
		"advisor effort xhigh",
	);
	assert(
		readSettings().subagents.agentOverrides["bead-advisor-backup"].thinking ===
			"high",
		"backup advisor effort high",
	);
	assert(
		readSettings().subagents.agentOverrides["bead-worker"].thinking === "xhigh",
		"worker effort xhigh",
	);

	// Flip a boolean live; profile label is preserved.
	settings = readSettings();
	mod.setWorkOrchBoolean(settings, "advisorVerifyTask", false);
	mod.setWorkOrchBoolean(settings, "slicePlanBeforeWork", false);
	mod.setWorkOrchBoolean(settings, "slicePlanWithCePlan", false);
	mod.setWorkOrchBoolean(settings, "codeReviewBeforeCommit", false);
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
		mod.workOrchSettings(cwd).codeReviewBeforeCommit === false,
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
		mod.workOrchSettings(cwd).slicePlanCeDepth === "Standard",
		"high ce-plan standard",
	);

	// Apply low profile: critic and verify off.
	mod.applyProfile((settings = readSettings()), "low");
	writeSettings(settings);
	const low = mod.workOrchSettings(cwd);
	assert(low.critic.brainstorm === false, "low no critic brainstorm");
	assert(low.advisorVerifyTask === false, "low no advisor verify");
	assert(low.slicePlanBeforeWork === true, "low lightweight slice planning");
	assert(low.slicePlanWithCePlan === false, "low no ce-plan per slice");
	assert(low.slicePlanCeDepth === "Lightweight", "low ce-plan depth unused");
	assert(low.codeReviewBeforeCommit === false, "low no code review");
	assert(low.simplifyBeforeReview === false, "low no simplify");
	assert(low.browserTestsOnUiDiff === false, "low no browser tests");

	// Toggle a critic gate explicitly.
	mod.setWorkOrchCritic((settings = readSettings()), "plan", true);
	writeSettings(settings);
	assert(
		mod.workOrchSettings(cwd).critic.plan === true,
		"explicit critic plan on",
	);
	assert(
		mod.workOrchSettings(cwd).critic.brainstorm === false,
		"brainstorm stays low default",
	);

	// Submenu loop: opening then choosing "done" exits cleanly.
	const commands = {};
	mod.default({
		on: () => {},
		registerCommand: (name, config) => {
			commands[name] = config;
		},
	});
	const notices = [];
	const ctx = {
		cwd,
		model: { provider: "p", id: "m" },
		modelRegistry: { getAvailable: async () => [] },
		ui: {
			notify: (message, level) => notices.push({ message, level }),
			select: async () => "done — Exit settings",
		},
	};
	await commands["work-settings"].handler("", ctx);
	assert(notices.length === 0, "done exits without notify");

	// status reports the advisor slot and gates.
	await commands["work-settings"].handler("status", ctx);
	assert(
		notices.at(-1).message.includes("Work settings\n\nProfile"),
		"status is grouped and readable",
	);
	assert(
		notices.at(-1).message.includes("› advisor (critic)"),
		"status lists advisor slot as submenu",
	);
	assert(
		notices.at(-1).message.includes("› advisor backup"),
		"status lists backup advisor slot as submenu",
	);
	assert(
		notices.at(-1).message.includes("planner writes slice plan before work"),
		"status lists slice planning gate",
	);
	assert(
		notices.at(-1).message.includes("ce-plan per slice (medium/high/max)"),
		"status lists ce-plan slice gate",
	);
	assert(
		notices.at(-1).message.includes("ce-plan slice depth: Lightweight"),
		"status lists ce-plan slice depth",
	);
	assert(
		notices.at(-1).message.includes("full ce-code-review before commit"),
		"status lists code-review gate",
	);
	assert(
		notices.at(-1).message.includes("ce-simplify-code before review"),
		"status lists simplify gate",
	);
	assert(
		notices.at(-1).message.includes("ce-test-browser when diff touches UI"),
		"status lists browser-test gate",
	);
	assert(
		notices.at(-1).message.includes("self-improving workflow fixes"),
		"status lists self-improving toggle",
	);
	assert(
		notices.at(-1).message.includes("new session between iterations"),
		"status lists fresh-session toggle",
	);
	assert(existsSync(settingsFile()), "settings file exists");

	// Live submenu: flip a critic gate off through the UI loop.
	mod.applyProfile((settings = readSettings()), "medium");
	writeSettings(settings);
	assert(
		mod.workOrchSettings(cwd).critic.brainstorm === true,
		"medium critic brainstorm on",
	);
	let flipped = false;
	const flipCtx = {
		cwd,
		model: { provider: "p", id: "m" },
		modelRegistry: { getAvailable: async () => [] },
		ui: {
			notify: () => {},
			select: async (_title, labels) => {
				if (!flipped) {
					flipped = true;
					return labels.find((label) => label.includes("critic on brainstorm"));
				}
				return labels.find((label) => label.startsWith("done"));
			},
		},
	};
	await commands["work-settings"].handler("", flipCtx);
	assert(
		mod.workOrchSettings(cwd).critic.brainstorm === false,
		"UI loop flipped critic brainstorm off",
	);

	let flippedResume = false;
	const resumeCtx = {
		cwd,
		model: { provider: "p", id: "m" },
		modelRegistry: { getAvailable: async () => [] },
		ui: {
			notify: () => {},
			select: async (_title, labels) => {
				if (!flippedResume) {
					flippedResume = true;
					return labels.find((label) =>
						label.includes("self-improving workflow fixes"),
					);
				}
				return labels.find((label) => label.startsWith("done"));
			},
		},
	};
	await commands["work-settings"].handler("", resumeCtx);
	assert(
		readSettings().workResume.selfImproving === true,
		"UI loop flipped self-improving on",
	);
} finally {
	rmSync(cwd, { recursive: true, force: true });
}

console.log("ok - work-settings behavior");
