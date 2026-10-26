// Chat mirror, check-in budgets, project files and linked images (tests moved from ce-workflow
// test-work-plan3-web.mjs with the code in plan 0db155f7 H9-01).
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkIn, createChatMirror } from "../src/chat.ts";
import { readLinkedImage, savePastedImage } from "../src/images.ts";

const chatHooks = new Map(), mirrored = [];
const mirror = createChatMirror({ on: (name, handler) => chatHooks.set(name, handler) }, (event, value) => mirrored.push({ event, value }));
const user = { role: "user", timestamp: 1, content: "Hello <script>" }, assistant = { role: "assistant", timestamp: 2, content: [{ type: "text", text: "Reply" }] };
chatHooks.get("input")({ text: user.content, source: "interactive", streamingBehavior: "followUp" });
chatHooks.get("message_start")({ message: user }); chatHooks.get("message_end")({ message: user });
chatHooks.get("message_start")({ message: assistant });
chatHooks.get("message_update")({ message: { ...assistant, content: [{ type: "text", text: "Reply streamed" }] } });
chatHooks.get("message_end")({ message: { ...assistant, content: [{ type: "text", text: "Reply complete" }] } });
assert.equal(mirror.snapshot().length, 2);
assert.equal(mirror.snapshot()[0].text, user.content, "text remains data, never interpreted as markup");
assert.equal(mirror.snapshot()[1].text, "Reply complete");
assert.equal(mirror.snapshot()[1].streaming, false);
assert(mirrored.some(item => item.event === "input" && item.value.streamingBehavior === "followUp"));
// `!cmd` from the chat box: Pi's bashExecution message shows as your row with the output in a code block.
{ const hooks = new Map(), bash = createChatMirror({ on: (name, handler) => hooks.set(name, handler) }, () => {});
 hooks.get("message_end")({ message: { role: "bashExecution", command: "ls", output: "a.txt\n", exitCode: 2, excludeFromContext: true, timestamp: 7 } });
 assert.deepEqual(bash.snapshot().map(({ id, role, text }) => ({ id, role, text })), [{ id: "user_7", role: "user", text: "!!ls\n```\na.txt\n```\nexit code 2" }]); }
const branch = { sessionManager: { getBranch: () => [{ type: "message", message: { role: "user", timestamp: 0, content: "Older" } }, { type: "message", message: user }, { type: "message", message: { ...assistant, content: [{ type: "text", text: "Reply complete" }] } }] } };
mirror.hydrate(branch);
assert.equal(mirror.snapshot().length, 3, "hydrate adds earlier branch chat without duplicating streamed rows");
chatHooks.get("message_start")({ message: { ...assistant, content: [] } });
mirror.hydrate(branch);
chatHooks.get("message_update")({ message: { ...assistant, content: [{ type: "text", text: "Same-millisecond second reply" }] } });
assert.equal(mirror.snapshot().length, 4, "same-millisecond messages keep independent ids across reopen");
assert.equal(mirror.snapshot().at(-1).text, "Same-millisecond second reply");
chatHooks.get("message_end")({ message: { role: "assistant", timestamp: 3, content: [{ type: "text", text: "x".repeat(70_000) }] } });
assert(mirror.snapshot().at(-1).truncated);
const toolTurn = { role: "assistant", timestamp: 3.5, content: [{ type: "thinking", thinking: "Plan the edit" }, { type: "toolCall", id: "call_1", name: "edit", arguments: { path: "C:/a.ts", edits: [] } }] };
chatHooks.get("message_start")({ message: toolTurn }); chatHooks.get("message_end")({ message: toolTurn });
chatHooks.get("message_end")({ message: { role: "toolResult", toolCallId: "call_1", toolName: "edit", content: [{ type: "text", text: "Edited" }], isError: true } });
const blocks = mirror.snapshot().at(-1).blocks;
assert.deepEqual(blocks.map(block => block.type === "tool" ? [block.title, block.result, block.error] : [block.type, block.text]), [["thinking", "Plan the edit"], ["edit C:/a.ts", "Edited", true]], "thinking and tool calls become collapsed blocks; the result joins its call");
assert.equal(mirror.snapshot().at(-1).text, "");
const brief = mirror.page().rows.at(-1);
assert(brief.brief && !brief.excerpt && brief.blocks[0].text === "" && brief.blocks[1].args === "" && brief.blocks[1].result === "" && brief.blocks[1].title === "edit C:/a.ts", "check-in rows keep block titles and completion only");
assert.equal(mirror.row(brief.id).blocks[1].result, "Edited", "full row on expand");
{ const writeTurn = { role: "assistant", timestamp: 3.6, content: [{ type: "toolCall", id: "call_w", name: "write", arguments: { path: "b.ts", content: "one\ntwo" } }] };
 chatHooks.get("message_start")({ message: writeTurn }); chatHooks.get("message_end")({ message: writeTurn });
 assert.equal(mirror.snapshot().at(-1).blocks[0].diff, "+one\n+two", "a write shows its content as added lines"); }
{ const askTurn = { role: "assistant", timestamp: 3.7, content: [{ type: "toolCall", id: "call_a", name: "ask_user", arguments: { question: "Open http://x/ ?", context: "Why", options: [{ title: "Yes" }, { title: "No" }] } }] };
 chatHooks.get("message_start")({ message: askTurn }); chatHooks.get("message_end")({ message: askTurn });
 chatHooks.get("message_end")({ message: { role: "toolResult", toolCallId: "call_a", content: [{ type: "text", text: "User answered: Yes" }] } });
 const ask = mirror.page().rows.at(-1).blocks[0];
 assert.deepEqual([ask.ask, ask.result], [[{ question: "Open http://x/ ?", context: "Why", options: ["Yes", "No"] }], "User answered: Yes"], "ask_user keeps its questions and answer in check-in rows"); }
