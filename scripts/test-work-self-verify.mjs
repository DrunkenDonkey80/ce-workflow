import assert from "node:assert/strict";
import { handsOff, NUDGE, registerSelfVerify, SELF_VERIFY } from "../extensions/self-verify.ts";

const reply = (text, extra = {}) => [{ role: "user", content: "fix it" }, { role: "assistant", content: [{ type: "text", text }], ...extra }];
for (const text of ["Done. Now you can run `npm start` and open the page.", "Fixed. Please open the app and click Save to confirm.", "To test it, launch the emulator.", "You'll need to open the app to check.", "I changed app.js to use `save`. I haven't opened the page in a browser to confirm.", "Not yet tested in the app.", "I didn't click the real buttons in a live window.", "I didn't open index.html in a real browser."])
	assert(handsOff(reply(text)), `hand-off detected: ${text}`);
for (const text of ["Fixed and verified: tests pass, screenshot shows the button.", "Blocked: the phone is not connected.", "I ran the app; the dialog opens.", "Run /reload to load the extension.", "The button did not render before the fix; now it does."])
	assert(!handsOff(reply(text)), `no false trigger: ${text}`);
assert(!handsOff(reply("Now you can run it.", { stopReason: "aborted" })), "aborted runs are not nudged");
assert(!handsOff([{ role: "user", content: "please run it" }]), "user text alone never triggers");
assert.match(SELF_VERIFY, /agent-browser[\s\S]*app_act[\s\S]*mobile_act[\s\S]*Reading the code or diff does not verify a UI change[\s\S]*name that exact blocker[\s\S]*no-tests/);

let end, sent = [], skip = false;
registerSelfVerify({ on: (name, fn) => { if (name === "agent_end") end = fn; }, sendUserMessage: (text, options) => sent.push([text, options.deliverAs]) }, () => skip);
end({ messages: reply("Now you can run it.") }, {});
assert.deepEqual(sent, [[NUDGE, "followUp"]], "a hand-off gets one nudge");
end({ messages: reply("Please open it yourself.") }, {});
assert.equal(sent.length, 1, "the reply to the nudge is never nudged again (no loop)");
end({ messages: reply("Now you can run it.") }, {});
assert.equal(sent.length, 2, "the next user prompt can be nudged again");
end({}, {}); // the nudge reply clears the one-shot flag
skip = true;
end({ messages: reply("Now you can run it.") }, {});
assert.equal(sent.length, 2, "skipped runs (planning) are not nudged");
skip = false;
end({ aborted: true, messages: reply("Now you can run it.") }, {});
assert.equal(sent.length, 2, "aborted runs are not nudged");
console.log("ok - self-verify rule and one-shot hand-off nudge");
