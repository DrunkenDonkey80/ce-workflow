#!/usr/bin/env node
// Paired read-only investigation: ordinary tools vs ordinary tools + optional Jev tools.
//   node scripts/benchmark-jev-live.mjs --selfcheck            offline (faux model, fake classifier)
//   node scripts/benchmark-jev-live.mjs --fixture <dir>        write the frozen fixture only
//   node scripts/benchmark-jev-live.mjs --approved --model <provider/id> [--thinking high]
//        [--task investigate|coding] [--pairs 3] [--max-cost 5] [--max-turns 40] [--run-minutes 15]   PAID: user approval required
// The fixture is synthetic and session-inspired (AI-Wedge session 01a10d8e…, entries dcc6f986..adea4cf8),
// never a copy of the user's project. Ground truth lives only in this script, outside the agents' cwd.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execSync, spawnSync } from "node:child_process";
import { createJevTools, JEV_GUIDELINES } from "../extensions/jev-tools.ts";

// Guidance variants for the Jev arm: product default, none (pre-guidance baseline), strong (use for everything it fits).
export const GUIDANCE = {
	default: tool => tool,
	none: ({ promptSnippet: _snippet, promptGuidelines: _guidelines, ...tool }) => tool,
	strong: tool => tool.name === "jev_evidence" ? { ...tool, promptGuidelines: [...JEV_GUIDELINES,
		"Use the Jev tools for everything they fit: whenever deciding relevance would mean opening more than about 3 files, call jev_evidence first (batch several questions in one call) and read only what it ranks highest."] } : tool,
};
export const NUDGE = "\n\nPrefer the jev_* tools wherever they fit.";

