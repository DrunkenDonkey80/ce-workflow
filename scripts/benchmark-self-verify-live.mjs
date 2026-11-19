#!/usr/bin/env node
// Live A/B of the self-verify changes: "on" loads this package's extensions as they are; "off" loads a copy with
// self-verify.ts stubbed and tool-loader.ts from HEAD (the old one-line catalog), everything else identical.
// Each run: a fresh git fixture in temp, one `pi -p` prompt, then scoring from its session file.
// Usage: node scripts/benchmark-self-verify-live.mjs [--model ID] [--thinking L] [--reps N] [--arms on,off]
//          [--scenarios web,cli,explain,regress,locked,webapp,desktop,landing,pricing] [--parallel N] [--output DIR] [--append FILE]
// --append FILE adds FILE to the system prompt of every arm (prompt A/B: run once without, once with, then compare).
// Block ablation: an arm "no-<tag>[+<tag>...]" is "on" without those system-prompt sections (locked-writes, test-sensitivity,
// self-verify, reporting, ponytail, project-map), removed by scripts/bench-sections-off.ts. --ponytail also loads the
// user's ponytail extension in every arm. --dry-run sends no request: it prints which sections each arm's prompt has.
// Compare: node scripts/compare-benchmark-runs.mjs <out>/off/results.json <out>/on/results.json
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sessionMetrics } from "./lab-metrics.mjs";
import { handsOff } from "../extensions/self-verify.ts";
process.env.PI_WORK_PROJECT_MAP ??= "off"; // live runs never map unless a fixture opts in (PI_WORK_PROJECT_MAP=on)

