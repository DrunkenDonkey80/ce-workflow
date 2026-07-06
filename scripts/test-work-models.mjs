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

const { default: workModelsExtension } = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);

function assert(ok, message) {
	if (!ok) throw new Error(message);
}

const cwd = mkdtempSync(path.join(tmpdir(), "work-models-"));
try {
	const commands = {};
	workModelsExtension({
		on: () => {},
		registerCommand: (name, config) => {
			commands[name] = config;
		},
	});

	const notices = [];
	const choices = [/^review\b/, /^test\/review-model\b/, /^xhigh\b/];
	const ctx = {
		cwd,
		model: { provider: "current", id: "control" },
		modelRegistry: {
			getAvailable: async () => [
				{ provider: "test", id: "review-model", name: "Review Model" },
			],
		},
		ui: {
			notify: (message, level) => notices.push({ message, level }),
			select: async (_title, labels) => {
				const wanted = choices.shift();
				const picked = labels.find((label) => wanted.test(label));
				assert(picked, `missing choice ${wanted}`);
				return picked;
			},
		},
	};

	await commands["work-models"].handler("", ctx);
	const settingsPath = path.join(cwd, ".pi", "settings.json");
	assert(existsSync(settingsPath), "work-models writes settings");
	let settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	assert(
		settings.subagents.agentOverrides["bead-reviewer"].model ===
			"test/review-model",
		"review model override is visible in settings",
	);
	assert(
		settings.subagents.agentOverrides["bead-reviewer"].thinking === "xhigh",
		"review effort override is visible in settings",
	);

	await commands["work-models"].handler("status", ctx);
	assert(
		notices.at(-1).message.includes("review: model:test/review-model"),
		"status shows review tuning",
	);

	await commands["work-models"].handler("reset", ctx);
	settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	assert(
		!settings.subagents?.agentOverrides?.["bead-reviewer"],
		"reset clears review tuning",
	);
} finally {
	rmSync(cwd, { recursive: true, force: true });
}

console.log("ok - work-models behavior");
