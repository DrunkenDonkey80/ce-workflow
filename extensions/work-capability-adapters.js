import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const VERSION = "1";
const adapters = new Map();

function artifact(root, kind, candidate) {
	const file = path.resolve(root, candidate);
	if (!existsSync(file) || !statSync(file).isFile())
		throw new Error(`adapter artifact is missing: ${candidate}`);
	const bytes = readFileSync(file);
	return {
		kind,
		path: path.relative(root, file).replaceAll("\\", "/"),
		bytes: bytes.length,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
}

function assertionsPass(assertions, result, root) {
	for (const assertion of assertions ?? []) {
		const actual =
			assertion.target === "exit"
				? String(result.status)
				: assertion.target === "file"
					? path.resolve(root, assertion.path)
					: String(result[assertion.target] ?? "");
		const ok =
			assertion.operator === "exists"
				? existsSync(actual)
				: assertion.operator === "equals"
					? actual === assertion.value
					: assertion.operator === "includes"
						? actual.includes(assertion.value)
						: assertion.operator === "matches"
							? new RegExp(assertion.value).test(actual)
							: assertion.operator === "sha256" &&
								createHash("sha256")
									.update(readFileSync(actual))
									.digest("hex") === assertion.value;
		if (!ok) throw new Error(`adapter assertion failed: ${JSON.stringify(assertion)}`);
	}
}

export function registerCapabilityAdapter(capability, adapter) {
	if (adapters.has(capability)) throw new Error(`adapter already registered: ${capability}`);
	adapters.set(capability, adapter);
}

export function capabilityAdapter(capability) {
	return adapters.get(capability);
}

export function runCapabilityAdapter({ cwd, requirement, revision, inspection }) {
	const adapter = capabilityAdapter(requirement.capability);
	if (!adapter)
		return {
			status: "BLOCKED",
			blocker: {
				code: `${requirement.capability}-adapter-unavailable`,
				resumeAction: `Configure a ${requirement.capability} adapter and rerun proof ${requirement.id}.`,
			},
		};
	return adapter.run({ cwd, requirement, revision, inspection });
}

registerCapabilityAdapter("browser", {
	id: "ce.browser.command",
	version: VERSION,
	run({ cwd, requirement, revision, inspection }) {
		const operation = requirement.operation ?? {};
		if (!operation.command)
			return {
				status: "BLOCKED",
				blocker: {
					code: "browser-runner-unconfigured",
					resumeAction: `Declare verificationContract entry ${requirement.id}.operation.command for the available browser provider.`,
				},
			};
		const executionRoot = path.resolve(cwd, operation.cwd ?? ".");
		mkdirSync(path.join(cwd, ".pi", "work-artifacts"), { recursive: true });
		const started = Date.now();
		const result = spawnSync(operation.command, {
			cwd: executionRoot,
			env: { ...process.env, ...(operation.env ?? {}) },
			shell: true,
			encoding: "utf8",
			timeout: Math.min(operation.timeoutMs ?? 120_000, 900_000),
			maxBuffer: 2 * 1024 * 1024,
		});
		const stdout = String(result.stdout ?? "");
		const stderr = String(result.stderr ?? "");
		if (result.error || result.status !== (operation.expectedExit ?? 0))
			return {
				status: "FAIL",
				detail: (result.error?.message ?? stderr ?? stdout).slice(0, 2_000),
				operation: { command: operation.command, durationMs: Date.now() - started },
			};
		assertionsPass(operation.assertions, { status: result.status, stdout, stderr }, executionRoot);
		let payload = {};
		try {
			payload = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
		} catch {
			// Artifact-free browser checks may rely only on declared assertions.
		}
		if (payload.cleanup?.ok === false)
			return { status: "FAIL", detail: "browser runner cleanup failed" };
		const artifacts = Object.entries(payload.artifacts ?? {}).map(([kind, file]) =>
			artifact(cwd, kind, file),
		);
		for (const kind of requirement.artifacts ?? [])
			if (!artifacts.some((entry) => entry.kind === kind))
				throw new Error(`browser runner did not produce required ${kind} artifact`);
		return {
			status: "PASS",
			targetRevision: revision,
			issuer: { type: "adapter", capability: "browser", id: this.id, version: this.version },
			operation: {
				command: operation.command,
				durationMs: Date.now() - started,
				cleanup: payload.cleanup ?? { ok: true },
				stdout: stdout.slice(0, 8_000),
				stderr: stderr.slice(0, 8_000),
			},
			artifacts,
			...(inspection ? { inspection: { by: "goal", summary: inspection } } : {}),
		};
	},
});
