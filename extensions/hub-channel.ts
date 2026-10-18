// Channel to pi-control-hub inside the RPC pipe (plan 0db155f7, D8/D22). Active only when the hub started this Pi.
// ask: one `input` dialog with a marker title and JSON in the placeholder; the hub answers with JSON as the value.
// publish: one-way updates as `setStatus` under a reserved key prefix.
import { randomUUID } from "node:crypto";

export const HUB_PREFIX = "pi-hub:";
export const hubActive = () => process.env.PI_HUB === "1";

type HubUi = {
	input(title: string, placeholder?: string, options?: { signal?: AbortSignal; timeout?: number }): Promise<string | undefined>;
	setStatus(key: string, text: string | undefined): void;
};

export function publish(ui: HubUi, kind: string, data: unknown): boolean {
	if (!hubActive()) return false;
	ui.setStatus(HUB_PREFIX + kind, data === undefined ? undefined : JSON.stringify(data));
	return true;
}

/**
 * Ask the hub; resolves to the parsed answer, or undefined on cancel, timeout or abort.
 * Pi drops an aborted or timed-out `input` itself (F8) and ignores a late answer; `closed` tells the hub to remove the form.
 */
export async function ask(ui: HubUi, kind: string, data: unknown, options: { signal?: AbortSignal; timeout?: number } = {}): Promise<unknown> {
	if (!hubActive()) throw new Error("The hub channel is only active when pi-control-hub started this Pi.");
	if (options.signal?.aborted) return undefined;
	const id = randomUUID();
	try {
		const value = await ui.input(HUB_PREFIX + kind, JSON.stringify({ id, data }), options);
		if (value === undefined) return undefined;
		try { return JSON.parse(value); } catch { return undefined; } // a malformed answer counts as cancelled
	} finally {
		publish(ui, "closed", { id });
	}
}
