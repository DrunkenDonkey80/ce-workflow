import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const VIEWPORT = { width: 390, height: 844 };
const REQUIRED = ["arithmetic", "keyboard", "error-recovery", "theme-persistence", "accessibility"];

function fail(reason, gates = []) { return { project: "calculator", passed: false, reason, gates }; }

export async function verifyCalculatorProject(root, browser) {
	if (!browser || typeof browser.capability !== "function") return fail("browser-unavailable");
	const capability = await browser.capability();
	if (!capability?.name || !capability?.version || capability.screenshot !== true) return fail("browser-capability-mismatch");
	const temp = mkdtempSync(path.join(os.tmpdir(), "ce-calculator-acceptance-"));
	const gates = [];
	try {
		await browser.setViewport(VIEWPORT);
		await browser.navigate(path.resolve(root, "index.html"));
		for (const name of REQUIRED) {
			const result = await browser.runScenario(name);
			gates.push({ name, passed: result?.passed === true, detail: result?.detail ?? "" });
		}
		const viewport = await browser.viewport();
		gates.push({ name: "viewport", passed: viewport?.width === VIEWPORT.width && viewport?.height === VIEWPORT.height });
		const errors = await browser.consoleErrors();
		gates.push({ name: "console", passed: Array.isArray(errors) && errors.length === 0, detail: errors?.join("\n") ?? "missing console evidence" });
		const screenshot = path.join(temp, "calculator.png");
		await browser.screenshot(screenshot, { fullPage: true });
		gates.push({ name: "screenshot", passed: existsSync(screenshot) && statSync(screenshot).size > 0, detail: screenshot });
		return { project: "calculator", passed: gates.every((gate) => gate.passed), browser: capability, viewport, gates };
	} catch (error) {
		return fail(error?.code === "ETIMEDOUT" ? "browser-timeout" : "browser-error", [...gates, { name: "browser", passed: false, detail: error instanceof Error ? error.message : String(error) }]);
	} finally {
		await browser?.close?.();
		rmSync(temp, { recursive: true, force: true });
	}
}

export { VIEWPORT };
