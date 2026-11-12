# Baseline: today's stack outside the model (T-02)

Part of the map `docs/plans/2026-11-12-own-agent-stack-instead-of-pi-go-no-go-map-11005151-plan3.md`. These are startup and resource numbers, not workflow speed. A claim that a path makes the workflow faster needs the end-to-end accounting in the AGENTS.md Optimization Regression Rule.

## Machine and setup

- Intel Core Ultra 7 265K (20 threads), 47 GB RAM, Windows native, Node v26.13.1, Pi 1.5.2. Measured 2026-11-12.
- Pi is spawned the way the hub spawns it (`hub/src/rpc-client.ts` `start()`: `node pi-launcher.js --mode rpc`). Extra flags: `--no-session --offline`, a fresh empty temp directory as cwd, model `openai-codex/gpt-6-luna`.
- **full** = our real setup (every package in `settings.json` plus ce-workflow). **bare** = `--no-extensions --no-skills` (Pi core only).
- Memory = the sum over the spawned process tree (launcher node, Pi node, console host): working set and private bytes, read 3 s after ready.

## Shared scenarios (any candidate server can run these)

| ID | Scenario | Measured as |
|---|---|---|
| S1 | Start to first ready reply | spawn, send a state query, wait for its response |
| S2 | First start vs warm start | S1 after the machine was idle vs repeated S1 |
| S3 | Idle memory, 1 session | after S1 plus 3 s |
| S4 | 5 sessions | start 5 at once: time until all are ready, summed memory |
| S5 | One short turn, overhead outside the model | prompt "Reply with exactly the word OK" with no tools; timeline from prompt sent |

Repetitions: S1 5 times per config; S4 2 times; S5 3 times. Results are medians.

## Results (medians)

| Scenario | bare (Pi core) | full (our setup) | Extension cost |
|---|---|---|---|
| S1 start to ready, warm | 270 ms | 1,339 ms | +1.07 s |
| S2 first start (1 run, first full start of the measuring session; disk cache probably cold) | 272 ms | 2,962 ms | +2.7 s |
| S3 memory, 1 idle session | 185 MB working set, 122 MB private | 335 MB, 276 MB | +150 MB |
| S4 5 sessions: all ready | 315 ms | 1,565 ms | |
| S4 5 sessions: memory | 936 MB, 621 MB private | 1,724 MB, 1,451 MB private | +790 MB |
| S5 prompt to `agent_start` | 2 ms | 11 ms | +9 ms |
| S5 prompt to first streamed token (model included) | 1,559 ms | 1,668 ms | about +110 ms, within model noise |
| S5 `agent_end` to `agent_settled` | 1 ms | 3 ms | |

Live sessions, sampled the same day: 2 running hub sessions used 584 MB and 341 MB of working set for the Pi process, plus 53 to 65 MB each for its launcher process. Long sessions grow well past the idle numbers.

## Pi-only metrics (not comparable to other servers)

- Extension load: about 1.1 s warm and 2.7 s on the first start, from full minus bare in S1.
- Hub session spawn: the same as full S1, since the hub spawns exactly this command. The hub's own work around it is not measured.
- `/reload`: not measured. Sent as an RPC prompt, it started a run (`disposition: started`) instead of reloading, so RPC has no reload command to time.
- Two node processes per session: the launcher (about 55 to 65 MB) plus Pi itself.

## Reading

- Outside the model, Pi core is fast: about 0.3 s to ready and about 120 MB private memory per session.
- Our packages make it about 5 times slower to start (+1.1 s warm, +2.7 s on the first start) and double the memory (+150 MB per session, about +800 MB for 5 sessions).
- Per-turn overhead outside the model is about 10 ms. Model time dominates every turn.
- The speed pain is therefore start time and memory from the package load, not the agent loop.

## Raw results

