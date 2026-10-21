// Pi's own SDK, loaded from Pi's managed install: the hub reads auth, models, settings and session files the way a running Pi does.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { agentDir } from "./rpc-client.ts";

const sdks = new Map<string, Promise<any>>(), runtimes = new Map<string, Promise<any>>();

export function piSdk(dir = agentDir()): Promise<any> {
	// shortcut: only Pi's managed install (agent/install/current-version) is found; add a `pi` path lookup if a hub runs beside an npm-installed Pi.
	if (!sdks.has(dir)) {
		const version = readFileSync(join(dir, "install", "current-version"), "utf8").trim();
		sdks.set(dir, import(pathToFileURL(join(dir, "install", "releases", version, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js")).href));
	}
	return sdks.get(dir)!;
}

/** One ModelRuntime per agent folder (auth.json and models.json); never refreshes catalogs over the network on create. */
export function piRuntime(dir = agentDir()): Promise<any> {
	if (!runtimes.has(dir)) runtimes.set(dir, piSdk(dir).then(sdk => sdk.ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: join(dir, "models.json"), refreshOnCreate: false })));
	return runtimes.get(dir)!;
}

export type ModelRef = { provider: string; id: string; name: string };

/** S-10 (D10): what a parked session would run with, and the models it may pick, without starting Pi. */
export type ParkedModels = {
	/** The model and thinking level on the session file's current branch (Pi's buildSessionContext), or null model. */
	fromFile(file: string): Promise<{ model: ModelRef | null; thinking: string }>;
	/** Pi settings' enabledModels for this folder, resolved; patterns that match no known model are listed as unresolved. */
	scoped(folder: string): Promise<{ models: ModelRef[]; unresolved: string[] }>;
};

export function piModels(dir = agentDir()): ParkedModels {
	const ref = (model: any): ModelRef => ({ provider: model.provider, id: model.id, name: model.name ?? model.id });
	const named = async (provider: string, id: string) => {
		const found = (await piRuntime(dir)).getAllModels().find((model: any) => model.provider === provider && model.id === id);
		return found ? ref(found) : { provider, id, name: id }; // e.g. a model only an extension registers
	};
	return {
		async fromFile(file) {
			const context = (await piSdk(dir)).SessionManager.open(file).buildSessionContext();
			return { model: context.model ? await named(context.model.provider, context.model.modelId) : null, thinking: context.thinkingLevel };
		},
		async scoped(folder) {
			const sdk = await piSdk(dir), patterns: string[] = sdk.SettingsManager.create(folder, dir).getEnabledModels() ?? [];
			if (!patterns.length) return { models: [], unresolved: [] };
			const { scopedModels, diagnostics } = await sdk.resolveModelScopeWithDiagnostics(patterns, await piRuntime(dir));
			return { models: scopedModels.map((entry: any) => ref(entry.model)), unresolved: diagnostics.map((item: any) => item.pattern ?? item.message).filter(Boolean) };
		},
	};
}
