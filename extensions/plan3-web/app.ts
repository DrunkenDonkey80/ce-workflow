// Browser-only JavaScript-compatible .ts source; served without a build step.
// @ts-ignore Browser URL includes the workspace token.
import { createDiagramView } from "./diagram.js?token=__TOKEN__";
const $ = id => document.getElementById(id);
const token = "__TOKEN__";
const target = new URLSearchParams(location.search).get("target") ?? "product";
const state = { connected: false, diagram: null, plan: null, activity: {} };

function showNotice(text) { $("notice").textContent = text; $("notice").hidden = !text; }
function renderShell() {
 const title = state.plan?.title ?? state.diagram?.title ?? "Architecture workspace";
 $("title").textContent = title; $("title").title = title; document.title = title + " — Plan3";
 $("target-kind").textContent = target === "product" ? "Product" : "Plan";
 $("commands").hidden = target === "product";
 $("connection").textContent = !state.connected ? "Disconnected" : state.activity.compacting ? "Compacting" : state.activity.working ? "Working" : "Idle";
 $("empty-diagram").hidden = !!state.diagram?.nodes?.length;
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
 const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "Workspace request failed."); return value;
}
const diagramView = createDiagramView($("diagram"), {
 mention(id) { const input = $("message-input"); input.value += (input.value && !/\\s$/.test(input.value) ? " " : "") + "@" + id + " "; input.focus(); },
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
