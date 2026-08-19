const dialogCursors = new Map();

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

function itemIndicator(item, { checked, currentValue, multi } = {}) {
	if (multi) return checked ? "✓" : "○";
	if (item.value === currentValue) return "●";
	if (item.local) return "[local]";
	return "";
}

function indicatedLabel(item, options = {}) {
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

function sectionLine(theme, title, width) {
	const label = `-- ${title} `;
	return theme.fg(
		"border",
		`${label}${"-".repeat(Math.max(0, width - visibleWidth(label)))}`,
	);
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
	const { title, items, currentValue, multi, cursorKey, tabAction } = options;
	if (multi) {
		const enabled = new Set(multi.selected ?? []);
		for (;;) {
			const choices = items.map((item) => ({
				...item,
				label: indicatedLabel(item, {
					checked: enabled.has(item.value),
					multi: true,
				}),
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
	const selected = await ctx.ui.select(title, labels);
	const index = labels.indexOf(selected);
	if (index < 0) return;
	if (choices[index].value === "__dialog_tab__") return { action: "tab" };
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
		purpose: initialPurpose = multi
			? "Choose one or more options."
			: "Choose an option to continue.",
		help: initialHelp,
		descriptionMaxLines = 3,
		descriptionMinLines = 0,
		selectOnSpace = false,
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
			index = retained >= 0 ? retained : 0;
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
					const selected = row === index;
					const state = {
						checked: enabled.has(item.value),
						currentValue,
						multi: Boolean(multi),
					};
					let color = item.color ?? "text";
					if (selected && !item.color) color = "accent";
					else if (multi) color = enabled.has(item.value) ? "success" : "dim";
					else if (item.enabled === true) color = "success";
					else if (item.enabled === false) color = "dim";
					else if (item.value === currentValue) color = "success";
					const indicator = itemIndicator(item, state);
					const prefix = `${selected ? ">" : " "} ${indicator ? `${indicator} ` : ""}`;
					const label = item.labelSegments
						? item.labelSegments
								.map((segment) =>
									theme.fg(segment.color ?? color, plainLabel(segment.text)),
								)
								.join("")
						: theme.fg(color, itemLabel(item));
					add(`${theme.fg(color, prefix)}${label}`);
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
					if (visible.length) index = (index - 1 + visible.length) % visible.length;
				} else if (
					keyMatches(keybindings, data, "tui.select.down", "down", "\x1b[B")
				) {
					if (visible.length) index = (index + 1) % visible.length;
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
		};
		return component;
	});
}

function treeVisualStatus(row) {
	return row.aggregateStatus ?? row.status;
}

function treeStatusColor(row) {
	const status = treeVisualStatus(row);
	if (row.attention || ["blocked", "paused", "needs_attention"].includes(status))
		return "warning";
	if (row.live || row.engaged || status === "in_progress") return "success";
	if (status === "closed") return "dim";
	return "text";
}

function treeActivityLabel(row) {
	const status = treeVisualStatus(row);
	if (row.attention) return "attention";
	if (row.exactLive) return "running";
	if (row.live) return "running child";
	if (status === "in_progress") return "active";
	if (row.engaged) return "active child";
	return "";
}

function treeStatusLabel(row) {
	const activity = treeActivityLabel(row);
	if (activity) return `[${activity}]`;
	return treeVisualStatus(row) === "closed" ? "[done]" : "[open]";
}

export async function showTreeWorkspaceDialog(ctx, options) {
	const {
		title,
		purpose = "Choose a work item to continue.",
		frame: initialFrame,
		refresh,
		refreshIntervalMs = 1000,
		setIntervalFn = setInterval,
		clearIntervalFn = clearInterval,
		cleanup,
		cursorKey = title,
		filter = true,
		resolveStats,
		maxVisible = 12,
	} = options;
	const rootsFor = (frame) => {
		const roadmaps = frame?.roadmaps ?? [];
		const seen = new Set();
		const remember = (row) => {
			if (seen.has(row.id)) throw new Error(`Duplicate work item ID: ${row.id}`);
			seen.add(row.id);
		};
		const byParent = new Map();
		for (const row of roadmaps) {
			const parent = row.parentId ?? "";
			if (!byParent.has(parent)) byParent.set(parent, []);
			byParent.get(parent).push(row);
		}
		const appendTasks = (rows, task, depth) => {
			remember(task);
			rows.push({ ...task, depth, container: Boolean(task.children?.length) });
			for (const child of task.children ?? []) appendTasks(rows, child, depth + 1);
		};
		const appendRoadmaps = (rows, parent = "", depth = 0) => {
			for (const roadmap of byParent.get(parent) ?? []) {
				remember(roadmap);
				rows.push({
					...roadmap,
					depth,
					container: Boolean(
						roadmap.tasks?.length || byParent.get(roadmap.id)?.length,
					),
				});
				for (const task of roadmap.tasks ?? []) appendTasks(rows, task, depth + 1);
				appendRoadmaps(rows, roadmap.id, depth + 1);
			}
		};
		const rows = [];
		appendRoadmaps(rows);
		return rows;
	};
	const nativeRows = rootsFor(initialFrame).map((row) => {
		const label = row.title ?? row.label;
		return {
			value: row.id,
			label: `${"  ".repeat(row.depth)}${row.id}${label ? ` ${label}` : ""}`,
			description: row.description,
			preserveCase: true,
		};
	});
	if (
		ctx.ui.workDialogsNative === true ||
		ctx.mode !== "tui" ||
		typeof ctx.ui.custom !== "function"
	) {
		try {
			return await nativeListDialog(ctx, {
				...options,
				items: nativeRows,
				cursorKey,
			});
		} finally {
			cleanup?.();
		}
	}

	return ctx.ui.custom((tui, theme, keybindings, done) => {
		let frame = initialFrame;
		let rows = rootsFor(frame);
		let query = "";
		let visible = [];
		const expansion = new Map();
		let selectedId =
			frame?.selectedId ?? dialogCursors.get(cursorKey) ?? rows[0]?.id;
		let closed = false;
		let timer;
		const statsById = new Map();

		const expanded = (row) =>
			expansion.has(row.id)
				? expansion.get(row.id)
				: treeVisualStatus(row) !== "closed";
		const rebuild = () => {
			const hiddenDepths = [];
			const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
			visible = rows.filter((row) => {
				while (
					hiddenDepths.length &&
					hiddenDepths[hiddenDepths.length - 1] >= row.depth
				)
					hiddenDepths.pop();
				const hidden = hiddenDepths.length > 0;
				if (row.container && !expanded(row)) hiddenDepths.push(row.depth);
				const haystack =
					`${row.title ?? row.label ?? ""} ${row.id} ${row.description ?? ""}`.toLowerCase();
				return (
					(!hidden || terms.length > 0) &&
					terms.every((term) => haystack.includes(term))
				);
			});
			if (!visible.some((row) => row.id === selectedId))
				selectedId = visible[0]?.id;
		};
		const finish = (result) => {
			if (closed) return;
			closed = true;
			if (timer !== undefined) clearIntervalFn(timer);
			cleanup?.();
			if (selectedId) dialogCursors.set(cursorKey, selectedId);
			done(result);
		};
		const poll = async () => {
			try {
				const next = await refresh?.();
				if (!next?.ok || next.signature === frame?.signature) return;
				const nextRows = rootsFor(next);
				frame = next;
				rows = nextRows;
				rebuild();
				tui.requestRender();
			} catch {
				// Projection errors deliberately retain the last good frame.
			}
		};
		const showStats = (id) => {
			if (!id || statsById.has(id)) return;
			try {
				statsById.set(id, resolveStats?.(id) ?? ["Stats:", "- unknown"]);
			} catch {
				statsById.set(id, ["Stats:", "- unknown"]);
			}
		};
		rebuild();
		if (refresh) timer = setIntervalFn(poll, refreshIntervalMs);

		return {
			render(width) {
				const safeWidth = Math.max(1, width - 2);
				const selected = visible.find((row) => row.id === selectedId);
				const lines = [];
				const add = (line = "") => lines.push(truncate(line, safeWidth));
				add(
					`${theme.fg("accent", theme.bold(title))}  ${theme.fg("dim", `${visible.length}/${rows.length}`)}`,
				);
				add(theme.fg("text", purpose));
				add(
					theme.fg(
						"dim",
						`${filter ? "Type to filter · " : ""}S to show stats · Up/Down to navigate · Space/Left/Right to expand · Enter to select · Esc to cancel`,
					),
				);
				if (filter)
					add(`${theme.fg("muted", "Filter:")} ${theme.fg("text", query)}`);
				add(sectionLine(theme, "Work items", safeWidth));

				const index = Math.max(
					0,
					visible.findIndex((row) => row.id === selectedId),
				);
				const count = Math.max(1, Math.min(maxVisible, visible.length || 1));
				const start = Math.max(
					0,
					Math.min(index - Math.floor(count / 2), visible.length - count),
				);
				if (!visible.length) add(theme.fg("warning", "  No matches"));
				for (let at = start; at < start + count && visible[at]; at += 1) {
					const row = visible[at];
					const marker = row.container ? (expanded(row) ? "[-]" : "[+]") : "   ";
					const progress =
						row.role || row.tasks
							? `${row.progress?.completed ?? 0}/${row.progress?.total ?? 0} `
							: "";
					const rowTitle = plainLabel(
						row.shortTitle ?? row.title ?? row.label ?? "",
					);
					const text = `${row.id}${rowTitle ? ` ${rowTitle}` : ""}`;
					const prefix = `${row.id === selectedId ? ">" : " "} ${"  ".repeat(row.depth)}${marker}`;
					add(
						theme.fg(
							row.id === selectedId ? "accent" : treeStatusColor(row),
							`${prefix} ${treeStatusLabel(row)} ${progress}${text}`,
						),
					);
				}

				add(sectionLine(theme, "Details", safeWidth));
				for (const line of wrapText(
					selected?.description || "No description.",
					safeWidth,
					4,
				))
					add(theme.fg("muted", line));
				const stats = statsById.get(selected?.id);
				if (stats) {
					add(sectionLine(theme, "Stats", safeWidth));
					for (const line of stats.slice(0, 10)) add(theme.fg("muted", line));
				}
				add(theme.fg("border", "─".repeat(safeWidth)));
				return lines;
			},
			handleInput(data) {
				const index = Math.max(
					0,
					visible.findIndex((row) => row.id === selectedId),
				);
				const row = visible[index];
				if (data.toLowerCase?.() === "s") {
					showStats(row?.id);
				} else if (
					keyMatches(
						keybindings,
						data,
						"tui.editor.cursorLeft",
						"left",
						"\x1b[D",
						"\x1bOD",
					)
				) {
					let parent = row?.container && expanded(row) ? row : undefined;
					for (let at = index - 1; !parent && at >= 0; at -= 1) {
						const candidate = visible[at];
						if (
							candidate.depth < (row?.depth ?? 0) &&
							candidate.container &&
							expanded(candidate)
						)
							parent = candidate;
					}
					if (parent) {
						selectedId = parent.id;
						expansion.set(parent.id, false);
						rebuild();
					}
				} else if (
					keyMatches(
						keybindings,
						data,
						"tui.editor.cursorRight",
						"right",
						"\x1b[C",
						"\x1bOC",
					)
				) {
					if (row?.container) {
						expansion.set(row.id, true);
						rebuild();
					}
				} else if (data === " ") {
					if (row?.container) {
						expansion.set(row.id, !expanded(row));
						rebuild();
					}
				} else if (keyMatches(keybindings, data, "tui.select.up", "up", "\x1b[A")) {
					if (visible.length)
						selectedId = visible[(index - 1 + visible.length) % visible.length].id;
				} else if (
					keyMatches(keybindings, data, "tui.select.down", "down", "\x1b[B")
				) {
					if (visible.length) selectedId = visible[(index + 1) % visible.length].id;
				} else if (
					keyMatches(
						keybindings,
						data,
						"tui.select.confirm",
						"enter",
						"return",
						"\r",
						"\n",
					)
				) {
					if (row) return finish({ action: "select", value: row.id, item: row });
				} else if (
					keyMatches(keybindings, data, "tui.select.cancel", "escape", "\x1b")
				) {
					if (filter && query) {
						query = "";
						rebuild();
					} else return finish({ action: "back" });
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
						rebuild();
					} else return finish({ action: "back" });
				} else if (filter) {
					const text = data.replace(/^\x1b\[200~/, "").replace(/\x1b\[201~$/, "");
					if (text && !/[\x00-\x1f\x7f]/u.test(text)) {
						query += text;
						rebuild();
					}
				}
				if (selectedId) dialogCursors.set(cursorKey, selectedId);
				tui.requestRender();
			},
			invalidate() {},
		};
	});
}

export function resetDialogStateForTest() {
	dialogCursors.clear();
}
