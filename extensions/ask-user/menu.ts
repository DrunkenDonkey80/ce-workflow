// ask_user's menu view (plan 0db155f7 D21): lists with filter, current item, Esc back, checklists and Tab.
// Under pi-control-hub the same `list` payload is drawn by the hub's form (listSubject/listDialogResponse).
import { ask as hubAsk, hubActive } from "../hub-channel.ts";
import type { RemoteListPrompt } from "./remote.ts";
import { randomUUID } from "node:crypto";
import { loadPlan3Ask } from "../plan3-ask.ts";

const dialogCursors = new Map();
export function listDialogResponse(payload: unknown, options) {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
	const value = payload as Record<string, unknown>;
	if (value.action === "tab") return options.tabAction ? { action: "tab" } : undefined;
	if (value.action === "back") {
		if (!options.multi) return null;
		const initial = new Set(options.multi.selected ?? []);
		const values = value.values ?? [...initial];
		if (!Array.isArray(values) || values.some(id => typeof id !== "string" || !options.items.some(item => item.value === id && !item.heading))) return;
		const selected = [...new Set(values)];
		if (options.multi.requireOne && !selected.length) return;
		if (options.items.some(item => item.disabled && selected.includes(item.value) !== initial.has(item.value))) return;
		return { action: "back", values: selected };
	}
	if (options.multi || !["select", "space", "row"].some(action => action === value.action)) return;
	const index = options.items.findIndex(item => item.value === value.value);
	const item = options.items[index];
	if (!item || item.heading || item.disabled || value.action === "space" && !options.spaceAction || value.action === "row" && (!options.rowAction || item.rowAction === false)) return;
	return { action: value.action, value: item.value, item, index };
}

function sentenceCase(value) {
	return String(value).replace(/^([a-z])/, (letter) => letter.toUpperCase());
}

function plainLabel(value) {
	const raw = String(value);
	const label = raw
		.replace(/\p{Extended_Pictographic}/gu, (symbol) =>
			symbol === "✔" ? symbol : "",
		)
		.replace(/[\uFE0F\u200D]/gu, "")
		.trimEnd();
	return /^\s*\p{Extended_Pictographic}/u.test(raw) ? label.trimStart() : label;
}

function itemLabel(item) {
	const raw = String(item.label);
	const label = plainLabel(raw);
	return item.preserveCase || !/^[a-z]/.test(raw) ? label : sentenceCase(label);
}

function labelFor(item) {
	const label = itemLabel(item);
	return item.description ? `${label} — ${item.description}` : label;
}

function itemIndicator(item, { checked, currentValue, multi }: { checked?: boolean; currentValue?: string; multi?: boolean } = {}) {
	if (multi) return checked ? "✓" : "○";
	if (item.value === currentValue) return "●";
	if (item.local) return "[local]";
	return "";
}

function indicatedLabel(item, options: any = {}) {
	return [itemIndicator(item, options), itemLabel(item)]
		.filter(Boolean)
		.join(" ");
}

function keyMatches(keybindings, data, id, ...fallbacks) {
	return Boolean(keybindings?.matches?.(data, id) || fallbacks.includes(data));
}

function stripAnsi(value) {
	return String(value).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function cellWidth(segment) {
	if (/\p{Emoji_Presentation}/u.test(segment) || /[\uFE0F\u200D]/u.test(segment))
		return 2;
	const code = segment.codePointAt(0) ?? 0;
	if (/^\p{Mark}+$/u.test(segment) || code < 32 || (code >= 0x7f && code < 0xa0))
		return 0;
	return (code >= 0x1100 && code <= 0x115f) ||
		(code >= 0x2e80 && code <= 0xa4cf) ||
		(code >= 0xac00 && code <= 0xd7a3) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xfe10 && code <= 0xfe6f) ||
		(code >= 0xff00 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6) ||
		(code >= 0x1b000 && code <= 0x1b2ff) ||
		(code >= 0x20000 && code <= 0x3fffd)
		? 2
		: 1;
}

function visibleWidth(value) {
	let width = 0;
	for (const { segment } of graphemes.segment(stripAnsi(value)))
		width += cellWidth(segment);
	return width;
}

function truncate(value, width) {
	const text = String(value ?? "");
	const safeWidth = Math.max(1, width);
	if (visibleWidth(text) <= safeWidth) return text;
	let result = "";
	let used = 0;
	for (const { segment } of graphemes.segment(stripAnsi(text))) {
		const next = cellWidth(segment);
		if (used + next > safeWidth - 1) break;
		result += segment;
		used += next;
	}
	return `${result}…`;
}

