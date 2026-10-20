import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";


export const DESIGN_HANDOFF_VERSION = 2;





const MAX_TEXT = 20_000;
const MAX_ITEMS = 128;

const ALLOWED_PROOFS = new Set([
	"interaction",
	"visual",
	"accessibility",
	"logs",
	"manual",
]);
const ALLOWED_VIEWPORTS = new Set(["desktop", "mobile", "tablet"]);
const ALLOWED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const REFERENCE_IMAGE_MAX_BYTES = 700_000;
const ALLOWED_TEXT_EXTENSIONS = new Set([".md", ".json"]);
const RESERVED_NAMES = new Set(["con", "prn", "aux", "nul", "com1", "lpt1"]);

function fail(message) {
	throw new Error(`design-contract: ${message}`);
}

function object(value, field) {
	if (!value || typeof value !== "object" || Array.isArray(value))
		fail(`${field} must be an object`);
	return value;
}

function string(value, field, max = MAX_TEXT) {
	if (typeof value !== "string" || !value.trim())
		fail(`${field} must be a non-empty string`);
	if (Buffer.byteLength(value, "utf8") > max)
		fail(`${field} exceeds ${max} bytes`);
	return value.trim();
}

function optionalString(value, field, max = MAX_TEXT) {
	if (value == null || value === "") return "";
	return string(value, field, max);
}

function array(value, field, { min = 0, max = MAX_ITEMS } = {}) {
	if (!Array.isArray(value) || value.length < min || value.length > max) {
		fail(`${field} must contain ${min}-${max} items`);
	}
	return value;
}

function unique(items, field) {
	const seen = new Set();
	for (const item of items) {
		if (seen.has(item)) fail(`${field} contains duplicate ${item}`);
		seen.add(item);
	}
}

function id(value, field, prefix) {
	const result = string(value, field, 80);
	if (!new RegExp(`^${prefix}-[A-Z0-9][A-Z0-9._-]*$`, "i").test(result))
		fail(`${field} has an invalid id`);
	return result;
}

function boundedJson(value, field, max = 256_000) {
	const text = JSON.stringify(value);
	if (!text || Buffer.byteLength(text, "utf8") > max)
		fail(`${field} exceeds ${max} bytes`);
}

export function canonicalizeDesignValue(value) {
	if (Array.isArray(value)) return value.map(canonicalizeDesignValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonicalizeDesignValue(value[key])]),
		);
	}
	return value;
}

export function canonicalDesignJson(value) {
	return `${JSON.stringify(canonicalizeDesignValue(value), null, 2)}\n`;
}

export function hashDesignValue(value) {
	return crypto
		.createHash("sha256")
		.update(canonicalDesignJson(value))
		.digest("hex");
}















function stringList(value, field, options: any = {}) {
	const result = array(value, field, options).map((item, index) =>
		string(item, `${field}[${index}]`),
	);
	unique(result, field);
	return result;
}

function records(value, field, prefix, validate) {
	const result = array(value, field, { min: 1 }).map((entry, index) => {
		object(entry, `${field}[${index}]`);
		id(entry.id, `${field}[${index}].id`, prefix);
		validate(entry, index);
		return entry;
	});
	unique(
		result.map((entry) => entry.id),
		`${field}.id`,
	);
	return result;
}







export function directionSelectionIsCurrent(selection, current) {
	if (!selection || !["human", "fixture"].includes(selection.authority))
		return false;
	return [
		"ownerId",
		"briefHash",
		"candidateManifestHash",
		"candidateId",
		"candidateArtifactHash",
	].every((key) => selection[key] === current[key]);
}

