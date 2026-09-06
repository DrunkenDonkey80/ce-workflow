#!/usr/bin/env node
// P4 Windows native capture profile (plan-final.md §2.7): UIA tree dump via
// PowerShell/.NET (OS built-in, zero deps) → normalized geometry.json. No
// PowerShell/Windows → recorded skip.
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const profileDir = path.dirname(fileURLToPath(import.meta.url));

function runPowerShell() {
	return new Promise((resolve, reject) => {
		execFile(
			"powershell",
			[
				"-NoProfile",
				"-NonInteractive",
				"-STA",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				path.join(profileDir, "win-uia-dump.ps1"),
			],
			{ timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error) reject(new Error(stderr || error.message));
				else resolve(stdout);
			},
		);
	});
}

// UIA tree JSON → gate geometry. InvokePattern marks interactivity (a
// focusable-but-inert window must not overlap its buttons), and containment
// establishes parent links so R2 can skip parent–child pairs.
export function normalizeUiaTree(tree, { viewport } = {}) {
	const raw = [];
	for (const node of Array.isArray(tree) ? tree : [tree]) {
		if (!node?.rect) continue;
		if (node.rect.width <= 0 || node.rect.height <= 0) continue;
		raw.push({
			tag: String(node.tag ?? "Control"),
			name: node.name ?? "",
			interactive: Boolean(node.invoke),
			rect: {
				x: Number(node.rect.x),
				y: Number(node.rect.y),
				width: Number(node.rect.width),
				height: Number(node.rect.height),
			},
		});
	}
	const contains = (outer, inner) =>
		outer !== inner &&
		outer.rect.x <= inner.rect.x &&
		outer.rect.y <= inner.rect.y &&
		outer.rect.x + outer.rect.width >= inner.rect.x + inner.rect.width &&
		outer.rect.y + outer.rect.height >= inner.rect.y + inner.rect.height;
	const elements = raw.map((entry, index) => {
		const parent = raw
			.filter((other) => contains(other, entry))
			.sort(
				(a, b) =>
					a.rect.width * a.rect.height - b.rect.width * b.rect.height,
			)[0];
		return {
			key: `uia-${index + 1}`,
			parent: parent ? `uia-${raw.indexOf(parent) + 1}` : null,
			anchor: null,
			testId: null,
			tag: entry.tag.replace(/^ControlType\./, ""),
			text: entry.name,
			rect: entry.rect,
			interactive: entry.interactive,
			effectiveOpacity: 1,
			styles: {
				color: null,
				backgroundColor: null,
				fontSize: null,
				fontWeight: "400",
				display: "block",
				position: "static",
				overflow: "visible",
				textOverflow: "clip",
				lineClamp: "none",
				zIndex: "auto",
			},
			overflow: {
				scrollWidth: entry.rect.width,
				clientWidth: entry.rect.width,
				scrollHeight: entry.rect.height,
				clientHeight: entry.rect.height,
			},
		};
	});
	const size = viewport ?? { width: 1920, height: 1080 };
	return {
		version: 1,
		profile: "win-uia",
		viewport: { name: "desktop", ...size },
		state: "ready",
		document: {
			scrollWidth: size.width,
			scrollHeight: size.height,
			innerWidth: size.width,
			innerHeight: size.height,
			htmlOverflow: "visible",
			bodyOverflow: "visible",
		},
		elements,
		text: elements.map((element) => element.text).join(" "),
	};
}

export async function captureWinUiaCell({ state = "ready", out } = {}) {
	const isWindows = process.platform === "win32";
	if (!isWindows) return { ok: false, skipped: "win-uia requires Windows" };
	let stdout;
	try {
		stdout = await runPowerShell();
	} catch (error) {
		return { ok: false, skipped: `powershell unavailable: ${error.message}` };
	}
	const arrayStart = stdout.indexOf("[");
	const objectStart = stdout.indexOf("{");
	const jsonStart =
		arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart)
			? arrayStart
			: objectStart;
	const jsonEnd = Math.max(stdout.lastIndexOf("}"), stdout.lastIndexOf("]"));
	if (jsonStart < 0 || jsonEnd < jsonStart)
		return { ok: false, skipped: "no UIA JSON in dump output" };
	let tree;
	try {
		tree = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
	} catch {
		return { ok: false, skipped: "unparseable UIA dump" };
	}
	const geometry = normalizeUiaTree(tree);
	geometry.state = state;
	mkdirSync(out, { recursive: true });
	const geometryJson = `${JSON.stringify(geometry, null, 1)}\n`;
	writeFileSync(path.join(out, "geometry.json"), geometryJson);
	writeFileSync(
		path.join(out, "meta.json"),
		`${JSON.stringify(
			{
				profile: "win-uia",
				viewport: geometry.viewport,
				state,
				captureTier: "deterministic",
				measuredBy: "win-uia-powershell",
				runs: 1,
				byteIdentical: null,
				quarantined: [],
				geometrySha256: createHash("sha256").update(geometryJson).digest("hex"),
			},
			null,
			1,
		)}\n`,
	);
	return {
		ok: true,
		cell: { profile: "win-uia", viewport: "desktop", state },
		artifacts: { geometry: "geometry.json", meta: "meta.json" },
	};
}
