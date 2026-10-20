import { parseAgentJsonPointer } from "../Core/AgentJsonPointerOperations.js";

export type AgentJsonSchema = Readonly<Record<string, unknown>>;

/**
 * Resolves the JSON-schema branches a pointer can address. This is schema
 * inspection rather than value lookup: unions stay expanded so a declaration
 * is accepted when at least one legitimate runtime branch provides the slot.
 */
export function resolveAgentJsonSchemaPointer(root: AgentJsonSchema, pointer: string): readonly AgentJsonSchema[] {
  const tokens = parseAgentJsonPointer(pointer);
  return resolve(root, root, tokens, new Set());
}

/** Resolves a relative pointer for every schema matched by a parent pointer. */
export function resolveAgentJsonSchemaRelativePointer(
  parents: readonly AgentJsonSchema[],
  pointer: string,
): readonly AgentJsonSchema[] {
  const tokens = parseAgentJsonPointer(pointer);
  return parents.flatMap((parent) => resolve(parent, parent, tokens, new Set()));
}

/**
 * A measure field is read from each selected collection entry. Expand arrays
 * here so callers validate the same shape the runtime aggregation reads.
 */
export function resolveAgentJsonSchemaCollectionField(
  parents: readonly AgentJsonSchema[],
  field: string,
): readonly AgentJsonSchema[] {
  return parents.flatMap((parent) =>
    collectionEntries(parent).flatMap((entry) => resolve(entry, entry, [field], new Set())),
  );
}

export function isAgentJsonSchemaScalar(schema: AgentJsonSchema): boolean {
  const types = schema.type;
  if (typeof types === "string") return ["string", "number", "integer", "boolean", "null"].includes(types);
  if (Array.isArray(types)) {
    return types.length > 0 && types.every((type) => typeof type === "string" && type !== "object" && type !== "array");
  }
  if ("const" in schema) return true;
  return Array.isArray(schema.enum) && schema.enum.every(isJsonScalar);
}

export function isAgentJsonSchemaNumber(schema: AgentJsonSchema): boolean {
  const types = schema.type;
  if (types === "number" || types === "integer") return true;
  return Array.isArray(types) && types.length > 0 && types.every((type) => type === "number" || type === "integer");
}

function resolve(
  root: AgentJsonSchema,
  schema: AgentJsonSchema,
  tokens: readonly string[],
  ancestry: ReadonlySet<AgentJsonSchema>,
): AgentJsonSchema[] {
  if (ancestry.has(schema)) return [];
  const nextAncestry = new Set(ancestry).add(schema);
  const referenced = resolveReference(root, schema);
  const candidates = referenced ? [referenced] : [schema];
  return candidates.flatMap((candidate) => {
    const branches = [candidate, ...schemaBranches(root, candidate, nextAncestry)];
    return branches.flatMap((branch) => {
      if (tokens.length === 0) return [branch];
      return resolveLocal(root, branch, tokens, nextAncestry);
    });
  });
}

function resolveLocal(
  root: AgentJsonSchema,
  schema: AgentJsonSchema,
  [token, ...remaining]: readonly string[],
  ancestry: ReadonlySet<AgentJsonSchema>,
): AgentJsonSchema[] {
  if (token === undefined) return [schema];
  if (token === "*") {
    return wildcardChildren(schema).flatMap((child) => resolve(root, child, remaining, ancestry));
  }
  const property = objectProperty(schema, token);
  if (property) return resolve(root, property, remaining, ancestry);
  const tupleItem = arrayItem(schema, token);
  return tupleItem ? resolve(root, tupleItem, remaining, ancestry) : [];
}

function schemaBranches(
  root: AgentJsonSchema,
  schema: AgentJsonSchema,
  ancestry: ReadonlySet<AgentJsonSchema>,
): AgentJsonSchema[] {
  return ["allOf", "anyOf", "oneOf"].flatMap((key) => {
    const values = schema[key];
    return Array.isArray(values)
      ? values.flatMap((value) => (isSchema(value) ? resolve(root, value, [], ancestry) : []))
      : [];
  });
}

function wildcardChildren(schema: AgentJsonSchema): readonly AgentJsonSchema[] {
  const properties = isSchemaRecord(schema.properties) ? Object.values(schema.properties).filter(isSchema) : [];
  const items = arrayItems(schema);
  const additional = isSchema(schema.additionalProperties) ? [schema.additionalProperties] : [];
  return [...properties, ...items, ...additional];
}

function collectionEntries(schema: AgentJsonSchema): readonly AgentJsonSchema[] {
  const referenced = schema;
  const items = arrayItems(referenced);
  return items.length > 0 ? items : [referenced];
}

function objectProperty(schema: AgentJsonSchema, token: string): AgentJsonSchema | undefined {
  const properties = isSchemaRecord(schema.properties) ? schema.properties : undefined;
  if (properties && isSchema(properties[token])) return properties[token];
  return isSchema(schema.additionalProperties) ? schema.additionalProperties : undefined;
}

function arrayItem(schema: AgentJsonSchema, token: string): AgentJsonSchema | undefined {
  if (!/^(?:0|[1-9]\d*)$/u.test(token)) return undefined;
  const index = Number(token);
  if (!Number.isSafeInteger(index)) return undefined;
  const items = schema.items;
  if (Array.isArray(items)) return isSchema(items[index]) ? items[index] : undefined;
  return isSchema(items) ? items : undefined;
}

function arrayItems(schema: AgentJsonSchema): readonly AgentJsonSchema[] {
  const items = schema.items;
  if (Array.isArray(items)) return items.filter(isSchema);
  return isSchema(items) ? [items] : [];
}

function resolveReference(root: AgentJsonSchema, schema: AgentJsonSchema): AgentJsonSchema | undefined {
  const reference = schema.$ref;
  if (typeof reference !== "string" || !reference.startsWith("#/")) return undefined;
  return parseAgentJsonPointer(reference.slice(1)).reduce<AgentJsonSchema | undefined>((current, token) => {
    if (!current || !isSchemaRecord(current)) return undefined;
    const child = current[token];
    return isSchema(child) ? child : undefined;
  }, root);
}

function isSchemaRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSchema(value: unknown): value is AgentJsonSchema {
  return isSchemaRecord(value);
}

function isJsonScalar(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}
