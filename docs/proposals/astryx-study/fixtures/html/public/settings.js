// Relay settings prototype. Values live in memory only and reset on reload or navigation.
"use strict";

const form = document.getElementById("settings-form");
const nameInput = document.getElementById("workspace-name");
const nameError = document.getElementById("workspace-name-error");
const notifications = document.getElementById("notifications");
const appearance = document.getElementById("appearance");
const saved = document.getElementById("settings-saved");

function setNameError(show) {
  nameError.hidden = !show;
  nameInput.setAttribute("aria-invalid", String(show));
}

function clearSaved() { saved.replaceChildren(); }

nameInput.addEventListener("blur", () => setNameError(!nameInput.value.trim()));
nameInput.addEventListener("input", () => { clearSaved(); if (nameInput.value.trim()) setNameError(false); });

notifications.addEventListener("change", () => {
  document.getElementById("notifications-state").textContent = notifications.checked ? "On" : "Off";
  clearSaved();
});

appearance.addEventListener("change", () => {
  document.documentElement.dataset.theme = appearance.checked ? "dark" : "light";
  document.getElementById("appearance-state").textContent = appearance.checked ? "Dark" : "Light";
  clearSaved();
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) {
    setNameError(true);
    nameInput.focus();
    return;
  }
  document.getElementById("workspace-label").textContent = name;
  const check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  check.setAttribute("viewBox", "0 0 24 24");
  check.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  Object.entries({ d: "m5 12 4.5 4.5L19 7", fill: "none", stroke: "currentColor", "stroke-width": "2.5", "stroke-linecap": "round", "stroke-linejoin": "round" })
    .forEach(([k, v]) => path.setAttribute(k, v));
  check.append(path);
  saved.replaceChildren(check, `Settings saved for this visit. They reset when you reload or leave this page.`);
});
