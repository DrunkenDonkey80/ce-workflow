#!/usr/bin/env node
// Record a finished Plan3 catch-up review: node scripts/work-catch-up-record.mjs <plan id | path>
import { createJiti } from "jiti";

const { recordCatchUp } = await createJiti(import.meta.url).import("../extensions/plan3-catch-up.ts");
const ref = process.argv[2];
if (!ref) {
	console.error("usage: node scripts/work-catch-up-record.mjs <plan id | path>");
	process.exit(2);
}
try {
	console.log(`recorded: ${recordCatchUp(process.cwd(), ref).join(", ")}`);
} catch (error) {
	console.error(error.message);
	process.exit(1);
}
