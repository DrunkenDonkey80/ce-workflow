// Browser URL imports carry the explicit workspace capability.
// @ts-ignore Browser-only module URL.
import rough from "./vendor/rough.js?token=__TOKEN__";
// @ts-ignore Browser-only module URL.
import { layout, routeEdges } from "./layout.js?token=__TOKEN__";

import type { Diagram } from "../plan3-diagram.ts";
const NS = "http://www.w3.org/2000/svg";
export function element<K extends keyof SVGElementTagNameMap>(tag: K, attributes = {}, text = undefined) {
 const node = document.createElementNS(NS, tag);
 for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
 if (text !== undefined) node.textContent = text;
 return node;
}
// Pending-removal X: two plain SVG lines, styled red by .pending-x.
const cross = (x, y, w, h) => { const mark = element("g", { class: "pending-x" }); mark.append(element("line", { x1: x, y1: y, x2: x + w, y2: y + h }), element("line", { x1: x + w, y1: y, x2: x, y2: y + h })); return mark; };
export function seed(id) { let value = 0; for (const char of id) value = Math.imul(value, 31) + char.charCodeAt(0); return (value & 0x7fffffff) || 1; }
// One color per top-level block: [header/stroke, pale tint]; keep in sync with .tone-N in styles.css (CSP blocks inline styles). Boxes inherit their block's color; status is a small tag.
const PALETTE = [["#4c6ef5", "#edf2ff"], ["#2f9e44", "#ebfbee"], ["#e8590c", "#fff4e6"], ["#7048e8", "#f3f0ff"], ["#1098ad", "#e3fafc"], ["#d6336c", "#fff0f6"], ["#5c940d", "#f4fce3"], ["#495057", "#f1f3f5"]];
const STATUS = { new: "new", changed: "changed", removed: "removed" };

