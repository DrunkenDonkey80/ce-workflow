// Browser-only source; the server strips erasable types without a build step.
import type { Diagram } from "../plan3-diagram.ts";
import type { createActivityMirror } from "../plan3-web.ts";
// @ts-ignore Browser URL includes the workspace token.
import { createDiagramView, element, seed } from "./diagram.js?token=__TOKEN__";
// @ts-ignore Browser URL includes the workspace token.
import { createFilesView } from "./files.js?token=__TOKEN__";
// @ts-ignore Browser URL includes the workspace token.
import { createPromptView } from "./prompts.js?token=__TOKEN__";
// @ts-ignore Browser URL includes the workspace token.
import { applyText } from "./stream.js?token=__TOKEN__";
function $(id: "message-input" | "comment-text"): HTMLTextAreaElement;
function $(id: "send" | "stop" | "comment-save" | "model-button" | "context-button" | "bias-button" | "generate"): HTMLButtonElement;
function $(id: "comment-prompt" | "prompt"): HTMLDialogElement;
function $(id: "composer" | "comment-form" | "prompt-form"): HTMLFormElement;
function $(id: "diagram"): SVGSVGElement;
function $(id: "search"): HTMLInputElement;
function $(id: string): HTMLElement;
function $(id: string): HTMLElement | SVGSVGElement { return document.getElementById(id); }
// Empty on the tailnet host (D21): remote pages authenticate with the same-origin device cookie.
const token = "__TOKEN__";
const auth: RequestInit = token ? { credentials: "omit", headers: { Authorization: "Bearer " + token } } : { credentials: "same-origin", headers: {} };
let target = new URLSearchParams(location.search).get("target") ?? undefined;
type Model = { provider: string; id: string; name: string };
type Plan = { id: string; title: string; done?: number; total?: number; focus?: string; bias?: number; open?: number; planning?: boolean; finishable?: boolean };
const state: { connected: boolean; diagram: Diagram | null; plan: Plan | null; status: { model: Model | null; effort: string | null; context?: number | null; folder?: string; tab?: string } | null; activity: Partial<ReturnType<ReturnType<typeof createActivityMirror>["snapshot"]> & { thinkingLength: number }>; pinning: boolean; more: boolean } = { connected: false, diagram: null, plan: null, status: null, activity: {}, pinning: false, more: false };
let commentPoint, hoverTimer, messageSending = false, commandSending = false;
const chat = new Map();

const BIAS_LABEL = { "-2": "Work:Plan", "-1": "Work:Task", 0: "Normal", 1: "Think:Task", 2: "Think:Plan" };
// Progress-bar buttons: fill to percent, coloured by footer tone (accent, success, warning, error, dim).
function setBar(item: HTMLElement, percent: number, tone: string) {
 item.style.setProperty("--fill", Math.max(0, Math.min(100, percent)) + "%"); item.dataset.tone = tone;
}
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
// Confirmations (brief) fade after ~1.5 s; errors and hints stay until replaced.
function showNotice(text, brief = false) { clearTimeout(noticeTimer); $("notice").textContent = text; $("notice").hidden = !text; if (brief && text) noticeTimer = setTimeout(() => showNotice(""), 1500); }
function renderShell() {
 // "<folder> - <herdr tab>", plus ": <plan>" on phones, where the plan bar sits in the drawer.
 const status = state.status, plan = state.plan, head = [status?.folder, status?.tab].filter(Boolean).join(" - ");
 const title = [head, matchMedia("(max-width: 899px)").matches ? plan?.title ?? state.diagram?.title : ""].filter(Boolean).join(": ") || plan?.title || "Architecture workspace";
 $("title").textContent = title; $("title").title = title;
 // Cheap cue for a backgrounded tab (D20): a waiting answer shows in the tab title.
 document.title = promptView.busy || state.activity.dialog ? "(!) " + title + " needs an answer" : title + " — Plan3";
 // D19 status line. Line 1: [model: effort] [Context: n%] [💡 bias]; line 2: the plan as a progress bar (or New plan).
 const effort = status?.effort ? status.effort[0].toUpperCase() + status.effort.slice(1) : "—";
 $("model-button").textContent = (status?.model?.name ?? "Model") + ": " + effort;
 $("context-button").textContent = "Context: " + (typeof status?.context === "number" ? Math.round(status.context) + "%" : "—");
 $("bias-button").textContent = "💡 " + (BIAS_LABEL[plan?.bias ?? 0] ?? "Normal");
 for (const id of ["model-button", "context-button"] as const) $(id).disabled = !state.connected;
 $("bias-button").disabled = !state.connected || !plan;
 // The plan bar names the plan; only the title part truncates, the count stays visible.
 $("plan-button").replaceChildren(Object.assign(document.createElement("span"), { className: "bar-text", textContent: plan?.title ?? "New plan" }), ...plan?.total ? [Object.assign(document.createElement("span"), { className: "bar-count", textContent: `${plan.done ?? 0}/${plan.total}` })] : []);
 $("plan-button").title = plan ? plan.title + " — plan actions" : "Start a new plan";
 setBar($("plan-button"), plan?.total ? (plan.done ?? 0) / plan.total * 100 : 0, "accent");
 for (const button of $("plan-menu").querySelectorAll<HTMLElement>("[data-plan]")) button.hidden = !plan;
 // Session modes: chips toggle them; the chat panel takes the mode's colour.
 const modes = (status as { modes?: { research?: string; night?: string } })?.modes ?? {}, research = modes.research ?? "off", night = modes.night ?? "off";
 $("mode-research").setAttribute("aria-pressed", String(research !== "off")); $("mode-research").textContent = research === "stopping" ? "Research: stopping" : "Research"; $("mode-research").dataset.tone = research === "stopping" ? "warning" : "";
 $("mode-night").setAttribute("aria-pressed", String(night !== "off")); $("mode-night").textContent = night === "paused" ? "Night: paused" : night === "complete" ? "Night: done" : "Night"; $("mode-night").dataset.tone = night === "paused" || night === "complete" ? "warning" : "";
 for (const id of ["mode-research", "mode-night"] as const) ($(id) as HTMLButtonElement).disabled = !state.connected || messageSending;
 $("chat").dataset.mode = research === "stopping" || (research === "off" && ["paused", "complete"].includes(night)) ? "warning" : research !== "off" || night !== "off" ? "accent" : "";
 // Research mode: Resolve (n) / Review / Finish / Resume, each enabled only when the plan allows it (the /plans3 menu gates).
 $("plan-actions").hidden = research === "off" || !plan;
 if (plan) {
  $("plan-actions").querySelector("[data-command=resolve]").textContent = plan.open ? "Resolve (" + plan.open + ")" : "Resolve";
  ($("review-button") as HTMLButtonElement).disabled = !state.connected || commandSending || promptView.busy || !!state.activity.working;
 }
 // Background subagents keep the session busy after the main run settles.
 const helpers = state.activity.subagents?.length ?? 0;
 $("connection").textContent = !state.connected ? "Disconnected" : state.activity.compacting ? "Compacting" : state.activity.working ? "Working\u2026" : helpers ? "Subagents\u2026" : "Idle";
 $("connection").dataset.state = !state.connected ? "off" : state.activity.working || state.activity.compacting || helpers ? "working" : "idle";
 // Row buttons are also gated by the plan state (no Resume while the plan is still being planned).
 const blocked = { resolve: !plan?.open, finish: !plan?.finishable, resume: !!plan?.planning };
 for (const button of document.querySelectorAll<HTMLButtonElement>("#plan-menu [data-command], #plan-actions [data-command]")) button.disabled = !state.connected || commandSending || promptView.busy || (!!state.activity.working && "plan" in button.dataset) || (button.parentElement?.id === "plan-actions" && !!blocked[button.dataset.command]);
 $("send").disabled = !state.connected || messageSending; $("send").textContent = state.activity.working ? "Queue" : "Send";
 $("stop").hidden = !state.activity.working; $("stop").disabled = !state.connected;
 const waiting = state.connected && state.activity.dialog && !promptView.busy ? "Pi is waiting for a terminal dialog: " + state.activity.dialog : "";
 $("waiting").textContent = waiting; $("waiting").hidden = !waiting;
}

