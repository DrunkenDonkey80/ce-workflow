#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	cpSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { OpenDesignClient } from "../extensions/opendesign-client.js";
import {
	buildWorkResumeState,
	executeOrchestratorAction,
	renderWorkResumeText,
} from "../extensions/work-models.js";
import { runGate } from "./ui-gate/gate.mjs";

const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
for (const name of [
	"prepareDesign" + "Session",
	"approveDesign" + "Session",
	"buildWorkPlan" + "State",
	"callOpenDesign" + "Tool",
])
	assert.doesNotMatch(source, new RegExp(`\\b${name}\\b`));

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const harnessRoot = mkdtempSync(path.join(os.tmpdir(), "ce-redesign-e2e-"));
const workspace = path.join(harnessRoot, "calculator");
const seed = path.join(
	root,
	"benchmarks/workflow-evaluation/v1/projects/calculator/seed",
);
cpSync(seed, workspace, { recursive: true });
mkdirSync(path.join(workspace, ".pi"), { recursive: true });
writeFileSync(
	path.join(workspace, ".pi/settings.json"),
	JSON.stringify({ workOrchestrator: { visualDesignWorkflow: "required" } }),
);

const fixtureStateFile = path.join(harnessRoot, "fake-opendesign-state.json");
function createFake() {
	return new OpenDesignClient(
		{
			command: process.execPath,
			args: [path.join(root, "scripts/fixtures/opendesign/fake-od.mjs")],
			env: {
				FAKE_OD_MODE: "design-e2e",
				FAKE_OD_STATE_FILE: fixtureStateFile,
			},
		},
		{ sandboxCwd: workspace, timeoutMs: 5_000 },
	);
}
let fake = createFake();
async function restartFake() {
	fake.close();
	fake = createFake();
	await fake.connect();
}
const sent = [];
const ctx = {
	cwd: workspace,
	hasUI: false,
	mode: "rpc",
	ui: { notify() {} },
};
const pi = {
	async sendUserMessage(message) {
		sent.push(String(message));
	},
};
const options = {
	callTool: (tool, args) => fake.callTool(tool, args),
	collectBrief: async () => ({ questionForm: { questions: [] } }),
	creativeDepth: "quick",
	designAnswerProvider: async (question) =>
		({
			audience: "Children learning basic arithmetic",
			visualTone: "Bright, playful, friendly, and readable",
			fidelity: "Complete calculator across desktop and mobile",
			devices: "Responsive web: desktop and mobile",
			referenceRelationship: "No external reference",
		})[question.id] ?? "Keep calculator behavior unchanged",
	testOnly: true,
	adapterFingerprint: "fixture",
	testHarnessRoot: harnessRoot,
	designDecisionAuthority: "fixture",
};

function command(name, args, extra = {}) {
	return executeOrchestratorAction(name, args, ctx, pi, "", {
		...options,
		...extra,
	});
}

function readSession(ownerId) {
	try {
		return JSON.parse(
			readFileSync(
				path.join(
					workspace,
					".ce-workflow/work-runs/design-sessions",
					`${ownerId}.json`,
				),
				"utf8",
			),
		);
	} catch (error) {
		throw new Error(`invalid design session fixture for ${ownerId}`, {
			cause: error,
		});
	}
}

