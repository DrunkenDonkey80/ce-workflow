// Browser URL imports carry the explicit workspace capability.
// @ts-ignore Browser-only module URL.
import rough from "./vendor/rough.js?token=__TOKEN__";
// @ts-ignore Browser-only module URL.
import { layout } from "./layout.js?token=__TOKEN__";

import type { Diagram } from "../plan3-diagram.ts";
const NS = "http://www.w3.org/2000/svg";
export function element<K extends keyof SVGElementTagNameMap>(tag: K, attributes = {}, text = undefined) {
 const node = document.createElementNS(NS, tag);
 for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
 if (text !== undefined) node.textContent = text;
 return node;
}
export function seed(id) { let value = 0; for (const char of id) value = Math.imul(value, 31) + char.charCodeAt(0); return (value & 0x7fffffff) || 1; }
const FAR = { w: 280, h: 100 };
const fills = { new: "#b2f2bb", changed: "#ffec99", removed: "#ced4da", existing: "#a5d8ff" };

export function createDiagramView(svg: SVGSVGElement, handlers) {
 const rc = rough.svg(svg), view = { x: 32, y: 32, scale: 1 };
 const measure = document.createElement("canvas").getContext("2d");
 measure.font = "16px Virgil";
 let diagram, boxes = new Map(), nodes = [], edges = [], gesture, first = true, selected = null, hovered = null;
 // Focus mode: the selected or hovered element, its edges and neighbors stay lit; the rest dims.
 function applyFocus() {
  const id = hovered ?? selected; svg.classList.toggle("focusing", !!id);
  for (const item of svg.querySelectorAll(".lit")) item.classList.remove("lit");
  if (!id || !diagram) return;
  const byId = new Map<string, any>(diagram.nodes.map(node => [node.id, node])), lit = new Set([id]);
  const under = at => { for (let node = byId.get(at); node; node = byId.get(node.parent)) if (node.id === id) return true; return false; };
  for (const edge of diagram.edges) if (edge.id === id || under(edge.from) || under(edge.to)) lit.add(edge.id).add(edge.from).add(edge.to);
  for (const at of [...lit]) for (let parent = byId.get(at)?.parent; byId.has(parent); parent = byId.get(parent).parent) lit.add(parent);
  for (const item of svg.querySelectorAll("[data-node], [data-edge]")) if (lit.has(item.getAttribute("data-node") ?? item.getAttribute("data-edge"))) item.classList.add("lit");
 }
 function arrow(row, a, b, options, label, both = false) {
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
  const dx = bx - ax, dy = by - ay; if (!dx && !dy) return false;
  const start = Math.min(a.w / 2 / Math.abs(dx), a.h / 2 / Math.abs(dy)), end = Math.min(b.w / 2 / Math.abs(dx), b.h / 2 / Math.abs(dy));
  const x1 = ax + dx * start, y1 = ay + dy * start, x2 = bx - dx * end, y2 = by - dy * end, angle = Math.atan2(dy, dx);
  const head = (x, y, turn) => rc.linearPath([[x - 10 * Math.cos(turn - .4), y - 10 * Math.sin(turn - .4)], [x, y], [x - 10 * Math.cos(turn + .4), y - 10 * Math.sin(turn + .4)]], options);
  row.append(rc.line(x1, y1, x2, y2, options), head(x2, y2, angle));
  if (both) row.append(head(x1, y1, angle + Math.PI));
  row.append(element("line", { x1, y1, x2, y2, class: "edge-hit" }));
  if (label) row.append(element("text", { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 8, class: label.className, "text-anchor": "middle" }, label.text));
  return true;
 }
 function lines(text, width, limit) {
  const out = []; let line = "";
  for (const char of String(text ?? "").replaceAll("\r", "")) {
   if (char === "\n" || line && measure.measureText(line + char).width > width) {
    const split = char === "\n" ? -1 : line.lastIndexOf(" ");
    out.push((split > 0 ? line.slice(0, split) : line).trimEnd());
    line = char === "\n" ? "" : ((split > 0 ? line.slice(split + 1) : "") + char).trimStart();
    if (out.length === limit) { out[limit - 1] += "…"; return out; }
   } else line += char;
  }
  if (line) out.push(line); return out;
 }
 // shortcut: near-band inline fields show bounded excerpts; full text remains in the hover card, expand limits if real diagrams need it.
 const noteSpace = (data, id) => data.notes.filter(note => note.target === id).length * 116;
 const details = node => [...lines(node.summary, 212, 4), ...lines(node.tech, 212, 2), ...lines(node.details, 212, 8)];
 function build(data: Diagram) {
  const byId = new Map(data.nodes.map(node => [node.id, node]));
  const root = id => { let node = byId.get(id); while (node?.parent) node = byId.get(node.parent); return node?.id; };
  const far = view.scale < .6, near = view.scale > 1.6;
  nodes = far ? data.nodes.filter(node => !node.parent) : data.nodes;
  const seen = new Set();
  edges = data.edges.map(edge => far ? { ...edge, from: root(edge.from), to: root(edge.to) } : edge).filter(edge => {
   if (edge.from === edge.to) return false;
   const key = edge.from + ":" + edge.to;
   if (far && seen.has(key)) return false; seen.add(key); return true;
  });
  boxes = layout({ nodes: far ? nodes.map(node => ({ ...node, kind: node.kind === "group" ? "service" : node.kind })) : nodes, edges }, node => near ? { w: 240, h: 78 + details(node).length * 18 + noteSpace(data, node.id) } : far ? FAR : { w: 168, h: 64 }, node => 32 + (near ? details(node).length * 18 + noteSpace(data, node.id) : 0));
 }
 function draw(data = diagram) {
  if (!data) return;
  const focused = document.activeElement?.getAttribute("data-node");
  build(data);
  const stage = element("g", { transform: `translate(${view.x} ${view.y}) scale(${view.scale})` });
  const near = view.scale > 1.6;
  function drawNode(node) {
   const box = boxes.get(node.id), group = node.kind === "group", closed = view.scale < .6;
   const row = element("g", { "data-node": node.id, tabindex: 0, role: "button", "aria-label": node.label + ", " + node.kind + ". Enter to mention; drag to move." });
   row.append(rc.rectangle(box.x, box.y, box.w, box.h, { seed: seed(node.id), roughness: .8, stroke: group ? "#868e96" : "#1e1e1e", strokeWidth: 1.5, strokeLineDash: group ? [8, 5] : undefined, fill: node.status ? fills[node.status] : group ? "#ffffff" : "#a5d8ff", fillStyle: node.status === "removed" ? "hachure" : "solid" }));
   // Overview labels are drawn larger so they stay legible at the small fit scale.
   const big = closed && !node.parent, size = big ? 1.6 : 1;
   lines(node.label, (box.w - 24) / size, 2).forEach((text, index) => row.append(element("text", { x: box.x + 12, y: box.y + 28 * size + index * 20 * size, class: "node-label" + (big ? " node-label-far" : "") }, text)));
   row.append(element("title", {}, [node.label, node.summary, node.tech, node.details].filter(Boolean).join("\n")));
   if (near) details(node).forEach((text, index) => row.append(element("text", { x: box.x + 12, y: box.y + 69 + index * 18, class: "node-detail" }, text)));
   if (group && !closed) row.classList.add("group-node");
   row.addEventListener("click", event => { if (event.ctrlKey || event.metaKey) handlers.mention(node.id); });
   row.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); if (handlers.pinning?.()) handlers.pin({ element: node.id }); else handlers.mention(node.id); } });
   // Open groups cover most of the canvas, so only a click (not hover) focuses them.
   const hoverable = !group || closed, preview = () => { if (hoverable) { hovered = node.id; applyFocus(); } };
   row.addEventListener("pointerenter", event => { preview(); handlers.hover?.(node.id, event); });
   row.addEventListener("focus", event => { preview(); handlers.hover?.(node.id, event); }); row.setAttribute("aria-describedby", "hover-card");
   for (const name of ["pointerleave", "blur"]) row.addEventListener(name, () => { if (hoverable) { hovered = null; applyFocus(); } handlers.leave?.(); });
   stage.append(row);
  }
  nodes.filter(node => node.kind === "group").forEach(drawNode);
  // Calm default: an edge that leaves a top-level group is drawn once per group pair (with a count) and
  // only appears individually while one of its ends is in focus.
  const byId = new Map<string, any>(data.nodes.map(node => [node.id, node]));
  const top = id => { let node = byId.get(id); while (byId.has(node?.parent)) node = byId.get(node.parent); return node?.id; };
  const bundles = new Map();
  for (const edge of edges) {
   const from = top(edge.from), to = top(edge.to);
   if (view.scale < .6 || from === to || from === edge.from && to === edge.to) continue;
   const key = [from, to].sort().join(" "), bundle = bundles.get(key) ?? { from, to, count: 0, both: false };
   bundle.count++; bundle.both ||= bundle.from !== from; bundles.set(key, bundle);
  }
  for (const [key, bundle] of bundles) {
   const row = element("g", { class: "bundle-edge" });
   row.append(element("title", {}, bundle.count + " connection" + (bundle.count > 1 ? "s" : "") + "; hover or click a box to see them."));
   if (arrow(row, boxes.get(bundle.from), boxes.get(bundle.to), { seed: seed(key), stroke: "#868e96", strokeWidth: 1.6, roughness: .7 }, bundle.count > 1 && { text: "\u00d7" + bundle.count, className: "bundle-count" }, bundle.both)) stage.append(row);
  }
  for (const edge of edges) {
   const a = boxes.get(edge.from), b = boxes.get(edge.to); if (!a || !b) continue;
   const bundled = view.scale >= .6 && bundles.has([top(edge.from), top(edge.to)].sort().join(" ")) && top(edge.from) !== top(edge.to);
   const row = element("g", { "data-edge": edge.id, tabindex: 0, role: "button", "aria-label": (edge.label || edge.id) + ". Enter to mention." });
   if (bundled) row.classList.add("detail-edge");
   const options = { seed: seed(edge.id), stroke: "#1e1e1e", strokeWidth: 1.4, roughness: .7, strokeLineDash: edge.status === "removed" ? [5, 4] : undefined };
   if (!arrow(row, a, b, options, view.scale >= .6 && edge.label && { text: edge.label, className: "edge-label" })) continue;
   row.addEventListener("click", event => { if (event.ctrlKey || event.metaKey) handlers.mention(edge.id); });
   row.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); if (handlers.pinning?.()) handlers.pin({ element: edge.id }); else handlers.mention(edge.id); } });
   row.addEventListener("pointerenter", event => { hovered = edge.id; applyFocus(); handlers.hover?.(edge.id, event); }); row.addEventListener("focus", event => { hovered = edge.id; applyFocus(); handlers.hover?.(edge.id, event); }); row.setAttribute("aria-describedby", "hover-card");
   for (const name of ["pointerleave", "blur"]) row.addEventListener(name, () => { hovered = null; applyFocus(); handlers.leave?.(); });
   stage.append(row);
  }
  nodes.filter(node => node.kind !== "group").forEach(drawNode);
  handlers.notes?.(stage, boxes, view, rc, data, node => 69 + details(node).length * 18);
  svg.replaceChildren(stage); hovered = null; applyFocus(); svg.dataset.selected = selected ?? ""; svg.dataset.revision = String(data.revision); svg.dataset.band = view.scale < .6 ? "far" : near ? "near" : "mid";
  document.getElementById("zoom-level").textContent = Math.round(view.scale * 100) + "%";
  if (focused) svg.querySelector<SVGElement>(`[data-node="${focused}"]`)?.focus();
 }
 function zoom(factor, x = svg.clientWidth / 2, y = svg.clientHeight / 2) {
  if (gesture) return;
  const old = view.scale; view.scale = Math.max(.01, Math.min(4, old * factor));
  view.x = x - (x - view.x) * view.scale / old; view.y = y - (y - view.y) * view.scale / old; draw();
 }
 function fit() {
  if (!diagram?.nodes.length) return;
  view.scale = 1;
  for (let pass = 0; pass < 2; pass++) {
   build(diagram); const all = [...boxes.values()];
   const left = Math.min(...all.map(box => box.x)), top = Math.min(...all.map(box => box.y));
   const w = Math.max(...all.map(box => box.x + box.w)) - left, h = Math.max(...all.map(box => box.y + box.h)) - top;
   view.scale = Math.max(.01, Math.min(pass === 1 && view.scale < .6 ? .59 : 1.2, (svg.clientWidth - 80) / w, (svg.clientHeight - 100) / h));
   view.x = (svg.clientWidth - w * view.scale) / 2 - left * view.scale; view.y = (svg.clientHeight - h * view.scale) / 2 - top * view.scale;
  }
  draw();
 }
 svg.addEventListener("wheel", event => { event.preventDefault(); const r = svg.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * .0015), event.clientX - r.left, event.clientY - r.top); }, { passive: false });
 svg.addEventListener("keydown", event => {
  if (["+", "=", "-"].includes(event.key)) { event.preventDefault(); zoom(event.key === "-" ? 1 / 1.2 : 1.2); }
  const delta = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[event.key];
  if (delta) { event.preventDefault(); view.x += delta[0]; view.y += delta[1]; draw(); }
 });
 svg.addEventListener("pointerdown", event => {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || !diagram || handlers.pinning?.()) return;
  if (!(event.target instanceof Element)) return;
  const id = event.target.closest("[data-node]")?.getAttribute("data-node"), node = diagram.nodes.find(node => node.id === id), box = boxes.get(id);
  const parent = boxes.get(node?.parent);
  gesture = { pointer: event.pointerId, x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, scale: view.scale, diagram, node, rx: box ? box.x - (parent ? parent.x + 24 : 0) : 0, ry: box ? box.y - (parent ? parent.y + 56 + (view.scale > 1.6 ? details(diagram.nodes.find(item => item.id === node.parent)).length * 18 + noteSpace(diagram, node.parent) : 0) : 0) : 0, moved: false };
  svg.setPointerCapture(event.pointerId); event.preventDefault();
 });
 svg.addEventListener("pointermove", event => {
  if (!gesture || event.pointerId !== gesture.pointer) return;
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y; gesture.moved ||= Math.hypot(dx, dy) > 3;
  if (gesture.node) {
   const preview = structuredClone(gesture.diagram), node = preview.nodes.find(node => node.id === gesture.node.id);
   node.x = gesture.rx + dx / gesture.scale; node.y = gesture.ry + dy / gesture.scale;
   gesture.position = { x: node.x, y: node.y }; draw(preview);
  } else { view.x = gesture.vx + dx; view.y = gesture.vy + dy; draw(); }
 });
 svg.addEventListener("pointerup", event => {
  if (!gesture || event.pointerId !== gesture.pointer) return;
  const done = gesture; gesture = null;
  if (done.node && done.moved && done.position) handlers.move({ entity: "node", id: done.node.id, expectedRevision: done.diagram.revision, ...done.position });
  else { if (!done.moved) selected = done.node && selected !== done.node.id ? done.node.id : null; draw(); }
 });
 for (const name of ["pointercancel", "lostpointercapture"]) svg.addEventListener(name, () => { if (gesture) { gesture = null; draw(); } });
 svg.addEventListener("click", event => {
  if (!handlers.pinning?.() || event.ctrlKey || event.metaKey) return;
  if (!(event.target instanceof Element)) return;
  const id = event.target.closest("[data-node], [data-edge]"), rect = svg.getBoundingClientRect();
  handlers.pin(id ? { element: id.getAttribute("data-node") ?? id.getAttribute("data-edge") } : { x: (event.clientX - rect.left - view.x) / view.scale, y: (event.clientY - rect.top - view.y) / view.scale });
 });
 window.addEventListener("keydown", event => { if (event.key === "Escape" && selected) { selected = null; draw(); } });
 document.fonts.ready.then(() => draw());
 return { render(data) { gesture = null; diagram = data; draw(); if (first && data.nodes.length) { first = false; fit(); } }, fit, zoom };
}
