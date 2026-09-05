import crypto from "node:crypto";
import fs from "node:fs";
import readline from "node:readline";

const mode = process.env.FAKE_OD_MODE ?? "success";
const tools = [
	"collect_brief",
	"create_project",
	"write_file",
	"get_project",
	"start_run",
	"get_run",
	"cancel_run",
	"list_files",
	"get_artifact",
	"get_file",
];
let calls = 0;
const stateFile = process.env.FAKE_OD_STATE_FILE;
let fixtureState = {
	activeProject: "",
	activeRun: "",
	runPhase: "",
	files: {},
};
if (mode === "design-e2e" && stateFile && fs.existsSync(stateFile)) {
	try {
		fixtureState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
	} catch {
		fixtureState = { activeProject: "", activeRun: "", runPhase: "", files: {} };
	}
}
const projectFiles = new Map(Object.entries(fixtureState.files ?? {}));
let lastBriefHash = fixtureState.lastBriefHash ?? "a".repeat(64);

function saveFixtureState() {
	if (mode !== "design-e2e" || !stateFile) return;
	fixtureState.files = Object.fromEntries(projectFiles);
	fixtureState.lastBriefHash = lastBriefHash;
	fs.writeFileSync(stateFile, JSON.stringify(fixtureState));
}

function reportedProjectName() {
	if (mode === "report-cwd") return process.cwd();
	if (mode === "report-pid") return String(process.pid);
	if (mode === "report-daemon-url") return process.env.OD_DAEMON_URL ?? "";
	if (mode === "report-daemon-binding")
		return JSON.stringify({
			args: process.argv.slice(2),
			url: process.env.OD_DAEMON_URL ?? "",
		});
	return "Recovered";
}

function promptBriefHash(prompt) {
	return (
		/Set briefHash to ([a-f0-9]{64})/.exec(prompt)?.[1] ??
		/- Brief hash: ([a-f0-9]{64})/.exec(prompt)?.[1] ??
		/"briefHash":"([a-f0-9]{64})"/.exec(prompt)?.[1] ??
		"a".repeat(64)
	);
}

function promptTargets(prompt) {
	const source = /## Required target matrix\s+```json\s+([\s\S]*?)\s+```/.exec(
		prompt,
	)?.[1];
	try {
		const targets = JSON.parse(source ?? "[]");
		if (Array.isArray(targets) && targets.length) return targets;
	} catch {}
	return [
		{
			id: "TARGET-RESPONSIVE",
			platform: "web",
			requiredViewports: ["mobile", "desktop"],
			requiredScreenIds: ["SCREEN-CALCULATOR"],
			requiredFlowIds: ["FLOW-CALCULATE"],
			evidence: ["fixture"],
		},
	];
}

