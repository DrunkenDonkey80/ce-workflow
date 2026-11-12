// Draft-local identities and bounded local snapshots. Reference content is evidence, never instructions.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { atomic, confined, read, withPlanLock } from "./plan3-files.ts";
import { processPng } from "./screen-read.ts";

export const REFERENCE_ASPECTS = ["whole", "colors", "typography", "layout", "background", "component", "region"] as const;
export type ReferenceSource = { id: string; revision: string; name: string; provenance: string; license: string; url?: string };
export type ReferenceSnapshot = { source: ReferenceSource; files: Map<string, Buffer>; thumbnail?: string };
export type DesignReference = { ref: string; revision: number; source: ReferenceSource; aspect: string; note: string; region?: number[]; status: "pending" | "ready" | "failed" | "removed"; snapshot: string; files?: { path: string; digest: string; bytes: number }[]; thumbnail?: string; error?: string };
type References = { version: 1; next: number; refs: DesignReference[] };
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function root(_cwd: string, owner: string) {
 if (typeof owner !== "string" || !uuid.test(owner)) throw fail(400, "Invalid reference owner.");
 return `.pi/designs/references/library/${owner}`;
}
function index(cwd: string, owner: string) { return confined(cwd, `${root(cwd, owner)}/index.json`); }
export function designReferences(cwd: string, owner: string): References {
 const file = index(cwd, owner);
 if (!fs.existsSync(file)) return { version: 1, next: 1, refs: [] };
 let value: References;
 try { value = JSON.parse(read(file, 2_000_000)); } catch (cause) { throw new Error("Reference draft is unreadable; it was not overwritten.", { cause }); }
 if (value?.version !== 1 || !Number.isSafeInteger(value.next) || value.next < 1 || value.next > 10001 || !Array.isArray(value.refs) || value.refs.length !== value.next - 1 || value.refs.some((ref, i) => ref?.ref !== `ref${i + 1}` || !uuid.test(ref.snapshot) || !Number.isSafeInteger(ref.revision) || ref.revision < 1 || !["pending", "ready", "failed", "removed"].includes(ref.status) || !REFERENCE_ASPECTS.includes(ref.aspect as typeof REFERENCE_ASPECTS[number]) || typeof ref.note !== "string" || ref.note.length > 4000 || typeof ref.source?.id !== "string" || typeof ref.source?.revision !== "string")) throw fail(409, "Invalid reference draft; it was not overwritten.");
 return value;
}
async function change<T>(cwd: string, owner: string, update: (store: References) => T) {
 return withPlanLock(index(cwd, owner), () => {
  const store = designReferences(cwd, owner), result = update(store);
  const encoded = JSON.stringify(store);
  if (Buffer.byteLength(encoded) > 2_000_000) throw fail(413, "Reference draft metadata limit reached; remove unused references.");
  atomic(index(cwd, owner), encoded); return result;
 });
}
export function referenceInput(input: { id?: unknown; revision?: unknown; aspect?: unknown; note?: unknown; region?: unknown }) {
 if (typeof input.id !== "string" || !input.id || input.id.length > 240 || typeof input.revision !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(input.revision)) throw fail(400, "Invalid source identity.");
 const aspect = input.aspect ?? "whole", note = input.note ?? "";
 if (!REFERENCE_ASPECTS.includes(aspect as typeof REFERENCE_ASPECTS[number]) || typeof note !== "string" || note.length > 4000) throw fail(400, "Invalid reference aspect or note.");
 const region = input.region;
 if (aspect === "region" && region === undefined) throw fail(400, "A reference region is required.");
 if (region !== undefined && (aspect !== "region" || !Array.isArray(region) || region.length !== 4 || region.some(n => !Number.isSafeInteger(n) || n < 0 || n > 10000) || region[2] <= 0 || region[3] <= 0)) throw fail(400, "Invalid reference region.");
 return { id: input.id, revision: input.revision, aspect: aspect as string, note, ...(region ? { region: region as number[] } : {}) };
}
export async function addDesignReference(cwd: string, owner: string, input: Parameters<typeof referenceInput>[0], capture: () => Promise<ReferenceSnapshot>) {
 const wanted = referenceInput(input);
 const prepared = await change(cwd, owner, store => {
  const duplicate = store.refs.find(ref => ["pending", "ready"].includes(ref.status) && ref.source.id === wanted.id && ref.source.revision === wanted.revision && ref.aspect === wanted.aspect && JSON.stringify(ref.region) === JSON.stringify(wanted.region));
  if (duplicate) return { ref: structuredClone(duplicate), existing: true };
  if (store.refs.filter(ref => ["pending", "ready"].includes(ref.status)).length >= 16 || store.next > 10000) throw fail(400, "Reference draft limit reached (16 active references).");
  const ref: DesignReference = { ref: `ref${store.next++}`, revision: 1, source: { id: wanted.id, revision: wanted.revision, name: wanted.id, provenance: "Capture pending", license: "Pending" }, aspect: wanted.aspect, note: wanted.note, region: wanted.region, status: "pending", snapshot: randomUUID() };
  store.refs.push(ref); return { ref: structuredClone(ref), existing: false };
 });
 if (prepared.existing) return prepared.ref;
 try {
  const captured = await capture();
  if (captured.source.id !== wanted.id || captured.source.revision !== wanted.revision) throw fail(409, "Captured source revision changed.");
  let bytes = 0;
  if (!captured.files.size || captured.files.size > 5000) throw fail(413, "Reference needs 1–5000 source files.");
  const snapshotRoot = confined(cwd, `${root(cwd, owner)}/${prepared.ref.snapshot}`);
  for (const [name, data] of captured.files) { confined(snapshotRoot, name); bytes += data.length; }
  if (bytes > 32 * 1024 * 1024) throw fail(413, "Reference exceeds 32 MiB.");
  if (captured.thumbnail && (!/\.(?:png|webp)$/i.test(captured.thumbnail) || !captured.files.has(captured.thumbnail))) throw fail(400, "Invalid reference thumbnail.");
  if (wanted.region) {
   if (!captured.thumbnail) throw fail(400, "A region needs a supplied image.");
   const original = captured.files.get(captured.thumbnail)!;
   const { convertToPng } = await import("@earendil-works/pi-coding-agent");
   const png = await convertToPng(original.toString("base64"), captured.thumbnail.endsWith(".png") ? "image/png" : "image/webp");
   if (!png) throw fail(503, "The host could not decode this source image; no region was attached.");
   let crop: Buffer;
   try { crop = processPng(Buffer.from(png.data, "base64"), wanted.region, 320).png; }
   catch (error) { throw fail(400, "Invalid reference crop: " + error.message); }
   if (captured.files.size >= 5000 || bytes + crop.length > 32 * 1024 * 1024) throw fail(413, "Cropped reference exceeds its snapshot limit.");
   captured.thumbnail = `region-${prepared.ref.snapshot}.png`; captured.files.set(captured.thumbnail, crop);
  }
  return await change(cwd, owner, store => {
   const ref = store.refs.find(ref => ref.ref === prepared.ref.ref)!;
   // A removed/revised reference cannot be resurrected by an older asynchronous capture.
   if (ref.status !== "pending" || ref.revision !== prepared.ref.revision || ref.snapshot !== prepared.ref.snapshot) return structuredClone(ref);
   const folder = confined(cwd, `${root(cwd, owner)}/${ref.snapshot}`);
   fs.mkdirSync(folder, { recursive: true });
   try {
    const files = [...captured.files].map(([name, data]) => {
     const file = confined(folder, name);
     fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data, { flag: "wx", mode: 0o600 });
     return { path: name, digest: hash(data), bytes: data.length };
    });
    Object.assign(ref, { source: captured.source, files, thumbnail: captured.thumbnail, status: "ready", revision: ref.revision + 1 });
    return structuredClone(ref);
   } catch (error) { fs.rmSync(folder, { recursive: true, force: true }); throw error; }
  });
 } catch (error) {
  await change(cwd, owner, store => {
   const ref = store.refs.find(ref => ref.ref === prepared.ref.ref)!;
   if (ref.status === "pending" && ref.revision === prepared.ref.revision) Object.assign(ref, { status: "failed", error: String(error.message).slice(0, 500), revision: ref.revision + 1 });
  });
  throw error;
 }
}
export function editDesignReference(cwd: string, owner: string, id: unknown, revision: unknown, note?: unknown) {
 if (typeof id !== "string" || !/^ref[1-9]\d{0,4}$/.test(id) || !Number.isSafeInteger(revision) || note !== undefined && (typeof note !== "string" || note.length > 4000)) throw fail(400, "Invalid reference edit.");
 return change(cwd, owner, store => {
  const ref = store.refs.find(ref => ref.ref === id);
  if (!ref || ref.status === "removed") throw fail(404, "No such reference.");
  if (ref.revision !== revision) throw fail(409, "Reference changed; refresh before editing it.");
  if (note !== undefined && ref.status !== "ready") throw fail(409, "Wait for the reference capture before editing its note.");
  if (note === undefined) { ref.status = "removed"; ref.files = undefined; ref.thumbnail = undefined; ref.note = ""; ref.source = { id: ref.source.id, revision: ref.source.revision, name: "Removed reference", provenance: "Removed", license: "Removed" }; } else ref.note = note as string;
  ref.revision++; return structuredClone(ref);
 });
}
export function referenceAssets(cwd: string, owner: string, id: unknown) {
 if (typeof id !== "string" || !/^ref[1-9]\d{0,4}$/.test(id)) throw fail(400, "Invalid reference ID.");
 const ref = designReferences(cwd, owner).refs.find(ref => ref.ref === id && ref.status === "ready");
 if (!ref || !Array.isArray(ref.files) || !ref.files.length || ref.files.length > 5000) throw fail(404, "Reference assets unavailable.");
 const files = new Map<string, Buffer>(); let total = 0;
 for (const file of ref.files) {
  if (typeof file.path !== "string" || !/^[a-f0-9]{64}$/.test(file.digest) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || (total += file.bytes) > 32 * 1024 * 1024) throw fail(409, "Invalid reference asset manifest.");
  const source = confined(confined(cwd, `${root(cwd, owner)}/${ref.snapshot}`), file.path), info = fs.lstatSync(source);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== file.bytes) throw fail(409, "Reference assets changed or are missing.");
  const data = fs.readFileSync(source);
  if (hash(data) !== file.digest) throw fail(409, "Reference asset digest mismatch.");
  files.set(file.path, data);
 }
 return { ref, files };
}
