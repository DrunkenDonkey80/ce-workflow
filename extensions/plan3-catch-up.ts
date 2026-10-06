// Catch-up as a Plan3 plan (used when the legacy workflow is off): generate the review plan for the
// Pi packages ce-workflow still depends on, and record the reviewed versions from that plan.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const PLAN3_CATCH_UP_PACKAGES = ["@earendil-works/pi-coding-agent", "pi-subagents", "pi-ask-user", "pi-intercom", "pi-lens"];
const BASELINE = path.join(import.meta.dirname, "work-catch-up-baseline.json");
const DECISIONS = "Catch-up decisions";

export function catchUpReviewBlocker(pkg, targetVersion) {
	if (!String(pkg?.reviewedAt ?? "").trim()) return "has no reviewedAt evidence";
	if (pkg.reviewedVersion !== targetVersion) return `review does not cover ${targetVersion}`;
	if (!Array.isArray(pkg.decisions) || pkg.decisions.length === 0) return "has no recorded catch-up decisions";
	for (const decision of pkg.decisions) {
		const status = String(decision.status ?? "");
		const pov = String(decision.pov ?? "");
		if (
			decision.version !== targetVersion ||
			!String(decision.title ?? "").trim() ||
			!["Adopt", "Trial", "Hold", "Reject", "Not-our-problem"].includes(pov) ||
			!String(decision.rationale ?? "").trim() ||
			!["adopted", "no-action"].includes(status)
		)
			return "has an incomplete catch-up decision";
		if (status === "adopted" && !["Adopt", "Trial"].includes(pov)) return "has an invalid adopted catch-up decision";
		if (status === "no-action" && !["Reject", "Not-our-problem"].includes(pov)) return "has an actionable catch-up decision that was not adopted";
		if (status === "adopted" && !String(decision.verification ?? "").trim()) return "adopted decision lacks verification";
	}
}

// Added lines of CHANGELOG/release-notes files in an npm diff: the notes of every release in between.
export function changelogExcerpt(diffPath) {
	let diff;
	try { diff = readFileSync(diffPath, "utf8"); } catch { return undefined; } // No artifact: the plan falls back to installed/GitHub notes.
	const added = diff.split(/^(?=diff --git )/m)
		.filter((part) => /changelog|release|history/i.test(part.split("\n", 1)[0]))
		.flatMap((part) => part.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1)));
	if (!added.length) return undefined;
	const file = `${diffPath.replace(/\.diff$/, "")}.changelog.md`;
	writeFileSync(file, `${added.join("\n")}\n`);
	return file;
}

