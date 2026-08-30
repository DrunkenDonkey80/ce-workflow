#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(
	process.env.WORK_FIXTURE_ROOT ?? path.resolve(import.meta.dirname, "../../.."),
);
const cache = path.join(
	process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
	"ms-playwright",
);
const version = readdirSync(cache)
	.filter((name) => /^chromium_headless_shell-/.test(name))
	.sort()
	.at(-1);
if (!version)
	throw new Error(
		"Playwright Chromium is unavailable; run playwright install chromium",
	);
const chromium = path.join(
	cache,
	version,
	"chrome-headless-shell-win64",
	"chrome-headless-shell.exe",
);
const page = pathToFileURL(
	path.join(import.meta.dirname, "browser-calculator.html"),
).href;
const outDir = path.join(root, ".pi", "work-artifacts", "browser-smoke");
mkdirSync(outDir, { recursive: true });
const screenshot = path.join(outDir, "calculator.png");
const common = [
	"--headless",
	"--no-sandbox",
	"--disable-gpu",
	"--allow-file-access-from-files",
];
const dom = spawnSync(chromium, [...common, "--dump-dom", page], {
	encoding: "utf8",
	timeout: 120_000,
});
if (
	dom.status !== 0 ||
	!/data-proof="ok"/.test(dom.stdout) ||
	!/<main>/.test(dom.stdout)
)
	throw new Error(
		`browser behavior/accessibility smoke failed: ${dom.stderr || dom.stdout}`,
	);
const shot = spawnSync(
	chromium,
	[...common, "--window-size=390,844", `--screenshot=${screenshot}`, page],
	{ encoding: "utf8", timeout: 120_000 },
);
if (shot.status !== 0)
	throw new Error(`browser screenshot failed: ${shot.stderr || shot.stdout}`);
const log = path.join(outDir, "browser.log");
writeFileSync(
	log,
	`chromium=${chromium}\nstate=ok\nviewport=390x844\ncleanup=process-exited\n`,
);
process.stdout.write(
	JSON.stringify({
		artifacts: {
			screenshot: path.relative(root, screenshot),
			log: path.relative(root, log),
		},
		cleanup: { ok: true, process: "exited" },
		state: "ok",
	}),
);
