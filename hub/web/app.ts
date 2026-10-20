// Browser-only source; the server strips erasable types without a build step.
import type { Diagram } from "../../extensions/plan3-diagram.ts";
import type { createActivityMirror } from "../../extensions/plan3-web.ts";
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
const state: { connected: boolean; diagram: Diagram | null; plan: Plan | null; status: { model: Model | null; effort: string | null; context?: number | null; tokens?: number | null; window?: number | null; folder?: string; tab?: string } | null; activity: Partial<ReturnType<ReturnType<typeof createActivityMirror>["snapshot"]> & { thinkingLength: number }>; pinning: boolean; more: boolean } = { connected: false, diagram: null, plan: null, status: null, activity: {}, pinning: false, more: false };
let commentPoint, hoverTimer, messageSending = false, commandSending = false;
const chat = new Map();

const BIAS_LABEL = { "-2": "Work:Plan", "-1": "Work:Task", 0: "Normal", 1: "Think:Task", 2: "Think:Plan" };
// Without a plan the bias is per session: Think / Normal / Work.
const SESSION_BIAS = { "-1": "Work", 0: "Normal", 1: "Think" };
const biasNow = () => state.plan ? state.plan.bias ?? 0 : (state.status as { modes?: { bias?: number } })?.modes?.bias ?? 0;
// Context fills toward the compaction border, not the model window.
const COMPACT_AT = 200_000;
// Progress-bar buttons: fill to percent, coloured by footer tone (accent, success, warning, error, dim).
function setBar(item: HTMLElement, percent: number, tone: string) {
 item.style.setProperty("--fill", Math.max(0, Math.min(100, percent)) + "%"); item.dataset.tone = tone;
}
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
// Confirmations (brief) fade after ~1.5 s; errors and hints stay until replaced.
function showNotice(text, brief = false) { clearTimeout(noticeTimer); $("notice").textContent = text; $("notice").hidden = !text; if (brief && text) noticeTimer = setTimeout(() => showNotice(""), 1500); }
let sessionStates: string[] = [], iconKey = "";
function renderShell() {
 // "<folder> - <session name>"; the tab title adds the current plan (H5-05).
 const status = state.status, plan = state.plan, head = [status?.folder, status?.tab].filter(Boolean).join(" - ");
 const title = head || plan?.title || "Architecture workspace", full = head && plan?.title ? `${head}: ${plan.title}` : title;
 $("title").textContent = title; $("title").title = full;
 // Phones: a second top-bar line with the plan name left and its steps right.
 $("title-plan").hidden = !plan?.title; $("title-plan").title = plan?.title ?? "";
 if (plan?.title) { const [name, steps] = $("title-plan").children; name.textContent = plan.title; steps.textContent = plan.total ? `${plan.done ?? 0}/${plan.total}` : ""; }
 // Cheap cue for a backgrounded tab (D20): a waiting answer shows in the tab title.
 document.title = promptView.busy || state.activity.dialog ? "(!) " + full + " needs an answer" : full;
 renderIcon();
 // D19 status line. Line 1: [model: effort] [Context: n%] [💡 bias]; line 2: the plan as a progress bar (or New plan).
 const effort = status?.effort ? status.effort[0].toUpperCase() + status.effort.slice(1) : "—";
 $("model-button").textContent = (status?.model?.name ?? "Model") + ": " + effort;
 // 120k/1m like Pi's footer; tokens are null right after compaction until the next reply.
 const short = n => n >= 1e6 ? +(n / 1e6).toFixed(1) + "m" : Math.round(n / 1e3) + "k";
 const used = typeof status?.tokens === "number" ? status.tokens / Math.min(COMPACT_AT, status.window || COMPACT_AT) * 100 : status?.context ?? 0;
 setBar($("context-button"), used, used >= 90 ? "error" : used >= 70 ? "warning" : "accent");
 $("context-button").replaceChildren(html("span", { className: "context-label", textContent: "Context: " }), (status?.window ? (typeof status.tokens === "number" ? short(status.tokens) : "?") + "/" + short(status.window) : typeof status?.context === "number" ? Math.round(status.context) + "%" : "—")); // the phone drawer hides the label
 $("bias-button").textContent = "💡 " + ((plan ? BIAS_LABEL : SESSION_BIAS)[biasNow()] ?? "Normal");
 for (const id of ["model-button", "context-button"] as const) $(id).disabled = !state.connected;
 $("bias-button").disabled = !state.connected;
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

// A running tool's age: 12s, 3:07, then 1:02:07, so stuck tools stand out.
function elapsed(ms: number) {
 const total = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = String(total % 60);
 return h ? `${h}:${String(m).padStart(2, "0")}:${s.padStart(2, "0")}` : m ? `${m}:${s.padStart(2, "0")}` : s + "s";
}
setInterval(() => { for (const item of document.querySelectorAll<HTMLElement>(".tool-elapsed")) item.textContent = elapsed(Date.now() - Number(item.dataset.start)); }, 1000);
function renderActivity() {
 const root = $("activity"), data = state.activity, opened = new Map([...root.querySelectorAll("details")].map(item => [item.dataset.id, item.open]));
 const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text = undefined, className = "") => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item; };
 const section = (id, title, open = false) => { const item = make("details"); item.dataset.id = id; item.open = opened.get(id) ?? open; item.append(make("summary", title)); root.append(item); return item; };
 root.replaceChildren();
 if (data.compacting) root.append(make("p", "Compacting session history…", "activity-status"));
 if (data.interrupted) root.append(make("p", "Run interrupted.", "activity-status"));
 for (const run of data.subagents ?? []) root.append(make("p", ["Subagent " + (run.model ? "(" + run.model + ") " : "") + run.label, run.state, run.turns === undefined ? "" : run.turns + " turns", run.tools === undefined ? "" : run.tools + " tools", run.tool ?? ""].filter(Boolean).join(" \u00b7 "), "activity-status"));
 if (data.error) { const error = make("p", data.error, "activity-error"); error.setAttribute("role", "alert"); root.append(error); }
 if (data.thinking) { const thinking = section("thinking", "Thinking", chatView() === "thinking"); thinking.className = "thinking-row"; thinking.append(make("pre", data.thinking)); }
 // Only the running run's calls show here; finished calls stay inside the chat rows, so the reply is the last thing shown.
 const tools = data.working ? data.tools ?? [] : [];
 for (const tool of tools) {
  const row = section(tool.id, [tool.name + toolArg(tool.args), tool.state, tool.durationMs === undefined ? "" : Math.round(tool.durationMs) + " ms"].filter(Boolean).join(" · "));
  if (tool.state === "running" && tool.startedAt) { const clock = make("span", elapsed(Date.now() - tool.startedAt), "tool-elapsed"); clock.dataset.start = String(tool.startedAt); row.firstElementChild!.append(" · ", clock); }
  row.className = "tool-row tool-" + (tool.state === "error" ? "error" : tool.state === "done" ? "ok" : "pending") + (tool.parent ? " nested-tool" : "");
  for (const [label, text] of [["Arguments", tool.args], ["Progress", tool.progress], ["Result", tool.result]]) if (text) { row.append(make("strong", label), make("pre", text)); }
 }
 [...root.querySelectorAll(".tool-row")].at(-1)?.classList.add("latest");
 root.classList.toggle("working", !!data.working);
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
 $("expand-left").hidden = mode !== "collapsed"; $("collapse-left").hidden = mode === "collapsed";
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
 // SAFETY: render only reads nodes, edges, notes and revision, which this empty stand-in provides.
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
const leftChoice = remembered("plan3-left", ["full", "narrow", "collapsed"], "full");
let firstSnapshot = true;
setLeft(leftChoice);
// Chat detail, cycled by one button: Full; Thinking hides tool blocks; Compact hides thinking, tools and in-between agent
// text, leaving prompts and final replies. While a run works, both keep its latest thinking and latest tool call visible.
const CHAT_VIEWS = ["expanded", "thinking", "compact"], CHAT_LABEL = { expanded: "Full", thinking: "Thinking", compact: "Compact" };
function setChatView(view: string) {
 for (const name of CHAT_VIEWS.slice(1)) document.documentElement.classList.toggle("chat-" + name, view === name);
 for (const id of ["chat-compact", "chat-compact-m"]) { $(id).setAttribute("aria-pressed", String(view !== "expanded")); $(id).textContent = (id === "chat-compact-m" ? "▤ Chat: " : "") + CHAT_LABEL[view]; }
 try { localStorage.setItem("plan3-chat", view); } catch { /* private mode: the view just is not remembered */ }
}
const chatView = () => CHAT_VIEWS.find(name => document.documentElement.classList.contains("chat-" + name)) ?? "expanded";
for (const id of ["chat-compact", "chat-compact-m"]) $(id).addEventListener("click", () => { setChatView(CHAT_VIEWS[(CHAT_VIEWS.indexOf(chatView()) + 1) % CHAT_VIEWS.length]); pinChat(); fillChat(); });
setChatView(remembered("plan3-chat", CHAT_VIEWS, "expanded"));
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
const homes = [["mobile-tabs", "drawer-views"], ["status-line", "drawer-status"], ["session-list", "drawer-sessions"], ["plan-menu", "title-menu"], ["connection", "topbar"], ["settings-button", "drawer-gear"], ["settings-menu", "drawer-gear"]]
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
// iOS (every iPhone browser is WebKit) pans the visible area down over the page to show the focused box and ignores
// scrollTo while the keyboard is up, so the page follows the visible area; a leftover scroll is undone once it is gone.
// Add #debug to the address to see the numbers on screen.
const debugViewport = location.hash.includes("debug") ? document.body.appendChild(Object.assign(document.createElement("output"), { style: "position:fixed;z-index:99;right:4px;top:30%;font:11px monospace;background:#ff0c;color:#000;padding:2px 4px;white-space:pre;pointer-events:none" })) : undefined;
const fitViewport = () => {
 const view = window.visualViewport, root = document.documentElement.style, height = view?.height ?? window.innerHeight, top = view?.offsetTop ?? 0;
 root.setProperty("--app-height", height + "px"); root.setProperty("--app-top", top + "px");
 if (!top && (window.scrollY || window.scrollX)) window.scrollTo(0, 0);
 if (debugViewport) debugViewport.textContent = `vv ${Math.round(height)} top ${Math.round(top)}\ninner ${innerHeight} scrollY ${Math.round(scrollY)}\nbody ${Math.round(document.body.getBoundingClientRect().top)}/${Math.round(document.body.getBoundingClientRect().height)}`;
};
window.visualViewport?.addEventListener("resize", fitViewport); window.visualViewport?.addEventListener("scroll", fitViewport); window.addEventListener("resize", fitViewport);
// Some keyboards report their final size only after closing; measure again once it has gone.
// The keyboard animates in or out over ~300 ms and iOS pans at its end; check again after it settles.
for (const type of ["focusin", "focusout"]) document.addEventListener(type, () => { setTimeout(fitViewport, 100); setTimeout(fitViewport, 400); });
fitViewport();
// iOS pans the whole page when a drag starts on something that cannot scroll (beside the chat box) and leaves it there.
// On phones only lists, text boxes and the diagram may take a drag; everything else is held still.
const scrolls = (item: Element | null) => {
 for (; item && item !== document.body; item = item.parentElement) {
  if (item.matches("textarea, input, svg, .canvas")) return true;
  const style = getComputedStyle(item);
  if ((/(auto|scroll)/.test(style.overflowY) && item.scrollHeight > item.clientHeight) || (/(auto|scroll)/.test(style.overflowX) && item.scrollWidth > item.clientWidth)) return true;
 }
 return false;
};
document.addEventListener("touchmove", event => { if (phone.matches && event.touches.length === 1 && !scrolls(event.target as Element)) event.preventDefault(); }, { passive: false });

