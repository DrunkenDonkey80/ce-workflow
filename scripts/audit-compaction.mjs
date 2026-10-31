#!/usr/bin/env node
// Token-free audit of Pi session logs: after each compaction, did the agent redo what the summary dropped?
// Usage: node scripts/audit-compaction.mjs [session dirs or .jsonl files] [--since=YYYY-MM-DD] [--top=N]
// Default: every session under ~/.pi/agent/sessions. Reads only; prints per-mode totals and the worst compactions.
import { readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const READS = new Set(["read", "read_symbol", "read_enclosing", "module_report"]);
const EDITS = new Set(["edit", "write"]);
const CORRECTION = /\b(i (already|just) (said|told|asked)|i told you|as i said|you forgot|we already (did|have|decided)|i said)\b|\bagain\?/i;
const WINDOW_CALLS = 40; // only early redo counts: later rereads are more likely new work
const INSTRUCTIONS = /(^|\/)(skill|agents|claude)\.md$/; // reloaded by design after a compaction, not a loss
const norm = (p, cwd = "") => (cwd && !path.isAbsolute(String(p)) ? path.resolve(cwd, String(p)) : String(p)).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const words = t => new Set(t.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []);
const similar = (a, b) => { if (a.size < 5 || b.size < 5) return false; let n = 0; for (const w of a) if (b.has(w)) n++; return n / (a.size + b.size - n) >= 0.6; };
const textOf = content => typeof content === "string" ? content : (content ?? []).filter(c => c.type === "text").map(c => c.text).join("\n");

/** Session entries (file order) to a flat event list. shortcut: file order, not the parentId tree, so /tree branches mix; walk the tree if branching gets used. */
function events(entries) {
	const out = [], at = new Map(); // entry id -> index of its first event (or the next one)
	const cwd = entries.find(e => e.type === "session")?.cwd ?? "";
	for (const e of entries) {
		at.set(e.id, out.length);
		const m = e.message;
		if (e.type === "compaction") out.push({ kind: "compaction", entry: e });
		else if (m?.role === "user") out.push({ kind: "user", text: textOf(m.content) });
		else if (m?.role === "assistant") for (const c of m.content ?? []) {
			if (c.type !== "toolCall") continue;
			const a = c.arguments ?? {};
			if (READS.has(c.name) && a.path) out.push({ kind: "read", path: norm(a.path, cwd) });
			else if (EDITS.has(c.name) && a.path) out.push({ kind: "edit", path: norm(a.path, cwd) });
			else if (c.name === "bash" && a.command) out.push({ kind: "bash", cmd: String(a.command).replace(/\s+/g, " ").trim() });
			else out.push({ kind: "tool" });
		}
	}
	return { ev: out, at };
}

/** Loss signals for each compaction of one session. */
export function auditSession(entries) {
	const { ev, at } = events(entries);
	const results = [];
	let droppedFrom = 0;
	for (let i = 0; i < ev.length; i++) {
		if (ev[i].kind !== "compaction") continue;
		const c = ev[i].entry, kept = at.get(c.firstKeptEntryId) ?? i;
		const dropped = ev.slice(droppedFrom, kept).filter(e => e.kind !== "compaction"), keptSpan = ev.slice(kept, i);
		droppedFrom = kept;
		const next = ev.findIndex((e, j) => j > i && e.kind === "compaction");
		const after = ev.slice(i + 1, next < 0 ? ev.length : next);
		let calls = 0;
		const window = after.filter(e => e.kind === "user" || (e.kind !== "user" && ++calls <= WINDOW_CALLS));
		const inKept = new Set(keptSpan.map(e => e.path ?? e.cmd).filter(Boolean));
		const droppedReads = new Set(dropped.filter(e => e.kind === "read" || e.kind === "edit").map(e => e.path).filter(p => !inKept.has(p)));
		const droppedCmds = new Set(dropped.filter(e => e.kind === "bash").map(e => e.cmd).filter(x => !inKept.has(x)));
		const droppedUsers = dropped.filter(e => e.kind === "user").map(e => words(e.text));
		const rereads = new Set(), repeatedCmds = new Set(), userRepeats = [], corrections = [], touched = new Set(), changed = new Set();
		for (const e of window) {
			if (e.path) touched.add(e.path);
			if (e.kind === "edit") changed.add(e.path);
			if (e.kind === "read" && droppedReads.has(e.path) && !changed.has(e.path) && !INSTRUCTIONS.test(e.path)) rereads.add(e.path);
			if (e.kind === "bash" && droppedCmds.has(e.cmd)) repeatedCmds.add(e.cmd);
			if (e.kind === "user") {
				const w = words(e.text);
				if (droppedUsers.some(d => similar(w, d))) userRepeats.push(e.text.slice(0, 120));
				if (CORRECTION.test(e.text)) corrections.push(e.text.slice(0, 120));
			}
		}
		const summary = String(c.summary ?? "");
		const summaryPaths = new Set((summary.match(/[A-Za-z]:[\\/][^\s"'`)\]]+|(?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)+\.\w+/g) ?? []).map(p => norm(p)));
		results.push({
			id: c.id, timestamp: c.timestamp, mode: c.details?.compactionMode ?? (c.fromHook ? "hook" : "native"),
			tokensBefore: c.tokensBefore ?? 0, summaryChars: summary.length, followed: after.length > 0,
			rereads: [...rereads], repeatedCmds: [...repeatedCmds], userRepeats, corrections,
			summaryPaths: summaryPaths.size, summaryPathsUsed: [...summaryPaths].filter(p => touched.has(p)).length,
		});
	}
	return results;
}

const score = r => r.rereads.length + r.repeatedCmds.length + 3 * (r.userRepeats.length + r.corrections.length);

function files(inputs) {
	return inputs.flatMap(input => {
		const abs = path.resolve(input);
		return statSync(abs).isDirectory() ? readdirSync(abs).flatMap(n => files([path.join(abs, n)])) : abs.endsWith(".jsonl") ? [abs] : [];
	});
}

function main(argv) {
	const flag = name => argv.find(a => a.startsWith(`--${name}=`))?.split("=")[1];
	const since = flag("since"), top = Number(flag("top") ?? 10);
	const inputs = argv.filter(a => !a.startsWith("--"));
	const all = [];
	for (const file of files(inputs.length ? inputs : [path.join(os.homedir(), ".pi", "agent", "sessions")])) {
		let entries;
		try { entries = readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)); }
		catch (error) { console.error(`skipped ${file}: ${error.message}`); continue; }
		for (const r of auditSession(entries)) if (r.followed && (!since || r.timestamp >= since)) all.push({ ...r, file });
	}
	if (!all.length) return console.log("No compactions followed by more work found.");
	const modes = Map.groupBy(all, r => r.mode);
	const per = (list, f) => (list.reduce((s, r) => s + f(r), 0) / list.length).toFixed(2);
	console.log(`${all.length} compactions followed by more work, ${new Set(all.map(r => r.file)).size} sessions\n`);
	console.log(["mode", "n", "tokensBefore", "summaryChars", "rereads", "repeatCmds", "userRepeats", "corrections", "summaryPathsUsed"].join("\t"));
	for (const [mode, list] of [...modes, ["ALL", all]]) {
		const paths = list.reduce((s, r) => s + r.summaryPaths, 0), used = list.reduce((s, r) => s + r.summaryPathsUsed, 0);
		console.log([mode, list.length, Math.round(per(list, r => r.tokensBefore)), Math.round(per(list, r => r.summaryChars)),
			per(list, r => r.rereads.length), per(list, r => r.repeatedCmds.length), per(list, r => r.userRepeats.length), per(list, r => r.corrections.length),
			paths ? `${Math.round(100 * used / paths)}% of ${paths}` : "-"].join("\t"));
	}
	console.log(`\nWorst ${top} (rereads + repeated commands + 3 × user repeats/corrections):`);
	for (const r of [...all].sort((a, b) => score(b) - score(a)).slice(0, top).filter(r => score(r) > 0)) {
		console.log(`\n${score(r)}  ${r.mode}  ${r.timestamp}  ${path.basename(r.file)}  compaction ${r.id}`);
		for (const p of r.rereads.slice(0, 5)) console.log(`  reread  ${p}`);
		for (const x of r.repeatedCmds.slice(0, 3)) console.log(`  rerun   ${x.slice(0, 140)}`);
		for (const t of r.userRepeats.slice(0, 2)) console.log(`  user repeated: ${t.replace(/\s+/g, " ")}`);
		for (const t of r.corrections.slice(0, 2)) console.log(`  user corrected: ${t.replace(/\s+/g, " ")}`);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
