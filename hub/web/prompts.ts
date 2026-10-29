// Browser-only shared prompt renderer; the server/terminal race owns acceptance.
function node<K extends keyof HTMLElementTagNameMap>(tag: K, properties = {}, text = undefined) { const item = document.createElement(tag); Object.assign(item, properties); if (text !== undefined) item.textContent = text; return item; }
export function createPromptView(dialog: HTMLDialogElement, form: HTMLFormElement, post, notice, attachTo: (text: HTMLTextAreaElement) => void, links: (target: HTMLElement, text: string) => void) {
 const pending = new Map(), cursors = new Map(); let active, sending = false;
 function remove(id) { pending.delete(id); if (active?.askId === id) { active = null; dialog.close(); } show(); }
 async function answer(payload) {
  if (!active || sending) return;
  const id = active.askId; sending = true;
  try { const value = await post("answer", { askId: id, ...payload }); remove(id); if (!value.accepted) notice("This prompt was already answered or closed."); }
  catch (error) { const message = form.querySelector<HTMLParagraphElement>(".prompt-error"); if (message && active?.askId === id) { message.textContent = error.message + ". Your answer draft is kept."; message.hidden = false; } }
  finally { sending = false; }
 }
 // Non-modal, so the session bar stays usable while a session waits; Escape still cancels like a modal dialog.
 dialog.addEventListener("keydown", event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); dialog.dispatchEvent(new Event("cancel", { cancelable: true })); } });
 function button(text, run) { const value = node("button", { type: "button" }, text); value.addEventListener("click", run); return value; }
 function show() {
  if (active || !pending.size) return;
  active = pending.values().next().value; const ask = active;
  form.onsubmit = event => event.preventDefault();
  // Menus keep their title and purpose line; a single question's own header is its title (no repeated lines).
  const heading = ask.kind === "list" || ask.questions ? [node("h2", { id: "prompt-title" }, ask.title ?? "Answer questions")] : [];
  form.replaceChildren(...heading, ...(ask.purpose && heading.length ? [node("p", { className: "dialog-purpose" }, ask.purpose)] : []), ...(ask.detail && heading.length ? [node("p", { className: "dialog-detail" }, ask.detail)] : []));
  // Thumbnails (e.g. browser_act uploads): raster data URLs only, never SVG or remote addresses.
  const images = (Array.isArray(ask.images) ? ask.images : []).filter(image => /^data:image\/(png|jpeg|gif|webp);base64,/.test(String(image?.src)));
  if (images.length && heading.length) form.append(node("div", { className: "dialog-images" }, undefined));
  for (const image of images) { const figure = node("figure"); figure.append(node("img", { src: image.src, alt: String(image.caption ?? "") }), node("figcaption", {}, String(image.caption ?? ""))); form.querySelector(".dialog-images")?.append(figure); }
  const error = node("p", { className: "prompt-error", hidden: true }); error.setAttribute("role", "alert");
  let collect;
  if (ask.kind === "list" && ask.compact) {
   // Compact card (H3-07): a few actions in one row, no filter or descriptions.
   dialog.classList.add("compact");
   const actions = node("div", { className: "dialog-actions" });
   for (const item of ask.items.filter(item => !item.heading)) { const pick = button(item.label, () => answer({ action: "select", value: item.value })); pick.disabled = !!item.disabled; if (ask.currentValue === item.value) pick.classList.add("current"); actions.append(pick); }
   form.append(error, actions);
   form.onkeydown = null;
   dialog.oncancel = event => { event.preventDefault(); answer({ action: "back" }); };
   dialog.show(); (actions.querySelector<HTMLButtonElement>(".current:not(:disabled)") ?? actions.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus(); return;
  }
  dialog.classList.remove("compact");
  if (ask.kind === "list") {
   const filter = node("input", { type: "search", placeholder: "Filter options", className: "prompt-filter", value: cursors.get(ask.title)?.filter ?? "" }); filter.setAttribute("aria-label", "Filter options");
   const rows = node("div", { className: "prompt-options" }), checks = new Map(), buttons = [];
   const selected = new Set(ask.multi?.selected ?? []);
   for (const item of ask.items) {
    if (item.heading) { rows.append(node("p", { className: "prompt-heading" }, item.label)); continue; }
    const row = node("div", { className: "prompt-row" }); row.dataset.search = (item.label + " " + (item.description ?? "")).toLowerCase();
    const label = item.label + (item.enabled === undefined ? "" : item.enabled ? " (on)" : " (off)");
    if (ask.multi) {
     const input = node("input", { type: "checkbox", value: item.value, checked: selected.has(item.value), disabled: !!item.disabled }); checks.set(item.value, input);
     input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); input.checked = !input.checked; } });
     const text = node("label", { className: "prompt-option" }); text.append(input, node("span", {}, label)); row.append(text);
    } else {
     const pick = button(label, () => answer({ action: "select", value: item.value })); pick.disabled = !!item.disabled; pick.dataset.value = item.value;
     if ((ask.currentValue ?? cursors.get(ask.title)?.value) === item.value) { pick.classList.add("current"); pick.setAttribute("aria-current", "true"); }
     pick.addEventListener("focus", () => cursors.set(ask.title, { filter: filter.value, value: item.value }));
     pick.addEventListener("keydown", event => {
      if (event.key === " " && ask.spaceAction) { event.preventDefault(); answer({ action: "space", value: item.value }); }
      if (event.key === "ArrowRight" && ask.rowAction && item.rowAction !== false) { event.preventDefault(); answer({ action: "row", value: item.value }); }
     }); buttons.push(pick); row.append(pick);
     if (ask.spaceAction) { const toggle = button("Toggle", () => answer({ action: "space", value: item.value })); toggle.disabled = !!item.disabled; row.append(toggle); }
     if (ask.rowAction && item.rowAction !== false) { const open = button("Open", () => answer({ action: "row", value: item.value })); open.disabled = !!item.disabled; row.append(open); }
    }
    if (item.description) row.append(node("p", { className: "prompt-description" }, item.description));
    rows.append(row);
   }
   const applyFilter = () => { for (const row of rows.querySelectorAll<HTMLDivElement>(".prompt-row")) row.hidden = !row.dataset.search.includes(filter.value.toLowerCase()); cursors.set(ask.title, { ...cursors.get(ask.title), filter: filter.value }); };
   filter.addEventListener("input", applyFilter); applyFilter(); form.append(filter, rows);
   const values = () => [...checks].filter(([, input]) => input.checked).map(([id]) => id);
   collect = () => { const chosen = values(); if (ask.multi?.requireOne && !chosen.length) throw new Error("Choose at least one option."); return { action: "back", values: chosen }; };
   const actions = node("div", { className: "dialog-actions" });
   if (ask.tabAction) actions.append(button(/model/i.test(ask.title) ? "Switch model scope (Tab)" : "Switch view (Tab)", () => answer({ action: "tab" })));
   actions.append(button(ask.multi ? "Done" : "Back", () => { try { answer(ask.multi ? collect() : { action: "back" }); } catch (failure) { error.textContent = failure.message; error.hidden = false; } }));
   form.append(error, actions);
   form.onkeydown = event => {
    if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey && event.target !== filter) { event.preventDefault(); filter.value += event.key; applyFilter(); filter.focus(); }
    if (event.key === "Enter" && event.target === filter && !ask.multi) { event.preventDefault(); const pick = buttons.find(item => !item.disabled && !item.parentElement.hidden && item.classList.contains("current")) ?? buttons.find(item => !item.disabled && !item.parentElement.hidden); pick?.click(); }
    if (event.key === "Tab" && ask.tabAction) { event.preventDefault(); answer({ action: "tab" }); }
    if (["ArrowDown", "ArrowUp"].includes(event.key) && !ask.multi) {
     event.preventDefault(); const available = buttons.filter(item => !item.disabled && !item.parentElement.hidden), index = available.findIndex(item => item === document.activeElement);
     available[(index + (event.key === "ArrowDown" ? 1 : -1) + available.length) % available.length]?.focus();
    }
   };
   dialog.oncancel = event => { event.preventDefault(); try { answer(ask.multi ? collect() : { action: "back" }); } catch (failure) { error.textContent = failure.message; error.hidden = false; } };
   dialog.show(); filter.focus(); return;
  }
  // Enter sends, Shift+Enter is a new line in the text box; checklist Enter toggles (its handler prevents default first).
  form.onkeydown = event => {
   if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.defaultPrevented) return;
   const field = event.target as HTMLInputElement;
   if (field.tagName === "TEXTAREA" || field.type === "radio") { event.preventDefault(); form.requestSubmit(); }
  };
  const questions = ask.questions ?? [ask], readers = [];
  for (const [index, question] of questions.entries()) {
   const section = node("fieldset", { className: "prompt-question" }); const legend = node("legend", ask.questions ? {} : { id: "prompt-title" }); links(legend, question.question); section.append(legend);
   // Image paths in the context or options become links with thumbnails; click opens full size.
   if (question.context) { const context = node("div", { className: "prompt-context" }); links(context, question.context); section.append(context); }
   const inputs = [];
   for (const option of question.options) {
    const input = node("input", { type: question.allowMultiple ? "checkbox" : "radio", name: "question_" + index, value: option.title, checked: !!option.selected }); input.dataset.on = option.selected ? "1" : ""; inputs.push(input);
    if (question.allowMultiple) input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); input.checked = !input.checked; } });
    // Tapping the chosen radio again clears it, so the text box can become your own answer.
    else input.addEventListener("click", () => { if (input.dataset.on) input.checked = false; for (const other of inputs) other.dataset.on = other.checked ? "1" : ""; });
    // Paths and URLs in an option link like in chat (a file link's click is handled, so it doesn't tick the option).
    const title = node("span"); links(title, option.title);
    const row = node("label", { className: "prompt-option" }); row.append(input, title);
    if (option.description) { const description = node("small", { className: "prompt-description" }); links(description, option.description); row.append(description); } section.append(row);
   }
   // One box like the terminal: with an option chosen it is the comment, with none it is your own answer.
   const freeform = question.allowFreeform || !question.options.length, commented = ask.allowComment && question.options.length > 0;
   const placeholder = !question.options.length ? "Write your answer" : freeform && commented ? "Comment on your choice, or choose nothing and write your own answer" : freeform ? "Or choose nothing and write your own answer" : "Optional comment";
   // A pre-filled answer (ask_user initialText) opens ready to edit, with room for it; a short one-line one (a name) stays one line.
   const prefilled = typeof question.initialText === "string" && !question.options.length, oneLine = prefilled && !question.initialText.includes("\n") && question.initialText.length <= 80;
   const text = node("textarea", { rows: oneLine ? 1 : prefilled ? 10 : 3, maxLength: 16000, placeholder, value: prefilled ? question.initialText : "" }); text.setAttribute("aria-label", placeholder + ": " + question.question);
   if (freeform || commented) { section.append(text); attachTo(text); }
   const skip = node("input", { type: "checkbox" });
   if (ask.questions) { const label = node("label", { className: "prompt-option" }); label.append(skip, "Skip this question"); section.append(label); }
   readers.push(() => {
    if (skip.checked && ask.questions) return { status: "skipped" };
    const selections = inputs.filter(input => input.checked).map(input => input.value), typed = text.value.trim();
    if (!selections.length) {
     if (freeform && typed) return { status: "answered", response: { kind: "freeform", text: typed } };
     throw new Error((freeform ? "Choose an answer or write one for: " : "Choose an answer to: ") + question.question);
    }
    if (typed && !commented) throw new Error("Clear the choice to send your own answer, or clear the text: " + question.question);
    return { status: "answered", response: { kind: "selection", selections, ...(typed ? { comment: typed } : {}) } };
   }); form.append(section);
  }
  const actions = node("div", { className: "dialog-actions" }); actions.append(node("button", { type: "button", className: "danger", onclick: () => answer({ cancel: true }) }, "Cancel"), node("button", { type: "submit", className: "primary" }, "Send answer")); form.append(error, actions);
  collect = () => {
   const answers = readers.map(read => read()); if (ask.questions) return { answers };
   const response = answers[0].response; return response.kind === "freeform" ? { text: response.text } : { selections: response.selections, ...(response.comment ? { comment: response.comment } : {}) };
  };
  form.onsubmit = event => { event.preventDefault(); try { answer(collect()); } catch (failure) { error.textContent = failure.message; error.hidden = false; } };
  dialog.oncancel = event => { event.preventDefault(); answer({ cancel: true }); };
  dialog.show(); form.querySelector<HTMLElement>("input,textarea,button")?.focus();
 }
 return {
  sync(asks) { for (const id of pending.keys()) if (!asks.some(ask => ask.askId === id)) pending.delete(id); for (const ask of asks) pending.set(ask.askId, ask); if (active && !pending.has(active.askId)) { active = null; dialog.close(); } show(); },
  pending(ask) { pending.set(ask.askId, ask); show(); },
  closed: remove,
  get busy() { return !!active; },
 };
}
