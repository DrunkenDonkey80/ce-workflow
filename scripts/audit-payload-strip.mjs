#!/usr/bin/env node
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripProcessedPayloads } from "../extensions/work-models.ts";

function globalRoot() {
	try {
		return execSync("npm root -g", { encoding: "utf8" }).trim();
	} catch {
		return path.join(process.env.APPDATA ?? "", "npm", "node_modules");
	}
}

const pi = await import(
	pathToFileURL(
		path.join(
			globalRoot(),
			"@earendil-works",
			"pi-coding-agent",
			"dist",
			"index.js",
		),
	)
);

function filesAt(inputs) {
	return inputs.flatMap((input) => {
		const absolute = path.resolve(input);
		return statSync(absolute).isDirectory()
			? readdirSync(absolute)
					.filter((name) => name.endsWith(".jsonl"))
					.map((name) => path.join(absolute, name))
			: [absolute];
	});
}

function text(content) {
	return Array.isArray(content)
		? content
				.filter((part) => part?.type === "text")
				.map((part) => part.text ?? "")
				.join("\n")
		: String(content ?? "");
}

function bytes(value) {
	return Buffer.byteLength(JSON.stringify(value));
}

function imageStats(messages) {
	let count = 0;
	let payloadBytes = 0;
	for (const message of messages) {
		if (!Array.isArray(message?.content)) continue;
		for (const part of message.content) {
			if (part?.type !== "image") continue;
			count++;
			payloadBytes += bytes(part);
		}
	}
	return { count, payloadBytes };
}

