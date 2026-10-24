// WSL needs its own browser opener, command lookup and login start; Windows, macOS and plain Linux keep theirs.
import { existsSync, readFileSync } from "node:fs";
import { execFile, execFileSync, spawn } from "node:child_process";

export function isWsl(env: NodeJS.ProcessEnv = process.env, procVersion?: string) {
	if (process.platform !== "linux" && procVersion === undefined) return false;
	if (env.WSL_DISTRO_NAME) return true;
	try { return /microsoft/i.test(procVersion ?? readFileSync("/proc/version", "utf8")); } catch { return false; }
}

/** The command that opens a URL. WSL: wslview, else rundll32 hands the URL to the Windows default browser
 * as one argument, so `&` and `?` need no escaping (cmd.exe start would parse `&` as a command separator). */
export function browserOpener(url: string, platform = process.platform, wsl = isWsl(), hasWslview = false): [string, string[]] {
	if (platform === "win32") return ["cmd", ["/c", "start", "", url]];
	if (platform === "darwin") return ["open", [url]];
	if (wsl) return hasWslview ? ["wslview", [url]] : ["rundll32.exe", ["url.dll,FileProtocolHandler", url]];
	return ["xdg-open", [url]];
}

/** Opens a URL in the default browser (detached). A missing or failing opener is ignored: callers print the URL. */
export function openInBrowser(url: string) {
	const [command, args] = browserOpener(url, process.platform, isWsl(), process.platform === "linux" && !!findCommand("wslview"));
	try { spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref(); } catch { /* printed instead */ }
}

/** PATH hits for a command; on WSL the Windows PATH it appends (/mnt/...) doesn't count, since its shims run Windows programs. */
export const linuxHits = (hits: string[], wsl = isWsl()) => wsl ? hits.filter(hit => !hit.startsWith("/mnt/")) : hits;
export function findCommand(command: string): string | undefined {
	try {
		const out = execFileSync(process.platform === "win32" ? "where" : "which", process.platform === "win32" ? [command] : ["-a", command], { encoding: "utf8", stdio: "pipe", windowsHide: true });
		return linuxHits(out.split(/\r?\n/).map(line => line.trim()).filter(Boolean))[0];
	} catch { return undefined; }
}

/** WSL with systemd as PID 1 can start the hub through a user unit; without it there is no login start. */
export const wslSystemd = () => existsSync("/run/systemd/system");

/**
 * True while a Windows UAC prompt is open on this PC: Windows runs consent.exe only then. Checked at most every 3 s and
 * only when asked (pages poll), so an idle hub spawns nothing; the first call after a gap returns the last known value.
 */
let uac = false, uacAt = 0;
export function uacPending(now = Date.now()) {
	if (process.platform !== "win32" || now - uacAt < 3000) return uac;
	uacAt = now;
	execFile("tasklist", ["/FI", "IMAGENAME eq consent.exe", "/NH", "/FO", "CSV"], { windowsHide: true, timeout: 5000 }, (error, stdout) => { if (!error) uac = /consent\.exe/i.test(stdout); });
	return uac;
}
