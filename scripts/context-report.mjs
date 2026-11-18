#!/usr/bin/env node
// What a blank session sends with every request: starts Pi once in <cwd> (no session, no provider call: the probe
// exits on the first request), splits the system prompt and tool schemas by owner, adds tool call rates from this
// PC's session logs, and suggests cuts for ce-workflow's own parts only; other owners are listed, not judged.
// Usage: node scripts/context-report.mjs [--cwd <dir>] [--json]
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { addSession, newCensus, piCli, summarize } from "./tool-usage-census.mjs";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OURS = "ce-workflow (ours)";
const PI_CORE = "Pi core";
const bytes = (text) => Buffer.byteLength(String(text ?? ""));
const bare = (name) => String(name ?? "").replace(/^mcp__pi__/, "");
const norm = (p) => { const r = path.resolve(p); return process.platform === "win32" ? r.toLowerCase() : r; };
const inside = (file, dir) => (norm(file) + path.sep).startsWith(norm(dir) + path.sep);
// Loaders and tools the harness itself relies on at session start: rare calls are expected, not a reason to defer.
const KEEP_DECLARED = new Set(["tools_enable", "plan3_create", "compaction_note", "ask_user"]);
const NEAR_ZERO_PER_1K = 1;
const MIN_TURNS = 1000; // below this the call rates say nothing
const BIG_TOOL = 2000; // schema plus prompt text
const BIG_SECTION = 1500;

export function ownerOf(sourceInfo, repoDir = REPO_DIR) {
	if (!sourceInfo || sourceInfo.source === "builtin" || sourceInfo.source === "sdk") return PI_CORE;
	if (sourceInfo.baseDir && norm(sourceInfo.baseDir) === norm(repoDir)) return OURS;
	if (sourceInfo.source?.startsWith("npm:")) return sourceInfo.source;
	return path.basename(sourceInfo.baseDir ?? sourceInfo.path ?? "unknown");
}

// Who added a file-backed prompt part (AGENTS.md, skill), from where the file lives.
function ownerOfFile(file, repoDir) {
	if (inside(file, repoDir)) return OURS;
	const pkg = String(file).match(/node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/);
	if (pkg) return `npm:${pkg[1].replace("\\", "/")}`;
	const git = String(file).match(/[\\/]git[\\/][^\\/]+[\\/]([^\\/]+[\\/][^\\/]+)/); // pi's git packages: git/<host>/<owner>/<repo>
	if (git) return `git:${git[1].replace("\\", "/")}`;
	if (path.basename(path.dirname(file)) === "agent") return "your Pi config";
	return path.dirname(file);
}

function systemText(payload) {
	const text = (v) => typeof v === "string" ? v : Array.isArray(v) ? v.map((b) => b?.text ?? "").join("\n") : "";
	if (payload.system) return text(payload.system);
	if (payload.instructions) return text(payload.instructions);
	return (payload.messages ?? payload.input ?? []).filter((m) => ["system", "developer"].includes(m.role)).map((m) => text(m.content)).join("\n");
}

/** Splits the captured request into owner-attributed parts. sectionOwners maps extra top-level tags to an owner. */
export function analyze({ system, tools, all }, { repoDir = REPO_DIR, sectionOwners = {}, rates = {}, turns = 0 } = {}) {
	const owners = new Map(all.map((t) => [bare(t.name), ownerOf(t.source, repoDir)]));
	const ruleTool = new Map(all.flatMap((t) => (t.promptGuidelines ?? []).map((g) => [String(g).trim(), bare(t.name)])));
	const parts = [];
	const add = (kind, name, owner, size) => size && parts.push({ kind, name, owner, bytes: size });
	const tagged = /^<([a-z][a-z_-]*)(?: [^>]*)?>$/gm;
	let last = 0;
	let other = 0;
	for (let m; (m = tagged.exec(system));) {
		const end = system.indexOf(`</${m[1]}>`, m.index);
		if (end < 0) continue;
		other += bytes(system.slice(last, m.index));
		const body = system.slice(m.index, end + m[1].length + 3);
		last = tagged.lastIndex = m.index + body.length;
		const tag = m[1];
		if (tag === "tools" || tag === "rules") {
			let core = body;
			for (const line of body.split("\n")) {
				const toolLine = tag === "tools" && line.match(/^- ([\w-]+):/);
				const tool = toolLine ? toolLine[1] : ruleTool.get(line.replace(/^- /, "").trim());
				if (!owners.has(tool)) continue;
				add("tool prompt text", tool, owners.get(tool), bytes(line) + 1);
				core = core.replace(line, "");
			}
			add("prompt section", `<${tag}> frame`, PI_CORE, bytes(core));
		} else if (tag === "project_context") {
			for (const f of body.matchAll(/<project_instructions path="([^"]+)">[\s\S]*?<\/project_instructions>/g)) add("instructions file", f[1], ownerOfFile(f[1], repoDir), bytes(f[0]));
			add("prompt section", "<project_context> frame", PI_CORE, bytes(body.replace(/<project_instructions[\s\S]*?<\/project_instructions>/g, "")));
		} else if (tag === "skills") {
			for (const s of body.matchAll(/<skill>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<location>([^<]+)<\/location>[\s\S]*?<\/skill>/g)) add("skill listing", s[1], ownerOfFile(s[2], repoDir), bytes(s[0]));
			add("prompt section", "<skills> frame", PI_CORE, bytes(body.replace(/<skill>[\s\S]*?<\/skill>/g, "")));
		} else add("prompt section", `<${tag}>`, ["docs", "cwd"].includes(tag) ? PI_CORE : sectionOwners[tag] ?? "another extension", bytes(body));
	}
	add("prompt section", "untagged text (Pi preamble and joins)", PI_CORE, other + bytes(system.slice(last)));
	// A package that adds both a skill and a same-named section (ponytail) owns the section.
	for (const p of parts.filter((p) => p.owner === "another extension")) p.owner = parts.find((s) => s.kind === "skill listing" && `<${s.name}>` === p.name)?.owner ?? p.owner;
	for (const t of tools) {
		const name = bare(t.name ?? t.function?.name);
		parts.push({ kind: "tool schema", name, owner: owners.get(name) ?? owners.get(name.toLowerCase()) ?? PI_CORE, bytes: bytes(JSON.stringify(t)), per1k: rates[name] ?? rates[name.toLowerCase()] });
	}
	return { parts, turns, ideas: ideasFor(parts, turns) };
}

