// Design session preview controls (D17): files.ts stays the generic viewer and calls in here for a design's page.

/** Adds the device width buttons before a design page's Download and Open links. */
export function designControls(root: HTMLElement, actions: HTMLElement) {
 for (const [text, width] of [["Desktop", ""], ["Phone", "phone"]]) {
  const button = Object.assign(document.createElement("button"), { type: "button", textContent: text, className: "files-width" });
  button.setAttribute("aria-pressed", String((root.dataset.width ?? "") === width));
  button.addEventListener("click", () => { if (width) root.dataset.width = width; else delete root.dataset.width; for (const other of actions.querySelectorAll(".files-width")) other.setAttribute("aria-pressed", String(other === button)); });
  actions.prepend(button);
 }
}

/** Forgets the preview's device choice when a design opens or closes. */
export function resetDesign(root: HTMLElement) { delete root.dataset.width; }
