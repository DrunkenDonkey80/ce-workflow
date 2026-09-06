#!/usr/bin/env node
// P4 Android native capture profile (plan-final.md §2.7): adb screencap +
// uiautomator dump → the gate's normalized geometry.json. Capability probe
// + retry + tolerant parse; no device → a recorded skip, never a fake pass.
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

function run(command, args, timeoutMs = 30_000) {
	return new Promise((resolve, reject) => {
		execFile(
			command,
			args,
			{ timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error)
					reject(
						new Error(
							`${command} ${args.join(" ")} failed: ${stderr || error.message}`,
						),
					);
				else resolve(stdout);
			},
		);
	});
}

const ATTRIBUTE = (name) => new RegExp(`${name}="([^"]*)"`);

function nodeAttributes(tag) {
	const bounds = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(
		ATTRIBUTE("bounds").exec(tag)?.[1] ?? "",
	);
	const left = bounds ? Number(bounds[1]) : 0;
	const top = bounds ? Number(bounds[2]) : 0;
	const right = bounds ? Number(bounds[3]) : 0;
	const bottom = bounds ? Number(bounds[4]) : 0;
	return {
		text: ATTRIBUTE("text").exec(tag)?.[1] || "",
		contentDesc: ATTRIBUTE("content-desc").exec(tag)?.[1] || "",
		resourceId: ATTRIBUTE("resource-id").exec(tag)?.[1] || "",
		className: ATTRIBUTE("class").exec(tag)?.[1] || "",
		clickable: ATTRIBUTE("clickable").exec(tag)?.[1] === "true",
		scrollable: ATTRIBUTE("scrollable").exec(tag)?.[1] === "true",
		rect: { x: left, y: top, width: right - left, height: bottom - top },
	};
}

// Tolerant uiautomator XML → gate geometry. Only surface-bearing nodes
// (text, description, or interactive) become elements.
export function normalizeUiautomatorDump(xml, { viewport } = {}) {
	const tags = [...String(xml).matchAll(/<node\b[^>]*>/g)].map((match) =>
		match[0].replace(/\/>$/, ""),
	);
	const elements = [];
	let index = 0;
	for (const tag of tags) {
		const attrs = nodeAttributes(tag);
		index += 1;
		if (
			!attrs.text &&
			!attrs.contentDesc &&
			!attrs.clickable &&
			!attrs.resourceId
		)
			continue;
		if (attrs.rect.width <= 0 || attrs.rect.height <= 0) continue;
		elements.push({
			key: `node-${index}`,
			parent: null,
			anchor: null,
			testId: attrs.resourceId || null,
			tag: attrs.className.split(".").at(-1) || "NODE",
			text: attrs.text || attrs.contentDesc,
			rect: attrs.rect,
			interactive: attrs.clickable || attrs.scrollable,
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
				scrollWidth: attrs.rect.width,
				clientWidth: attrs.rect.width,
				scrollHeight: attrs.rect.height,
				clientHeight: attrs.rect.height,
			},
		});
	}
	const size = viewport ?? { width: 1080, height: 2400 };
	return {
		version: 1,
		profile: "android-uiautomator",
		viewport: { name: "device", ...size },
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

export async function androidCapability({ serial = null } = {}) {
	const base = serial ? ["-s", serial] : [];
	try {
		const list = await run("adb", [...base, "devices"], 10_000);
		return /device\s*$/m.test(list.replace("List of devices attached", ""));
	} catch {
		return false;
	}
}

export async function captureAndroidCell({
	serial = null,
	state = "ready",
	out,
	retries = 2,
}) {
	const base = serial ? ["-s", serial] : [];
	if (!(await androidCapability({ serial })))
		return { ok: false, skipped: "adb-device-unavailable" };
	mkdirSync(out, { recursive: true });
	const sizeLine = await run("adb", [...base, "shell", "wm", "size"]);
	const sizeMatch = /(\d+)x(\d+)/.exec(sizeLine.split("\n").at(-1) ?? "");
	const viewport = sizeMatch
		? { width: Number(sizeMatch[1]), height: Number(sizeMatch[2]) }
		: { width: 1080, height: 2400 };
	let xml = null;
	let lastError = null;
	for (let attempt = 0; attempt <= retries && !xml; attempt += 1) {
		try {
			await run("adb", [...base, "shell", "uiautomator", "dump", "/sdcard/window_dump.xml"]);
			xml = await run("adb", [...base, "shell", "cat", "/sdcard/window_dump.xml"]);
		} catch (error) {
			lastError = error;
		}
	}
	if (!xml) throw new Error(`uiautomator dump failed: ${lastError?.message ?? "no output"}`);
	const geometry = normalizeUiautomatorDump(xml, { viewport });
	geometry.state = state;
	const geometryJson = `${JSON.stringify(geometry, null, 1)}\n`;
	writeFileSync(path.join(out, "geometry.json"), geometryJson);
	const screenshot = path.join(out, "screenshot.png");
	const png = await run("adb", [...base, "exec-out", "screencap", "-p"]);
	writeFileSync(screenshot, Buffer.from(png, "binary"));
	writeFileSync(
		path.join(out, "meta.json"),
		`${JSON.stringify(
			{
				profile: "android-uiautomator",
				viewport: { name: "device", ...viewport },
				state,
				captureTier: "deterministic",
				measuredBy: "android-uiautomator",
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
		cell: { profile: "android-uiautomator", viewport: "device", state },
		artifacts: {
			geometry: "geometry.json",
			meta: "meta.json",
			screenshot: "screenshot.png",
		},
	};
}