function wrapText(value, width, maxLines) {
	const words = stripAnsi(value).trim().split(/\s+/).filter(Boolean);
	const lines = [];
	let line = "";
	for (let index = 0; index < words.length; index += 1) {
		const candidate = line ? `${line} ${words[index]}` : words[index];
		if (visibleWidth(candidate) <= width) {
			line = candidate;
			continue;
		}
		if (line) lines.push(truncate(line, width));
		line = words[index];
		if (lines.length === maxLines - 1) {
			lines.push(truncate([line, ...words.slice(index + 1)].join(" "), width));
			return lines;
		}
	}
	if (line) lines.push(truncate(line, width));
	return lines;
}

/** Every character kept: lines break anywhere (a URL has no spaces), never truncated. */
export function hardWrap(value, width) {
	const lines = [];
	let line = "", used = 0;
	for (const { segment } of graphemes.segment(stripAnsi(value ?? "").replace(/\s+/g, " "))) {
		const next = cellWidth(segment);
		if (used + next > width && line) { lines.push(line); line = ""; used = 0; }
		line += segment;
		used += next;
	}
	if (line) lines.push(line);
	return lines;
}

function sectionLine(theme, title, width) {
	const label = `-- ${title} `;
	return theme.fg(
		"border",
		`${label}${"-".repeat(Math.max(0, width - visibleWidth(label)))}`,
	);
}

function initialIndex(items, { cursorKey, currentValue, selectedIndex = undefined }) {
	if (Number.isInteger(selectedIndex))
		return Math.max(0, Math.min(selectedIndex, items.length - 1));
	const currentIndex = items.findIndex((item) => item.value === currentValue);
	if (currentIndex >= 0) return currentIndex;
	const remembered = dialogCursors.get(cursorKey);
	const rememberedIndex = items.findIndex((item) => item.value === remembered);
	return Math.max(0, rememberedIndex);
}

async function nativeListDialog(ctx, options) {
	const { items, currentValue, multi, cursorKey, tabAction } = options;
	const title = options.detail ? `${options.title}
${options.detail}` : options.title;
	if (multi) {
		const enabled = new Set(multi.selected ?? []);
		for (;;) {
			if (options.signal?.aborted) return;
			const choices = items.map((item) => ({
				...item,
				label: indicatedLabel(item, {
					checked: enabled.has(item.value),
					multi: true,
				}),
				preserveCase: true,
			}));
			const labels = choices.map(labelFor);
			const selected = await ctx.ui.select(title, labels, { signal: options.signal });
			if (options.signal?.aborted) return;
			const index = labels.indexOf(selected);
			if (index < 0) {
				if (multi.requireOne && !enabled.size) {
					ctx.ui.notify?.("Select at least one option", "warning");
					continue;
				}
				return { action: "back", values: [...enabled] };
			}
			const item = choices[index];
			if (item.disabled === true) {
				ctx.ui.notify?.(
					item.disabledReason ?? item.description ?? "This option is unavailable.",
					"warning",
				);
				continue;
			}
			if (enabled.has(item.value)) enabled.delete(item.value);
			else enabled.add(item.value);
		}
	}
	const remembered = dialogCursors.get(cursorKey);
	const active = currentValue ?? remembered;
	const choices = [
		...items.filter((item) => item.value === active),
		...items.filter((item) => item.value !== active),
		...(tabAction
			? [{ value: "__dialog_tab__", label: tabAction.label, preserveCase: true }]
			: []),
	];
	const labels = choices.map((item) =>
		labelFor({
			...item,
			label: indicatedLabel(item, { currentValue: active }),
			preserveCase: true,
		}),
	);
	for (;;) {
		if (options.signal?.aborted) return;
		const selected = await ctx.ui.select(title, labels, { signal: options.signal });
		const index = labels.indexOf(selected);
		if (index < 0) return;
		if (choices[index].value === "__dialog_tab__") return { action: "tab" };
		if (choices[index].disabled === true) {
			ctx.ui.notify?.(
				choices[index].disabledReason ??
					choices[index].description ??
					"This option is unavailable.",
				"warning",
			);
			continue;
		}
		dialogCursors.set(cursorKey, choices[index].value);
		return {
			action: "select",
			value: choices[index].value,
			item: choices[index],
			index,
		};
	}
}