```jsonl
{"config":"bare","scenario":"start","model":"openai-codex/gpt-6-luna","node":"v26.13.1","results":[{"rep":0,"readyMs":275,"procs":3,"wsMB":185,"privateMB":122},{"rep":1,"readyMs":272,"procs":3,"wsMB":186,"privateMB":122},{"rep":2,"readyMs":270,"procs":3,"wsMB":185,"privateMB":122},{"rep":3,"readyMs":262,"procs":3,"wsMB":185,"privateMB":121},{"rep":4,"readyMs":258,"procs":3,"wsMB":186,"privateMB":123}]}
{"config":"full","scenario":"start","model":"openai-codex/gpt-6-luna","node":"v26.13.1","results":[{"rep":0,"readyMs":1348,"procs":3,"wsMB":347,"privateMB":292},{"rep":1,"readyMs":1207,"procs":3,"wsMB":335,"privateMB":276},{"rep":2,"readyMs":1356,"procs":3,"wsMB":336,"privateMB":277},{"rep":3,"readyMs":1298,"procs":3,"wsMB":334,"privateMB":274},{"rep":4,"readyMs":1339,"procs":3,"wsMB":334,"privateMB":275}]}
{"config":"bare","scenario":"five","model":"openai-codex/gpt-6-luna","node":"v26.13.1","results":[{"rep":0,"allReadyMs":315,"wsMB":936,"privateMB":618},{"rep":1,"allReadyMs":303,"wsMB":936,"privateMB":621}]}
{"config":"full","scenario":"five","model":"openai-codex/gpt-6-luna","node":"v26.13.1","results":[{"rep":0,"allReadyMs":1565,"wsMB":1724,"privateMB":1451},{"rep":1,"allReadyMs":1508,"wsMB":1661,"privateMB":1364}]}
{"config":"full","scenario":"reload","model":"openai-codex/gpt-6-luna","node":"v26.13.1","results":[{"rep":0,"disposition":"started","reloadMs":42},{"rep":1,"disposition":"started","reloadMs":42},{"rep":2,"disposition":"started","reloadMs":43}]}
{"config":"bare","scenario":"turn","model":"openai-codex/gpt-6-luna","node":"v26.13.1","results":[{"rep":0,"disposition":"started","agent_start":2,"message_end":3,"firstUpdate":1342,"agent_end":1536,"agent_settled":1536,"settleAfterEndMs":0},{"rep":1,"disposition":"started","agent_start":2,"message_end":2,"firstUpdate":1559,"agent_end":3120,"agent_settled":3121,"settleAfterEndMs":1},{"rep":2,"disposition":"started","agent_start":2,"message_end":2,"firstUpdate":1589,"agent_end":1638,"agent_settled":1639,"settleAfterEndMs":1}]}
{"config":"full","scenario":"turn","model":"openai-codex/gpt-6-luna","node":"v26.13.1","results":[{"rep":0,"disposition":"started","agent_start":11,"message_end":29,"firstUpdate":1615,"agent_end":1725,"agent_settled":1728,"settleAfterEndMs":3},{"rep":1,"disposition":"started","agent_start":11,"message_end":14,"firstUpdate":1765,"agent_end":1910,"agent_settled":1913,"settleAfterEndMs":3},{"rep":2,"disposition":"started","agent_start":11,"message_end":13,"firstUpdate":1668,"agent_end":1829,"agent_settled":1832,"settleAfterEndMs":3}]}
```

## Script (`%TEMP%\own-agent-stack\bench.mjs`)

Usage: `node bench.mjs <full|bare> <start|five|turn|reload> <reps>`.

