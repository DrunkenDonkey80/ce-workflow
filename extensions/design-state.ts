// Shared by the host, preview and injected classic script; keep this function self-contained.
export type DesignJson = null | boolean | number | string | DesignJson[] | { [key: string]: DesignJson };
export function designStateJson(value: unknown): string {
	let entries = 0;
	function walk(value: unknown, depth: number): DesignJson {
		if (depth > 8) throw new Error("Design state exceeds 8 levels.");
		if (value === null) return null;
		if (typeof value === "string" || typeof value === "boolean") return value;
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (!value || typeof value !== "object") throw new Error("Design state must contain only finite JSON values.");
		const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
		if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error("Design state must contain only plain objects and arrays.");
		const keys = Reflect.ownKeys(value).filter(key => !(array && key === "length"));
		entries += keys.length;
		if (entries > 256) throw new Error("Design state exceeds 256 entries.");
		if (array && keys.length !== value.length) throw new Error("Design state arrays must not contain holes or extra properties.");
		const result: { [key: string]: DesignJson } = Object.create(null);
		for (const key of keys.sort()) {
			if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Invalid design state key.");
			const property = Object.getOwnPropertyDescriptor(value, key);
			if (!property?.enumerable || !("value" in property)) throw new Error("Design state cannot contain accessors or hidden properties.");
			result[key] = walk(property.value, depth + 1);
		}
		if (!array) return result;
		return Array.from({ length: value.length }, (_, index) => {
			if (!(String(index) in result)) throw new Error("Invalid design state array entry.");
			return result[index];
		});
	}
	const json = JSON.stringify(walk(value, 0));
	if (new TextEncoder().encode(json).length > 16384) throw new Error("Design state exceeds 16 KiB.");
	return json;
}
