// pi-hub update: Pi processes the hub does not own keep the old version and can lock extension files during the update.
import { execFileSync } from "node:child_process";

export type Proc = { pid: number; ppid: number; args: string };

export function listProcesses(): Proc[] {
	if (process.platform === "win32") {
		const json = execFileSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"], { encoding: "utf8", windowsHide: true, maxBuffer: 16 << 20 });
		const rows = json.trim() ? [JSON.parse(json)].flat() : [];
		return rows.map(r => ({ pid: r.ProcessId, ppid: r.ParentProcessId, args: r.CommandLine ?? "" }));
	}
	return execFileSync("ps", ["-eo", "pid=,ppid=,args="], { encoding: "utf8" }).split("\n").flatMap(line => {
		const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
		return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] }] : [];
	});
}

/** Top-level Pi launchers (a subagent's Pi has a Pi ancestor), except the hub's own RPC children. */
export function outsidePis(procs: Proc[], hubPid?: number): Proc[] {
	const byPid = new Map(procs.map(p => [p.pid, p])), isPi = (p: Proc) => /pi-launcher\.js/.test(p.args);
	const hasPiAncestor = (p: Proc) => {
		for (let up = byPid.get(p.ppid), seen = 0; up && seen < 64; up = byPid.get(up.ppid), seen++) if (isPi(up)) return true;
		return false;
	};
	return procs.filter(p => isPi(p) && !hasPiAncestor(p) && !(p.ppid === hubPid && /--mode rpc/.test(p.args)));
}