function counts(before, after) {
	const out = {
		images: 0,
		giantResults: 0,
		supersededReads: 0,
		duplicates: 0,
		thinking: 0,
	};
	for (let index = 0; index < before.length; index++) {
		const oldMessage = before[index];
		const newMessage = after[index];
		if (oldMessage?.role === "assistant" && Array.isArray(oldMessage.content))
			out.thinking +=
				oldMessage.content.filter((part) => part?.type === "thinking").length -
				(newMessage?.content ?? []).filter((part) => part?.type === "thinking")
					.length;
		if (oldMessage?.role !== "toolResult") continue;
		const marker = text(newMessage?.content);
		if (/^\[stale read of /.test(marker)) out.supersededReads++;
		if (/^\[duplicate .* output omitted/.test(marker)) out.duplicates++;
		const oldParts = Array.isArray(oldMessage.content) ? oldMessage.content : [];
		const newParts = Array.isArray(newMessage?.content) ? newMessage.content : [];
		out.images += Math.max(
			0,
			oldParts.filter((part) => part?.type === "image").length -
				newParts.filter((part) => part?.type === "image").length,
		);
		for (let part = 0; part < oldParts.length; part++)
			if (
				oldParts[part]?.type === "text" &&
				(oldParts[part].text ?? "").length >= 24_000 &&
				newParts[part]?.type === "text" &&
				(newParts[part].text ?? "").length < 24_000 &&
				!/^\[(stale read|duplicate )/.test(newParts[part].text ?? "")
			)
				out.giantResults++;
	}
	return out;
}

function anomalies(before, after) {
	const found = [];
	if (before.length !== after.length) found.push("message-count-changed");
	if (
		after.some(
			(message, index) =>
				Array.isArray(message?.content) &&
				!message.content.length &&
				(!Array.isArray(before[index]?.content) ||
					before[index].content.length > 0),
		)
	)
		found.push("new-empty-content");
	const beforeIds = before
		.filter((message) => message?.role === "toolResult")
		.map((message) => message.toolCallId);
	const afterIds = after
		.filter((message) => message?.role === "toolResult")
		.map((message) => message.toolCallId);
	if (JSON.stringify(beforeIds) !== JSON.stringify(afterIds))
		found.push("tool-result-pairing-changed");
	for (let index = 0; index < after.length; index++) {
		if (!/^\[duplicate .* output omitted/.test(text(after[index]?.content)))
			continue;
		const original = before[index];
		const originalText = text(original?.content);
		const hash = createHash("sha256").update(originalText).digest("hex");
		const keeper = before.findIndex((message, candidate) => {
			if (
				candidate <= index ||
				message?.role !== "toolResult" ||
				message.toolName !== original.toolName ||
				createHash("sha256").update(text(message.content)).digest("hex") !== hash
			)
				return false;
			return !/^\[(stale read|duplicate )/.test(text(after[candidate]?.content));
		});
		if (keeper < 0) found.push(`duplicate-without-retained-target:${index}`);
	}
	return found;
}

const replay = process.argv.includes("--replay");
const inputs = process.argv.slice(2).filter((arg) => arg !== "--replay");
if (!inputs.length) {
	process.stderr.write(
		"usage: node scripts/audit-payload-strip.mjs [--replay] <session.jsonl|session-dir> [...]\n",
	);
	process.exit(2);
}

const totals = {
	mode: replay ? "historical-requests" : "final-leaves",
	files: 0,
	requests: 0,
	requestsWithImagesBefore: 0,
	requestsWithImagesAfter: 0,
	imagePartsBefore: 0,
	imagePartsAfter: 0,
	imagePayloadBytesBefore: 0,
	imagePayloadBytesAfter: 0,
	malformedLines: 0,
	messages: 0,
	beforeBytes: 0,
	defaultAfterBytes: 0,
	withThinkingAfterBytes: 0,
	defaultStripped: {
		images: 0,
		giantResults: 0,
		supersededReads: 0,
		duplicates: 0,
		thinking: 0,
	},
	withThinkingStripped: {
		images: 0,
		giantResults: 0,
		supersededReads: 0,
		duplicates: 0,
		thinking: 0,
	},
	standaloneSavedBytes: {
		images: 0,
		giantResults: 0,
		supersededReads: 0,
		duplicates: 0,
		thinking: 0,
	},
	anomalies: [],
	defaultSavedBytes: 0,
	defaultSavedPercent: 0,
	withThinkingSavedBytes: 0,
	withThinkingSavedPercent: 0,
};
for (const file of filesAt(inputs)) {
	const source = readFileSync(file, "utf8");
	const lines = source.split(/\r?\n/).filter(Boolean);
	const malformed = lines.filter((line) => {
		try {
			JSON.parse(line);
			return false;
		} catch {
			return true;
		}
	}).length;
	const entries = pi.parseSessionEntries(source);
	const cwd = entries[0]?.cwd;
	const contexts = replay
		? entries
				.filter(
					(entry) =>
						entry.type === "message" &&
						entry.message?.role === "assistant" &&
						entry.parentId,
				)
				.map((entry) => pi.buildSessionContext(entries, entry.parentId).messages)
		: [pi.buildSessionContext(entries).messages];
	totals.files++;
	totals.malformedLines += malformed;
	for (const messages of contexts) {
		const frozen = JSON.stringify(messages);
		const outgoing = stripProcessedPayloads(messages, { cwd });
		const withThinking = stripProcessedPayloads(messages, {
			cwd,
			thinking: true,
		});
		if (JSON.stringify(messages) !== frozen)
			throw new Error(`input mutated: ${file}`);
		const issues = [
			...anomalies(messages, outgoing),
			...anomalies(messages, withThinking).map((issue) => `thinking-on:${issue}`),
		];
		const defaultStripped = counts(messages, outgoing);
		const withThinkingStripped = counts(messages, withThinking);
		const beforeBytes = bytes(messages);
		const beforeImages = imageStats(messages);
		const afterImages = imageStats(outgoing);
		totals.requests++;
		totals.requestsWithImagesBefore += beforeImages.count > 0 ? 1 : 0;
		totals.requestsWithImagesAfter += afterImages.count > 0 ? 1 : 0;
		totals.imagePartsBefore += beforeImages.count;
		totals.imagePartsAfter += afterImages.count;
		totals.imagePayloadBytesBefore += beforeImages.payloadBytes;
		totals.imagePayloadBytesAfter += afterImages.payloadBytes;
		totals.messages += messages.length;
		totals.beforeBytes += beforeBytes;
		totals.defaultAfterBytes += bytes(outgoing);
		totals.withThinkingAfterBytes += bytes(withThinking);
		for (const key of Object.keys(defaultStripped)) {
			totals.defaultStripped[key] += defaultStripped[key];
			totals.withThinkingStripped[key] += withThinkingStripped[key];
			const options = {
				images: false,
				giantResults: false,
				supersededReads: false,
				duplicates: false,
				thinking: false,
				cwd,
				[key]: true,
			};
			totals.standaloneSavedBytes[key] +=
				beforeBytes - bytes(stripProcessedPayloads(messages, options));
		}
		for (const issue of issues)
			if (totals.anomalies.length < 20) totals.anomalies.push({ file, issue });
	}
}

totals.defaultSavedBytes = totals.beforeBytes - totals.defaultAfterBytes;
totals.defaultSavedPercent = totals.beforeBytes
	? Number(((totals.defaultSavedBytes / totals.beforeBytes) * 100).toFixed(2))
	: 0;
totals.withThinkingSavedBytes =
	totals.beforeBytes - totals.withThinkingAfterBytes;
totals.withThinkingSavedPercent = totals.beforeBytes
	? Number(
			((totals.withThinkingSavedBytes / totals.beforeBytes) * 100).toFixed(2),
		)
	: 0;
process.stdout.write(`${JSON.stringify(totals, null, 2)}\n`);
if (totals.malformedLines || totals.anomalies.length) process.exitCode = 1;
