// Relay dashboard prototype. State lives in memory only and resets on reload.
"use strict";

const OWNERS = ["Maya Chen", "Sam Okafor", "Lina Park", "Arun Shah", "Jo Rivera"];
const STATUSES = ["Active", "Review", "Planned", "Paused"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const projects = [
  { id: "atlas", name: "Atlas mobile rollout", owner: "Maya Chen", status: "Active", due: "2026-11-18" },
  { id: "beacon", name: "Beacon accessibility audit", owner: "Sam Okafor", status: "Review", due: "2026-11-20" },
  { id: "cedar", name: "Cedar partner portal", owner: "Lina Park", status: "Active", due: "2026-11-24" },
  { id: "delta", name: "Delta incident playbook", owner: "Arun Shah", status: "Planned", due: "2026-11-27" },
  { id: "ember", name: "Ember release checklist", owner: "Jo Rivera", status: "Review", due: "2026-11-30" },
  { id: "fjord", name: "Fjord field-research synthesis and next-quarter recommendations", owner: "Maya Chen", status: "Planned", due: "2026-12-04" },
];

const view = { query: "", status: "All", listState: "populated", savedNote: "" };

const $ = (selector) => document.querySelector(selector);

// Builds elements from text nodes only, so project names typed by the user are never parsed as markup.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) if (value != null) el.setAttribute(key, value);
  el.append(...children.flat().filter((child) => child != null && child !== ""));
  return el;
}

// Icons come from constant markup in this file, never from user input.
const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  Active: `${SVG_OPEN} stroke-width="2.5"><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/></svg>`,
  Review: `${SVG_OPEN} stroke-width="2.5"><circle cx="12" cy="12" r="9.5"/><path d="M12 7a5 5 0 0 0 0 10z" fill="currentColor" stroke="none"/></svg>`,
  Planned: `${SVG_OPEN} stroke-width="2.5"><circle cx="12" cy="12" r="9.5"/></svg>`,
  Paused: `${SVG_OPEN} stroke-width="2.5"><circle cx="12" cy="12" r="9.5"/><path d="M9.5 8.5v7M14.5 8.5v7"/></svg>`,
  edit: `${SVG_OPEN} stroke-width="1.75"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>`,
  check: `${SVG_OPEN} stroke-width="2.5"><path d="m5 12 4.5 4.5L19 7"/></svg>`,
  alert: `${SVG_OPEN} stroke-width="2"><path d="M12 3 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/></svg>`,
};
const iconParser = new DOMParser();
const icon = (name) => document.importNode(iconParser.parseFromString(ICONS[name], "image/svg+xml").documentElement, true);

function formatDate(iso, withYear = true) {
  if (!iso) return "No due date";
  const [y, m, d] = iso.split("-");
  return `${d} ${MONTHS[Number(m) - 1]}${withYear ? ` ${y}` : ""}`;
}

// Shape encodes status so it never relies on color: filled = Active, half = Review, hollow = Planned, bars = Paused.
const statusBadge = (status) => h("span", { class: `status status-${status}` }, icon(status), status);
const byDue = (a, b) => (a.due || "9999").localeCompare(b.due || "9999");

function renderOverview() {
  const ordered = [...projects].sort(byDue);
  const next = ordered.find((p) => p.due);
  const reviews = ordered.filter((p) => p.status === "Review");

  $("#dashboard-summary").textContent = next
    ? `${projects.length} projects. ${next.name} is due next, on ${formatDate(next.due)}.`
    : `${projects.length} projects. None has a due date yet.`;

  const track = $("#track");
  track.style.setProperty("--stops", ordered.length);
  track.replaceChildren(...ordered.map((p, i) => {
    const label = h("span", { class: "stop-label" },
      h("span", { class: "stop-name", "aria-hidden": "true" }, p.name.split(" ")[0]),
      h("span", { class: "sr-only" }, `${p.name}, ${p.status}, due `),
      h("span", { class: "stop-due" }, formatDate(p.due, false)));
    const top = i % 2 === 0;
    return h("li", { class: "stop", "data-id": `stop-${p.id}` },
      h("span", { class: "stop-slot stop-slot-top" }, top ? label : null),
      h("span", { class: "stop-marker" }, icon(p.status)),
      h("span", { class: "stop-slot stop-slot-bottom" }, top ? null : label));
  }));

  $("#status-counts").replaceChildren(...STATUSES.map((s) =>
    h("div", { "data-id": `count-${s.toLowerCase()}` },
      icon(s), h("dt", {}, s), h("dd", {}, String(projects.filter((p) => p.status === s).length)))));

  $("#due-next-body").replaceChildren(next
    ? h("div", {},
        h("p", { class: "next-name", "data-id": "due-next-name" }, next.name),
        h("p", { class: "next-meta", "data-id": "due-next-meta" },
          h("span", {}, `Due ${formatDate(next.due)}`), h("span", {}, next.owner), statusBadge(next.status)))
    : h("p", { "data-id": "due-next-empty" }, "No project has a due date yet."));

  $("#waiting-review-body").replaceChildren(reviews.length
    ? h("ul", { class: "review-list", "data-id": "waiting-review-list" }, reviews.map((p) =>
        h("li", { "data-id": `review-${p.id}` }, h("strong", {}, p.name), h("span", {}, `${p.owner}, due ${formatDate(p.due)}`))))
    : h("p", { "data-id": "waiting-review-empty" }, "Nothing is waiting for review."));
}

