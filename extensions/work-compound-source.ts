

import { lstatSync, readFileSync, realpathSync } from "node:fs";

import path from "node:path";

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;



export function normalizeSourcePath(relativePath) {
	if (
		typeof relativePath !== "string" ||
		!relativePath ||
		path.isAbsolute(relativePath) ||
		relativePath.includes("\\") ||
		relativePath.includes("\0")
	)
		throw new Error(`unsafe source path: ${relativePath}`);
	const normalized = path.posix.normalize(relativePath);
	if (normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/"))
		throw new Error(`source path escapes quarantine: ${relativePath}`);
	for (const segment of normalized.split("/")) {
		if (!segment || segment === "." || segment === "..")
			throw new Error(`unsafe source path segment: ${relativePath}`);
		if (/[. ]$/.test(segment) || WINDOWS_RESERVED.test(segment))
			throw new Error(`source path is not Windows portable: ${relativePath}`);
	}
	return normalized;
}



function confinedAbsolute(root, relativePath) {
	const normalized = normalizeSourcePath(relativePath);
	const absolute = path.resolve(root, ...normalized.split("/"));
	const resolvedRoot = path.resolve(root);
	if (absolute !== resolvedRoot && !absolute.startsWith(`${resolvedRoot}${path.sep}`))
		throw new Error(`source path escapes quarantine: ${relativePath}`);
	return { absolute, normalized };
}

export function readConfinedFile(root, relativePath, allowedPaths) {
	const { absolute, normalized } = confinedAbsolute(root, relativePath);
	if (allowedPaths && !allowedPaths.has(normalized))
		throw new Error(`source path is not in the verified closure: ${normalized}`);
	const stat = lstatSync(absolute);
	if (!stat.isFile() || stat.isSymbolicLink())
		throw new Error(`source path is not a regular file: ${normalized}`);
	const realRoot = realpathSync(root);
	const realFile = realpathSync(absolute);
	if (!realFile.startsWith(`${realRoot}${path.sep}`))
		throw new Error(`source path resolves outside quarantine: ${normalized}`);
	return readFileSync(realFile);
}
