// pi-lens reformats every file the agent writes (format.enabled defaults to on), which rewrites whole sources behind the
// user's back. On a machine with pi-lens, ask once to turn it off. The answer is stored in pi-lens's own config as an
// explicit true or false, so an unset key is the only state that asks.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { showListDialog } from "./ask-user/menu.ts";

// shortcut: default config location only; pi-lens can relocate it (configuration.md "global-config-location"), add that if someone does.
export const lensConfigFile = (home = os.homedir()) => path.join(home, ".pi-lens", "config.json");

const read = (file: string) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };

/** True when pi-lens is in use here and nobody has decided on its auto-format yet. */
export const lensFormatUndecided = (file = lensConfigFile()) => {
	if (!existsSync(path.dirname(file))) return false;
	const config = existsSync(file) ? read(file) : {};
	return !!config && typeof config === "object" && typeof config.format?.enabled !== "boolean";
};

export function setLensFormat(enabled: boolean, file = lensConfigFile()) {
	const config = (existsSync(file) ? read(file) : null) ?? {};
	config.format = { ...config.format, enabled };
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}

export function registerLensFormatCheck(pi, file = lensConfigFile(), dialog = showListDialog) {
	let asked = false;
	pi.on("session_start", (_event, ctx) => {
		if (asked || !ctx?.hasUI || !lensFormatUndecided(file)) return;
		asked = true;
		// Not awaited: the dialog must not hold up session start.
		void dialog(ctx, {
			title: "Turn off pi-lens auto-format?", purpose: "pi-lens reformats every file the agent writes, so unrelated lines change in your diffs. Lint and diagnostics keep running.",
			compact: true, filter: false, cursorKey: "lens-format",
			items: [{ value: "off", label: "Turn it off (Recommended)" }, { value: "on", label: "Keep formatting" }],
		})
			// Escape decides nothing: the next session asks again.
			.then(pick => { if (pick?.value && lensFormatUndecided(file)) setLensFormat(pick.value === "on", file); })
			.catch(() => { asked = false; });
	});
}
