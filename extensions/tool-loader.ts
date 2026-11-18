// Situational tools cost ~25k characters of schema and rules on every request, while a session needs at most one family
// (a phone app, a desktop app, a logged-in site). They register "deferred" (Pi declares them only once activated, records
// that per branch and restores it on resume), and tools_enable lists them in one short line each. Plan f75ccea6 E7 added
// the tools the E3 log census found under 1 call per 1,000 assistant turns in every phase (camera, browser search/fetch,
// jev_triage, plan3_diagram, session_dialog).
export const SITUATIONAL_TOOLS = {
	screen_read: "see an app window, headless browser page, phone or VM screen as an image (visual UI checks)",
	mobile_act: "operate an iOS Simulator, iPhone or Android device: launch, read the screen, tap, type, swipe",
	app_act: "operate a running Windows/macOS app via Accessibility/UI Automation: menus, press, type, keys",
	vm_act: "drive a VirtualBox VM for installer tests: accounts, sign-in, UAC, runs, keys, click, snapshots, USB",
	browser_act: "operate a site in the user's logged-in browser: click, type, select, upload",
	image_search: "Google Images in the user's browser: contact sheet of results, then save originals",
	generate_image: "generate or edit a PNG image from a prompt",
	project_commands: "add/remove/list the user's project command buttons on the hub page",
	peer_ls: "list paired hubs (other PCs), the projects they share with this one, and their folders",
	peer_grep: "ripgrep a project another paired hub shares (code and its Pi session files)",
	peer_read: "read a file from a project another paired hub shares",
	peer_fetch: "copy a file (binary too, up to 200 MB) from a project another paired hub shares into .pi/inbox",
	design: "Design sessions: start variants built live in the hub, pick one and export it",
	video_digest: "digest a YouTube coding video: transcript plus code, diagrams and tables rebuilt as Markdown",
	browser_search: "Google web search in the user's own browser profile (titles, real URLs, snippets)",
	browser_fetch: "load a page in the user's own browser when a plain fetch is blocked (Cloudflare, bot checks)",
	jev_triage: "ask a cheap classifier many typed questions about JSON or explicit file ranges in one call",
	plan3_diagram: "read/edit a plan's or the product's architecture diagram",
	session_dialog: "wait for or answer another hub session's open question after an intercom send was stopped",
	camera_capture: "capture a still or short burst from the project camera (enabled in /wo Settings)",
	camera_watch: "watch the project camera for visual change or quiet (device LEDs, screens)",
	camera_recover: "reattach an earlier camera frame by its capture id",
	camera_stop: "stop a running camera watch",
	symbol_search: "pi-lens: find files by ranked identifier search",
	read_enclosing: "pi-lens: read the symbol or callback enclosing a line",
	effective_config: "pi-lens: explain resolved pi-lens configuration and its provenance",
};

// Near-unused tools other packages (pi-lens) register always-active. Their owners never re-add a tool removed from the active
// set (pi-lens only re-plans its own situational ones), so the session start withdraws them and tools_enable offers them.
const FOREIGN_TOOLS = ["symbol_search", "read_enclosing", "effective_config"];

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

/** A prompt that tells the model to use an instructed tool declares it. */
export const activateNamedTools = (pi, text) => activateTools(pi, INSTRUCTED_TOOLS.filter((name) => new RegExp(`\\b${name}\\b`).test(text ?? "")));

export const TOOLS_ENABLE = "tools_enable";

/** The loader for the situational tools registered on this machine, minus excluded ones; undefined when none are left.
 * Camera tools register model-only (never callable from scripts) and inactive, so they count too. */
export function toolsEnableTool(pi, exclude = []) {
	const available = pi.getAllTools?.().filter((tool) => (tool.exposure === "deferred" || tool.exposure === "model-only" || (FOREIGN_TOOLS.includes(tool.name) && tool.exposure !== "hidden")) && tool.name in SITUATIONAL_TOOLS && !exclude.includes(tool.name)).map((tool) => tool.name) ?? [];
	if (!available.length) return;
	return {
		name: TOOLS_ENABLE,
		label: "Enable tools",
		description: `Before telling the user to open, click, look at or test something, check whether one of these tools can do it, enable it and do it yourself: local web UI → headless agent-browser via bash + screen_read; a desktop app → app_act + screen_read; a phone app or simulator → mobile_act + screen_read; an installer or guest OS → vm_act + screen_read; an external site needing the user's login → browser_act. Enabling brings the full parameters and rules for your next request, stays on for this session and grants no consent by itself; enable only what the task needs.\n${available.map((name) => `- ${name}: ${SITUATIONAL_TOOLS[name]}`).join("\n")}`,
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
