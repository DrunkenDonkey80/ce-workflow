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
  // Label on the longest straight run, where it has the most room.
  const at = points.slice(1).reduce((best, point, k) => { const length = Math.abs(point[0] - points[k][0]) + Math.abs(point[1] - points[k][1]); return length > best.length ? { length, x: (point[0] + points[k][0]) / 2, y: (point[1] + points[k][1]) / 2 } : best; }, { length: -1, x: 0, y: 0 });
  if (label) row.append(element("text", { x: at.x, y: at.y - 8, class: label.className, "text-anchor": "middle" }, label.text));
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
  const tops = data.nodes.filter(node => !node.parent).map(node => node.id), color = id => PALETTE[Math.max(0, tops.indexOf(top(id))) % PALETTE.length];
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
   label.forEach((text, index) => row.append(element("text", { x: box.x + 12, y: box.y + 23 + index * 20, class: "node-label" + (frame ? " group-label tone-" + PALETTE.indexOf(color(node.id)) : "") }, text)));
   if (STATUS[node.status]) row.append(element("text", { x: box.x + box.w - 8, y: box.y + 14, "text-anchor": "end", class: "status-tag" + (frame ? "" : " on-head") }, STATUS[node.status]));
   const body = near ? details(node) : !frame ? summary(node) : [];
   body.forEach((text, index) => row.append(element("text", { x: box.x + 12, y: box.y + head(node, 1, box.w) + (near ? 22 : 18) + index * (near ? 18 : 15), class: near ? "node-detail" : "node-summary" }, text)));
   if (group) row.classList.add("group-node");
   row.addEventListener("click", event => { if (event.ctrlKey || event.metaKey) handlers.mention(node.id); });
   row.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); if (handlers.pinning?.()) handlers.pin({ element: node.id }); else handlers.mention(node.id); } });
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
   const bundled = bundles.has([top(edge.from), top(edge.to)].sort().join(" ")) && top(edge.from) !== top(edge.to);
   const row = element("g", { "data-edge": edge.id, tabindex: 0, role: "button", "aria-label": (edge.label || edge.id) + ". Enter to mention." });
   if (bundled) row.classList.add("detail-edge");
   const options = { seed: seed(edge.id), stroke: "#1e1e1e", strokeWidth: 1.4, roughness: .7, strokeLineDash: edge.status === "removed" ? [5, 4] : undefined };
   if (!arrow(row, routes.get(edge.id), options, edge.label && { text: edge.label, className: "edge-label" })) continue;
   row.addEventListener("click", event => { if (event.ctrlKey || event.metaKey) handlers.mention(edge.id); });
   row.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); if (handlers.pinning?.()) handlers.pin({ element: edge.id }); else handlers.mention(edge.id); } });
   row.addEventListener("pointerenter", event => { hovered = edge.id; applyFocus(); handlers.hover?.(edge.id, event); }); row.addEventListener("focus", event => { hovered = edge.id; applyFocus(); handlers.hover?.(edge.id, event); }); row.setAttribute("aria-describedby", "hover-card");
   for (const name of ["pointerleave", "blur"]) row.addEventListener(name, () => { hovered = null; applyFocus(); handlers.leave?.(); });
   stage.append(row);
  }
  nodes.filter(node => node.kind !== "group").forEach(drawNode);
  handlers.notes?.(stage, boxes, view, rc, data, node => head(node) + 22 + details(node).length * 18);
  svg.replaceChildren(stage); hovered = null; applyFocus(); applySearch(); svg.dataset.selected = selected ?? ""; svg.dataset.revision = String(data.revision); svg.dataset.band = near ? "near" : "mid";
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
  const id = event.target.closest("[data-node]")?.getAttribute("data-node"), hit = diagram.nodes.find(node => node.id === id), box = boxes.get(id);
  // A plain drag pans the view; only Shift+drag moves a box.
  const node = event.shiftKey ? hit : undefined;
  const parent = boxes.get(node?.parent);
  gesture = { pointer: event.pointerId, x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, scale: view.scale, diagram, node, hit, boxes, rx: box ? box.x - (parent ? parent.x + 24 : 0) : 0, ry: box ? box.y - (parent ? parent.y + 56 + (view.scale > 1.6 ? details(diagram.nodes.find(item => item.id === node.parent)).length * 18 + noteSpace(diagram, node.parent) : 0) : 0) : 0, moved: false };
  svg.setPointerCapture(event.pointerId); event.preventDefault();
 });
 svg.addEventListener("pointermove", event => {
  if (!gesture || event.pointerId !== gesture.pointer) return;
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y; gesture.moved ||= Math.hypot(dx, dy) > 3;
  if (gesture.node) {
   gesture.position = { x: gesture.rx + dx / gesture.scale, y: gesture.ry + dy / gesture.scale };
   // One reroute per frame keeps the drag responsive on large diagrams.
   gesture.delta = [dx / gesture.scale, dy / gesture.scale];
   gesture.frame ??= requestAnimationFrame(() => { if (!gesture?.delta) return; gesture.frame = null; dragTo(gesture.node.id, gesture.delta[0], gesture.delta[1]); });
  } else { view.x = gesture.vx + dx; view.y = gesture.vy + dy; move(); }
 });
 svg.addEventListener("pointerup", event => {
  if (!gesture || event.pointerId !== gesture.pointer) return;
  const done = gesture; gesture = null; if (done.frame) cancelAnimationFrame(done.frame); if (done.node) built.data = null; // drop the drag preview's shifted boxes
  if (done.node && done.moved && done.position) handlers.move({ entity: "node", id: done.node.id, expectedRevision: done.diagram.revision, ...done.position });
  else if (done.node) draw();
  else if (!done.moved) { selected = done.hit && selected !== done.hit.id ? done.hit.id : null; svg.dataset.selected = selected ?? ""; applyFocus(); }
 });
 for (const name of ["pointercancel", "lostpointercapture"]) svg.addEventListener(name, () => { if (gesture) { gesture = null; built.data = null; draw(); } });
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
 return { search, render(data) {
  // A same-revision echo (save response, then the SSE broadcast) must not cancel a drag in progress.
  if (gesture && data.revision === diagram?.revision) { diagram = data; return; }
  gesture = null; diagram = data; draw(); if (first && data.nodes.length && svg.clientWidth) { first = false; fit(); } }, fit, zoom };
}
