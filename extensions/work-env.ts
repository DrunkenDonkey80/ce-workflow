// /wo env: set environment variables (usually secrets, often a few together: id, password, key) without the value ever reaching the model.
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

/** The variable names the last reply asks for: UPPER_SNAKE words in sentences about variables, else the last such word. */
export function envNamesFromText(text: string) {
	const names = (part: string) => part.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? [];
	const nearVariable = text.split(/(?<=[.!?\n])\s+/).filter(sentence => /variable|\benv\b|token|secret|api key|password/i.test(sentence)).flatMap(names);
	return [...new Set(nearVariable.length ? nearVariable : names(text).slice(-1))];
}

/** NAME=value lines, like a .env file: blank lines, # comments and a leading `export` are skipped; one pair of quotes is dropped. */
export function parseEnvLines(text: string) {
	return text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#")).map(line => {
		const at = line.indexOf("="), name = (at < 0 ? line : line.slice(0, at)).replace(/^export\s+/, "").trim();
		const value = at < 0 ? "" : line.slice(at + 1).trim();
		return { name, value: value.length > 1 && /^(["']).*\1$/s.test(value) ? value.slice(1, -1) : value };
	});
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
		{ question: "Variables", context: "One NAME=value per line (a pasted .env works). Values stay out of the chat: the agent is told only the names.", options: [], allowFreeform: true,
			initialText: envNamesFromText(lastReply(ctx)).map(name => `${name}=`).join("\n") },
		{ question: "Keep it", options: [
			{ title: SESSION, selected: true, description: "Only this Pi session and the tools it runs; gone when it exits." },
			{ title: PERMANENT, description: "Also saved for your user; Pi sessions started later see it (hub sessions after a hub restart)." },
		], allowFreeform: false },
	] });
	const answers = result.details?.answers;
	if (result.details?.cancelled || !Array.isArray(answers)) return;
	const text = answers[0]?.status === "answered" && answers[0].response?.kind === "freeform" ? String(answers[0].response.text) : "";
	const scope = answers[1]?.response?.selections?.[0] ?? SESSION;
	const vars = parseEnvLines(text);
	// Check every line first: a typo sets nothing, so you never end up with half of a login.
	const bad = vars.find(({ name, value }) => !VALID.test(name) || !value || value.includes("\0"));
	if (!vars.length || bad) return ctx.ui.notify(!bad ? "No variables given. Nothing was set." : !VALID.test(bad.name) ? `Not a valid variable name: "${bad.name.slice(0, 60)}". Nothing was set.` : `No value for ${bad.name}. Nothing was set.`, "warning");
	for (const { name, value } of vars) process.env[name] = value;
	const names = vars.map(item => item.name).join(", ");
	let where = "this session";
	if (scope === PERMANENT) {
		try { for (const { name, value } of vars) where = `this session and ${await setPermanent(name, value)}`; }
		catch (error) { where = "this session"; ctx.ui.notify(`${names}: set for this session, but saving permanently failed: ${error instanceof Error ? error.message : error}`, "warning"); }
	}
	ctx.ui.notify(`Set ${names} for ${where}.`, "info");
	pi.sendUserMessage(`I set the environment variable${vars.length > 1 ? "s" : ""} ${names} for ${where}. ${vars.length > 1 ? "Their values are secrets" : "Its value is a secret"}: read it from the environment when needed, never print, log or commit it.`, ctx.isIdle?.() === false ? { deliverAs: "followUp" } : undefined);
}
