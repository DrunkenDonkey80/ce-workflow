import assert from "node:assert/strict";
import {
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
import { dispatchPrivateWorkflow } from "../extensions/work-private-workflows.js";
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
const authority = {
	actionToken: "work-models:F7:brainstorm:v1",
	callerUrl: pathToFileURL(path.join(extensionRoot, "work-models.js")).href,
};
const planAuthority = { ...authority, actionToken: "work-models:F7:plan:v1" };
const generated = Object.fromEntries(
	["brainstorm.md", "plan.md", "manifest.json", "provenance.json"].map((name) => [
		name,
		readFileSync(path.join(resourceRoot, name)),
	]),
);
const restore = () => {
	for (const [name, bytes] of Object.entries(generated))
		writeFileSync(path.join(resourceRoot, name), bytes);
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
const planPlaybook = dispatchPrivateWorkflow("plan", planAuthority);
check(() => {
	assert.match(planPlaybook, /Ask exactly one focused clarification per turn/);
	assert.match(planPlaybook, /Requirement preservation and self-audit/);
	assert.match(planPlaybook, /Open Question Gate/);
	assert.match(planPlaybook, /Actor-visible handoff/);
}, "verified plan resource dispatch preserves the planning contract");
const parity = JSON.parse(
	readFileSync(path.join(extensionRoot, "work-compound-inventory.json"), "utf8"),
).parityIndex;
check(() => {
	assert.deepEqual(Object.keys(parity).filter((name) => ["ce-brainstorm", "ce-plan"].includes(name)), [
		"ce-brainstorm",
		"ce-plan",
	]);
	for (const field of ["trigger", "decisions", "toolBoundary", "artifacts", "failure", "actorVisibleOutcome"])
		assert.ok(parity["ce-brainstorm"][field] && parity["ce-plan"][field]);
	assert.match(playbook, /stop without inventing it/i);
	assert.match(planPlaybook, /Do not bootstrap.*blocking open questions/i);
}, "brainstorm and plan parity rows cover trigger through actor-visible failure outcome");
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

	writeFileSync(path.join(resourceRoot, "brainstorm.md"), `${playbook}\nmutated\n`);
	rejects(
		() => dispatchPrivateWorkflow("brainstorm", authority),
		/resource changed/,
		"mutated resource rejection",
	);
	restore();

	writeFileSync(path.join(resourceRoot, "plan.md"), `${planPlaybook}\nmutated\n`);
	rejects(
		() => dispatchPrivateWorkflow("plan", planAuthority),
		/resource changed: plan/,
		"mutated plan resource rejection",
	);
	restore();

	const unverified = JSON.parse(generated["manifest.json"]);
	unverified.verified = false;
	writeFileSync(path.join(resourceRoot, "manifest.json"), `${JSON.stringify(unverified, null, 2)}\n`);
	rejects(
		() => dispatchPrivateWorkflow("brainstorm", authority),
		/unverified private workflow generation/,
		"unverified generation rejection",
	);
} finally {
	restore();
}

const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "private-workflow-translation-"));
try {
	const sourcePath = "skills/ce-brainstorm/SKILL.md";
	const sourceBytes = Buffer.from("---\nname: source-brainstorm\n---\nAsk one question.\n");
	const planSourcePath = "skills/ce-plan/SKILL.md";
	const planSourceBytes = Buffer.from("---\nname: source-plan\n---\nPreserve and plan.\n");
	const target = path.join(fixtureRoot, ...sourcePath.split("/"));
	const planTarget = path.join(fixtureRoot, ...planSourcePath.split("/"));
	mkdirSync(path.dirname(target), { recursive: true });
	mkdirSync(path.dirname(planTarget), { recursive: true });
	writeFileSync(target, sourceBytes);
	writeFileSync(planTarget, planSourceBytes);
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
				"ce-plan": [
					{ path: planSourcePath, bytes: planSourceBytes.length, sha256: sha256(planSourceBytes) },
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
		assert.equal(provenance.sources[0].path, sourcePath);
		assert.equal(provenance.sources[0].sha256, sha256(sourceBytes));
		assert.equal(provenance.sources[1].path, planSourcePath);
		assert.equal(provenance.sources[1].sha256, sha256(planSourceBytes));
		assert.equal(provenance.license.spdx, "MIT");
		assert.equal(provenance.translator.version, 2);
		assert.match(first["plan.md"], /Open Question Gate/);
	}, "brainstorm and plan release, path, hash, license, and translator provenance");
	writeFileSync(planTarget, "changed\n");
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
const zeroSurface = {
	commands,
	skillDescriptions,
	extensionHooks,
	resourceRoots,
	modelInvocableEntries: [
		...commands.map((name) => `command:${name}`),
		...skillDescriptions.map((name) => `skill:${name}`),
	],
};
check(() => {
	assert.deepEqual(zeroSurface, {
		commands: [],
		skillDescriptions: [],
		extensionHooks: [],
		resourceRoots: [],
		modelInvocableEntries: [],
	});
	assert.deepEqual(packageManifest.pi.extensions, ["extensions/work-models.js"]);
	assert.deepEqual(packageManifest.pi.skills, ["./skills"]);
}, "clean package runtime exposes zero private or CE surface");

console.log(`PASS test-work-private-workflows (${checks} offline checks) zeroSurface=true`);
