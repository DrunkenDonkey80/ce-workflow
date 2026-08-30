#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const mode = process.argv[2];
const root = path.resolve(process.env.WORK_FIXTURE_ROOT ?? path.resolve(import.meta.dirname, "../../.."));
const out = path.join(root, ".pi", "work-artifacts", `${mode}-smoke`);
mkdirSync(out, { recursive: true });
if (mode === "command") {
	const rows = readFileSync(path.join(import.meta.dirname, "sample.csv"), "utf8").trim().split(/\r?\n/).slice(1);
	const total = rows.reduce((sum, row) => sum + Number(row.split(",")[1]), 0);
	const report = path.join(out, "report.json");
	writeFileSync(report, `${JSON.stringify({ rows: rows.length, total })}\n`);
	process.stdout.write(JSON.stringify({ artifacts: { file: path.relative(root, report) }, cleanup: { ok: true }, rows: rows.length, total }));
} else if (mode === "service") {
	const server = createServer((request, response) => {
		response.setHeader("content-type", "application/json");
		response.end(JSON.stringify({ ok: true, path: request.url }));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	const response = await fetch(`http://127.0.0.1:${port}/health`);
	const body = await response.json();
	await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	const log = path.join(out, "service.log");
	writeFileSync(log, `port=${port}\nstatus=${response.status}\npath=${body.path}\ncleanup=closed\n`);
	process.stdout.write(JSON.stringify({ artifacts: { log: path.relative(root, log) }, cleanup: { ok: true, listener: "closed" }, status: response.status, body }));
} else throw new Error("usage: run-process-smoke.mjs command|service");
