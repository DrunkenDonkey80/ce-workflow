// Browser-only source; the server strips erasable types without a build step.
import type { Diagram } from "../../extensions/plan3-diagram.ts";
import type { createActivityMirror } from "../../extensions/plan3-web.ts";
// @ts-ignore Browser URL includes the workspace token.
import { createDiagramView, element, seed } from "./diagram.js?token=__TOKEN__";
// Optional icons may be absent from an already-running hub after an update.
// @ts-ignore Browser URL includes the workspace token.
const { ICONS, iconSvg, BUTTON_ICONS } = await import("./icons.js?token=__TOKEN__").catch(() => ({ ICONS: {} as Record<string, [string, string, boolean]>, iconSvg: (_name: string, _states?: string[]) => "", BUTTON_ICONS: {} as Record<string, [string, string]> }));
// @ts-ignore Browser URL includes the workspace token.
import { createFilesView } from "./files.js?token=__TOKEN__";
// @ts-ignore Browser URL includes the workspace token.
import { createPromptView } from "./prompts.js?token=__TOKEN__";
// @ts-ignore Browser URL includes the workspace token.
import { applyText } from "./stream.js?token=__TOKEN__";
// @ts-ignore Browser URL includes the workspace token.
import { annotate, confirmBox, legend } from "./annotate.js?token=__TOKEN__";
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
const state: { connected: boolean; diagram: Diagram | null; plan: Plan | null; status: { model: Model | null; effort: string | null; context?: number | null; tokens?: number | null; estimated?: boolean; window?: number | null; git?: GitFiles | null; folder?: string; tab?: string; parked?: boolean } | null; activity: Partial<ReturnType<ReturnType<typeof createActivityMirror>["snapshot"]> & { thinkingLength: number }>; pinning: boolean; more: boolean } = { connected: false, diagram: null, plan: null, status: null, activity: {}, pinning: false, more: false };
let commentPoint, hoverTimer, messageSending = false, commandSending = false;
const chat = new Map();