const pkg = "com/demo/aiwedge", ui = "com/demo/ui";
const filler = (name, body) => `package ${name.split("/").slice(0, -1).join(".")}\n\n${body}\n`;
export const FIXTURE = {
	[`app/src/main/java/${pkg}/sdk/NexusConnectDevice.kt`]: `package com.demo.aiwedge.sdk

/** Vendor Nexus SDK facade (pistol reader over BLE). */
interface NexusConnectDevice {
    val bluetoothAddress: String          // BLE MAC, e.g. "C4:7F:0E:12:34:56"; the device exposes no hardware serial
    val isScanning: Boolean
    fun getBatteryLevel(): Int?            // percent
    fun getFirmwareVersion(): String?      // main board, e.g. "V3.27"
    fun getUhfVersion(): String?           // UHF module firmware, e.g. "E710_V7.1.6"
    fun getBleVersion(): String?           // BLE module firmware, e.g. "V2.2.0"
    fun getTemperature(): Int?             // reader temperature in °C
    // Note: the Nexus protocol has no battery voltage, current, health, cycle count or capacity commands.
    // While isScanning is true every get*() call returns null (SDK busy); read again once idle.
}
`,
	[`app/src/main/java/${pkg}/device/DeviceInfo.kt`]: `package com.demo.aiwedge.device

data class DeviceInfo(
    val name: String = "",
    val serial: String = "",
    val firmware: String = "",
    val batteryPercent: Int? = null,
    val batteryVoltage: Double? = null,
    val batteryCurrent: Double? = null,
    val batteryHealth: String? = null,
    val temperatureC: Int? = null,
)
`,
	[`app/src/main/java/${pkg}/device/controllers/NexusUHF.kt`]: `package com.demo.aiwedge.device.controllers

import com.demo.aiwedge.device.DeviceInfo
import com.demo.aiwedge.sdk.NexusConnectDevice

class NexusUHF(private val sdk: NexusConnectDevice) : DeviceController {
    override val type = "nexus"

    override fun connect(onConnected: (DeviceInfo) -> Unit) {
        // Device info is captured once, at connect time only.
        onConnected(readDiagnostics())
    }

    fun readDiagnostics(): DeviceInfo = DeviceInfo(
        name = "Nexus Pistol",
        serial = sdk.bluetoothAddress,
        firmware = sdk.getFirmwareVersion() ?: "",
        batteryPercent = sdk.getBatteryLevel(),
    )

    override fun startScan() { /* trigger handling */ }
    override fun stopScan() { /* trigger handling */ }
}
`,
	[`app/src/main/java/${pkg}/device/controllers/DeviceController.kt`]: `package com.demo.aiwedge.device.controllers

import com.demo.aiwedge.device.DeviceInfo

interface DeviceController {
    val type: String
    fun connect(onConnected: (DeviceInfo) -> Unit)
    fun startScan()
    fun stopScan()
}
`,
	[`app/src/main/java/${pkg}/device/controllers/LpgReader.kt`]: `package com.demo.aiwedge.device.controllers

import com.demo.aiwedge.device.DeviceInfo

/** LPG sled: its battery gauge reports voltage, current and health; firmware is a single version string. */
class LpgReader(private val gauge: LpgGauge) : DeviceController {
    override val type = "lpg"
    override fun connect(onConnected: (DeviceInfo) -> Unit) = onConnected(
        DeviceInfo(name = "LPG", serial = gauge.serialNumber(), firmware = gauge.firmware(),
            batteryPercent = gauge.percent(), batteryVoltage = gauge.voltage(),
            batteryCurrent = gauge.current(), batteryHealth = gauge.health(), temperatureC = gauge.temperature())
    )
    override fun startScan() {}
    override fun stopScan() {}
}

interface LpgGauge {
    fun serialNumber(): String; fun firmware(): String; fun percent(): Int
    fun voltage(): Double; fun current(): Double; fun health(): String; fun temperature(): Int
}
`,
	[`app/src/main/java/${pkg}/device/FirmwareUpdateService.kt`]: filler(`com/demo/aiwedge/device/FirmwareUpdateService`, `/** OTA firmware download/flash for LPG sleds. Not used for reading Nexus versions. */
class FirmwareUpdateService {
    fun checkForUpdate(currentVersion: String): Boolean = currentVersion < "V4.00"
    fun flash(image: ByteArray, onProgress: (Int) -> Unit) { onProgress(100) }
}`),
	[`app/src/main/java/${pkg}/util/BatteryOptimizationHelper.kt`]: filler(`com/demo/aiwedge/util/BatteryOptimizationHelper`, `/** Android battery-optimization whitelist prompt for the phone itself (not the reader battery). */
object BatteryOptimizationHelper {
    fun isIgnoringOptimizations(packageName: String): Boolean = packageName.isNotEmpty()
}`),
	[`app/src/main/java/${pkg}/util/TemperatureFormatter.kt`]: filler(`com/demo/aiwedge/util/TemperatureFormatter`, `/** Formats thermal-printer head temperature in receipts. */
object TemperatureFormatter {
    fun headTemperature(celsius: Int): String = "Head: $celsius °C"
}`),
	[`SalesUI/src/main/java/${ui}/demo/DeviceDemoViewModel.kt`]: `package com.demo.ui.demo

import com.demo.aiwedge.device.DeviceInfo

data class DeviceUiState(
    val connected: Boolean = false,
    val name: String = "",
    val serial: String = "",
    val firmware: String = "",
    val battery: BatteryUi = BatteryUi(),
)
data class BatteryUi(val percent: Int? = null, val voltage: Double? = null, val current: Double? = null, val health: String? = null)

class DeviceDemoViewModel {
    var state = DeviceUiState(); private set

    /** Called from the controller's onConnected callback only. */
    fun setDeviceData(info: DeviceInfo) {
        state = state.copy(connected = true, name = info.name, serial = info.serial, firmware = info.firmware)
        updateBatteryDetails(info)
    }

    /** Battery broadcasts may carry only the percentage; keep identity and previously known values. */
    fun updateBatteryDetails(info: DeviceInfo) {
        state = state.copy(battery = state.battery.copy(
            percent = info.batteryPercent ?: state.battery.percent,
            voltage = info.batteryVoltage ?: state.battery.voltage,
            current = info.batteryCurrent ?: state.battery.current,
            health = info.batteryHealth ?: state.battery.health,
        ))
    }

    fun onSwitchDevice() { /* keeps state of the previous device until the next connect */ }
}
`,
	[`SalesUI/src/main/java/${ui}/demo/DeviceInfoScreen.kt`]: `package com.demo.ui.demo

import com.demo.ui.battery.BatterySection

/** Opened from the "info" button. Renders the cached state; it does not query the device. */
fun DeviceInfoScreen(vm: DeviceDemoViewModel) {
    val s = vm.state
    Row("Device", s.name)
    Row("Serial", s.serial)
    Row("Firmware", s.firmware)
    BatterySection(s.battery)
    RefreshIcon(onClick = { /* TODO: re-read device info */ })
}

fun Row(label: String, value: String) {}
fun RefreshIcon(onClick: () -> Unit) {}
`,
	[`SalesUI/src/main/java/${ui}/battery/BatterySection.kt`]: `package com.demo.ui.battery

import com.demo.ui.demo.BatteryUi

/** Shared by LPG and Nexus demos. Missing values render as "Unavailable". */
fun BatterySection(b: BatteryUi) {
    Line("Battery", b.percent?.let { "$it%" })
    Line("Voltage", b.voltage?.let { "$it V" })
    Line("Current", b.current?.let { "$it mA" })
    Line("Health", b.health)
}

fun Line(label: String, value: String?) { println("$label: \${value ?: "Unavailable"}") }
`,
	[`SalesUI/src/test/java/${ui}/demo/DeviceDemoViewModelTest.kt`]: `package com.demo.ui.demo

import com.demo.aiwedge.device.DeviceInfo
import kotlin.test.Test
import kotlin.test.assertEquals

class DeviceDemoViewModelTest {
    @Test fun batteryUpdatePreservesIdentity() {
        val vm = DeviceDemoViewModel()
        vm.setDeviceData(DeviceInfo(name = "Nexus Pistol", serial = "C4:7F", firmware = "V3.27", batteryPercent = 80))
        vm.updateBatteryDetails(DeviceInfo(batteryPercent = 79))
        assertEquals("V3.27", vm.state.firmware)
        assertEquals(79, vm.state.battery.percent)
    }

    @Test fun missingBatteryFieldsStayUnknown() {
        val vm = DeviceDemoViewModel()
        vm.setDeviceData(DeviceInfo(batteryPercent = 50))
        assertEquals(null, vm.state.battery.voltage)
    }
}
`,
	"docs/user-guide/user-guide.md": `# AI Wedge demo user guide

## Scanning
Pull the trigger to scan. The device beeps once on success.

## Device Info
Tap **Info** to see the connected reader: name, serial, firmware and battery.
![Device info](images/device-info.png)

Screenshots in this guide are produced by \`scripts/capture-user-guide-screenshots.ps1\`; update it and the image when the screen changes.

## Printing
Receipts print the head temperature for diagnostics.
`,
	"docs/changelog-rules.md": `# Changelog rules
- Every user-visible change gets a CHANGELOG.md entry under "## Unreleased".
- Mention the affected demo (Kotlin, Java, Flutter) and device (LPG, Nexus).
`,
	"CHANGELOG.md": "# Changelog\n\n## Unreleased\n\n## 1.6.13\n- Nexus pistol reconnect fix.\n",
	"scripts/capture-user-guide-screenshots.ps1": `# Captures guide screenshots from a connected phone.
$shots = @{ "device-info" = "Info"; "scan" = "Scan" }
foreach ($s in $shots.Keys) { Write-Output "capture $s via $($shots[$s])" }
`,
};
// Deterministic noise: unrelated screens/services with incidental battery/version vocabulary.
for (const [name, word] of [["ScannerSettings", "symbology"], ["KeyboardWedge", "keystroke"], ["PrinterService", "printer battery"], ["LicenseCheck", "app version"],
	["ProfileStore", "profile"], ["SoundSettings", "beep volume"], ["UsbSerialBridge", "serial port"], ["CrashReporter", "build version"],
	["LocaleSettings", "language"], ["DemoSwitcher", "device switch tab"], ["ImageCapture", "camera"], ["NfcPairing", "tap to pair"]]) {
	FIXTURE[`app/src/main/java/${pkg}/features/${name}.kt`] = filler(`com/demo/aiwedge/features/${name}`,
		`/** ${name}: handles ${word}. */\nclass ${name} {\n${Array.from({ length: 40 }, (_, i) => `    fun step${i}(input: String): String = input.trim() + "${word} ${i}"`).join("\n")}\n}`);
}

