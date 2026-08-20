export function stringifyAgentCanonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => (entry === undefined ? "null" : stringifyAgentCanonicalJson(entry))).join(",")}]`;
  }

  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number": {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) throw new TypeError("Canonical JSON cannot encode a non-finite number.");
      return serialized;
    }
    case "object":
      return `{${Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([key, entry]) => `${JSON.stringify(key)}:${stringifyAgentCanonicalJson(entry)}`)
        .join(",")}}`;
    default:
      throw new TypeError(`Canonical JSON cannot encode ${typeof value}.`);
  }
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
