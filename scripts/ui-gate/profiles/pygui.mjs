#!/usr/bin/env node
// P4 Python GUI capture profile (plan-final.md §2.7): runs the embedded
// tkinter helper (tk-helper.py) and normalizes its self-report into gate
// geometry. No python/tkinter → recorded skip.
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const profileDir = path.dirname(fileURLToPath(import.meta.url));

function runPython(python) {
	return new Promise((resolve, reject) => {
		execFile(
			python,
			[path.join(profileDir, "tk-helper.py")],
			{ timeout: 30_000 },
			(error, stdout, stderr) => {
				if (error) reject(new Error(stderr || error.message));
				else resolve(stdout);
			},
		);
	});
}

export function normalizeTkReport(report) {
	const elements = [];
	for (const element of report?.elements ?? []) {
		if (element.w <= 0 || element.h <= 0) continue;
		elements.push({
			key: element.key,
			parent: element.key.replace(/\/[^/]+$/, "") || null,
			anchor: null,
			testId: null,
			tag: String(element.class ?? "Widget"),
			text: element.text ?? "",
			rect: {
				x: Number(element.x),
				y: Number(element.y),
				width: Number(element.w),
				height: Number(element.h),
			},
			interactive:
				/^(T?Button|T?Checkbutton|T?Radiobutton|T?Entry|T?Combobox|T?Spinbox|T?Menubutton|T?Scale|T?Scrollbar)$/i.test(
					String(element.class ?? ""),
				),
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
				scrollWidth: Number(element.w),
				clientWidth: Number(element.w),
				scrollHeight: Number(element.h),
				clientHeight: Number(element.h),
			},
		});
	}
	const viewport = {
		width: report?.viewport?.width ?? 320,
		height: report?.viewport?.height ?? 160,
	};
	return {
		version: 1,
		profile: "pygui-tkinter",
		viewport: { name: "desktop", ...viewport },
		state: "ready",
		document: {
			scrollWidth: viewport.width,
			scrollHeight: viewport.height,
			innerWidth: viewport.width,
			innerHeight: viewport.height,
			htmlOverflow: "visible",
			bodyOverflow: "visible",
		},
		elements,
		text: elements.map((element) => element.text).join(" "),
	};
}

export async function capturePyGuiCell({
	state = "ready",
	out,
	python = "python",
} = {}) {
	let stdout;
	try {
		stdout = await runPython(python);
	} catch (error) {
		return { ok: false, skipped: `python/tkinter unavailable: ${error.message}` };
	}
	const jsonLine = stdout.trim().split("\n").at(-1);
	let report;
	try {
		report = JSON.parse(jsonLine);
	} catch {
		return { ok: false, skipped: "unparseable tkinter self-report" };
	}
	const geometry = normalizeTkReport(report);
	geometry.state = state;
	mkdirSync(out, { recursive: true });
	const geometryJson = `${JSON.stringify(geometry, null, 1)}\n`;
	writeFileSync(path.join(out, "geometry.json"), geometryJson);
	writeFileSync(
		path.join(out, "meta.json"),
		`${JSON.stringify(
			{
				profile: "pygui-tkinter",
				viewport: geometry.viewport,
				state,
				captureTier: "deterministic",
				measuredBy: "pygui-tkinter",
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
		cell: { profile: "pygui-tkinter", viewport: "desktop", state },
		artifacts: { geometry: "geometry.json", meta: "meta.json" },
	};
}
