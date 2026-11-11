// Pi 1.5's cache-stats / significant-notice rules. RPC has no cache-miss event and the detector is not a public SDK export.
// Keep only usage, never message bodies: a session can run for days.
export function createCacheMissTracker() {
	let previous: { tokens: number; model: string; timestamp: number; reportedCache: boolean; readRate?: number } | undefined;
	return {
		reset() { previous = undefined; },
		observe(message: any): string | undefined {
			if (["compactionSummary", "branchSummary"].includes(message?.role)) { previous = undefined; return; }
			if (!["assistant", "cacheWarm"].includes(message?.role)) return;
			const usage = message.usage;
			if (!usage || ![usage.input, usage.cacheRead, usage.cacheWrite].every(n => Number.isFinite(n) && n >= 0)) return;
			const tokens = usage.input + usage.cacheRead + usage.cacheWrite;
			if (!tokens) return;
			const before = previous, model = `${message.provider}/${message.model}`;
			const readRate = usage.cacheRead > 0 && Number.isFinite(usage.cost?.cacheRead) ? usage.cost.cacheRead / usage.cacheRead : before?.model === model ? before.readRate : undefined;
			previous = { tokens, model, timestamp: message.timestamp, reportedCache: !!before?.reportedCache || usage.cacheRead + usage.cacheWrite > 0 || message.role === "cacheWarm", readRate };
			if (message.role === "cacheWarm" || !before || (!before.reportedCache && !usage.cacheRead && !usage.cacheWrite)) return;
			const missed = Math.min(before.tokens, tokens) - usage.cacheRead;
			if (missed <= 1024) return; // cache breakpoint granularity, as in Pi
			const paid = usage.input + usage.cacheWrite, cost = usage.cost;
			// RPC has no model price catalog: omit the dollar estimate until this model reports a cache-read rate.
			const extra = readRate !== undefined && paid > 0 && Number.isFinite(cost?.input) && Number.isFinite(cost?.cacheWrite)
				? missed * Math.max(0, (cost.input + cost.cacheWrite) / paid - readRate) : 0;
			if (missed < 20_000 && extra < 0.1) return;
			const idle = message.timestamp - before.timestamp;
			const reason = model !== before.model ? " after model switch" : idle >= 300_000 ? ` after ${Math.round(idle / 60_000)}m idle` : "";
			return `Cache miss${reason}: ${missed.toLocaleString("en-US")} tokens re-billed${extra >= 0.01 ? ` (~$${extra.toFixed(2)})` : ""}`;
		},
	};
}
