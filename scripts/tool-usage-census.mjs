#!/usr/bin/env node
// Tool-use census per Plan3 phase and tool-loading window, from real Pi session logs.
// Reads only entry types, tool names, plan3-run modes, timestamps and the tool lists in tools_enable /
// pi_lens_activate_tools result details; never message text or tool arguments (sessions hold user content).
// Usage: node scripts/tool-usage-census.mjs [--local <sessions dir>] [--peer <dir> --peer-map <json>]
//          [--stats-root <dir>] [--tool-defs <json>] [--dump-tool-defs <out.json>] [--since 2026-09-01] [--json]
// --peer: session files copied from paired hubs (peer_fetch); --peer-map maps each original file name to its hub.
// --dump-tool-defs starts Pi once with the user's own extensions and writes the registered and active tool
// definitions, which --tool-defs then reads for description and schema sizes.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Tool-loading windows: everything always on; situational tools on demand (318b4244); trigger-oriented tools_enable (17b68ef2).
export const WINDOWS = [["1-all-on", ""], ["2-on-demand", "2026-10-31"], ["3-trigger", "2026-11-13"]];
export const windowOf = (ts) => WINDOWS.findLast(([, start]) => String(ts ?? "") >= start)[0];
const LOADERS = new Set(["tools_enable", "pi_lens_activate_tools"]);
const bare = (name) => String(name ?? "").replace(/^mcp__pi__/, "");
const has = (line, text) => line.includes(text);

// Adds one session's lines to acc. Phase comes from the latest plan3-run entry (planning has no mode); there is no
// end marker, so a session stays in its last Plan3 phase; chat before any Plan3 run counts as "normal".
export function addSession(acc, lines, { session, machine }) {
	let phase = "normal";
	(acc.machines[machine] ??= { sessions: 0, turns: 0 }).sessions++;
	for (const line of lines) {
		if (!line || !(has(line, '"plan3-run"') || has(line, '"role":"assistant"') || has(line, '"role":"toolResult"'))) continue;
		let entry;
		try { entry = JSON.parse(line); } catch { continue; }
		if (entry.type === "custom" && entry.customType === "plan3-run") { phase = entry.data?.mode ?? "planning"; continue; }
		if (entry.type !== "message") continue;
		const message = entry.message ?? {};
		const window = windowOf(entry.timestamp);
		if (message.role === "toolResult" && LOADERS.has(bare(message.toolName))) {
			const loaded = message.details?.enabled ?? message.details?.added ?? [];
			const loads = (acc.loads[window] ??= {});
			for (const name of loaded) loads[name] = (loads[name] ?? 0) + 1;
			continue;
		}
		if (message.role !== "assistant") continue;
		const bucket = (acc.buckets[`${window}|${phase}`] ??= { turns: 0, sessions: new Set(), tools: {} });
		bucket.turns++;
		bucket.sessions.add(session);
		acc.machines[machine].turns++;
		for (const part of message.content ?? []) {
			if (part?.type !== "toolCall") continue;
			const tool = (bucket.tools[bare(part.name)] ??= { calls: 0, sessions: new Set() });
			tool.calls++;
			tool.sessions.add(session);
		}
	}
}

export const newCensus = () => ({ machines: {}, buckets: {}, loads: {} });

// Size of what a request carries for one tool: name, description and JSON schema.
export const schemaBytes = (def) => Buffer.byteLength(JSON.stringify({ name: def.name, description: def.description, parameters: def.parameters }));

