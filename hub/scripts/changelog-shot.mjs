// Changelog screenshots: node hub/scripts/changelog-shot.mjs "<css selector>" docs/changelog/<name>.png [setup JS] [--size=1280x800] [--pad=12] [--ask=<ask_user JSON>]
// Starts a throwaway hub (temp PI_CODING_AGENT_DIR, fake Pi, a git folder named ce-workflow with one open plan),
// opens the page headless, optionally shows an ask_user form (--ask, e.g. a command's dialog), runs the optional setup JS
// in the page (open a menu, click a tab...), then crops the selector plus --pad pixels of what surrounds it.
// Nothing touches the real hub or its sessions.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [selector, out, setup = ""] = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
const flag = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const pad = Number(flag("pad") ?? 12), ask = flag("ask"), [width, height] = (flag("size") ?? "1280x800").split("x");
if (!selector || !out || !/\.png$/i.test(out)) { console.error('Usage: changelog-shot.mjs "<selector>" <out.png> [setup JS] [--size=WxH] [--pad=N] [--ask=JSON]'); process.exit(2); }
const binary = process.platform === "win32" ? join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe") : "agent-browser";
const session = `hub-shot-${process.pid}`, execute = promisify(execFile);
async function browser(...args) {
	const { stdout } = await execute(binary, ["--session", session, "--json", ...args], { timeout: 30_000, maxBuffer: 2_000_000 });
	let result; try { result = JSON.parse(stdout); } catch { throw new Error("agent-browser returned non-JSON: " + stdout.slice(0, 300)); }
	if (!result.success) throw new Error(args[0] + ": " + JSON.stringify(result.error ?? result)); return result.data;
}

const root = fs.mkdtempSync(join(os.tmpdir(), "hub-shot-")), folder = join(root, "ce-workflow");
process.env.PI_CODING_AGENT_DIR = root;
fs.mkdirSync(join(folder, "docs/plans"), { recursive: true });
fs.writeFileSync(join(folder, "docs/plans/2026-10-25-sample-plan-12345678-plan3.md"), "---\nplan3: true\nstatus: active\ncreated: 2026-10-25\n---\n\n# Sample plan\n\n## Steps\n\n- [x] **S01** first\n- [ ] **S02** second\n");
execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "init", "-q"], { cwd: folder });

// What ce-workflow would answer through /pi-hub: just enough for a full header.
const models = { model: { provider: "fake", id: "fake-1", name: "Claude Opus" }, effort: "high", efforts: ["low", "medium", "high"], scoped: [{ provider: "fake", id: "fake-1", name: "Claude Opus" }], others: [] };
const stub = endpoint => endpoint === "/api/models" ? models : endpoint === "/api/commands" ? { pi: [], wo: [], args: {} } : { ok: true };
const relay = http.createServer((request, response) => { let text = ""; request.on("data", c => text += c); request.on("end", () => { let value; try { value = { ok: true, value: stub(JSON.parse(text).endpoint) }; } catch (error) { value = { ok: false, status: 500, error: error.message }; } response.end(JSON.stringify(value)); }); });
await new Promise(done => relay.listen(0, "127.0.0.1", done));
process.env.FAKE_PI_HUB_URL = `http://127.0.0.1:${relay.address().port}/`;

const { startHub } = await import("../src/hub.ts");
const hub = await startHub({ command: [process.execPath, fileURLToPath(new URL("./fake-pi.mjs", import.meta.url))], usage: false, pool: false, models: undefined });
try {
	const { id } = await hub.host.create(folder, "1"), rpc = hub.host.live.get(id).rpc;
	await rpc.send({ type: "prompt", message: "/state " + JSON.stringify({ plan: { id: "12345678", title: "Sample plan", status: "active", done: 1, total: 2, focus: "S02", bias: 0 }, modes: { research: "off", night: "off" } }) });
	await browser("set", "viewport", width, height);
	await browser("open", `http://127.0.0.1:${hub.config.port}/s/${id}/?token=${hub.config.localKey}`);
	await browser("wait", "--fn", 'document.getElementById("title").textContent.startsWith("ce-workflow")');
	if (ask) { JSON.parse(ask); void rpc.send({ type: "prompt", message: "/hubask 0 " + ask }).catch(() => {}); await browser("wait", "--fn", "document.getElementById(\"prompt\")?.open"); }
	if (setup) await browser("eval", "-b", Buffer.from(`(async () => { ${setup} })()`).toString("base64"));
	await browser("wait", "600");
	const file = resolve(out); fs.mkdirSync(join(file, ".."), { recursive: true });
	// A transparent fixed frame over the element plus padding: the element screenshot of the frame shows what is under it.
	const framed = await browser("eval", "-b", Buffer.from(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const r = el.getBoundingClientRect(), p = ${pad};
		const x = Math.max(0, r.left - p), y = Math.max(0, r.top - p), frame = Object.assign(document.createElement("div"), { id: "changelog-shot-frame" });
		frame.style.cssText = \`position:fixed;left:\${x}px;top:\${y}px;width:\${Math.min(innerWidth, r.right + p) - x}px;height:\${Math.min(innerHeight, r.bottom + p) - y}px;pointer-events:none;z-index:2147483647;background:transparent\`;
		document.body.append(frame); return true; })()`).toString("base64"));
	if (!framed.result) throw new Error("No element matches " + selector);
	await browser("screenshot", "#changelog-shot-frame", file);
	console.log("saved " + file);
} finally {
	await hub.stop(); relay.close(); await browser("close").catch(() => {});
	fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
