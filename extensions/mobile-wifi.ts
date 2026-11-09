// Wi-Fi iPhones and iPads for mobile_act. mobilecli finds real iOS devices only through usbmuxd (USB), so the ones Xcode reaches
// over the network come from devicectl, and mobile_act drives their DeviceKit helper itself, over the CoreDevice tunnel.
import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Device, Options } from "./mobile-act.ts";

type Exec = (command: string, args: string[], options: { timeout: number; signal?: AbortSignal }) => Promise<{ code?: number; killed?: boolean; stdout?: string; stderr?: string }>;
export const DEVICEKIT_TAG = "0.0.36"; // the helper version mobilecli 1.0.22 installs (agentVersionIOS); keep them in step
const PORT = 12004;
const CACHE = path.join(os.homedir(), ".cache", "ce-workflow");
/** Wi-Fi-only iOS devices: id -> tunnel address ("" while the tunnel is down). */
export const wifi = new Map<string, string>();

async function devicectl(exec: Exec, args: string[], signal?: AbortSignal, timeout = 60_000) {
	const out = path.join(os.tmpdir(), `mobile-wifi-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
	const r = await exec("xcrun", ["devicectl", ...args, "--json-output", out], { timeout, signal });
	try { return JSON.parse(await readFile(out, "utf8")).result; }
	catch { throw new Error(`devicectl ${args.slice(0, 3).join(" ")} failed: ${String(r.stderr || r.stdout || "").trim().slice(-300)}`); }
	finally { await rm(out, { force: true }); }
}

/** Paired iPhones and iPads that Xcode reaches over the network; online when their tunnel is up. Empty off macOS or without Xcode. */
export async function wifiDevices(exec: Exec, signal?: AbortSignal): Promise<Device[]> {
	if (process.platform !== "darwin") return [];
	const list = (await devicectl(exec, ["list", "devices"], signal).catch(() => undefined))?.devices ?? [];
	return list.filter((d: any) => d.hardwareProperties?.reality === "physical" && d.hardwareProperties?.platform === "iOS" && d.connectionProperties?.transportType === "localNetwork").map((d: any) => {
		const id = d.hardwareProperties.udid, ip = d.connectionProperties.tunnelState === "connected" ? d.connectionProperties.tunnelIPAddress ?? "" : "";
		wifi.set(id, ip);
		return { id, name: d.deviceProperties?.name ?? id, platform: "ios", type: "real", state: ip ? "online" : "offline", version: d.deviceProperties?.osVersionNumber ?? "" };
	});
}

/** Opens the device's tunnel (any devicectl request does) and says whether it came up. */
export async function wifiConnect(exec: Exec, dev: Device, signal?: AbortSignal) {
	await devicectl(exec, ["device", "info", "details", "--device", dev.id], signal);
	await wifiDevices(exec, signal);
	if (!wifi.get(dev.id)) throw new Error(`${dev.name} does not answer over Wi-Fi: it must be unlocked, on the Mac's network, and paired in Xcode (Window > Devices and Simulators, "Connect via network").`);
}

async function rpc(exec: Exec, ip: string, method: string, params: object = {}, signal?: AbortSignal, timeout = 60_000) {
	const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
	const r = await exec("curl", ["-gsS", "-m", String(Math.ceil(timeout / 1000)), "-H", "Content-Type: application/json", "--data-binary", body, `http://[${ip}]:${PORT}/rpc`], { timeout: timeout + 5000, signal });
	if (r.killed || r.code) throw new Error(`The mobile_act helper does not answer (${method}): ${String(r.stderr || "curl failed").trim().slice(-300)}`);
	let res;
	try { res = JSON.parse(String(r.stdout)); } catch { throw new Error(`The mobile_act helper sent non-JSON for ${method}: ${String(r.stdout).slice(0, 300)}`); }
	if (res.error) throw new Error(`${method} failed: ${res.error.message ?? JSON.stringify(res.error)}`);
	return res.result;
}

// The element types mobilecli keeps from the helper's tree (its filterSourceElements), so Wi-Fi snapshots match USB ones.
const ACCEPTED = new Set(["TextField", "TextView", "Button", "Switch", "Icon", "SearchField", "StaticText", "Image", "SecureTextField", "WebView", "Slider", "ProgressIndicator", "ActivityIndicator", "Picker", "PickerWheel", "Link", "Tab", "TabBar", "NavigationBar", "Toolbar", "Alert", "Sheet", "Cell", "Table", "CollectionView", "ScrollView"]);
const ALWAYS = new Set(["TextField", "TextView", "SecureTextField", "Button", "Switch", "SearchField", "WebView", "Slider", "Picker", "PickerWheel"]);
/** The helper's raw tree as mobilecli's dump ui elements: rejected elements hand their children to the nearest kept ancestor. */
export function treeElements(n: any): any[] {
	const kids = (n.children ?? []).flatMap(treeElements), type = String(n.type ?? "").replace(/^XCUIElementType/, ""), f = n.rect ?? {};
	const has = (v: unknown) => typeof v === "string" && v !== "";
	if (!(ACCEPTED.has(type) || has(n.rawIdentifier)) || !(f.x >= 0 && f.y >= 0 && f.width > 0 && f.height > 0)) return kids;
	if (!ALWAYS.has(type) && ![n.label, n.name, n.rawIdentifier, n.placeholderValue].some(has)) return kids;
	return [{ type, label: n.label, value: n.value, identifier: n.rawIdentifier, rect: { x: Math.trunc(f.x), y: Math.trunc(f.y), width: Math.trunc(f.width), height: Math.trunc(f.height) }, children: kids }];
}

const BUTTONS: Record<string, string> = { HOME: "home", POWER: "lock", VOLUME_UP: "volumeUp", VOLUME_DOWN: "volumeDown" };
/** Does what the mobilecli command (args) would, through the helper at ip; returns what mobilecli puts in data. */
export async function wifiCall(exec: Exec, ip: string, args: string[], signal?: AbortSignal, timeout?: number) {
	const call = (method: string, params?: object) => rpc(exec, ip, method, params, signal, timeout);
	const [cmd, sub, arg] = args, nums = (s: string) => s.split(",").map(Number), opt = (name: string) => args[args.indexOf(name) + 1];
	const key = (k: string) => call("device.io.keys", { keys: [{ key: k, modifiers: [] }] });
	switch (`${cmd} ${sub}`) {
		case "device info": return { device: { screenSize: (await call("device.info")).screenSize } };
		case "dump ui": return { elements: treeElements(await call("device.dump.ui", { format: "json" })) };
		case "apps foreground": return { packageName: (await call("device.apps.foreground")).bundleId };
		case "apps launch": case "apps terminate": return call(`device.apps.${sub}`, { bundleId: arg });
		case "io tap": { const [x, y] = nums(arg); return call("device.io.tap", { x, y }); }
		case "io longpress": { const [x, y] = nums(arg); return call("device.io.longpress", { x, y, duration: Number(opt("--duration") ?? 1000) / 1000 }); }
		case "io swipe": { const [x1, y1, x2, y2] = nums(arg); return call("device.io.swipe", { x1, y1, x2, y2 }); }
		case "io text": return call("device.io.text", { text: arg });
		case "io fill": await key("clear"); return arg ? call("device.io.text", { text: arg }) : {}; // HID clear empties the focused field, as mobilecli's fill
		case "io keys": return key(arg);
		case "io button": return call("device.io.button", { button: BUTTONS[arg] ?? arg.toLowerCase() });
	}
	if (cmd === "screenshot") {
		const b64 = String((await call("device.screenshot", { format: "png" })).data ?? "");
		await writeFile(opt("--output"), Buffer.from(b64.slice(b64.indexOf(",") + 1), "base64"));
		return {};
	}
	throw new Error(`mobile_act cannot run mobilecli ${cmd} ${sub ?? ""} on a Wi-Fi device.`);
}

/** Team of the newest unexpired development profile that lists the device: Xcode made it when it signed an app for the device. */
export async function teamFor(exec: Exec, udid: string, signal?: AbortSignal, dirs = ["Library/MobileDevice/Provisioning Profiles", "Library/Developer/Xcode/UserData/Provisioning Profiles"].map(d => path.join(os.homedir(), d)), now = Date.now()) {
	let best: { team: string; made: number } | undefined;
	for (const dir of dirs) for (const name of await readdir(dir).catch(() => [] as string[])) {
		if (!name.endsWith(".mobileprovision")) continue;
		const xml = String((await exec("security", ["cms", "-D", "-i", path.join(dir, name)], { timeout: 10_000, signal })).stdout ?? "");
		const date = (k: string) => Date.parse(xml.match(new RegExp(`<key>${k}</key>\\s*<date>([^<]*)</date>`))?.[1] ?? "");
		const team = xml.match(/<key>TeamIdentifier<\/key>\s*<array>\s*<string>([^<]*)<\/string>/)?.[1];
		if (team && date("ExpirationDate") > now && xml.includes(`<string>${udid}</string>`) && !(best && best.made >= date("CreationDate"))) best = { team, made: date("CreationDate") };
	}
	return best?.team;
}

/** Makes sure the DeviceKit helper answers on the device: builds it once per device with the user's team, then starts it as a UI test. */
export async function wifiAgent(exec: Exec, dev: Device, o: Options) {
	const ip = wifi.get(dev.id)!, { signal } = o;
	if (await rpc(exec, ip, "device.info", {}, signal, 5000).then(() => true, () => false)) return;
	const dir = path.join(CACHE, "devicekit", dev.id), products = path.join(dir, "Build", "Products"); // per device: its signing profile must list it
	const find = async () => (await readdir(products).catch(() => [] as string[])).find(f => f.endsWith(".xctestrun"));
	if (!await find()) {
		if (!o.confirm || !await o.confirm(`Build the mobile_act helper for ${dev.name}?`, `${dev.name} is on Wi-Fi, which mobilecli cannot reach. mobile_act builds the DeviceKit helper (devicekit-ios ${DEVICEKIT_TAG}) with your Xcode team and runs it on the device as a UI test. This takes about 2 minutes, once per device. Build it now?`))
			throw new Error(`The mobile_act helper is not built for ${dev.name}; call again and allow the build.`);
		const team = await teamFor(exec, dev.id, signal);
		if (!team) throw new Error(`No development profile lists ${dev.name} (${dev.id}). Run any app on it from Xcode once, so Xcode registers it with your team, then retry.`);
		const src = path.join(CACHE, `devicekit-ios-${DEVICEKIT_TAG}`), pbx = path.join(src, "devicekit-ios.xcodeproj", "project.pbxproj");
		if (!existsSync(pbx)) {
			await rm(src, { recursive: true, force: true });
			const c = await exec("git", ["clone", "-q", "--depth", "1", "--branch", DEVICEKIT_TAG, "https://github.com/mobile-next/devicekit-ios", src], { timeout: 300_000, signal });
			if (c.code || c.killed) throw new Error(`Downloading devicekit-ios failed: ${String(c.stderr ?? "").trim().slice(-500)}`);
		}
		// Bundle ids are global: Apple refuses mobile-next's, so each team gets its own.
		await writeFile(pbx, (await readFile(pbx, "utf8")).replace(/(com\.mobilenext|cewf\.\w+)\.devicekit-ios/g, `cewf.${team}.devicekit-ios`));
		const b = await exec("xcrun", ["xcodebuild", "build-for-testing", "-project", path.join(src, "devicekit-ios.xcodeproj"), "-scheme", "devicekit-ios", "-destination", `id=${dev.id}`, "-derivedDataPath", dir, "-allowProvisioningUpdates", `DEVELOPMENT_TEAM=${team}`, "CODE_SIGN_STYLE=Automatic"], { timeout: 900_000, signal });
		if (b.code || b.killed || !await find()) throw new Error(`Building the helper failed:\n${String(b.stdout ?? "").split("\n").filter(l => /error:/.test(l)).slice(0, 8).join("\n") || String(b.stderr ?? "").trim().slice(-800)}`);
	}
	// Detached: the helper keeps running for later calls and sessions. It listens on the tunnel address only, not the whole network.
	const log = path.join(dir, "helper.log"), out = openSync(log, "w");
	const child = spawn("xcrun", ["xcodebuild", "test-without-building", "-xctestrun", path.join(products, (await find())!), "-destination", `id=${dev.id}`], { detached: true, stdio: ["ignore", out, out], env: { ...process.env, TEST_RUNNER_DEVICEKIT_LISTEN_HOST: `127.0.0.1,${ip}` } });
	let ended = false;
	child.on("exit", () => { ended = true; });
	child.unref();
	for (let t = 0; t < 90 && !ended; t++) {
		if (await rpc(exec, ip, "device.info", {}, signal, 3000).then(() => true, () => false)) return;
		await new Promise(res => setTimeout(res, 1000));
	}
	if (!ended) child.kill();
	const text = await readFile(log, "utf8").catch(() => "");
	if (/enabling automation mode/i.test(text)) throw new Error(`${dev.name} refused UI automation: turn on Settings > Developer > Enable UI Automation on the device (it may ask for the passcode), then retry.`);
	throw new Error(`The helper did not start on ${dev.name}${/iPad/i.test(dev.name) ? " (an iPad needs multitasking off: Settings > Multitasking & Gestures, Full Screen Apps)" : ""}. Log: ${log}\n${text.split("\n").filter(l => /error|fail/i.test(l)).slice(-6).join("\n")}`);
}
