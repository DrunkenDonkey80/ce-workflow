// R-02: pins a published app release into hub/app/release.json (version, URLs, SHA-256) for hub/src/app-install.ts.
// Usage: node hub/app/pin-release.mjs app-v0.1.0 [--from <folder with the downloaded assets>]
// Without --from it downloads the release's assets with `gh release download`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "DrunkenDonkey80/ce-workflow";
const ASSETS = { "windows-x64": "pi-hub-app-windows-x64.exe", "linux-x64": "pi-hub-app-linux-x64.AppImage" };
const [tag, flag, from] = process.argv.slice(2);
if (!/^app-v\d+\.\d+\.\d+$/.test(tag ?? "") || (flag && flag !== "--from")) {
	console.error("Usage: node hub/app/pin-release.mjs app-v<x.y.z> [--from <folder>]");
	process.exit(2);
}
const folder = from ?? mkdtempSync(path.join(tmpdir(), "pi-hub-app-pin-"));
try {
	if (!from) execFileSync("gh", ["release", "download", tag, "--repo", REPO, "--dir", folder, ...Object.values(ASSETS).flatMap(name => ["--pattern", name])], { stdio: "inherit" });
	const assets = Object.fromEntries(Object.entries(ASSETS).map(([key, name]) => [key, {
		url: `https://github.com/${REPO}/releases/download/${tag}/${name}`,
		sha256: createHash("sha256").update(readFileSync(path.join(folder, name))).digest("hex"),
	}]));
	const out = new URL("./release.json", import.meta.url);
	writeFileSync(out, JSON.stringify({ version: tag.slice(5), assets }, null, "\t") + "\n");
	console.log(`pinned ${tag} in ${fileURLToPath(out)}`);
} finally {
	if (!from) rmSync(folder, { recursive: true, force: true });
}
