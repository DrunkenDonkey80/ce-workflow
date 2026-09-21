#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assert } from "./work-command-fixture.mjs";

const modulePath = path.join(
	import.meta.dirname,
	"../extensions/work-models.ts",
);
const source = readFileSync(modulePath, "utf8");
const mod = await import(pathToFileURL(modulePath).href);

assert(
	!("deriveSuccessorPrefetch" in mod) &&
		!("launchSuccessorPrefetch" in mod) &&
		!("promoteSuccessorPrefetch" in mod) &&
		!("createSuccessorPrefetchAdapter" in mod) &&
		!source.includes("maybeLaunchSuccessorPrefetch") &&
		!source.includes('key: "prepareNextCandidate"') &&
		source.includes("function reconcileSuccessorPrefetches"),
	"only legacy successor-prefetch reconciliation remains",
);

console.log("work prefetch retirement tests passed");