function candidateFiles(prompt) {
	const briefHash = promptBriefHash(prompt);
	lastBriefHash = briefHash;
	const targets = promptTargets(prompt);
	const targetIds = targets.map((target) => target.id);
	// The selected candidate is a full anchored calculator page whose geometry
	// mirrors the e2e implementation (same spacing/type scale), so the UI gate
	// can measure fidelity from the approved artifact.
	const selectedContent = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Sunny Stickers Calculator</title>
<style>
:root { --canvas: #FFF4CC; --surface: #7D5CFF; --text: #202044; --accent: #FF4F81; --action: #27C7FF; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 18px system-ui; color: var(--text); background: linear-gradient(135deg, var(--canvas), var(--accent)); }
.calculator { width: min(92vw, 26rem); padding: 1.5rem; border: 6px solid var(--accent); border-radius: 2rem; background: var(--surface); box-shadow: 0 1rem 0 var(--text); }
header { display: flex; align-items: center; justify-content: space-between; }
#display { display: block; box-sizing: border-box; width: 100%; min-height: 4rem; margin: 1rem 0; padding: .75rem; border: 3px solid var(--text); border-radius: 1rem; background: var(--canvas); font-size: 2rem; text-align: right; }
.keys { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
button { min-width: 44px; min-height: 44px; border: 0; border-radius: 1rem; background: var(--action); color: var(--text); font: inherit; font-weight: 700; }
button:focus-visible { outline: 4px solid var(--accent); outline-offset: 2px; }
@media (max-width: 480px) { .calculator { width: calc(100vw - 2rem); padding: 1rem; border-radius: 1.25rem; } }
</style>
</head>
<body>
<main class="calculator" data-ce-candidate-id="CANDIDATE-2" data-ce-brief-hash="${briefHash}">
<header data-ce-el="title"><h1>My Calculator</h1><button id="theme" type="button" aria-label="Toggle theme">Theme</button></header>
<output id="display" data-ce-el="display" aria-live="polite">0</output>
<div id="keys" class="keys" data-ce-el="keypad">
<button type="button">7</button><button type="button">8</button><button type="button">9</button><button type="button">÷</button>
<button type="button">4</button><button type="button">5</button><button type="button">6</button><button type="button">×</button>
<button type="button">1</button><button type="button">2</button><button type="button">3</button><button type="button">−</button>
<button type="button">0</button><button type="button">C</button><button type="button" data-ce-el="equals control">=</button><button type="button">+</button>
</div>
</main>
</body>
</html>`;
	const candidates = [
		["CANDIDATE-1", "Rainbow Blocks", "#ff4f81", "#27c7ff", null],
		["CANDIDATE-2", "Sunny Stickers", "#ffb800", "#7d5cff", selectedContent],
		["CANDIDATE-3", "Candy Space", "#3cdb8f", "#ff6b35", null],
	].map(([id, title, primary, accent, content]) => {
		const previewArtifact = `candidate-${id.slice(-1)}.html`;
		const body =
			content ??
			`<!doctype html><main data-ce-candidate-id="${id}" data-ce-brief-hash="${briefHash}" style="background:${primary};color:${accent}"><h1>${title} Calculator</h1><output>5</output><button>7</button><button>+</button></main>`;
		projectFiles.set(previewArtifact, body);
		return {
			id,
			title,
			rationale: `A distinct bright kids-like calculator direction.`,
			differentiators: [`Palette ${primary}/${accent}`, `Layout motif`],
			previewArtifact,
			previewFragment: `#candidate=${id}`,
			targets: targetIds,
			artifactHash: crypto.createHash("sha256").update(body).digest("hex"),
		};
	});
	projectFiles.set(
		"candidate-launcher.html",
		"<!doctype html><main id=launcher></main><script>const id=new URL(location).hash.slice(11);document.documentElement.dataset.ceCandidateId=id</script>",
	);
	projectFiles.set(
		"DESIGN-CANDIDATES.json",
		JSON.stringify({
			version: 1,
			briefHash,
			launcherArtifact: "candidate-launcher.html",
			candidates,
		}),
	);
}

