# Proposal: remote-answer channel for pi-ask-user

**Upstream:** edlsh/pi-ask-user · **Diff:** [pi-ask-user-remote-answer.patch](./pi-ask-user-remote-answer.patch) · **Status:** running locally, verified end-to-end

## Problem

`ask_user` parks on `ctx.ui.custom()` / `ctx.ui.input()` and resolves only from
local terminal input, its own `timeout`, or turn abort. A session driven
remotely (e.g. monitored over pi-intercom) therefore blocks forever on a human
who is not at that terminal: inbound intercom is delivered as `steer`, which is
only read on the next model request — one that never comes.

## Change (~120 lines, additive)

1. `ask:pending` event when a prompt opens: `{askId, question, context, options, allowMultiple, allowFreeform, allowComment}`.
2. `ask:answer` event accepted while the same prompt is open: `{askId, selections?: string[], text?: string, comment?}`.
3. Whichever of local human / remote answerer resolves first wins:
   - the remote answer is validated against the same options the local UI shows (title match, or freeform only when allowed) — a remote answerer cannot invent a choice;
   - a winning remote answer also closes the local overlay through the existing `done()` callback;
   - invalid remote answers are ignored and the prompt stays up.
4. Opt-in: the whole channel is inert unless `PI_ASK_USER_REMOTE_ANSWERS=1`. Default behavior is byte-identical to today.

## Why this shape

- The TUI path already funnels through `done(result)`, so a programmatic answer returns a real, non-cancelled `AskResponse` — no UI rework.
- Validation lives where option semantics already live; the bridge cannot bypass `allowFreeform=false`.
- Events are the existing extension bus (`pi.events`), so any bridge (intercom, RPC supervisor, test harness) can drive it without new plugin APIs.

## Verified

- Live: a blocking `ask_user` in a real pi RPC session (options, `allowFreeform=false`) resolved via `ask:answer` and the tool returned `User answered: Local B` — `scripts/test-ask-remote-live.mjs`.
- Bridge unit tests (forwarding, retry on peer discovery, answer routing, multi-select, wrong-askId rejection, cleanup): `scripts/test-work-ask-remote.mjs`.
- Downgrade-safe: without the env var no events fire; without a listener (`pi-intercom` absent) the outbox emit is a no-op and the prompt behaves exactly as today.
- Idempotent local patcher with anchor checks for upstream drift: `scripts/patch-ask-user-remote-answer.mjs`.

## Known limitation

The freeform-only branch (`ctx.ui.input`, no options) has no `done()`; there the
remote answer wins the race but the underlying input dialog stays pending until
its own timeout/abort. Upstream could switch it to `ctx.ui.custom` for parity.

## Suggested env naming for upstream

Happy to rename events to `ask_user:pending` / `ask_user:answer` or gate behind
a settings field instead of env if preferred — the shape is what matters.
