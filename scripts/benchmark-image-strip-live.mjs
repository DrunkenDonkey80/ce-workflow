#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import {
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const value = (flag, fallback) => {
	const index = args.indexOf(flag);
	return index < 0 ? fallback : args[index + 1];
};
const model = value("--model", "openai-codex/gpt-5.6-terra");
const repetitions = Number(value("--repetitions", "3"));
const scenario = value("--scenario", "reuse");
if (!new Set(["reuse", "spent", "extract"]).has(scenario))
	throw new Error(`unknown scenario: ${scenario}`);
const outputRoot = path.resolve(
	value("--output", path.join(repo, ".pi", "image-strip-terra-pilot")),
);
const extension = path.join(repo, "extensions", "work-models.ts");
const wireProbe = path.join(repo, "scripts", "reasoning-wire-probe.mjs");
const policies = [
	{ id: "IS", size: "small", width: 480, height: 320, rolling: true },
	{ id: "IC", size: "small", width: 480, height: 320, rolling: false },
	{ id: "IL", size: "large", width: 2000, height: 1333, rolling: true },
	{ id: "IB", size: "large", width: 2000, height: 1333, rolling: false },
];
const rotations = policies.map((_, offset) =>
	policies.map((__, index) => (index + offset) % policies.length),
);

function npmRoot() {
	try {
		return execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
	} catch {
		return path.join(process.env.APPDATA ?? "", "npm", "node_modules");
	}
}

const piCli = path.join(
	npmRoot(),
	"@earendil-works",
	"pi-coding-agent",
	"dist",
	"bundle",
	"cli.js",
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function generateImage(file, width, height) {
	const script = `
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import sys
p,w,h=sys.argv[1],int(sys.argv[2]),int(sys.argv[3])
s=w/900
noise=Image.effect_noise((w,h),24).convert('RGB').filter(ImageFilter.GaussianBlur(max(1,int(2*s))))
base=Image.new('RGB',(w,h),'#10203a')
base=Image.blend(base,noise,0.08)
d=ImageDraw.Draw(base)
def font(px,bold=False):
 return ImageFont.truetype('C:/Windows/Fonts/arial%s.ttf' % ('bd' if bold else ''),max(12,int(px*s)))
def box(x): return int(x*s)
d.rounded_rectangle((box(38),box(28),w-box(38),h-box(28)),radius=box(24),fill='#f8fafc',outline='#2e7dff',width=max(3,box(7)))
d.text((box(82),box(70)),'VISION CODE',font=font(25),fill='#10203a')
d.text((box(82),box(112)),'COBALT-731',font=font(48,True),fill='#2e7dff')
d.ellipse((box(655),box(78),box(765),box(188)),fill='#ffb000')
d.text((box(82),box(222)),'TRIANGLES',font=font(22),fill='#10203a')
for x in (box(600),box(680),box(760)):
 d.polygon([(x,box(270)),(x+box(28),box(218)),(x+box(56),box(270))],fill='#ef4444')
d.rounded_rectangle((box(82),box(264),box(245),box(310)),radius=box(12),fill='#10203a')
d.text((box(112),box(272)),'ORBIT',font=font(22,True),fill='#ffffff')
base.save(p,optimize=True)
`;
	execFileSync("python", ["-c", script, file, String(width), String(height)]);
}

function scaffold(cwd, policy) {
	mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		path.join(cwd, ".pi", "settings.json"),
		`${JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 2_000 } }, null, 2)}\n`,
	);
	writeFileSync(
		path.join(cwd, "README.md"),
		"Disposable image-retention benchmark.\n",
	);
	writeFileSync(
		path.join(cwd, "package.json"),
		'{"name":"image-retention-benchmark","private":true,"type":"module"}\n',
	);
	generateImage(path.join(cwd, "target.png"), policy.width, policy.height);
	execFileSync("git", ["init", "-q", "-b", "master"], { cwd });
}

function text(content) {
	if (typeof content === "string") return content;
	return Array.isArray(content)
		? content
				.filter((part) => part?.type === "text")
				.map((part) => part.text ?? "")
				.join("\n")
		: "";
}

function wireRows(file) {
	try {
		return readFileSync(file, "utf8")
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	} catch {
		return [];
	}
}