function matches(p) {
  const q = view.query.trim().toLowerCase();
  return (view.status === "All" || p.status === view.status)
    && (p.name.toLowerCase().includes(q) || p.owner.toLowerCase().includes(q));
}

function renderRow(p) {
  return h("li", { class: "project-row", "data-id": `project-${p.id}` },
    h("h3", { class: "project-name", "data-id": `project-${p.id}-name` }, p.name),
    h("dl", { class: "project-meta" },
      h("div", { class: "meta-owner" }, h("dt", {}, "Owner"), h("dd", { "data-id": `project-${p.id}-owner` }, p.owner)),
      h("div", { class: "meta-status" }, h("dt", { class: "sr-only" }, "Status"), h("dd", { "data-id": `project-${p.id}-status` }, statusBadge(p.status))),
      h("div", { class: "meta-due" }, h("dt", {}, "Due"), h("dd", { "data-id": `project-${p.id}-due` },
        p.due ? h("time", { datetime: p.due }, formatDate(p.due)) : "No due date"))),
    h("button", { class: "button edit-button", type: "button", "data-edit": p.id, "data-id": `edit-${p.id}`, "aria-label": `Edit ${p.name}` },
      icon("edit"), "Edit"));
}

function filterDescription() {
  const parts = [];
  if (view.query.trim()) parts.push(`matching “${view.query.trim()}”`);
  if (view.status !== "All") parts.push(`with status ${view.status}`);
  return parts.join(" ");
}

function statePanel(id, title, text, action, extraClass = "") {
  return h("div", { class: `state-panel ${extraClass}`, "data-id": id },
    h("h3", { "data-id": `${id}-title` }, ...title), h("p", {}, text), action);
}