function ideasFor(parts, turns) {
	const ideas = [];
	const ours = parts.filter((p) => p.owner === OURS);
	const text = (name) => parts.filter((t) => t.kind === "tool prompt text" && t.name.toLowerCase() === name.toLowerCase()).reduce((s, t) => s + t.bytes, 0);
	for (const schema of ours.filter((p) => p.kind === "tool schema")) {
		const p = { ...schema, bytes: schema.bytes + text(schema.name) };
		if (turns >= MIN_TURNS && !KEEP_DECLARED.has(p.name) && !p.name.endsWith("_enable") && (p.per1k ?? 0) < NEAR_ZERO_PER_1K)
			ideas.push({ bytes: p.bytes, text: `Tool \`${p.name}\` is called ${p.per1k ?? 0} times per 1,000 turns: move it to tools_enable (saves ${p.bytes} B).` });
		else if (p.bytes > BIG_TOOL) ideas.push({ bytes: p.bytes, text: `Tool \`${p.name}\` costs ${p.bytes} B (schema and prompt text): shorten its description, parameter descriptions and rules.` });
	}
	for (const p of ours.filter((p) => ["prompt section", "instructions file"].includes(p.kind) && p.bytes > BIG_SECTION))
		ideas.push({ bytes: p.bytes, text: `${p.kind === "instructions file" ? "Instructions file" : "Prompt section"} \`${p.name}\` is ${p.bytes} B in every request: shorten it, or add it only when the work needs it.` });
	return ideas.sort((a, b) => b.bytes - a.bytes).map((i) => i.text);
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
export function formatReport({ parts, turns, ideas }, cwd) {
	const sum = (list) => list.reduce((s, p) => s + p.bytes, 0);
	const tools = parts.filter((p) => p.kind === "tool schema");
	const prompt = parts.filter((p) => p.kind !== "tool schema");
	const toolText = Object.groupBy(parts.filter((p) => p.kind === "tool prompt text"), (p) => p.name.toLowerCase());
	const textOf = (name) => sum(toolText[name.toLowerCase()] ?? []);
	const total = sum(parts);
	const byOwner = Object.entries(Object.groupBy(parts, (p) => p.owner)).map(([owner, list]) => [owner, sum(list.filter((p) => p.kind !== "tool schema")), sum(list.filter((p) => p.kind === "tool schema"))]).sort((a, b) => b[1] + b[2] - a[1] - a[2]);
	const lines = [
		`# Context report: blank session in ${cwd}`,
		"",
		`Every request starts with **${kb(total)}** (about ${Math.round(total / 4).toLocaleString("en")} tokens): system prompt ${kb(sum(prompt))}, ${tools.length} tool schemas ${kb(sum(tools))}.`,
		"",
		"## By owner",
		"",
		"| Owner | Prompt | Tools | Total |",
		"|---|---:|---:|---:|",
		...byOwner.map(([owner, p, t]) => `| ${owner} | ${kb(p)} | ${kb(t)} | ${kb(p + t)} |`),
		"",
		"## Tool schemas",
		"",
		"Prompt text = its line in the tool list plus its rules in the system prompt.",
		"",
		"| Tool | Owner | Schema | Prompt text | Calls per 1k turns |",
		"|---|---|---:|---:|---:|",
		...tools.sort((a, b) => b.bytes + textOf(b.name) - a.bytes - textOf(a.name)).map((p) => `| ${p.name} | ${p.owner} | ${p.bytes} B | ${textOf(p.name)} B | ${p.per1k ?? "–"} |`),
		"",
		"## System prompt parts",
		"",
		"| Part | Kind | Owner | Size |",
		"|---|---|---|---:|",
		...prompt.filter((p) => p.kind !== "tool prompt text").sort((a, b) => b.bytes - a.bytes).map((p) => `| ${p.name} | ${p.kind} | ${p.owner} | ${p.bytes} B |`),
		"",
		"## Ideas (ce-workflow's own parts only; other owners are listed above, not judged)",
		"",
		...(ideas.length ? ideas.map((i) => `- ${i}`) : ["- Nothing over the thresholds."]),
		...(turns < MIN_TURNS ? ["- Call rates skipped: this PC's session logs since on-demand loading hold fewer than 1,000 turns."] : []),
	];
	return lines.join("\n");
}

// Tool call rates since on-demand loading, from this PC's sessions (tool names only, never message text).
function callRates(declared, all) {
	const acc = newCensus();
	const walk = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []).flatMap((d) => d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith(".jsonl") ? [path.join(dir, d.name)] : []);
	const since = Date.parse("2026-10-31");
	for (const file of walk(path.join(os.homedir(), ".pi", "agent", "sessions"))) {
		if (statSync(file).mtimeMs < since) continue;
		addSession(acc, readFileSync(file, "utf8").split("\n"), { session: file, machine: "this-pc" });
	}
	const result = summarize(acc, { active: declared, all });
	const turns = Object.entries(acc.buckets).filter(([key]) => !key.startsWith("1-")).reduce((s, [, b]) => s + b.turns, 0);
	return { turns, rates: Object.fromEntries(result.alwaysOn.map((t) => [t.name, t.maxPer1kTurns])) };
}