export function validateDesignHandoff(raw, options: any = {}) {
	const handoff = object(raw, "handoff");
	boundedJson(handoff, "handoff");
	if (![1, DESIGN_HANDOFF_VERSION].includes(handoff.version))
		fail("unsupported handoff version");
	if (options.targetMatrix?.length && handoff.version !== DESIGN_HANDOFF_VERSION)
		fail("new target-aware commissions require handoff version 2");
	const targetIds = new Set();
	const variantIds = new Set();
	if (handoff.version === DESIGN_HANDOFF_VERSION) {
		records(handoff.targets, "targets", "TARGET", (target, index) => {
			string(target.platform, `targets[${index}].platform`, 80);
			const viewports = stringList(
				target.requiredViewports,
				`targets[${index}].requiredViewports`,
				{ min: 1, max: 3 },
			);
			for (const viewport of viewports)
				if (!ALLOWED_VIEWPORTS.has(viewport)) fail(`invalid viewport ${viewport}`);
			stringList(target.evidence, `targets[${index}].evidence`, { min: 1 });
			stringList(target.requiredScreenIds, `targets[${index}].requiredScreenIds`, {
				min: 1,
			});
			stringList(target.requiredFlowIds, `targets[${index}].requiredFlowIds`, {
				min: 1,
			});
			targetIds.add(target.id);
		});
		records(handoff.variants, "variants", "VARIANT", (variant, index) => {
			const targetId = string(variant.targetId, `variants[${index}].targetId`, 80);
			if (!targetIds.has(targetId)) fail(`unknown variant target ${targetId}`);
			const viewport = string(variant.viewport, `variants[${index}].viewport`, 20);
			if (!ALLOWED_VIEWPORTS.has(viewport)) fail(`invalid viewport ${viewport}`);
			optionalString(variant.previewRoute, `variants[${index}].previewRoute`, 500);
			optionalString(
				variant.previewArtifact,
				`variants[${index}].previewArtifact`,
				500,
			);
			if (!variant.previewRoute && !variant.previewArtifact)
				fail(`variants[${index}] requires a preview route or artifact`);
			stringList(variant.screenIds, `variants[${index}].screenIds`, { min: 1 });
			stringList(variant.flowIds, `variants[${index}].flowIds`, { min: 1 });
			variantIds.add(variant.id);
		});
		for (const target of handoff.targets) {
			for (const viewport of target.requiredViewports) {
				const variant = handoff.variants.find(
					(item) => item.targetId === target.id && item.viewport === viewport,
				);
				if (!variant) fail(`missing ${target.id}/${viewport} variant`);
				for (const screenId of target.requiredScreenIds)
					if (!variant.screenIds.includes(screenId))
						fail(`${variant.id} omits required screen ${screenId}`);
				for (const flowId of target.requiredFlowIds)
					if (!variant.flowIds.includes(flowId))
						fail(`${variant.id} omits required flow ${flowId}`);
			}
		}
		if (options.targetMatrix?.length) {
			const expectedIds = new Set(options.targetMatrix.map((target) => target.id));
			for (const target of handoff.targets)
				if (!expectedIds.has(target.id))
					fail(`target ${target.id} is not present in the authoritative matrix`);
			for (const expected of options.targetMatrix) {
				const actual = handoff.targets.find((target) => target.id === expected.id);
				if (!actual) fail(`missing required target ${expected.id}`);
				for (const viewport of expected.requiredViewports ?? [])
					if (!actual.requiredViewports.includes(viewport))
						fail(`${expected.id} omits required viewport ${viewport}`);
			}
		}
	}
	let selection;
	if (handoff.selection != null || options.selection) {
		selection = object(handoff.selection, "selection");
		const manifestHash =
			selection.manifestHash ?? selection.candidateManifestHash;
		const candidateHash =
			selection.candidateHash ?? selection.candidateArtifactHash;
		for (const [field, value] of [
			["manifestHash", manifestHash],
			["candidateHash", candidateHash],
		]) {
			if (!/^[a-f0-9]{64}$/.test(string(value, `selection.${field}`, 64)))
				fail(`selection.${field} must be sha256`);
		}
		if (
			!selection.selectionHash ||
			!/^[a-f0-9]{64}$/.test(
				string(selection.selectionHash, "selection.selectionHash", 64),
			) ||
			(options.selection &&
				selection.selectionHash !== hashDesignValue(options.selection))
		)
			fail("selection.selectionHash does not match");
		id(selection.candidateId, "selection.candidateId", "CANDIDATE");
		if (
			options.selection &&
			!directionSelectionIsCurrent(options.selection, {
				ownerId: options.selection.ownerId,
				briefHash: options.selection.briefHash,
				candidateManifestHash: manifestHash,
				candidateId: selection.candidateId,
				candidateArtifactHash: candidateHash,
			})
		)
			fail("handoff selection lineage mismatch");
	}
	const identity = object(handoff.identity, "identity");
	id(identity.id, "identity.id", "DESIGN");
	string(identity.title, "identity.title", 200);
	if (
		!/^[a-f0-9]{64}$/.test(string(identity.briefHash, "identity.briefHash", 64))
	)
		fail("identity.briefHash must be sha256");
	if (options.briefHash && identity.briefHash !== options.briefHash)
		fail("brief hash mismatch");
	const direction = object(handoff.direction, "direction");
	string(direction.summary, "direction.summary");
	const colors = array(direction.roleColors, "direction.roleColors", {
		min: 4,
		max: 6,
	});
	for (const [index, color] of colors.entries()) {
		object(color, `direction.roleColors[${index}]`);
		string(color.name, `direction.roleColors[${index}].name`, 80);
		if (
			!/^#[0-9a-f]{6}$/i.test(
				string(color.value, `direction.roleColors[${index}].value`, 7),
			)
		)
			fail("role color must be #RRGGBB");
	}
	unique(
		colors.map((color) => color.name),
		"direction.roleColors.name",
	);
	string(direction.signatureElement, "direction.signatureElement");
	string(direction.intentionalRisk, "direction.intentionalRisk");
	object(handoff.content, "content");
	object(handoff.tokens, "tokens");
	if (handoff.elementsRef != null)
		optionalString(handoff.elementsRef, "elementsRef", 200);
	records(handoff.screens, "screens", "SCREEN", (screen, index) => {
		string(screen.title, `screens[${index}].title`, 200);
		if (handoff.version === DESIGN_HANDOFF_VERSION) {
			for (const targetId of stringList(
				screen.targetIds,
				`screens[${index}].targetIds`,
				{ min: 1 },
			))
				if (!targetIds.has(targetId)) fail(`unknown screen target ${targetId}`);
			for (const variantId of stringList(
				screen.variantIds,
				`screens[${index}].variantIds`,
				{ min: 1 },
			))
				if (!variantIds.has(variantId)) fail(`unknown screen variant ${variantId}`);
		}
		stringList(screen.states, `screens[${index}].states`, { min: 1, max: 32 });
		const viewports = stringList(
			screen.viewports,
			`screens[${index}].viewports`,
			{ min: 1, max: 3 },
		);
		for (const viewport of viewports)
			if (!ALLOWED_VIEWPORTS.has(viewport)) fail(`invalid viewport ${viewport}`);
		stringList(screen.requiredRegions, `screens[${index}].requiredRegions`, {
			min: 1,
			max: 32,
		});
		if (screen.layoutAssertions != null)
			stringList(screen.layoutAssertions, `screens[${index}].layoutAssertions`, {
				max: 32,
			});
	});
	records(handoff.flows, "flows", "FLOW", (flow, index) => {
		stringList(flow.steps, `flows[${index}].steps`, { min: 1, max: 32 });
		if (handoff.version === DESIGN_HANDOFF_VERSION) {
			for (const targetId of stringList(
				flow.targetIds,
				`flows[${index}].targetIds`,
				{ min: 1 },
			))
				if (!targetIds.has(targetId)) fail(`unknown flow target ${targetId}`);
			for (const variantId of stringList(
				flow.variantIds,
				`flows[${index}].variantIds`,
				{ min: 1 },
			))
				if (!variantIds.has(variantId)) fail(`unknown flow variant ${variantId}`);
		}
	});
	records(handoff.components, "components", "COMP", (component, index) => {
		string(component.name, `components[${index}].name`, 200);
		stringList(component.states, `components[${index}].states`, {
			min: 1,
			max: 32,
		});
	});
	stringList(handoff.responsiveRules, "responsiveRules", { min: 1 });
	records(handoff.interactions, "interactions", "INT", (interaction, index) => {
		string(interaction.trigger, `interactions[${index}].trigger`);
		string(interaction.outcome, `interactions[${index}].outcome`);
	});
	stringList(handoff.accessibility, "accessibility", { min: 1 });
	for (const [index, asset] of array(handoff.assets, "assets", {
		max: 64,
	}).entries()) {
		object(asset, `assets[${index}]`);
		validateDesignArtifactRelativePath(asset.path, { allowImages: true });
		string(asset.license, `assets[${index}].license`, 200);
		string(asset.provenance, `assets[${index}].provenance`, 500);
	}
	stringList(handoff.implementationConstraints, "implementationConstraints", {
		min: 1,
	});
	records(handoff.acceptance, "acceptance", "DES", (criterion, index) => {
		string(criterion.description, `acceptance[${index}].description`);
		stringList(criterion.screenIds, `acceptance[${index}].screenIds`, { min: 1 });
		if (handoff.version === DESIGN_HANDOFF_VERSION) {
			for (const targetId of stringList(
				criterion.targetIds,
				`acceptance[${index}].targetIds`,
				{ min: 1 },
			))
				if (!targetIds.has(targetId)) fail(`unknown acceptance target ${targetId}`);
			for (const variantId of stringList(
				criterion.variantIds,
				`acceptance[${index}].variantIds`,
				{ min: 1 },
			))
				if (!variantIds.has(variantId))
					fail(`unknown acceptance variant ${variantId}`);
		}
		stringList(criterion.states, `acceptance[${index}].states`, { min: 1 });
		const viewports = stringList(
			criterion.viewports,
			`acceptance[${index}].viewports`,
			{ min: 1, max: 3 },
		);
		const proofs = stringList(criterion.proofs, `acceptance[${index}].proofs`, {
			min: 1,
			max: 5,
		});
		for (const viewport of viewports)
			if (!ALLOWED_VIEWPORTS.has(viewport)) fail(`invalid viewport ${viewport}`);
		for (const proof of proofs)
			if (!ALLOWED_PROOFS.has(proof)) fail(`invalid proof ${proof}`);
	});
	if (array(handoff.openQuestions, "openQuestions").length)
		fail("openQuestions must be empty");
	const provenance = object(handoff.provenance, "provenance");
	string(provenance.source, "provenance.source", 500);
	string(provenance.generatedAt, "provenance.generatedAt", 100);
	if (provenance.remoteFingerprint != null)
		string(provenance.remoteFingerprint, "provenance.remoteFingerprint", 128);
	return canonicalizeDesignValue({
		version: handoff.version,
		...(handoff.elementsRef ? { elementsRef: handoff.elementsRef } : {}),
		...(handoff.version === DESIGN_HANDOFF_VERSION
			? { targets: handoff.targets, variants: handoff.variants }
			: {}),
		...(selection ? { selection } : {}),
		identity,
		direction,
		content: handoff.content,
		tokens: handoff.tokens,
		screens: handoff.screens,
		flows: handoff.flows,
		components: handoff.components,
		responsiveRules: handoff.responsiveRules,
		interactions: handoff.interactions,
		accessibility: handoff.accessibility,
		assets: handoff.assets,
		implementationConstraints: handoff.implementationConstraints,
		acceptance: handoff.acceptance,
		openQuestions: [],
		provenance,
	});
}

