#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	copyFileSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { piInvocation } from "./workflow-evaluation-rpc.mjs";

const DIMENSIONS = [
	"palette",
	"hierarchy",
	"composition",
	"typography",
	"signatureElement",
	"responsiveAdaptation",
];
const sha256 = (file) =>
	createHash("sha256").update(readFileSync(file)).digest("hex");

function assistantMessage(stdout) {
	return String(stdout ?? "")
		.split(/\r?\n/)
		.filter(Boolean)
		.flatMap((line) => {
			try {
				return [JSON.parse(line)];
			} catch {
				return [];
			}
		})
		.filter(
			(event) =>
				event.type === "message_end" && event.message?.role === "assistant",
		)
		.at(-1)?.message;
}

function messageText(message) {
	if (typeof message?.content === "string") return message.content;
	return (message?.content ?? [])
		.map((part) => (part?.type === "text" ? part.text : ""))
		.join("");
}

function parseResult(message) {
	const text = messageText(message).trim();
	const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? text;
	let result;
	try {
		result = JSON.parse(fenced);
	} catch (error) {
		throw new Error("visual evaluator returned malformed JSON", { cause: error });
	}
	if (result?.version !== "visual-evaluation/v1" || !result.scores)
		throw new Error("visual evaluator returned an invalid contract");
	const scores = Object.fromEntries(
		DIMENSIONS.map((dimension) => {
			const score = Number(result.scores[dimension]);
			if (!Number.isFinite(score) || score < 0 || score > 4)
				throw new Error(`invalid visual score: ${dimension}`);
			return [dimension, score];
		}),
	);
	const rationale = String(result.rationale ?? "").trim();
	if (!rationale || rationale.length > 2_000)
		throw new Error("visual evaluator rationale is missing or too large");
	return { scores, rationale };
}

export function runVisualEvaluation(input, seams = {}) {
	const selectedPath = path.resolve(input.selectedPath);
	const implementedPath = path.resolve(input.implementedPath);
	const selectedHash = sha256(selectedPath);
	const implementedHash = sha256(implementedPath);
	if (selectedHash !== input.selectedHash || implementedHash !== input.implementedHash)
		throw new Error("visual evaluation input hash drift");
	const evaluator = input.evaluator ?? {};
	const approvedTraits = JSON.stringify(input.approvedTraits ?? {});
	if (Buffer.byteLength(approvedTraits) > 16_384)
		throw new Error("approved visual traits exceed 16 KiB");
	if (!evaluator.provider || !evaluator.model)
		throw new Error("visual evaluator identity is required");
	const expectedFingerprint = `${evaluator.provider}/${evaluator.model}`;
	if (expectedFingerprint === input.writerFingerprint)
		throw new Error("visual evaluator must differ from the implementation writer");
	const temp = mkdtempSync(path.join(os.tmpdir(), "ce-visual-evaluator-"));
	const swap = (seams.randomBytes ?? randomBytes)(1)[0] % 2 === 1;
	const mapping = swap
		? { A: "implemented", B: "selected" }
		: { A: "selected", B: "implemented" };
	const sources = { selected: selectedPath, implemented: implementedPath };
	const aPath = path.join(temp, "A.png");
	const bPath = path.join(temp, "B.png");
	copyFileSync(sources[mapping.A], aPath);
	copyFileSync(sources[mapping.B], bPath);
	const promptPath = path.join(temp, "rubric.json");
	writeFileSync(
		promptPath,
		JSON.stringify({
			approvedTraits: input.approvedTraits ?? {},
			dimensions: DIMENSIONS,
			anchors: { 0: "missing", 1: "major mismatch", 2: "partial", 3: "match", 4: "close match" },
		}),
	);
	const sourceRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
	const args = [
		"--mode",
		"json",
		"--print",
		"--no-session",
		"--offline",
		"--no-tools",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"--system-prompt",
		path.join(sourceRoot, "agents", "workflow-visual-evaluator.md"),
		"--provider",
		evaluator.provider,
		"--model",
		evaluator.model,
		`@${aPath}`,
		`@${bPath}`,
		`@${promptPath}`,
	];
	const started = Date.now();
	try {
		const [command, commandArgs] = piInvocation(args, input.piCommand);
		const run = (seams.spawnSync ?? spawnSync)(command, commandArgs, {
			encoding: "utf8",
			timeout: evaluator.timeoutMs ?? 900_000,
			maxBuffer: 16 * 1024 * 1024,
		});
		if (run.status !== 0)
			throw new Error(`visual evaluator failed: ${run.stderr || run.stdout}`);
		const assistant = assistantMessage(run.stdout);
		if (!assistant) throw new Error("visual evaluator produced no assistant result");
		const actualProvider = assistant.provider;
		const actualModel = assistant.model;
		if (
			!actualProvider ||
			!actualModel ||
			actualProvider !== evaluator.provider ||
			!String(actualModel).endsWith(String(evaluator.model).split("/").at(-1))
		)
			throw new Error("visual evaluator fingerprint mismatch");
		const actualFingerprint = `${actualProvider}/${actualModel}`;
		if (actualFingerprint === input.writerFingerprint)
			throw new Error("visual evaluator identity matches the implementation writer");
		const parsed = parseResult(assistant);
		const mean =
			Object.values(parsed.scores).reduce((sum, score) => sum + score, 0) /
			DIMENSIONS.length;
		const output = {
			version: "visual-evaluation/v1",
			inputHashes: { selected: selectedHash, implemented: implementedHash },
			evaluatorFingerprint: actualFingerprint,
			writerFingerprint: input.writerFingerprint,
			scores: parsed.scores,
			rationale: parsed.rationale,
			mean,
			passed:
				Object.values(parsed.scores).every((score) => score >= 3) && mean >= 3.25,
			wallMs: Date.now() - started,
		};
		const control = {
			version: 1,
			mapping,
			blindedControlHash: createHash("sha256")
				.update(JSON.stringify({ mapping, selectedHash, implementedHash }))
				.digest("hex"),
		};
		if (input.outputPath)
			writeFileSync(path.resolve(input.outputPath), JSON.stringify(output, null, 2));
		if (input.controlPath)
			writeFileSync(path.resolve(input.controlPath), JSON.stringify(control, null, 2));
		return { output, control };
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		const inputPath = process.argv[2];
		if (!inputPath)
			throw new Error("Usage: workflow-visual-evaluation.mjs <input.json>");
		const input = JSON.parse(readFileSync(inputPath, "utf8"));
		const result = runVisualEvaluation(input);
		process.stdout.write(`${JSON.stringify(result.output)}\n`);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
