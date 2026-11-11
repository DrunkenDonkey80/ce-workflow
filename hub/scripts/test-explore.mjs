// Explore: an archive unpacks once into a temp folder, its files serve under /x/<key>/, nothing outside it does.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rename, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { designLists, designPage, explore, sendExplored, unview, viewers, viewPage, watchDesign } from "../src/explore.ts";
import { appStarter } from "../../extensions/design-app.ts";
import { appPublication, BUILD_STATUS, ensureAppBuilt } from "../../extensions/design-build.ts";

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

	// S08: design screens are HTML files directly in the folder; adding or removing one, or a new version, sends one design-changed.
	const project = join(work, "proj"), design = join(project, ".pi", "designs", "design-1");
	await mkdir(join(design, "sub"), { recursive: true });
	for (const [name, text] of [["index.html", "<h1>i</h1>"], ["b.html", "b"], ["sub/c.html", "c"], ["styles.css", ""]]) await writeFile(join(design, name), text);
	assert.equal(await designPage(project, "design-1", "sub/c.html"), undefined, "screens are directly in the folder");
	assert.equal(await designPage(project, "design-1", "../design-1/b.html"), undefined);
	assert.equal(await designPage(project, "design-1", "styles.css"), undefined, "only HTML");
	assert.match(await designPage(project, "design-1", "b.html"), /b\.html$/);
	assert.deepEqual(await designLists(project, "design-1"), { screens: ["index.html", "b.html"], versions: [] });
	const lists = [], d = await viewPage(join(design, "index.html"), project, false, { owner: "s3", notify: () => {} }, true);
	await watchDesign(d.key, project, "design-1", value => lists.push(value));
	const changes = async () => { await sleep(600); return lists.splice(0); };
	await writeFile(join(design, "index.html"), "<h1>edited</h1>");
	assert.deepEqual(await changes(), [], "a plain save is not a list change");
	await writeFile(join(design, "a.html"), "a");
	assert.deepEqual(await changes(), [{ screens: ["index.html", "a.html", "b.html"], versions: [] }], "a new screen");
	await rm(join(design, "b.html"));
	assert.deepEqual(await changes(), [{ screens: ["index.html", "a.html"], versions: [] }], "a removed screen");
	await mkdir(join(project, ".pi", "designs", "history", "design-1", "1"));
	await writeFile(join(project, ".pi", "designs", "history", "design-1", "1", "index.html"), "v1");
	assert.deepEqual(await changes(), [{ screens: ["index.html", "a.html"], versions: [1] }], "a new version");
	// S10: a design session's own pages carry the comment bridge (with a matching length); other explored pages do not.
	const bridged = await fetchLike(`/x/${d.key}/index.html`);
	assert.match(bridged.body, /^<h1>edited<\/h1><script data-design-chrome>[\s\S]*design:pick[\s\S]*<\/script>$/);
	assert.equal(bridged.head["content-length"], Buffer.byteLength(bridged.body));
	assert.match(bridged.head["content-security-policy"], /sandbox [^;]*\ballow-forms\b/, "own designs permit local submit handlers");
	assert.match(bridged.head["content-security-policy"], /; form-action 'none'/, "native form navigation is forbidden");
	assert.doesNotMatch(bridged.head["content-security-policy"], /allow-same-origin|allow-top-navigation|allow-popups-to-escape-sandbox/);
	assert.doesNotMatch((await fetchLike(`/x/${view.key}/index.html`)).head["content-security-policy"], /allow-forms|form-action/, "generic live HTML keeps its original policy");
	assert.doesNotMatch((await fetchLike(`/x/${first.key}/index.html`)).body, /data-design-chrome/, "an explored archive page is served as it is");
	await writeFile(join(design, "page.html"), "<body><p>x</p></body></html>");
	assert.match((await fetchLike(`/x/${d.key}/page.html`)).body, /<p>x<\/p><script data-design-chrome>[\s\S]*<\/script><\/body><\/html>$/, "before the closing body tag");
	await rm(join(design, "page.html")); await changes();
	// S09: a kept version is its own handle's history folder only.
	assert.match(await designPage(project, "design-1", "index.html", 1), /history.design-1.1.index.html$/);
	await mkdir(join(project, ".pi", "designs", "history", "design-2", "5"), { recursive: true }); await writeFile(join(project, ".pi", "designs", "history", "design-2", "5", "index.html"), "x");
	for (const version of [5, 0, -1, 1.5, 2]) assert.equal(await designPage(project, "design-1", "index.html", version), undefined, String(version));
	unview(d.key, "s3");
	await writeFile(join(design, "z.html"), "z");
	assert.deepEqual(await changes(), [], "a closed design view stops watching");
	// Component views remain on a complete immutable generation throughout failed/partial source publication.
	const component = join(project,".pi/designs/design-3");await mkdir(component,{recursive:true});
	const source=appStarter("Component"), output=new Map([["index.html",Buffer.from("<h1>Good component</h1>")]]);
	const put=async files=>{for(const [name,bytes]of files){await mkdir(join(component,name,".."),{recursive:true});await writeFile(join(component,name),bytes);}};
	await put(appPublication(source,output));
	await ensureAppBuilt(component,{runtime:async()=>assert.fail("verified output works offline without a dependency cache")});
	const good=await designPage(project,"design-3");assert.match(good,/\.design-preview.[a-f0-9]{64}.index.html$/);
	const componentView=await viewPage(good,project,true,{owner:"component",notify},true), componentChanges=[];
	await watchDesign(componentView.key,project,"design-3",value=>componentChanges.push(value));
	await writeFile(join(component,"index.html"),"HALF WRITTEN");
	await writeFile(join(component,BUILD_STATUS),JSON.stringify({state:"failed",error:"Syntax error in the draft"}));
	assert.equal(await designPage(project,"design-3"),good,"uncommitted root HTML never becomes the live preview");
	assert.match((await fetchLike(`/x/${componentView.key}/index.html`)).body,/Good component/);
	await sleep(500);assert(componentChanges.some(value=>value.build?.state==="failed"),"failure reaches existing preview status controls");
	const oldGeneration=(await designLists(project,"design-3")).build.generation;
	source.set("src/App.jsx",Buffer.from("// refined"));output.set("index.html",Buffer.from("<h1>Refined component</h1>"));
	await put(appPublication(source,output));await ensureAppBuilt(component,{runtime:async()=>assert.fail("matching retained output needs no compiler")});
	const latest=await designPage(project,"design-3");assert.notEqual(latest,good);
	await sleep(500);assert(componentChanges.some(value=>value.build?.generation && value.build.generation!==oldGeneration),"the complete new generation reaches the existing preview");
	assert.match((await fetchLike(`/x/${componentView.key}/index.html`)).body,/Good component/,"old viewer stays internally coherent until it reopens the new generation");
	unview(componentView.key,"component");
	console.log("explore ok");
} finally { await rm(work, { recursive: true, force: true }); }