export function normalizeRemoteFingerprint(files) {
	const normalized = array(files, "remote files", { max: 64 }).map(
		(file, index) => {
			object(file, `remote files[${index}]`);
			const name = validateDesignArtifactRelativePath(file.path ?? file.name, {
				allowHtml: true,
			});
			const size = Number(file.size ?? 0);
			if (!Number.isSafeInteger(size) || size < 0)
				fail(`remote files[${index}].size must be a non-negative integer`);
			return {
				name,
				size,
				modifiedAt: optionalString(
					file.mtime == null && file.modifiedAt == null
						? undefined
						: String(file.mtime ?? file.modifiedAt),
					`remote files[${index}].modifiedAt`,
					100,
				),
				mime: optionalString(file.mime, `remote files[${index}].mime`, 100),
				kind: optionalString(file.kind, `remote files[${index}].kind`, 100),
			};
		},
	);
	normalized.sort((a, b) => a.name.localeCompare(b.name));
	return hashDesignValue(normalized);
}

export function validateDesignArtifactRelativePath(relativePath, options: any = {}) {
	const value = string(relativePath, "artifact path", 300).replaceAll("\\", "/");
	if (
		value.startsWith("/") ||
		/^[A-Za-z]:/.test(value) ||
		value.split("/").includes("..")
	)
		fail("artifact path escapes design directory");
	const parts = value.split("/");
	if (
		parts.some(
			(part) => !part || RESERVED_NAMES.has(part.split(".")[0].toLowerCase()),
		)
	)
		fail("artifact path contains a reserved name");
	const extension = path.extname(value).toLowerCase();
	const allowed = new Set([
		...ALLOWED_TEXT_EXTENSIONS,
		...(options.allowImages ? ALLOWED_IMAGE_EXTENSIONS : []),
		...(options.allowHtml ? [".html"] : []),
	]);
	if (!allowed.has(extension))
		fail(`artifact type ${extension || "none"} is not allowed`);
	return value;
}

