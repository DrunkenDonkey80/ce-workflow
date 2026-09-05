// UI gate evidence overlays (plan-final.md §2.6): SVG overlay + HTML viewer.
import { writeFileSync } from "node:fs";

function esc(text) {
	return String(text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export function renderOverlaySvg(geometry, findings) {
	const width = Math.max(geometry.document.scrollWidth, geometry.viewport.width);
	const height = Math.max(
		geometry.document.scrollHeight,
		geometry.viewport.height,
	);
	const shapes = [];
	for (const el of geometry.elements) {
		if (el.tag === "HTML" || el.tag === "BODY") continue;
		shapes.push(
			`\t<rect x="${el.rect.x}" y="${el.rect.y}" width="${el.rect.width}" height="${el.rect.height}" fill="rgba(74,144,217,0.05)" stroke="#4a90d9" stroke-width="1" opacity="0.5"/>`,
		);
	}
	const marks = findings.map((finding, index) => {
		// Document-level findings (scroll-trap, content-missing) have no element
		// rect; anchor their marker to the viewport's top-left instead of crashing.
		const rect = finding.rect ?? { x: 8, y: 8, width: 0, height: 0 };
		return (
			`\t<g><rect x="${rect.x - 2}" y="${rect.y - 2}" width="${rect.width + 4}" height="${rect.height + 4}" fill="rgba(255,0,0,0.08)" stroke="#d33" stroke-width="2"/>` +
			`<text x="${rect.x}" y="${Math.max(12, rect.y - 4)}" font-size="12" fill="#d33">${esc(`${index + 1}. ${finding.rule} (${finding.severity})`)}</text></g>`
		);
	});
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.min(width, 2000)}" height="${Math.min(height, 8000)}" viewBox="0 0 ${width} ${height}" font-family="monospace">
<!-- ui-gate overlay ${geometry.viewport.name}/${geometry.state} -->
<rect width="${geometry.viewport.width}" height="${geometry.viewport.height}" fill="none" stroke="#999" stroke-dasharray="6 6"/>
${shapes.join("\n")}
${marks.join("\n")}
</svg>
`;
	return svg;
}

export function renderViewerHtml({
	screenshotName,
	overlayName,
	findings,
	specScreenshotName,
	specOverlayName,
}) {
	const specBlock = specScreenshotName
		? `\t\t<section><h2>Approved candidate</h2><img src="${esc(specScreenshotName)}" alt="candidate" />${specOverlayName ? `<img src="${esc(specOverlayName)}" alt="spec overlay" />` : ""}</section>`
		: "";
	const rows = findings
		.map(
			(finding, index) =>
				`\t\t<tr><td>${index + 1}</td><td>${esc(finding.rule)}</td><td>${esc(finding.severity)}</td><td>${esc(finding.element.matchKey)}</td><td>${esc(JSON.stringify(finding.measured))}</td></tr>`,
		)
		.join("\n");
	return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>ui-gate findings</title>
<style>body{font:14px system-ui;margin:1rem;display:grid;grid-template-columns:1fr 1fr;gap:1rem}img{max-width:100%;border:1px solid #ccc}table{grid-column:1/-1;border-collapse:collapse}td,th{border:1px solid #ccc;padding:.25rem .5rem;text-align:left}th{background:#f4f4f4}</style>
</head>
<body>
\t\t<section><h2>Implemented capture</h2><img src="${esc(screenshotName)}" alt="implemented" /><img src="${esc(overlayName)}" alt="overlay" /></section>
${specBlock}
\t\t<table><tr><th>#</th><th>rule</th><th>severity</th><th>element</th><th>measured</th></tr>
${rows}
\t\t</table>
</body>
</html>
`;
}

export function writeEvidenceArtifacts({
	outDir,
	geometry,
	findings,
	specGeometry,
	specScreenshotName,
}) {
	const overlayName = "overlay.svg";
	writeFileSync(
		`${outDir}/${overlayName}`,
		renderOverlaySvg(geometry, findings),
	);
	let specOverlayName;
	if (specGeometry) {
		specOverlayName = "spec-overlay.svg";
		writeFileSync(
			`${outDir}/${specOverlayName}`,
			renderOverlaySvg(specGeometry, []),
		);
	}
	writeFileSync(
		`${outDir}/viewer.html`,
		renderViewerHtml({
			screenshotName: "screenshot.png",
			overlayName,
			findings,
			specScreenshotName,
			specOverlayName,
		}),
	);
	return {
		overlay: overlayName,
		viewer: "viewer.html",
		...(specOverlayName ? { specOverlay: specOverlayName } : {}),
	};
}
