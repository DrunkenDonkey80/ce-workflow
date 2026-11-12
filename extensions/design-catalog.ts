// Read-only library metadata. Browsing never loads or provisions the optional runtime.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { OWN, designStore, readTree, systemIndex } from "./design.ts";
import { appPreviewFolder, BUILD_FILE, BUILD_STATUS } from "./design-build.ts";
import { astryxRuntime } from "./design-runtime.ts";
import { confined } from "./plan3-files.ts";
import { foundImage, foundItems } from "./design-references.ts";

export type CatalogEntry = {
	id: string; source: "od" | "astryx" | "draft" | "export" | "web"; kind: "system" | "theme" | "component" | "design" | "screenshot";
	name: string; revision: string; preview: "sample" | "image" | "none"; availability: "cached" | "not-cached" | "unavailable";
	license: string; provenance: string; category?: string; description?: string; url?: string; imageRevision?: string;
	folder?: string; page?: string; handle?: string; designRevision?: string; status?: string;
};
const IMAGE_REVISION = "fd5cf0df987791117e96ccc0bec603c64be8b136";
const IMAGE_THEMES = ["butter", "gothic", "matcha", "neutral", "stone", "y2k"];
export function designImage(id: string | null, revision: string | null, cwd?: string, owner?: string) {
	if (id?.startsWith("found:")) return cwd && owner && revision === id.slice(6) ? foundImage(cwd, owner, revision) : undefined;
	const component = id?.startsWith("astryx:component:") ? id.slice(17) : undefined;
	if (component) return revision === shots.lockDigest && Object.hasOwn(shots.images, component) ? fs.readFileSync(new URL(`./astryx-runtime/previews/components/${shots.images[component]}.webp`, import.meta.url)) : undefined;
	const slug = IMAGE_THEMES.find(name => id === `astryx:theme:${name}`);
	if (!slug || revision !== IMAGE_REVISION) return undefined;
	return fs.readFileSync(new URL(`./astryx-runtime/previews/${slug}.webp`, import.meta.url));
}
let astryx;
try { astryx = JSON.parse(fs.readFileSync(new URL("./astryx-runtime/catalog.json", import.meta.url), "utf8")); }
catch (cause) { throw new Error("The bundled design catalog is unreadable; reinstall ce-workflow.", { cause }); }
if (astryx.lockDigest !== astryxRuntime.lockDigest || astryx.version !== astryxRuntime.versions["@astryxdesign/core"]) throw new Error("Design catalog does not match the reviewed Astryx pin.");
// Component pictures from scripts/astryx-component-shots.mjs; a stale set (older pin) is shown as no picture.
let shots: { lockDigest: string; images: Record<string, string> };
try { shots = JSON.parse(fs.readFileSync(new URL("./astryx-runtime/previews/components/components.json", import.meta.url), "utf8")); }
catch { shots = { lockDigest: "", images: {} }; }
if (shots.lockDigest !== astryx.lockDigest) shots = { lockDigest: "", images: {} };

