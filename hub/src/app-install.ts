// D4/D10/D13: the hub installs, stages and removes the desktop app. One version: CI builds the app for every pushed ce-workflow
// version as release app-v<version> (.github/workflows/app-release.yml), and the hub takes the build matching its own version,
// checked against the SHA-256 digest GitHub reports for the file (issue #6; replaces the hashes pinned in the repo).
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { iconSvg, ICONS } from "../web/icons.ts";

export type Release = { version: string; assets: Record<string, { url: string; sha256: string }> };
export type AppStatus = { supported: boolean; note?: string; installed: boolean; version: string | null; staged: string | null; latest: string | null; running: boolean; login: boolean };

const REPO = "DrunkenDonkey80/ce-workflow";
const RELEASES = `https://github.com/${REPO}/releases/download/`;
const RUN_VALUE = "PiHubApp";
const ASSETS: Record<string, string> = { "pi-hub-app-windows-x64.exe": "windows-x64", "pi-hub-app-linux-x64.AppImage": "linux-x64" };
export const PACKAGE_VERSION: string = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

/** The app build for one ce-workflow version, or null while CI has not published it yet (or never will: an unpushed version). */
export async function lookupRelease(version = PACKAGE_VERSION, get: typeof fetch = fetch): Promise<Release | null> {
	const response = await get(`https://api.github.com/repos/${REPO}/releases/tags/app-v${version}`, { headers: { accept: "application/vnd.github+json" } });
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Release check failed: HTTP ${response.status}.`);
	const body = await response.json() as { assets?: { name: string; browser_download_url: string; digest?: string | null }[] };
	const assets = (body.assets ?? []).filter(item => ASSETS[item.name] && item.digest?.startsWith("sha256:"))
		.map(item => [ASSETS[item.name], { url: item.browser_download_url, sha256: item.digest!.slice(7) }] as const);
	return { version, assets: Object.fromEntries(assets) };
}

export function createAppInstall({
	platform = process.platform, wsl = false, arch = process.arch, home = os.homedir(),
	localAppData = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming"),
	dataDir, release, refresh,
	releaseBase = RELEASES, runKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", download = fetch,
}: { platform?: string; wsl?: boolean; arch?: string; home?: string; localAppData?: string; appData?: string; dataDir: string; release?: () => Release | null; refresh?: () => Promise<void>; releaseBase?: string; runKey?: string; download?: typeof fetch }) {
	// Default: the last GitHub answer, refreshed before every install and stage.
	let known: Release | null = null;
	release ??= () => known;
	refresh ??= async () => { known = await lookupRelease(); };
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
	/** Downloads the release asset, refusing other URLs and any hash mismatch; writes a temp file, then renames it into place. */
	async function fetchTo(target: string) {
		const pin = release!(), item = pin?.assets[asset];
		if (!pin) throw new Error(`No desktop app build for version ${PACKAGE_VERSION} yet; it is published a few minutes after that version is pushed.`);
		if (!item) throw new Error(`No ${asset} build in release ${pin.version}.`);
		if (!item.url.startsWith(releaseBase)) throw new Error("Refused: the URL is not a release of this repo.");
		const response = await download(item.url);
		if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}.`);
		const bytes = Buffer.from(await response.arrayBuffer()), hash = createHash("sha256").update(bytes).digest("hex");
		if (hash !== item.sha256.toLowerCase()) throw new Error("Refused: the downloaded file does not match the release's SHA-256.");
		mkdirSync(dir, { recursive: true });
		const temp = `${target}.${process.pid}.tmp`;
		writeFileSync(temp, bytes, { mode: 0o755 });
		try { renameSync(temp, target); } catch (error) { rmSync(temp, { force: true }); throw error; }
		return pin.version;
	}

	function status(): AppStatus {
		const value = unsupported ? null : current();
		return { supported: !unsupported, ...(unsupported ? { note: unsupported } : {}), installed: !!value, version: value?.version ?? null, staged: value?.staged ?? null, latest: release!()?.version ?? null, running: !unsupported && running(), login: !unsupported && !!value && login() };
	}
	async function install() {
		guard();
		if (running()) throw new Error("Quit Pi Hub from the tray first.");
		await refresh!();
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
	/** D4: stage the build for this version as .next; the running file stays untouched until the app restarts. */
	async function stage() {
		guard();
		const value = current();
		if (!value) throw new Error("The desktop app is not installed.");
		await refresh!();
		const latest = release!()?.version;
		if (!latest || latest === value.version || latest === value.staged) return status();
		write({ version: value.version, staged: await fetchTo(next) });
		return status();
	}
	/** The periodic check (H-05): stage when installed and supported (not on WSL, D13); otherwise nothing. */
	const autoStage = async () => unsupported || !current() ? status() : stage();
	function start() {
		guard();
		if (!current()) throw new Error("The desktop app is not installed.");
		if (!running()) spawn(file, ["--hub-data", dataDir], { cwd: dir, detached: true, stdio: "ignore" }).on("error", () => {}).unref();
		return status();
	}
	/** Stop = quit: the app holds no unsaved state (tabs are saved on change), so ending its pid is safe. */
	function stop() {
		guard();
		if (running()) { try { process.kill(Number(readFileSync(lock, "utf8").trim())); } catch { /* already gone */ } rmSync(lock, { force: true }); }
		return status();
	}
	/** Same as the tray's "Restart to update": the new process swaps the staged build in at start (it waits for the old one to exit). */
	const restart = () => { stop(); return start(); };
	function uninstall() {
		guard();
		if (running()) throw new Error("Quit Pi Hub from the tray first.");
		if (read()) setLogin(false);
		rmSync(dir, { recursive: true, force: true }); rmSync(shortcut, { force: true });
		return status();
	}
	return { status, install, stage, autoStage, start, stop, restart, uninstall, setLogin, paths: { dir, file, next, record, lock, shortcut, autostartFile } };
}
