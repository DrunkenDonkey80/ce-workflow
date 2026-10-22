// The changelog the hub serves: parsing, "What's new" filtering, image names, and the real CHANGELOG.md's shape.
import assert from "node:assert/strict";
import { changelogImage, hubVersion, parseChangelog, readChangelog, since, VERSION_PATTERN } from "../src/changelog.ts";

const entries = parseChangelog("# Changelog\n\nintro\n\n## Unreleased\n\n- next\n\n## 0.1.10 — 2026-10-22\n\n### Added\n- ten\n\n## 0.1.9 — 2026-10-21\n\n- nine\n");
assert.deepEqual(entries.map(e => [e.version, e.date]), [["Unreleased", ""], ["0.1.10", "2026-10-22"], ["0.1.9", "2026-10-21"]]);
assert.equal(entries[1].body, "### Added\n- ten");
assert.deepEqual(since(entries, "0.1.9").map(e => e.version), ["0.1.10"], "numeric order (0.1.10 > 0.1.9); Unreleased is never new");
assert.deepEqual(since(entries, "0.1.10"), []);
for (const bad of [null, "..png", "../package.json", "a/b.png", "x.svg", "x.png.exe"]) assert.throws(() => changelogImage(bad), /Unknown changelog image/);
assert.throws(() => changelogImage("missing-shot.png"), /not found/);

// Every released section names an x.y.z version and a date, newest first, and the package version has its entry.
const real = readChangelog(), released = real.filter(e => e.version !== "Unreleased");
for (const entry of released) { assert.match(entry.version, VERSION_PATTERN); assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/, entry.version); assert(entry.body, entry.version); }
for (let i = 1; i < released.length; i++) assert.deepEqual(since([released[i - 1]], released[i].version).length, 1, `${released[i - 1].version} before ${released[i].version}`);
assert(real.some(e => e.version === hubVersion()), `CHANGELOG.md has no entry for ${hubVersion()}`);
console.log("ok - changelog parse, What's new filter, image names, CHANGELOG.md shape");