function renderActivity() {
 const root = $("activity"), data = state.activity, opened = new Map([...root.querySelectorAll("details")].map(item => [item.dataset.id, item.open]));
 const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text = undefined, className = "") => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item; };
 const section = (id, title, open = false) => { const item = make("details"); item.dataset.id = id; item.open = opened.get(id) ?? open; item.append(make("summary", title)); root.append(item); return item; };
 root.replaceChildren();
 if (data.compacting) root.append(make("p", "Compacting session history…", "activity-status"));
 if (data.interrupted) root.append(make("p", "Run interrupted.", "activity-status"));
 for (const run of data.subagents ?? []) root.append(make("p", ["Subagent " + run.label, run.state, run.turns === undefined ? "" : run.turns + " turns", run.tools === undefined ? "" : run.tools + " tools", run.tool ?? ""].filter(Boolean).join(" \u00b7 "), "activity-status"));
 if (data.error) { const error = make("p", data.error, "activity-error"); error.setAttribute("role", "alert"); root.append(error); }
 if (data.thinking) { const thinking = section("thinking", "Thinking"); thinking.className = "thinking-row"; thinking.append(make("pre", data.thinking)); }
 // Only the running run's calls show here; finished calls stay inside the chat rows, so the reply is the last thing shown.
 const tools = data.working ? data.tools ?? [] : [];
 for (const tool of tools) {
  const row = section(tool.id, tool.name + " · " + tool.state + (tool.durationMs === undefined ? "" : " · " + Math.round(tool.durationMs) + " ms"));
  row.className = "tool-row tool-" + (tool.state === "error" ? "error" : tool.state === "done" ? "ok" : "pending") + (tool.parent ? " nested-tool" : "");
  for (const [label, text] of [["Arguments", tool.args], ["Progress", tool.progress], ["Result", tool.result]]) if (text) { row.append(make("strong", label), make("pre", text)); }
 }
 if (data.queue?.length || data.hasPendingMessages) {
  const queue = section("queue", "Observed queued messages", true);
  queue.append(make("p", "May be stale; edit or cancel the real queue in Pi.", "activity-caution"));
  for (const item of data.queue ?? []) queue.append(make("p", item.delivery + ": " + item.text));
 }
 if (tools.length) root.append(make("p", "Text-only excerpts; custom tool renderers and images stay in Pi.", "activity-caution"));
 pinChat();
}

// R7: full split, narrowed to the chat's width, or collapsed to >>; the choice and tab survive reloads.
const workspace = $("workspace"), remembered = (key, values, fallback) => { try { const value = localStorage.getItem(key); return values.includes(value) ? value : fallback; } catch { return fallback; } };
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
function setLeft(mode) {
 workspace.dataset.left = mode; remember("plan3-left", mode);
 $("expand-left").hidden = mode !== "collapsed";
 $("narrow-left").setAttribute("aria-pressed", String(mode === "narrow")); $("narrow-left").textContent = mode === "narrow" ? "Widen" : "Narrow";
 for (const id of ["expand-left", "collapse-left"]) $(id).setAttribute("aria-expanded", String(mode !== "collapsed"));
}
// Project and Plan tabs share one canvas; each keeps its own diagram (T-01). state.diagram is the shown one.
type DiagramTab = "project" | "plan";
let diagramTab: DiagramTab = "plan";
const diagrams: Record<DiagramTab, Diagram | null> = { project: null, plan: null };
const planTarget = () => target && target !== "product" ? target : undefined;
const diagramTarget = () => diagramTab === "project" ? "product" : planTarget();
const LEFT_TABS = ["files", "project", "plan"];
function renderDiagram(refit = false) {
 state.diagram = diagrams[diagramTab];
 diagramView.render(state.diagram ?? { nodes: [], edges: [], notes: [], revision: 0 } as unknown as Diagram);
 if (refit && $("diagram").clientWidth) diagramView.fit();
 $("empty-diagram").textContent = diagramTab === "project" ? "No project diagram yet. Generate one, or draw with the bar above." : planTarget() ? "This plan has no diagram yet. Draw one with the bar above, or Generate." : "No plan is open.";
 $("empty-diagram").hidden = !!(state.diagram?.nodes?.length || state.diagram?.notes?.length);
}
function setDiagram(tab: DiagramTab, value: Diagram | null, refit = false) {
 diagrams[tab] = value;
 if (tab === diagramTab) { renderDiagram(refit); renderMentions(); renderShell(); }
}
function setTab(name) {
 if (name === "diagram") name = "plan"; // remembered from before the Project/Plan split
 for (const view of LEFT_TABS) { const selected = view === name; $("tab-" + view).setAttribute("aria-selected", String(selected)); $("tab-" + view).tabIndex = selected ? 0 : -1; }
 $("files").hidden = name !== "files"; $("canvas").hidden = name === "files"; $("canvas").setAttribute("aria-labelledby", "tab-" + name);
 $("zoom-controls").hidden = $("edit-bar").hidden = name === "files";
 if (name === "files") setTool("select");
 remember("plan3-tab", name);
 if (name === "files") { filesView.shown(); return; }
 diagramTab = name; renderDiagram(true);
 // Before the first snapshot the chat helpers are not ready; the snapshot renders them.
 if (state.connected) { renderMentions(); renderShell(); }
}
$("narrow-left").addEventListener("click", () => setLeft(workspace.dataset.left === "narrow" ? "full" : "narrow"));
$("collapse-left").addEventListener("click", () => { setLeft("collapsed"); $("expand-left").focus(); });
$("expand-left").addEventListener("click", () => { setLeft("full"); $("collapse-left").focus(); });
for (const [index, view] of LEFT_TABS.entries()) {
 $("tab-" + view).addEventListener("click", () => setTab(view));
 $("tab-" + view).addEventListener("keydown", event => {
  const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: LEFT_TABS.length - 1 }[event.key]; if (next === undefined) return;
  event.preventDefault(); const name = LEFT_TABS[(next + LEFT_TABS.length) % LEFT_TABS.length]; setTab(name); $("tab-" + name).focus();
 });
}
setLeft(remembered("plan3-left", ["full", "narrow", "collapsed"], "full"));
// R9 phones: one view at a time; Files and Diagram reuse the desktop tab panels.
const mobileViews = ["chat", "files", "project", "plan"];
function setMobile(view) {
 workspace.dataset.mobile = view === "chat" ? "chat" : "panel";
 for (const name of mobileViews) { const tab = $("mobile-" + name); tab.setAttribute("aria-selected", String(name === view)); tab.tabIndex = name === view ? 0 : -1; }
 if (view !== "chat") setTab(view);
 remember("plan3-mobile", view);
}
for (const name of mobileViews) {
 $("mobile-" + name).addEventListener("click", () => { setMobile(name); setDrawer(false); });
 $("mobile-" + name).addEventListener("keydown", event => {
  const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key]; if (!step) return;
  event.preventDefault(); const next = mobileViews[(mobileViews.indexOf(name) + step + mobileViews.length) % mobileViews.length]; setMobile(next); $("mobile-" + next).focus();
 });
}
// Phones: views, status line and sessions move into the drawer so the chat gets the screen; desktop puts them back.
const phone = matchMedia("(max-width: 899px)"), drawer = $("drawer");
const homes = [["mobile-tabs", "drawer-views"], ["status-line", "drawer-status"], ["session-list", "title-menu"], ["connection", "topbar"]]
 .map(([id, slot]) => { const node = id === "status-line" || id === "topbar" ? document.querySelector("." + id)! : $(id); return { node, slot: slot === "topbar" ? document.querySelector(".topbar")! : $(slot), parent: node.parentNode!, next: node.nextSibling }; });
function placeForPhone() {
 for (const home of homes) if (phone.matches) home.slot.append(home.node); else home.parent.insertBefore(home.node, home.next);
 if (!phone.matches) setDrawer(false);
 ($("message-input") as HTMLTextAreaElement).rows = phone.matches ? 4 : 6;
}
function setDrawer(open: boolean) {
 drawer.dataset.open = String(open); drawer.inert = !open; $("drawer-backdrop").hidden = !open;
 $("drawer-toggle").setAttribute("aria-expanded", String(open)); $("drawer-toggle").setAttribute("aria-label", open ? "Close menu" : "Open menu");
 if (open) { drawer.querySelector<HTMLElement>("[aria-selected=true]")?.focus(); void loadUsage(); }
}
phone.addEventListener("change", () => { placeForPhone(); renderShell(); }); placeForPhone();
$("drawer-toggle").addEventListener("click", () => setDrawer(drawer.dataset.open !== "true"));
$("drawer-backdrop").addEventListener("click", () => setDrawer(false));
drawer.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); setDrawer(false); $("drawer-toggle").focus(); } });
// Swipe right from the left edge opens; swipe left anywhere closes.
let swipe: { x: number; y: number; edge: boolean } | undefined;
document.addEventListener("touchstart", event => { const t = event.touches[0]; swipe = phone.matches && event.touches.length === 1 ? { x: t.clientX, y: t.clientY, edge: t.clientX < 24 } : undefined; }, { passive: true });
document.addEventListener("touchend", event => {
 const t = event.changedTouches[0]; if (!swipe || !t) return;
 const dx = t.clientX - swipe.x, flat = Math.abs(dx) > 2 * Math.abs(t.clientY - swipe.y);
 if (flat && dx > 60 && swipe.edge) setDrawer(true); else if (flat && dx < -60 && drawer.dataset.open === "true") setDrawer(false);
 swipe = undefined;
}, { passive: true });
// iOS keeps the layout viewport under the on-screen keyboard; size the page to what is visible so the composer stays reachable.
const fitViewport = () => document.documentElement.style.setProperty("--app-height", (window.visualViewport?.height ?? window.innerHeight) + "px");
window.visualViewport?.addEventListener("resize", fitViewport); fitViewport();