export function resolveDesignArtifactPath(root, relativePath, options: any = {}) {
	const relative = validateDesignArtifactRelativePath(relativePath, options);
	const base = path.resolve(root);
	const target = path.resolve(base, relative);
	if (target !== base && !target.startsWith(`${base}${path.sep}`))
		fail("artifact path escapes design directory");
	let current = base;
	for (const part of path.relative(base, target).split(path.sep)) {
		current = path.join(current, part);
		if (!fs.existsSync(current)) break;
		const stats = fs.lstatSync(current);
		if (stats.isSymbolicLink()) fail("artifact path cannot traverse a symlink");
		if (current === target && !stats.isFile())
			fail("artifact must be a regular file");
	}
	return target;
}

export function writeConfinedDesignArtifact(
	root,
	relativePath,
	content,
	options = {},
) {
	const target = resolveDesignArtifactPath(root, relativePath, options);
	const bytes = Buffer.isBuffer(content)
		? content
		: Buffer.from(String(content), "utf8");
	const maxBytes = options.maxBytes ?? 512_000;
	if (bytes.length > maxBytes) fail("artifact is too large");
	fs.mkdirSync(path.dirname(target), { recursive: true });
	resolveDesignArtifactPath(root, relativePath, options);
	const temp = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
	try {
		fs.writeFileSync(temp, bytes, { mode: 0o600, flag: "wx" });
		fs.renameSync(temp, target);
	} finally {
		if (fs.existsSync(temp)) fs.unlinkSync(temp);
	}
	return target;
}

