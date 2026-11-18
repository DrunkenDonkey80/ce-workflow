import os from "node:os";
import path from "node:path";

// Shared shell-command guard for research mode, Plan3 execute runs and night mode.
// shortcut: word match on the command line, not a sandbox; scripts, aliases and `cd` before a command are not followed. Upgrade to an OS policy if that matters.

const SEPARATOR = /^[;&|()\r\n]$/;
const shellWords = (command) => (String(command ?? "").match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s;&|()]+|[;&|()\r\n]/g) ?? [])
	.map((word) => word.replace(/^["']|["']$/g, ""));

// Every program call in a command line, also inside `bash -lc "..."` / `powershell -Command "..."` wrappers.
function calls(command) {
	const words = shellWords(command), out = [];
	for (let i = 0; i < words.length; i++) {
		if (/^-(?:c|lc|command)$/i.test(words[i]) && words[i + 1]?.includes(" ")) out.push(...calls(words[i + 1]));
		if (SEPARATOR.test(words[i])) continue;
		let end = i + 1;
		while (end < words.length && !SEPARATOR.test(words[end])) end++;
		out.push({ program: words[i], args: words.slice(i + 1, end) });
	}
	return out;
}

// Git calls with their verb (after global options) and the words after it.
export function gitCalls(command) {
	return calls(command).filter((call) => /(?:^|[\\/])git(?:\.exe)?$/i.test(call.program)).map(({ args }) => {
		let j = 0;
		while (args[j]?.startsWith("-")) {
			if (["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"].includes(args[j])) j++;
			j++;
		}
		return { verb: args[j] ?? "", args: args.slice(j + 1) };
	});
}

// True when the command runs git with a verb matching `verbs`.
export const runsGit = (command, verbs: RegExp) => gitCalls(command).some((call) => verbs.test(call.verb));

const TEMP_VARS = /^(?:\$\{?(?:TEMP|TMP|TMPDIR)\}?|\$env:(?:TEMP|TMP)|%(?:TEMP|TMP)%)(?=$|[\\/])/i;
function within(file, dir) {
	const rel = path.relative(dir, file);
	return !rel || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
// A delete target is safe inside the project or the system temp folder; unknown variables are not.
function safeTarget(target, cwd) {
	const tmp = os.tmpdir();
	let file = target.replace(TEMP_VARS, tmp).replace(/^\/tmp(?=$|\/)/, tmp).replace(/^~(?=$|[\\/])/, os.homedir());
	if (/[$%]/.test(file)) return false;
	file = path.resolve(cwd, file);
	const fold = (value) => process.platform === "win32" ? value.toLowerCase() : value;
	return [cwd, tmp].some((dir) => within(fold(file), fold(path.resolve(dir))));
}
// rm: -r/-R in short-flag groups or --recursive; Remove-Item: -Recurse or any prefix of it.
const RECURSE = { rm: /^(?:-[a-z]*r[a-z]*|--recursive)$/i, "remove-item": /^-r(?:e(?:c(?:u(?:r(?:se?)?)?)?)?)?$/i };

// Night mode: git push, git reset --hard, git clean -f and recursive deletes outside the project and temp.
export function destructiveCommand(command, cwd) {
	for (const { verb, args } of gitCalls(command)) {
		if (/^push$/i.test(verb)) return "git push";
		if (/^reset$/i.test(verb) && args.includes("--hard")) return "git reset --hard";
		if (/^clean$/i.test(verb) && args.some((arg) => arg === "--force" || /^-[a-z]*f/i.test(arg))) return "git clean -f";
	}
	for (const { program, args } of calls(command)) {
		const name = program.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "").toLowerCase();
		if (!RECURSE[name] || !args.some((arg) => RECURSE[name].test(arg))) continue;
		const targets = args.filter((arg) => !arg.startsWith("-"));
		if (targets.some((target) => !safeTarget(target, cwd))) return "a recursive delete outside the project and temp folders";
	}
	return "";
}
