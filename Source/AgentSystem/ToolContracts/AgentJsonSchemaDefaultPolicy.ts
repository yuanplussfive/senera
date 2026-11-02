import { parseAgentJsonPointer } from "../Core/AgentJsonPointerOperations.js";

type JsonSchema = Readonly<Record<string, unknown>>;

export interface AgentJsonSchemaDefaultPolicyIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/**
 * AJV deliberately does not mutate data from defaults below `oneOf` or
 * `anyOf`: there is no unambiguous branch at the point defaults are applied.
 * Package contracts must express branch-specific defaults through a
 * conditional `allOf` instead, where a discriminator determines the branch.
 */
export function inspectAgentJsonSchemaDefaultPolicy(schema: JsonSchema): readonly AgentJsonSchemaDefaultPolicyIssue[] {
  const issues: AgentJsonSchemaDefaultPolicyIssue[] = [];
  visitSchema(schema, schema, [], false, new Set(), issues);
  return issues;
}

function visitSchema(
  root: JsonSchema,
  value: unknown,
  path: readonly (string | number)[],
  isAlternativeBranch: boolean,
  ancestry: ReadonlySet<JsonSchema>,
  issues: AgentJsonSchemaDefaultPolicyIssue[],
): void {
  if (!isJsonSchema(value)) return;
  if (ancestry.has(value)) return;
  const nextAncestry = new Set(ancestry).add(value);
  if (isAlternativeBranch && Object.hasOwn(value, "default")) {
    issues.push({
      path: [...path, "default"],
      message:
        "JSON Schema defaults cannot be declared inside oneOf or anyOf branches. Express branch-specific defaults with allOf and if/then.",
    });
  }

  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    const branches = value[keyword];
    if (!Array.isArray(branches)) continue;
    const branchIsAlternative = isAlternativeBranch || keyword === "anyOf" || keyword === "oneOf";
    branches.forEach((branch, index) =>
      visitSchema(root, branch, [...path, keyword, index], branchIsAlternative, nextAncestry, issues),
    );
  }

  for (const keyword of [
    "if",
    "then",
    "else",
    "not",
    "contains",
    "propertyNames",
    "additionalItems",
    "additionalProperties",
    "unevaluatedItems",
    "unevaluatedProperties",
    "contentSchema",
  ] as const) {
    visitSchema(root, value[keyword], [...path, keyword], isAlternativeBranch, nextAncestry, issues);
  }

  visitSchemaMap(root, value.properties, [...path, "properties"], isAlternativeBranch, nextAncestry, issues);
  visitSchemaMap(
    root,
    value.patternProperties,
    [...path, "patternProperties"],
    isAlternativeBranch,
    nextAncestry,
    issues,
  );
  visitSchemaMap(
    root,
    value.dependentSchemas,
    [...path, "dependentSchemas"],
    isAlternativeBranch,
    nextAncestry,
    issues,
  );
  visitSchemaMap(root, value.definitions, [...path, "definitions"], isAlternativeBranch, nextAncestry, issues);
  visitSchemaMap(root, value.$defs, [...path, "$defs"], isAlternativeBranch, nextAncestry, issues);

  const dependencies = value.dependencies;
  if (isJsonSchemaMap(dependencies)) {
    visitSchemaMap(root, dependencies, [...path, "dependencies"], isAlternativeBranch, nextAncestry, issues);
  }

  const items = value.items;
  if (Array.isArray(items)) {
    items.forEach((item, index) =>
      visitSchema(root, item, [...path, "items", index], isAlternativeBranch, nextAncestry, issues),
    );
  } else {
    visitSchema(root, items, [...path, "items"], isAlternativeBranch, nextAncestry, issues);
  }

  const prefixItems = value.prefixItems;
  if (Array.isArray(prefixItems)) {
    prefixItems.forEach((item, index) =>
      visitSchema(root, item, [...path, "prefixItems", index], isAlternativeBranch, nextAncestry, issues),
    );
  }

  const reference = resolveLocalReference(root, value.$ref);
  if (reference) {
    visitSchema(root, reference.value, reference.path, isAlternativeBranch, nextAncestry, issues);
  }
}

function visitSchemaMap(
  root: JsonSchema,
  value: unknown,
  path: readonly (string | number)[],
  isAlternativeBranch: boolean,
  ancestry: ReadonlySet<JsonSchema>,
  issues: AgentJsonSchemaDefaultPolicyIssue[],
): void {
  if (!isJsonSchemaMap(value)) return;
  for (const [key, schema] of Object.entries(value)) {
    visitSchema(root, schema, [...path, key], isAlternativeBranch, ancestry, issues);
  }
}

function resolveLocalReference(
  root: JsonSchema,
  reference: unknown,
): { readonly value: JsonSchema; readonly path: readonly (string | number)[] } | undefined {
  if (typeof reference !== "string") return undefined;
  if (reference === "#") return { value: root, path: [] };
  if (!reference.startsWith("#/")) return undefined;

  let current: unknown = root;
  const path: Array<string | number> = [];
  for (const token of parseAgentJsonPointer(reference.slice(1))) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(token)) return undefined;
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length) return undefined;
      current = current[index];
      path.push(index);
      continue;
    }
    if (!isJsonSchemaMap(current) || !Object.hasOwn(current, token)) return undefined;
    current = current[token];
    path.push(token);
  }
  return isJsonSchema(current) ? { value: current, path } : undefined;
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonSchemaMap(value: unknown): value is Readonly<Record<string, unknown>> {
  return isJsonSchema(value);
}
