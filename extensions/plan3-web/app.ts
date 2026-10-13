// Browser-only JavaScript-compatible .ts source; served without a build step.
// @ts-ignore Browser URL includes the workspace token.
import { createDiagramView, element, seed } from "./diagram.js?token=__TOKEN__";
const $ = id => document.getElementById(id);
const token = "__TOKEN__";
const target = new URLSearchParams(location.search).get("target") ?? "product";
const state = { connected: false, diagram: null, plan: null, activity: {}, pinning: false };
let commentPoint, hoverTimer;

function showNotice(text) { $("notice").textContent = text; $("notice").hidden = !text; }
function renderShell() {
 const title = state.plan?.title ?? state.diagram?.title ?? "Architecture workspace";
 $("title").textContent = title; $("title").title = title; document.title = title + " — Plan3";
 $("target-kind").textContent = target === "product" ? "Product" : "Plan";
 $("commands").hidden = target === "product";
 $("connection").textContent = !state.connected ? "Disconnected" : state.activity.compacting ? "Compacting" : state.activity.working ? "Working" : "Idle";
 $("empty-diagram").hidden = !!(state.diagram?.nodes?.length || state.diagram?.notes?.length);
}

const splitter = $("splitter"); let resize;
function resizeChat(width) {
 const value = Math.max(280, Math.min(640, width));
 $("workspace").style.setProperty("--chat-width", value + "px");
 splitter.setAttribute("aria-valuenow", String(value));
}
splitter.addEventListener("pointerdown", event => {
 if (event.button !== 0) return;
 resize = { x: event.clientX, width: Number(splitter.getAttribute("aria-valuenow")) };
 splitter.setPointerCapture(event.pointerId); event.preventDefault();
});
splitter.addEventListener("pointermove", event => { if (resize) resizeChat(resize.width + resize.x - event.clientX); });
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) splitter.addEventListener(name, () => { resize = null; });
splitter.addEventListener("keydown", event => {
 const value = Number(splitter.getAttribute("aria-valuenow"));
 const next = { ArrowLeft: value + 10, ArrowRight: value - 10, Home: 280, End: 640 }[event.key];
 if (next === undefined) return;
 event.preventDefault(); resizeChat(next);
});