function designImageMime(bytes, extension) {
	if (
		bytes
			.subarray(0, 8)
			.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
		extension === ".png"
	)
		return "image/png";
	if (
		bytes[0] === 0xff &&
		bytes[1] === 0xd8 &&
		bytes[2] === 0xff &&
		[".jpg", ".jpeg"].includes(extension)
	)
		return "image/jpeg";
	if (
		bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
		bytes.subarray(8, 12).toString("ascii") === "WEBP" &&
		extension === ".webp"
	)
		return "image/webp";
	fail("image bytes do not match the approved extension");
}

export function inspectUserDesignReference(
	sourcePath,
	maxBytes = REFERENCE_IMAGE_MAX_BYTES,
) {
	const source = path.resolve(string(sourcePath, "asset.sourcePath", 2_000));
	const stats = fs.lstatSync(source);
	if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maxBytes)
		fail("user reference must be a bounded regular file");
	const extension = path.extname(source).toLowerCase();
	if (!ALLOWED_IMAGE_EXTENSIONS.has(extension))
		fail("only approved image types can be copied");
	const content = fs.readFileSync(source);
	return {
		source,
		content,
		extension,
		mime: designImageMime(content, extension),
		sha256: crypto.createHash("sha256").update(content).digest("hex"),
	};
}



function openDesignExecutionBoundary() {
	return [
		"Execution boundary:",
		"- Work only inside the OpenDesign project workspace and Preview.",
		"- Do not inspect, edit, create, delete, execute commands in, or run Git against any local source repository or external filesystem path.",
		"- Treat implementation source as read-only context. Describe production changes in DESIGN-HANDOFF.md; do not apply them.",
		"- Commands needed to build the Preview are allowed only inside the OpenDesign project workspace.",
	];
}

function designHandoffContractPrompt({
	briefHash,
	targetMatrix = [],
	selection,
} = {}) {
	const selectionContract = selection
		? {
				manifestHash: selection.candidateManifestHash,
				candidateId: selection.candidateId,
				candidateHash: selection.candidateArtifactHash,
				selectionHash: hashDesignValue(selection),
			}
		: undefined;
	return [
		"DESIGN-HANDOFF.json must use the ce-workflow v2 contract below; do not substitute another schema.",
		briefHash ? `Authoritative briefHash: ${briefHash}` : "",
		targetMatrix.length
			? `Authoritative targets: ${canonicalDesignJson(targetMatrix)}`
			: "",
		selectionContract
			? `Authoritative selection: ${canonicalDesignJson(selectionContract)}`
			: "",
		"Required top-level keys: version, targets, variants, identity, direction, content, tokens, screens, flows, components, responsiveRules, interactions, accessibility, assets, implementationConstraints, acceptance, openQuestions, provenance; include selection when supplied above.",
		'Use version: 2. targets is 1+ {id:"TARGET-*",platform,requiredViewports:[desktop|tablet|mobile],evidence:[string],requiredScreenIds:["SCREEN-*"],requiredFlowIds:["FLOW-*"]}.',
		'variants is 1+ {id:"VARIANT-*",targetId,viewport,previewRoute or previewArtifact,screenIds:["SCREEN-*"],flowIds:["FLOW-*"]}; cover every required target/viewport.',
		'identity is {id:"DESIGN-*",title,briefHash}. direction is {summary,roleColors:[4-6 {name,value:"#RRGGBB"}],signatureElement,intentionalRisk}. content and tokens are objects.',
		'screens is 1+ {id:"SCREEN-*",title,targetIds,variantIds,states,viewports,requiredRegions,layoutAssertions?}; layoutAssertions is an optional string array of spatial facts like "display above keypad" verified per viewport. flows is 1+ {id:"FLOW-*",steps,targetIds,variantIds}; components is 1+ {id:"COMP-*",name,states}.',
		'Optional top-level elementsRef may point at the hash-bound design/elements.json sidecar (list it in assets with path "design/elements.json"); geometry gates bind to that hash.',
		'interactions is 1+ {id:"INT-*",trigger,outcome}. responsiveRules, accessibility, and implementationConstraints are non-empty string arrays. assets is an array of {path,license,provenance}; asset paths may end only in .md, .json, .png, .jpg, .jpeg, or .webp. Never list .html in assets: an HTML Preview belongs only in variants[].previewArtifact.',
		'acceptance is 1+ {id:"DES-*",description,screenIds,targetIds,variantIds,states,viewports,proofs:[interaction|visual|accessibility|logs|manual]}. openQuestions must be []. provenance is {source,generatedAt}; omit remoteFingerprint (if present it must be at most 128 UTF-8 bytes).',
	].filter(Boolean);
}