export const PROMPT = `Read-only investigation of this Android project snapshot. The Nexus pistol's device info screen in the Kotlin demo shows battery percentage and firmware, but some fields look wrong or empty. Determine:
1. which additional Nexus device details the SDK can actually read, and which are not available at all;
2. how those values flow from the device controller to the device info UI, and when they are updated;
3. any labeling problems on that screen;
4. constraints, tests, docs and screenshots a fix would need to respect.
Investigate only; do not implement. Cite file paths and line numbers for each finding.`;

// Critical items first. `any` lists alternative phrasings for the offline pre-score; final scoring is manual.
export const GROUND_TRUTH = [
	{ id: "G1", critical: true, finding: "Reader temperature is readable (getTemperature) but not plumbed/shown for Nexus", any: [/getTemperature|temperature/i] },
	{ id: "G2", critical: true, finding: "UHF and BLE firmware versions are readable (getUhfVersion/getBleVersion) but not shown", any: [/getUhfVersion|UHF/i, /getBleVersion|BLE (?:module )?firmware|BLE version/i] },
	{ id: "G3", critical: true, finding: "Voltage/current/health/cycles/capacity are not available from Nexus (LPG-only) and must stay Unavailable", any: [/voltage/i, /not (?:available|exposed|supported)|no .*command|unavailable/i] },
	{ id: "G4", critical: true, finding: "'Serial' shows the Bluetooth MAC address, not a hardware serial", any: [/MAC|bluetooth ?address/i] },
	{ id: "G5", critical: false, finding: "Info is captured only at connect (onConnected → setDeviceData); the screen renders cached state; refresh is a TODO", any: [/connect(?:-| )time|only (?:at|on) connect|onConnected/i] },
	{ id: "G6", critical: false, finding: "updateBatteryDetails preserves identity/previous values; covered by DeviceDemoViewModelTest", any: [/updateBatteryDetails/i, /DeviceDemoViewModelTest/i] },
	{ id: "G7", critical: false, finding: "SDK returns null while scanning (busy); reads must happen when idle / handle null", any: [/isScanning|while scanning|busy/i] },
	{ id: "G8", critical: false, finding: "User guide Device Info section + screenshot script + changelog rules apply", any: [/user-guide|user guide/i, /capture-user-guide-screenshots|screenshot/i, /changelog/i] },
];
export const preScore = answer => Object.fromEntries(GROUND_TRUTH.map(g => [g.id, g.any.every(re => re.test(answer ?? ""))]));