// The top bar sizes Think and the usage bars to the chat panel below them.
new ResizeObserver(() => document.body.style.setProperty("--chat-px", $("chat").offsetWidth + "px")).observe($("chat"));
const splitter = $("splitter"); let resize;
// The chat width survives reloads and restarts.
queueMicrotask(() => { try { const saved = Number(localStorage.getItem("plan3-chat-width")); if (saved) resizeChat(saved); } catch { /* private mode */ } });
function resizeChat(width) {
 const value = Math.max(280, Math.min(640, width));
 $("workspace").style.setProperty("--chat-width", value + "px"); remember("plan3-chat-width", String(value));
 splitter.setAttribute("aria-valuenow", String(value));
}
splitter.addEventListener("pointerdown", event => {
 if (event.button !== 0) return;
 resize = { x: event.clientX, width: Number(splitter.getAttribute("aria-valuenow")) };
 splitter.setPointerCapture(event.pointerId); event.preventDefault();
});
// In the narrow state the shared width belongs to the left panel, so dragging runs the other way.
const direction = () => workspace.dataset.left === "narrow" ? -1 : 1;
splitter.addEventListener("pointermove", event => { if (resize) resizeChat(resize.width + (resize.x - event.clientX) * direction()); });
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) splitter.addEventListener(name, () => { resize = null; });
splitter.addEventListener("keydown", event => {
 const value = Number(splitter.getAttribute("aria-valuenow"));
 const next = { ArrowLeft: value + 10 * direction(), ArrowRight: value - 10 * direction(), Home: 280, End: 640 }[event.key];
 if (next === undefined) return;
 event.preventDefault(); resizeChat(next);
});

