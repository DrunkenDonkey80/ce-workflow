import assert from "node:assert/strict";
import { prefixInlineToolAdditions } from "../extensions/anthropic-inline-tools.ts";

const added = (name) => ({ type: "tool_addition", tool: { type: "tool_definition", definition: { name } } });
const payload = (betas) => ({ betas, messages: [{ role: "system", content: [added("plan3_create"), added("Read"), added("mcp__pi__x"), { type: "tool_removal", tool: { type: "tool_reference", name: "beta_tool" } }] }] });
const names = (p) => p.messages[0].content.map((b) => b.tool.definition?.name ?? b.tool.name);

assert.deepEqual(names(prefixInlineToolAdditions(payload(["claude-code-20250219", "oauth-2025-04-20"]))), ["mcp__pi__plan3_create", "Read", "mcp__pi__x", "beta_tool"]);
assert.deepEqual(names(prefixInlineToolAdditions(payload(["inline-tools"]))), ["plan3_create", "Read", "mcp__pi__x", "beta_tool"], "API-key payloads stay unchanged");
console.log("anthropic inline tools: ok");