try {
	await fake.connect();
	const objective =
		"Create a kids-like calculator design that features bright colors while preserving calculator behavior";
	const redesigned = await command("work-redesign", objective);
	assert.equal(redesigned.ok, true, redesigned.message);
	const initialStore = JSON.parse(
		readFileSync(path.join(workspace, ".ce-workflow/work-items.json"), "utf8"),
	);
	const ownerId = Object.values(initialStore.items).find((item) =>
		item.labels?.includes("wo:design-required"),
	)?.id;
	assert.ok(ownerId, "redesign creates a design-required work item");

	assert.equal(
		(await command("work-design", `prepare ${ownerId}`)).action,
		"design-commission-ready",
	);
	assert.equal(
		(await command("work-design", ownerId)).action,
		"design-run-started",
	);
	await restartFake();
	const candidates = await command("work-design", ownerId);
	assert.equal(
		candidates.action,
		"design-candidate-selection-required",
		candidates.message,
	);
	const candidateSession = readSession(ownerId);
	assert.equal(candidateSession.candidatePreviews.length, 3);
	assert.equal(
		new Set(candidateSession.candidatePreviews.map((candidate) => candidate.url))
			.size,
		3,
	);
	const forgedHumanSelection = await command(
		"work-design",
		`candidates ${ownerId} CANDIDATE-2`,
		{
			designDecisionAuthority: undefined,
			decisionEventId: "forged-human-selection",
		},
	);
	assert.equal(forgedHumanSelection.ok, false);
	assert.equal(forgedHumanSelection.reason, "design-selection-invalid");

	const selected = await command(
		"work-design",
		`candidates ${ownerId} CANDIDATE-2`,
		{ decisionEventId: "fixture-selection" },
	);
	assert.equal(selected.action, "design-refinement-started", selected.message);
	const replayedSelection = await command(
		"work-design",
		`candidates ${ownerId} CANDIDATE-2`,
		{ decisionEventId: "fixture-selection" },
	);
	assert.equal(replayedSelection.action, "design-selection-current");
	await restartFake();
	await command("work-design", ownerId);
	assert.equal(readSession(ownerId).state, "review_ready");
	const synchronized = await command("work-design", `sync ${ownerId}`);
	assert.equal(
		readSession(ownerId).state,
		"approval_required",
		`${synchronized.message}\n${JSON.stringify(readSession(ownerId), null, 2)}`,
	);
	await assert.rejects(
		() =>
			command("work-design", `approve ${ownerId}`, {
				designDecisionAuthority: undefined,
				decisionEventId: "forged-human-approval",
			}),
		/cannot create human decisions/,
	);
	const approvalNote = "Approved Sunny Sticker revision for implementation";
	const approved = await command(
		"work-design",
		`approve ${ownerId} ${approvalNote}`,
		{ decisionEventId: "fixture-approval" },
	);
	assert.equal(
		approved.action,
		"design-approved-materialized",
		approved.message,
	);
	const replayedApproval = await command("work-design", `approve ${ownerId}`, {
		decisionEventId: "fixture-approval",
	});
	assert.equal(replayedApproval.action, "design-approval-current");
	const session = readSession(ownerId);
	assert.equal(session.state, "approved");
	assert.equal(session.selectionAuthority, "fixture");
	assert.equal(
		JSON.parse(readFileSync(path.join(workspace, session.approvalPath), "utf8"))
			.notes,
		approvalNote,
	);
	const store = JSON.parse(
		readFileSync(path.join(workspace, ".ce-workflow/work-items.json"), "utf8"),
	);
	const implementation = Object.values(store.items).find((item) =>
		item.labels?.includes("wo:design-implementation"),
	);
	assert.ok(implementation, "approval materializes an implementation work item");
	assert.ok(implementation.labels.includes("wo:test-only"));
	const resumeState = buildWorkResumeState(workspace, ownerId);
	assert.notEqual(resumeState.action, "design-resume-required");
	assert.doesNotThrow(() => renderWorkResumeText(resumeState));
	assert.match(
		renderWorkResumeText({
			ok: true,
			action: "design-resume-required",
			message: "Visual design is waiting.",
			suggestedCommands: [`/wo design ${ownerId}`],
		}),
		/Action: design-resume-required/,
	);
	for (const value of [
		session.briefHash,
		session.candidateManifestHash,
		session.selectionHash,
		session.handoffHash,
		session.approvalHash,
		session.approvalPath,
		session.pendingContinuation.key,
	])
		assert.ok(
			implementation.description.includes(value),
			`implementation authority includes ${value}`,
		);

	const plan = await command("work-plan", `${ownerId} new`);
	assert.equal(plan.action, "handoff-plan", plan.message);
	assert.ok(
		sent.some(
			(prompt) =>
				prompt.includes("Approved design authority") &&
				prompt.includes(session.selectionHash),
		),
		"the public planning handoff receives the exact approved authority",
	);
	const copiedRoot = mkdtempSync(path.join(os.tmpdir(), "ce-redesign-copied-"));
	try {
		cpSync(workspace, copiedRoot, { recursive: true });
		const copied = await executeOrchestratorAction(
			"work-plan",
			`${ownerId} new`,
			{ ...ctx, cwd: copiedRoot },
			pi,
		);
		assert.equal(copied.action, "design-planning-blocked");
	} finally {
		rmSync(copiedRoot, { recursive: true, force: true });
	}

	// Deterministic worker fixture: implement from the approved semantic handoff, never by copying prototype code.
	const handoff = JSON.parse(
		readFileSync(path.join(workspace, session.handoffPath), "utf8"),
	);
	const colors = Object.fromEntries(
		handoff.direction.roleColors.map(({ name, value }) => [name, value]),
	);
	const css = `:root { --canvas: ${colors.canvas}; --surface: ${colors.surface}; --text: ${colors.text}; --accent: ${colors.accent}; --action: ${colors.action}; }\n* { box-sizing: border-box; }\nbody { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 18px system-ui; color: var(--text); background: linear-gradient(135deg, var(--canvas), var(--accent)); }\n.calculator { width: min(92vw, 26rem); padding: 1.5rem; border: 6px solid var(--accent); border-radius: 2rem; background: var(--surface); box-shadow: 0 1rem 0 var(--text); }\nheader { display: flex; align-items: center; justify-content: space-between; }\n#display { display: block; box-sizing: border-box; width: 100%; min-height: 4rem; margin: 1rem 0; padding: .75rem; border: 3px solid var(--text); border-radius: 1rem; background: var(--canvas); font-size: 2rem; text-align: right; }\n.keys { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }\nbutton { min-width: 44px; min-height: 44px; border: 0; border-radius: 1rem; background: var(--action); color: var(--text); font: inherit; font-weight: 700; }\nbutton:focus-visible { outline: 4px solid var(--accent); outline-offset: 2px; }\n@media (max-width: 480px) { .calculator { width: calc(100vw - 2rem); padding: 1rem; border-radius: 1.25rem; } }\n@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }\n`;
	writeFileSync(path.join(workspace, "styles.css"), css);
	const appPath = path.join(workspace, "app.js");
	writeFileSync(
		appPath,
		`export function calculate(left, operator, right) {\n  if (operator === "+") return left + right;\n  if (operator === "−") return left - right;\n  if (operator === "×") return left * right;\n  if (operator === "÷") return right === 0 ? "Error" : left / right;\n  return right;\n}\nif (typeof document !== "undefined") {\n  const display = document.querySelector("#display");\n  let left = 0, operator = "+", entry = "";\n  const keys = ["7","8","9","÷","4","5","6","×","1","2","3","−","0","C","=","+"];\n  for (const value of keys) {\n    const button = document.createElement("button");\n    button.type = "button"; button.textContent = value; button.setAttribute("aria-label", value);
    if (value === "=") button.setAttribute("data-ce-el", "equals control");\n    button.onclick = () => {\n      if (/\\d/.test(value)) entry += value;\n      else if (value === "C") { left = 0; operator = "+"; entry = ""; }\n      else if (value === "=") { entry = String(calculate(left, operator, Number(entry || 0))); localStorage.setItem("result", entry); }\n      else { left = Number(entry || 0); operator = value; entry = ""; }\n      display.value = entry || "0";\n    };\n    document.querySelector("#keys").append(button);\n  }\n  document.querySelector("#theme").onclick = () => {\n    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";\n    document.documentElement.dataset.theme = theme; localStorage.setItem("theme", theme);\n  };\n}\n`,
	);
	const indexPath = path.join(workspace, "index.html");
	writeFileSync(
		indexPath,
		readFileSync(indexPath, "utf8")
			.replace(
				'<main class="calculator"',
				`<main class="calculator" data-design-candidate="${session.selectedCandidateId}" data-design-criteria="${handoff.acceptance.map((item) => item.id).join(" ")}"`,
			)
			.replace("<header>", '<header data-ce-el="title">')
			.replace("<h1>Calculator</h1>", "<h1>My Calculator</h1>")
			.replace('<output id="display"', '<output id="display" data-ce-el="display"')
			.replace(
				'<div id="keys" class="keys"></div>',
				'<div id="keys" class="keys" data-ce-el="keypad"></div>',
			),
	);

	const implementationText = `${readFileSync(indexPath, "utf8")}\n${readFileSync(path.join(workspace, "styles.css"), "utf8")}`;
	assert.match(implementationText, /data-design-candidate="CANDIDATE-2"/);
	for (const color of Object.values(colors))
		assert.ok(implementationText.includes(color));
	for (const criterion of handoff.acceptance)
		assert.ok(implementationText.includes(criterion.id));
	assert.match(implementationText, /@media \(max-width: 480px\)/);
	assert.match(implementationText, /focus-visible/);
	assert.doesNotMatch(implementationText, /#6c5ce7|#00b894/);
	assert.match(readFileSync(appPath, "utf8"), /localStorage/);
	const runtime = await import(
		`${pathToFileURL(appPath).href}?e2e=${Date.now()}`
	);
	assert.equal(runtime.calculate(2, "+", 3), 5);
	assert.equal(runtime.calculate(9, "÷", 0), "Error");

	// Measured UI gate: approved OD candidate (spec) vs implemented page.
	const fixtureFiles = JSON.parse(readFileSync(fixtureStateFile, "utf8")).files;
	const specPath = path.join(
		workspace,
		".ce-workflow/evidence/redesign-e2e/spec-candidate-2.html",
	);
	mkdirSync(path.dirname(specPath), { recursive: true });
	writeFileSync(specPath, fixtureFiles["candidate-2.html"]);
	const gateOut = path.join(
		workspace,
		".ce-workflow/evidence/redesign-e2e/ui-gate",
	);
	const gate = await runGate({
		actual: indexPath,
		spec: specPath,
		viewports: ["desktop", "mobile"],
		out: gateOut,
		handoffFile: path.join(workspace, session.handoffPath),
	});
	assert.equal(
		gate.errors,
		0,
		`ui gate must be clean: ${JSON.stringify(gate.byRule)}`,
	);
	const gateReport = JSON.parse(
		readFileSync(path.join(gateOut, "findings.json"), "utf8"),
	);
	assert.ok(
		gateReport.evidence.geometryDeltas.every((delta) => delta <= 0.15),
		"measured geometry deltas within the 15% contract tolerance",
	);
	assert.ok(
		gateReport.evidence.typographyDeltas.every((delta) => delta <= 0.15),
		"measured typography deltas within the 15% contract tolerance",
	);
	for (const flag of [
		"reflow",
		"noHorizontalOverflow",
		"visibleFocus",
		"contrast",
	])
		assert.equal(
			gateReport.evidence.responsive[flag],
			true,
			`${flag} measured true`,
		);
	assert.ok(
		["title", "display", "keypad", "equals control"].every((region) =>
			gateReport.evidence.regions.includes(region),
		),
		"ui gate verifies all required regions",
	);

	const evidence = path.join(workspace, ".ce-workflow/evidence/redesign-e2e");
	mkdirSync(evidence, { recursive: true });
	const sourceHash = createHash("sha256")
		.update(implementationText)
		.update(readFileSync(appPath))
		.digest("hex");
	const report = {
		version: 1,
		kind: "fixture-controller-proof",
		objective,
		ownerId,
		selectedCandidateId: session.selectedCandidateId,
		authority: {
			briefHash: session.briefHash,
			manifestHash: session.candidateManifestHash,
			selectionHash: session.selectionHash,
			handoffHash: session.handoffHash,
			approvalHash: session.approvalHash,
		},
		matrix: handoff.variants.map((variant) => ({
			variantId: variant.id,
			viewport: variant.viewport,
			implemented:
				(variant.viewport === "desktop" &&
					implementationText.includes("width: min(92vw, 26rem)")) ||
				(variant.viewport === "mobile" && implementationText.includes("@media")),
		})),
		criteria: handoff.acceptance.map((criterion) => ({
			id: criterion.id,
			implemented: implementationText.includes(criterion.id),
		})),
		sourceHash,
		visualEvidence: false,
		uiGate: {
			ok: gate.ok,
			errors: gate.errors,
			warnings: gate.warnings,
			regions: gateReport.evidence.regions,
			measuredBy: "web-chromium",
			vlmCalls: 0,
		},
	};
	writeFileSync(
		path.join(evidence, "fixture-controller-report.json"),
		JSON.stringify(report, null, 2),
	);
	assert.equal(
		report.matrix.every((cell) => cell.implemented),
		true,
	);
	assert.equal(
		report.criteria.every((criterion) => criterion.implemented),
		true,
	);
	assert.equal(report.visualEvidence, false);
	process.stdout.write(
		"ok - calculator redesign selection-to-implementation e2e\n",
	);
} finally {
	fake.close();
	rmSync(harnessRoot, { recursive: true, force: true });
}