const BIAS_LABEL = { "-2": "Worker (Plan)", "-1": "Worker (Task)", 0: "Default", 1: "Thinker (Task)", 2: "Thinker (Plan)" };
// Without a plan the bias is per session: Thinker / Default / Worker.
const SESSION_BIAS = { "-1": "Worker", 0: "Default", 1: "Thinker" };
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
let sessionStates: string[] = [], ownTone = "", iconKey = "", appleFor = "";
let navRequest: { n: number; dir: number; ctrl: boolean } | null = null; // a back/forward press for the app (see piHubGo)
// D5: inside the desktop app (user agent marker) the title is a machine line the app reads for its tab, taskbar and tray.
const inApp = () => navigator.userAgent.includes("PiHubApp/");
// Small line icons for the header buttons; each has its own colour in styles.css (.ui-icon[data-icon]).
const ICON_PATHS: Record<string, string> = {
 think: '<circle cx="8" cy="8" r="6.5"/><path d="M6 6.3a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.3v.4"/><path d="M8 11.8v.1"/>',
 research: '<path d="M3 1.5h7.5l2.5 2.5v4M3 1.5v13h5"/><path d="M5.5 5h4M5.5 8h2"/><circle cx="11" cy="11.5" r="2.3"/><path d="m12.7 13.2 1.8 1.8"/>',
 night: '<path d="M13.5 9.8A6 6 0 1 1 6.2 2.5a4.7 4.7 0 0 0 7.3 7.3z"/>',
 env: '<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3M6 8.5h4M6 11h4"/>',
};
function icon(name: string) {
 const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
 const colour = BUTTON_ICONS[name];
 svg.setAttribute("viewBox", colour?.[0] ?? "0 0 16 16"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("class", colour ? "ui-icon color-icon" : "ui-icon"); svg.dataset.icon = name;
 svg.innerHTML = colour?.[1] ?? ICON_PATHS[name] ?? ""; return svg;
}
function renderShell() {
 // "<folder> - <session name>"; the tab title adds the current plan (H5-05).
 const status = state.status, plan = state.plan, head = [status?.folder, status?.tab].filter(Boolean).join(" - ");
 const title = head || plan?.title || "Architecture workspace", full = head && plan?.title ? `${head}: ${plan.title}` : title;
 $("title").textContent = title; $("title").title = full;
 // Phones: a second top-bar line with the plan name left and its steps right.
 $("title-plan").hidden = !plan?.title; $("title-plan").title = plan?.title ?? "";
 if (plan?.title) { const [name, steps] = $("title-plan").children; name.textContent = plan.title; steps.textContent = plan.total ? `${plan.done ?? 0}/${plan.total}` : ""; }
 // Cheap cue for a backgrounded tab (D20): a waiting answer shows in the tab title.
 if (!inApp()) document.title = promptView.busy || state.activity.dialog ? "(!) " + full + " needs an answer" : full;
 renderIcon();
 // D19 status line. Line 1: [model: effort] [Context: n%] [? bias]; line 2: the plan as a progress bar (or New plan).
 const effort = status?.effort ? status.effort[0].toUpperCase() + status.effort.slice(1) : "—";
 $("model-button").replaceChildren(icon("model"), (status?.model?.name ?? "Model") + ": " + effort);
 // 120k/1m like Pi's footer; tokens are null right after compaction until the next reply.
 const short = n => n >= 1e6 ? +(n / 1e6).toFixed(1) + "m" : Math.round(n / 1e3) + "k";
 // Research suspends compaction, so the bar fills up to the model's real window instead of the 200k compaction border.
 const researching = ((status as { modes?: { research?: string } })?.modes?.research ?? "off") !== "off";
 const used = typeof status?.tokens === "number" ? status.tokens / (researching && status.window ? status.window : Math.min(COMPACT_AT, status.window || COMPACT_AT)) * 100 : status?.context ?? 0;
 setBar($("context-button"), used, used >= 90 ? "error" : used >= 70 ? "warning" : "accent");
 $("context-button").replaceChildren(icon("context"), html("span", { className: "context-label", textContent: "Context: " }), (status?.window ? (typeof status.tokens === "number" ? (status.estimated ? "~" : "") + short(status.tokens) : "?") + "/" + short(status.window) : typeof status?.context === "number" ? Math.round(status.context) + "%" : "—")); // the phone drawer hides the label
 $("bias-button").replaceChildren(icon("bias"), (plan ? BIAS_LABEL : SESSION_BIAS)[biasNow()] ?? "Normal");
 for (const id of ["model-button", "context-button"] as const) $(id).disabled = !state.connected;
 $("bias-button").disabled = !state.connected;
 // The plan bar names the plan; only the title part truncates, the count stays visible.
 $("plan-button").replaceChildren(Object.assign(document.createElement("span"), { className: "bar-text", textContent: plan?.title ?? "New plan" }), ...plan?.total ? [Object.assign(document.createElement("span"), { className: "bar-count", textContent: `${plan.done ?? 0}/${plan.total}` })] : []);
 $("plan-button").title = plan ? plan.title + " — plan actions" : "Start a new plan";
 setBar($("plan-button"), plan?.total ? (plan.done ?? 0) / plan.total * 100 : 0, "accent");
 for (const button of $("plan-menu").querySelectorAll<HTMLElement>("[data-plan]")) button.hidden = !plan;
 // Session modes: chips toggle them; the chat panel takes the mode's colour.
 const modes = (status as { modes?: { research?: string; night?: string } })?.modes ?? {}, research = modes.research ?? "off", night = modes.night ?? "off";
 $("mode-research").setAttribute("aria-pressed", String(research !== "off")); $("mode-research").replaceChildren(icon("research"), research === "stopping" ? "Research: stopping" : "Research"); $("mode-research").dataset.tone = research === "stopping" ? "warning" : "";
 $("mode-night").setAttribute("aria-pressed", String(night !== "off")); $("mode-night").replaceChildren(icon("night"), night === "paused" ? "Night: paused" : night === "complete" ? "Night: done" : "Night"); $("mode-night").dataset.tone = night === "paused" || night === "complete" ? "warning" : "";
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
 // Commit shows with changed files; Commit and push also with unpushed commits; Pull latest when origin is ahead.
 // The hub reads git on each status (run end, model change) and fetches in the background.
 const git = status?.git, busy = !state.connected || messageSending || !!state.activity.working || promptView.busy;
 $("git-commit").hidden = !git?.changed; $("git-push").hidden = !git?.changed && !git?.ahead; $("git-pull").hidden = !git?.behind;
 $("git-pull-text").textContent = git?.behind ? `Pull latest (${git.behind})` : "Pull latest";
 for (const id of ["git-pull", "git-commit", "git-push", "env-var", "drawer-env-var"]) ($(id) as HTMLButtonElement).disabled = busy;
 renderCommands(status?.commands ?? [], busy);
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
setInterval(() => {
 for (const item of document.querySelectorAll<HTMLElement>(".tool-elapsed")) item.textContent = elapsed(Date.now() - Number(item.dataset.start));
 for (const item of document.querySelectorAll<HTMLElement>(".session-timer")) item.textContent = "⏰ " + elapsed(Number(item.dataset.due) - Date.now());
}, 1000);
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
  if (tool.state === "running" && tool.startedAt) { const clock = make("span", elapsed(Date.now() - tool.startedAt), "tool-elapsed"); clock.dataset.start = String(tool.startedAt); row.firstElementChild!.prepend("(", clock, ") "); } // first, so a stuck tool shows at a glance
  row.className = "tool-row tool-" + (tool.state === "error" ? "error" : tool.state === "done" ? "ok" : "pending") + (tool.parent ? " nested-tool" : "");
  for (const [label, text] of [["Arguments", tool.args], ["Progress", tool.progress], ["Result", tool.result]]) if (text) { row.append(make("strong", label), make("pre", text)); }
 }
 [...root.querySelectorAll(".tool-row")].at(-1)?.classList.add("latest");
 root.classList.toggle("working", !!data.working);
 if (data.queue?.length || data.hasPendingMessages) {
  // Not yet in the context: grey rows with Edit (back into the box) and ✕ (cancel) until Pi delivers them.
  for (const item of data.queue ?? []) {
   const row = make("div", undefined, "queued-msg"), edit = make("button", "edit", "queue-edit") as HTMLButtonElement, drop = make("button", "✕", "queue-drop") as HTMLButtonElement;
   edit.type = drop.type = "button"; edit.title = "Take it back into the box to change (↑ in an empty box)"; drop.title = "Cancel this queued message"; drop.setAttribute("aria-label", "Cancel queued message");
   edit.addEventListener("click", () => void editQueued(item.text)); drop.addEventListener("click", () => void editQueued(item.text, true));
   row.append(make("span", item.text), edit, drop); root.append(row);
  }
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
 for (const id of ["chat-compact", "chat-compact-m"]) { $(id).setAttribute("aria-pressed", String(view !== "expanded")); $(id).replaceChildren(icon("think"), (id === "chat-compact-m" ? "Chat: " : "") + CHAT_LABEL[view]); }
 if (view === "thinking") for (const item of document.querySelectorAll<HTMLDetailsElement>(".block-change[open]")) item.open = false;
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
// The app's frameless window (Windows): the sidebar runs to the top, the app's tab strip lies over the band right of it,
// and the strip's gear opens these settings. The title line tells the app where the sidebar ends (side).
const setFrame = () => document.body.classList.toggle("app-frame", navigator.userAgent.includes("PiHubFrame") && !phone.matches);
phone.addEventListener("change", () => { placeForPhone(); setFrame(); renderShell(); }); placeForPhone(); setFrame();
(window as unknown as { piHubSettings: () => void }).piHubSettings = () => $("settings-button").click();
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
// Ctrl+wheel: the whole page 10% bigger or smaller (50\u2013200%), remembered per hub; a pinch on a touchpad arrives the same way, one step per 120 ms.
let pageZoom = Number(localStorage.getItem("hub-zoom")) || 1, zoomedAt = 0;
document.body.style.zoom = String(pageZoom);
document.addEventListener("wheel", event => {
 if (!event.ctrlKey || event.defaultPrevented) return; // the diagram and image viewer zoom themselves
 event.preventDefault();
 if (event.timeStamp - zoomedAt < 120 || !event.deltaY) return;
 zoomedAt = event.timeStamp;
 pageZoom = Math.round(Math.min(2, Math.max(0.5, pageZoom + (event.deltaY < 0 ? 0.1 : -0.1))) * 10) / 10;
 document.body.style.zoom = String(pageZoom); remember("hub-zoom", String(pageZoom)); fitViewport();
 showNotice(`Size ${Math.round(pageZoom * 100)}%`, true);
}, { passive: false });
const fitViewport = () => {
 const view = window.visualViewport, root = document.documentElement.style, height = view?.height ?? window.innerHeight, top = view?.offsetTop ?? 0;
 // The body's own lengths are zoomed (Ctrl+wheel below), so it gets the visible size divided by its zoom.
 root.setProperty("--app-height", height / pageZoom + "px"); root.setProperty("--app-top", top / pageZoom + "px");
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
const filesView = createFilesView($("files"), { get, image: src => openViewer(src), markdown: (target, text) => renderMarkdown(target, text, new Set()), closed: () => closeExplore() });
// /plan3 architecture links open on the Project tab.
setTab(target === "product" ? "project" : remembered("plan3-tab", [...LEFT_TABS, "diagram"], "plan"));
{ const view = remembered("plan3-mobile", [...mobileViews, "diagram"], "chat"); setMobile(view === "diagram" ? "plan" : view); }
$("search").addEventListener("input", () => { const count = diagramView.search($("search").value); $("search-count").textContent = $("search").value.trim() ? String(count) : ""; });
$("search").addEventListener("keydown", event => {
 if (event.key === "Enter") { event.preventDefault(); diagramView.search($("search").value, true); }
 if (event.key === "Escape") { $("search").value = ""; diagramView.search(""); $("search-count").textContent = ""; $("diagram").focus(); }
});
// Ctrl+F: inside the files/diagram panel it searches the diagram, everywhere else the chat.
window.addEventListener("keydown", event => {
 if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return;
 event.preventDefault();
 if (event.shiftKey) { toggleSwitcher(true); $("session-filter").focus(); ($("session-filter") as HTMLInputElement).select(); return; } // the sidebar filter
 if ((event.target as Element).closest?.("#left-panel") && !$("search").closest("[hidden]")) { $("search").focus(); $("search").select(); return; }
 openChatSearch();
});
// Chat search: marks every hit in the text that is shown now (Compact-hidden rows and closed blocks don't count) with the
// CSS highlight API, so the chat DOM is untouched; it re-runs as the chat changes.
// A hit may cross bold/code/link text but not a block (paragraph, code block, cell) or a chat row.
let findHits: Range[] = [], findKeys: string[] = [], findAt = -1, findQueued = false;
const findInput = () => $("chat-find") as HTMLInputElement;
// Folds case one code point at a time so every folded unit maps back to its source character ("İ" folds to two units);
// lower-upper-lower makes ς, σ and Σ alike, and ẞ, ß and ss.
function foldCase(text: string) {
 if (!/[^\0-\x7f]/.test(text)) return { folded: text.toLowerCase(), from: null, to: null };
 let folded = "", at = 0; const from: number[] = [], to: number[] = [];
 for (const char of text) { const low = char.toLowerCase().toUpperCase().toLowerCase(); folded += low; for (let i = 0; i < low.length; i++) { from.push(at); to.push(at + char.length); } at += char.length; }
 return { folded, from, to };
}
function openChatSearch() { $("chat-search").hidden = false; findInput().focus(); findInput().select(); runChatSearch(); }
function closeChatSearch() { $("chat-search").hidden = true; findHits = []; findKeys = []; findAt = -1; paintChatSearch(); $("message-input").focus(); }
function runChatSearch(keep = false) {
 const needle = foldCase(findInput().value).folded, previous = findKeys[findAt], feed = $("feed");
 findHits = []; findKeys = [];
 if (needle && !$("chat-search").hidden) {
  const blocks = new Map<Element, Element>(), perRow = new Map<string, number>();
  const blockOf = (element: Element): Element => { let block = blocks.get(element); if (!block) { block = element !== feed && element.parentElement && getComputedStyle(element).display === "inline" ? blockOf(element.parentElement) : element; blocks.set(element, block); } return block; };
  let run: Text[] = [], runBlock: Element | null = null;
  const searchRun = () => {
   if (!run.length) return;
   const starts: number[] = []; let length = 0; for (const node of run) { starts.push(length); length += node.length; }
   const { folded, from, to } = foldCase(run.map(node => node.data).join(""));
   // Starts go to the node holding the character, ends to the node holding the one before.
   const point = (index: number, end: boolean): [Text, number] => { let i = run.length - 1; while (i > 0 && (end ? starts[i] >= index : starts[i] > index)) i--; return [run[i], index - starts[i]]; };
   // Rows are re-rendered as they stream, so a hit is known by its row id and its place in that row.
   const row = run[0].parentElement.closest<HTMLElement>("#messages > li, #activity > *"), rowKey = !row ? "feed" : row.parentElement.id + "/" + (row.dataset.id ?? row.tagName + "." + row.className); // id-less activity lines are told apart by kind
   for (let at = folded.indexOf(needle); at >= 0; at = folded.indexOf(needle, at + needle.length)) {
    const range = new Range(); range.setStart(...point(from ? from[at] : at, false)); range.setEnd(...point(to ? to[at + needle.length - 1] : at + needle.length, true)); findHits.push(range);
    const nth = perRow.get(rowKey) ?? 0; perRow.set(rowKey, nth + 1); findKeys.push(rowKey + "#" + nth);
   }
   run = [];
  };
  const walker = document.createTreeWalker(feed, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
   const parent = node.parentElement;
   if (!parent || parent.closest("button, .sr-only") || !parent.checkVisibility?.({ visibilityProperty: true } as CheckVisibilityOptions)) { searchRun(); continue; }
   if (!node.length) continue;
   const block = blockOf(parent); if (block !== runBlock) { searchRun(); runBlock = block; }
   run.push(node);
  }
  searchRun();
 }
 // While the chat updates, stay on the same hit; a new query starts at the newest one.
 findAt = !findHits.length ? -1 : keep && previous ? Math.max(0, findKeys.indexOf(previous)) : findHits.length - 1;
 paintChatSearch();
 if (!keep && findAt >= 0) jumpChatSearch(findAt);
}
function paintChatSearch() {
 $("chat-find-count").textContent = !findInput().value ? "" : findHits.length ? `${findAt + 1}/${findHits.length}` : "0";
 if (!("highlights" in CSS)) return; // no marks on old browsers; count and jumping still work
 CSS.highlights.set("chat-hit", new Highlight(...findHits.filter((_, index) => index !== findAt)));
 CSS.highlights.set("chat-hit-current", new Highlight(...findHits[findAt] ? [findHits[findAt]] : []));
}
function jumpChatSearch(index: number) {
 if (!findHits.length) return;
 findAt = (index + findHits.length) % findHits.length; paintChatSearch();
 stick = false; $("to-bottom").hidden = false; // reading an older hit must not snap back to the end
 findHits[findAt].startContainer.parentElement?.scrollIntoView({ block: "center" });
}
findInput().addEventListener("input", () => runChatSearch());
$("chat-search-m").addEventListener("click", () => { setDrawer(false); setMobile("chat"); openChatSearch(); });
findInput().addEventListener("keydown", event => {
 if (event.key === "Enter") { event.preventDefault(); jumpChatSearch(findAt + (event.shiftKey ? -1 : 1)); }
 if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeChatSearch(); }
});
for (const button of $("chat-search").querySelectorAll<HTMLButtonElement>("[data-find]")) button.addEventListener("click", () => {
 const move = button.dataset.find;
 if (move === "close") return closeChatSearch();
 jumpChatSearch(move === "first" ? 0 : move === "last" ? findHits.length - 1 : findAt + (move === "next" ? 1 : -1));
});
new MutationObserver(() => { if ($("chat-search").hidden || !findInput().value || findQueued) return; findQueued = true; requestAnimationFrame(() => { findQueued = false; runChatSearch(true); }); }).observe($("feed"), { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["open", "hidden", "class"] });

const promptView = createPromptView($("prompt"), $("prompt-form"), post, showNotice, attachTo, renderLinks);
// A session switched to any way (sidebar click, attention key, Alt+1…9, Alt+↑/↓, the filter, a notification) starts with the chat box focused, so you can
// type at once; an open question keeps its own focus. jumpTo carries that over the page load.
// A touch screen is exempt: focusing would pop its keyboard over the chat.
const focusChat = () => { if (!promptView.busy && !matchMedia("(pointer: coarse)").matches) $("message-input").focus(); };
const jumpTo = (id: string) => { sessionStorage.setItem("focus-chat", "1"); location.assign(sessionUrl(id)); };
(window as unknown as { piHubFocus: () => void }).piHubFocus = focusChat;
if (sessionStorage.getItem("focus-chat")) { sessionStorage.removeItem("focus-chat"); focusChat(); }
// Image links and thumbnails open full size in the page (a new tab on a home-screen app may lack the pairing cookie).
document.addEventListener("click", event => {
 const link = (event.target as HTMLElement).closest?.<HTMLAnchorElement>("a.thumb, a.chat-link"); if (!link || !/\/api\/(image|changelog)\?/.test(link.href)) return;
 event.preventDefault(); openViewer(link.href);
});
// The viewer: centred; the wheel zooms at the pointer (the box grows to the screen, then scrolls), a drag pans, a click closes.
const viewer = $("viewer") as HTMLDialogElement, viewed = viewer.querySelector("img")!;
let zoom = 1, fit = 1, drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
function openViewer(src: string) { zoom = 1; viewed.style.cssText = ""; delete viewer.dataset.zoomed; viewed.src = src; viewer.showModal(); }
viewer.addEventListener("wheel", event => {
 event.preventDefault(); if (!viewed.naturalWidth) return;
 const box = viewed.getBoundingClientRect(), x = (event.clientX - box.left) / box.width, y = (event.clientY - box.top) / box.height;
 if (zoom === 1) fit = box.width / viewed.naturalWidth;
 zoom = Math.max(1, Math.min(16, zoom * (event.deltaY < 0 ? 1.25 : 0.8)));
 viewed.style.cssText = zoom > 1 ? `max-width: none; max-height: none; width: ${viewed.naturalWidth * fit * zoom}px` : "";
 if (zoom > 1) viewer.dataset.zoomed = ""; else delete viewer.dataset.zoomed;
 const after = viewed.getBoundingClientRect(); // keep the point under the pointer where it was
 viewer.scrollLeft += after.left + x * after.width - event.clientX; viewer.scrollTop += after.top + y * after.height - event.clientY;
}, { passive: false });
viewer.addEventListener("pointerdown", event => { if (event.button === 0) drag = { x: event.clientX, y: event.clientY, left: viewer.scrollLeft, top: viewer.scrollTop, moved: false }; });
viewer.addEventListener("pointermove", event => {
 if (!drag || !(event.buttons & 1)) return;
 const dx = event.clientX - drag.x, dy = event.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
 if (drag.moved) { viewer.scrollLeft = drag.left - dx; viewer.scrollTop = drag.top - dy; event.preventDefault(); }
});
viewer.addEventListener("click", () => { if (!drag?.moved) viewer.close(); drag = null; });
viewer.addEventListener("dragstart", event => event.preventDefault());
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
 // Thinking view: one open text block per run of thinking, joined across the (hidden) tool calls between them;
 // a file change (edit/write) stays visible there, collapsed, and starts a new run so the order holds.
 let run: HTMLElement | null = null;
 (row.blocks ?? []).forEach((block, index) => {
  if (block.type === "thinking" && block.text?.trim()) {
   if (run) run.textContent += "\n\n" + block.text.trim();
   else { run = Object.assign(document.createElement("div"), { className: "thinking-text", textContent: block.text.trim() }); box.append(run); }
  }
  if (block.ask) { box.append(askExchange(block)); return; }
  const change = block.type === "tool" && (block.name === "edit" || block.name === "write");
  if (change) run = null;
  const item = document.createElement("details"), summary = document.createElement("summary"), key = block.id ?? "thinking_" + index;
  // Pi's tool colours: grey while running, green when done, red on error.
  item.dataset.key = key; item.open = opened.has(key) || (!known.has(key) && change && chatView() === "expanded"); item.className = "block block-" + block.type + (change ? " block-change" : block.type === "tool" && /^read/.test(block.name) ? " block-read" : "") + (block.type === "tool" ? block.error ? " block-error" : block.result === undefined ? " block-pending" : " block-ok" : "");
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
  appendThumbs(box, images); images.clear(); checkFileLinks(box);
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
$("messages").addEventListener("click", async event => {
 const drop = (event.target as HTMLElement).closest<HTMLButtonElement>("#drop-last");
 if (!drop || !await confirmBox("Remove your last message and everything the agent did after it from the context? A running agent stops first.")) return;
 drop.disabled = true;
 try { await post("drop", { text: drop.dataset.text ?? "" }); showNotice("Removed from the context.", true); } catch (error) { showNotice((error as Error).message); } finally { drop.disabled = false; }
});
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
  item.className = "message " + row.role + (text ? "" : " message-blocks") + (finals.has(row.id) ? " final" : "") + (row.blocks?.some(block => block.ask) ? " has-ask" : "") + (row.role === "user" && text.startsWith("⏰ Scheduled") ? " scheduled" : ""); item.hidden = !text && !row.blocks?.length && !note;
  // Rows are told apart by colour (user block vs plain agent text); the label stays for screen readers.
  item.children[0].textContent = text ? (row.role === "user" ? "You:" : "Agent:") : ""; item.children[0].className = "sr-only";
  renderBlocks(item.children[1] as HTMLElement, row); renderLinks(item.children[2] as HTMLElement, row.text);
  item.children[3].textContent = note; (item.children[4] as HTMLElement).hidden = !row.excerpt;
 }
 // ✕ on the last prompt takes it and everything after it out of the context (a prompt sent by mistake).
 const lastPrompt = [...chat.values()].findLast(row => row.role === "user"), drop = $("drop-last") ?? Object.assign(document.createElement("button"), { id: "drop-last", type: "button", className: "drop-last", textContent: "\u2715", title: "Remove this message and everything after it from the context" });
 const dropHost = lastPrompt && !lastPrompt.text.startsWith("!") && list.querySelector<HTMLLIElement>(`:scope > li[data-id="${CSS.escape(lastPrompt.id)}"]`);
 if (dropHost) { drop.dataset.text = lastPrompt.text; if (drop.parentElement !== dropHost) dropHost.append(drop); } else drop.remove();
 // Follow new output only while the reader is at the bottom; otherwise offer a jump button.
 if (follow) feed.scrollTop = feed.scrollHeight; else if (feed.scrollHeight > feed.clientHeight) $("to-bottom").hidden = false;
 fillChat();
}
// File paths in chat text (any extension) become links once the hub confirms the file exists (checkFileLinks); images also
// show as thumbnails (pasted or terminal Alt+V images too). The server shares any file on this PC outside hidden folders.
// A path in double quotes or backticks may contain spaces; file:/// URLs link to the local path they name.
const LINKED_PATH = /(?<![\w:/\\.-])(?:[A-Za-z]:[\\/]|\/)?(?:[^\s"'`<>|*?()[\]:\\/]+[\\/])*[^\s"'`<>|*?()[\]:\\/]+\.[A-Za-z][A-Za-z0-9]{0,9}(?![\w-])/gi;
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|svg)$/i;
// Body of a quoted path: a drive, or a first folder without spaces (so "/review docs/plan.md" or "see docs/a.md" are not one path),
// no colon after that, and a file extension right before the closing quote.
const QUOTED_PATH = String.raw`(?:[A-Za-z]:[\\/]|[\\/]?[^\s"\x60<>|*?:\\/]+[\\/])[^"\x60<>|*?:\r\n]*?\.[A-Za-z][A-Za-z0-9]{0,9}`, WHOLE_QUOTED_PATH = new RegExp("^" + QUOTED_PATH + "$", "i");
function renderLinks(target: HTMLElement, text: string) {
 target.replaceChildren(); const images = new Set<string>(); renderMarkdown(target, text, images); appendThumbs(target, images); checkFileLinks(target);
}
// Chat Markdown subset, built as DOM (never innerHTML): ``` code, | tables |, # headings, **bold**, *italic*, [links](url) and `code`; lists stay as text.
const TABLE_ROW = /^\s*\|.*\|\s*$/, TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
function renderMarkdown(target: HTMLElement, text: string, images: Set<string>) {
 const lines = text.split("\n"); let prose: string[] = [];
 // An image path's thumbnail goes right after its line, not at the end of the message.
 const flush = () => {
  const body = prose.join("\n").replace(/^\n+|\n+$/g, ""); prose = []; if (!body) return;
  let div = document.createElement("div");
  for (const line of body.split("\n")) {
   if (!div.childNodes.length && !line.trim()) continue;
   const before = new Set(images); if (div.childNodes.length) div.append("\n"); inline(div, line, images);
   const added = [...images].filter(path => !before.has(path)); if (!added.length) continue;
   target.append(div); appendThumbs(target, new Set(added)); for (const path of added) images.delete(path); div = document.createElement("div");
  }
  if (div.childNodes.length) target.append(div);
 };
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
// A double-quoted path or a file:/// URL is taken whole, so _ or * in its folder names never splits it.
const INLINE = new RegExp(/`([^`\n]+)`|\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*\n]+?)\*\*|(?<![*\w])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![*\w])|(?<!\w)_(?=\S)([^_\n]+?)(?<=\S)_(?!\w)/.source + '|"(' + QUOTED_PATH + ')"' + String.raw`|(?<!\w)(file:///[^\s"'\x60<>]+)`, "gi");
function inline(target: HTMLElement, text: string, images: Set<string>) {
 let at = 0;
 for (const match of text.matchAll(INLINE)) {
  linkPaths(target, text.slice(at, match.index), images); at = match.index + match[0].length;
  if (match[7] !== undefined || match[8] !== undefined) { linkPaths(target, match[0], images); continue; }
  if (match[2] !== undefined) {
   // Only targets linkPaths would link (http(s), file paths) become links, labelled with the link text; others show the label.
   const probe = document.createElement("span"); linkPaths(probe, match[3], images);
   const link = probe.querySelector("a"); if (link && [...probe.childNodes].every(node => node === link || !node.textContent)) { link.textContent = match[2]; target.append(link); } else target.append(match[2]);
   continue;
  }
  const element = document.createElement(match[1] !== undefined ? "code" : match[4] !== undefined ? "b" : "i");
  if (match[1] !== undefined && WHOLE_QUOTED_PATH.test(match[1])) appendPathLink(element, match[1], images); else linkPaths(element, match[1] ?? match[4] ?? match[5] ?? match[6], images);
  target.append(element);
 }
 linkPaths(target, text.slice(at), images);
}
// Web addresses open in a new tab; trailing Markdown or sentence punctuation is not part of them.
const LINKED = new RegExp(String.raw`(https?://[^\s"'\x60<>]+)|(?<!\w)(file:///[^\s"'\x60<>]+)|(["\x60])(` + QUOTED_PATH + String.raw`)\3|` + LINKED_PATH.source, "gi");
function linkPaths(target: HTMLElement, text: string, images: Set<string>) {
 let at = 0;
 for (const match of text.matchAll(LINKED)) {
  if (match[1]) {
   const url = match[1].replace(/[*_.,;:!?)\]]+$/, "");
   target.append(text.slice(at, match.index)); at = match.index + url.length;
   target.append(Object.assign(document.createElement("a"), { textContent: url, href: url, target: "_blank", rel: "noopener", className: "chat-link" }));
   continue;
  }
  if (match[2]) {
   const url = match[2].replace(/[*_.,;:!?)\]]+$/, ""), raw = url.slice("file://".length);
   let path = raw; try { path = decodeURIComponent(raw); } catch { /* malformed escapes: keep the raw path */ }
   path = path.replace(/^\/(?=[A-Za-z]:)/, "");
   target.append(text.slice(at, match.index)); at = match.index + url.length; appendPathLink(target, path, images);
   continue;
  }
  // A quoted path links without its quotes; the quotes stay as text.
  const path = match[4] ?? match[0], start = match.index + (match[4] ? 1 : 0);
  target.append(text.slice(at, start)); at = start + path.length; appendPathLink(target, path, images);
 }
 target.append(text.slice(at));
}
function appendPathLink(target: HTMLElement, path: string, images: Set<string>) {
 const link = Object.assign(document.createElement("a"), { textContent: path, className: "file-link", href: fileSource(path, false) });
 link.dataset.path = path; if (IMAGE_FILE.test(path)) images.add(path);
 target.append(link);
}
// Model text names many things that look like files (Node.js, e.g.); a link stays plain text until the hub finds the file.
const fileFound = new Map<string, string | null>();
function checkFileLinks(root: HTMLElement) {
 const links = [...root.querySelectorAll<HTMLAnchorElement>("a.file-link:not([data-full])")];
 const apply = () => { for (const link of links) { const full = fileFound.get(link.dataset.path!); if (full === null) link.replaceWith(link.textContent!); else if (full) link.dataset.full = full; } };
 const unknown = [...new Set(links.map(link => link.dataset.path!))].filter(path => !fileFound.has(path)).slice(0, 200);
 if (!unknown.length) return apply();
 post("paths", { paths: unknown }).then(({ found }) => { for (const path of unknown) fileFound.set(path, found[path] ?? null); apply(); }).catch(() => undefined);
}
const fileSource = (path: string, download: boolean) => "api/download?path=" + encodeURIComponent(path) + (download ? "&download=1" : "") + (token ? "&token=" + token : "");
// On this PC (key page): click opens the file, Shift copies its path, Ctrl opens its folder. Remotely a click offers Download / Open.
document.addEventListener("click", event => {
 const link = (event.target as HTMLElement).closest?.<HTMLAnchorElement>("a.file-link[data-full]"); if (!link) return;
 event.preventDefault(); const path = link.dataset.path!, full = link.dataset.full!;
 if (!token) openFileMenu(link, path, full);
 else if (event.shiftKey) void copyPath(full);
 else void openFile(path, event.ctrlKey || event.metaKey);
});
document.addEventListener("contextmenu", event => {
 const link = (event.target as HTMLElement).closest?.<HTMLAnchorElement>("a.file-link[data-full]"); if (!link) return;
 event.preventDefault(); openFileMenu(link, link.dataset.path!, link.dataset.full!);
});
function openFileMenu(link: HTMLElement, path: string, full: string) {
 const uploads: [string, () => void][] = [["Upload", () => void wormhole(path, "")], ["Zip and upload", () => void wormhole(path, "zip")], ...(sevenZip ? [["7z and upload", () => void wormhole(path, "7z")] as [string, () => void]] : [])];
 const explore: [string, () => void][] = /.(zip|7z|rar|tar|tgz|tbz2?|txz|tar.(gz|bz2|xz|zst))$/i.test(path) ? [["Explore", () => void exploreArchive(path)]] : [];
 showMenu(link, token ? [...explore, ["Open", () => void openFile(path, false)], ["Open folder", () => void openFile(path, true)], ["Copy path", () => void copyPath(full)], ...uploads]
  : [...explore, ["Download", () => Object.assign(document.createElement("a"), { href: fileSource(path, true), download: "" }).click()], ["Open", () => void open(fileSource(path, false), "_blank", "noopener")], ["Copy path", () => void copyPath(full)], ...uploads]);
}
// Wormhole upload: the hub packs, encrypts and uploads; the page polls once a second and copies the link (key in its #fragment).
let sevenZip = false; get("upload").then(value => { sevenZip = value.sevenZip; }, () => undefined);
async function wormhole(path: string, pack: string) {
 try {
  const { id } = await post("upload", { path, pack });
  for (;;) {
   const job = await get("upload?id=" + encodeURIComponent(id));
   if (job.error) return showNotice(job.error);
   if (job.url) { try { await navigator.clipboard.writeText(job.url); showNotice("Wormhole link copied (24 h): " + job.url); } catch { prompt("Wormhole link (24 h):", job.url); } return; }
   showNotice(`${job.name}: ${job.status}`);
   await new Promise(done => setTimeout(done, 1000));
  }
 } catch (error) { showNotice(error.message); }
}
// Explore: the hub unpacks the archive into a temp folder; the Files tab walks it and the chat shrinks to make room.
async function exploreArchive(path: string) {
 showNotice("Unpacking " + path.split(/[\/]/).pop() + "…");
 try {
  const value = await post("explore", { path });
  if (!filesView.exploring) {
   beforeExplore = { left: workspace.dataset.left!, tab: $("files").hidden ? diagramTab : "files", width: splitter.getAttribute("aria-valuenow")!, mobile: workspace.dataset.mobile === "chat" ? "chat" : "files" };
   history.pushState({ explore: true }, "");
  }
  filesView.explore(value);
  if (phone.matches) setMobile("files"); else { setTab("files"); setLeft("full"); resizeChat(280); }
  showNotice(`${value.name}: ${value.files.length} files` + (value.truncated ? " (first 5000 shown)" : ""));
 } catch (error) { showNotice(error.message); }
}
// Close (or Back: the browser's, the mouse's) puts the chat back the way it was.
let beforeExplore: { left: string; tab: string; width: string; mobile: string } | null = null;
function closeExplore() {
 if (history.state?.explore) return history.back(); // popstate comes back here
 if (!filesView.exploring) return;
 filesView.close();
 const was = beforeExplore; beforeExplore = null; if (!was) return;
 if (phone.matches) setMobile(was.mobile); else { setTab(was.tab); setLeft(was.left); resizeChat(Number(was.width)); }
}
addEventListener("popstate", () => closeExplore());
async function openFile(path: string, reveal: boolean) {
 try { const { revealed } = await post("open", { path, reveal }); if (revealed && !reveal) showNotice("Programs and scripts open in their folder, never run."); } catch (error) { showNotice(error.message); }
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
 const picker = Object.assign(document.createElement("input"), { type: "file", multiple: true, hidden: true }), button = Object.assign(document.createElement("label"), { className: "attach button", title: "Attach files (or drop or paste them here)", textContent: "File" }), thumbs = Object.assign(document.createElement("div"), { className: "prompt-thumbs" });
 button.append(picker); picker.addEventListener("change", () => { const files = [...picker.files ?? []]; picker.value = ""; void attachAll(files, text); });
 takeFiles(text, text);
 text.addEventListener("input", () => { thumbs.replaceChildren(); appendThumbs(thumbs, new Set([...text.value.matchAll(LINKED_PATH)].map(match => match[0]).filter(path => IMAGE_FILE.test(path)))); });
 text.after(button, thumbs);
}
const imageSource = (path: string) => "api/image?path=" + encodeURIComponent(path) + (token ? "&token=" + token : "");
const mentioned = () => [...new Set([...$("message-input").value.matchAll(/(?<![\w@])@([a-z][a-z0-9_]{0,47})(?![A-Za-z0-9_])/g)].map(match => match[1]))];
function renderMentions() {
 const data = state.diagram, all = [...(data?.nodes ?? []), ...(data?.edges ?? []), ...(data?.notes ?? [])]; $("mentions").replaceChildren();
 for (const id of mentioned()) { const entity = all.find(item => item.id === id), chip = document.createElement("span"); chip.className = "mention-chip"; chip.textContent = "@" + id + (entity ? "" : " (not found)"); chip.title = "No matching element; sent as text."; if (entity && "label" in entity) chip.title = entity.label ?? chip.title; if (entity && "text" in entity) chip.title = entity.text; $("mentions").append(chip); }
}
$("message-input").addEventListener("input", renderMentions);
// Images in the chat box show as thumbnails under it; clicking one annotates it. Saving uploads a new PNG, swaps its path in
// the box and puts the marker notes after it as text. A re-edit starts again from the original with the shapes still editable.
const annotated = new Map<string, { source: string; state: unknown; notes: string }>();
function renderComposerThumbs() {
 const value = $("message-input").value, paths = [...new Set([...value.matchAll(LINKED_PATH)].map(match => match[0]).filter(path => IMAGE_FILE.test(path)))].slice(0, 8);
 $("composer-thumbs").replaceChildren(...paths.map(path => {
  const button = html("button", { type: "button", className: "composer-thumb", title: "Annotate " + path }), img = html("img", { src: imageSource(path), alt: "" });
  img.addEventListener("error", () => button.remove()); button.append(img); button.addEventListener("click", () => void annotateImage(path)); return button;
 }));
}
async function annotateImage(path: string) {
 const previous = annotated.get(path), source = previous?.source ?? path;
 let result; try { result = await annotate(imageSource(source), previous?.state); } catch (error) { return showNotice(error.message); }
 if (!result) return;
 showNotice("Saving the annotated image…");
 try {
  const name = "annotated-" + (source.split(/[\\/]/).pop() ?? "image").replace(/\.[^.]+$/, "") + ".png";
  const response = await fetch("api/paste?name=" + encodeURIComponent(name), { ...auth, method: "POST", headers: { ...auth.headers, "Content-Type": "image/png" }, body: result.blob });
  const saved = await response.json(); if (!response.ok) throw new Error(saved.error ?? "Upload failed.");
  const input = $("message-input"), notes = legend(result.state.shapes), quoted = /\s/.test(saved.path) ? `"${saved.path}"` : saved.path;
  let text = input.value; if (previous?.notes) text = text.replace("\n" + previous.notes, "");
  const at = text.indexOf(path); if (at < 0) return showNotice("The image is no longer in the message.");
  const before = text.slice(0, at).replace(/"$/, ""), after = text.slice(at + path.length).replace(/^"/, "");
  input.value = before + quoted + (notes ? "\n" + notes : "") + (notes && after && !after.startsWith("\n") ? "\n" : "") + after;
  annotated.delete(path); annotated.set(saved.path, { source, state: result.state, notes });
  input.dispatchEvent(new Event("input")); showNotice("Annotated image saved.", true);
 } catch (error) { showNotice(error.message); }
}
$("message-input").addEventListener("input", renderComposerThumbs);
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
// Pasted, dropped and attached files become temp files on the hub PC (images like Pi's terminal paste); the chat gets their paths.
// From a remote device this is how a local file reaches the hub: copy it in Explorer and paste, or drag it in.
const transferFiles = (data: DataTransfer | null) => {
 const files = [...data?.files ?? []]; if (files.length) return files;
 const image = [...data?.items ?? []].find(item => item.type.startsWith("image/"))?.getAsFile(); return image ? [image] : [];
};
async function attachAll(files: File[], input: HTMLTextAreaElement) { for (const file of files) await attach(file, input); }
// On the hub's own PC (the page has the local key) a file copied in Explorer is already here: insert its real path.
async function pasteFiles(files: File[], input: HTMLTextAreaElement) {
 let copied: { path: string; size: number }[] = [];
 if (token) try { copied = (await get("clipfiles")).files; } catch { /* upload instead */ }
 for (const file of files) {
  const local = copied.find(item => item.size === file.size && item.path.split(/[\\/]/).pop() === file.name);
  if (local) insertPath(input, /\s/.test(local.path) ? `"${local.path}"` : local.path); else await attach(file, input);
 }
}
function insertPath(input: HTMLTextAreaElement, path: string) {
 const at = input.selectionStart; input.setRangeText((at && !/\s/.test(input.value[at - 1]) ? " " : "") + path + " ", at, input.selectionEnd, "end"); input.scrollTop = input.scrollHeight; input.focus(); input.dispatchEvent(new Event("input"));
 if (input === $("message-input")) toBottom();
}
// Uploads still saving into the chat box: Send waits for them, so a fast paste-then-Enter sends text and image together.
const chatUploads = new Set<Promise<void>>();
function trackUpload(job: Promise<void>, input: HTMLTextAreaElement) { if (input !== $("message-input")) return; chatUploads.add(job); void job.finally(() => chatUploads.delete(job)); }
function takeFiles(zone: HTMLElement, input: HTMLTextAreaElement) {
 input.addEventListener("paste", event => { const files = transferFiles(event.clipboardData); if (!files.length) return; event.preventDefault(); trackUpload(pasteFiles(files, input), input); });
 zone.addEventListener("dragover", event => { if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } });
 zone.addEventListener("drop", event => { const files = transferFiles(event.dataTransfer); if (!files.length) return; event.preventDefault(); event.stopPropagation(); trackUpload(attachAll(files, input), input); });
}
takeFiles($("chat"), $("message-input"));
$("attach").addEventListener("change", () => { const input = $("attach") as HTMLInputElement, files = [...input.files ?? []]; input.value = ""; trackUpload(attachAll(files, $("message-input")), $("message-input")); });
// Saves the file on the hub PC and inserts its path at the cursor of `input` (chat box or a prompt's answer box).
async function attach(file: File, input: HTMLTextAreaElement) {
 showNotice("Saving " + file.name + "\u2026");
 try {
  const response = await fetch("api/paste?name=" + encodeURIComponent(file.name), { ...auth, method: "POST", headers: { ...auth.headers, "Content-Type": file.type || "application/octet-stream" }, body: file });
  const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "Upload failed.");
  insertPath(input, value.path); showNotice("Saved: " + value.path, true);
 } catch (error) { showNotice(error.message); }
}
// Typing "/name" or "/wo sub" lists matching commands; arrows move, Tab/Enter picks, Escape closes.
type SlashItem = { value: string; description: string };
let slashAt = -1; // where an @session word starts, -1 for a /command
// Typing "@" and part of folder/name (or the intercom id) lists the other hub sessions; picking one writes its intercom reference.
let slashCommands: Promise<{ pi: { name: string; description: string }[]; wo: SlashItem[]; args?: Record<string, SlashItem[]> }> | undefined, slashPick = 0;
async function updateSlash() {
 const input = $("message-input") as HTMLTextAreaElement, menu = $("slash-menu"), value = input.value;
 const match = input.selectionStart === value.length ? /^\/(?:([\w-]+) (\S*(?: \S*)?)|(\S*))$/.exec(value) : null;
 const caret = input.selectionStart, word = match ? null : /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
 if (word && lastSessions) {
  const query = word[1].toLowerCase(); slashAt = caret - word[1].length - 1;
  return showSlash(lastSessions[0].flatMap(group => group.sessions.filter(session => session.id !== sessionId).map(session => [sessionRef(group.folder, session).replace(/ \(.*/, ""), session.pi ? "intercom " + session.pi : "no intercom id yet", sessionRef(group.folder, session)]))
   .filter(row => row[2].toLowerCase().includes(query)).slice(0, 12));
 }
 slashAt = -1;
 if (!match) { menu.hidden = true; return; }
 slashCommands ??= get("commands").catch(error => { slashCommands = undefined; throw error; });
 let list; try { list = await slashCommands; } catch { menu.hidden = true; return; }
 if (input.value !== value) return;
 const rows = match[1] ? (list.args?.[match[1]] ?? []).filter(item => item.value.startsWith(match[2]) && item.value !== match[2]).map(item => [`/${match[1]} ${item.value}`, item.description])
  : list.pi.filter(item => item.name.startsWith(match[3])).map(item => ["/" + item.name, item.description]);
 showSlash(rows);
}
function showSlash(rows: string[][]) {
 const menu = $("slash-menu");
 slashPick = Math.min(slashPick, Math.max(0, rows.length - 1));
 menu.replaceChildren(...rows.map(([command, description, insert = command], index) => {
  const option = document.createElement("div"); option.className = "slash-option"; option.setAttribute("role", "option"); option.dataset.command = insert; option.setAttribute("aria-selected", String(index === slashPick));
  option.append(Object.assign(document.createElement("strong"), { textContent: command }), Object.assign(document.createElement("small"), { textContent: description }));
  option.addEventListener("mousedown", event => { event.preventDefault(); pickSlash(insert); });
  return option;
 }));
 menu.hidden = !rows.length;
}
function pickSlash(command: string) {
 const input = $("message-input") as HTMLTextAreaElement, caret = input.selectionStart, head = slashAt >= 0 ? input.value.slice(0, slashAt) + command + " " : command + " ";
 input.value = head + (slashAt >= 0 ? input.value.slice(caret) : ""); input.focus(); input.setSelectionRange(head.length, head.length);
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
 // Escape: a recalled prompt goes back to the draft, typed text is cleared (Ctrl+Z brings it back), and only an empty box stops the run.
 if (event.key === "Escape") {
  const input = $("message-input") as HTMLTextAreaElement;
  if (historyAt !== -1) { event.preventDefault(); event.stopPropagation(); showHistory(-1, -1); return; }
  if (input.value) { event.preventDefault(); event.stopPropagation(); input.select(); document.execCommand("delete"); return; }
  if (!$("stop").hidden && !$("stop").disabled) { event.preventDefault(); $("stop").click(); }
 }
 // Like Pi's Alt+Up: take queued messages back to edit (plain ↑ only in an empty box, so it never steals caret moves).
 if (event.key === "ArrowUp" && (event.altKey || !$("message-input").value) && state.activity.queue?.length) { event.preventDefault(); void editQueued(state.activity.queue.at(-1).text); return; }
 // Prompt history: ↑ at the very start of the box steps back through this session's prompts, ↓ at the very end steps forward.
 const box = $("message-input"), atStart = box.selectionStart === 0 && box.selectionEnd === 0, atEnd = box.selectionStart === box.value.length;
 if (event.altKey || event.shiftKey || event.ctrlKey) return;
 // Leaving the draft takes a second ↑ at the start, so reaching the top never jumps away by accident.
 const armed = historyArmed; historyArmed = false;
 if (event.key === "ArrowUp" && atStart && historyAt === -1 && prompts().length && !armed) { event.preventDefault(); historyArmed = true; return; }
 if (event.key === "ArrowUp" && atStart && historyAt !== 0 && prompts().length) { event.preventDefault(); showHistory(historyAt === -1 ? prompts().length - 1 : historyAt - 1, 0); }
 if (event.key === "ArrowDown" && atEnd && historyAt !== -1) { event.preventDefault(); showHistory(historyAt + 1 < prompts().length ? historyAt + 1 : -1, -1); }
});
// historyAt: the prompt shown from history (-1 = the user's own draft). The last prompt, when its run was stopped
// (aborted), opens in edit mode (orange): sending first takes it and everything after it out of the context.
let historyAt = -1, historyDraft = "", historyArmed = false;
$("message-input").addEventListener("pointerdown", () => { historyArmed = false; });
$("message-input").addEventListener("focus", renderHistoryNav);
// The ▲/▼ beside the box step through the same history with one click.
$("history-older").addEventListener("click", () => { if (prompts().length && historyAt !== 0) showHistory(historyAt === -1 ? prompts().length - 1 : historyAt - 1, -1); $("message-input").focus(); });
$("history-newer").addEventListener("click", () => { if (historyAt !== -1) showHistory(historyAt + 1 < prompts().length ? historyAt + 1 : -1, -1); $("message-input").focus(); });
function renderHistoryNav() {
 const shown = historyAt === -1 ? undefined : prompts()[historyAt], time = Number(/^user_(\d+)/.exec(shown?.id ?? "")?.[1]);
 ($("history-older") as HTMLButtonElement).disabled = !prompts().length || historyAt === 0;
 ($("history-newer") as HTMLButtonElement).disabled = historyAt === -1;
 $("history-when").textContent = shown ? (time > 1e12 ? whenText(time) : "earlier message") : "";
}
// shortcut: only prompts loaded in the page, and a long prompt's 2 KB excerpt; load earlier rows or the full row if that bites.
const prompts = () => [...chat.values()].filter(row => row.role === "user");
function lastStopped() {
 const rows = [...chat.values()], last = rows.findLastIndex(row => row.role === "user");
 return last >= 0 && rows.slice(last + 1).some(row => row.role === "assistant" && /abort/i.test(row.error ?? ""));
}
function showHistory(at: number, caret: number) {
 const box = $("message-input");
 if (historyAt === -1) historyDraft = box.value;
 historyAt = at; box.value = at === -1 ? historyDraft : prompts()[at].text;
 // The last prompt is editable while its run still goes too: Send stops it first (the server's drop aborts a running agent).
 const running = !$("stop").hidden, editing = at !== -1 && at === prompts().length - 1 && (lastStopped() || running);
 box.classList.toggle("editing-last", editing); box.classList.toggle("from-history", at !== -1 && !editing); renderHistoryNav(); box.title = editing ? `Editing your ${running ? "running" : "stopped"} last message: Send ${running ? "stops the run, " : ""}replaces it and what followed it` : "";
 box.setSelectionRange(caret === -1 ? box.value.length : caret, caret === -1 ? box.value.length : caret);
 box.dispatchEvent(new Event("input"));
}
$("composer").addEventListener("submit", async event => {
 event.preventDefault(); if (messageSending || !state.connected) return;
 if (chatUploads.size) {
  messageSending = true; showNotice("Waiting for the pasted file\u2026");
  try { while (chatUploads.size) await Promise.allSettled([...chatUploads]); } finally { messageSending = false; }
  if (!state.connected) return;
 }
 const text = $("message-input").value; if (!text.trim()) return;
 // Toolbar lines still in the message carry their diagram's context, grouped per diagram (A2).
 const sent = editLines.filter(item => text.split("\n").includes(item.line)), parts = new Map();
 for (const item of sent) parts.set(item.target, [...new Set([...(parts.get(item.target) ?? []), ...item.ids])]);
 messageSending = true; saveDraft(); expectWork(); renderShell(); // the stored draft goes now: leaving the page mid-send must not bring the sent text back
 // Sending jumps to the newest message; later rows keep following from the bottom.
 toBottom();
 const replacing = $("message-input").classList.contains("editing-last") ? prompts().at(-1)?.text : undefined;
 historyAt = -1; $("message-input").classList.remove("editing-last", "from-history"); $("message-input").title = ""; renderHistoryNav();
 try {
  if (replacing !== undefined) await post("drop", { text: replacing }); const result = await post("message", { text, target: diagramTarget() ?? target, ...(parts.size ? { diagrams: [...parts].map(([target, ids]) => ({ target, ids })) } : {}) }); editLines = editLines.filter(item => !sent.includes(item)); if ($("message-input").value === text) $("message-input").value = ""; renderMentions(); showNotice(result.queued ? "Sent; it steers the running agent." : "Message sent.", true); }
 catch (error) { expectWork(false); showNotice(error.message + ". Your message draft is kept."); }
 finally { messageSending = false; saveDraft(); renderShell(); }
});
// Sending shows Working at once instead of when the agent starts seconds later. The server's next activity event
// replaces this guess; if none comes (a command that starts no turn), it drops back after 15 s.
let expectTimer = 0;
function expectWork(on = true) {
 clearTimeout(expectTimer);
 if (!on) { if (expectTimer) { expectTimer = 0; state.activity = { ...state.activity, working: false }; renderActivity(); renderShell(); } return; }
 if (state.activity.working) return;
 state.activity = { ...state.activity, working: true, tools: [] }; renderActivity();
 expectTimer = window.setTimeout(() => expectWork(false), 15000);
}
// Menus: one open at a time; Escape or a click elsewhere closes and returns focus to its button.
const menus = [["git-push", "push-menu"], ["commands-more", "commands-menu"], ["review-button", "review-menu"], ["model-button", "model-menu"], ["context-button", "context-menu"], ["bias-button", "bias-menu"], ["settings-button", "settings-menu"], ["plan-button", "plan-menu"], ["title", "title-menu"]];
function toggleMenu(button: string, menu: string, open = $(menu).hidden) {
 for (const [other, panel] of menus) if (open && other !== button && !$(panel).hidden) toggleMenu(other, panel, false);
 $(menu).hidden = !open; $(button).setAttribute("aria-expanded", String(open));
 // Under its button, kept inside the window.
 if (open && $(menu).parentElement === $(button).parentElement?.closest(".status-line")) { const own = $(button).getBoundingClientRect(), line = $(menu).parentElement.getBoundingClientRect(); $(menu).style.left = Math.max(0, Math.min($(button).offsetWidth ? own.left : innerWidth, innerWidth - $(menu).offsetWidth - 8) - line.left) + "px"; }
 // Settings grew long: it may use the window's full height below its button.
 if (open && menu === "settings-menu") $(menu).style.maxHeight = innerHeight - $(menu).getBoundingClientRect().top - 8 + "px";
 if (open) ($(menu).querySelector<HTMLElement>("input, button:not([hidden]):not(:disabled)"))?.focus();
}
function closeMenus(focus = false) {
 for (const [button, menu] of menus) if (!$(menu).hidden) { toggleMenu(button, menu, false); if (focus) $(button).focus(); }
}
document.addEventListener("keydown", event => { if (event.key === "Escape" && modelBack && !$("model-menu").hidden) { event.stopPropagation(); modelBack(); return; } if (event.key === "Escape" && menus.some(([, menu]) => !$(menu).hidden)) { event.stopPropagation(); closeMenus(true); } }, true);
document.addEventListener("pointerdown", event => { if (!(event.target as Element).closest?.(".status-line, #title, #title-menu, #plan-actions, .commands-more-wrap")) closeMenus(); });
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
$("review-button").addEventListener("click", event => {
 toggleMenu("review-button", "review-menu"); const menu = $("review-menu"); if (menu.hidden) return;
 // At the mouse (the button's corner for keyboard clicks), kept inside the window.
 const own = $("review-button").getBoundingClientRect(), x = event.detail ? event.clientX : own.left, y = event.detail ? event.clientY : own.bottom;
 Object.assign(menu.style, { position: "fixed", right: "auto", bottom: "auto", left: Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + "px", top: Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + "px" });
});
// Plan commands go through /api/command with the shown plan (a typed "/plan3 review <id>" would not name the plan).
for (const button of document.querySelectorAll<HTMLElement>("#plan-menu [data-command], #plan-actions [data-command]")) button.addEventListener("click", async () => {
 const command = button.dataset.command; closeMenus(); setDrawer(false);
 if (command === "new") return newPlan();
 if (command === "delete" && !await confirmBox(`Delete the plan "${state.plan?.title ?? "shown here"}" and its diagram permanently?`)) return;
 if (command === "force finish" && !await confirmBox(`Force finish "${state.plan?.title ?? "this plan"}"? It is archived as complete; its unfinished steps are listed in the plan.`)) return;
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
for (const id of ["git-commit", "git-pull"]) $(id).addEventListener("click", () => void toggleMode($(id).dataset.git!));
// Push asks which tests to run first: scoped by default for fast releases, full on request.
$("git-push").addEventListener("click", () => toggleMenu("git-push", "push-menu"));
for (const choice of document.querySelectorAll<HTMLButtonElement>(".push-choice")) choice.addEventListener("click", () => { closeMenus(); void toggleMode(choice.dataset.git!); });
// The value is asked by /wo env through ask_user and never enters the chat.
for (const id of ["env-var", "drawer-env-var"]) $(id).addEventListener("click", () => void toggleMode("/wo env"));
// Project commands (the project_commands tool): chips right of >>, folded into Commands ▾ when they no longer fit;
// the phone drawer lists them. Prompt commands send their text to the agent, run commands start on the hub PC.
type ProjectCommand = { name: string; kind: "prompt" | "run"; text: string; help?: string };
function commandChip(command: ProjectCommand, withHelp: boolean) {
 const button = html("button", { type: "button", className: "mode-chip project-command", title: (command.help ? command.help + "\n" : "") + (command.kind === "run" ? "Runs on the hub PC: " : "Sends: ") + command.text + "\nRight-click or long-press to delete" });
 button.dataset.kind = command.kind; button.append(command.name);
 if (withHelp && command.help) button.append(html("small", { textContent: command.help }));
 let press = 0, pressed = false;
 button.addEventListener("click", event => { if (pressed) { pressed = false; event.preventDefault(); return; } closeMenus(); void runProjectCommand(command); });
 button.addEventListener("contextmenu", event => { event.preventDefault(); void removeProjectCommand(command.name); });
 button.addEventListener("pointerdown", event => { pressed = false; if (event.pointerType === "touch") press = window.setTimeout(() => { pressed = true; void removeProjectCommand(command.name); }, 500); });
 for (const end of ["pointerup", "pointercancel", "pointermove"]) button.addEventListener(end, () => clearTimeout(press));
 return button;
}
function renderCommands(list: ProjectCommand[], busy: boolean) {
 list = token ? list : list.filter(command => !command.local); // remote pages (no local key) skip this-PC-only buttons
 // renderShell can run before this part of the module loads, so the last list lives on the element.
 const key = JSON.stringify(list);
 if (key !== $("project-commands").dataset.key) {
  $("project-commands").dataset.key = key;
  $("project-commands").replaceChildren(...list.map(command => commandChip(command, false)));
  $("commands-menu").replaceChildren(...list.map(command => commandChip(command, true)));
  $("drawer-project-commands").replaceChildren(...list.map(command => commandChip(command, false)));
  $("drawer-project-commands").hidden = !list.length;
  fitCommands();
 }
 // Prompt commands wait like Commit; run commands only need the hub.
 for (const button of document.querySelectorAll<HTMLButtonElement>(".project-command")) button.disabled = button.dataset.kind === "run" ? !state.connected : busy;
}
function fitCommands() {
 const row = $("project-commands"), more = $("commands-more");
 row.hidden = false; more.hidden = true;
 const over = row.scrollWidth > row.clientWidth + 1;
 row.hidden = over; more.hidden = !over;
 if (!over && !$("commands-menu").hidden) toggleMenu("commands-more", "commands-menu", false);
}
new ResizeObserver(fitCommands).observe(document.querySelector(".chat-heading")!);
$("commands-more").addEventListener("click", () => toggleMenu("commands-more", "commands-menu"));
async function runProjectCommand(command: ProjectCommand) {
 if (messageSending) return; messageSending = true; renderShell();
 try { await post("run", { name: command.name }); if (command.kind === "run") showNotice("Started on the hub PC: " + command.name, true); }
 catch (error) { showNotice(error.message); } finally { messageSending = false; renderShell(); }
}
async function removeProjectCommand(name: string) {
 if (!await confirmBox(`Delete the command "${name}"?`)) return;
 try { await post("commands", { remove: name }); } catch (error) { showNotice(error.message); }
}
$("mode-research").addEventListener("click", () => void toggleMode("/research " + ($("mode-research").getAttribute("aria-pressed") === "true" ? "off" : "on")));
$("mode-night").addEventListener("click", () => void toggleMode("/night " + ($("mode-night").getAttribute("aria-pressed") === "true" ? "off" : "on")));
// H5-05 session bar: every hub session grouped by folder, colour-coded (orange working, red waiting, green unseen idle,
// blue waiting for a timer, grey seen idle, dim parked), plus Recents (D18) closed by default. One hub, so links are plain /s/<id>/ pages.
type Tone = "working" | "waiting" | "scheduled" | "unseen" | "seen" | "parked" | "terminal";
type HubTimer = { id: string; kind: string; dueAt: number; every?: number; lastRun?: number; label: string };
type HubSession = { id: string; name: string; tone: Tone; attention?: number; parked?: boolean; plan?: { done: number; total: number }; job?: number; park?: string; timers?: HubTimer[]; worked?: number; pi?: string; quiet?: boolean };
type GitFiles = { changed: number; added?: number; modified?: number; deleted?: number; untracked?: number; ahead: number; behind?: number; files?: { kind: string; path: string }[] };
type Group = { folder: string; label: string; archived?: boolean; git?: GitFiles | null; sessions: HubSession[] };
// The folder's uncommitted files under its name: added +n, modified ~n, deleted ×n, not yet in git +n (lighter green).
// The open session's folder also gets the header's Pull / Commit / Commit and push as icons on the right; they click the header buttons.
function gitLine(git?: GitFiles | null, own = false) {
 const parts = ([["added", "+", "added"], ["untracked", "+", "not in git yet"], ["modified", "+", "modified"], ["deleted", "×", "deleted"]] as const)
  .filter(([kind]) => git?.[kind]).map(([kind, sign, words]) => html("span", { className: "git-" + kind, textContent: sign + git![kind], title: `${git![kind]} ${words}` }));
 const actions = !own || !git ? [] : ([["git-pull", !!git.behind, "Pull latest"], ["git-commit", !!git.changed, "Commit"], ["git-push", !!(git.changed || git.ahead), "Commit and push"]] as const).filter(([, shown]) => shown).map(([id, , label]) => {
  const button = html("button", { type: "button", className: "session-git-action", title: label }); button.dataset.git = id;
  button.setAttribute("aria-label", label); button.append($(id).querySelector(".git-icon")!.cloneNode(true));
  // shortcut: the push test menu opens at the header button, so on phones it sits behind the drawer; fine while the drawer is a peek.
  button.addEventListener("click", event => { event.stopPropagation(); $(id).click(); });
  return button;
 });
 if (!parts.length && !actions.length) return [];
 const line = html("div", { className: "session-git" }); line.append(...parts);
 // Hovering the counts lists the files, grouped like the counts.
 if (git?.files?.length) {
  const list = html("div", { className: "session-git-files" });
  for (const [kind, words] of [["added", "Added"], ["untracked", "Not in git yet"], ["modified", "Modified"], ["deleted", "Deleted"]]) {
   const paths = git.files.filter(file => file.kind === kind).map(file => file.path); if (!paths.length) continue;
   list.append(html("strong", { className: "git-" + kind, textContent: words }), ...paths.map(path => html("div", { textContent: path })));
  }
  if (git.changed > git.files.length) list.append(html("em", { textContent: `…and ${git.changed - git.files.length} more` }));
  // Fixed, beside the sidebar and centred in the window, as tall as its files allow below the chat heading (the >> line);
  // the scrolling session list would clip an absolute popup.
  line.addEventListener("mouseenter", () => {
   const side = (line.closest("#switcher, #drawer") ?? line).getBoundingClientRect(), top = $("chat").querySelector(".chat-heading")?.getBoundingClientRect().bottom ?? 0;
   list.style.maxHeight = innerHeight - top - 16 + "px";
   list.style.left = Math.max(8, Math.min(side.right + 8, innerWidth - list.offsetWidth - 8)) + "px";
   list.style.top = Math.max(top + 8, (innerHeight - list.offsetHeight) / 2) + "px";
  });
  line.append(list); for (const part of parts) part.removeAttribute("title");
 }
 if (actions.length) { const right = html("span", { className: "session-git-actions" }); right.append(...actions); line.append(right); }
 return [line];
}
type Recent = { file: string; folder: string; label: string; name: string | null; modified: number };
const sessionId = location.pathname.split("/")[2] ?? "";
// The unsent message survives switching sessions and reloads, per session; pagehide also catches programmatic edits (send clears it).
const draftKey = "plan3-draft:" + sessionId, saveDraft = () => { try { const value = messageSending ? "" : $("message-input").value; if (value) localStorage.setItem(draftKey, value); else localStorage.removeItem(draftKey); } catch { /* private mode */ } };
try { if (!$("message-input").value) $("message-input").value = localStorage.getItem(draftKey) ?? ""; } catch { /* private mode */ }
$("message-input").addEventListener("input", saveDraft);
// S-12: typing into a parked session starts it once, so Pi is (nearly) ready when the message is sent.
let waking = false;
$("message-input").addEventListener("input", () => {
 if (!state.status?.parked || waking || !$("message-input").value.trim()) return;
 waking = true; void sessionAction({ action: "resume", id: sessionId }).then(done => { if (!done) waking = false; }); // stays set until a live status arrives
}); addEventListener("pagehide", saveDraft);
// Typing in a live session's chat counts as activity (at most one ping per 30 s), so auto-park waits until you stop.
let typingPing = 0;
$("message-input").addEventListener("input", () => { if (state.status?.parked || Date.now() - typingPing < 30_000) return; typingPing = Date.now(); void post("typing", {}).catch(() => {}); });
const sessionUrl = (id: string) => `/s/${id}/` + (token ? "?token=" + encodeURIComponent(token) : "");
let sessionsTimer = 0, sessionOrder: string[] = [], ownFolder = "";
// Tab icon over every shared session: red when any asks something, yellow while any works.
// The hub's icon (gear → Tab icon, default the first) fills the tab icon, dark on white; a corner dot shows the state (none when idle).
type Updates = { pi: { current: string; latest: string } | null; packages: string[]; installed?: { source: string; name: string; version: string; update: boolean }[]; checkedAt: number | null; checking: boolean; error?: string };
type HubSettings = { version?: string; seenVersion?: string; updates?: Updates; idleParkMinutes?: number; icon?: string; usageHidden?: string[]; usageProviders?: { id: string; label: string }[]; notify?: { question: boolean; done: boolean }; hostname?: string; uac?: boolean; collapseHours?: number; attentionKey?: string; waiting?: { action: string; why: string[]; busy: string[] } | null };
let hubSettings: HubSettings = {}, appBadge = 0, attentionList: HubSession[] = [];
const iconName = () => ICONS[hubSettings.icon ?? ""] ? hubSettings.icon! : Object.keys(ICONS)[0];
function renderIcon() {
 const states = [...sessionStates];
 if (promptView.busy || state.activity.dialog) states.push("waiting");
 // A question replaces this session's working tone: one session asking is red only, not red and orange.
 else if (state.activity.working || state.activity.subagents?.length || ownTone === "working") states.push("working");
 // An installed app's taskbar/dock icon is fixed at install; its badge is the only live part (Chromium, Safari): a mark while
 // count of what needs you (questions, finished sessions you haven't opened); colours are impossible there. Working has no badge.
 if (inApp()) {
  const tones = [...states, ownTone].filter(tone => ["waiting", "working", "unseen", "scheduled"].includes(tone)); // the app has no page in front: own unseen counts
  // attention: how many things need you, for the app's badge on a pinned button.
  // session/nav: the session on screen and a back/forward button press, for the app's visit trail (hub/app/ui).
  const line = "pi-hub-state " + JSON.stringify({ icon: iconName(), name: hubSettings.hostname ?? "", version: hubSettings.version ?? "", states: [...new Set(tones)], attention: tones.filter(tone => tone === "waiting" || tone === "unseen").length, session: sessionId, nav: navRequest,
   // latest: the newest session needing you, so the app's attention key picks this hub; key: that hotkey (this PC's hub sets it).
   latest: attentionList[0]?.attention ?? 0, key: hubSettings.attentionKey ?? "",
   // side: where the strip starts (frameless app); gear: the settings badge the strip's gear repeats ("!" ce-workflow, else a count).
   // shortcut: CSS px equal the app's logical px only at 100% page zoom; scale by the zoom if the app ever allows it.
   ...document.body.classList.contains("app-frame") && { side: $("switcher").hidden ? 0 : Math.round($("switcher").getBoundingClientRect().right), gear: !$("update-badge").hidden ? "!" : $("update-others").hidden ? "" : $("update-others").textContent } });
  if (document.title !== line) document.title = line;
 }
 const needsYou = states.filter(tone => tone === "waiting" || tone === "unseen").length;
 if (needsYou !== appBadge && "setAppBadge" in navigator) { appBadge = needsYou; void (needsYou ? navigator.setAppBadge(needsYou) : navigator.clearAppBadge()).catch(() => {}); }
 const icon = iconName(), svg = icon ? iconSvg(icon, states) : "";
 if (!icon || svg === iconKey) return; // no icons served (older hub): keep the static one
 iconKey = svg;
 document.querySelector<HTMLLinkElement>("link[rel=icon]")!.href = "data:image/svg+xml," + encodeURIComponent(svg);
 if (icon !== appleFor) { appleFor = icon; appleIcon(iconSvg(icon)); }
}
// iOS "Add to Home Screen" reads only a PNG apple-touch-icon, so draw the picked icon (no dots) into one.
function appleIcon(svg: string) {
 const image = new Image(), canvas = document.createElement("canvas"); canvas.width = canvas.height = 180;
 image.onload = () => { canvas.getContext("2d")!.drawImage(image, 0, 0, 180, 180); document.querySelector<HTMLLinkElement>("link[rel=apple-touch-icon]")!.href = canvas.toDataURL("image/png"); };
 image.src = "data:image/svg+xml," + encodeURIComponent(svg.replace("<style>", '<rect width="32" height="32" fill="#fff"/><style>')); // iOS shows transparency as black
}
// Icons: a parked session with a timer still counts as waiting for it (blue); questions and finished runs keep their own colour.
// Seen = this page is in the active window. The app's webview keeps its focus while another program is in front;
// the app says so in piHubFront (hub/app main.rs).
const seenNow = () => document.visibilityState === "visible" && document.hasFocus() && (window as unknown as { piHubFront?: boolean }).piHubFront !== false;
const iconTone = (session?: HubSession) => !session ? "" : session.tone === "parked" && session.timers?.length ? "scheduled" : session.tone;
async function loadSessions() {
 clearTimeout(sessionsTimer);
 // A background tab keeps polling, slower, so its icon still shows the other sessions.
 const visible = document.visibilityState === "visible";
 try {
  const { groups, recents, settings } = await get("sessions") as { groups: Group[]; recents: Recent[]; settings?: HubSettings };
  const uacBefore = !!hubSettings.uac;
  hubSettings = settings ?? {}; ($("hub-park") as HTMLSelectElement).value = String(hubSettings.idleParkMinutes ?? 10); ($("hub-collapse") as HTMLSelectElement).value = String(hubSettings.collapseHours ?? 48); renderUsageProviders(); renderNotify(); renderUpdates(); checkWhatsNew();
  if (!!hubSettings.uac !== uacBefore) notifyUac(!!hubSettings.uac);
  notifyChanges(groups);
  // A run that finished here turns blue too; it clears only once this page is in front of the user.
  // Looking at it also drops it from the attention key's list.
  const own = groups.flatMap(group => group.sessions).find(session => session.id === sessionId);
  if (seenNow() && own && (own.tone === "unseen" || own.attention)) { void post("seen", {}).catch(() => {}); delete own.attention; }
  // Questions first, then the newest: a question blocks work, a finished run can wait.
  attentionList = groups.flatMap(group => group.sessions).filter(session => session.attention).sort((a, b) => Number(b.tone === "waiting") - Number(a.tone === "waiting") || b.attention! - a.attention!);
  $("attention-field").hidden = !inApp(); ($("attention-key") as HTMLInputElement).value = hubSettings.attentionKey ?? "";
  ownTone = iconTone(groups.flatMap(group => group.sessions).find(session => session.id === sessionId));
  sessionStates = groups.flatMap(group => group.sessions.filter(session => session.id !== sessionId).map(iconTone)); renderIcon();
  renderSessions(groups, recents); try { sessionStorage.setItem("hub-sessions", JSON.stringify([groups, recents])); } catch { /* full: the next page waits for the hub */ }
 } catch (error) { showNotice("Sessions failed to load: " + error.message); }
 void checkPairing();
 sessionsTimer = window.setTimeout(loadSessions, visible || inApp() ? 5000 : 15000); // the app's hidden tabs still feed its icon
}
// Desktop app: the mouse back/forward buttons walk the sessions visited across every hub tab (with Ctrl, this hub only).
// The app's tab strip keeps that trail; the press goes to it in the title line, and piHubGo opens the session it picks.
for (const type of ["mousedown", "mouseup", "auxclick"]) window.addEventListener(type, event => {
 const press = event as MouseEvent; if ((press.button !== 3 && press.button !== 4) || !inApp()) return;
 press.preventDefault(); // the webview's own history step would fight the app's
 if (press.button === 3 && filesView.exploring) { if (type === "mouseup") closeExplore(); return; } // Back leaves Explore first
 if (type === "mouseup") { navRequest = { n: Date.now(), dir: press.button === 3 ? -1 : 1, ctrl: press.ctrlKey }; renderIcon(); }
}, true);
(window as unknown as { piHubGo: (id: string) => void }).piHubGo = jumpTo;
// The app's attention key (hub/app): open the newest session that needs you; this page being in front counts as seen.
(window as unknown as { piHubAttention: () => void }).piHubAttention = () => {
 const next = attentionList.shift();
 if (next?.id === sessionId) { void post("seen", {}).catch(() => {}); renderIcon(); focusChat(); } // already open: now it is in front
 else if (next) jumpTo(next.id);
};
// Click the box and press the keys (a modifier plus a letter or digit); Backspace or Delete turns the key off.
$("attention-key").addEventListener("keydown", event => {
 if (event.key === "Tab" || event.key === "Escape") return;
 event.preventDefault();
 const key = /^(Key|Digit)([A-Z0-9])$/.exec(event.code)?.[2]?.toLowerCase(), mods = ([["ctrl", event.ctrlKey], ["shift", event.shiftKey], ["alt", event.altKey], ["super", event.metaKey]] as const).filter(([, on]) => on).map(([name]) => name);
 const value = event.key === "Backspace" || event.key === "Delete" ? "" : key && mods.length ? [...mods, key].join("+") : null;
 if (value === null) return;
 ($("attention-key") as HTMLInputElement).value = value; void saveHubSettings({ attentionKey: value });
});
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
$("devices-button").addEventListener("click", () => void (closeMenus(), showDevices()).catch(error => showNotice("Devices: " + error.message)));
$("devices-close").addEventListener("click", () => ($("devices") as HTMLDialogElement).close());
const words: Record<Tone, string> = { working: "working", waiting: "waiting for an answer", scheduled: "scheduled", unseen: "idle, new activity", seen: "idle", parked: "parked", terminal: "open in a terminal" };
for (const id of ["env-var", "drawer-env-var"]) $(id).prepend(icon("env"));
function html<K extends keyof HTMLElementTagNameMap>(tag: K, properties: Partial<HTMLElementTagNameMap[K]> = {}) { return Object.assign(document.createElement(tag), properties); }
// EU style: Today 14:05, Yesterday 09:12, else 18/10/2026 14:05.
function whenText(time: number) {
 const date = new Date(time), pad = (n: number) => String(n).padStart(2, "0"), clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
 const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(time).setHours(0, 0, 0, 0)) / 86_400_000);
 return `${days === 0 ? "Today" : days === 1 ? "Yesterday" : `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`} ${clock}`;
}
// Folder fold, per browser: open (all shown) until a time, closed (only working/waiting sessions and this one), else auto:
// sessions that have not worked for the Auto-collapse hours hide. Opening shows them 5 min, then auto applies again.
let folds: Record<string, { open?: number; closed?: boolean }> = {};
try { folds = JSON.parse(localStorage.getItem("hub-folds") ?? "{}"); } catch { /* private mode or bad JSON */ }
let lastSessions: [Group[], Recent[]] | undefined, filterPick = "";
const rerenderSessions = () => { if (lastSessions) renderSessions(...lastSessions); };
function folded(session: HubSession, folder: string, now = Date.now()) {
 if (session.id === sessionId || session.tone === "working" || session.tone === "waiting") return false;
 const fold = folds[folder], hours = hubSettings.collapseHours ?? 48;
 if (fold?.open && fold.open > now) return false;
 if (fold?.closed) return true;
 return !!hours && (session.tone === "seen" || session.tone === "parked") && !!session.worked && now - session.worked > hours * 3_600_000;
}
function toggleFold(folder: string, hidden: number) {
 folds[folder] = hidden ? { open: Date.now() + 5 * 60_000 } : { closed: true };
 try { localStorage.setItem("hub-folds", JSON.stringify(folds)); } catch { /* private mode */ }
 rerenderSessions();
}
// Sidebar filter (Ctrl+Shift+F): matches folder and session names, folds ignored; ↑/↓ move the dashed pick, Enter opens it.
const filterInput = $("session-filter") as HTMLInputElement, pickRows = () => [...$("session-list").querySelectorAll<HTMLElement>(".session[data-id]")].filter(row => row.getClientRects().length); // not inside closed Archives
function markPick(id = filterPick) {
 const rows = pickRows(); filterPick = rows.some(row => row.dataset.id === id) ? id : rows[0]?.dataset.id ?? "";
 for (const row of rows) row.classList.toggle("picked", row.dataset.id === filterPick);
}
filterInput.addEventListener("input", () => { filterPick = ""; rerenderSessions(); });
filterInput.addEventListener("keydown", event => {
 const rows = pickRows(), at = rows.findIndex(row => row.dataset.id === filterPick);
 if (event.key === "ArrowDown" || event.key === "ArrowUp") {
  event.preventDefault(); if (!rows.length) return;
  const next = rows[(at + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length]; markPick(next.dataset.id); next.scrollIntoView({ block: "nearest" });
 }
 // Enter opens the pick and clears the filter, so the sidebar shows every folder again.
 if (event.key === "Enter" && filterPick) { event.preventDefault(); const pick = filterPick; filterInput.value = ""; filterPick = ""; rerenderSessions(); if (pick !== sessionId) jumpTo(pick); else focusChat(); }
 // Escape clears the filter; on an empty one it goes back to the chat box.
 if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!filterInput.value) return focusChat(); filterInput.value = ""; filterPick = ""; rerenderSessions(); }
});
// Mouse drag of a folder (by its name row) or of a session row inside its folder: a line shows where it lands;
// drop(onto, after) saves the order on the hub.
let dragging = false, draggedAt = 0, archivesOpen = false;
function dragItem(handle: HTMLElement, box: HTMLElement, selector: string, drop: (onto: HTMLElement, after: boolean) => void) {
 handle.addEventListener("pointerdown", down => {
  if (down.button !== 0 || down.pointerType !== "mouse" || (down.target as Element).closest("button")) return;
  down.stopPropagation(); // a session row sits inside its folder box
  let target: { box: HTMLElement; after: boolean } | undefined;
  const clear = () => $("session-list").querySelectorAll(".drop-before, .drop-after").forEach(item => item.classList.remove("drop-before", "drop-after"));
  const move = (event: PointerEvent) => {
   if (!dragging && Math.abs(event.clientY - down.clientY) < 6) return;
   dragging = true; box.classList.add("dragged"); clear();
   const over = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(selector);
   target = over && over !== box && over.parentElement === box.parentElement ? { box: over, after: event.clientY > over.getBoundingClientRect().top + over.offsetHeight / 2 } : undefined;
   target?.box.classList.add(target.after ? "drop-after" : "drop-before");
  };
  const up = () => {
   removeEventListener("pointermove", move); removeEventListener("pointerup", up);
   if (!dragging) return;
   dragging = false; draggedAt = Date.now(); // the click that ends a drag must not fold or open the folder
   if (target && lastSessions) drop(target.box, target.after);
   rerenderSessions();
  };
  addEventListener("pointermove", move); addEventListener("pointerup", up);
 });
}
function renderSessions(groups: Group[], recents: Recent[]) {
 lastSessions = [groups, recents];
 if (dragging) return; // a rebuilt list would drop the folder being dragged
 $("switcher").hidden = false; document.body.classList.add("has-switcher");
 const query = filterInput.value.trim().toLowerCase(), now = Date.now();
 sessionOrder = groups.flatMap(group => group.sessions.map(session => session.id));
 ownFolder = groups.find(group => group.sessions.some(session => session.id === sessionId))?.folder ?? "";
 try { if (ownFolder) localStorage.setItem("hub-last:" + ownFolder, sessionId); } catch { /* private mode */ }
 const open = $("session-list").querySelector<HTMLDetailsElement>(".session-recents")?.open ?? false;
 const folderBox = (group: Group) => {
  const shown = group.sessions.filter(session => query ? `${group.label} ${session.name}`.toLowerCase().includes(query) : !folded(session, group.folder, now));
  if (query && !shown.length) return [];
  const hidden = query ? 0 : group.sessions.length - shown.length;
  const head = html("div", { className: "session-group" });
  // Treeview box: + while any session is hidden (shows all for 5 min), − hides the ones not working; the name does the same.
  const fold = html("button", { type: "button", className: "session-fold", textContent: hidden ? "+" : "−", title: hidden ? `Show ${hidden} hidden session${hidden === 1 ? "" : "s"}` : "Hide the sessions that are not working" });
  fold.setAttribute("aria-label", `${fold.title} in ${group.label}`); fold.addEventListener("click", () => toggleFold(group.folder, hidden));
  const add = html("button", { type: "button", className: "session-add", textContent: "+", title: `New session in ${group.label} (Alt+N)` });
  add.setAttribute("aria-label", `New session in ${group.label}`); add.addEventListener("click", () => void newSession(group.folder));
  const label = html("span", { className: "session-group-label", textContent: `${group.label} (${group.sessions.length})`, title: `${group.folder}\nRight-click: open folder, archive` });
  label.addEventListener("click", event => { event.stopPropagation(); if (Date.now() - draggedAt > 300) toggleFold(group.folder, hidden); });
  head.addEventListener("contextmenu", event => {
   event.preventDefault(); event.stopPropagation();
   showMenu(label, [["Open folder", () => void sessionAction({ action: "open-folder", folder: group.folder })], group.archived ? ["Unarchive", () => void sessionAction({ action: "unarchive", folder: group.folder })] : ["Archive", () => void sessionAction({ action: "archive", folder: group.folder })]]);
  });
  head.append(fold, label, add);
  // One framed box per folder: red while one waits for an answer, orange while one works, light blue for the open session's folder.
  const box = html("div", { className: "session-folder" }), tones = group.sessions.map(session => session.tone);
  box.dataset.folder = group.folder;
  dragItem(head, box, ".session-folder", (onto, after) => {
   const order = groups.map(item => item.folder).filter(item => item !== group.folder);
   order.splice(order.indexOf(onto.dataset.folder!) + (after ? 1 : 0), 0, group.folder);
   groups.sort((a, b) => order.indexOf(a.folder) - order.indexOf(b.folder));
   void sessionAction({ action: "order", folders: order });
  });
  const tone = tones.includes("waiting") ? "waiting" : tones.includes("working") ? "working" : group.sessions.some(session => session.id === sessionId) ? "current" : "";
  if (tone) box.dataset.tone = tone;
  // A click in the folder box but off any session row opens its last visited session, else the first working, non-parked, or any.
  box.addEventListener("click", event => {
   if ((event.target as HTMLElement).closest(".session, button, a") || !group.sessions.length || Date.now() - draggedAt < 300) return;
   let last = ""; try { last = localStorage.getItem("hub-last:" + group.folder) ?? ""; } catch { /* private mode */ }
   const pick = group.sessions.find(session => session.id === last) ?? group.sessions.find(session => session.tone === "working") ?? group.sessions.find(session => !(session.parked ?? session.tone === "parked")) ?? group.sessions[0];
   if (pick.id !== sessionId) jumpTo(pick.id);
  });
  // The git line only in the open session's folder, and not when it is fully folded.
  box.append(head, ...shown.length && group.folder === ownFolder ? gitLine(group.git, true) : [], ...shown.map(session => {
   const row = sessionRow(session, group.label, group.folder);
   // Sessions reorder inside their folder; the whole folder's list is saved, hidden ones too.
   dragItem(row, row, ".session[data-id]", (onto, after) => {
    const order = group.sessions.filter(item => item.id !== session.id);
    order.splice(order.findIndex(item => item.id === onto.dataset.id) + (after ? 1 : 0), 0, session);
    group.sessions = order;
    void sessionAction({ action: "order", sessions: order.map(item => item.id) });
   });
   return row;
  }));
  return [box];
 };
 const rows = groups.filter(group => !group.archived).flatMap(folderBox), archivedRows = groups.filter(group => group.archived).flatMap(folderBox);
 // Archived folders: below the others in a closed-by-default section (open while a filter matches one).
 const archives = html("details", { className: "session-archives", open: archivesOpen || (!!query && archivedRows.length > 0) });
 archives.addEventListener("toggle", () => { if (!query) archivesOpen = archives.open; });
 archives.append(html("summary", { textContent: `Archives (${groups.filter(group => group.archived).length})` }), ...archivedRows);
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
 newFolder.addEventListener("click", () => { const dialog = $("new-folder") as HTMLDialogElement; ($("new-folder-path") as HTMLInputElement).value = ""; dialog.showModal(); });
 $("session-list").replaceChildren(...rows, ...archivedRows.length ? [archives] : [], ...query ? [] : [recent, newFolder]);
 markPick();
}
function sessionRow(session: HubSession, folder: string, path: string) {
 const row = html("div", { className: "session" }); row.dataset.tone = session.tone; row.dataset.id = session.id; row.toggleAttribute("data-parked", session.parked ?? session.tone === "parked");
 const link = html("a", { className: "session-link", href: sessionUrl(session.id), title: `${folder} - ${session.name} · ${words[session.tone]}${session.park ? " · " + session.park : ""}` });
link.addEventListener("click", () => sessionStorage.setItem("focus-chat", "1")); // the next page starts with the chat box focused
 link.draggable = false; // the row drags instead of the browser's link drag
 link.setAttribute("aria-label", `${session.name} in ${folder}, ${words[session.tone]}${session.id === sessionId ? ", this session" : ""}`);
 if (session.id === sessionId) row.setAttribute("aria-current", "page");
 link.append(html("span", { className: "session-letter", textContent: (session.name.trim()[0] ?? "?").toUpperCase() }), html("span", { className: "session-label", textContent: session.name }), html("small", { className: "session-state", textContent: words[session.tone] + (session.park ? " · " + session.park : "") }));
 const more = html("button", { type: "button", className: "session-more", textContent: "⋯", title: "Session actions" });
 more.setAttribute("aria-haspopup", "true"); more.setAttribute("aria-label", `Actions for ${session.name}`);
 more.addEventListener("click", event => { event.stopPropagation(); openSessionMenu(more, session, path); });
 // Right-click, or a long press on touch (iOS never fires contextmenu), opens the same menu at the row.
 row.addEventListener("contextmenu", event => { event.preventDefault(); openSessionMenu(row, session, path); });
 let press = 0, pressed = false;
 row.addEventListener("pointerdown", event => { pressed = false; if (event.pointerType === "touch") press = window.setTimeout(() => { pressed = true; openSessionMenu(row, session, path); }, 500); });
 for (const end of ["pointerup", "pointercancel", "pointermove"]) row.addEventListener(end, () => clearTimeout(press));
 row.addEventListener("click", event => { if (pressed || Date.now() - draggedAt < 300) { event.preventDefault(); pressed = false; } }, true); // nor the click that ends a drag // the long press must not also open the session
 // D4/D11: the next timer counts down in the row (the 1 s ticker above updates it).
 const next = session.timers?.[0];
 if (next) {
  const timer = html("span", { className: "session-timer", textContent: "⏰ " + elapsed(next.dueAt - Date.now()), title: session.timers!.map(t => `${t.kind}: ${t.label}${t.lastRun ? " · last run " + whenText(t.lastRun) : ""}`).join("\n") });
  timer.dataset.due = String(next.dueAt); link.append(timer);
 }
 row.append(link, more);
 // A long job (pi-hub progress) above the name, so it never meets the plan line below: only its percent and bar.
 if (session.job !== undefined) {
  const line = html("span", { className: "session-progress session-job", title: `Job: ${session.job}%` });
  line.style.setProperty("--fill", session.job + "%");
  line.append(html("small", { textContent: session.job + "%" }), html("i"));
  line.addEventListener("click", () => link.click());
  row.prepend(line);
 }
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
const menuItem = (text: string, run: () => void, className = "") => { const button = html("button", { type: "button", textContent: text, className }); button.setAttribute("role", "menuitem"); button.addEventListener("click", () => { sessionMenu.hidden = true; run(); }); return button; };
function placeMenu(anchor: HTMLElement) {
 const box = anchor.getBoundingClientRect(); sessionMenu.hidden = false;
 sessionMenu.style.position = "fixed"; sessionMenu.style.top = Math.max(8, Math.min(box.bottom, innerHeight - sessionMenu.offsetHeight - 8)) + "px"; sessionMenu.style.left = Math.max(8, Math.min(box.left, innerWidth - sessionMenu.offsetWidth - 8)) + "px";
 sessionMenu.querySelector("button")?.focus();
}
function showMenu(anchor: HTMLElement, items: [string, () => void][]) { sessionMenu.replaceChildren(...items.map(([text, run]) => menuItem(text, run))); placeMenu(anchor); }
function openSessionMenu(anchor: HTMLElement, session: HubSession, path: string) {
 const parked = session.parked ?? session.tone === "parked", item = menuItem;
 // H7-01: a session open in a terminal window comes back by itself when that window closes.
 if (session.tone === "terminal") showNotice(`"${session.name}" is open in a terminal on the PC; it returns here when that Pi exits.`);
 sessionMenu.replaceChildren(...session.tone === "terminal" ? [item("Copy folder path", () => void copyPath(path))] : [
  item("Rename…", () => { const name = prompt("New name:", session.name); if (name?.trim()) void sessionAction({ action: "rename", id: session.id, name }); }),
  item("Copy folder path", () => void copyPath(path)),
  item("Copy intercom id", () => void copyPath(sessionRef(path, session))),
  ...(session.timers ?? []).map(t => item(`Cancel ⏰ ${t.kind}: ${t.label.slice(0, 40)}`, () => void sessionAction({ action: "cancel-timer", id: session.id, timer: t.id }))),
  item("Open in terminal", () => void sessionAction({ action: "terminal", id: session.id })),
  parked ? item("Resume", () => void sessionAction({ action: "resume", id: session.id })) : item("Park", () => void sessionAction({ action: "park", id: session.id })),
  ...(parked ? [] : [item("Reload", () => void sessionAction({ action: "reload", id: session.id }))]),
  // Delete = unstar: the record leaves its group, the session file stays in Recents (D18); a live one is parked first.
  item("Delete session", async () => {
   if (!await confirmBox(`Delete "${session.name}" from its group? The session file stays in Recents.`)) return;
   if (!parked) { try { await post("session", { action: "park", id: session.id }); } catch (error) { return showNotice(error.message); } }
   void sessionAction({ action: "unstar", id: session.id });
  }, "danger"),
 ]);
 placeMenu(anchor);
}
document.addEventListener("pointerdown", event => { if (!sessionMenu.contains(event.target as Node)) sessionMenu.hidden = true; });
// The clipboard needs a secure page (localhost or the tailnet https link); otherwise show the path to copy by hand.
// How another session reaches this one: folder/name for people, the intercom short id for the agent.
const sessionRef = (folder: string, session: HubSession) => (folder.split(/[\\/]/).filter(Boolean).pop() ?? folder) + "/" + session.name + (session.pi ? " (intercom " + session.pi + ")" : "");
async function copyPath(path: string) {
 try { await navigator.clipboard.writeText(path); showNotice(`Copied ${path}`); } catch { prompt("Path:", path); }
}
sessionMenu.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); sessionMenu.hidden = true; } });
async function sessionAction(data: Record<string, unknown>) {
 try { const value = await post("session", data); await loadSessions(); return value; }
 catch (error) { showNotice(error.message); }
}
// Local: one folder for machine requests (install, check something) that belong to no project; made on first use.
$("new-folder-form").addEventListener("submit", event => { event.preventDefault(); const folder = ($("new-folder-path") as HTMLInputElement).value.trim(); if (!folder) return; ($("new-folder") as HTMLDialogElement).close(); void newSession(folder); });
$("new-folder-local").addEventListener("click", () => { ($("new-folder") as HTMLDialogElement).close(); void newSession("~/pi-local", true); });
$("new-folder-cancel").addEventListener("click", () => ($("new-folder") as HTMLDialogElement).close());
async function newSession(folder: string, create = false) {
 let created: { id?: string } | undefined;
 try { created = await post("session", { action: "new", folder, ...create ? { create } : {} }) as typeof created; }
 catch (error) {
  if (error.message !== "Folder does not exist." || !await confirmBox(`${folder} does not exist. Create it and start a session there?`)) { if (error.message !== "Folder does not exist.") showNotice(error.message); return; }
  created = await sessionAction({ action: "new", folder, create: true }) as typeof created;
 }
 if (created?.id) jumpTo(created.id);
}
// D5 keyboard shortcuts: Alt+↑/↓ previous or next session, Alt+N new session in this folder (Esc in the chat box stops a run).
window.addEventListener("keydown", event => {
 if (!event.altKey || event.ctrlKey || event.metaKey) return;
 if (event.key === "ArrowUp" || event.key === "ArrowDown") {
  const at = sessionOrder.indexOf(sessionId), next = sessionOrder[at + (event.key === "ArrowDown" ? 1 : -1)];
  if (at >= 0 && next) { event.preventDefault(); jumpTo(next); }
 }
 if (event.key.toLowerCase() === "n" && ownFolder) { event.preventDefault(); void newSession(ownFolder); }
 // Alt+= / Alt+- like the terminal: one bias step toward Think or Work (codes, so Shift and keyboard layouts don't matter).
 const step = { Equal: 1, NumpadAdd: 1, Minus: -1, NumpadSubtract: -1 }[event.code];
 if (step && state.connected) {
  event.preventDefault();
  const limit = state.plan ? 2 : 1, level = Math.max(-limit, Math.min(limit, biasNow() + step));
  if (level !== biasNow()) post("bias", { level }).then(() => showNotice(""), error => showNotice(error.message));
 }
});
// Desktop session bar: open by default; collapsing to the letter stripe is remembered.
function toggleSwitcher(open: boolean) { localStorage.setItem("plan3-switcher", open ? "open" : "closed"); document.body.classList.toggle("switcher-open", open); $("switcher").dataset.open = String(open); $("switcher-toggle").setAttribute("aria-expanded", String(open)); $("switcher-toggle").setAttribute("aria-label", open ? "Hide shared sessions" : "Show shared sessions"); }
$("switcher-toggle").addEventListener("click", () => toggleSwitcher($("switcher").dataset.open !== "true"));
new ResizeObserver(() => renderIcon()).observe($("switcher")); // the app's strip follows the sidebar's edge
// Not from the filter box: Escape there only clears it, and an extra press must not fold the list away.
$("switcher").addEventListener("keydown", event => { if (event.key === "Escape" && $("switcher").dataset.open === "true" && event.target !== $("session-filter")) { event.stopPropagation(); toggleSwitcher(false); $("switcher-toggle").focus(); } });
toggleSwitcher(localStorage.getItem("plan3-switcher") !== "closed");
document.addEventListener("visibilitychange", () => void loadSessions());
window.addEventListener("focus", () => void loadSessions()); // clears this session's blue once you look at it
// Switching sessions loads a new page: draw the last list at once so the sidebar does not vanish until the hub answers.
try { const last = JSON.parse(sessionStorage.getItem("hub-sessions") ?? "null"); if (last) renderSessions(last[0], last[1]); } catch (error) { reportError(error); } // still loads the list below
void loadSessions();
// Subscription usage: one bar per provider (7d left, coloured like the footer, warnings in their colour);
// tapping one opens its window: every quota window as a bar, the pool's notes and, for Claude, the account pool.
type Segment = { text: string; color?: string };
type UsageBar = { label: string; left: number; color: string; resets?: string; at?: string };
type Usage = { id: string; label: string; window?: string; left: number; color: string; resets?: string; bars?: UsageBar[]; warnings?: Segment[]; notes?: string[]; soon?: { left: number; in: string }[] };
// The next refills (within 48 h) as dotted marks at the level they bring; the usage window labels them in grey.
function soonMarks(bar: HTMLElement, item: Usage, labelled: boolean) {
 // Labels stack one line apart, so close refills (75% and 65%) never print over each other; the bar grows to fit.
 const soon = item.soon ?? [];
 if (labelled && soon.length > 1) bar.style.paddingBottom = 20 + (soon.length - 1) * 13 + "px";
 for (const [line, refill] of soon.entries()) {
  const at = shownLeft(refill.left), mark = el("i", "usage-soon" + (at > 70 ? " flip" : ""));
  mark.style.left = at + "%";
  if (labelled) { const label = el("span", "", `${refill.in} \u00b7 ${at}%`); label.style.bottom = 1 + line * 13 + "px"; mark.append(label); }
  bar.append(mark);
 }
}
let usage: Usage[] = [], usageAccounts: Segment[] = [], usageTimer = 0, usageShown = "";
const el = (tag: string, className: string, text = "") => Object.assign(document.createElement(tag), { className, textContent: text });
// Usage as % left (default) or % used, per device (gear → Usage shows); fills follow the shown number.
const usageUsed = () => { try { return localStorage.getItem("hub-usage") === "used"; } catch { return false; } };
const shownLeft = (left: number) => usageUsed() ? 100 - left : left, usageWord = () => usageUsed() ? "used" : "left";
const tone = (color?: string) => color === "error" || color === "warning" || color === "success" ? color : "accent";
async function loadUsage() {
 clearTimeout(usageTimer); if (document.visibilityState !== "visible") return;
 try {
  const value = await get("usage") as { summary: Usage[]; accounts?: Segment[] };
  usage = value.summary; usageAccounts = value.accounts ?? [];
  renderUsageBar();
  if (usageShown && ($("usage-window") as HTMLDialogElement).open) void openUsage(usageShown, false);
 } catch { $("usage-button").hidden = true; }
 usageTimer = window.setTimeout(loadUsage, 120_000);
}
// Top-bar windows of a provider: its 5h (when it has one) and the headline (7d, else its longest); each hides on its own.
const topWindows = (item: Usage) => [...new Set(["5h", item.window ?? "7d"])].filter(label => item.bars?.some(bar => bar.label === label));
const usageKey = (item: Usage, label: string) => item.id + ":" + label;
function renderUsageBar() {
 const hidden = new Set(hubSettings.usageHidden ?? []);
 $("usage-button").replaceChildren(...usage.flatMap(item => topWindows(item).filter(label => !hidden.has(usageKey(item, label))).map(label => {
  const bar = item.bars!.find(entry => entry.label === label)!, head = label === item.window, warnings = head ? item.warnings ?? [] : [];
  // The headline keeps the summary's reset (none for a rotating Claude pool) and the warnings.
  const left = head ? item.left : bar.left, resets = head ? item.resets : bar.resets;
  const button = el("button", "bar usage-bar"); button.type = "button"; button.dataset.provider = item.id; button.dataset.window = label;
  button.append(el("span", "usage-item", `${item.label} ${label}: ${shownLeft(left)}%${resets ? " " + resets : ""}`), ...warnings.map(w => el("span", "usage-warning tone-" + w.color, " \u00b7 " + w.text)));
  // A warning outranks the quota colour: the expiring week is the thing to act on.
  setBar(button, shownLeft(left), tone(warnings.find(w => w.color === "error")?.color ?? warnings[0]?.color ?? bar.color));
  if (head) soonMarks(button, item, false);
  button.title = [item.label, ...(item.bars ?? []).map(entry => `${entry.label} ${shownLeft(entry.left)}% ${usageWord()}${entry.resets ? " (" + entry.resets + ")" : ""}`), ...(item.warnings ?? []).map(w => w.text), ...(item.soon ?? []).map(s => `${shownLeft(s.left)}% ${usageWord()} in ${s.in}`), "Right-click hides this bar"].join(" \u00b7 ");
  button.addEventListener("click", () => void openUsage(item.id));
  button.addEventListener("contextmenu", event => { event.preventDefault(); void showUsageWindow(item, label, false); });
  return button;
 })));
 $("usage-button").hidden = !$("usage-button").childElementCount;
}
// Hiding every top-bar window of a provider turns the provider off as a whole: unticked in the gear menu and no longer polled.
async function showUsageWindow(item: Usage, label: string, show: boolean) {
 const hidden = new Set(hubSettings.usageHidden ?? []);
 if (show) hidden.delete(usageKey(item, label)); else hidden.add(usageKey(item, label));
 if (topWindows(item).every(window => hidden.has(usageKey(item, window)))) { for (const window of topWindows(item)) hidden.delete(usageKey(item, window)); hidden.add(item.id); }
 await saveHubSettings({ usageHidden: [...hidden] }); renderUsageProviders();
 if (hidden.has(item.id)) showNotice(`${item.label} usage is off; turn it back on under the gear \u2192 Usage.`, true);
 void loadUsage();
}
type Window = { pct: number; tone?: string; resets?: string; clock?: string } | null;
type PoolRow = { label: string; email?: string; plan?: string; priority: number; state: string; login: string; fiveHour: Window; sevenDay: Window; notes: { text: string; tone?: string }[]; active: boolean; favorite: boolean; weekend: boolean; disabled: boolean; dead: boolean };
let poolPick = "";
async function poolAct(act: string, label = "", value?: number) {
 if (act === "remove" && !await confirmBox(`Delete "${label}" from the Claude pool?`)) return;
 try { const result = await post("pool", { act, label, value }) as { message?: string }; if (result.message) showNotice(result.message); }
 catch (error) { showNotice(error.message); }
 void loadUsage();
}
// One quota bar: fill = the shown number (left or used), colour = how close to the limit; the reset clock turns red when the week expires soon.
async function copyPool() {
 if (!await confirmBox("Copy the Claude pool's logins? They grant access to these subscriptions: treat them like a password.\n\nUnless login sync is on, both PCs then share single-use tokens and one of them loses the accounts at the next refresh.")) return;
 try {
  const text = JSON.stringify((await post("pool", { act: "export" }) as { config: unknown }).config, null, 2);
  // The clipboard needs a secure page; otherwise the text is shown to copy by hand.
  try { await navigator.clipboard.writeText(text); showNotice("Logins copied: paste them in the other hub's Claude window."); } catch { prompt("Copy these logins:", text); }
 } catch (error) { showNotice("Copy failed: " + (error as Error).message); }
}
async function pastePool() {
 const text = prompt("Paste the logins copied from another hub:", "");
 if (!text?.trim()) return;
 try { const result = await post("pool", { act: "import", text }) as { message?: string }; showNotice(result.message ?? "Logins added."); }
 catch (error) { showNotice("Paste failed: " + (error as Error).message); }
 void loadUsage();
}
function poolBar(name: string, w: Window) {
 const bar = el("div", "pool-bar");
 if (!w) { bar.append(el("span", "pool-bar-name", name), el("span", "pool-bar-track"), el("span", "pool-bar-text", "—")); return bar; }
 const track = el("span", "pool-bar-track"), fill = el("span", "pool-bar-fill tone-" + (w.tone ?? "success"));
 const value = shownLeft(100 - w.pct); fill.style.width = Math.max(0, Math.min(100, value)) + "%"; track.append(fill);
 const text = el("span", "pool-bar-text"); text.append(`${value}% ${usageWord()}`);
 if (w.resets) text.append(" · ", el("span", w.clock ? "tone-" + w.clock : "", w.resets));
 bar.append(el("span", "pool-bar-name", name), track, text); return bar;
}
const LEVELS: [string, string][] = [["2", "++ Prefer"], ["1", "+ Higher"], ["0", "Neutral"], ["-1", "− Lower"], ["-2", "−− Last resort"]];
function poolActions(row: PoolRow) {
 const bar = el("div", "pool-actions"), button = (text: string, title: string, run: () => void, cls = "") => { const b = el("button", cls, text); b.type = "button"; b.title = title; b.addEventListener("click", run); bar.append(b); return b; };
 bar.append(el("b", "pool-pick", row.label));
 button("Switch to", "Switch to this account now (held until it runs out)", () => void poolAct("switch", row.label)).disabled = row.active || row.disabled || row.dead;
 // Force = the pool's favourite flag (green in the terminal): forced accounts serve first while they have quota; several may be forced.
 button(row.favorite ? "Stop force" : "Force use", row.favorite ? "Back to normal ranking" : "Serve this account first while it has quota (several accounts can be forced)", () => void poolAct("favorite", row.label), row.favorite ? "on" : "");
 const level = document.createElement("select"); level.title = "Priority level";
 for (const [value, text] of LEVELS) level.append(Object.assign(document.createElement("option"), { value, textContent: text }));
 level.value = String(row.priority);
 level.addEventListener("change", () => void poolAct("priority", row.label, Number(level.value)));
 bar.append(level);
 button(row.weekend ? "Weekend: on" : "Weekend: off", "Weekend account: drained over the weekend", () => void poolAct("weekend", row.label), row.weekend ? "on" : "");
 button(row.disabled ? "Enable" : "Disable", row.disabled ? "Put back in rotation" : "Take out of rotation", () => void poolAct("toggle", row.label));
 button("Delete", "Remove from the pool", () => void poolAct("remove", row.label), "danger");
 return bar;
}
function poolRowBox(row: PoolRow, select: () => void) {
 const box = el("div", "pool-row" + (row.active ? " active" : "") + (row.favorite ? " forced" : "") + (row.disabled || row.dead ? " off" : "") + (row.label === poolPick ? " picked" : ""));
 box.tabIndex = 0; box.setAttribute("role", "option"); box.setAttribute("aria-selected", String(row.label === poolPick));
 const head = el("div", "pool-head");
 head.append(el("span", "pool-mark", row.active ? "▶" : ""), el("b", "pool-name", row.label));
 if (row.favorite) head.append(el("span", "pool-chip pool-forced", "forced"));
 const level = LEVELS.find(([value]) => value === String(row.priority))?.[1].split(" ")[0];
 if (level && row.priority) head.append(el("span", "pool-chip", level));
 if (row.plan) head.append(el("span", "pool-chip", row.plan));
 if (row.weekend) head.append(el("span", "pool-chip", "weekend"));
 if (row.state !== "ok") head.append(el("span", "pool-chip tone-" + (row.dead ? "error" : "warning"), row.state));
 if (row.login && row.login !== "ok") head.append(el("span", "pool-chip tone-error", row.login));
 // Notes ("as of 5m ago") ride on the name line instead of a line of their own.
 if (row.notes.length) { const notes = el("span", "pool-notes"); for (const note of row.notes) notes.append(el("span", note.tone ? "tone-" + note.tone : "", note.text)); head.append(notes); }
 if (row.email) head.append(el("small", "pool-email", row.email));
 const bars = el("div", "pool-bars"); bars.append(poolBar("5h", row.fiveHour), poolBar("7d", row.sevenDay));
 box.append(head, bars);
 box.addEventListener("click", select); box.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); } });
 return box;
}
async function openUsage(id: string, open = true) {
 const item = usage.find(entry => entry.id === id), dialog = $("usage-window") as HTMLDialogElement;
 if (!item) { if (!open) dialog.close(); return; } // the shown provider was just turned off
 usageShown = id; $("usage-title").textContent = item.label + " usage";
 const body: HTMLElement[] = (item.bars ?? []).map(bar => {
  const row = el("div", "bar usage-window-bar");
  row.append(el("b", "", bar.label), ` ${shownLeft(bar.left)}% ${usageWord()}${bar.resets ? " · resets in " + bar.resets : ""}${bar.at ? " (" + bar.at + ")" : ""}`);
  setBar(row, shownLeft(bar.left), tone(bar.color));
  if (bar.label === item.window && item.soon?.length) { row.classList.add("has-soon"); soonMarks(row, item, true); }
  return row;
 });
 const hidden = new Set(hubSettings.usageHidden ?? []), top = el("div", "usage-top", "Top bar:");
 for (const label of topWindows(item)) {
  const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: !hidden.has(usageKey(item, label)) });
  box.addEventListener("change", () => void showUsageWindow(item, label, box.checked));
  const field = document.createElement("label"); field.append(box, " " + label); top.append(field);
 }
 body.push(top, ...(item.warnings ?? []).map(w => el("p", "usage-alert tone-" + w.color, "⚠ " + w.text)), ...(item.notes ?? []).map(note => el("p", "dialog-purpose", note)));
 if (id === "claude") {
  let pool: { title: string; drain7d: boolean; rows: PoolRow[] } | null = null;
  try { pool = await get("pool"); } catch { pool = null; }
  // Copy/paste the pool's logins (refresh tokens + login-sync key) to set up the pool on another hub.
  const copyPaste = () => {
   const copy = el("button", "", "Copy logins"), paste = el("button", "", "Paste logins");
   copy.title = "Copy every account's login to paste into another hub"; paste.title = "Add the logins copied from another hub";
   copy.addEventListener("click", () => void copyPool()); paste.addEventListener("click", () => void pastePool());
   return [copy, paste];
  };
  if (pool && !pool.rows.length) { const tools = el("div", "pool-tools"); tools.append(el("h3", "", pool.title || "Claude pool"), ...copyPaste()); body.push(tools); }
  if (pool?.rows.length) {
   const rows = pool.rows;
   if (!rows.some(row => row.label === poolPick)) poolPick = rows.find(row => row.active)?.label ?? rows[0].label;
   const tools = el("div", "pool-tools");
   const refresh = el("button", "", "↻ Refresh"), drain = el("button", pool.drain7d ? "on" : "", pool.drain7d ? "Drain 7d: on" : "Drain 7d: off");
   refresh.title = "Fetch every account's usage now"; drain.title = "Drain 7d: serve the soonest-expiring week first, ignoring 5h";
   refresh.addEventListener("click", () => void poolAct("refresh")); drain.addEventListener("click", () => void poolAct("mode"));
   tools.append(el("h3", "", pool.title), refresh, drain, ...copyPaste());
   const list = el("div", "pool-list"), actions = el("div", "pool-dock");
   list.setAttribute("role", "listbox");
   const draw = () => { list.replaceChildren(...rows.map(row => poolRowBox(row, () => { poolPick = row.label; draw(); }))); actions.replaceChildren(poolActions(rows.find(row => row.label === poolPick)!)); };
   draw(); body.push(tools, list, actions);
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
// Bookmarked messages, 1–9 per session: Ctrl+Shift+N saves the box text (overwriting), Ctrl+N puts it at the caret.
// shortcut: kept in this browser's localStorage, so another device has its own set; move to the hub if they should sync.
const bookmarkKey = "bookmarks:" + location.pathname;
const bookmarks = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(bookmarkKey) ?? "{}"); } catch { return {}; } };
function saveBookmark(n: number, text: string) { const all = bookmarks(); all[n] = text; localStorage.setItem(bookmarkKey, JSON.stringify(all)); showNotice(`Bookmark ${n} saved; Ctrl+${n} puts it in the box.`); if (($("bookmarks") as HTMLDialogElement).open) renderBookmarks(); }
function useBookmark(n: number) {
 const text = bookmarks()[n]; if (!text) return showNotice(`No bookmark ${n} yet: Ctrl+Shift+${n} saves the box text.`);
 const box = $("message-input"), start = box.selectionStart, end = box.selectionEnd;
 box.focus(); box.setRangeText(text, start, end, "end"); box.dispatchEvent(new Event("input"));
}
function renderBookmarks() {
 const all = bookmarks(), box = $("message-input").value.trim();
 $("bookmark-list").replaceChildren(...Array.from({ length: 9 }, (_, i) => {
  const n = i + 1, row = html("div", { className: "bookmark-row" }), text = all[n];
  const use = html("button", { type: "button", className: "bookmark-use", disabled: !text, title: text ? `Ctrl+${n}` : "Empty" });
  use.append(html("strong", { textContent: String(n) }), html("span", { textContent: text ?? "Empty" }));
  use.addEventListener("click", () => { ($("bookmarks") as HTMLDialogElement).close(); useBookmark(n); });
  const save = html("button", { type: "button", className: "bookmark-save", textContent: text ? "Overwrite" : "Save box", disabled: !box, title: box ? "Save the message box text here (Ctrl+Shift+" + n + ")" : "Type something in the box first" });
  save.addEventListener("click", () => saveBookmark(n, $("message-input").value));
  row.append(use, save); return row;
 }));
}
$("bookmarks-button").addEventListener("click", () => { renderBookmarks(); ($("bookmarks") as HTMLDialogElement).showModal(); });
$("bookmarks-close").addEventListener("click", () => ($("bookmarks") as HTMLDialogElement).close());
document.addEventListener("keydown", event => {
 const n = /^Digit([1-9])$/.exec(event.code)?.[1]; if (!n || !event.ctrlKey || event.altKey || event.metaKey) return;
 event.preventDefault();
 if (!event.shiftKey) return useBookmark(Number(n));
 const text = $("message-input").value; if (text.trim()) saveBookmark(Number(n), text); else showNotice("Type the message in the box first, then Ctrl+Shift+" + n + " bookmarks it.");
});
$("pi-commands").addEventListener("click", () => void pickCommand("pi"));
$("wo-commands").addEventListener("click", () => void pickCommand("wo"));
$("command-close").addEventListener("click", () => ($("command-picker") as HTMLDialogElement).close());
// A click on the backdrop closes the view-only dialogs; questions, approvals and the note editor keep theirs.
for (const id of ["command-picker", "devices", "usage-window", "changelog"]) {
 const dialog = $(id) as HTMLDialogElement, outside = (event: MouseEvent) => { const box = dialog.getBoundingClientRect(); return event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom); };
 let pressed = false; // pressed on the backdrop too, so a text selection dragged out of the dialog does not close it
 dialog.addEventListener("pointerdown", event => { pressed = outside(event); });
 dialog.addEventListener("click", event => { if (pressed && outside(event)) dialog.close(); pressed = false; });
}
async function changeStatus(endpoint: "model" | "effort", body) {
 closeMenus(); if (drawer.dataset.open === "true") setDrawer(false); else $("model-button").focus();
 try { state.status = { ...state.status, ...await post(endpoint, body) }; renderShell(); showNotice(""); } catch (error) { showNotice(error.message); }
}
// The model menu (D19, sketch C): the list sets this chat's model; below it a Roles summary (default, work, think models,
// each with its own effort) whose rows open the same list for that role; Escape or ← goes back to this chat's list.
let modelBack: (() => void) | null = null;
const effortName = (level: string | null) => !level ? "Session's" : level === "medium" ? "Mid" : level === "xhigh" ? "XHigh" : level[0].toUpperCase() + level.slice(1);
function modelMenu(menu: HTMLElement, value, mode: "chat" | "default" | "work" | "think" = "chat", all = false) {
 const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}) => Object.assign(document.createElement(tag), tag === "button" ? { type: "button" } : {}, props);
 const refOf = (model: Model) => model.provider + "/" + model.id, current = value.model;
 const known = [...value.scoped, ...value.others, ...current ? [current] : []];
 const nameOf = (ref: string | null) => !ref ? "—" : known.find(model => refOf(model) === ref)?.name ?? ref.split("/").slice(1).join("/");
 const holds = (ref: string) => mode === "default" ? ref === value.default : mode === "work" ? ref === value.work : mode === "think" ? value.think?.includes(ref) : current && refOf(current) === ref;
 const again = (to = mode) => modelMenu(menu, value, to, all);
 // Pi's default model (new sessions start on it) wears a crown, the /wo work model (Plan3 coding) a hammer, think models
 // (Plan models: advisors and review) a thought bubble; one model may wear all three.
 const crown = (button: HTMLElement, ref: string) => {
  const roles = [ref === value.default && "default", ref === value.work && "work", value.think?.includes(ref) && "think"].filter(Boolean) as string[];
  button.dataset.roles = roles.join(" "); button.dataset.ref = ref; button.title = ref + (roles.length ? " · " + roles.join(", ") + " model" : "") + (mode === "chat" ? " · right-click: set roles" : "");
 };
 const set = (model: { provider: string; id: string }, body: Record<string, unknown>, done: string) => async () => {
  try { Object.assign(value, await post("defaultmodel", { provider: model.provider, id: model.id, ...body })); if (!menu.hidden) again(); showNotice(done, true); } catch (error) { showNotice(error.message); }
 };
 const option = (model: Model) => {
  const ref = refOf(model), button = el("button", { className: "model-option", textContent: model.name }); crown(button, ref);
  button.setAttribute("aria-pressed", String(!!holds(ref)));
  if (mode === "chat") {
   button.addEventListener("click", () => changeStatus("model", { provider: model.provider, id: model.id }));
   button.addEventListener("contextmenu", event => {
    event.preventDefault(); const think = value.think?.includes(ref);
    showMenu(button, [
     [ref === value.default ? "Already the default model" : "Set as default model", set(model, {}, model.name + " is now the default model.")],
     ref === value.work ? ["Unset work model", set(model, { role: "work", on: false }, model.name + " is no longer the work model.")] : ["Set as work model", set(model, { role: "work" }, model.name + " is now the work model (Plan3 coding).")],
     think ? ["Remove from think models", set(model, { role: "think", on: false }, model.name + " is no longer a think model.")] : ["Add to think models", set(model, { role: "think" }, model.name + " is now a think model (Plan models).")],
    ]);
   });
   return button;
  }
  // A role list: clicking picks it (think: toggles it, several allowed); the picked row carries its effort button.
  const role = mode === "default" ? undefined : mode, on = !!holds(ref);
  button.addEventListener("click", set(model, mode === "think" ? { role, on: !on } : { role }, mode === "think" && on ? model.name + " is no longer a think model." : model.name + " is now the " + mode + " model" + (mode === "think" ? " (one of them)." : ".")));
  if (!on) return button;
  const level = mode === "default" ? value.defaultEffort ?? "medium" : mode === "work" ? value.workEffort : value.thinkEffort?.[ref];
  const effort = el("button", { className: "role-effort", textContent: effortName(level) + " ▾", title: "Effort for this role" });
  effort.addEventListener("click", () => showMenu(effort, [...(mode === "work" ? [null] : []), "minimal", "low", "medium", "high", "xhigh"].map(next => [(next === level ? "✓ " : "") + (next ? effortName(next) : "Session's effort"), set(model, { role, effort: next }, model.name + ": " + effortName(next) + " effort as the " + mode + " model.")])));
  const row = el("div", { className: "role-row" }); row.append(button, effort); return row;
 };
 const models = all || !value.scoped.length ? [...value.scoped, ...value.others] : value.scoped;
 const items: Node[] = [];
 if (mode === "chat") {
  modelBack = null;
  // This chat's thinking level on one line (Low / Mid / High, plus the current one if different).
  const efforts = el("div", { className: "effort-row" });
  efforts.append(...["low", "medium", "high", ...(["low", "medium", "high"].includes(value.effort) || !value.effort ? [] : [value.effort])].map(level => {
   const button = el("button", { textContent: effortName(level) }); button.dataset.level = level;
   button.setAttribute("aria-pressed", String(level === value.effort)); button.addEventListener("click", () => changeStatus("effort", { level })); return button;
  }));
  items.push(efforts);
 } else {
  modelBack = () => again("chat");
  const back = el("button", { className: "model-back", textContent: "← " + { default: "👑 Default model", work: "🔨 Work model", think: "💭 Think models" }[mode] });
  back.addEventListener("click", modelBack);
  items.push(back, el("p", { className: "model-note", textContent: { default: "New sessions start on it, at its effort.", work: "/resume3 switches to it to code a plan.", think: "Advisors and reviews (Plan models); pick several." }[mode] }));
  if (mode === "work" && value.work) {
   const [provider, ...id] = value.work.split("/"), none = el("button", { className: "model-option", textContent: "Don't switch (keep the session's model)" });
   none.addEventListener("click", set({ provider, id: id.join("/") }, { role: "work", on: false }, "No work model: /resume3 keeps the session's model."));
   items.push(none);
  }
 }
 // A parked session lists only scoped models (D10) and says why when there are none; Pi's Ctrl+P set unless "all".
 if (value.note) items.push(el("p", { className: "model-note", textContent: value.note }));
 items.push(...models.map(option));
 if (value.scoped.length && value.others.length) {
  const toggle = el("button", { className: "model-all", textContent: (all ? "☑" : "☐") + " Show all models" }); toggle.setAttribute("aria-pressed", String(all));
  toggle.addEventListener("click", () => modelMenu(menu, value, mode, !all)); items.push(toggle);
 }
 if (mode === "chat") {
  const row = (to: "default" | "work" | "think", label: string, text: string) => { const button = el("button", { className: "role-summary" }); button.append(el("span", { className: "role-label", textContent: label }), el("span", { className: "role-value", textContent: text }), el("span", { textContent: "›" })); button.dataset.role = to; button.addEventListener("click", () => again(to)); return button; };
  items.push(el("h3", { textContent: "Roles" }),
   row("default", "👑 Default", nameOf(value.default) + (value.default ? " · " + effortName(value.defaultEffort ?? "medium") : "")),
   row("work", "🔨 Work", value.work ? nameOf(value.work) + " · " + effortName(value.workEffort) : "—"),
   row("think", "💭 Think", value.think?.length ? value.think.map(ref => nameOf(ref) + " · " + effortName(value.thinkEffort?.[ref])).join(", ") : "—"));
 }
 menu.replaceChildren(...items);
 (menu.querySelector<HTMLElement>(".model-option[aria-pressed=true]") ?? menu.querySelector<HTMLElement>(".model-option, button"))?.focus();
}
$("model-button").addEventListener("click", async () => {
 if (!$("model-menu").hidden) return toggleMenu("model-button", "model-menu", false);
 const menu = $("model-menu"); menu.replaceChildren("Loading models…"); toggleMenu("model-button", "model-menu", true);
 try { modelMenu(menu, await get("models")); } catch (error) { menu.replaceChildren("Models failed to load: " + error.message); }
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
$("settings-button").addEventListener("click", () => {
 toggleMenu("settings-button", "settings-menu");
 // Catch up exists only in a session of the ce-workflow checkout itself (/wo lists it there).
 slashCommands ??= get("commands").catch(error => { slashCommands = undefined; throw error; });
 slashCommands.then(list => { $("hub-catchup").hidden = !list.wo.some(item => item.value === "catch-up"); }, () => {});
});
$("hub-catchup").addEventListener("click", async () => {
 closeMenus(); setDrawer(false);
 try { await post("message", { text: "/wo catch-up" }); showNotice("Catch-up started; progress shows here.", true); } catch (error) { showNotice(error.message); }
});
$("hub-restart").addEventListener("click", async () => {
 closeMenus(); setDrawer(false);
 if (!await confirmBox("Restart the hub? Every session stops and starts again; nothing is lost.")) return;
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
  // Closed down to the bottom edge, so the graph is a filled area the number stands out against.
  const left = 48 - loadSamples.length * 2;
  box.querySelector("polyline")!.setAttribute("points", [`${left},20`, ...loadSamples.map((sample, index) => `${index * 2 + left},${(20 - sample[key] / 5).toFixed(1)}`), "46,20"].join(" "));
  box.querySelector("span")!.textContent = String(value);
  box.setAttribute("aria-label", `${name} ${value}%`); box.title = `${name} ${value}% (graph: last 2 minutes)` + topText(key);
 }
}
// Hovering a graph lists the 5 programs using the most of it; looked up on hover only, at most every 10 s (it costs about a second).
type Top = { name: string; value: number }[];
let topProcs: { cpu: Top; memory: Top } | null = null, topAt = 0;
const topText = (key: "cpu" | "memory") => !topProcs?.[key].length ? "" : "\n\nTop programs:\n" + topProcs[key].map(item => `${key === "cpu" ? `${item.value}%` : `${(item.value / 1e9).toFixed(1)} GB`}  ${item.name}`).join("\n");
for (const key of ["cpu", "memory"] as const) $("load-" + key).addEventListener("mouseenter", async () => {
 if (Date.now() - topAt < 10_000) return;
 topAt = Date.now();
 try { topProcs = await get("processes"); } catch { return; }
 const box = $("load-" + key); box.title = box.title.split("\n\n")[0] + topText(key);
});
void pollLoad(); setInterval(pollLoad, 5000);
// Notifications: a session starts asking a question, or stops working (subagents count as working). Every open hub
// page polls, so the tag makes the OS replace duplicates; the session in view on a visible page is not announced.
let lastTones: Map<string, string> | null = null;
// A Windows UAC prompt blocks whatever started it and can only be answered at the PC itself, never from this page.
const uacText = () => `Admin approval (UAC) is waiting on ${hubSettings.hostname ?? "the hub PC"}; answer it at that PC.`;
function notifyUac(open: boolean) {
 if (!open) { if ($("notice").textContent?.startsWith("Admin approval (UAC)")) showNotice(""); return; }
 showNotice(uacText());
 if (typeof Notification === "undefined" || Notification.permission !== "granted" || !(hubSettings.notify ?? { question: true }).question) return;
 try { new Notification(uacText(), { tag: "uac" }); } catch { /* phones without a service worker refuse page notifications */ }
}
function notifyChanges(groups: Group[]) {
 const tones = new Map(groups.flatMap(group => group.sessions.map(session => [session.id, session.tone] as [string, string])));
 const before = lastTones; lastTones = tones;
 if (!before || typeof Notification === "undefined" || Notification.permission !== "granted") return;
 const notify = hubSettings.notify ?? { question: true, done: true };
 for (const group of groups) for (const session of group.sessions) {
  const was = before.get(session.id), now = session.tone;
  if (was === now || (session.id === sessionId && seenNow())) continue;
  // shortcut: one 5 s (15 s in the background) poll decides "finished"; a gap between chained turns can announce early.
  const kind = now === "waiting" && notify.question ? "asks a question" : was === "working" && ["seen", "unseen", "scheduled"].includes(now) && notify.done && !session.quiet ? "finished" : "";
  if (!kind) continue;
  try {
   const note = new Notification(`${group.label} - ${session.name} ${kind}`, { tag: `${session.id}:${now}` });
   note.onclick = () => { window.focus(); if (session.id !== sessionId) jumpTo(session.id); note.close(); };
  } catch { /* phones without a service worker refuse page notifications */ }
 }
}
// Gear badge: how many of Pi and its extensions have an update (hub checks hourly); the list sits in the gear menu.
function renderUpdates() {
 const updates = hubSettings.updates, count = updates ? (updates.pi ? 1 : 0) + updates.packages.length : 0;
 const own = !!updates?.packages.some(name => /ce-workflow/i.test(name)), others = count - (own ? 1 : 0);
 // An older running hub sends no version and has no changelog endpoint yet.
 $("hub-version").textContent = "Version: " + (hubSettings.version ?? ""); $("hub-version").hidden = !hubSettings.version;
 // Red dot only for ce-workflow (the one that matters); Pi and other extensions get a fainter yellow count.
 $("update-badge").hidden = !own; $("update-others").hidden = !others; $("update-button").hidden = !own; $("update-others").textContent = String(others);
 $("settings-button").title = count ? `Hub settings (${count} update${count > 1 ? "s" : ""})` : "Hub settings";
 const when = updates?.checkedAt ? new Date(updates.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
 const names = updates ? [...updates.pi ? [`Pi ${updates.pi.current} → ${updates.pi.latest}`] : [], ...updates.installed ? [] : updates.packages] : []; // the extension rows below mark their own updates
 $("update-list").textContent = !updates ? "Not checked by this hub." : updates.checking ? "Checking…" : (names.length ? names.join(", ") : when ? `Last checked ${when}` : "Not checked yet") + (updates.error ? ` · check failed: ${updates.error}` : "");
 // Installed extensions: ⟳ in front when an update is waiting (Update all installs it), red × uninstalls (not ce-workflow: the hub runs from it).
 $("extension-list").replaceChildren(...(updates?.installed ?? []).map(item => {
  const row = html("div", { className: "extension-row", title: item.source });
  row.append(html("span", { className: "extension-update", textContent: item.update ? "⟳" : "", title: item.update ? "Update available; Update all installs it" : "" }), html("span", { className: "extension-name", textContent: item.name }), html("span", { className: "extension-version", textContent: item.version }));
  if (!/ce-workflow/i.test(item.source)) {
   const remove = html("button", { type: "button", className: "extension-remove", textContent: "×", title: `Uninstall ${item.name}` });
   remove.addEventListener("click", async () => {
    if (!await confirmBox(`Uninstall ${item.name}? Pi removes it (pi remove ${item.source}); running sessions keep it until they restart.`)) return;
    remove.disabled = true;
    try { hubSettings = await post("hub", { action: "remove-package", source: item.source }) as HubSettings; showNotice(`Uninstalled ${item.name}.`, true); } catch (error) { showNotice(error.message); }
    renderUpdates();
   });
   row.append(remove);
  }
  return row;
 }));
 ($("update-check") as HTMLButtonElement).disabled = !updates || updates.checking;
 const wait = hubSettings.waiting;
 $("update-waiting").hidden = !wait;
 if (wait) $("update-waiting").textContent = `Hub restart waiting: ${wait.why.join(", ")}` + (wait.busy.length ? ` · until idle: ${wait.busy.join(", ")}` : " · restarting shortly");
}
// A click on either badge goes straight to Update all (same confirm) instead of opening the gear menu.
// The Update button (and the gear's badges): everything, or just ce-workflow when it has the update. Picking is the go-ahead.
function updateMenu(anchor: HTMLElement) {
 const own = !!hubSettings.updates?.packages.some(name => /ce-workflow/i.test(name));
 showMenu(anchor, [["Update everything (Pi, extensions, ce-workflow)", () => void runUpdate()], ...own ? [["Update only ce-workflow", () => void runUpdate("ce-workflow")] as [string, () => void]] : []]);
}
$("update-button").addEventListener("click", event => { event.stopPropagation(); updateMenu($("update-button")); });
for (const badge of ["update-badge", "update-others"]) { $(badge).title = "Update now"; $(badge).addEventListener("click", event => { event.stopPropagation(); updateMenu($("settings-button")); }); }
$("update-check").addEventListener("click", async () => {
 ($("update-check") as HTMLButtonElement).disabled = true; $("update-list").textContent = "Checking…";
 try { hubSettings = await post("hub", { action: "check-updates" }) as HubSettings; } catch (error) { showNotice(error.message); }
 renderUpdates();
});
// H-04 (D7): the Desktop app row lives on this PC's own page only; a remote page has no key and never shows it.
type AppStatus = { supported: boolean; note?: string; installed: boolean; version: string | null; staged: string | null; latest: string | null; running: boolean; login: boolean };
function renderApp(app: AppStatus) {
 $("app-group").hidden = false;
 const newer = !!app.latest && app.latest !== app.version && app.latest !== app.staged;
 $("app-status").textContent = !app.supported ? app.note ?? "" : !app.installed ? (app.latest ? `Not installed · ${app.latest} available` : "No app release is pinned yet.")
  : `Installed ${app.version}` + (app.staged ? ` · ${app.staged} ready` : newer ? ` · ${app.latest} available` : app.latest === app.version ? " · up to date" : "") + (app.running ? " · running" : "");
 $("app-login-field").hidden = $("app-actions").hidden = !app.supported;
 ($("app-login") as HTMLInputElement).checked = app.login; ($("app-login") as HTMLInputElement).disabled = !app.installed;
 const install = $("app-install") as HTMLButtonElement;
 install.textContent = app.installed ? "Update" : "Install"; install.disabled = !app.installed && !app.latest; // Update always checks GitHub now (the hub itself only checks every 10 minutes)
 $("app-uninstall").hidden = !app.installed;
 const start = $("app-start") as HTMLButtonElement;
 start.hidden = !app.installed; start.textContent = app.running ? "Stop" : "Start";
}
async function appAction(body: Record<string, unknown>, busy?: string) {
 if (busy) $("app-status").textContent = busy;
 try { renderApp(await post("app", body)); } catch (error) { showNotice(error.message); void appAction({ action: "status" }); }
}
// Linux: the daily cleanup moves old sessions to the Trash, which a server never empties.
async function trashAction(empty = false) {
 if (empty && !await confirmBox("Delete the trashed sessions for good?")) return;
 try {
  const trash = await post("hub", { action: "trash", empty }) as { supported: boolean; files: number; bytes: number; freed?: number };
  $("trash-field").hidden = !trash.supported;
  $("trash-size").textContent = trash.files ? `${trash.files} files` : "None";
  const button = $("trash-empty") as HTMLButtonElement;
  button.disabled = !trash.files; button.textContent = trash.files ? `Empty (${(trash.bytes / 1e9).toFixed(1)} GB)` : "Empty";
  if (empty) showNotice(`Freed ${Math.round((trash.freed ?? 0) / 1e6)} MB.`, true);
 } catch (error) { showNotice("Trash: " + error.message); }
}
$("trash-empty").addEventListener("click", () => void trashAction(true));
$("settings-button").addEventListener("click", () => { if (token && !$("settings-menu").hidden) { void appAction({ action: "status" }); void remoteAction(); } if (!$("settings-menu").hidden) void trashAction(); });
// Remote access (tailscale serve) is switched and its address copied on this PC's own page only, like pairing.
type RemoteStatus = { on: boolean; url?: string; missing?: string[]; error?: string };
let remoteUrl = "";
async function remoteAction(on?: boolean) {
 $("remote-group").hidden = false;
 const box = $("remote-on") as HTMLInputElement, copy = $("remote-copy") as HTMLButtonElement;
 if (on !== undefined) { box.disabled = copy.disabled = true; $("remote-status").textContent = on ? "Turning on\u2026" : "Turning off\u2026"; }
 let remote: RemoteStatus;
 try { remote = on === undefined ? (await hub("status")).remote : await hub("remote", { on }); } catch (error) { showNotice("Remote: " + error.message); remote = (await hub("status").catch(() => ({ remote: { on: false } }))).remote; }
 remoteUrl = remote.url ?? ""; box.checked = remote.on; box.disabled = false; copy.disabled = !remoteUrl;
 $("remote-status").textContent = !remote.on ? "Off" : remoteUrl || "Not served: " + (remote.error ?? remote.missing?.join(" ") ?? "starting");
}
$("remote-on").addEventListener("change", () => void remoteAction(($("remote-on") as HTMLInputElement).checked));
$("remote-copy").addEventListener("click", () => { if (remoteUrl) void copyPath(remoteUrl); });
$("app-install").addEventListener("click", () => void appAction({ action: $("app-install").textContent === "Update" ? "update" : "install" }, "Downloading…").then(() => setTimeout(() => void appAction({ action: "status" }), 2500)));
$("app-uninstall").addEventListener("click", () => void appAction({ action: "uninstall" }));
// The app writes app.lock a moment after it starts, so look again shortly after.
$("app-start").addEventListener("click", () => void appAction({ action: $("app-start").textContent === "Stop" ? "stop" : "start" }).then(() => setTimeout(() => void appAction({ action: "status" }), 2500)));
$("app-login").addEventListener("change", () => void appAction({ action: "login", on: ($("app-login") as HTMLInputElement).checked }));
function renderNotify() {
 const notify = hubSettings.notify ?? { question: true, done: true };
 ($("notify-question") as HTMLInputElement).checked = notify.question; ($("notify-done") as HTMLInputElement).checked = notify.done;
}
const askNotifyPermission = () => { if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission(); };
for (const key of ["question", "done"] as const) $("notify-" + key).addEventListener("change", () => {
 if (($("notify-" + key) as HTMLInputElement).checked) askNotifyPermission();
 void saveHubSettings({ notify: { [key]: ($("notify-" + key) as HTMLInputElement).checked } as HubSettings["notify"] });
});
// Browsers ask for permission only after a click; on by default, so the first click anywhere asks once.
addEventListener("pointerdown", () => { const notify = hubSettings.notify ?? { question: true, done: true }; if (notify.question || notify.done) askNotifyPermission(); }, { once: true });
// Changelog: the version in the gear opens all of it; after an update, What's new opens once with only the newer versions.
async function openChangelog(seen?: string) {
 let value: { version: string; entries: { version: string; date: string; body: string }[] };
 try { value = await get("changelog" + (seen ? "?since=" + encodeURIComponent(seen) : "")); } catch (error) { showNotice(error.message); return; }
 if (seen && !value.entries.length) return;
 $("changelog-title").textContent = seen ? `What's new in ${value.version}` : "Changelog";
 $("changelog-body").replaceChildren(...value.entries.map(entry => {
  const section = html("section", {});
  section.append(html("h3", { textContent: entry.date ? `${entry.version} · ${entry.date}` : entry.version }));
  // Screenshots (![alt](docs/changelog/x.png)) show as thumbnails right after the line above them and open full size.
  const parts = entry.body.split(/^!\[[^\]]*\]\((?:docs\/changelog\/)?([\w.-]+\.(?:png|jpe?g))\)[ \t]*$/gim);
  parts.forEach((part, i) => {
   if (i % 2) { const source = "api/changelog?image=" + encodeURIComponent(part) + (token ? "&token=" + token : ""), link = html("a", { href: source, className: "thumb" }); link.append(html("img", { src: source, alt: part, loading: "lazy" })); section.append(link); }
   else if (part.trim()) { const text = html("div", {}); renderMarkdown(text, part, new Set()); section.append(text); }
  });
  return section;
 }));
 ($("changelog") as HTMLDialogElement).showModal();
}
$("hub-version").addEventListener("click", () => { closeMenus(); void openChangelog(); });
$("changelog-close").addEventListener("click", () => ($("changelog") as HTMLDialogElement).close());
let changelogChecked = false;
function checkWhatsNew() {
 const { version, seenVersion } = hubSettings; if (changelogChecked || !version) return; changelogChecked = true;
 if (seenVersion === version) return;
 if (seenVersion) void openChangelog(seenVersion);
 void saveHubSettings({ seenVersion: version });
}
async function saveHubSettings(change: HubSettings) {
 try { hubSettings = await post("hub", { action: "settings", ...change }) as HubSettings; renderIcon(); renderIconPicker(); }
 catch (error) { showNotice(error.message); }
}
$("hub-park").addEventListener("change", () => void saveHubSettings({ idleParkMinutes: Number(($("hub-park") as HTMLSelectElement).value) }));
$("hub-collapse").addEventListener("change", () => void saveHubSettings({ collapseHours: Number(($("hub-collapse") as HTMLSelectElement).value) }).then(rerenderSessions));
// One checkbox per usage provider; unticked ones are neither polled nor shown.
function renderUsageProviders() {
 const hidden = new Set(hubSettings.usageHidden ?? []);
 $("usage-providers").replaceChildren(...(hubSettings.usageProviders ?? []).map(provider => {
  const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: !hidden.has(provider.id) });
  box.addEventListener("change", async () => {
   // Ticking a provider back on also shows all its top-bar windows again.
   const next = [...hidden].filter(key => key !== provider.id && !key.startsWith(provider.id + ":"));
   await saveHubSettings({ usageHidden: box.checked ? next : [...next, provider.id] }); renderUsageProviders(); void loadUsage();
  });
  const label = document.createElement("label"); label.append(box, " " + provider.label); return label;
 }));
 renderUsageBar();
}
// The picker: every icon previewed idle (no names: the pictures say it).
function renderIconPicker() {
 const current = iconName();
 const choice = (label: string, picked: boolean, svg: string, pick: () => void) => {
  const button = html("button", { type: "button", className: "icon-choice", title: label }); button.setAttribute("role", "radio"); button.setAttribute("aria-checked", String(picked)); button.setAttribute("aria-label", label);
  button.innerHTML = svg; button.addEventListener("click", pick); return button;
 };
 $("icon-grid").replaceChildren(...Object.keys(ICONS).map(name => choice(name.replaceAll("-", " "), name === current, iconSvg(name), () => void saveHubSettings({ icon: name }))));
}
$("settings-button").addEventListener("click", renderIconPicker);
// Theme and Auto/Light/Dark are per device (phone and PC may differ), kept in this browser. data-dark drives what CSS
// light-dark() can't (the diagram's invert filter).
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const themeSetting = (key: string, value?: string) => { try { if (value === undefined) return localStorage.getItem(key) ?? ""; if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* private mode */ } return value ?? ""; };
function applyTheme() {
 const root = document.documentElement, theme = themeSetting("hub-theme"), mode = themeSetting("hub-mode");
 if (theme) root.dataset.theme = theme; else delete root.dataset.theme;
 if (mode) root.dataset.mode = mode; else delete root.dataset.mode;
 root.toggleAttribute("data-dark", mode ? mode === "dark" : darkQuery.matches);
 ($("hub-theme") as HTMLSelectElement).value = theme; ($("hub-mode") as HTMLSelectElement).value = mode;
}
applyTheme(); darkQuery.addEventListener("change", applyTheme);
($("hub-usage") as HTMLSelectElement).value = usageUsed() ? "used" : "";
$("hub-usage").addEventListener("change", () => { themeSetting("hub-usage", ($("hub-usage") as HTMLSelectElement).value); void loadUsage(); });
for (const key of ["hub-theme", "hub-mode"]) $(key).addEventListener("change", () => { themeSetting(key, ($(key) as HTMLSelectElement).value); applyTheme(); });
$("hub-update").addEventListener("click", async () => {
 closeMenus(); setDrawer(false);
 if (!await confirmBox("Update Pi and extensions? Every session stops, pi update --all runs, then they start again; nothing is lost. Pi outside the hub (terminals) keeps the old version until restarted.")) return;
 await runUpdate();
});
async function runUpdate(only?: "ce-workflow") {
 try {
  const result = await post("hub", { action: "update", ...only ? { only } : {} }) as { queued?: string[] };
  if (result.queued) return showNotice(`Downloading now. Busy sessions (${result.queued.join(", ")}) reload onto it when quiet; the hub restarts once every session is idle.`, true);
  showNotice(`Updating ${only ?? "Pi and extensions"}; the page reconnects when the hub is back (a minute or two).`, true); } catch (error) { showNotice(error.message); }
}
// Queued messages come back into the box (Pi would otherwise still deliver them after Stop), ahead of any draft.
function restoreQueued(restored?: string[]) {
 if (!restored?.length) return false;
 const input = $("message-input"); input.value = [...restored, input.value].filter(Boolean).join("\n\n"); input.focus(); input.dispatchEvent(new Event("input")); return true;
}
$("stop").addEventListener("click", async () => { try { const result = await post("stop", {}) as { restored?: string[] }; showNotice(restoreQueued(result.restored) ? "Stopped. Your queued message is back in the box to edit." : "Stop requested.", true); } catch (error) { showNotice(error.message); } });
// One queued message: edit puts it in the box, cancel drops it. Already delivered: its text still comes back, and Send posts it as a new message.
async function editQueued(text?: string, cancel = false) {
 try {
  const result = await post("unqueue", text === undefined ? {} : { text }) as { restored?: string[]; delivered?: boolean };
  if (result.delivered) { if (!cancel) restoreQueued([text!]); showNotice(cancel ? "Already delivered; it can't be cancelled." : "Already delivered; Send posts your edit as a new message.", true); return; }
  if (cancel) { showNotice("Queued message cancelled.", true); return; }
  showNotice(restoreQueued(result.restored) ? "Queued message back in the box to edit." : "Nothing queued.", true);
 } catch (error) { showNotice(error.message); }
}

