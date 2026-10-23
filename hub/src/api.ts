// H5-03: the page API under /s/<session>/api/. The endpoint map is in plan 0db155f7 Findings ("H5-03 endpoint map").
// Plans, diagrams, files and images are read here with ce-workflow's Pi-free modules, so they also work while parked;
// what only Pi knows goes through RPC or a hub call (ce-workflow /pi-hub).
import type http from "node:http";
import { execFile } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyDiagram, loadDiagram } from "../../extensions/plan3-diagram.ts";
import { webTarget } from "../../extensions/plan3-web.ts";
import { FileRefused, listFiles, readProjectDiff, readProjectFile } from "./files.ts";
import { readLinkedImage, readPastedImage, savePastedImage } from "./images.ts";
import { linkedFiles, openLinkedFile, sendLinkedFile } from "./linked-files.ts";
import { currentPlan, listPlans } from "../../extensions/plan3.ts";
import { toForm, toResponse } from "./forms.ts";
import { nextName as nextFreeName, type Registry, scanRecents, star } from "./registry.ts";
import type { RpcRecord } from "./rpc-client.ts";
import type { Usage } from "./usage.ts";
import type { Pool } from "./pool.ts";
import type { ParkedModels } from "./pi-sdk.ts";
import type { SessionHost } from "./sessions.ts";
import type { SessionView } from "./view.ts";
import type { Scheduler } from "./scheduler.ts";
import { runCommand, type Commands } from "./commands.ts";

const EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const ANSWER_FIELDS = ["target", "askId", "text", "selections", "comment", "answers", "action", "value", "values", "cancel"];
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const parse = (text: unknown) => { try { return JSON.parse(String(text)); } catch { return undefined; } };
const only = (data: Record<string, unknown>, fields: string[], message: string) => { if (Object.keys(data).some(key => !fields.includes(key))) throw fail(400, message); };
type Target = { kind: "product" } | { kind: "plan"; id: string };
type Plan = Awaited<ReturnType<typeof listPlans>>[number];

