// Secrets out of text that leaves the process (hub errors, knowledge input): URL token/key params, sk-/Bearer keys, key=value pairs.
export function redactSecrets(value: unknown, max = 32_000) {
	return String(value ?? "")
		.replace(/([?&](?:token|key|code|secret)=)[^&\s]+/gi, "$1[REDACTED]")
		.replace(/\b(?:sk|od|Bearer)[-_ ][A-Za-z0-9._-]{12,}\b/gi, "[REDACTED]")
		.replace(/("?(?:api[_-]?key|access[_-]?token|token|password|secret)"?\s*[:=]\s*)[^,\s}]+/gi, "$1[REDACTED]")
		.slice(-max);
}
