import { z } from "zod";
import { AgentSystemConfigSchema } from "../Schemas/AgentSystemConfigSchema.js";

interface JsonSchemaNode {
  readonly type?: string | readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchemaNode;
}

export interface AgentConfigFieldContract {
  readonly required: boolean;
}

const AgentSystemConfigJsonSchema = z.toJSONSchema(AgentSystemConfigSchema, {
  cycles: "throw",
  reused: "inline",
  unrepresentable: "throw",
}) as JsonSchemaNode;

export function readAgentConfigFieldContract(path: readonly string[], fieldType: string): AgentConfigFieldContract {
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

  return { required: fieldType === "boolean" || required };
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