async function post(endpoint, body) {
 const response = await fetch("/api/" + endpoint, { method: "POST", credentials: "omit", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ target, ...body }) });
 const value = await response.json(); if (!response.ok) { const error = new Error(value.error ?? "Workspace request failed."); error.status = response.status; throw error; } return value;
}
function hover(id, event) {
 if (state.pinning) return;
 clearTimeout(hoverTimer);
 const data = state.diagram, targets = new Set([id]), node = data.nodes.find(node => node.id === id), edge = data.edges.find(edge => edge.id === id);
 if (node?.kind === "group") {
  for (const child of data.nodes) { let at = child; while (at?.parent) { if (at.parent === id) { targets.add(child.id); break; } at = data.nodes.find(node => node.id === at.parent); } }
  for (const link of data.edges) if (targets.has(link.from) && targets.has(link.to)) targets.add(link.id);
 }
 const notes = data.notes.filter(note => note.id === id || targets.has(note.target));
 const info = [...(node ? [node.label, node.summary, node.tech, node.details] : edge ? [edge.label || edge.id] : []), ...notes.map(note => (note.author === "user" ? "Your note" : "Agent note") + "\n" + note.text)].filter(Boolean).join("\n\n");
 if (!info) return;
 const card = $("hover-card"), canvas = $("canvas").getBoundingClientRect(), at = event.currentTarget.getBoundingClientRect();
 card.textContent = info; card.scrollTop = 0; card.dataset.notes = String(!!notes.length); card.hidden = false;
  const x = (event.clientX ?? at.x + at.width / 2) - canvas.left, y = (event.clientY ?? at.y + at.height / 2) - canvas.top;
 card.style.left = Math.max(8, x + card.offsetWidth + 12 < canvas.width ? x + 12 : x - card.offsetWidth - 12) + "px";
 card.style.top = Math.max(8, y + card.offsetHeight + 12 < canvas.height ? y + 12 : y - card.offsetHeight - 12) + "px";
}
$("diagram").addEventListener("pointerdown", () => { clearTimeout(hoverTimer); $("hover-card").hidden = true; });
function leave() { hoverTimer = setTimeout(() => { $("hover-card").hidden = true; }, 150); }
function drawNotes(stage, boxes, view, rc, data, detailY) {
 const indexes = new Map();
 const visibleBox = id => { let node = data.nodes.find(node => node.id === id); while (node && !boxes.has(node.id)) node = data.nodes.find(parent => parent.id === node.parent); return node ? boxes.get(node.id) : undefined; };
 for (const note of data.notes) {
  const node = data.nodes.find(node => node.id === note.target), edge = data.edges.find(edge => edge.id === note.target), box = visibleBox(note.target);
  const count = indexes.get(note.target) ?? 0; indexes.set(note.target, count + 1);
  let x = note.x, y = note.y;
  if (box) { x = box.x + box.w - 14 + count * 24; y = box.y + 8; }
  if (edge) { const a = visibleBox(edge.from), b = visibleBox(edge.to); if (!a || !b) continue; x = (a.x + a.w / 2 + b.x + b.w / 2) / 2; y = (a.y + a.h / 2 + b.y + b.h / 2) / 2; }
  const inline = view.scale > 1.6, w = inline ? 216 : 20, h = inline ? 100 : 20;
  if (inline && node && boxes.has(node.id)) { x = box.x + 12; y = box.y + detailY(node) + count * 116; }
  if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
  const row = element("g", { "data-note": note.id, tabindex: 0, role: "button", "aria-label": "Note: " + note.text.slice(0, 200), "aria-describedby": "hover-card" });
  row.append(rc.rectangle(x, y, w, h, { seed: seed(note.id), stroke: "#1e1e1e", strokeWidth: 1, fill: "#ffc9c9", fillStyle: "solid", roughness: .7 }));
  if (inline) {
   const body = element("foreignObject", { x, y, width: w, height: h }), text = document.createElement("div");
   text.className = "note-text"; text.textContent = note.text; body.append(text); row.append(body);
  } else row.append(element("text", { x: x + 10, y: y + 15, "text-anchor": "middle", class: "note-pin" }, "•"));
  row.addEventListener("pointerenter", event => hover(note.id, event)); row.addEventListener("focus", event => hover(note.id, event));
  row.addEventListener("pointerleave", leave); row.addEventListener("blur", leave);
  row.addEventListener("click", event => { if (event.ctrlKey || event.metaKey) insertMention(note.id); });
  row.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); insertMention(note.id); } });
  stage.append(row);
 }
}
function insertMention(id) { const input = $("message-input"); input.value += (input.value && !/\s$/.test(input.value) ? " " : "") + "@" + id + " "; input.focus(); }
function pin(point) {
 commentPoint = { ...point, expectedRevision: state.diagram.revision }; state.pinning = false; $("pin-note").setAttribute("aria-pressed", "false"); $("canvas").classList.remove("pinning");
 $("comment-purpose").textContent = point.element ? "Pin a comment to @" + point.element + "." : "Pin a comment at this canvas position.";
 $("comment-error").hidden = true; $("comment-prompt").showModal(); $("comment-text").focus(); showNotice("");
}
const diagramView = createDiagramView($("diagram"), {
 hover, leave, notes: drawNotes, pin, pinning: () => state.pinning,
 mention: insertMention,
 async move(body) {
  try { const value = await post("move", body); state.diagram = value.diagram; diagramView.render(state.diagram); showNotice(""); }
  catch (error) {
   showNotice(error.message + " Positions were not saved.");
   try {
    const response = await fetch("/api/snapshot?target=" + encodeURIComponent(target), { credentials: "omit", headers: { Authorization: "Bearer " + token } });
    const fresh = await response.json(); if (!response.ok) throw new Error(fresh.error ?? "Could not reload the diagram.");
    state.diagram = fresh.diagram;
   } catch (reloadError) { showNotice(error.message + " Positions were not saved. Reload failed: " + reloadError.message); }
   diagramView.render(state.diagram);
  }
 },
});
$("pin-note").addEventListener("click", () => {
 state.pinning = !state.pinning; $("hover-card").hidden = true; $("pin-note").setAttribute("aria-pressed", String(state.pinning)); $("canvas").classList.toggle("pinning", state.pinning);
 showNotice(state.pinning ? "Click a box, arrow or empty space to pin a note. Escape cancels." : "");
});
$("comment-cancel").addEventListener("click", () => $("comment-prompt").close());
$("comment-form").addEventListener("submit", async event => {
 event.preventDefault(); $("comment-save").disabled = true;
 try { const value = await post("comment", { ...commentPoint, text: $("comment-text").value }); state.diagram = value.diagram; diagramView.render(state.diagram); renderShell(); $("comment-prompt").close(); $("comment-text").value = ""; showNotice("Note saved."); }
 catch (error) { $("comment-error").textContent = error.message + ". Your note draft is kept."; $("comment-error").hidden = false; if (error.status === 409) commentPoint.expectedRevision = state.diagram.revision; }
 finally { $("comment-save").disabled = false; }
});
$("hover-card").addEventListener("pointerenter", () => clearTimeout(hoverTimer)); $("hover-card").addEventListener("pointerleave", leave);
window.addEventListener("keydown", event => { if (event.key === "Escape") { $("hover-card").hidden = true; if (state.pinning) { state.pinning = false; $("pin-note").setAttribute("aria-pressed", "false"); $("canvas").classList.remove("pinning"); showNotice(""); } } });
$("zoom-in").addEventListener("click", () => diagramView.zoom(1.2));
$("zoom-out").addEventListener("click", () => diagramView.zoom(1 / 1.2));
$("zoom-fit").addEventListener("click", () => diagramView.fit());

// Native EventSource reconnects; the server always starts a connection with a fresh full snapshot.
const events = new EventSource("/api/events?token=" + token + "&target=" + encodeURIComponent(target));
function applyUpdate(event, update) {
 try { update(JSON.parse(event.data)); }
 catch (error) { showNotice("Workspace update failed: " + error.message + ". Reopen from the Pi terminal; your message draft is kept."); }
}
function listen(name, update) { events.addEventListener(name, event => applyUpdate(event, update)); }
listen("snapshot", value => {
 state.connected = true; state.diagram = value.diagram; state.plan = value.plan; state.activity = value.activity ?? {};
 showNotice(""); renderShell(); diagramView.render(state.diagram);
});
listen("diagram", value => {
 if ((target === "product" && value.target.kind === "product") || value.target.id === target) { state.diagram = value.diagram; diagramView.render(state.diagram); renderShell(); }
});
listen("activity", value => { state.activity = value; renderShell(); });
events.addEventListener("error", event => {
 if (event.data) { applyUpdate(event, value => showNotice(value.message ?? "Workspace update failed.")); return; }
 state.connected = false; renderShell();
 showNotice("Connection lost. Return to the Pi terminal and reopen the workspace. Your unsent message is still here.");
});
window.addEventListener("pagehide", () => events.close());
