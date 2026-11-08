// Lab metrics (R3): tokens, cost, turns and tool calls of every Pi session under a session dir,
// subagent child sessions included (they sit in <session>/<run-id>/run-N/session.jsonl).
// subagent-artifacts/ holds copies of child transcripts, so it is skipped to avoid double counting.
// Usage: node scripts/lab-metrics.mjs <session-dir>
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function sessionFiles(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === "subagent-artifacts" ? [] : sessionFiles(full);
		return entry.name.endsWith(".jsonl") ? [full] : [];
	});
}

export function sessionMetrics(dir) {
	const total = { sessions: 0, turns: 0, toolCalls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0, models: {} };
	for (const file of sessionFiles(dir)) {
		total.sessions++;
		for (const line of readFileSync(file, "utf8").split("\n")) {
			let entry;
			try { entry = JSON.parse(line); } catch { continue; }
			const message = entry.type === "message" ? entry.message : undefined;
			if (message?.role !== "assistant") continue;
			total.turns++;
			total.toolCalls += (message.content ?? []).filter((block) => block.type === "toolCall").length;
			const usage = message.usage ?? {};
			for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) total[key] += usage[key] ?? 0;
			total.cost += usage.cost?.total ?? 0;
			const model = `${message.provider}/${message.model}`;
			total.models[model] = (total.models[model] ?? 0) + 1;
		}
	}
	total.cost = Math.round(total.cost * 10000) / 10000;
	return total;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	if (!process.argv[2]) throw new Error("usage: lab-metrics.mjs <session-dir>");
	console.log(JSON.stringify(sessionMetrics(process.argv[2]), null, "\t"));
}
