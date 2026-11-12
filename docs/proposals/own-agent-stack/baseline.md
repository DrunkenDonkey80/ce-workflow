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

## Candidates measured on this machine (T-07)

Measured 2026-11-12, same machine. Finalists from T-05: **Codex `app-server` 0.166.0** (the installed CLI; the newest release is 0.167.1) against **Pi 1.5.2**. Same scenarios S1 to S5, plus **S4b**: five threads in one server process, which is how a hub built on `app-server` would run.

- **Codex bare:** an empty `CODEX_HOME` with no config, MCP servers or login.
- **Codex full:** the user's real `~/.codex`: 4 MCP servers, 13 plugins and hooks.
- **Codex spawn:** the native `codex.exe`, the way a hub would spawn it. Model `gpt-6-luna` for both agents.
- **WSL setup:**
  - Ubuntu-26.04, Node v24.22.0.
  - Native Linux installs of Pi and Codex in `~/oas`, on ext4.
  - Pi bare uses a WSL-local agent dir, unless the row says `/mnt/c`.
  - Pi full was not run in WSL, because its packages are installed for Windows.
- **Memory on Linux:** "private" counts pages mapped by one process only. A static binary's code counts as private when one copy runs and as shared when five run, which is why "five" can be lower than five times one.

### Windows native (medians)

