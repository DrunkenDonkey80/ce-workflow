// D4/D10/D13: the hub installs, stages and removes the desktop app from the hashes pinned in hub/app/release.json.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { iconSvg, ICONS } from "../web/icons.ts";

export type Release = { version: string; assets: Record<string, { url: string; sha256: string }> };
export type AppStatus = { supported: boolean; note?: string; installed: boolean; version: string | null; staged: string | null; latest: string | null; running: boolean; login: boolean };

const RELEASES = "https://github.com/DrunkenDonkey80/ce-workflow/releases/download/";
const RUN_VALUE = "PiHubApp";
/** The pin, or null before the first app release is pinned (R-04) or when the file is unreadable. */
function pinned(): Release | null {
	try { return JSON.parse(readFileSync(new URL("../app/release.json", import.meta.url), "utf8")); } catch { return null; }
}

export function createAppInstall({
	platform = process.platform, wsl = false, arch = process.arch, home = os.homedir(),
	localAppData = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming"),
	dataDir, release = pinned,
	releaseBase = RELEASES, runKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", download = fetch,
}: { platform?: string; wsl?: boolean; arch?: string; home?: string; localAppData?: string; appData?: string; dataDir: string; release?: () => Release | null; releaseBase?: string; runKey?: string; download?: typeof fetch }) {
	const windows = platform === "win32";
	const asset = windows ? "windows-x64" : "linux-x64";
	const unsupported = wsl ? "Install the app from the Windows hub." : !(windows || platform === "linux") || arch !== "x64" ? "The desktop app is for 64-bit Windows and Linux." : undefined;
	const dir = windows ? path.join(localAppData, "Programs", "pi-hub-app") : path.join(home, ".local", "share", "pi-hub-app");
	const ext = windows ? ".exe" : ".AppImage";
	const file = path.join(dir, "pi-hub-app" + ext), next = path.join(dir, "pi-hub-app.next" + ext);
	const record = path.join(dir, "installed.json"), lock = path.join(dir, "app.lock");
	const shortcut = windows ? path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Pi Hub.lnk") : path.join(home, ".local", "share", "applications", "pi-hub-app.desktop");
	const autostartFile = path.join(home, ".config", "autostart", "pi-hub-app.desktop");
	const loginCommand = `"${file}" --hidden --hub-data "${dataDir}"`;
	const reg = (...args: string[]) => execFileSync("reg", args, { encoding: "utf8", stdio: "pipe", windowsHide: true });

	const read = (): { version: string; staged?: string } | null => { try { return JSON.parse(readFileSync(record, "utf8")); } catch { return null; } };
	const write = (value: { version: string; staged?: string }) => writeFileSync(record, JSON.stringify(value));
	/** The app swaps .next in at start (P-05); a staged version whose file is gone is the one running now. */
	function current() {
		const value = read();
		if (value?.staged && !existsSync(next)) { write({ version: value.staged }); return { version: value.staged }; }
		return value;
	}
	// The running app keeps its pid in app.lock (P-05); a dead pid is a stale lock.
	function running() {
		try { const pid = Number(readFileSync(lock, "utf8").trim()); if (!pid) return false; process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
	}
	function login() {
		if (windows) { try { return reg("query", runKey, "/v", RUN_VALUE).includes("REG_SZ"); } catch { return false; } }
		return existsSync(autostartFile);
	}
	function setLogin(on: boolean) {
		guard();
		if (!read()) throw new Error("The desktop app is not installed.");
		if (windows) {
			if (on) reg("add", runKey, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", loginCommand, "/f");
			else if (login()) reg("delete", runKey, "/v", RUN_VALUE, "/f");
		} else if (on) { mkdirSync(path.dirname(autostartFile), { recursive: true }); writeFileSync(autostartFile, desktopEntry(`${loginCommand}`, true)); }
		else rmSync(autostartFile, { force: true });
		return status();
	}
	const desktopEntry = (exec: string, autostart = false) => `[Desktop Entry]\nType=Application\nName=Pi Hub\nExec=${exec}\nIcon=${path.join(dir, "icon.svg")}\nCategories=Development;\n${autostart ? "X-GNOME-Autostart-enabled=true\n" : ""}`;

	function guard() { if (unsupported) throw new Error(unsupported); }
	/** Downloads the pinned asset, refusing other URLs and any hash mismatch; writes a temp file, then renames it into place. */
	async function fetchTo(target: string) {
		const pin = release(), item = pin?.assets[asset];
		if (!pin) throw new Error("No desktop app release is pinned yet.");
		if (!item) throw new Error(`No ${asset} build in release ${pin.version}.`);
		if (!item.url.startsWith(releaseBase)) throw new Error("Refused: the pinned URL is not a release of this repo.");
		const response = await download(item.url);
		if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}.`);
		const bytes = Buffer.from(await response.arrayBuffer()), hash = createHash("sha256").update(bytes).digest("hex");
		if (hash !== item.sha256.toLowerCase()) throw new Error("Refused: the downloaded file does not match the pinned SHA-256.");
		mkdirSync(dir, { recursive: true });
		const temp = `${target}.${process.pid}.tmp`;
		writeFileSync(temp, bytes, { mode: 0o755 });
		try { renameSync(temp, target); } catch (error) { rmSync(temp, { force: true }); throw error; }
		return pin.version;
	}

	function status(): AppStatus {
		const value = unsupported ? null : current();
		return { supported: !unsupported, ...(unsupported ? { note: unsupported } : {}), installed: !!value, version: value?.version ?? null, staged: value?.staged ?? null, latest: release()?.version ?? null, running: !unsupported && running(), login: !unsupported && !!value && login() };
	}
	async function install() {
		guard();
		if (running()) throw new Error("Quit Pi Hub from the tray first.");
		const version = await fetchTo(file);
		rmSync(next, { force: true });
		write({ version });
		// The app reads the hub data folder from here: a desktop or login launch may lack PI_CODING_AGENT_DIR.
		let config: Record<string, unknown> = {}; try { config = JSON.parse(readFileSync(path.join(dir, "app.json"), "utf8")); } catch { /* first install */ }
		writeFileSync(path.join(dir, "app.json"), JSON.stringify({ ...config, hubData: dataDir }, null, "\t"));
		if (windows) {
			mkdirSync(path.dirname(shortcut), { recursive: true });
			const quote = (text: string) => "'" + text.replaceAll("'", "''") + "'";
			execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
				`$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${quote(shortcut)}); $s.TargetPath = ${quote(file)}; $s.WorkingDirectory = ${quote(dir)}; $s.Save()`], { stdio: "pipe", windowsHide: true });
		} else {
			writeFileSync(path.join(dir, "icon.svg"), iconSvg(Object.keys(ICONS)[0]));
			mkdirSync(path.dirname(shortcut), { recursive: true }); writeFileSync(shortcut, desktopEntry(`"${file}"`));
		}
		return setLogin(true); // D10: on by default
	}
	/** D4: stage a newer pinned build as .next; the running file stays untouched until the app restarts. */
	async function stage() {
		guard();
		const value = current();
		if (!value) throw new Error("The desktop app is not installed.");
		const latest = release()?.version;
		if (!latest || latest === value.version || latest === value.staged) return status();
		write({ version: value.version, staged: await fetchTo(next) });
		return status();
	}
	function uninstall() {
		guard();
		if (running()) throw new Error("Quit Pi Hub from the tray first.");
		if (read()) setLogin(false);
		rmSync(dir, { recursive: true, force: true }); rmSync(shortcut, { force: true });
		return status();
	}
	return { status, install, stage, uninstall, setLogin, paths: { dir, file, next, lock, shortcut, autostartFile } };
}
