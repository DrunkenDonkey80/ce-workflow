import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	inspectCompoundSource,
	quarantineWasRemoved,
	scanRepositoryCallSites,
	sha256,
	withCompoundQuarantine,
} from "../extensions/work-compound-source.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "..");
const policy = JSON.parse(
	readFileSync(path.join(repositoryRoot, "extensions", "work-compound-source-policy.json"), "utf8"),
);
const inventory = JSON.parse(
	readFileSync(path.join(repositoryRoot, "extensions", "work-compound-inventory.json"), "utf8"),
);

function parseArguments(args) {
	const options = { requireZeroSurface: false, requireCleanup: false };
	for (let index = 0; index < args.length; index++) {
		if (args[index] === "--release") options.release = args[++index];
		else if (args[index] === "--require-zero-surface") options.requireZeroSurface = true;
		else if (args[index] === "--require-cleanup") options.requireCleanup = true;
		else throw new Error(`unknown argument: ${args[index]}`);
	}
	if (!options.release) throw new Error("--release is required");
	if (options.release !== policy.release) throw new Error(`untrusted release: ${options.release}`);
	return options;
}

function resolveCodingAgentPackage() {
	const candidates = [];
	if (process.env.PI_CODING_AGENT_PACKAGE_ROOT)
		candidates.push(process.env.PI_CODING_AGENT_PACKAGE_ROOT);
	if (process.platform === "win32" && process.env.APPDATA)
		candidates.push(path.join(process.env.APPDATA, "npm", "node_modules", "@earendil-works", "pi-coding-agent"));
	if (process.platform !== "win32") {
		const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
		candidates.push(path.join(npmRoot, "@earendil-works", "pi-coding-agent"));
	}
	const found = candidates.find((candidate) => existsSync(path.join(candidate, "dist", "core", "resource-loader.js")));
	if (!found) throw new Error("installed @earendil-works/pi-coding-agent runtime was not found");
	return found;
}

function snapshotDirectory(root) {
	const hash = createHash("sha256");
	let entries = 0;
	function visit(current, relative = "") {
		if (!existsSync(current)) return;
		for (const name of readdirSync(current).sort()) {
			const absolute = path.join(current, name);
			const childRelative = relative ? `${relative}/${name}` : name;
			const stat = lstatSync(absolute);
			hash.update(`${childRelative}\0${stat.isDirectory() ? "d" : stat.isSymbolicLink() ? "l" : "f"}\0${stat.size}\0${stat.mtimeMs}\0`);
			entries++;
			if (stat.isDirectory()) visit(absolute, childRelative);
		}
	}
	visit(root);
	return { path: root, exists: existsSync(root), entries, metadataSha256: hash.digest("hex") };
}

function snapshotGlobalPiState() {
	const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
	const settingsPath = path.join(agentDir, "settings.json");
	return {
		agentDir,
		settings: existsSync(settingsPath)
			? { exists: true, bytes: statSync(settingsPath).size, sha256: sha256(readFileSync(settingsPath)) }
			: { exists: false },
		gitPackages: snapshotDirectory(path.join(agentDir, "git")),
		npmPackages: snapshotDirectory(path.join(agentDir, "npm")),
	};
}

function remoteReleaseSha() {
	const ref = `refs/tags/${policy.release}`;
	const lines = execFileSync("git", ["ls-remote", policy.repository, ref, `${ref}^{}`], {
		encoding: "utf8",
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	})
		.trim()
		.split(/\r?\n/)
		.filter(Boolean);
	const refs = new Map(lines.map((line) => line.split(/\s+/, 2).reverse()));
	const peeled = refs.get(`${ref}^{}`) ?? refs.get(ref);
	if (peeled !== policy.peeledCommitSha)
		throw new Error(`release tag identity mismatch: observed ${peeled ?? "missing"}`);
	return peeled;
}

