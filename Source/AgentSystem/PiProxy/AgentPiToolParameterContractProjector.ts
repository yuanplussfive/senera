import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import type {
  AgentPiToolParameterContract,
  AgentPiToolParameterOutlineProperty,
} from "./AgentPiAssistantMessageTypes.js";

const EmptyJsonSchema = Object.freeze({ type: "object", properties: {} });

interface JsonSchemaPropertyNode {
  path: string;
  schema: Record<string, unknown>;
  required: boolean;
}

export interface AgentPiToolParameterContractProjection {
  contract: AgentPiToolParameterContract;
  truncated: boolean;
}

export class AgentPiToolParameterContractProjector {
  constructor(private readonly tokenProjector: AgentTokenProjector) {}

  project(schema: unknown, tokenLimit: number): AgentPiToolParameterContractProjection {
    const complete = {
      format: "json_schema" as const,
      schema: schema ?? EmptyJsonSchema,
    };
    if (this.fits(complete, tokenLimit)) {
      return { contract: complete, truncated: false };
    }

    return {
      contract: this.projectOutline(schema, tokenLimit),
      truncated: true,
    };
  }

  private projectOutline(schema: unknown, tokenLimit: number): AgentPiToolParameterContract {
    const nodes = collectJsonSchemaProperties(schema);
    const descriptionTokens = Math.max(1, Math.floor(tokenLimit / Math.max(1, nodes.length) / 2));
    const properties: AgentPiToolParameterOutlineProperty[] = [];
    for (const node of nodes) {
      const allowedValues = jsonSchemaAllowedValues(node.schema);
      const property: AgentPiToolParameterOutlineProperty = {
        path: node.path,
        types: jsonSchemaTypes(node.schema),
        required: node.required,
        ...(typeof node.schema.description === "string"
          ? { description: this.tokenProjector.previewText(node.schema.description, descriptionTokens).text }
          : {}),
        ...(allowedValues.length > 0 ? { allowedValues } : {}),
      };
      if (this.outlineFits(schema, [...properties, property], nodes.length, tokenLimit)) {
        properties.push(property);
        continue;
      }

      const minimal = {
        path: property.path,
        types: property.types,
        required: property.required,
      };
      if (this.outlineFits(schema, [...properties, minimal], nodes.length, tokenLimit)) {
        properties.push(minimal);
      }
    }
    return jsonSchemaOutline(schema, properties, nodes.length - properties.length);
  }

  private outlineFits(
    schema: unknown,
    properties: AgentPiToolParameterOutlineProperty[],
    omittedProperties: number,
    tokenLimit: number,
  ): boolean {
    return this.fits(jsonSchemaOutline(schema, properties, omittedProperties), tokenLimit);
  }

  private fits(value: unknown, tokenLimit: number): boolean {
    return this.tokenProjector.previewJson(value, tokenLimit) === value;
  }
}

function collectJsonSchemaProperties(value: unknown): JsonSchemaPropertyNode[] {
  const root = readRecord(value);
  if (!root) return [];
  const nodes: JsonSchemaPropertyNode[] = [];

  const visitContainer = (schema: Record<string, unknown>, prefix: string, ancestors: Set<object>): void => {
    if (ancestors.has(schema)) return;
    const branch = new Set(ancestors).add(schema);
    const required = new Set(readStringArray(schema.required));
    const properties = readRecord(schema.properties);
    for (const [name, propertyValue] of Object.entries(properties ?? {})) {
      const property = readRecord(propertyValue);
      if (!property) continue;
      const path = prefix ? `${prefix}.${name}` : name;
      nodes.push({ path, schema: property, required: required.has(name) });
      visitNested(property, path, branch);
    }
  };

  const visitNested = (schema: Record<string, unknown>, path: string, ancestors: Set<object>): void => {
    visitContainer(schema, path, ancestors);
    const items = readRecord(schema.items);
    if (items) visitNested(items, `${path}[]`, ancestors);
    for (const variant of [...readArray(schema.anyOf), ...readArray(schema.oneOf), ...readArray(schema.allOf)]) {
      const nested = readRecord(variant);
      if (nested) visitNested(nested, path, ancestors);
    }
  };

  visitContainer(root, "", new Set());
  return nodes;
}

function jsonSchemaOutline(
  schema: unknown,
  properties: AgentPiToolParameterOutlineProperty[],
  omittedProperties: number,
): AgentPiToolParameterContract {
  return {
    format: "json_schema_outline",
    rootTypes: jsonSchemaTypes(readRecord(schema) ?? EmptyJsonSchema),
    properties,
    omittedProperties,
  };
}

function jsonSchemaTypes(schema: Record<string, unknown>): string[] {
  const declared = Array.isArray(schema.type)
    ? schema.type.filter((value): value is string => typeof value === "string")
    : typeof schema.type === "string"
      ? [schema.type]
      : [];
  const variants = [...readArray(schema.anyOf), ...readArray(schema.oneOf)].flatMap((value) => {
    const variant = readRecord(value);
    return variant ? jsonSchemaTypes(variant) : [];
  });
  const inferred = [
    ...(readRecord(schema.properties) ? ["object"] : []),
    ...(schema.items !== undefined ? ["array"] : []),
    ...jsonSchemaAllowedValues(schema).map(jsonValueType),
  ];
  const types = uniqueStrings([...declared, ...variants, ...inferred]);
  return types.length > 0 ? types : ["unknown"];
}

function jsonSchemaAllowedValues(schema: Record<string, unknown>): unknown[] {
  if (Array.isArray(schema.enum)) return [...schema.enum];
  if (Object.hasOwn(schema, "const")) return [schema.const];
  return [...readArray(schema.anyOf), ...readArray(schema.oneOf)].flatMap((value) => {
    const variant = readRecord(value);
    return variant ? jsonSchemaAllowedValues(variant) : [];
  });
}

function jsonValueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
