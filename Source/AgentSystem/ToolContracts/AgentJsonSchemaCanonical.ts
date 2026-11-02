import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import { isAgentUnknownRecord } from "../Core/AgentUnknownValue.js";

const SchemaMaps = ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas", "dependencies"];
const SchemaArrays = ["allOf", "anyOf", "oneOf", "prefixItems"];
const ChildSchemas = [
  "additionalProperties",
  "additionalItems",
  "contains",
  "not",
  "if",
  "then",
  "else",
  "propertyNames",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contentSchema",
  "items",
];

/** Compare schemas without treating equivalent bare type unions as API changes. */
export function canonicalizeAgentJsonSchema(value: unknown): string {
  return stringifyAgentCanonicalJson(normalizeTypeUnions(value));
}

function normalizeTypeUnions(value: unknown): unknown {
  if (!isAgentUnknownRecord(value)) return value;
  // Defaults, const, enum and extension annotations contain values rather than
  // schemas. Visit only JSON Schema child locations so their data is immutable.
  const normalized = { ...value };
  for (const key of SchemaMaps) {
    const children = normalized[key];
    if (isAgentUnknownRecord(children)) {
      normalized[key] = Object.fromEntries(
        Object.entries(children).map(([name, schema]) => [name, normalizeTypeUnions(schema)]),
      );
    }
  }
  for (const key of SchemaArrays) {
    if (Array.isArray(normalized[key])) normalized[key] = normalized[key].map(normalizeTypeUnions);
  }
  for (const key of ChildSchemas) {
    const child = normalized[key];
    if (Array.isArray(child)) normalized[key] = child.map(normalizeTypeUnions);
    else if (isAgentUnknownRecord(child)) normalized[key] = normalizeTypeUnions(child);
  }
  if (Array.isArray(normalized.type)) {
    const types = [...new Set(normalized.type)].sort();
    normalized.type = types.length === 1 ? types[0] : types;
  }
  const variants = normalized.anyOf;
  if (!Object.hasOwn(normalized, "type") && isBareTypeUnion(variants)) {
    const { anyOf: _anyOf, ...rest } = normalized;
    const types = [...new Set(variants.map((entry) => entry.type))].sort();
    return { ...rest, type: types.length === 1 ? types[0] : types };
  }
  return normalized;
}

function isBareTypeUnion(value: unknown): value is readonly { type: string }[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) => isAgentUnknownRecord(entry) && Object.keys(entry).length === 1 && typeof entry.type === "string",
    )
  );
}