function smallJson(cwd: string, file: string) {
	const full = confined(cwd, file);
	if (fs.statSync(full).size > 64 * 1024) throw new Error("Design metadata is too large.");
	return JSON.parse(fs.readFileSync(full, "utf8"));
}
function boundedTree(directory: string) {
	if (!fs.existsSync(directory)) return new Map<string, Buffer>();
	let bytes = 0, count = 0;
	const dir = fs.opendirSync(directory, { recursive: true });
	try {
		for (let file = dir.readSync(); file; file = dir.readSync()) {
			if (++count > 5000) throw new Error("Preview exceeds 5000 entries.");
			if (file.isFile()) bytes += fs.statSync(path.join(file.parentPath, file.name)).size;
			if (bytes > 32 * 1024 * 1024) throw new Error("Preview exceeds 32 MiB.");
		}
	} finally { dir.closeSync(); }
	return readTree(directory);
}
function digest(files: Map<string, Buffer>, authored = false) {
	const hash = createHash("sha256");
	for (const name of [...files.keys()].sort()) {
		if (authored && ["DESIGN.json", "BRIEF.md", "HANDOFF.md", BUILD_FILE, BUILD_STATUS].includes(name)) continue;
		const bytes = files.get(name)!;
		hash.update(name + "\0" + bytes.length + "\0").update(bytes);
	}
	return hash.digest("hex");
}
function savedEntries(cwd: string, entries: CatalogEntry[], warnings: string[]) {
	// shortcut: saved-source hashes are eager; cache by filesystem signature if large project libraries make this slow.
	const add = (source: "draft" | "export", folder: string, handle: string, name: string, status: string) => {
		try {
			const files = boundedTree(confined(cwd, folder)), pages = [...files.keys()].filter(file => /\.html?$/i.test(file)).sort();
			entries.push({ id: `${source}:${source === "draft" ? handle : folder.slice("docs/designs/".length)}`, source, kind: "design", name: name.slice(0, 200), handle, folder,
				page: files.has("index.html") ? "index.html" : pages[0], revision: digest(files), designRevision: digest(files, true), status,
				preview: pages.length ? "sample" : "none", availability: pages.length ? "cached" : "unavailable", license: "Project-owned; retain its asset notices",
				provenance: `${status}. ${folder}/. Draft and selected export are independent sources; references retain their chosen snapshot.`,
			});
		} catch (error) {
			warnings.push(`Saved design ${name.slice(0, 200)} unavailable: ${error.message}`);
			entries.push({ id: `${source}:${source === "draft" ? handle : folder.slice("docs/designs/".length)}`, source, kind: "design", name: name.slice(0, 200), handle, revision: "unavailable", status, preview: "none", availability: "unavailable", license: "Project-owned; retain its asset notices", provenance: `${status}. Preview unavailable: ${error.message}` });
		}
	};
	try {
		for (const item of designStore(cwd).sessions) add("draft", `.pi/designs/${item.handle}`, item.handle, typeof item.name === "string" ? item.name : item.handle, "Live studio draft (may differ from the last kept version or selected export)");
	} catch (error) { warnings.push(error.message); }
	try {
		const root = confined(cwd, "docs/designs");
		if (fs.existsSync(root)) for (const dir of fs.readdirSync(root, { withFileTypes: true })) if (dir.isDirectory()) {
			const folder = `docs/designs/${dir.name}`;
			if (!fs.existsSync(confined(cwd, `${folder}/DESIGN.json`))) continue;
			try {
				const item = smallJson(cwd, `${folder}/DESIGN.json`);
				if (typeof item?.handle !== "string" || !/^design-\d+$/.test(item.handle) || !Number.isSafeInteger(item.version) || item.version < 1) throw new Error("Invalid selected-export ownership metadata.");
				add("export", folder, item.handle, typeof item.name === "string" ? item.name : dir.name, `Selected export v${item.version}`);
			} catch (error) { warnings.push(`Export ${dir.name} unavailable: ${error.message}`); }
		}
	} catch (error) { warnings.push(error.message); }
}

/** A cached sample's served folder; card previews read it in place, without a copy. */
export async function catalogFolder(cwd: string, id: unknown, revision: unknown) {
	if (typeof id !== "string" || id.length > 240 || typeof revision !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision)) throw Object.assign(new Error("Invalid catalog identity."), { status: 400 });
	const item = (await designCatalog(cwd)).entries.find(entry => entry.id === id);
	if (!item) throw Object.assign(new Error("No such catalog entry."), { status: 404 });
	if (item.revision !== revision) throw Object.assign(new Error("Source changed; refresh the library before inspecting it."), { status: 409 });
	if (!item.folder || !item.page) throw Object.assign(new Error("No local sample is cached. No download or build was started."), { status: 404 });
	return { item, directory: appPreviewFolder(confined(cwd, item.folder), item.source !== "draft") };
}
/** Resolve only catalog IDs; capture is local, bounded and never builds or provisions a runtime. */
export async function catalogFiles(cwd: string, id: unknown, revision: unknown) {
	const { item, directory } = await catalogFolder(cwd, id, revision);
	const files = boundedTree(directory);
	if (!files.has(item.page)) throw Object.assign(new Error("The cached sample is missing."), { status: 404 });
	const captured = digest(files);
	if (item.source !== "od" && directory === confined(cwd, item.folder) && captured !== item.revision) throw Object.assign(new Error("Source changed while reading it; reopen the inspector."), { status: 409 });
	return { item, files, revision: captured, note: directory !== confined(cwd, item.folder) ? "Last published component preview; browsing never recompiles source edits." : "Isolated source sample, not a generated design." };
}

/** Reference capture preserves source bytes; metadata-only entries remain explicitly metadata-only. */
export async function catalogReference(cwd: string, id: unknown, revision: unknown, owner?: string) {
 if (typeof id !== "string" || id.length > 240 || typeof revision !== "string") throw Object.assign(new Error("Invalid catalog identity."), { status: 400 });
 const item = (await designCatalog(cwd, owner)).entries.find(entry => entry.id === id);
 if (!item) throw Object.assign(new Error("No such catalog entry."), { status: 404 });
 if (item.revision !== revision) throw Object.assign(new Error("Source changed; refresh the library before adding it."), { status: 409 });
 if (item.folder && item.page) { const sample = await catalogFiles(cwd, id, revision); return { source: sample.item, files: sample.files }; }
 const files = new Map<string, Buffer>([["SOURCE.json", Buffer.from(JSON.stringify(item, null, 2))]]);
 const image = item.source === "web" ? "source.png" : "source.webp";
 if (item.preview === "image") { const bytes = designImage(item.id, item.imageRevision ?? null, cwd, owner); if (!bytes) throw new Error("Source image is missing."); files.set(image, bytes); }
 if (item.source === "od") throw Object.assign(new Error("The OpenDesign source is not cached. No download was started."), { status: 404 });
 return { source: item, files, thumbnail: files.has(image) ? image : undefined };
}

