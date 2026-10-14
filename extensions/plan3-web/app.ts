// Browser-only source; the server strips erasable types without a build step.
import type { Diagram } from "../plan3-diagram.ts";
import type { createActivityMirror } from "../plan3-web.ts";
// @ts-ignore Browser URL includes the workspace token.
import { createDiagramView, element, seed } from "./diagram.js?token=__TOKEN__";
// @ts-ignore Browser URL includes the workspace token.
import { createPromptView } from "./prompts.js?token=__TOKEN__";
function $(id: "message-input" | "comment-text"): HTMLTextAreaElement;
function $(id: "send" | "stop" | "comment-save"): HTMLButtonElement;
function $(id: "comment-prompt" | "prompt"): HTMLDialogElement;
function $(id: "composer" | "comment-form" | "prompt-form"): HTMLFormElement;
function $(id: "diagram"): SVGSVGElement;
function $(id: "search"): HTMLInputElement;
function $(id: string): HTMLElement;
function $(id: string): HTMLElement | SVGSVGElement { return document.getElementById(id); }
const token = "__TOKEN__";
let target = new URLSearchParams(location.search).get("target") ?? undefined;
const state: { connected: boolean; diagram: Diagram | null; plan: { title: string } | null; activity: Partial<ReturnType<ReturnType<typeof createActivityMirror>["snapshot"]>>; pinning: boolean } = { connected: false, diagram: null, plan: null, activity: {}, pinning: false };
let commentPoint, hoverTimer, messageSending = false, commandSending = false;
const chat = new Map();

function showNotice(text) { $("notice").textContent = text; $("notice").hidden = !text; }
function renderShell() {
 const title = state.plan?.title ?? state.diagram?.title ?? "Architecture workspace";
 $("title").textContent = title; $("title").title = title; document.title = title + " — Plan3";
 $("target-kind").textContent = target === "product" ? "Product" : "Plan";
 $("commands").hidden = target === "product";
 $("connection").textContent = !state.connected ? "Disconnected" : state.activity.compacting ? "Compacting" : state.activity.working ? "Working" : "Idle";
 $("empty-diagram").hidden = !!(state.diagram?.nodes?.length || state.diagram?.notes?.length);
 for (const button of $("commands").querySelectorAll("button")) button.disabled = !state.connected || !!state.activity.working || commandSending || promptView.busy;
 $("send").disabled = !state.connected || messageSending; $("send").textContent = state.activity.working ? "Queue" : "Send";
 $("stop").hidden = !state.activity.working; $("stop").disabled = !state.connected;
}