// The top bar sizes Think and the usage bars to the chat panel below them.
new ResizeObserver(() => document.body.style.setProperty("--chat-px", $("chat").offsetWidth + "px")).observe($("chat"));
// The session sidebar starts below the full-width top bar.
new ResizeObserver(() => document.body.style.setProperty("--topbar-h", document.querySelector<HTMLElement>(".topbar")!.offsetHeight + "px")).observe(document.querySelector(".topbar")!);
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
 const response = await fetch("api/" + endpoint, auth);
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
 const response = await fetch("api/" + endpoint, { ...auth, method: "POST", headers: { ...auth.headers, "Content-Type": "application/json" }, body: JSON.stringify({ target, ...body }) });
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
function openNote(title, purpose, save) { $("comment-delete").hidden = true; $("comment-title").textContent = title; $("comment-purpose").textContent = purpose; $("comment-save").textContent = save; $("comment-error").hidden = true; $("comment-prompt").showModal(); $("comment-text").focus(); }
function startNote(id) { draftFor = id; labelFor = null; $("comment-label").textContent = "Note"; openNote("Note on @" + id, "Adds a line to your message. Add more notes, then send them together.", "Add to message"); }
function insertMention(id) { const input = $("message-input"); input.value += (input.value && !/\s$/.test(input.value) ? " " : "") + "@" + id + " "; input.focus(); renderMentions(); }
// E-03 editing bar: Box and Group draw on the canvas (U-02); Select moves, resizes, connects and edits labels.
let tool = "select", groupColor = 0, labelFor = null;
function setTool(name) {
 tool = name;
 for (const button of document.querySelectorAll("#edit-bar [data-tool]")) button.setAttribute("aria-pressed", String(button.getAttribute("data-tool") === name));
 $("canvas").classList.toggle("editing", name !== "select");
 showNotice({ box: "Drag to draw a box, or click to add one; inside a group it goes in the group.", group: "Drag to draw a group; boxes inside the outline move into it." }[name] ?? "");
}
// Toolbar chat lines join the message like note lines; the user sends them together (R7). Each remembers its
// diagram and the ids it touches (A2), so undoing a pending add drops exactly its lines and Send scopes their context.
let editLines = [];
const lineIds = line => [...line.matchAll(/\(@([a-z][a-z0-9_]*)\)/g)].map(match => match[1]);
function addEditLine(line, target, added) {
 const input = $("message-input");
 input.value = input.value.trimEnd() ? input.value.trimEnd() + "\n" + line + "\n" : line + "\n"; renderMentions();
 editLines.push({ line, target, added, ids: [...new Set([...lineIds(line), ...added])] });
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
  else if (value.line) {
   // U-03: renaming a pending add rewrites its own line instead of adding one.
   const own = value.line.startsWith("Add ") || value.line.startsWith("Connect ") ? editLines.find(item => item.target === id && edit.kind === "rename" && item.added.includes(edit.id)) : undefined;
   if (own) { const input = $("message-input"), rows = input.value.split("\n"), at = rows.indexOf(own.line); if (at >= 0) rows[at] = value.line; input.value = rows.join("\n"); own.line = value.line; renderMentions(); }
   else addEditLine(value.line, id, [...itemIds(value.diagram)].filter(item => !before.has(item)));
  }
  return true;
 }
 catch (error) { showNotice(error.message); if (error.status === 409) try { setDiagram(tab, (await get("diagram?target=" + encodeURIComponent(id))).diagram); } catch { /* the notice already explains */ } return false; }
}
// U-03: creating opens no dialog (the server picks "New box", "New group 2", ...); the tool returns to Select.
async function createAt({ adopt = [], ...spec }) {
 const before = itemIds(state.diagram); setTool("select");
 if (!await applyEdit({ ...spec, ...(spec.kind === "group" ? { color: groupColor } : {}) })) return;
 const id = state.diagram.nodes.find(node => !before.has(node.id))?.id;
 for (const box of adopt) if (!await applyEdit({ kind: "reparent", id: box, parent: id })) break;
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
 commentPoint = { ...point, target: diagramTarget(), expectedRevision: state.diagram.revision }; state.pinning = false; $("pin-note").setAttribute("aria-pressed", "false"); $("canvas").classList.remove("pinning");
 draftFor = ""; labelFor = null; $("comment-label").textContent = "Note"; openNote("Add a note", point.element ? "Pin a comment to @" + point.element + "." : "Pin a comment at this canvas position.", "Save note"); showNotice("");
}
const diagramView = createDiagramView($("diagram"), {
 hover, leave, notes: drawNotes, pin, pinning: () => state.pinning, tool: () => tool, groupColor: () => groupColor, create: spec => void createAt(spec),
 connect(body) { void applyEdit({ kind: "connect", ...body }); },
 async reparent(body) { if (!await applyEdit({ kind: "reparent", id: body.id, ...(body.parent ? { parent: body.parent } : {}) })) diagramView.render(state.diagram); },
 mention: insertMention, note: startNote,
 // E-04: rename opens the label dialog pre-filled; resize is layout only (no chat line).
 rename(id) {
  const item = [...state.diagram.nodes, ...state.diagram.edges].find(item => item.id === id); if (!item) return;
  labelFor = { kind: "rename", id }; draftFor = ""; $("comment-label").textContent = "Label";
  openNote("Rename @" + id, "Changes the label; the agent sees it as a pending edit.", "Rename"); $("comment-text").value = item.label ?? ""; $("comment-text").select();
  // U-07: the label dialog also deletes; the first click only arms it and names what goes.
  const kids = node => state.diagram.nodes.filter(child => child.parent === node).reduce((count, child) => count + 1 + kids(child.id), 0);
  const what = "from" in item ? "connection @" + id : item.kind === "group" ? `group "${item.label}"` + (kids(id) ? ` and ${kids(id)} inside` : "") : `box "${item.label}"`;
  Object.assign($("comment-delete"), { hidden: false, textContent: "Delete" }); $("comment-delete").dataset.what = what; delete $("comment-delete").dataset.armed;
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
$("comment-delete").addEventListener("click", async () => {
 const button = $("comment-delete") as HTMLButtonElement;
 if (!button.dataset.armed) { button.dataset.armed = "1"; button.textContent = "Confirm: delete " + button.dataset.what; return; }
 button.disabled = true;
 try { if (await applyEdit({ kind: "delete", id: labelFor.id })) { $("comment-prompt").close(); $("comment-text").value = ""; labelFor = null; } }
 finally { button.disabled = false; }
});
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

const promptView = createPromptView($("prompt"), $("prompt-form"), post, showNotice, attachTo, renderLinks);
// Image links and thumbnails open full size in the page (a new tab on a home-screen app may lack the pairing cookie).
document.addEventListener("click", event => {
 const link = (event.target as HTMLElement).closest?.<HTMLAnchorElement>("a.thumb, a.chat-link"); if (!link || !link.href.includes("/api/image?")) return;
 event.preventDefault(); const viewer = document.getElementById("viewer") as HTMLDialogElement; (viewer.querySelector("img") as HTMLImageElement).src = link.href; viewer.showModal();
});
document.getElementById("viewer").addEventListener("click", () => (document.getElementById("viewer") as HTMLDialogElement).close());
// The live tool line names what it works on, like the chat rows' titles (hub/src/chat.ts toolTitle); CSS cuts it at the box width.
function toolArg(args?: string) {
 let value: unknown; try { value = JSON.parse(args ?? ""); } catch { return ""; }
 const record = (value ?? {}) as Record<string, unknown>, keys = ["path", "file", "command", "query", "url", "question", "action", "agent"];
 const text = keys.map(key => record[key]).find(item => typeof item === "string") ?? Object.values(record).find(item => typeof item === "string");
 const line = String(text ?? "").split("\n").find(item => item.trim())?.trim() ?? "";
 return line ? " " + line : "";
}
// Pi-like rows: text stays visible; thinking and each tool call are one collapsed line that expands on click.
function renderBlocks(box: HTMLElement, row) {
 const opened = new Set([...box.querySelectorAll<HTMLDetailsElement>("details[open]")].map(item => item.dataset.key));
 const known = new Set([...box.querySelectorAll<HTMLDetailsElement>("details")].map(item => item.dataset.key));
 box.replaceChildren(); const images = new Set<string>();
 // Thinking view: one open text block per run of thinking, joined across the (hidden) tool calls between them.
 let run: HTMLElement | null = null;
 (row.blocks ?? []).forEach((block, index) => {
  if (block.type === "thinking" && block.text?.trim()) {
   if (run) run.textContent += "\n\n" + block.text.trim();
   else { run = Object.assign(document.createElement("div"), { className: "thinking-text", textContent: block.text.trim() }); box.append(run); }
  }
  if (block.ask) { box.append(askExchange(block)); return; }
  const item = document.createElement("details"), summary = document.createElement("summary"), key = block.id ?? "thinking_" + index;
  // Pi's tool colours: grey while running, green when done, red on error.
  item.dataset.key = key; item.open = opened.has(key) || (!known.has(key) && block.type === "tool" && (block.name === "edit" || block.name === "write")); item.className = "block block-" + block.type + (block.type === "tool" ? block.error ? " block-error" : block.result === undefined ? " block-pending" : " block-ok" : "");
  if (block.type === "thinking") summary.textContent = "Thinking";
  else summary.append(Object.assign(document.createElement("b"), { textContent: block.name }), block.title.slice(block.name.length) + (block.result === undefined ? (row.streaming ? "" : " \u2026") : block.error ? " \u2715" : ""));
  item.append(summary);
  // An edit's diff (or a write's content as added lines) replaces its raw arguments.
  for (const text of block.type === "thinking" ? [block.text] : [block.diff ? undefined : block.args, block.result].filter(value => value !== undefined)) { const pre = document.createElement("pre"); if (block.type === "thinking") pre.textContent = text; else linkPaths(pre, text, images); item.append(pre); }
  if (block.diff) {
   const pre = document.createElement("pre"); pre.className = "diff";
   for (const line of block.diff.split("\n")) pre.append(Object.assign(document.createElement("span"), { textContent: line + "\n", className: line[0] === "+" ? "diff-add" : line[0] === "-" ? "diff-del" : "" }));
   item.append(pre);
  }
  box.append(item);
  // Tool output images (screenshots, renders) show under the block, visible while it is collapsed.
  appendThumbs(box, images); images.clear();
 });
}
// ask_user is part of the conversation: the agent's questions above, your answer below, shown open in every chat view.
function askExchange(block) {
 const box = Object.assign(document.createElement("div"), { className: "ask-exchange" }), asked = Object.assign(document.createElement("div"), { className: "ask-q" });
 for (const question of block.ask) {
  const title = Object.assign(document.createElement("div"), { className: "ask-question" }); renderLinks(title, question.question); asked.append(title);
  if (question.context) { const context = Object.assign(document.createElement("div"), { className: "ask-context" }); renderLinks(context, question.context); asked.append(context); }
  if (question.options.length) asked.append(Object.assign(document.createElement("div"), { className: "ask-options", textContent: question.options.join(" · ") }));
 }
 const answer = Object.assign(document.createElement("div"), { className: "ask-a" + (block.error ? " ask-error" : block.result === undefined ? " ask-waiting" : "") });
 renderLinks(answer, block.result === undefined ? "Waiting for your answer…" : block.result.replace(/^User answered(?: \d+ of \d+ questions)?:\s*/, ""));
 box.append(asked, answer); return box;
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
new ResizeObserver(() => { pinChat(); fillChat(); }).observe($("feed"));
$("feed").addEventListener("load", pinChat, true);
$("messages").addEventListener("click", event => { const id = (event.target as HTMLElement).closest<HTMLElement>("[data-full]")?.dataset.full; if (id) void loadRow(id); });
// Opening a thinking/tool block of an excerpt row loads its bodies.
$("messages").addEventListener("toggle", event => { const item = (event.target as HTMLElement).closest<HTMLLIElement>("li"); const row = chat.get(item?.dataset.id); if ((event.target as HTMLDetailsElement).open && (row?.excerpt || row?.brief)) void loadRow(item.dataset.id); }, true);
let loadingEarlier = false;
// Load earlier rows until the chat fills its view: compact mode can hide every row of a page, leaving nothing to scroll.
// shortcut: a turn with hundreds of tool rows costs one 20-row request each; a server-side compact page if that drags.
const fillChat = () => { const feed = $("feed"); if (state.more && !loadingEarlier && feed.clientHeight && feed.scrollHeight <= feed.clientHeight + 48) void loadEarlier(); };
async function loadEarlier() {
 if (loadingEarlier) return; loadingEarlier = true; let loaded = false;
 try {
  const first = chat.keys().next().value, page = await get("rows" + (first ? "?before=" + encodeURIComponent(first) : ""));
  const rows = [...page.rows, ...chat.values()]; chat.clear(); for (const row of rows) chat.set(row.id, row);
  state.more = page.more; const list = $("feed"), height = list.scrollHeight; renderChat(); list.scrollTop += list.scrollHeight - height; loaded = true;
 } catch (error) { showNotice(error.message); } finally { loadingEarlier = false; if (loaded) fillChat(); }
}
$("to-bottom").addEventListener("click", () => toBottom());
// Final replies fetched in full once each (a failed fetch is not retried on every render).
const finalLoads = new Set<string>();
function renderChat() {
 const list = $("messages"), feed = $("feed"), follow = stick;
 // The final reply of a turn: the last agent row with text before the next prompt; it shows in full and stands out.
 const rows = [...chat.values()], finals = new Set<string>();
 rows.forEach((row, index) => { if (row.role !== "assistant" || !row.text.trim()) return; const next = rows.slice(index + 1).find(other => other.role === "user" || (other.role === "assistant" && other.text.trim())); if (!next || next.role === "user") finals.add(row.id); });
 // Keep the newest 100 shown rows (compact: prompts and final replies) and 512 KB of their text. Only while following the
 // end: rows the reader loaded by scrolling up stay. Trimmed rows load again on scroll.
 if (stick) {
  const compact = chatView() === "compact", encoder = new TextEncoder();
  let shown = 0, bytes = 0, keep = rows.length;
  for (; keep > 0; keep--) {
   const row = rows[keep - 1];
   if (!compact || row.role === "user" || finals.has(row.id) || row.blocks?.some(block => block.ask)) { shown++; bytes += encoder.encode(row.text).length; }
   if (shown > 100 || bytes > 512000 || rows.length - keep >= 3000) break;
  }
  for (const row of rows.splice(0, keep)) chat.delete(row.id);
  if (keep) state.more = true;
 }
 for (const item of list.querySelectorAll<HTMLLIElement>(":scope > li")) if (!chat.has(item.dataset.id)) item.remove();
 let previous: HTMLLIElement | null = null;
 for (const row of chat.values()) {
  let item = [...list.querySelectorAll<HTMLLIElement>(":scope > li")].find(item => item.dataset.id === row.id);
  if (!item) { item = document.createElement("li"); item.dataset.id = row.id; const full = document.createElement("button"); full.type = "button"; full.className = "row-full"; full.textContent = "Show full message"; full.dataset.full = row.id; item.append(document.createElement("strong"), document.createElement("div"), document.createElement("div"), document.createElement("small"), full); }
  // Keep server order, also for rows inserted above by loadEarlier.
  if (!item.isConnected || item.previousElementSibling !== previous) { if (previous) previous.after(item); else list.prepend(item); }
  previous = item;
  item.classList.toggle("final", finals.has(row.id));
  if (finals.has(row.id) && row.excerpt && !row.streaming && !finalLoads.has(row.id)) { finalLoads.add(row.id); void loadRow(row.id); }
  const json = JSON.stringify(row); if (item.dataset.json === json) continue; item.dataset.json = json;
  const text = row.text.trim(), note = row.error ?? (row.truncated ? "Excerpt; full history stays in Pi." : row.streaming && !row.blocks?.length ? "Streaming…" : "");
  // A turn with only thinking/tool calls is a compact block list without the "Agent" header; an empty one is hidden.
  item.className = "message " + row.role + (text ? "" : " message-blocks") + (finals.has(row.id) ? " final" : "") + (row.blocks?.some(block => block.ask) ? " has-ask" : ""); item.hidden = !text && !row.blocks?.length && !note;
  // Rows are told apart by colour (user block vs plain agent text); the label stays for screen readers.
  item.children[0].textContent = text ? (row.role === "user" ? "You:" : "Agent:") : ""; item.children[0].className = "sr-only";
  renderBlocks(item.children[1] as HTMLElement, row); renderLinks(item.children[2] as HTMLElement, row.text);
  item.children[3].textContent = note; (item.children[4] as HTMLElement).hidden = !row.excerpt;
 }
 // Follow new output only while the reader is at the bottom; otherwise offer a jump button.
 if (follow) feed.scrollTop = feed.scrollHeight; else if (feed.scrollHeight > feed.clientHeight) $("to-bottom").hidden = false;
 fillChat();
}
// Image and Markdown paths in chat text become links: images open full size and show as thumbnails
// (pasted or terminal Alt+V images too); .md opens in the Files tab. The server shows any image on this PC outside hidden folders.
// shortcut: paths with spaces are not detected; quote-aware parsing if that matters.
const LINKED_PATH = /(?<![\w:/\\.-])(?:[A-Za-z]:[\\/]|\/)?(?:[^\s"'`<>|*?()[\]:\\/]+[\\/])*[^\s"'`<>|*?()[\]:\\/]+\.(?:png|jpe?g|gif|webp|md)(?![\w-])/gi;
function renderLinks(target: HTMLElement, text: string) {
 target.replaceChildren(); const images = new Set<string>(); renderMarkdown(target, text, images); appendThumbs(target, images);
}
// Chat Markdown subset, built as DOM (never innerHTML): ``` code, | tables |, # headings, **bold**, *italic*, [links](url) and `code`; lists stay as text.
const TABLE_ROW = /^\s*\|.*\|\s*$/, TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
function renderMarkdown(target: HTMLElement, text: string, images: Set<string>) {
 const lines = text.split("\n"); let prose: string[] = [];
 const flush = () => { const body = prose.join("\n").replace(/^\n+|\n+$/g, ""); prose = []; if (body) { const div = document.createElement("div"); inline(div, body, images); target.append(div); } };
 for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (/^\s*```/.test(line)) {
   flush(); const code: string[] = []; while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
   const pre = Object.assign(document.createElement("pre"), { className: "md-code" }); linkPaths(pre, code.join("\n"), images); target.append(pre);
  } else if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[i + 1] ?? "")) {
   flush(); const table = Object.assign(document.createElement("table"), { className: "md-table" }), cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|");
   const head = table.createTHead().insertRow(); for (const cell of cells(line)) inline(head.appendChild(document.createElement("th")), cell.trim(), images);
   const body = table.createTBody(); i++;
   while (TABLE_ROW.test(lines[i + 1] ?? "")) { const row = body.insertRow(); for (const cell of cells(lines[++i])) inline(row.insertCell(), cell.trim(), images); }
   target.append(table);
  } else if (/^#{1,6}\s/.test(line)) {
   flush(); const h = Object.assign(document.createElement("div"), { className: "md-heading" }); inline(h, line.replace(/^#+\s+/, ""), images); target.append(h);
  } else prose.push(line);
 }
 flush();
}
// Italic markers need text right inside them, and _x_ word boundaries, so "* item" and snake_case stay as they are.
const INLINE = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*\n]+?)\*\*|(?<![*\w])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![*\w])|(?<!\w)_(?=\S)([^_\n]+?)(?<=\S)_(?!\w)/g;
function inline(target: HTMLElement, text: string, images: Set<string>) {
 let at = 0;
 for (const match of text.matchAll(INLINE)) {
  linkPaths(target, text.slice(at, match.index), images); at = match.index + match[0].length;
  if (match[2] !== undefined) {
   // Only targets linkPaths would link (http(s), images, .md) become links, labelled with the link text; others show the label.
   const probe = document.createElement("span"); linkPaths(probe, match[3], images);
   const link = probe.querySelector("a"); if (link && link.textContent === probe.textContent) { link.textContent = match[2]; target.append(link); } else target.append(match[2]);
   continue;
  }
  const element = document.createElement(match[1] !== undefined ? "code" : match[4] !== undefined ? "b" : "i"); linkPaths(element, match[1] ?? match[4] ?? match[5] ?? match[6], images); target.append(element);
 }
 linkPaths(target, text.slice(at), images);
}
// Web addresses open in a new tab; trailing Markdown or sentence punctuation is not part of them.
const LINKED = new RegExp("(https?://[^\\s\"'\\x60<>]+)|" + LINKED_PATH.source, "gi");
function linkPaths(target: HTMLElement, text: string, images: Set<string>) {
 let at = 0;
 for (const match of text.matchAll(LINKED)) {
  if (match[1]) {
   const url = match[1].replace(/[*_.,;:!?)\]]+$/, "");
   target.append(text.slice(at, match.index)); at = match.index + url.length;
   target.append(Object.assign(document.createElement("a"), { textContent: url, href: url, target: "_blank", rel: "noopener", className: "chat-link" }));
   continue;
  }
  const path = match[0], image = !/\.md$/i.test(path);
  target.append(text.slice(at, match.index)); at = match.index + path.length;
  const link = Object.assign(document.createElement("a"), { textContent: path, className: "chat-link", href: image ? imageSource(path) : "#" });
  if (image) { link.target = "_blank"; link.rel = "noopener"; images.add(path); }
  else link.addEventListener("click", event => { event.preventDefault(); setTab("files"); filesView.open(path); if (matchMedia("(max-width: 899px)").matches) setMobile("files"); });
  target.append(link);
 }
 target.append(text.slice(at));
}
function appendThumbs(target: HTMLElement, images: Set<string>) {
 for (const path of [...images].slice(0, 6)) {
  const link = Object.assign(document.createElement("a"), { href: imageSource(path), target: "_blank", rel: "noopener", className: "thumb" }), img = Object.assign(document.createElement("img"), { src: imageSource(path), alt: path, loading: "lazy" });
  // Bare names from listings (look-*.png) or moved files cannot be served; drop the broken thumbnail, keep the text.
  img.addEventListener("error", () => link.remove()); link.append(img); target.append(link);
 }
}
// Prompt answer boxes: paste or pick an image (on a phone: library or camera); its path goes in the text, a small thumbnail below.
function attachTo(text: HTMLTextAreaElement) {
 const picker = Object.assign(document.createElement("input"), { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", hidden: true }), button = Object.assign(document.createElement("label"), { className: "attach button", title: "Attach an image", textContent: "Image" }), thumbs = Object.assign(document.createElement("div"), { className: "prompt-thumbs" });
 button.append(picker); picker.addEventListener("change", () => { const file = picker.files?.[0]; picker.value = ""; if (file) void attach(file, text); });
 text.addEventListener("paste", event => { const file = [...(event.clipboardData?.items ?? [])].find(item => item.type.startsWith("image/"))?.getAsFile(); if (file) { event.preventDefault(); void attach(file, text); } });
 text.addEventListener("input", () => { thumbs.replaceChildren(); appendThumbs(thumbs, new Set([...text.value.matchAll(LINKED_PATH)].map(match => match[0]).filter(path => !/\.md$/i.test(path)))); });
 text.after(button, thumbs);
}
const imageSource = (path: string) => "api/image?path=" + encodeURIComponent(path) + (token ? "&token=" + token : "");
const mentioned = () => [...new Set([...$("message-input").value.matchAll(/(?<![\w@])@([a-z][a-z0-9_]{0,47})(?![A-Za-z0-9_])/g)].map(match => match[1]))];
function renderMentions() {
 const data = state.diagram, all = [...(data?.nodes ?? []), ...(data?.edges ?? []), ...(data?.notes ?? [])]; $("mentions").replaceChildren();
 for (const id of mentioned()) { const entity = all.find(item => item.id === id), chip = document.createElement("span"); chip.className = "mention-chip"; chip.textContent = "@" + id + (entity ? "" : " (not found)"); chip.title = "No matching element; sent as text."; if (entity && "label" in entity) chip.title = entity.label ?? chip.title; if (entity && "text" in entity) chip.title = entity.text; $("mentions").append(chip); }
}
$("message-input").addEventListener("input", renderMentions);
// Push to talk: the browser's own speech recognition (Chrome and Safari send the audio to Google/Apple). Hold the button,
// the recognised words appear live in the box without focusing it (no phone keyboard); release to stop. EN or BG.
const TALK_LANGS = { "en-US": "EN", "bg-BG": "BG" };
let talkLang = localStorage.getItem("plan3-talk-lang") in TALK_LANGS ? localStorage.getItem("plan3-talk-lang") : "en-US", talking;
$("talk-lang").textContent = TALK_LANGS[talkLang];
$("talk-lang").addEventListener("click", () => { talkLang = talkLang === "en-US" ? "bg-BG" : "en-US"; localStorage.setItem("plan3-talk-lang", talkLang); $("talk-lang").textContent = TALK_LANGS[talkLang]; });
function startTalk() {
 const Speech = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
 if (!Speech) return showNotice("This browser has no speech recognition (Brave and Firefox lack it); try Chrome, Edge or Safari.");
 if (talking) return;
 const input = $("message-input"), base = input.value && !/\s$/.test(input.value) ? input.value + " " : input.value, recognition = new Speech();
 talking = recognition; recognition.lang = talkLang; recognition.interimResults = true; recognition.continuous = true;
 recognition.onresult = event => { input.value = base + [...event.results].map(result => result[0].transcript).join(""); input.scrollTop = input.scrollHeight; input.dispatchEvent(new Event("input")); };
 recognition.onerror = event => { if (event.error !== "aborted" && event.error !== "no-speech") showNotice(event.error === "not-allowed" ? "Microphone blocked: allow it for this site in the browser settings." : "Speech recognition failed: " + event.error); };
 recognition.onend = () => { if (talking === recognition) talking = undefined; $("talk").classList.remove("live"); };
 $("talk").classList.add("live"); recognition.start();
}
const stopTalk = () => talking?.stop();
$("talk").addEventListener("pointerdown", event => { event.preventDefault(); $("talk").setPointerCapture(event.pointerId); startTalk(); });
for (const type of ["pointerup", "pointercancel"]) $("talk").addEventListener(type, stopTalk);
$("talk").addEventListener("contextmenu", event => event.preventDefault());
$("talk").addEventListener("keydown", event => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); startTalk(); } });
$("talk").addEventListener("keyup", event => { if (event.key === " " || event.key === "Enter") stopTalk(); });
// Clipboard and attached images become temp files (like Pi's terminal paste); the chat gets their path.
$("message-input").addEventListener("paste", event => {
 const file = [...(event.clipboardData?.items ?? [])].find(item => item.type.startsWith("image/"))?.getAsFile(); if (!file) return;
 event.preventDefault(); void attach(file, $("message-input"));
});
$("attach").addEventListener("change", () => { const input = $("attach") as HTMLInputElement, file = input.files?.[0]; input.value = ""; if (file) void attach(file, $("message-input")); });
// Saves the image like a terminal paste and inserts its path at the cursor of `input` (chat box or a prompt's answer box).
async function attach(file: File, input: HTMLTextAreaElement) {
 showNotice("Saving image\u2026");
 try {
  const response = await fetch("api/paste", { ...auth, method: "POST", headers: { ...auth.headers, "Content-Type": file.type }, body: file });
  const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "Image paste failed.");
  const at = input.selectionStart; input.setRangeText((at && !/\s/.test(input.value[at - 1]) ? " " : "") + value.path + " ", at, input.selectionEnd, "end"); input.scrollTop = input.scrollHeight; input.focus(); input.dispatchEvent(new Event("input"));
  if (input === $("message-input")) toBottom(); showNotice("Image saved: " + value.path, true);
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
// Touch keyboards have no Shift+Enter, so there Enter adds a line and only Send sends.
const touchKeyboard = matchMedia("(pointer: coarse)");
$("message-input").addEventListener("keydown", event => {
 if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !touchKeyboard.matches) { event.preventDefault(); $("composer").requestSubmit(); }
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
 try { const result = await post("message", { text, target: diagramTarget() ?? target, ...(parts.size ? { diagrams: [...parts].map(([target, ids]) => ({ target, ids })) } : {}) }); editLines = editLines.filter(item => !sent.includes(item)); if ($("message-input").value === text) $("message-input").value = ""; renderMentions(); showNotice(result.queued ? "Sent; it steers the running agent." : "Message sent.", true); }
 catch (error) { showNotice(error.message + ". Your message draft is kept."); }
 finally { messageSending = false; renderShell(); }
});
// Menus: one open at a time; Escape or a click elsewhere closes and returns focus to its button.
const menus = [["review-button", "review-menu"], ["model-button", "model-menu"], ["context-button", "context-menu"], ["bias-button", "bias-menu"], ["settings-button", "settings-menu"], ["plan-button", "plan-menu"], ["title", "title-menu"]];
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
// Phones: the title opens the plans with their commands (the plan menu moves under it); sessions live in the drawer.
async function openTitlePlans() {
 toggleMenu("title", "title-menu"); if ($("title-menu").hidden) return;
 $("plan-menu").hidden = false; await loadPlans($("plan-list")); $("plan-divider").hidden = !$("plan-list").querySelector(".plan-option");
}
$("title-plan").addEventListener("click", () => void openTitlePlans());
$("title").addEventListener("click", () => phone.matches ? void openTitlePlans() : !$("switcher").hidden && toggleSwitcher($("switcher").dataset.open !== "true"));
function newPlan() {
 setDrawer(false); const input = $("message-input"); input.value = "/plan3 "; input.focus(); input.setSelectionRange(input.value.length, input.value.length);
 showNotice("Describe the plan after /plan3 and send.");
}
// Plan menu: open plans on top (the shown one marked, the session's current one labelled), a divider, then actions.
$("plan-button").addEventListener("click", async () => {
 if (phone.matches) { setDrawer(false); if ($("title-menu").hidden) await openTitlePlans(); return; }
 if (!$("plan-menu").hidden) return toggleMenu("plan-button", "plan-menu", false);
 toggleMenu("plan-button", "plan-menu", true); await loadPlans($("plan-list"));
 $("plan-divider").hidden = !$("plan-list").querySelector(".plan-option");
});
// The open plans, the shown one pressed and the session's current one labelled; picking one shows its diagram.
async function loadPlans(list: HTMLElement) {
 try {
  const { plans, current } = await get("plans") as { plans: { id: string; title: string; done?: number; total?: number }[]; current: string | null };
  list.replaceChildren(...plans.map(item => {
   const pick = Object.assign(document.createElement("button"), { type: "button", className: "plan-option", textContent: item.title + (item.total ? ` · ${item.done ?? 0}/${item.total}` : "") + (item.id === current ? " (current)" : "") });
   pick.setAttribute("aria-pressed", String(item.id === target));
   pick.addEventListener("click", () => { if (item.id === target) return closeMenus(); const url = new URL(location.href); url.searchParams.set("target", item.id); location.assign(url); });
   return pick;
  }));
 } catch (error) { list.replaceChildren("Plans failed to load: " + error.message); }
}
$("review-button").addEventListener("click", () => toggleMenu("review-button", "review-menu"));
// Plan commands go through /api/command with the shown plan (a typed "/plan3 review <id>" would not name the plan).
for (const button of document.querySelectorAll<HTMLElement>("#plan-menu [data-command], #plan-actions [data-command]")) button.addEventListener("click", async () => {
 const command = button.dataset.command; closeMenus(); setDrawer(false);
 if (command === "new") return newPlan();
 if (command === "delete" && !confirm(`Delete the plan "${state.plan?.title ?? "shown here"}" and its diagram permanently?`)) return;
 if (command === "force finish" && !confirm(`Force finish "${state.plan?.title ?? "this plan"}"? It is archived as complete; its unfinished steps are listed in the plan.`)) return;
 if (commandSending) return; commandSending = true; renderShell();
 try {
  await post("command", { command }); showNotice("");
  // The deleted plan can't be shown any more; fall back to the session's current plan or the project diagram.
  if (command === "delete" || command === "force finish") { const url = new URL(location.href); url.searchParams.delete("target"); location.assign(url); }
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
// H5-05 session bar: every hub session grouped by folder, colour-coded (orange working, red waiting, blue unseen idle,
// grey seen idle, dim parked), plus Recents (D18) closed by default. One hub, so links are plain /s/<id>/ pages.
type Tone = "working" | "waiting" | "unseen" | "seen" | "parked" | "terminal";
type HubSession = { id: string; name: string; tone: Tone; plan?: { done: number; total: number } };
type Group = { folder: string; label: string; sessions: HubSession[] };
type Recent = { file: string; folder: string; label: string; name: string | null; modified: number };
const sessionId = location.pathname.split("/")[2] ?? "";
// The unsent message survives switching sessions and reloads, per session; pagehide also catches programmatic edits (send clears it).
const draftKey = "plan3-draft:" + sessionId, saveDraft = () => { try { const value = $("message-input").value; if (value) localStorage.setItem(draftKey, value); else localStorage.removeItem(draftKey); } catch { /* private mode */ } };
try { if (!$("message-input").value) $("message-input").value = localStorage.getItem(draftKey) ?? ""; } catch { /* private mode */ }
$("message-input").addEventListener("input", saveDraft); addEventListener("pagehide", saveDraft);
const sessionUrl = (id: string) => `/s/${id}/` + (token ? "?token=" + encodeURIComponent(token) : "");
let sessionsTimer = 0, sessionOrder: string[] = [], ownFolder = "";
// Tab icon over every shared session: red when any asks something, blue while any works, a shovel laid down when all rest.
function renderIcon() {
 const waiting = promptView.busy || !!state.activity.dialog || sessionStates.includes("waiting");
 const working = !!state.activity.working || !!state.activity.subagents?.length || sessionStates.includes("working");
 const key = waiting ? "waiting" : working ? "working" : "idle";
 if (key === iconKey) return; iconKey = key;
 const back = { waiting: "#e03131", working: "#1c7ed6", idle: "" }[key], handle = back ? "#ffd8a8" : "#c4893f", blade = back ? "#fff" : "#495057";
 const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${back ? `<rect width="32" height="32" rx="7" fill="${back}"/>` : ""}<g transform="${back ? "translate(0 1) scale(.9) translate(1.8 0) rotate(40 16 16)" : "translate(0 6) rotate(90 16 16)"}"><rect x="14.5" y="3" width="3" height="16" rx="1.5" fill="${handle}"/><rect x="10.5" y="1.5" width="11" height="3.5" rx="1.75" fill="${handle}"/><path d="M9.5 18.5h13v5.5a6.5 6.5 0 0 1-13 0z" fill="${blade}"/></g></svg>`;
 document.querySelector<HTMLLinkElement>("link[rel=icon]")!.href = "data:image/svg+xml," + encodeURIComponent(svg);
}
async function loadSessions() {
 clearTimeout(sessionsTimer);
 // A background tab keeps polling, slower, so its icon still shows the other sessions.
 const visible = document.visibilityState === "visible";
 try {
  const { groups, recents } = await get("sessions") as { groups: Group[]; recents: Recent[] };
  sessionStates = groups.flatMap(group => group.sessions.filter(session => session.id !== sessionId).map(session => session.tone)); renderIcon();
  renderSessions(groups, recents);
 } catch (error) { showNotice("Sessions failed to load: " + error.message); }
 void checkPairing();
 sessionsTimer = window.setTimeout(loadSessions, visible ? 5000 : 15000);
}
// H6-03 (D19): new devices are approved, and paired ones revoked, on local hub pages only: remote pages carry no key.
async function hub(route: string, data?: unknown) {
 const response = await fetch("../../api/" + route, data === undefined ? auth : { ...auth, method: "POST", headers: { ...auth.headers, "Content-Type": "application/json" }, body: JSON.stringify(data) });
 const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "HTTP " + response.status); return value;
}
const pairDialog = () => $("pair-approve") as HTMLDialogElement;
async function checkPairing() {
 if (!token) return;
 $("devices-button").hidden = false;
 let pending; try { ({ pending } = await hub("pairing")); } catch { return; }
 if (!pending) { if (pairDialog().open) pairDialog().close(); return; }
 $("pair-device").textContent = `${pending.label} · ${pending.login} · ${pending.address}`; $("pair-approve-code").textContent = pending.code;
 if (!pairDialog().open) { pairDialog().showModal(); $("pair-reject").focus(); }
}
async function decidePairing(approve: boolean) {
 if (pairDialog().open) pairDialog().close();
 try { await hub("pairing", { approve }); showNotice(approve ? "Device paired." : "Device rejected."); } catch (error) { showNotice("Pairing: " + error.message); }
}
$("pair-accept").addEventListener("click", () => void decidePairing(true));
$("pair-reject").addEventListener("click", () => void decidePairing(false));
// Escape means no: an unanswered request would reopen with every poll.
pairDialog().addEventListener("cancel", event => { event.preventDefault(); void decidePairing(false); });
async function showDevices() {
 const [{ devices }, { remote }] = await Promise.all([hub("devices"), hub("status")]);
 $("devices-remote").textContent = !remote.on ? "Remote access is off (pi-hub remote on)." : remote.url ? "Remote address: " + remote.url : "Remote access is on but not served: " + (remote.error ?? remote.missing?.join(" "));
 $("device-list").replaceChildren(...(devices.length ? devices.map(device => {
  const row = html("li"), revoke = html("button", { type: "button", className: "danger", textContent: "Revoke" });
  revoke.setAttribute("aria-label", "Revoke " + device.label);
  revoke.addEventListener("click", () => void hub(`devices/${device.id}/revoke`, {}).then(showDevices, error => showNotice("Revoke: " + error.message)));
  row.append(html("span", { textContent: `${device.label} · ${device.login} · last used ${new Date(device.lastUsed).toLocaleString()}` }), revoke);
  return row;
 }) : [html("li", { textContent: "No paired devices." })]));
 const dialog = $("devices") as HTMLDialogElement; if (!dialog.open) dialog.showModal();
}
$("devices-button").addEventListener("click", () => void showDevices().catch(error => showNotice("Devices: " + error.message)));
$("devices-close").addEventListener("click", () => ($("devices") as HTMLDialogElement).close());
const words: Record<Tone, string> = { working: "working", waiting: "waiting for an answer", unseen: "idle, new activity", seen: "idle", parked: "parked", terminal: "open in a terminal" };
function html<K extends keyof HTMLElementTagNameMap>(tag: K, properties: Partial<HTMLElementTagNameMap[K]> = {}) { return Object.assign(document.createElement(tag), properties); }
// EU style: Today 14:05, Yesterday 09:12, else 18/10/2026 14:05.
function whenText(time: number) {
 const date = new Date(time), pad = (n: number) => String(n).padStart(2, "0"), clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
 const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(time).setHours(0, 0, 0, 0)) / 86_400_000);
 return `${days === 0 ? "Today" : days === 1 ? "Yesterday" : `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`} ${clock}`;
}
function renderSessions(groups: Group[], recents: Recent[]) {
 $("switcher").hidden = false; document.body.classList.add("has-switcher");
 sessionOrder = groups.flatMap(group => group.sessions.map(session => session.id));
 ownFolder = groups.find(group => group.sessions.some(session => session.id === sessionId))?.folder ?? "";
 const open = $("session-list").querySelector<HTMLDetailsElement>(".session-recents")?.open ?? false;
 const rows = groups.flatMap(group => {
  const head = html("div", { className: "session-group" });
  const add = html("button", { type: "button", className: "session-add", textContent: "+", title: `New session in ${group.label} (Alt+N)` });
  add.setAttribute("aria-label", `New session in ${group.label}`); add.addEventListener("click", () => void newSession(group.folder));
  head.append(html("span", { className: "session-group-label", textContent: group.label, title: group.folder }), add);
  // One framed box per folder: red while one waits for an answer, orange while one works, light blue for the open session's folder.
  const box = html("div", { className: "session-folder" }), tones = group.sessions.map(session => session.tone);
  const tone = tones.includes("waiting") ? "waiting" : tones.includes("working") ? "working" : group.sessions.some(session => session.id === sessionId) ? "current" : "";
  if (tone) box.dataset.tone = tone;
  box.append(head, ...group.sessions.map(session => sessionRow(session, group.label)));
  return [box];
 });
 const recent = html("details", { className: "session-recents", open });
 recent.append(html("summary", { textContent: `Recents (${recents.length})` }), ...recents.map(item => {
  const row = html("div", { className: "session recent" }), name = item.name ?? whenText(item.modified);
  const starButton = html("button", { type: "button", className: "session-more", textContent: "☆", title: "Star: add it to its folder group" });
  starButton.setAttribute("aria-label", `Star ${item.label} · ${name}`);
  starButton.addEventListener("click", () => { const as = prompt(`Name for this session in ${item.label} (empty = next number):`, ""); if (as !== null) void sessionAction({ action: "star", file: item.file, name: as }); });
  // Two lines: folder (and name) above, the time below.
  const text = html("span", { className: "session-label recent-text", title: item.file });
  text.append(html("span", { textContent: item.name ? `${item.label} · ${item.name}` : item.label }), html("small", { className: "recent-when", textContent: whenText(item.modified) }));
  row.append(text, starButton);
  return row;
 }));
 // Inside the list, so the phone drawer gets it too.
 const newFolder = html("button", { type: "button", className: "session-devices", textContent: "New folder" });
 newFolder.addEventListener("click", () => { const folder = prompt("Full path of the folder to start a Pi session in:"); if (folder?.trim()) void newSession(folder.trim()); });
 $("session-list").replaceChildren(...rows, recent, newFolder);
}
function sessionRow(session: HubSession, folder: string) {
 const row = html("div", { className: "session" }); row.dataset.tone = session.tone;
 const link = html("a", { className: "session-link", href: sessionUrl(session.id), title: `${folder} - ${session.name} · ${words[session.tone]}` });
 link.setAttribute("aria-label", `${session.name} in ${folder}, ${words[session.tone]}${session.id === sessionId ? ", this session" : ""}`);
 if (session.id === sessionId) row.setAttribute("aria-current", "page");
 link.append(html("span", { className: "session-letter", textContent: (session.name.trim()[0] ?? "?").toUpperCase() }), html("span", { className: "session-label", textContent: session.name }), html("small", { className: "session-state", textContent: words[session.tone] }));
 const more = html("button", { type: "button", className: "session-more", textContent: "⋯", title: "Session actions" });
 more.setAttribute("aria-haspopup", "true"); more.setAttribute("aria-label", `Actions for ${session.name}`);
 more.addEventListener("click", event => { event.stopPropagation(); openSessionMenu(more, session); });
 row.append(link, more);
 // A plan in progress: steps done/total, then a line filled left to right.
 if (session.plan) {
  const line = html("span", { className: "session-progress", title: `Plan: ${session.plan.done}/${session.plan.total} steps` });
  line.style.setProperty("--fill", Math.round(session.plan.done / session.plan.total * 100) + "%");
  line.append(html("small", { textContent: `${session.plan.done}/${session.plan.total}` }), html("i"));
  line.addEventListener("click", () => link.click()); // the whole row selects the session
  row.append(line);
 }
 return row;
}
// One popup for the row actions; Park/Resume follow the session's state.
const sessionMenu = html("div", { className: "status-menu session-menu", hidden: true }); sessionMenu.setAttribute("role", "menu"); document.body.append(sessionMenu);
function openSessionMenu(anchor: HTMLElement, session: HubSession) {
 const parked = session.tone === "parked";
 const item = (text: string, run: () => void) => { const button = html("button", { type: "button", textContent: text }); button.setAttribute("role", "menuitem"); button.addEventListener("click", () => { sessionMenu.hidden = true; run(); }); return button; };
 // H7-01: a session open in a terminal window comes back by itself when that window closes.
 if (session.tone === "terminal") return showNotice(`"${session.name}" is open in a terminal on the PC; it returns here when that Pi exits.`);
 sessionMenu.replaceChildren(
  item("Rename…", () => { const name = prompt("New name:", session.name); if (name?.trim()) void sessionAction({ action: "rename", id: session.id, name }); }),
  item("Open in terminal", () => void sessionAction({ action: "terminal", id: session.id })),
  parked ? item("Resume", () => void sessionAction({ action: "resume", id: session.id })) : item("Park", () => void sessionAction({ action: "park", id: session.id })),
  ...(parked ? [item("Unstar (keep the file)", () => { if (confirm(`Remove "${session.name}" from its group? The session file stays in Recents.`)) void sessionAction({ action: "unstar", id: session.id }); })] : [item("Reload", () => void sessionAction({ action: "reload", id: session.id }))]),
 );
 const box = anchor.getBoundingClientRect(); sessionMenu.hidden = false;
 sessionMenu.style.position = "fixed"; sessionMenu.style.top = Math.max(8, Math.min(box.bottom, innerHeight - sessionMenu.offsetHeight - 8)) + "px"; sessionMenu.style.left = Math.max(8, Math.min(box.left, innerWidth - sessionMenu.offsetWidth - 8)) + "px";
 sessionMenu.querySelector("button")?.focus();
}
document.addEventListener("pointerdown", event => { if (!sessionMenu.contains(event.target as Node)) sessionMenu.hidden = true; });
sessionMenu.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); sessionMenu.hidden = true; } });
async function sessionAction(data: Record<string, unknown>) {
 try { const value = await post("session", data); await loadSessions(); return value; }
 catch (error) { showNotice(error.message); }
}
async function newSession(folder: string) {
 const created = await sessionAction({ action: "new", folder }) as { id?: string } | undefined;
 if (created?.id) location.assign(sessionUrl(created.id));
}
// D5 keyboard shortcuts: Alt+↑/↓ previous or next session, Alt+N new session in this folder (Esc in the chat box stops a run).
window.addEventListener("keydown", event => {
 if (!event.altKey || event.ctrlKey || event.metaKey) return;
 if (event.key === "ArrowUp" || event.key === "ArrowDown") {
  const at = sessionOrder.indexOf(sessionId), next = sessionOrder[at + (event.key === "ArrowDown" ? 1 : -1)];
  if (at >= 0 && next) { event.preventDefault(); location.assign(sessionUrl(next)); }
 }
 if (event.key.toLowerCase() === "n" && ownFolder) { event.preventDefault(); void newSession(ownFolder); }
});
// Desktop session bar: open by default; collapsing to the letter stripe is remembered.
function toggleSwitcher(open: boolean) { localStorage.setItem("plan3-switcher", open ? "open" : "closed"); document.body.classList.toggle("switcher-open", open); $("switcher").dataset.open = String(open); $("switcher-toggle").setAttribute("aria-expanded", String(open)); $("switcher-toggle").setAttribute("aria-label", open ? "Hide shared sessions" : "Show shared sessions"); }
$("switcher-toggle").addEventListener("click", () => toggleSwitcher($("switcher").dataset.open !== "true"));
$("switcher").addEventListener("keydown", event => { if (event.key === "Escape" && $("switcher").dataset.open === "true") { event.stopPropagation(); toggleSwitcher(false); $("switcher-toggle").focus(); } });
toggleSwitcher(localStorage.getItem("plan3-switcher") !== "closed");
document.addEventListener("visibilitychange", () => void loadSessions());
void loadSessions();
// Subscription usage: one bar per provider (7d left, coloured like the footer, warnings in their colour);
// tapping one opens its window: every quota window as a bar, the pool's notes and, for Claude, the account pool.
type Segment = { text: string; color?: string };
type UsageBar = { label: string; left: number; color: string; resets?: string; at?: string };
type Usage = { id: string; label: string; left: number; color: string; resets?: string; bars?: UsageBar[]; warnings?: Segment[]; notes?: string[] };
let usage: Usage[] = [], usageLines: Segment[][] = [], usageAccounts: Segment[] = [], usageTimer = 0, usageShown = "";
const el = (tag: string, className: string, text = "") => Object.assign(document.createElement(tag), { className, textContent: text });
const tone = (color?: string) => color === "error" || color === "warning" || color === "success" ? color : "accent";
async function loadUsage() {
 clearTimeout(usageTimer); if (document.visibilityState !== "visible") return;
 try {
  const value = await get("usage") as { summary: Usage[]; lines: Segment[][]; accounts?: Segment[] };
  usage = value.summary; usageLines = value.lines; usageAccounts = value.accounts ?? [];
  $("usage-button").hidden = !usage.length;
  $("usage-button").replaceChildren(...usage.map(item => {
   const button = el("button", "bar usage-bar"); button.type = "button"; button.dataset.provider = item.id;
   button.append(el("span", "usage-item", `${item.label}: ${item.left}%${item.resets ? " " + item.resets : ""}`), ...(item.warnings ?? []).map(w => el("span", "usage-warning tone-" + w.color, " · " + w.text)));
   // A warning outranks the quota colour: the expiring week is the thing to act on.
   setBar(button, item.left, tone(item.warnings?.find(w => w.color === "error")?.color ?? item.warnings?.[0]?.color ?? item.color));
   button.title = (usageLines.find(line => line[0]?.text === item.label) ?? []).map(part => part.text).join("") || item.label;
   button.addEventListener("click", () => void openUsage(item.id));
   return button;
  }));
  if (usageShown && ($("usage-window") as HTMLDialogElement).open) void openUsage(usageShown, false);
 } catch { $("usage-button").hidden = true; }
 usageTimer = window.setTimeout(loadUsage, 120_000);
}
// The Claude pool's own row text carries ANSI colours (it is the /claude-pool menu line).
function ansi(text: string) {
 const line = el("div", "pool-line"); let color = "";
 for (const [index, piece] of text.split(/\x1b\[(\d+)m/).entries()) {
  if (index % 2) { color = ({ 31: "error", 32: "success", 33: "warning", 34: "accent" })[piece] ?? ""; continue; }
  if (piece) line.append(color ? el("span", "tone-" + color, piece) : piece);
 }
 return line;
}
type PoolRow = { label: string; line: string; active: boolean; favorite: boolean; weekend: boolean; disabled: boolean; dead: boolean };
async function poolAct(act: string, label = "") {
 if (act === "remove" && !confirm(`Remove "${label}" from the Claude pool?`)) return;
 try { const result = await post("pool", { act, label }) as { message?: string }; if (result.message) showNotice(result.message); }
 catch (error) { showNotice(error.message); }
 void loadUsage();
}
async function openUsage(id: string, open = true) {
 const item = usage.find(entry => entry.id === id), dialog = $("usage-window") as HTMLDialogElement;
 if (!item) return;
 usageShown = id; $("usage-title").textContent = item.label + " usage";
 const body: HTMLElement[] = (item.bars ?? []).map(bar => {
  const row = el("div", "bar usage-window-bar");
  row.append(el("b", "", bar.label), ` ${bar.left}% left${bar.resets ? " · resets in " + bar.resets : ""}${bar.at ? " (" + bar.at + ")" : ""}`);
  setBar(row, bar.left, tone(bar.color)); return row;
 });
 body.push(...(item.warnings ?? []).map(w => el("p", "usage-alert tone-" + w.color, "⚠ " + w.text)), ...(item.notes ?? []).map(note => el("p", "dialog-purpose", note)));
 if (id === "claude") {
  let pool: { title: string; drain7d: boolean; rows: PoolRow[] } | null = null;
  try { pool = await get("pool"); } catch { pool = null; }
  if (pool?.rows.length) {
   const tools = el("div", "pool-tools");
   const refresh = el("button", "", "↻ Refresh usage"), drain = el("button", pool.drain7d ? "on" : "", pool.drain7d ? "Drain 7d: on" : "Drain 7d: off");
   refresh.title = "Fetch every account's usage now"; drain.title = "Drain 7d: serve the soonest-expiring week first, ignoring 5h";
   refresh.addEventListener("click", () => void poolAct("refresh")); drain.addEventListener("click", () => void poolAct("mode"));
   tools.append(el("h3", "", pool.title), refresh, drain);
   body.push(tools, ...pool.rows.map(row => {
    const box = el("div", "pool-row" + (row.active ? " active" : "") + (row.disabled || row.dead ? " off" : ""));
    const actions = el("div", "pool-actions");
    const action = (act: string, text: string, title: string, on = false) => { const b = el("button", on ? "on" : "", text); b.type = "button"; b.title = title; b.addEventListener("click", () => void poolAct(act, row.label)); actions.append(b); };
    action("switch", "Use", "Switch to this account now (held until it runs out)", row.active);
    action("favorite", "★", "Favourite", row.favorite); action("weekend", "Wknd", "Weekend account", row.weekend);
    action("up", "↑", "Raise priority"); action("down", "↓", "Lower priority");
    action("toggle", row.disabled ? "Enable" : "Disable", row.disabled ? "Put back in rotation" : "Take out of rotation");
    action("remove", "✕", "Remove from the pool");
    box.append(ansi(row.line), actions); return box;
   }));
  } else if (usageAccounts.length) body.push(el("h3", "", "Accounts · 7d left · resets in"), ...usageAccounts.map(part => el("div", "usage-line tone-" + part.color + (part.text.startsWith("→") ? " current" : ""), part.text)));
 }
 $("usage-body").replaceChildren(...body);
 if (open && !dialog.open) dialog.showModal();
}
$("usage-close").addEventListener("click", () => { usageShown = ""; ($("usage-window") as HTMLDialogElement).close(); });
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
 const menu = $("bias-menu"), current = biasNow(), labels = state.plan ? BIAS_LABEL : SESSION_BIAS;
 menu.replaceChildren(...(state.plan ? [2, 1, 0, -1, -2] : [1, 0, -1]).map(level => {
  const button = Object.assign(document.createElement("button"), { type: "button", textContent: labels[level] }); button.dataset.level = String(level);
  button.setAttribute("aria-pressed", String(level === current));
  button.addEventListener("click", async () => {
   closeMenus(); setDrawer(false);
   try { await post("bias", { level }); showNotice(""); } catch (error) { showNotice(error.message); }
  });
  return button;
 }));
 toggleMenu("bias-button", "bias-menu");
});
$("settings-button").addEventListener("click", () => toggleMenu("settings-button", "settings-menu"));
$("hub-restart").addEventListener("click", async () => {
 closeMenus(); setDrawer(false);
 if (!confirm("Restart the hub? Every session stops and starts again; nothing is lost.")) return;
 try { await post("hub", { action: "restart" }); showNotice("Hub restarting; the page reconnects by itself.", true); } catch (error) { showNotice(error.message); }
});
// PC load every 5 s while the page is visible; 24 samples = the last 2 minutes.
const loadSamples: { cpu: number; memory: number }[] = [];
async function pollLoad() {
 if (document.hidden) return;
 try { loadSamples.push(await get("system")); } catch { return; }
 if (loadSamples.length > 24) loadSamples.shift();
 for (const [key, name] of [["cpu", "CPU"], ["memory", "Memory"]] as const) {
  const box = $("load-" + key), value = loadSamples.at(-1)![key];
  box.querySelector("polyline")!.setAttribute("points", loadSamples.map((sample, index) => `${index * 2 + 48 - loadSamples.length * 2},${(20 - sample[key] / 5).toFixed(1)}`).join(" "));
  box.querySelector("span")!.textContent = String(value);
  box.setAttribute("aria-label", `${name} ${value}%`); box.title = `${name} ${value}% (graph: last 2 minutes)`;
 }
}
void pollLoad(); setInterval(pollLoad, 5000);
$("hub-update").addEventListener("click", async () => {
 closeMenus(); setDrawer(false);
 if (!confirm("Update Pi and extensions? Every session stops, pi update --all runs, then they start again; nothing is lost. Pi outside the hub (herdr, terminals) keeps the old version until restarted.")) return;
 try { await post("hub", { action: "update" }); showNotice("Updating Pi and extensions; the page reconnects when the hub is back (a minute or two).", true); } catch (error) { showNotice(error.message); }
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
 state.connected = true; state.plan = value.plan; state.status = value.status ?? null;
 // A plan picked in the menu that isn't Pi's current one: the plan bar names the shown plan, not "New plan".
 if (target && target !== "product" && value.plan?.id !== target) void get("plans").then(({ plans }) => { const shown = plans.find(item => item.id === target); if (shown) { state.plan = shown; renderShell(); } }, () => {}); state.activity = value.activity ?? {}; state.more = !!value.more;
 chat.clear(); for (const row of value.chat ?? []) chat.set(row.id, row);
 // Dialogs over 16 KB arrive brief; fetch their full body.
 promptView.sync((value.dialogs ?? []).filter(ask => !ask.brief));
 for (const ask of value.dialogs ?? []) if (ask.brief) get("dialog?id=" + encodeURIComponent(ask.askId)).then(full => { promptView.pending(full); renderShell(); }, error => showNotice(error.message)); renderActivity(); renderChat(); showNotice(""); renderShell();
 void Promise.all([loadDiagram("project"), loadDiagram("plan")]).then(() => {
  // A session with no diagrams opens with the chat expanded; not remembered, so sessions with diagrams keep the reader's layout.
  if (firstSnapshot && !Object.values(diagrams).some(item => item?.nodes?.length || item?.notes?.length)) { setLeft("collapsed"); remember("plan3-left", leftChoice); }
  firstSnapshot = false;
 });
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
 events = new EventSource("api/events?" + query);
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
