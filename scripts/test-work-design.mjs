import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	canonicalDesignJson,
	consumeDesignRepairAttempt,
	copyDesignReferenceAsset,
	createDesignApproval,
	createDesignSession,
	createTextFallbackHandoff,
	designApprovalIsCurrent,
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
	approveDesignSession,
	buildWorkBrainstormState,
	buildWorkPlanState,
	buildWorkRedesignState,
	buildWorkResumeState,
	prepareDesignSession,
	designReviewChoices,
	reviewDesignSession,
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

	const reordered = Object.fromEntries(
		Object.entries(valid).sort(([a], [b]) => b.localeCompare(a)),
	);
	assert.equal(
		hashDesignValue(valid),
		hashDesignValue(reordered),
		"hash is independent of object key order",
	);
	assert.equal(canonicalDesignJson(valid), canonicalDesignJson(reordered));

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
	assert.equal(
		renderDesignRepairPrompt(["z error", "a error"]),
		renderDesignRepairPrompt(["a error", "z error"]),
		"repair prompt is deterministic",
	);

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
		const boards = prepareDesignSession(lifecycleRoot, redesign.epic.id, {
			directionOpen: true,
		});
		assert.equal(boards.action, "choose-design-direction");
		assert.equal(boards.boards.length, 3);
		const prepared = prepareDesignSession(lifecycleRoot, redesign.epic.id, {
			selectedDirection: boards.boards[1].description,
			actorsAndFlows: ["Account owner recovers access"],
			statesAndContent: ["Loading, locked, error, and restored states"],
			responsiveRules: ["Desktop and mobile recovery remain complete"],
			accessibility: ["Keyboard flow, focus recovery, and announced errors"],
		});
		assert.equal(prepared.designSession.state, "commission_ready");
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
			reconcileProject: async ({ projectId }) => {
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
				startObserved = true;
				return { runId: "run-test" };
			},
		});
		assert.equal(startObserved, true);
		assert.equal(started.action, "design-run-started");
		assert.equal(started.designSession.state, "run_active");
		const reconciled = await advanceDesignSession(
			lifecycleRoot,
			redesign.epic.id,
			{
				callTool: async (tool, args) => {
					assert.deepEqual([tool, args], ["get_run", { runId: "run-test" }]);
					return {
						status: "succeeded",
						previewUrl: "https://example.test/preview",
						studioUrl: "https://example.test/studio",
						agentMessage: "Ready",
					};
				},
			},
		);
		assert.equal(reconciled.designSession.state, "review_ready");
		assert.equal(
			designReviewChoices(reconciled.designSession).find(
				(choice) => choice.value === "approve",
			).disabled,
			true,
			"review keeps approval disabled until a synchronized handoff exists",
		);
		const projectedReview = await reviewDesignSession(
			lifecycleRoot,
			redesign.epic.id,
			{ ui: {} },
		);
		assert.equal(projectedReview.action, "design-review-ready");
		assert.ok(
			projectedReview.choices.some((choice) => choice.value === "revise"),
			"headless review projects the same actions",
		);

		const firstRequestId = reconciled.designSession.requestId;
		const revised = await reviewDesignSession(
			lifecycleRoot,
			redesign.epic.id,
			{
				mode: "rpc",
				ui: {
					select: async (_title, labels) =>
						labels.find((label) => label.includes("Request changes")),
					input: async () => "Increase contrast and preserve the recovery states.",
				},
			},
			{
				callTool: async (tool, args) => {
					assert.equal(tool, "start_run");
					assert.equal(args.project, reconciled.designSession.projectId);
					assert.notEqual(args.requestId, firstRequestId);
					const durable = loadDesignSession(lifecycleRoot, redesign.epic.id);
					assert.equal(durable.state, "run_pending");
					assert.equal(durable.requestId, args.requestId);
					return { runId: "revision-run" };
				},
			},
		);
		assert.equal(revised.action, "design-revision-started");
		assert.equal(revised.designSession.revision, 1);
		assert.equal(revised.designSession.state, "run_active");
		const revisionReady = await advanceDesignSession(
			lifecycleRoot,
			redesign.epic.id,
			{
				callTool: async () => ({
					status: "succeeded",
					previewUrl: "https://example.test/revision",
					studioUrl: "https://example.test/studio-revision",
					agentMessage: "Revision ready",
				}),
			},
		);
		assert.equal(revisionReady.designSession.state, "review_ready");
		const canceled = await reviewDesignSession(lifecycleRoot, redesign.epic.id, {
			mode: "rpc",
			ui: {
				select: async (_title, labels) =>
					labels.find((label) => label.includes("Cancel design")),
			},
		});
		assert.equal(canceled.designSession.state, "canceled");
		assert.equal(
			canceled.designSession.previewUrl,
			"https://example.test/revision",
		);
		assert.match(canceled.designSession.feedback, /Increase contrast/);
		assert.match(canceled.designSession.canceledReason, /human canceled/);

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
					metadata: { briefPath: relative, objective: ownerId },
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
			callTool: async (tool) => {
				if (tool === "list_files")
					return { files: [{ path: "DESIGN-HANDOFF.json", size: 10, mtime: 1 }] };
				if (tool === "get_file") return invalid;
				if (tool === "start_run") {
					const durable = loadDesignSession(lifecycleRoot, repairId);
					assert.equal(durable.state, "run_pending");
					assert.equal(durable.repairAttempts, 1);
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
	} finally {
		fs.rmSync(lifecycleRoot, { recursive: true, force: true });
	}

	process.stdout.write("work-design tests passed\n");
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
