// D4: the desktop strip (hub/app/ui/index.html) calls Tauri; this stands in for the parts it uses, backed by Hub.swift.
(() => {
 const call = (cmd, args = {}) => window.webkit.messageHandlers.pihub.postMessage({ cmd, args });
 const focusListeners = [];
 window.__piHubFocus = focused => { for (const listener of focusListeners) listener({ payload: focused }); };
 const win = { onFocusChanged: async listener => { focusListeners.push(listener); return () => {}; }, minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {} };
 // The native menu opens where the last pointer went down (right-click, long press).
 let point = { x: 0, y: 0 };
 addEventListener("pointerdown", event => { point = { x: event.clientX, y: event.clientY }; }, true);
 addEventListener("contextmenu", event => { point = { x: event.clientX, y: event.clientY }; }, true);
 const menu = { Menu: { new: async ({ items }) => ({
  // Resolves after the menu closed and the picked action ran: the strip counts a pick after that as a cancel.
  popup: async () => {
   const pick = await call("menu", { items: items.map(item => item.item === "Separator" ? null : item.text), x: point.x, y: point.y });
   if (typeof pick === "number") items[pick]?.action?.();
  },
 }) } };
 window.__TAURI__ = { core: { invoke: call }, window: { getCurrentWindow: () => win }, menu };
 // AP-04: the strip is as tall as its rows; Swift sizes the view to it.
 addEventListener("DOMContentLoaded", () => {
  // Phones lay a page without a viewport out 980 px wide and shrink it; the strip is drawn at device width instead.
  document.head.append(Object.assign(document.createElement("meta"), { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" }));
  let last = 0;
  new ResizeObserver(() => { const height = Math.ceil(document.body.getBoundingClientRect().height); if (height !== last) { last = height; void call("height", { height }); } }).observe(document.body);
 });
})();
