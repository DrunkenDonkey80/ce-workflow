// Library browsing is local UI; it never sends a model prompt.
import type { CatalogEntry } from "../../extensions/design-catalog.ts";
import type { DesignReference } from "../../extensions/design-references.ts";
// @ts-ignore Browser URL includes the workspace token.
import { annotate, legend } from "./annotate.js?token=__TOKEN__";

export function createDesignLibrary(root: HTMLElement, { get, post, back: leave, attached }: { get: (endpoint: string) => Promise<any>; post: (endpoint: string, data: Record<string, unknown>) => Promise<any>; back: () => void; attached: (ref: DesignReference) => void }) {
 const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; return item; };
 const heading = make("h2", "Design library"), purpose = make("p", "Browse references before asking for a design. Choosing inspiration does not install or select a project foundation."), head = make("div"), leaveButton = make("button", "Back to workspace"), refresh = make("button", "Refresh sources");
 leaveButton.type = refresh.type = "button"; leaveButton.addEventListener("click", leave); head.className = "library-heading"; head.append(leaveButton, heading, refresh);
 const tools = make("div"), tabs = make("div"), search = make("input"), status = make("p"), list = make("div"), detail = make("section");
 search.type = "search"; search.maxLength = 200; search.setAttribute("aria-label", "Search design library"); status.setAttribute("role", "status");
 // R1: one tab per kind of reference; the search box filters within the tab.
 const kinds = [["designs", "Designs"], ["themes", "Themes"], ["components", "Components"], ["image", "Image search"]] as const;
 type Tab = typeof kinds[number][0];
 const tabOf = (item: CatalogEntry): Tab => item.kind === "theme" ? "themes" : item.kind === "component" ? "components" : item.source === "web" ? "image" : "designs";
 let tab: Tab = "designs";
 // Each tab keeps its own search text: a Google query must not filter Themes down to nothing.
 const queries: Partial<Record<Tab, string>> = {};
 tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Reference type"); tabs.className = "library-tabs"; list.id = "library-results";
 const tabButtons = kinds.map(([value, label]) => { const button = make("button", label); button.type = "button"; button.setAttribute("role", "tab"); button.dataset.tab = value; button.setAttribute("aria-controls", list.id); button.addEventListener("click", () => { queries[tab] = search.value; tab = value; search.value = queries[tab] ?? ""; filter(); }); return button; });
 tabs.addEventListener("keydown", event => {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key]; if (!step) return;
  const next = tabButtons[(kinds.findIndex(([value]) => value === tab) + step + kinds.length) % kinds.length]; event.preventDefault(); next.click(); next.focus();
 });
 tabs.append(...tabButtons);
 // Favorites are kept in this browser for every session; the star beside the tabs shows only them.
 const favoriteKey = "design-library:favorites", favorites = new Set<string>(), starFilter = make("button", "★"), bar = make("div");
 try { for (const id of JSON.parse(localStorage.getItem(favoriteKey) ?? "[]")) if (typeof id === "string") favorites.add(id); } catch { /* private mode: stars last for this page */ }
 let favoritesOnly = false;
 starFilter.type = "button"; starFilter.className = "library-star"; starFilter.title = "Show favorites only"; starFilter.setAttribute("aria-label", "Show favorites only");
 starFilter.addEventListener("click", () => { favoritesOnly = !favoritesOnly; filter(); });
 bar.className = "library-tabbar"; bar.append(tabs, starFilter);
 tools.className = "library-row"; list.className = "library-list"; list.setAttribute("role", "tabpanel"); detail.className = "library-detail"; detail.hidden = true;
 // V-05: in the Image search tab, Enter or Search runs the session's image_search; elsewhere the box only filters.
 const searchButton = make("button", "Search"), results = make("div");
 searchButton.type = "button"; results.className = "library-list library-results"; results.setAttribute("aria-label", "Image search results");
 tools.append(search, searchButton);
 type Found = { n: number; title: string; site: string; page: string; width: number; height: number; original: boolean; thumb: string };
 let found: { set: string; query: string; results: Found[] } | undefined, searching = false;
 async function webSearch() {
  const query = search.value.trim(); if (tab !== "image" || !query || searching) return;
  searching = searchButton.disabled = true; status.textContent = "Searching Google Images in your browser… approve google.com when asked.";
  try { found = { query, ...await post("designsearch", { query }) }; draw(); remember(); status.textContent = `${found!.results.length} results for "${query}".` + (found!.results.length && !found!.results.some(item => item.thumb) ? " No thumbnails came back: reload the Pi browser fetch extension in your browser (extensions page, Reload); thumbnails need version 1.8." : ""); }
  catch (error) { status.textContent = "Image search failed: " + error.message; }
  finally { searching = searchButton.disabled = false; }
 }
 searchButton.addEventListener("click", () => void webSearch());
 search.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void webSearch(); } });
 // Card corner: the icon buttons that used to be a row of text buttons.
 function cornerButton(text: string, label: string, title: string) { const button = make("button", text); button.type = "button"; button.title = title; button.setAttribute("aria-label", label); return button; }
 function result(item: Found, set: string) {
  const tile = make("article"), title = make("h3"), open = make("button", item.title || "(no title)"), feedback = make("p"), actions = make("div");
  const keep = cornerButton("+", `Add ${item.title || "result " + item.n} as a reference`, "Add reference"); keep.dataset.pick = "";
  tile.dataset.result = String(item.n); open.type = "button"; open.dataset.open = ""; open.className = "library-open"; open.title = "Open the original"; title.append(open); feedback.setAttribute("role", "status");
  actions.className = "library-card-actions"; actions.append(keep); tile.append(actions);
  if (item.thumb) { const img = make("img"); img.src = item.thumb; img.alt = item.title || "Search result " + item.n; img.className = "library-result-thumb"; tile.append(img); }
  tile.append(title, make("small", [item.site, item.width ? `${item.width}×${item.height}` : ""].filter(Boolean).join(" · ")));
  open.disabled = keep.disabled = !item.original;
  open.addEventListener("click", () => void showResult(item, set, open, feedback));
  keep.addEventListener("click", () => void pickResult(item, set, keep, feedback));
  gestures(tile, () => { if (!keep.disabled) void pickResult(item, set, keep, feedback); }, () => { if (!open.disabled) void showResult(item, set, open, feedback); });
  tile.append(feedback); return tile;
 }
 // V-06: the original becomes a saved pick (outlives later searches), then attaches like any other card.
 async function pickResult(item: Found, set: string, button: HTMLButtonElement, feedback: HTMLElement) {
  button.disabled = true; feedback.textContent = "Saving the original as a pick…";
  try {
   const { id } = await post("designpick", { set, n: item.n });
   loaded = undefined; await open();
   const entry = entries.find(candidate => candidate.id === id);
   if (!entry) throw new Error("the saved pick is not listed");
   const ref = await post("designreference", { action: "add", id: entry.id, revision: entry.revision, aspect: "whole" });
   attached(ref); status.textContent = `Selected @${ref.ref} (${entry.name}). Describe how to use it in Chat.`;
  } catch (error) { feedback.textContent = "Could not add result: " + error.message; status.textContent = feedback.textContent; }
  finally { button.disabled = !item.original; }
 }
 async function showResult(item: Found, set: string, button: HTMLButtonElement, feedback: HTMLElement) {
  button.disabled = true; feedback.textContent = "Downloading the original…";
  try {
   const got = await post("designoriginal", { set, n: item.n });
   cancelSample(); gridScroll = root.scrollTop;
   const back = make("button", "Back to results"), img = make("img"); back.type = "button"; img.src = got.image; img.alt = item.title || "Search result " + item.n; img.className = "library-image";
   back.addEventListener("click", () => { detail.replaceChildren(); detail.hidden = true; bar.hidden = tools.hidden = page.hidden = list.hidden = status.hidden = false; results.hidden = tab !== "image"; root.scrollTop = gridScroll; button.focus({ preventScroll: true }); });
   detail.replaceChildren(back, make("h3", item.title || "Search result " + item.n), img);
   if (item.page) { const link = make("a", "Open source page"); link.href = item.page; link.target = "_blank"; link.rel = "noopener noreferrer"; detail.append(link); }
   bar.hidden = tools.hidden = page.hidden = list.hidden = status.hidden = results.hidden = true; detail.hidden = false; root.scrollTop = 0; back.focus(); feedback.textContent = "";
  } catch (error) { feedback.textContent = "Could not open the original: " + error.message; }
  finally { button.disabled = !item.original; }
 }
 // D12: a page is captured by this session's browser_fetch, after your per-site approval; nothing loads in this page.
 const page = make("form"), address = make("input"), pageAspect = make("select"), pageAdd = make("button", "Add page reference"), pageStatus = make("p");
 address.type = "url"; address.required = true; address.maxLength = 236; address.placeholder = "https://… a page to borrow from"; address.setAttribute("aria-label", "Page address");
 pageAspect.setAttribute("aria-label", "Page reference aspect"); pageStatus.setAttribute("role", "status"); page.className = "library-row"; pageAdd.type = "submit";
 for (const [value, label] of [["whole", "Whole style"], ["colors", "Colors"], ["typography", "Typography"], ["layout", "Layout"], ["background", "Background"], ["component", "Component"]]) { const option = make("option", label); option.value = value; pageAspect.append(option); }
 async function capture(url: string, aspect: string, button: HTMLButtonElement, feedback: HTMLElement) {
  button.disabled = true; feedback.textContent = "Approve the site when asked; your browser takes a screenshot…";
  try { const ref = await post("designreference", { action: "add", url, aspect }); attached(ref); feedback.textContent = `Selected @${ref.ref}. Describe how to use it in Chat.`; return true; }
  catch (error) { feedback.textContent = "Could not add page: " + error.message; return false; }
  finally { button.disabled = false; }
 }
 page.addEventListener("submit", async event => { event.preventDefault(); if (await capture(address.value, pageAspect.value, pageAdd, pageStatus)) address.value = ""; });
 page.append(address, pageAspect, pageAdd, pageStatus);
 root.append(head, purpose, bar, tools, page, status, results, list, detail);
 let entries: CatalogEntry[] = [], offline = "", loaded: Promise<void> | undefined, selected = "", gridScroll = 0, viewport = "", inspection = 0, viewed: string | undefined, abandoned: string | undefined;
 const key = "design-library:" + location.pathname;
 try {
  const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
  if (kinds.some(([value]) => value === saved?.tab)) tab = saved.tab;
  for (const [value] of kinds) if (typeof saved?.queries?.[value] === "string") queries[value] = saved.queries[value].slice(0, 200);
  search.value = queries[tab] ?? "";
  const results = JSON.parse(sessionStorage.getItem(key + ":found") ?? "null");
  if (typeof results?.set === "string" && typeof results.query === "string" && Array.isArray(results.results)) found = results;
  if (typeof saved?.selected === "string") selected = saved.selected;
  if (typeof saved?.favoritesOnly === "boolean") favoritesOnly = saved.favoritesOnly;
  if (typeof saved?.previewKey === "string" && /^[a-f0-9]{32}$/.test(saved.previewKey)) abandoned = saved.previewKey;
  if (["", "390", "768", "1280"].includes(saved?.viewport)) viewport = saved.viewport;
  if (Number.isFinite(saved?.scroll) && saved.scroll >= 0) gridScroll = saved.scroll;
 } catch { /* private mode: browsing still works without persistence */ }
 const remember = () => { try { queries[tab] = search.value; sessionStorage.setItem(key, JSON.stringify({ queries, tab, favoritesOnly, selected, scroll: gridScroll, viewport, previewKey: viewed })); if (found) sessionStorage.setItem(key + ":found", JSON.stringify(found)); } catch { /* private mode or full: results stay in memory */ } };
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
 // V-04: a card shows a screenshot of its page (the hub renders it once and keeps it on disk), never a live page;
 // the live page opens only in the card's detail. It loads when the card nears the view and then stays.
 const cardItems = new WeakMap<HTMLElement, CatalogEntry>(), waiting: (() => void)[] = [];
 let downloads = 0;
 const seen = new IntersectionObserver(changes => { for (const change of changes) if (change.isIntersecting) { seen.unobserve(change.target); void preview(change.target as HTMLElement); } }, { root, rootMargin: "200px 0px" });
 async function fetched(item: CatalogEntry) {
  if (downloads >= 3) await new Promise<void>(go => waiting.push(go));
  downloads++;
  try { const value = await post("designfetch", { id: item.id }); if (value.entry) Object.assign(item, value.entry); return item.availability === "cached"; }
  finally { downloads--; waiting.shift()?.(); }
 }
 async function preview(wrap: HTMLElement, attempt = 0) {
  wrap.setAttribute("aria-busy", "true");
  const item = cardItems.get(wrap)!;
  const failed = (message: string) => {
   wrap.setAttribute("aria-busy", "false");
   const retry = make("button", "Retry preview"); retry.type = "button"; retry.addEventListener("click", () => void preview(wrap, attempt + 1));
   wrap.replaceChildren(make("p", "Preview unavailable: " + message), retry);
  };
  try {
   if (item.source === "od" && item.availability !== "cached") {
    const cached = await fetched(item);
    const add = wrap.closest("article")?.querySelector<HTMLButtonElement>("[data-add]"); if (add) add.disabled = !cached;
    if (!cached) throw new Error("this package has no preview page");
   }
   const shot = make("img"); shot.alt = item.name + " preview"; shot.decoding = "async";
   shot.addEventListener("load", () => wrap.setAttribute("aria-busy", "false"), { once: true });
   shot.addEventListener("error", () => failed("the page could not be pictured"), { once: true });
   shot.src = `api/designthumb?id=${encodeURIComponent(item.id)}&revision=${encodeURIComponent(item.revision)}${attempt ? "&retry=" + attempt : ""}&token=__TOKEN__`;
   wrap.replaceChildren(shot);
  } catch (error) { failed(error.message); }
 }
 function cardPreview(item: CatalogEntry) {
  const wrap = make("div"); wrap.className = "library-card-preview"; cardItems.set(wrap, item); seen.observe(wrap); return wrap;
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
 // A plain click on the card opens it (the picture leads); Ctrl-click, right-click and a touch hold add it.
 function gestures(node: HTMLElement, pick: () => void, open: () => void) {
  const safe = (event: Event) => !(event.target as HTMLElement).closest("button, a, input, textarea, select, iframe") && getSelection()?.isCollapsed !== false;
  let held = false;
  node.addEventListener("click", event => {
   if (held) { held = false; return; } // the hold already picked it
   if (!safe(event)) return;
   if (event.ctrlKey || event.metaKey) { event.preventDefault(); pick(); } else if (event.button === 0) open();
  });
  node.addEventListener("contextmenu", event => { if (safe(event)) { event.preventDefault(); pick(); } });
  let timer: ReturnType<typeof setTimeout>, x = 0, y = 0;
  const cancel = () => clearTimeout(timer);
  node.addEventListener("pointerdown", event => {
   cancel(); if (event.pointerType !== "touch" || !event.isPrimary || !safe(event)) return;
   x = event.clientX; y = event.clientY;
   held = false; timer = setTimeout(() => { if (node.isConnected && !node.closest("[hidden]") && getSelection()?.isCollapsed !== false) { held = true; pick(); } }, 650);
  });
  node.addEventListener("pointermove", event => { if (Math.hypot(event.clientX - x, event.clientY - y) > 8) cancel(); }, { passive: true });
  for (const event of ["pointerup", "pointercancel", "pointerleave"]) node.addEventListener(event, cancel, { passive: true });
 }
 function inspect(item: CatalogEntry) {
  cancelSample(); gridScroll = detail.hidden ? root.scrollTop : gridScroll; selected = item.id;
  const back = make("button", "Back to library"), title = make("h3", item.name), provenance = make("p", item.provenance);
  back.type = "button";
  back.addEventListener("click", () => {
   cancelSample(); detail.replaceChildren(); detail.hidden = true; bar.hidden = tools.hidden = page.hidden = list.hidden = status.hidden = false; results.hidden = tab !== "image"; selected = ""; remember();
   list.querySelector<HTMLButtonElement>(`[data-entry="${CSS.escape(item.id)}"] [data-inspect]`)?.focus({ preventScroll: true }); root.scrollTop = gridScroll;
  });
  detail.replaceChildren(back, title, provenance, make("p", `${item.license}; catalog revision ${item.revision}`));
  if (item.description) detail.append(make("p", item.description));
  const actions = make("div"), aspect = make("select"), note = make("textarea"), addButton = make("button", "Add reference"), feedback = make("p");
  aspect.setAttribute("aria-label", "Reference aspect");
  for (const [value, label] of [["whole", "Whole style"], ["colors", "Colors"], ["typography", "Typography"], ["layout", "Layout"], ["background", "Background"], ["component", "Component"]]) { const option = make("option", label); option.value = value; aspect.append(option); }
  if (item.kind === "component") aspect.value = "component";
  note.maxLength = 4000; note.rows = 2; note.placeholder = "What should we borrow? (optional)"; note.setAttribute("aria-label", "Reference note");
  addButton.type = "button"; addButton.dataset.add = ""; feedback.setAttribute("role", "status"); actions.className = "library-tools";
  addButton.disabled = item.preview === "sample" || item.source === "od";
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
  // The picture leads: you pick by look, then read the details.
  if (item.preview === "image" && item.imageRevision) actions.before(image(item), make("p", item.kind === "component" ? "Rendered from its pinned example in the neutral theme. A still picture: it does not demonstrate responsive behaviour or interactive controls." : "Static source image, not a generated preview. It does not demonstrate responsive behaviour or interactive controls."));
  else if (item.preview === "sample" && item.availability === "cached") sample(item);
  else detail.append(make("p", item.preview === "sample" ? "This source sample is not cached for viewing on this host yet. No download was started." : "No supplied visual sample. This entry is metadata only; nothing was generated."));
  if (item.kind === "component") void docs(item);
  if (item.url) { const link = make("a", "View original source"); link.href = item.url; link.target = "_blank"; link.rel = "noopener noreferrer"; detail.append(link); }
  bar.hidden = tools.hidden = page.hidden = list.hidden = status.hidden = results.hidden = true; detail.hidden = false; root.scrollTop = 0; back.focus(); remember();
 }
 // V-10: usage and props ship with the hub, so Inspect needs no runtime install.
 async function docs(item: CatalogEntry) {
  const request = inspection, box = make("section"); box.className = "library-docs"; box.append(make("p", "Loading usage and props…")); detail.append(box);
  try {
   const value: { description?: string; practices?: { do: boolean; text: string }[]; props: { name: string; type?: string; default?: string; required?: boolean; description?: string }[] } = await get(`designdocs?id=${encodeURIComponent(item.id)}`);
   if (request !== inspection) return;
   const parts: HTMLElement[] = [make("h4", "Usage")];
   if (value.description) parts.push(make("p", value.description));
   if (value.practices?.length) { const practices = make("ul"); practices.append(...value.practices.map(item => make("li", `${item.do ? "Do" : "Don't"}: ${item.text}`))); parts.push(practices); }
   parts.push(make("h4", "Props"));
   if (value.props.length) {
    const table = make("table"), head = make("tr"); head.append(...["Prop", "Type", "Default", "Description"].map(text => make("th", text))); table.append(head);
    for (const prop of value.props) { const row = make("tr"), name = make("td"), code = make("code", prop.name + (prop.required ? " *" : "")); name.append(code); row.append(name, make("td", prop.type ?? ""), make("td", prop.default ?? ""), make("td", prop.description ?? "")); table.append(row); }
    parts.push(table, make("small", "* required"));
   } else parts.push(make("p", "No documented props."));
   box.replaceChildren(...parts);
  } catch (error) { if (request === inspection) box.replaceChildren(make("p", "Usage and props unavailable: " + error.message)); }
 }
 const draw = () => {
  for (const button of tabButtons) { const on = button.dataset.tab === tab; button.setAttribute("aria-selected", String(on)); button.tabIndex = on ? 0 : -1; }
  starFilter.setAttribute("aria-pressed", String(favoritesOnly));
  const imaging = tab === "image";
  search.placeholder = imaging ? "Search Google Images, then press Enter" : `Search ${kinds.find(([value]) => value === tab)![1].toLowerCase()}`;
  searchButton.hidden = results.hidden = !imaging; tools.classList.toggle("searching", imaging);
  results.replaceChildren(...imaging && found ? [make("h3", `Results for "${found.query}"`), ...found.results.map(item => result(item, found!.set))] : []);
  const query = imaging ? "" : search.value.toLowerCase().trim(), matches = entries.filter(item => tabOf(item) === tab && (!favoritesOnly || favorites.has(item.id)) && (!query || [item.name, item.category, item.description, item.status].some(text => text?.toLowerCase().includes(query))));
  status.textContent = `${matches.length} ${matches.length === 1 ? "reference" : "references"}.${offline ? " " + offline : ""}`;
  const card = (item: CatalogEntry) => {
   const row = make("article"), title = make("h3"), provenance = make("p", item.provenance), details = make("small", `${item.source} / ${item.kind} · ${item.revision.slice(0, 12)} · ${item.license}`), open = make("button", item.name);
   row.dataset.entry = item.id; open.type = "button"; open.dataset.inspect = ""; open.className = "library-open"; open.title = "Inspect " + item.name; title.append(open);
   const addButton = cornerButton("+", `Add ${item.name} as a reference`, "Add reference"), star = cornerButton("", "Favorite " + item.name, ""), actions = make("div"), feedback = make("p"); addButton.dataset.add = ""; star.dataset.star = ""; feedback.setAttribute("role", "status");
   const starred = () => { const on = favorites.has(item.id); star.textContent = on ? "★" : "☆"; star.title = on ? "Remove from favorites" : "Add to favorites"; star.setAttribute("aria-pressed", String(on)); };
   star.addEventListener("click", () => { if (!favorites.delete(item.id)) favorites.add(item.id); try { localStorage.setItem(favoriteKey, JSON.stringify([...favorites])); } catch { /* private mode */ } starred(); });
   starred(); actions.className = "library-card-actions"; actions.append(addButton, star); row.append(actions);
   const pick = () => void add(item, addButton, feedback, item.kind === "component" ? "component" : "whole");
   addButton.disabled = (item.preview === "sample" || item.source === "od") && item.availability !== "cached"; // OpenDesign is added only as its cached page
   addButton.addEventListener("click", pick); open.addEventListener("click", event => { if (event.ctrlKey || event.metaKey) pick(); else inspect(item); });
   gestures(row, () => { if (!addButton.disabled) pick(); }, () => inspect(item));
   if (item.preview === "image" && item.imageRevision) { const thumb = image(item, true); if (item.kind === "component") thumb.classList.add("library-thumb-whole"); row.append(thumb); }
   if (item.colors) { const swatches = make("ul"); swatches.className = "library-swatches"; swatches.setAttribute("aria-label", item.name + " colors"); for (const [name, hex] of Object.entries(item.colors)) { const swatch = make("li", name); swatch.style.setProperty("--swatch", hex); swatch.title = `${name} ${hex}`; swatches.append(swatch); } row.append(swatches); }
   if (item.preview === "sample" && (item.availability === "cached" || item.source === "od")) row.append(cardPreview(item));
   if (item.status) row.append(make("p", item.status));
   row.append(title, details, provenance);
   if (item.description) row.append(make("p", item.description));
   const url = item.source === "web" ? item.url : undefined;
   if (url) { const page = make("button", "Capture page"); page.type = "button"; page.dataset.capture = ""; page.title = url; page.addEventListener("click", () => void capture(url, "whole", page, feedback)); row.append(page); }
   row.append(feedback); return row;
  };
  seen.disconnect();
  const groups = new Map<string, CatalogEntry[]>();
  for (const item of matches) { const group = item.availability === "cached" && item.designRevision ? item.designRevision : item.id; if (!groups.has(group)) groups.set(group, []); groups.get(group)!.push(item); }
  list.replaceChildren(...[...groups.values()].map(items => {
   if (items.length === 1) return card(items[0]);
   const group = make("section"), rows = make("div"); group.className = "library-group"; rows.className = "library-list";
   rows.append(...items.map(card)); group.append(make("h3", "Same authored files · separate source snapshots"), rows); return group;
  }));
  if (imaging) list.prepend(make("h3", "Saved picks"));
  if (!matches.length) list.append(make("p", favoritesOnly ? "No favorites in this tab yet. Star a card, or press ★ again to show everything." : imaging ? "No saved picks yet. Search, then add a result." : entries.length ? "No matches. Clear your search or filters." : "No cached references yet. Reopen the library when the host is online."));
  root.scrollTop = gridScroll;
 };
 const filter = () => { gridScroll = 0; draw(); remember(); };
 search.addEventListener("input", () => { if (tab !== "image") filter(); else remember(); });
 root.addEventListener("scroll", () => { if (detail.hidden) { gridScroll = root.scrollTop; remember(); } }, { passive: true });
 refresh.addEventListener("click", () => { cancelSample(); selected = ""; detail.replaceChildren(); detail.hidden = true; bar.hidden = tools.hidden = page.hidden = list.hidden = status.hidden = false; results.hidden = tab !== "image"; loaded = undefined; void open(); remember(); });
 function open() {
  return loaded ??= (async () => {
   status.textContent = "Loading reference metadata…";
   try { const value = await get("designcatalog"); entries = value.entries; offline = [value.offline, ...(value.warnings ?? [])].filter(Boolean).join(" "); draw(); const item = entries.find(item => item.id === selected); if (item) inspect(item); void post("designwarm", {}).catch(() => {}); }
   catch (error) { status.textContent = "Could not load the library. Refresh to retry: " + error.message; loaded = undefined; }
  })();
 }
 // The mouse Back button (app.ts) leaves an open card or search result, like its Back button.
 return { open, inside: () => !detail.hidden, back: () => detail.querySelector<HTMLButtonElement>("button")?.click() };
}