export function summarize(acc, defs, { nearZeroPer1k = 1 } = {}) {
	const phases = {};
	for (const [key, b] of Object.entries(acc.buckets)) {
		const tools = Object.entries(b.tools)
			.sort((x, y) => y[1].calls - x[1].calls)
			.map(([name, t]) => [name, { calls: t.calls, per1kTurns: +(t.calls * 1000 / b.turns).toFixed(2), sessionShare: +(t.sessions.size / b.sessions.size).toFixed(3) }]);
		phases[key] = { turns: b.turns, sessions: b.sessions.size, tools: Object.fromEntries(tools) };
	}
	const out = { machines: acc.machines, phases, loads: acc.loads };
	if (!defs) return out;
	const active = new Set(defs.active.map(bare));
	const alwaysOn = defs.all.filter((d) => active.has(bare(d.name)));
	// Near zero: under nearZeroPer1k calls per 1,000 turns in every phase since on-demand loading began.
	const recent = Object.entries(acc.buckets).filter(([key]) => !key.startsWith("1-"));
	const rate = (name) => Math.max(0, ...recent.map(([, b]) => (b.tools[name]?.calls ?? 0) * 1000 / b.turns));
	const sum = (list) => list.reduce((s, d) => s + schemaBytes(d), 0);
	out.alwaysOn = alwaysOn
		.map((d) => ({ name: bare(d.name), descriptionChars: String(d.description ?? "").length, schemaBytes: schemaBytes(d), maxPer1kTurns: +rate(bare(d.name)).toFixed(2) }))
		.sort((x, y) => x.maxPer1kTurns - y.maxPer1kTurns || y.schemaBytes - x.schemaBytes);
	out.nearZero = out.alwaysOn.filter((t) => t.maxPer1kTurns < nearZeroPer1k).map((t) => t.name);
	// Estimate, not measured: requests do not log the tools they offered. All-on = every registered tool;
	// on demand = the tools active at session start (loads add to this per session).
	out.estimatedSchemaBytesPerRequest = { "1-all-on": sum(defs.all), onDemandBase: sum(alwaysOn), nearZeroShare: sum(alwaysOn.filter((d) => out.nearZero.includes(bare(d.name)))) };
	return out;
}

// Per-plan totals from committed Plan3 stats (all machines, no phase split).
export function planStats(root) {
	const tools = {};
	let plans = 0;
	for (const repo of existsSync(root) ? readdirSync(root) : []) {
		const logs = path.join(root, repo, "docs", "plans", "logs");
		if (!existsSync(logs)) continue;
		for (const file of readdirSync(logs).filter((name) => name.endsWith(".stats.json"))) {
			let stats;
			try { stats = JSON.parse(readFileSync(path.join(logs, file), "utf8")); } catch { continue; }
			plans++;
			for (const [name, t] of Object.entries(stats.tools ?? {})) tools[bare(name)] = (tools[bare(name)] ?? 0) + (t.count ?? 0);
		}
	}
	return { plans, tools: Object.fromEntries(Object.entries(tools).sort((a, b) => b[1] - a[1])) };
}

function sessionFiles(dir) {
	if (!dir || !existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
		d.isDirectory() ? sessionFiles(path.join(dir, d.name)) : d.name.endsWith(".jsonl") ? [path.join(dir, d.name)] : []);
}

