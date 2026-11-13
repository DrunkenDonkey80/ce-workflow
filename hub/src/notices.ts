// Warnings and errors stay in the session's chat timeline (page only, never model context); info is a passing toast.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hubDataDir } from "./registry.ts";

export type Notice = { text: string; level: "info" | "warning" | "error"; at: number; source: string };
const KEEP = 50;
const file = (id: string) => /^[\w-]+$/.test(id) ? path.join(hubDataDir(), "notices", id + ".json") : undefined;
export const levelOf = (value: unknown): Notice["level"] => value === "warning" || value === "error" ? value : "info";

// shortcut: a removed session's file stays (a few KB at most); sweep the folder if it ever grows.
export function readNotices(id: string): Notice[] {
	try { const list = JSON.parse(readFileSync(file(id)!, "utf8")); return Array.isArray(list) ? list : []; } catch { return []; }
}

/** Publishes a notice to the session's open pages; warnings and errors are kept for later pages too. */
export function postNotice(view: { publish(event: string, value: unknown): void } | undefined, id: string, text: string, level: unknown = "info", source = "session") {
	const notice: Notice = { level: levelOf(level), text: "", at: Date.now(), source };
	notice.text = text.slice(0, notice.level === "info" ? 2000 : 8000);
	if (notice.level !== "info" && notice.text.trim() && file(id)) {
		mkdirSync(path.dirname(file(id)!), { recursive: true });
		writeFileSync(file(id)!, JSON.stringify([...readNotices(id), notice].slice(-KEEP)));
	}
	view?.publish("notice", notice);
}
