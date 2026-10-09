import fs from "node:fs";
export const html = `<!doctype html><html><head><title>Native calculator</title></head><body><button aria-label="One">1</button><output>0</output></body></html>`;
export const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf2kAAAAASUVORK5CYII=", "base64");
if (process.argv.includes("export")) {
	const arg = name => process.argv[process.argv.indexOf(`--${name}`) + 1];
	const format = arg("format"), file = arg("out");
	if (!file || !["html", "image"].includes(format) || format === "html" && process.argv.includes("--page") || format === "image" && (!process.argv.includes("--page") || arg("image-format") !== "png")) throw new Error("Invalid native export arguments");
	const data = process.env.FAKE_NATIVE_EXPORT_BAD === format ? "invalid" : format === "html" ? html : png;
	fs.writeFileSync(file, data, { flag: "wx" });
	console.log(JSON.stringify({ ok: true, path: file, bytes: fs.statSync(file).size, format }));
}
