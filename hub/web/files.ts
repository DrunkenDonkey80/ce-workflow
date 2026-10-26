// Browser Files tab (R8, D10): read-only project tree beside (desktop) or above (phone) a content or diff viewer.
type ProjectFile = { path: string; change?: string; size?: number };
// An explored archive (hub/src/explore.ts): its files are served raw under /x/<key>/.
type Archive = { key: string; name: string; files: ProjectFile[]; truncated: boolean };
const IMAGE = /.(?:png|jpe?g|gif|webp|bmp|svg|ico)$/i, FRAME = /.(?:html?|pdf)$/i, MEDIA = /.(?:mp4|webm|mp3|wav)$/i, MARKDOWN = /.(?:md|markdown)$/i, TEXT_BYTES = 1_048_576;
const size = (bytes = 0) => bytes < 1024 ? bytes + " B" : bytes < 1_048_576 ? (bytes / 1024).toFixed(1) + " KB" : (bytes / 1_048_576).toFixed(1) + " MB";
type Folder = { folders: Map<string, Folder>; files: ProjectFile[]; changed: boolean };
const CHANGE_NAMES = { M: "modified", A: "added", D: "deleted", R: "renamed", C: "copied", "??": "untracked" };

export function createFilesView(root: HTMLElement, { get, image, markdown }: { get: (endpoint: string) => Promise<any>; image: (src: string) => void; markdown: (target: HTMLElement, text: string) => void }) {
 root.replaceChildren();
 const tree = Object.assign(document.createElement("nav"), { className: "files-tree" }), viewer = Object.assign(document.createElement("section"), { className: "files-viewer" });
 tree.setAttribute("aria-label", "Project files"); viewer.setAttribute("aria-label", "File content"); viewer.tabIndex = 0;
 const heading = Object.assign(document.createElement("h2"), { textContent: "Select a file" }), body = Object.assign(document.createElement("pre"), { className: "files-body" });
 viewer.append(heading, body); root.append(tree, viewer);
 // linked: a file opened from a chat link, kept even when the tree does not list it (absolute path).
 let selected = "", linked = "", loaded = false, version = 0, archive: Archive | null = null;
 const open = new Set<string>();

 function folder(files: ProjectFile[]) {
  const top: Folder = { folders: new Map(), files: [], changed: false };
  for (const file of files) {
   let at = top; const parts = file.path.split("/");
   for (const part of parts.slice(0, -1)) {
    if (file.change) at.changed = true;
    if (!at.folders.has(part)) at.folders.set(part, { folders: new Map(), files: [], changed: false });
    at = at.folders.get(part);
   }
   if (file.change) at.changed = true;
   at.files.push(file);
  }
  return top;
 }
 // Native <details>/<summary> folders give Enter/Space toggling; changed folders start open.
 function draw(at: Folder, prefix: string, into: HTMLElement) {
  for (const [name, child] of [...at.folders].sort(([a], [b]) => a.localeCompare(b))) {
   const path = prefix + name + "/", details = document.createElement("details"), summary = document.createElement("summary");
   summary.textContent = name; if (child.changed) summary.classList.add("changed");
   details.open = open.has(path) || (child.changed && !open.has("!" + path));
   details.addEventListener("toggle", () => { open.delete(details.open ? "!" + path : path); open.add(details.open ? path : "!" + path); });
   details.append(summary); draw(child, path, details); into.append(details);
  }
  for (const file of at.files) {
   const button = document.createElement("button"); button.type = "button"; button.className = "file"; button.dataset.path = file.path;
   button.textContent = file.path.slice(prefix.length);
   if (file.change) { const mark = Object.assign(document.createElement("span"), { className: "file-mark", textContent: file.change }); mark.title = CHANGE_NAMES[file.change[0] === "?" ? "??" : file.change[0]] ?? "changed"; button.append(" ", mark); button.dataset.change = file.change; }
   button.setAttribute("aria-current", String(file.path === selected));
   button.addEventListener("click", () => show(file));
   into.append(button);
  }
 }
 async function refresh() {
  const mine = ++version;
  try {
   const value = archive ?? await get("files");
   if (mine !== version) return;
   loaded = true; tree.replaceChildren();
   if (archive) {
    const close = Object.assign(document.createElement("button"), { type: "button", textContent: "Close" });
    close.addEventListener("click", () => { archive = null; selected = ""; heading.textContent = "Select a file"; body.replaceChildren(); void refresh(); });
    const bar = Object.assign(document.createElement("div"), { className: "files-archive", textContent: "📦 " + archive.name }); bar.append(close); tree.append(bar);
   }
   draw(folder(value.files), "", tree);
   if (!value.files.length) tree.append(Object.assign(document.createElement("p"), { className: "files-empty", textContent: archive ? "The archive is empty." : "No visible project files." }));
   if (value.truncated) tree.append(Object.assign(document.createElement("p"), { className: "files-empty", textContent: "Only the first 5000 files are shown." }));
   const current = value.files.find(file => file.path === selected);
   if (current && !archive) await show(current, true); else if (selected && selected !== linked) { selected = ""; heading.textContent = "Select a file"; body.replaceChildren(); }
  } catch (error) { if (mine === version) { tree.replaceChildren(Object.assign(document.createElement("p"), { className: "files-empty", textContent: "Files failed to load: " + error.message })); } }
 }
 async function show(file: ProjectFile, quiet = false) {
  selected = file.path;
  for (const button of tree.querySelectorAll<HTMLElement>(".file")) button.setAttribute("aria-current", String(button.dataset.path === selected));
  if (archive) return showExplored(archive, file);
  heading.textContent = file.path + (file.change ? " — " + (CHANGE_NAMES[file.change[0] === "?" ? "??" : file.change[0]] ?? "changed") : "");
  if (!quiet) body.replaceChildren("Loading…");
  try {
   const value = await get((file.change ? "diff" : "file") + "?path=" + encodeURIComponent(file.path));
   if (selected !== file.path) return;
   if (!value.diff) { body.className = "files-body"; body.replaceChildren(value.content || "(empty file)"); return; }
   // D10 diff fills: added #b2f2bb, removed #ffc9c9; text only, never markup.
   body.className = "files-body diff";
   body.replaceChildren(...value.diff.split("\n").map(line => {
    const span = Object.assign(document.createElement("span"), { textContent: line + "\n" });
    span.className = /^(\+\+\+|---) /.test(line) || /^(diff|index|new|deleted|similarity|rename) /.test(line) ? "meta" : line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "";
    return span;
   }));
  } catch (error) { if (selected === file.path) { body.className = "files-body"; body.replaceChildren("Not shown: " + error.message); } }
 }
 // Archive files: images (click zooms), HTML and PDF in a frame (sandboxed by the hub), markdown rendered, text as text,
 // anything else offered for download. Download and Open (new tab) for every file.
 async function showExplored(from: Archive, file: ProjectFile) {
  const url = `/x/${from.key}/${file.path.split("/").map(encodeURIComponent).join("/")}`;
  const link = (text: string, href: string, extra: Record<string, string>) => Object.assign(document.createElement("a"), { textContent: text, href, ...extra });
  const actions = Object.assign(document.createElement("span"), { className: "files-actions" });
  actions.append(link("Download", url + "?download=1", { download: file.path.split("/").pop()! }), link("Open", url, { target: "_blank", rel: "noopener" }));
  heading.replaceChildren(`${file.path} · ${size(file.size)}`, actions);
  body.className = "files-body rich";
  if (IMAGE.test(file.path)) { const img = Object.assign(document.createElement("img"), { src: url, alt: file.path, className: "files-image" }); img.addEventListener("click", () => image(url)); return body.replaceChildren(img); }
  if (FRAME.test(file.path)) return body.replaceChildren(Object.assign(document.createElement("iframe"), { src: url, className: "files-frame", title: file.path }));
  if (MEDIA.test(file.path)) return body.replaceChildren(Object.assign(document.createElement(/.mp[34]$|.wav$/i.test(file.path) && !/.mp4$/i.test(file.path) ? "audio" : "video"), { src: url, controls: true, className: "files-image" }));
  if ((file.size ?? 0) > TEXT_BYTES) return body.replaceChildren(`Too large to show here (${size(file.size)}); use Download.`);
  body.replaceChildren("Loading…");
  try {
   const response = await fetch(url); if (!response.ok) throw new Error(await response.text());
   const text = await response.text(); if (selected !== file.path || archive !== from) return;
   if (text.includes(" ")) return body.replaceChildren("Binary file; use Download.");
   body.replaceChildren();
   if (MARKDOWN.test(file.path)) markdown(body, text); else { body.className = "files-body"; body.textContent = text || "(empty file)"; }
  } catch (error) { if (selected === file.path) body.replaceChildren("Not shown: " + error.message); }
 }
 return {
  /** Shows an explored archive's files instead of the project's until Close. */
  explore(value: Archive) { archive = value; selected = ""; heading.textContent = "Select a file"; body.replaceChildren(); void refresh(); },
  /** First show loads; later file changes refresh only while visible, otherwise on next show. */
  shown() { if (!loaded) void refresh(); },
  open(path: string) { linked = path; void show({ path }); },
  changed(visible: boolean) { if (archive) return; if (visible) void refresh(); else loaded = false; },
 };
}
