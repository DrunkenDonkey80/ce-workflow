// Benchmark-only extension, loaded last: removes the system-prompt sections named in BENCH_SECTIONS_OFF (comma list of
// section tags, e.g. locked-writes,ponytail) after every other extension has added its own.
// BENCH_DRY_RUN=FILE writes the first provider payload to FILE and exits before the request is sent (no model cost).
import { writeFileSync } from "node:fs";

export default function benchSectionsOff(pi) {
	const off = (process.env.BENCH_SECTIONS_OFF ?? "").split(",").filter(Boolean);
	pi.on("before_agent_start", (event) => {
		const sections = event?.systemPromptOptions?.sections;
		if (sections && typeof sections === "object") for (const tag of off) delete sections[tag];
	});
	pi.on("before_provider_request", (event) => {
		if (!process.env.BENCH_DRY_RUN) return;
		writeFileSync(process.env.BENCH_DRY_RUN, JSON.stringify(event.payload ?? event));
		process.exit(0);
	});
}