async function downloadArchive(target) {
	const response = await fetch(policy.archive.url, { redirect: "follow" });
	if (!response.ok) throw new Error(`archive download failed: HTTP ${response.status}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	writeFileSync(target, bytes);
	const observed = { bytes: bytes.length, sha256: sha256(bytes), url: response.url };
	if (observed.bytes !== policy.archive.bytes || observed.sha256 !== policy.archive.sha256)
		throw new Error(`archive identity mismatch: ${JSON.stringify(observed)}`);
	return observed;
}

function sourceRelative(sourceRoot, absolute) {
	return path.relative(sourceRoot, absolute).split(path.sep).join("/");
}

function officialSurface(loader, resolved, sourceRoot) {
	const extensionResult = loader.getExtensions();
	const extensions = extensionResult.extensions.filter((entry) =>
		path.resolve(entry.resolvedPath).startsWith(`${path.resolve(sourceRoot)}${path.sep}`),
	);
	const skills = loader.getSkills().skills.filter((skill) =>
		path.resolve(skill.filePath).startsWith(`${path.resolve(sourceRoot)}${path.sep}`),
	);
	const commands = extensions.flatMap((entry) => [...entry.commands.keys()]);
	const tools = extensions.flatMap((entry) => [...entry.tools.keys()]);
	const extensionHooks = extensions.flatMap((entry) => [...entry.handlers.keys()]);
	const resourceRoots = [
		...resolved.extensions
			.filter(
				(entry) =>
					entry.enabled &&
					entry.metadata.baseDir &&
					path.resolve(entry.metadata.baseDir) === path.resolve(sourceRoot),
			)
			.map((entry) => ({ type: "extension", path: sourceRelative(sourceRoot, entry.path) })),
		...resolved.skills
			.filter(
				(entry) =>
					entry.enabled &&
					entry.metadata.baseDir &&
					path.resolve(entry.metadata.baseDir) === path.resolve(sourceRoot),
			)
			.map((entry) => ({ type: "skill", path: sourceRelative(sourceRoot, entry.path) })), 
	];
	return {
		commands: commands.sort(),
		skillCatalog: skills.map((skill) => skill.name).sort(),
		skillDescriptions: skills
			.map((skill) => ({ name: skill.name, description: skill.description }))
			.sort((left, right) => left.name.localeCompare(right.name)),
		extensionHooks: extensionHooks.sort(),
		extensionPaths: extensions.map((entry) => sourceRelative(sourceRoot, entry.resolvedPath)).sort(),
		resourceRoots,
		tools: tools.sort(),
		modelInvocableEntries: [
			...commands.map((name) => `command:${name}`),
			...tools.map((name) => `tool:${name}`),
			...skills.map((skill) => `skill:${skill.name}`),
		].sort(),
	};
}

function assertZeroSurface(surface) {
	for (const [name, entries] of Object.entries(surface)) {
		if (entries.length) throw new Error(`filtered official source exposed ${name}: ${JSON.stringify(entries)}`);
	}
}

const options = parseArguments(process.argv.slice(2));
const globalStateBefore = snapshotGlobalPiState();
const peeledCommitSha = remoteReleaseSha();
const codingAgentPackage = resolveCodingAgentPackage();
const codingAgentIdentity = JSON.parse(readFileSync(path.join(codingAgentPackage, "package.json"), "utf8"));
let quarantinePath;
const quarantined = await withCompoundQuarantine(async (root) => {
	quarantinePath = root;
	const archive = await downloadArchive(path.join(root, "official-release.tar.gz"));
	const agentDir = path.join(root, "pi-agent");
	mkdirSync(agentDir, { recursive: true });
	const moduleRoot = path.join(codingAgentPackage, "dist", "core");
	const { SettingsManager } = await import(pathToFileURL(path.join(moduleRoot, "settings-manager.js")));
	const { DefaultPackageManager } = await import(pathToFileURL(path.join(moduleRoot, "package-manager.js")));
	const { DefaultResourceLoader } = await import(pathToFileURL(path.join(moduleRoot, "resource-loader.js")));
	const source = `git:github.com/EveryInc/compound-engineering-plugin@${peeledCommitSha}`;
	const baselineSettings = SettingsManager.inMemory({ packages: [source] }, { projectTrusted: false });
	const packageManager = new DefaultPackageManager({ cwd: root, agentDir, settingsManager: baselineSettings });
	await packageManager.install(source);
	const sourceRoot = packageManager.getInstalledPath(source, "user");
	if (!sourceRoot) throw new Error("temporary Pi package source path was not resolved");
	const checkoutSha = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	const sourceInspection = inspectCompoundSource({ root: sourceRoot, policy, commitSha: checkoutSha });

	const baselineResolved = await packageManager.resolve();
	const baselineLoader = new DefaultResourceLoader({
		cwd: root,
		agentDir,
		settingsManager: baselineSettings,
		noContextFiles: true,
		noPromptTemplates: true,
		noThemes: true,
	});
	await baselineLoader.reload();
	const beforeFiltering = officialSurface(baselineLoader, baselineResolved, sourceRoot);

	const filteredEntry = {
		source,
		extensions: [],
		skills: [],
		prompts: [],
		themes: [],
	};
	const filteredSettings = SettingsManager.inMemory({ packages: [filteredEntry] }, { projectTrusted: false });
	const filteredManager = new DefaultPackageManager({ cwd: root, agentDir, settingsManager: filteredSettings });
	const filteredResolved = await filteredManager.resolve();
	const filteredLoader = new DefaultResourceLoader({
		cwd: root,
		agentDir,
		settingsManager: filteredSettings,
		noContextFiles: true,
		noPromptTemplates: true,
		noThemes: true,
	});
	await filteredLoader.reload();
	const afterFiltering = officialSurface(filteredLoader, filteredResolved, sourceRoot);
	if (options.requireZeroSurface) assertZeroSurface(afterFiltering);

	const repositoryInventory = scanRepositoryCallSites({
		root: repositoryRoot,
		inventory,
		workflowNames: policy.workflows,
	});
	const importedByPath = new Map(sourceInspection.importedFiles.map((entry) => [entry.path, entry]));
	const resourceClosures = Object.fromEntries(
		Object.entries(sourceInspection.closures).map(([workflow, paths]) => [
			workflow,
			paths.map((entry) => importedByPath.get(entry)),
		]),
	);
	return {
		archive,
		source,
		checkoutSha,
		sourceInspection,
		filteredEntry,
		beforeFiltering,
		afterFiltering,
		repositoryInventory,
		resourceClosures,
	};
});
const quarantineRemoved = quarantineWasRemoved(quarantinePath);
if (options.requireCleanup && !quarantineRemoved)
	throw new Error(`quarantine was not removed: ${quarantinePath}`);
const globalStateAfter = snapshotGlobalPiState();
if (JSON.stringify(globalStateBefore) !== JSON.stringify(globalStateAfter))
	throw new Error("global Pi settings or installed package state changed during probe");

const evidence = {
	schemaVersion: 1,
	createdAt: new Date().toISOString(),
	release: policy.release,
	peeledCommitSha,
	archive: quarantined.value.archive,
	packageIdentity: quarantined.value.sourceInspection.packageIdentity,
	licenseEvidence: quarantined.value.sourceInspection.licenseEvidence,
	sourceReadProof: quarantined.value.sourceInspection.sourceReadProof,
	importedFiles: quarantined.value.sourceInspection.importedFiles,
	runtimeProbe: {
		piPackageEntry: quarantined.value.filteredEntry,
		piRuntime: { name: codingAgentIdentity.name, version: codingAgentIdentity.version },
		beforeFiltering: quarantined.value.beforeFiltering,
		afterFiltering: quarantined.value.afterFiltering,
		zeroEffectiveSurface: Object.values(quarantined.value.afterFiltering).every((entries) => entries.length === 0),
	},
	inventory: {
		release: inventory.release,
		parityIndex: inventory.parityIndex,
		mentions: quarantined.value.repositoryInventory.mentions,
		callSites: quarantined.value.repositoryInventory.callSites,
		resourceClosures: quarantined.value.resourceClosures,
	},
	containment: {
		quarantinePath,
		quarantineRemoved,
		temporaryPiStateOnly: true,
		globalStateBefore,
		globalStateAfter,
		globalStateUnchanged: true,
	},
};
const evidencePath = path.join(
	repositoryRoot,
	".ce-workflow",
	"work-runs",
	"compound-source",
	`${policy.release}.json`,
);
mkdirSync(path.dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(
	`PASS probe-work-compound-source release=${policy.release} sha=${peeledCommitSha} archive=${evidence.archive.sha256} imported=${evidence.importedFiles.length} callSites=${evidence.inventory.callSites.length} zeroSurface=${evidence.runtimeProbe.zeroEffectiveSurface} quarantineRemoved=${quarantineRemoved}`,
);
console.log(`evidence=${evidencePath}`);
