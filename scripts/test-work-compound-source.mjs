import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	inspectCompoundSource,
	quarantineWasRemoved,
	readConfinedFile,
	sha256,
	withCompoundQuarantine,
} from "../extensions/work-compound-source.js";

let checks = 0;
const check = (fn, label) => {
	fn();
	checks++;
	process.stdout.write(`ok ${checks} - ${label}\n`);
};
const rejects = (fn, expression, label) =>
	check(() => assert.throws(fn, expression), label);

function fixture() {
	const root = path.join(os.tmpdir(), `ce-source-fixture-${process.pid}-${Date.now()}`);
	const manifest = {
		name: "compound-fixture",
		version: "1.0.0",
		repository: "https://example.test/official.git",
		pi: { extensions: ["./extension.js"], skills: ["./skills"] },
	};
	const files = {
		"package.json": `${JSON.stringify(manifest, null, 2)}\n`,
		LICENSE: "MIT License\nPermission is hereby granted, free of charge\n",
		"skills/ce-alpha/SKILL.md": "---\nname: ce-alpha\n---\nRead references/guide.md.\n",
		"skills/ce-alpha/references/guide.md": "verified guide\n",
	};
	for (const [relative, content] of Object.entries(files)) {
		const target = path.join(root, ...relative.split("/"));
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
	const entries = Object.keys(files).map((entryPath) => ({
		mode: "100644",
		stage: "0",
		path: entryPath,
	}));
	const policy = {
		peeledCommitSha: "a".repeat(40),
		version: manifest.version,
		packageIdentity: { name: manifest.name, repository: manifest.repository },
		knownManifestKeys: Object.keys(manifest),
		knownPiManifestKeys: Object.keys(manifest.pi),
		declaredPiSurface: manifest.pi,
		license: {
			path: "LICENSE",
			spdx: "MIT",
			sha256: sha256(files.LICENSE),
			requiredPermissionText: "Permission is hereby granted, free of charge",
		},
		notices: [],
		workflows: ["ce-alpha"],
	};
	return {
		root,
		manifest,
		entries,
		policy,
		inspect: (overrides = {}) =>
			inspectCompoundSource({
				root,
				policy,
				commitSha: policy.peeledCommitSha,
				trackedEntries: entries,
				...overrides,
			}),
	};
}

const positive = fixture();
try {
	const result = positive.inspect();
	check(() => assert.equal(result.packageIdentity.name, "compound-fixture"), "positive identity");
	check(() => assert.equal(result.importedFiles.length, 2), "complete workflow closure hashes");
	check(
		() => assert.equal(result.sourceReadProof[0].exactAllowlistedRead, true),
		"exact allowlisted source read proof",
	);
	rejects(
		() => positive.inspect({ commitSha: "b".repeat(40) }),
		/commit identity mismatch/,
		"commit identity mismatch",
	);
	rejects(
		() => readConfinedFile(positive.root, "../outside", new Set()),
		/escapes quarantine/,
		"lexical path containment",
	);
	rejects(
		() => readConfinedFile(positive.root, "skills\\ce-alpha\\SKILL.md"),
		/unsafe source path/,
		"backslash path ambiguity",
	);
	rejects(
		() =>
			positive.inspect({
				trackedEntries: [...positive.entries, { mode: "120000", stage: "0", path: "link" }],
			}),
		/source symlink rejected/,
		"tracked symlink rejection",
	);
	rejects(
		() =>
			positive.inspect({
				trackedEntries: [
					...positive.entries,
					{ mode: "100644", stage: "0", path: "skills/ce-alpha/references/GUIDE.md" },
				],
			}),
		/Windows path collision/,
		"Windows case-fold collision",
	);
	rejects(
		() =>
			positive.inspect({
				trackedEntries: [...positive.entries, { mode: "100644", stage: "0", path: "docs/CON" }],
			}),
		/not Windows portable/,
		"Windows reserved path rejection",
	);

	const unknownManifest = { ...positive.manifest, modelContextProtocolServers: {} };
	writeFileSync(path.join(positive.root, "package.json"), JSON.stringify(unknownManifest));
	rejects(() => positive.inspect(), /unknown package manifest surface/, "unknown manifest surface");
	writeFileSync(path.join(positive.root, "package.json"), JSON.stringify(positive.manifest));
	const unknownPi = { ...positive.manifest, pi: { ...positive.manifest.pi, prompts: ["./prompts"] } };
	writeFileSync(path.join(positive.root, "package.json"), JSON.stringify(unknownPi));
	rejects(() => positive.inspect(), /unknown Pi manifest surface/, "unknown Pi discovery surface");
	writeFileSync(path.join(positive.root, "package.json"), JSON.stringify(positive.manifest));

	rejects(
		() => positive.inspect({ trackedEntries: positive.entries.filter((entry) => !entry.path.endsWith("guide.md")) }),
		/unresolved source reference/,
		"unresolved closure reference",
	);
	writeFileSync(path.join(positive.root, "LICENSE"), "MIT License\n");
	rejects(() => positive.inspect(), /license identity/, "license identity and permission evidence");
} finally {
	rmSync(positive.root, { recursive: true, force: true });
}

let successfulPath;
const successful = await withCompoundQuarantine(async (quarantinePath) => {
	successfulPath = quarantinePath;
	writeFileSync(path.join(quarantinePath, "readable.txt"), "ok");
	return "done";
});
check(() => assert.equal(successful.value, "done"), "quarantine callback result");
check(() => assert.equal(quarantineWasRemoved(successfulPath), true), "quarantine cleanup on success");
let failedPath;
await assert.rejects(
	withCompoundQuarantine(async (quarantinePath) => {
		failedPath = quarantinePath;
		throw new Error("fixture failure");
	}),
	/fixture failure/,
);
check(() => assert.equal(quarantineWasRemoved(failedPath), true), "quarantine cleanup on failure");

console.log(`PASS test-work-compound-source (${checks} offline checks)`);