const short = (name) => name.replace(/^@[^/]+\//, "");

export function catchUpPlanText(state, focus = "", today = new Date().toISOString().slice(0, 10)) {
	const targets = state.packages.filter((pkg) => pkg.needsReview);
	const span = (pkg) => `${pkg.baselineVersion || "?"}→${pkg.targetVersion}`;
	const code = (file) => (file ? `\`${file}\`` : "none");
	const rows = targets.map((pkg) => `| ${pkg.name} | ${pkg.baselineVersion || "none"} | ${pkg.targetVersion} | ${pkg.installedVersion || "not installed"} | ${code(pkg.diffPath && changelogExcerpt(pkg.diffPath))} | ${pkg.diffPath ? code(pkg.diffPath) : "none (same version: earlier review evidence is incomplete)"} |`);
	const skeleton = JSON.stringify(Object.fromEntries(targets.map((pkg) => [pkg.name, []])), null, 2);
	return `---
plan3: true
status: draft
created: ${today}
source: catch-up
catch-up: ${JSON.stringify(Object.fromEntries(targets.map((pkg) => [pkg.name, pkg.targetVersion])))}
---

# Catch up ${targets.map((pkg) => `${short(pkg.name)} ${span(pkg)}`).join(", ")}

## Original request

> Catch ce-workflow up with the new releases of the Pi packages it still uses: review every release after the last reviewed version up to the target, decide what helps or breaks this repository, apply what is adopted, then record the reviewed versions.${focus ? `\n> User focus: ${focus}` : ""}

## Review targets

| Package | Last reviewed | Target | Installed | Changelog excerpt | Full diff |
|---|---|---|---|---|---|
${rows.join("\n")}

Several releases may lie between the last reviewed version and the target; review all of them, not only the newest notes. Start from the changelog excerpt (the CHANGELOG lines added across every intermediate release). The full diff (\`npm diff\` between the versions) can be very large: search it with rg for the files or APIs a change names instead of reading it whole. Without an excerpt, or when the diff starts with an error, read the changelog from the installed package or its GitHub releases.

## How to review (planning)

1. For each target, list the changes in every release since the last reviewed version that could affect ce-workflow: Pi extension hooks/events/context, tool registration and exposure, commands, settings, SDK, TUI, model runtime; for plugins their tool schemas, lifecycle and skills. Skip unrelated trivia.
2. Understand before judging. When a change touches a feature or term you cannot explain from this repository (for example "codemode can now do X"), research it first: the package's README/docs/examples (Pi docs live in the installed package's docs/), its source in node_modules, context7, or the web. Put a one-line explanation of the feature in the decision rationale. Never grade a change you could not explain.
3. Map each change to this repository: search extensions/ and scripts/ for the affected API or feature and state what it would fix, delete, simplify or enable here — or why it does not apply.
4. Grade it: Adopt or Trial → status "adopted"; Reject or Not-our-problem → status "no-action". Hold is not allowed: when you cannot decide, ask the user with the tradeoff and your recommendation, and record the answer in Decisions.
5. Record every graded change in the ${DECISIONS} JSON below (a package with nothing relevant gets one Not-our-problem decision saying so). For each adopted change, add a step to Phase 1 with its focused check; when nothing is adopted, replace the Phase 1 placeholder with "None — nothing adopted."

## ${DECISIONS}

Fill during planning. Each entry: {"title", "pov": "Adopt|Trial|Reject|Not-our-problem", "status": "adopted|no-action", "rationale"}; adopted entries also need "verification" (the check command and its result), added when the step is done. The recorder fills in the version.

\`\`\`json
${skeleton}
\`\`\`

## Decisions

Record user answers and settled choices here.

## Open questions

### Blocking

Not assessed yet.

### Deferred

None recorded.

## Phases

### Phase 1 — Apply adopted changes

Pending investigation.

### Phase 2 — Verify and record

- [ ] **CU-90** Run \`npm run verify:quiet\` after the adopted changes and record the result.
- [ ] **CU-91** Record the reviewed versions: \`node scripts/work-catch-up-record.mjs <this plan's id>\`. It writes exactly the target versions above (not newer releases) into \`extensions/work-catch-up-baseline.json\` and refuses missing, unexplained or unverified decisions.

## Resume context

Planning has not started.

## Amendments

- ${today}: Generated by /wo → Catch up packages.
`;
}

function planFile(cwd, ref) {
	if (/[\\/]|\.md$/.test(ref)) return path.resolve(cwd, ref);
	for (const dir of [path.join(cwd, "docs", "plans"), path.join(cwd, "docs", "plans", "done")]) {
		let names = [];
		try { names = readdirSync(dir); } catch {}
		const name = names.find((candidate) => candidate.endsWith(`-${ref}-plan3.md`));
		if (name) return path.join(dir, name);
	}
	throw new Error(`No Plan3 plan with id ${ref} in docs/plans.`);
}

function parse(text, what) {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(`${what} is not valid JSON: ${error.message}`);
	}
}

// Writes the plan's target versions and decisions into the baseline; all or nothing.
export function recordCatchUp(cwd, ref, baselinePath = BASELINE, now = new Date().toISOString()) {
	const text = readFileSync(planFile(cwd, ref), "utf8");
	const targetsLine = text.match(/^catch-up: (.+)$/m)?.[1];
	if (!targetsLine) throw new Error("This plan has no catch-up targets (frontmatter catch-up:).");
	const targets = parse(targetsLine, "The catch-up frontmatter");
	const block = text.split(`## ${DECISIONS}`)[1]?.match(/```json\r?\n([\s\S]*?)\r?\n```/)?.[1];
	if (!block) throw new Error(`The plan has no JSON block under ## ${DECISIONS}.`);
	const decisions = parse(block, `The ${DECISIONS} block`);
	const baseline = parse(readFileSync(baselinePath, "utf8"), baselinePath);
	const problems = [];
	const updates = Object.entries(targets).map(([name, version]) => {
		const pkg = baseline.packages.find((candidate) => candidate.name === name);
		const reviewed = { reviewedAt: now, reviewedVersion: version, decisions: (decisions[name] ?? []).map((decision) => ({ ...decision, version })) };
		const blocker = !pkg ? "is not in the baseline" : catchUpReviewBlocker(reviewed, version);
		if (blocker) problems.push(`${name} ${blocker}`);
		return [pkg, { ...reviewed, version }];
	});
	if (problems.length) throw new Error(`Nothing recorded:\n- ${problems.join("\n- ")}`);
	for (const [pkg, update] of updates) Object.assign(pkg, update);
	baseline.capturedAt = now;
	writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
	return Object.entries(targets).map(([name, version]) => `${name}@${version}`);
}
