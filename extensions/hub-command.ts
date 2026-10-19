// /wo hub: install, start and control pi-control-hub (../hub) from inside Pi. Every action runs the hub's own CLI with
// Pi's Node, so the terminal command `pi-hub` and this menu share one implementation.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { showListDialog } from "./ask-user/menu.ts";

const CLI = fileURLToPath(new URL("../hub/src/cli.ts", import.meta.url));

/** Runs `pi-hub <args>`; resolves with its output, errors included (the CLI prints them and exits non-zero). */
export function hubCli(args: string[], timeout = 180_000): Promise<{ ok: boolean; text: string }> {
	// The hub runs its .ts files with Node's type stripping: Node 24+, and never from inside node_modules.
	if (Number(process.versions.node.split(".")[0]) < 24) return Promise.resolve({ ok: false, text: `The hub needs Node 24 or newer; Pi runs on ${process.version}.` });
	if (/[\\/]node_modules[\\/]/.test(CLI)) return Promise.resolve({ ok: false, text: "The hub cannot run from node_modules; install ce-workflow from git (pi install git:…)." });
	return new Promise(resolve => execFile(process.execPath, ["--no-warnings", CLI, ...args], { timeout, windowsHide: true }, (error, stdout, stderr) =>
		resolve({ ok: !error, text: [stdout, stderr].map(s => String(s).trim()).filter(Boolean).join("\n") || (error ? error.message : "Done.") })));
}

export type HubStatus = { pairing?: { code: string; label?: string; login?: string } | null; running: boolean; autostart: boolean; command: boolean; local?: string; remote: { on: boolean; url?: string; error?: string; missing?: string[] }; sessions?: number; live?: number; busy?: number };

export async function handleHubCommand(args: string, ctx) {
	const notify = (text: string, ok = true) => ctx.ui?.notify?.(text, ok ? "info" : "warning");
	// Typed form: /wo hub install | start | stop | restart | open [remote] | remote on|off | autostart on|off | new … | update
	if (args.trim()) { const result = await hubCli(args.trim().split(/\s+/)); return notify(result.text, result.ok); }
	const read = await hubCli(["status", "--json"], 30_000);
	let status: HubStatus;
	try { status = JSON.parse(read.text); } catch { return notify(read.text, false); }
	const { summary, items } = hubMenu(status, ctx.cwd);
	const selected = await showListDialog(ctx, { title: "Pi control hub", purpose: summary, items, filter: false, cursorKey: "hub-menu" });
	if (!selected) return;
	const result = await hubCli(selected.value === "new" ? ["new", ctx.cwd] : selected.value.split(" "));
	notify(result.text, result.ok);
}

/** The menu for a hub status: Install or Start while stopped, page/session/remote controls while running. */
export function hubMenu(status: HubStatus, cwd: string) {
	const installed = status.autostart || status.command;
	const remote = !status.remote.on ? "Remote off" : status.remote.url ? `Remote: ${status.remote.url}` : `Remote on, not served: ${status.remote.error ?? status.remote.missing?.join(" ") ?? "unknown"}`;
	const item = (value: string, label: string, description: string) => ({ value, label, description });
	const items = !status.running ? [
		installed ? item("start", "Start", "Start the hub now; it brings back the sessions that were running.")
			: item("install", "Install (Recommended)", "Adds the pi-hub terminal command, starts the hub at login and starts it now. Then shows its address."),
		...(installed ? [item("install", "Reinstall", "Re-adds the pi-hub command and login start, then starts the hub.")] : []),
	] : [
		// A phone waiting on the pairing page: approve it here, no browser needed.
		...(status.pairing ? [item("pair approve", `Approve device ${status.pairing.code}`, `${status.pairing.label ?? "A device"}${status.pairing.login ? ` (${status.pairing.login})` : ""} shows this code; approve only if it matches.`),
			item("pair reject", "Reject that device", "It stays unpaired.")] : []),
		item("open", "Open local page", `${status.local} in this PC's browser.`),
		...(status.remote.url ? [item("open remote", "Open remote page", `${status.remote.url}, the address your phone uses.`)] : []),
		item("new", "New session in this folder", `Starts a hub session in ${cwd}; it shows on the page.`),
		item("restart", "Restart", "Stops every hub session and starts them again; refused while one is busy."),
		item("stop", "Stop", "Stops the hub and its sessions; refused while one is busy."),
		item(`remote ${status.remote.on ? "off" : "on"}`, status.remote.on ? "Turn remote access off" : "Turn remote access on", status.remote.on ? "Removes the tailnet address." : "Serves the hub on your tailnet (Tailscale with HTTPS certificates) for the phone; never public."),
	];
	items.push(item(`autostart ${status.autostart ? "off" : "on"}`, status.autostart ? "Don't start at login" : "Start at login", status.autostart ? "Removes the login start." : "Starts the hub hidden when you log in."));
	const summary = status.running
		? `${status.pairing ? `Device waiting, code ${status.pairing.code} · ` : ""}Running · ${status.sessions} sessions (${status.live} live${status.busy ? `, ${status.busy} busy` : ""}) · ${status.local} · ${remote}`
		: installed ? `Stopped · ${remote}` : "Not installed";
	return { summary, items };
}