export function createPageApi({ host, registry, views, scheduler, usage, pool, models, commands, settings = () => ({}) }: { host: SessionHost; registry: Registry; views: Map<string, SessionView>; scheduler?: Scheduler; usage?: Usage; pool?: Pool; models?: ParkedModels; commands?: Commands; settings?: () => Record<string, unknown> }) {
	const folder = (id: string) => registry.get(id)!.folder;
	const published = (id: string) => host.live.get(id)?.published.state as { plan?: { id: string }; modes?: unknown } | undefined;

	/** The session's plan: the one Pi published, else the newest open plan (what Pi would pick, ce-workflow R6). */
	function current(id: string, plans: Plan[]) {
		const pick = plans.find(plan => plan.id === published(id)?.plan?.id && plan.status !== "complete");
		return pick ?? currentPlan({}, plans);
	}
	async function resolve(id: string, wanted?: string | null) {
		const plans = await listPlans(folder(id)), now = current(id, plans);
		const target: Target = wanted ? webTarget(wanted) : now ? { kind: "plan", id: now.id } : { kind: "product" };
		if (target.kind === "product") return { target, plans, now, resolved: { kind: "product" as const } };
		const plan = plans.find(item => item.id === target.id);
		if (!plan) throw fail(404, "Displayed plan no longer exists.");
		return { target, plans, now, resolved: { kind: "plan" as const, plan } };
	}

	/** S-10: a parked session's model and thinking level: what Pi last reported, else read from its file (and kept). */
	async function parkedModel(id: string) {
		const record = registry.get(id)!;
		if (record.model === undefined && record.sessionFile && models) {
			const read = await models.fromFile(record.sessionFile).catch(() => null);
			if (read) return registry.update(id, { model: read.model, thinking: read.thinking });
		}
		return record;
	}

	// Right after a compaction Pi reports null tokens (its footer shows "?"); show Pi's own post-compaction estimate instead.
	// Commit / Commit and push / Pull latest buttons and the sidebar's per-folder file line: changed files by kind, unpushed and unpulled
	// commits; null outside a git repository. "behind" needs a fetch: one quiet background fetch per folder every 5 minutes, seen on the
	// next status. Every open page polls the sidebar, so there one git status per folder serves all pages for 4 s; status reads fresh.
	type GitState = { changed: number; added: number; modified: number; deleted: number; untracked: number; ahead: number; behind: number } | null;
	const fetched = new Map<string, number>(), gitCache = new Map<string, { at: number; state: Promise<GitState> }>();
	const readGit = (cwd: string) => new Promise<GitState>(resolve => execFile("git", ["status", "--porcelain=v1", "--branch"], { cwd, timeout: 5000, windowsHide: true }, (error, out) => {
		if (error) return resolve(null);
		const [head = "", ...files] = out.split("\n").filter(Boolean), count = (test: (xy: string) => boolean) => files.filter(line => test(line.slice(0, 2))).length;
		if (Date.now() - (fetched.get(cwd) ?? 0) > 300_000) { fetched.set(cwd, Date.now()); execFile("git", ["fetch", "--quiet"], { cwd, timeout: 60_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, () => {}); }
		const untracked = count(xy => xy === "??"), added = count(xy => xy[0] === "A"), deleted = count(xy => xy[0] !== "A" && xy.includes("D"));
		resolve({ changed: files.length, added, modified: files.length - untracked - added - deleted, deleted, untracked, ahead: Number(/\bahead (\d+)/.exec(head)?.[1] ?? 0), behind: Number(/\bbehind (\d+)/.exec(head)?.[1] ?? 0) });
	}));
	const gitState = (cwd: string) => {
		const hit = gitCache.get(cwd);
		if (hit && Date.now() - hit.at < 4000) return hit.state;
		const state = readGit(cwd); gitCache.set(cwd, { at: Date.now(), state }); return state;
	};
	const contextTokens = (tokens?: number | null, compacted?: number) => typeof tokens === "number" ? { tokens } : typeof compacted === "number" ? { tokens: compacted, estimated: true } : { tokens: null };
	/** ce-workflow webStatus; context needs a running Pi, model and effort come from the record while parked. */
	async function status(id: string) {
		const record = registry.get(id)!, live = host.live.get(id);
		const base = { folder: path.basename(record.folder), tab: record.name, modes: published(id)?.modes ?? record.modes ?? { research: "off", night: "off" }, git: await readGit(record.folder), commands: commands?.list(record.folder) ?? [] };
		if (!live) { const parked = await parkedModel(id); return { ...base, model: parked.model ?? null, effort: parked.thinking ?? null, context: null, parked: true }; }
		const [state, stats] = await Promise.all([live.rpc.send({ type: "get_state" }), live.rpc.send({ type: "get_session_stats" })]);
		void host.remember(live, state);
		const model = state.data?.model;
		return { ...base, model: model ? { provider: model.provider, id: model.id, name: model.name ?? model.id } : null, effort: state.data?.thinkingLevel ?? null, context: stats.data?.contextUsage?.percent ?? null, ...contextTokens(stats.data?.contextUsage?.tokens, live.compactedTokens), window: stats.data?.contextUsage?.contextWindow ?? null };
	}
	const publishStatus = async (id: string) => { const value = await status(id); views.get(id)?.publish("status", value); return value; };

	/** Snapshot extras, as ce-workflow's snapshot: target, current, status and (for Pi's own plan) its action state. */
	async function extras(id: string, wanted?: string | null) {
		// No seen() here: background tabs and the app's hidden tabs reconnect too; only a page in front of the user posts "seen".
		const { target, now } = await resolve(id, wanted);
		const plan = published(id)?.plan; // shortcut: only Pi's current plan carries bias/finishable; another displayed plan shows without its action row until Pi switches to it.
		return { target, current: now?.id ?? null, status: await status(id), ...(plan && target.kind === "plan" && plan.id === target.id ? { plan } : {}) };
	}

	async function parkedModels(id: string) {
		const record = await parkedModel(id);
		const scoped = models ? await models.scoped(record.folder).catch(() => ({ models: [], unresolved: [] })) : { models: [], unresolved: [] };
		const note = scoped.models.length ? undefined : "No scoped models in Pi settings; only the session's own model is shown.";
		return { model: record.model ?? null, effort: record.thinking ?? null, scoped: scoped.models.length ? scoped.models : record.model ? [record.model] : [], others: [], unresolved: scoped.unresolved, parked: true, note };
	}

	/** A hub call needs a running Pi; writes start a parked session, reads do not. */
	async function call(id: string, endpoint: string, data: Record<string, unknown>, { start = true } = {}) {
		if (!host.live.has(id) && !start) throw fail(409, "Session is parked; resume it first.");
		await host.resume(id); // also waits for a session that is still starting (S-15)
		const result = await host.call(id, endpoint, data);
		if (!result.ok) throw fail(result.status ?? 500, result.error ?? "Hub call failed.");
		return result.value;
	}

	/** Open forms for the snapshot (H5-04): every dialog Pi has open, as page forms. */
	const forms = (id: string) => [...host.pendingDialogs(id).flatMap(dialog => toForm(dialog) ?? []), ...[...scriptAsks.get(id)?.values() ?? []].map(ask => ask.form)];
	const openDialog = (id: string, askId: unknown) => host.pendingDialogs(id).find(dialog => dialog.id === askId && toForm(dialog));

	// `pi-hub ask` from a run command's script: an ask_user form the hub holds itself (no Pi, no model turn), parked
	// sessions too. The CLI's request stays open until the page answers; a script that dies takes its form with it.
	const scriptAsks = new Map<string, Map<string, { form: Record<string, unknown> & { askId: string }; done: (answer: Record<string, unknown>) => void }>>();
	const closeAsk = (id: string, askId: string) => { if (scriptAsks.get(id)?.delete(askId)) views.get(id)?.publish("dialog_closed", { askId }); };
	function scriptAsk(id: string, data: Record<string, unknown>, closed: Promise<unknown>): Promise<Record<string, unknown>> {
		if (!registry.get(id)) throw fail(404, "Unknown session.");
		const question = (value: unknown) => {
			const item = value as Record<string, unknown>;
			if (!item || typeof item.question !== "string" || !item.question.trim()) throw fail(400, "question: the text to ask.");
			if (item.options !== undefined && !Array.isArray(item.options)) throw fail(400, "options: a list.");
			const options = ((item.options ?? []) as unknown[]).map(option => typeof option === "string" ? { title: option } : option as Record<string, unknown>);
			if (options.some(option => !option || typeof option.title !== "string" || !option.title)) throw fail(400, "options: titles (strings or {title, description}).");
			return { question: item.question, ...(typeof item.context === "string" ? { context: item.context } : {}), options, allowMultiple: item.allowMultiple === true, allowFreeform: item.allowFreeform !== false, ...(typeof item.initialText === "string" ? { initialText: item.initialText } : {}) };
		};
		const askId = "script-" + crypto.randomUUID();
		const form = Array.isArray(data.questions)
			? { askId, questions: data.questions.map(question), allowComment: data.allowComment === true }
			: { askId, ...question(data), allowComment: data.allowComment === true };
		return new Promise(done => {
			const open = scriptAsks.get(id) ?? new Map(); scriptAsks.set(id, open);
			open.set(askId, { form, done });
			views.get(id)?.publish("dialog", form);
			void closed.then(() => closeAsk(id, askId));
		});
	}

	// H5-05: the session bar. A finished run stays "unseen" until a page opens the session or shows it in front of the user.
	const unseen = new Set<string>();
	const seen = (id: string) => unseen.delete(id);
	function tone(id: string) {
		if (registry.get(id)?.state === "terminal") return "terminal";
		if (forms(id).length) return "waiting"; // a script's question waits on a parked session too
		if (!host.live.has(id)) return "parked";
		if (host.busyReasons(id).length) return "working";
		if (scheduler?.list(id).length) return "scheduled"; // D4: idle, a timer will wake it
		return unseen.has(id) ? "unseen" : "seen";
	}
	// When an idle live session auto-parks (D16).
	function parkNote(id: string) {
		const live = host.live.get(id);
		if (!live || !host.idleParkMinutes || host.busyReasons(id).length) return undefined;
		return `parks in ${Math.max(1, Math.ceil((live.lastActivity + host.idleParkMinutes * 60_000 - Date.now()) / 60_000))} min`;
	}
	// The sidebar's plan line: steps done of total for a live session working on a plan.
	function planProgress(id: string) {
		const plan = (host.live.get(id)?.published.state as { plan?: { done?: number; total?: number } } | undefined)?.plan;
		return plan?.total ? { done: plan.done ?? 0, total: plan.total } : undefined;
	}
	// D11: the row shows timers (countdown, last run); ticks never reach the chat.
	const timers = (id: string) => scheduler?.list(id).sort((a, b) => a.dueAt - b.dueAt).map(t => ({ id: t.id, kind: t.kind, dueAt: t.dueAt, every: t.every, lastRun: t.lastRun, label: (t.text ?? t.command ?? "").slice(0, 80) }));
	async function sessions() {
		const groups = await Promise.all(registry.groups().map(async group => ({ ...group, git: await gitState(group.folder), sessions: group.sessions.map(record => ({ id: record.id, name: record.name, tone: tone(record.id), plan: planProgress(record.id), park: parkNote(record.id), timers: timers(record.id) })) })));
		const recents = (await scanRecents(registry)).map(recent => ({ file: recent.file, folder: recent.cwd, label: path.basename(recent.cwd) || recent.cwd, name: recent.name ?? null, modified: recent.modified }));
		return { groups, recents, settings: settings() };
	}
	/** The first free number in a folder group: sessions are named 1, 2, 3… unless renamed. */
	const nextName = (folder: string) => nextFreeName(registry, folder);
	async function session(data: Record<string, unknown>) {
		only(data, ["target", "action", "id", "name", "folder", "file", "create", "timer"], "Invalid session fields.");
		const id = typeof data.id === "string" ? data.id : "", name = typeof data.name === "string" ? data.name.trim() : "";
		const known = () => { if (!registry.get(id)) throw fail(404, "Unknown session."); return id; };
		switch (data.action) {
			case "new": {
				// A known group, or (New folder) an existing absolute folder, which starts its group.
				const typed = typeof data.folder === "string" ? data.folder.trim().replace(/^"(.*)"$/, "$1") : "";
				const folder = !typed ? undefined : registry.groups().find(group => group.folder.toLowerCase() === path.resolve(typed).toLowerCase())?.folder
					?? (path.isAbsolute(typed) && statSync(typed, { throwIfNoEntry: false })?.isDirectory() ? path.resolve(typed) : undefined);
				// A missing absolute folder is created only after the page asked (create: true); its parent may be missing too.
				if (!folder && data.create === true && path.isAbsolute(typed) && !statSync(typed, { throwIfNoEntry: false })) {
					mkdirSync(typed, { recursive: true });
					return host.create(path.resolve(typed), name || nextName(path.resolve(typed)));
				}
				if (!folder) throw fail(404, path.isAbsolute(typed) && !statSync(typed, { throwIfNoEntry: false }) ? "Folder does not exist." : "No such folder; enter the full path of an existing folder.");
				return host.create(folder, name || nextName(folder));
			}
			case "rename": if (!name) throw fail(400, "Name required."); return host.rename(known(), name);
			case "park": await host.park(known()); return { ok: true };
			case "resume": { const resumed = known(); await host.resume(resumed); await publishStatus(resumed).catch(() => undefined); return { ok: true }; } // the page leaves its parked look (S-12)
			case "reload": await host.restart(known()); return { ok: true };
			case "terminal": await host.openTerminal(known()); return { ok: true };
			case "star": {
				const recent = (await scanRecents(registry)).find(item => item.file === data.file);
				if (!recent) throw fail(404, "That session is no longer recent.");
				return star(registry, recent, name || nextName(recent.cwd));
			}
			case "cancel-timer":
				if (!scheduler?.list(known()).some(t => t.id === data.timer)) throw fail(404, "No such timer.");
				return { ok: scheduler.cancel(String(data.timer)) };
			case "unstar":
				if (host.live.has(known())) throw fail(409, "Park the session first.");
				registry.remove(id); unseen.delete(id); return { ok: true }; // the session file stays (D18)
		}
		throw fail(400, "Unknown session action.");
	}

	async function get(id: string, endpoint: string, params: URLSearchParams, response: http.ServerResponse, remote = false): Promise<unknown> {
		switch (endpoint) {
			case "plans": {
				const plans = await listPlans(folder(id)), now = current(id, plans);
				const open = plans.filter(plan => plan.status !== "complete").sort((a, b) => String(b.updated ?? b.created ?? "").localeCompare(String(a.updated ?? a.created ?? "")));
				return { current: now?.id ?? null, plans: open.map(plan => ({ id: plan.id, title: plan.title, done: plan.done, total: plan.total })) };
			}
			case "diagram": {
				const { target, resolved } = await resolve(id, params.get("target"));
				return { target, diagram: loadDiagram(folder(id), resolved) ?? emptyDiagram(resolved) };
			}
			case "files": return listFiles(folder(id));
			case "file": case "diff":
				try { return await (endpoint === "file" ? readProjectFile : readProjectDiff)(folder(id), params.get("path")); }
				catch (error) { throw error instanceof FileRefused ? fail(403, error.message) : error; }
			case "image": {
				const image = params.has("path") ? await readLinkedImage(params.get("path"), folder(id)) : await readPastedImage(params.get("name"));
				// SVG can carry script: opened on its own it runs sandboxed, with no scripts at all.
				response.writeHead(200, { "content-type": image.type, "cache-control": "private, max-age=86400", ...(image.type === "image/svg+xml" ? { "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:" } : {}) });
				response.end(image.bytes);
				return undefined;
			}
			// Files named in chat: inline opens it in the browser, download saves it (the remote page's Open and Download).
			case "download": await sendLinkedFile(params.get("path"), folder(id), params.has("download"), response, remote); return undefined;
			case "dialog": { const script = scriptAsks.get(id)?.get(params.get("id") ?? ""); if (script) return script.form; const dialog = openDialog(id, params.get("id")); if (!dialog) throw fail(404, "That question is no longer open."); return toForm(dialog); }
			case "sessions": return sessions();
			case "system": return systemLoad();
			// D6: usage comes from the hub's own poller, so it shows with every session parked.
			case "usage": return usage?.usage() ?? { summary: [], accounts: [] };
			// D9: the pool is global, answered by the hub through cpool, never by a session.
			case "pool": return pool ? pool.view() : null;
			// D10: a parked session picks only from Pi settings' scoped models, never from every model.
			case "models": if (!host.live.has(id)) return parkedModels(id); return call(id, `/api/${endpoint}`, {}, { start: false });
			case "commands": return call(id, `/api/${endpoint}`, {}, { start: false });
		}
		throw fail(404, "Unknown workspace endpoint.");
	}

	async function post(id: string, endpoint: string, data: Record<string, unknown>, remote = false): Promise<unknown> {
		switch (endpoint) {
			case "session": return session(data);
			case "seen": seen(id); return { ok: true }; // the page showing this session is visible and focused
			case "message":
				// RPC has no reload; D12: Reload is park + resume (idle only).
				if (typeof data.text === "string" && /^\/(wo )?reload$/.test(data.text.trim())) { await host.restart(id); return { ok: true }; }
				// /new is a Pi built-in (no extension can run it): a fresh session, and the pages reconnect to its empty chat.
				if (typeof data.text === "string" && data.text.trim() === "/new") {
					try { await host.newSession(id); } catch (error) { throw fail(409, (error as Error).message); }
					views.get(id)?.close(); views.delete(id); return { ok: true };
				}
				return call(id, "/api/message", data);
			// ✕ on the last prompt: it and the agent's work on it leave the context; the pages reconnect to the shorter chat.
			case "drop": {
				only(data, ["target", "text"], "Invalid fields.");
				if (typeof data.text !== "string") throw fail(400, "text: the last message.");
				try { await host.dropLastPrompt(id, data.text); } catch (error) { throw fail(409, (error as Error).message); }
				views.get(id)?.close(); views.delete(id); return { ok: true };
			}
			case "command": case "bias": case "generate": case "edit": case "comment": case "move": return call(id, `/api/${endpoint}`, data);
			case "pool": if (!pool) throw fail(404, "The Claude pool is not available."); return pool.action(data);
			case "paths": return linkedFiles(data.paths, folder(id), remote);
			case "open": return openLinkedFile(data.path, folder(id), data.reveal === true, remote);
			// Project commands run by name only: the page never sends a command line.
			case "run": {
				const command = commands?.list(folder(id)).find(item => item.name === data.name);
				if (!command) throw fail(404, "That command no longer exists.");
				if (command.kind === "prompt") return call(id, "/api/message", { text: command.text });
				runCommand(folder(id), command.text, id); return { ok: true, started: true };
			}
			case "commands": {
				only(data, ["target", "remove"], "Invalid fields.");
				const ok = commands?.remove(folder(id), String(data.remove ?? "")) ?? false;
				refresh(folder(id)); return { ok };
			}
			// Pi's abort still delivers queued messages, so take them out first and hand them back for editing (rpc-commands.md).
			// unqueue with text takes back one message (edit or cancel): Pi only clears the whole queue, so the rest is queued again.
			case "stop": case "unqueue": {
				only(data, ["target", "text"], "Invalid fields.");
				const live = host.live.get(id), queued = live ? (await live.rpc.send({ type: "clear_queue" })).data : undefined;
				const steering: string[] = queued?.steering ?? [], followUp: string[] = queued?.followUp ?? [];
				if (endpoint === "stop") await live?.rpc.send({ type: "abort" });
				if (endpoint === "stop" || typeof data.text !== "string") return { ok: true, restored: [...steering, ...followUp] };
				const list = steering.includes(data.text) ? steering : followUp, at = list.indexOf(data.text);
				if (at >= 0) list.splice(at, 1);
				// shortcut: re-queued messages go to the back of any message queued in this instant; fine for one person typing.
				for (const message of steering) await live!.rpc.send({ type: "steer", message });
				for (const message of followUp) await live!.rpc.send({ type: "follow_up", message });
				return { ok: true, restored: at >= 0 ? [data.text] : [], delivered: at < 0 };
			}
			case "model": {
				only(data, ["target", "provider", "id"], "Invalid model fields.");
				const live = host.live.get(id);
				if (!live) { // S-11: kept for the resume; only a model the parked list offers (D10)
					const pick = (await parkedModels(id)).scoped.find(model => model.provider === data.provider && model.id === data.id);
					if (!pick) throw fail(404, "That model is not in Pi's scoped models.");
					const record = registry.get(id)!;
					registry.update(id, { model: pick, pending: { ...record.pending, model: pick } });
					return publishStatus(id);
				}
				const models: { provider: string; id: string }[] = (await live.rpc.send({ type: "get_available_models" })).data?.models ?? [];
				if (!models.some(model => model.provider === data.provider && model.id === data.id)) throw fail(404, "That model is not available in this session.");
				const set = await live.rpc.send({ type: "set_model", provider: data.provider, modelId: data.id });
				if (!set.success) throw fail(409, set.error ?? `No credentials for ${data.provider}/${data.id}.`);
				return publishStatus(id);
			}
			case "effort": {
				only(data, ["target", "level"], "Invalid effort level.");
				if (!EFFORTS.includes(data.level as string)) throw fail(400, "Invalid effort level.");
				const live = host.live.get(id);
				if (!live) { // S-11: Pi clamps it to the model on resume
					const record = registry.get(id)!;
					registry.update(id, { thinking: data.level as string, pending: { ...record.pending, thinking: data.level as string } });
					return publishStatus(id);
				}
				await live.rpc.send({ type: "set_thinking_level", level: data.level });
				return publishStatus(id); // the model may clamp the level
			}
			case "answer": {
				only(data, ANSWER_FIELDS, "Invalid answer fields.");
				// First answer wins: a second tab (or a closed ask) gets accepted: false, as ce-workflow's dialogs.answer.
				const script = scriptAsks.get(id)?.get(data.askId as string);
				if (script) { const { target: _target, askId: _askId, ...answer } = data; closeAsk(id, data.askId as string); script.done(answer); return { accepted: true }; }
				const dialog = openDialog(id, data.askId);
				if (!dialog || !host.respond(id, dialog.id as string, toResponse(dialog, data))) return { accepted: false };
				views.get(id)?.publish("dialog_closed", { askId: dialog.id });
				return { accepted: true };
			}
		}
		throw fail(404, "Unknown workspace endpoint.");
	}

	// Live frames ce-workflow's own server sent: status after runs and mode changes, Pi's plan, changed diagrams.
	host.on("event", (id: string, event: RpcRecord) => {
		if (event.type !== "agent_settled") return;
		unseen.add(id); // an open page in a background tab, a minimized app or another device has not shown it to anyone
		if (views.has(id)) void publishStatus(id).catch(() => {});
	});
	host.on("closed", (id: string, requestId: string) => views.get(id)?.publish("dialog_closed", { askId: requestId }));
	host.on("notice", (id: string, text: string) => views.get(id)?.publish("notice", { text }));
	host.on("ui", (id: string, request: RpcRecord) => {
		const view = views.get(id), form = view && toForm(request);
		if (form) view.publish("dialog", form);
		if (!view || request.method !== "setStatus") return;
		if (request.statusKey === "pi-hub:state") {
			const state = parse(request.statusText);
			if (state && "plan" in state) view.publish("plan", state.plan ?? null); // null: the plan finished or was closed
			void publishStatus(id).catch(() => {});
		}
		if (request.statusKey === "pi-hub:diagram") void (async () => {
			const { target, resolved } = await resolve(id, parse(request.statusText)?.target);
			view.publish("diagram", { target, diagram: loadDiagram(folder(id), resolved) ?? emptyDiagram(resolved) });
		})().catch(() => {}); // a plan deleted meanwhile: nothing to show
	});

	/** Shows changed project commands on every open page of that folder's sessions. */
	const refresh = (dir: string) => { for (const record of registry.list()) if (views.has(record.id) && path.relative(record.folder, dir) === "") void publishStatus(record.id).catch(() => {}); };

	return { get, post, extras, forms, settings, refresh, scriptAsk, saveImage: savePastedImage };
}

// PC load for the page's CPU/memory graph: CPU is the busy share of all cores since the previous call.
const cpuTimes = () => os.cpus().reduce((sum, { times }) => ({ idle: sum.idle + times.idle, total: sum.total + times.user + times.nice + times.sys + times.irq + times.idle }), { idle: 0, total: 0 });
let lastCpu = cpuTimes();
export function systemLoad() {
	const now = cpuTimes(), total = now.total - lastCpu.total, idle = now.idle - lastCpu.idle; lastCpu = now;
	return { cpu: total > 0 ? Math.round(100 * (1 - idle / total)) : 0, memory: Math.round(100 * (1 - os.freemem() / os.totalmem())) };
}
