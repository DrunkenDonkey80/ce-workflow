import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const REVIEW_POLICIES = Object.freeze(["risk-based", "review-all"]);

export function normalizeReviewPolicy(value) {
	return value === "review-all" ? value : "risk-based";
}

export function isProductionPath(file) {
	const normalized = String(file ?? "").replaceAll("\\", "/");
	return (
		Boolean(normalized) &&
		!normalized.startsWith(".ce-workflow/") &&
		!/(?:^|\/)(?:docs?|test|tests|__tests__|fixtures?|snapshots?)(?:\/|$)/i.test(
			normalized,
		) &&
		!/(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/i.test(normalized) &&
		!/(?:^|\/)(?:readme|changelog|license)(?:\.[^/]*)?$/i.test(normalized) &&
		!/\.(?:md|mdx|rst|txt)$/i.test(normalized)
	);
}

export function hasProductionDiff(files = []) {
	return files.some(isProductionPath);
}

function readJson(file) {
	try {
		return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
	} catch {
		return {};
	}
}

export function readReviewPolicy(cwd) {
	const global = readJson(
		path.join(
			process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent"),
			"settings.json",
		),
	);
	const project = readJson(path.join(cwd, ".pi", "settings.json"));
	return normalizeReviewPolicy(
		project.workOrchestrator?.reviewPolicy ??
			global.workOrchestrator?.reviewPolicy,
	);
}
