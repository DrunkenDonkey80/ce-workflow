// Videos hub button (a run command): the YouTube channels we watch, what is new there, and digesting it.
// Processed = a digest.md carrying the video id; analyzed for ideas = that digest has the Takeaways section.
// Feeds and the ids passed over on purpose live in docs/research/videos/feeds.json.
import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digestOwner, TAKEAWAYS } from "../extensions/video-digest.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIDEOS = path.join(ROOT, "docs", "research", "videos");
const FEEDS = path.join(VIDEOS, "feeds.json");
const LATEST = 30; // newest entries checked per tab
const PARALLEL = 3;
const HUB_CLI = path.join(ROOT, "hub", "src", "cli.ts");

/** id → { dir, takeaways } for every digest on disk. */
export function digestIndex(dir = VIDEOS) {
	const index = new Map();
	for (const name of existsSync(dir) ? readdirSync(dir) : []) {
		const id = digestOwner(path.join(dir, name));
		if (id) index.set(id, { dir: name, takeaways: readFileSync(path.join(dir, name, "digest.md"), "utf8").includes(TAKEAWAYS) });
	}
	return index;
}

/** Feed entries neither digested nor passed over. */
export const newVideos = (entries, index, seen) => entries.filter((entry) => !index.has(entry.id) && !seen.includes(entry.id));

/** One option title per video, unique so a picked title maps back to its video. */
export const videoLabel = (entry) => `${entry.short ? "short" : clock(entry.duration)} · ${entry.title} [${entry.id}]`;
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** "https://www.youtube.com/@x/videos" → "https://www.youtube.com/@x"; undefined for anything but a YouTube channel. */
export function channelUrl(text) {
	const m = String(text ?? "").trim().match(/^https?:\/\/(?:www\.|m\.)?youtube\.com\/(@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)/i);
	return m ? `https://www.youtube.com/${m[1]}` : undefined;
}

const run = (command, args, timeout, options = {}) => new Promise((resolve) => execFile(command, args, { timeout, windowsHide: true, maxBuffer: 10_000_000, ...options },
	(error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, out: String(stdout), err: String(stderr) })));