const long = mirror.page().rows.find(row => row.text.length === 2000); assert(long?.excerpt, "long text is a 2 KB excerpt");
assert.throws(() => mirror.row("missing"), /Unknown chat row/);
for (let timestamp = 4; timestamp < 110; timestamp++) chatHooks.get("message_end")({ message: { role: "user", timestamp, content: "recent" } });
assert.equal(mirror.snapshot().length, 100);
{
 const hooks = new Map(), events = [], live = createChatMirror({ on: (name, handler) => hooks.set(name, handler) }, (event, value) => events.push({ event, value }));
 const turn = text => ({ role: "assistant", timestamp: 50, content: [{ type: "text", text }] });
 hooks.get("message_start")({ message: turn("") });
 for (let i = 1; i <= 20; i++) hooks.get("message_update")({ message: turn("a".repeat(i)) });
 assert.equal(events.length, 1, "token updates within 250 ms coalesce");
 await new Promise(resolve => setTimeout(resolve, 300));
 assert.deepEqual(events.map(item => item.event), ["delta", "delta"]);
 assert.deepEqual([events[1].value.offset, events[1].value.text], [0, "a".repeat(20)], "a delta appends only the unsent text");
 hooks.get("message_update")({ message: { ...turn("a".repeat(20)), content: [{ type: "text", text: "a".repeat(20) }, { type: "toolCall", id: "c", name: "read", arguments: { path: "x" } }] } });
 hooks.get("message_end")({ message: { ...turn("a".repeat(25)), content: [{ type: "text", text: "a".repeat(25) }, { type: "toolCall", id: "c", name: "read", arguments: { path: "x" } }] } });
 const final = events.at(-1).value;
 assert.deepEqual([final.offset, final.text, final.streaming], [20, "aaaaa", false], "message_end flushes at once");
 assert.equal(final.blocks[0].title, "read x"); assert.equal(final.blocks[0].args, "", "blocks travel brief");
 hooks.get("message_end")({ message: { role: "toolResult", toolCallId: "c", content: [{ type: "text", text: "body" }] } });
 assert.deepEqual([events.at(-1).value.offset, events.at(-1).value.text, events.at(-1).value.blocks[0].result], [25, "", ""], "a tool result resends only brief blocks");
 live.reset();
}
const newest = mirror.page(); assert.equal(newest.rows.length, 20); assert(newest.more);
const older = mirror.page(newest.rows[0].id); assert.equal(older.rows.at(-1).id, mirror.snapshot()[79].id, "Show earlier pages back without overlap");
assert.equal(mirror.page(mirror.snapshot()[10].id).more, false);
// C-WEB byte budgets (D21).
{
 const hooks = new Map(), big = createChatMirror({ on: (name, handler) => hooks.set(name, handler) }, () => {});
 const wide = "😀界é".repeat(1200);
 for (let t = 1; t <= 100; t++) hooks.get("message_end")({ message: { role: t % 2 ? "user" : "assistant", timestamp: 1000 + t, content: wide } });
 const live = { working: true, thinking: "思".repeat(64_000), tools: [{ id: "t", name: "bash", state: "running", args: "x".repeat(16_000), progress: "y".repeat(16_000) }, { id: "d", name: "read", state: "done", result: "z".repeat(16_000) }], queue: Array.from({ length: 100 }, (_, i) => ({ id: "q" + i, text: "q".repeat(5000), delivery: "followUp" })) };
 const question = { askId: "11111111-2222-4333-8444-555555555555", question: "Pick one", context: "Ω".repeat(200_000), options: [{ title: "A" }] };
 const packet = checkIn(big, live, [question], { target: { kind: "plan", id: "12345678" } }), size = Buffer.byteLength(JSON.stringify(packet));
 assert(size <= 64_000, `check-in snapshot is ${size} bytes`);
 assert.equal(packet.chat.at(-1).id, big.snapshot().at(-1).id, "the newest row survives the budget"); assert(packet.more);
 assert(packet.chat.every(row => row.excerpt && !/[\ud800-\udbff]$/.test(row.text)), "excerpts never split a surrogate pair");
 assert(packet.dialogs[0].brief && packet.dialogs[0].title === "Pick one" && !("context" in packet.dialogs[0]), "a large question travels brief");
 assert.deepEqual(packet.activity.tools.map(tool => tool.id), ["t"]); assert.equal(packet.activity.thinkingLength, 64_000);
}
// P4-02: Files API (D11, D21): hidden paths, change marks, diffs that never show secrets.
{
 const { listFiles, readProjectFile, readProjectDiff, FileRefused } = await import("../src/files.ts");
 const { execFileSync } = await import("node:child_process"), { mkdir } = await import("node:fs/promises");
 const repo = await mkdtemp(join(tmpdir(), "plan3-files-test-")), run = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, stdio: "pipe" });
 try {
  const plain = await mkdtemp(join(tmpdir(), "plan3-files-plain-"));
  await mkdir(join(plain, "src")); await mkdir(join(plain, "node_modules")); await writeFile(join(plain, "src", "a.ts"), "x"); await writeFile(join(plain, "node_modules", "b.js"), "x"); await writeFile(join(plain, ".env"), "K=1");
  assert.deepEqual(await listFiles(plain), { files: [{ path: "src/a.ts", size: 1 }], truncated: false, git: false }, "a walk outside git still hides secrets and generated folders");
  await rm(plain, { recursive: true, force: true });
  run("init", "-q");
  assert.deepEqual(await readProjectDiff(repo, "x.txt").catch(error => error.constructor.name), "FileRefused", "a missing file is refused, not crashed");
  await writeFile(join(repo, "first.txt"), "one\n"); assert.deepEqual(await readProjectDiff(repo, "first.txt"), { path: "first.txt", diff: "", content: "one\n" }, "an unborn repository shows content");
  await writeFile(join(repo, "keep.txt"), "a\nb\n"); await writeFile(join(repo, "gone.txt"), "bye\n"); await writeFile(join(repo, "old.txt"), "same content here\n".repeat(5));
  await writeFile(join(repo, "conf.txt"), "password = 'abcdefghijkl'\nport = 1\n"); await writeFile(join(repo, ".gitignore"), "ignored.log\n");
  run("add", "-A"); run("commit", "-qm", "base");
  await writeFile(join(repo, "keep.txt"), "a\nB\n"); await rm(join(repo, "gone.txt")); run("mv", "old.txt", "new.txt");
  await writeFile(join(repo, "conf.txt"), "port = 1\n"); await writeFile(join(repo, "fresh.txt"), "new\n"); await writeFile(join(repo, "ignored.log"), "x"); await writeFile(join(repo, ".env.local"), "K=1");
  const { files, git } = await listFiles(repo);
  assert.equal(git, true);
  assert.deepEqual(files, [{ path: ".gitignore", size: 12 }, { path: "conf.txt", change: "M", size: 9 }, { path: "first.txt", size: 4 }, { path: "fresh.txt", change: "??", size: 4 }, { path: "gone.txt", change: "D" }, { path: "keep.txt", change: "M", size: 4 }, { path: "new.txt", change: "R", size: 90 }]);
  assert.match((await readProjectDiff(repo, "keep.txt")).diff, /^-b$[\s\S]*^\+B$/m);
  assert.match((await readProjectDiff(repo, "gone.txt")).diff, /deleted file mode/, "a deleted file shows its diff without the file existing");
  assert.match((await readProjectDiff(repo, "new.txt")).diff, /rename from old\.txt/, "staged renames are diffed against HEAD");
  assert.deepEqual(await readProjectDiff(repo, "fresh.txt"), { path: "fresh.txt", diff: "", content: "new\n" }, "untracked files show content");
  await assert.rejects(readProjectDiff(repo, "conf.txt"), /secret/, "a removed secret line is never shown");
  for (const bad of [".env.local", "../escape.txt", "C:/Windows/win.ini", "a\u0000b", "", 5]) await assert.rejects(readProjectFile(repo, bad), FileRefused, String(bad));
  await assert.rejects(readProjectDiff(repo, ".env.local"), FileRefused);
  assert.deepEqual(await readProjectFile(repo, "keep.txt"), { path: "keep.txt", content: "a\nB\n" });
  await mkdir(join(repo, "sub")); await writeFile(join(repo, "sub", "s.txt"), "line\n".repeat(9) + "s\n"); run("add", "sub/s.txt"); run("commit", "-qm", "sub"); await writeFile(join(repo, "sub", "s.txt"), "line\n".repeat(9) + "S\n"); run("mv", "sub/s.txt", "sub/t.txt");
  assert.deepEqual((await listFiles(join(repo, "sub"))).files, [{ path: "t.txt", change: "RM", size: 47 }], "a session in a subfolder sees cwd-relative marks only");
  assert.match((await readProjectDiff(join(repo, "sub"), "t.txt")).diff, /rename from sub\/s\.txt/);
 } finally { await rm(repo, { recursive: true, force: true }); }
}
{
 // Images anywhere on this PC are served (another project's render), except under hidden dot-folders.
 const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
 const root = await mkdtemp(join(tmpdir(), "plan3-image-")), png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
 await mkdir(join(root, "other", ".secret"), { recursive: true }); await writeFile(join(root, "other", "front.png"), png); await writeFile(join(root, "other", ".secret", "x.png"), png);
 assert.equal((await readLinkedImage(join(root, "other", "front.png"), join(root, "project"))).type, "image/png");
 await assert.rejects(readLinkedImage(join(root, "other", ".secret", "x.png"), join(root, "project")), error => error.status === 403);
 // Dropped files from a remote device: any type keeps a safe name in its own temp folder; SVG is served as an image.
 const svg = await savePastedImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), root, "..\\..\\my house.svg");
 assert.match(svg, /[\\/]pi-upload-[0-9a-f-]{36}[\\/]my_house\.svg$/);
 assert.equal((await readLinkedImage(svg)).type, "image/svg+xml");
 assert.match(await savePastedImage(Buffer.from("notes"), root, ".env"), /[\\/]env$/, "a leading dot cannot hide the file");
 await assert.rejects(savePastedImage(Buffer.from("x"), root), error => error.status === 415, "an unnamed non-image is refused");
 await writeFile(join(root, "fake.svg"), "not svg"); await assert.rejects(readLinkedImage(join(root, "fake.svg")), error => error.status === 415);
 await rm(root, { recursive: true });
}
console.log("chat files images ok");
