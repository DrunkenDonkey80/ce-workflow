import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { renderDesign } from "../../../../extensions/design-render.ts";
const cwd = process.cwd();
assert.ok(["html", "astryx"].includes(path.basename(cwd)), "Run from one comparison arm folder");
assert.ok(fs.existsSync(path.join(cwd, "public", "index.html")), "Build public/index.html first");
fs.mkdirSync(path.join(cwd, "checks"), { recursive: true });
const results = [];
for (const width of [390, 1440]) {
  const result = await renderDesign({ folder: path.join(cwd, "public"), width, height: 900, maxEdge: 1440 });
  assert.ok(result.png.length > 100, "Renderer returned no usable PNG");
  const screenshot = path.join(cwd, "checks", `look-${width}.png`);
  fs.writeFileSync(screenshot, result.png);
  results.push({ width, screenshot, pngBytes: result.png.length, report: result.report });
}
fs.writeFileSync(path.join(cwd, "checks", "look.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