function refinementFiles(prompt) {
	const promptedBriefHash = promptBriefHash(prompt);
	const briefHash =
		promptedBriefHash === "a".repeat(64) ? lastBriefHash : promptedBriefHash;
	const targets = promptTargets(prompt);
	const authorityText =
		/Selection authority:\s*(\{[\s\S]*?\})\s*Do not edit/.exec(prompt)?.[1];
	let selection = {};
	try {
		selection = JSON.parse(authorityText ?? "{}");
	} catch {
		selection = {};
	}
	const variants = targets.flatMap((target) =>
		target.requiredViewports.map((viewport) => ({
			id: `VARIANT-${target.id.replace(/^TARGET-/, "")}-${viewport.toUpperCase()}`,
			targetId: target.id,
			viewport,
			previewRoute: `#refined-${viewport}`,
			screenIds: target.requiredScreenIds,
			flowIds: target.requiredFlowIds,
		})),
	);
	const handoff = {
		version: 2,
		targets,
		variants,
		selection,
		identity: {
			id: "DESIGN-CALCULATOR",
			title: "Kids-like bright calculator",
			briefHash,
		},
		direction: {
			summary: "Bright child-oriented calculator with chunky controls.",
			roleColors: [
				{ name: "canvas", value: "#FFF4CC" },
				{ name: "surface", value: "#7D5CFF" },
				{ name: "text", value: "#202044" },
				{ name: "accent", value: "#FF4F81" },
				{ name: "action", value: "#27C7FF" },
			],
			signatureElement: "Bouncy star-shaped equals control",
			intentionalRisk: "Playful shapes require disciplined focus treatment",
		},
		content: { heading: "My Calculator", display: "0" },
		tokens: {
			spacing: [8, 12, 20, 28],
			typeRoles: ["display", "number", "label"],
		},
		screens: [
			{
				id: "SCREEN-CALCULATOR",
				title: "Calculator",
				targetIds: targets.map((target) => target.id),
				variantIds: variants.map((variant) => variant.id),
				states: ["ready", "result", "error"],
				viewports: [
					...new Set(targets.flatMap((target) => target.requiredViewports)),
				],
				requiredRegions: ["title", "display", "keypad", "equals control"],
			},
		],
		flows: [
			{
				id: "FLOW-CALCULATE",
				title: "Calculate",
				steps: ["Enter operands", "Choose operation", "Show result"],
				targetIds: targets.map((target) => target.id),
				variantIds: variants.map((variant) => variant.id),
			},
		],
		components: [
			{
				id: "COMP-KEY",
				name: "Calculator key",
				states: ["default", "focused", "pressed"],
			},
		],
		responsiveRules: [
			"Use four keypad columns without horizontal overflow at mobile and desktop widths",
		],
		interactions: [
			{
				id: "INT-EQUALS",
				trigger: "Activate equals",
				outcome: "Display the calculated result",
			},
		],
		accessibility: [
			"Every key is keyboard reachable with visible focus",
			"The display announces results",
		],
		assets: [],
		implementationConstraints: [
			"Preserve calculator behavior",
			"Do not copy prototype code into production",
		],
		acceptance: [
			{
				id: "DES-1",
				description:
					"The calculator uses the approved bright palette, required regions, signature element, and responsive keypad.",
				screenIds: ["SCREEN-CALCULATOR"],
				targetIds: targets.map((target) => target.id),
				variantIds: variants.map((variant) => variant.id),
				states: ["ready", "result"],
				viewports: [
					...new Set(targets.flatMap((target) => target.requiredViewports)),
				],
				proofs: ["interaction", "visual", "accessibility", "logs"],
			},
		],
		openQuestions: [],
		provenance: {
			source: "OpenDesign fixture",
			generatedAt: "2026-08-31T00:00:00.000Z",
			remoteFingerprint: "fixture",
		},
	};
	projectFiles.set("DESIGN-HANDOFF.json", JSON.stringify(handoff));
	projectFiles.set("DESIGN-HANDOFF.md", "# Kids-like bright calculator\n");
}

function send(message) {
	const text = JSON.stringify(message);
	if (mode === "content-length") {
		process.stdout.write(
			`Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`,
		);
	} else if (mode === "split") {
		const line = `${text}\n`;
		const middle = Math.floor(line.length / 2);
		process.stdout.write(line.slice(0, middle));
		setTimeout(() => process.stdout.write(line.slice(middle)), 5);
	} else {
		process.stdout.write(`${text}\n`);
	}
}

function result(id, value) {
	send({ jsonrpc: "2.0", id, result: value });
}

function toolResult(id, value) {
	result(id, {
		content: [{ type: "text", text: JSON.stringify(value) }],
		structuredContent: value,
	});
}

function toolError(id, value) {
	result(id, {
		content: [{ type: "text", text: JSON.stringify(value) }],
		structuredContent: value,
		isError: true,
	});
}

if (["stderr", "stderr-exit"].includes(mode))
	process.stderr.write(
		"apiKey=sk-super-secret-value token=https://example.test/?token=private\n",
	);
if (mode === "oversized") process.stdout.write(`${"x".repeat(4096)}\n`);

