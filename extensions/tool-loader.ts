// Situational tools cost ~25k characters of schema and rules on every request, while a session needs at most one family
// (a phone app, a desktop app, a logged-in site). They register "deferred" (Pi declares them only once activated, records
// that per branch and restores it on resume), and tools_enable lists them in one short line each. Plan f75ccea6 E7 added
// the tools the E3 log census found under 1 call per 1,000 assistant turns in every phase (camera, browser search/fetch,
// jev_triage, plan3_diagram, session_dialog).
export const SITUATIONAL_TOOLS = {
	screen_read: "screenshot an app window, headless browser page, phone or VM",
	mobile_act: "drive an iOS Simulator, iPhone or Android device",
	app_act: "drive a running Windows/macOS desktop app",
	vm_act: "drive a VirtualBox VM (installer tests, UAC, snapshots)",
	browser_act: "operate a site in the user's logged-in browser",
	image_search: "Google Images in the user's browser",
	generate_image: "generate or edit a PNG image",
	project_commands: "the user's project command buttons on the hub page",
	peer_ls: "list paired hubs (other PCs) and their shared projects",
	peer_grep: "ripgrep a project a paired hub shares",
	peer_read: "read a file from a project a paired hub shares",
	peer_fetch: "copy a file from a paired hub's project into .pi/inbox",
	design: "hub design sessions: live variants, pick, export",
	video_digest: "digest a YouTube coding video into Markdown",
	browser_search: "Google search in the user's browser",
	browser_fetch: "load a page in the user's browser (bot-check blocked pages)",
	jev_triage: "cheap classifier questions about JSON or file ranges",
	plan3_diagram: "read/edit a plan or product architecture diagram",
	session_dialog: "answer or wait for another hub session's open question",
	camera_capture: "still or burst from the project camera",
	camera_watch: "watch the project camera for change or quiet",
	camera_recover: "reattach an earlier camera frame",
	camera_stop: "stop a camera watch",
	knowledge: "record or look up durable project facts",
	symbol_search: "pi-lens: ranked identifier search for files",
	read_enclosing: "pi-lens: read the symbol enclosing a line",
	effective_config: "pi-lens: explain its resolved configuration",
	project_report: "pi-lens: project hubs and entry points",
	module_report: "pi-lens: outline a file's symbols before reading bodies",
	read_symbol: "pi-lens: read one symbol's source",
	pi_lens_activate_tools: "pi-lens: activate ast_grep and lsp_navigation tools",
	"resolve-library-id": "Context7: find a library id (current library docs)",
	"query-docs": "Context7: query a library's current docs by id",
};

// Plan f75ccea6 D-10: always-on tools a Plan3 phase almost never calls (E3 census); plan3.ts drops them for that phase.
export const PHASE_DROPS = {
	planning: ["resolve-library-id", "query-docs", "project_report", "module_report", "read_symbol"],
	think: ["resolve-library-id", "query-docs", "project_report", "module_report"],
	coding: ["project_report", "module_report"],
};

// Near-unused tools other packages (pi-lens, Context7) register always-active. Their owners never re-add a tool removed from the active
// set (pi-lens only re-plans its own situational ones), so the session start withdraws them and tools_enable offers them.
const FOREIGN_TOOLS = ["symbol_search", "read_enclosing", "effective_config", "project_report", "module_report", "pi_lens_activate_tools", "resolve-library-id", "query-docs"];
// Direct tools tools_enable also offers: the withdrawn ones and the per-phase drops (listed even while active).
const OFFERED_DIRECT = new Set([...FOREIGN_TOOLS, ...Object.values(PHASE_DROPS).flat()]);

/** Withdraw the foreign near-unused tools, except those a tools_enable call on this branch enabled (a resume keeps them). */
export function deferForeignTools(pi, branch = []) {
	const enabled = new Set(branch.flatMap((entry) => entry?.message?.role === "toolResult" && entry.message.toolName === TOOLS_ENABLE ? entry.message.details?.enabled ?? [] : []));
	const active = pi.getActiveTools?.() ?? [], kept = active.filter((name) => !FOREIGN_TOOLS.includes(name) || enabled.has(name));
	if (kept.length < active.length) pi.setActiveTools(kept);
}

// Tools the harness itself tells the model to call; the instruction declares them, so it never names a tool the model cannot see.
const INSTRUCTED_TOOLS = ["plan3_diagram", "session_dialog"];

/** Declare the named registered tools (no change, and so no prompt-cache break, when all are already active). */
export function activateTools(pi, names) {
	const active = pi.getActiveTools?.() ?? [], missing = names.filter((name) => !active.includes(name));
	if (!missing.length) return;
	const registered = new Set(pi.getAllTools?.().filter((tool) => tool.exposure !== "hidden").map((tool) => tool.name));
	const added = missing.filter((name) => registered.has(name));
	if (added.length) pi.setActiveTools([...active, ...added]);
}

/** Declare or withdraw mode-bound tools (research_note while research is on); no change when already in that state. */
export function setToolsActive(pi, names, on) {
	const active = pi.getActiveTools?.();
	if (!active || !pi.setActiveTools) return;
	if (on) return activateTools(pi, names);
	if (names.some((name) => active.includes(name))) pi.setActiveTools(active.filter((name) => !names.includes(name)));
}

/** A prompt that tells the model to use an instructed tool declares it. */
export const activateNamedTools = (pi, text) => activateTools(pi, INSTRUCTED_TOOLS.filter((name) => new RegExp(`\\b${name}\\b`).test(text ?? "")));

export const TOOLS_ENABLE = "tools_enable";

/** The loader for the situational tools registered on this machine, minus excluded ones; undefined when none are left.
 * Camera tools register model-only (never callable from scripts) and inactive, so they count too. */
export function toolsEnableTool(pi, exclude = []) {
	const available = pi.getAllTools?.().filter((tool) => (tool.exposure === "deferred" || tool.exposure === "model-only" || (OFFERED_DIRECT.has(tool.name) && tool.exposure !== "hidden")) && tool.name in SITUATIONAL_TOOLS && !exclude.includes(tool.name)).map((tool) => tool.name) ?? [];
	if (!available.length) return;
	return {
		name: TOOLS_ENABLE,
		label: "Enable tools",
		description: `Before telling the user to open, click, look at or test something, check whether one of these tools can do it, enable it and do it yourself: local web UI → headless agent-browser via bash + screen_read; a desktop app → app_act + screen_read; a phone app or simulator → mobile_act + screen_read; an installer or guest OS → vm_act + screen_read; an external site needing the user's login → browser_act. Enabled tools work from your next step, stay on for this session and grant no consent; enable only what the task needs.\n${available.map((name) => `- ${name}: ${SITUATIONAL_TOOLS[name]}`).join("\n")}`,
		promptSnippet: "Enable situational tools before handing a UI check to the user: app windows, phones, VMs, screenshots, logged-in sites, images, hub buttons; also browser search/fetch, camera, diagrams and rarely used helpers",
		parameters: {
			type: "object",
			properties: { tools: { type: "array", items: { type: "string", enum: available }, minItems: 1 } },
			required: ["tools"],
			additionalProperties: false,
		},
		async execute(_id, params) {
			const wanted = [...new Set((params?.tools ?? []).filter((name) => available.includes(name)))];
			if (!wanted.length) throw new Error(`Name one of: ${available.join(", ")}`);
			pi.setActiveTools([...new Set([...pi.getActiveTools(), ...wanted])]);
			return { content: [{ type: "text", text: `Enabled ${wanted.join(", ")}: call them from your next step.` }], details: { enabled: wanted } };
		},
	};
}
