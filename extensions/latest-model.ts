// Newest available model of a family (luna, terra, sol, astra), so code does not pin an outdated release.
// Picks up a new release without a benchmark: use it only for short, bounded calls.
const newer = (a: number[], b: number[]) => {
	for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
	return false;
};

export async function latestModel(registry, provider: string, family: string) {
	if (!/^[a-z]+$/.test(family)) throw new Error(`bad model family: ${family}`);
	let best, bestVersion: number[] | undefined;
	for (const model of (await registry?.getAvailable?.()) ?? []) {
		if (model.provider !== provider || !model.id.startsWith("gpt-") || !model.id.endsWith(`-${family}`)) continue;
		const text = model.id.slice(4, -family.length - 1);
		if (!/^\d+(\.\d+)*$/.test(text)) continue;
		const version = text.split(".").map(Number);
		if (!bestVersion || newer(version, bestVersion)) { best = model; bestVersion = version; }
	}
	return best;
}
