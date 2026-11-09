// Design session preview (D17): files.ts stays the generic viewer and hands a design's page to designFrame.
// D4: one device picker (OD's viewport matrix plus Slide), rotate, the frame scaled down to fit, the choice kept per design.
// D7: a screen picker when the design has more than one HTML file.
// version: a kept version shown read-only (S09); none is the live design.
export type DesignView = { key: string; name: string; handle?: string; screens?: string[]; versions?: number[]; version?: number };
// screen: show another screen of this view; open: reopen the preview at a version (none = live); restore: ask the agent.
export type DesignActions = { screen: (screen: string) => void; open: (version: number | undefined, screen: string) => void; restore: (version: number) => void };

// Desktop is the panel's own width (no frame); the rest mirror extensions/design-render.ts (the page cannot import it).
const DEVICES: [string, number, number][] = [["Desktop", 0, 0], ["Phone small", 360, 800], ["Phone", 390, 844], ["Phone large", 430, 932], ["Foldable", 600, 960], ["Tablet", 820, 1180], ["Laptop", 1366, 768], ["Slide", 1920, 1080]];
type Device = { preset: string; rotated: boolean };
const storeKey = (view: DesignView) => "design-device:" + (view.handle ?? view.name);
function device(view: DesignView): Device {
 try { const saved = JSON.parse(localStorage.getItem(storeKey(view)) ?? "{}"); if (DEVICES.some(([name]) => name === saved.preset)) return { preset: saved.preset, rotated: !!saved.rotated }; } catch { /* unreadable: default */ }
 return { preset: "Desktop", rotated: false };
}

// S10: the bridge in the page (hub/src/design-bridge.ts). Only the frame shown now, with its current load id, is heard;
// a valid pick goes out as a bubbling "design-pick" event from that frame. Comment mode and the pins outlive reloads.
export type DesignPick = { screen: string; id: string; selector: string; tag: string; text: string; rect: { x: number; y: number; width: number; height: number } };
export type DesignPin = { n: number; screen: string; id: string; selector: string };
let current: { frame: HTMLIFrameElement; load: string; screen: string } | undefined, commenting = false, pins: DesignPin[] = [];
const tell = (data: Record<string, unknown>) => { if (current?.frame.isConnected) current.frame.contentWindow?.postMessage({ load: current.load, ...data }, "*"); };
export function setDesignPins(list: DesignPin[]) { pins = list; tell({ pins }); }
const bounded = (value: unknown, max: number, pattern?: RegExp) => typeof value === "string" && value.length <= max && (!pattern || pattern.test(value));
function readPick(data: any, screen: string): DesignPick | undefined {
 const rect = data?.rect;
 if (data?.screen !== screen || !bounded(data.id, 80, /^[\w-]*$/) || !bounded(data.selector, 300) || !(data.id || data.selector) || !bounded(data.tag, 32, /^[a-z][a-z0-9-]*$/) || !bounded(data.text, 160)) return undefined;
 if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return undefined;
 return { screen, id: data.id, selector: data.selector, tag: data.tag, text: data.text, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
}
addEventListener("message", event => {
 if (!current?.frame.isConnected || event.source !== current.frame.contentWindow || event.data?.load !== current.load || event.data.type !== "design:pick") return;
 const pick = readPick(event.data, current.screen);
 if (pick) current.frame.dispatchEvent(new CustomEvent("design-pick", { bubbles: true, detail: pick }));
});

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
 const comment = Object.assign(document.createElement("button"), { type: "button", className: "design-comment", textContent: "Comment", title: "Click an element in the page to comment on it" });
 comment.setAttribute("aria-pressed", String(commenting));
 comment.addEventListener("click", () => { commenting = !commenting; comment.setAttribute("aria-pressed", String(commenting)); tell({ mode: commenting ? "comment" : "" }); });
 frame.addEventListener("load", () => {
  current = { frame, load: crypto.randomUUID(), screen: path };
  frame.contentWindow?.postMessage({ type: "design:hello", load: current.load, mode: commenting ? "comment" : "", pins }, "*");
 });
 const controls: HTMLElement[] = [comment, picker, rotate];
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
