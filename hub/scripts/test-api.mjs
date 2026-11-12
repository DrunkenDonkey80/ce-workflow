// H5-03: the page API under /s/<id>/api/ (endpoint map in plan 0db155f7 Findings) and the request checks kept from plan3-web.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { addDesignReference, designReferences, editDesignReference, publishFound, referenceAssets } from "../../extensions/design-references.ts";
import { saveDiagram } from "../../extensions/plan3-diagram.ts";
import { authorizeReferenceBundle, deliverReferenceBundle, freezeReferenceBundle, referenceBundle, referenceBundleAssets } from "../../extensions/design-bundles.ts";
import { appStarter } from "../../extensions/design-app.ts";
import { runDesign, writeRefusal } from "../../extensions/design.ts";
import { appPublication, ensureAppBuilt } from "../../extensions/design-build.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-api-"));
process.env.PI_CODING_AGENT_DIR = root;
const { startHub } = await import("../src/hub.ts");
{ // CU-04: background git reads never take the optional index lock, whatever the parent set.
	const { gitReadEnv } = await import("../src/files.ts");
	const saved = process.env.GIT_OPTIONAL_LOCKS; process.env.GIT_OPTIONAL_LOCKS = "1";
	const env = gitReadEnv();
	assert.equal(env.GIT_OPTIONAL_LOCKS, "0"); assert.equal(env.PI_CODING_AGENT_DIR, root);
	if (saved === undefined) delete process.env.GIT_OPTIONAL_LOCKS; else process.env.GIT_OPTIONAL_LOCKS = saved;
}
const folder = path.join(root, "proj");
fs.mkdirSync(path.join(folder, "docs", "plans"), { recursive: true });
const plan = (id, title, updated, status = "active") => {
	const file = path.join(folder, "docs", "plans", `2026-10-18-${title.toLowerCase()}-${id}-plan3.md`);
	fs.writeFileSync(file, `---\nplan3: true\nstatus: ${status}\ncreated: 2026-10-18\nupdated: ${updated}\n---\n\n# ${title}\n\n## Steps\n\n- [x] **A-01** one\n- [ ] **A-02** two\n`);
	return { kind: "plan", plan: { id, file, title } };
};
const older = plan("aaaaaaaa", "Older", "2026-10-18T10:00:00Z");
plan("bbbbbbbb", "Newer", "2026-10-18T12:00:00Z");
plan("cccccccc", "Finished", "2026-10-18T13:00:00Z", "complete");
await saveDiagram(folder, older, { version: 1, kind: "plan", plan: "aaaaaaaa", title: "Older", revision: 0, nodes: [{ id: "api", label: "API", kind: "service" }], edges: [], notes: [] }, 0);
fs.writeFileSync(path.join(folder, "notes.txt"), "hello\n");
fs.writeFileSync(path.join(folder, ".env"), "SECRET=1\n");
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
fs.writeFileSync(path.join(folder, "shot.png"), png);

// S-10: Pi's SDK stands in as a fake; a parked session reads its model from the file once and keeps it.
let fileReads = 0;
const models = {
	fromFile: async () => { fileReads++; return { model: { provider: "fake", id: "fake-2", name: "Fake Two" }, thinking: "high" }; },
	scoped: async () => ({ models: scopedList, unresolved: ["gone/*"] }),
	available: async () => [...scopedList, { provider: "fake", id: "fake-3", name: "Fake Three" }].filter((model, index, list) => list.findIndex(other => other.id === model.id) === index),
	setScoped: async (_folder, ref, on) => { scopedList = scopedList.filter(model => model.provider + "/" + model.id !== ref); if (on) scopedList.push({ provider: "fake", id: ref.split("/")[1], name: ref }); },
	defaultModel: async () => defaultModel, setDefault: async (provider, id, effort) => { defaultModel = provider + "/" + id; defaultEffort = effort; },
};
let defaultModel = "fake/fake-2"; let defaultEffort;
let scopedList = [{ provider: "fake", id: "fake-1", name: "Fake One" }, { provider: "fake", id: "fake-2", name: "Fake Two" }];
// The /wo roles are real: they edit a settings.json, here a temp one that keeps its other keys.
const rolesDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-roles-"));
fs.writeFileSync(path.join(rolesDir, "settings.json"), JSON.stringify({ theme: "dark", workOrchestrator: { plan3: { models: [{ model: "other/x", thinking: "low" }] } } }));
const { roles, setRole } = (await import("../src/pi-sdk.ts")).piModels(rolesDir); Object.assign(models, { roles, setRole });
const hub = await startHub({ command: [process.execPath, fileURLToPath(new URL("./fake-pi.mjs", import.meta.url))], models });
const { port, localKey } = hub.config;
const origin = `http://127.0.0.1:${port}`;
const auth = { authorization: `Bearer ${localKey}`, connection: "close" };
const get = async (id, route) => { const r = await fetch(`${origin}/s/${id}/api/${route}`, { headers: auth }); return { status: r.status, body: r.headers.get("content-type")?.startsWith("application/json") ? await r.json() : Buffer.from(await r.arrayBuffer()), headers: r.headers }; };
const post = async (id, route, data, headers = {}) => {
	const r = await fetch(`${origin}/s/${id}/api/${route}`, { method: "POST", headers: { ...auth, origin, "content-type": "application/json", ...headers }, body: Buffer.isBuffer(data) ? data : JSON.stringify(data) });
	return { status: r.status, body: await r.json() };
};
/** A raw request, so Host can be anything (fetch always sets it from the URL). */
const rawGet = (pathname, headers) => new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port, path: pathname, headers }, response => { response.resume(); resolve(response.statusCode); }).on("error", reject));
const until = async test => { for (let i = 0; i < 200; i++) { const value = await test(); if (value) return value; await new Promise(r => setTimeout(r, 10)); } throw new Error("timed out"); };