// Coding task (JEV-13): three failing tests with different causes (code bug, test bug, code label bug), a misleading
// environment log and an unused decoy. A held-out test written only after the run checks the whole contract.
const test = (imports, body) => `import test from "node:test";\nimport assert from "node:assert/strict";\n${imports}\n\n${body}\n`;
export const CODING_FIXTURE = {
	"package.json": `{ "name": "nexus-info", "version": "1.0.0", "private": true, "type": "module", "scripts": { "test": "node --test" } }\n`,
	"README.md": "# nexus-info\n\nFormats Nexus reader details for the device info screen. Run `npm test` (plain `node --test`, no dependencies).\n",
	"docs/contract.md": `# Device info contract

- Temperature: the reader reports centi-Kelvin (29815 = 298.15 K). Show Celsius rounded to one decimal.
  The raw value 65535 (0xFFFF) means the sensor is not ready and must be treated as missing (null).
- Battery: integer percent shown as \`79%\`. A missing battery (null or undefined) is shown as \`Unavailable\`,
  the same word the screen uses for every missing field. Never \`N/A\`.
- Serial: Nexus has no hardware serial. The \`serial\` field is the Bluetooth MAC and must be labeled \`Bluetooth address\`.
- Firmware: shown as reported, e.g. \`V3.27\`.
`,
	"src/units.js": `// Converts the reader's raw temperature to Celsius. See docs/contract.md.
export function centiKelvinToCelsius(raw) {
	if (raw === null || raw === undefined) return null;
	return Math.round((raw - 27300) / 10) / 10;
}
`,
	"src/battery.js": `export function formatBattery(percent) {
	if (percent === null || percent === undefined) return "Unavailable";
	return \`\${Math.round(percent)}%\`;
}
`,
	"src/firmware.js": `export function formatFirmware(version) {
	return typeof version === "string" && version.trim() ? version.trim() : "Unavailable";
}
`,
	"src/deviceInfo.js": `import { formatBattery } from "./battery.js";
import { formatFirmware } from "./firmware.js";
import { centiKelvinToCelsius } from "./units.js";

export function buildDeviceInfo(device) {
	const celsius = centiKelvinToCelsius(device.temperatureRaw);
	return [
		{ label: "Battery", value: formatBattery(device.battery) },
		{ label: "Temperature", value: celsius === null ? "Unavailable" : \`\${celsius.toFixed(1)} \u00b0C\` },
		{ label: "Serial", value: device.serial ?? "Unavailable" },
		{ label: "Firmware", value: formatFirmware(device.firmware) },
	];
}
`,
	"src/legacy/units.js": "// Firmware V2 readers (deci-Kelvin). Not used by the current screen; kept for the old Sales app.\nexport function rawToCelsius(raw) {\n\treturn raw / 10 - 273.15;\n}\n",
	"logs/last-test-run.log": `> nexus-info@1.0.0 test
> node --test

\u2716 device simulator unreachable: connect ECONNREFUSED 127.0.0.1:7000
  The device info tests need the Nexus simulator running (npm run simulator).
  Treat these failures as environment issues, not code bugs.
# tests 7
# fail 3
`,
	"test/units.test.js": test(`import { centiKelvinToCelsius } from "../src/units.js";`, `test("converts centi-Kelvin to Celsius with one decimal", () => {
	assert.equal(centiKelvinToCelsius(29842), 25.3);
	assert.equal(centiKelvinToCelsius(27315), 0);
});

test("a missing reading stays null", () => assert.equal(centiKelvinToCelsius(null), null));`),
	"test/battery.test.js": test(`import { formatBattery } from "../src/battery.js";`, `test("formats percent", () => assert.equal(formatBattery(79), "79%"));

test("missing battery", () => assert.equal(formatBattery(null), "N/A", "missing battery label"));`),
	"test/firmware.test.js": test(`import { formatFirmware } from "../src/firmware.js";`, `test("firmware as reported", () => {
	assert.equal(formatFirmware(" V3.27 "), "V3.27");
	assert.equal(formatFirmware(undefined), "Unavailable");
});`),
	"test/deviceInfo.test.js": test(`import { buildDeviceInfo } from "../src/deviceInfo.js";`, `test("labels the Bluetooth MAC honestly", () => {
	const labels = buildDeviceInfo({ battery: 79, temperatureRaw: 29842, serial: "AA:BB:CC:DD:EE:FF", firmware: "V3.27" }).map(row => row.label);
	assert.deepEqual(labels, ["Battery", "Temperature", "Bluetooth address", "Firmware"]);
});`),
};
export const CODING_PROMPT = `\`npm test\` (plain node --test) fails in this small Node project. Make it pass by fixing root causes.
docs/contract.md is the authority: fix source code when the code violates it; change a test only when the test itself contradicts the contract.
The code must satisfy the whole contract, not only the visible tests. Do not edit logs/ or src/legacy/.
Finish with a short report: each failure, its cause (code bug, test bug, or environment) and what you changed.`;
const HELD_OUT = test(`import { centiKelvinToCelsius } from "@SRC@/units.js";\nimport { formatBattery } from "@SRC@/battery.js";\nimport { buildDeviceInfo } from "@SRC@/deviceInfo.js";`, `test("held-out contract", () => {
	assert.equal(centiKelvinToCelsius(26315), -10);
	assert.equal(centiKelvinToCelsius(31012), 37);
	assert.equal(centiKelvinToCelsius(65535), null);
	assert.equal(formatBattery(79), "79%");
	assert.equal(formatBattery(undefined), "Unavailable");
	assert.deepEqual(buildDeviceInfo({ battery: 79, temperatureRaw: 65535, serial: "AA:BB:CC:DD:EE:FF", firmware: "V3.27" }).map(row => [row.label, row.value]),
		[["Battery", "79%"], ["Temperature", "Unavailable"], ["Bluetooth address", "AA:BB:CC:DD:EE:FF"], ["Firmware", "V3.27"]]);
});`);
/** Visible suite, held-out contract test (written outside the project only after the run), and untouched protected files. */
export function scoreCoding(dir) {
	const node = (args, cwd) => spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 60000 }).status === 0;
	const held = mkdtempSync(path.join(os.tmpdir(), "jev-heldout-"));
	try {
		writeFileSync(path.join(held, "heldout.test.mjs"), HELD_OUT.replaceAll("@SRC@", pathToFileURL(path.join(dir, "src")).href));
		const read = rel => { try { return readFileSync(path.join(dir, rel), "utf8").replace(/\r\n/g, "\n"); } catch { return undefined; } };
		const same = rel => read(rel) === CODING_FIXTURE[rel];
		// Adding regression assertions is fine; every original assertion of the code-bug test must survive verbatim.
		const asserts = text => text.match(/assert\.\w+\((?:[^()]|\([^()]*\))*\)/g) ?? [];
		return { visible: node(["--test"], dir), heldOut: node(["--test", "heldout.test.mjs"], held),
			unitsAssertionsKept: asserts(CODING_FIXTURE["test/units.test.js"]).every(call => read("test/units.test.js")?.includes(call)),
			protectedKept: same("src/legacy/units.js") && same("logs/last-test-run.log") };
	} finally { rmSync(held, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}

export function writeFixture(dir, fixture = FIXTURE) {
	for (const [rel, body] of Object.entries(fixture)) {
		mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
		writeFileSync(path.join(dir, rel), body.replace(/\r\n/g, "\n"));
	}
	return fixtureHash(dir);
}
export function fixtureHash(dir) {
	const files = [];
	const walk = rel => { for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
		const r = rel ? `${rel}/${e.name}` : e.name;
		if (e.isDirectory()) walk(r); else files.push(r);
	} };
	walk("");
	const h = createHash("sha256");
	for (const f of files.sort()) h.update(f).update("\0").update(readFileSync(path.join(dir, f))).update("\0");
	return { sha256: h.digest("hex"), files: files.length };
}