function renderList() {
  const panel = $("#project-list");
  const status = $("#list-status");
  panel.removeAttribute("aria-busy");
  status.replaceChildren();

  if (view.listState === "loading") {
    panel.setAttribute("aria-busy", "true");
    panel.replaceChildren(
      h("div", { class: "loading-label", "data-id": "loading-state" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Loading Field operations projects…"),
      ...[1, 2, 3].map(() => h("div", { class: "skeleton-row", "aria-hidden": "true" }, h("span", { class: "skeleton-bar" }), h("span", { class: "skeleton-bar" }))));
    return;
  }
  if (view.listState === "empty") {
    panel.replaceChildren(statePanel("empty-state", ["No projects in Field operations yet"],
      "Projects your team creates in Relay are listed here with their owner, status and due date.",
      h("button", { class: "button", type: "button", "data-action": "populate", "data-id": "empty-reload" }, "Reload project list")));
    return;
  }
  if (view.listState === "error") {
    panel.replaceChildren(statePanel("error-state", [icon("alert"), "Projects couldn't load"],
      "Relay didn't get a response while loading the Field operations list. Your search and status filter are kept. Check your connection, then retry.",
      h("button", { class: "button button-primary", type: "button", "data-action": "populate", "data-id": "error-retry" }, "Retry"),
      "state-panel-error"));
    return;
  }

  const shown = projects.filter(matches);
  const filtered = view.query.trim() || view.status !== "All";
  status.append(h("span", { "data-id": "results-count" },
    filtered ? `Showing ${shown.length} of ${projects.length} projects ${filterDescription()}` : `${projects.length} projects`));
  if (view.savedNote) status.append(h("span", { class: "save-note", "data-id": "save-note" }, icon("check"), view.savedNote));

  if (!shown.length) {
    panel.replaceChildren(statePanel("no-results", ["No projects match"],
      `Nothing ${filterDescription()}. Clear the search and status filter to see all ${projects.length} projects.`,
      h("button", { class: "button", type: "button", "data-action": "clear-filters", "data-id": "clear-filters" }, "Clear search and filter")));
    return;
  }
  panel.replaceChildren(
    h("div", { class: "list-head", "aria-hidden": "true", "data-id": "list-head" },
      h("span", {}, "Project"), h("span", {}, "Owner"), h("span", {}, "Status"), h("span", {}, "Due"), h("span")),
    h("ul", { class: "project-list", "data-id": "project-rows" }, shown.map(renderRow)));
}

function render() {
  renderOverview();
  renderList();
}

// Filters
$("#search").addEventListener("input", (e) => { view.query = e.target.value; view.savedNote = ""; renderList(); });
document.querySelectorAll('input[name="status-filter"]').forEach((radio) =>
  radio.addEventListener("change", () => { view.status = radio.value; view.savedNote = ""; renderList(); }));

$("#reset-filters").addEventListener("click", () => clearFilters());

function clearFilters() {
  view.query = "";
  view.status = "All";
  $("#search").value = "";
  $('input[name="status-filter"][value="All"]').checked = true;
  renderList();
  $("#search").focus();
}

// Prototype state switcher
function setListState(state, focusAfter) {
  view.listState = state;
  view.savedNote = "";
  $(`input[name="list-state"][value="${state}"]`).checked = true;
  renderList();
  if (focusAfter) $("#list-status").focus();
}
document.querySelectorAll('input[name="list-state"]').forEach((radio) =>
  radio.addEventListener("change", () => setListState(radio.value)));

$("#project-list").addEventListener("click", (e) => {
  const button = e.target.closest("button");
  if (!button) return;
  if (button.dataset.edit) openEditor(button.dataset.edit, button);
  else if (button.dataset.action === "clear-filters") clearFilters();
  else if (button.dataset.action === "populate") setListState("populated", true);
});

// Edit dialog
const dialog = $("#edit-dialog");
const form = $("#edit-form");
const nameInput = $("#project-name");
const nameError = $("#project-name-error");
let editing = null;
let opener = null;

$("#project-owner").append(...OWNERS.map((o) => new Option(o)));
$("#project-status").append(...STATUSES.map((s) => new Option(s)));

function setNameError(show) {
  nameError.hidden = !show;
  nameInput.setAttribute("aria-invalid", String(show));
}

function openEditor(id, button) {
  editing = projects.find((p) => p.id === id);
  opener = button;
  $("#edit-title").textContent = `Edit ${editing.name}`;
  nameInput.value = editing.name;
  $("#project-owner").value = editing.owner;
  $("#project-status").value = editing.status;
  $("#project-due").value = editing.due;
  setNameError(false);
  dialog.showModal();
  nameInput.focus();
}

nameInput.addEventListener("blur", () => { if (dialog.open && !nameInput.value.trim()) setNameError(true); });
nameInput.addEventListener("input", () => { if (nameInput.value.trim()) setNameError(false); });

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) {
    setNameError(true);
    nameInput.focus();
    return;
  }
  Object.assign(editing, {
    name,
    owner: $("#project-owner").value,
    status: $("#project-status").value,
    due: $("#project-due").value,
  });
  view.savedNote = matches(editing) ? `Saved ${name}.` : `Saved ${name}. It's hidden by the current search or filter.`;
  const savedId = editing.id;
  render();
  opener = document.querySelector(`[data-id="edit-${savedId}"]`) || $("#list-status");
  dialog.close();
  // The close event fires a task later; focus now so the re-rendered row's button never loses focus to the closed dialog.
  opener.focus();
});

$("#cancel-project").addEventListener("click", () => dialog.close());

// Escape fires "cancel" and closes the dialog; every close path discards unsaved input and returns focus.
dialog.addEventListener("close", () => {
  setNameError(false);
  editing = null;
  if (opener) opener.focus();
  opener = null;
});

// Keep Tab and Shift+Tab inside the modal instead of escaping to browser chrome.
dialog.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const focusable = [...dialog.querySelectorAll("input, select, button")].filter((el) => !el.disabled);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

render();
