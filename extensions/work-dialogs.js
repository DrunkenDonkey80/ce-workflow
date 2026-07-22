const dialogCursors = new Map();

function sentenceCase(value) {
	return String(value).replace(/^([a-z])/, (letter) => letter.toUpperCase());
}

function itemLabel(item) {
	return item.preserveCase ? String(item.label) : sentenceCase(item.label);
}

function labelFor(item) {
	const label = itemLabel(item);
	return item.description ? `${label} — ${item.description}` : label;
}

function checkLabel(item, enabled) {
	return `${enabled ? "✓ on" : "○ off"} ${itemLabel(item)}`;
}

function keyMatches(keybindings, data, id, ...fallbacks) {
	return Boolean(keybindings?.matches?.(data, id) || fallbacks.includes(data));
}

function stripAnsi(value) {
	return String(value).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function fit(value, width) {
	const text = String(value);
	const visible = stripAnsi(text).length;
	if (visible <= width) return `${text}${" ".repeat(width - visible)}`;
	const plain = stripAnsi(text);
	return width > 1 ? `${plain.slice(0, width - 1)}…` : plain.slice(0, width);
}

function frame(theme, title, content, width) {
	const inner = Math.max(8, width - 2);
	const border = (text) => theme.fg("border", text);
	const row = (text = "") =>
		`${border("│")}${fit(` ${text}`, inner)}${border("│")}`;
	return [
		border(`╭${"─".repeat(inner)}╮`),
		row(theme.fg("accent", theme.bold(title))),
		...content.map(row),
		border(`╰${"─".repeat(inner)}╯`),
	];
}

function initialIndex(items, { cursorKey, currentValue, selectedIndex }) {
	if (Number.isInteger(selectedIndex))
		return Math.max(0, Math.min(selectedIndex, items.length - 1));
	const currentIndex = items.findIndex((item) => item.value === currentValue);
	if (currentIndex >= 0) return currentIndex;
	const remembered = dialogCursors.get(cursorKey);
	const rememberedIndex = items.findIndex((item) => item.value === remembered);
	return Math.max(0, rememberedIndex);
}

async function nativeListDialog(ctx, options) {
	const { title, items, currentValue, multi, cursorKey } = options;
	if (multi) {
		const enabled = new Set(multi.selected ?? []);
		for (;;) {
			const choices = items.map((item) => ({
				...item,
				label: checkLabel(item, enabled.has(item.value)),
				preserveCase: true,
			}));
			const labels = choices.map(labelFor);
			const selected = await ctx.ui.select(title, labels);
			const index = labels.indexOf(selected);
			if (index < 0) {
				if (multi.requireOne && !enabled.size) {
					ctx.ui.notify?.("Select at least one option", "warning");
					continue;
				}
				return { action: "back", values: [...enabled] };
			}
			const item = choices[index];
			if (enabled.has(item.value)) enabled.delete(item.value);
			else enabled.add(item.value);
		}
	}
	const remembered = dialogCursors.get(cursorKey);
	const active = currentValue ?? remembered;
	const choices = [
		...items.filter((item) => item.value === active),
		...items.filter((item) => item.value !== active),
	];
	const labels = choices.map(labelFor);
	const selected = await ctx.ui.select(title, labels);
	const index = labels.indexOf(selected);
	if (index < 0) return;
	dialogCursors.set(cursorKey, choices[index].value);
	return {
		action: "select",
		value: choices[index].value,
		item: choices[index],
		index,
	};
}

export async function showListDialog(ctx, options) {
	const {
		title,
		items,
		currentValue,
		selectedIndex,
		cursorKey = title,
		filter = true,
		multi,
		subtitle,
		purpose = multi
			? "Choose one or more options."
			: "Choose an option to continue.",
		help,
		selectOnSpace = false,
		onInput,
		forceCustom = false,
	} = options;
	if (
		ctx.ui.workDialogsNative === true ||
		(ctx.mode !== "tui" &&
			!(forceCustom && !ctx.mode && typeof ctx.ui.custom === "function"))
	)
		return nativeListDialog(ctx, { ...options, cursorKey });
	if (typeof ctx.ui.custom !== "function")
		return nativeListDialog(ctx, { ...options, cursorKey });

	return ctx.ui.custom(
		(tui, theme, keybindings, done) => {
			const enabled = new Set(multi?.selected ?? []);
			const source = [...items];
			let query = "";
			let visible = source.map((item, index) => ({ item, index }));
			let index = initialIndex(source, {
				cursorKey,
				currentValue,
				selectedIndex,
			});

			const remember = () => {
				const selected = visible[index]?.item;
				if (selected) dialogCursors.set(cursorKey, selected.value);
			};
			const applyFilter = () => {
				const selectedValue = visible[index]?.item.value;
				const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
				visible = source
					.map((item, sourceIndex) => ({ item, index: sourceIndex }))
					.filter(({ item }) => {
						const haystack =
							`${item.label} ${item.value} ${item.description ?? ""}`.toLowerCase();
						return terms.every((term) => haystack.includes(term));
					});
				const retained = visible.findIndex(
					({ item }) => item.value === selectedValue,
				);
				index = Math.max(0, retained);
				remember();
			};
			const close = (result) => {
				remember();
				done(result);
			};
			const back = () => {
				if (multi?.requireOne && !enabled.size) {
					ctx.ui.notify?.("Select at least one option", "warning");
					return;
				}
				return close(
					multi ? { action: "back", values: [...enabled] } : undefined,
				);
			};

			const component = {
				focused: false,
				render(width) {
					const content = [theme.fg("muted", purpose), ""];
					if (subtitle) content.push(theme.fg("dim", subtitle), "");
					if (filter) {
						const cursor = component.focused ? "▌" : "";
						content.push(
							fit(`Filter: ${query}${cursor}`, Math.max(1, width - 4)),
							"",
						);
					}
					if (!visible.length) content.push(theme.fg("warning", "No matches"));
					else {
						const count = Math.min(
							visible.length,
							source.some((item) => item.inlineDescription) ? 6 : 12,
						);
						const start = Math.max(
							0,
							Math.min(index - Math.floor(count / 2), visible.length - count),
						);
						for (let row = start; row < start + count; row += 1) {
							const item = visible[row].item;
							const marker = row === index ? "> " : "  ";
							const current = item.value === currentValue ? " (current)" : "";
							const local = item.local ? "* " : "  ";
							const label = multi
								? checkLabel(item, enabled.has(item.value))
								: itemLabel(item);
							const text = `${marker}${local}${label}${current}`;
							let color = item.color ?? "text";
							if (row === index && !item.color) color = "accent";
							else if (multi)
								color = enabled.has(item.value) ? "success" : "dim";
							else if (item.enabled === true) color = "success";
							else if (item.enabled === false) color = "dim";
							else if (item.value === currentValue) color = "success";
							content.push(theme.fg(color, text));
							if (item.inlineDescription)
								content.push(
									theme.fg(
										"muted",
										`${item.descriptionPrefix ?? "   "}${item.description ?? "No short description yet."}`,
									),
								);
						}
						if (visible.length > count)
							content.push(theme.fg("dim", `${index + 1}/${visible.length}`));
						const selected = visible[index]?.item;
						if (selected?.description && !selected.inlineDescription)
							content.push(
								"",
								...String(selected.description)
									.split("\n")
									.map((line) => theme.fg("muted", line)),
							);
					}
					let defaultHelp = "↑↓ navigate · Enter select · Esc/Backspace back";
					if (multi)
						defaultHelp =
							"↑↓ navigate · Enter/Space toggle · Esc/Backspace save and go back";
					if (filter) defaultHelp = `Type to filter · ${defaultHelp}`;
					content.push("", theme.fg("dim", help ?? defaultHelp));
					return frame(theme, title, content, width);
				},
				handleInput(data) {
					const selected = visible[index];
					if (keyMatches(keybindings, data, "tui.select.up", "up", "\x1b[A")) {
						if (visible.length)
							index = (index - 1 + visible.length) % visible.length;
					} else if (
						keyMatches(keybindings, data, "tui.select.down", "down", "\x1b[B")
					) {
						if (visible.length) index = (index + 1) % visible.length;
					} else if (
						keyMatches(keybindings, data, "tui.select.cancel", "escape", "\x1b")
					) {
						if (filter && query) {
							query = "";
							applyFilter();
						} else return back();
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
						if (!item) return;
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
						keyMatches(
							keybindings,
							data,
							"tui.editor.deleteToLineStart",
							"ctrl+u",
						)
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
						const text = data
							.replace(/^\x1b\[200~/, "")
							.replace(/\x1b\[201~$/, "");
						if (!text || /[\x00-\x1f\x7f]/u.test(text)) return;
						query += text;
						applyFilter();
					}
					remember();
					tui.requestRender();
				},
				invalidate() {},
			};
			return component;
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "70%",
				minWidth: 54,
				maxHeight: "85%",
				margin: 1,
			},
		},
	);
}

export function resetDialogStateForTest() {
	dialogCursors.clear();
}
