// Browser Files tab (R8, D10): read-only project tree beside (desktop) or above (phone) a content or diff viewer.
type ProjectFile = { path: string; change?: string };
type Folder = { folders: Map<string, Folder>; files: ProjectFile[]; changed: boolean };
const CHANGE_NAMES = { M: "modified", A: "added", D: "deleted", R: "renamed", C: "copied", "??": "untracked" };

export function createFilesView(root: HTMLElement, { get }: { get: (endpoint: string) => Promise<any> }) {
 root.replaceChildren();
 const tree = Object.assign(document.createElement("nav"), { className: "files-tree" }), viewer = Object.assign(document.createElement("section"), { className: "files-viewer" });
 tree.setAttribute("aria-label", "Project files"); viewer.setAttribute("aria-label", "File content"); viewer.tabIndex = 0;
 const heading = Object.assign(document.createElement("h2"), { textContent: "Select a file" }), body = Object.assign(document.createElement("pre"), { className: "files-body" });
 viewer.append(heading, body); root.append(tree, viewer);
 let selected = "", loaded = false, version = 0;
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
   const value = await get("files");
   if (mine !== version) return;
   loaded = true; tree.replaceChildren(); draw(folder(value.files), "", tree);
   if (!value.files.length) tree.append(Object.assign(document.createElement("p"), { className: "files-empty", textContent: "No visible project files." }));
   if (value.truncated) tree.append(Object.assign(document.createElement("p"), { className: "files-empty", textContent: "Only the first 5000 files are shown." }));
   const current = value.files.find(file => file.path === selected);
   if (current) await show(current, true); else if (selected) { selected = ""; heading.textContent = "Select a file"; body.replaceChildren(); }
  } catch (error) { if (mine === version) { tree.replaceChildren(Object.assign(document.createElement("p"), { className: "files-empty", textContent: "Files failed to load: " + error.message })); } }
 }
 async function show(file: ProjectFile, quiet = false) {
  selected = file.path;
  for (const button of tree.querySelectorAll<HTMLElement>(".file")) button.setAttribute("aria-current", String(button.dataset.path === selected));
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
 return {
  /** First show loads; later file changes refresh only while visible, otherwise on next show. */
  shown() { if (!loaded) void refresh(); },
  changed(visible: boolean) { if (visible) void refresh(); else loaded = false; },
 };
}
