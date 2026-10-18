// H5-03: the page API under /s/<session>/api/. The endpoint map is in plan 0db155f7 Findings ("H5-03 endpoint map").
// Plans, diagrams, files and images are read here with ce-workflow's Pi-free modules, so they also work while parked;
// what only Pi knows goes through RPC or a hub call (ce-workflow /pi-hub).
import type http from "node:http";
import path from "node:path";
import { emptyDiagram, loadDiagram } from "pi-work-orchestrator/extensions/plan3-diagram.ts";
import { FileRefused, listFiles, readProjectDiff, readProjectFile } from "pi-work-orchestrator/extensions/plan3-files.ts";
import { readLinkedImage, readPastedImage, savePastedImage, webTarget } from "pi-work-orchestrator/extensions/plan3-web.ts";
import { currentPlan, listPlans } from "pi-work-orchestrator/extensions/plan3.ts";
import type { Registry } from "./registry.ts";
import type { RpcRecord } from "./rpc-client.ts";
import type { SessionHost } from "./sessions.ts";
import type { SessionView } from "./view.ts";

const EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const ANSWER_FIELDS = ["target", "askId", "text", "selections", "comment", "answers", "action", "value", "values", "cancel"];
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const parse = (text: unknown) => { try { return JSON.parse(String(text)); } catch { return undefined; } };
const only = (data: Record<string, unknown>, fields: string[], message: string) => { if (Object.keys(data).some(key => !fields.includes(key))) throw fail(400, message); };
type Target = { kind: "product" } | { kind: "plan"; id: string };
type Plan = Awaited<ReturnType<typeof listPlans>>[number];

export function createPageApi({ host, registry, views }: { host: SessionHost; registry: Registry; views: Map<string, SessionView> }) {
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

	/** ce-workflow webStatus; model, effort and context need a running Pi. */
	async function status(id: string) {
		const record = registry.get(id)!, live = host.live.get(id);
		const base = { folder: path.basename(record.folder), tab: record.name, modes: published(id)?.modes ?? { research: "off", night: "off" } };
		if (!live) return { ...base, model: null, effort: null, context: null };
		const [state, stats] = await Promise.all([live.rpc.send({ type: "get_state" }), live.rpc.send({ type: "get_session_stats" })]);
		const model = state.data?.model;
		return { ...base, model: model ? { provider: model.provider, id: model.id, name: model.name ?? model.id } : null, effort: state.data?.thinkingLevel ?? null, context: stats.data?.contextUsage?.percent ?? null };
	}
	const publishStatus = async (id: string) => { const value = await status(id); views.get(id)?.publish("status", value); return value; };

	/** Snapshot extras, as ce-workflow's snapshot: target, current, status and (for Pi's own plan) its action state. */
	async function extras(id: string, wanted?: string | null) {
		const { target, now } = await resolve(id, wanted);
		const plan = published(id)?.plan; // shortcut: only Pi's current plan carries bias/finishable; another displayed plan shows without its action row until Pi switches to it.
		return { target, current: now?.id ?? null, status: await status(id), ...(plan && target.kind === "plan" && plan.id === target.id ? { plan } : {}) };
	}

	/** A hub call needs a running Pi; writes start a parked session, reads do not. */
	async function call(id: string, endpoint: string, data: Record<string, unknown>, { start = true } = {}) {
		if (!host.live.has(id)) { if (!start) throw fail(409, "Session is parked; resume it first."); await host.resume(id); }
		const result = await host.call(id, endpoint, data);
		if (!result.ok) throw fail(result.status ?? 500, result.error ?? "Hub call failed.");
		return result.value;
	}

	/** The open channel ask with this askId (ce-workflow hub-channel.ts: input titled pi-hub:ask, JSON placeholder). */
	function channelAsk(id: string, askId: unknown) {
		for (const dialog of host.pendingDialogs(id)) {
			const data = dialog.method === "input" && dialog.title === "pi-hub:ask" ? parse(dialog.placeholder)?.data : undefined;
			if (data && typeof askId === "string" && data.askId === askId) return { requestId: dialog.id as string, data };
		}
		throw fail(404, "That question is no longer open.");
	}

	async function get(id: string, endpoint: string, params: URLSearchParams, response: http.ServerResponse): Promise<unknown> {
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
				response.writeHead(200, { "content-type": image.type, "cache-control": "private, max-age=86400" });
				response.end(image.bytes);
				return undefined;
			}
			case "dialog": return channelAsk(id, params.get("id")).data;
			case "models": case "usage": case "commands": return call(id, `/api/${endpoint}`, {}, { start: false });
		}
		throw fail(404, "Unknown workspace endpoint.");
	}

	async function post(id: string, endpoint: string, data: Record<string, unknown>): Promise<unknown> {
		switch (endpoint) {
			case "message":
				// RPC has no reload; D12: Reload is park + resume (idle only).
				if (typeof data.text === "string" && /^\/(wo )?reload$/.test(data.text.trim())) { await host.restart(id); return { ok: true }; }
				return call(id, "/api/message", data);
			case "command": case "bias": case "generate": case "edit": case "comment": case "move": return call(id, `/api/${endpoint}`, data);
			case "stop": {
				only(data, ["target"], "Invalid Stop fields.");
				await host.live.get(id)?.rpc.send({ type: "abort" });
				return { ok: true };
			}
			case "model": {
				only(data, ["target", "provider", "id"], "Invalid model fields.");
				const live = host.live.get(id);
				if (!live) throw fail(409, "Session is parked; resume it first.");
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
				if (!live) throw fail(409, "Session is parked; resume it first.");
				await live.rpc.send({ type: "set_thinking_level", level: data.level });
				return publishStatus(id); // the model may clamp the level
			}
			case "answer": {
				only(data, ANSWER_FIELDS, "Invalid answer fields.");
				const { requestId } = channelAsk(id, data.askId);
				const { target: _target, ...answer } = data;
				host.respond(id, requestId, data.cancel === true ? { cancelled: true } : { value: JSON.stringify(answer) });
				return { ok: true };
			}
		}
		throw fail(404, "Unknown workspace endpoint.");
	}

	// Live frames ce-workflow's own server sent: status after runs and mode changes, Pi's plan, changed diagrams.
	host.on("event", (id: string, event: RpcRecord) => { if (event.type === "agent_settled" && views.has(id)) void publishStatus(id).catch(() => {}); });
	host.on("ui", (id: string, request: RpcRecord) => {
		const view = views.get(id);
		if (!view || request.method !== "setStatus") return;
		if (request.statusKey === "pi-hub:state") {
			const state = parse(request.statusText);
			if (state?.plan) view.publish("plan", state.plan);
			void publishStatus(id).catch(() => {});
		}
		if (request.statusKey === "pi-hub:diagram") void (async () => {
			const { target, resolved } = await resolve(id, parse(request.statusText)?.target);
			view.publish("diagram", { target, diagram: loadDiagram(folder(id), resolved) ?? emptyDiagram(resolved) });
		})().catch(() => {}); // a plan deleted meanwhile: nothing to show
	});

	return { get, post, extras, saveImage: savePastedImage };
}
