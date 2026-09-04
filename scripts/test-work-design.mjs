import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	canonicalDesignJson,
	consumeDesignRepairAttempt,
	copyDesignReferenceAsset,
	createDesignApproval,
	createDesignFidelityContract,
	createDesignSession,
	createTextFallbackHandoff,
	designApprovalIsCurrent,
	designFidelityStatus,
	designLifecycleTelemetry,
	designLineageNotes,
	hashDesignValue,
	loadDesignSession,
	normalizeRemoteFingerprint,
	renderDesignBrief,
	renderDesignRepairPrompt,
	resolveDesignArtifactPath,
	saveDesignSession,
	transitionDesignSession,
	validateDesignArtifactRelativePath,
	validateDesignHandoff,
	writeConfinedDesignArtifact,
} from "../extensions/work-design.js";
import { openDesignPayloadDigest } from "../extensions/opendesign-client.js";
import {
	advanceDesignSession,
	answerDesignClarification,
	approveDesignSession,
	buildWorkBrainstormState,
	buildWorkPlanState,
	buildWorkRedesignState,
	buildWorkResumeState,
	collectRedesignDiscovery,
	detectDesignTargetMatrix,
	extractDesignReferencePaths,
	inferUiDesignInput,
	prepareDesignSession,
	designPlanningAuthority,
	restartDesignSession,
	reviewDesignSession,
	reviseDesignSession,
	selectDesignCandidate,
	substantialUiWork,
	syncDesignSession,
	waiveDesignSession,
} from "../extensions/work-models.js";
import { loadStore } from "../extensions/work-store.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ce-work-design-"));
function fixture(name) {
	try {
		return JSON.parse(
			fs.readFileSync(
				new URL(`./fixtures/opendesign/${name}`, import.meta.url),
				"utf8",
			),
		);
	} catch (error) {
		throw new Error(`invalid design fixture ${name}`, { cause: error });
	}
}
const valid = fixture("handoff-valid.json");
const invalid = fixture("handoff-invalid.json");
const rejects = (fn, pattern) => assert.throws(fn, pattern);

