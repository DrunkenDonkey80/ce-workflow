// Shared by judge-handoff.mjs and judge-design-extras.mjs: a deadline per judge attempt, one retry, and a judge
// error kept apart from the verdict (idea from SkillEvaluator docs/metrics-reference.mdx: errors are unscored, not failures).
import { spawn, spawnSync } from "node:child_process";
import { wilson } from "./compare-benchmark-runs.mjs";

export const JUDGE_TIMEOUT_MS = 5 * 60_000;

// Resolves with the child's stdout; past the deadline kills the whole tree (pi-launcher runs pi as a grandchild).
export function runChild(command, args, { cwd, timeoutMs = JUDGE_TIMEOUT_MS } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
		let out = "";
		const timer = setTimeout(() => {
			if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
			else child.kill("SIGKILL");
			reject(new Error(`judge timeout after ${Math.round(timeoutMs / 1000)} s`));
		}, timeoutMs);
		child.stdout.on("data", (c) => { out += c; });
		child.stderr.on("data", () => {});
		child.on("error", (error) => { clearTimeout(timer); reject(error); });
		child.on("close", () => { clearTimeout(timer); resolve(out); });
	});
}

// attempt() returns the judge's raw reply; parse() returns the verdict or undefined for a wrong shape.
export async function judgeWithRetry(attempt, parse, attempts = 2) {
	const errors = [];
	for (let i = 0; i < attempts; i++) {
		try {
			const out = await attempt();
			const value = parse(out);
			if (value !== undefined) return { value };
			errors.push(`invalid reply: ${String(out).slice(0, 200)}`);
		} catch (error) { errors.push(error.message); }
	}
	return { error: errors.join("; ") };
}

// The first JSON array in the reply, if every element passes ok and the length is n.
export function parseArray(out, n, ok) {
	try {
		const value = JSON.parse(String(out).match(/\[[\s\S]*?\]/)?.[0]);
		return Array.isArray(value) && value.length === n && value.every(ok) ? value : undefined;
	} catch { return undefined; }
}

// "k/n unit (95% lo-hi%)" with a Wilson interval; the unit says what was counted.
export function rate(k, n, unit) {
	const w = wilson(k, n);
	return w ? `${k}/${n} ${unit} (95% ${Math.round(w[0] * 100)}-${Math.round(w[1] * 100)}%)` : `0 ${unit}`;
}