```js
// T-02 baseline: start, memory, turn timeline and /reload of `pi --mode rpc`, the way hub/src/rpc-client.ts spawns it.
// usage: node bench.mjs <config full|bare> <scenario start|five|turn|reload> <reps> [model]
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const [config = "full", scenario = "start", reps = "3", model = "openai-codex/gpt-6-luna"] = process.argv.slice(2);
const launcher = join(process.env.USERPROFILE, ".pi", "agent", "bin", "pi-launcher.js");
const cwd = mkdtempSync(join(tmpdir(), "pi-bench-"));
const extra = config === "bare" ? ["--no-extensions", "--no-skills"] : [];

function start() {
	const t0 = performance.now();
	const child = spawn(process.execPath, [launcher, "--mode", "rpc", "--no-session", "--offline", "--model", model, ...extra], { cwd, stdio: "pipe", windowsHide: true });
	let buf = "";
	const waiters = new Map(), listeners = [];
	child.stdout.on("data", d => {
		buf += d; let i;
		while ((i = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1);
			let rec; try { rec = JSON.parse(line); } catch { continue; }
			if (rec.type === "response" && waiters.has(rec.id)) { waiters.get(rec.id)(rec); waiters.delete(rec.id); }
			else listeners.forEach(l => l(rec, performance.now()));
		}
	});
	child.stderr.on("data", () => {});
	const send = (cmd) => new Promise(res => { waiters.set(cmd.id, res); child.stdin.write(JSON.stringify(cmd) + "\n"); });
	return { child, t0, send, listeners };
}

// Working set and private bytes of the process tree, MB.
function memory(pid) {
	const ps = `$all=Get-CimInstance Win32_Process|Select ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount;$ids=@(${pid});$i=0;while($i -lt $ids.Count){$ids+=@($all|?{$_.ParentProcessId -eq $ids[$i]}|%{$_.ProcessId});$i++};$t=$all|?{$ids -contains $_.ProcessId};"{0} {1} {2}" -f $ids.Count,(($t|Measure WorkingSetSize -Sum).Sum/1MB),(($t|Measure PrivatePageCount -Sum).Sum/1MB)`;
	const [procs, ws, priv] = execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).trim().split(" ").map(Number);
	return { procs, wsMB: Math.round(ws), privateMB: Math.round(priv) };
}
const stop = (p) => new Promise(res => { p.child.on("exit", res); p.child.stdin.end(); setTimeout(() => p.child.kill(), 15000); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const out = [];
for (let r = 0; r < Number(reps); r++) {
	if (scenario === "start") {
		const p = start();
		await p.send({ id: "s", type: "get_state" });
		const readyMs = Math.round(performance.now() - p.t0);
		await sleep(3000);
		out.push({ rep: r, readyMs, ...memory(p.child.pid) });
		await stop(p);
	} else if (scenario === "five") {
		const ps = Array.from({ length: 5 }, start);
		await Promise.all(ps.map(p => p.send({ id: "s", type: "get_state" })));
		const allReadyMs = Math.round(performance.now() - Math.min(...ps.map(p => p.t0)));
		await sleep(3000);
		const mem = ps.map(p => memory(p.child.pid));
		out.push({ rep: r, allReadyMs, wsMB: mem.reduce((a, m) => a + m.wsMB, 0), privateMB: mem.reduce((a, m) => a + m.privateMB, 0) });
		await Promise.all(ps.map(stop));
	} else if (scenario === "turn") {
		const p = start();
		await p.send({ id: "s", type: "get_state" });
		const marks = {};
		const settled = new Promise(res => p.listeners.push((rec, t) => {
			const k = rec.type === "message_update" ? "firstUpdate" : rec.type;
			if (["agent_start", "firstUpdate", "message_end", "agent_end", "agent_settled"].includes(k) && marks[k] === undefined) marks[k] = t;
			if (rec.type === "agent_settled") res();
		}));
		const t = performance.now();
		const resp = await p.send({ id: "p", type: "prompt", message: "Reply with exactly the word OK and nothing else. Do not use tools." });
		await settled;
		const rel = Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, Math.round(v - t)]));
		out.push({ rep: r, disposition: resp.data?.disposition ?? resp.error, ...rel, settleAfterEndMs: rel.agent_settled - rel.agent_end });
		await stop(p);
	} else if (scenario === "reload") {
		const p = start();
		await p.send({ id: "s", type: "get_state" });
		const t = performance.now();
		const resp = await p.send({ id: "r", type: "prompt", message: "/reload" });
		await p.send({ id: "s2", type: "get_state" });
		out.push({ rep: r, disposition: resp.data?.disposition ?? resp.error, reloadMs: Math.round(performance.now() - t) });
		await stop(p);
	}
}
console.log(JSON.stringify({ config, scenario, model, node: process.version, results: out }));
```
