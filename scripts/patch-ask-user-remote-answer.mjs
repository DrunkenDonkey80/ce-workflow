#!/usr/bin/env node
// Optional pi-ask-user 0.16 remote-answer patch. Never applied by package verification.
import { existsSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REMOTE_HELPERS = `// ce-workflow remote-answer channel v2; opt-in and single-question only.
export const ASK_PENDING_EVENT = "ask:pending";
export const ASK_ANSWER_EVENT = "ask:answer";

function coerceRemoteAnswer(
   payload: { selections?: unknown; text?: unknown; comment?: unknown },
   options: QuestionOption[],
   allowMultiple: boolean,
   allowFreeform: boolean,
   allowComment: boolean,
): AskResponse | null {
   const requested = Array.isArray(payload.selections)
      ? payload.selections.filter((value): value is string => typeof value === "string")
      : typeof payload.text === "string" ? [payload.text] : [];
   if (!requested.length || (requested.length > 1 && !allowMultiple)) return null;
   const selected = requested.map((value) => options.find((option) => option.title.trim().toLowerCase() === value.trim().toLowerCase())?.title);
   const comment = allowComment && typeof payload.comment === "string" ? payload.comment : null;
   if (selected.every((title) => title !== undefined)) return createSelectionResponse([...new Set(selected as string[])], comment);
   if (!allowFreeform || requested.length > 1) return null;
   return createFreeformResponse(requested[0]);
}

async function runRemoteAsk(
   pi: ExtensionAPI,
   subject: AskEventSubject,
   allowMultiple: boolean,
   allowFreeform: boolean,
   allowComment: boolean,
   signal: AbortSignal | undefined,
   run: (localSignal: AbortSignal | undefined) => Promise<AskResponse | null>,
): Promise<AskResponse | null> {
   if (!(parseBooleanPreference(process.env.PI_ASK_USER_REMOTE_ANSWERS) ?? false)) return run(signal);
   if (signal?.aborted) return null;
   const local = new AbortController();
   const forwardAbort = () => local.abort();
   signal?.addEventListener("abort", forwardAbort, { once: true });
   const askId = globalThis.crypto.randomUUID();
   let settle: (response: AskResponse) => void = () => {};
   const remote = new Promise<AskResponse>((resolve) => { settle = resolve; });
   const dispose = pi.events.on(ASK_ANSWER_EVENT, (payload: unknown) => {
      const event = payload as { askId?: unknown; selections?: unknown; text?: unknown; comment?: unknown } | null;
      if (!event || event.askId !== askId || local.signal.aborted) return;
      const response = coerceRemoteAnswer(event, subject.options ?? [], allowMultiple, allowFreeform, allowComment);
      if (response) { settle(response); local.abort(); }
   });
   try {
      const result = Promise.race([remote, Promise.resolve().then(() => local.signal.aborted ? null : run(local.signal))]);
      pi.events.emit(ASK_PENDING_EVENT, { ...subject, askId, allowMultiple, allowFreeform, allowComment });
      return await result;
   } finally {
      local.abort();
      dispose();
      signal?.removeEventListener("abort", forwardAbort);
   }
}

`;

export function patchAskUserSource(source) {
   if (source.includes("// ce-workflow remote-answer channel v2;")) return source;
   if (source.includes("ASK_ANSWER_EVENT")) throw new Error("Legacy remote-answer patch detected; restore its backup or reinstall pi-ask-user before patching.");
   const edits = [
      ["function formatResponseSummary(response: AskResponse): string {", `${REMOTE_HELPERS}function formatResponseSummary(response: AskResponse): string {`],
      [
         `            const answer = await whileBlocked(pi, () => ctx.ui.input(prompt, "Type your answer...", dialogOpts));
            const response = signal?.aborted ? null : createFreeformResponse(answer);`,
         `            const response = await whileBlocked(pi, () => runRemoteAsk(pi, subject, allowMultiple, allowFreeform, allowComment, signal,
               async (localSignal) => {
                  const answer = await ctx.ui.input(prompt, "Type your answer...", { ...dialogOpts, signal: localSignal });
                  return localSignal?.aborted ? null : createFreeformResponse(answer);
               }));`,
      ],
      [
         `         const result = await whileBlocked(pi, () => runCustomPrompt<AskUIResult>(ctx.ui, {
            signal,`,
         `         const result = await whileBlocked(pi, () => runRemoteAsk(pi, subject, allowMultiple, allowFreeform, allowComment, signal,
            (localSignal) => runCustomPrompt<AskUIResult>(ctx.ui, {
            signal: localSignal,`,
      ],
      [
         `               allowComment,
               dialogOpts,
            ),
         }));`,
         `               allowComment,
               { ...dialogOpts, signal: localSignal },
            ),
         })));`,
      ],
   ];
   for (const [index, [find, replace]] of edits.entries()) {
      const hits = source.split(find).length - 1;
      if (hits !== 1) throw new Error(`anchor ${index + 1} matched ${hits} times (expected 1); upstream changed: ${find.slice(0, 120)}`);
      source = source.replace(find, replace);
   }
   return source;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
   const pkgDir = process.env.PI_ASK_USER_DIR || path.join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-ask-user");
   const target = path.join(pkgDir, "index.ts");
   try {
      const original = readFileSync(target, "utf8");
      const patched = patchAskUserSource(original);
      if (patched === original) console.log(`already patched: ${target}`);
      else {
         const backup = `${target}.pre-remote-answer`;
         if (!existsSync(backup)) copyFileSync(target, backup);
         writeFileSync(target, patched);
         console.log(`patched ${target}\nbackup  ${backup}\nenable with PI_ASK_USER_REMOTE_ANSWERS=1`);
      }
   } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
   }
}
