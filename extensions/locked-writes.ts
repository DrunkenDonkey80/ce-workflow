// Locked-writes check (plan 427dd6a8 D-12): flag a locked-write callback that ignores the state it receives.
// Benchmarks showed agents wrapping old pre-lock code as `transact(id, () => patch)`: the API looks safe, the stale read stays.
// shortcut: name and text heuristics, not a parser; a regex literal holding quotes or brackets can confuse it. Move to the TS AST if it misfires.

const CALL = /\b([\w$]*(?:[Tt]ransact|[Ll]ock|[Aa]tomic|[Uu]pdate|[Mm]utate|[Mm]odify)[\w$]*)\s*\(/g;
const ARROW = /^(?:async\s+)?(?:\(([^()]*)\)(?:\s*:[^=]*)?|([\w$]+))\s*=>\s*([\s\S]*)$/;
const CODE = /\.(?:[cm]?[jt]sx?)$/i;
const TEST = /(?:\.(?:test|spec)\.|[\\/]__tests__[\\/])/i;

// End (exclusive) of the string, comment or bracket group starting at i; i + 1 for any other character; -1 when unclosed.
function skip(text: string, i: number): number {
	const ch = text[i];
	if (ch === "\"" || ch === "'" || ch === "`") {
		for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === "\\") i++;
		return i < text.length ? i + 1 : -1;
	}
	if (ch === "/" && text[i + 1] === "/") { const end = text.indexOf("\n", i); return end < 0 ? text.length : end; }
	if (ch === "/" && text[i + 1] === "*") { const end = text.indexOf("*/", i + 2); return end < 0 ? -1 : end + 2; }
	if (!"([{".includes(ch)) return i + 1;
	for (let j = i + 1; j >= 0 && j < text.length; j = skip(text, j)) if (")]}".includes(text[j])) return j + 1;
	return -1;
}

// Top-level comma-separated arguments of the call whose "(" is at `open`.
function args(text: string, open: number) {
	const end = skip(text, open);
	if (end < 0) return [];
	const out: string[] = [];
	let start = open + 1;
	for (let i = start; i >= 0 && i < end - 1; i = skip(text, i)) if (text[i] === ",") { out.push(text.slice(start, i)); start = i + 1; }
	out.push(text.slice(start, end - 1));
	return out.map(arg => arg.trim());
}

// Calls to lock-ish writers whose callback ignores its argument: `() => patch`, `(_current) => ({ order })`, `(current) => { return x; }` with current unused.
// Zero parameters count only when the body is a ready value (`() => patch`, `() => ({ order })`): `withLock(id, () => save(x))`
// and better-sqlite3's `db.transaction(() => { ... })` are plain locks that pass no state.
export function ignoredStateCallbacks(text: string) {
	const found: { line: number; call: string }[] = [];
	for (const match of text.matchAll(CALL)) {
		const open = match.index + match[0].length - 1;
		for (const arg of args(text, open)) {
			const arrow = ARROW.exec(arg);
			if (!arrow) continue;
			const params = (arrow[1] ?? arrow[2] ?? "").trim();
			const body = arrow[3].trim().replace(/\.\.\./g, " "); // a spread `...current` reads current
			if (/^[{[]/.test(params)) continue; // destructured: it reads the state
			const names = params ? params.split(",").map(p => p.trim().split(/[\s:=?]/)[0]).filter(Boolean) : [];
			const ignored = names.length ? names.every(name => name.startsWith("_") || !new RegExp(`(?<![\\w$.])${name.replace(/\$/g, "\\$")}(?![\\w$])`).test(body)) : /^(?:\(\s*\{|[\w$.]+\s*\)?\s*$)/.test(body);
			if (ignored) found.push({ line: text.slice(0, match.index).split("\n").length, call: `${match[1]}(…${arg.replace(/\s+/g, " ").slice(0, 90)}` });
		}
	}
	return found;
}

// tool_result handler body: a note appended to a successful write/edit of source code, or undefined.
export function lockedWritesNote(toolName: string, input: any, isError: boolean) {
	if (isError || (toolName !== "write" && toolName !== "edit")) return;
	const file = String(input?.path ?? "");
	if (!CODE.test(file) || TEST.test(file)) return;
	const texts = toolName === "write" ? [input?.content] : [...(Array.isArray(input?.edits) ? input.edits.map(e => e?.newText) : []), input?.newText];
	const hits = texts.filter(t => typeof t === "string").flatMap(t => ignoredStateCallbacks(t));
	if (!hits.length) return;
	const where = toolName === "write" ? (h) => `line ${h.line}: ` : () => "";
	return `\n\nLocked writes check: ${hits.length} locked-write callback(s) here ignore the state they receive, so what they write was decided from a read taken before the lock:\n${hits.slice(0, 8).map(h => `- ${where(h)}${h.call}`).join("\n")}\nMove the checks and computed values inside the callback and derive them from its argument. If this callback really is not a locked read-modify-write, ignore this note.`;
}
