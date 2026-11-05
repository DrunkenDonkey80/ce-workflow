// Explore: an archive unpacks once into a temp folder, its files serve under /x/<key>/, nothing outside it does.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rename, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { explore, sendExplored, unview, viewers, viewPage } from "../src/explore.ts";

const work = await mkdtemp(join(tmpdir(), "pi-hub-explore-test-"));
try {
	await mkdir(join(work, "site", "img"), { recursive: true });
	await writeFile(join(work, "site", "index.html"), "<img src=img/a.png>");
	await writeFile(join(work, "site", "img", "a.png"), "PNG");
	await writeFile(join(work, "site", "notes.md"), "# Hi");
	const archive = join(work, "site.tar");
	execFileSync(process.platform === "win32" ? join(process.env.SystemRoot, "System32", "tar.exe") : "tar", ["-cf", archive, "-C", join(work, "site"), "."]);

	const first = await explore(archive), again = await explore(archive);
	assert.equal(first.key, again.key, "unpacked once per hub run");
	assert.match(first.key, /^[0-9a-f]{32}$/);
	assert.deepEqual(first.files.map(file => [file.path.replace(/^\.\//, ""), file.size]), [["img/a.png", 3], ["index.html", 19], ["notes.md", 4]], "files with sizes, sorted");
	await assert.rejects(explore(join(work, "site", "notes.md")), /Only zip, 7z/);

	const fetchLike = async (path) => {
		const response = { head: null, status: 0, body: "", writeHead(status, head) { this.status = status; this.head = head; }, end(text) { this.body += text ?? ""; this.done(); }, destroy() { this.done(); },
			write(chunk) { this.body += chunk; return true; }, on() { return this; }, once() { return this; }, emit() { return true; }, removeListener() { return this; } };
		const finished = new Promise(done => { response.done = done; });
		const handled = await sendExplored(path, false, "http://127.0.0.1:1", response);
		if (handled) await finished;
		return handled && response;
	};
	const page = await fetchLike(`/x/${first.key}/img/a.png`);
	assert.deepEqual([page.status, page.head["content-type"], page.body], [200, "image/png", "PNG"], "a file inside serves");
	assert.match((await fetchLike(`/x/${first.key}/index.html`)).head["content-security-policy"], /^sandbox allow-scripts allow-popups allow-pointer-lock allow-downloads; default-src http:\/\/127\.0\.0\.1:1 https: /, "pages run sandboxed: this host and https CDNs");
	assert.equal((await fetchLike(`/x/${first.key}/..%2F..%2F${encodeURIComponent(archive.split(/[\\/]/).pop())}`)).status, 404, "no way out of the folder");
	assert.equal((await fetchLike(`/x/${"0".repeat(32)}/index.html`)).status, 404, "unknown key");
	assert.equal(await fetchLike("/s/x"), false, "other paths are not explore URLs");

	// View page: the HTML's folder serves live, each file checked like a chat link (no dotfiles; remotely, the project only).
	await writeFile(join(work, "site", ".env"), "SECRET=1");
	const view = await viewPage(join(work, "site", "index.html"), join(work, "site"), true);
	assert.equal(view.open, "index.html");
	assert.deepEqual(view.files.map(file => file.path), ["img/a.png", "index.html", "notes.md"], "hidden files are not listed");
	assert.equal((await fetchLike(`/x/${view.key}/img/a.png`)).status, 200);
	await writeFile(join(work, "site", "img", "later.md"), "new");
	assert.equal((await fetchLike(`/x/${view.key}/img/later.md`)).status, 200, "live: files written after opening serve too");
	assert.equal((await fetchLike(`/x/${view.key}/.env`)).status, 404, "no dotfiles");
	const old = new Date(Date.now() - 10 * 864e5); await utimes(join(work, "site", "notes.md"), old, old); // recent temp files stay open to remote, like chat links
	const outside = await viewPage(join(work, "site", "index.html"), join(work, "elsewhere"), true);
	assert.equal((await fetchLike(`/x/${outside.key}/notes.md`)).status, 404, "remotely, files outside the project stay closed");
	const md = await viewPage(join(work, "site", "notes.md"), work, false);
	assert.deepEqual([md.open, md.files.map(file => file.path)], ["notes.md", ["notes.md"]], "any other file: shown alone, its folder not walked");
	assert.equal((await fetchLike(`/x/${md.key}/notes.md`)).status, 200);

	// Live preview (S01): each viewer has its own key; the files it served are watched, a change notifies that key once.
	const live = join(work, "live"); await mkdir(live);
	for (const [name, text] of [["a.html", "<link href=a.css>"], ["a.css", "a{}"], ["b.html", "<link href=b.css>"], ["b.css", "b{}"], ["other.txt", "x"]]) await writeFile(join(live, name), text);
	const events = [], sleep = ms => new Promise(done => setTimeout(done, ms));
	const notify = key => events.push(key);
	const a = await viewPage(join(live, "a.html"), live, false, { owner: "s1", notify }), b = await viewPage(join(live, "b.html"), live, false, { owner: "s1", notify });
	assert.notEqual(a.key, b.key, "two viewers of one folder get their own keys");
	for (const path of [`/x/${a.key}/a.html`, `/x/${a.key}/a.css`, `/x/${b.key}/b.html`, `/x/${b.key}/b.css`]) assert.equal((await fetchLike(path)).status, 200);
	const settle = async () => { await sleep(500); const got = events.splice(0); return got; };
	await settle();
	await writeFile(join(live, "a.css"), "a{color:red}");
	assert.deepEqual(await settle(), [a.key], "a's stylesheet changed: only a's viewer, once");
	await writeFile(join(live, "other.txt"), "y");
	assert.deepEqual(await settle(), [], "a file no viewer served: nothing");
	for (const round of [1, 2]) { await writeFile(join(live, "b.css.tmp"), `b{${round}}`); await rename(join(live, "b.css.tmp"), join(live, "b.css")); assert.deepEqual(await settle(), [b.key], `atomic save ${round}: one notice`); }
	await rm(join(live, "a.css")); await sleep(50); await writeFile(join(live, "a.css"), "a{}");
	assert.deepEqual(await settle(), [a.key], "delete then recreate: one notice");
	assert.equal(unview(a.key, "s2"), false, "another session cannot close it");
	assert.equal(unview(a.key, "s1"), true);
	await writeFile(join(live, "a.css"), "a{x}");
	assert.deepEqual(await settle(), [], "a closed viewer gets nothing");
	assert.equal((await fetchLike(`/x/${a.key}/a.css`)).status, 404, "and its key no longer serves");
	viewers("s1", 0, 10); await sleep(50);
	assert.equal((await fetchLike(`/x/${b.key}/b.css`)).status, 404, "no page left for the session: its viewers close");
	console.log("explore ok");
} finally { await rm(work, { recursive: true, force: true }); }
