// Developer loop: build the desktop app from this checkout and restart the installed app onto it.
// Usage: node hub/app/dev-restart.mjs (a project button runs it; progress and errors go to pi-hub notice when available).
// The build is staged as pi-hub-app.next like a release, so the app's own start-up swap installs it (P-05).
import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createAppInstall, PACKAGE_VERSION } from "../src/app-install.ts";
import { hubDataDir } from "../src/registry.ts";

const tauri = fileURLToPath(new URL("./src-tauri/", import.meta.url));
const tell = text => { console.log(text); try { execSync(`pi-hub notice "${text.replace(/["%!^&|<>`$\\]/g, "")}"`, { stdio: "ignore", windowsHide: true }); } catch { /* no hub session */ } };
try {
	const app = createAppInstall({ dataDir: hubDataDir() });
	if (!app.status().supported) throw new Error(app.status().note);
	if (!app.status().installed) throw new Error("Install the desktop app from the hub page first.");
	tell("Building the desktop app from source (a minute or two)…");
	// Release LTO links on one core for most of the build; a dev build skips it and splits codegen across every core (CI releases keep both).
	const env = { ...process.env, CARGO_PROFILE_RELEASE_LTO: "false", CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "256", CARGO_PROFILE_RELEASE_INCREMENTAL: "true" };
	execFileSync("cargo", ["tauri", "build", "--no-bundle"], { cwd: tauri, stdio: "inherit", windowsHide: true, env });
	const built = fileURLToPath(new URL(`./src-tauri/target/release/pi-hub-app${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
	if (!existsSync(built)) throw new Error(`No build at ${built}`);
	copyFileSync(built, app.paths.next);
	// Staged as this checkout's version: the hub shows it after the swap and does not stage the CI release of that version over it.
	const record = JSON.parse(readFileSync(app.paths.record, "utf8"));
	writeFileSync(app.paths.record, JSON.stringify({ version: record.version, staged: PACKAGE_VERSION }));
	app.restart();
	tell("Desktop app restarted on the local build.");
} catch (error) {
	tell(`Desktop app rebuild failed: ${error.message.split("\n")[0]}`);
	process.exitCode = 1;
}
