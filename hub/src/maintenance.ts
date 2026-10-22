// A detached child still belongs to its parent's systemd cgroup; maintenance must run in a separate unit.
import { readFileSync } from "node:fs";
import { agentDir } from "./rpc-client.ts";

export const HUB_SERVICE = "pi-control-hub.service";
export function systemdHub(pid: number, cgroup?: string): boolean {
	if (process.platform !== "linux" && cgroup === undefined) return false;
	try { return /\/pi-control-hub\.service(?:\/|\n|$)/.test(cgroup ?? readFileSync(`/proc/${pid}/cgroup`, "utf8")); } catch { return false; }
}

export function maintenanceCommand(action: "restart" | "update", cli: string, log: string, managed = systemdHub(process.pid)): [string, string[]] {
	const args = [cli, ...(action === "update" ? ["update", "--yes"] : ["restart"])];
	if (!managed) return [process.execPath, args];
	const env = { PATH: process.env.PATH, PI_CODING_AGENT_DIR: agentDir(), PI_HUB_PI_COMMAND: process.env.PI_HUB_PI_COMMAND };
	return ["systemd-run", ["--user", "--collect", "--quiet", "--property=Type=exec",
		`--property=StandardOutput=append:${log}`, `--property=StandardError=append:${log}`,
		...Object.entries(env).flatMap(([key, value]) => value === undefined ? [] : [`--setenv=${key}=${value}`]),
		"--", process.execPath, ...args]];
}
