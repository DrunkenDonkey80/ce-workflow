// Image annotator for the chat box: draw on a pasted image and add numbered markers with notes.
// The notes go into the chat as text, so the model reads them exactly; the image only carries the numbers.
export const COLORS = ["#e03131", "#f08c00", "#2f9e44", "#1971c2", "#000000", "#ffffff"];
type Point = [number, number];
export type Shape =
	| { kind: "pen"; color: string; points: Point[] }
	| { kind: "arrow" | "rect" | "ellipse"; color: string; a: Point; b: Point }
	| { kind: "marker"; color: string; n: number; at: Point; text: string };
export type Annotation = { shapes: Shape[]; crop: { a: Point; b: Point } | null };
type Tool = "move" | "pen" | "arrow" | "rect" | "ellipse" | "marker" | "crop";

/** confirm() in the page: the browser's own box opens at the top, where the Pi Hub app's tab strip covers it. */
export function confirmBox(text: string): Promise<boolean> {
	const dialog = document.createElement("dialog"), message = document.createElement("p"), actions = document.createElement("div");
	const cancel = Object.assign(document.createElement("button"), { type: "button", textContent: "Cancel" });
	const ok = Object.assign(document.createElement("button"), { type: "button", textContent: "OK", className: "primary" });
	dialog.className = "compact"; message.style.whiteSpace = "pre-line"; message.textContent = text; actions.className = "dialog-actions";
	actions.append(cancel, ok); dialog.append(message, actions); document.body.append(dialog);
	ok.onclick = () => dialog.close("ok"); cancel.onclick = () => dialog.close();
	dialog.showModal(); ok.focus();
	return new Promise(resolve => dialog.addEventListener("close", () => { dialog.remove(); resolve(dialog.returnValue === "ok"); }));
}

/** Lowest marker number not used yet (1–99), or 0 when all are taken. */
export function nextNumber(shapes: Shape[]) {
	const used = new Set(shapes.flatMap(shape => shape.kind === "marker" ? [shape.n] : []));
	for (let n = 1; n <= 99; n++) if (!used.has(n)) return n;
	return 0;
}
/** "(1) note" lines in number order; markers without a note are left out. */
export const legend = (shapes: Shape[]) => shapes.flatMap(shape => shape.kind === "marker" && shape.text.trim() ? [shape] : [])
	.sort((x, y) => x.n - y.n).map(shape => `(${shape.n}) ${shape.text.trim()}`).join("\n");

const box = (a: Point, b: Point) => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) });
const segment = (p: Point, a: Point, b: Point) => {
	const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
	return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
function move(shape: Shape, dx: number, dy: number) {
	const shift = (p: Point): Point => [p[0] + dx, p[1] + dy];
	if (shape.kind === "pen") shape.points = shape.points.map(shift);
	else if (shape.kind === "marker") shape.at = shift(shape.at);
	else { shape.a = shift(shape.a); shape.b = shift(shape.b); }
}

function draw(ctx: CanvasRenderingContext2D, shape: Shape, line: number, radius: number) {
	ctx.strokeStyle = ctx.fillStyle = shape.color; ctx.lineWidth = line; ctx.lineCap = ctx.lineJoin = "round"; ctx.beginPath();
	if (shape.kind === "pen") { shape.points.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.stroke(); }
	else if (shape.kind === "rect") { const r = box(shape.a, shape.b); ctx.strokeRect(r.x, r.y, r.w, r.h); }
	else if (shape.kind === "ellipse") { const r = box(shape.a, shape.b); ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
	else if (shape.kind === "arrow") {
		const angle = Math.atan2(shape.b[1] - shape.a[1], shape.b[0] - shape.a[0]), head = line * 5;
		const back: Point = [shape.b[0] - Math.cos(angle) * head * 0.8, shape.b[1] - Math.sin(angle) * head * 0.8];
		ctx.moveTo(...shape.a); ctx.lineTo(...back); ctx.stroke(); ctx.beginPath(); ctx.moveTo(...shape.b);
		for (const side of [-0.45, 0.45]) ctx.lineTo(shape.b[0] - Math.cos(angle + side) * head, shape.b[1] - Math.sin(angle + side) * head);
		ctx.closePath(); ctx.fill();
	} else {
		const light = shape.color === "#ffffff";
		ctx.arc(...shape.at, radius, 0, Math.PI * 2); ctx.fill();
		ctx.lineWidth = Math.max(1.5, radius / 8); ctx.strokeStyle = light ? "#000" : "#fff"; ctx.stroke(); // stands out on any background
		ctx.fillStyle = light ? "#000" : "#fff"; ctx.font = `700 ${Math.round(radius * (shape.n > 9 ? 1 : 1.2))}px system-ui, sans-serif`;
		ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(shape.n), shape.at[0], shape.at[1] + radius * 0.06);
	}
}

const TOOLS: [Tool, string, string][] = [["move", "✥", "Select and move"], ["pen", "✎", "Free draw"], ["arrow", "↗", "Arrow"], ["rect", "▭", "Rectangle"], ["ellipse", "◯", "Circle"], ["marker", "①", "Numbered marker with a note"], ["crop", "⛶", "Crop: send only this area"]];
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}) => Object.assign(document.createElement(tag), props);

