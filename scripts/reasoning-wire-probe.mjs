#!/usr/bin/env node
import { appendFileSync } from "node:fs";

export default function reasoningWireProbe(pi) {
	const output = process.env.REASONING_WIRE_PROBE;
	if (!output) return;
	pi.on("before_provider_request", (event) => {
		const fields = {};
		const images = { count: 0, chars: 0 };
		const visit = (value) => {
			if (!value || typeof value !== "object") return;
			if (Array.isArray(value)) {
				for (const item of value) visit(item);
				return;
			}
			if (/image/i.test(String(value.type ?? ""))) {
				const payload =
					value.data ?? value.image_url ?? value.source?.data ?? value.source?.url;
				if (typeof payload === "string") {
					images.count++;
					images.chars += payload.length;
				}
			}
			for (const [key, child] of Object.entries(value)) {
				if (/reason|thinking/i.test(key)) {
					const metric = (fields[key] ??= { count: 0, chars: 0 });
					metric.count++;
					if (typeof child === "string") metric.chars += child.length;
				}
				visit(child);
			}
		};
		visit(event.payload);
		appendFileSync(output, `${JSON.stringify({ fields, images })}\n`);
	});
}
