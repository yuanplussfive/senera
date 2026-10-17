import { z } from "zod";
import { AgentSystemConfigSchema } from "../Schemas/AgentSystemConfigSchema.js";

interface JsonSchemaNode {
  readonly type?: string | readonly string[];
  readonly enum?: readonly (string | number | boolean)[];
  readonly anyOf?: readonly JsonSchemaNode[];
  readonly oneOf?: readonly JsonSchemaNode[];
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchemaNode;
  readonly additionalProperties?: boolean | JsonSchemaNode;
}

export interface AgentConfigFieldContract {
  readonly required: boolean;
  readonly options?: readonly (string | number | boolean)[];
}

const AgentSystemConfigJsonSchema = z.toJSONSchema(AgentSystemConfigSchema, {
  cycles: "throw",
  reused: "inline",
  unrepresentable: "throw",
}) as JsonSchemaNode;

export function readAgentConfigFieldContract(path: readonly string[]): AgentConfigFieldContract {
  if (path.length === 0) {
    throw new TypeError("Agent config form field path must not be empty.");
  }

  let current = AgentSystemConfigJsonSchema;
  let required = false;
  for (const segment of path) {
    const objectSchema = unwrapArrayItems(current, path);
    const property = objectSchema.properties?.[segment];
    if (!property) {
      throw new TypeError(`Agent config form field path is not declared by AgentSystemConfigSchema: ${path.join(".")}`);
    }
    required = objectSchema.required?.includes(segment) ?? false;
    current = property;
  }

  return {
    required,
    ...(current.enum ? { options: current.enum } : {}),
  };
}

export function listAgentConfigLeafPaths(): string[][] {
  const leaves = new Map<string, string[]>();
  collectSchemaLeafPaths(AgentSystemConfigJsonSchema, [], leaves);
  return [...leaves.values()].sort((left, right) => left.join(".").localeCompare(right.join(".")));
}

function collectSchemaLeafPaths(schema: JsonSchemaNode, path: readonly string[], leaves: Map<string, string[]>): void {
  const alternatives = [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])];
  if (alternatives.length > 0) {
    for (const alternative of alternatives) collectSchemaLeafPaths(alternative, path, leaves);
    return;
  }

  if (isSchemaType(schema, "array")) {
    if (schema.items) {
      collectSchemaLeafPaths(schema.items, path, leaves);
    } else {
      addLeafPath(path, leaves);
    }
    return;
  }

  if (isSchemaType(schema, "object")) {
    const properties = Object.entries(schema.properties ?? {});
    if (properties.length > 0) {
      for (const [name, property] of properties) collectSchemaLeafPaths(property, [...path, name], leaves);
      return;
    }
  }

  addLeafPath(path, leaves);
}

function addLeafPath(path: readonly string[], leaves: Map<string, string[]>): void {
  if (path.length === 0) return;
  const value = [...path];
  leaves.set(value.join("\u001f"), value);
}

function unwrapArrayItems(schema: JsonSchemaNode, path: readonly string[]): JsonSchemaNode {
  let current = schema;
  while (isSchemaType(current, "array")) {
    if (!current.items) {
      throw new TypeError(`Agent config array schema has no item contract: ${path.join(".")}`);
    }
    current = current.items;
  }
  if (!isSchemaType(current, "object") || !current.properties) {
    throw new TypeError(`Agent config form path does not traverse an object schema: ${path.join(".")}`);
  }
  return current;
}

function isSchemaType(schema: JsonSchemaNode, expected: string): boolean {
  return Array.isArray(schema.type) ? schema.type.includes(expected) : schema.type === expected;
}