async function run(policy, repetition, sequence) {
	const cwd = path.join(
		outputRoot,
		`rep-${repetition + 1}-${sequence + 1}-${policy.id}`,
	);
	scaffold(cwd, policy);
	const sessionDir = path.join(cwd, "sessions");
	const wireOutput = path.join(cwd, "wire-probe.jsonl");
	const child = spawn(
		process.execPath,
		[
			piCli,
			"--mode",
			"rpc",
			"--session-dir",
			sessionDir,
			"--model",
			model,
			"--thinking",
			"off",
			"--tools",
			"read",
			"--no-extensions",
			"--extension",
			extension,
			"--extension",
			wireProbe,
			"-a",
		],
		{
			cwd,
			env: {
				...process.env,
				STRIP_IMAGES: policy.rolling ? "all" : "0",
				STRIP_GIANT_RESULTS: "0",
				STRIP_SUPERSEDED_READS: "0",
				STRIP_DUPLICATES: "0",
				STRIP_THINKING: "0",
				STRIP_DEBUG: "1",
				REASONING_WIRE_PROBE: wireOutput,
			},
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
	const events = [];
	let stdout = "";
	let stderr = "";
	let buffer = "";
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
		buffer += chunk;
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines)
			try {
				events.push(JSON.parse(line));
			} catch {}
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	let prompts;
	let expected;
	if (scenario === "reuse") {
		prompts = [
			"Use the read tool on target.png. Reply with exactly CODE= followed by the vision code shown, and nothing else.",
			"Reply exactly ACK-2 and do not use any tool.",
			"Report exactly TRIANGLES=<number shown in target.png>. Re-read target.png only if its pixels are unavailable.",
			"Re-read target.png now so a fresh image exists at the compaction boundary. Reply exactly BOUNDARY-READY.",
			"Report exactly BADGE=<word in the dark badge in target.png>. Re-read target.png only if its pixels are unavailable.",
		];
		expected = [
			/^CODE=COBALT-731$/i,
			/^ACK-2$/i,
			/^TRIANGLES=3$/i,
			/^BOUNDARY-READY$/i,
			/^BADGE=ORBIT$/i,
		];
	} else if (scenario === "extract") {
		prompts = [
			"Use the read tool on target.png. Preserve its reusable facts by replying exactly: VISUAL_RECORD CODE=COBALT-731; TRIANGLES=3; BADGE=ORBIT; CIRCLE=AMBER",
			"Reply exactly ACK-2 and do not use any tool.",
			"Using only the retained VISUAL_RECORD, reply exactly TRIANGLES=3 and do not re-read the image.",
			"Using only the retained VISUAL_RECORD, reply exactly BADGE=ORBIT and do not re-read the image.",
			"Using only the retained VISUAL_RECORD, reply exactly CIRCLE=AMBER and do not re-read the image.",
		];
		expected = [
			/^VISUAL_RECORD CODE=COBALT-731; TRIANGLES=3; BADGE=ORBIT; CIRCLE=AMBER$/i,
			/^ACK-2$/i,
			/^TRIANGLES=3$/i,
			/^BADGE=ORBIT$/i,
			/^CIRCLE=AMBER$/i,
		];
	} else {
		prompts = [
			"Use the read tool on target.png. Reply with exactly CODE= followed by the vision code shown, and nothing else.",
			"Reply exactly ACK-2 and do not use any tool.",
			"The image task is finished. Reply exactly ACK-3 and do not use any tool.",
			"Reply exactly ACK-4 and do not use any tool.",
			"Reply exactly ACK-5 and do not use any tool.",
		];
		expected = [
			/^CODE=COBALT-731$/i,
			/^ACK-2$/i,
			/^ACK-3$/i,
			/^ACK-4$/i,
			/^ACK-5$/i,
		];
	}
	const replies = [];
	const wireRanges = [];
	const started = Date.now();
	try {
		for (let index = 0; index < prompts.length; index++) {
			if (index === 4 && scenario === "reuse") {
				const before = events.filter(
					(event) => event.type === "response" && event.command === "compact",
				).length;
				child.stdin.write(
					`${JSON.stringify({ type: "compact", customInstructions: "The visual probe is complete. Preserve only the four exact textual answers already returned; omit image payloads and unasked visual details." })}\n`,
				);
				const deadline = Date.now() + 600_000;
				while (
					events.filter(
						(event) => event.type === "response" && event.command === "compact",
					).length <= before
				) {
					if (child.exitCode !== null)
						throw new Error(`pi exited ${child.exitCode}: ${stderr.slice(-2000)}`);
					if (Date.now() > deadline) throw new Error("compaction timed out");
					await sleep(200);
				}
			}
			const settled = events.filter(
				(event) => event.type === "agent_settled",
			).length;
			const wireStart = wireRows(wireOutput).length;
			const eventStart = events.length;
			child.stdin.write(
				`${JSON.stringify({ type: "prompt", message: prompts[index] })}\n`,
			);
			const deadline = Date.now() + 600_000;
			while (
				events.filter((event) => event.type === "agent_settled").length <= settled
			) {
				if (child.exitCode !== null)
					throw new Error(`pi exited ${child.exitCode}: ${stderr.slice(-2000)}`);
				if (Date.now() > deadline) throw new Error(`prompt ${index + 1} timed out`);
				await sleep(200);
			}
			const phaseEvents = events.slice(eventStart);
			const reply =
				phaseEvents
					.filter(
						(event) =>
							event.type === "message_end" && event.message?.role === "assistant",
					)
					.map((event) => text(event.message.content).trim())
					.filter(Boolean)
					.at(-1) ?? "";
			replies.push({ value: reply, pass: expected[index].test(reply) });
			wireRanges.push(wireRows(wireOutput).slice(wireStart));
		}
	} finally {
		child.kill();
		writeFileSync(path.join(cwd, "rpc.stdout.jsonl"), stdout);
		writeFileSync(path.join(cwd, "rpc.stderr.log"), stderr);
	}
	const sessionFile = readdirSync(sessionDir)
		.filter((name) => name.endsWith(".jsonl"))
		.map((name) => path.join(sessionDir, name))[0];
	const entries = [];
	for (const line of readFileSync(sessionFile, "utf8").split(/\r?\n/)) {
		if (!line) continue;
		try {
			entries.push(JSON.parse(line));
		} catch {
			throw new Error(`malformed session line in ${sessionFile}`);
		}
	}
	const assistant = entries
		.filter(
			(entry) => entry.type === "message" && entry.message?.role === "assistant",
		)
		.map((entry) => entry.message);
	const usageMessages = [
		...assistant,
		...entries
			.filter((entry) => entry.type === "compaction" && entry.usage)
			.map((entry) => ({ usage: entry.usage })),
	];
	const usage = usageMessages.reduce(
		(sum, message) => {
			for (const key of [
				"input",
				"output",
				"cacheRead",
				"cacheWrite",
				"reasoning",
				"totalTokens",
			])
				sum[key] += message.usage?.[key] ?? 0;
			sum.costUsd += message.usage?.cost?.total ?? 0;
			return sum;
		},
		{
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			reasoning: 0,
			totalTokens: 0,
			costUsd: 0,
		},
	);
	const toolCalls = assistant
		.flatMap((message) => (Array.isArray(message.content) ? message.content : []))
		.filter((part) => part?.type === "toolCall");
	return {
		policy: policy.id,
		scenario,
		size: policy.size,
		rolling: policy.rolling,
		repetition: repetition + 1,
		sequence: sequence + 1,
		image: {
			width: policy.width,
			height: policy.height,
			bytes: statSync(path.join(cwd, "target.png")).size,
		},
		elapsedMs: Date.now() - started,
		pass: replies.every((reply) => reply.pass),
		replies,
		turns: assistant.length,
		toolCalls: toolCalls.length,
		readCalls: toolCalls.filter((call) => call.name === "read").length,
		usage,
		wireImagesByPrompt: wireRanges.map((rows) =>
			rows.map((row) => row.images?.count ?? 0),
		),
		wireImageCharsByPrompt: wireRanges.map((rows) =>
			rows.map((row) => row.images?.chars ?? 0),
		),
		compactions: entries.filter((entry) => entry.type === "compaction").length,
		cwd,
	};
}

mkdirSync(outputRoot, { recursive: true });
const results = [];
for (let repetition = 0; repetition < repetitions; repetition++) {
	for (const [sequence, policyIndex] of rotations[
		repetition % rotations.length
	].entries()) {
		const result = await run(policies[policyIndex], repetition, sequence);
		results.push(result);
		writeFileSync(
			path.join(outputRoot, "results.json"),
			`${JSON.stringify({ model, repetitions, scenario, results }, null, 2)}\n`,
		);
		console.log(
			JSON.stringify({
				policy: result.policy,
				repetition: result.repetition,
				pass: result.pass,
				tokens: result.usage.totalTokens,
				cost: result.usage.costUsd,
				reads: result.readCalls,
				wire: result.wireImagesByPrompt,
			}),
		);
	}
}