const repo = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const value = (flag, fallback) => { const i = args.indexOf(flag); return i < 0 ? fallback : args[i + 1]; };
const model = value("--model", "openai-codex/gpt-5.6-terra");
const thinking = value("--thinking", "medium");
const reps = Number(value("--reps", "3"));
const arms = value("--arms", "off,on").split(",");
const scenarioNames = value("--scenarios", "web,cli,explain").split(",");
const parallel = Number(value("--parallel", "4"));
const append = value("--append", undefined);
const ponytail = args.includes("--ponytail") ? [path.join(os.homedir(), ".pi", "agent", "git", "github.com", "DietrichGebert", "ponytail", "pi-extension", "index.js")] : [];
const dryRun = args.includes("--dry-run");
// Anthropic runs need the user's OAuth pool provider: --no-extensions would leave a revoked auth.json token.
const providerExtension = path.join(os.homedir(), ".pi", "agent", "git", "github.com", "DrunkenDonkey80", "pi-provider-claude-ex", "index.ts");
const provider = model.startsWith("anthropic/") && existsSync(providerExtension) ? [providerExtension] : [];
const BLOCKS = ["locked-writes", "test-sensitivity", "self-verify", "reporting", "ponytail", "project-map"];
const out = path.resolve(value("--output", path.join(repo, ".pi", "self-verify-bench", new Date().toISOString().replace(/[:.]/g, "-"))));
const launcher = path.join(os.homedir(), ".pi", "agent", "bin", "pi-launcher.js");
const piEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PI_HUB"))); // dialogs never reach the user's hub
// No "unattended run" line: telling the model nobody is there hides the hand-off this benchmark measures.
const extensionList = (() => {
	try { return JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")).pi.extensions; }
	catch (error) { throw new Error(`cannot read pi.extensions from package.json: ${error.message}`, { cause: error }); }
})();

const TIDEPOOL = "# Tidepool\n\nShared grocery lists for families: everyone adds items from their phone, whoever is at the store ticks them off, and the list syncs live.\n";
const SCENARIOS = {
	web: {
		files: {
			"index.html": `<!doctype html>\n<html><body>\n<h1>Notes</h1>\n<textarea id="note"></textarea>\n<button id="save">Save</button>\n<p id="status"></p>\n<script src="app.js"></script>\n</body></html>\n`,
			"app.js": `document.getElementById("save-button").addEventListener("click", () => {\n\tlocalStorage.setItem("note", document.getElementById("note").value);\n\tdocument.getElementById("status").textContent = "Saved!";\n});\n`,
		},
		prompt: "Clicking Save on index.html should show \"Saved!\" but nothing happens. Fix it.",
		pass: (dir) => { // every id app.js looks up exists in index.html
			const html = readFileSync(path.join(dir, "index.html"), "utf8"), js = readFileSync(path.join(dir, "app.js"), "utf8");
			const ids = [...js.matchAll(/getElementById\(["']([^"']+)/g)].map((m) => m[1]);
			return ids.length > 0 && ids.every((id) => new RegExp(`id=["']${id}["']`).test(html));
		},
		verified: (calls) => calls.some((c) => c.name === "screen_read" || (c.name === "bash" && /agent-browser|playwright|puppeteer|jsdom|--headless|happy-dom/i.test(c.args))),
	},
	cli: {
		files: { "sum.mjs": "const [a, b] = process.argv.slice(2);\nconsole.log(a + b);\n" },
		prompt: "`node sum.mjs 2 3` prints 23 instead of 5. Fix it.",
		pass: (dir) => execFileSync(process.execPath, ["sum.mjs", "2", "3"], { cwd: dir, encoding: "utf8" }).trim() === "5",
		verified: (calls) => calls.some((c) => c.name === "bash" && /sum\.mjs/.test(c.args)),
	},
	webapp: { // a feature across server and UI; only a browser shows the button works
		files: (port) => ({
			"README.md": `# Todos\n\nRun \`node server.mjs\`, then open http://localhost:${port}.\n`,
			"server.mjs": `import http from "node:http";\nimport { readFile } from "node:fs/promises";\n\nconst PORT = Number(process.env.PORT ?? ${port});\nconst todos = [{ id: 1, text: "Buy milk", done: true }, { id: 2, text: "Write report", done: false }];\nlet next = 3;\nconst json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };\n\nhttp.createServer(async (req, res) => {\n\tconst url = new URL(req.url, "http://localhost");\n\tif (url.pathname === "/api/todos" && req.method === "GET") return json(res, 200, todos);\n\tif (url.pathname === "/api/todos" && req.method === "POST") {\n\t\tlet body = "";\n\t\tfor await (const chunk of req) body += chunk;\n\t\tconst todo = { id: next++, text: JSON.parse(body).text, done: false };\n\t\ttodos.push(todo);\n\t\treturn json(res, 201, todo);\n\t}\n\tconst toggle = url.pathname.match(/^\\/api\\/todos\\/(\\d+)\\/toggle$/);\n\tif (toggle && req.method === "POST") {\n\t\tconst todo = todos.find((t) => t.id === Number(toggle[1]));\n\t\tif (!todo) return json(res, 404, {});\n\t\ttodo.done = !todo.done;\n\t\treturn json(res, 200, todo);\n\t}\n\tconst file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);\n\tif (!["index.html", "app.js"].includes(file)) { res.writeHead(404); return res.end(); }\n\tres.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "text/html" });\n\tres.end(await readFile(new URL(\`./public/\${file}\`, import.meta.url)));\n}).listen(PORT, () => console.log(\`http://localhost:\${PORT}\`));\n`,
			"public/index.html": `<!doctype html>\n<html><head><title>Todos</title></head><body>\n<h1>Todos</h1>\n<form id="add"><input id="text" placeholder="New todo"><button>Add</button></form>\n<ul id="list"></ul>\n<script src="app.js"></script>\n</body></html>\n`,
			"public/app.js": `const list = document.getElementById("list");\n\nasync function load() {\n\tconst todos = await (await fetch("/api/todos")).json();\n\tlist.innerHTML = "";\n\tfor (const todo of todos) {\n\t\tconst item = document.createElement("li");\n\t\tconst box = document.createElement("input");\n\t\tbox.type = "checkbox";\n\t\tbox.checked = todo.done;\n\t\tbox.onchange = async () => { await fetch(\`/api/todos/\${todo.id}/toggle\`, { method: "POST" }); load(); };\n\t\titem.append(box, " ", todo.text);\n\t\tlist.append(item);\n\t}\n}\n\ndocument.getElementById("add").onsubmit = async (event) => {\n\tevent.preventDefault();\n\tconst input = document.getElementById("text");\n\tawait fetch("/api/todos", { method: "POST", body: JSON.stringify({ text: input.value }) });\n\tinput.value = "";\n\tload();\n};\n\nload();\n`,
		}),
		prompt: "Add a \"Clear completed\" button to the todo app: clicking it removes all completed todos, on the server too, so they stay gone after a reload.",
		pass: (dir) => /clear completed/i.test(readFileSync(path.join(dir, "public", "index.html"), "utf8") + readFileSync(path.join(dir, "public", "app.js"), "utf8"))
			&& execFileSync("git", ["diff", "--stat", "HEAD", "--", "server.mjs"], { cwd: dir, encoding: "utf8" }).trim() !== "",
		verified: (calls) => calls.some((c) => c.name === "screen_read" || (c.name === "bash" && /agent-browser|playwright|puppeteer|--headless/i.test(c.args))),
	},
	desktop: { // a native window; app_act/screen_read, or driving the Tk widgets from Python, count as checking it
		files: {
			"counter.py": `import tkinter as tk\n\nroot = tk.Tk()\nroot.title("Counter")\ncount = 0\nlabel = tk.Label(root, text="0", font=("Segoe UI", 32))\nlabel.pack(padx=40, pady=10)\n\n\ndef add():\n    global count\n    count += 1\n    label.config(text=str(count))\n\n\ndef reset():\n    global count\n    count = 0\n\n\ntk.Button(root, text="Add", command=add).pack(side="left", padx=10, pady=10)\ntk.Button(root, text="Reset", command=reset).pack(side="right", padx=10, pady=10)\nroot.mainloop()\n`,
		},
		prompt: "In the Counter app (`python counter.py`), pressing Reset doesn't set the number back to 0. Fix it.",
		pass: (dir) => /def reset\(\):[\s\S]*?label(?:\.config(?:ure)?\(|\[)/.test(readFileSync(path.join(dir, "counter.py"), "utf8")),
		verified: (calls) => calls.some((c) => c.name === "app_act" || c.name === "screen_read" || (c.name === "bash" && /python[\s\S]*(?:invoke|reset\(\)|event_generate)/i.test(c.args))),
	},
	regress: { // test-sensitivity: the fix needs a regression test that fails on the old code
		files: {
			"price.mjs": "export function total(amount) {\n\treturn amount > 100 ? amount * 0.9 : amount;\n}\n",
			"test.mjs": "import assert from \"node:assert/strict\";\nimport { total } from \"./price.mjs\";\n\nassert.equal(total(50), 50);\nassert.equal(total(200), 180);\nconsole.log(\"ok\");\n",
		},
		prompt: "Orders of 100 or more should get 10% off, but right now an order of exactly 100 gets no discount. Fix it. Tests: `node test.mjs`.",
		pass: (dir) => { // fixed code passes the agent's test, and that test fails on the original code
			const run = () => { try { execFileSync(process.execPath, ["test.mjs"], { cwd: dir, stdio: "ignore" }); return true; } catch { return false; } };
			const fixed = readFileSync(path.join(dir, "price.mjs"), "utf8");
			if (!run()) return false;
			try { execFileSync("git", ["checkout", "HEAD", "--", "price.mjs"], { cwd: dir }); return !run(); }
			finally { writeFileSync(path.join(dir, "price.mjs"), fixed); }
		},
		verified: (calls) => calls.some((c) => c.name === "test_sensitivity" || (c.name === "bash" && /test\.mjs/.test(c.args))), // test_sensitivity runs the tests green first
	},
	locked: { // locked-writes: decisions must come from the state read inside the lock
		files: {
			"store.mjs": "import { readFile, writeFile } from \"node:fs/promises\";\n\nlet chain = Promise.resolve();\nexport function withLock(fn) {\n\tconst run = chain.then(fn, fn);\n\tchain = run.catch(() => {});\n\treturn run;\n}\n\n// Counts every visit and remembers each user once.\nexport async function addVisit(file, user) {\n\tconst data = JSON.parse(await readFile(file, \"utf8\"));\n\tconst seen = data.users.includes(user);\n\treturn withLock(async () => {\n\t\tif (!seen) data.users.push(user);\n\t\tdata.visits += 1;\n\t\tawait writeFile(file, JSON.stringify(data));\n\t\treturn data.visits;\n\t});\n}\n",
		},
		prompt: "When several requests call addVisit in store.mjs at the same time, visits get lost. Fix it.",
		pass: (dir) => { // 20 concurrent visits by 5 users: 20 visits, 5 users
			const code = `import { addVisit } from "./store.mjs"; import { readFileSync, writeFileSync } from "node:fs"; writeFileSync("bench-store.json", JSON.stringify({ visits: 0, users: [] })); await Promise.all(Array.from({ length: 20 }, (_, i) => addVisit("bench-store.json", "u" + (i % 5)))); const d = JSON.parse(readFileSync("bench-store.json", "utf8")); console.log(d.visits === 20 && d.users.length === 5);`;
			try { return execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: dir, encoding: "utf8" }).trim() === "true"; } catch { return false; }
			finally { rmSync(path.join(dir, "bench-store.json"), { force: true }); }
		},
		verified: (calls) => calls.some((c) => c.name === "test_sensitivity" || (c.name === "bash" && /node\b/.test(c.args) && /store|addVisit/.test(c.args))),
	},
	// Vague design briefs (plan f01355e6 X13): pass is only the must-haves; score expected extras with scripts/judge-design-extras.mjs.
	landing: {
		files: { "README.md": TIDEPOOL },
		prompt: "Build a landing page for Tidepool (see README.md) as index.html.",
		pass: (dir) => /<html/i.test(readFileSync(path.join(dir, "index.html"), "utf8")),
		verified: (calls) => SCENARIOS.web.verified(calls),
	},
	pricing: {
		files: { "README.md": TIDEPOOL },
		prompt: "Build a pricing page for Tidepool (see README.md) as pricing.html, with Free, Family and Pro plans.",
		pass: (dir) => { const html = readFileSync(path.join(dir, "pricing.html"), "utf8"); return ["Free", "Family", "Pro"].every((plan) => html.includes(plan)); },
		verified: (calls) => SCENARIOS.web.verified(calls),
	},
	explain: { // control: explanation requested, files must stay untouched, no checks expected
		files: { "sum.mjs": "const [a, b] = process.argv.slice(2);\nconsole.log(Number(a) + Number(b));\n" },
		prompt: "Explain briefly how I would add a --verbose flag to sum.mjs. Don't change any files.",
		pass: (dir) => execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).trim() === "",
		verified: () => null,
	},
};

// The "off" arm: same extensions with the change removed. A sibling of extensions/ so ../package.json and ../hub resolve.
function offExtensions() {
	const dir = path.join(repo, `extensions-bench-off-${process.pid}`); // per process: parallel benchmark invocations
	rmSync(dir, { recursive: true, force: true });
	cpSync(path.join(repo, "extensions"), dir, { recursive: true });
	writeFileSync(path.join(dir, "tool-loader.ts"), execFileSync("git", ["show", "HEAD:extensions/tool-loader.ts"], { cwd: repo, encoding: "utf8" }));
	writeFileSync(path.join(dir, "self-verify.ts"), `export const SELF_VERIFY = "";\n`);
	return dir;
}

function fixture(scenario) {
	const dir = mkdtempSync(path.join(os.tmpdir(), "sv-"));
	const files = typeof scenario.files === "function" ? scenario.files(41000 + Math.floor(Math.random() * 9000)) : scenario.files; // own port: runs are parallel
	for (const [name, text] of Object.entries(files)) {
		mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
		writeFileSync(path.join(dir, name), text);
	}
	const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
	git("init", "-q"); git("add", "-A"); git("-c", "user.name=bench", "-c", "user.email=bench@local", "commit", "-q", "-m", "fixture");
	writeFileSync(path.join(dir, ".git", "info", "exclude"), "/.pi/\n/.ce-workflow/\n/.pi-lens-probe-home/\n");
	return dir;
}

function sessionEntries(sessions) {
	const files = existsSync(sessions) ? readdirSync(sessions).filter((n) => n.endsWith(".jsonl")) : [];
	// A killed run can leave a partial last line; skip it like lab-metrics does.
	return files.flatMap((n) => readFileSync(path.join(sessions, n), "utf8").split("\n").flatMap((l) => { try { return l ? [JSON.parse(l)] : []; } catch { return []; } }));
}

async function one(arm, extDir, name, repetition) {
	const scenario = SCENARIOS[name];
	const id = `${arm}-${name}-${repetition}`;
	const art = path.join(out, arm, `${name}-${repetition}`);
	mkdirSync(art, { recursive: true });
	const dir = fixture(scenario), sessions = path.join(art, "sessions");
	const extArgs = [...extensionList.map((rel) => path.join(extDir, path.relative("extensions", rel))), ...provider, ...ponytail, path.join(repo, "scripts", "bench-sections-off.ts")].flatMap((file) => ["--extension", file]);
	const payload = path.join(art, "dry-run-payload.json");
	const started = Date.now();
	const { code, timedOut } = await new Promise((resolve) => {
		const child = spawn(process.execPath, [launcher, "-p", "--mode", "json", "--model", model, "--thinking", thinking, "--no-extensions", ...extArgs,
			"--session-dir", sessions, ...(append ? ["--append-system-prompt", path.resolve(append)] : []), scenario.prompt],
		{ cwd: dir, env: { ...piEnv, AGENT_BROWSER_SESSION: `sv-${process.pid}-${id}`, BENCH_SECTIONS_OFF: arm.startsWith("no-") ? arm.slice(3).replaceAll("+", ",") : "", ...(dryRun ? { BENCH_DRY_RUN: payload } : {}) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
		let timedOut = false;
		const timer = setTimeout(() => { timedOut = true; child.kill(); }, 15 * 60_000);
		const log = [];
		child.stdout.on("data", (c) => log.push(c));
		child.stderr.on("data", (c) => log.push(c));
		child.on("exit", (code) => { clearTimeout(timer); writeFileSync(path.join(art, "pi.log"), Buffer.concat(log)); resolve({ code, timedOut }); });
	});
	const elapsedMs = Date.now() - started;
	if (dryRun) {
		const sent = existsSync(payload) ? readFileSync(payload, "utf8") : "";
		const present = BLOCKS.filter((tag) => sent.includes(`<${tag}>`));
		console.log(id, sent ? `sections: ${present.join(", ") || "none"}; missing: ${BLOCKS.filter((t) => !present.includes(t)).join(", ") || "none"}` : `no payload (exit ${code})`);
		return { scenario: name, repetition, arm, dryRun: true, present };
	}
	try { execFileSync("agent-browser", ["--session", `sv-${process.pid}-${id}`, "close"], { stdio: "ignore", timeout: 20_000 }); } catch {}
	const messages = sessionEntries(sessions).filter((e) => e.type === "message").map((e) => e.message);
	const calls = messages.filter((m) => m.role === "assistant").flatMap((m) => (m.content ?? []).filter((b) => b.type === "toolCall"))
		.map((b) => ({ name: b.name, args: JSON.stringify(b.arguments ?? {}) }));
	const nudged = messages.filter((m) => m.role === "user" && JSON.stringify(m.content).includes("Self-verify check")).length;
	const firstAnswer = nudged ? messages.slice(0, messages.findIndex((m) => m.role === "user" && JSON.stringify(m.content).includes("Self-verify check"))) : messages;
	const finalText = messages.filter((m) => m.role === "assistant").map((m) => (m.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("")).filter(Boolean).at(-1) ?? "";
	const metrics = sessionMetrics(sessions);
	const failed = timedOut ? "timeout" : code !== 0 ? `exit ${code}` : messages.find((m) => m.role === "assistant" && m.stopReason === "error")?.errorMessage?.slice(0, 200);
	let pass;
	try { pass = scenario.pass(dir); } catch { pass = false; }
	const result = {
		scenario: name, repetition, arm, model, elapsedMs, completed: !failed, ...(failed ? { error: failed } : {}),
		usage: { totalTokens: metrics.totalTokens, costUsd: metrics.cost }, turns: metrics.turns, toolCalls: metrics.toolCalls,
		pass, verified: scenario.verified(calls), handoffBeforeNudge: handsOff(firstAnswer), handoffFinal: handsOff(messages), nudged,
		finalWords: finalText.split(/\s+/).filter(Boolean).length, finalText,
		enabled: calls.filter((c) => c.name === "tools_enable").map((c) => c.args), dir,
	};
	writeFileSync(path.join(art, "result.json"), JSON.stringify(result, null, 2));
	console.log(id, JSON.stringify({ pass, verified: result.verified, handoff: result.handoffBeforeNudge, nudged, turns: result.turns, cost: result.usage.costUsd, s: Math.round(elapsedMs / 1000) }));
	return result;
}

const benchStart = new Date();
const extDirs = { on: path.join(repo, "extensions"), off: arms.includes("off") ? offExtensions() : undefined };
const jobs = [];
for (let repetition = 1; repetition <= reps; repetition++) for (const name of scenarioNames) for (const arm of arms) jobs.push([arm, extDirs[arm] ?? extDirs.on, name, repetition]);
const results = [];
try {
	let next = 0;
	const worker = async () => {
		while (next < jobs.length) {
			const job = jobs[next++];
			try { results.push(await one(...job)); }
			catch (error) { results.push({ scenario: job[2], repetition: job[3], arm: job[0], error: String(error?.message ?? error) }); console.error(`${job[0]}-${job[2]}-${job[3]} failed:`, error); }
		}
	};
	await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, () => worker()));
} finally {
	if (extDirs.off) rmSync(extDirs.off, { recursive: true, force: true });
	// Agents may leave the fixture app or server running; stop only those started during this benchmark.
	if (process.platform === "win32") try {
		execFileSync("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -gt [datetime]'${benchStart.toISOString()}' -and $_.CommandLine -match 'counter\\.py|server\\.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: "ignore", timeout: 60_000 });
	} catch (error) { console.error("stray-process cleanup failed:", error.message); }
}
if (dryRun) process.exit(0);
for (const arm of arms) writeFileSync(path.join(out, arm, "results.json"), JSON.stringify({ model, thinking, results: results.filter((r) => r.arm === arm) }, null, 2));
for (const arm of arms) {
	const rs = results.filter((r) => r.arm === arm && !r.error);
	const count = (key, value = true) => rs.filter((r) => r[key] === value).length;
	console.log(`${arm}: ${rs.length} ok runs, pass ${count("pass")}, verified ${count("verified")}/${rs.filter((r) => r.verified !== null).length}, hand-off ${count("handoffBeforeNudge")} (final ${count("handoffFinal")}), nudged ${rs.filter((r) => r.nudged).length}, cost $${rs.reduce((s, r) => s + r.usage.costUsd, 0).toFixed(3)}`);
}
console.log(`results: ${out}`);