/** Opens the annotator on `src`; resolves with the PNG and the editable state, or null when cancelled. */
export function annotate(src: string, start: Annotation = { shapes: [], crop: null }): Promise<{ blob: Blob; state: Annotation } | null> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onerror = () => reject(new Error("The image could not be loaded."));
		image.onload = () => resolve(open(image, structuredClone(start)));
		image.src = src;
	});
}

function open(image: HTMLImageElement, state: Annotation) {
	const width = image.naturalWidth, height = image.naturalHeight, size = Math.max(width, height);
	const line = Math.max(2, Math.round(size / 350)), radius = Math.max(12, Math.round(size / 55));
	const dialog = el("dialog", { className: "annotate", tabIndex: -1 }), bar = el("div", { className: "annotate-bar" }), stage = el("div", { className: "annotate-stage" });
	const canvas = el("canvas", { width, height }), note = el("input", { className: "annotate-note", type: "text", hidden: true, maxLength: 500, placeholder: "Note for this marker, Enter to keep" });
	const notes = el("ol", { className: "annotate-legend" }), ctx = canvas.getContext("2d")!;
	let tool: Tool = "pen", color = COLORS[0], selected = -1, editing = -1, editingNew = false, last: Point | null = null, dirty = false;
	let action: { kind: "draw" | "drag" | "crop"; from: Point; moved: boolean } | null = null;
	const history: Annotation[] = [];
	const snapshot = () => { history.push(structuredClone(state)); dirty = true; };
	const undo = () => { const back = history.pop(); if (!back) return; Object.assign(state, back); selected = -1; closeNote(false); render(); };

	const buttons = new Map<string, HTMLButtonElement>();
	for (const [id, label, title] of TOOLS) {
		const button = el("button", { type: "button", textContent: label, title, className: "annotate-tool" });
		button.setAttribute("aria-label", title); button.addEventListener("click", () => { tool = id; selected = -1; render(); }); buttons.set(id, button); bar.append(button);
	}
	const swatches = COLORS.map(value => {
		const swatch = el("button", { type: "button", className: "annotate-swatch", title: "Colour" }); swatch.style.background = value;
		swatch.addEventListener("click", () => { color = value; const shape = state.shapes[selected]; if (shape) { snapshot(); shape.color = value; } render(); }); return swatch;
	});
	const undoButton = el("button", { type: "button", textContent: "↶", title: "Undo (Ctrl+Z)", className: "annotate-tool" });
	const removeButton = el("button", { type: "button", textContent: "🗑", title: "Delete the selected element (Del)", className: "annotate-tool" });
	const cancel = el("button", { type: "button", textContent: "Cancel" }), save = el("button", { type: "button", textContent: "Save", className: "annotate-save" });
	undoButton.addEventListener("click", undo); removeButton.addEventListener("click", () => remove());
	bar.append(el("span", { className: "annotate-gap" }), ...swatches, el("span", { className: "annotate-gap" }), undoButton, removeButton, el("span", { className: "annotate-fill" }), cancel, save);
	stage.append(canvas, note);
	dialog.append(bar, el("p", { className: "dialog-purpose", textContent: "Draw on the image. Markers: click with ①, or press 1–9 over the image; type a note and press Enter. Ctrl+Z undoes, Del removes the selected element." }), stage, notes);
	document.body.append(dialog);

	function render() {
		ctx.clearRect(0, 0, width, height); ctx.drawImage(image, 0, 0);
		state.shapes.forEach(shape => draw(ctx, shape, line, radius));
		const shape = state.shapes[selected];
		if (shape) {
			const points = shape.kind === "pen" ? shape.points : shape.kind === "marker" ? [[shape.at[0] - radius, shape.at[1] - radius], [shape.at[0] + radius, shape.at[1] + radius]] as Point[] : [shape.a, shape.b];
			const xs = points.map(p => p[0]), ys = points.map(p => p[1]), pad = line * 2;
			ctx.save(); ctx.setLineDash([line * 3, line * 2]); ctx.lineWidth = Math.max(1, line / 2); ctx.strokeStyle = "#1c7ed6";
			ctx.strokeRect(Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...ys) - Math.min(...ys) + pad * 2); ctx.restore();
		}
		if (state.crop) {
			const r = box(state.crop.a, state.crop.b);
			ctx.save(); ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.rect(r.x, r.y, r.w, r.h); ctx.fill("evenodd");
			ctx.setLineDash([line * 3, line * 2]); ctx.lineWidth = Math.max(1, line / 2); ctx.strokeStyle = "#fff"; ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.restore();
		}
		for (const [id, button] of buttons) button.setAttribute("aria-pressed", String(id === tool));
		swatches.forEach((swatch, i) => swatch.setAttribute("aria-pressed", String(COLORS[i] === color)));
		undoButton.disabled = !history.length; removeButton.disabled = !state.shapes[selected];
		const markers = state.shapes.flatMap((shape, index) => shape.kind === "marker" ? [{ shape, index }] : []).sort((x, y) => x.shape.n - y.shape.n);
		notes.replaceChildren(...markers.map(({ shape, index }) => {
			const item = el("li", { textContent: `(${shape.n}) ${shape.text || "…"}`, title: "Edit this note" }); item.style.setProperty("--marker", shape.color);
			item.addEventListener("click", () => { selected = index; render(); openNote(index, false); }); return item;
		}));
	}
	const at = (event: { clientX: number; clientY: number }): Point => {
		const rect = canvas.getBoundingClientRect();
		return [(event.clientX - rect.left) * width / rect.width, (event.clientY - rect.top) * height / rect.height];
	};
	function hit(p: Point) {
		const near = line * 3 + 4;
		for (let i = state.shapes.length - 1; i >= 0; i--) {
			const shape = state.shapes[i];
			if (shape.kind === "marker" ? Math.hypot(p[0] - shape.at[0], p[1] - shape.at[1]) <= radius + 2
				: shape.kind === "pen" ? shape.points.some((q, j) => segment(p, shape.points[j - 1] ?? q, q) <= near)
				: shape.kind === "arrow" ? segment(p, shape.a, shape.b) <= near
				: (() => { const r = box(shape.a, shape.b); return p[0] >= r.x - near && p[0] <= r.x + r.w + near && p[1] >= r.y - near && p[1] <= r.y + r.h + near; })()) return i;
		}
		return -1;
	}
	function addMarker(n: number, p: Point) {
		const existing = state.shapes.findIndex(shape => shape.kind === "marker" && shape.n === n);
		snapshot();
		if (existing >= 0) { (state.shapes[existing] as { at: Point }).at = p; selected = existing; }
		else { state.shapes.push({ kind: "marker", color, n, at: p, text: "" }); selected = state.shapes.length - 1; }
		render(); openNote(selected, existing < 0);
	}
	function openNote(index: number, isNew: boolean) {
		const shape = state.shapes[index]; if (shape?.kind !== "marker") return;
		editing = index; editingNew = isNew; note.value = shape.text; note.hidden = false;
		const rect = canvas.getBoundingClientRect(), outer = stage.getBoundingClientRect(), scale = rect.width / width;
		const left = rect.left - outer.left + (shape.at[0] + radius) * scale + 8, top = rect.top - outer.top + shape.at[1] * scale - 16;
		note.style.left = Math.max(4, Math.min(left, outer.width - 284)) + "px"; note.style.top = Math.max(4, Math.min(top, outer.height - 36)) + "px";
		setTimeout(() => note.focus()); // after the click's own mousedown, which would otherwise take focus back and close the note
	}
	function closeNote(keep: boolean) {
		const shape = state.shapes[editing];
		if (shape?.kind === "marker") {
			if (keep && note.value.trim() !== shape.text) { if (!editingNew) snapshot(); shape.text = note.value.trim(); }
			else if (!keep && editingNew && !shape.text) { history.pop(); state.shapes.splice(editing, 1); selected = -1; } // Escape on a fresh marker drops it
		}
		editing = -1; note.hidden = true; dialog.focus({ preventScroll: true }); render(); // keeps the 1–9 and Ctrl+Z keys working
	}
	function remove() { if (!state.shapes[selected]) return; snapshot(); state.shapes.splice(selected, 1); selected = -1; render(); }

	canvas.addEventListener("pointerdown", event => {
		if (event.button !== 0) return;
		if (editing >= 0) closeNote(true);
		const p = at(event), target = hit(p); canvas.setPointerCapture(event.pointerId);
		const marker = target >= 0 && state.shapes[target].kind === "marker";
		if (tool === "move" || (marker && tool !== "crop")) { selected = target; if (target >= 0) { snapshot(); action = { kind: "drag", from: p, moved: false }; } render(); return; }
		selected = -1; snapshot();
		if (tool === "marker") { const n = nextNumber(state.shapes); history.pop(); if (n) addMarker(n, p); return; }
		if (tool === "crop") { state.crop = { a: p, b: p }; action = { kind: "crop", from: p, moved: false }; render(); return; }
		state.shapes.push(tool === "pen" ? { kind: "pen", color, points: [p] } : { kind: tool, color, a: p, b: p });
		action = { kind: "draw", from: p, moved: false }; render();
	});
	canvas.addEventListener("pointermove", event => {
		const p = at(event); last = p; if (!action) return;
		action.moved = true;
		if (action.kind === "crop") state.crop!.b = p;
		else if (action.kind === "drag") { move(state.shapes[selected], p[0] - action.from[0], p[1] - action.from[1]); action.from = p; }
		else { const shape = state.shapes.at(-1)!; if (shape.kind === "pen") shape.points.push(p); else if (shape.kind !== "marker") shape.b = p; }
		render();
	});
	canvas.addEventListener("pointerleave", () => { if (!action) last = null; });
	const finish = () => {
		if (!action) return;
		const { kind, moved } = action; action = null;
		if (kind === "drag" && !moved) history.pop();
		if (kind === "crop") { const r = box(state.crop!.a, state.crop!.b); if (r.w < 8 || r.h < 8) undo(); } // a click, not a drag: nothing changes
		if (kind === "draw") {
			const shape = state.shapes.at(-1)!;
			const tiny = shape.kind === "pen" ? shape.points.length < 2 : shape.kind !== "marker" && Math.hypot(shape.a[0] - shape.b[0], shape.a[1] - shape.b[1]) < line * 2;
			if (tiny) undo();
		}
		render();
	};
	canvas.addEventListener("pointerup", finish); canvas.addEventListener("pointercancel", finish);
	canvas.addEventListener("dblclick", event => { const target = hit(at(event)); if (state.shapes[target]?.kind === "marker") openNote(target, false); });
	note.addEventListener("keydown", event => {
		event.stopPropagation();
		if (event.key === "Enter") { event.preventDefault(); closeNote(true); }
		if (event.key === "Escape") { event.preventDefault(); closeNote(false); }
	});
	note.addEventListener("blur", () => { if (editing >= 0) closeNote(true); });
	dialog.addEventListener("keydown", event => {
		if (event.target === note) return;
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); }
		else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); remove(); }
		else if (/^[1-9]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); addMarker(Number(event.key), last ?? [width / 2, height / 2]); }
	});

	return new Promise<{ blob: Blob; state: Annotation } | null>(resolve => {
		const done = (value: { blob: Blob; state: Annotation } | null) => { dialog.close(); dialog.remove(); resolve(value); };
		dialog.addEventListener("cancel", async event => { event.preventDefault(); if (!dirty || await confirmBox("Discard the annotations?")) done(null); });
		cancel.addEventListener("click", async () => { if (!dirty || await confirmBox("Discard the annotations?")) done(null); });
		save.addEventListener("click", () => {
			if (editing >= 0) closeNote(true);
			const r = state.crop ? box(state.crop.a, state.crop.b) : { x: 0, y: 0, w: width, h: height };
			const out = el("canvas", { width: Math.round(r.w), height: Math.round(r.h) }), octx = out.getContext("2d")!;
			octx.translate(-r.x, -r.y); octx.drawImage(image, 0, 0); state.shapes.forEach(shape => draw(octx, shape, line, radius));
			out.toBlob(blob => blob ? done({ blob, state }) : alert("The image could not be saved."), "image/png");
		});
		render(); dialog.showModal(); canvas.focus();
	});
}
