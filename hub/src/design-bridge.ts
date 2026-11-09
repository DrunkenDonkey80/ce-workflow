// The design bridge (S10, D2): a script the hub adds to every HTML page it serves for a design session's own preview.
// It talks to the hub page (its parent) over postMessage only: the frame is sandboxed to an opaque origin. The parent
// says hello with a load id after each load; every message back carries that id, so the parent drops messages from
// another frame or an earlier load. In Comment mode a click picks an element instead of acting on it; pins are drawn
// from the list the parent sends, so they survive live reloads. Its own elements are marked data-design-chrome.
// S12: in Edit mode a click inspects (computed styles go back), and style messages change that element inline until
// the next load. A page's Tweaks panel dispatches a "design:tweaks" CustomEvent, which goes up with the load id.
export const DESIGN_BRIDGE = `<script data-design-chrome>(() => {
	if (window.parent === window || window.__designBridge) return;
	window.__designBridge = true;
	let load = "", mode = "", pins = [], hovered = null, layer = null, editing = null;
	const STYLES = ["color", "background-color", "font-size", "font-weight", "padding", "margin", "gap", "border-radius"];
	const screen = decodeURIComponent(location.pathname.split("/").pop() || "index.html");
	const send = (type, data) => { if (load) parent.postMessage({ type, load, ...data }, "*"); };
	const chrome = el => !!(el && el.closest && el.closest("[data-design-chrome]"));
	const clip = (text, max) => String(text || "").replace(/\\s+/g, " ").trim().slice(0, max);
	// A short selector for an element without a data-id: up to its nearest data-id or id ancestor.
	const selector = el => {
		const parts = [];
		for (let at = el; at && at !== document.documentElement && parts.length < 6; at = at.parentElement) {
			if (at !== el && at.dataset && at.dataset.id) { parts.unshift('[data-id="' + at.dataset.id + '"]'); break; }
			if (at.id) { parts.unshift("#" + CSS.escape(at.id)); break; }
			if (at === document.body) { parts.unshift("body"); break; }
			const same = at.parentElement ? [...at.parentElement.children].filter(child => child.tagName === at.tagName) : [];
			parts.unshift(at.tagName.toLowerCase() + (same.length > 1 ? ":nth-of-type(" + (same.indexOf(at) + 1) + ")" : ""));
		}
		return parts.join(" > ").slice(0, 300);
	};
	// The element meant: the clicked one, or its data-id ancestor when that is small (a button around an icon or a span).
	const target = el => {
		const named = el.closest("[data-id]");
		return named && (named === el || (named.innerText || "").length <= 160) ? named : el;
	};
	const find = pin => { try { return (pin.id && document.querySelector('[data-id="' + CSS.escape(pin.id) + '"]')) || (pin.selector && document.querySelector(pin.selector)); } catch { return null; } };
	const outline = el => { if (hovered) hovered.style.outline = hovered.dataset.designOutline || ""; hovered = el; if (el) { el.dataset.designOutline = el.style.outline; el.style.outline = "2px solid #e8590c"; } };
	function drawPins() {
		layer?.remove(); layer = null;
		const mine = pins.filter(pin => pin.screen === screen);
		if (!mine.length) return;
		layer = document.createElement("div");
		layer.setAttribute("data-design-chrome", "");
		layer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none";
		for (const pin of mine) {
			const el = find(pin); if (!el) continue;
			const box = el.getBoundingClientRect(), dot = document.createElement("span");
			dot.textContent = String(pin.n);
			dot.style.cssText = "position:absolute;min-width:22px;height:22px;padding:0 5px;box-sizing:border-box;border-radius:11px;background:#e8590c;color:#fff;font:600 12px/22px system-ui,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.4)";
			dot.style.left = Math.max(0, box.left + scrollX - 8) + "px"; dot.style.top = Math.max(0, box.top + scrollY - 8) + "px";
			layer.append(dot);
		}
		document.body.append(layer);
	}
	addEventListener("message", event => {
		if (event.source !== parent) return;
		const message = event.data || {};
		if (message.type === "design:hello" && typeof message.load === "string") { load = message.load; send("design:hash", { hash: location.hash }); }
		if (message.load !== load) return;
		if (typeof message.mode === "string") { mode = message.mode; if (!mode) outline(null); document.documentElement.style.cursor = mode ? "crosshair" : ""; }
		if (message.style && editing) for (const name of STYLES) if (typeof message.style[name] === "string") editing.style.setProperty(name, message.style[name].slice(0, 100));
		if (Array.isArray(message.pins)) { pins = message.pins; drawPins(); }
	});
	addEventListener("mouseover", event => { if (mode && !chrome(event.target)) outline(target(event.target)); }, true);
	addEventListener("click", event => {
		if (!mode || chrome(event.target)) return;
		event.preventDefault(); event.stopPropagation();
		const el = target(event.target), box = el.getBoundingClientRect(), id = el.dataset.id && /^[\\w-]{1,80}$/.test(el.dataset.id) ? el.dataset.id : "";
		const pick = { screen, id, selector: id ? "" : selector(el), tag: el.tagName.toLowerCase(), text: clip(el.innerText || el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("placeholder") || el.value, 160), rect: { x: box.left, y: box.top, width: box.width, height: box.height } };
		if (mode === "comment") return send("design:pick", pick);
		outline(null); editing = el; const computed = getComputedStyle(el);
		send("design:inspect", { ...pick, styles: Object.fromEntries(STYLES.map(name => [name, computed.getPropertyValue(name).slice(0, 100)])) });
	}, true);
	addEventListener("design:tweaks", event => { if (event.detail && typeof event.detail === "object") send("design:tweaks", { values: event.detail }); });
	addEventListener("resize", drawPins);
	addEventListener("hashchange", () => { send("design:hash", { hash: location.hash }); drawPins(); }); // Mark renders the slide shown
	addEventListener("load", drawPins);
})();</script>`;

/** The page with the bridge before its closing body tag (or at the end when it has none). */
export function withBridge(html: string) {
	const at = html.search(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
	return at < 0 ? html + DESIGN_BRIDGE : html.slice(0, at) + DESIGN_BRIDGE + html.slice(at);
}
