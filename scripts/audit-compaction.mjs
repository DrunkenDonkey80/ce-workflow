#!/usr/bin/env node
// Token-free audit of Pi session logs: after each compaction, did the agent redo what the summary dropped?
// Usage: node scripts/audit-compaction.mjs [session dirs or .jsonl files] [--since=YYYY-MM-DD] [--top=N]
// Default: every session under ~/.pi/agent/sessions. Reads only; prints per-mode totals and the worst compactions.
// Signals are triage, not proof: a reread can be normal read-before-edit, and reads done through bash are not seen.
import { readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const READS = new Set(["read", "read_symbol", "read_enclosing", "module_report"]);
const EDITS = new Set(["edit", "write"]);
const CORRECTION = /\b(i (already|just) (said|told|asked)|i told you|as i said|you forgot|we already (did|have|decided))\b/i;
// Messages sent as "user" by timers, Plan3, intercom and subagent wakes: never a human repeating themselves.
const MACHINE = /^(\u23f0 Scheduled|Plan3: |One-time before executing|New intercom message above|Subagent updates above|Inspect subagent updates above|Compaction is complete)/;
const WINDOW_CALLS = 40; // only early redo counts: later rereads are more likely new work
const INSTRUCTIONS = /(^|\/)(skill|agents|claude)\.md$/; // reloaded by design after a compaction, not a loss
const norm = (p, cwd = "") => (cwd && !path.isAbsolute(String(p)) ? path.resolve(cwd, String(p)) : String(p)).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const words = t => new Set(String(t).toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []);
const similar = (a, b) => { if (a.size < 5 || b.size < 5) return false; let n = 0; for (const w of a) if (b.has(w)) n++; return n / (a.size + b.size - n) >= 0.6; };
const textOf = content => typeof content === "string" ? content : (content ?? []).filter(c => c.type === "text").map(c => c.text).join("\n");
const questionsOf = a => [a.question, ...(Array.isArray(a.questions) ? a.questions.map(q => q?.question) : [])].filter(Boolean).join("\n");

/** Session entries (file order) to a flat event list. shortcut: file order, not the parentId tree, so /tree branches mix; walk the tree if branching gets used. */
function events(entries) {
	const out = [], at = new Map(); // entry id -> index of its first event (or the next one)
	const cwd = entries.find(e => e.type === "session")?.cwd ?? "";
	for (const e of entries) {
		at.set(e.id, out.length);
		const m = e.message;
		if (e.type === "compaction") out.push({ kind: "compaction", entry: e });
		else if (m?.role === "user") { const text = textOf(m.content).trim(); out.push({ kind: "user", text, machine: MACHINE.test(text) }); }
		else if (m?.role === "assistant") for (const c of m.content ?? []) {
			if (c.type !== "toolCall") continue;
			const a = c.arguments ?? {};
			if (READS.has(c.name) && a.path) out.push({ kind: "read", path: norm(a.path, cwd) });
			else if (EDITS.has(c.name) && a.path) out.push({ kind: "edit", path: norm(a.path, cwd), sig: `${norm(a.path, cwd)}\n${JSON.stringify(a.edits ?? [a.oldText, a.newText, a.content])}` });
			else if (c.name === "bash" && a.command) out.push({ kind: "bash", cmd: String(a.command).replace(/\s+/g, " ").trim() });
			else if (c.name === "ask_user") out.push({ kind: "ask", text: questionsOf(a) });
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
		const window = [];
		for (let calls = 0, j = 0; j < after.length && (after[j].kind === "user" || ++calls <= WINDOW_CALLS); j++) window.push(after[j]);
		const inKept = new Set(keptSpan.map(e => e.sig ?? e.path ?? e.cmd).filter(Boolean));
		const droppedReads = new Set(dropped.filter(e => e.kind === "read" || e.kind === "edit").map(e => e.path).filter(p => !inKept.has(p)));
		const droppedCmds = new Set(dropped.filter(e => e.kind === "bash").map(e => e.cmd).filter(x => !inKept.has(x)));
		const droppedEdits = new Set(dropped.filter(e => e.kind === "edit").map(e => e.sig).filter(x => !inKept.has(x)));
		const droppedUsers = dropped.filter(e => e.kind === "user" && !e.machine).map(e => ({ text: e.text, w: words(e.text) }));
		const droppedAsks = dropped.filter(e => e.kind === "ask").map(e => words(e.text));
		const rereads = new Set(), repeatedCmds = new Set(), redoneEdits = new Set(), userRepeats = [], corrections = [], reasks = [], changed = new Set();
		for (const e of window) {
			if (e.kind === "edit") { if (droppedEdits.has(e.sig)) redoneEdits.add(e.path); changed.add(e.path); }
			if (e.kind === "read" && droppedReads.has(e.path) && !changed.has(e.path) && !INSTRUCTIONS.test(e.path)) rereads.add(e.path);
			if (e.kind === "bash" && droppedCmds.has(e.cmd)) repeatedCmds.add(e.cmd);
			if (e.kind === "ask" && droppedAsks.some(d => similar(words(e.text), d))) reasks.push(e.text.slice(0, 120));
			if (e.kind === "user" && !e.machine) {
				const w = words(e.text);
				// shortcut: exact repeats are skipped as hub button prompts ("commit and push..."), so a word-for-word human repeat is missed too.
				if (droppedUsers.some(d => d.text !== e.text && similar(w, d.w))) userRepeats.push(e.text.slice(0, 120));
				if (CORRECTION.test(e.text)) corrections.push(e.text.slice(0, 120));
			}
		}
		results.push({
			id: c.id, timestamp: c.timestamp, mode: c.details?.compactionMode ?? (c.fromHook ? "hook" : "native"),
			tokensBefore: c.tokensBefore ?? 0, summaryChars: String(c.summary ?? "").length, followed: after.length > 0,
			rereads: [...rereads], repeatedCmds: [...repeatedCmds], redoneEdits: [...redoneEdits], reasks, userRepeats, corrections,
		});
	}
	return results;
}

const score = r => r.rereads.length + r.repeatedCmds.length + 2 * r.redoneEdits.length + 3 * (r.reasks.length + r.userRepeats.length + r.corrections.length);

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
	const all = [], seen = new Set(); // forked sessions copy their parent's compactions
	for (const file of files(inputs.length ? inputs : [path.join(os.homedir(), ".pi", "agent", "sessions")])) {
		let entries;
		try { entries = readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)); }
		catch (error) { console.error(`skipped ${file}: ${error.message}`); continue; }
		for (const r of auditSession(entries)) {
			const key = `${r.id}@${r.timestamp}`;
			if (r.followed && (!since || r.timestamp >= since) && !seen.has(key)) { seen.add(key); all.push({ ...r, file }); }
		}
	}
	if (!all.length) return console.log("No compactions followed by more work found.");
	const modes = Map.groupBy(all, r => r.mode);
	const per = (list, f) => (list.reduce((s, r) => s + f(r), 0) / list.length).toFixed(2);
	console.log(`${all.length} compactions followed by more work, ${new Set(all.map(r => r.file)).size} sessions\n`);
	console.log(["mode", "n", "tokensBefore", "summaryChars", "rereads", "repeatCmds", "redoneEdits", "reasked", "userRepeats", "corrections"].join("\t"));
	for (const [mode, list] of [...modes, ["ALL", all]])
		console.log([mode, list.length, Math.round(per(list, r => r.tokensBefore)), Math.round(per(list, r => r.summaryChars)),
			...["rereads", "repeatedCmds", "redoneEdits", "reasks", "userRepeats", "corrections"].map(k => per(list, r => r[k].length))].join("\t"));
	console.log(`\nWorst ${top} (rereads + reruns + 2 × redone edits + 3 × re-asked questions, user repeats and corrections):`);
	for (const r of [...all].sort((a, b) => score(b) - score(a)).slice(0, top).filter(r => score(r) > 0)) {
		console.log(`\n${score(r)}  ${r.mode}  ${r.timestamp}  ${path.basename(r.file)}  compaction ${r.id}`);
		for (const p of r.rereads.slice(0, 5)) console.log(`  reread  ${p}`);
		for (const x of r.repeatedCmds.slice(0, 3)) console.log(`  rerun   ${x.slice(0, 140)}`);
		for (const p of r.redoneEdits.slice(0, 3)) console.log(`  redid edit  ${p}`);
		for (const t of r.reasks.slice(0, 2)) console.log(`  asked the user again: ${t.replace(/\s+/g, " ")}`);
		for (const t of r.userRepeats.slice(0, 2)) console.log(`  user repeated: ${t.replace(/\s+/g, " ")}`);
		for (const t of r.corrections.slice(0, 2)) console.log(`  user corrected: ${t.replace(/\s+/g, " ")}`);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
