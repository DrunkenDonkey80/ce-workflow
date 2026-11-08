// Situational tools cost ~25k characters of schema and rules on every request, while a session needs at most one family
// (a phone app, a desktop app, a logged-in site). They register "deferred" (Pi declares them only once activated, records
// that per branch and restores it on resume), and tools_enable lists them in one short line each.
export const SITUATIONAL_TOOLS = {
	screen_read: "see an app window, headless browser page, phone or VM screen as an image (visual UI checks)",
	mobile_act: "operate an iOS Simulator, iPhone or Android device: launch, read the screen, tap, type, swipe",
	app_act: "operate a running Windows/macOS app via Accessibility/UI Automation: menus, press, type, keys",
	vm_act: "drive a VirtualBox VM for installer tests: accounts, sign-in, UAC, runs, keys, click, snapshots, USB",
	browser_act: "operate a site in the user's logged-in browser: click, type, select, upload",
	image_search: "Google Images in the user's browser: contact sheet of results, then save originals",
	generate_image: "generate or edit a PNG image from a prompt",
	project_commands: "add/remove/list the user's project command buttons on the hub page",
	design: "OpenDesign design sessions: start variants, track them, pick one and export it",
	video_digest: "digest a YouTube coding video: transcript plus code, diagrams and tables rebuilt as Markdown",
};

export const TOOLS_ENABLE = "tools_enable";

/** The loader for the situational tools registered on this machine; undefined when none are. */
export function toolsEnableTool(pi) {
	const available = pi.getAllTools?.().filter((tool) => tool.exposure === "deferred" && tool.name in SITUATIONAL_TOOLS).map((tool) => tool.name) ?? [];
	if (!available.length) return;
	return {
		name: TOOLS_ENABLE,
		label: "Enable tools",
		description: `Declare situational tools for your next request; their full parameters and rules arrive with them, and they stay on for this session. Enable only what the task needs (a phone app: mobile_act + screen_read; a desktop app: app_act + screen_read; a VirtualBox VM: vm_act + screen_read).\n${available.map((name) => `- ${name}: ${SITUATIONAL_TOOLS[name]}`).join("\n")}`,
		promptSnippet: "Enable situational tools (phone, desktop app, VM, screen capture, logged-in browser, images, hub buttons)",
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
