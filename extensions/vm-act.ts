// vm_act: drive a VirtualBox VM for installer/UI tests (keys, text, click, guest run, copy, snapshots, USB). Screenshots are screen_read target=vm.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

export const VBOXMANAGE = process.platform === "win32"
	? path.join(process.env.VBOX_MSI_INSTALL_PATH || path.join(process.env.ProgramFiles || "C:\\Program Files", "Oracle", "VirtualBox"), "VBoxManage.exe")
	: "VBoxManage";

export type VmConfig = { vm?: string; user?: string; passwordEnv?: string };
const readJson = (file: string) => { try { return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}; } catch { return {}; } };
/** workOrchestrator.vm from the project .pi/settings.json, else the global one. */
export function vmConfig(cwd: string): VmConfig {
	const global = path.join(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent"), "settings.json");
	const value = readJson(path.join(cwd, ".pi", "settings.json")).workOrchestrator?.vm ?? readJson(global).workOrchestrator?.vm;
	return value && typeof value === "object" ? value : {};
}

export async function vbox(args: string[], timeout = 120_000, signal?: AbortSignal) {
	try {
		const { stdout } = await promisify(execFile)(VBOXMANAGE, args, { timeout, signal, windowsHide: true, maxBuffer: 16 << 20 });
		return stdout;
	} catch (e: any) {
		if (e?.code === "ENOENT") throw new Error(`VBoxManage not found at ${VBOXMANAGE}; install VirtualBox or set VBOX_MSI_INSTALL_PATH.`);
		throw new Error(`VBoxManage ${args.join(" ")} ${e?.killed ? `timed out after ${timeout / 1000} s (guest work may still be running)` : "failed"}: ${String(e?.stderr || e?.message).trim().slice(-1500)}`);
	}
}

/** Names from `list runningvms` / `list vms` lines: "name" {uuid}. */
export const vmNames = (out: string) => [...out.matchAll(/^"(.*)" \{[0-9a-f-]+\}$/gim)].map(m => m[1]);
export const runningVms = async (signal?: AbortSignal) => vmNames(await vbox(["list", "runningvms"], 30_000, signal));

/** The VM to act on: the call's vm, else the configured one, else the only running VM. */
export async function resolveVm(cwd: string, vm?: string, running = runningVms) {
	if (vm) return vm;
	const configured = vmConfig(cwd).vm;
	if (configured) return configured;
	const names = await running();
	if (names.length === 1) return names[0];
	throw new Error(names.length ? `Several VMs are running; pass vm (one of: ${names.join(", ")}) or set workOrchestrator.vm in .pi/settings.json.` : "No VM is running; start one or pass vm.");
}
