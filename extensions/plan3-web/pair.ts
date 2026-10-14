// Browser-only pairing page (D4/D22): show the code, wait for terminal approval, then load the workspace.
const status = document.getElementById("pair-status"), code = document.getElementById("pair-code"), retry = document.getElementById("pair-retry") as HTMLButtonElement;
async function call(url: string, init: RequestInit = {}) {
 const response = await fetch(url, { credentials: "same-origin", ...init }), value = await response.json();
 if (!response.ok) throw new Error(value.error ?? "Pairing failed.");
 return value;
}
async function start() {
 retry.hidden = true; code.textContent = ""; status.textContent = "Asking the PC…";
 try {
  const pending = await call("/pair/start", { method: "POST" });
  if (pending.paired) { status.textContent = "Already paired. Loading…"; location.reload(); return; }
  code.textContent = pending.code; status.textContent = "Approve this device at the PC if it shows the same code.";
  for (;;) {
   const result = await call("/pair/status?id=" + encodeURIComponent(pending.id));
   if (result.state === "approved") { status.textContent = "Paired. Loading…"; location.reload(); return; }
   if (result.state !== "pending") throw new Error(result.state === "denied" ? "The PC declined this device." : "The code expired.");
  }
 } catch (error) { code.textContent = ""; status.textContent = error.message; retry.hidden = false; retry.focus(); }
}
retry.addEventListener("click", () => void start());
void start();
