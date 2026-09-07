type JsonSchema = Record<string, unknown>;

const ObjectUnionKeywords = ["oneOf", "anyOf"] as const;

/**
 * Normalizes object unions for tool-call providers that require a root object
 * type in function parameters. The union branches remain unchanged so their
 * action-specific validation semantics are preserved.
 */
export function ensureObjectRootJsonSchema(
  schema: Readonly<Record<string, unknown>>,
  subject = "Tool input",
): JsonSchema {
  if (schema.type === "object") return schema as JsonSchema;

  if (schema.type !== undefined) {
    throw new Error(`${subject} schema must have a root type of "object".`);
  }

  const union = findObjectUnion(schema);
  if (union) return { ...schema, type: "object" };

  throw new Error(`${subject} schema must describe a JSON object at the root.`);
}

export function isObjectJsonSchema(schema: Readonly<Record<string, unknown>>): boolean {
  if (schema.type === "object") return true;
  return findObjectUnion(schema) !== undefined;
}

function findObjectUnion(schema: Readonly<Record<string, unknown>>): readonly JsonSchema[] | undefined {
  for (const keyword of ObjectUnionKeywords) {
    const branches = schema[keyword];
    if (!Array.isArray(branches) || branches.length === 0) continue;
    const objects = branches.flatMap((branch) => {
      if (!isRecord(branch) || !isObjectJsonSchema(branch)) return [];
      return [branch];
    });
    if (objects.length === branches.length) return objects;
  }
  return undefined;
}

function isRecord(value: unknown): value is JsonSchema {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
