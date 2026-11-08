import path from "node:path";

// The recipe ships with the package (package.json files); its §7 skeleton carries the human gates.
export const REWORK_RECIPE = path.resolve(import.meta.dirname, "..", "docs", "proposals", "2026-11-05-rework-recipe.md");

/** Planning request for `/plan3 rework [target]`; `sha` is set only by the lab driver, which prepared the clone itself. */
export const reworkRequest = (target = "", sha = "") => [
	`Rework${target ? ` ${target}` : ""}: apply the rework recipe at ${REWORK_RECIPE} to this project.`,
	"Read the recipe in full first and follow its plan skeleton (section 7).",
	target ? `Map starts from "${target}" and may pick a better target inside it.` : "Map picks the rework target.",
	sha ? `Pre-rework SHA: ${sha}.` : "Record the pre-rework SHA as recipe section 3 says (commit current work first if the tree is dirty) before writing the plan.",
	"Goal: a deeper module (recipe §0): a smaller interface, rules moved from callers into the module, and fewer files touched by the next realistic changes, with no behavior regression. A split that keeps the same interface is not the goal. Local repair or stop is the right pick only when it meets that goal better.",
	"Planning writes the plan only: Map and every later phase run after /plan3 finish, on their phase models.",
].join(" ");