async function get(endpoint) {
 const response = await fetch("/api/" + endpoint, auth);
 const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "Workspace request failed."); return value;
}
async function loadDiagram(tab: DiagramTab, refit = false) {
 const id = tab === "project" ? "product" : planTarget();
 if (!id) { setDiagram(tab, null); return; }
 try { const value = await get("diagram?target=" + encodeURIComponent(id)); if (id === (tab === "project" ? "product" : planTarget())) setDiagram(tab, value.diagram, refit); }
 catch (error) { showNotice("Diagram failed to load: " + error.message); }
}
// Check-in rows are excerpts; the full row loads when the reader asks for it.
const loading = new Set();
async function loadRow(id) {
 if (loading.has(id)) return; loading.add(id);
 try { chat.set(id, await get("row?id=" + encodeURIComponent(id))); renderChat(); } catch (error) { showNotice(error.message); } finally { loading.delete(id); }
}
async function post(endpoint, body) {
 const response = await fetch("/api/" + endpoint, { ...auth, method: "POST", headers: { ...auth.headers, "Content-Type": "application/json" }, body: JSON.stringify({ target, ...body }) });
 const value = await response.json(); if (!response.ok) { throw Object.assign(new Error(value.error ?? "Workspace request failed."), { status: response.status }); } return value;
}
function hover(id, _event) {
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
 // Shown in a fixed spot over the top of the chat pane, so it never covers the diagram under the pointer.
 const card = $("hover-card"), chat = $("chat").getBoundingClientRect();
 card.textContent = info; card.scrollTop = 0; card.dataset.notes = String(!!notes.length); card.hidden = false;
 card.style.left = chat.left + 8 + "px"; card.style.top = chat.top + 8 + "px"; card.style.width = chat.width - 16 + "px";
}
$("diagram").addEventListener("pointerdown", () => { clearTimeout(hoverTimer); $("hover-card").hidden = true; });
function leave() { clearTimeout(hoverTimer); $("hover-card").hidden = true; }
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
// Right-click: the note popup adds "@id: note" as a line of the message, so several notes and a closing request go to the agent together.
let draftFor = "";
function openNote(title, purpose, save) { $("comment-title").textContent = title; $("comment-purpose").textContent = purpose; $("comment-save").textContent = save; $("comment-error").hidden = true; $("comment-prompt").showModal(); $("comment-text").focus(); }
function startNote(id) { draftFor = id; labelFor = null; $("comment-label").textContent = "Note"; openNote("Note on @" + id, "Adds a line to your message. Add more notes, then send them together.", "Add to message"); }
function insertMention(id) { const input = $("message-input"); input.value += (input.value && !/\s$/.test(input.value) ? " " : "") + "@" + id + " "; input.focus(); renderMentions(); }
// E-03 editing bar: a non-Select tool turns diagram clicks into edits (through the same click hook notes use).
let tool = "select", groupColor = 0, connectFrom = "", labelFor = null;
function setTool(name) {
 tool = name; connectFrom = ""; document.querySelector(".connect-from")?.classList.remove("connect-from");
 for (const button of document.querySelectorAll("#edit-bar [data-tool]")) button.setAttribute("aria-pressed", String(button.getAttribute("data-tool") === name));
 $("canvas").classList.toggle("editing", name !== "select");
 showNotice({ box: "Click empty space or a group to add a box.", group: "Click empty space or a group to add a group.", connect: "Click the box the connection starts from.", delete: "Click a box, group or connection to delete it." }[name] ?? "");
}
// Toolbar chat lines join the message like note lines; the user sends them together (R7). Each remembers its
// diagram and the ids it touches (A2), so undoing a pending add drops exactly its lines and Send scopes their context.
let editLines = [];
const lineIds = line => [...line.matchAll(/\(@([a-z][a-z0-9_]*)\)/g)].map(match => match[1]);
function addEditLine(line, target, added) {
 const input = $("message-input");
 input.value = input.value.trimEnd() ? input.value.trimEnd() + "\n" + line + "\n" : line + "\n"; renderMentions();
 editLines.push({ line, target, ids: [...new Set([...lineIds(line), ...added])] });
}
// Drops the lines about removed ids, leaving the user's own typing (and identical hand-typed lines past the first) alone.
function dropEditLines(target, removed) {
 const input = $("message-input"), gone = editLines.filter(item => item.target === target && item.ids.some(id => removed.includes(id)));
 if (!gone.length) return;
 const rows = input.value.split("\n");
 for (const item of gone) { const at = rows.indexOf(item.line); if (at >= 0) rows.splice(at, 1); }
 editLines = editLines.filter(item => !gone.includes(item));
 input.value = rows.join("\n").replace(/^\n+/, ""); if (input.value.trim() === "") input.value = ""; renderMentions();
}
const itemIds = data => new Set(data ? [...data.nodes, ...data.edges, ...data.notes].map(item => item.id) : []);
async function applyEdit(edit) {
 const tab = diagramTab, id = diagramTarget(), before = itemIds(state.diagram);
 try {
  const value = await post("edit", { target: id, expectedRevision: state.diagram?.revision ?? 0, edit }); setDiagram(tab, value.diagram);
  // D5: deleting an unsent add undoes it, so its lines go too instead of a Delete line.
  if (value.removed?.length) dropEditLines(id, value.removed);
  else if (value.line) addEditLine(value.line, id, [...itemIds(value.diagram)].filter(item => !before.has(item)));
  return true;
 }
 catch (error) { showNotice(error.message); if (error.status === 409) try { setDiagram(tab, (await get("diagram?target=" + encodeURIComponent(id))).diagram); } catch { /* the notice already explains */ } return false; }
}
function editAt(point) {
 const node = state.diagram?.nodes.find(node => node.id === point.element);
 if (tool === "box" || tool === "group") {
  if (point.element && !node) return showNotice("Click empty space or a group.");
  const parent = node ? (node.kind === "group" ? node.id : node.parent) : undefined;
  labelFor = { kind: tool, ...(parent ? { parent } : {}), ...(tool === "group" ? { color: groupColor } : {}), ...(point.element ? {} : { x: Math.round(point.x), y: Math.round(point.y) }) };
  draftFor = ""; $("comment-label").textContent = "Label";
  openNote(tool === "box" ? "New box" : "New group", parent ? "Inside @" + parent + "." : "On the canvas.", tool === "box" ? "Add box" : "Add group");
 } else if (tool === "connect") {
  if (!node) return showNotice("Connections join boxes or groups; click one.");
  if (!connectFrom) { connectFrom = node.id; $("diagram").querySelector(`[data-node="${node.id}"]`)?.classList.add("connect-from"); return showNotice("Now click the box to connect @" + node.id + " to."); }
  const from = connectFrom; connectFrom = ""; void applyEdit({ kind: "connect", from, to: node.id }).then(() => showNotice("Click the box the next connection starts from."));
 } else if (tool === "delete" && point.element) void applyEdit({ kind: "delete", id: point.element });
}
for (const button of document.querySelectorAll("#edit-bar [data-tool]")) button.addEventListener("click", () => setTool(button.getAttribute("data-tool")));
// G-01: the directions prompt arrives through the shared dialog race; this request settles once it is answered.
$("generate").addEventListener("click", async () => {
 const button = $("generate"); button.disabled = true;
 try { const result = await post("generate", { target: diagramTarget() }); showNotice(result.cancelled ? "Generate cancelled; nothing saved." : "Directions saved; the agent is updating the diagram.", true); }
 catch (error) { showNotice(error.message); }
 finally { button.disabled = false; }
});
for (const swatch of document.querySelectorAll("#edit-bar [data-color]")) swatch.addEventListener("click", () => {
 groupColor = Number(swatch.getAttribute("data-color"));
 // With Select and a group selected, a swatch recolors that group.
 const picked = state.diagram?.nodes.find(node => node.id === diagramView.selected());
 if (tool === "select" && picked?.kind === "group") void applyEdit({ kind: "recolor", id: picked.id, color: groupColor });
 for (const other of document.querySelectorAll("#edit-bar [data-color]")) other.setAttribute("aria-pressed", String(other === swatch));
});
function pin(point) {
 if (tool !== "select") return editAt(point);
 commentPoint = { ...point, target: diagramTarget(), expectedRevision: state.diagram.revision }; state.pinning = false; $("pin-note").setAttribute("aria-pressed", "false"); $("canvas").classList.remove("pinning");
 draftFor = ""; labelFor = null; $("comment-label").textContent = "Note"; openNote("Add a note", point.element ? "Pin a comment to @" + point.element + "." : "Pin a comment at this canvas position.", "Save note"); showNotice("");
}
const diagramView = createDiagramView($("diagram"), {
 hover, leave, notes: drawNotes, pin, pinning: () => state.pinning || tool !== "select",
 mention: insertMention, note: startNote,
 // E-04: rename opens the label dialog pre-filled; resize is layout only (no chat line).
 rename(id) {
  const item = [...state.diagram.nodes, ...state.diagram.edges].find(item => item.id === id); if (!item) return;
  labelFor = { kind: "rename", id }; draftFor = ""; $("comment-label").textContent = "Label";
  openNote("Rename @" + id, "Changes the label; the agent sees it as a pending edit.", "Rename"); $("comment-text").value = item.label ?? ""; $("comment-text").select();
 },
 resize(body) { void applyEdit({ kind: "resize", id: body.id, w: body.w, h: body.h }); },
 async move(body) {
  const tab = diagramTab, id = diagramTarget();
  try { const value = await post("move", { ...body, target: id }); setDiagram(tab, value.diagram); showNotice(""); }
  catch (error) {
   showNotice(error.message + " Positions were not saved.");
   try {
    setDiagram(tab, (await get("diagram?target=" + encodeURIComponent(id))).diagram);
   } catch (reloadError) { showNotice(error.message + " Positions were not saved. Reload failed: " + reloadError.message); diagramView.render(state.diagram); }
  }
 },
});
$("pin-note").addEventListener("click", () => {
 state.pinning = !state.pinning; $("hover-card").hidden = true; $("pin-note").setAttribute("aria-pressed", String(state.pinning)); $("canvas").classList.toggle("pinning", state.pinning);
 showNotice(state.pinning ? "Click a box, arrow or empty space to pin a note. Escape cancels." : "");
});
$("comment-cancel").addEventListener("click", () => $("comment-prompt").close());
$("comment-text").addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); $("comment-form").requestSubmit(); } });
$("comment-form").addEventListener("submit", async event => {
 event.preventDefault();
 if (labelFor) {
  const label = $("comment-text").value.trim(); if (!label) return;
  $("comment-save").disabled = true;
  try { if (await applyEdit({ ...labelFor, label })) { $("comment-prompt").close(); $("comment-text").value = ""; labelFor = null; } }
  finally { $("comment-save").disabled = false; }
  return;
 }
 if (draftFor) {
  const input = $("message-input"), line = "@" + draftFor + ": " + $("comment-text").value.trim();
  input.value = input.value.trimEnd() ? input.value.trimEnd() + "\n" + line + "\n" : line + "\n";
  $("comment-prompt").close(); $("comment-text").value = ""; input.focus(); input.setSelectionRange(input.value.length, input.value.length); renderMentions();
  return;
 }
 $("comment-save").disabled = true;
 try { const value = await post("comment", { ...commentPoint, text: $("comment-text").value }); setDiagram(commentPoint.target === "product" ? "project" : "plan", value.diagram); $("comment-prompt").close(); $("comment-text").value = ""; showNotice("Note saved."); }
 catch (error) { $("comment-error").textContent = error.message + ". Your note draft is kept."; $("comment-error").hidden = false; if (error.status === 409) commentPoint.expectedRevision = state.diagram.revision; }
 finally { $("comment-save").disabled = false; }
});
$("hover-card").addEventListener("pointerenter", () => clearTimeout(hoverTimer)); $("hover-card").addEventListener("pointerleave", leave);
window.addEventListener("keydown", event => { if (event.key === "Escape") { $("hover-card").hidden = true; if (tool !== "select" && !$("comment-prompt").open) setTool("select"); if (state.pinning) { state.pinning = false; $("pin-note").setAttribute("aria-pressed", "false"); $("canvas").classList.remove("pinning"); showNotice(""); } } });
$("zoom-in").addEventListener("click", () => diagramView.zoom(1.2));
$("zoom-out").addEventListener("click", () => diagramView.zoom(1 / 1.2));
$("zoom-fit").addEventListener("click", () => diagramView.fit());
const filesView = createFilesView($("files"), { get });
// /plan3 architecture links open on the Project tab.
setTab(target === "product" ? "project" : remembered("plan3-tab", [...LEFT_TABS, "diagram"], "plan"));
{ const view = remembered("plan3-mobile", [...mobileViews, "diagram"], "chat"); setMobile(view === "diagram" ? "plan" : view); }
$("search").addEventListener("input", () => { const count = diagramView.search($("search").value); $("search-count").textContent = $("search").value.trim() ? String(count) : ""; });
$("search").addEventListener("keydown", event => {
 if (event.key === "Enter") { event.preventDefault(); diagramView.search($("search").value, true); }
 if (event.key === "Escape") { $("search").value = ""; diagramView.search(""); $("search-count").textContent = ""; $("diagram").focus(); }
});
// Ctrl+F searches the diagram instead of the page.
window.addEventListener("keydown", event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); $("search").focus(); $("search").select(); } });