try {
	const validated = validateDesignHandoff(
		{ ...valid, ignored: "not automation authority" },
		{ briefHash: "a".repeat(64) },
	);
	assert.equal(validated.identity.id, "DESIGN-DEMO");
	assert.equal(validated.openQuestions.length, 0);
	assert.equal(
		validated.ignored,
		undefined,
		"unknown top-level fields are excluded from automation authority",
	);
	rejects(() => validateDesignHandoff(invalid), /design-contract/);
	rejects(
		() => validateDesignHandoff({ ...valid, openQuestions: ["unsettled"] }),
		/openQuestions must be empty/,
	);
	rejects(
		() => validateDesignHandoff(valid, { briefHash: "b".repeat(64) }),
		/brief hash mismatch/,
	);
	rejects(
		() =>
			validateDesignHandoff({
				...valid,
				direction: {
					...valid.direction,
					roleColors: valid.direction.roleColors.slice(0, 3),
				},
			}),
		/roleColors/,
	);
	rejects(
		() =>
			validateDesignHandoff({
				...valid,
				screens: [...valid.screens, valid.screens[0]],
			}),
		/duplicate/,
	);
	const v2TargetMatrix = [
		{
			id: "TARGET-DESKTOP",
			platform: "desktop",
			requiredViewports: ["desktop"],
			evidence: ["user answer"],
			requiredScreenIds: ["SCREEN-HOME"],
			requiredFlowIds: ["FLOW-RECOVER"],
		},
		{
			id: "TARGET-ANDROID",
			platform: "android",
			requiredViewports: ["mobile"],
			evidence: ["user answer"],
			requiredScreenIds: ["SCREEN-HOME"],
			requiredFlowIds: ["FLOW-RECOVER"],
		},
	];
	const v2 = {
		...valid,
		version: 2,
		targets: v2TargetMatrix,
		variants: [
			{
				id: "VARIANT-DESKTOP",
				targetId: "TARGET-DESKTOP",
				viewport: "desktop",
				screenIds: ["SCREEN-HOME"],
				flowIds: ["FLOW-RECOVER"],
				previewRoute: "/desktop",
			},
			{
				id: "VARIANT-ANDROID",
				targetId: "TARGET-ANDROID",
				viewport: "mobile",
				screenIds: ["SCREEN-HOME"],
				flowIds: ["FLOW-RECOVER"],
				previewRoute: "/android",
			},
		],
		screens: valid.screens.map((screen) => ({
			...screen,
			targetIds: ["TARGET-DESKTOP", "TARGET-ANDROID"],
			variantIds: ["VARIANT-DESKTOP", "VARIANT-ANDROID"],
		})),
		flows: valid.flows.map((flow) => ({
			...flow,
			targetIds: ["TARGET-DESKTOP", "TARGET-ANDROID"],
			variantIds: ["VARIANT-DESKTOP", "VARIANT-ANDROID"],
		})),
		acceptance: valid.acceptance.map((criterion) => ({
			...criterion,
			targetIds: ["TARGET-DESKTOP", "TARGET-ANDROID"],
			variantIds: ["VARIANT-DESKTOP", "VARIANT-ANDROID"],
		})),
	};
	assert.equal(
		validateDesignHandoff(v2, {
			briefHash: "a".repeat(64),
			targetMatrix: v2TargetMatrix,
		}).version,
		2,
	);
	rejects(
		() => validateDesignHandoff(valid, { targetMatrix: v2TargetMatrix }),
		/require handoff version 2/,
	);
	rejects(
		() => validateDesignHandoff(v2, { targetMatrix: [v2TargetMatrix[0]] }),
		/not present in the authoritative matrix/,
	);
	rejects(
		() =>
			validateDesignHandoff(
				{
					...v2,
					variants: v2.variants.filter(
						(variant) => variant.targetId !== "TARGET-ANDROID",
					),
				},
				{ targetMatrix: v2TargetMatrix },
			),
		/missing TARGET-ANDROID\/mobile variant/,
	);

	const reordered = Object.fromEntries(
		Object.entries(valid).sort(([a], [b]) => b.localeCompare(a)),
	);
	assert.equal(
		hashDesignValue(valid),
		hashDesignValue(reordered),
		"hash is independent of object key order",
	);
	assert.equal(canonicalDesignJson(valid), canonicalDesignJson(reordered));

	const fidelity = createDesignFidelityContract({
		authority: {
			handoffHash: "b".repeat(64),
			approvalHash: "c".repeat(64),
			criteria: validated.acceptance,
		},
		criteriaIds: ["DES-1"],
		strict: true,
		verificationContract: {
			version: 1,
			required: [
				{
					id: "browser-template",
					capability: "browser",
					proof: "visual",
					source: "repository browser runner",
					operation: {
						command: "node scripts/browser-proof.mjs",
						timeoutMs: 60_000,
						expectedExit: 0,
						assertions: [{ target: "stdout", operator: "includes", value: "PASS" }],
					},
				},
			],
		},
	});
	assert.equal(fidelity.ok, true);
	assert.equal(fidelity.contract.required.length, 5);
	assert.equal(fidelity.manifest.length, 40);
	assert(
		fidelity.contract.required
			.filter((entry) => entry.capability === "browser")
			.every(
				(entry) =>
					entry.operation.command === "node scripts/browser-proof.mjs" &&
					entry.fidelity.handoffHash === "b".repeat(64) &&
					entry.instructions.includes("pixel equality is not required"),
			),
		"derived browser proof copies the declared operation and binds semantic cells to the approved handoff",
	);
	const staleProof = fidelity.contract.required[0].id;
	const fidelityStatus = designFidelityStatus(
		{ verificationContract: fidelity.contract },
		{ stale: [staleProof], missing: [], blocked: [], untrusted: [], waived: [] },
	);
	assert.equal(fidelityStatus.ok, false);
	assert(
		fidelityStatus.missingCells.every(
			(cell) => cell.proofId === staleProof && cell.status === "stale",
		),
		"fidelity status retains every stale matrix cell and its proof id",
	);
	const privateTelemetry = designLifecycleTelemetry(
		{
			state: "failed",
			policy: "required",
			revision: 3,
			repairAttempts: 1,
			createdAt: "2026-08-31T00:00:00.000Z",
			updatedAt: "2026-08-31T00:00:02.000Z",
			projectId: "must-not-be-recorded",
			previewUrl: "https://example.test/?token=secret",
			feedback: "private prompt content",
		},
		{ criteria: 4, proofs: 8, failureCategory: "protocol" },
	);
	assert.deepEqual(
		privateTelemetry,
		{
			version: 1,
			eligible: true,
			policy: "required",
			availability: "available",
			phase: "failed",
			durationMs: 2_000,
			revision: 3,
			counts: {
				clarifications: 0,
				repairs: 1,
				syncs: 0,
				stale: 0,
				criteria: 4,
				proofs: 8,
			},
			fallback: false,
			approvalDurationMs: undefined,
			cancellationCategory: undefined,
			failureCategory: "protocol",
		},
		"design telemetry is a bounded operational whitelist",
	);
	assert.doesNotMatch(
		JSON.stringify(privateTelemetry),
		/secret|prompt content|projectId|previewUrl/,
	);

	assert.equal(
		createDesignFidelityContract({
			authority: {
				handoffHash: "b".repeat(64),
				approvalHash: "c".repeat(64),
				criteria: validated.acceptance,
			},
			criteriaIds: ["DES-1"],
			verificationContract: { version: 1, required: [] },
		}).blocker.code,
		"browser-runner-unavailable",
		"missing browser command becomes a typed blocker",
	);
	const oversizedCriteria = Array.from({ length: 33 }, (_, index) => ({
		id: `DES-${index + 1}`,
		screenIds: ["screen"],
		states: ["default"],
		viewports: [`viewport-${index}`],
		proofs: ["screenshot"],
	}));
	assert.equal(
		createDesignFidelityContract({
			authority: {
				handoffHash: "b".repeat(64),
				approvalHash: "c".repeat(64),
				criteria: oversizedCriteria,
			},
			criteriaIds: oversizedCriteria.map((criterion) => criterion.id),
			verificationContract: {
				version: 1,
				required: [
					{
						id: "browser",
						capability: "browser",
						operation: { command: "node browser-check.mjs" },
					},
				],
			},
		}).blocker.code,
		"design-fidelity-manifest-too-large",
		"lossless fidelity grouping fails closed rather than dropping cells",
	);

	let session = createDesignSession({
		ownerId: "work-7",
		policy: "auto",
		state: "brief_required",
		now: "2026-08-31T00:00:00.000Z",
	});
	session = transitionDesignSession(
		session,
		"commission_ready",
		{ briefHash: "a".repeat(64) },
		"2026-08-31T00:01:00.000Z",
	);
	rejects(
		() => transitionDesignSession(session, "completed"),
		/illegal transition/,
	);
	saveDesignSession(root, session);
	assert.deepEqual(
		loadDesignSession(root, "work-7"),
		session,
		"atomic runtime state survives restart",
	);

	const repaired = consumeDesignRepairAttempt(session);
	assert.equal(repaired.repairAttempts, 1);
	rejects(() => consumeDesignRepairAttempt(repaired), /already consumed/);

	const fingerprint = normalizeRemoteFingerprint([
		{ name: "DESIGN-HANDOFF.json", size: 20, modifiedAt: "2" },
		{ name: "DESIGN-HANDOFF.md", size: 10, modifiedAt: "1" },
	]);
	assert.equal(
		fingerprint,
		normalizeRemoteFingerprint([
			{ name: "DESIGN-HANDOFF.md", size: 10, modifiedAt: "1" },
			{ name: "DESIGN-HANDOFF.json", size: 20, modifiedAt: "2" },
		]),
	);

	const current = {
		ownerId: "work-7",
		briefHash: "a".repeat(64),
		handoffHash: "b".repeat(64),
		remoteFingerprint: fingerprint,
		revision: 2,
	};
	const approval = createDesignApproval({
		...current,
		notes: "Approved after review",
		decidedAt: "2026-08-31T00:02:00.000Z",
	});
	assert.equal(designApprovalIsCurrent(approval, current), true);
	for (const [key, value] of [
		["ownerId", "other"],
		["briefHash", "c".repeat(64)],
		["handoffHash", "d".repeat(64)],
		["remoteFingerprint", "e".repeat(64)],
		["revision", 3],
	]) {
		assert.equal(
			designApprovalIsCurrent(approval, { ...current, [key]: value }),
			false,
			`${key} invalidates approval`,
		);
	}

	assert.equal(
		validateDesignArtifactRelativePath("DESIGN-HANDOFF.json"),
		"DESIGN-HANDOFF.json",
	);
	assert.equal(
		validateDesignArtifactRelativePath("reference/a.webp", { allowImages: true }),
		"reference/a.webp",
	);
	for (const bad of [
		"../escape.json",
		"C:/escape.json",
		"prototype.js",
		"CON.json",
		"reference/a.png",
	]) {
		rejects(() => validateDesignArtifactRelativePath(bad), /design-contract/);
	}
	fs.mkdirSync(path.join(root, "artifacts"));
	fs.mkdirSync(path.join(root, "artifacts", "directory.json"));
	rejects(
		() =>
			resolveDesignArtifactPath(path.join(root, "artifacts"), "directory.json"),
		/regular file/,
	);
	const target = path.join(root, "target.json");
	fs.writeFileSync(target, "{}");
	try {
		fs.symlinkSync(target, path.join(root, "artifacts", "link.json"));
		rejects(
			() => resolveDesignArtifactPath(path.join(root, "artifacts"), "link.json"),
			/symlink|regular file/,
		);
		const outside = path.join(root, "outside");
		fs.mkdirSync(outside);
		fs.writeFileSync(path.join(outside, "nested.json"), "{}");
		fs.symlinkSync(
			outside,
			path.join(root, "artifacts", "linked-directory"),
			process.platform === "win32" ? "junction" : "dir",
		);
		rejects(
			() =>
				resolveDesignArtifactPath(
					path.join(root, "artifacts"),
					"linked-directory/nested.json",
				),
			/symlink/,
		);
	} catch (error) {
		if (!["EPERM", "EACCES"].includes(error?.code)) throw error;
	}

	const confined = path.join(root, "docs", "designs", "confined");
	writeConfinedDesignArtifact(confined, "DESIGN-HANDOFF.md", "# Safe\n");
	assert.equal(
		fs.readFileSync(path.join(confined, "DESIGN-HANDOFF.md"), "utf8"),
		"# Safe\n",
	);
	rejects(
		() => writeConfinedDesignArtifact(confined, "prototype.js", "alert(1)"),
		/artifact type/,
	);
	fs.mkdirSync(path.join(root, "assets"), { recursive: true });
	fs.writeFileSync(
		path.join(root, "assets", "licensed.png"),
		Buffer.from([1, 2, 3]),
	);
	const copied = copyDesignReferenceAsset(root, "docs/designs/confined", {
		sourceKind: "repository-local",
		sourcePath: "assets/licensed.png",
		license: "MIT",
	});
	assert.equal(fs.readFileSync(copied).length, 3);
	for (const input of [
		{ sourceKind: "remote", sourcePath: "assets/licensed.png", license: "MIT" },
		{
			sourceKind: "repository-local",
			sourcePath: "assets/licensed.png",
			license: "unknown",
		},
	])
		rejects(
			() => copyDesignReferenceAsset(root, "docs/designs/confined", input),
			/design-contract/,
		);

	const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ce-ui-targets-"));
	fs.mkdirSync(path.join(targetRoot, "ui"), { recursive: true });
	fs.mkdirSync(path.join(targetRoot, "rules"), { recursive: true });
	fs.writeFileSync(
		path.join(targetRoot, "ui", "build.gradle.kts"),
		'kotlin { androidTarget(); jvm("desktop") }\ncompose.desktop { application {} }\n',
	);
	fs.writeFileSync(
		path.join(targetRoot, "rules", "build.gradle.kts"),
		"kotlin { js(IR) { nodejs() } }\n",
	);
	execFileSync("git", ["init", "-q"], { cwd: targetRoot });
	execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: targetRoot });
	execFileSync("git", ["add", "."], { cwd: targetRoot });
	assert.deepEqual(
		detectDesignTargetMatrix(targetRoot).map((target) => target.id),
		["TARGET-ANDROID", "TARGET-DESKTOP"],
		"a headless Kotlin/JS rules module is not a shipped web UI target",
	);
	fs.rmSync(targetRoot, { recursive: true, force: true });

	const promptRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ce-ui-prompt-"));
	const promptReference = path.join(promptRoot, "clipboard-reference.png");
	const promptReferenceBytes = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
		"base64",
	);
	fs.writeFileSync(promptReference, promptReferenceBytes);
	const userPrompt = `I want a game not app/website design and the main playthrough to look similar but not exact copy to ${promptReference}`;
	assert.deepEqual(extractDesignReferencePaths(userPrompt), [promptReference]);
	assert.deepEqual(inferUiDesignInput(userPrompt), {
		objective: userPrompt,
		projectType: "game",
		primaryExperience:
			"main playthrough to look similar but not exact copy to " + promptReference,
		referenceRelationship: "principles-not-copy",
		referencePaths: [promptReference],
		explicitUiDirection: userPrompt,
	});
	assert.deepEqual(
		detectDesignTargetMatrix(promptRoot, "desktop and mobile").map(
			(target) => target.id,
		),
		["TARGET-DESKTOP", "TARGET-ANDROID"],
	);
	const discoveryAnswers = {
		audience: "Adult Belot players on home computers and phones",
		devices: "desktop and mobile",
		visualTone: "Immersive, warm, tactile, and competitive",
		referenceBorrow:
			"immersive central playfield, at-a-glance turn context, spatialized players, restrained chrome",
		fidelity: "full primary flow",
		accessibility: "standard baseline",
	};
	const discovery = await collectRedesignDiscovery(
		{ cwd: promptRoot },
		userPrompt,
		{
			designAnswerProvider: async (question) => discoveryAnswers[question.id],
			collectBrief: async () => ({
				questionForm: {
					questions: [{ id: "platform" }, { id: "scope" }, { id: "fidelity" }],
				},
			}),
		},
	);
	assert.deepEqual(
		discovery.asked.map((answer) => answer.id),
		[
			"audience",
			"devices",
			"visualTone",
			"referenceBorrow",
			"fidelity",
			"accessibility",
		],
		"the prompt settles game form, primary experience, and non-copy intent; only unresolved UI questions are asked",
	);
	assert.deepEqual(
		discovery.openDesignBriefQuestions.map((question) => question.id),
		["platform", "scope", "fidelity"],
	);
	const promptRedesign = buildWorkRedesignState(promptRoot, userPrompt, {
		policy: "required",
		uiInput: discovery.intake,
		designAnswers: discovery.answers,
		designAnswerRecords: discovery.asked,
		targetMatrix: discovery.targetMatrix,
		openDesignBriefQuestions: discovery.openDesignBriefQuestions,
		creativeDepth: "wide",
	});
	assert.equal(promptRedesign.ok, true);
	assert.equal(promptRedesign.designSession.projectType, "game");
	assert.equal(promptRedesign.designSession.references.length, 1);
	assert.ok(
		promptRedesign.designSession.designAnswerRecords.every(
			(record) => record.source === "test",
		),
		"deterministic test answers retain test provenance",
	);
	assert.match(promptRedesign.handoffPrompt, /UI design input|UI-DESIGN-INPUT/);
	assert.match(
		promptRedesign.handoffPrompt,
		/exactly one subagent workflowScript/,
	);
	const durableReference = path.join(
		promptRoot,
		...promptRedesign.designSession.references[0].localPath.split("/"),
	);
	fs.rmSync(promptReference);
	assert.deepEqual(fs.readFileSync(durableReference), promptReferenceBytes);
	const promptPrepared = prepareDesignSession(
		promptRoot,
		promptRedesign.epic.id,
		{
			selectedDirection: "Immersive playfield with tactical clarity",
		},
	);
	assert.equal(promptPrepared.designSession.targetMatrix.length, 2);
	assert.match(
		fs.readFileSync(
			path.join(promptRoot, ...promptPrepared.designSession.briefPath.split("/")),
			"utf8",
		),
		/audience \[test\]: Adult Belot players/,
	);
	const promptCalls = [];
	const promptStarted = await advanceDesignSession(
		promptRoot,
		promptRedesign.epic.id,
		{
			reconcileProject: async ({ projectId }) => ({ project: { id: projectId } }),
			callTool: async (tool, args) => {
				promptCalls.push({ tool, args });
				if (tool === "write_file") return { path: args.path };
				if (tool === "start_run") return { runId: "prompt-run" };
				throw new Error(`unexpected prompt tool ${tool}`);
			},
		},
	);
	assert.equal(promptStarted.action, "design-run-started");
	assert.deepEqual(
		promptCalls.map((call) => call.tool),
		["write_file", "start_run"],
	);
	assert.deepEqual(
		Buffer.from(promptCalls[0].args.content, "base64"),
		promptReferenceBytes,
	);
	assert.match(promptCalls[1].args.prompt, /Project form: game/);
	assert.match(promptCalls[1].args.prompt, /TARGET-DESKTOP/);
	assert.match(promptCalls[1].args.prompt, /TARGET-ANDROID/);
	assert.match(promptCalls[1].args.prompt, /immersive central playfield/);
	assert.match(promptCalls[1].args.prompt, /exact composition, branded artwork/);
	assert.match(promptCalls[1].args.prompt, /DESIGN-CANDIDATES\.json v1/);
	fs.rmSync(promptRoot, { recursive: true, force: true });

	assert.equal(
		renderDesignRepairPrompt(["z error", "a error"]),
		renderDesignRepairPrompt(["a error", "z error"]),
		"repair prompt is deterministic",
	);
	const repairPrompt = renderDesignRepairPrompt(["invalid"], {
		briefHash: "a".repeat(64),
		targetMatrix: [
			{
				id: "TARGET-MOBILE",
				platform: "web",
				requiredViewports: ["mobile"],
			},
		],
		selection: {
			candidateManifestHash: "b".repeat(64),
			candidateId: "CANDIDATE-A",
			candidateArtifactHash: "c".repeat(64),
		},
	});
	assert.match(repairPrompt, /DESIGN-HANDOFF\.json v2/);
	assert.match(
		repairPrompt,
		/Required top-level keys: version, targets, variants/,
	);
	assert.match(repairPrompt, /Never list \.html in assets/);
	assert.match(repairPrompt, /omit remoteFingerprint/);
	assert.match(repairPrompt, /Authoritative targets:[\s\S]*TARGET-MOBILE/);
	assert.match(repairPrompt, /Authoritative selection:[\s\S]*CANDIDATE-A/);

	const fallback = createTextFallbackHandoff({
		briefHash: "a".repeat(64),
		summary: "Text-only direction",
		roleColors: valid.direction.roleColors,
		screens: valid.screens,
		flows: valid.flows,
		components: valid.components,
		responsiveRules: valid.responsiveRules,
		interactions: valid.interactions,
		accessibility: valid.accessibility,
		acceptance: valid.acceptance,
		implementationConstraints: ["Reuse repository components"],
		generatedAt: "2026-08-31T00:00:00.000Z",
	});
	assert.match(fallback.implementationConstraints.at(-1), /Text fallback/);

	assert.match(
		renderDesignBrief({
			title: "Demo",
			objective: "Improve recovery",
			actorsAndFlows: ["Operator recovers"],
			statesAndContent: ["Loading and error"],
			constraints: ["Keyboard access"],
		}),
		/Improve recovery/,
	);
	assert.ok(
		designLineageNotes({
			designDirectory: "docs/designs/demo",
			handoffHash: "b".repeat(64),
			state: "approved",
		}).every((note) => note.startsWith("wo:design ")),
	);

	assert.equal(substantialUiWork("Update a server timeout"), false);
	assert.equal(
		substantialUiWork(
			"Redesign the account settings interface and every recovery screen",
		),
		true,
	);
	const lifecycleRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "ce-work-design-flow-"),
	);
	try {
		execFileSync("git", ["init"], { cwd: lifecycleRoot, stdio: "ignore" });
		fs.mkdirSync(path.join(lifecycleRoot, ".pi"), { recursive: true });
		fs.writeFileSync(
			path.join(lifecycleRoot, ".pi", "settings.json"),
			JSON.stringify({ workOrchestrator: { visualDesignWorkflow: "auto" } }),
		);
		const brainstorm = buildWorkBrainstormState(
			lifecycleRoot,
			"new Redesign the account settings interface with responsive recovery screens",
			{ policy: "auto", now: new Date("2026-08-31T00:00:00.000Z") },
		);
		assert.equal(brainstorm.designSession.state, "audit_required");
		prepareDesignSession(lifecycleRoot, brainstorm.idea.id, {
			selectedDirection: "Focused account recovery",
		});
		const brainstormPath = "docs/brainstorms/account-recovery.md";
		fs.mkdirSync(path.dirname(path.join(lifecycleRoot, brainstormPath)), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(lifecycleRoot, brainstormPath),
			"# Account recovery\n",
		);
		const linked = buildWorkBrainstormState(
			lifecycleRoot,
			`idea ${brainstorm.idea.id} ${brainstormPath}`,
			{ policy: "auto" },
		);
		assert.equal(linked.designSession.sourceArtifact, brainstormPath);
		assert.match(
			buildWorkPlanState(lifecycleRoot, brainstormPath).handoffPrompt,
			/Authoritative visual-design contract/,
			"brainstorm and planning share one brief instead of competing UI guidance",
		);

		const redesign = buildWorkRedesignState(
			lifecycleRoot,
			"Account recovery dashboard",
			{ policy: "required", now: new Date("2026-08-31T01:00:00.000Z") },
		);
		assert.equal(redesign.action, "design-audit-required");
		assert.ok(redesign.initiative.labels.includes("initiative"));
		assert.ok(redesign.audit.labels.includes("wo:design-audit"));
		assert.equal(
			Object.values(loadStore(lifecycleRoot).items).some((item) =>
				item.labels?.includes("wo:implementation"),
			),
			false,
			"redesign creates audit/design work, not premature implementation",
		);
		assert.equal(
			buildWorkResumeState(lifecycleRoot, redesign.epic.id).action,
			"design-resume-required",
			"ordinary resume selects the durable design session before planning",
		);
		const prepared = prepareDesignSession(lifecycleRoot, redesign.epic.id, {
			actorsAndFlows: ["Account owner recovers access"],
			statesAndContent: ["Loading, locked, error, and restored states"],
			responsiveRules: ["Desktop and mobile recovery remain complete"],
			accessibility: ["Keyboard flow, focus recovery, and announced errors"],
		});
		assert.equal(prepared.designSession.state, "commission_ready");
		const blockedPlanning = buildWorkPlanState(
			lifecycleRoot,
			`${redesign.epic.id} fork`,
		);
		assert.equal(blockedPlanning.action, "design-planning-blocked");
		assert.deepEqual(blockedPlanning.suggestedCommands, [
			`/wo design revise ${redesign.epic.id}`,
		]);
		const brief = fs.readFileSync(
			path.join(lifecycleRoot, ...prepared.designSession.briefPath.split("/")),
			"utf8",
		);
		for (const heading of [
			"Repository and reuse",
			"Visual direction",
			"States and content",
			"Responsive behavior",
			"Accessibility",
		])
			assert.match(brief, new RegExp(heading));

		let startObserved = false;
		const started = await advanceDesignSession(lifecycleRoot, redesign.epic.id, {
			reconcileProject: async ({ projectId, callTool }) => {
				assert.equal(typeof callTool, "function");
				const durable = loadDesignSession(lifecycleRoot, redesign.epic.id);
				assert.equal(durable.state, "run_pending");
				assert.equal(durable.projectId, projectId);
				return { conversationId: "conversation-test" };
			},
			callTool: async (tool, args) => {
				assert.equal(tool, "start_run");
				const durable = loadDesignSession(lifecycleRoot, redesign.epic.id);
				assert.equal(durable.requestId, args.requestId);
				assert.equal(durable.payloadDigest, openDesignPayloadDigest(args));
				assert.match(
					args.prompt,
					/Work only inside the OpenDesign project workspace/,
				);
				assert.match(args.prompt, /Do not inspect, edit, create, delete/);
				assert.match(args.prompt, /Candidate delivery contract/);
				assert.match(args.prompt, new RegExp(durable.briefHash));
				startObserved = true;
				return { runId: "run-test" };
			},
		});
		assert.equal(startObserved, true);
		assert.equal(started.action, "design-run-started");
		assert.equal(started.designSession.state, "run_active");
		const candidateArtifacts = Object.fromEntries(
			["A", "B", "C"].map((suffix) => [
				`CANDIDATE-${suffix}`,
				`<!doctype html><main data-ce-candidate-id="CANDIDATE-${suffix}" data-ce-brief-hash="${prepared.designSession.briefHash}">Direction ${suffix}</main>`,
			]),
		);
		const candidateManifest = {
			version: 1,
			briefHash: prepared.designSession.briefHash,
			launcherArtifact: "candidate-launcher.html",
			targetMatrix: prepared.designSession.targetMatrix,
			candidates: Object.entries(candidateArtifacts).map(
				([id, content], index) => ({
					id,
					title: `Direction ${index + 1}`,
					rationale: `Distinct direction ${index + 1}`,
					differentiators: [`Palette ${index + 1}`, `Layout ${index + 1}`],
					previewArtifact: `candidate-${index + 1}.html`,
					previewFragment: `#candidate=${id}`,
					artifactHash: createHash("sha256").update(content).digest("hex"),
					targets: prepared.designSession.targetMatrix.length
						? prepared.designSession.targetMatrix.map((target) => target.id)
						: ["TARGET-PRIMARY"],
				}),
			),
		};
		const remoteCandidateManifest = {
			...candidateManifest,
			launcher: candidateManifest.launcherArtifact,
			launcherArtifact: undefined,
			candidates: candidateManifest.candidates.map(
				({ targets, previewArtifact, ...candidate }) => ({
					...candidate,
					previewArtifact: candidateManifest.launcherArtifact,
					artifact: previewArtifact,
					targetCoverage: targets.map((targetId) => ({
						targetId,
						status: "complete",
					})),
				}),
			),
		};
		const candidateFiles = [
			{ path: "DESIGN-CANDIDATES.json", size: 100 },
			{ path: "candidate-launcher.html", size: 100 },
			...candidateManifest.candidates.map((candidate) => ({
				path: candidate.previewArtifact,
				size: candidateArtifacts[candidate.id].length,
			})),
		];
		const reconciled = await advanceDesignSession(
			lifecycleRoot,
			redesign.epic.id,
			{
				callTool: async (tool, args) => {
					if (tool === "get_run")
						return {
							runId: "run-test",
							projectId: started.designSession.projectId,
							status: "succeeded",
							previewUrl: "",
							studioUrl: "https://example.test/studio",
						};
					if (tool === "list_files") return { files: candidateFiles };
					if (tool === "get_file") {
						if (args.path === "DESIGN-CANDIDATES.json")
							return remoteCandidateManifest;
						const candidate = candidateManifest.candidates.find(
							(item) => item.previewArtifact === args.path,
						);
						return candidateArtifacts[candidate.id];
					}
					throw new Error(`unexpected candidate tool ${tool}`);
				},
			},
		);
		assert.equal(
			reconciled.action,
			"design-candidate-selection-required",
			reconciled.message,
		);
		assert.equal(reconciled.designSession.state, "candidate_selection_required");
		assert.equal(reconciled.candidates.length, 3);
		assert.equal(new Set(reconciled.candidates.map((item) => item.url)).size, 3);
		assert.match(
			reconciled.candidates[0].url,
			new RegExp(
				`/api/projects/${started.designSession.projectId}/raw/candidate-launcher\\.html#candidate=CANDIDATE-A$`,
			),
		);
		const selected = await selectDesignCandidate(
			lifecycleRoot,
			redesign.epic.id,
			"CANDIDATE-B",
			{
				authority: "human",
				userInitiated: true,
				decisionEventId: "selection-event-1",
				callTool: async (tool, args) => {
					assert.equal(tool, "start_run");
					assert.match(args.prompt, /Refine only selected candidate CANDIDATE-B/);
					assert.match(args.prompt, /Required top-level keys: version, targets/);
					assert.match(args.prompt, /Authoritative selection:[\s\S]*CANDIDATE-B/);
					return { runId: "refinement-run" };
				},
			},
		);
		assert.equal(selected.action, "design-refinement-started");
		assert.equal(selected.designSession.selectedCandidateId, "CANDIDATE-B");
		assert.equal(selected.designSession.selectionAuthority, "human");
		const revisionReady = await advanceDesignSession(
			lifecycleRoot,
			redesign.epic.id,
			{
				callTool: async () => ({
					runId: "refinement-run",
					projectId: selected.designSession.projectId,
					status: "succeeded",
					previewUrl: "https://example.test/refinement",
					studioUrl: "https://example.test/studio-refinement",
				}),
			},
		);
		assert.equal(revisionReady.designSession.state, "review_ready");
		const selectionReceipt = JSON.parse(
			fs.readFileSync(
				path.join(lifecycleRoot, revisionReady.designSession.selectionPath),
				"utf8",
			),
		);
		const refinementSyncReady = {
			...revisionReady.designSession,
			targetMatrix: [],
		};
		saveDesignSession(lifecycleRoot, refinementSyncReady);
		const refinedHandoff = {
			...valid,
			identity: {
				...valid.identity,
				briefHash: refinementSyncReady.briefHash,
			},
			selection: {
				manifestHash: selectionReceipt.candidateManifestHash,
				candidateId: selectionReceipt.candidateId,
				candidateHash: selectionReceipt.candidateArtifactHash,
				selectionHash: hashDesignValue(selectionReceipt),
			},
		};
		const refinedSync = await syncDesignSession(lifecycleRoot, redesign.epic.id, {
			callTool: async (tool, args) => {
				if (tool === "list_files")
					return {
						files: [
							{
								path: "DESIGN-HANDOFF.json",
								mime: "application/json",
								size: 1_000,
								mtime: 2,
							},
							{
								path: "candidate-2.html",
								mime: "text/html",
								size: 2_000,
								mtime: 2,
							},
						],
					};
				if (tool === "get_file" && args.path === "DESIGN-HANDOFF.json")
					return refinedHandoff;
				throw new Error("refinement sync must not re-pin the refined artifact");
			},
		});
		assert.equal(refinedSync.action, "design-sync-updated");
		assert.equal(refinedSync.designSession.state, "approval_required");

		const clarificationId = "clarification-design";
		const clarificationBrief = `docs/designs/${clarificationId}/DESIGN-BRIEF.md`;
		fs.mkdirSync(path.dirname(path.join(lifecycleRoot, clarificationBrief)), {
			recursive: true,
		});
		fs.writeFileSync(path.join(lifecycleRoot, clarificationBrief), "# Clarify\n");
		const clarification = transitionDesignSession(
			transitionDesignSession(
				createDesignSession({
					ownerId: clarificationId,
					policy: "required",
					state: "commission_ready",
					metadata: {
						briefPath: clarificationBrief,
						briefHash: "a".repeat(64),
						projectId: "clarification-project",
					},
				}),
				"run_pending",
				{ requestId: crypto.randomUUID() },
			),
			"run_active",
			{ runId: "clarification-run" },
		);
		saveDesignSession(
			lifecycleRoot,
			transitionDesignSession(clarification, "clarification_required", {
				agentMessage: "Should the mobile variant use touch-only controls?",
			}),
		);
		const clarificationAnswered = await answerDesignClarification(
			lifecycleRoot,
			clarificationId,
			"Yes, touch-only, with 44px minimum targets.",
			{
				callTool: async (tool, args) => {
					assert.equal(tool, "start_run");
					assert.equal(args.project, "clarification-project");
					assert.match(args.prompt, /same design commission/);
					return { runId: "clarification-followup" };
				},
			},
		);
		assert.equal(clarificationAnswered.action, "design-clarification-started");
		assert.equal(clarificationAnswered.designSession.clarifications.length, 1);
		assert.equal(
			clarificationAnswered.designSession.clarifications[0].source,
			"human",
		);

		const interruptedBrief = "docs/designs/interrupted/DESIGN-BRIEF.md";
		fs.mkdirSync(path.dirname(path.join(lifecycleRoot, interruptedBrief)), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(lifecycleRoot, interruptedBrief),
			"# Interrupted brief\n",
		);
		const interrupted = transitionDesignSession(
			createDesignSession({
				ownerId: "interrupted-design",
				policy: "required",
				state: "commission_ready",
				metadata: { briefPath: interruptedBrief, objective: "Interrupted" },
			}),
			"run_pending",
			{ projectId: "project-interrupted", projectName: "Interrupted" },
		);
		saveDesignSession(lifecycleRoot, interrupted);
		const recoveredStart = await advanceDesignSession(
			lifecycleRoot,
			interrupted.ownerId,
			{
				reconcileProject: async ({ projectId }) => ({
					project: { id: projectId },
					conversationId: "recovered-conversation",
				}),
				callTool: async (tool, args) => {
					assert.equal(tool, "start_run");
					assert.equal(args.project, "project-interrupted");
					return { runId: "run-interrupted" };
				},
			},
		);
		assert.equal(recoveredStart.action, "design-run-recovered");
		assert.equal(recoveredStart.designSession.runId, "run-interrupted");

		const canceledId = "canceled-design";
		const canceledPayload = {
			project: "project-canceled",
			prompt: "Canceled design prompt",
			requestId: "request-canceled",
		};
		const canceledSession = transitionDesignSession(
			transitionDesignSession(
				createDesignSession({
					ownerId: canceledId,
					policy: "required",
					state: "commission_ready",
					metadata: { objective: "Canceled design" },
				}),
				"run_pending",
				{
					projectId: canceledPayload.project,
					startPayload: canceledPayload,
					requestId: canceledPayload.requestId,
					payloadDigest: openDesignPayloadDigest(canceledPayload),
				},
			),
			"run_active",
			{ runId: "run-canceled" },
		);
		saveDesignSession(lifecycleRoot, canceledSession);
		const canceledStatus = await advanceDesignSession(lifecycleRoot, canceledId, {
			callTool: async (tool) => {
				assert.equal(tool, "get_run");
				return {
					runId: "run-canceled",
					projectId: canceledPayload.project,
					status: "canceled",
				};
			},
		});
		assert.equal(canceledStatus.action, "design-failed");
		assert.equal(canceledStatus.designSession.errorCategory, "run-canceled");
		assert.equal(
			canceledStatus.designSession.nextAction,
			`/wo design resume ${canceledId}`,
		);
		const unconfirmedResume = await advanceDesignSession(
			lifecycleRoot,
			canceledId,
			{
				callTool: async () => assert.fail("unconfirmed resume called provider"),
			},
		);
		assert.equal(
			unconfirmedResume.action,
			"design-run-resume-confirmation-required",
		);
		const resumedCanceled = await advanceDesignSession(
			lifecycleRoot,
			canceledId,
			{
				resumeConfirmed: true,
				callTool: async (tool, args) => {
					assert.equal(tool, "start_run");
					assert.equal(args.project, canceledPayload.project);
					assert.equal(args.prompt, canceledPayload.prompt);
					assert.notEqual(args.requestId, canceledPayload.requestId);
					assert.equal(args.resume, undefined);
					return { runId: "run-canceled-recovered" };
				},
			},
		);
		assert.equal(resumedCanceled.action, "design-run-restarted");
		assert.equal(resumedCanceled.designSession.state, "run_active");
		assert.equal(resumedCanceled.designSession.runId, "run-canceled-recovered");
		assert.equal(
			resumedCanceled.designSession.projectId,
			canceledPayload.project,
		);
		assert.equal(
			resumedCanceled.designSession.runAttempts[0].runId,
			"run-canceled",
		);
		assert.equal(
			resumedCanceled.designSession.runAttempts[0].requestId,
			canceledPayload.requestId,
		);
		const livenessAttention = await advanceDesignSession(
			lifecycleRoot,
			canceledId,
			{
				designRunLivenessAttentionMs: 0,
				callTool: async (tool) => {
					assert.equal(tool, "get_run");
					return {
						runId: "run-canceled-recovered",
						projectId: canceledPayload.project,
						status: "running",
					};
				},
			},
		);
		assert.equal(livenessAttention.ok, false);
		assert.equal(livenessAttention.action, "design-run-liveness-attention");
		assert.equal(livenessAttention.designSession.state, "run_active");
		const restartedFromScratch = await restartDesignSession(
			lifecycleRoot,
			canceledId,
			{
				reconcileProject: async ({ projectId }) => {
					assert.notEqual(projectId, canceledPayload.project);
					return { conversationId: "fresh-conversation" };
				},
				callTool: async (tool, args) => {
					if (tool === "cancel_run") {
						assert.deepEqual(args, { runId: "run-canceled-recovered" });
						return { canceled: true };
					}
					assert.equal(tool, "start_run");
					assert.notEqual(args.project, canceledPayload.project);
					assert.match(args.prompt, /Canceled design prompt/);
					return { runId: "run-fresh" };
				},
			},
		);
		assert.equal(
			restartedFromScratch.action,
			"design-run-restarted-from-scratch",
		);
		assert.equal(restartedFromScratch.designSession.state, "run_active");
		assert.equal(restartedFromScratch.designSession.runId, "run-fresh");
		assert.notEqual(
			restartedFromScratch.designSession.projectId,
			canceledPayload.project,
		);
		assert.equal(
			restartedFromScratch.designSession.runAttempts.at(-1).status,
			"abandoned",
		);

		const refinementRestartId = "refinement-restart-design";
		const refinementLineage = {
			candidateManifestPath: "docs/designs/refinement/DESIGN-CANDIDATES.json",
			candidateManifestHash: "b".repeat(64),
			selectionPath: "docs/designs/refinement/DIRECTION-SELECTION.json",
			selectionHash: "c".repeat(64),
			selectedCandidateId: "CANDIDATE-B",
			selectedCandidateHash: "d".repeat(64),
			selectionAuthority: { kind: "human", actor: "maintainer" },
			selectionDecisionEventId: "decision-refinement",
		};
		saveDesignSession(
			lifecycleRoot,
			createDesignSession({
				ownerId: refinementRestartId,
				policy: "required",
				state: "run_active",
				metadata: {
					objective: "Restart refinement",
					projectId: "project-refinement",
					runId: "run-refinement",
					requestId: "request-refinement",
					candidatePhase: "refinement",
					...refinementLineage,
					startPayload: {
						project: "project-refinement",
						prompt: "Refine selected candidate B",
						requestId: "request-refinement",
					},
				},
			}),
		);
		const restartedRefinement = await restartDesignSession(
			lifecycleRoot,
			refinementRestartId,
			{
				reconcileProject: async () => ({
					conversationId: "fresh-refinement-conversation",
				}),
				callTool: async (tool, args) => {
					if (tool === "cancel_run") return { canceled: true };
					assert.equal(tool, "start_run");
					assert.equal(args.prompt, "Refine selected candidate B");
					return { runId: "run-refinement-fresh" };
				},
			},
		);
		assert.equal(restartedRefinement.designSession.candidatePhase, "refinement");
		for (const [key, value] of Object.entries(refinementLineage))
			assert.deepEqual(restartedRefinement.designSession[key], value);

		const providerFailedId = "provider-failed-design";
		const providerFailedPayload = {
			project: "project-provider-failed",
			prompt: "Repair responsive clipping",
			requestId: "request-provider-failed",
		};
		const providerFailedSession = transitionDesignSession(
			transitionDesignSession(
				createDesignSession({
					ownerId: providerFailedId,
					policy: "required",
					state: "commission_ready",
					metadata: { objective: "Provider failed design" },
				}),
				"run_pending",
				{
					projectId: providerFailedPayload.project,
					startPayload: providerFailedPayload,
					requestId: providerFailedPayload.requestId,
					payloadDigest: openDesignPayloadDigest(providerFailedPayload),
				},
			),
			"run_active",
			{ runId: "run-provider-failed" },
		);
		saveDesignSession(lifecycleRoot, providerFailedSession);
		const providerFailure = await advanceDesignSession(
			lifecycleRoot,
			providerFailedId,
			{
				callTool: async () => ({
					runId: "run-provider-failed",
					projectId: providerFailedPayload.project,
					status: "failed",
				}),
			},
		);
		assert.equal(providerFailure.action, "design-failed");
		assert.equal(providerFailure.designSession.errorCategory, "run-failed");
		assert.equal(
			providerFailure.designSession.nextAction,
			`/wo design resume ${providerFailedId}`,
		);
		saveDesignSession(lifecycleRoot, {
			...providerFailure.designSession,
			errorCategory: undefined,
			nextAction: `/wo design ${providerFailedId}`,
		});
		const resumedFailure = await advanceDesignSession(
			lifecycleRoot,
			providerFailedId,
			{
				resumeConfirmed: true,
				callTool: async (tool, args) => {
					assert.equal(tool, "start_run");
					assert.equal(args.prompt, providerFailedPayload.prompt);
					return { runId: "run-provider-recovered" };
				},
			},
		);
		assert.equal(resumedFailure.action, "design-run-restarted");
		assert.equal(resumedFailure.designSession.runId, "run-provider-recovered");
		assert.equal(
			resumedFailure.designSession.runAttempts.at(-1).status,
			"failed",
		);

		const reviewRestartId = "review-restart-design";
		saveDesignSession(
			lifecycleRoot,
			createDesignSession({
				ownerId: reviewRestartId,
				policy: "required",
				state: "review_ready",
				repairAttempts: 1,
				metadata: {
					briefPath: interruptedBrief,
					briefHash: "a".repeat(64),
					objective: "Restart reviewed design",
					projectId: "project-reviewed",
					runId: "run-reviewed",
					requestId: "request-repair",
					candidatePhase: "refinement",
					candidateManifestHash: "b".repeat(64),
					selectionPath: "docs/designs/old/DIRECTION-SELECTION.json",
					selectedCandidateId: "CANDIDATE-OLD",
					selectedCandidateHash: "c".repeat(64),
					syncError: "stale repair error",
					startPayload: {
						project: "project-reviewed",
						prompt: "Repair the old handoff",
						requestId: "request-repair",
					},
				},
			}),
		);
		const restartedReview = await restartDesignSession(
			lifecycleRoot,
			reviewRestartId,
			{
				reconcileProject: async ({ projectId }) => {
					assert.notEqual(projectId, "project-reviewed");
					return { conversationId: "fresh-review-conversation" };
				},
				callTool: async (tool, args) => {
					assert.equal(tool, "start_run");
					assert.match(args.prompt, /Produce exactly three/);
					assert.doesNotMatch(args.prompt, /Repair the old handoff/);
					return { runId: "run-review-fresh" };
				},
			},
		);
		assert.equal(restartedReview.action, "design-run-restarted-from-scratch");
		assert.equal(restartedReview.designSession.state, "run_active");
		assert.equal(restartedReview.designSession.candidatePhase, "candidates");
		assert.equal(restartedReview.designSession.repairAttempts, 0);
		assert.equal(restartedReview.designSession.selectionPath, undefined);
		assert.equal(restartedReview.designSession.selectedCandidateId, undefined);
		assert.equal(restartedReview.designSession.candidateManifestHash, undefined);
		assert.equal(restartedReview.designSession.syncError, undefined);

		for (const [ownerId, policy, expected] of [
			["auto-design", "auto", "design-text-fallback"],
			["required-design", "required", "design-required-blocked"],
		]) {
			const relative = `docs/designs/${ownerId}/DESIGN-BRIEF.md`;
			fs.mkdirSync(path.dirname(path.join(lifecycleRoot, relative)), {
				recursive: true,
			});
			fs.writeFileSync(path.join(lifecycleRoot, relative), "# Brief\n");
			saveDesignSession(
				lifecycleRoot,
				createDesignSession({
					ownerId,
					policy,
					state: "commission_ready",
					metadata: {
						briefPath: relative,
						briefHash: "a".repeat(64),
						objective: ownerId,
					},
				}),
			);
			const unavailable = await advanceDesignSession(lifecycleRoot, ownerId, {
				reconcileProject: async () => {
					throw Object.assign(new Error("missing"), { category: "spawn-failed" });
				},
			});
			assert.equal(unavailable.action, expected);
			if (policy === "required") {
				assert.ok(
					unavailable.suggestedCommands.includes(`/wo design waive ${ownerId}`),
				);
				assert.equal(
					waiveDesignSession(lifecycleRoot, ownerId).action,
					"design-waived-to-text",
				);
				const fallbackApproval = await approveDesignSession(lifecycleRoot, ownerId);
				assert.equal(fallbackApproval.action, "design-approved");
				assert.equal(
					designPlanningAuthority(lifecycleRoot, ownerId).authority.fallback,
					true,
				);
			}
		}

		const retryId = "required-retry-design";
		const retryBrief = `docs/designs/${retryId}/DESIGN-BRIEF.md`;
		fs.mkdirSync(path.dirname(path.join(lifecycleRoot, retryBrief)), {
			recursive: true,
		});
		fs.writeFileSync(path.join(lifecycleRoot, retryBrief), "# Retry brief\n");
		saveDesignSession(
			lifecycleRoot,
			createDesignSession({
				ownerId: retryId,
				policy: "required",
				state: "commission_ready",
				metadata: { briefPath: retryBrief, objective: retryId },
			}),
		);
		await advanceDesignSession(lifecycleRoot, retryId, {
			reconcileProject: async () => {
				throw Object.assign(new Error("missing"), { category: "spawn-failed" });
			},
		});
		const retried = await advanceDesignSession(lifecycleRoot, retryId, {
			reconcileProject: async () => ({ conversationId: "retry-conversation" }),
			callTool: async () => ({ runId: "retry-run" }),
		});
		assert.equal(retried.action, "design-run-recovered");
		assert.equal(retried.designSession.runId, "retry-run");

		const syncId = "sync-design";
		const syncDirectory = `docs/designs/${syncId}`;
		const syncBrief = `${syncDirectory}/DESIGN-BRIEF.md`;
		fs.mkdirSync(path.join(lifecycleRoot, ...syncDirectory.split("/")), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(lifecycleRoot, ...syncBrief.split("/")),
			"# Sync brief\n",
		);
		saveDesignSession(
			lifecycleRoot,
			createDesignSession({
				ownerId: syncId,
				policy: "required",
				state: "review_ready",
				metadata: {
					briefPath: syncBrief,
					briefHash: "a".repeat(64),
					designDirectory: syncDirectory,
					projectId: "project-sync",
					previewUrl: "https://example.test/preview",
				},
			}),
		);
		let remoteVersion = 1;
		const fetched = [];
		const designPeer = async (tool, args) => {
			if (tool === "list_files")
				return {
					files: [
						{
							path: "DESIGN-HANDOFF.json",
							mime: "application/json",
							size: 1_000,
							mtime: remoteVersion,
						},
						{
							path: "DESIGN-HANDOFF.md",
							mime: "text/markdown",
							size: 20,
							mtime: remoteVersion,
						},
						{ path: "prototype.js", mime: "text/javascript", size: 99 },
					],
				};
			if (tool === "get_file") {
				fetched.push(args.path);
				return args.path.endsWith(".json") ? valid : "# Human handoff\n";
			}
			throw new Error(`unexpected tool ${tool}`);
		};
		const synchronized = await syncDesignSession(lifecycleRoot, syncId, {
			callTool: designPeer,
		});
		assert.equal(synchronized.action, "design-sync-updated");
		assert.equal(synchronized.designSession.state, "approval_required");
		assert.deepEqual(fetched.sort(), [
			"DESIGN-HANDOFF.json",
			"DESIGN-HANDOFF.md",
		]);
		assert.equal(
			fs.existsSync(path.join(lifecycleRoot, syncDirectory, "prototype.js")),
			false,
		);
		saveDesignSession(lifecycleRoot, {
			...synchronized.designSession,
			syncError: "stale pre-approval diagnostic",
		});
		const approvedSync = await approveDesignSession(
			lifecycleRoot,
			syncId,
			"Looks good",
			{
				callTool: designPeer,
			},
		);
		assert.equal(approvedSync.action, "design-approved");
		assert.equal(approvedSync.designSession.state, "approved");
		assert.equal(approvedSync.designSession.syncError, undefined);
		const planningAuthority = designPlanningAuthority(lifecycleRoot, syncId);
		assert.equal(planningAuthority.ok, true);
		assert.equal(planningAuthority.authority.criteria[0].id, "DES-1");
		assert.equal(planningAuthority.authority.prototypeAuthority, false);
		assert.equal(
			fs.existsSync(path.join(lifecycleRoot, syncDirectory, "APPROVAL.json")),
			true,
		);
		remoteVersion = 2;
		const stale = await syncDesignSession(lifecycleRoot, syncId, {
			callTool: designPeer,
		});
		assert.equal(stale.action, "design-sync-updated");
		assert.equal(stale.designSession.state, "approval_required");
		assert.equal(
			stale.designSession.revision,
			approvedSync.designSession.revision + 1,
		);
		assert.equal(stale.designSession.approvalHash, undefined);
		remoteVersion = 3;
		const resynchronized = await syncDesignSession(lifecycleRoot, syncId, {
			callTool: designPeer,
		});
		assert.equal(resynchronized.action, "design-sync-updated");
		assert.equal(resynchronized.designSession.state, "approval_required");
		assert.equal(
			resynchronized.designSession.revision,
			stale.designSession.revision + 1,
		);

		const raceId = "eventual-preview-design";
		saveDesignSession(
			lifecycleRoot,
			createDesignSession({
				ownerId: raceId,
				policy: "required",
				state: "review_ready",
				metadata: {
					briefPath: syncBrief,
					briefHash: "a".repeat(64),
					targetMatrix: v2TargetMatrix,
					designDirectory: syncDirectory,
					projectId: "project-eventual-preview",
					syncError: "stale preview listing",
				},
			}),
		);
		let raceListCalls = 0;
		const raceHandoff = {
			...v2,
			variants: v2.variants.map((variant, index) =>
				index === 0
					? {
							...variant,
							previewRoute: undefined,
							previewArtifact: "sunny-sticker-preview.html",
						}
					: variant,
			),
		};
		const raceSync = await syncDesignSession(lifecycleRoot, raceId, {
			callTool: async (tool, args) => {
				if (tool === "list_files") {
					raceListCalls += 1;
					return {
						files: [
							{ path: "DESIGN-HANDOFF.json", size: 1_000, mtime: 1 },
							...(raceListCalls > 1
								? [
										{
											path: "sunny-sticker-preview.html",
											size: 2_000,
											mtime: 1,
										},
									]
								: []),
						],
					};
				}
				if (tool === "get_file" && args.path === "DESIGN-HANDOFF.json")
					return raceHandoff;
				throw new Error(`unexpected race tool ${tool}`);
			},
		});
		assert.equal(raceSync.action, "design-sync-updated");
		assert.equal(raceSync.designSession.syncError, undefined);
		assert.equal(raceListCalls, 2);

		const repairId = "repair-design";
		saveDesignSession(
			lifecycleRoot,
			createDesignSession({
				ownerId: repairId,
				policy: "required",
				state: "review_ready",
				metadata: {
					briefPath: syncBrief,
					briefHash: "a".repeat(64),
					designDirectory: syncDirectory,
					projectId: "project-repair",
					previewUrl: "https://example.test/preview",
				},
			}),
		);
		const repaired = await syncDesignSession(lifecycleRoot, repairId, {
			callTool: async (tool, args) => {
				if (tool === "list_files")
					return { files: [{ path: "DESIGN-HANDOFF.json", size: 10, mtime: 1 }] };
				if (tool === "get_file") return invalid;
				if (tool === "start_run") {
					const durable = loadDesignSession(lifecycleRoot, repairId);
					assert.equal(durable.state, "run_pending");
					assert.equal(durable.repairAttempts, 1);
					assert.match(args.prompt, /Required top-level keys: version, targets/);
					assert.match(
						args.prompt,
						new RegExp(`Authoritative briefHash: ${"a".repeat(64)}`),
					);
					return { runId: "repair-run" };
				}
			},
		});
		assert.equal(repaired.action, "design-repair-started");
		assert.equal(repaired.designSession.repairAttempts, 1);
		saveDesignSession(
			lifecycleRoot,
			transitionDesignSession(repaired.designSession, "review_ready", {
				runId: undefined,
			}),
		);
		const secondInvalid = await syncDesignSession(lifecycleRoot, repairId, {
			callTool: async (tool) => {
				if (tool === "list_files")
					return { files: [{ path: "DESIGN-HANDOFF.json", size: 10, mtime: 2 }] };
				if (tool === "get_file") return invalid;
				throw new Error("a second repair must not start");
			},
		});
		assert.equal(secondInvalid.action, "design-sync-invalid");
		assert.equal(secondInvalid.designSession.repairAttempts, 1);
		const reviewInvalid = await reviewDesignSession(lifecycleRoot, repairId, {});
		assert.equal(reviewInvalid.action, "design-review-ready");
		const revisedInvalid = await reviseDesignSession(
			lifecycleRoot,
			repairId,
			"Regenerate the handoff with the exact v2 contract.",
			{
				callTool: async (tool, args) => {
					assert.equal(tool, "start_run");
					assert.match(args.prompt, /Required top-level keys: version, targets/);
					return { runId: "schema-revision-run" };
				},
			},
		);
		assert.equal(revisedInvalid.action, "design-revision-started");

		const fetchId = "fetch-design";
		saveDesignSession(
			lifecycleRoot,
			createDesignSession({
				ownerId: fetchId,
				policy: "required",
				state: "review_ready",
				metadata: {
					briefPath: syncBrief,
					briefHash: "a".repeat(64),
					designDirectory: syncDirectory,
					projectId: "project-fetch",
					previewUrl: "https://example.test/preview",
				},
			}),
		);
		const fetchPending = await syncDesignSession(lifecycleRoot, fetchId, {
			callTool: async (tool) => {
				if (tool === "list_files")
					return { files: [{ path: "DESIGN-HANDOFF.json", size: 10, mtime: 1 }] };
				throw new Error("offline");
			},
		});
		assert.equal(fetchPending.action, "design-sync-pending");
		assert.equal(fetchPending.designSession.state, "review_ready");
		assert.equal(fetchPending.designSession.repairAttempts, 0);

		const longObjective = `Редизайн ${"десктоп преживяване ".repeat(20)}`;
		const longRedesign = buildWorkRedesignState(lifecycleRoot, longObjective, {
			policy: "required",
		});
		const longPrepared = prepareDesignSession(
			lifecycleRoot,
			longRedesign.epic.id,
		);
		const longBrief = fs.readFileSync(
			path.join(lifecycleRoot, ...longPrepared.designSession.briefPath.split("/")),
			"utf8",
		);
		assert.ok(
			Buffer.byteLength(longBrief.split("\n", 1)[0].slice(2)) <= 200,
			"default design brief titles fit the contract byte limit",
		);
		assert.match(longBrief, new RegExp(longObjective.trim()));
	} finally {
		fs.rmSync(lifecycleRoot, { recursive: true, force: true });
	}

	process.stdout.write("work-design tests passed\n");
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