/** P3-11: the conversation's own web results; another session's owner never sees them. */
function webEntries(cwd: string, owner: string, entries: CatalogEntry[], warnings: string[]) {
	try {
		for (const item of foundItems(cwd, owner).reverse()) entries.push({ id: `found:${item.sha}`, source: "web", kind: "screenshot", name: item.title, description: item.why, url: item.page,
			revision: item.sha, imageRevision: item.sha, preview: "image", availability: "cached", license: "Third-party web image: inspiration only, not licensed for copying",
			provenance: `Found by the agent on ${new URL(item.page).hostname} (web search, ${item.at.slice(0, 10)}).` });
	} catch (error) { warnings.push(error.message); }
}
export async function designCatalog(cwd: string, owner?: string) {
	const index: { commit: string; names: string[]; offline?: string } = await systemIndex(cwd).catch(error => ({ commit: "", names: [], offline: String(error.message).slice(0, 240) }));
	const entries: CatalogEntry[] = [];
	if (/^[0-9a-f]{40}$/.test(index.commit ?? "") && Array.isArray(index.names)) {
		for (const name of index.names) if (typeof name === "string" && /^[a-z0-9][a-z0-9-]{0,60}$/.test(name)) {
			const folder = `.pi/designs/systems/${name}`, url = `https://github.com/nexu-io/open-design/tree/${index.commit}/design-systems/${name}`;
			let source: { commit?: string; files?: unknown } | undefined;
			try { source = smallJson(cwd, `${folder}/SOURCE.json`); } catch { /* not downloaded yet */ }
			const current = source?.commit === index.commit, complete = current && Array.isArray(source.files);
			// V-12: each package gives a Designs card (its components page) and a Themes card (its colors page beside ../tokens.css).
			for (const [id, kind, pages, provenance] of [[`od:${name}`, "system", ["kit.html", "components.html"], "OpenDesign source sample (inspiration, not a project foundation)"], [`od-colors:${name}`, "theme", ["preview/colors.html"], "OpenDesign color page (inspiration, not a project foundation)"]] as const) {
				const page = current ? pages.find(file => fs.statSync(confined(cwd, `${folder}/${file}`), { throwIfNoEntry: false })?.isFile()) : undefined;
				entries.push({ id, source: "od", kind, name, revision: index.commit, preview: page || !complete ? "sample" : "none", availability: page ? "cached" : complete ? "unavailable" : "not-cached",
					folder: page ? folder : undefined, page, license: "Apache-2.0", provenance: page || !complete ? provenance : `${provenance}. This package has no such page.`, url });
			}
		}
	}
	for (const theme of astryx.themes) {
		const image = IMAGE_THEMES.includes(theme.slug);
		entries.push({
			id: `astryx:theme:${theme.slug}`, source: "astryx", kind: "theme", name: theme.displayName, description: theme.description,
			revision: astryx.lockDigest, preview: image ? "image" : "none", availability: image ? "cached" : "unavailable", license: "MIT",
			imageRevision: image ? IMAGE_REVISION : undefined, url: image ? `https://github.com/meta/astryx/blob/${IMAGE_REVISION}/apps/docsite/public/theme-${theme.slug}-preview.png` : undefined,
			provenance: `Astryx ${astryx.version} theme metadata. ${image ? `Static source image from docs 0.7.13 (${IMAGE_REVISION.slice(0, 7)}). ` : "No supplied image. "}Inspiration does not install or select a theme.`,
		});
	}
	for (const [group, components] of Object.entries(astryx.groups) as [string, { name: string; package: string }[]][]) {
		for (const component of components) {
			const image = Object.hasOwn(shots.images, component.name);
			entries.push({
				id: `astryx:component:${component.name}`, source: "astryx", kind: "component", name: component.name, category: group,
				revision: astryx.lockDigest, preview: image ? "image" : "none", availability: image ? "cached" : "unavailable", license: "MIT",
				imageRevision: image ? shots.lockDigest : undefined,
				provenance: `${component.package} ${astryx.version}; ${image ? "picture rendered from its pinned example" : "no picture (its pinned examples do not render alone)"}. Not an installed project dependency.`,
			});
		}
	}
	const warnings: string[] = [];
	if (owner) webEntries(cwd, owner, entries, warnings);
	savedEntries(cwd, entries, warnings);
	return { entries, own: OWN.filter(file => fs.existsSync(confined(cwd, file))), offline: index.offline, warnings, version: astryx.version };
}
