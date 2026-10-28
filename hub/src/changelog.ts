// The changelog shown in the hub (gear → version, and What's new after an update): CHANGELOG.md at the repo root,
// one "## <version> — <date>" section per version, images under docs/changelog/.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
/** The Pi browser fetch extension the browser loads unpacked from this checkout: its version and folder (gear → Pi and extensions). */
export function browserExtension(): { version: string; path: string } {
	const dir = path.join(root, "browser-fetch", "extension");
	try { return { version: JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")).version ?? "", path: dir }; } catch { return { version: "", path: dir }; }
}
export function hubVersion(): string { try { return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version ?? ""; } catch { return ""; } }

export type ChangelogEntry = { version: string; date: string; body: string };
export function parseChangelog(text: string): ChangelogEntry[] {
	return text.split(/^## /m).slice(1).map(section => {
		const [heading, ...rest] = section.split("\n"), [version, date = ""] = heading.split(/\s+—\s+/);
		return { version: version.trim(), date: date.trim(), body: rest.join("\n").trim() };
	});
}
export const readChangelog = () => parseChangelog(readFileSync(path.join(root, "CHANGELOG.md"), "utf8"));

/** A changelog screenshot by bare file name; anything else is refused. */
export function changelogImage(name: string | null) {
	if (!name || !/^[\w.-]+\.(png|jpe?g)$/i.test(name) || name.includes("..")) throw Object.assign(new Error("Unknown changelog image."), { status: 400 });
	try { return { bytes: readFileSync(path.join(root, "docs", "changelog", name)), type: /\.png$/i.test(name) ? "image/png" : "image/jpeg" }; }
	catch { throw Object.assign(new Error("Changelog image not found."), { status: 404 }); }
}

/** Entries released after `since` (x.y.z, numeric order); Unreleased never counts as new. */
export function since(entries: ChangelogEntry[], since: string) {
	const key = (v: string) => v.split(".").map(Number), base = key(since);
	return entries.filter(entry => VERSION_PATTERN.test(entry.version) && key(entry.version).reduce((order, n, i) => order || n - base[i], 0) > 0);
}