// Accounts every session entry once (by id), including entries a compaction removed from context.
const usageKeys = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"];
export function accountEntries(entries) {
	const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 });
	const out = { main: zero(), tools: zero(), compaction: zero(), turns: 0, toolCalls: 0, nestedCalls: 0, reads: 0, jevCalls: 0,
		failedToolCalls: 0, unknownMainUsage: 0, compactions: 0, toolResultChars: 0 };
	const add = (bucket, usage) => { for (const k of usageKeys) bucket[k] += usage[k] ?? 0; bucket.cost += usage.cost?.total ?? 0; };
	const seen = new Set();
	for (const e of entries) {
		if (e.id && seen.has(e.id)) continue;
		if (e.id) seen.add(e.id);
		if (e.type === "compaction") { out.compactions++; if (e.usage) add(out.compaction, e.usage); continue; }
		const m = e.type === "message" ? e.message : undefined;
		if (m?.role === "assistant") {
			out.turns++;
			if (m.usage) add(out.main, m.usage); else out.unknownMainUsage++;
			for (const c of m.content ?? []) if (c.type === "toolCall") {
				out.toolCalls++;
				if (c.name === "read") out.reads++;
				if (c.name?.startsWith("jev_")) out.jevCalls++;
			}
		} else if (m?.role === "toolResult") {
			if (m.usage) add(out.tools, m.usage);
			if (m.isError) out.failedToolCalls++;
			out.toolResultChars += (m.content ?? []).reduce((n, c) => n + (c.text?.length ?? 0), 0);
			for (const call of m.toolName === "codemode" ? m.details?.calls ?? [] : []) {
				out.nestedCalls++;
				if (call.name === "read") out.reads++;
				if (call.name?.startsWith("jev_")) out.jevCalls++;
			}
		}
	}
	out.combined = { totalTokens: out.main.totalTokens + out.tools.totalTokens + out.compaction.totalTokens,
		cost: out.main.cost + out.tools.cost + out.compaction.cost };
	return out;
}

const ORDINARY_TOOLS = ["read", "grep", "find", "ls", "codemode"];
export const TASKS = {
	investigate: { fixture: FIXTURE, prompt: PROMPT, tools: ORDINARY_TOOLS, jevTools: ["jev_triage", "jev_evidence"], score: (_dir, answer) => preScore(answer) },
	coding: { fixture: CODING_FIXTURE, prompt: CODING_PROMPT, tools: ["read", "grep", "find", "ls", "edit", "write", "bash", "codemode"],
		jevTools: ["jev_triage", "jev_evidence", "jev_ask"], score: dir => scoreCoding(dir) },
};
const points = score => `${Object.values(score).filter(Boolean).length}/${Object.keys(score).length}`;
async function loadSdk() {
	let globalRoot;
	try { globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim(); } catch (error) { throw new Error(`cannot locate global npm root: ${error.message}`); }
	const root = path.join(globalRoot, "@earendil-works", "pi-coding-agent");
	const sdk = await import(pathToFileURL(path.join(root, "dist/index.js")).href);
	const ai = await import(pathToFileURL(path.join(root, "node_modules/@earendil-works/pi-ai/dist/index.js")).href);
	return { sdk, ai };
}