export function createDiagramView(svg: SVGSVGElement, handlers) {
 const rc = rough.svg(svg), view = { x: 32, y: 32, scale: 1 };
 const measure = document.createElement("canvas").getContext("2d");
 measure.font = "16px system-ui";
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
 function arrow(row, points, options, label, both = false) {
  if (!points || points.length < 2) return false;
  const head = ([x, y], [px, py]) => { const turn = Math.atan2(y - py, x - px); return rc.linearPath([[x - 10 * Math.cos(turn - .4), y - 10 * Math.sin(turn - .4)], [x, y], [x - 10 * Math.cos(turn + .4), y - 10 * Math.sin(turn + .4)]], options); };
  row.append(rc.linearPath(points, options), head(points.at(-1), points.at(-2)));
  if (both) row.append(head(points[0], points[1]));
  row.append(element("polyline", { points: points.join(" "), class: "edge-hit" }));
  // Label (and a pending-removal X) on the longest straight run, where it has the most room.
  const at = points.slice(1).reduce((best, point, k) => { const length = Math.abs(point[0] - points[k][0]) + Math.abs(point[1] - points[k][1]); return length > best.length ? { length, x: (point[0] + points[k][0]) / 2, y: (point[1] + points[k][1]) / 2 } : best; }, { length: -1, x: 0, y: 0 });
  if (label) row.append(element("text", { x: at.x, y: at.y - 8, class: label.className, "text-anchor": "middle" }, label.text));
  if (options.cross) row.append(cross(at.x - 8, at.y - 8, 16, 16));
  return true;
 }
 function lines(text, width, limit, font = "16px system-ui") {
  measure.font = font;
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
 // Mid zoom: up to three lines of summary (or tech) in 12px body text under the header.
 const summary = node => lines(node.summary || node.tech, 176, 3, "12px system-ui");
 const head = (node, size = 1, w = 240) => (14 + Math.min(2, lines(node.label, (w - 24) / size, 2).length) * 20) * size;
 let built = { data: null, band: "" }, routes = new Map(), bundles = new Map();
 function build(data: Diagram) {
  const near = view.scale > 1.6, band = near ? "near" : "mid";
  // Layout and routing depend only on the data and zoom band; panning and hovering reuse them.
  if (built.data === data && built.band === band) return; built = { data, band };
  const byId = new Map(data.nodes.map(node => [node.id, node]));
  const root = id => { let node = byId.get(id); while (node?.parent) node = byId.get(node.parent); return node?.id; };
  nodes = data.nodes;
  edges = data.edges.filter(edge => edge.from !== edge.to);
  boxes = layout({ nodes, edges }, node => near ? { w: 240, h: head(node) + 30 + details(node).length * 18 + noteSpace(data, node.id) } : { w: 200, h: head(node, 1, 200) + 14 + Math.max(1, summary(node).length) * 15 }, node => 32 + (near ? details(node).length * 18 + noteSpace(data, node.id) : 0));
  // Calm default: an edge that leaves a top-level group is drawn once per group pair (with a count) and
  // only appears individually while one of its ends is in focus.
  bundles = new Map();
  for (const edge of edges) {
   if (edge.edit) continue; // Pending edits always draw on their own (E-02).
   const from = root(edge.from), to = root(edge.to);
   if (from === to || from === edge.from && to === edge.to) continue;
   const key = [from, to].sort().join(" "), bundle = bundles.get(key) ?? { from, to, count: 0, both: false };
   bundle.count++; bundle.both ||= bundle.from !== from; bundles.set(key, bundle);
  }
  route();
 }
 function route() {
  routes = routeEdges(boxes, edges, nodes.filter(node => node.kind !== "group").map(node => node.id));
  for (const [id, points] of routeEdges(boxes, [...bundles].map(([id, bundle]) => ({ id, ...bundle })), nodes.filter(node => !node.parent).map(node => node.id))) bundles.get(id).points = points;
 }
 // Drag preview: the box and its children follow the pointer and only the arrows are rerouted; the drop
 // saves x, y and the next layout snaps the box into the grid cell under it.
 function dragTo(id, dx, dy) {
  const byId = new Map<string, any>(diagram.nodes.map(node => [node.id, node]));
  const moves = at => { for (let node = byId.get(at); node; node = byId.get(node.parent)) if (node.id === id) return true; return false; };
  boxes = new Map([...gesture.boxes].map(([at, box]) => [at, moves(at) ? { ...box, x: box.x + dx, y: box.y + dy } : box]));
  route(); draw();
 }
 // Pan and in-band zoom only move the stage; a full redraw (Rough.js strokes for every shape) happens only
 // when the data, zoom band or drag preview changes.
 const band = () => view.scale > 1.6 ? "near" : "mid";
 let painted = { data: null, band: "" };
 function move() {
  const stage = svg.firstElementChild;
  if (!stage || painted.data !== diagram || painted.band !== band()) return draw();
  stage.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.scale})`);
  document.getElementById("zoom-level").textContent = Math.round(view.scale * 100) + "%";
 }
 function draw(data = diagram) {
  if (!data) return;
  painted = { data, band: band() };
  const focused = document.activeElement?.getAttribute("data-node");
  build(data);
  const byId = new Map<string, any>(data.nodes.map(node => [node.id, node]));
  const top = id => { let node = byId.get(id); while (byId.has(node?.parent)) node = byId.get(node.parent); return node?.id; };
  // D7: the nearest group with a stored color wins, else the top-level block's color.
  const tops = data.nodes.filter(node => !node.parent).map(node => node.id), color = id => {
   for (let node = byId.get(id); node; node = byId.get(node.parent)) if (node.kind === "group" && Number.isInteger(node.color)) return PALETTE[node.color];
   return PALETTE[Math.max(0, tops.indexOf(top(id))) % PALETTE.length];
  };
  const stage = element("g", { transform: `translate(${view.x} ${view.y}) scale(${view.scale})` });
  const near = view.scale > 1.6;
  function drawNode(node) {
   const box = boxes.get(node.id), group = node.kind === "group";
   const row = element("g", { "data-node": node.id, tabindex: 0, role: "button", "aria-label": node.label + ", " + node.kind + ". Enter to mention; right-click to add a note; Shift+drag to move." });
   const [ink, tint] = color(node.id), frame = group, removed = node.status === "removed";
   // Open blocks are pale tinted panels; boxes are cards with a colored header and smaller body text.
   row.append(rc.rectangle(box.x, box.y, box.w, box.h, { seed: seed(node.id), roughness: .6, stroke: ink, strokeWidth: frame ? 1.2 : 1.5, strokeLineDash: frame && node.parent ? [8, 5] : undefined, fill: frame ? (node.parent ? "#ffffffaa" : tint) : removed ? "#ced4da" : "#ffffff", fillStyle: removed ? "hachure" : "solid" }));
   const label = lines(node.label, box.w - 24, 2);
   if (!frame) row.append(rc.rectangle(box.x, box.y, box.w, head(node, 1, box.w), { seed: seed(node.id) + 1, roughness: .4, stroke: ink, strokeWidth: 1, fill: ink, fillStyle: "solid" }));
   // U-04/U-05: the title band is the grab area; the label text itself opens the label dialog (U-03).
   row.append(element("rect", { x: box.x, y: box.y, width: box.w, height: head(node, 1, box.w), class: "title-band" }));
   label.forEach((text, index) => row.append(element("text", { x: box.x + 12, y: box.y + 23 + index * 20, class: "node-label" + (frame ? " group-label tone-" + PALETTE.indexOf(color(node.id)) : "") }, text)));
   if (STATUS[node.status]) row.append(element("text", { x: box.x + box.w - 8, y: box.y + 14, "text-anchor": "end", class: "status-tag" + (frame ? "" : " on-head") }, STATUS[node.status]));
   const body = near ? details(node) : !frame ? summary(node) : [];
   body.forEach((text, index) => row.append(element("text", { x: box.x + 12, y: box.y + head(node, 1, box.w) + (near ? 22 : 18) + index * (near ? 18 : 15), class: near ? "node-detail" : "node-summary" }, text)));
   if (group) row.classList.add("group-node");
   // U-04/U-06: a corner resize handle and side-midpoint connect handles, shown on hover (styles.css).
   if (handlers.resize) row.append(element("rect", { x: box.x + box.w - 7, y: box.y + box.h - 7, width: 14, height: 14, class: "resize-handle", "aria-hidden": "true" }));
   if (handlers.connect) for (const [cx, cy] of [[box.x + box.w / 2, box.y], [box.x + box.w, box.y + box.h / 2], [box.x + box.w / 2, box.y + box.h], [box.x, box.y + box.h / 2]]) row.append(element("circle", { cx, cy, r: 6, class: "connect-handle", "aria-hidden": "true" }));
   if (node.edit) {
    row.classList.add("pending", "pending-" + node.edit);
    row.append(element("rect", { x: box.x - 5, y: box.y - 5, width: box.w + 10, height: box.h + 10, rx: 6, class: "pending-outline" }));
    if (node.edit === "remove") row.append(cross(box.x, box.y, box.w, box.h));
   }
   row.addEventListener("click", event => { if (event.ctrlKey || event.metaKey) handlers.mention(node.id); });
   row.addEventListener("keydown", event => { if (event.key === "F2") { event.preventDefault(); handlers.rename?.(node.id); } if (event.key === "Enter") { event.preventDefault(); const tool = handlers.tool?.() ?? "select"; if (handlers.pinning?.()) handlers.pin({ element: node.id }); else if (tool !== "select") handlers.create({ kind: tool, parent: group ? node.id : node.parent }); else handlers.mention(node.id); } });
   // Open groups cover most of the canvas, so only a click (not hover) focuses them.
   const hoverable = !group, preview = () => { if (hoverable) { hovered = node.id; applyFocus(); } };
   row.addEventListener("pointerenter", event => { preview(); handlers.hover?.(node.id, event); });
   row.addEventListener("focus", event => { preview(); handlers.hover?.(node.id, event); }); row.setAttribute("aria-describedby", "hover-card");
   for (const name of ["pointerleave", "blur"]) row.addEventListener(name, () => { if (hoverable) { hovered = null; applyFocus(); } handlers.leave?.(); });
   stage.append(row);
  }
  nodes.filter(node => node.kind === "group").forEach(drawNode);
  for (const [key, bundle] of bundles) {
   const row = element("g", { class: "bundle-edge" });
   if (arrow(row, bundle.points, { seed: seed(key), stroke: "#868e96", strokeWidth: 1.6, roughness: .7 }, bundle.count > 1 && { text: "\u00d7" + bundle.count, className: "bundle-count" }, bundle.both)) stage.append(row);
  }
  for (const edge of edges) {
   const bundled = !edge.edit && bundles.has([top(edge.from), top(edge.to)].sort().join(" ")) && top(edge.from) !== top(edge.to);
   const row = element("g", { "data-edge": edge.id, tabindex: 0, role: "button", "aria-label": (edge.label || edge.id) + ". Enter to mention." });
   if (bundled) row.classList.add("detail-edge");
   if (edge.edit) row.classList.add("pending", "pending-" + edge.edit);
   const options = { seed: seed(edge.id), stroke: edge.edit ? "#e03131" : "#1e1e1e", strokeWidth: edge.edit ? 2 : 1.4, roughness: .7, strokeLineDash: edge.status === "removed" || edge.edit === "add" || edge.edit === "change" ? [5, 4] : undefined, cross: edge.edit === "remove" };
   if (!arrow(row, routes.get(edge.id), options, edge.label && { text: edge.label, className: "edge-label" })) continue;
   row.addEventListener("click", event => { if (event.ctrlKey || event.metaKey) handlers.mention(edge.id); });
   row.addEventListener("keydown", event => { if (event.key === "F2") { event.preventDefault(); handlers.rename?.(edge.id); } if (event.key === "Enter") { event.preventDefault(); if (handlers.pinning?.()) handlers.pin({ element: edge.id }); else handlers.mention(edge.id); } });
   row.addEventListener("pointerenter", event => { hovered = edge.id; applyFocus(); handlers.hover?.(edge.id, event); }); row.addEventListener("focus", event => { hovered = edge.id; applyFocus(); handlers.hover?.(edge.id, event); }); row.setAttribute("aria-describedby", "hover-card");
   for (const name of ["pointerleave", "blur"]) row.addEventListener(name, () => { hovered = null; applyFocus(); handlers.leave?.(); });
   stage.append(row);
  }
  nodes.filter(node => node.kind !== "group").forEach(drawNode);
  handlers.notes?.(stage, boxes, view, rc, data, node => head(node) + 22 + details(node).length * 18);
  svg.replaceChildren(stage); if (gesture?.drop) svg.querySelector(`[data-node="${gesture.drop}"]`)?.classList.add("drop-target"); hovered = null; applyFocus(); applySearch(); svg.dataset.selected = selected ?? ""; svg.dataset.revision = String(data.revision); svg.dataset.band = near ? "near" : "mid";
  document.getElementById("zoom-level").textContent = Math.round(view.scale * 100) + "%";
  if (focused) svg.querySelector<SVGElement>(`[data-node="${focused}"]`)?.focus();
 }
 function zoom(factor, x = svg.clientWidth / 2, y = svg.clientHeight / 2) {
  if (gesture) return;
  const old = view.scale, px = (x - view.x) / old, py = (y - view.y) / old, band = scale => scale > 1.6 ? 1 : 0;
  view.scale = Math.max(.01, Math.min(4, old * factor));
  view.x = x - px * view.scale; view.y = y - py * view.scale;
  // Crossing a zoom band swaps in another layout; keep the top-level box under the pointer (or nearest) where it was.
  if (diagram && band(old) !== band(view.scale)) {
   const distance = box => Math.hypot(Math.max(box.x - px, 0, px - box.x - box.w), Math.max(box.y - py, 0, py - box.y - box.h));
   const anchor = diagram.nodes.filter(node => !node.parent && boxes.has(node.id)).sort((a, b) => distance(boxes.get(a.id)) - distance(boxes.get(b.id)))[0]?.id, before = boxes.get(anchor);
   build(diagram); const after = boxes.get(anchor);
   if (before && after) { view.x = x - (after.x + (px - before.x) / before.w * after.w) * view.scale; view.y = y - (after.y + (py - before.y) / before.h * after.h) * view.scale; }
  }
  move();
 }
 function fit() {
  if (!diagram?.nodes.length) return;
  // Fit stays below the near band, so one mid layout measures it at any scale.
  view.scale = 1; build(diagram); const all = [...boxes.values()];
  const left = Math.min(...all.map(box => box.x)), top = Math.min(...all.map(box => box.y));
  const w = Math.max(...all.map(box => box.x + box.w)) - left, h = Math.max(...all.map(box => box.y + box.h)) - top;
  view.scale = Math.max(.01, Math.min(1.2, (svg.clientWidth - 80) / w, (svg.clientHeight - 100) / h));
  view.x = (svg.clientWidth - w * view.scale) / 2 - left * view.scale; view.y = (svg.clientHeight - h * view.scale) / 2 - top * view.scale;
  draw();
 }
 svg.addEventListener("wheel", event => { event.preventDefault(); const r = svg.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * .0015), event.clientX - r.left, event.clientY - r.top); }, { passive: false });
 svg.addEventListener("keydown", event => {
  if (["+", "=", "-"].includes(event.key)) { event.preventDefault(); zoom(event.key === "-" ? 1 / 1.2 : 1.2); }
  const delta = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[event.key];
  if (delta) { event.preventDefault(); view.x += delta[0]; view.y += delta[1]; move(); }
 });
 svg.addEventListener("pointerdown", event => {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || !diagram || handlers.pinning?.()) return;
  if (!(event.target instanceof Element)) return;
  const id = event.target.closest("[data-node]")?.getAttribute("data-node"), hit = diagram.nodes.find(node => node.id === id), box = boxes.get(id), tool = handlers.tool?.() ?? "select";
  const start = { pointer: event.pointerId, x: event.clientX, y: event.clientY, scale: view.scale, diagram, boxes, moved: false };
  // U-02: Box and Group tools draw; inside a group (or on one of its boxes) the new element goes in that group.
  if (tool !== "select") gesture = { ...start, draw: tool, parent: hit ? (hit.kind === "group" ? hit.id : hit.parent) : undefined, at: world(event) };
  else if (hit && event.target.matches(".connect-handle")) gesture = { ...start, connect: hit.id, at: world(event) };
  else if (hit && event.target.matches(".resize-handle")) gesture = { ...start, resize: hit.id, w: box.w, h: box.h };
  else {
   // E-04: a plain drag on a box moves it; a group moves by its title band (or Shift+drag); elsewhere the canvas pans.
   const node = hit && (hit.kind !== "group" || event.shiftKey || event.target.closest(".title-band, .node-label")) ? hit : undefined, from = origin(node?.parent);
   gesture = { ...start, vx: view.x, vy: view.y, node, hit, label: !!event.target.closest(".node-label"), edge: event.target.closest("[data-edge]")?.getAttribute("data-edge"), rx: box ? box.x - from.x : 0, ry: box ? box.y - from.y : 0 };
  }
  svg.setPointerCapture(event.pointerId); event.preventDefault();
 });
 const world = event => { const r = svg.getBoundingClientRect(); return { x: (event.clientX - r.left - view.x) / view.scale, y: (event.clientY - r.top - view.y) / view.scale }; };
 // Stored x, y are relative to the parent's content corner (padding and title, plus near-band details).
 function origin(parentId) {
  const parent = boxes.get(parentId); if (!parent) return { x: 0, y: 0 };
  return { x: parent.x + 24, y: parent.y + 56 + (view.scale > 1.6 ? details(diagram.nodes.find(item => item.id === parentId)).length * 18 + noteSpace(diagram, parentId) : 0) };
 }
 // U-05: the innermost group under the point, never the dragged element or anything inside it.
 function dropTarget(point, id) {
  const byId = new Map<string, any>(diagram.nodes.map(node => [node.id, node])), within = at => { for (let node = byId.get(at); node; node = byId.get(node.parent)) if (node.id === id) return true; return false; };
  let best, area = Infinity;
  for (const node of diagram.nodes) {
   const box = gesture.boxes.get(node.id);
   if (node.kind !== "group" || !box || within(node.id) || point.x < box.x || point.y < box.y || point.x > box.x + box.w || point.y > box.y + box.h || box.w * box.h >= area) continue;
   best = node.id; area = box.w * box.h;
  }
  return best;
 }
 const drawnRect = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
 const tone = (kind, parent) => PALETTE[kind === "group" ? handlers.groupColor?.() ?? 0 : diagram.nodes.find(node => node.id === parent)?.color ?? 7][0];
 svg.addEventListener("pointermove", event => {
  if (!gesture || event.pointerId !== gesture.pointer) return;
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y; gesture.moved ||= Math.hypot(dx, dy) > 3;
  if (gesture.draw || gesture.connect) {
   const at = world(event), stage = svg.firstElementChild;
   if (!gesture.moved || !stage) return;
   if (gesture.draw) {
    gesture.preview ??= stage.appendChild(element("rect", { class: "draw-preview", stroke: tone(gesture.draw, gesture.parent) }));
    const r = drawnRect(gesture.at, at); for (const key of ["x", "y"]) gesture.preview.setAttribute(key, String(r[key])); gesture.preview.setAttribute("width", String(r.w)); gesture.preview.setAttribute("height", String(r.h));
   } else {
    gesture.preview ??= stage.appendChild(element("line", { class: "connect-preview", x1: gesture.at.x, y1: gesture.at.y }));
    gesture.preview.setAttribute("x2", String(at.x)); gesture.preview.setAttribute("y2", String(at.y));
   }
  } else if (gesture.resize) {
   // Same bounds as the schema (D8); the preview reroutes arrows like a move.
   gesture.size = { w: Math.round(Math.min(1200, Math.max(120, gesture.w + dx / gesture.scale))), h: Math.round(Math.min(1200, Math.max(60, gesture.h + dy / gesture.scale))) };
   boxes = new Map([...gesture.boxes].map(([at, box]) => [at, at === gesture.resize ? { ...box, ...gesture.size } : box])); route(); draw();
  } else if (gesture.node) {
   gesture.position = { x: gesture.rx + dx / gesture.scale, y: gesture.ry + dy / gesture.scale };
   // One reroute per frame keeps the drag responsive on large diagrams.
   gesture.delta = [dx / gesture.scale, dy / gesture.scale]; gesture.drop = dropTarget(world(event), gesture.node.id);
   gesture.frame ??= requestAnimationFrame(() => { if (!gesture?.delta) return; gesture.frame = null; dragTo(gesture.node.id, gesture.delta[0], gesture.delta[1]); });
  } else { view.x = gesture.vx + dx; view.y = gesture.vy + dy; move(); }
 });
 svg.addEventListener("pointerup", event => {
  if (!gesture || event.pointerId !== gesture.pointer) return;
  const done = gesture; gesture = null; if (done.frame) cancelAnimationFrame(done.frame); if (done.node || done.resize) built.data = null; // drop the drag preview's shifted boxes
  done.preview?.remove();
  if (done.draw) {
   // A drag smaller than the schema minimum counts as a click: default size at the press point.
   const r = drawnRect(done.at, world(event)), drawn = done.moved && r.w >= 120 && r.h >= 60, at = drawn ? r : done.at, from = origin(done.parent);
   // D13: a drawn group adopts every box whose center is inside it.
   const adopt = drawn && done.draw === "group" ? diagram.nodes.filter(node => { const box = boxes.get(node.id); return node.kind !== "group" && box && box.x + box.w / 2 > r.x && box.x + box.w / 2 < r.x + r.w && box.y + box.h / 2 > r.y && box.y + box.h / 2 < r.y + r.h; }).map(node => node.id) : [];
   handlers.create({ kind: done.draw, parent: done.parent, x: Math.round(at.x - from.x), y: Math.round(at.y - from.y), ...(drawn ? { w: Math.round(Math.min(1200, r.w)), h: Math.round(Math.min(1200, r.h)) } : {}), adopt });
  } else if (done.connect) {
   // Pointer capture retargets the event to the svg, so hit-test the release point; itself or a duplicate adds nothing.
   const to = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-node]")?.getAttribute("data-node");
   if (done.moved && to && to !== done.connect && !diagram.edges.some(edge => edge.from === done.connect && edge.to === to)) handlers.connect({ from: done.connect, to });
  } else if (done.resize) { if (done.moved && done.size) handlers.resize?.({ id: done.resize, expectedRevision: done.diagram.revision, ...done.size }); else draw(); }
  else if (done.node && done.moved && done.position) {
   // D11: a different drop group (or the bare canvas) is a reparent; inside the same parent it only pins the position.
   if ((done.drop ?? "") !== (done.node.parent ?? "")) handlers.reparent({ id: done.node.id, parent: done.drop });
   else handlers.move({ entity: "node", id: done.node.id, expectedRevision: done.diagram.revision, ...done.position });
  }
  else if (done.moved && done.node) draw();
  else if (!done.moved && done.label && done.hit) handlers.rename?.(done.hit.id);
  else if (!done.moved && done.edge) handlers.rename?.(done.edge);
  else if (!done.moved) { selected = done.hit && selected !== done.hit.id ? done.hit.id : null; svg.dataset.selected = selected ?? ""; applyFocus(); }
 });
 for (const name of ["pointercancel", "lostpointercapture"]) svg.addEventListener(name, () => { if (gesture) { gesture.preview?.remove(); gesture = null; built.data = null; draw(); } });
 svg.addEventListener("click", event => {
  if (!handlers.pinning?.() || event.ctrlKey || event.metaKey) return;
  if (!(event.target instanceof Element)) return;
  const id = event.target.closest("[data-node], [data-edge]"), rect = svg.getBoundingClientRect();
  handlers.pin(id ? { element: id.getAttribute("data-node") ?? id.getAttribute("data-edge") } : { x: (event.clientX - rect.left - view.x) / view.scale, y: (event.clientY - rect.top - view.y) / view.scale });
 });
 window.addEventListener("keydown", event => { if (event.key === "Escape" && selected) { selected = null; svg.dataset.selected = ""; applyFocus(); } });
 // Right-click on a box, arrow or note starts a note on it in the chat composer.
 svg.addEventListener("contextmenu", event => {
  const target = event.target instanceof Element && event.target.closest("[data-node], [data-edge], [data-note]");
  if (!target) return;
  event.preventDefault(); handlers.note?.(target.getAttribute("data-node") ?? target.getAttribute("data-edge") ?? target.getAttribute("data-note"));
 });
 // Search highlights matching boxes (label, id, summary, tech, details) and the blocks that contain them.
 let query = "", found = [], cursor = -1;
 function applySearch() {
  svg.classList.toggle("searching", !!query);
  for (const item of svg.querySelectorAll(".match, .match-parent")) item.classList.remove("match", "match-parent");
  if (!query || !diagram) { found = []; return; }
  const byId = new Map<string, any>(diagram.nodes.map(node => [node.id, node])), shown = id => { let node = byId.get(id); while (node && !boxes.has(node.id)) node = byId.get(node.parent); return node?.id; };
  const hits = diagram.nodes.filter(node => [node.id, node.label, node.summary, node.tech, node.details].some(text => String(text ?? "").toLowerCase().includes(query)));
  found = [...new Set(hits.map(node => shown(node.id)).filter(Boolean))];
  for (const id of found) {
   svg.querySelector(`[data-node="${id}"]`)?.classList.add("match");
   for (let parent = byId.get(id)?.parent; byId.has(parent); parent = byId.get(parent).parent) svg.querySelector(`[data-node="${parent}"]`)?.classList.add("match-parent");
  }
 }
 document.fonts.ready.then(() => draw());
 function search(text, next = false) {
  query = text.trim().toLowerCase(); applySearch();
  if (!next || !found.length) { cursor = -1; return found.length; }
  // Enter pans to the next match.
  cursor = (cursor + 1) % found.length; const box = boxes.get(found[cursor]);
  view.x = svg.clientWidth / 2 - (box.x + box.w / 2) * view.scale; view.y = svg.clientHeight / 2 - (box.y + box.h / 2) * view.scale; move();
  return found.length;
 }
 return { search, selected: () => selected, render(data) {
  // A same-revision echo (save response, then the SSE broadcast) must not cancel a drag in progress.
  if (gesture && data.revision === diagram?.revision) { diagram = data; return; }
  gesture = null; diagram = data; draw(); if (first && data.nodes.length && svg.clientWidth) { first = false; fit(); } }, fit, zoom };
}
