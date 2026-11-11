// P3-08: public Astryx 0.7.12 palette authoring, not its theme compiler or component runtime.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runAstryx, type LibraryOptions } from "./design-library.ts";
export type ThemeOptions = LibraryOptions;

type Input = { accent: string; neutral: string; baseSize: number; typeScale: number; radius: number };
type Provenance = { version: string; lockDigest: string };
const STOPS = Array.from({ length: 21 }, (_, i) => i * 5);
const HEX = /^#[\da-f]{6}$/i;
export function themeInput(args): Input {
	const color = (value, name: string) => {
		if (typeof value !== "string" || !HEX.test(value)) throw new Error(`${name} must be a six-digit hex color, e.g. #c2410c.`);
		return value.toLowerCase();
	};
	const number = (value, name: string, min: number, max: number) => {
		if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be a finite number from ${min} to ${max}.`);
		return value;
	};
	return { accent: color(args.accent, "accent"), neutral: color(args.neutral === undefined ? "#767676" : args.neutral, "neutral"), baseSize: number(args.baseSize === undefined ? 16 : args.baseSize, "baseSize", 15, 24), typeScale: number(args.typeScale === undefined ? 1.2 : args.typeScale, "typeScale", 1, 1.5), radius: number(args.radius === undefined ? 8 : args.radius, "radius", 0, 32) };
}

/** WCAG relative luminance after compositing both layers over an explicit opaque canvas. */
export function contrastRatio(foreground: string, background: string, canvas = "#ffffff") {
	const parse = (hex: string) => {
		if (typeof hex !== "string" || !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(hex)) throw new Error("Contrast colors must be hex RGB or RGBA.");
		let value = hex.slice(1);
		if (value.length <= 4) value = [...value].map(c => c + c).join("");
		return { rgb: [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16) / 255), alpha: value.length === 8 ? parseInt(value.slice(6), 16) / 255 : 1 };
	};
	const base = parse(canvas);
	if (base.alpha !== 1) throw new Error("Contrast canvas must be opaque.");
	const over = (layer: ReturnType<typeof parse>, surface: number[]) => layer.rgb.map((c, i) => c * layer.alpha + surface[i] * (1 - layer.alpha));
	const bg = over(parse(background), base.rgb), fg = over(parse(foreground), bg);
	const luminance = (rgb: number[]) => rgb.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
	const a = luminance(fg), b = luminance(bg);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Returns files for the existing source writer; never writes the design folder. */
export function themeTokens(input: Input, candidate, source: Provenance) {
	input = themeInput(input);
	if (candidate?.schemaVersion !== 1 || candidate.recipe !== "astryx-oklch-v1" || JSON.stringify(candidate.stops) !== JSON.stringify(STOPS)) throw new Error("Unsupported Astryx palette contract.");
	const ramps = {} as Record<"light" | "dark", Record<string, Record<number, string>>>;
	const modes = {} as Record<"light" | "dark", Record<string, string>>;
	for (const mode of ["light", "dark"] as const) {
		ramps[mode] = {};
		for (const family of ["accent", "neutral"]) {
			const values = candidate.palette?.[family]?.[mode];
			if (!values || STOPS.some(stop => typeof values[stop] !== "string" || !HEX.test(values[stop]))) throw new Error(`Invalid ${family}/${mode} palette colors.`);
			ramps[mode][family] = Object.fromEntries(STOPS.map(stop => [stop, values[stop].toLowerCase()]));
		}
		const { accent: a, neutral: n } = ramps[mode], dark = mode === "dark", accent = a[dark ? 70 : 50];
		if (a[50] !== input.accent) throw new Error("Palette did not preserve the exact accent seed.");
		modes[mode] = { bg: n[dark ? 5 : 95], surface: n[dark ? 10 : 100], text: n[dark ? 95 : 10], muted: n[dark ? 65 : 40], border: n[dark ? 45 : 60], accent, "on-accent": contrastRatio("#ffffff", accent) >= contrastRatio("#000000", accent) ? "#ffffff" : "#000000", focus: accent };
	}
	const contrast = Object.entries(modes).flatMap(([mode, tokens]) => [
		["text", "bg", 4.5], ["text", "surface", 4.5], ["muted", "bg", 4.5], ["muted", "surface", 4.5], ["on-accent", "accent", 4.5], ["accent", "bg", 4.5], ["border", "surface", 3], ["focus", "bg", 3],
	].map(([foreground, background, minimum]: [string, string, number]) => {
		const ratio = contrastRatio(tokens[foreground], tokens[background]);
		return { mode, foreground, background, ratio, minimum, pass: ratio >= minimum };
	}));
	const steps: [string, number][] = [["caption", -1], ["body", 0], ["subtitle", 1], ["heading-sm", 2], ["heading", 3], ["heading-lg", 4], ["display", 5]];
	const type = Object.fromEntries(steps.map(([name, power]) => [name, Math.round(input.baseSize * input.typeScale ** power * 1000) / 1000]));
	const globals = [`  --type-scale: ${input.typeScale};`, `  --type-body: ${input.baseSize}px;`, ...steps.filter(([, power]) => power !== 0).map(([name, power]) => `  --type-${name}: calc(var(--type-body)${power < 0 ? " / var(--type-scale)" : " * var(--type-scale)".repeat(power)});`), `  --radius: ${input.radius}px;`, "  --radius-sm: calc(var(--radius) / 2);", "  --radius-lg: calc(var(--radius) * 1.5);", "  --radius-pill: 999px;"];
	const declarations = (mode: "light" | "dark") => [`  color-scheme: ${mode};`, ...Object.entries(ramps[mode]).flatMap(([family, ramp]) => STOPS.map(stop => `  --${family}-${stop}: ${ramp[stop]};`)), ...Object.entries(modes[mode]).map(([name, value]) => `  --${name}: ${value};`)].join("\n");
	const css = `/* Generated with @astryxdesign/cli ${source.version}; semantic mapping belongs to ce-workflow. */\n:root {\n${globals.join("\n")}\n${declarations("light")}\n}\n@media (prefers-color-scheme: dark) {\n:root:not([data-theme="light"]) {\n${declarations("dark")}\n}\n}\n:root[data-theme="dark"] {\n${declarations("dark")}\n}\n`;
	const tokens = { schemaVersion: 1, source: { api: "@astryxdesign/cli/api#generateTonalPalette", ...source, recipe: candidate.recipe }, input, ramps, modes, type, radius: { base: input.radius, sm: input.radius / 2, lg: input.radius * 1.5, pill: 999 }, contrast, scope: "Token pairs only; not page accessibility certification. Border evidence applies when the border conveys a control boundary. Recheck rendered states and any live overrides." };
	const designNotes = ["## Generated theme", "", `Astryx CLI ${source.version}, ${candidate.recipe}; exact dependency lock ${source.lockDigest}.`, "", "`tokens.css` supplies accent/neutral ramps, semantic light/dark colors, type and radius scales. `theme.tokens.json` records inputs and measured token-pair contrast; it is not a whole-page accessibility certification.", "", ...contrast.map(pair => `- ${pair.mode} ${pair.foreground}/${pair.background}: ${pair.ratio.toFixed(2)}:1; needs ${pair.minimum}:1 — ${pair.pass ? "pass" : "FAIL"}.`)].join("\n");
	return { css, tokens, designNotes, previewControls: previewControls(input), instruction: "Write css as tokens.css and tokens as theme.tokens.json in this design's folder; link the CSS, merge designNotes into DESIGN.md, and use semantic variables. Optional previewControls reuse Tweaks/Keep; Keep seed edits require regeneration before persisting contrast evidence. Include designTheme.capture()/restore() in the page's declared designPreview state alongside supported app drafts." };
}

function previewControls(input: Input) {
	return `<style data-design-chrome>[data-theme-tweaks] label{display:inline-flex;align-items:center;gap:.25rem;margin:.25rem}[data-theme-tweaks] summary{cursor:pointer}@media(pointer:coarse){[data-theme-tweaks] :is(summary,input,label){min-height:44px}[data-theme-tweaks] input[type=checkbox]{min-width:44px}}</style>\n<details data-design-chrome data-theme-tweaks style="position:fixed;right:1rem;bottom:1rem;z-index:999;max-width:calc(100vw - 2rem);padding:.75rem;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:8px;font:14px/1.5 system-ui">
<summary>Tweaks</summary>
<label>Accent <input data-theme-knob="accent" type="color" value="${input.accent}"></label>
<label>Type scale <input data-theme-knob="typeScale" type="number" required min="1" max="1.5" step="any" value="${input.typeScale}" style="width:5em"></label>
<label>Radius <input data-theme-knob="radius" type="number" required min="0" max="32" step="any" value="${input.radius}" style="width:4em"></label>
<label>Dark <input data-theme-knob="dark" type="checkbox"></label>
<p>Live accent edits are overrides. Keep regenerates both ramps and contrast.</p>
</details>
<script data-design-chrome>(() => {
 const panel = document.querySelector('[data-theme-tweaks]'), root = document.documentElement;
 const initial = ${JSON.stringify({ accent: input.accent, typeScale: input.typeScale, radius: input.radius })};
 let values = { ...initial, dark: root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches };
 const knob = name => panel.querySelector('[data-theme-knob="' + name + '"]');
 const apply = next => {
  if (!next || typeof next !== 'object' || Array.isArray(next) || Object.keys(next).length !== 4 || !/^#[\\da-f]{6}$/i.test(next.accent) || !Number.isFinite(next.typeScale) || next.typeScale < 1 || next.typeScale > 1.5 || !Number.isFinite(next.radius) || next.radius < 0 || next.radius > 32 || typeof next.dark !== 'boolean') throw Error('Invalid theme tweak state');
  values = { accent: next.accent, typeScale: next.typeScale, radius: next.radius, dark: next.dark };
  for (const name of ['accent', 'typeScale', 'radius']) knob(name).value = values[name];
  knob('dark').checked = values.dark;root.dataset.theme = values.dark ? 'dark' : 'light';
  if (values.accent.toLowerCase() === initial.accent) root.style.removeProperty('--accent');else root.style.setProperty('--accent', values.accent);
  root.style.setProperty('--type-scale', values.typeScale);root.style.setProperty('--radius', values.radius + 'px');
 };
 panel.addEventListener('input', () => {
  if (!knob('typeScale').value || !knob('radius').value) return;
  const next = { accent: knob('accent').value, typeScale: Number(knob('typeScale').value), radius: Number(knob('radius').value), dark: knob('dark').checked };
  try { apply(next); } catch { return; }
  window.dispatchEvent(new CustomEvent('design:tweaks', { detail: { ...values } }));
 });
 window.designTheme = { capture: () => ({ ...values }), restore: async value => { apply(value); } };
 apply(values);
})();</script>`;
}

/** Entry used only by the fixed subprocess bootstrap; no project configs or source execute. */
export async function themePalette(directory: string, args) {
	const input = themeInput(args);
	const api = await import(pathToFileURL(path.join(directory, "node_modules/@astryxdesign/cli/api/index.mjs")).href);
	return api.generateTonalPalette({ families: [{ id: "accent", seed: input.accent, anchors: ["light", "dark"].map(mode => ({ mode, stop: 50, color: input.accent, policy: "exact" })) }, { id: "neutral", seed: input.neutral, kind: "neutral" }], stops: STOPS, modeStrategy: "light-and-dark" });
}

export async function runTheme(args, options: ThemeOptions = {}) {
	const input = themeInput(args);
	options.progress?.("Generating light/dark tokens with the pinned Astryx public API…");
	const { runtime, value } = await runAstryx("themePalette", input, options);
	return themeTokens(input, value, { version: runtime.versions["@astryxdesign/cli"], lockDigest: runtime.lockDigest });
}