export function renderOpenDesignGenerationPrompt(
	brief,
	briefHash,
	{ projectType = "product", targetMatrix = [], references = [] } = {},
) {
	const content = string(brief, "brief");
	const hash =
		briefHash ?? crypto.createHash("sha256").update(content).digest("hex");
	return [
		content,
		`Artifact form: ${string(projectType, "projectType", 80)}. Respect this framing; do not default to website/dashboard/app chrome.`,
		targetMatrix.length
			? `Required target matrix (exact coverage):\n${JSON.stringify(targetMatrix)}`
			: "",
		references.length
			? `Project-local inspiration references (analyze these files; never copy exact trade dress):\n${references.map((reference) => `- ${reference.remotePath}: borrow ${reference.borrow}; avoid ${reference.avoid}`).join("\n")}`
			: "",
		...openDesignExecutionBoundary(),
		...designHandoffContractPrompt({ briefHash: hash, targetMatrix }),
		"Delivery contract:",
		"- Create a complete, runnable, visually intentional interface in OpenDesign Preview. Do not reproduce the current/default interface with only cosmetic changes.",
		`- Return root DESIGN-HANDOFF.json v${DESIGN_HANDOFF_VERSION} and DESIGN-HANDOFF.md alongside the Preview. Include targets[] and separately addressable variants[] covering every required target/viewport; mobile is a real interaction/layout variant, not a shrunken desktop canvas.`,
		"- DESIGN-HANDOFF.md must include an Implementation description with screen-by-screen deltas, component/token changes, responsive behavior, interactions, accessibility, and a production source-change plan. Describe only; do not edit production source.",
		`- Set identity.briefHash to ${string(hash, "briefHash", 64)}.`,
	]
		.filter(Boolean)
		.join("\n");
}





export function renderDesignRepairPrompt(errors = [], contract: any = {}) {
	const list = array(errors, "repair errors", { min: 1, max: 20 })
		.map((entry) => string(String(entry), "repair error", 500))
		.sort();
	return [
		"Repair the design handoff only; preserve the approved visual direction.",
		...openDesignExecutionBoundary(),
		...designHandoffContractPrompt(contract),
		`Return root DESIGN-HANDOFF.json v${DESIGN_HANDOFF_VERSION} and DESIGN-HANDOFF.md.`,
		"Do not generate executable code or binary assets.",
		"Validation errors:",
		...list.map((entry) => `- ${entry}`),
	].join("\n");
}











export function renderDesignRevisionPrompt(
	feedback,
	acceptedFacts = [],
	constraints = [],
	contract = {},
) {
	return [
		"Revise the current design without changing settled product behavior.",
		...openDesignExecutionBoundary(),
		...designHandoffContractPrompt(contract),
		"Update the Preview plus root DESIGN-HANDOFF.json and DESIGN-HANDOFF.md; do not modify production source.",
		`Feedback: ${string(feedback, "feedback", 4_000)}`,
		`Preserve: ${stringList(acceptedFacts, "acceptedFacts", { max: 64 }).join("; ") || "the accepted direction"}`,
		`Constraints: ${stringList(constraints, "constraints", { max: 64 }).join("; ") || "none beyond the brief"}`,
	].join("\n");
}
