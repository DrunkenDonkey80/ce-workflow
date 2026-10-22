// Changelog screenshots: node hub/scripts/changelog-shot.mjs "<css selector>" docs/changelog/<name>.png [setup JS] [--wide]
// Starts a throwaway hub (temp PI_CODING_AGENT_DIR, fake Pi, a git folder named ce-workflow with one open plan),
// opens the page headless, runs the optional setup JS in the page (open a menu, click a tab...), then crops the selector.
// Nothing touches the real hub or its sessions.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [selector, out, setup = ""] = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
if (!selector || !out || !/\.png$/i.test(out)) { console.error('Usage: changelog-shot.mjs "<selector>" <out.png> [setup JS] [--wide]'); process.exit(2); }
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
	await browser("set", "viewport", process.argv.includes("--wide") ? "1600" : "1280", "800");
	await browser("open", `http://127.0.0.1:${hub.config.port}/s/${id}/?token=${hub.config.localKey}`);
	await browser("wait", "--fn", 'document.getElementById("title").textContent.startsWith("ce-workflow")');
	if (setup) await browser("eval", "-b", Buffer.from(`(async () => { ${setup} })()`).toString("base64"));
	await browser("wait", "600");
	const file = resolve(out); fs.mkdirSync(join(file, ".."), { recursive: true });
	await browser("screenshot", selector, file);
	console.log("saved " + file);
} finally {
	await hub.stop(); relay.close(); await browser("close").catch(() => {});
	fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