function renderActivity() {
 const root = $("activity"), data = state.activity, opened = new Map([...root.querySelectorAll("details")].map(item => [item.dataset.id, item.open]));
 const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text = undefined, className = "") => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item; };
 const section = (id, title, open = false) => { const item = make("details"); item.dataset.id = id; item.open = opened.get(id) ?? open; item.append(make("summary", title)); root.append(item); return item; };
 root.replaceChildren();
 if (data.compacting) root.append(make("p", "Compacting session history…", "activity-status"));
 if (data.interrupted) root.append(make("p", "Run interrupted.", "activity-status"));
 if (data.error) { const error = make("p", data.error, "activity-error"); error.setAttribute("role", "alert"); root.append(error); }
 if (data.thinking) section("thinking", "Thinking").append(make("pre", data.thinking));
 for (const tool of data.tools ?? []) {
  const row = section(tool.id, tool.name + " · " + tool.state + (tool.durationMs === undefined ? "" : " · " + Math.round(tool.durationMs) + " ms"));
  row.className = "tool-row" + (tool.parent ? " nested-tool" : "") + (tool.state === "error" ? " tool-error" : "");
  for (const [label, text] of [["Arguments", tool.args], ["Progress", tool.progress], ["Result", tool.result]]) if (text) { row.append(make("strong", label), make("pre", text)); }
 }
 if (data.queue?.length || data.hasPendingMessages) {
  const queue = section("queue", "Observed queued messages", true);
  queue.append(make("p", "May be stale; edit or cancel the real queue in Pi.", "activity-caution"));
  for (const item of data.queue ?? []) queue.append(make("p", item.delivery + ": " + item.text));
 }
 if (data.tools?.length) root.append(make("p", "Text-only excerpts; custom tool renderers and images stay in Pi.", "activity-caution"));
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
// Right-click: the composer gets "note @id: "; Enter saves the rest as a note on that element.
const NOTE = /^note @([a-z][a-z0-9_]{0,47}):\s*([\s\S]+)$/;
function startNote(id) { const input = $("message-input"); input.value = "note @" + id + ": "; input.focus(); input.setSelectionRange(input.value.length, input.value.length); renderMentions(); showNotice("Type the note for @" + id + " and press Enter."); }
function insertMention(id) { const input = $("message-input"); input.value += (input.value && !/\s$/.test(input.value) ? " " : "") + "@" + id + " "; input.focus(); renderMentions(); }
function pin(point) {
 commentPoint = { ...point, expectedRevision: state.diagram.revision }; state.pinning = false; $("pin-note").setAttribute("aria-pressed", "false"); $("canvas").classList.remove("pinning");
 $("comment-purpose").textContent = point.element ? "Pin a comment to @" + point.element + "." : "Pin a comment at this canvas position.";
 $("comment-error").hidden = true; $("comment-prompt").showModal(); $("comment-text").focus(); showNotice("");
}
const diagramView = createDiagramView($("diagram"), {
 hover, leave, notes: drawNotes, pin, pinning: () => state.pinning,
 mention: insertMention, note: startNote,
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
 box.replaceChildren();
 (row.blocks ?? []).forEach((block, index) => {
  const item = document.createElement("details"), summary = document.createElement("summary"), key = block.id ?? "thinking_" + index;
  item.dataset.key = key; item.open = opened.has(key); item.className = "block block-" + block.type + (block.error ? " block-error" : "");
  summary.textContent = block.type === "thinking" ? "Thinking" : block.title + (block.result === undefined ? (row.streaming ? "" : " \u2026") : block.error ? " \u2715" : "");
  item.append(summary);
  for (const text of block.type === "thinking" ? [block.text] : [block.args, block.result].filter(value => value !== undefined)) { const pre = document.createElement("pre"); pre.textContent = text; item.append(pre); }
  box.append(item);
 });
}
const atBottom = (list: HTMLElement) => list.scrollHeight - list.scrollTop - list.clientHeight < 48;
$("messages").addEventListener("scroll", () => { if (atBottom($("messages"))) $("to-bottom").hidden = true; });
$("to-bottom").addEventListener("click", () => { const list = $("messages"); list.scrollTop = list.scrollHeight; $("to-bottom").hidden = true; });
function renderChat() {
 const list = $("messages"), follow = atBottom(list);
 const encoder = new TextEncoder();
 while (chat.size > 100 || [...chat.values()].reduce((bytes, row) => bytes + encoder.encode(row.text).length, 0) > 512000) chat.delete(chat.keys().next().value);
 for (const item of list.querySelectorAll<HTMLLIElement>(":scope > li")) if (!chat.has(item.dataset.id)) item.remove();
 for (const row of chat.values()) {
  let item = [...list.querySelectorAll<HTMLLIElement>(":scope > li")].find(item => item.dataset.id === row.id);
  if (!item) { item = document.createElement("li"); item.dataset.id = row.id; item.append(document.createElement("strong"), document.createElement("div"), document.createElement("div"), document.createElement("small")); list.append(item); }
  const json = JSON.stringify(row); if (item.dataset.json === json) continue; item.dataset.json = json;
  const text = row.text.trim(), note = row.error ?? (row.truncated ? "Excerpt; full history stays in Pi." : row.streaming && !row.blocks?.length ? "Streaming…" : "");
  // A turn with only thinking/tool calls is a compact block list without the "Agent" header; an empty one is hidden.
  item.className = "message " + row.role + (text ? "" : " message-blocks"); item.hidden = !text && !row.blocks?.length && !note;
  item.children[0].textContent = text ? (row.role === "user" ? "You" : "Agent") : "";
  renderBlocks(item.children[1] as HTMLElement, row); item.children[2].textContent = row.text; item.children[3].textContent = note;
 }
 // Follow new output only while the reader is at the bottom; otherwise offer a jump button.
 if (follow) list.scrollTop = list.scrollHeight; else if (list.scrollHeight > list.clientHeight) $("to-bottom").hidden = false;
}
const mentioned = () => [...new Set([...$("message-input").value.matchAll(/(?<![\w@])@([a-z][a-z0-9_]{0,47})(?![A-Za-z0-9_])/g)].map(match => match[1]))];
function renderMentions() {
 const data = state.diagram, all = [...(data?.nodes ?? []), ...(data?.edges ?? []), ...(data?.notes ?? [])]; $("mentions").replaceChildren();
 for (const id of mentioned()) { const entity = all.find(item => item.id === id), chip = document.createElement("span"); chip.className = "mention-chip"; chip.textContent = "@" + id + (entity ? "" : " (not found)"); chip.title = "No matching element; sent as text."; if (entity && "label" in entity) chip.title = entity.label ?? chip.title; if (entity && "text" in entity) chip.title = entity.text; $("mentions").append(chip); }
}
$("message-input").addEventListener("input", renderMentions);
// Clipboard images become temp files (like Pi's terminal paste); the chat gets their path.
$("message-input").addEventListener("paste", async event => {
 const file = [...(event.clipboardData?.items ?? [])].find(item => item.type.startsWith("image/"))?.getAsFile(); if (!file) return;
 event.preventDefault(); showNotice("Saving pasted image\u2026");
 try {
  const response = await fetch("/api/paste", { method: "POST", credentials: "omit", headers: { Authorization: "Bearer " + token, "Content-Type": file.type }, body: file });
  const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "Image paste failed.");
  const input = $("message-input"), at = input.selectionStart; input.setRangeText((at && !/\s/.test(input.value[at - 1]) ? " " : "") + value.path + " ", at, input.selectionEnd, "end"); input.scrollTop = input.scrollHeight; input.focus(); const list = $("messages"); list.scrollTop = list.scrollHeight; renderMentions(); showNotice("Image saved: " + value.path);
 } catch (error) { showNotice(error.message); }
});
// Terminal parity: Enter sends, Shift+Enter adds a line, Escape stops a running agent.
$("message-input").addEventListener("keydown", event => {
 if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); $("composer").requestSubmit(); }
 if (event.key === "Escape" && !$("stop").hidden && !$("stop").disabled) { event.preventDefault(); $("stop").click(); }
});
$("composer").addEventListener("submit", async event => {
 event.preventDefault(); if (messageSending || !state.connected) return;
 const text = $("message-input").value; if (!text.trim()) return;
 const note = text.trim().match(NOTE);
 if (note) {
  messageSending = true; renderShell();
  try { const value = await post("comment", { element: note[1], text: note[2].trim(), expectedRevision: state.diagram.revision }); state.diagram = value.diagram; diagramView.render(state.diagram); if ($("message-input").value === text) $("message-input").value = ""; renderMentions(); showNotice("Note saved on @" + note[1] + "."); }
  catch (error) { showNotice(error.message + ". Your note draft is kept."); }
  finally { messageSending = false; renderShell(); }
  return;
 }
 messageSending = true; renderShell();
 // Sending jumps to the newest message; later rows keep following from the bottom.
 const list = $("messages"); list.scrollTop = list.scrollHeight; $("to-bottom").hidden = true;
 try { const result = await post("message", { text }); if ($("message-input").value === text) $("message-input").value = ""; renderMentions(); showNotice(result.queued ? "Message queued as a follow-up." : "Message sent."); }
 catch (error) { showNotice(error.message + ". Your message draft is kept."); }
 finally { messageSending = false; renderShell(); }
});
for (const button of $("commands").querySelectorAll("button")) button.addEventListener("click", async () => {
 if (commandSending) return; commandSending = true; renderShell();
 try {
  const command = button.dataset.command === "resume" ? "/resume3" : "/plan3 " + button.dataset.command;
  await post("message", { text: command + " " + target }); showNotice("");
 }
 catch (error) { showNotice(error.message); }
 finally { commandSending = false; renderShell(); }
});
$("stop").addEventListener("click", async () => { try { await post("stop", {}); showNotice("Stop requested."); } catch (error) { showNotice(error.message); } });

