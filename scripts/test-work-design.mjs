import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	canonicalDesignJson,
	consumeDesignRepairAttempt,
	createDesignApproval,
	createDesignSession,
	createTextFallbackHandoff,
	designApprovalIsCurrent,
	designLineageNotes,
	hashDesignValue,
	loadDesignSession,
	normalizeRemoteFingerprint,
	renderDesignBrief,
	resolveDesignArtifactPath,
	saveDesignSession,
	transitionDesignSession,
	validateDesignArtifactRelativePath,
	validateDesignHandoff,
} from "../extensions/work-design.js";

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

	process.stdout.write("work-design tests passed\n");
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