export function piCli() {
	const releases = path.join(os.homedir(), ".pi", "agent", "install", "releases");
	const installed = (existsSync(releases) ? readdirSync(releases) : []).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
		.map((v) => path.join(releases, v, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js"));
	if (installed.some(existsSync)) return installed.find(existsSync);
	let npmRoot = "";
	try { npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8", shell: true }).trim(); } catch {}
	const cli = [...installed, path.join(npmRoot, "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js")].find(existsSync);
	if (!cli) throw new Error("Pi CLI not found");
	return cli;
}

// Starts Pi in RPC mode with the user's extensions, snapshots registered and active tools a few seconds after
// session start (other extensions adjust the active set in their own session_start handlers), then stops it.
async function dumpToolDefs(out, cwd) {
	const dir = mkdtempSync(path.join(os.tmpdir(), "tool-census-"));
	const probe = path.join(dir, "probe.ts");
	writeFileSync(probe, `import { writeFileSync } from "node:fs";
export default function (pi) {
	pi.on("session_start", () => setTimeout(() => writeFileSync(${JSON.stringify(out)}, JSON.stringify({
		active: pi.getActiveTools(),
		all: pi.getAllTools().map((t) => ({ name: t.name, description: t.description, parameters: t.parameters, source: t.sourceInfo?.source })),
	})), 5000));
}
`);
	const { PI_HUB: _hub, PI_HUB_SESSION: _session, ...env } = process.env;
	rmSync(out, { force: true });
	const child = spawn(process.execPath, [piCli(), "--mode", "rpc", "--no-session", "--extension", probe], { cwd, env: { ...env, PI_WORK_PROJECT_MAP: "off" }, stdio: ["pipe", "ignore", "pipe"] });
	let stderr = "";
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	const deadline = Date.now() + 60_000;
	while (!existsSync(out)) {
		if (child.exitCode !== null) throw new Error(`pi exited ${child.exitCode}: ${stderr.slice(-1500)}`);
		if (Date.now() > deadline) { child.kill(); throw new Error("tool definition dump timed out"); }
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	child.kill();
	rmSync(dir, { recursive: true, force: true });
}

export function formatCensus(r) {
	const lines = ["Coverage:"];
	for (const [m, c] of Object.entries(r.machines)) lines.push(`  ${m}: ${c.sessions} sessions, ${c.turns} assistant turns`);
	for (const [key, p] of Object.entries(r.phases).sort()) {
		lines.push(`${key}: ${p.turns} turns, ${p.sessions} sessions`);
		lines.push(`  ${Object.entries(p.tools).slice(0, 25).map(([n, t]) => `${n} ${t.calls} (${t.per1kTurns}/1k, ${Math.round(t.sessionShare * 100)}%)`).join(", ")}`);
	}
	for (const [w, loads] of Object.entries(r.loads).sort()) if (Object.keys(loads).length) lines.push(`Loads ${w}: ${Object.entries(loads).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(", ")}`);
	if (r.alwaysOn) {
		lines.push("Always-on tools (max calls per 1k turns in any phase since on-demand loading; description chars; schema bytes):");
		for (const t of r.alwaysOn) lines.push(`  ${t.name}: ${t.maxPer1kTurns}/1k, ${t.descriptionChars} chars, ${t.schemaBytes} B`);
		lines.push(`Near zero (<1 per 1k turns in every phase): ${r.nearZero.join(", ") || "none"}`);
		const e = r.estimatedSchemaBytesPerRequest;
		lines.push(`Estimated tool schema bytes per request (estimate: offered tools are not logged): all-on ${e["1-all-on"]}, on-demand base ${e.onDemandBase}, of which near-zero ${e.nearZeroShare}`);
	}
	if (r.planStats) lines.push(`Plan3 stats (${r.planStats.plans} plans, all machines, no phase split): ${Object.entries(r.planStats.tools).slice(0, 25).map(([n, c]) => `${n} ${c}`).join(", ")}`);
	return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const args = process.argv.slice(2);
	const value = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback);
	const dump = value("--dump-tool-defs");
	if (dump) {
		await dumpToolDefs(path.resolve(dump), path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
		console.log(`tool definitions written to ${path.resolve(dump)}`);
		process.exit(0);
	}
	const since = new Date(value("--since", "2026-09-01"));
	const acc = newCensus();
	const peerMap = value("--peer-map") ? JSON.parse(readFileSync(value("--peer-map"), "utf8")) : {};
	const inputs = [
		...sessionFiles(value("--local", path.join(os.homedir(), ".pi", "agent", "sessions"))).map((file) => ({ file, machine: "this-pc" })),
		// peer_fetch prefixes a timestamp and id: <iso>-<8 hex>-<original name>
		...sessionFiles(value("--peer")).map((file) => ({ file, machine: peerMap[path.basename(file).replace(/^\d{4}-\d\d-\d\dT[\d-]+Z-[0-9a-f]{8}-/, "")] ?? "peer" })),
	];
	for (const { file, machine } of inputs) {
		if (statSync(file).mtime < since) continue;
		addSession(acc, readFileSync(file, "utf8").split("\n"), { session: file, machine });
	}
	const defs = value("--tool-defs") ? JSON.parse(readFileSync(value("--tool-defs"), "utf8")) : undefined;
	const result = summarize(acc, defs);
	result.planStats = planStats(value("--stats-root", path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")));
	console.log(args.includes("--json") ? JSON.stringify(result, null, 1) : formatCensus(result));
}