const reader = readline.createInterface({
	input: process.stdin,
	crlfDelay: Infinity,
});
reader.on("line", (line) => {
	let message;
	try {
		message = JSON.parse(line);
	} catch {
		return;
	}
	if (message.id == null) return;
	if (mode === "hang") return;
	if (["exit", "stderr-exit"].includes(mode)) process.exit(3);
	if (mode === "malformed") {
		process.stdout.write("{broken\n");
		return;
	}
	if (message.method === "initialize") {
		result(message.id, {
			protocolVersion: "2025-03-26",
			serverInfo: {
				name: mode === "wrong-identity" ? "octal-dump" : "open-design",
				version: "0.2.0",
			},
			capabilities: { tools: {} },
		});
		return;
	}
	if (message.method === "tools/list") {
		result(message.id, {
			tools: (mode === "missing-tool"
				? tools.filter((name) => name !== "start_run")
				: tools
			).map((name) => ({ name })),
		});
		return;
	}
	if (message.method !== "tools/call") return;
	calls += 1;
	const name = message.params?.name;
	const args = message.params?.arguments ?? {};
	if (
		mode === "tool-error" ||
		(mode === "create-tool-error" && name === "create_project")
	) {
		toolError(message.id, { message: "daemon unavailable token=secret" });
		return;
	}
	const marker = process.env.FAKE_OD_MARKER;
	if (
		marker &&
		((mode === "read-exit-once" && name === "get_run") ||
			(mode === "create-exit-once" && name === "create_project")) &&
		!fs.existsSync(marker)
	) {
		fs.writeFileSync(marker, "attempted");
		process.exit(4);
	}
	if (name === "collect_brief")
		toolResult(message.id, {
			questionForm: {
				questions: [
					{ id: "platform", prompt: "Which platform?" },
					{ id: "scope", prompt: "What scope?" },
					{ id: "fidelity", prompt: "What fidelity?" },
				],
			},
		});
	else if (name === "create_project") {
		if (mode === "design-e2e") {
			fixtureState.activeProject = args.id;
			saveFixtureState();
		}
		toolResult(message.id, {
			project: { id: args.id },
			conversationId: "conversation-1",
		});
	} else if (name === "write_file")
		toolResult(message.id, {
			projectId: args.project,
			path: args.path,
			size: Buffer.from(args.content, args.encoding).length,
		});
	else if (name === "get_project")
		toolResult(message.id, {
			project: {
				id: args.project,
				name: reportedProjectName(),
			},
		});
	else if (name === "start_run") {
		if (mode === "design-e2e") {
			fixtureState.activeProject = args.project;
			fixtureState.runPhase = args.prompt.includes("Candidate delivery contract")
				? "candidates"
				: "refinement";
			fixtureState.activeRun = `${fixtureState.runPhase}-run`;
			if (fixtureState.runPhase === "candidates") candidateFiles(args.prompt);
			else refinementFiles(args.prompt);
			saveFixtureState();
		}
		toolResult(message.id, {
			runId: mode === "design-e2e" ? fixtureState.activeRun : "run-1",
			projectId: args.project,
			requestId: args.requestId,
			resumed: args.resume === true,
		});
	} else if (name === "get_run")
		toolResult(message.id, {
			runId: args.runId,
			projectId: mode === "design-e2e" ? fixtureState.activeProject : undefined,
			status: "succeeded",
			previewUrl:
				mode === "untrusted-urls"
					? "https://example.test/preview?token=super-secret"
					: "https://example.test/preview",
			studioUrl:
				mode === "untrusted-urls"
					? `${"java"}script:alert('unsafe')`
					: "https://example.test/studio",
			agentMessage: mode === "untrusted-urls" ? "Done token=super-secret" : "Done",
		});
	else if (name === "cancel_run")
		toolResult(message.id, { runId: args.runId, canceled: true });
	else if (name === "list_files")
		toolResult(message.id, {
			files:
				mode === "design-e2e"
					? [...projectFiles].map(([name, content]) => ({
							name,
							size: Buffer.byteLength(content),
							mtime: fixtureState.runPhase,
							mime: name.endsWith(".json")
								? "application/json"
								: name.endsWith(".md")
									? "text/markdown"
									: "text/html",
						}))
					: [{ name: "DESIGN-HANDOFF.json", size: 10 }],
		});
	else if (name === "get_file") {
		const content = projectFiles.get(args.path) ?? "";
		if (mode === "design-e2e" && args.path.endsWith(".json")) {
			let parsed;
			try {
				parsed = JSON.parse(content);
			} catch {
				parsed = {};
			}
			toolResult(message.id, parsed);
		} else
			toolResult(message.id, {
				name: args.path,
				projectId: mode === "design-e2e" ? fixtureState.activeProject : undefined,
				runId: mode === "design-e2e" ? fixtureState.activeRun : undefined,
				content:
					mode === "design-e2e"
						? [
								{ type: "text", text: "[od:active-context]" },
								{ type: "text", text: content },
							]
						: "{}",
			});
	} else if (name === "get_artifact") toolResult(message.id, { files: [] });
});
