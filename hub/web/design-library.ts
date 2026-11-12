// Library browsing is local UI; it never sends a model prompt.
import type { CatalogEntry } from "../../extensions/design-catalog.ts";
import type { DesignReference } from "../../extensions/design-references.ts";
// @ts-ignore Browser URL includes the workspace token.
import { annotate, legend } from "./annotate.js?token=__TOKEN__";

export function createDesignLibrary(root: HTMLElement, { get, post, back: leave, attached }: { get: (endpoint: string) => Promise<any>; post: (endpoint: string, data: Record<string, unknown>) => Promise<any>; back: () => void; attached: (ref: DesignReference) => void }) {
 const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; return item; };
 const heading = make("h2", "Design library"), purpose = make("p", "Browse references before asking for a design. Choosing inspiration does not install or select a project foundation."), head = make("div"), leaveButton = make("button", "Back to workspace"), refresh = make("button", "Refresh sources");
 leaveButton.type = refresh.type = "button"; leaveButton.addEventListener("click", leave); head.className = "library-heading"; head.append(leaveButton, heading, refresh);
 const tools = make("div"), search = make("input"), source = make("select"), kind = make("select"), status = make("p"), list = make("div"), detail = make("section");
 search.type = "search"; search.maxLength = 200; search.placeholder = "Search designs and components"; search.setAttribute("aria-label", "Search design library");
 source.setAttribute("aria-label", "Reference source"); kind.setAttribute("aria-label", "Reference type"); status.setAttribute("role", "status");
 for (const [select, rows] of [[source, [["", "All sources"], ["od", "OpenDesign"], ["astryx", "Astryx"], ["draft", "Studio drafts"], ["export", "Selected exports"]]], [kind, [["", "All types"], ["system", "Design systems"], ["theme", "Themes"], ["component", "Components"], ["design", "Saved designs"]]]] as [HTMLSelectElement, string[][]][]) {
  for (const [value, label] of rows) { const option = make("option", label); option.value = value; select.append(option); }
 }
 tools.className = "library-tools"; list.className = "library-list"; detail.className = "library-detail"; detail.hidden = true;
 tools.append(search, source, kind);
 // D12: a page is captured by this session's browser_fetch, after your per-site approval; nothing loads in this page.
 const page = make("form"), address = make("input"), pageAspect = make("select"), pageAdd = make("button", "Add page reference"), pageStatus = make("p");
 address.type = "url"; address.required = true; address.maxLength = 236; address.placeholder = "https://… a page to borrow from"; address.setAttribute("aria-label", "Page address");
 pageAspect.setAttribute("aria-label", "Page reference aspect"); pageStatus.setAttribute("role", "status"); page.className = "library-tools";
 for (const [value, label] of [["whole", "Whole style"], ["colors", "Colors"], ["typography", "Typography"], ["layout", "Layout"], ["background", "Background"], ["component", "Component"]]) { const option = make("option", label); option.value = value; pageAspect.append(option); }
 page.addEventListener("submit", async event => {
  event.preventDefault(); pageAdd.disabled = true; pageStatus.textContent = "Approve the site when asked; your browser takes a screenshot…";
  try { const ref = await post("designreference", { action: "add", url: address.value, aspect: pageAspect.value }); attached(ref); address.value = ""; pageStatus.textContent = `Selected @${ref.ref}. Describe how to use it in Chat.`; }
  catch (error) { pageStatus.textContent = "Could not add page: " + error.message; }
  finally { pageAdd.disabled = false; }
 });
 page.append(address, pageAspect, pageAdd, pageStatus);
 root.append(head, purpose, tools, page, status, list, detail);
 let entries: CatalogEntry[] = [], offline = "", loaded: Promise<void> | undefined, selected = "", gridScroll = 0, viewport = "", inspection = 0, viewed: string | undefined, abandoned: string | undefined;
 const key = "design-library:" + location.pathname;
 try {
  const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
  if (typeof saved?.query === "string") search.value = saved.query.slice(0, 200);
  if (typeof saved?.source === "string") source.value = saved.source;
  if (typeof saved?.kind === "string") kind.value = saved.kind;
  if (typeof saved?.selected === "string") selected = saved.selected;
  if (typeof saved?.previewKey === "string" && /^[a-f0-9]{32}$/.test(saved.previewKey)) abandoned = saved.previewKey;
  if (["", "390", "768", "1280"].includes(saved?.viewport)) viewport = saved.viewport;
  if (Number.isFinite(saved?.scroll) && saved.scroll >= 0) gridScroll = saved.scroll;
 } catch { /* private mode: browsing still works without persistence */ }
 const remember = () => { try { sessionStorage.setItem(key, JSON.stringify({ query: search.value, source: source.value, kind: kind.value, selected, scroll: gridScroll, viewport, previewKey: viewed })); } catch { /* private mode */ } };
 const release = (id: string) => { void post("unview", { key: id }).catch(() => {}); };
 if (abandoned) release(abandoned);
 const cancelSample = () => { inspection++; if (viewed) { release(viewed); viewed = undefined; } };
 function image(item: CatalogEntry, thumbnail = false) {
  const img = make("img"); img.alt = item.name + ": supplied static source image"; img.loading = "lazy"; img.decoding = "async";
  img.className = thumbnail ? "library-thumb" : "library-image";
  img.src = `api/designimage?id=${encodeURIComponent(item.id)}&revision=${encodeURIComponent(item.imageRevision ?? "")}&token=__TOKEN__`;
  img.addEventListener("error", () => img.replaceWith(make("p", "Image unavailable on this host. Metadata is still available.")), { once: true });
  return img;
 }
 function sample(item: CatalogEntry) {
  const request = inspection, loading = make("p", "Opening isolated source sample…"); loading.setAttribute("role", "status"); detail.append(loading);
  void post("designexample", { id: item.id, revision: item.revision }).then(value => {
   if (request !== inspection || selected !== item.id) { release(value.key); return; }
   viewed = value.key; detail.querySelector<HTMLButtonElement>("[data-add]")!.disabled = false;
   const frame = make("iframe"), wrap = make("div"), controls = make("div"), label = make("label", "Preview width "), sizes = make("select"), note = make("p", value.note + " External fonts, libraries and network requests are blocked; use only the controls supplied by the sample.");
   for (const [width, text] of [["", "Fit panel"], ["390", "Phone (390 px)"], ["768", "Tablet (768 px)"], ["1280", "Desktop (1280 px)"]]) { const option = make("option", text); option.value = width; sizes.append(option); }
   sizes.value = viewport; sizes.setAttribute("aria-label", "Preview viewport width"); label.append(sizes); controls.append(label); controls.className = "library-tools";
   frame.title = item.name + " – isolated source sample"; frame.setAttribute("sandbox", "allow-scripts"); frame.referrerPolicy = "no-referrer"; frame.dataset.revision = value.revision;
   wrap.setAttribute("aria-busy", "true"); frame.addEventListener("load", () => wrap.setAttribute("aria-busy", "false"), { once: true });
   frame.src = `/x/${value.key}/${value.open.split("/").map(encodeURIComponent).join("/")}`;
   const resize = () => { frame.style.width = sizes.value ? sizes.value + "px" : "100%"; viewport = sizes.value; remember(); };
   sizes.addEventListener("change", resize); resize(); wrap.className = "library-preview"; wrap.append(frame); loading.replaceWith(note, controls, wrap);
  }).catch(error => { if (request === inspection && selected === item.id) loading.textContent = "Sample unavailable: " + error.message; });
 }
 async function add(item: CatalogEntry, button: HTMLButtonElement, feedback: HTMLElement, aspect = "whole", note = "", region?: number[]) {
  button.disabled = true; feedback.textContent = "Saving reference…";
  try {
   const ref = await post("designreference", { action: "add", id: item.id, revision: item.revision, aspect, note, ...(region ? { region } : {}), ...(selected === item.id && viewed ? { previewKey: viewed } : {}) });
   attached(ref); feedback.textContent = `Selected @${ref.ref}. Describe how to use it in Chat.`;
  } catch (error) { feedback.textContent = "Could not add reference: " + error.message; }
  finally { button.disabled = false; }
 }
 // Never cancel native scrolling or text selection. Shortcuts apply only to non-interactive card content.
 function gestures(node: HTMLElement, pick: () => void) {
  const safe = (event: Event) => !(event.target as HTMLElement).closest("button, a, input, textarea, select, iframe") && getSelection()?.isCollapsed !== false;
  node.addEventListener("click", event => { if ((event.ctrlKey || event.metaKey) && safe(event)) { event.preventDefault(); pick(); } });
  node.addEventListener("contextmenu", event => { if (safe(event)) { event.preventDefault(); pick(); } });
  let timer: ReturnType<typeof setTimeout>, x = 0, y = 0;
  const cancel = () => clearTimeout(timer);
  node.addEventListener("pointerdown", event => {
   cancel(); if (event.pointerType !== "touch" || !event.isPrimary || !safe(event)) return;
   x = event.clientX; y = event.clientY;
   timer = setTimeout(() => { if (node.isConnected && !node.closest("[hidden]") && getSelection()?.isCollapsed !== false) pick(); }, 650);
  });
  node.addEventListener("pointermove", event => { if (Math.hypot(event.clientX - x, event.clientY - y) > 8) cancel(); }, { passive: true });
  for (const event of ["pointerup", "pointercancel", "pointerleave"]) node.addEventListener(event, cancel, { passive: true });
 }
 function inspect(item: CatalogEntry) {
  cancelSample(); gridScroll = detail.hidden ? root.scrollTop : gridScroll; selected = item.id;
  const back = make("button", "Back to library"), title = make("h3", item.name), provenance = make("p", item.provenance);
  back.type = "button";
  back.addEventListener("click", () => {
   cancelSample(); detail.replaceChildren(); detail.hidden = true; tools.hidden = page.hidden = list.hidden = status.hidden = false; selected = ""; remember();
   list.querySelector<HTMLButtonElement>(`[data-entry="${CSS.escape(item.id)}"] button`)?.focus({ preventScroll: true }); root.scrollTop = gridScroll;
  });
  detail.replaceChildren(back, title, provenance, make("p", `${item.license}; catalog revision ${item.revision}`));
  if (item.description) detail.append(make("p", item.description));
  const actions = make("div"), aspect = make("select"), note = make("textarea"), addButton = make("button", "Add reference"), feedback = make("p");
  aspect.setAttribute("aria-label", "Reference aspect");
  for (const [value, label] of [["whole", "Whole style"], ["colors", "Colors"], ["typography", "Typography"], ["layout", "Layout"], ["background", "Background"], ["component", "Component"]]) { const option = make("option", label); option.value = value; aspect.append(option); }
  if (item.kind === "component") aspect.value = "component";
  note.maxLength = 4000; note.rows = 2; note.placeholder = "What should we borrow? (optional)"; note.setAttribute("aria-label", "Reference note");
  addButton.type = "button"; addButton.dataset.add = ""; feedback.setAttribute("role", "status"); actions.className = "library-tools";
  addButton.disabled = item.preview === "sample";
  addButton.addEventListener("click", () => void add(item, addButton, feedback, aspect.value, note.value));
  actions.append(aspect, addButton); detail.append(actions, note, feedback);
  if (item.preview === "image") {
   const pick = make("button", "Pick image region…"); pick.type = "button";
   pick.addEventListener("click", async () => {
    try {
     const result = await annotate(`api/designimage?id=${encodeURIComponent(item.id)}&revision=${encodeURIComponent(item.imageRevision ?? "")}&token=__TOKEN__`);
     if (!result) return;
     if (!result.state.crop) { feedback.textContent = "Use Crop in the image editor, then Save to select a region."; return; }
     const { a, b } = result.state.crop, region = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])].map(Math.round);
     await add(item, pick, feedback, "region", [note.value, legend(result.state.shapes)].filter(Boolean).join("\n"), region);
    } catch (error) { feedback.textContent = "Could not select region: " + error.message; }
   });
   actions.append(pick); detail.append(make("p", "Pick a region with Crop, then Save. A cropped thumbnail, original image and crop coordinates are attached; drawings are not. Marker notes are kept."));
  }
  if (item.preview === "image" && item.imageRevision) detail.append(image(item), make("p", "Static source image, not a generated preview. It does not demonstrate responsive behaviour or interactive controls."));
  else if (item.preview === "sample" && item.availability === "cached") sample(item);
  else detail.append(make("p", item.preview === "sample" ? "This source sample is not cached for viewing on this host yet. No download was started." : "No supplied visual sample. This entry is metadata only; nothing was generated."));
  if (item.url) { const link = make("a", "View original source"); link.href = item.url; link.target = "_blank"; link.rel = "noopener noreferrer"; detail.append(link); }
  tools.hidden = page.hidden = list.hidden = status.hidden = true; detail.hidden = false; root.scrollTop = 0; back.focus(); remember();
 }
 const draw = () => {
  const query = search.value.toLowerCase().trim(), matches = entries.filter(item => (!source.value || item.source === source.value) && (!kind.value || item.kind === kind.value) && (!query || [item.name, item.category, item.description, item.status].some(text => text?.toLowerCase().includes(query))));
  status.textContent = `${matches.length} ${matches.length === 1 ? "reference" : "references"}.${offline ? " " + offline : ""}`;
  const card = (item: CatalogEntry) => {
   const row = make("article"), title = make("h3", item.name), provenance = make("p", item.provenance), details = make("small", `${item.source} / ${item.kind} · ${item.revision.slice(0, 12)} · ${item.license}`), open = make("button", "Inspect " + item.name);
   row.dataset.entry = item.id; open.type = "button"; open.dataset.inspect = "";
   const addButton = make("button", "Add reference"), feedback = make("p"); addButton.type = "button"; addButton.dataset.add = ""; feedback.setAttribute("role", "status");
   const pick = () => void add(item, addButton, feedback, item.kind === "component" ? "component" : "whole");
   addButton.disabled = item.preview === "sample" && item.availability !== "cached";
   addButton.addEventListener("click", pick); open.addEventListener("click", event => { if (event.ctrlKey || event.metaKey) pick(); else inspect(item); });
   gestures(row, () => { if (!addButton.disabled) pick(); });
   if (item.preview === "image" && item.imageRevision) row.append(image(item, true));
   if (item.status) row.append(make("p", item.status));
   row.append(title, details, provenance, open, addButton, feedback); return row;
  };
  const groups = new Map<string, CatalogEntry[]>();
  for (const item of matches) { const group = item.availability === "cached" && item.designRevision ? item.designRevision : item.id; if (!groups.has(group)) groups.set(group, []); groups.get(group)!.push(item); }
  list.replaceChildren(...[...groups.values()].map(items => {
   if (items.length === 1) return card(items[0]);
   const group = make("section"), rows = make("div"); group.className = "library-group"; rows.className = "library-list";
   rows.append(...items.map(card)); group.append(make("h3", "Same authored files · separate source snapshots"), rows); return group;
  }));
  if (!matches.length) list.append(make("p", entries.length ? "No matches. Clear your search or filters." : "No cached references yet. Reopen the library when the host is online."));
  root.scrollTop = gridScroll;
 };
 const filter = () => { gridScroll = 0; draw(); remember(); };
 search.addEventListener("input", filter); source.addEventListener("change", filter); kind.addEventListener("change", filter);
 root.addEventListener("scroll", () => { if (detail.hidden) { gridScroll = root.scrollTop; remember(); } }, { passive: true });
 refresh.addEventListener("click", () => { cancelSample(); selected = ""; detail.replaceChildren(); detail.hidden = true; tools.hidden = page.hidden = list.hidden = status.hidden = false; loaded = undefined; void open(); remember(); });
 function open() {
  return loaded ??= (async () => {
   status.textContent = "Loading reference metadata…";
   try { const value = await get("designcatalog"); entries = value.entries; offline = [value.offline, ...(value.warnings ?? [])].filter(Boolean).join(" "); draw(); const item = entries.find(item => item.id === selected); if (item) inspect(item); }
   catch (error) { status.textContent = "Could not load the library. Refresh to retry: " + error.message; loaded = undefined; }
  })();
 }
 return { open };
}