| Scenario | Pi bare | Pi full (ours) | Codex bare | Codex full (user's `~/.codex`) |
|---|---|---|---|---|
| S1 start to ready | 270 ms | 1,339 ms | 88 ms (thread ready 118 ms) | 166 ms (thread ready 327 ms) |
| S3 memory, 1 idle session | 122 MB private, 3 procs | 276 MB, 3 procs | 37 MB private, 8 procs | 364 MB, 21 procs |
| S4 5 processes: all ready, memory | 315 ms, 621 MB | 1,565 ms, 1,451 MB | 152 to 159 ms, 120 to 126 MB | 489 to 511 ms, 1,873 to 1,883 MB |
| S4b 5 threads, 1 process | — (no multi-session server) | — | 115 to 155 ms, 46 to 54 MB | 295 to 333 ms, **72 procs**, 1,546 MB |
| S5 prompt to turn start | 2 ms | 11 ms | not run (needs a login copy) | 27 ms |
| S5 prompt to first token, `gpt-6-luna` | 1,559 ms | 1,668 ms | not run | 3,206 ms |
| S5 first token, Claude `claude-opus-5-5` | — | 1,052 and 2,302 ms (2 runs) | not possible (no Claude login, G1) | not possible |

The first full S4 attempt for Codex hung (no reply within 900 s) and was killed; the two reruns completed.

### WSL (medians)

| Scenario | Pi bare | Pi bare, agent dir on `/mnt/c` | Codex bare |
|---|---|---|---|
| S1 start to ready | 152 ms | 1,821 ms | 87 ms (thread ready 99 ms) |
| S3 memory, 1 session | 112 MB RSS, 60 MB private, 1 proc | 113 MB RSS | 153 MB RSS, 144 MB private, 4 procs |
| S4 5 processes | 191 ms, 560 MB RSS, 293 MB private | 1,272 to 1,348 ms | 100 to 105 ms, 707 MB RSS, 130 MB private |
| S4b 5 threads, 1 process | — | — | 108 to 124 ms, 173 MB RSS |
| S5 first token, `gpt-6-luna` | — | 1,060 and 1,574 ms (turn start 2 ms) | not measured: with the Windows `~/.codex` mounted, `initialize` never replied; a separate WSL login would start a second token lineage, so it was not tried |
| S5 first token, Claude | — | 1,193 and 2,164 ms | not possible (G1) |

### Matrix: candidate by server OS by provider

| | Windows native | WSL | Linux (no machine available) |
|---|---|---|---|
| Pi, OpenAI Codex login | tested (T-02) | tested | cited: Pi installer and docs |
| Pi, Claude subscription | tested | tested | cited, same code path |
| Codex app-server, OpenAI Codex login | tested | unknown: hung with the shared config | cited: Linux release binaries |
| Codex app-server, Claude subscription | not possible (G1; addable by porting our provider) | not possible | not possible |

### Reading

- **Core:** Codex core starts about 3 times faster than Pi core (88 against 270 ms on Windows) and uses about a third of the memory (37 against 122 MB private).
- **Five sessions:** one Codex process with five threads uses about 50 MB, against 621 MB for five bare Pi processes. That is the gain from in-process sessions. Pi's SDK could capture part of it (`wishes.md`), but that is not measured.
- **Full setups are heavy on both agents:**
  - Ours: Pi full uses 276 MB and takes 1.3 s per session.
  - The user's Codex full uses 364 MB and 21 processes per session.
  - Codex starts every MCP server once per thread, so five threads made 72 processes.
  - On both agents the cost is in extensions and MCP servers, not in the core.
- **Turns:** Codex full took 3.2 s to the first token, against 1.7 s for Pi on the same model. Not separated: Codex's larger system prompt, its hooks and its plugins all add to that. Overhead before the model is 11 ms on Pi and 27 ms on Codex; model time dominates both.
- **WSL:** Pi starts in 0.15 s with its config on ext4, but in 1.8 s with the config on `/mnt/c`. A WSL server must keep its files inside WSL.

### Raw results (T-07)

Windows (`results.jsonl`):

```jsonl
{"candidate":"codex app-server","config":"bare","scenario":"start","model":"gpt-6-luna","platform":"win32","results":[{"rep":0,"readyMs":98,"threadMs":128,"procs":8,"wsMB":125,"privateMB":37},{"rep":1,"readyMs":82,"threadMs":115,"procs":8,"wsMB":125,"privateMB":37},{"rep":2,"readyMs":86,"threadMs":118,"procs":8,"wsMB":125,"privateMB":37},{"rep":3,"readyMs":88,"threadMs":117,"procs":8,"wsMB":126,"privateMB":38},{"rep":4,"readyMs":98,"threadMs":128,"procs":8,"wsMB":126,"privateMB":38}]}
{"candidate":"codex app-server","config":"bare","scenario":"five","model":"gpt-6-luna","platform":"win32","results":[{"rep":0,"allReadyMs":159,"wsMB":401,"privateMB":126},{"rep":1,"allReadyMs":152,"wsMB":389,"privateMB":120}]}
{"candidate":"codex app-server","config":"bare","scenario":"fiveThreads","model":"gpt-6-luna","platform":"win32","results":[{"rep":0,"allReadyMs":115,"procs":8,"wsMB":141,"privateMB":54},{"rep":1,"allReadyMs":155,"procs":5,"wsMB":114,"privateMB":46}]}
{"candidate":"codex app-server","config":"full","scenario":"start","model":"gpt-6-luna","platform":"win32","results":[{"rep":0,"readyMs":150,"threadMs":323,"procs":21,"wsMB":568,"privateMB":350},{"rep":1,"readyMs":166,"threadMs":330,"procs":21,"wsMB":591,"privateMB":364},{"rep":2,"readyMs":177,"threadMs":327,"procs":21,"wsMB":590,"privateMB":364},{"rep":3,"readyMs":170,"threadMs":334,"procs":21,"wsMB":597,"privateMB":372},{"rep":4,"readyMs":142,"threadMs":298,"procs":21,"wsMB":592,"privateMB":366}]}
{"candidate":"codex app-server","config":"full","scenario":"five","model":"gpt-6-luna","platform":"win32","results":[{"rep":0,"allReadyMs":511,"wsMB":2920,"privateMB":1873}],"note":"first attempt hung for 900 s and was killed; this rerun completed"}
{"candidate":"codex app-server","config":"full","scenario":"five","model":"gpt-6-luna","platform":"win32","results":[{"rep":0,"allReadyMs":489,"wsMB":2938,"privateMB":1883}]}
{"candidate":"codex app-server","config":"full","scenario":"fiveThreads","model":"gpt-6-luna","platform":"win32","results":[{"rep":0,"allReadyMs":333,"procs":72,"wsMB":2264,"privateMB":1546},{"rep":1,"allReadyMs":295,"procs":72,"wsMB":2266,"privateMB":1549}]}
{"candidate":"codex app-server","config":"full","scenario":"turn","model":"gpt-6-luna","platform":"win32","results":[{"rep":0,"ack":"ok","status":"completed","turn/started":27,"firstDelta":3291,"turn/completed":3777},{"rep":1,"ack":"ok","status":"completed","turn/started":27,"firstDelta":3206,"turn/completed":3631},{"rep":2,"ack":"ok","status":"completed","turn/started":26,"firstDelta":3174,"turn/completed":3645}]}
{"config":"full","scenario":"turn","model":"anthropic/claude-opus-5-5","node":"v26.13.1","results":[{"rep":0,"disposition":"started","agent_start":11,"message_end":14,"firstUpdate":2302,"agent_end":2324,"agent_settled":2328,"settleAfterEndMs":4},{"rep":1,"disposition":"started","agent_start":10,"message_end":14,"firstUpdate":1052,"agent_end":1074,"agent_settled":1076,"settleAfterEndMs":2}]}
```

WSL (`results-wsl.jsonl`):

```jsonl
{"config":"bare","scenario":"start","model":"openai-codex/gpt-6-luna","node":"v24.22.0","platform":"linux","results":[{"rep":0,"readyMs":1936,"procs":1,"wsMB":122,"privateMB":70},{"rep":1,"readyMs":1821,"procs":1,"wsMB":112,"privateMB":59},{"rep":2,"readyMs":1684,"procs":1,"wsMB":113,"privateMB":60},{"rep":3,"readyMs":1834,"procs":1,"wsMB":113,"privateMB":60},{"rep":4,"readyMs":1774,"procs":1,"wsMB":113,"privateMB":60}]}
{"config":"bare","scenario":"five","model":"openai-codex/gpt-6-luna","node":"v24.22.0","platform":"linux","results":[{"rep":0,"allReadyMs":1348,"wsMB":581,"privateMB":316},{"rep":1,"allReadyMs":1272,"wsMB":581,"privateMB":316}]}
{"config":"bare","scenario":"turn","model":"openai-codex/gpt-6-luna","node":"v24.22.0","platform":"linux","results":[{"rep":0,"disposition":"started","agent_start":2,"message_end":2,"firstUpdate":1574,"agent_end":1631,"agent_settled":1632,"settleAfterEndMs":1},{"rep":1,"disposition":"started","agent_start":2,"message_end":2,"firstUpdate":1060,"agent_end":1135,"agent_settled":1136,"settleAfterEndMs":1}]}
{"config":"bare","scenario":"turn","model":"anthropic/claude-opus-5-5","node":"v24.22.0","platform":"linux","results":[{"rep":0,"disposition":"started","agent_start":2,"message_end":2,"firstUpdate":2164,"agent_end":2175,"agent_settled":2175,"settleAfterEndMs":0},{"rep":1,"disposition":"started","agent_start":2,"message_end":2,"firstUpdate":1193,"agent_end":1197,"agent_settled":1197,"settleAfterEndMs":0}]}
{"candidate":"codex app-server","config":"bare","scenario":"start","model":"gpt-6-luna","platform":"linux","results":[{"rep":0,"readyMs":398,"threadMs":413,"procs":4,"wsMB":153,"privateMB":143},{"rep":1,"readyMs":104,"threadMs":114,"procs":4,"wsMB":153,"privateMB":144},{"rep":2,"readyMs":101,"threadMs":111,"procs":4,"wsMB":153,"privateMB":144},{"rep":3,"readyMs":103,"threadMs":113,"procs":4,"wsMB":153,"privateMB":144},{"rep":4,"readyMs":100,"threadMs":110,"procs":4,"wsMB":154,"privateMB":144}]}
{"candidate":"codex app-server","config":"bare","scenario":"five","model":"gpt-6-luna","platform":"linux","results":[{"rep":0,"allReadyMs":131,"wsMB":706,"privateMB":130},{"rep":1,"allReadyMs":125,"wsMB":706,"privateMB":127}]}
{"candidate":"codex app-server","config":"bare","scenario":"fiveThreads","model":"gpt-6-luna","platform":"linux","results":[{"rep":0,"allReadyMs":150,"procs":4,"wsMB":171,"privateMB":161},{"rep":1,"allReadyMs":118,"procs":4,"wsMB":171,"privateMB":159}]}
{"note":"wsl-run2: codex native binary (no npm shim)","candidate":"codex app-server","config":"bare","scenario":"start","platform":"linux","results":[{"rep":0,"readyMs":236,"threadMs":255,"procs":4,"wsMB":153,"privateMB":144},{"rep":1,"readyMs":87,"threadMs":99,"procs":4,"wsMB":153,"privateMB":144},{"rep":2,"readyMs":87,"threadMs":100,"procs":4,"wsMB":153,"privateMB":143},{"rep":3,"readyMs":80,"threadMs":89,"procs":4,"wsMB":153,"privateMB":144},{"rep":4,"readyMs":85,"threadMs":96,"procs":4,"wsMB":154,"privateMB":144}]}
{"note":"wsl-run2","candidate":"codex app-server","config":"bare","scenario":"five","platform":"linux","results":[{"rep":0,"allReadyMs":105,"wsMB":708,"privateMB":130},{"rep":1,"allReadyMs":100,"wsMB":707,"privateMB":130}]}
{"note":"wsl-run2","candidate":"codex app-server","config":"bare","scenario":"fiveThreads","platform":"linux","results":[{"rep":0,"allReadyMs":108,"procs":4,"wsMB":172,"privateMB":163},{"rep":1,"allReadyMs":124,"procs":4,"wsMB":174,"privateMB":165}]}
{"note":"wsl-run3: Pi with a WSL-local agent dir","config":"bare","scenario":"start","platform":"linux","results":[{"rep":0,"readyMs":245,"procs":1,"wsMB":121,"privateMB":68},{"rep":1,"readyMs":149,"procs":1,"wsMB":112,"privateMB":59},{"rep":2,"readyMs":152,"procs":1,"wsMB":113,"privateMB":60},{"rep":3,"readyMs":148,"procs":1,"wsMB":112,"privateMB":59},{"rep":4,"readyMs":153,"procs":1,"wsMB":112,"privateMB":60}]}
{"note":"wsl-run3","config":"bare","scenario":"five","platform":"linux","results":[{"rep":0,"allReadyMs":191,"wsMB":560,"privateMB":294},{"rep":1,"allReadyMs":191,"wsMB":559,"privateMB":292}]}
{"note":"codex turn in WSL with CODEX_HOME=/mnt/c/Users/Flex/.codex: initialize never answered; killed by timeout 400; not retried (a separate WSL login would start a new token lineage)"}
```

Scripts in `%TEMP%\own-agent-stack`: `bench.mjs` (T-02, now also Linux: `PI_CLI` points at a native `cli.js`), `codex-bench.mjs` below, and `wsl-run.sh`, `wsl-run2.sh`, `wsl-run3.sh` (WSL drivers).

```js
// T-07: the T-02 scenarios against `codex app-server` (JSON-RPC over stdio), spawned as the native binary like a hub would.
// usage: node codex-bench.mjs <start|five|fiveThreads|turn> <reps> [model] [codexBinary]
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const win = process.platform === "win32";
const [scenario = "start", reps = "3", model = "gpt-6-luna",
	bin = win ? join(process.env.APPDATA, "npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe") : "codex"] = process.argv.slice(2);
const cwd = mkdtempSync(join(tmpdir(), "codex-bench-"));

function start() {
	const t0 = performance.now();
	const child = spawn(bin, ["app-server"], { cwd, stdio: "pipe", windowsHide: true });
	let buf = "", next = 1;
	const waiters = new Map(), listeners = [];
	child.stdout.on("data", d => {
		buf += d; let i;
		while ((i = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1);
			let rec; try { rec = JSON.parse(line); } catch { continue; }
			if (rec.id !== undefined && !rec.method && waiters.has(rec.id)) { waiters.get(rec.id)(rec); waiters.delete(rec.id); }
			else listeners.forEach(l => l(rec, performance.now()));
		}
	});
	child.stderr.on("data", () => {});
	const send = (method, params) => new Promise(res => { const id = next++; waiters.set(id, res); child.stdin.write(JSON.stringify({ id, method, params }) + "\n"); });
	const notify = (method, params) => child.stdin.write(JSON.stringify({ method, params }) + "\n");
	return { child, t0, send, notify, listeners };
}
async function ready(p) {
	const r = await p.send("initialize", { clientInfo: { name: "bench", version: "0" } });
	if (r.error) throw new Error(JSON.stringify(r.error));
	p.notify("initialized", {});
}
const thread = async p => { const r = await p.send("thread/start", { cwd, model, ephemeral: true }); if (r.error) throw new Error(JSON.stringify(r.error)); return r.result.thread.id; };

function memory(pid) {
	if (!win) {
		// Linux: RSS and private (Rss - Shared) of the tree from /proc.
		const sh = `ids="${pid}"; for c in $(pgrep -P ${pid}); do ids="$ids $c $(pgrep -P $c)"; done; n=0; r=0; p=0; for i in $ids; do n=$((n+1)); s=/proc/$i/smaps_rollup; r=$((r+$(awk '/^Rss/{print $2}' $s))); p=$((p+$(awk '/^Private_(Clean|Dirty)/{t+=$2}END{print t}' $s))); done; echo $n $((r/1024)) $((p/1024))`;
		const [procs, wsMB, privateMB] = execFileSync("bash", ["-c", sh], { encoding: "utf8" }).trim().split(" ").map(Number);
		return { procs, wsMB, privateMB };
	}
	const ps = `$all=Get-CimInstance Win32_Process|Select ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount;$ids=@(${pid});$i=0;while($i -lt $ids.Count){$ids+=@($all|?{$_.ParentProcessId -eq $ids[$i]}|%{$_.ProcessId});$i++};$t=$all|?{$ids -contains $_.ProcessId};"{0} {1} {2}" -f $ids.Count,(($t|Measure WorkingSetSize -Sum).Sum/1MB),(($t|Measure PrivatePageCount -Sum).Sum/1MB)`;
	const [procs, ws, priv] = execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).trim().split(" ").map(Number);
	return { procs, wsMB: Math.round(ws), privateMB: Math.round(priv) };
}
const stop = p => new Promise(res => { p.child.on("exit", res); p.child.stdin.end(); setTimeout(() => p.child.kill(), 15000); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const out = [];
for (let r = 0; r < Number(reps); r++) {
	if (scenario === "start") {
		const p = start();
		await ready(p);
		const readyMs = Math.round(performance.now() - p.t0);
		await thread(p);
		const threadMs = Math.round(performance.now() - p.t0);
		await sleep(3000);
		out.push({ rep: r, readyMs, threadMs, ...memory(p.child.pid) });
		await stop(p);
	} else if (scenario === "five") {
		const ps = Array.from({ length: 5 }, start);
		const stage = ps.map(() => "spawned");
		const all = Promise.all(ps.map(async (p, i) => { await ready(p); stage[i] = "initialized"; await thread(p); stage[i] = "thread"; }));
		if (await Promise.race([all.then(() => false), sleep(60000).then(() => true)])) { out.push({ rep: r, timeout: stage }); ps.forEach(p => p.child.kill()); break; }
		const allReadyMs = Math.round(performance.now() - Math.min(...ps.map(p => p.t0)));
		await sleep(3000);
		const mem = ps.map(p => memory(p.child.pid));
		out.push({ rep: r, allReadyMs, wsMB: mem.reduce((a, m) => a + m.wsMB, 0), privateMB: mem.reduce((a, m) => a + m.privateMB, 0) });
		await Promise.all(ps.map(stop));
	} else if (scenario === "fiveThreads") {
		// What a hub built on app-server would do: one process, five threads.
		const p = start();
		await ready(p);
		await Promise.all(Array.from({ length: 5 }, () => thread(p)));
		const allReadyMs = Math.round(performance.now() - p.t0);
		await sleep(3000);
		out.push({ rep: r, allReadyMs, ...memory(p.child.pid) });
		await stop(p);
	} else if (scenario === "turn") {
		const p = start();
		await ready(p);
		const threadId = await thread(p);
		const marks = {};
		let fail;
		const done = new Promise(res => p.listeners.push((rec, t) => {
			const k = rec.method === "item/agentMessage/delta" ? "firstDelta" : rec.method;
			if (["turn/started", "firstDelta", "turn/completed"].includes(k) && marks[k] === undefined) marks[k] = t;
			if (rec.method === "error") fail = rec.params;
			if (rec.method === "turn/completed") res(rec.params);
		}));
		const t = performance.now();
		const resp = await p.send("turn/start", { threadId, input: [{ type: "text", text: "Reply with exactly the word OK and nothing else. Do not use tools." }] });
		const completed = await Promise.race([done, sleep(120000).then(() => ({ timeout: true }))]);
		const rel = Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, Math.round(v - t)]));
		out.push({ rep: r, ack: resp.error ?? "ok", status: completed.turn?.status ?? completed, error: fail, ...rel });
		await stop(p);
	}
}
console.log(JSON.stringify({ candidate: "codex app-server", config: process.env.CODEX_HOME ? "bare" : "full", scenario, model, platform: process.platform, results: out }));
```
