import assert from "node:assert/strict";
import { handsOff, SELF_VERIFY } from "../extensions/self-verify.ts";

const reply = (text, extra = {}) => [{ role: "user", content: "fix it" }, { role: "assistant", content: [{ type: "text", text }], ...extra }];
for (const text of ["Done. Now you can run `npm start` and open the page.", "Fixed. Please open the app and click Save to confirm.", "To test it, launch the emulator.", "You'll need to open the app to check.", "I changed app.js to use `save`. I haven't opened the page in a browser to confirm.", "Not yet tested in the app.", "I didn't click the real buttons in a live window.", "I didn't open index.html in a real browser."])
	assert(handsOff(reply(text)), `hand-off detected: ${text}`);
for (const text of ["Fixed and verified: tests pass, screenshot shows the button.", "Blocked: the phone is not connected.", "I ran the app; the dialog opens.", "Run /reload to load the extension.", "The button did not render before the fix; now it does."])
	assert(!handsOff(reply(text)), `no false trigger: ${text}`);
assert(!handsOff(reply("Now you can run it.", { stopReason: "aborted" })), "aborted runs are not scored as handoffs");
assert(!handsOff([{ role: "user", content: "please run it" }]), "user text alone never triggers");
assert.match(SELF_VERIFY, /your call[\s\S]*about to tell the user to run, open, click or test[\s\S]*agent-browser[\s\S]*app_act[\s\S]*mobile_act[\s\S]*only when no tool can[\s\S]*exact reason[\s\S]*no-tests/);

console.log("ok - self-verify standing rule and benchmark hand-off scoring");
