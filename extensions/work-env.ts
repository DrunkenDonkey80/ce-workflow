// /wo env: set an environment variable (usually a secret) without the value ever reaching the model.
// The value goes ask_user → this code → process.env (and the user's permanent environment); the agent only hears the name.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { loadPlan3Ask } from "./plan3-ask.ts";
import { showAskDialog } from "./ask-user/menu.ts";

const VALID = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SESSION = "This session", PERMANENT = "Permanent (user)";

/** The variable name the last reply asks for: an UPPER_SNAKE word, preferring one in a sentence about a variable. */
export function envNameFromText(text: string) {
	const names = (part: string) => part.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? [];
	const nearVariable = text.split(/(?<=[.!?\n])\s+/).filter(sentence => /variable|\benv\b|token|secret|api key/i.test(sentence)).flatMap(names);
	return nearVariable.at(-1) ?? names(text).at(-1) ?? "";
}

function lastReply(ctx): string {
	const entries = ctx.sessionManager?.getBranch?.() ?? [];
	for (let index = entries.length - 1; index >= 0; index--) {
		const message = entries[index]?.message;
		if (entries[index]?.type === "message" && message?.role === "assistant")
			return (Array.isArray(message.content) ? message.content : []).filter(part => part?.type === "text").map(part => part.text).join("\n");
	}
	return "";
}

/** Writes the user's permanent variable; the value travels in the child's environment, never on a command line. */
export async function setPermanent(name: string, value: string, home = os.homedir()) {
	if (process.platform === "win32") {
		await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::SetEnvironmentVariable($env:PI_ENV_NAME, $env:PI_ENV_VALUE, 'User')"],
			{ env: { ...process.env, PI_ENV_NAME: name, PI_ENV_VALUE: value }, windowsHide: true, timeout: 30_000 });
		return "your Windows user environment";
	}
	// shortcut: ~/.profile only (login shells); zsh-only setups need ~/.zprofile, add it when someone hits that.
	const file = path.join(home, ".profile");
	const kept = (existsSync(file) ? readFileSync(file, "utf8") : "").split("\n").filter(line => !line.startsWith(`export ${name}=`));
	while (kept.length && kept.at(-1) === "") kept.pop();
	writeFileSync(file, [...kept, `export ${name}='${value.replaceAll("'", "'\\''")}'`, ""].join("\n"), { mode: 0o600 });
	return "~/.profile";
}

export async function handleEnvCommand(ctx, pi) {
	const ask = await loadPlan3Ask(pi);
	const result = await showAskDialog(ctx, ask, { allowComment: false, questions: [
		{ question: "Variable name", context: "Letters, digits and _; not starting with a digit.", options: [], allowFreeform: true, initialText: envNameFromText(lastReply(ctx)) },
		{ question: "Value", context: "Stays out of the chat: the agent is told only the name.", options: [], allowFreeform: true },
		{ question: "Keep it", options: [
			{ title: SESSION, selected: true, description: "Only this Pi session and the tools it runs; gone when it exits." },
			{ title: PERMANENT, description: "Also saved for your user; Pi sessions started later see it (hub sessions after a hub restart)." },
		], allowFreeform: false },
	] });
	const answers = result.details?.answers;
	if (result.details?.cancelled || !Array.isArray(answers)) return;
	const [name, value] = answers.slice(0, 2).map(answer => answer?.status === "answered" && answer.response?.kind === "freeform" ? String(answer.response.text).trim() : "");
	const scope = answers[2]?.response?.selections?.[0] ?? SESSION;
	if (!VALID.test(name)) return ctx.ui.notify(`Not a valid variable name: "${name.slice(0, 60)}". Nothing was set.`, "warning");
	if (!value || value.includes("\0")) return ctx.ui.notify(`No value for ${name}. Nothing was set.`, "warning");
	process.env[name] = value;
	let where = "this session";
	if (scope === PERMANENT) {
		try { where = `this session and ${await setPermanent(name, value)}`; }
		catch (error) { ctx.ui.notify(`${name} is set for this session, but saving it permanently failed: ${error instanceof Error ? error.message : error}`, "warning"); }
	}
	ctx.ui.notify(`Set ${name} for ${where}.`, "info");
	pi.sendUserMessage(`I set the environment variable ${name} for ${where}. Its value is a secret: read it from the environment when needed, never print, log or commit it.`, ctx.isIdle?.() === false ? { deliverAs: "followUp" } : undefined);
}
