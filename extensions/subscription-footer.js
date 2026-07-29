const MIN_WIDTH = 56;
const FULL_WIDTH = 80;
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function codePointWidth(codePoint) {
	if (
		codePoint === 0 ||
		(codePoint >= 0x300 && codePoint <= 0x36f) ||
		(codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
		(codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
		(codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
		(codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
		(codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
	)
		return 0;
	return codePoint >= 0x1100 &&
		(codePoint <= 0x115f ||
			codePoint === 0x2329 ||
			codePoint === 0x232a ||
			(codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
			(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
			(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
			(codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
			(codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
			(codePoint >= 0xff00 && codePoint <= 0xff60) ||
			(codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
			(codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
			(codePoint >= 0x20000 && codePoint <= 0x3fffd))
		? 2
		: 1;
}

function graphemeWidth(value) {
	let width = 0;
	for (const character of value) width = Math.max(width, codePointWidth(character.codePointAt(0)));
	return width;
}

export function stripAnsi(value) {
	return String(value ?? "").replace(ANSI_PATTERN, "");
}

export function visibleWidth(value) {
	let width = 0;
	for (const { segment } of segmenter.segment(stripAnsi(value))) width += graphemeWidth(segment);
	return width;
}

export function truncatePlain(value, maxWidth, suffix = "…") {
	const plain = String(value ?? "").replace(/[\r\n\t\x00-\x1f\x7f]/g, " ");
	if (visibleWidth(plain) <= maxWidth) return plain;
	const suffixWidth = visibleWidth(suffix);
	if (maxWidth <= suffixWidth) return "";
	let output = "";
	let width = 0;
	for (const { segment } of segmenter.segment(plain)) {
		const next = graphemeWidth(segment);
		if (width + next + suffixWidth > maxWidth) break;
		output += segment;
		width += next;
	}
	return output + suffix;
}

function formatTokens(count) {
	const value = Math.max(0, Number(count) || 0);
	if (value < 1000) return String(Math.round(value));
	if (value < 10000) return `${(value / 1000).toFixed(1)}k`;
	if (value < 1000000) return `${Math.round(value / 1000)}k`;
	return value < 10000000
		? `${(value / 1000000).toFixed(1)}M`
		: `${Math.round(value / 1000000)}M`;
}

function contextValues(ctx) {
	const usage = ctx.getContextUsage?.() ?? {};
	const used = Math.max(0, Number(usage.tokens) || 0);
	const total = Math.max(
		0,
		Number(usage.contextWindow ?? usage.maxTokens ?? ctx.model?.contextWindow) || 0,
	);
	const rawPercent = usage.percent;
	const percent = Number.isFinite(rawPercent)
		? Math.max(0, Math.min(100, Math.round(rawPercent)))
		: total
			? Math.max(0, Math.min(100, Math.round((used / total) * 100)))
			: 0;
	return { used, total, percent };
}

function pressureColor(used) {
	if (used > 200000) return "error";
	if (used > 150000) return "warning";
	return "success";
}

function contextBar(percent, cells) {
	const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * cells);
	return `${"█".repeat(filled)}${"░".repeat(cells - filled)}`;
}

export function renderModelRow(ctx, theme, width, thinkingLevel) {
	if (width < MIN_WIDTH) {
		const diagnostic = truncatePlain("Subscription footer needs at least 56 columns", width);
		return [theme?.fg?.("warning", diagnostic) ?? diagnostic];
	}
	const { used, total, percent } = contextValues(ctx);
	const full = width >= FULL_WIDTH;
	const barCells = full ? 12 : Math.max(4, Math.min(10, width - 52));
	const effort = String(thinkingLevel ?? ctx.thinkingLevel ?? "off");
	const model = String(ctx.model?.name ?? ctx.model?.id ?? "no model");
	const bar = contextBar(percent, barCells);
	const suffix = full
		? ` · Effort: ${effort} · Context [${bar}] ${percent}% ${formatTokens(used)}/${formatTokens(total)} · F8 Compact`
		: ` · ${effort} · [${bar}] ${percent}% ${formatTokens(used)}/${formatTokens(total)} · F8 Compact`;
	const prefix = full ? "Model: " : "";
	const modelWidth = Math.max(1, width - visibleWidth(prefix) - visibleWidth(suffix));
	const plainModel = truncatePlain(model, modelWidth);
	const color = pressureColor(used);
	const styledBar = theme?.fg?.(color, bar) ?? bar;
	return [`${prefix}${plainModel}${suffix.replace(bar, styledBar)}`];
}

export function createSubscriptionFooterController(
	pi,
	{ readGlobalSettings, providers = [] } = {},
) {
	let generation = 0;
	let activeCtx;
	let installed = false;
	const registry = [...providers];
	const setting = () =>
		readGlobalSettings?.().workOrchestrator?.subscriptionFooter ?? {};

	function stop({ restore = true, notify = false } = {}) {
		generation++;
		const ctx = activeCtx;
		activeCtx = undefined;
		if (installed && restore) ctx?.ui?.setFooter?.(undefined);
		installed = false;
		if (notify)
			ctx?.ui?.notify?.(
				"Subscription footer disabled; Pi's built-in footer is restored. Use /reload for another footer extension to reclaim ownership.",
				"info",
			);
	}

	function install(ctx) {
		if (ctx?.mode !== "tui" || ctx.hasUI === false || !setting().enabled) return false;
		stop({ restore: false });
		activeCtx = ctx;
		installed = true;
		const currentGeneration = generation;
		ctx.ui.setFooter((tui, theme) => ({
			invalidate() {},
			render(width) {
				return renderModelRow(ctx, theme, width, pi?.getThinkingLevel?.());
			},
			dispose() {
				if (currentGeneration === generation) stop({ restore: false });
				tui?.requestRender?.();
			},
		}));
		return true;
	}

	return {
		start: install,
		apply(ctx) {
			if (activeCtx && activeCtx !== ctx) return false;
			if (setting().enabled) return install(ctx);
			if (activeCtx === ctx) stop({ notify: true });
			return false;
		},
		shutdown(ctx) {
			if (activeCtx === ctx) stop();
		},
		providers: registry,
		isInstalled: () => installed,
	};
}

export const SUBSCRIPTION_FOOTER_DEFAULTS = Object.freeze({
	enabled: false,
	incidents: false,
	ownershipNoticeAcknowledged: false,
});