try {
	fs.writeFileSync(path.join(folder, "s.jsonl"), "");
	const record = hub.registry.add({ name: "1", folder, sessionFile: path.join(folder, "s.jsonl"), state: "parked" });
	const id = record.id;

	// Library metadata uses this project's pinned index; no runtime/provisioning or Pi start on reads.
	const cache = path.join(folder, ".pi/designs/systems/index.json"), commit = "1".repeat(40);
	fs.mkdirSync(path.dirname(cache), { recursive: true });
	fs.writeFileSync(cache, JSON.stringify({ commit, names: ["example", "../../escape"], fetched: Date.now() }));
	const catalog = await get(id, "designcatalog");
	assert.equal(catalog.status, 200);
	assert.deepEqual(catalog.body.entries.filter(item => item.source === "od").map(item => [item.id, item.revision]), [["od:example", commit], ["od-colors:example", commit]]);
	assert.equal(catalog.body.entries.filter(item => item.kind === "component").length, 174);
	assert.equal(catalog.body.entries.filter(item => item.kind === "theme").length, 8, "7 Astryx themes and the OpenDesign colors page");
	assert(catalog.body.entries.every(item => item.license && item.provenance && item.revision));
	const shots = JSON.parse(fs.readFileSync(new URL("../../extensions/astryx-runtime/previews/components/components.json", import.meta.url), "utf8"));
	for (const item of catalog.body.entries.filter(entry => entry.kind === "component")) {
		const pictured = Object.hasOwn(shots.images, item.name);
		assert.deepEqual([item.preview, item.availability, item.imageRevision], pictured ? ["image", "cached", item.revision] : ["none", "unavailable", undefined], `${item.name}: a picture only when one was rendered for this pin`);
	}
	const picturedButton = await get(id, `designimage?id=astryx:component:Button&revision=${shots.lockDigest}`);
	assert.equal(picturedButton.status, 200); assert.equal(picturedButton.body.toString("ascii", 8, 12), "WEBP");
	assert.equal((await get(id, `designimage?id=astryx:component:Button&revision=${"0".repeat(64)}`)).status, 404, "a component picture from another pin is never served");
	assert.equal((await get(id, `designimage?id=${encodeURIComponent("astryx:component:../catalog")}&revision=${shots.lockDigest}`)).status, 404, "component picture names are a whitelist");
	const buttonDocs = await get(id, "designdocs?id=astryx:component:Button");
	assert.equal(buttonDocs.status, 200); assert(buttonDocs.body.description && buttonDocs.body.props.some(prop => prop.name === "label" && prop.required), "Inspect gets bundled usage and props without a runtime");
	assert.equal((await get(id, "designdocs?id=astryx:component:__proto__")).status, 404, "docs names are own keys only");
	assert.equal(hub.host.live.has(id), false, "browsing does not wake a parked model");
	assert.equal(await rawGet(`/s/${id}/api/designcatalog`, {}), 401, "catalog requires normal session authentication");
	const images = catalog.body.entries.filter(item => item.preview === "image" && item.kind === "theme");
	assert.deepEqual(images.map(item => item.id.slice(13)).sort(), Object.keys(shots.themes).sort(), "every pinned theme has its rendered picture");
	assert.equal(images.length, 7);
	assert(images.every(item => Object.values(item.colors ?? {}).length === 9 && Object.values(item.colors).every(hex => /^#[0-9a-f]{6}$/.test(hex))), "theme cards carry their nine swatches as hex");
	for (const item of images) {
		assert.equal(item.imageRevision, shots.lockDigest, "theme pictures belong to the rendered set for this pin");
		const route = `designimage?id=${encodeURIComponent(item.id)}&revision=${item.imageRevision}`, image = await get(id, route);
		assert.equal(image.status, 200); assert.equal(image.headers.get("content-type"), "image/webp");
		assert.equal(image.body.toString("ascii", 0, 4), "RIFF"); assert.equal(image.body.toString("ascii", 8, 12), "WEBP");
		assert(image.body.length < 256_000, "bundled source images stay bounded");
		assert.equal(await rawGet(`/s/${id}/api/${route}`, {}), 401, "image bytes require session authentication too");
	}
	assert.equal((await get(id, `designimage?id=astryx:theme:neutral&revision=${"0".repeat(40)}`)).status, 404, "a stale image revision never serves different bytes");
	assert.equal((await get(id, `designimage?id=../../sessions.json&revision=${images[0].imageRevision}`)).status, 404, "image names are a whitelist, not filesystem paths");
	assert.equal((await get(id, `designimage?id=astryx:theme:__proto__&revision=${images[0].imageRevision}`)).status, 404, "theme picture names are own keys only");
	assert.equal(hub.host.live.has(id), false, "images do not wake a parked model");
	{
		const input = { action: "add", id: images[0].id, revision: images[0].revision, aspect: "colors", note: "<img src=x onerror=alert(1)>" };
		const duplicates = await Promise.all([post(id, "designreference", input), post(id, "designreference", input)]);
		assert(duplicates.every(result => result.status === 200)); assert.equal(duplicates[0].body.ref, duplicates[1].body.ref, "duplicate writers share one stable reference identity");
		let ref = (await get(id, "designreferences")).body.refs[0]; assert.equal(ref.ref, "ref1"); assert.equal(ref.status, "ready"); assert.equal(ref.note, input.note);
		assert.equal(await rawGet(`/s/${id}/api/designreferences`, {}), 401);
		assert.equal((await post(id, "designreference", { ...input, path: "../escape" })).status, 400);
		assert.equal((await post(id, "designreference", { ...input, aspect: "not-an-aspect" })).status, 400);
		assert.equal((await post(id, "designreference", { ...input, revision: "0".repeat(64) })).status, 409);
		assert.equal((await post(id, "designreference", { ...input, region: [0, 0, 1, 1] })).status, 400);
		assert.equal((await get(id, "designreferenceimage?ref=ref1")).status, 200);
		const region = await post(id, "designreference", { ...input, aspect: "region", region: [12, 16, 80, 40] });
		assert.equal(region.status, 200);
		const cropped = await get(id, `designreferenceimage?ref=${region.body.ref}`);
		assert.equal(cropped.body.readUInt32BE(0), 0x89504e47, "region thumbnails must contain cropped PNG pixels, not the full WebP image");
		assert.equal(cropped.body.readUInt32BE(16), 80); assert.equal(cropped.body.readUInt32BE(20), 40);
		assert.deepEqual(region.body.region, [12, 16, 80, 40]);
		assert(referenceAssets(folder, id, region.body.ref).files.has("source.webp"), "a crop keeps its original source for provenance");
		assert.equal((await post(id, "designreference", { ...input, aspect: "region" })).status, 400);
		assert.equal((await post(id, "designreference", { ...input, aspect: "region", region: [0.5, 0, 80, 40] })).status, 400);
		assert.equal((await post(id, "designreference", { ...input, aspect: "region", region: [9999, 9999, 80, 40] })).status, 400);
		const second = hub.registry.add({ name: "reference-owner-test", folder, state: "parked" });
		try { assert.equal((await get(second.id, "designreferenceimage?ref=ref1")).status, 404, "another session cannot read reference assets"); }
		finally { hub.registry.remove(second.id); }
		assert.equal((await post(id, "designreference", { action: "note", id: ref.ref, revision: 1, note: "stale" })).status, 409);
		ref = (await post(id, "designreference", { action: "note", id: ref.ref, revision: ref.revision, note: "Use these colors" })).body;
		const asset = path.join(folder, ".pi/designs/references/library", id, ref.snapshot, "source.webp"), original = fs.readFileSync(asset), tampered = Buffer.from(original); tampered[20] ^= 1; fs.writeFileSync(asset, tampered);
		assert.equal((await get(id, "designreferenceimage?ref=ref1")).status, 409, "asset hashes are rechecked rather than trusting mutable reference paths"); fs.writeFileSync(asset, original);
		assert.equal((await post(id, "designreference", { action: "remove", id: ref.ref, revision: ref.revision })).body.status, "removed");
		assert.equal((await get(id, "designreferenceimage?ref=ref1")).status, 404);
		const again = await post(id, "designreference", input); assert.equal(again.status, 200); assert.notEqual(again.body.ref, "ref1", "removed IDs never point to newly captured assets");
		const submission = randomUUID(), selection = [{ ref: again.body.ref, revision: again.body.revision }], brief = { text: "Mix these colors into two variants", target: "product" };
		const bundles = await Promise.all([freezeReferenceBundle(folder, id, submission, selection, brief), freezeReferenceBundle(folder, id, submission, selection, brief)]);
		assert.deepEqual(bundles[0], bundles[1], "duplicate submissions freeze one identical bundle");
		assert.equal(referenceBundle(folder, submission).authorized, false, "freezing alone never authorizes generation");
		await assert.rejects(freezeReferenceBundle(folder, id, submission, selection, { ...brief, text: "Changed brief" }), /different brief/);
		await assert.rejects(authorizeReferenceBundle(folder, randomUUID(), submission, brief), /cannot authorize/);
		await authorizeReferenceBundle(folder, id, submission, brief);
		assert.equal(referenceBundle(folder, submission).authorized, true);
		await editDesignReference(folder, id, again.body.ref, again.body.revision, "New draft note");
		assert.equal(referenceBundleAssets(folder, submission).bundle.refs[0].note, input.note, "later draft edits cannot change a submitted reference");
		assert.equal((await freezeReferenceBundle(folder, id, submission, selection, brief)).refs[0].note, input.note, "retries use the frozen selection rather than newer draft data");
		const freshSelection = [{ ref: again.body.ref, revision: designReferences(folder, id).refs.find(ref => ref.ref === again.body.ref).revision }], uncertainId = randomUUID();
		await freezeReferenceBundle(folder, id, uncertainId, freshSelection, brief);
		await assert.rejects(deliverReferenceBundle(folder, id, uncertainId, brief, () => { throw new Error("Transport broke after dispatch"); }), /Transport broke/);
		assert.equal(referenceBundle(folder, uncertainId).delivery, "uncertain");
		await assert.rejects(deliverReferenceBundle(folder, id, uncertainId, brief, () => assert.fail("must never resend an ambiguous delivery")), /uncertain/);
		const asyncId = randomUUID(); await freezeReferenceBundle(folder, id, asyncId, freshSelection, brief);
		let markUncertain;
		await deliverReferenceBundle(folder, id, asyncId, brief, (_context, uncertain) => { markUncertain = uncertain; return { queued: true }; });
		await markUncertain(); assert.equal(referenceBundle(folder, asyncId).delivery, "uncertain", "a later SDK rejection remains uncertain across a reload");
		await assert.rejects(deliverReferenceBundle(folder, id, asyncId, brief, () => assert.fail("must not retry an asynchronous failure")), /uncertain/);
		const frozenFile = path.join(folder, ".pi/designs/references/bundles", submission, "assets", again.body.ref, "source.webp"), frozenBytes = fs.readFileSync(frozenFile), corrupt = Buffer.from(frozenBytes); corrupt[20] ^= 1; fs.writeFileSync(frozenFile, corrupt);
		assert.throws(() => referenceBundleAssets(folder, submission), /digest mismatch/); fs.writeFileSync(frozenFile, frozenBytes);
		await assert.rejects(freezeReferenceBundle(folder, id, "../escape", selection, brief), /Invalid reference bundle/);
		const owner = randomUUID(), source = { id: "test:source", revision: "1".repeat(64), name: "Owned fixture", provenance: "Test", license: "Test" };
		let release; const captured = new Promise(resolve => release = resolve);
		const pending = addDesignReference(folder, owner, { ...source, aspect: "whole" }, async () => { await captured; return { source, files: new Map([["index.html", Buffer.from("original")]]) }; });
		const prepared = await until(() => designReferences(folder, owner).refs[0]); await editDesignReference(folder, owner, prepared.ref, prepared.revision); release();
		assert.equal((await pending).status, "removed", "stale asynchronous completion never resurrects a removed reference");
		assert(!fs.existsSync(path.join(folder, ".pi/designs/references/library", owner, prepared.snapshot)), "stale captures do not publish files");
		assert.throws(() => referenceAssets(folder, owner, prepared.ref), /unavailable/);
		assert.equal(hub.host.live.has(id), false, "selecting references never wakes a model");
	}
	{
		const write = (name, text) => { const target = path.join(folder, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
		const html = "<h1>Source sample</h1><link rel=stylesheet href=assets/colors.css><script>window.sample = true</script>";
		write(".pi/designs/sessions.json", JSON.stringify({ version: 2, next: 2, sessions: [{ handle: "design-1", name: "Draft", direction: "A test", kind: "web", inputs: [], references: [], created: 1 }] }));
		for (const root of [".pi/designs/design-1", "docs/designs/Selected"]) { write(root + "/index.html", html); write(root + "/assets/colors.css", "h1 { color: purple }"); }
		write("docs/designs/Selected/DESIGN.json", JSON.stringify({ handle: "design-1", name: "Selected", version: 1 }));
		write("docs/designs/Orphan/DESIGN.json", JSON.stringify({ handle: "design-77", name: "Retained export", version: 2 }));
		write("docs/designs/Orphan/pages/main.html", "<h1>Retained export</h1>");
		write(".pi/designs/systems/example/SOURCE.json", JSON.stringify({ commit })); write(".pi/designs/systems/example/components.html", html);
		const saved = (await get(id, "designcatalog")).body.entries, draft = saved.find(item => item.id === "draft:design-1"), selected = saved.find(item => item.id === "export:Selected");
		assert.equal(saved.filter(item => item.kind === "design").length, 3, "live drafts and retained exports are independent catalog entries");
		assert.equal(draft.designRevision, selected.designRevision, "identical authored files can group without losing separate provenance");
		assert.notEqual(draft.revision, selected.revision, "export handoff metadata remains in its exact source revision");
		assert(saved.some(item => item.id === "export:Orphan" && /v2/.test(item.status)), "an export survives without a studio record");
		assert.equal(saved.find(item => item.id === "od:example").page, "components.html", "legacy samples fall back from kit to components");
		assert.equal((await post(id, "designexample", { id: draft.id, revision: draft.revision, path: "../escape" })).status, 400, "sample requests do not accept paths");
		assert.equal((await post(id, "designexample", { id: "draft:../escape", revision: draft.revision })).status, 404);
		assert.equal(await rawGet(`/s/${id}/api/designexample`, {}), 401);
		const captured = await post(id, "designexample", { id: draft.id, revision: draft.revision }); assert.equal(captured.status, 200);
		const sampleURL = `${origin}/x/${captured.body.key}/${captured.body.open}`, page = await fetch(sampleURL);
		assert.equal(await page.text(), html, "reference HTML never receives the privileged studio comment bridge");
		const policy = page.headers.get("content-security-policy");
		assert.match(policy, /default-src 'none'/); assert(!policy.includes("https:"), "reference CSP has no blanket remote network access");
		assert(policy.includes(`connect-src ${origin}/x/${captured.body.key}/`), "scripts may only fetch this snapshot, not hub APIs or other projects");
		assert.equal(page.headers.get("referrer-policy"), "no-referrer");
		assert.equal(await (await fetch(`${origin}/x/${captured.body.key}/assets/colors.css`)).text(), "h1 { color: purple }");
		write(".pi/designs/design-1/index.html", "<h1>Changed later</h1>");
		assert.equal(await (await fetch(sampleURL)).text(), html, "an inspected snapshot survives source edits");
		const attached = await post(id, "designreference", { action: "add", id: draft.id, revision: draft.revision, previewKey: captured.body.key, aspect: "layout", note: "Keep this earlier layout" });
		assert.equal(attached.status, 200); assert.equal(referenceAssets(folder, id, attached.body.ref).files.get("index.html").toString(), html, "attachments keep the exact inspected source snapshot");
		assert.equal((await post(id, "designreference", { action: "add", id: draft.id, revision: draft.revision, previewKey: "0".repeat(32), aspect: "typography" })).status, 404);
		assert.equal((await post(id, "designexample", { id: draft.id, revision: draft.revision })).status, 409, "stale catalog revisions cannot silently select newer files");
		const changed = (await get(id, "designcatalog")).body.entries;
		assert.notEqual(changed.find(item => item.id === draft.id).designRevision, selected.designRevision, "diverged draft/export files remain distinguishable");
		const orphan = saved.find(item => item.id === "export:Orphan"), nested = await post(id, "designexample", { id: orphan.id, revision: orphan.revision });
		assert.equal(nested.status, 200); assert.equal(nested.body.open, "pages/main.html");
		assert.equal(await (await fetch(`${origin}/x/${nested.body.key}/pages/main.html`)).text(), "<h1>Retained export</h1>");
		assert.equal((await fetch(`${origin}/x/${captured.body.key}/..%2F..%2Fsessions.json`)).status, 404);
		await post(id, "unview", { key: captured.body.key }); await post(id, "unview", { key: nested.body.key });
		assert.equal((await fetch(sampleURL)).status, 404, "closing an inspector revokes its capability");
		const tooLarge = path.join(folder, ".pi/designs/design-1/huge.bin"); fs.writeFileSync(tooLarge, ""); fs.truncateSync(tooLarge, 33 * 1024 * 1024);
		const bounded = (await get(id, "designcatalog")).body;
		assert(bounded.entries.some(item => item.id === draft.id && item.availability === "unavailable"), "large drafts stay discoverable without loading their bytes");
		assert(bounded.warnings.some(message => /32 MiB/.test(message)));
		fs.rmSync(path.join(folder, "docs/designs"), { recursive: true });
		assert.equal(hub.host.live.has(id), false, "all source browsing remains Pi-free");
	}
	fs.rmSync(path.join(folder, ".pi"), { recursive: true });
	const cli = (...args) => new Promise((resolve, reject) => execFile(process.execPath, [fileURLToPath(new URL("../src/cli.ts", import.meta.url)), "open", ...args, "--json"], { windowsHide: true, timeout: 20_000 }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(JSON.parse(stdout))));
	const linked = await cli("--view", "library", "--session", id);
	assert.equal(linked.created, false); assert.equal(linked.id, id);
	assert.equal(new URL(linked.url).searchParams.get("view"), "library");
	assert.equal(new URL(linked.url).searchParams.get("token"), localKey);
	assert.equal(hub.host.live.has(id), false, "a session link does not wake it");
	await assert.rejects(cli("--view", "untrusted", "--session", id), /Only --view library/);
	await assert.rejects(cli("--view", "library", "--session", "ffffffff-ffff-ffff-ffff-ffffffffffff"), /no other session was adopted/);
	const countBeforeFallback = hub.registry.list().length;
	await assert.rejects(cli("remote", "--view", "library", "--folder", folder), /Remote off/);
	assert.equal(hub.registry.list().length, countBeforeFallback, "remote unavailable fails before creating a briefing");
	const briefing = await cli("--view", "library", "--folder", folder);
	assert.equal(briefing.created, true); assert.notEqual(briefing.id, id, "plain terminals never adopt an unrelated same-folder session");
	assert.equal((await cli("--view", "library", "--session", briefing.id)).created, false);
	assert.deepEqual((await get(briefing.id, "snapshot")).body.chat, [], "new fallback sends no generation prompt");
	await hub.host.park(briefing.id); hub.registry.remove(briefing.id);

	// Parked: plans, diagram, files and images come from the folder; nothing starts.
	const plans = await get(id, "plans");
	assert.deepEqual(plans.body, { current: "bbbbbbbb", plans: [{ id: "bbbbbbbb", title: "Newer", done: 1, total: 2 }, { id: "aaaaaaaa", title: "Older", done: 1, total: 2 }] });
	assert.equal((await get(id, "diagram")).body.target.id, "bbbbbbbb", "the displayed plan is the current one");
	const diagram = await get(id, "diagram?target=aaaaaaaa");
	assert.deepEqual(diagram.body.diagram.nodes.map(node => node.label), ["API"]);
	assert.equal((await get(id, "diagram?target=product")).body.diagram.kind, "product");
	assert.equal((await get(id, "diagram?target=dddddddd")).status, 404);
	assert.equal((await get(id, "diagram?target=../x")).status, 400);
	const files = (await get(id, "files")).body.files.map(file => file.path);
	assert(files.includes("notes.txt") && !files.includes(".env"), "secret-shaped files stay hidden");
	assert.equal((await get(id, "file?path=notes.txt")).body.content, "hello\n");
	assert.equal((await get(id, "file?path=.env")).status, 403);
	assert.equal((await get(id, "file?path=../outside")).status, 403);
	const image = await get(id, `image?path=${encodeURIComponent(path.join(folder, "shot.png"))}`);
	assert.equal(image.status, 200);
	assert.equal(image.headers.get("content-type"), "image/png");
	const parkedModels = (await get(id, "models")).body;
	assert.deepEqual([parkedModels.model.id, parkedModels.effort, parkedModels.scoped.map(m => m.id), parkedModels.others, parkedModels.unresolved, parkedModels.parked], ["fake-2", "high", ["fake-1", "fake-2"], [], ["gone/*"], true], "D10: scoped models only");
	assert.equal(hub.host.live.has(id), false, "listing models does not start a parked session");
	assert.equal((await get(id, "commands")).status, 409, "reads that need Pi do not start a parked session");
	const snapshot = (await get(id, "snapshot")).body;
	assert.deepEqual(snapshot.target, { kind: "plan", id: "bbbbbbbb" });
	assert.equal(snapshot.current, "bbbbbbbb");
	assert.deepEqual(snapshot.status, { folder: "proj", tab: "1", modes: { research: "off", night: "off" }, git: null, commands: [], model: { provider: "fake", id: "fake-2", name: "Fake Two" }, effort: "high", context: null, parked: true });
	execFileSync("git", ["init", "-q", "-b", "work"], { cwd: folder });
	const loose = fs.readdirSync(folder).filter(name => name !== ".git").length;
	const { files: gitFiles, ...counts } = (await get(id, "snapshot")).body.status.git;
	assert.deepEqual(counts, { changed: loose, added: 0, modified: 0, deleted: 0, untracked: loose, ahead: 0, behind: 0, branch: "work" }, "Commit buttons: new files counted as untracked, none ahead or behind; a branch off master is named");
	assert.deepEqual(gitFiles.map(file => file.kind), Array(loose).fill("untracked"), "the hover list names each untracked file");
	fs.rmSync(path.join(folder, ".git"), { recursive: true, force: true });
	assert.equal(fileReads, 1, "the file is read once, then the record keeps it");
	assert.match(snapshot.build, /^[0-9a-f]{12}$/);

	// Paste: magic bytes decide; the saved path serves back as a thumbnail.
	const pasted = await post(id, "paste", png, { "content-type": "image/png" });
	assert.equal(pasted.status, 200);
	assert.equal((await get(id, `image?name=${encodeURIComponent(path.basename(pasted.body.path))}`)).status, 200);
	assert.equal((await post(id, "paste", Buffer.from("not an image"), { "content-type": "image/png" })).status, 415);
	fs.rmSync(pasted.body.path, { force: true });

	// Live preview (S01): every View page gets its own key; only this session can close it.
	fs.writeFileSync(path.join(folder, "page.html"), "<p>hi</p>");
	const [view1, view2] = [(await post(id, "explore", { path: "page.html" })).body, (await post(id, "explore", { path: "page.html" })).body];
	assert.match(view1.key, /^[0-9a-f]{32}$/); assert.notEqual(view1.key, view2.key, "one key per viewer");
	assert.equal((await post(id, "unview", { key: view1.key, extra: 1 })).status, 400);
	assert.deepEqual((await post(id, "unview", { key: view1.key })).body, { ok: true });
	assert.deepEqual((await post(id, "unview", { key: view1.key })).body, { ok: false }, "already closed");
	fs.rmSync(path.join(folder, "page.html"));

	// S07 design preview: only the session's own .pi/designs/<handle>/ (handle from its published modes); no path is taken.
	assert.equal((await post(id, "designpreview", {})).status, 404, "not a design session");
	const designs = path.join(folder, ".pi", "designs"), mine = path.join(designs, "design-1");
	const staticState = '<script>window.designPreview={capture:()=>null,restore:()=>{}};</script>';
	fs.mkdirSync(path.join(mine, "css"), { recursive: true }); fs.writeFileSync(path.join(mine, "index.html"), "<link href=css/a.css>" + staticState); fs.writeFileSync(path.join(mine, "css", "a.css"), "p{}");
	fs.writeFileSync(path.join(designs, "sessions.json"), "{}"); fs.writeFileSync(path.join(folder, "secret.txt"), "s");
	fs.symlinkSync(folder, path.join(mine, "out"), "junction");
	const preview = async handle => { hub.registry.update(id, { modes: { design: handle } }); return post(id, "designpreview", {}); };
	const designView = (await preview("design-1")).body;
	assert.deepEqual([designView.design, designView.open, designView.files.map(file => file.path).filter(file => !file.startsWith("out/"))], [true, "index.html", ["css/a.css", "index.html"]]);
	const fetchX = async rel => (await fetch(`${origin}/x/${designView.key}/${rel}`)).status;
	assert.deepEqual([await fetchX("index.html"), await fetchX("css/a.css")], [200, 200], "its page and resources load");
	assert.deepEqual([await fetchX("..%2Fsessions.json"), await fetchX("out/secret.txt"), await fetchX("out/.pi/designs/sessions.json")], [404, 404, 404], "no escape from the handle folder, by .. or a link out");
	assert.equal((await preview("design-2")).status, 404, "another handle with no design yet");
	assert.equal((await preview("../..")).status, 404, "a handle is design-N only");
	assert.equal((await post(id, "designpreview", { path: "x" })).status, 400, "names no path");
	// S08: a screen is an HTML file directly in its own design folder; the lists feed the pickers.
	assert.deepEqual([designView.handle, designView.screens, designView.versions], ["design-1", ["index.html"], []]);
	fs.writeFileSync(path.join(mine, "pay.html"), "<p>pay</p>"); hub.registry.update(id, { modes: { design: "design-1" } });
	const screenRes = await post(id, "designpreview", { screen: "pay.html" }), screenView = screenRes.body; assert.equal(screenRes.status, 200, JSON.stringify(screenRes.body));
	assert.deepEqual([screenView.open, screenView.screens], ["pay.html", ["index.html", "pay.html"]]);
	for (const screen of ["css/a.css", "../design-1/pay.html", "out/page.html", "nope.html"]) assert.equal((await post(id, "designpreview", { screen })).status, 404, screen);
	assert.equal((await post(id, "designpreview", { screen: 1 })).status, 400);
	await post(id, "unview", { key: screenView.key });
	// S09: a kept version is shown read-only from its own history folder, with that version's screens.
	fs.mkdirSync(path.join(designs, "history", "design-1", "2"), { recursive: true }); fs.writeFileSync(path.join(designs, "history", "design-1", "2", "index.html"), "<p>v2</p>" + staticState);
	const old = (await post(id, "designpreview", { version: 2 })).body;
	assert.deepEqual([old.version, old.screens, old.versions, old.open], [2, ["index.html"], [2], "index.html"]);
	assert((await (await fetch(`${origin}/x/${old.key}/index.html`)).text()).startsWith("<p>v2</p>" + staticState + "<script data-design-chrome>"), "the kept page, with the bridge (S10)");
	for (const version of [3, 0, "2", 1.5]) assert.equal((await post(id, "designpreview", { version })).status, typeof version === "number" && version === 3 ? 404 : 400, String(version));
	assert.equal((await post(id, "designpreview", { version: 2, screen: "pay.html" })).status, 404, "that version had no pay screen");
	await post(id, "unview", { key: old.key });
	// S13: Mark renders the shown state of the session's own design only: slide hash, kept version and unsaved inline edits.
	const shot = async (body) => { const res = await post(id, "designshot", { screen: "index.html", width: 400, height: 300, pageState: null, input: "mouse", reducedMotion: false, ...body }); return res.status === 200 ? fs.readFileSync(res.body.path) : res.status; };
	for (const [body, status] of [[{ buildGeneration: "../bad" }, 400], [{ buildGeneration: "0".repeat(64) }, 409], [{ width: 100 }, 400], [{ hash: "#a b" }, 400], [{ styleEdits: [{ selector: "p", styles: { "x;y": "1" } }] }, 400], [{ screen: 1 }, 400], [{ path: "x" }, 400], [{ screen: "../design-1/pay.html" }, 404], [{ screen: "out/page.html" }, 404], [{ version: 9 }, 404]]) assert.equal(await shot(body), status, JSON.stringify(body));
	fs.writeFileSync(path.join(mine, "deck.html"), "<body><p>slide</p><script>document.body.style.background = location.hash === '#2' ? '#000' : '#fff'</script>" + staticState + "</body>");
	const [first, second, edited, version2, current] = [await shot({ screen: "deck.html" }), await shot({ screen: "deck.html", hash: "#2" }), await shot({ screen: "deck.html", styleEdits: [{ selector: "p", styles: { "font-size": "80px" } }] }), await shot({ version: 2 }), await shot({})];
	assert(Buffer.isBuffer(first) && Buffer.isBuffer(current), `renders give PNG files: ${first} ${current}`);
	assert(!first.equals(second) && !first.equals(edited) && !version2.equals(current), "the slide, the inline edit and the version each change the picture");
	assert.equal((await post(id, "designshot", { screen: "index.html", width: 400, height: 300 })).status, 400, "missing capture cannot silently render defaults");
	for (const body of [{ pageState: { constructor: {} } }, { pageState: "é".repeat(8192) }, { pageState: Array(257).fill(0) }, { pageState: Array.from({ length: 9 }).reduce(value => [value], null) }, { input: "pen" }, { reducedMotion: "false" }]) assert.equal(await shot(body), 400, "invalid state/capability rejected before rendering");
	fs.writeFileSync(path.join(mine, "legacy.html"), "<p>No state support</p>");
	assert.equal(await shot({ screen: "legacy.html" }), 502, "unsupported capture is not a success PNG");
	fs.writeFileSync(path.join(mine, "state.html"), '<script>let current=null;window.designPreview={capture:()=>current,restore:value=>{current=value;document.body.style.background=value.color;}};</script><p>Restored</p>');
	assert(Buffer.isBuffer(await shot({ screen: "state.html", pageState: { color: "red" }, input: "touch", reducedMotion: true })), "validated state and capability reach the renderer");
	hub.registry.update(id, { modes: undefined }); assert.equal(await shot({}), 404, "not a design session"); hub.registry.update(id, { modes: { design: "design-1" } });
	assert.equal((await post(id, "explore", { path: ".pi/designs/design-1/index.html" })).status, 404, "other .pi files stay refused for chat links");
	// Component Mark binds the capture to the exact generation, never a newer source build with a similar state schema.
	const componentDir=path.join(designs,"design-3"), componentSource=appStarter("Component"), componentOutput=new Map([["index.html",Buffer.from("<p>Component</p>"+staticState)]]);
	const publishComponent=async()=>{for(const [name,bytes]of appPublication(componentSource,componentOutput)){const dest=path.join(componentDir,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);}await ensureAppBuilt(componentDir,{runtime:async()=>assert.fail("retained component output must be usable without installing")});};
	await publishComponent();const componentView=(await preview("design-3")).body;
	assert.match(componentView.build.generation,/^[a-f0-9]{64}$/);
	assert.equal(await shot({}),409,"a component capture must identify its generation");
	assert(Buffer.isBuffer(await shot({buildGeneration:componentView.build.generation})),"matching component generation renders");
	componentSource.set("src/App.jsx",Buffer.from("// refined source"));await publishComponent();
	assert.equal(await shot({buildGeneration:componentView.build.generation}),409,"an older live capture cannot silently render the new generation");
	await post(id,"unview",{key:componentView.key});
	await post(id, "unview", { key: designView.key }); hub.registry.update(id, { modes: undefined });
	fs.rmSync(path.join(folder, ".pi"), { recursive: true, force: true }); fs.rmSync(path.join(folder, "secret.txt"));

	// S-11: model and effort picked while parked are kept and set on resume, before the message.
	assert.equal((await post(id, "model", { provider: "fake", id: "nope" })).status, 404, "parked picks come from the scoped list only");
	assert.equal((await get(id, "models")).body.default, "fake/fake-2", "the list names Pi's default model");
	assert.equal((await post(id, "defaultmodel", { provider: "fake", id: "nope" })).status, 404, "only a listed model becomes the default");
	const crowned = await post(id, "defaultmodel", { provider: "fake", id: "fake-1" }); assert.equal(crowned.body.default, "fake/fake-1", JSON.stringify(crowned));
	assert.equal(defaultModel, "fake/fake-1", "saved through Pi's settings");
	// The same model may be default, work and think; think is a list.
	assert.equal((await post(id, "defaultmodel", { provider: "fake", id: "fake-1", role: "boss" })).status, 400);
	await post(id, "defaultmodel", { provider: "fake", id: "fake-1", role: "work" });
	const roled = (await post(id, "defaultmodel", { provider: "fake", id: "fake-1", role: "think" })).body;
	assert.deepEqual([roled.default, roled.work, roled.think], ["fake/fake-1", "fake/fake-1", ["other/x", "fake/fake-1"]], JSON.stringify(roled));
	assert.deepEqual([(await get(id, "models")).body.work, (await post(id, "defaultmodel", { provider: "fake", id: "fake-1", role: "think", on: false })).body.think], ["fake/fake-1", ["other/x"]], "listed, and removable");
	const saved = JSON.parse(fs.readFileSync(path.join(rolesDir, "settings.json"), "utf8"));
	assert.deepEqual([saved.theme, saved.workOrchestrator.plan3], ["dark", { models: [{ model: "other/x", thinking: "low" }], codingModel: "fake/fake-1" }], "other settings and efforts kept");
	// Each role has its own effort: work may use the session's (null); a think model keeps its place when only its effort changes.
	assert.equal((await post(id, "defaultmodel", { provider: "fake", id: "fake-1", effort: "turbo" })).status, 400);
	assert.equal((await post(id, "defaultmodel", { provider: "fake", id: "fake-1", effort: null })).status, 400, "only work may use the session's effort");
	await post(id, "defaultmodel", { provider: "fake", id: "fake-1", effort: "high" }); assert.equal(defaultEffort, "high", "the default model's effort goes to Pi");
	assert.equal((await post(id, "defaultmodel", { provider: "fake", id: "fake-1", role: "work", effort: "medium" })).body.workEffort, "medium");
	await post(id, "defaultmodel", { provider: "fake", id: "fake-1", role: "think", effort: "xhigh" }); await post(id, "defaultmodel", { provider: "fake", id: "fake-2", role: "think" });
	const tuned = (await post(id, "defaultmodel", { provider: "fake", id: "fake-1", role: "think", effort: "low" })).body;
	assert.deepEqual([tuned.think, tuned.thinkEffort], [["other/x", "fake/fake-1", "fake/fake-2"], { "other/x": "low", "fake/fake-1": "low", "fake/fake-2": "high" }], JSON.stringify(tuned));
	assert.equal((await post(id, "defaultmodel", { provider: "fake", id: "fake-1", role: "work", effort: null })).body.workEffort, null, "work back on the session's effort");
	// Set scoped models: a parked session may scope any model with a login; the answer is the new list.
	assert.equal((await post(id, "defaultmodel", { provider: "fake", id: "nope", role: "scoped" })).status, 404);
	const scopedOn = (await post(id, "defaultmodel", { provider: "fake", id: "fake-3", role: "scoped" })).body;
	assert.deepEqual(scopedOn.scoped.map(model => model.id), ["fake-1", "fake-2", "fake-3"], JSON.stringify(scopedOn));
	assert.deepEqual((await post(id, "defaultmodel", { provider: "fake", id: "fake-3", role: "scoped", on: false })).body.scoped.map(model => model.id), ["fake-1", "fake-2"]);
	assert.equal((await post(id, "model", { provider: "fake", id: "fake-1" })).body.model.id, "fake-1");
	assert.equal((await post(id, "effort", { level: "medium" })).body.effort, "medium");
	assert.equal(hub.host.live.has(id), false, "a parked pick does not start Pi");
	assert.deepEqual(hub.registry.get(id).pending, { model: { provider: "fake", id: "fake-1", name: "Fake One" }, thinking: "medium" });

	// A write starts a parked session; message goes to ce-workflow as a hub call.
	const sent = await post(id, "message", { target: "bbbbbbbb", text: "hi" });
	assert.deepEqual(sent.body, { endpoint: "/api/message", data: { target: "bbbbbbbb", text: "hi" } });
	{
		const source = { id: "test:relay", revision: "a".repeat(64), name: "Relay fixture", provenance: "Local test", license: "Test" };
		const ref = await addDesignReference(folder, id, { ...source, aspect: "colors" }, async () => ({ source, files: new Map([["colors.css", Buffer.from("body { color: purple; }")]]) })), submission = randomUUID();
		const message = { target: "product", text: `Borrow @${ref.ref}`, references: { submission, refs: [{ ref: ref.ref, revision: ref.revision }] } };
		const relayed = await post(id, "message", message);
		assert.equal(relayed.status, 200); assert.deepEqual(relayed.body.data, { target: "product", text: message.text, bundle: submission });
		assert.equal(referenceBundle(folder, submission).authorized, false, "the fake Pi relay cannot authorize a launch; the real handler must do it");
		assert.equal((await post(id, "message", message)).body.data.bundle, submission, "transport retry retains the frozen bundle ID");
		assert.equal((await post(id, "message", { ...message, text: "/new" })).status, 400, "references cannot trigger command shortcuts");
		assert.equal((await post(id, "message", { text: "Forged", bundle: submission })).status, 400);
		for (const file of [`.pi/designs/references/bundles/${submission}/bundle.json`, `.pi/designs/references/bundles/${submission}/assets/${ref.ref}/source.webp`, `.pi/designs/references/library/${id}/index.json`, ".pi/designs/references/library", ".pi/designs/references/bundles"]) assert.match(writeRefusal(folder, "design-1", file), /read-only/, "design sessions cannot rewrite evidence or its authorization");
		assert.equal(writeRefusal(folder, "design-1", ".pi/designs/references/site/STYLE.md"), undefined, "ordinary site reference guidance remains writable");
	}
	{
		// D12: page references are captured by the session's consent-gated browser_fetch and stored by the hub.
		for (const url of ["file:///etc/passwd", "data:text/html,x", "https://user:pw@site.test/", "not a url", "https://site.test/" + "x".repeat(240)]) assert.equal((await post(id, "designreference", { action: "add", url, aspect: "whole" })).status, 400, url);
		assert.equal((await post(id, "designreference", { action: "add", url: "https://site.test/", id: "astryx:x", aspect: "whole" })).status, 400, "a URL reference cannot borrow a catalog identity");
		assert.match((await post(id, "designreference", { action: "add", url: "https://denied.test/", aspect: "whole" })).body.error, /not approved/, "per-site approval refusals reach the page");
		assert.equal((await post(id, "designreference", { action: "add", url: "https://junk.test/", aspect: "whole" })).status, 502, "non-PNG captures are refused");
		// V-05: the Image search tab asks the session (fake Pi echoes the call); empty queries and foreign shapes never reach it.
		assert.deepEqual((await post(id, "designsearch", { query: "  pos ui " })).body, { endpoint: "/api/designsearch", data: { query: "pos ui" } });
		for (const body of [{ query: " " }, { query: 1 }, { query: "x", path: "/tmp" }]) assert.equal((await post(id, "designsearch", body)).status, 400);
		assert.deepEqual((await post(id, "designoriginal", { set: "s2", n: 3 })).body, { endpoint: "/api/designoriginal", data: { set: "s2", n: 3 } });
		assert.deepEqual((await post(id, "designpick", { set: "s2", n: 3 })).body, { endpoint: "/api/designpick", data: { set: "s2", n: 3 } }, "V-06: picks go to the session by set and number");
		for (const body of [{ set: "../x", n: 1 }, { set: "s1", n: 0 }, { set: "s1", n: "1" }, { set: "s1", n: 1, path: "/tmp/a.png" }]) assert.equal((await post(id, "designoriginal", body)).status, 400);
		const page = await post(id, "designreference", { action: "add", url: "https://site.test/a", aspect: "layout", note: "spacing" });
		assert.equal(page.status, 200); assert.equal(page.body.status, "ready"); assert.equal(page.body.thumbnail, "screenshot.png"); assert.equal(page.body.source.url, "https://site.test/a");
		assert.match(page.body.source.license, /inspiration only/); assert.equal(page.body.source.name, "<b>Page</b>", "titles stay data; the page renders them as text");
		assert.equal((await get(id, `designreferenceimage?ref=${page.body.ref}`)).status, 200);
		assert.equal((await post(id, "designreference", { action: "add", url: "https://site.test/a", aspect: "layout" })).body.ref, page.body.ref, "the same page keeps one stable reference identity");
		const sibling = (await post(id, "designreference", { action: "add", url: "https://site.test/b", aspect: "layout" })).body;
		assert.notEqual(sibling.ref, page.body.ref, "two pages from the same host are separate references");
		const pageBundle = randomUUID(); await freezeReferenceBundle(folder, id, pageBundle, [{ ref: page.body.ref, revision: page.body.revision }], { text: "Use the page", target: "product" });
		await post(id, "designreference", { action: "remove", id: page.body.ref, revision: page.body.revision });
		const recaptured = (await post(id, "designreference", { action: "add", url: "https://site.test/a", aspect: "layout" })).body;
		assert.notEqual(recaptured.ref, page.body.ref, "recapture after removal never reuses the removed ID");
		assert.equal(referenceBundleAssets(folder, pageBundle).bundle.refs[0].note, "spacing", "recapture after Send leaves the frozen submission unchanged");
		for (const ref of [sibling, recaptured]) await post(id, "designreference", { action: "remove", id: ref.ref, revision: ref.revision });
	}
	assert.equal(hub.host.live.has(id), true);
	assert.deepEqual((await post(id, "command", { target: "bbbbbbbb", command: "review" })).body.endpoint, "/api/command");
	assert.deepEqual(Object.keys((await get(id, "usage")).body), ["summary", "accounts"], "usage comes from the hub, not the session");

	// Status from RPC; model and effort through RPC with a status frame.
	const status = (await get(id, "snapshot")).body.status;
	assert.deepEqual([status.model.id, status.effort, status.context], ["fake-1", "medium", 42], "the parked picks reached Pi");
	assert.equal(hub.registry.get(id).pending, undefined);
	assert.equal((await post(id, "model", { provider: "fake", id: "nope" })).status, 404);
	assert.equal((await post(id, "model", { provider: "fake", id: "fake-2", extra: 1 })).status, 400);
	assert.equal((await post(id, "model", { provider: "fake", id: "fake-2" })).body.model.id, "fake-2");
	assert.equal((await post(id, "effort", { level: "turbo" })).status, 400);
	assert.equal((await post(id, "effort", { level: "high" })).body.effort, "high");
	assert.deepEqual([hub.registry.get(id).model.id, hub.registry.get(id).thinking], ["fake-2", "high"], "the record follows the live session");

	// Pi's published plan and diagram changes reach the snapshot; /reload restarts the session (D12).
	await hub.host.prompt(id, `/state ${JSON.stringify({ plan: { id: "aaaaaaaa", title: "Older", finishable: false }, modes: { research: "on", night: "off" }, compacting: false, subagents: [] })}`);
	const followed = (await get(id, "snapshot")).body;
	assert.deepEqual([followed.current, followed.target.id, followed.plan?.finishable, followed.status.modes.research], ["aaaaaaaa", "aaaaaaaa", false, "on"]);
	assert.equal((await get(id, "plans")).body.current, "aaaaaaaa");
	// A parked pick Pi refuses keeps the previous model and tells the page.
	const notices = []; hub.host.on("notice", (sid, text) => { if (sid === id) notices.push(text); });
	hub.registry.update(id, { pending: { model: { provider: "nokey", id: "x", name: "No Key" } } });
	const pid = hub.host.live.get(id).rpc.process?.pid;
	assert.deepEqual((await post(id, "message", { text: " /reload " })).body, { ok: true });
	assert.equal(hub.host.live.has(id), true, "reload resumes");
	if (pid) assert.notEqual(hub.host.live.get(id).rpc.process?.pid, pid, "reload is a new Pi");
	assert.equal((await get(id, "snapshot")).body.status.modes.research, "on", "modes outlive the Pi process until it publishes again");
	assert.match(notices[0] ?? "", /Kept the previous model: No Key/);
	assert.equal(hub.registry.get(id).pending, undefined);

	// H5-04 forms: every open dialog is a page form keyed by its request id; snapshot, dialog and dialog_closed frames carry it.
	const notified = prefix => new Promise(r => { const l = (sid, req) => { if (sid === id && req.method === "notify" && req.message.startsWith(prefix)) { hub.host.off("ui", l); r(req.message.slice(prefix.length)); } }; hub.host.on("ui", l); });
	const frames = [], view = hub.views.get(id), publish = view.publish;
	view.publish = (event, value) => { if (event.startsWith("dialog")) frames.push([event, value]); publish(event, value); };
	const open = async (command, prefix) => {
		const before = new Set(hub.host.pendingDialogs(id).map(d => d.id)), result = notified(prefix);
		void hub.host.prompt(id, command);
		const dialog = await until(() => hub.host.pendingDialogs(id).find(d => !before.has(d.id)));
		return { askId: dialog.id, result };
	};

	// Channel ask: ask_user data as is, plus ce-workflow's own askId sent back with the answer.
	const channel = await open(`/ask ${JSON.stringify({ id: "c", data: { askId: "own-1", question: "Pick?", options: [{ title: "A" }] } })}`, "answer:");
	assert.deepEqual((await get(id, `dialog?id=${channel.askId}`)).body, { askId: channel.askId, question: "Pick?", options: [{ title: "A" }] });
	assert.deepEqual((await get(id, "snapshot")).body.dialogs.map(form => form.askId), [channel.askId], "a reconnecting page sees the open form");
	assert.deepEqual(frames.at(-1), ["dialog", { askId: channel.askId, question: "Pick?", options: [{ title: "A" }] }]);
	assert.equal((await post(id, "answer", { askId: channel.askId, text: "x", bogus: 1 })).status, 400);
	assert.deepEqual((await post(id, "answer", { askId: channel.askId, selections: ["A"], comment: "ok", target: "aaaaaaaa" })).body, { accepted: true });
	assert.deepEqual(JSON.parse(await channel.result), { selections: ["A"], comment: "ok", askId: "own-1" });
	assert.deepEqual(frames.at(-1), ["dialog_closed", { askId: channel.askId }]);
	assert.deepEqual((await post(id, "answer", { askId: channel.askId, text: "again" })).body, { accepted: false }, "first answer wins");
	assert.equal((await get(id, `dialog?id=${channel.askId}`)).status, 404);

	// Another session answers through the hub (ce-workflow session_dialog): by stays out of the answer, the asked
	// model is told by a steer that it was not the user, and a waiting session reads what was picked.
	const peer = await open(`/ask ${JSON.stringify({ id: "p", data: { askId: "own-2", question: "Go?", options: [{ title: "Yes" }, { title: "No" }] } })}`, "answer:");
	const hubRoute = (route, data) => fetch(`${origin}${route}`, { method: data ? "POST" : "GET", headers: { "x-hub-key": localKey, "content-type": "application/json", connection: "close" }, body: data && JSON.stringify(data) }).then(r => r.json());
	assert.deepEqual((await hubRoute(`/api/sessions/${id}/dialogs`)).forms.map(form => form.askId), [peer.askId]);
	const live = hub.host.live.get(id), realPrompt = hub.host.prompt, steered = [];
	live.running = true; hub.host.prompt = async (sid, message, extra) => { steered.push([sid, message, extra]); return {}; };
	try {
		assert.deepEqual(await hubRoute(`/api/sessions/${id}/answer`, { askId: peer.askId, selections: ["Yes"], by: "lead in game" }), { accepted: true });
	} finally { hub.host.prompt = realPrompt; live.running = false; }
	assert.deepEqual(JSON.parse(await peer.result), { selections: ["Yes"], askId: "own-2" });
	assert.deepEqual(steered, [[id, '[Session lead in game answered "Go?" with: Yes. That was the other session, not the user.]', { streamingBehavior: "steer" }]]);
	assert.deepEqual((await hubRoute(`/api/sessions/${id}/dialogs`)).answered.find(entry => entry.askId === peer.askId), { askId: peer.askId, by: "lead in game", answer: "Yes" });
	assert.deepEqual((await hubRoute(`/api/sessions/${id}/dialogs`)).answered.find(entry => entry.askId === channel.askId), { askId: channel.askId, answer: "A (comment: ok)" }, "the user's own answers are recorded too, without by");

	// Standard Pi notifications (including slash-command errors) reach the page, not just custom hub notices.
	const notifiedFrames = [], beforeNotify = view.publish;
	view.publish = (event, value) => { if (event === "notice") notifiedFrames.push(value.text); beforeNotify(event, value); };
	hub.host.live.get(id).rpc.emit("ui", { type: "extension_ui_request", method: "notify", message: "Plan3: Choose a Plan3 plan.", notifyType: "error" });
	assert.equal(notifiedFrames.at(-1), "Plan3: Choose a Plan3 plan.", "Pi command errors must reach the hub notice area");
	hub.host.live.get(id).rpc.emit("ui", { type: "extension_ui_request", method: "notify", message: "x".repeat(3000) });
	assert.equal(notifiedFrames.at(-1).length, 2000, "notifications are bounded like hub notices");
	hub.host.live.get(id).rpc.emit("ui", { type: "extension_ui_request", method: "notify", message: {} });
	assert.equal(notifiedFrames.length, 2, "malformed notifications are ignored");
	view.publish = beforeNotify;

	// A run button's script asks through pi-hub ask (shim on PATH, PI_HUB_SESSION set) and gets the answer: no model turn.
	const noticed = [], withDialogs = view.publish;
	view.publish = (event, value) => { if (event === "notice") noticed.push(value.text); withDialogs(event, value); };
	const hubPost = (route, data) => fetch(`${origin}${route}`, { method: "POST", headers: { "x-hub-key": localKey, "content-type": "application/json", connection: "close" }, body: JSON.stringify(data) }).then(r => r.json());
	await hubPost("/api/commands", { action: "add", folder, name: "Deploy", kind: "run", text: "pi-hub ask \"Deploy where?\" --option staging --option prod > answer.txt && pi-hub notice \"Deployed\"" });
	assert.deepEqual((await post(id, "run", { name: "Deploy" })).body, { ok: true, started: true });
	const asked = await until(async () => frames.findLast(frame => frame[0] === "dialog" && frame[1].question === "Deploy where?")?.[1]);
	assert.deepEqual(asked.options, [{ title: "staging" }, { title: "prod" }]);
	assert.deepEqual((await get(id, "snapshot")).body.dialogs.map(form => form.askId), [asked.askId]);
	assert.deepEqual((await post(id, "answer", { askId: asked.askId, selections: ["prod"] })).body, { accepted: true });
	await until(() => noticed.includes("Deployed"));
	assert.equal(fs.readFileSync(path.join(folder, "answer.txt"), "utf8").trim(), "prod");
	// Extra clicks: a bound Shift action runs instead; a menu script lists actions on right-click and gets the picked one back.
	const script = "node -e \"const e = process.env; if (e.PI_HUB_CLICK === 'menu' && !e.PI_HUB_ACTION) console.log('Fast\\nSlow'); else require('fs').writeFileSync('click.txt', e.PI_HUB_CLICK + ' ' + (e.PI_HUB_ACTION ?? '-'))\"";
	await hubPost("/api/commands", { action: "add", folder, name: "Multi", kind: "run", text: script, menu: true, actions: [{ name: "Clean", kind: "run", text: "node -e \"require('fs').writeFileSync('click.txt', 'clean')\"", click: "shift" }] });
	const clicked = async (data, expected) => { fs.rmSync(path.join(folder, "click.txt"), { force: true }); assert.equal((await post(id, "run", { name: "Multi", ...data })).body.started, true); await until(() => fs.existsSync(path.join(folder, "click.txt")) && fs.readFileSync(path.join(folder, "click.txt"), "utf8") === expected); };
	await clicked({ click: "ctrl" }, "ctrl -");
	await clicked({ click: "shift" }, "clean");
	assert.deepEqual((await post(id, "commandmenu", { name: "Multi" })).body, { actions: ["Fast", "Slow"] });
	await clicked({ click: "menu", action: "Slow" }, "menu Slow");
	assert.deepEqual((await post(id, "commands", { rename: "Multi", to: "Many" })).body, { ok: true });
	assert.equal((await post(id, "run", { name: "Multi" })).status, 404, "renamed");
	// A script that goes away (killed, timed out) takes its form with it.
	const gone = new AbortController(), pending = fetch(`${origin}/api/sessions/${id}/ask`, { method: "POST", signal: gone.signal, headers: { "x-hub-key": localKey, "content-type": "application/json" }, body: JSON.stringify({ question: "Left?" }) }).catch(() => {});
	const left = await until(async () => frames.findLast(frame => frame[0] === "dialog" && frame[1].question === "Left?")?.[1]);
	gone.abort(); await pending;
	await until(() => frames.some(frame => frame[0] === "dialog_closed" && frame[1].askId === left.askId));
	assert.equal((await hubPost(`/api/sessions/${id}/ask`, { options: ["x"] })).error, "question: the text to ask.");
	view.publish = withDialogs;

	// Plain RPC dialogs from other extensions or Pi itself, converted both ways.
	const select = await open(`/dialog select ${JSON.stringify({ title: "Pick a mode", options: ["Fast", "Slow"] })}`, "dialog:");
	assert.deepEqual((await get(id, `dialog?id=${select.askId}`)).body, { askId: select.askId, kind: "list", title: "Pick a mode", purpose: "Choose an option to continue.", items: [{ value: "Fast", label: "Fast" }, { value: "Slow", label: "Slow" }] });
	assert.equal((await post(id, "answer", { askId: select.askId, action: "select", value: "Other" })).status, 400);
	await post(id, "answer", { askId: select.askId, action: "select", value: "Slow" });
	assert.deepEqual(JSON.parse(await select.result), { value: "Slow" });
	const back = await open(`/dialog select ${JSON.stringify({ title: "Pick", options: ["A"] })}`, "dialog:");
	await post(id, "answer", { askId: back.askId, action: "back" });
	assert.deepEqual(JSON.parse(await back.result), { cancelled: true });
	const confirm = await open(`/dialog confirm ${JSON.stringify({ title: "Allow dangerous command?", message: "rm -rf build" })}`, "dialog:");
	const card = (await get(id, `dialog?id=${confirm.askId}`)).body;
	assert.deepEqual([card.kind, card.compact, card.purpose, card.items.map(item => item.label)], ["list", true, "rm -rf build", ["Yes", "No"]]);
	await post(id, "answer", { askId: confirm.askId, action: "select", value: "yes" });
	assert.deepEqual(JSON.parse(await confirm.result), { confirmed: true });
	const refuse = await open(`/dialog confirm ${JSON.stringify({ title: "Sure?", message: "" })}`, "dialog:");
	await post(id, "answer", { askId: refuse.askId, action: "back" });
	assert.deepEqual(JSON.parse(await refuse.result), { confirmed: false }, "Esc on a confirm is No");
	const input = await open(`/dialog input ${JSON.stringify({ title: "Name?", placeholder: "e.g. Bob" })}`, "dialog:");
	assert.deepEqual((await get(id, `dialog?id=${input.askId}`)).body, { askId: input.askId, question: "Name?", context: "e.g. Bob", options: [], allowFreeform: true });
	await post(id, "answer", { askId: input.askId, text: "Ann" });
	assert.deepEqual(JSON.parse(await input.result), { value: "Ann" });
	const editor = await open(`/dialog editor ${JSON.stringify({ title: "Rules", prefill: "line 1" })}`, "dialog:");
	assert.equal((await get(id, `dialog?id=${editor.askId}`)).body.initialText, "line 1");
	await post(id, "answer", { askId: editor.askId, cancel: true });
	assert.deepEqual(JSON.parse(await editor.result), { cancelled: true });
	assert.deepEqual((await get(id, "snapshot")).body.dialogs, []);
	view.publish = publish;

	// Stop aborts the run.
	void hub.host.prompt(id, "hold");
	await until(() => hub.host.live.get(id).running);
	// One queued message taken back (edit/cancel); the others stay queued, and the page's list follows.
	await hub.host.live.get(id).rpc.send({ type: "steer", message: "keep me" });
	await hub.host.live.get(id).rpc.send({ type: "steer", message: "drop me" });
	await until(async () => (await get(id, "snapshot")).body.activity.queue.length === 2);
	assert.deepEqual((await post(id, "unqueue", { text: "drop me" })).body, { ok: true, restored: ["drop me"], delivered: false });
	await until(async () => JSON.stringify((await get(id, "snapshot")).body.activity.queue.map(item => item.text)) === '["keep me"]');
	assert.equal((await post(id, "unqueue", { text: "long gone" })).body.delivered, true, "already steered: the page posts the edit as a new message");
	await hub.host.live.get(id).rpc.send({ type: "clear_queue" });
	await hub.host.live.get(id).rpc.send({ type: "steer", message: "oops, wrong" });
	const stopped = await post(id, "stop", {});
	assert.equal(stopped.status, 200);
	assert.deepEqual(stopped.body.restored, ["oops, wrong"], "Stop takes queued messages back instead of letting abort deliver them");
	await until(() => !hub.host.live.get(id).running);

	// \u2715 on the last prompt: Pi forks from just before it, the registry follows, and a stale page can't drop another one.
	await hub.host.prompt(id, "shown by mistake");
	await until(() => !hub.host.live.get(id).running);
	const prompts = async () => (await get(id, "snapshot")).body.chat.filter(row => row.role === "user").map(row => row.text);
	const shown = await prompts(), beforeDrop = hub.registry.get(id).sessionFile;
	assert.equal(shown.at(-1), "shown by mistake");
	assert.equal((await post(id, "drop", { text: "an older prompt" })).status, 409, "only the last prompt");
	assert.deepEqual((await post(id, "drop", { text: "shown by mistake" })).body, { ok: true });
	assert.notEqual(hub.registry.get(id).sessionFile, beforeDrop);
	assert.deepEqual(await prompts(), shown.slice(0, -1), "the prompt and the reply to it are gone");

	// /new: a fresh session file, the lock moves with it, and the chat starts empty.
	const oldFile = hub.registry.get(id).sessionFile;
	assert.equal((await post(id, "message", { text: "/new" })).status, 200);
	assert.notEqual(hub.registry.get(id).sessionFile, oldFile, "registry follows Pi's new session file");
	assert.deepEqual((await get(id, "snapshot")).body.chat, [], "the page reconnects to an empty chat");

	// S03: the line under the name, set through the hub (pi-hub subtitle) or published by an extension; plain, capped, empty clears.
	const subtitle = async () => (await get(id, "sessions")).body.groups.flatMap(group => group.sessions).find(session => session.id === id).subtitle;
	assert.deepEqual(await hubRoute(`/api/sessions/${id}/subtitle`, { text: " Home\npage \u0007 " }), { ok: true, subtitle: "Home page" });
	assert.equal(await subtitle(), "Home page", "the session list returns it");
	assert.equal((await hubRoute(`/api/sessions/${id}/subtitle`, { text: "x".repeat(200) })).subtitle.length, 80, "capped");
	await hub.host.prompt(id, `/subtitle ${JSON.stringify("Published ★")}`);
	assert.equal(await until(async () => await subtitle() === "Published ★" && "ok"), "ok", "an extension publishes it through the hub channel");
	await hubRoute(`/api/sessions/${id}/subtitle`, { text: "" });
	assert.equal(await subtitle(), undefined, "empty clears it");
	assert.equal((await hubRoute(`/api/sessions/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}/subtitle`, { text: "x" })).error, "Unknown session.");

	// S05: a design session (ce-workflow publishes modes.design) sits last in its folder, whatever its order in the registry.
	const painted = hub.registry.add({ name: "Bold", folder, sessionFile: path.join(folder, "d.jsonl"), state: "parked" }); hub.registry.update(painted.id, { modes: { design: "design-1" } });
	const trailing = hub.registry.add({ name: "after", folder, sessionFile: path.join(folder, "a.jsonl"), state: "parked" });
	const folderRows = (await get(id, "sessions")).body.groups.find(group => group.sessions.some(session => session.id === painted.id)).sessions;
	assert.deepEqual([folderRows.at(-1).id, folderRows.at(-1).design, folderRows.at(-2).id], [painted.id, "design-1", trailing.id]);
	hub.registry.remove(painted.id); hub.registry.remove(trailing.id);

	// H5-05 session bar: folder groups with state tones, actions, Recents with Star/Unstar (D18).
	const tones = async () => Object.fromEntries((await get(id, "sessions")).body.groups.flatMap(group => group.sessions.map(session => [session.name, session.tone])));
	await post(id, "seen", {}); assert.equal((await tones())["1"], "seen");
	await hub.host.prompt(id, "hi");
	assert.equal((await until(async () => (await tones())["1"] === "unseen" && "ok")), "ok", "a finished run is unseen, open page or not");
	await get(id, "snapshot");
	assert.equal((await tones())["1"], "unseen", "a (re)connect alone, as a background tab or the app's hidden tab, keeps it unseen");
	const attention = async () => (await get(id, "sessions")).body.groups.flatMap(group => group.sessions).find(session => session.id === id).attention;
	assert.equal(typeof await attention(), "number", "a finished run joins the attention key's list");
	assert.equal((await post(id, "seen", {})).status, 200);
	assert.equal((await tones())["1"], "seen", "a focused page showing it marks it seen");
	assert.equal(await attention(), undefined, "and drops it from the attention list");
	// A run another session started over intercom finishes quietly: not unseen, flagged so the page sends no "finished".
	const settles = hub.host.live.get(id).settles;
	await hub.host.prompt(id, "intercom"); await until(() => hub.host.live.get(id).settles > settles);
	const quiet = (await get(id, "sessions")).body.groups.flatMap(group => group.sessions).find(session => session.id === id);
	assert.deepEqual([quiet.tone, quiet.quiet], ["seen", true], "an intercom-only run stays seen");
	// S-05: an idle session with a timer is "scheduled"; the row carries the timers; the menu cancels one (own session only).
	const timer = await (await fetch(`${origin}/api/sessions/${id}/timers`, { method: "POST", headers: { "x-hub-key": localKey, connection: "close", "content-type": "application/json" }, body: JSON.stringify({ kind: "script", command: "exit 0", everyMinutes: 5 }) })).json();
	const row = async () => (await get(id, "sessions")).body.groups.flatMap(group => group.sessions).find(session => session.id === id);
	assert.equal((await row()).tone, "scheduled");
	assert.deepEqual((await row()).timers.map(t => [t.id, t.kind, t.label]), [[timer.id, "script", "exit 0"]]);
	assert.equal((await post(id, "session", { action: "cancel-timer", id, timer: "nope" })).status, 404);
	assert.equal((await post(id, "session", { action: "cancel-timer", id, timer: timer.id })).status, 200);
	assert.equal((await row()).tone, "seen");
	const created = (await post(id, "session", { action: "new", folder })).body;
	assert.equal(created.name, "2", "new sessions take the next free number");
	const missing = await post(id, "session", { action: "new", folder: path.join(root, "missing") });
	assert.deepEqual([missing.status, missing.body.error], [404, "Folder does not exist."], "a missing folder is only reported, so the page can ask");
	const made = (await post(id, "session", { action: "new", folder: path.join(root, "made", "deep"), create: true })).body;
	assert.equal(fs.statSync(path.join(root, "made", "deep")).isDirectory(), true, "create: true makes the folder (and its parents)");
	await hub.host.park(made.id); hub.registry.remove(made.id); // keep the later group checks to their own folders
	assert.equal((await post(id, "session", { action: "new", folder: "relative" })).status, 404, "only absolute paths");
	assert.equal((await post(id, "session", { action: "new", folder: "~/pi-hub-test-missing-" + process.pid })).body.error, "Folder does not exist.", "~ is the home folder (Local uses ~/pi-local)");
	assert.equal((await post(id, "session", { action: "rename", id: created.id, name: "Docs" })).status, 200);
	// Folder and session menus: Copy git URL gives origin without a token stored in it.
	assert.equal((await post(id, "session", { action: "git-url", folder })).status, 404, "no git origin");
	execFileSync("git", ["init", "-q"], { cwd: folder }); execFileSync("git", ["remote", "add", "origin", "https://me:tok3n@github.com/me/proj.git"], { cwd: folder });
	assert.deepEqual((await post(id, "session", { action: "git-url", folder })).body, { url: "https://github.com/me/proj.git" });
	fs.rmSync(path.join(folder, ".git"), { recursive: true, force: true });
	// Plan d21eefbf S08: the session menu's hub links; pairing needs remote access (the tailnet) first.
	assert.deepEqual((await post(id, "links", { action: "list", session: created.id })).body, { comm: 2, hubs: [], pairing: null, links: [] });
	assert.equal((await post(id, "links", { action: "list", session: "nope" })).status, 404);
	assert.match((await post(id, "links", { action: "pair", url: "mac.tail.ts.net:7781" })).body.error, /Turn on remote access first/);
	assert.equal((await post(id, "links", { action: "sessions", hub: "https://mac.tail.ts.net:7781" })).status, 404, "not paired");
	await hub.host.prompt(created.id, "hi"); await until(async () => (await tones()).Docs === "unseen" && "ok");
	assert.equal((await post(id, "session", { action: "park", id: created.id })).status, 200);
	const docs = async () => (await get(id, "sessions")).body.groups.flatMap(group => group.sessions).find(session => session.name === "Docs");
	assert.deepEqual([(await docs()).tone, (await docs()).parked], ["unseen", true], "parking keeps a finished run blue until it is looked at");
	const parkedTimer = await (await fetch(`${origin}/api/sessions/${created.id}/timers`, { method: "POST", headers: { "x-hub-key": localKey, connection: "close", "content-type": "application/json" }, body: JSON.stringify({ kind: "script", command: "exit 0", everyMinutes: 5 }) })).json();
	assert.deepEqual([(await docs()).tone, (await docs()).parked], ["scheduled", true], "a parked session with a timer shows scheduled, not finished");
	assert.equal((await post(id, "session", { action: "cancel-timer", id: created.id, timer: parkedTimer.id })).status, 200);
	assert.equal((await docs()).tone, "unseen");
	await post(created.id, "seen", {});
	assert.equal((await tones()).Docs, "parked");
	assert.equal((await post(id, "session", { action: "unstar", id })).status, 409, "a live session is parked before unstarring");
	assert.equal((await post(id, "session", { action: "bogus", id })).status, 400);
	assert.equal((await post(id, "session", { action: "park", id: "00000000-0000-0000-0000-000000000000" })).status, 404);
	const other = path.join(root, "other"), recentDir = path.join(root, "sessions", "--other--"), recentFile = path.join(recentDir, "r.jsonl");
	fs.mkdirSync(other); fs.mkdirSync(recentDir, { recursive: true });
	fs.writeFileSync(recentFile, JSON.stringify({ type: "session", version: 3, id: "r1", timestamp: "2026-10-18T00:00:00Z", cwd: other }) + "\n");
	const listed = (await get(id, "sessions")).body;
	assert.deepEqual(listed.recents.map(item => [item.file, item.label]), [[recentFile, "other"]]);
	const starred = (await post(id, "session", { action: "star", file: recentFile, name: "" })).body;
	assert.equal(starred.name, "1");
	const after = (await get(id, "sessions")).body;
	assert.deepEqual([after.recents.length, after.groups.map(group => group.label)], [0, ["other", "proj"]], "starring moves it into its folder's group");
	assert.equal((await post(id, "session", { action: "star", file: recentFile })).status, 404, "already starred");
	assert.equal((await post(id, "session", { action: "unstar", id: starred.id })).status, 200);
	assert(fs.existsSync(recentFile), "unstar keeps the file");
	assert.equal((await get(id, "sessions")).body.recents.length, 1, "back in Recents");

	// Request checks.
	assert.equal(await rawGet(`/s/${id}/api/plans?token=${localKey}`, { host: `evil.example:${port}` }), 403, "foreign Host (DNS rebinding)");
	assert.equal(await rawGet(`/s/${id}/api/plans?token=${localKey}`, { host: `localhost:${port}` }), 200);
	assert.equal(await rawGet(`/s/${id}/api/plans?token=${localKey}&pad=${"x".repeat(2100)}`, { host: `127.0.0.1:${port}` }), 414);
	assert.equal((await post(id, "stop", {}, { origin: "http://evil.example" })).status, 403, "foreign Origin");
	assert.equal((await post(id, "stop", {}, { "content-type": "text/plain" })).status, 415, "form posts need JSON");
	const noOrigin = await fetch(`${origin}/s/${id}/api/stop`, { method: "POST", headers: { authorization: `Bearer ${localKey}`, "content-type": "application/json" }, body: "{}" });
	assert.equal(noOrigin.status, 403, "a page POST without Origin");
	assert.equal((await post(id, "message", { text: "x".repeat(70_000) })).status, 413);
	assert.equal((await post(id, "nothing", {})).status, 404);
	const headers = (await get(id, "plans")).headers;
	assert.equal(headers.get("x-content-type-options"), "nosniff");
	assert.match(headers.get("content-security-policy"), /default-src 'none'/);
	assert.match(headers.get("content-security-policy"), /frame-src 'self'/, "View page and explored HTML show in a frame");
	assert.equal(headers.get("referrer-policy"), "no-referrer");
	{ // Bundle-aware launch uses the existing executor, with no model, renderer or network.
		const project = path.join(root, "reference-launch"), owner = randomUUID(), previousOwner = process.env.PI_HUB_SESSION;
		const source = { id: "astryx:theme:neutral", revision: "b".repeat(64), name: "Owned launch fixture", provenance: "Local fixture", license: "Test license" };
		const ref = await addDesignReference(project, owner, { ...source, aspect: "colors", note: "Only these colors" }, async () => ({ source, files: new Map([["colors.css", Buffer.from(":root { --accent: purple; }")]]) }));
		const submission = randomUUID(), data = { text: "Make two variants", target: "product" };
		await freezeReferenceBundle(project, owner, submission, [{ ref: ref.ref, revision: ref.revision }], data);
		const args = { action: "start", brief: data.text, title: "Fixture app", kind: "app", directions: ["Calm", "Bold"], names: ["Calm", "Bold"], bundle: submission };
		const calls = []; let createFails = true, promptFails = false;
		const tools = { hub: async parts => { calls.push(parts); if (parts[0] === "new" && parts[2] === "Bold" && createFails) return { ok: false, text: "Host unavailable" }; if (["new", "fork"].includes(parts[0])) return { ok: true, text: `http://localhost/s/${randomUUID()}/` }; if (parts[0] === "prompt" && promptFails) return { ok: false, text: "Connection lost after dispatch" }; return { ok: true, text: "Sent." }; } };
		process.env.PI_HUB_SESSION = owner;
		try {
			await assert.rejects(runDesign(project, args, tools), /not authorized/); assert.equal(calls.length, 0, "browsing/freezing cannot start generation");
			await authorizeReferenceBundle(project, owner, submission, data);
			process.env.PI_HUB_SESSION = randomUUID(); await assert.rejects(runDesign(project, args, tools), /not authorized/); process.env.PI_HUB_SESSION = owner;
			await assert.rejects(runDesign(project, { ...args, bundle: "" }, tools), /Invalid reference bundle/);
			const results = await Promise.all([runDesign(project, args, tools), runDesign(project, args, tools)]), handles = results[0].sessions.map(item => item.handle);
			assert.deepEqual(results[1].sessions.map(item => item.handle), handles); assert.equal(calls.filter(parts => parts[0] === "new").length, 2, "concurrent starts reserve each direction once");
			const status = await runDesign(project, { action: "status" }, tools), calm = status.find(item => item.name === "Calm"), bold = status.find(item => item.name === "Bold");
			assert(calm.hubSessionId); assert.equal(bold.hubSessionId, undefined); assert.equal(calm.foundation, undefined, "an Astryx reference cannot silently choose the component runtime");
			const first = calls.find(parts => parts[0] === "prompt")[2]; assert.match(first, /untrusted design evidence[\s\S]*Only these colors[\s\S]*colors.css/);
			const beforeReplay = calls.length; await runDesign(project, args, tools); assert.equal(calls.length, beforeReplay, "replay returns handles without retrying partial launches");
			await assert.rejects(runDesign(project, { ...args, directions: ["Changed", "Bold"] }, tools), /different start arguments/);
			createFails = false; promptFails = true;
			const [failed] = await runDesign(project, { action: "open", handle: bold.handle }, tools); assert(failed.hubSessionId); assert.equal(failed.hubStage, "uncertain");
			const afterFailure = calls.length; await runDesign(project, { action: "open", handle: bold.handle }, tools); await runDesign(project, { action: "open", handle: calm.handle }, tools);
			assert.equal(calls.length, afterFailure, "a created session with ambiguous first-prompt delivery is never blindly resent");
			assert.equal(handles.length, 2, "the requested variant count starts exactly two designs");
			promptFails = false;
			// Simulate a reconciled/crash-before-dispatch stage, including an existing scaffold.
			const storeFile = path.join(project, ".pi/designs/sessions.json"), store = JSON.parse(fs.readFileSync(storeFile)); store.sessions.find(item => item.handle === bold.handle).hubStage = "created"; fs.writeFileSync(storeFile, JSON.stringify(store));
			for (const handle of handles) fs.writeFileSync(path.join(project, ".pi/designs", handle, "index.html"), "<h1>Owned fixture</h1>");
			await runDesign(project, { action: "open", handle: bold.handle }, tools); assert.equal(calls.at(-1)[1], failed.hubSessionId); assert.match(calls.at(-1)[2], /Build the design now:[\s\S]*untrusted design evidence/);
			const sessionIds = new Set((await runDesign(project, { action: "status" }, tools)).filter(item => handles.includes(item.handle)).map(item => item.hubSessionId));
			assert.equal(sessionIds.size, 2); for (const session of sessionIds) assert(calls.some(parts => parts[0] === "prompt" && parts[1] === session && /Only these colors[\s\S]*colors\.css/.test(parts[2])), "each variant session receives the attached reference assets");
			const [clone] = await runDesign(project, { action: "clone", handle: calm.handle, name: "Calm copy" }, tools); assert.equal(clone.bundle, submission); assert(!handles.includes(clone.handle));
			assert.deepEqual((await runDesign(project, args, tools)).sessions.map(item => item.handle), handles, "clones retain provenance but never join the original launch reservation");
			const selected = await runDesign(project, { action: "select", handle: calm.handle }, tools), exported = path.join(project, selected.folder), evidence = JSON.parse(fs.readFileSync(path.join(exported, "REFERENCE-SOURCES.json")));
			assert.equal(evidence.mode, "provenance-only"); assert.equal(evidence.refs[0].source.license, "Test license"); assert.equal(evidence.refs[0].aspect, "colors");
			assert(!JSON.stringify(evidence).includes(".pi/designs/references/bundles/"), "exports do not leave broken studio asset dependencies"); assert.match(fs.readFileSync(path.join(exported, "HANDOFF.md"), "utf8"), /not redistributed/);
			const fresh = randomUUID(); await freezeReferenceBundle(project, owner, fresh, [{ ref: ref.ref, revision: ref.revision }], data); await authorizeReferenceBundle(project, owner, fresh, data);
			const another = await runDesign(project, { ...args, bundle: fresh }, tools); assert(another.sessions.every(item => !handles.includes(item.handle)), "an explicit fresh submission creates another batch");
		} finally { if (previousOwner === undefined) delete process.env.PI_HUB_SESSION; else process.env.PI_HUB_SESSION = previousOwner; }
	}
	// P3-11: the agent's web picks become this conversation's library cards; only downloaded images, never other files.
	{
		const project = path.join(root, "found"), downloads = path.join(root, "downloads"), webp = fs.readFileSync(new URL(`../../extensions/astryx-runtime/previews/components/${JSON.parse(fs.readFileSync(new URL("../../extensions/astryx-runtime/previews/components/components.json", import.meta.url), "utf8")).themes.neutral}.webp`, import.meta.url));
		fs.mkdirSync(path.join(downloads, "set"), { recursive: true }); fs.writeFileSync(project + ".jsonl", ""); fs.writeFileSync(project + "-other.jsonl", ""); fs.mkdirSync(project);
		fs.writeFileSync(path.join(downloads, "set", "01.webp"), webp); fs.writeFileSync(path.join(downloads, "set", "02.jpg"), "not an image"); fs.writeFileSync(path.join(root, "outside.webp"), webp);
		const mine = hub.registry.add({ name: "found", folder: project, sessionFile: project + ".jsonl", state: "parked" }).id, other = hub.registry.add({ name: "other", folder: project, sessionFile: project + "-other.jsonl", state: "parked" }).id;
		const good = { title: "Kiosk POS", page: "https://pos.example/kiosk", image: path.join(downloads, "set", "01.webp"), why: "large tiles" };
		const published = await publishFound(project, mine, [good, { ...good, image: path.join(downloads, "set", "02.jpg") }, { ...good, image: path.join(root, "outside.webp") }, { ...good, page: "file:///etc/passwd" }], downloads);
		assert.equal(published.added, 1); assert.equal(published.skipped.length, 3); assert.match(published.skipped.join("\n"), /saved by image_search/);
		assert.equal((await publishFound(project, mine, [good], downloads)).shown, 1, "republishing the same image does not duplicate its card");
		const web = (await get(mine, "designcatalog")).body.entries.filter(item => item.source === "web");
		assert.equal(web.length, 1); assert.equal(web[0].url, good.page); assert.match(web[0].license, /inspiration only/);
		assert.equal((await get(other, "designcatalog")).body.entries.filter(item => item.source === "web").length, 0, "another conversation never sees these results");
		const route = `designimage?id=${encodeURIComponent(web[0].id)}&revision=${web[0].imageRevision}`, image = await get(mine, route);
		assert.equal(image.status, 200); assert.equal(image.headers.get("content-type"), "image/png"); assert.equal((await get(other, route)).status, 404);
		const ref = await post(mine, "designreference", { action: "add", id: web[0].id, revision: web[0].revision, aspect: "layout" });
		assert.equal(ref.status, 200); assert.equal(ref.body.status, "ready"); assert.equal(ref.body.thumbnail, "source.png");
		assert.equal((await post(mine, "designreference", { action: "add", id: web[0].id, revision: web[0].revision, aspect: "region", region: [0, 0, 40, 30] })).status, 200, "found images support region crops");
		const saved = process.env.PI_HUB_SESSION; delete process.env.PI_HUB_SESSION;
		try { await assert.rejects(runDesign(project, { action: "found", items: [good] }, { hub: async () => ({ ok: false, text: "" }) }), /\/wo design/); }
		finally { if (saved !== undefined) process.env.PI_HUB_SESSION = saved; }
	}
	console.log("api ok");
} finally {
	await hub.stop();
	fs.rmSync(root, { recursive: true, force: true });
}
