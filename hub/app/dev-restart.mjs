// Developer loop: build the desktop app from this checkout and restart the installed app onto it.
// Usage: node hub/app/dev-restart.mjs (a project button runs it; progress and errors go to pi-hub notice when available).
// The build is staged as pi-hub-app.next like a release, so the app's own start-up swap installs it (P-05).
import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createAppInstall } from "../src/app-install.ts";
import { hubDataDir } from "../src/registry.ts";

const tauri = fileURLToPath(new URL("./src-tauri/", import.meta.url));
const tell = text => { console.log(text); try { execSync(`pi-hub notice "${text.replace(/["%!^&|<>`$\\]/g, "")}"`, { stdio: "ignore", windowsHide: true }); } catch { /* no hub session */ } };
try {
	const app = createAppInstall({ dataDir: hubDataDir() });
	if (!app.status().supported) throw new Error(app.status().note);
	if (!app.status().installed) throw new Error("Install the desktop app from the hub page first.");
	tell("Building the desktop app from source (a minute or two)…");
	execFileSync("cargo", ["tauri", "build", "--no-bundle"], { cwd: tauri, stdio: "inherit", windowsHide: true });
	const built = fileURLToPath(new URL(`./src-tauri/target/release/pi-hub-app${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
	if (!existsSync(built)) throw new Error(`No build at ${built}`);
	copyFileSync(built, app.paths.next);
	app.restart();
	tell("Desktop app restarted on the local build.");
} catch (error) {
	tell(`Desktop app rebuild failed: ${error.message.split("\n")[0]}`);
	process.exitCode = 1;
}
