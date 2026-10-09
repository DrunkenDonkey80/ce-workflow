# Calculator design export

Exported through OpenDesign's installed `od export` command, without an agent/model call, browser workaround or desktop-wide capture.

- `porcelain-calculator-prototype.html`: standalone HTML with inline styles/script and system fonts; implementation reference, not production code.
- `calculator-preview.png`: native desktop initial-state image export, visually inspected. This is the design itself, not an application/monitor screenshot.
- `EXPORT-MANIFEST.json`: project, conversation, completed run, export time, file sizes and SHA-256 hashes. This snapshots the current saved native file, not a guaranteed historical run revision.

The installed CLI was invoked with Node, the exact existing project/file and a loopback daemon URL discovered through the running native application's own sidecar SDK. HTML used `--format html`; PNG used `--format image --image-format png --page`. Both used explicit local `--out` paths and returned successful JSON envelopes.

This folder is the local design handoff for plan ca1c0001. The settled brief remains in `../OPEN-DESIGN-APP-BRIEF.md`. No ce-workflow handoff schema was imposed on OpenDesign, and the historical `DESIGN-STATE.json` is not this export's authority.

**Not approved or plan-finished.** Exporting does not record human approval or unlock implementation. Desktop initial appearance was inspected; arithmetic, mobile/error/focus states and accessibility have not been verified by this agent. Re-export into a fresh snapshot if the native design changes.
