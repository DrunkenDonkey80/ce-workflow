// Explore: an archive unpacks once into a temp folder, its files serve under /x/<key>/, nothing outside it does.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { explore, sendExplored } from "../src/explore.ts";

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
	assert.match((await fetchLike(`/x/${first.key}/index.html`)).head["content-security-policy"], /^sandbox allow-scripts allow-popups; default-src http:\/\/127\.0\.0\.1:1 /, "pages run sandboxed, this host only");
	assert.equal((await fetchLike(`/x/${first.key}/..%2F..%2F${encodeURIComponent(archive.split(/[\\/]/).pop())}`)).status, 404, "no way out of the folder");
	assert.equal((await fetchLike(`/x/${"0".repeat(32)}/index.html`)).status, 404, "unknown key");
	assert.equal(await fetchLike("/s/x"), false, "other paths are not explore URLs");
	console.log("explore ok");
} finally { await rm(work, { recursive: true, force: true }); }
