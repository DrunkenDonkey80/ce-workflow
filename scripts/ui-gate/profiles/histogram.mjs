#!/usr/bin/env node
// P4 histogram colour sampler for off-web surfaces (plan-final.md §2.7):
// the same eroded-central-50% mode counter the Tier 3 whitelist uses.
// Web keeps getComputedStyle (exact); native surfaces get this.
import { dominantColour } from "../tier3/rules-whitelist.mjs";
import { decodePng } from "../tier3/png.mjs";

export { dominantColour };

export function histogramColour({ image, rect }) {
	return dominantColour({ image, rect });
}

export function histogramFromPng(pngBuffer, rect) {
	return dominantColour({ image: decodePng(pngBuffer), rect });
}
