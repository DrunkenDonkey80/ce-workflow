#!/usr/bin/env node
// Tier 3 hysteresis (plan-final.md §2.7): Schmitt trigger — fire at
// threshold T, clear only below 0.7·T — plus diff-gated resolution: a
// finding that "resolves" without a UI-surface fingerprint change is
// noise, not a fix.
export const CLEAR_FACTOR = 0.7;

export function schmitt({ measured, threshold }) {
	return {
		firing: measured >= threshold,
		clearing: measured < CLEAR_FACTOR * threshold,
	};
}

// A finding that disappears while the fingerprint is unchanged was not
// fixed — hold it open with hysteresisHeld so threshold noise cannot
// manufacture convergence.
export function applyHysteresis({
	previous,
	current,
	fingerprintAtFire,
	fingerprint,
}) {
	const held = [];
	const currentKeys = new Set(current.map((finding) => finding.id));
	for (const finding of previous ?? []) {
		if (currentKeys.has(finding.id)) continue;
		const firedAt = fingerprintAtFire?.get(finding.id);
		if (firedAt && firedAt !== fingerprint) continue; // real resolution
		held.push({ ...finding, hysteresisHeld: true });
	}
	return { findings: [...current, ...held], held };
}

export function fingerprintMap(findings, fingerprint) {
	return new Map((findings ?? []).map((finding) => [finding.id, fingerprint]));
}