// Compact view (H3-07): a few actions and nothing else to say. One line when it fits; otherwise the text wraps above the actions.
function compactDialog(ctx, options) {
	const { title, purpose, items, currentValue, cursorKey } = options;
	const actions = items.filter(item => !item.heading);
	return ctx.ui.custom((tui, theme, keybindings, done) => {
		let index = Math.max(0, actions.findIndex(item => item.value === (currentValue ?? dialogCursors.get(cursorKey))));
		let finished = false;
		const close = result => {
			if (finished) return;
			finished = true;
			options.signal?.removeEventListener("abort", cancel);
			done(result);
		};
		const cancel = () => close(undefined);
		const choose = item => {
			if (item.disabled === true) {
				ctx.ui.notify?.(item.disabledReason ?? item.description ?? "This option is unavailable.", "warning");
				return;
			}
			dialogCursors.set(cursorKey, item.value);
			close({ action: "select", value: item.value, item, index: items.indexOf(item) });
		};
		const component = {
			render(width) {
				const safeWidth = Math.max(1, width - 2);
				const buttons = actions.map((item, row) => row === index
					? theme.fg("accent", theme.bold(`[ ${itemLabel(item)} ]`))
					: theme.fg(item.disabled === true ? "dim" : "text", `  ${itemLabel(item)}  `)).join(" ");
				const controls = `${buttons}  ${theme.fg("dim", "\u2190/\u2192 Enter \u00b7 Esc")}`;
				const text = `${title}${purpose ? ` ${purpose}` : ""}`;
				const line = `${theme.fg("accent", theme.bold(title))}${purpose ? ` ${theme.fg("text", purpose)}` : ""}  ${controls}`;
				if (visibleWidth(line) <= safeWidth) return [line];
				return [...wrapText(text, safeWidth, 6).map(part => theme.fg("text", part)), truncate(controls, safeWidth)];
			},
			handleInput(data) {
				if (keyMatches(keybindings, data, "tui.select.cancel", "escape", "\x1b")) return cancel();
				if (keyMatches(keybindings, data, "tui.select.confirm", "enter", "return", "\r", "\n")) return choose(actions[index]);
				if (keyMatches(keybindings, data, "tui.select.up", "up", "\x1b[A") || data === "\x1b[D") index = (index - 1 + actions.length) % actions.length;
				else if (keyMatches(keybindings, data, "tui.select.down", "down", "\x1b[B") || data === "\x1b[C" || data === "\t") index = (index + 1) % actions.length;
				else {
					// A letter picks the action it uniquely starts, e.g. y/n.
					const matches = data.length === 1 ? actions.filter(item => itemLabel(item).toLowerCase().startsWith(data.toLowerCase())) : [];
					if (matches.length === 1) choose(matches[0]);
					return;
				}
				tui.requestRender();
			},
			invalidate() {},
			dispose() { options.signal?.removeEventListener("abort", cancel); },
		};
		options.signal?.addEventListener("abort", cancel, { once: true });
		if (options.signal?.aborted) cancel();
		return component;
	});
}

/** Yes/No in the compact view; Esc or a closed prompt counts as No. */
export async function askConfirm(ctx, title: string, message?: string, options: { signal?: AbortSignal; terminalOnly?: boolean; cursorKey?: string } = {}) {
	const result = await showListDialog(ctx, {
		title, purpose: message, compact: true, filter: false, cursorKey: options.cursorKey ?? `confirm:${title}`,
		items: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
		signal: options.signal, terminalOnly: options.terminalOnly,
	});
	return result?.value === "yes";
}

