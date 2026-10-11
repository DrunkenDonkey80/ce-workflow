import { createJiti } from "jiti";
const { runCameraProcess } = await createJiti(import.meta.url).import("../../extensions/work-camera-process.ts");
const abort = new AbortController();
let stop;
const owner = {
	signal: abort.signal,
	async guard() {},
	async begin() {},
	attachStop(fn) { stop = fn; },
	async worker(workerPid, childPid) { if (childPid) console.log(JSON.stringify([workerPid, childPid])); },
	async finish() { await stop(); },
};
await runCameraProcess(owner, process.execPath, ["-e", "setInterval(()=>{},1000)"], { durationMs: 30000, maxBytes: 1024 });