const promptView = createPromptView($("prompt"), $("prompt-form"), post, showNotice);
// Pi-like rows: text stays visible; thinking and each tool call are one collapsed line that expands on click.
function renderBlocks(box: HTMLElement, row) {
 const opened = new Set([...box.querySelectorAll<HTMLDetailsElement>("details[open]")].map(item => item.dataset.key));
 const known = new Set([...box.querySelectorAll<HTMLDetailsElement>("details")].map(item => item.dataset.key));
 box.replaceChildren();
 (row.blocks ?? []).forEach((block, index) => {
  const item = document.createElement("details"), summary = document.createElement("summary"), key = block.id ?? "thinking_" + index;
  // Pi's tool colours: grey while running, green when done, red on error.
  item.dataset.key = key; item.open = opened.has(key) || (!known.has(key) && block.type === "tool" && (block.name === "edit" || block.name === "write")); item.className = "block block-" + block.type + (block.type === "tool" ? block.error ? " block-error" : block.result === undefined ? " block-pending" : " block-ok" : "");
  if (block.type === "thinking") summary.textContent = "Thinking";
  else summary.append(Object.assign(document.createElement("b"), { textContent: block.name }), block.title.slice(block.name.length) + (block.result === undefined ? (row.streaming ? "" : " \u2026") : block.error ? " \u2715" : ""));
  item.append(summary);
  // An edit's diff (or a write's content as added lines) replaces its raw arguments.
  for (const text of block.type === "thinking" ? [block.text] : [block.diff ? undefined : block.args, block.result].filter(value => value !== undefined)) { const pre = document.createElement("pre"); pre.textContent = text; item.append(pre); }
  if (block.diff) {
   const pre = document.createElement("pre"); pre.className = "diff";
   for (const line of block.diff.split("\n")) pre.append(Object.assign(document.createElement("span"), { textContent: line + "\n", className: line[0] === "+" ? "diff-add" : line[0] === "-" ? "diff-del" : "" }));
   item.append(pre);
  }
  box.append(item);
 });
}
const atBottom = (list: HTMLElement) => list.scrollHeight - list.scrollTop - list.clientHeight < 48;
// Scrolling near the top loads earlier rows (no button).
// Stay pinned to the newest output until the reader scrolls away. Only scrolling changes this: the activity rows above
// growing, images loading or the keyboard opening shrink or grow the list without a scroll event, and must not unpin it.
let stick = true;
// Explicit jumps re-pin at once; the scroll event that would do it arrives a frame later.
function toBottom() { stick = true; pinChat(); $("to-bottom").hidden = true; }
const pinChat = () => { const list = $("feed"); if (stick) list.scrollTop = list.scrollHeight; };
// Only moving up unpins: a late scroll event after content grew below finds the list off the end without the reader moving.
let lastTop = 0;
$("feed").addEventListener("scroll", () => { const list = $("feed"); if (atBottom(list)) stick = true; else if (list.scrollTop < lastTop - 2) stick = false; lastTop = list.scrollTop; if (stick) $("to-bottom").hidden = true; if (list.scrollTop < 48 && state.more) void loadEarlier(); });
new ResizeObserver(pinChat).observe($("feed"));
$("feed").addEventListener("load", pinChat, true);
$("messages").addEventListener("click", event => { const id = (event.target as HTMLElement).closest<HTMLElement>("[data-full]")?.dataset.full; if (id) void loadRow(id); });
// Opening a thinking/tool block of an excerpt row loads its bodies.
$("messages").addEventListener("toggle", event => { const item = (event.target as HTMLElement).closest<HTMLLIElement>("li"); const row = chat.get(item?.dataset.id); if ((event.target as HTMLDetailsElement).open && (row?.excerpt || row?.brief)) void loadRow(item.dataset.id); }, true);
let loadingEarlier = false;
async function loadEarlier() {
 if (loadingEarlier) return; loadingEarlier = true;
 try {
  const first = chat.keys().next().value, page = await get("rows" + (first ? "?before=" + encodeURIComponent(first) : ""));
  const rows = [...page.rows, ...chat.values()]; chat.clear(); for (const row of rows) chat.set(row.id, row);
  state.more = page.more; const list = $("feed"), height = list.scrollHeight; renderChat(); list.scrollTop += list.scrollHeight - height;
 } catch (error) { showNotice(error.message); } finally { loadingEarlier = false; }
}
$("to-bottom").addEventListener("click", () => toBottom());
function renderChat() {
 const list = $("messages"), feed = $("feed"), follow = stick;
 const encoder = new TextEncoder();
 while (chat.size > 100 || [...chat.values()].reduce((bytes, row) => bytes + encoder.encode(row.text).length, 0) > 512000) chat.delete(chat.keys().next().value);
 for (const item of list.querySelectorAll<HTMLLIElement>(":scope > li")) if (!chat.has(item.dataset.id)) item.remove();
 let previous: HTMLLIElement | null = null;
 for (const row of chat.values()) {
  let item = [...list.querySelectorAll<HTMLLIElement>(":scope > li")].find(item => item.dataset.id === row.id);
  if (!item) { item = document.createElement("li"); item.dataset.id = row.id; const full = document.createElement("button"); full.type = "button"; full.className = "row-full"; full.textContent = "Show full message"; full.dataset.full = row.id; item.append(document.createElement("strong"), document.createElement("div"), document.createElement("div"), document.createElement("small"), full); }
  // Keep server order, also for rows inserted above by loadEarlier.
  if (!item.isConnected || item.previousElementSibling !== previous) { if (previous) previous.after(item); else list.prepend(item); }
  previous = item;
  const json = JSON.stringify(row); if (item.dataset.json === json) continue; item.dataset.json = json;
  const text = row.text.trim(), note = row.error ?? (row.truncated ? "Excerpt; full history stays in Pi." : row.streaming && !row.blocks?.length ? "Streaming…" : "");
  // A turn with only thinking/tool calls is a compact block list without the "Agent" header; an empty one is hidden.
  item.className = "message " + row.role + (text ? "" : " message-blocks"); item.hidden = !text && !row.blocks?.length && !note;
  // Rows are told apart by colour (user block vs plain agent text); the label stays for screen readers.
  item.children[0].textContent = text ? (row.role === "user" ? "You:" : "Agent:") : ""; item.children[0].className = "sr-only";
  renderBlocks(item.children[1] as HTMLElement, row); renderLinks(item.children[2] as HTMLElement, row.text);
  item.children[3].textContent = note; (item.children[4] as HTMLElement).hidden = !row.excerpt;
 }
 // Follow new output only while the reader is at the bottom; otherwise offer a jump button.
 if (follow) feed.scrollTop = feed.scrollHeight; else if (feed.scrollHeight > feed.clientHeight) $("to-bottom").hidden = false;
}
// Image and Markdown paths in chat text become links: images open full size and show as thumbnails
// (pasted or terminal Alt+V images too); .md opens in the Files tab. The server limits images to the project and temp folder.
// shortcut: paths with spaces are not detected; quote-aware parsing if that matters.
const LINKED_PATH = /(?<![\w:/\\.-])(?:[A-Za-z]:[\\/]|\/)?(?:[^\s"'`<>|*?()[\]:\\/]+[\\/])*[^\s"'`<>|*?()[\]:\\/]+\.(?:png|jpe?g|gif|webp|md)(?![\w-])/gi;
function renderLinks(target: HTMLElement, text: string) {
 target.replaceChildren(); let at = 0; const images = new Set<string>();
 for (const match of text.matchAll(LINKED_PATH)) {
  const path = match[0], image = !/\.md$/i.test(path);
  target.append(text.slice(at, match.index)); at = match.index + path.length;
  const link = Object.assign(document.createElement("a"), { textContent: path, className: "chat-link", href: image ? imageSource(path) : "#" });
  if (image) { link.target = "_blank"; link.rel = "noopener"; images.add(path); }
  else link.addEventListener("click", event => { event.preventDefault(); setTab("files"); filesView.open(path); if (matchMedia("(max-width: 899px)").matches) setMobile("files"); });
  target.append(link);
 }
 target.append(text.slice(at));
 for (const path of [...images].slice(0, 6)) {
  const link = Object.assign(document.createElement("a"), { href: imageSource(path), target: "_blank", rel: "noopener", className: "thumb" });
  link.append(Object.assign(document.createElement("img"), { src: imageSource(path), alt: path, loading: "lazy" })); target.append(link);
 }
}
const imageSource = (path: string) => "/api/image?path=" + encodeURIComponent(path) + (token ? "&token=" + token : "");
const mentioned = () => [...new Set([...$("message-input").value.matchAll(/(?<![\w@])@([a-z][a-z0-9_]{0,47})(?![A-Za-z0-9_])/g)].map(match => match[1]))];
function renderMentions() {
 const data = state.diagram, all = [...(data?.nodes ?? []), ...(data?.edges ?? []), ...(data?.notes ?? [])]; $("mentions").replaceChildren();
 for (const id of mentioned()) { const entity = all.find(item => item.id === id), chip = document.createElement("span"); chip.className = "mention-chip"; chip.textContent = "@" + id + (entity ? "" : " (not found)"); chip.title = "No matching element; sent as text."; if (entity && "label" in entity) chip.title = entity.label ?? chip.title; if (entity && "text" in entity) chip.title = entity.text; $("mentions").append(chip); }
}
$("message-input").addEventListener("input", renderMentions);
// Clipboard and attached images become temp files (like Pi's terminal paste); the chat gets their path.
$("message-input").addEventListener("paste", event => {
 const file = [...(event.clipboardData?.items ?? [])].find(item => item.type.startsWith("image/"))?.getAsFile(); if (!file) return;
 event.preventDefault(); void attach(file);
});
$("attach").addEventListener("change", () => { const input = $("attach") as HTMLInputElement, file = input.files?.[0]; input.value = ""; if (file) void attach(file); });
async function attach(file: File) {
 showNotice("Saving image\u2026");
 try {
  const response = await fetch("/api/paste", { ...auth, method: "POST", headers: { ...auth.headers, "Content-Type": file.type }, body: file });
  const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "Image paste failed.");
  const input = $("message-input"), at = input.selectionStart; input.setRangeText((at && !/\s/.test(input.value[at - 1]) ? " " : "") + value.path + " ", at, input.selectionEnd, "end"); input.scrollTop = input.scrollHeight; input.focus(); toBottom(); renderMentions(); showNotice("Image saved: " + value.path, true);
 } catch (error) { showNotice(error.message); }
}
// Typing "/name" or "/wo sub" lists matching commands; arrows move, Tab/Enter picks, Escape closes.
type SlashItem = { value: string; description: string };
let slashCommands: Promise<{ pi: { name: string; description: string }[]; wo: SlashItem[]; args?: Record<string, SlashItem[]> }> | undefined, slashPick = 0;
async function updateSlash() {
 const input = $("message-input") as HTMLTextAreaElement, menu = $("slash-menu"), value = input.value;
 const match = input.selectionStart === value.length ? /^\/(?:([\w-]+) (\S*(?: \S*)?)|(\S*))$/.exec(value) : null;
 if (!match) { menu.hidden = true; return; }
 slashCommands ??= get("commands").catch(error => { slashCommands = undefined; throw error; });
 let list; try { list = await slashCommands; } catch { menu.hidden = true; return; }
 if (input.value !== value) return;
 const rows = match[1] ? (list.args?.[match[1]] ?? []).filter(item => item.value.startsWith(match[2]) && item.value !== match[2]).map(item => [`/${match[1]} ${item.value}`, item.description])
  : list.pi.filter(item => item.name.startsWith(match[3])).map(item => ["/" + item.name, item.description]);
 slashPick = Math.min(slashPick, Math.max(0, rows.length - 1));
 menu.replaceChildren(...rows.map(([command, description], index) => {
  const option = document.createElement("div"); option.className = "slash-option"; option.setAttribute("role", "option"); option.dataset.command = command; option.setAttribute("aria-selected", String(index === slashPick));
  option.append(Object.assign(document.createElement("strong"), { textContent: command }), Object.assign(document.createElement("small"), { textContent: description }));
  option.addEventListener("mousedown", event => { event.preventDefault(); pickSlash(command); });
  return option;
 }));
 menu.hidden = !rows.length;
}
function pickSlash(command: string) {
 const input = $("message-input") as HTMLTextAreaElement; input.value = command + " "; input.focus(); input.setSelectionRange(input.value.length, input.value.length);
 slashPick = 0; $("slash-menu").hidden = true; renderMentions(); void updateSlash(); // "/plan3 " opens its arguments
}
$("message-input").addEventListener("input", () => { slashPick = 0; void updateSlash(); });
$("message-input").addEventListener("blur", () => { $("slash-menu").hidden = true; });
$("message-input").addEventListener("keydown", event => {
 const menu = $("slash-menu"); if (menu.hidden) return;
 const options = [...menu.children] as HTMLElement[], step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
 if (step) { slashPick = (slashPick + step + options.length) % options.length; options.forEach((option, index) => option.setAttribute("aria-selected", String(index === slashPick))); options[slashPick].scrollIntoView({ block: "nearest" }); }
 else if ((event.key === "Tab" || event.key === "Enter") && !event.shiftKey) pickSlash(options[slashPick].dataset.command);
 else if (event.key === "Escape") menu.hidden = true;
 else return;
 event.preventDefault(); event.stopImmediatePropagation();
});
// Terminal parity: Enter sends, Shift+Enter adds a line, Escape stops a running agent.
$("message-input").addEventListener("keydown", event => {
 if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); $("composer").requestSubmit(); }
 if (event.key === "Escape" && !$("stop").hidden && !$("stop").disabled) { event.preventDefault(); $("stop").click(); }
});
$("composer").addEventListener("submit", async event => {
 event.preventDefault(); if (messageSending || !state.connected) return;
 const text = $("message-input").value; if (!text.trim()) return;
 // Toolbar lines still in the message carry their diagram's context, grouped per diagram (A2).
 const sent = editLines.filter(item => text.split("\n").includes(item.line)), parts = new Map();
 for (const item of sent) parts.set(item.target, [...new Set([...(parts.get(item.target) ?? []), ...item.ids])]);
 messageSending = true; renderShell();
 // Sending jumps to the newest message; later rows keep following from the bottom.
 toBottom();
 try { const result = await post("message", { text, target: diagramTarget() ?? target, ...(parts.size ? { diagrams: [...parts].map(([target, ids]) => ({ target, ids })) } : {}) }); editLines = editLines.filter(item => !sent.includes(item)); if ($("message-input").value === text) $("message-input").value = ""; renderMentions(); showNotice(result.queued ? "Message queued as a follow-up." : "Message sent.", true); }
 catch (error) { showNotice(error.message + ". Your message draft is kept."); }
 finally { messageSending = false; renderShell(); }
});
// Menus: one open at a time; Escape or a click elsewhere closes and returns focus to its button.
const menus = [["review-button", "review-menu"], ["model-button", "model-menu"], ["context-button", "context-menu"], ["bias-button", "bias-menu"], ["plan-button", "plan-menu"], ["usage-button", "usage-menu"], ["title", "title-menu"]];
function toggleMenu(button: string, menu: string, open = $(menu).hidden) {
 for (const [other, panel] of menus) if (open && other !== button && !$(panel).hidden) toggleMenu(other, panel, false);
 $(menu).hidden = !open; $(button).setAttribute("aria-expanded", String(open));
 // Under its button, kept inside the window.
 if (open && $(menu).parentElement === $(button).parentElement?.closest(".status-line")) { const own = $(button).getBoundingClientRect(), line = $(menu).parentElement.getBoundingClientRect(); $(menu).style.left = Math.max(0, Math.min(own.left, innerWidth - $(menu).offsetWidth - 8) - line.left) + "px"; }
 if (open) ($(menu).querySelector<HTMLElement>("input, button:not([hidden]):not(:disabled)"))?.focus();
}
function closeMenus(focus = false) {
 for (const [button, menu] of menus) if (!$(menu).hidden) { toggleMenu(button, menu, false); if (focus) $(button).focus(); }
}
document.addEventListener("keydown", event => { if (event.key === "Escape" && menus.some(([, menu]) => !$(menu).hidden)) { event.stopPropagation(); closeMenus(true); } }, true);
document.addEventListener("pointerdown", event => { if (!(event.target as Element).closest?.(".status-line, #title, #title-menu, #plan-actions")) closeMenus(); });
// The title opens the session picker: a popup on phones, the switcher stripe on desktop.
$("title").addEventListener("click", () => phone.matches ? toggleMenu("title", "title-menu") : !$("switcher").hidden && toggleSwitcher($("switcher").dataset.open !== "true"));
function newPlan() {
 setDrawer(false); const input = $("message-input"); input.value = "/plan3 "; input.focus(); input.setSelectionRange(input.value.length, input.value.length);
 showNotice("Describe the plan after /plan3 and send.");
}
// Plan menu: open plans on top (the shown one marked, the session's current one labelled), a divider, then actions.
$("plan-button").addEventListener("click", async () => {
 if (!$("plan-menu").hidden) return toggleMenu("plan-button", "plan-menu", false);
 toggleMenu("plan-button", "plan-menu", true);
 try {
  const { plans, current } = await get("plans") as { plans: { id: string; title: string; done?: number; total?: number }[]; current: string | null };
  $("plan-list").replaceChildren(...plans.map(item => {
   const pick = Object.assign(document.createElement("button"), { type: "button", className: "plan-option", textContent: item.title + (item.total ? ` · ${item.done ?? 0}/${item.total}` : "") + (item.id === current ? " (current)" : "") });
   pick.setAttribute("aria-pressed", String(item.id === target));
   pick.addEventListener("click", () => { if (item.id === target) return closeMenus(); const url = new URL(location.href); url.searchParams.set("target", item.id); location.assign(url); });
   return pick;
  }));
  $("plan-divider").hidden = !plans.length;
 } catch (error) { $("plan-list").replaceChildren("Plans failed to load: " + error.message); }
});
$("review-button").addEventListener("click", () => toggleMenu("review-button", "review-menu"));
// Plan commands go through /api/command with the shown plan (a typed "/plan3 review <id>" would not name the plan).
for (const button of document.querySelectorAll<HTMLElement>("#plan-menu [data-command], #plan-actions [data-command]")) button.addEventListener("click", async () => {
 const command = button.dataset.command; closeMenus(); setDrawer(false);
 if (command === "new") return newPlan();
 if (commandSending) return; commandSending = true; renderShell();
 try {
  await post("command", { command }); showNotice("");
 }
 catch (error) { showNotice(error.message); }
 finally { commandSending = false; renderShell(); }
});
// Mode chips run the same commands as the terminal; the next status event redraws them.
async function toggleMode(text: string) {
 if (messageSending) return; messageSending = true; renderShell();
 try { await post("message", { text }); } catch (error) { showNotice(error.message); } finally { messageSending = false; renderShell(); }
}
$("mode-research").addEventListener("click", () => void toggleMode("/research " + ($("mode-research").getAttribute("aria-pressed") === "true" ? "off" : "on")));
$("mode-night").addEventListener("click", () => void toggleMode("/night " + ($("mode-night").getAttribute("aria-pressed") === "true" ? "off" : "on")));
// D18 switcher: other shared sessions on this PC, colour-coded; links work remotely, where one paired cookie covers every port.
type Session = { id: string; name: string; cwd: string; port: number; state: "working" | "waiting" | "idle"; revision: number; unseen: boolean };
let sessionsTimer = 0;
async function loadSessions() {
 clearTimeout(sessionsTimer);
 if (document.visibilityState !== "visible") return;
 try {
  const { sessions } = await get("sessions") as { sessions: Session[] }, own = sessions.find(session => session.port === Number(location.port || (location.protocol === "https:" ? 443 : 80)));
  // Seen is per device on the server (D21): looking at an idle session marks its last run seen.
  if (own?.unseen && own.state === "idle") {
   const response = await fetch("/api/seen", { ...auth, method: "POST", headers: { ...auth.headers, "Content-Type": "application/json" }, body: JSON.stringify({ revision: own.revision }) });
   if (response.ok) own.unseen = false;
  }
  renderSessions(sessions, own);
 } catch { $("switcher").hidden = true; document.body.classList.remove("has-switcher"); }
 sessionsTimer = window.setTimeout(loadSessions, 5000);
}
function renderSessions(sessions: Session[], own: Session | undefined) {
 const show = sessions.length > 0; $("switcher").hidden = !show; document.body.classList.toggle("has-switcher", show);
 $("session-list").replaceChildren(...sessions.map(session => {
  const tone = session.state === "idle" ? (session.unseen ? "unseen" : "seen") : session.state, words = { working: "working", waiting: "waiting for an answer", unseen: "idle, new activity", seen: "idle" }[tone];
  const folder = session.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? session.cwd;
  const item = document.createElement(token || session === own ? "span" : "a");
  if (item instanceof HTMLAnchorElement) item.href = `${location.protocol}//${location.hostname}:${session.port}/`;
  else if (session !== own) item.title = "Open it from its own terminal link; switching needs a paired remote device.";
  item.className = "session"; item.dataset.tone = tone; item.dataset.port = String(session.port);
  if (session === own) item.setAttribute("aria-current", "page");
  item.append(Object.assign(document.createElement("span"), { className: "session-letter", textContent: (session.name.trim()[0] ?? "?").toUpperCase() }),
   Object.assign(document.createElement("span"), { className: "session-label", textContent: session.name }));
  item.title ||= `${session.name} · ${words}`;
  item.setAttribute("aria-label", `${session.name} in ${folder}, ${words}${session === own ? ", this session" : ""}`);
  return item;
 }));
}
// Desktop session bar: open by default; collapsing to the letter stripe is remembered.
function toggleSwitcher(open: boolean) { localStorage.setItem("plan3-switcher", open ? "open" : "closed"); document.body.classList.toggle("switcher-open", open); $("switcher").dataset.open = String(open); $("switcher-toggle").setAttribute("aria-expanded", String(open)); $("switcher-toggle").setAttribute("aria-label", open ? "Hide shared sessions" : "Show shared sessions"); }
$("switcher-toggle").addEventListener("click", () => toggleSwitcher($("switcher").dataset.open !== "true"));
$("switcher").addEventListener("keydown", event => { if (event.key === "Escape" && $("switcher").dataset.open === "true") { event.stopPropagation(); toggleSwitcher(false); $("switcher-toggle").focus(); } });
toggleSwitcher(localStorage.getItem("plan3-switcher") !== "closed");
document.addEventListener("visibilitychange", () => void loadSessions());
void loadSessions();
// Subscription 7d left per provider (footer data); tapping shows the footer rows in their colours.
type Segment = { text: string; color?: string };
let usageLines: Segment[][] = [], usageTimer = 0;
// Footer rows become one block per provider (│) with one line per item (·); bar glyphs become equal-height cells.
function usageBlocks(rows: Segment[][]) {
 const lines: HTMLElement[] = []; let line: HTMLElement;
 const start = (provider: boolean) => { line = document.createElement("div"); line.className = "usage-line" + (provider ? " provider" : ""); lines.push(line); };
 for (const row of rows) {
  start(true);
  for (const part of row) for (const [index, piece] of part.text.split(/ (│|·) /).entries()) {
   if (index % 2) { start(piece === "│"); continue; }
   const span = Object.assign(document.createElement("span"), { className: part.color ? "tone-" + part.color : "" });
   for (const chunk of piece.split(/([█░]+)/)) if (/^[█░]+$/.test(chunk)) span.append(...[...chunk].map(cell => Object.assign(document.createElement("span"), { className: cell === "█" ? "cell" : "cell off" }))); else if (chunk) span.append(chunk);
   line.append(span);
  }
 }
 return lines;
}
async function loadUsage() {
 clearTimeout(usageTimer); if (document.visibilityState !== "visible") return;
 try {
  const value = await get("usage") as { summary: { label: string; left: number; color: string }[]; lines: Segment[][] };
  usageLines = value.lines; $("usage-button").hidden = !value.summary.length;
  // One bar per provider: filled to the 7d share left, coloured like the footer.
  $("usage-button").replaceChildren(...value.summary.map(item => { const bar = Object.assign(document.createElement("span"), { className: "bar", textContent: item.label + " 7d " + item.left + "%" }); setBar(bar, item.left, item.color); return bar; }));
 } catch { $("usage-button").hidden = true; }
 usageTimer = window.setTimeout(loadUsage, 120_000);
}
$("usage-button").addEventListener("click", () => {
 $("usage-menu").replaceChildren(...usageBlocks(usageLines));
 toggleMenu("usage-button", "usage-menu");
});
document.addEventListener("visibilitychange", () => void loadUsage());
void loadUsage();
// Pi and /wo command pickers (drawer, phones): a pick goes into the composer for review before sending.
async function pickCommand(kind: "pi" | "wo") {
 setDrawer(false); const dialog = $("command-picker") as HTMLDialogElement, list = $("command-list");
 list.replaceChildren("Loading commands…"); $("command-title").textContent = kind === "pi" ? "Pi commands" : "/wo commands"; dialog.showModal();
 try {
  const value = await get("commands") as { pi: { name: string; description: string }[]; wo: { value: string; description: string }[] };
  const rows = kind === "pi" ? value.pi.map(item => ["/" + item.name, item.description]) : value.wo.map(item => ["/wo " + item.value, item.description]);
  list.replaceChildren(...rows.length ? rows.map(([command, description]) => {
   const button = document.createElement("button"); button.type = "button"; button.className = "command-option";
   button.append(Object.assign(document.createElement("strong"), { textContent: command }), Object.assign(document.createElement("small"), { textContent: description }));
   button.addEventListener("click", () => { dialog.close(); const input = $("message-input"); input.value = command + " "; input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
   return button;
  }) : ["No commands available."]);
 } catch (error) { list.replaceChildren("Commands failed to load: " + error.message); }
}
$("pi-commands").addEventListener("click", () => void pickCommand("pi"));
$("wo-commands").addEventListener("click", () => void pickCommand("wo"));
$("command-close").addEventListener("click", () => ($("command-picker") as HTMLDialogElement).close());
async function changeStatus(endpoint: "model" | "effort", body) {
 closeMenus(); if (drawer.dataset.open === "true") setDrawer(false); else $("model-button").focus();
 try { state.status = { ...state.status, ...await post(endpoint, body) }; renderShell(); showNotice(""); } catch (error) { showNotice(error.message); }
}
$("model-button").addEventListener("click", async () => {
 if (!$("model-menu").hidden) return toggleMenu("model-button", "model-menu", false);
 const menu = $("model-menu"); menu.replaceChildren("Loading models…"); toggleMenu("model-button", "model-menu", true);
 try {
  const value = await get("models"), current = value.model;
  const option = (model: Model) => {
   const button = document.createElement("button"); button.type = "button"; button.className = "model-option"; button.textContent = model.name; button.title = model.provider + "/" + model.id;
   button.setAttribute("aria-pressed", String(current?.provider === model.provider && current?.id === model.id));
   button.addEventListener("click", () => changeStatus("model", { provider: model.provider, id: model.id })); return button;
  };
  // Thinking level on one line (Low / Mid / High, plus the current one if different), then scoped models only
  // (Pi's Ctrl+P set); all available models when nothing is scoped.
  const efforts = Object.assign(document.createElement("div"), { className: "effort-row" });
  efforts.append(...["low", "medium", "high", ...(["low", "medium", "high"].includes(value.effort) || !value.effort ? [] : [value.effort])].map(level => {
   const button = Object.assign(document.createElement("button"), { type: "button", textContent: level === "medium" ? "Mid" : level[0].toUpperCase() + level.slice(1) }); button.dataset.level = level;
   button.setAttribute("aria-pressed", String(level === value.effort)); button.addEventListener("click", () => changeStatus("effort", { level })); return button;
  }));
  menu.replaceChildren(efforts, ...(value.scoped.length ? value.scoped : value.others).map(option));
  (menu.querySelector<HTMLElement>(".model-option[aria-pressed=true]") ?? menu.querySelector<HTMLElement>(".model-option, button"))?.focus();
 } catch (error) { menu.replaceChildren("Models failed to load: " + error.message); }
});
$("context-button").addEventListener("click", () => toggleMenu("context-button", "context-menu"));
// Compact runs /wo compact, which uses the compaction method chosen in /wo settings.
$("compact-now").addEventListener("click", async () => {
 closeMenus(); setDrawer(false);
 try { await post("message", { text: "/wo compact" }); showNotice("Compaction requested.", true); } catch (error) { showNotice(error.message); }
});
$("bias-button").addEventListener("click", () => {
 const menu = $("bias-menu"), current = state.plan?.bias ?? 0;
 menu.replaceChildren(...[2, 1, 0, -1, -2].map(level => {
  const button = Object.assign(document.createElement("button"), { type: "button", textContent: BIAS_LABEL[level] }); button.dataset.level = String(level);
  button.setAttribute("aria-pressed", String(level === current));
  button.addEventListener("click", async () => {
   closeMenus(); setDrawer(false);
   try { await post("bias", { level }); showNotice(""); } catch (error) { showNotice(error.message); }
  });
  return button;
 }));
 toggleMenu("bias-button", "bias-menu");
});
$("stop").addEventListener("click", async () => { try { await post("stop", {}); showNotice("Stop requested.", true); } catch (error) { showNotice(error.message); } });

// The server starts every connection with a fresh full snapshot. Native EventSource stops for good on an HTTP error
// (503 while Pi reloads), so the page reconnects itself with backoff and reloads when the build changed.
let events: EventSource, build = "", retryDelay = 1000, retryTimer = 0;
const handlers: [string, (value) => void][] = [];
function applyUpdate(event: MessageEvent, update) {
 try { update(JSON.parse(event.data)); }
 catch (error) { showNotice("Workspace update failed: " + error.message + ". Reopen from the Pi terminal; your message draft is kept."); }
}
function listen(name, update) { handlers.push([name, update]); }
listen("files", () => filesView.changed(!$("files").hidden));
listen("status", value => { state.status = value; renderShell(); });
// Plan events always describe Pi's current plan. When Pi switches plans, the page follows it,
// unless the reader picked another plan in the menu: that view stays until Pi switches again.
let currentPlan: string | null = null;
listen("plan", value => {
 if (value.id !== target && value.id !== currentPlan) {
  target = value.id;
  const query = new URLSearchParams(location.search); if (query.has("target")) { query.set("target", value.id); history.replaceState(null, "", "?" + query + location.hash); }
  void loadDiagram("plan", true);
 }
 currentPlan = value.id;
 if (value.id === target) { state.plan = value; renderShell(); }
});
listen("snapshot", value => {
 if (build && value.build && value.build !== build) { location.reload(); return; }
 build ||= value.build ?? ""; retryDelay = 1000;
 if (value.target) target = value.target.kind === "product" ? "product" : value.target.id;
 currentPlan = value.current ?? null;
 state.connected = true; state.plan = value.plan; state.status = value.status ?? null; state.activity = value.activity ?? {}; state.more = !!value.more;
 chat.clear(); for (const row of value.chat ?? []) chat.set(row.id, row);
 // Dialogs over 16 KB arrive brief; fetch their full body.
 promptView.sync((value.dialogs ?? []).filter(ask => !ask.brief));
 for (const ask of value.dialogs ?? []) if (ask.brief) get("dialog?id=" + encodeURIComponent(ask.askId)).then(full => { promptView.pending(full); renderShell(); }, error => showNotice(error.message)); renderActivity(); renderChat(); showNotice(""); renderShell(); void loadDiagram("project"); void loadDiagram("plan");
});
listen("diagram", value => {
 const tab = value.target.kind === "product" ? "project" : value.target.id === planTarget() ? "plan" : null;
 if (tab) setDiagram(tab, value.diagram);
});
listen("message", row => { chat.set(row.id, row); renderChat(); });
listen("dialog", value => { promptView.pending(value); renderShell(); });
listen("dialog_closed", value => { promptView.closed(value.askId); renderShell(); });
// A new run starts with an empty tool list (the server clears its own at agent_start).
listen("activity", value => { state.activity = { ...state.activity, ...value, ...(value.working && !state.activity.working && !value.tools ? { tools: [] } : {}) }; renderActivity(); renderShell(); });
// Appended text per D21: apply only at the current length, ignore stale, refetch the row on a gap.
listen("delta", delta => {
 const row = chat.get(delta.id), text = applyText(row && !row.excerpt ? row.text : undefined, delta.offset, delta.text);
 if (text === "gap") { void loadRow(delta.id); return; }
 if (text === "stale") return;
 chat.set(delta.id, { ...row, id: delta.id, role: delta.role, text, streaming: delta.streaming, excerpt: false, truncated: delta.truncated ?? row?.truncated, error: delta.error ?? row?.error, ...(delta.blocks ? { blocks: delta.blocks, brief: delta.blocks.length > 0 } : {}) });
 renderChat();
 // An open block would lose its body to the brief update; reload it.
 if (delta.blocks?.length && $("messages").querySelector(`li[data-id="${CSS.escape(delta.id)}"] details[open]`)) void loadRow(delta.id);
});
listen("thinking", delta => {
 const data = state.activity, text = data.thinking ?? "", length = data.thinkingLength ?? text.length, at = delta.offset - (length - text.length);
 if (delta.offset > 0 && delta.offset + delta.text.length < length) return;
 // A gap (page joined mid-thought) restarts the shown thinking from what arrived.
 const next = delta.offset > 0 && at >= 0 && at <= text.length ? text.slice(0, at) + delta.text : delta.text;
 state.activity = { ...data, thinking: next.slice(-64000), thinkingLength: delta.offset + delta.text.length }; renderActivity();
});
listen("tool", row => {
 const tools = [...(state.activity.tools ?? [])], index = tools.findIndex(item => item.id === row.id);
 if (index < 0) tools.push(row); else tools[index] = row;
 state.activity = { ...state.activity, tools: tools.slice(-50) }; renderActivity();
});
function connect() {
 const query = new URLSearchParams(); if (token) query.set("token", token); if (target) query.set("target", target);
 events = new EventSource("/api/events?" + query);
 for (const [name, update] of handlers) events.addEventListener(name, (event: MessageEvent) => applyUpdate(event, update));
 events.addEventListener("error", event => {
  if (event instanceof MessageEvent && event.data) { applyUpdate(event, value => showNotice(value.message ?? "Workspace update failed.")); return; }
  state.connected = false; renderShell();
  showNotice("Pi is reloading… reconnecting. Your unsent message is still here.");
  if (events.readyState !== EventSource.CLOSED) return;
  clearTimeout(retryTimer); retryTimer = window.setTimeout(connect, retryDelay); retryDelay = Math.min(retryDelay * 2, 15_000);
 });
}
connect();
window.addEventListener("pagehide", () => { clearTimeout(retryTimer); events.close(); });
