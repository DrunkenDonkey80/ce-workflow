// Read-only discovery from the reviewed installed release; no CLI host, init or remote discover sources.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { astryxRuntime } from "./design-runtime.ts";
import { runAstryx, type LibraryOptions } from "./design-library.ts";

export const LOOKUP_CATALOGS = ["component", "template", "theme", "doc", "hook"];
export function astryxSystem() {
	const version = astryxRuntime.versions["@astryxdesign/core"];
	return { name: "astryx", package: "@astryxdesign/core", version, lockDigest: astryxRuntime.lockDigest, guide: `# Astryx ${version}\n\nPinned package reference, lock ${astryxRuntime.lockDigest}.\n\nUse design {action:"lookup",query:"needed control"}, then catalog/name (and section when useful) for only the required installed-version documentation. First library use asks before a host download; remote browsers install nothing. Do not run CLI setup, init, discover, scaffold or install commands.\n\nSelection alone supplies guidance, not a React build. Keep normal root HTML screens; use a component starter only when the studio explicitly supplies it. Standalone design theme output remains CSS/JSON.\n` };
}
export function lookupInput(args) {
	const { query, catalog, name, section, libraryVersion } = args;
	if (libraryVersion !== undefined && libraryVersion !== astryxRuntime.versions["@astryxdesign/cli"]) throw new Error("Lookup libraryVersion must match the pinned Astryx release, not latest.");
	if (catalog !== undefined && !LOOKUP_CATALOGS.includes(catalog)) throw new Error("Unknown lookup catalog: component, template, theme, doc or hook.");
	if (query !== undefined) {
		if (typeof query !== "string" || !query.trim() || Buffer.byteLength(query.trim()) > 256 || /[\x00-\x1f\x7f]/.test(query)) throw new Error("Lookup query must be 1–256 UTF-8 bytes without control characters.");
		if (name !== undefined || section !== undefined) throw new Error("Lookup takes a query or a catalog/name, not both.");
		const limit = args.limit === undefined ? 5 : args.limit;
		if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("Lookup limit must be an integer from 1 to 10.");
		return { query: query.trim(), ...(catalog === undefined ? {} : { catalog }), limit };
	}
	if (!catalog || typeof name !== "string" || Buffer.byteLength(name) > 120 || !name.split("/").every(part => /^[a-z0-9][a-z0-9_.-]*$/i.test(part)) || (catalog !== "doc" && name.includes("/"))) throw new Error("Lookup needs a catalog and exact name; paths, package selectors and versions are not accepted as names.");
	if (args.limit !== undefined) throw new Error("Lookup limit applies only to query results.");
	if (section !== undefined && (typeof section !== "string" || !/^[a-z0-9][a-z0-9_. -]{0,119}$/i.test(section) || (catalog === "component" ? !["usage", "props", "examples"].includes(section) : catalog === "hook" ? section !== "params" : catalog !== "doc"))) throw new Error("Invalid lookup section: use a doc heading, component usage/props/examples, or hook params.");
	return { catalog, name, ...(section === undefined ? {} : { section }) };
}

export function lookupResponse(value, input) {
	const domain = input.query !== undefined ? "search" : input.catalog === "doc" ? "docs" : input.catalog;
	if (!value || typeof value !== "object" || typeof value.type !== "string" || !("data" in value) || !/^(search|component\.detail(?:\.[a-z]+)?|template\.show|theme\.detail|docs\.[a-z.]+|hook\.detail(?:\.[a-z]+)?)$/.test(value.type)) throw new Error("Invalid Astryx lookup response.");
	if (domain === "search" ? value.type !== "search" : !value.type.startsWith(`${domain}.`)) throw new Error("Unexpected Astryx lookup response domain.");
	if (input.query !== undefined && (value.type !== "search" || !Array.isArray(value.data?.results) || value.data.results.length > input.limit)) throw new Error("Astryx search response exceeds its result count limit.");
	if (Buffer.byteLength(JSON.stringify(value)) > 48 * 1024) throw new Error("Astryx lookup response exceeds 48 KiB. Search for a narrower item or request a component/doc section.");
	return value;
}

/** Fixed worker entry. Cache-root package.json stops config discovery before any project ancestors. */
export async function libraryLookup(directory: string, args) {
	const input = lookupInput(args);
	const packageJson = (file: string) => {
		try { return JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")); }
		catch (cause) { throw new Error("Invalid lookup cache package metadata; no fallback installation is permitted.", { cause }); }
	};
	const manifest = packageJson("package.json");
	if (JSON.stringify(manifest.dependencies) !== JSON.stringify(astryxRuntime.versions)) throw new Error("Lookup cache manifest does not match the reviewed pin.");
	if (["astryx.config.ts", "astryx.config.mjs", "astryx.config.js"].some(file => fs.existsSync(path.join(directory, file)))) throw new Error("Project configuration is not allowed in the lookup cache.");
	for (const name of ["cli", "core"]) {
		const pkg = packageJson(`node_modules/@astryxdesign/${name}/package.json`);
		if (pkg.name !== `@astryxdesign/${name}` || pkg.version !== astryxRuntime.versions[pkg.name]) throw new Error("Lookup cache package version mismatch; no fallback installation is permitted.");
	}
	const api = await import(pathToFileURL(path.join(directory, "node_modules/@astryxdesign/cli/api/index.mjs")).href);
	let value;
	if ("query" in input) value = await api.search(input.query, { cwd: directory, type: input.catalog, limit: input.limit });
	else if (input.catalog === "component") {
		value = await api.component(input.name, { cwd: directory, package: "@astryxdesign/core", detail: "compact", props: input.section === "props" });
		if (input.section && input.section !== "props") value = { ...value, data: { name: input.name, [input.section]: value.data[input.section] } };
	} else if (input.catalog === "template") value = await api.template(input.name, { cwd: directory, package: "@astryxdesign/core", show: true });
	else if (input.catalog === "hook") value = await api.hook(input.name, { cwd: directory, detail: "compact", params: input.section === "params" });
	else if (input.catalog === "doc") value = await api.docs(input.name, input.section, { cwd: directory, detail: "compact", depth: 0 });
	else {
		const themes = (await api.themeListAvailable({ cwd: directory })).data.filter(theme => theme.slug === input.name);
		if (!themes.length) throw new Error(`Unknown theme ${input.name} in the pinned release.`);
		if (themes.length !== 1) throw new Error(`Ambiguous theme ${input.name} in the pinned release.`);
		value = { type: "theme.detail", package: themes[0].package, data: themes[0] };
	}
	return lookupResponse(value, input);
}

export async function runLookup(args, options: LibraryOptions = {}) {
	const input = lookupInput(args);
	options.progress?.("Reading the pinned installed Astryx catalog…");
	const { runtime, value } = await runAstryx("libraryLookup", input, options);
	return { source: { api: "@astryxdesign/cli/api", versions: runtime.versions, lockDigest: runtime.lockDigest }, response: lookupResponse(value, input), note: "Reference data only. Do not run suggested CLI setup, install, scaffold or discover commands. HTML remains the default; lookups do not select a system or edit files." };
}