// The server starts every connection with a fresh full snapshot. Native EventSource stops for good on an HTTP error
// (503 while Pi reloads), so the page reconnects itself with backoff and reloads when the build changed.
let events: EventSource, build = "", retryDelay = 1000, retryTimer = 0;
const handlers: [string, (value) => void][] = [];
function applyUpdate(event: MessageEvent, update) {
 try { update(JSON.parse(event.data)); }
 catch (error) { showNotice("Workspace update failed: " + error.message + ". Reopen from the Pi terminal; your message draft is kept."); }
}
// pi-hub progress bar: hidden 1 min after done reaches total, or 15 min after the last report (a job that died or was forgotten).
let jobProgress: { done: number; total: number; label: string; seen: number } | null = null;
function setProgress(value?: { done: number; total: number; label: string; ago: number } | null) {
 jobProgress = value ? { ...value, seen: Date.now() - value.ago } : null; renderProgress();
}
function renderProgress() {
 const box = $("job-progress"), job = jobProgress, age = job ? Date.now() - job.seen : 0;
 box.hidden = !job || age > 15 * 60_000 || (job.done >= job.total && age > 60_000);
 if (box.hidden || !job) return;
 const percent = Math.min(100, Math.floor(job.done / job.total * 100)), text = `${job.label ? job.label + " " : ""}${job.done}/${job.total} (${percent}%)`;
 box.querySelector("span")!.textContent = text; box.title = text; box.querySelector("b")!.style.width = percent + "%";
 box.setAttribute("aria-valuemax", String(job.total)); box.setAttribute("aria-valuenow", String(job.done)); box.setAttribute("aria-label", text);
}
setInterval(renderProgress, 30_000);
function listen(name, update) { handlers.push([name, update]); }
listen("files", () => filesView.changed(!$("files").hidden));
listen("status", value => {
 state.status = value;
 // Woken by typing: a compaction the message would wait for starts now, while you finish typing (ce-workflow /wo compact early).
 if (!value?.parked && waking && $("message-input").value.trim()) void post("message", { text: "/wo compact early" }).catch(() => {});
 if (!value?.parked) waking = false; renderShell();
});
listen("sessions", () => void loadSessions()); // another session started, finished, asked or parked
listen("notice", value => showNotice(value.text));
listen("progress", value => setProgress(value)); // e.g. a model picked while parked could not be used (S-11)
// Plan events always describe Pi's current plan. When Pi switches plans, the page follows it,
// unless the reader picked another plan in the menu: that view stays until Pi switches again.
let currentPlan: string | null = null;
listen("plan", value => {
 // No current plan (it finished or was closed): a page following Pi's plan falls back to the product view, like a fresh load.
 if (!value) {
  const following = target === currentPlan; currentPlan = null;
  if (following && target) { target = "product"; state.plan = null; void loadDiagram("plan", true); renderShell(); }
  return;
 }
 if (value.id !== target && value.id !== currentPlan) {
  target = value.id;
  const query = new URLSearchParams(location.search); if (query.has("target")) { query.set("target", value.id); history.replaceState(null, "", "?" + query + location.hash); }
  void loadDiagram("plan", true);
 }
 currentPlan = value.id;
 if (value.id === target) { state.plan = value; renderShell(); }
});
listen("snapshot", value => {
 setProgress(value.progress);
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
listen("activity", value => { if ("working" in value) { clearTimeout(expectTimer); expectTimer = 0; } state.activity = { ...state.activity, ...value, ...(value.working && !state.activity.working && !value.tools ? { tools: [] } : {}) }; renderActivity(); renderShell(); });
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
