import assert from "node:assert/strict";
import { browserOpener, isWsl, linuxHits } from "../src/platform.ts";

assert.equal(isWsl({ WSL_DISTRO_NAME: "Ubuntu" }, ""), true, "WSL_DISTRO_NAME marks WSL");
assert.equal(isWsl({}, "Linux version 6.18.54.1-microsoft-standard-WSL2"), true, "/proc/version names microsoft");
assert.equal(isWsl({}, "Linux version 6.8.0-45-generic (buildd@lcy02)"), false, "plain Linux is not WSL");

const url = "http://127.0.0.1:5/s/x/?token=ab&c=1";
assert.deepEqual(browserOpener(url, "win32", false), ["cmd", ["/c", "start", "", url]], "Windows unchanged");
assert.deepEqual(browserOpener(url, "darwin", false), ["open", [url]], "macOS unchanged");
assert.deepEqual(browserOpener(url, "linux", false), ["xdg-open", [url]], "plain Linux keeps xdg-open");
assert.deepEqual(browserOpener(url, "linux", true, true), ["wslview", [url]], "WSL prefers wslview");
assert.deepEqual(browserOpener(url, "linux", true, false), ["rundll32.exe", ["url.dll,FileProtocolHandler", url]], "WSL falls back to the Windows browser; the URL stays one argument");

const hits = ["/mnt/c/Users/x/AppData/Roaming/npm/pi-hub", "/usr/local/bin/pi-hub"];
assert.deepEqual(linuxHits(hits, true), ["/usr/local/bin/pi-hub"], "WSL ignores the appended Windows PATH");
assert.deepEqual(linuxHits(hits.slice(0, 1), true), [], "only a Windows hit means not installed");
assert.deepEqual(linuxHits(hits, false), hits, "elsewhere every hit counts");
console.log("ok - WSL detection, opener choice and /mnt/ PATH filter");
