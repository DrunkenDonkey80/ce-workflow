// Browser-only JavaScript-compatible .ts source; served without a build step.
const $ = id => document.getElementById(id);
const token = "__TOKEN__";
const target = new URL(location.href).searchParams.get("target") ?? "product";
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

// Native EventSource reconnects; the server always starts a connection with a fresh full snapshot.
const events = new EventSource("/api/events?token=" + token + "&target=" + encodeURIComponent(target));
events.addEventListener("snapshot", event => {
 const value = JSON.parse(event.data);
 state.connected = true; state.diagram = value.diagram; state.plan = value.plan; state.activity = value.activity ?? {};
 showNotice(""); renderShell();
});
events.addEventListener("activity", event => { state.activity = JSON.parse(event.data); renderShell(); });
events.addEventListener("error", () => {
 state.connected = false; renderShell();
 showNotice("Connection lost. Return to the Pi terminal and reopen the workspace. Your unsent message is still here.");
});
window.addEventListener("pagehide", () => events.close());
