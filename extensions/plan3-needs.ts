import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { showListDialog } from "./work-dialogs.ts";

// Plan3 requirements: external things steps need (the user, a VM, a printer, a reboot). The plan defines them;
// the user owns their on/off state, kept in a sidecar so plan rewrites (optimize, convert) never flip a switch.
// Two remembered sets: day and night; night mode switches between them. This gates scheduling only, not tools.
export const HUMAN = "human";
export const HUMAN_TEXT = "The user can answer questions (built in)";
export type Avail = { mode?: "day" | "night"; day?: Record<string, boolean>; night?: Record<string, boolean> };

export const needsFile = (logFile: string) => logFile.replace(/\.md$/, ".needs.json");
export function readAvail(file: string): Avail {
	try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; }
}
export function writeAvail(file: string, avail: Avail) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(avail, null, "\t")}\n`);
}
const mode = (avail: Avail) => avail.mode ?? "day";
// Unset means off: the model never grants itself access. Human defaults to present by day, absent at night.
export function isOn(avail: Avail, id: string) {
	const set = avail[mode(avail)] ?? {};
	return id in set ? set[id] : id === HUMAN && mode(avail) === "day";
}
// The night set starts as a copy of the day set with the user away.
const nightSet = (avail: Avail) => avail.night ?? { ...avail.day, [HUMAN]: false };
export const unset = (avail: Avail, ids: string[]) => ids.filter((id) => id !== HUMAN && !(id in (avail.day ?? {})));

// A new requirement's answer applies to both sets; the night set keeps the user away.
export function setBoth(avail: Avail, id: string, on: boolean): Avail {
	return { ...avail, day: { ...avail.day, [id]: on }, night: { ...nightSet(avail), [id]: id === HUMAN ? false : on } };
}
export function setMode(avail: Avail, next: "day" | "night"): Avail {
	return next === "night" ? { ...avail, mode: "night", night: nightSet(avail) } : { ...avail, mode: "day" };
}
export const availLine = (avail: Avail, defs: Map<string, string>) => {
	const ids = [...defs.keys()];
	const on = ids.filter((id) => isOn(avail, id)), off = ids.filter((id) => !isOn(avail, id));
	return `Available now (${mode(avail)}): ${on.join(", ") || "nothing"}; off: ${off.join(", ") || "nothing"}.`;
};
export const changeMessage = (changes: string[], line: string) =>
	`Plan3 requirements changed by the user: ${changes.join(", ")}. ${line} Do not start steps that need a requirement that is off; finish or safely park the current one and continue with runnable work.`;

// Checklist for the active set (or the set night mode is switching to); Esc saves. Returns "R-x on" style changes.
export async function chooseAvail(ctx, file: string, defs: Map<string, string>, avail = readAvail(file)) {
	if (!ctx.hasUI || defs.size <= 1) return { avail, changes: [] as string[] };
	const ids = [...defs.keys()];
	const picked = await showListDialog(ctx, {
		title: `Requirements · ${mode(avail) === "night" ? "night" : "day"}`,
		purpose: "Checked = available to the agent now. Esc saves and tells the agent what changed.",
		cursorKey: `plan3-needs:${file}`, filter: false,
		multi: { selected: ids.filter((id) => isOn(avail, id)) },
		items: ids.map((id) => ({ value: id, label: id, description: defs.get(id), preserveCase: true })),
	});
	if (!picked?.values) return { avail, changes: [] as string[] };
	const set = Object.fromEntries(ids.map((id) => [id, picked.values.includes(id)]));
	const changes = ids.filter((id) => set[id] !== isOn(avail, id)).map((id) => `${id} ${set[id] ? "on" : "off"}`);
	const next = { ...avail, [mode(avail)]: { ...avail[mode(avail)], ...set } };
	writeAvail(file, next);
	return { avail: next, changes };
}
