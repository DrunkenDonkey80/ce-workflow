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

function itemIndicator(item, { checked, currentValue, multi } = {}) {
	if (multi) return checked ? "✓" : "○";
	if (item.value === currentValue) return "●";
	if (item.local) return "*";
	return " ";
}

function indicatedPrefix(item, options, align = true) {
	const indicator = itemIndicator(item, options);
	if (!align) return indicator === " " ? "" : indicator;
	return `${options?.selected ? "❯" : " "} ${indicator}`;
}

function indicatedLabel(item, options, align = true) {
	return `${indicatedPrefix(item, options, align)}${itemLabel(item)}`;
}

function styledLabel(theme, item, options, color) {
	return `${theme.fg(color, indicatedPrefix(item, options))}${item.labelSegments
		.map((segment) => theme.fg(segment.color ?? color, segment.text))
		.join("")}`;
}

function keyMatches(keybindings, data, id, ...fallbacks) {
	return Boolean(keybindings?.matches?.(data, id) || fallbacks.includes(data));
}

function stripAnsi(value) {
	return String(value).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// ponytail: calibrated for packaged icons on Windows Terminal; update with icons.
const terminalEmojiExtraCells = new Map([
	["🧱", 1],
	["🧭", 1],
	["🧹", 1],
	["🌍", 1],
	["🟢", 1],
	["🟡", 1],
	["🪲", 1],
	["🧽", 1],
]);

function cellWidth(segment) {
	if (
		/\p{Emoji_Presentation}/u.test(segment) ||
		/[\uFE0F\u200D]/u.test(segment)
	)
		return 2 + (terminalEmojiExtraCells.get(segment) ?? 0);
	const code = segment.codePointAt(0) ?? 0;
	if (
		/^\p{Mark}+$/u.test(segment) ||
		code < 32 ||
		(code >= 0x7f && code < 0xa0)
	)
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

function fit(value, width) {
	const text = String(value);
	const safeWidth = Math.max(1, width);
	const visible = visibleWidth(text);
	if (visible <= safeWidth) return `${text}${" ".repeat(safeWidth - visible)}`;
	let result = "";
	let used = 0;
	for (const { segment } of graphemes.segment(stripAnsi(text))) {
		const next = cellWidth(segment);
		if (used + next > safeWidth - 1) break;
		result += segment;
		used += next;
	}
	result += "…";
	return `${result}${" ".repeat(Math.max(0, safeWidth - used - 1))}`;
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
		if (line) lines.push(fit(line, width).trimEnd());
		line = words[index];
		if (lines.length === maxLines - 1) {
			lines.push(
				fit([line, ...words.slice(index + 1)].join(" "), width).trimEnd(),
			);
			return lines;
		}
	}
	if (line) lines.push(fit(line, width).trimEnd());
	return lines;
}

function sectionLine(theme, title, width) {
	const label = ` ${title} `;
	return theme.fg(
		"border",
		`${label}${"─".repeat(Math.max(0, width - visibleWidth(label)))}`,
	);
}

function workspaceHeight(tui) {
	return Math.max(1, (tui.terminal?.rows ?? 24) - 1);
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
			? [
					{
						value: "__dialog_tab__",
						label: tabAction.label,
						preserveCase: true,
					},
				]
			: []),
	];
	const labels = choices.map((item) =>
		labelFor({
			...item,
			label: indicatedLabel(item, { currentValue: active }, false),
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
	} = options;
	if (
		ctx.ui.workDialogsNative === true ||
		(ctx.mode !== "tui" &&
			!(forceCustom && !ctx.mode && typeof ctx.ui.custom === "function"))
	)
		return nativeListDialog(ctx, { ...options, cursorKey });
	if (typeof ctx.ui.custom !== "function")
		return nativeListDialog(ctx, { ...options, cursorKey });
	const subtitleLines = (
		Array.isArray(subtitle) ? subtitle : [subtitle]
	).filter(Boolean);

	return ctx.ui.custom(
		(tui, theme, keybindings, done) => {
			const enabled = new Set(multi?.selected ?? []);
			let source = [...items];
			let purpose = initialPurpose;
			let help = initialHelp;
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

			let cachedKey;
			let cachedLines;
			const component = {
				focused: false,
				render(width) {
					const height = workspaceHeight(tui);
					const renderWidth = Math.max(1, width - 2);
					const cacheKey = `${renderWidth}:${height}:${component.focused}`;
					if (cacheKey === cachedKey) return cachedLines;
					const lines = [];
					const add = (line = "") =>
						lines.push(fit(line || "\u00a0", renderWidth));
					const inline = source.some((item) => item.inlineDescription);
					const detailRows = inline
						? 0
						: Math.max(descriptionMinLines, descriptionMaxLines);
					const shownSubtitles = subtitleLines.slice(
						0,
						Math.max(0, height - detailRows - 8),
					);

					add(
						`${theme.fg("accent", theme.bold(title))}  ${theme.fg(
							"dim",
							`${visible.length}/${source.length}${multi ? ` · ${enabled.size} selected` : ""}`,
						)}`,
					);
					add(theme.fg("muted", purpose));
					for (const line of shownSubtitles) add(theme.fg("dim", line));
					if (filter) {
						const cursor = component.focused ? "▌" : "";
						add(
							`${theme.fg("muted", "Filter:")} ${theme.fg("text", `${query}${cursor}`)}`,
						);
					}

					const detailBlockRows = detailRows ? detailRows + 1 : 0;
					const footerRows = 2;
					const listRows = Math.max(
						1,
						height - lines.length - detailBlockRows - footerRows - 1,
					);
					const itemRows = inline ? 2 : 1;
					const count = Math.max(
						1,
						Math.min(visible.length, Math.floor(listRows / itemRows)),
					);
					const start = Math.max(
						0,
						Math.min(index - Math.floor(count / 2), visible.length - count),
					);
					const position = visible.length
						? `${index + 1}/${visible.length}`
						: "0/0";
					add(
						sectionLine(
							theme,
							multi ? `Checklist · ${position}` : `Options · ${position}`,
							renderWidth,
						),
					);

					const body = [];
					if (!visible.length) body.push(theme.fg("warning", " No matches"));
					for (let row = start; row < start + count && visible[row]; row += 1) {
						const item = visible[row].item;
						const state = {
							checked: enabled.has(item.value),
							currentValue,
							multi: Boolean(multi),
							selected: row === index,
						};
						let color = item.color ?? "text";
						if (row === index && !item.color) color = "accent";
						else if (multi) color = enabled.has(item.value) ? "success" : "dim";
						else if (item.enabled === true) color = "success";
						else if (item.enabled === false) color = "dim";
						else if (item.value === currentValue) color = "success";
						body.push(
							item.labelSegments
								? styledLabel(theme, item, state, color)
								: theme.fg(color, indicatedLabel(item, state)),
						);
						if (item.inlineDescription)
							body.push(
								theme.fg(
									"muted",
									`${item.descriptionPrefix ?? "   "}${item.description ?? "No short description yet."}`,
								),
							);
					}
					while (body.length < listRows) body.push("\u00a0");
					for (const line of body.slice(0, listRows)) add(line);

					if (detailRows) {
						add(sectionLine(theme, "Details", width));
						const selected = visible[index]?.item;
						const details = wrapText(
							selected?.description ?? "No description.",
							Math.max(8, renderWidth - 2),
							detailRows,
						);
						while (details.length < detailRows) details.push("");
						for (const line of details.slice(0, detailRows))
							add(theme.fg("muted", line));
					}

					let defaultHelp = "↑↓ navigate · Enter select · Esc/Backspace back";
					if (multi)
						defaultHelp =
							"↑↓ navigate · Enter/Space toggle · Esc/Backspace save and go back";
					if (filter) defaultHelp = `Type to filter · ${defaultHelp}`;
					add(sectionLine(theme, "Keys", renderWidth));
					add(theme.fg("dim", help ?? defaultHelp));
					while (lines.length < height) add();
					cachedKey = cacheKey;
					cachedLines = lines.slice(0, height);
					return cachedLines;
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
					cachedKey = undefined;
					tui.requestRender();
				},
				invalidate() {
					cachedKey = undefined;
				},
			};
			return component;
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "100%",
				maxHeight: "100%",
			},
		},
	);
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
	return "muted";
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
			for (const child of task.children ?? [])
				appendTasks(rows, child, depth + 1);
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
				for (const task of roadmap.tasks ?? [])
					appendTasks(rows, task, depth + 1);
				appendRoadmaps(rows, roadmap.id, depth + 1);
			}
		};
		const rows = [];
		appendRoadmaps(rows);
		return rows;
	};
	const nativeRows = rootsFor(initialFrame).map((row) => ({
		value: row.id,
		label: `${"  ".repeat(row.depth)}${row.title ?? row.label ?? row.id}`,
		description: row.description,
		preserveCase: true,
	}));
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

	return ctx.ui.custom(
		(tui, theme, keybindings, done) => {
			let frame = initialFrame;
			let rows = rootsFor(frame);
			let query = "";
			let visible = [];
			const expansion = new Map();
			let selectedId =
				frame?.selectedId ?? dialogCursors.get(cursorKey) ?? rows[0]?.id;
			let closed = false;
			let timer;
			let cachedKey;
			let cachedLines;
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
				cachedKey = undefined;
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
			rebuild();
			if (refresh) timer = setIntervalFn(poll, refreshIntervalMs);

			const component = {
				focused: false,
				render(width) {
					const height = workspaceHeight(tui);
					const renderWidth = Math.max(1, width - 2);
					const cache = `${renderWidth}:${height}:${component.focused}:${query}:${frame?.signature}:${selectedId}:${[...expansion]}`;
					if (cache === cachedKey) return cachedLines;
					const selected = visible.find((row) => row.id === selectedId);
					if (selected && !statsById.has(selected.id)) {
						try {
							statsById.set(selected.id, resolveStats?.(selected.id) ?? ["Stats:", "- unknown"]);
						} catch {
							statsById.set(selected.id, ["Stats:", "- unknown"]);
						}
					}
					const stats = statsById.get(selected?.id) ?? ["Stats:", "- unknown"];
					const lines = [];
					const add = (line = "") =>
						lines.push(fit(line || "\u00a0", renderWidth));
					const header = [
						`${theme.fg("accent", theme.bold(title))}  ${theme.fg("dim", `${visible.length}/${rows.length}`)}`,
						theme.fg("muted", purpose),
					];
					if (filter)
						header.push(
							`${theme.fg("muted", "Filter:")} ${theme.fg("text", `${query}${component.focused ? "▌" : ""}`)}`,
						);
					const statsWidth = Math.min(
						Math.max(1, Math.floor((renderWidth - 2) / 2)),
						Math.max(1, ...stats.map((line) => visibleWidth(line))),
					);
					const headerWidth = Math.max(1, renderWidth - statsWidth - 2);
					const statsRows = Math.min(
						9,
						Math.max(header.length, height - 5),
					);
					const shownStats = stats.length > statsRows
						? [
								...stats.slice(0, Math.max(0, statsRows - 1)),
								`… ${stats.length - statsRows + 1} more`,
							]
						: stats;
					for (let at = 0; at < statsRows; at += 1) {
						const left = fit(header[at] ?? "", headerWidth);
						const right = fit(shownStats[at] ?? "", statsWidth).trimEnd();
						add(
							`${left}  ${" ".repeat(Math.max(0, statsWidth - visibleWidth(right)))}${theme.fg("muted", right)}`,
						);
					}
					add(sectionLine(theme, "Work items", renderWidth));
					const detailRows = Math.max(
						0,
						Math.min(6, height - lines.length - 4),
					);
					const bodyRows = Math.max(0, height - lines.length - detailRows - 3);
					const index = Math.max(
						0,
						visible.findIndex((row) => row.id === selectedId),
					);
					const start = Math.max(
						0,
						Math.min(
							index - Math.floor(bodyRows / 2),
							visible.length - bodyRows,
						),
					);
					for (let at = start; at < start + bodyRows; at += 1) {
						const row = visible[at];
						if (!row) add();
						else {
							const selected = row.id === selectedId;
							const marker = row.container
								? expanded(row)
									? "[-]"
									: "[+]"
								: "   ";
							const progress = row.role || row.tasks
								? `${row.progress?.completed ?? 0}/${row.progress?.total ?? 0} `
								: "";
							const prefix = `${theme.fg(selected ? "accent" : "text", selected ? "❯" : " ")} ${"  ".repeat(row.depth)}${marker} `;
							const dot = theme.fg(
								treeStatusColor(row),
								treeVisualStatus(row) === "closed" ? "✓" : "●",
							);
							const title = theme.fg(
								selected
									? "accent"
									: treeVisualStatus(row) === "closed"
										? "dim"
										: "text",
								`${progress}${row.shortTitle ?? row.title ?? row.label ?? row.id}`,
							);
							add(`${prefix}${dot} ${title}`);
						}
					}
					add(sectionLine(theme, "Details", renderWidth));
					const details = detailRows
						? wrapText(
								selected?.description || "No description.",
								renderWidth,
								detailRows,
							)
						: [];
					for (const line of details) add(theme.fg("text", line));
					while (lines.length < height - 2) add();
					add(sectionLine(theme, "Keys", renderWidth));
					add(
						theme.fg(
							"dim",
							`${filter ? "Type to filter · " : ""}↑↓ navigate · Space/←/→ expand · Enter select · Esc back`,
						),
					);
					while (lines.length < height) add();
					cachedKey = cache;
					cachedLines = lines.slice(0, height);
					return cachedLines;
				},
				handleInput(data) {
					const index = Math.max(
						0,
						visible.findIndex((row) => row.id === selectedId),
					);
					const row = visible[index];
					if (data === "left" || data === "\x1b[D") {
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
					} else if (data === "right" || data === "\x1b[C") {
						if (row?.container) {
							expansion.set(row.id, true);
							rebuild();
						}
					} else if (data === " ") {
						if (row?.container) {
							expansion.set(row.id, !expanded(row));
							rebuild();
						}
					} else if (
						keyMatches(keybindings, data, "tui.select.up", "up", "\x1b[A")
					) {
						if (visible.length)
							selectedId =
								visible[(index - 1 + visible.length) % visible.length].id;
					} else if (
						keyMatches(keybindings, data, "tui.select.down", "down", "\x1b[B")
					) {
						if (visible.length)
							selectedId = visible[(index + 1) % visible.length].id;
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
						if (row)
							return finish({ action: "select", value: row.id, item: row });
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
						const text = data
							.replace(/^\x1b\[200~/, "")
							.replace(/\x1b\[201~$/, "");
						if (text && !/[\x00-\x1f\x7f]/u.test(text)) {
							query += text;
							rebuild();
						}
					}
					if (selectedId) dialogCursors.set(cursorKey, selectedId);
					cachedKey = undefined;
					tui.requestRender();
				},
				invalidate() {
					cachedKey = undefined;
				},
			};
			return component;
		},
		{
			overlay: true,
			overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
		},
	);
}

export function resetDialogStateForTest() {
	dialogCursors.clear();
}
