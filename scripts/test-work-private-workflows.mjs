import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "../extensions/work-compound-source.js";
import {
	legacyCompoundRemovalRecommendation,
	privateWorkflowActivationWarning,
} from "../extensions/work-models.js";
import { dispatchPrivateWorkflow } from "../extensions/work-private-workflows.js";
import {
	activatePendingPrivateWorkflowRelease,
	classifyPrivateWorkflowRelease,
	PRIVATE_WORKFLOW_OWNED_OUTPUTS,
	PRIVATE_WORKFLOW_RELEASE_GATES,
	promoteVerifiedPrivateWorkflowRelease,
	readPrivateWorkflowActivationState,
	resolveLatestOfficialStableRelease,
	rollbackPrivateWorkflowRelease,
} from "../extensions/work-compound-catch-up.js";
import { translateVerifiedWorkflows } from "./generate-work-private-workflows.mjs";

let checks = 0;
const check = (fn, label) => {
	fn();
	checks++;
	console.log(`ok ${checks} - ${label}`);
};
const rejects = (fn, expression, label) =>
	check(() => assert.throws(fn, expression), label);

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const extensionRoot = path.join(repositoryRoot, "extensions");
const resourceRoot = path.join(extensionRoot, "private-workflows");
const inventoryPath = path.join(extensionRoot, "work-compound-inventory.json");
const packageZeroSurface = () => {
	const packageManifest = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
	const extensionSource = readFileSync(path.join(extensionRoot, "work-models.js"), "utf8");
	const privateName = /(?:^|[\\/-])(?:ce-|private-workflows?)/i;
	const commands = [...extensionSource.matchAll(/registerCommand\(\s*["']([^"']+)/g)]
		.map((match) => match[1])
		.filter((name) => name.startsWith("ce-"));
	const skillDescriptions = readdirSync(path.join(repositoryRoot, "skills"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name.startsWith("ce-"))
		.map((entry) => entry.name);
	const extensionHooks = packageManifest.pi.extensions.filter((entry) => privateName.test(entry));
	const resourceRoots = [...packageManifest.pi.extensions, ...packageManifest.pi.skills]
		.filter((entry) => privateName.test(entry));
	return {
		commands,
		skillDescriptions,
		extensionHooks,
		resourceRoots,
		modelInvocableEntries: [
			...commands.map((name) => `command:${name}`),
			...skillDescriptions.map((name) => `skill:${name}`),
		],
	};
};
const expectedZeroSurface = {
	commands: [],
	skillDescriptions: [],
	extensionHooks: [],
	resourceRoots: [],
	modelInvocableEntries: [],
};
const authority = {
	actionToken: "work-models:F7:brainstorm:v1",
	callerUrl: pathToFileURL(path.join(extensionRoot, "work-models.js")).href,
};
const debugAuthority = { ...authority, actionToken: "work-models:debug:investigation:v1" };
const learningAuthority = { ...authority, actionToken: "work-models:finish:learning-capture:v1" };
const planAuthority = { ...authority, actionToken: "work-models:F7:plan:v1" };
const reviewAuthority = { ...authority, actionToken: "work-models:finish:review:v1" };
const simplifyAuthority = { ...authority, actionToken: "work-models:finish:simplify:v1" };
const browserAuthority = { ...authority, actionToken: "work-models:finish:browser:v1" };
const catchUpAuthority = {
	...authority,
	actionToken: "work-models:catch-up:candidate-review:v1",
};
const generated = Object.fromEntries(
	[
		"brainstorm.md",
		"browser.md",
		"debug.md",
		"explain.md",
		"learning.md",
		"plan.md",
		"pov.md",
		"review.md",
		"simplify.md",
		"manifest.json",
		"provenance.json",
	].map((name) => [name, readFileSync(path.join(resourceRoot, name))]),
);
const inventoryBytes = readFileSync(inventoryPath);
const restore = () => {
	for (const [name, bytes] of Object.entries(generated))
		writeFileSync(path.join(resourceRoot, name), bytes);
	writeFileSync(inventoryPath, inventoryBytes);
};

const playbook = dispatchPrivateWorkflow("brainstorm", authority);
check(() => {
	assert.match(playbook, /Ask exactly one focused clarification per turn/);
	assert.match(playbook, /Brainstorm saved: <absolute path>/);
}, "verified brainstorm resource dispatch");
rejects(
	() => dispatchPrivateWorkflow("brainstorm", { ...authority, callerUrl: import.meta.url }),
	/external private workflow caller rejected/,
	"external caller rejection",
);
const debugPlaybook = dispatchPrivateWorkflow("debug", debugAuthority);
check(() => {
	assert.match(debugPlaybook, /Reproduce, root cause, fix, verify/);
	assert.match(debugPlaybook, /causal chain/);
	assert.match(debugPlaybook, /Failure and blocker evidence/);
	assert.match(debugPlaybook, /Actor-visible handoff/);
}, "verified debug resource preserves investigation and blocker contracts");
const learningPlaybook = dispatchPrivateWorkflow("learning", learningAuthority);
check(() => {
	assert.match(learningPlaybook, /Eligibility and skip gate/);
	assert.match(learningPlaybook, /Destination and deduplication/);
	assert.match(learningPlaybook, /wo:learning:<key>=<artifact>/);
	assert.match(learningPlaybook, /created, updated, or skipped/);
}, "verified learning resource preserves destination, deduplication, key, and skip contracts");
const planPlaybook = dispatchPrivateWorkflow("plan", planAuthority);
check(() => {
	assert.match(planPlaybook, /Ask exactly one focused clarification per turn/);
	assert.match(planPlaybook, /Requirement preservation and self-audit/);
	assert.match(planPlaybook, /Open Question Gate/);
	assert.match(planPlaybook, /Actor-visible handoff/);
}, "verified plan resource dispatch preserves the planning contract");
const reviewPlaybook = dispatchPrivateWorkflow("review", reviewAuthority);
const simplifyPlaybook = dispatchPrivateWorkflow("simplify", simplifyAuthority);
const browserPlaybook = dispatchPrivateWorkflow("browser", browserAuthority);
const povPlaybook = dispatchPrivateWorkflow("pov", catchUpAuthority);
const explainPlaybook = dispatchPrivateWorkflow("explain", catchUpAuthority);
check(() => {
	assert.match(reviewPlaybook, /Review is read-only/);
	assert.match(reviewPlaybook, /at most one targeted re-review/);
	assert.match(reviewPlaybook, /wo:review PASS/);
	assert.match(reviewPlaybook, /blocks coded commit and close/);
}, "verified review resource preserves scoped, read-only, bounded-cycle contracts");
check(() => {
	assert.match(simplifyPlaybook, /without changing behavior/);
	assert.match(simplifyPlaybook, /wo:simplify NOOP/);
	assert.match(simplifyPlaybook, /wo:simplify PASS/);
	assert.match(simplifyPlaybook, /last verified behavior unchanged/);
}, "verified simplification resource preserves equivalent-change and no-op contracts");
check(() => {
	assert.match(browserPlaybook, /smallest runnable affected pages/);
	assert.match(browserPlaybook, /wo:browser PASS/);
	assert.match(browserPlaybook, /wo:browser WAIVED/);
	assert.match(browserPlaybook, /coded commit and close remain blocked/);
	assert.notEqual(browserPlaybook, reviewPlaybook);
	assert.notEqual(browserPlaybook, simplifyPlaybook);
}, "verified browser resource preserves affected-UI, waiver, and distinct specialist contracts");
check(() => {
	assert.match(povPlaybook, /every actionable catch-up candidate/);
	assert.match(povPlaybook, /Adopt, Trial, Hold, Reject, or Not-our-problem/);
	assert.match(povPlaybook, /actor-visible recommendation/);
	assert.match(explainPlaybook, /intentionally too-technical/);
	assert.match(explainPlaybook, /never selects, changes, or softens the graded verdict/);
	assert.notEqual(povPlaybook, explainPlaybook);
}, "verified POV and conditional explain resources preserve candidate-review contracts");
const parity = JSON.parse(inventoryBytes).parityIndex;
check(() => {
	assert.deepEqual(
		Object.keys(parity).filter((name) =>
			[
				"ce-brainstorm",
				"ce-code-review",
				"ce-compound",
				"ce-debug",
				"ce-explain",
				"ce-plan",
				"ce-pov",
				"ce-simplify-code",
				"ce-test-browser",
			].includes(name),
		),
		[
			"ce-brainstorm",
			"ce-plan",
			"ce-code-review",
			"ce-simplify-code",
			"ce-test-browser",
			"ce-pov",
			"ce-explain",
			"ce-debug",
			"ce-compound",
		],
	);
	for (const field of ["trigger", "decisions", "toolBoundary", "artifacts", "failure", "actorVisibleOutcome"])
		for (const name of [
			"ce-brainstorm",
			"ce-code-review",
			"ce-compound",
			"ce-debug",
			"ce-plan",
			"ce-pov",
			"ce-explain",
			"ce-simplify-code",
			"ce-test-browser",
		]) assert.ok(parity[name][field]);
	assert.match(playbook, /stop without inventing it/i);
	assert.match(debugPlaybook, /do not guess or report success/i);
	assert.match(learningPlaybook, /Skipping is a successful gate outcome/i);
	assert.match(planPlaybook, /Do not bootstrap.*blocking open questions/i);
	assert.match(reviewPlaybook, /failed.*blocks coded commit and close/i);
	assert.match(simplifyPlaybook, /Missing PASS\/NOOP evidence blocks/i);
	assert.match(browserPlaybook, /not an implicit waiver/i);
	assert.match(povPlaybook, /blocks baseline advancement/i);
	assert.match(explainPlaybook, /keep the candidate undecided/i);
}, "complete private parity matrix covers trigger through actor-visible failure outcome");
rejects(
	() => dispatchPrivateWorkflow("unknown", authority),
	/unknown private workflow/,
	"literal workflow allowlist",
);
rejects(
	() => dispatchPrivateWorkflow("plan", authority),
	/external private workflow caller rejected/,
	"workflow-specific action token rejection",
);
rejects(
	() => dispatchPrivateWorkflow("learning", debugAuthority),
	/external private workflow caller rejected/,
	"debug authority cannot load learning resource",
);
rejects(
	() => dispatchPrivateWorkflow("review", browserAuthority),
	/external private workflow caller rejected/,
	"browser authority cannot load non-equivalent review resource",
);
rejects(
	() => dispatchPrivateWorkflow("pov", planAuthority),
	/external private workflow caller rejected/,
	"plan authority cannot load catch-up POV resource",
);

try {
	const manifest = JSON.parse(generated["manifest.json"]);
	manifest.workflows.brainstorm.path = "../escape.md";
	writeFileSync(path.join(resourceRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	rejects(
		() => dispatchPrivateWorkflow("brainstorm", authority),
		/escapes quarantine/,
		"manifest path escape rejection",
	);
	restore();

	rmSync(path.join(resourceRoot, "brainstorm.md"));
	rejects(
		() => dispatchPrivateWorkflow("brainstorm", authority),
		/ENOENT/,
		"missing resource rejection",
	);
	restore();

	rmSync(path.join(resourceRoot, "debug.md"));
	rejects(
		() => dispatchPrivateWorkflow("debug", debugAuthority),
		/ENOENT/,
		"missing debug resource rejection",
	);
	restore();

	rmSync(path.join(resourceRoot, "learning.md"));
	rejects(
		() => dispatchPrivateWorkflow("learning", learningAuthority),
		/ENOENT/,
		"missing learning resource rejection",
	);
	restore();

	for (const [workflow, workflowAuthority] of [
		["review", reviewAuthority],
		["simplify", simplifyAuthority],
		["browser", browserAuthority],
		["pov", catchUpAuthority],
		["explain", catchUpAuthority],
	]) {
		rmSync(path.join(resourceRoot, `${workflow}.md`));
		rejects(
			() => dispatchPrivateWorkflow(workflow, workflowAuthority),
			/ENOENT/,
			`missing ${workflow} resource rejection`,
		);
		restore();
	}

	writeFileSync(path.join(resourceRoot, "brainstorm.md"), `${playbook}\nmutated\n`);
	rejects(
		() => dispatchPrivateWorkflow("brainstorm", authority),
		/resource changed/,
		"mutated resource rejection",
	);
	restore();

	writeFileSync(path.join(resourceRoot, "debug.md"), `${debugPlaybook}\nmutated\n`);
	rejects(
		() => dispatchPrivateWorkflow("debug", debugAuthority),
		/resource changed: debug/,
		"mutated debug resource rejection",
	);
	restore();

	writeFileSync(path.join(resourceRoot, "learning.md"), `${learningPlaybook}\nmutated\n`);
	rejects(
		() => dispatchPrivateWorkflow("learning", learningAuthority),
		/resource changed: learning/,
		"mutated learning resource rejection",
	);
	restore();

	writeFileSync(path.join(resourceRoot, "plan.md"), `${planPlaybook}\nmutated\n`);
	rejects(
		() => dispatchPrivateWorkflow("plan", planAuthority),
		/resource changed: plan/,
		"mutated plan resource rejection",
	);
	restore();

	for (const [workflow, workflowAuthority, workflowPlaybook] of [
		["review", reviewAuthority, reviewPlaybook],
		["simplify", simplifyAuthority, simplifyPlaybook],
		["browser", browserAuthority, browserPlaybook],
		["pov", catchUpAuthority, povPlaybook],
		["explain", catchUpAuthority, explainPlaybook],
	]) {
		writeFileSync(path.join(resourceRoot, `${workflow}.md`), `${workflowPlaybook}\nmutated\n`);
		rejects(
			() => dispatchPrivateWorkflow(workflow, workflowAuthority),
			new RegExp(`resource changed: ${workflow}`),
			`mutated ${workflow} resource rejection`,
		);
		restore();
	}

	const unverified = JSON.parse(generated["manifest.json"]);
	unverified.verified = false;
	writeFileSync(path.join(resourceRoot, "manifest.json"), `${JSON.stringify(unverified, null, 2)}\n`);
	rejects(
		() => dispatchPrivateWorkflow("brainstorm", authority),
		/unverified private workflow generation/,
		"unverified generation rejection",
	);
	restore();

	const incompleteParity = JSON.parse(inventoryBytes);
	delete incompleteParity.parityIndex["ce-pov"].actorVisibleOutcome;
	writeFileSync(inventoryPath, `${JSON.stringify(incompleteParity, null, 2)}\n`);
	rejects(
		() => dispatchPrivateWorkflow("pov", catchUpAuthority),
		/unknown private workflow ce-pov parity row surface/,
		"incomplete U4 parity row rejection",
	);
} finally {
	restore();
}

const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "private-workflow-translation-"));
try {
	const sourcePath = "skills/ce-brainstorm/SKILL.md";
	const sourceBytes = Buffer.from("---\nname: source-brainstorm\n---\nAsk one question.\n");
	const debugSourcePath = "skills/ce-debug/SKILL.md";
	const debugSourceBytes = Buffer.from("---\nname: source-debug\n---\nReproduce and trace.\n");
	const learningSourcePath = "skills/ce-compound/SKILL.md";
	const learningSourceBytes = Buffer.from("---\nname: source-compound\n---\nCapture learning.\n");
	const planSourcePath = "skills/ce-plan/SKILL.md";
	const planSourceBytes = Buffer.from("---\nname: source-plan\n---\nPreserve and plan.\n");
	const reviewSourcePath = "skills/ce-code-review/SKILL.md";
	const reviewSourceBytes = Buffer.from("---\nname: source-review\n---\nReview the scoped diff.\n");
	const simplifySourcePath = "skills/ce-simplify-code/SKILL.md";
	const simplifySourceBytes = Buffer.from("---\nname: source-simplify\n---\nSimplify equivalently.\n");
	const browserSourcePath = "skills/ce-test-browser/SKILL.md";
	const browserSourceBytes = Buffer.from("---\nname: source-browser\n---\nTest affected pages.\n");
	const povSourcePath = "skills/ce-pov/SKILL.md";
	const povSourceBytes = Buffer.from("---\nname: source-pov\n---\nForm a graded verdict.\n");
	const explainSourcePath = "skills/ce-explain/SKILL.md";
	const explainSourceBytes = Buffer.from("---\nname: source-explain\n---\nTeach the technical subject.\n");
	const fixtureSources = [
		[sourcePath, sourceBytes],
		[debugSourcePath, debugSourceBytes],
		[learningSourcePath, learningSourceBytes],
		[planSourcePath, planSourceBytes],
		[reviewSourcePath, reviewSourceBytes],
		[simplifySourcePath, simplifySourceBytes],
		[browserSourcePath, browserSourceBytes],
		[povSourcePath, povSourceBytes],
		[explainSourcePath, explainSourceBytes],
	];
	for (const [source, bytes] of fixtureSources) {
		const file = path.join(fixtureRoot, ...source.split("/"));
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, bytes);
	}
	const policy = {
		release: "fixture-v1",
		peeledCommitSha: "a".repeat(40),
		archive: { sha256: "b".repeat(64) },
		license: { path: "LICENSE", sha256: "c".repeat(64), spdx: "MIT" },
	};
	const evidence = {
		schemaVersion: 1,
		release: policy.release,
		peeledCommitSha: policy.peeledCommitSha,
		archive: policy.archive,
		licenseEvidence: {
			path: policy.license.path,
			sha256: policy.license.sha256,
			spdx: policy.license.spdx,
			permissionTextPresent: true,
			notices: [],
		},
		runtimeProbe: { zeroEffectiveSurface: true },
		containment: { quarantineRemoved: true, globalStateUnchanged: true },
		inventory: {
			resourceClosures: {
				"ce-brainstorm": [
					{ path: sourcePath, bytes: sourceBytes.length, sha256: sha256(sourceBytes) },
				],
				"ce-debug": [
					{ path: debugSourcePath, bytes: debugSourceBytes.length, sha256: sha256(debugSourceBytes) },
				],
				"ce-compound": [
					{ path: learningSourcePath, bytes: learningSourceBytes.length, sha256: sha256(learningSourceBytes) },
				],
				"ce-plan": [
					{ path: planSourcePath, bytes: planSourceBytes.length, sha256: sha256(planSourceBytes) },
				],
				"ce-code-review": [
					{ path: reviewSourcePath, bytes: reviewSourceBytes.length, sha256: sha256(reviewSourceBytes) },
				],
				"ce-simplify-code": [
					{ path: simplifySourcePath, bytes: simplifySourceBytes.length, sha256: sha256(simplifySourceBytes) },
				],
				"ce-test-browser": [
					{ path: browserSourcePath, bytes: browserSourceBytes.length, sha256: sha256(browserSourceBytes) },
				],
				"ce-pov": [
					{ path: povSourcePath, bytes: povSourceBytes.length, sha256: sha256(povSourceBytes) },
				],
				"ce-explain": [
					{ path: explainSourcePath, bytes: explainSourceBytes.length, sha256: sha256(explainSourceBytes) },
				],
			},
		},
	};
	const args = { sourceRoot: fixtureRoot, evidence, policy, translatorBytes: "translator" };
	const first = translateVerifiedWorkflows(args);
	const second = translateVerifiedWorkflows(args);
	check(
		() => assert.deepEqual(first, second),
		"two offline translations from one verified closure are byte-identical",
	);
	const provenance = JSON.parse(first["provenance.json"]);
	check(() => {
		assert.equal(provenance.release, policy.release);
		for (const [source, bytes] of fixtureSources) {
			const recorded = provenance.sources.find((entry) => entry.path === source);
			assert.equal(recorded?.sha256, sha256(bytes));
		}
		assert.equal(provenance.license.spdx, "MIT");
		assert.equal(provenance.translator.version, 5);
		assert.match(first["debug.md"], /Failure and blocker evidence/);
		assert.match(first["learning.md"], /Destination and deduplication/);
		assert.match(first["plan.md"], /Open Question Gate/);
		assert.match(first["review.md"], /bounded cycle/);
		assert.match(first["simplify.md"], /Equivalent change or no-op/);
		assert.match(first["browser.md"], /Affected UI selection/);
		assert.match(first["pov.md"], /Graded verdict/);
		assert.match(first["explain.md"], /Conditional boundary/);
	}, "nine-workflow release, path, hash, license, and translator provenance");

	check(() => {
		for (const status of ["current", "update", "unknown", "blocked", "failed"])
			assert.equal(
				classifyPrivateWorkflowRelease({ resolution: { status } }).status,
				status,
			);
		assert.equal(
			classifyPrivateWorkflowRelease({ resolution: { status: "update" }, writable: false }).status,
			"non-writable",
		);
		assert.equal(
			classifyPrivateWorkflowRelease({
				resolution: { status: "update" },
				dirtyPaths: ["notes.txt"],
			}).status,
			"unrelated-dirt",
		);
		assert.equal(
			classifyPrivateWorkflowRelease({
				resolution: { status: "update" },
				dirtyPaths: [".ce-workflow/work-items.json", ...PRIVATE_WORKFLOW_OWNED_OUTPUTS],
			}).status,
			"update",
		);
	}, "stable release states distinguish current, update, unknown, blocked, failed, non-writable, and unrelated dirt");
	check(() => {
		const resolution = resolveLatestOfficialStableRelease(
			{
				repository: "https://github.com/EveryInc/compound-engineering-plugin.git",
				release: "compound-engineering-v3.21.0",
				version: "3.21.0",
			},
			{
				execFileSync: () => [
					`${"a".repeat(40)}\trefs/tags/compound-engineering-v3.21.0`,
					`${"b".repeat(40)}\trefs/tags/compound-engineering-v3.22.0`,
					`${"c".repeat(40)}\trefs/tags/compound-engineering-v3.22.0^{}`,
					`${"d".repeat(40)}\trefs/tags/compound-engineering-v3.23.0-rc.1`,
				].join("\n"),
			},
		);
		assert.deepEqual(resolution, {
			status: "update",
			release: "compound-engineering-v3.22.0",
			version: "3.22.0",
			peeledCommitSha: "c".repeat(40),
		});
	}, "official resolver selects the highest stable tag and peeled commit");

	const releaseFixtureRoot = mkdtempSync(path.join(os.tmpdir(), "private-workflow-release-"));
	const makeRepository = (name) => {
		const root = path.join(releaseFixtureRoot, name);
		const canonical = path.join(root, "extensions", "private-workflows");
		mkdirSync(canonical, { recursive: true });
		for (const [file, bytes] of Object.entries(generated)) writeFileSync(path.join(canonical, file), bytes);
		return root;
	};
	const canonicalBytes = (root) => Object.fromEntries(
		PRIVATE_WORKFLOW_OWNED_OUTPUTS.map((relativePath) => [
			relativePath,
			readFileSync(path.join(root, ...relativePath.split("/"))),
		]),
	);
	const assertCanonicalBytes = (root, before) => {
		for (const [relativePath, bytes] of Object.entries(before))
			assert.ok(readFileSync(path.join(root, ...relativePath.split("/"))).equals(bytes), relativePath);
		const artifactRoot = path.join(root, ".ce-workflow", "work-runs", "compound-releases");
		if (existsSync(artifactRoot))
			assert.equal(
				readdirSync(artifactRoot).some((name) => name.startsWith("quarantine-")),
				false,
				"release quarantine is removed",
			);
	};
	const releaseOptions = (root, overrides = {}) => ({
		repositoryRoot: root,
		descriptor: policy,
		resolution: {
			status: "update",
			release: evidence.release,
			version: "1.0.0",
			peeledCommitSha: evidence.peeledCommitSha,
		},
		dirtyPaths: () => [],
		writable: () => true,
		acquireCandidate: async () => ({
			sourceRoot: fixtureRoot,
			evidence: structuredClone(evidence),
			policy: structuredClone(policy),
		}),
		gates: PRIVATE_WORKFLOW_RELEASE_GATES,
		runGate: async () => true,
		...overrides,
	});
	try {
		const firstRoot = makeRepository("success-one");
		const secondRoot = makeRepository("success-two");
		const firstBefore = canonicalBytes(firstRoot);
		const secondBefore = canonicalBytes(secondRoot);
		assert.deepEqual(packageZeroSurface(), expectedZeroSurface);
		const promoted = await promoteVerifiedPrivateWorkflowRelease(releaseOptions(firstRoot));
		const repeated = await promoteVerifiedPrivateWorkflowRelease(releaseOptions(secondRoot));
		const candidateBytes = Object.fromEntries(
			PRIVATE_WORKFLOW_OWNED_OUTPUTS.map((relativePath) => [
				relativePath,
				readFileSync(path.join(promoted.pendingGenerationPath, path.posix.basename(relativePath))),
			]),
		);
		check(() => {
			assert.equal(promoted.status, "promoted", promoted.reason);
			assert.equal(repeated.status, "promoted", repeated.reason);
			assert.deepEqual(promoted.ownedOutputs, PRIVATE_WORKFLOW_OWNED_OUTPUTS);
			assert.deepEqual(promoted.gates, [
				{ name: "u4-private-workflow-parity", status: "passed" },
				{ name: "package-work-goal", status: "passed" },
			]);
			assert.ok(readFileSync(promoted.auditPath).equals(readFileSync(repeated.auditPath)));
			const audit = JSON.parse(readFileSync(promoted.auditPath, "utf8"));
			assert.deepEqual(audit.ownedOutputs, PRIVATE_WORKFLOW_OWNED_OUTPUTS);
			assert.equal(audit.source.toRelease, evidence.release);
			assert.equal(audit.provenance.license.spdx, "MIT");
			assert.equal(audit.provenance.translator.version, 5);
			assert.equal(audit.compatibility.parity.complete, true);
			assert.equal(audit.compatibility.zeroEffectiveSurface, true);
			assert.equal(audit.quarantineRemoved, true);
			assertCanonicalBytes(firstRoot, firstBefore);
			assertCanonicalBytes(secondRoot, secondBefore);
			assert.equal(readPrivateWorkflowActivationState(firstRoot).status, "pending");
			assert.equal(readPrivateWorkflowActivationState(secondRoot).status, "pending");
			assert.deepEqual(packageZeroSurface(), expectedZeroSurface);
			for (const [relativePath, bytes] of Object.entries(firstBefore)) {
				const name = path.posix.basename(relativePath);
				assert.ok(readFileSync(path.join(promoted.retainedGenerationPath, name)).equals(bytes));
			}
		}, "promotion persists pending B and retained A while complete A remains active with zero CE surface");

		const legacyAgentDir = path.join(releaseFixtureRoot, "legacy-agent");
		mkdirSync(
			path.join(legacyAgentDir, "npm", "node_modules", "pi-compound-engineering"),
			{ recursive: true },
		);
		const cleanAgentDir = path.join(releaseFixtureRoot, "clean-agent");
		const independentBefore = {
			playbook: dispatchPrivateWorkflow("brainstorm", authority),
			catchUp: readFileSync(path.join(extensionRoot, "work-catch-up-baseline.json")),
			surface: packageZeroSurface(),
		};
		const activated = activatePendingPrivateWorkflowRelease(firstRoot);
		const activatedWithoutLegacy = activatePendingPrivateWorkflowRelease(secondRoot);
		check(() => {
			assert.equal(
				legacyCompoundRemovalRecommendation(legacyAgentDir),
				"pi remove npm:pi-compound-engineering",
			);
			assert.equal(legacyCompoundRemovalRecommendation(cleanAgentDir), undefined);
			assert.equal(activated.status, "activated", activated.reason);
			assert.equal(activatedWithoutLegacy.status, activated.status);
			assertCanonicalBytes(firstRoot, candidateBytes);
			assertCanonicalBytes(secondRoot, candidateBytes);
			assert.equal(readPrivateWorkflowActivationState(firstRoot).status, "active");
			assert.equal(readPrivateWorkflowActivationState(secondRoot).status, "active");
			assert.deepEqual(
				{
					playbook: dispatchPrivateWorkflow("brainstorm", authority),
					catchUp: readFileSync(path.join(extensionRoot, "work-catch-up-baseline.json")),
					surface: packageZeroSurface(),
				},
				independentBefore,
			);
		}, "legacy presence only returns the exact actor recommendation while release, catch-up, and restart behavior stays identical");
		const rolledBack = rollbackPrivateWorkflowRelease(firstRoot);
		const rolledBackWithoutLegacy = rollbackPrivateWorkflowRelease(secondRoot);
		check(() => {
			assert.deepEqual(
				{
					status: rolledBack.status,
					code: rolledBack.code,
					automatic: rolledBack.automatic,
				},
				{ status: "rolled-back", code: "private-workflow-rollback", automatic: false },
			);
			assert.deepEqual(
				{
					status: rolledBackWithoutLegacy.status,
					code: rolledBackWithoutLegacy.code,
					automatic: rolledBackWithoutLegacy.automatic,
				},
				{
					status: rolledBack.status,
					code: rolledBack.code,
					automatic: rolledBack.automatic,
				},
			);
			assertCanonicalBytes(firstRoot, firstBefore);
			assertCanonicalBytes(secondRoot, secondBefore);
			assert.equal(readPrivateWorkflowActivationState(firstRoot).status, "rolled-back");
			assert.equal(readPrivateWorkflowActivationState(secondRoot).status, "rolled-back");
			assert.deepEqual(packageZeroSurface(), expectedZeroSurface);
		}, "coded rollback is identical with the legacy package present or absent");
		const persistedRollback = activatePendingPrivateWorkflowRelease(firstRoot);
		check(() => {
			assert.equal(persistedRollback.status, "rolled-back");
			assert.equal(persistedRollback.code, rolledBack.code);
			assert.equal(persistedRollback.reason, rolledBack.reason);
			assert.equal(persistedRollback.alreadyReported, true);
			assert.equal(privateWorkflowActivationWarning(persistedRollback), undefined);
			assert.equal(
				privateWorkflowActivationWarning(rolledBack),
				`Private workflow activation rolled-back (${rolledBack.code}): ${rolledBack.reason}`,
			);
		}, "persisted rollback stays quiet while fresh coded rollback remains actor-visible");

		const failureCases = [
			["acquisition failure", { acquireCandidate: async () => { throw new Error("network failed"); } }],
			["failing gate", { runGate: async (gate) => gate.name !== "package-work-goal" }],
			["incomplete parity", { parityCheck: () => { throw new Error("incomplete parity"); } }],
			["interrupted quarantine", { interrupt: (phase) => { if (phase === "after-gates") throw new Error("interrupted"); } }],
			["interrupted prior retention", { interrupt: (phase) => { if (phase === "after-prior-retention") throw new Error("interrupted"); } }],
			["interrupted pending retention", { interrupt: (phase) => { if (phase === "after-pending-retention") throw new Error("interrupted"); } }],
		];
		for (const [label, overrides] of failureCases) {
			const root = makeRepository(label.replaceAll(" ", "-"));
			const before = canonicalBytes(root);
			const result = await promoteVerifiedPrivateWorkflowRelease(releaseOptions(root, overrides));
			check(() => {
				assert.notEqual(result.status, "promoted");
				assertCanonicalBytes(root, before);
			}, `${label} preserves canonical bytes and removes quarantine`);
		}

		const mutatedSourceRoot = makeRepository("mutated-source");
		const mutatedSourceBefore = canonicalBytes(mutatedSourceRoot);
		const sourceFile = path.join(fixtureRoot, ...sourcePath.split("/"));
		const sourceOriginal = readFileSync(sourceFile);
		const mutatedSource = await promoteVerifiedPrivateWorkflowRelease(releaseOptions(mutatedSourceRoot, {
			interrupt: (phase) => {
				if (phase === "after-first-generation") writeFileSync(sourceFile, "mutated\n");
			},
		}));
		writeFileSync(sourceFile, sourceOriginal);
		check(() => {
			assert.equal(mutatedSource.status, "blocked");
			assertCanonicalBytes(mutatedSourceRoot, mutatedSourceBefore);
		}, "mutated verified source preserves canonical bytes and removes quarantine");

		for (const phase of ["after-active-rename", "after-candidate-rename"]) {
			const root = makeRepository(`activation-${phase}`);
			const before = canonicalBytes(root);
			await promoteVerifiedPrivateWorkflowRelease(releaseOptions(root));
			const result = activatePendingPrivateWorkflowRelease(root, {
				interrupt: (current) => {
					if (current === phase) throw new Error(`interrupted ${phase}`);
				},
			});
			check(() => {
				assert.equal(result.status, "rolled-back");
				assert.equal(result.code, "private-workflow-rollback");
				assertCanonicalBytes(root, before);
			}, `${phase} activation interruption restores complete A with coded rollback`);
		}

		for (const phase of ["after-current-rename", "after-retained-rename"]) {
			const root = makeRepository(`rollback-${phase}`);
			const before = canonicalBytes(root);
			await promoteVerifiedPrivateWorkflowRelease(releaseOptions(root));
			assert.equal(activatePendingPrivateWorkflowRelease(root).status, "activated");
			const result = rollbackPrivateWorkflowRelease(root, {
				interrupt: (current) => {
					if (current === phase) throw new Error(`interrupted ${phase}`);
				},
			});
			check(() => {
				assert.equal(result.status, "rolled-back");
				assert.equal(result.code, "private-workflow-rollback");
				assertCanonicalBytes(root, before);
			}, `${phase} rollback interruption restores complete A without mixed outputs`);
		}

		for (const failure of ["missing-retained", "mutated-retained", "failed-verification"]) {
			const root = makeRepository(failure);
			const before = canonicalBytes(root);
			const result = await promoteVerifiedPrivateWorkflowRelease(releaseOptions(root));
			if (failure === "missing-retained")
				rmSync(result.retainedGenerationPath, { recursive: true, force: true });
			if (failure === "mutated-retained")
				writeFileSync(path.join(result.retainedGenerationPath, "brainstorm.md"), "mutated\n");
			const activation = activatePendingPrivateWorkflowRelease(
				root,
				failure === "failed-verification"
					? { verify: () => { throw new Error("simulated next-start verification failure"); } }
					: {},
			);
			check(() => {
				assert.equal(activation.status, "rolled-back");
				assert.equal(activation.code, "private-workflow-rollback");
				assertCanonicalBytes(root, before);
			}, `${failure} next-start check preserves complete A and never mixes generations`);
		}

		const mutatedCanonicalRoot = makeRepository("mutated-canonical");
		const mutatedCanonicalBefore = canonicalBytes(mutatedCanonicalRoot);
		const mutatedCanonical = await promoteVerifiedPrivateWorkflowRelease(releaseOptions(mutatedCanonicalRoot, {
			interrupt: (phase) => {
				if (phase === "after-gates")
					writeFileSync(
						path.join(mutatedCanonicalRoot, "extensions", "private-workflows", "brainstorm.md"),
						"mutated\n",
					);
			},
		}));
		check(() => {
			assert.equal(mutatedCanonical.status, "blocked");
			assertCanonicalBytes(mutatedCanonicalRoot, mutatedCanonicalBefore);
		}, "canonical mutation during audit restores exact prior bytes and removes quarantine");
	} finally {
		rmSync(releaseFixtureRoot, { recursive: true, force: true });
	}

	writeFileSync(path.join(fixtureRoot, ...planSourcePath.split("/")), "changed\n");
	rejects(
		() => translateVerifiedWorkflows(args),
		/verified source resource changed/,
		"mutated verified closure rejection",
	);
	evidence.runtimeProbe.zeroEffectiveSurface = false;
	rejects(
		() => translateVerifiedWorkflows(args),
		/unverified U1 source evidence/,
		"unverified source generation rejection",
	);
} finally {
	rmSync(fixtureRoot, { recursive: true, force: true });
}

check(() => {
	const packageManifest = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
	assert.deepEqual(packageZeroSurface(), expectedZeroSurface);
	assert.deepEqual(packageManifest.pi.extensions, ["extensions/work-models.js"]);
	assert.deepEqual(packageManifest.pi.skills, ["./skills"]);
	assert.equal(packageManifest.peerDependencies["pi-compound-engineering"], undefined);
}, "clean package runtime exposes zero private or CE surface");

console.log(`PASS test-work-private-workflows (${checks} offline checks) zeroSurface=true`);
