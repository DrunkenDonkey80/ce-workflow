// Design session preview (D17): files.ts stays the generic viewer and hands a design's page to designFrame.
// D4: one device picker (OD's viewport matrix plus Slide), rotate, the frame scaled down to fit, the choice kept per design.
// D7: a screen picker when the design has more than one HTML file.
// version: a kept version shown read-only (S09); none is the live design.
export type DesignView = { key: string; name: string; handle?: string; screens?: string[]; versions?: number[]; version?: number };
// screen: show another screen of this view; open: reopen the preview at a version (none = live); restore: ask the agent.
// mark: render what the preview shows and open it in the annotator (S13, D13).
export type MarkState = { screen: string; version?: number; width: number; height: number; hash?: string; styleEdits: { selector: string; styles: Record<string, string> }[] };
export type DesignActions = { screen: (screen: string) => void; open: (version: number | undefined, screen: string) => void; restore: (version: number) => void; mark: (state: MarkState) => void };

// Desktop is the panel's own width (no frame); the rest mirror extensions/design-render.ts (the page cannot import it).
const DEVICES: [string, number, number][] = [["Desktop", 0, 0], ["Phone small", 360, 800], ["Phone", 390, 844], ["Phone large", 430, 932], ["Foldable", 600, 960], ["Tablet", 820, 1180], ["Laptop", 1366, 768], ["Slide", 1920, 1080]];
type Device = { preset: string; rotated: boolean };
const storeKey = (view: DesignView) => "design-device:" + (view.handle ?? view.name);
function device(view: DesignView): Device {
 try { const saved = JSON.parse(localStorage.getItem(storeKey(view)) ?? "{}"); if (DEVICES.some(([name]) => name === saved.preset)) return { preset: saved.preset, rotated: !!saved.rotated }; } catch { /* unreadable: default */ }
 return { preset: "Desktop", rotated: false };
}