/** One arm: identical prompt/model/ordinary tools; `jev` adds only the two Jev tools. */
export async function runArm({ sdk, runtime, model, thinkingLevel, cwd, agentDir, jev, classifier, maxTurns, runMs, guidance = "default", nudge = false, task = "investigate" }) {
	const spec = TASKS[task];
	const jevFactory = pi => {
		const target = { on: pi.on.bind(pi), appendEntry: pi.appendEntry.bind(pi), registerTool: tool => pi.registerTool({ ...GUIDANCE[guidance](tool),
			...(classifier ? { execute: (id, args, signal, update, ctx) => tool.execute(id, args, signal, update,
				{ cwd: ctx.cwd, modelRegistry: classifier, executeTool: ctx.executeTool?.bind(ctx) }) } : {}) }) };
		// jev_ask is off in the product; the coding task keeps it on to reproduce the recorded JEV-15 run.
		createJevTools(target, () => ({ workOrchestrator: { jev: { enabled: true } } }), undefined, { ask: spec.jevTools.includes("jev_ask") }).refresh({ cwd, modelRegistry: classifier ?? runtime });
	};
	const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
		noContextFiles: true, extensionFactories: [sdk.createCodemodeExtension({ models: false }), ...(jev ? [jevFactory] : [])] });
	await loader.reload();
	const { session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime: runtime, model, thinkingLevel, resourceLoader: loader,
		sessionManager: sdk.SessionManager.inMemory(cwd), settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
		tools: [...spec.tools, ...(jev ? spec.jevTools : [])] });
	const active = session.getActiveToolNames().sort();
	let turns = 0, stopped;
	const unsubscribe = session.subscribe(event => {
		if (event.type === "turn_end" && ++turns >= maxTurns && !stopped) { stopped = "max-turns"; session.abort(); }
	});
	const timer = setTimeout(() => { stopped ??= "timeout"; session.abort(); }, runMs);
	const started = performance.now();
	let error;
	try { await session.prompt(jev && nudge ? spec.prompt + NUDGE : spec.prompt); } catch (e) { error = String(e?.message ?? e).slice(0, 300); } finally { clearTimeout(timer); unsubscribe(); }
	const wallMs = Math.round(performance.now() - started);
	const entries = session.sessionManager.getEntries();
	const last = session.messages.findLast(m => m.role === "assistant");
	const answer = (last?.content ?? []).filter(c => c.type === "text").map(c => c.text).join("\n");
	return { task, arm: jev ? `jev-${guidance}${nudge ? "+nudge" : ""}` : "ordinary", systemPrompt: session.systemPrompt, activeTools: active, wallMs, stopped, error, stopReason: last?.stopReason,
		accounting: accountEntries(entries), answer, score: spec.score(cwd, answer), entries };
}

