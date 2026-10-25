// Pi's own SDK, loaded from Pi's managed install: the hub reads auth, models, settings and session files the way a running Pi does.
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { agentDir } from "./rpc-client.ts";

const sdks = new Map<string, Promise<any>>(), runtimes = new Map<string, Promise<any>>();

const PACKAGE = join("node_modules", "@earendil-works", "pi-coding-agent");

/** Pi's package folder: the managed install (agent/install/current-version), else the npm-installed one behind the `pi` on PATH (issue #5). */
export function piPackage(dir = agentDir(), path = process.env.PATH ?? ""): string {
	const marker = join(dir, "install", "current-version");
	if (existsSync(marker)) return join(dir, "install", "releases", readFileSync(marker, "utf8").trim(), PACKAGE);
	// shortcut: npm layouts only (Windows pi.cmd beside node_modules, POSIX bin/pi linking into the package); pnpm/volta shims are not followed.
	for (const folder of path.split(delimiter).filter(Boolean)) {
		if (existsSync(join(folder, "pi.cmd")) && existsSync(join(folder, PACKAGE))) return join(folder, PACKAGE);
		let at: string;
		try { at = realpathSync(join(folder, "pi")); } catch { continue; }
		for (let up = dirname(at); up !== dirname(up); up = dirname(up)) if (basename(up) === "pi-coding-agent" && existsSync(join(up, "package.json"))) return up;
	}
	throw new Error(`Pi SDK not found: no ${marker} and no npm-installed pi on PATH.`);
}

export function piSdk(dir = agentDir()): Promise<any> {
	if (!sdks.has(dir)) {
		let entry: string;
		try { entry = join(piPackage(dir), "dist", "index.js"); } catch (error) { return Promise.reject(error); }
		sdks.set(dir, import(pathToFileURL(entry).href));
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
	/** Pi settings' default model for this folder, as provider/id, or null. */
	defaultModel(folder: string): Promise<string | null>;
	/** Saves the default model in Pi's global settings (what Pi's /model does). */
	setDefault(provider: string, id: string): Promise<void>;
	/** The workflow's /wo models (global settings): work = Plan3 coding model, think = the Plan models list, as provider/id. */
	roles(): { work: string | null; think: string[] };
	/** Sets or clears the work model, or adds (high effort) or removes a think model; one model may hold every role. */
	setRole(role: "work" | "think", ref: string, on: boolean): void;
};

function readSettings(dir: string): any {
	const file = join(dir, "settings.json");
	return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}; // a broken file throws rather than being overwritten
}

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
		async defaultModel(folder) {
			const settings = (await piSdk(dir)).SettingsManager.create(folder, dir), provider = settings.getDefaultProvider(), id = settings.getDefaultModel();
			return provider && id ? provider + "/" + id : null;
		},
		async setDefault(provider, id) {
			const settings = (await piSdk(dir)).SettingsManager.create(process.cwd(), dir);
			settings.setDefaultModelAndProvider(provider, id); await settings.flush();
		},
		// shortcut: global settings only, like /wo's Global scope; a project override in .pi/settings.json still wins there.
		roles() {
			const plan3 = readSettings(dir).workOrchestrator?.plan3 ?? {};
			return { work: plan3.codingModel ?? null, think: (plan3.models ?? []).map((entry: { model: string }) => entry.model) };
		},
		setRole(role, ref, on) {
			const settings = readSettings(dir), plan3 = ((settings.workOrchestrator ??= {}).plan3 ??= {});
			if (role === "work") { if (on) plan3.codingModel = ref; else delete plan3.codingModel; }
			else { const list = (plan3.models ?? []).filter((entry: { model: string }) => entry.model !== ref); plan3.models = on ? [...list, { model: ref, thinking: "high" }] : list; }
			writeFileSync(join(dir, "settings.json"), `${JSON.stringify(settings, null, "\t")}\n`);
		},
		async scoped(folder) {
			const sdk = await piSdk(dir), patterns: string[] = sdk.SettingsManager.create(folder, dir).getEnabledModels() ?? [];
			if (!patterns.length) return { models: [], unresolved: [] };
			const { scopedModels, diagnostics } = await sdk.resolveModelScopeWithDiagnostics(patterns, await piRuntime(dir));
			return { models: scopedModels.map((entry: any) => ref(entry.model)), unresolved: diagnostics.map((item: any) => item.pattern ?? item.message).filter(Boolean) };
		},
	};
}
