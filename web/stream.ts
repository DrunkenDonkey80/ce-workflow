// Live text deltas (D21), shared by the page and its tests.
/** Applies `{ offset, text }` to `current` (undefined = unknown or an excerpt): the new text, "stale" to ignore, or "gap" to refetch. */
export function applyText(current: string | undefined, offset: number, text: string): string | "stale" | "gap" {
	if (offset === 0) return text;
	if (current === undefined || offset > current.length) return "gap";
	if (offset + text.length < current.length) return "stale";
	return current.slice(0, offset) + text;
}