// Native EventSource reconnects; the server always starts a connection with a fresh full snapshot.
const events = new EventSource("/api/events?token=" + token + (target ? "&target=" + encodeURIComponent(target) : ""));
function applyUpdate(event: MessageEvent, update) {
 try { update(JSON.parse(event.data)); }
 catch (error) { showNotice("Workspace update failed: " + error.message + ". Reopen from the Pi terminal; your message draft is kept."); }
}
function listen(name, update) { events.addEventListener(name, (event: MessageEvent) => applyUpdate(event, update)); }
listen("snapshot", value => {
 if (value.target) target = value.target.kind === "product" ? "product" : value.target.id;
 state.connected = true; state.diagram = value.diagram; state.plan = value.plan; state.activity = value.activity ?? {};
 chat.clear(); for (const row of value.chat ?? []) chat.set(row.id, row);
 promptView.sync(value.dialogs ?? []); renderActivity(); renderChat(); renderMentions(); showNotice(""); renderShell(); diagramView.render(state.diagram);
});
listen("diagram", value => {
 if ((target === "product" && value.target.kind === "product") || value.target.id === target) { state.diagram = value.diagram; diagramView.render(state.diagram); renderShell(); }
});
listen("message", row => { chat.set(row.id, row); renderChat(); });
listen("dialog", value => { promptView.pending(value); renderShell(); });
listen("dialog_closed", value => { promptView.closed(value.askId); renderShell(); });
listen("activity", value => { state.activity = value; renderActivity(); renderShell(); });
events.addEventListener("error", event => {
 if (event instanceof MessageEvent && event.data) { applyUpdate(event, value => showNotice(value.message ?? "Workspace update failed.")); return; }
 state.connected = false; renderShell();
 showNotice("Connection lost. Return to the Pi terminal and reopen the workspace. Your unsent message is still here.");
});
window.addEventListener("pagehide", () => events.close());
