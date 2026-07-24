import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cswapMenuItems, resolveCswap } from "../extensions/work-models.js";

// Accounts with >50% 5h quota free come first, nearest reset first.
const { items, activeNumber } = cswapMenuItems({
	activeAccountNumber: 2,
	accounts: [
		{
			number: 1,
			email: "a@x.io",
			usage: {
				fiveHour: {
					pct: 60,
					countdown: "1h 32m",
					resetsAt: "2026-07-24T10:00:00Z",
				},
				sevenDay: { pct: 10, countdown: "3d 12h 5m" },
			},
		},
		{ number: 2, alias: "work", email: "b@x.io", active: true },
		{
			number: 3,
			email: "c@x.io",
			usage: {
				fiveHour: {
					pct: 10,
					countdown: "3h",
					resetsAt: "2026-07-24T12:00:00Z",
				},
				sevenDay: { pct: 90, countdown: "2d" },
			},
		},
		{
			number: 4,
			email: "d@x.io",
			usage: {
				fiveHour: {
					pct: 20,
					countdown: "1h",
					resetsAt: "2026-07-24T10:00:00Z",
				},
			},
		},
	],
});
assert.equal(activeNumber, 2);
assert.deepEqual(
	items.map((item) => item.value),
	["4", "3", "1", "2"],
);
assert.equal(
	items[2].label,
	"a@x.io, 5h [████░░] 60%, in 1h 32m, week [█░░░░░] 10%, in 3d 12h 5m",
);
assert.deepEqual(
	new Set(
		items
			.flatMap((item) => item.labelSegments.map(({ color }) => color))
			.filter(Boolean),
	),
	new Set(["success", "warning", "error"]),
);
assert.equal(items[3].label, "b@x.io");
assert(items.every((item) => !/^●?\s*\d+\./.test(item.label)));
assert(items.every((item) => item.description == null));
assert.deepEqual(cswapMenuItems(null), { items: [], activeNumber: undefined });

// Detection: override that exists resolves; a missing override does not.
const dir = path.join(tmpdir(), `cswap-test-${process.pid}`);
mkdirSync(dir, { recursive: true });
const bin = path.join(dir, "cswap");
writeFileSync(bin, "");
process.env.WORK_ORCH_CSWAP_BIN = bin;
assert.equal(resolveCswap(), bin);
process.env.WORK_ORCH_CSWAP_BIN = path.join(
	tmpdir(),
	"definitely-missing-cswap",
);
assert.equal(resolveCswap(), null);
delete process.env.WORK_ORCH_CSWAP_BIN;
assert.ok(existsSync(bin));

console.log("ok - cswap menu helpers");
