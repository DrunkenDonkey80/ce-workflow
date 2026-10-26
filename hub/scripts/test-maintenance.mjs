import assert from "node:assert/strict";
import { HUB_SERVICE, maintenanceCommand, systemdHub } from "../src/maintenance.ts";

assert.equal(systemdHub(0, `0::/user.slice/user-1000.slice/user@1000.service/app.slice/${HUB_SERVICE}\n`), true);
assert.equal(systemdHub(0, `0::/user.slice/${HUB_SERVICE}/child\n`), true);
for (const cgroup of ["0::/init.scope\n", "0::/app.slice/other.service\n", `0::/${HUB_SERVICE}.other\n`]) assert.equal(systemdHub(0, cgroup), false);
assert.equal(systemdHub(2147483647), false, "a missing process is not a managed hub");

const cli = "/a folder/hub/cli.ts", log = "/data folder/hub.log";
for (const action of ["restart", "update"]) {
	const tail = [process.execPath, cli, action, ...(action === "update" ? ["--yes"] : [])];
	assert.deepEqual(maintenanceCommand(action, cli, log, false), [tail[0], tail.slice(1)], "non-systemd launch stays direct");
	const [command, args] = maintenanceCommand(action, cli, log, true);
	assert.equal(command, "systemd-run", "the worker must leave the hub's cgroup");
	assert(args.includes("--user") && args.includes("--collect") && args.includes("--property=Type=exec"));
	assert(args.includes(`--property=StandardOutput=append:${log}`));
	assert(args.includes(`--property=StandardError=append:${log}`));
	assert(args.some(arg => arg.startsWith("--setenv=PI_CODING_AGENT_DIR=")), "worker uses the same data directory");
	assert.deepEqual(args.slice(args.indexOf("--") + 1), tail, "paths with spaces remain single arguments");
}
assert.deepEqual(maintenanceCommand("update", cli, log, false, "git:github.com/x/ce-workflow")[1], [cli, "update", "--yes", "--extension", "git:github.com/x/ce-workflow"], "just one package");
console.log("maintenance ok");