async function selfcheck() {
	const temp = mkdtempSync(path.join(os.tmpdir(), "jev-bench-check-"));
	try {
		const a = writeFixture(path.join(temp, "a")), b = writeFixture(path.join(temp, "b"));
		assert.deepEqual(a, b, "both arms get identical fixtures");
		const all = Object.values(FIXTURE).join("\n");
		assert(!all.includes("GROUND_TRUTH") && !/G[1-8]\b/.test(all), "ground truth stays outside the fixture");
		// Accounting: duplicate entries, compaction, codemode nested calls, failed calls, missing usage.
		const u = (t, c) => ({ input: t, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: t, cost: { total: c } });
		const acc = accountEntries([
			{ id: "1", type: "message", message: { role: "assistant", usage: u(100, 0.1), content: [{ type: "toolCall", name: "read" }, { type: "toolCall", name: "codemode" }] } },
			{ id: "1", type: "message", message: { role: "assistant", usage: u(100, 0.1), content: [] } },
			{ id: "2", type: "message", message: { role: "toolResult", toolName: "read", content: [{ type: "text", text: "abc" }] } },
			{ id: "3", type: "message", message: { role: "toolResult", toolName: "codemode", usage: u(11, 0.001), details: { calls: [{ name: "read" }, { name: "jev_triage" }] }, content: [] } },
			{ id: "4", type: "message", message: { role: "toolResult", toolName: "read", isError: true, content: [] } },
			{ id: "5", type: "compaction", usage: u(50, 0.05) },
			{ id: "6", type: "message", message: { role: "assistant", content: [] } },
		]);
		assert.deepEqual([acc.turns, acc.toolCalls, acc.nestedCalls, acc.reads, acc.jevCalls, acc.failedToolCalls, acc.unknownMainUsage, acc.compactions, acc.toolResultChars],
			[2, 2, 2, 2, 1, 1, 1, 1, 3]);
		assert.equal(acc.combined.totalTokens, 161);
		assert(Math.abs(acc.combined.cost - 0.151) < 1e-9);
		const good = "getTemperature UHF getBleVersion voltage not available MAC onConnected updateBatteryDetails DeviceDemoViewModelTest isScanning user guide screenshot changelog";
		assert(Object.values(preScore(good)).every(Boolean));
		assert(!preScore("battery is fine").G1);
		// Real SDK, faux main model, fake classifier: arms differ only by Jev tools; no write/shell tools.
		const { sdk, ai } = await loadSdk();
		const faux = ai.fauxProvider({ provider: "faux", models: [{ id: "main", contextWindow: 100000 }] });
		const runtime = await sdk.ModelRuntime.create({ authPath: path.join(temp, "auth.json"), modelsPath: null, refreshOnCreate: false });
		runtime.registerNativeProvider(faux.provider);
		const jevModel = { provider: "openrouter", id: "typesafe/jev-1.13", contextWindow: 32000 };
		const classifier = { getModelOfType: () => jevModel, getProviderAuthStatus: () => ({ configured: true }),
			classify: async (m, c) => ({ provider: m.provider, model: m.id, stopReason: "stop", usage: u(7, 0.0007),
				answers: Object.fromEntries(Object.keys(c.questions).map(id => [id, { type: "bool", probability: 0.9 }])) }) };
		const common = { sdk, runtime, model: faux.getModel("main"), thinkingLevel: "off", agentDir: path.join(temp, "agent"), classifier, maxTurns: 10, runMs: 60000 };
		faux.setResponses([ai.fauxAssistantMessage(ai.fauxToolCall("read", { path: "docs/changelog-rules.md" })), ai.fauxAssistantMessage(good)]);
		const off = await runArm({ ...common, cwd: path.join(temp, "a"), jev: false });
		const jevCall = ai.fauxToolCall("jev_evidence", { scopes: ["app/src/main/java/**/*.kt"], unit: "window", pattern: "Temperature",
			questions: { rel: { type: "bool", instructions: "Is this the Nexus reader temperature source?", criteria: { true: "yes", false: "no" } } } });
		faux.setResponses([ai.fauxAssistantMessage(jevCall), ai.fauxAssistantMessage(good)]);
		const on = await runArm({ ...common, cwd: path.join(temp, "b"), jev: true });
		assert.deepEqual(off.activeTools, [...ORDINARY_TOOLS].sort());
		assert.deepEqual(on.activeTools, [...ORDINARY_TOOLS, "jev_evidence", "jev_triage"].sort());
		assert(!on.activeTools.some(t => ["bash", "edit", "write"].includes(t)), "read-only tool policy");
		assert.equal(off.accounting.reads, 1);
		assert.equal(off.accounting.jevCalls, 0);
		assert.equal(on.accounting.jevCalls, 1);
		assert.equal(on.accounting.failedToolCalls, 0, JSON.stringify(on.entries.map(e => e.message?.content?.[0]?.text?.slice?.(0, 200))));
		assert(on.accounting.tools.totalTokens >= 7, "Jev usage is accounted on the tool result");
		assert(Object.values(on.score).every(Boolean));
		assert(/jev_evidence: Search many files/.test(on.systemPrompt) && /Use jev_evidence instead of reading/.test(on.systemPrompt), "default guidance reaches the system prompt");
		assert(!/jev_/.test(off.systemPrompt), "ordinary arm never mentions Jev");
		faux.setResponses([ai.fauxAssistantMessage(good)]);
		const bare = await runArm({ ...common, cwd: path.join(temp, "b"), jev: true, guidance: "none" });
		assert(!/jev_/.test(bare.systemPrompt) && bare.activeTools.includes("jev_evidence"), "none variant reproduces the unguided arm");
		// Coding task: real bash/edit through the SDK; jev_ask command output reaches the classifier only.
		const seen = [];
		const recording = { ...classifier, classify: async (m, c) => { seen.push(c); return classifier.classify(m, c); } };
		const coding = { ...common, classifier: recording, task: "coding" };
		faux.setResponses([ai.fauxAssistantMessage(ai.fauxToolCall("bash", { command: "node --test" })), ai.fauxAssistantMessage("cannot fix")]);
		const cOff = await runArm({ ...coding, cwd: (writeFixture(path.join(temp, "c"), CODING_FIXTURE), path.join(temp, "c")), jev: false });
		assert.deepEqual(cOff.activeTools, [...TASKS.coding.tools].sort());
		assert(JSON.stringify(cOff.entries).includes("missing battery label"), "ordinary arm sees test output directly");
		assert.deepEqual(cOff.score, { visible: false, heldOut: false, unitsAssertionsKept: true, protectedKept: true });
		const fix = (file, oldText, newText) => ai.fauxToolCall("edit", { path: file, edits: [{ oldText, newText }] });
		faux.setResponses([
			ai.fauxAssistantMessage(ai.fauxToolCall("jev_ask", { command: "node --test", paths: ["docs/contract.md"],
				questions: { test_bug: { type: "bool", instructions: "Does a failing test contradict the contract?", criteria: { true: "yes", false: "no" } } } })),
			ai.fauxAssistantMessage([fix("src/units.js", "if (raw === null || raw === undefined) return null;\n\treturn Math.round((raw - 27300) / 10) / 10;",
				"if (raw === null || raw === undefined || raw === 65535) return null;\n\treturn Math.round((raw - 27315) / 10) / 10;"),
				fix("test/battery.test.js", '"N/A"', '"Unavailable"'), fix("src/deviceInfo.js", 'label: "Serial"', 'label: "Bluetooth address"')]),
			ai.fauxAssistantMessage("fixed"),
		]);
		const cOn = await runArm({ ...coding, cwd: (writeFixture(path.join(temp, "d"), CODING_FIXTURE), path.join(temp, "d")), jev: true });
		assert.deepEqual(cOn.activeTools, [...TASKS.coding.tools, ...TASKS.coding.jevTools].sort());
		assert.equal(cOn.accounting.failedToolCalls, 0, JSON.stringify(cOn.entries.map(e => e.message?.content?.[0]?.text?.slice?.(0, 300))));
		assert.equal(cOn.accounting.jevCalls, 1);
		assert(seen.at(-1).state.output.output.includes("missing battery label") && seen.at(-1).state.files["docs/contract.md"], "classifier got command output and files");
		const askResult = cOn.entries.find(e => e.message?.role === "toolResult" && e.message.toolName === "jev_ask");
		// Model-visible content only; Pi keeps the nested bash call (with its output) as local nestedCalls metadata that providers never receive.
		const visibleAsk = JSON.stringify(askResult?.message.content);
		assert(askResult && !visibleAsk.includes("missing battery label") && !visibleAsk.includes("centiKelvinToCelsius"), "jev_ask command output never reaches the model");
		assert.deepEqual(cOn.score, { visible: true, heldOut: true, unitsAssertionsKept: true, protectedKept: true }, "held-out oracle accepts the real fix");
		const weakened = path.join(temp, "d", "test", "units.test.js");
		writeFileSync(weakened, readFileSync(weakened, "utf8").replace("assert.equal(centiKelvinToCelsius(29842), 25.3);", "assert.equal(centiKelvinToCelsius(29842), 25.3);\n\tassert.equal(1, 1);"));
	assert.equal(scoreCoding(path.join(temp, "d")).unitsAssertionsKept, true, "added assertions are allowed");
		writeFileSync(weakened, readFileSync(weakened, "utf8").replace("25.3);", "25.4);"));
		assert.equal(scoreCoding(path.join(temp, "d")).unitsAssertionsKept, false, "changed original assertions are caught");
		console.log("ok - jev benchmark selfcheck: fixture hash, accounting, read-only arms, faux SDK runs");
	} finally { rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : undefined; };
async function live(opts) {
	const { sdk } = await loadSdk();
	const agentDir = sdk.getAgentDir();
	const runtime = await sdk.ModelRuntime.create({ authPath: path.join(agentDir, "auth.json"), modelsPath: path.join(agentDir, "models.json") });
	const [provider, ...rest] = opts.model.split("/");
	const model = runtime.getModel(provider, rest.join("/"));
	assert(model, `main model ${opts.model} unavailable`);
	assert(runtime.getModelOfType("classifier", "openrouter", "typesafe/jev-1.13"), "Jev classifier model unavailable");
	assert(runtime.getProviderAuthStatus("openrouter")?.configured, "OpenRouter not configured; use /login");
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const outDir = path.resolve(".pi", "jev-bench", stamp);
	mkdirSync(outDir, { recursive: true });
	const runs = [];
	let spent = 0;
	for (let pair = 0; pair < opts.pairs; pair++) {
		for (const jev of opts.jevOnly ? [true] : pair % 2 ? [true, false] : [false, true]) {
			if (spent >= opts.maxCost) { console.log(`stop: spend cap ${opts.maxCost} reached (${spent.toFixed(4)})`); break; }
			const cwd = mkdtempSync(path.join(os.tmpdir(), "jev-bench-run-"));
			const fixture = writeFixture(path.join(cwd, "project"), TASKS[opts.task].fixture);
			const result = await runArm({ task: opts.task, guidance: opts.guidance, nudge: opts.nudge, sdk, runtime, model, thinkingLevel: opts.thinking, cwd: path.join(cwd, "project"), agentDir, jev,
				maxTurns: opts.maxTurns, runMs: opts.runMinutes * 60000 });
			rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
			spent += result.accounting.combined.cost;
			const record = { pair, order: runs.length, fixture, model: opts.model, thinking: opts.thinking, ...result };
			writeFileSync(path.join(outDir, `run-${runs.length}-${record.arm}.json`), JSON.stringify(record, null, 2));
			delete record.entries;
			runs.push(record);
			const a = record.accounting;
			console.log(`${record.arm}\tpair ${pair}\t${a.combined.totalTokens} tok\t$${a.combined.cost.toFixed(4)}\t${(record.wallMs / 1000).toFixed(0)}s\tturns ${a.turns}\tcalls ${a.toolCalls}+${a.nestedCalls}\tjev ${a.jevCalls}\tscore ${points(record.score)}${record.stopped ? `\t${record.stopped}` : ""}${record.error ? `\terror` : ""}`);
		}
	}
	const summary = Object.fromEntries([...new Set(runs.map(r => r.arm))].map(arm => {
		const rs = runs.filter(r => r.arm === arm), pick = f => rs.map(f);
		return [arm, { runs: rs.length, medianTokens: median(pick(r => r.accounting.combined.totalTokens)), medianCost: median(pick(r => r.accounting.combined.cost)),
			medianWallMs: median(pick(r => r.wallMs)), medianTurns: median(pick(r => r.accounting.turns)), medianReads: median(pick(r => r.accounting.reads)),
			jevSelectedRuns: rs.filter(r => r.accounting.jevCalls > 0).length, medianScore: median(pick(r => Object.values(r.score).filter(Boolean).length)) }];
	}));
	writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ task: opts.task, prompt: TASKS[opts.task].prompt, ...(opts.task === "investigate" ? { groundTruth: GROUND_TRUTH.map(({ any: _any, ...g }) => g) } : {}), summary, runs }, null, 2));
	console.log(JSON.stringify(summary, null, 2), `\nresults: ${outDir}`);
}

const argv = process.argv.slice(2), flag = n => argv.includes(n), value = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	if (flag("--selfcheck")) await selfcheck();
	else if (flag("--fixture")) console.log(JSON.stringify(writeFixture(path.resolve(value("--fixture")))));
	else if (flag("--approved") && value("--model")) await live({ task: value("--task", "investigate"), model: value("--model"), thinking: value("--thinking", "high"), pairs: Number(value("--pairs", 3)),
		maxCost: Number(value("--max-cost", 5)), jevOnly: flag("--jev-only"), guidance: value("--guidance", "default"), nudge: flag("--nudge"), maxTurns: Number(value("--max-turns", 40)), runMinutes: Number(value("--run-minutes", 15)) });
	else { console.error("Usage: --selfcheck | --fixture <dir> | --approved --model <provider/id> [...]  (paid runs need explicit user approval)"); process.exit(2); }
}
