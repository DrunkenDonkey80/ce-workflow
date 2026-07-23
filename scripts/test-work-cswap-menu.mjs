import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cswapMenuItems, resolveCswap } from "../extensions/work-models.js";

// Rendering: active marker, alias/email fallback, and the missing-usage case.
const { items, activeNumber } = cswapMenuItems({
	activeAccountNumber: 2,
	accounts: [
		{
			number: 1,
			email: "a@x.io",
			usage: {
				fiveHour: { pct: 6, countdown: "4h 50m", clock: "20:20" },
				sevenDay: { pct: 0, countdown: "4d 20h", clock: "Jul 28 12:00" },
			},
		},
		{ number: 2, alias: "work", email: "b@x.io", active: true },
	],
});
assert.equal(activeNumber, 2);
assert.equal(items[0].label, "1. a@x.io");
assert.match(items[0].description, /5h: 6% used · resets in 4h 50m \(20:20\)/);
assert.match(items[0].description, /Week: 0% used · resets in 4d 20h/);
assert.equal(items[1].label, "● 2. work (active)");
assert.equal(items[1].description, "Usage info unavailable");
assert.deepEqual(cswapMenuItems(null), { items: [], activeNumber: undefined });

// Detection: override that exists resolves; a missing override does not.
const dir = path.join(tmpdir(), `cswap-test-${process.pid}`);
mkdirSync(dir, { recursive: true });
const bin = path.join(dir, "cswap");
writeFileSync(bin, "");
process.env.WORK_ORCH_CSWAP_BIN = bin;
assert.equal(resolveCswap(), bin);
process.env.WORK_ORCH_CSWAP_BIN = path.join(tmpdir(), "definitely-missing-cswap");
assert.equal(resolveCswap(), null);
delete process.env.WORK_ORCH_CSWAP_BIN;
assert.ok(existsSync(bin));

console.log("ok - cswap menu helpers");