// S10/S12: the bridge in the page (hub/src/design-bridge.ts). Only the frame shown now, with its current load id, is
// heard. Each valid message goes out as a bubbling event from that frame: design-pick in Comment mode, design-inspect in
// Edit mode, design-tweaks from the page's Tweaks panel. The mode and the pins outlive reloads.
export type DesignPick = { screen: string; id: string; selector: string; tag: string; text: string; rect: { x: number; y: number; width: number; height: number } };
export type DesignPin = { n: number; screen: string; id: string; selector: string };
// hash and edits: the slide shown and the unsaved inline styles of this load, so Mark renders exactly that.
let current: { frame: HTMLIFrameElement; load: string; screen: string; hash: string; edits: Map<string, Record<string, string>> } | undefined, mode = "", pins: DesignPin[] = [];
const tell = (data: Record<string, unknown>) => { if (current?.frame.isConnected) current.frame.contentWindow?.postMessage({ load: current.load, ...data }, "*"); };
export function setDesignPins(list: DesignPin[]) { pins = list; tell({ pins }); }
/** How a chat line names an element (D2): its screen and data-id, or a short selector when it has none. */
export const elementName = (pick: DesignPick) => `${pick.screen} ${pick.id ? "@" + pick.id : pick.selector}`;
const line = (text: string) => document.dispatchEvent(new CustomEvent("design-line", { detail: text })); // app.ts adds it to the chat box
const STYLES = ["color", "background-color", "font-size", "font-weight", "padding", "margin", "gap", "border-radius"];
const bounded = (value: unknown, max: number, pattern?: RegExp) => typeof value === "string" && value.length <= max && (!pattern || pattern.test(value));
function readPick(data: any, screen: string): DesignPick | undefined {
 const rect = data?.rect;
 if (data?.screen !== screen || !bounded(data.id, 80, /^[\w-]*$/) || !bounded(data.selector, 300) || !(data.id || data.selector) || !bounded(data.tag, 32, /^[a-z][a-z0-9-]*$/) || !bounded(data.text, 160)) return undefined;
 if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return undefined;
 return { screen, id: data.id, selector: data.selector, tag: data.tag, text: data.text, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
}
const readStyles = (styles: any) => styles && typeof styles === "object" && STYLES.every(name => bounded(styles[name], 100)) ? Object.fromEntries(STYLES.map(name => [name, styles[name] as string])) : undefined;
function readTweaks(values: any) {
 const entries = values && typeof values === "object" && !Array.isArray(values) ? Object.entries(values) : [];
 const valid = entries.length > 0 && entries.length <= 20 && entries.every(([key, value]) => /^[\w-]{1,40}$/.test(key) && (bounded(value, 80) || typeof value === "boolean" || Number.isFinite(value)));
 return valid ? Object.fromEntries(entries) : undefined;
}
addEventListener("message", event => {
 if (!current?.frame.isConnected || event.source !== current.frame.contentWindow || event.data?.load !== current.load) return;
 const data = event.data, frame = current.frame, emit = (name: string, detail: unknown) => frame.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
 if (data.type === "design:hash") { if (bounded(data.hash, 41, /^(#[\w-]{0,40})?$/)) current.hash = data.hash; return; }
 if (data.type === "design:tweaks") { const values = readTweaks(data.values); if (values) emit("design-tweaks", values); return; }
 const pick = readPick(data, current.screen); if (!pick) return;
 if (data.type === "design:pick" && mode === "comment") emit("design-pick", pick);
 const styles = data.type === "design:inspect" && mode === "edit" && readStyles(data.styles);
 if (styles) emit("design-inspect", { ...pick, styles });
});
// D12: the inspector changes the element live; Keep adds a Set line with what changed, Cancel undoes the inline styles.
function inspect(body: HTMLElement, pick: DesignPick & { styles: Record<string, string> }) {
 body.querySelector(".design-inspector")?.remove();
 const form = Object.assign(document.createElement("form"), { className: "design-inspector" });
 form.setAttribute("aria-label", "Element styles");
 const title = Object.assign(document.createElement("div"), { className: "design-inspector-title", textContent: `<${pick.tag}>${pick.text ? ` "${pick.text.slice(0, 40)}"` : ""}` });
 const target = pick.id ? `[data-id="${pick.id}"]` : pick.selector;
 const inputs = STYLES.map(name => {
  const input = Object.assign(document.createElement("input"), { name, value: pick.styles[name], spellcheck: false });
  input.addEventListener("input", () => { tell({ style: { [name]: input.value } }); current?.edits.set(target, { ...current.edits.get(target), [name]: input.value }); });
  const row = document.createElement("label"); row.append(name, input); return row;
 });
 const keep = Object.assign(document.createElement("button"), { type: "submit", textContent: "Keep", title: "Add a Set line to your message for the agent to write" });
 const cancel = Object.assign(document.createElement("button"), { type: "button", textContent: "Cancel" });
 const changed = () => STYLES.map(name => [name, (form.elements.namedItem(name) as HTMLInputElement).value.replace(/\s+/g, " ").trim()]).filter(([name, value]) => value !== pick.styles[name]);
 cancel.addEventListener("click", () => {
  const undone = changed().map(([name]) => name), kept = { ...current?.edits.get(target) };
  for (const name of undone) delete kept[name];
  tell({ style: Object.fromEntries(undone.map(name => [name, ""])) }); current?.edits.set(target, kept); form.remove();
 });
 form.addEventListener("submit", event => {
  event.preventDefault(); const edits = changed();
  if (edits.length) line(`Set ${elementName(pick)}: ${edits.map(([name, value]) => `${name} ${value}`).join("; ")}`);
  form.remove();
 });
 const buttons = Object.assign(document.createElement("div"), { className: "design-inspector-buttons" }); buttons.append(keep, cancel);
 form.append(title, ...inputs, buttons); body.append(form);
}

/** The design's page in a device frame, with the device, rotate and screen controls added before Download and Open. */
export function designFrame(view: DesignView, path: string, src: string, body: HTMLElement, actions: HTMLElement, act: DesignActions) {
 const state = device(view);
 const frame = Object.assign(document.createElement("iframe"), { src, className: "files-frame", title: path });
 const stage = Object.assign(document.createElement("div"), { className: "design-stage" });
 stage.append(frame); body.replaceChildren(stage);
 const picker = Object.assign(document.createElement("select"), { className: "design-device", title: "Device" });
 picker.setAttribute("aria-label", "Device");
 for (const [name, width, height] of DEVICES) picker.append(new Option(width ? `${name} ${width}×${height}` : name, name));
 picker.value = state.preset;
 const rotate = Object.assign(document.createElement("button"), { type: "button", className: "design-rotate", textContent: "⟳", title: "Rotate (landscape)" });
 rotate.setAttribute("aria-label", "Rotate");
 // Comment and Edit are one mode at a time; pressing the active one turns it off.
 const modes = ([["comment", "Comment", "Click an element in the page to comment on it"], ["edit", "Edit", "Click an element to change its styles live"]] as const).map(([value, text, title]) => {
  const button = Object.assign(document.createElement("button"), { type: "button", className: "design-" + value, textContent: text, title });
  button.addEventListener("click", () => { mode = mode === value ? "" : value; sync(); tell({ mode }); if (mode !== "edit") body.querySelector(".design-inspector")?.remove(); });
  return button;
 });
 const sync = () => { for (const button of modes) button.setAttribute("aria-pressed", String(button.className === "design-" + mode)); };
 sync();
 const keepTweaks = Object.assign(document.createElement("button"), { type: "button", className: "design-keep-tweaks", textContent: "Keep tweaks", title: "Add the page's Tweaks values to your message", hidden: true });
 let tweaks: Record<string, unknown> = {};
 frame.addEventListener("design-tweaks", event => { tweaks = (event as CustomEvent).detail; keepTweaks.hidden = false; });
 keepTweaks.addEventListener("click", () => { line("Keep tweaks: " + Object.entries(tweaks).map(([key, value]) => `${key} ${value}`).join(", ")); keepTweaks.hidden = true; });
 frame.addEventListener("design-inspect", event => inspect(body, (event as CustomEvent).detail));
 frame.addEventListener("load", () => {
  current = { frame, load: crypto.randomUUID(), screen: path, hash: "", edits: new Map() };
  frame.contentWindow?.postMessage({ type: "design:hello", load: current.load, mode, pins }, "*");
 });
 const mark = Object.assign(document.createElement("button"), { type: "button", className: "design-mark", textContent: "Mark", title: "Draw on a picture of this screen at this size" });
 mark.addEventListener("click", () => {
  const [, presetWidth, presetHeight] = DEVICES.find(([name]) => name === state.preset)!, clamp = (value: number) => Math.min(4000, Math.max(200, Math.round(value)));
  const [width, height] = !presetWidth ? [frame.clientWidth, frame.clientHeight] : state.rotated ? [presetHeight, presetWidth] : [presetWidth, presetHeight];
  const live = current?.frame === frame ? current : undefined;
  act.mark({ screen: path, ...view.version ? { version: view.version } : {}, width: clamp(width), height: clamp(height), ...live?.hash ? { hash: live.hash } : {}, styleEdits: [...live?.edits ?? []].filter(([, styles]) => Object.keys(styles).length).map(([selector, styles]) => ({ selector, styles })) });
 });
 const controls: HTMLElement[] = [...modes, keepTweaks, mark, picker, rotate];
 if ((view.screens?.length ?? 0) > 1) {
  const screens = Object.assign(document.createElement("select"), { className: "design-screen", title: "Screen" });
  screens.setAttribute("aria-label", "Screen");
  for (const screen of view.screens!) screens.append(new Option(screen.replace(/\.html?$/i, ""), screen));
  screens.value = path;
  screens.addEventListener("change", () => act.screen(screens.value));
  controls.unshift(screens);
 }
 // S09, D19: ◂ steps back from live to the newest version and on; ▸ forward to live. Restore goes through the agent.
 const kept = view.versions ?? [];
 if (kept.length) {
  const at = view.version ? kept.indexOf(view.version) : kept.length;
  const step = (text: string, label: string, target: number | undefined, enabled: boolean) => {
   const button = Object.assign(document.createElement("button"), { type: "button", className: "design-step", textContent: text, title: label, disabled: !enabled });
   button.setAttribute("aria-label", label); button.addEventListener("click", () => act.open(target, path)); return button;
  };
  const label = Object.assign(document.createElement("span"), { className: "design-version", textContent: view.version ? `v${view.version} of ${kept.at(-1)}` : "Live" });
  controls.push(step("◂", "Older version", kept[at - 1], at > 0), label, step("▸", "Newer version", kept[at + 1], at < kept.length));
  if (view.version) {
   const restore = Object.assign(document.createElement("button"), { type: "button", className: "design-restore", textContent: "Restore", title: `Ask the agent to restore version ${view.version}` });
   restore.addEventListener("click", () => act.restore(view.version!));
   controls.push(restore);
  }
 }
 actions.prepend(...controls);
 const viewer = body.parentElement!;
 const fit = () => {
  if (!frame.isConnected) return observer.disconnect();
  const [, presetWidth, presetHeight] = DEVICES.find(([name]) => name === state.preset)!;
  rotate.disabled = !presetWidth; rotate.setAttribute("aria-pressed", String(state.rotated && !!presetWidth));
  stage.classList.toggle("device", !!presetWidth);
  if (!presetWidth) { frame.style.cssText = stage.style.cssText = ""; return; }
  const [width, height] = state.rotated ? [presetHeight, presetWidth] : [presetWidth, presetHeight];
  const room = Math.max(200, viewer.clientHeight - (body.offsetTop - viewer.offsetTop) - 16);
  const scale = Math.min(1, body.clientWidth / width, room / height);
  Object.assign(frame.style, { width: width + "px", height: height + "px", transform: `scale(${scale})` });
  Object.assign(stage.style, { width: Math.floor(width * scale) + "px", height: Math.floor(height * scale) + "px" });
 };
 const observer = new ResizeObserver(fit);
 observer.observe(viewer);
 const save = () => { try { localStorage.setItem(storeKey(view), JSON.stringify(state)); } catch { /* private mode: not kept */ } fit(); };
 picker.addEventListener("change", () => { state.preset = picker.value; save(); });
 rotate.addEventListener("click", () => { state.rotated = !state.rotated; save(); });
 fit();
}
