#!/usr/bin/env node
// Patch the installed pi-ask-user so a remote answerer (our intercom bridge)
// can answer a blocking ask_user prompt. Idempotent; fails loudly if an anchor
// moved upstream. Env PI_ASK_USER_DIR overrides the package location.
import { existsSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const pkgDir =
   process.env.PI_ASK_USER_DIR ||
   path.join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-ask-user");
const target = path.join(pkgDir, "index.ts");
if (!existsSync(target)) {
   console.error(`pi-ask-user not found at ${target}`);
   process.exit(1);
}

const HELPERS = `// Remote-answer channel: another extension (e.g. an intercom bridge) can answer
// this exact ask on behalf of the human. Answers are validated against the same
// options the local UI shows, so a remote answerer cannot invent a choice.
// Opt-in: PI_ASK_USER_REMOTE_ANSWERS=1.
export const ASK_PENDING_EVENT = "ask:pending";
export const ASK_ANSWER_EVENT = "ask:answer";

function matchOptionTitles(values: string[], options: QuestionOption[]): string[] {
   const titles: string[] = [];
   for (const value of values) {
      const needle = value.trim().toLowerCase();
      const hit = options.find((option) => option.title.trim().toLowerCase() === needle);
      if (!hit) return [];
      if (!titles.includes(hit.title)) titles.push(hit.title);
   }
   return titles;
}

function coerceRemoteAnswer(
   payload: { selections?: unknown; text?: unknown; comment?: unknown },
   options: QuestionOption[],
   allowMultiple: boolean,
   allowFreeform: boolean,
   allowComment: boolean,
): AskResponse | null {
   const requested = Array.isArray(payload.selections)
      ? payload.selections.filter((value): value is string => typeof value === "string")
      : typeof payload.text === "string"
         ? [payload.text]
         : [];
   if (requested.length === 0) return null;
   if (requested.length > 1 && !allowMultiple) return null;
   const comment = allowComment && typeof payload.comment === "string" ? payload.comment : null;
   const selections = options.length > 0 ? matchOptionTitles(requested, options) : [];
   if (selections.length > 0) return createSelectionResponse(selections, comment);
   if (!allowFreeform || requested.length > 1) return null;
   return createFreeformResponse(requested[0]);
}

`;

const CHANNEL = `         // A remote answerer may answer this exact ask instead of the local
         // human; whichever answers first wins and closes the local prompt.
         const remoteAnswersEnabled = parseBooleanPreference(process.env.PI_ASK_USER_REMOTE_ANSWERS) ?? false;
         const askId = globalThis.crypto.randomUUID();
         const openRemoteChannel = () => {
            if (!remoteAnswersEnabled) {
               return {
                  answered: new Promise<AskResponse>(() => { }),
                  dispose: () => { },
                  bindLocalUI: (_done: (result: AskUIResult) => void) => { },
               };
            }
            let settle: ((response: AskResponse) => void) | undefined;
            let closeLocalUI: ((result: AskUIResult) => void) | undefined;
            const answered = new Promise<AskResponse>((resolve) => {
               settle = resolve;
            });
            const dispose = pi.events.on(ASK_ANSWER_EVENT, (payload: unknown) => {
               const event = payload as { askId?: unknown; selections?: unknown; text?: unknown; comment?: unknown } | null;
               if (!event || typeof event !== "object" || event.askId !== askId) return;
               const response = coerceRemoteAnswer(event, options, allowMultiple, allowFreeform, allowComment);
               if (!response) return;
               settle?.(response);
               closeLocalUI?.(response);
            });
            pi.events.emit(ASK_PENDING_EVENT, {
               askId,
               question,
               context: normalizedContext,
               options,
               allowMultiple,
               allowFreeform,
               allowComment,
            });
            return {
               answered,
               dispose,
               bindLocalUI: (done: (result: AskUIResult) => void) => {
                  closeLocalUI = done;
               },
            };
         };

`;

const edits = [
   // 1. shared helpers
   {
      find: "function formatResponseSummary(response: AskResponse): string {",
      replace: `${HELPERS}function formatResponseSummary(response: AskResponse): string {`,
   },
   // 2. per-ask remote channel
   {
      find: "         if (rawOptions.length > 0 && options.length === 0) {",
      replace: `${CHANNEL}         if (rawOptions.length > 0 && options.length === 0) {`,
   },
   // 3. freeform-only branch (no options): race the input prompt
   {
      find: `            pi.events.emit("herdr:blocked", { active: true, label: "Waiting for user response" });
            let answer: string | undefined;
            try {
               answer = await ctx.ui.input(prompt, "Type your answer...", timeout ? { timeout } : undefined);
            } finally {
               pi.events.emit("herdr:blocked", { active: false });
            }
            const response = createFreeformResponse(answer);`,
      replace: `            const remote = openRemoteChannel();
            pi.events.emit("herdr:blocked", { active: true, label: "Waiting for user response" });
            let response: AskResponse | null;
            try {
               response = await Promise.race([
                  remote.answered,
                  Promise.resolve(ctx.ui.input(prompt, "Type your answer...", timeout ? { timeout } : undefined))
                     .then((answer) => createFreeformResponse(answer)),
               ]);
            } finally {
               remote.dispose();
               pi.events.emit("herdr:blocked", { active: false });
            }`,
   },
   // 4. options branch: open the channel before blocking
   {
      find: `         pi.events.emit("herdr:blocked", { active: true, label: "Waiting for user response" });
         try {`,
      replace: `         const remote = openRemoteChannel();
         pi.events.emit("herdr:blocked", { active: true, label: "Waiting for user response" });
         try {`,
   },
   // 5. let a remote answer close the local overlay
   {
      find: `done: (result: AskUIResult | null) => void) => {
               if (signal) {`,
      replace: `done: (result: AskUIResult | null) => void) => {
               remote.bindLocalUI(done);
               if (signal) {`,
   },
   // 6+7. race the TUI overlay
   {
      find: "            const customResult = await ctx.ui.custom<AskUIResult | null>(",
      replace:
         "            const customResult = await Promise.race([remote.answered, ctx.ui.custom<AskUIResult | null>(",
   },
   {
      find: `               buildCustomUIOptions(effectiveDisplayMode, (handle) => {
                  overlayHandle = handle;
               }),
            );`,
      replace: `               buildCustomUIOptions(effectiveDisplayMode, (handle) => {
                  overlayHandle = handle;
               }),
            )]);`,
   },
   // 8. race the RPC dialog fallback
   {
      find: "               result = await askViaDialogs(ctx.ui, question, normalizedContext, options, allowMultiple, allowFreeform, allowComment, timeout);",
      replace: `               result = await Promise.race([
                  remote.answered,
                  askViaDialogs(ctx.ui, question, normalizedContext, options, allowMultiple, allowFreeform, allowComment, timeout),
               ]);`,
   },
   // 9. unsubscribe
   {
      find: "            removeOverlayInputListener?.();",
      replace: `            remote.dispose();
            removeOverlayInputListener?.();`,
   },
];

let source = readFileSync(target, "utf8");
if (source.includes("ASK_ANSWER_EVENT")) {
   console.log(`already patched: ${target}`);
   process.exit(0);
}

for (const [index, edit] of edits.entries()) {
   const hits = source.split(edit.find).length - 1;
   if (hits !== 1) {
      console.error(
         `anchor ${index + 1} matched ${hits} times (expected 1); upstream changed:\n${edit.find.slice(0, 120)}`,
      );
      process.exit(1);
   }
   source = source.replace(edit.find, edit.replace);
}

const backup = `${target}.pre-remote-answer`;
if (!existsSync(backup)) copyFileSync(target, backup);
writeFileSync(target, source);
console.log(
   `patched ${target}\nbackup  ${backup}\nenable with PI_ASK_USER_REMOTE_ANSWERS=1`,
);