async function ytdlp(args) {
	for (const bin of ["yt-dlp", path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links", "yt-dlp.exe")]) {
		const result = await run(bin, ["-q", "--no-warnings", "--encoding", "utf-8", ...args], 300_000);
		if (result.code !== "ENOENT") return result;
	}
	throw new Error("yt-dlp is missing: winget install yt-dlp.yt-dlp");
}

export async function listTab(feed, tab) {
	const result = await ytdlp(["--flat-playlist", "--playlist-end", String(LATEST), "--print", "%(id)s\t%(duration)s\t%(title)s", `${feed.url}/${tab}`]);
	if (result.code) return []; // a channel without that tab
	return result.out.split(/\r?\n/).filter(Boolean).map((line) => {
		const [id, duration, ...title] = line.split("\t");
		return { id, short: tab === "shorts", duration: Number(duration) || 0, title: title.join(" "), feed: feed.name };
	});
}

const hub = (args, input) => new Promise((resolve) => {
	const child = spawn(process.env.PI_HUB_NODE || process.execPath, [HUB_CLI, ...args], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
	let out = "";
	child.stdout.on("data", (chunk) => (out += chunk));
	child.on("close", (code) => resolve({ code, out }));
	child.stdin.end(input ?? "");
});
const notice = (text) => hub(["notice", text]);
const progress = (done, total, label) => hub(["progress", String(done), String(total), label]);
/** An ask_user form on the hub page; undefined when cancelled. */
async function ask(form) {
	const result = await hub(["ask", "--json", "-", "--raw"], JSON.stringify(form));
	if (result.code) return undefined;
	try { return JSON.parse(result.out); } catch { throw new Error(`pi-hub ask gave no JSON: ${result.out.slice(0, 200)}`); }
}

function load() {
	if (!existsSync(FEEDS)) return { feeds: [], seen: [] };
	// A broken file stops the button instead of being overwritten with an empty list.
	try { return JSON.parse(readFileSync(FEEDS, "utf8")); } catch (error) { throw new Error(`${FEEDS} is not valid JSON: ${error.message}`); }
}
const save = (state) => writeFileSync(FEEDS, `${JSON.stringify(state, null, "\t")}\n`);

/** One headless Pi run per video (the video_digest tool plus the agent's takeaways), PARALLEL at a time. */
async function digest(urls, what) {
	const env = { ...process.env };
	delete env.PI_HUB_SESSION; // the child Pi is not this hub session
	let done = 0;
	const failed = [];
	const queue = [...urls];
	await progress(0, urls.length, what);
	const worker = async () => {
		for (let url; (url = queue.shift()); ) {
			const prompt = `Digest ${url} with video_digest, then write its takeaways section for ce-workflow.`;
			// shell: pi is pi.cmd on Windows; the prompt has no quotes or shell metacharacters.
			const result = await run(process.platform === "win32" ? "pi.cmd" : "pi", ["-p", `"${prompt}"`], 1_800_000, { cwd: ROOT, env, shell: true });
			if (result.code) failed.push(url);
			await progress(++done, urls.length, what);
		}
	};
	await Promise.all(Array.from({ length: Math.min(PARALLEL, urls.length) }, worker));
	await notice(`Videos: ${what} finished, ${urls.length - failed.length}/${urls.length} ok${failed.length ? `; failed: ${failed.join(" ")}` : ""}. Digests are not committed.`);
}

async function main() {
	const state = load();
	await notice(`Videos: checking ${state.feeds.length} feeds…`);
	const index = digestIndex();
	const entries = (await Promise.all(state.feeds.flatMap((feed) => [listTab(feed, "shorts"), listTab(feed, "videos")]))).flat();
	const fresh = newVideos(entries, index, state.seen);
	const bare = [...index.entries()].filter(([, digest]) => !digest.takeaways);
	const lines = state.feeds.map((feed) => {
		const own = fresh.filter((entry) => entry.feed === feed.name);
		return `${feed.name} (${feed.url}): ${own.filter((e) => e.short).length} new shorts, ${own.filter((e) => !e.short).length} new full videos`;
	});
	const options = [
		...(fresh.length ? [{ title: `Process all ${fresh.length} new`, description: "One headless Pi run per video (digest + takeaways), 3 at a time; about $0.10 a short, $0.25 a full video." },
			{ title: "Pick which to process", description: "The ones you leave unticked are marked seen and stop showing as new." },
			{ title: "Mark all new as seen", description: "Nothing is processed; they stop showing as new." }] : []),
		...(bare.length ? [{ title: `Analyze ${bare.length} digests for ideas`, description: "They have no Takeaways section yet; a Pi run per digest writes it." }] : []),
		{ title: "Add a feed", description: "A YouTube channel URL, e.g. https://www.youtube.com/@mattpocockuk" },
		...(state.feeds.length ? [{ title: "Remove a feed" }] : []),
	];
	const answer = await ask({
		question: "Video feeds",
		context: `${lines.join("\n") || "No feeds yet."}\n\n${index.size} videos digested, ${index.size - bare.length} analyzed for ideas (Takeaways). Newest ${LATEST} per tab checked.`,
		options, allowFreeform: false,
	});
	const pick = answer?.selections?.[0] ?? "";
	if (pick.startsWith("Process all")) return digest(fresh.map((e) => `https://www.youtube.com/watch?v=${e.id}`), `${fresh.length} new videos`);
	if (pick === "Mark all new as seen") { state.seen.push(...fresh.map((e) => e.id)); save(state); return notice(`Videos: ${fresh.length} marked seen.`); }
	if (pick === "Pick which to process") {
		const chosen = await ask({ question: "Which videos should be digested?", context: "Unticked ones are marked seen.", options: fresh.map((e) => ({ title: videoLabel(e), description: e.feed })), allowMultiple: true, allowFreeform: false });
		if (!chosen) return;
		const picked = fresh.filter((e) => chosen.selections?.includes(videoLabel(e)));
		state.seen.push(...fresh.filter((e) => !picked.includes(e)).map((e) => e.id));
		save(state);
		return picked.length ? digest(picked.map((e) => `https://www.youtube.com/watch?v=${e.id}`), `${picked.length} picked videos`) : notice("Videos: nothing picked; all marked seen.");
	}
	if (pick.startsWith("Analyze")) return digest(bare.map(([id]) => `https://www.youtube.com/watch?v=${id}`), `${bare.length} digests to analyze`);
	if (pick === "Add a feed") {
		const typed = await ask({ question: "YouTube channel URL", context: "e.g. https://www.youtube.com/@mattpocockuk" });
		const url = channelUrl(typed?.text);
		if (!url) return typed && notice(`Videos: not a YouTube channel URL: ${typed.text}`);
		if (state.feeds.some((feed) => feed.url.toLowerCase() === url.toLowerCase())) return notice("Videos: that feed is already watched.");
		const name = (await ytdlp(["--flat-playlist", "--playlist-end", "1", "--print", "%(channel)s", `${url}/videos`])).out.split(/\r?\n/)[0]?.trim() || url;
		state.feeds.push({ name, url });
		save(state);
		return notice(`Videos: watching ${name}. Click Videos again to see what is new.`);
	}
	if (pick === "Remove a feed") {
		const gone = await ask({ question: "Stop watching which feed?", options: state.feeds.map((feed) => ({ title: feed.name, description: feed.url })), allowFreeform: false });
		state.feeds = state.feeds.filter((feed) => feed.name !== gone?.selections?.[0]);
		save(state);
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => notice(`Videos failed: ${error.message}`));
}