export function progressBar(complete, total, width = 12) {
	const safeTotal = Math.max(0, Number(total) || 0);
	const safeComplete = Math.max(0, Math.min(safeTotal, Number(complete) || 0));
	const filled = safeTotal ? Math.round((safeComplete / safeTotal) * width) : 0;
	return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

/** The `list` payload the web form and the hub draw (RemoteListPrompt). */
export function listSubject(options): RemoteListPrompt {
	return {
		kind: "list", title: options.title, purpose: options.purpose ?? (options.multi ? "Choose one or more options." : "Choose an option to continue."),
		items: options.items.map(item => ({ value: item.value, label: item.label, description: item.description, heading: item.heading, disabled: item.disabled, enabled: item.enabled, rowAction: item.rowAction })),
		currentValue: options.currentValue, ...(options.multi ? { multi: { selected: [...(options.multi.selected ?? [])], requireOne: options.multi.requireOne } } : {}),
		spaceAction: Boolean(options.spaceAction), rowAction: Boolean(options.rowAction), tabAction: Boolean(options.tabAction),
		...(options.detail ? { detail: String(options.detail) } : {}),
		...(options.images?.length ? { images: options.images } : {}),
		...(options.compact ? { compact: true } : {}),
	};
}

// Open ce-workflow dialogs (every one goes through showListDialog or showAskDialog); self-update never reloads under one.
let dialogs = 0;
export const openDialogs = () => dialogs;
async function counted<T>(open: Promise<T>): Promise<T> { dialogs++; try { return await open; } finally { dialogs--; } }

export function showListDialog(ctx, options) { return counted(listDialog(ctx, options)); }
async function listDialog(ctx, options) {
	if (hubActive()) {
		// Under pi-control-hub there is no terminal: terminal-only approvals are refused, everything else is drawn by the hub (D21).
		if (options.terminalOnly || options.signal?.aborted) return;
		const result = listDialogResponse(await hubAsk(ctx.ui, "ask", listSubject(options), { signal: options.signal }), options);
		if (result?.value) dialogCursors.set(options.cursorKey ?? options.title, result.value);
		return result ?? undefined;
	}
	return localListDialog(ctx, options);
}
async function localListDialog(ctx, options) {
	if (options.signal?.aborted) return;
	const {
		title,
		items,
		currentValue,
		selectedIndex,
		cursorKey = title,
		filter = true,
		multi,
		subtitle,
		purpose: initialPurpose = multi
			? "Choose one or more options."
			: "Choose an option to continue.",
		help: initialHelp,
		descriptionMaxLines = 3,
		descriptionMinLines = 0,
		selectOnSpace = false,
		spaceAction = false,
		rowAction,
		tabAction,
		onInput,
		forceCustom = false,
		maxVisible = 10,
	} = options;
	const canUseCustom =
		typeof ctx.ui.custom === "function" &&
		(ctx.mode === "tui" || (forceCustom && !ctx.mode));
	if (ctx.ui.workDialogsNative === true || !canUseCustom)
		return nativeListDialog(ctx, { ...options, cursorKey });
	if (options.compact && !multi) return compactDialog(ctx, { ...options, cursorKey });
	const subtitleLines = (Array.isArray(subtitle) ? subtitle : [subtitle]).filter(
		Boolean,
	);

	return ctx.ui.custom((tui, theme, keybindings, done) => {
		const enabled = new Set(multi?.selected ?? []);
		let source = [...items];
		let purpose = initialPurpose;
		let help = initialHelp;
		let query = "";
		let visible = source.map((item, index) => ({ item, index }));
		let index = initialIndex(source, { cursorKey, currentValue, selectedIndex });

		const remember = () => {
			const selected = visible[index]?.item;
			if (selected) dialogCursors.set(cursorKey, selected.value);
		};
		const applyFilter = () => {
			const selectedValue = visible[index]?.item.value;
			const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
			const matches = source
				.map((item, sourceIndex) => ({ item, index: sourceIndex }))
				.filter(({ item }) => {
					const haystack =
						`${item.label} ${item.value} ${item.description ?? ""}`.toLowerCase();
					return terms.every((term) => haystack.includes(term));
				});
			const direct = matches.filter(({ item }) => {
				const haystack = `${item.label} ${item.value}`.toLowerCase();
				return terms.every((term) => haystack.includes(term));
			});
			visible = direct.length ? direct : matches;
			const retained = visible.findIndex(
				({ item }) => item.value === selectedValue,
			);
			index = retained >= 0 ? retained : 0;
			remember();
		};
		let finished = false;
		const close = (result) => {
			if (finished) return;
			finished = true;
			options.signal?.removeEventListener("abort", cancel);
			remember();
			done(result);
		};
		const cancel = () => close(undefined);
		const move = (delta) => {
			if (!visible.length) return;
			for (let attempts = 0; attempts < visible.length; attempts += 1) {
				index = (index + delta + visible.length) % visible.length;
				if (!visible[index].item.heading) break;
			}
		};
		const back = () => {
			if (multi?.requireOne && !enabled.size) {
				ctx.ui.notify?.("Select at least one option", "warning");
				return;
			}
			close(multi ? { action: "back", values: [...enabled] } : undefined);
		};

		const component = {
			render(width) {
				const safeWidth = Math.max(1, width - 2);
				const lines = [];
				const add = (line = "") => lines.push(truncate(line, safeWidth));
				add(
					`${theme.fg("accent", theme.bold(title))}  ${theme.fg(
						"dim",
						`${visible.length}/${source.length}${multi ? ` · ${enabled.size} selected` : ""}`,
					)}`,
				);
				add(theme.fg("text", purpose));
				for (const line of hardWrap(options.detail, safeWidth)) lines.push(theme.fg("accent", line));
				let defaultHelp = "Up/Down to navigate · Enter to select · Esc to cancel";
				if (multi)
					defaultHelp =
						"Up/Down to navigate · Enter/Space to toggle · Esc to save and go back";
				if (filter) defaultHelp = `Type to filter · ${defaultHelp}`;
				add(theme.fg("dim", help ?? defaultHelp));
				for (const line of subtitleLines) add(theme.fg("dim", line));
				if (filter)
					add(`${theme.fg("muted", "Filter:")} ${theme.fg("text", query)}`);
				add(sectionLine(theme, multi ? "Checklist" : "Options", safeWidth));

				const count = Math.max(1, Math.min(maxVisible, visible.length || 1));
				const start = Math.max(
					0,
					Math.min(index - Math.floor(count / 2), visible.length - count),
				);
				if (!visible.length) add(theme.fg("warning", "  No matches"));
				for (let row = start; row < start + count && visible[row]; row += 1) {
					const item = visible[row].item;
					if (item.heading) {
						add(theme.fg(item.color ?? "accent", theme.bold(itemLabel(item))));
						continue;
					}
					const selected = row === index;
					const state = {
						checked: enabled.has(item.value),
						currentValue,
						multi: Boolean(multi),
					};
					let color = item.color ?? "text";
					if (item.disabled === true) color = "dim";
					else if (selected && !item.color) color = "accent";
					else if (multi) color = enabled.has(item.value) ? "success" : "dim";
					else if (item.enabled === true) color = "success";
					else if (item.enabled === false) color = "dim";
					else if (item.value === currentValue) color = "success";
					const indicator = itemIndicator(item, state);
					const prefix = `${selected ? ">" : " "} ${indicator ? `${indicator} ` : ""}`;
					let label;
					if (item.labelSegments)
						label = item.labelSegments
							.map((segment) => {
								const text = theme.fg(segment.color ?? color, plainLabel(segment.text));
								return segment.bold ? theme.bold(text) : text;
							})
							.join("");
					else label = theme.fg(color, itemLabel(item));
					add(`${theme.fg(color, prefix)}${label}`);
					for (const detail of item.detailLines ?? [])
						for (const line of wrapText(detail, Math.max(1, safeWidth - 4), 2))
							add(`    ${theme.fg(item.detailColor ?? "muted", line)}`);
				}

				const selected = visible[index]?.item;
				const detailRows = Math.max(
					descriptionMinLines,
					selected?.description ? descriptionMaxLines : 0,
				);
				if (detailRows) {
					add(sectionLine(theme, "Details", safeWidth));
					const details = wrapText(
						selected?.description ?? "No description.",
						safeWidth,
						detailRows,
					);
					for (const line of details) add(theme.fg("muted", line));
				}

				add(theme.fg("border", "─".repeat(safeWidth)));
				return lines;
			},
			handleInput(data) {
				const selected = visible[index];
				if (keyMatches(keybindings, data, "tui.select.up", "up", "\x1b[A")) {
					move(-1);
				} else if (
					keyMatches(keybindings, data, "tui.select.down", "down", "\x1b[B")
				) {
					move(1);
				} else if (
					tabAction &&
					keyMatches(keybindings, data, "tui.input.tab", "tab", "\t")
				) {
					const next = tabAction.toggle?.();
					if (!next) return close({ action: "tab" });
					source = [...next.items];
					purpose = next.purpose ?? purpose;
					help = next.help ?? help;
					query = "";
					visible = source.map((item, sourceIndex) => ({
						item,
						index: sourceIndex,
					}));
					index = initialIndex(source, { cursorKey, currentValue });
				} else if (
					keyMatches(keybindings, data, "tui.select.cancel", "escape", "\x1b")
				) {
					if (filter && query) {
						query = "";
						applyFilter();
					} else return back();
				} else if (spaceAction && data === " ") {
					const item = visible[index]?.item;
					if (!item || item.heading || item.disabled === true) return;
					return close({
						action: "space",
						value: item.value,
						item,
						index: visible[index].index,
					});
				} else if (rowAction && data === rowAction.key) {
					const item = visible[index]?.item;
					if (
						!item ||
						item.heading ||
						item.disabled === true ||
						item.rowAction === false
					)
						return;
					return close({
						action: "row",
						value: item.value,
						item,
						index: visible[index].index,
					});
				} else if (
					keyMatches(
						keybindings,
						data,
						"tui.select.confirm",
						"enter",
						"return",
						"\r",
						"\n",
					) ||
					((multi || selectOnSpace) && data === " ")
				) {
					const item = visible[index]?.item;
					if (!item || item.heading) return;
					if (item.disabled === true) {
						ctx.ui.notify?.(
							item.disabledReason ?? item.description ?? "This option is unavailable.",
							"warning",
						);
						return;
					}
					if (multi) {
						if (enabled.has(item.value)) enabled.delete(item.value);
						else enabled.add(item.value);
					} else {
						return close({
							action: "select",
							value: item.value,
							item,
							index: visible[index].index,
						});
					}
				} else if (
					filter &&
					keyMatches(
						keybindings,
						data,
						"tui.editor.deleteCharBackward",
						"backspace",
						"\b",
						"\x7f",
					)
				) {
					if (query) {
						query = [...query].slice(0, -1).join("");
						applyFilter();
					} else return back();
				} else if (
					filter &&
					keyMatches(keybindings, data, "tui.editor.deleteToLineStart", "ctrl+u")
				) {
					query = "";
					applyFilter();
				} else {
					const special = onInput?.({
						data,
						keybindings,
						item: selected?.item,
						index: selected?.index ?? index,
						query,
					});
					if (special) return close(special);
					if (!filter) return;
					const text = data.replace(/^\x1b\[200~/, "").replace(/\x1b\[201~$/, "");
					if (!text || /[\x00-\x1f\x7f]/u.test(text)) return;
					query += text;
					applyFilter();
				}
				remember();
				tui.requestRender();
			},
			invalidate() {},
			dispose() { options.signal?.removeEventListener("abort", cancel); },
		};
		options.signal?.addEventListener("abort", cancel, { once: true });
		if (options.signal?.aborted) cancel();
		return component;
	});
}

export function resetDialogStateForTest() {
	dialogCursors.clear();
}

// Reuse ask_user's scrollable editor for Plan3 decisions rather than a second UI.
export function showAskDialog(ctx, ask, params, signal?: AbortSignal, ideaLayout = false) {
	let askContext = ctx;
	if (ideaLayout && typeof ctx.ui.custom === "function") {
		askContext = { ...ctx, ui: { ...ctx.ui, custom: (factory, options) => ctx.ui.custom((tui, ...args) => {
			const component = factory(tui, ...args);
			// ponytail: pi-ask-user 0.16 has no layout options; use native options when added.
			if (typeof component.buildFullContextLines !== "function" || typeof component.getOverlayMaxRenderLines !== "function") throw new Error("The installed ask_user does not support compact Plan3 idea popups.");
			const contextLines = component.buildFullContextLines.bind(component);
			component.buildFullContextLines = width => {
				const lines = contextLines(width).slice();
				if (stripAnsi(lines[0] ?? "").trim() === "Context:") {
					lines.shift();
					while (lines.length && !stripAnsi(lines[0]).trim()) lines.shift();
				}
				return lines;
			};
			component.getOverlayMaxRenderLines = () => Math.max(1, (Number.isFinite(tui.terminal.rows) ? Math.floor(tui.terminal.rows) : 24) - 2);
			return component;
		}, { ...options, overlayOptions: { ...options?.overlayOptions, width: "98%", maxHeight: "100%", margin: 1 } }) } };
	}
	return counted<any>(ask.execute(randomUUID(), { allowComment: true, ...params, displayMode: "overlay" }, signal, undefined, askContext));
}

/** Free-text prompt through ask_user (terminal, web share and hub alike); undefined when cancelled.
 * Without a loaded ask_user (minimal installs, unit fakes) it falls back to Pi's own editor/input. */
export async function askText(ctx, pi, title: string, { initialText = "", placeholder = "", multiline = false } = {}) {
	if (!pi?.getAllTools?.().some(tool => tool.name === "ask_user"))
		return multiline && typeof ctx.ui.editor === "function" ? ctx.ui.editor(title, initialText) : ctx.ui.input?.(title, placeholder || initialText);
	const result = await showAskDialog(ctx, await loadPlan3Ask(pi), { question: title, ...(placeholder ? { context: placeholder } : {}), ...(initialText ? { initialText } : {}), allowFreeform: true, allowComment: false });
	const response = result.details?.response;
	if (result.details?.cancelled || response?.kind !== "freeform" || typeof response.text !== "string") return;
	return response.text;
}
