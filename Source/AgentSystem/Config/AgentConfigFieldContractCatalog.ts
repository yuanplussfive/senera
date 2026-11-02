import { z } from "zod";
import { AgentSystemConfigSchema } from "../Schemas/AgentSystemConfigSchema.js";
import type { AgentConfigFormInputBounds, AgentConfigFormFieldPresence } from "../Types/ConfigFormTypes.js";

interface JsonSchemaNode {
  readonly type?: string | readonly string[];
  readonly enum?: readonly (string | number | boolean)[];
  readonly const?: unknown;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly exclusiveMaximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly anyOf?: readonly JsonSchemaNode[];
  readonly oneOf?: readonly JsonSchemaNode[];
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchemaNode;
  readonly additionalProperties?: boolean | JsonSchemaNode;
}

export interface AgentConfigFieldContract extends AgentConfigFormFieldPresence {
  readonly required: boolean;
  readonly options?: readonly (string | number | boolean)[];
  readonly inputBounds: AgentConfigFormInputBounds;
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
  const optionalParents: string[][] = [];
  for (const [index, segment] of path.entries()) {
    const objectSchema = unwrapArrayItems(current, path);
    const property = objectSchema.properties?.[segment];
    if (!property) {
      throw new TypeError(`Agent config form field path is not declared by AgentSystemConfigSchema: ${path.join(".")}`);
    }
    required = objectSchema.required?.includes(segment) ?? false;
    if (!required && index < path.length - 1 && isSchemaType(property, "object"))
      optionalParents.push(path.slice(0, index + 1));
    current = property;
  }

  return {
    required,
    ...(optionalParents.length ? { optionalParents } : {}),
    ...(current.enum ? { options: current.enum } : {}),
    inputBounds: readInputBounds(current),
  };
}

function readInputBounds(schema: JsonSchemaNode): AgentConfigFieldContract["inputBounds"] {
  const numeric = readInputRange(schema, "number");
  const length = readInputRange(schema, "string");
  return {
    ...(Number.isFinite(numeric.min)
      ? { min: numeric.min, ...(numeric.minExclusive ? { minExclusive: true } : {}) }
      : {}),
    ...(Number.isFinite(numeric.max)
      ? { max: numeric.max, ...(numeric.maxExclusive ? { maxExclusive: true } : {}) }
      : {}),
    ...(Number.isFinite(length.min) ? { minLength: length.min } : {}),
    ...(Number.isFinite(length.max) ? { maxLength: length.max } : {}),
  };
}

/** Projects the outer input range; gaps inside unions still need schema validation. */
function readInputRange(
  schema: JsonSchemaNode,
  kind: "number" | "string",
): { min: number; max: number; minExclusive: boolean; maxExclusive: boolean } {
  let min = (kind === "number" ? schema.minimum : schema.minLength) ?? -Infinity;
  let max = (kind === "number" ? schema.maximum : schema.maxLength) ?? Infinity;
  let minExclusive = false;
  let maxExclusive = false;
  if (kind === "number") {
    const integer = isSchemaType(schema, "integer");
    if (schema.exclusiveMinimum !== undefined && schema.exclusiveMinimum >= min) {
      min = schema.exclusiveMinimum;
      minExclusive = true;
    }
    if (schema.exclusiveMaximum !== undefined && schema.exclusiveMaximum <= max) {
      max = schema.exclusiveMaximum;
      maxExclusive = true;
    }
    if (integer) {
      min = minExclusive ? Math.floor(min) + 1 : Math.ceil(min);
      max = maxExclusive ? Math.ceil(max) - 1 : Math.floor(max);
      minExclusive = false;
      maxExclusive = false;
    }
    const values = schema.const !== undefined ? [schema.const] : schema.enum;
    if (values?.length && values.every((value): value is number => typeof value === "number")) {
      if (Math.min(...values) > min) minExclusive = false;
      if (Math.max(...values) < max) maxExclusive = false;
      min = Math.max(min, Math.min(...values));
      max = Math.min(max, Math.max(...values));
    }
  }
  for (const alternatives of [schema.anyOf, schema.oneOf]) {
    if (!alternatives?.length) continue;
    const ranges = alternatives.map((alternative) => readInputRange(alternative, kind));
    const unionMin = Math.min(...ranges.map((range) => range.min));
    const unionMax = Math.max(...ranges.map((range) => range.max));
    if (unionMin >= min) {
      const exclusive = ranges.filter((range) => range.min === unionMin).every((range) => range.minExclusive);
      minExclusive = unionMin === min ? minExclusive || exclusive : exclusive;
      min = unionMin;
    }
    if (unionMax <= max) {
      const exclusive = ranges.filter((range) => range.max === unionMax).every((range) => range.maxExclusive);
      maxExclusive = unionMax === max ? maxExclusive || exclusive : exclusive;
      max = unionMax;
    }
  }
  return { min, max, minExclusive, maxExclusive };
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
