// D11: WKWebView has no page notifications; this Notification hands each one to Hub.swift, which posts it natively.
// window.__piHubPermission is set by Swift before this runs and whenever the app's permission changes.
(() => {
 const send = (cmd, args = {}) => window.webkit.messageHandlers.pihub.postMessage({ cmd, args });
 const notes = new Map();
 class PiHubNotification extends EventTarget {
  static get permission() { return window.__piHubPermission || "default"; }
  static async requestPermission(callback) { const result = await send("notify_permission"); window.__piHubPermission = result; callback?.(result); return result; }
  constructor(title, options = {}) {
   super();
   this.title = String(title); this.body = String(options.body ?? ""); this.tag = String(options.tag ?? "");
   this.onclick = null; this.onclose = null; this.key = this.tag || Math.random().toString(36).slice(2);
   notes.set(this.key, this);
   void send("notify", { title: this.title, body: this.body, tag: this.key });
  }
  close() { notes.delete(this.key); void send("notify_close", { tag: this.key }); }
 }
 window.Notification = PiHubNotification;
 window.__piHubClicked = key => { const note = notes.get(key); if (!note) return; const event = new Event("click"); note.onclick?.(event); note.dispatchEvent(event); };
})();
