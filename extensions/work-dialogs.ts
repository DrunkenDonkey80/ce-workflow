import { randomUUID } from "node:crypto";
import { dialogCursors, keyMatches, nativeListDialog, plainLabel, sectionLine, stripAnsi, truncate, wrapText } from "./ask-user/menu.ts";
// The list view moved into ask_user (plan 0db155f7 H3-06); H3-08 points importers there and removes this file.
export { bindListDialogBridge, listDialogResponse, progressBar, resetDialogStateForTest, showListDialog } from "./ask-user/menu.ts";

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
	return ask.execute(randomUUID(), { allowComment: true, ...params, displayMode: "overlay" }, signal, undefined, askContext);
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
