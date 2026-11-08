#!/usr/bin/env node
// Blind judge bundle for one skills-lab task (plan 79614d24 SK-08, design.md "Judge protocol").
// node scripts/skills-lab-judge.mjs <run> <task> [--extra <task2>]  -> C:\SOFT\git\skills-lab\judge\<run>\<task>\
// Writes run-<label>.md per run (reduced transcript, final diff, arm-free checks) and key.json (label -> arm/rep).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const LAB = "C:/SOFT/git/skills-lab";
const TASKS = path.join(import.meta.dirname, "..", "docs", "proposals", "skills-lab", "tasks");
const [run, task] = process.argv.slice(2);
if (!run || !task) throw new Error("usage: skills-lab-judge.mjs <run> <task>");
const runDir = path.join(LAB, "runs", run);
const rows = readFileSync(path.join(runDir, "results.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.task === task);
if (!rows.length) throw new Error(`no ${task} runs in ${run}`);
const lab = JSON.parse(readFileSync(path.join(TASKS, task, "lab.json"), "utf8"));

// Redact what names the skill: its name, its path, /skill: lines and its distinctive headings.
const skillName = lab.skill?.split("/").pop();
const skillFile = lab.skill && path.join(LAB, "mattpocock-skills", "skills", lab.skill, "SKILL.md");
const skillText = skillFile && existsSync(skillFile) ? readFileSync(skillFile, "utf8") : "";
const description = skillText.match(/^description: (.{20,60})/m)?.[1];
const headings = skillFile && existsSync(skillFile) ? readFileSync(skillFile, "utf8").split(/\r?\n/).filter((l) => /^#{1,4} /.test(l)).map((l) => l.replace(/^#+ /, "").trim()).filter((h) => h.length > 6) : [];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const redactors = [/\/skill:\S+/g, /<skill name=[\s\S]*?<\/skill>/g, /[^\s"'`]*mattpocock-skills[^\s"'`]*/g,
	...(skillName ? [new RegExp(esc(skillName), "gi"), new RegExp(esc(skillName.replace(/-/g, " ")), "gi")] : []),
	...headings.map((h) => new RegExp(esc(h), "gi"))];
const redact = (s) => redactors.reduce((t, re) => t.replace(re, "[redacted]"), s);
const cut = (s, n) => (s.length > n ? `${s.slice(0, n)} …[${s.length - n} more chars]` : s);
const text = (content) => (typeof content === "string" ? content : (content ?? []).filter((p) => p.type === "text").map((p) => p.text).join("\n"));

function transcript(file) {
	const out = [];
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line.trim()) continue;
		const e = JSON.parse(line);
		if (e.type !== "message_end") continue;
		const { role, content } = e.message;
		if (role === "assistant") {
			for (const p of content ?? []) {
				if (p.type === "text" && p.text.trim()) out.push(`**assistant:** ${p.text.trim()}`);
				if (p.type === "toolCall") out.push(`**tool ${p.name}:** ${cut(JSON.stringify(p.arguments), 1200)}`);
			}
		} else if (role === "toolResult") {
			const t = text(content); // a read of the skill file would reveal the arm
			out.push(`**result:** ${description && t.includes(description) ? "[redacted file content]" : cut(t, 1000)}`);
		}
	}
	return redact(out.join("\n\n"));
}

// Lab noise, not the agent's work: pi-lens writes probe logs into the cwd (excluded for runs after 73a1dbd).
function diff(file) {
	if (!existsSync(file)) return { text: "(no diff)", files: [] };
	const parts = readFileSync(file, "utf8").split(/^(?=diff --git )/m).filter((p) => !/^diff --git a\/\.pi-lens-probe-home\//.test(p));
	return { text: parts.join(""), files: parts.map((p) => p.match(/^diff --git a\/(\S+)/)?.[1]).filter(Boolean) };
}

const out = path.join(LAB, "judge", run, task);
mkdirSync(out, { recursive: true });
const key = {};
const labels = rows.map(() => randomBytes(2).toString("hex").toUpperCase());
rows.forEach((r, i) => {
	const label = labels[i], base = path.join(runDir, `${r.task}-${r.arm}-${r.rep}`);
	const d = diff(`${base}.diff`);
	// only-agents-md was failed by the probe logs above; recompute it from the cleaned file list.
	const checks = r.checks.map((c) => (c.name === "only-agents-md" ? { ...c, pass: d.files.length > 0 && d.files.every((f) => f === "AGENTS.md") } : c));
	key[label] = { arm: r.arm, rep: r.rep, checks, metrics: r.metrics, skillRead: r.skillRead, outside: r.outside, wallMs: r.wallMs };
	writeFileSync(path.join(out, `run-${label}.md`), [`# Run ${label}`, "", `Checks: ${checks.map((c) => `${c.name} ${c.pass ? "pass" : "fail"}`).join(", ")}`,
		`Changed files: ${d.files.join(", ") || "none"}`, "", "## Transcript", "", transcript(`${base}.events.jsonl`), "", "## Final diff", "", "```diff", redact(cut(d.text, 60000)), "```", ""].join("\n"));
});
writeFileSync(path.join(out, "key.json"), JSON.stringify(key, null, "\t"));
console.log(`${rows.length} runs -> ${out} (labels ${labels.join(" ")})`);