// Top-level prompt tags ce-workflow's extensions put in systemPromptOptions.sections.
function ourSectionTags(repoDir) {
	const dir = path.join(repoDir, "extensions");
	const source = readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");
	return Object.fromEntries([...source.matchAll(/sections\[["']([a-z][a-z_-]*)["']\]\s*=/g)].map((m) => [m[1], OURS]));
}

export async function captureBlankRequest(cwd) {
	const dir = mkdtempSync(path.join(os.tmpdir(), "context-report-"));
	const out = path.join(dir, "request.json");
	const probe = path.join(dir, "probe.ts");
	writeFileSync(probe, `import { writeFileSync } from "node:fs";
export default function (pi) {
	pi.on("before_provider_request", (event) => {
		const p = event.payload ?? event;
		writeFileSync(${JSON.stringify(out)}, JSON.stringify({ payload: { system: p.system, instructions: p.instructions, messages: p.messages, input: p.input }, tools: p.tools ?? [],
			all: pi.getAllTools().map((t) => ({ name: t.name, description: t.description, parameters: t.parameters, promptGuidelines: t.promptGuidelines, source: t.sourceInfo })) }));
		process.exit(0); // before anything reaches the provider
	});
}
`);
	// A hub-hosted Pi would register the probe as a hub session.
	const { PI_HUB: _hub, PI_HUB_SESSION: _session, ...env } = process.env;
	try {
		await new Promise((resolve, reject) => {
			const child = spawn(process.execPath, [piCli(), "-p", "--no-session", "--extension", probe, "hi"], { cwd, env, stdio: ["ignore", "ignore", "pipe"] });
			let stderr = "";
			child.stderr.on("data", (chunk) => { stderr += chunk; });
			const timer = setTimeout(() => { child.kill(); reject(new Error("blank session did not reach its first request in 90 s")); }, 90_000);
			child.on("error", reject);
			child.on("exit", (code) => { clearTimeout(timer); if (existsSync(out)) resolve(); else reject(new Error(`pi exited ${code} before its first request: ${stderr.slice(-1500)}`)); });
		});
		const { payload, tools, all } = JSON.parse(readFileSync(out, "utf8"));
		return { system: systemText(payload), tools, all };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

export async function contextReport(cwd, { json = false } = {}) {
	const request = await captureBlankRequest(cwd);
	const declared = request.tools.map((t) => bare(t.name ?? t.function?.name));
	const analysis = analyze(request, { sectionOwners: ourSectionTags(REPO_DIR), ...callRates(declared, request.all) });
	return json ? JSON.stringify(analysis, null, 1) : formatReport(analysis, cwd);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const args = process.argv.slice(2);
	const cwd = args.includes("--cwd") ? path.resolve(args[args.indexOf("--cwd") + 1]) : process.cwd();
	console.log(await contextReport(cwd, { json: args.includes("--json") }));
}
