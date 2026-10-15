// Commands lack ctx.executeTool. Reuse the loaded package's popup, not a second UI.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

export async function loadPlan3Ask(pi: ExtensionAPI) {
	const source = pi.getAllTools?.().find(tool => tool.name === "ask_user")?.sourceInfo?.path;
	if (!source) throw new Error("Plan3 needs the loaded ask_user extension; no model prompt was sent.");
	const vendored = path.resolve(source) === fileURLToPath(new URL("./ask-user/index.ts", import.meta.url));
	if (!vendored) {
		let manifest;
		try { manifest = JSON.parse(await readFile(path.join(path.dirname(source), "package.json"), "utf8")); }
		catch (cause) { throw new Error("Cannot verify the installed pi-ask-user package.", { cause }); }
		if (manifest.name !== "pi-ask-user" || !/^0\.16\./.test(manifest.version))
			throw new Error(`Plan3 supports pi-ask-user 0.16.x; found ${manifest.name} ${manifest.version}.`);
	}
	// Use the host's module instances, including bundled Pi installs; do not resolve
	// a second SDK/theme singleton from the ask-user package's node_modules.
	const [sdk, tui, typebox] = await Promise.all([
		import("@earendil-works/pi-coding-agent"),
		import("@earendil-works/pi-tui"),
		import("@sinclair/typebox"),
	]);
	const module = await createJiti(import.meta.url, { moduleCache: false, virtualModules: {
		"@earendil-works/pi-coding-agent": sdk,
		"@earendil-works/pi-tui": tui,
		"@sinclair/typebox": typebox,
	} }).import<{ registerAskUser?: unknown; default?: unknown }>(source);
	const factory = vendored ? module.registerAskUser : module.default;
	let ask: ToolDefinition | undefined;
	if (typeof factory !== "function") throw new Error("pi-ask-user does not export an extension factory.");
	await factory({ events: pi.events, registerTool: (tool: ToolDefinition) => { if (tool.name === "ask_user") ask = tool; } });
	if (typeof ask?.execute !== "function") throw new Error("pi-ask-user did not register a compatible ask_user tool.");
	// External pi-ask-user 0.16.x has no initialText; callers then pre-fill ctx.ui.editor in the terminal only.
	return Object.assign(ask, { prefills: vendored });
}
