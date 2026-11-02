import { parseAgentJsonPointer, readAgentJsonPointer } from "../Core/AgentJsonPointerOperations.js";

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
  root: AgentJsonSchema,
  parents: readonly AgentJsonSchema[],
  pointer: string,
): readonly AgentJsonSchema[] {
  const tokens = parseAgentJsonPointer(pointer);
  return [...new Set(parents.flatMap((parent) => resolve(root, parent, tokens, new Set())))];
}

/**
 * A measure field is read from each selected collection entry. Expand arrays
 * here so callers validate the same shape the runtime aggregation reads.
 */
export function resolveAgentJsonSchemaCollectionField(
  root: AgentJsonSchema,
  parents: readonly AgentJsonSchema[],
  field: string,
): readonly AgentJsonSchema[] {
  return [
    ...new Set(
      parents.flatMap((parent) =>
        resolve(root, parent, [], new Set()).flatMap((branch) =>
          collectionEntries(branch).flatMap((entry) => resolve(root, entry, [field], new Set())),
        ),
      ),
    ),
  ];
}

export function isAgentJsonSchemaScalar(schema: AgentJsonSchema): boolean {
  const types = schema.type;
  if (typeof types === "string") return ["string", "number", "integer", "boolean", "null"].includes(types);
  if (Array.isArray(types)) {
    return types.length > 0 && types.every((type) => typeof type === "string" && type !== "object" && type !== "array");
  }
  if ("const" in schema) return isJsonScalar(schema.const);
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
  const branches = [
    schema,
    ...(referenced ? resolve(root, referenced, [], nextAncestry) : []),
    ...schemaBranches(root, schema, nextAncestry),
  ];
  return [
    ...new Set(branches.flatMap((branch) => (tokens.length === 0 ? [branch] : resolveLocal(root, branch, tokens)))),
  ];
}

function resolveLocal(
  root: AgentJsonSchema,
  schema: AgentJsonSchema,
  [token, ...remaining]: readonly string[],
): AgentJsonSchema[] {
  if (token === undefined) return [schema];
  // Consuming a pointer segment makes progress even for recursive schemas.
  // Cycle detection only applies to references/unions at the same position.
  if (token === "*") {
    return wildcardChildren(schema).flatMap((child) => resolve(root, child, remaining, new Set()));
  }
  const properties = objectProperties(schema, token);
  const tupleItem = arrayItem(schema, token);
  return [...properties, ...(tupleItem ? [tupleItem] : [])].flatMap((child) =>
    resolve(root, child, remaining, new Set()),
  );
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
  const patterns = isSchemaRecord(schema.patternProperties)
    ? Object.values(schema.patternProperties).filter(isSchema)
    : [];
  const items = arrayItems(schema);
  const additional = isSchema(schema.additionalProperties) ? [schema.additionalProperties] : [];
  return [...properties, ...patterns, ...items, ...additional];
}

function collectionEntries(schema: AgentJsonSchema): readonly AgentJsonSchema[] {
  const items = arrayItems(schema);
  return items.length > 0 ? items : [schema];
}

function objectProperties(schema: AgentJsonSchema, token: string): readonly AgentJsonSchema[] {
  const properties = isSchemaRecord(schema.properties) ? schema.properties : undefined;
  const declared = properties && Object.hasOwn(properties, token) ? [properties[token]] : [];
  const patterns = isSchemaRecord(schema.patternProperties)
    ? Object.entries(schema.patternProperties)
        .filter(([pattern]) => new RegExp(pattern, "u").test(token))
        .map(([, child]) => child)
    : [];
  const matching = [...declared, ...patterns];
  return matching.length > 0
    ? matching.filter(isSchema)
    : isSchema(schema.additionalProperties)
      ? [schema.additionalProperties]
      : [];
}

function arrayItem(schema: AgentJsonSchema, token: string): AgentJsonSchema | undefined {
  if (!/^(?:0|[1-9]\d*)$/u.test(token)) return undefined;
  const index = Number(token);
  if (!Number.isSafeInteger(index)) return undefined;
  const prefix = tupleItems(schema);
  const item =
    prefix && index < prefix.length
      ? prefix[index]
      : Array.isArray(schema.items)
        ? schema.additionalItems
        : schema.items;
  return isSchema(item) ? item : undefined;
}

function arrayItems(schema: AgentJsonSchema): readonly AgentJsonSchema[] {
  const prefix = tupleItems(schema) ?? [];
  const tail = Array.isArray(schema.items) ? schema.additionalItems : schema.items;
  return [...prefix.filter(isSchema), ...(isSchema(tail) ? [tail] : [])];
}

function tupleItems(schema: AgentJsonSchema): readonly unknown[] | undefined {
  if (Array.isArray(schema.prefixItems)) return schema.prefixItems;
  return Array.isArray(schema.items) ? schema.items : undefined;
}

function resolveReference(root: AgentJsonSchema, schema: AgentJsonSchema): AgentJsonSchema | undefined {
  const reference = schema.$ref;
  if (typeof reference !== "string" || (reference !== "#" && !reference.startsWith("#/"))) return undefined;
  const target = readAgentJsonPointer(root, decodeURIComponent(reference.slice(1)));
  return target.found && isSchema(target.value) ? target.value : undefined;
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
