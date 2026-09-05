import { AgentXmlCodec } from "../Xml/AgentXmlCodec.js";
import { createXmlProtocolSpec } from "../Xml/AgentXmlPolicy.js";
import { AgentPromptContractRenderer } from "../Prompt/AgentPromptContractRenderer.js";
import type { AgentPromptContractView, ContractProjectionNode } from "../Prompt/AgentPromptContractTypes.js";

type JsonSchema = Record<string, unknown>;

export class AgentJsonSchemaPromptContractProjector {
  private readonly protocol = createXmlProtocolSpec();
  private readonly renderer = new AgentPromptContractRenderer({
    xmlCodec: new AgentXmlCodec(this.protocol),
    arrayItemName: this.protocol.items.arrayItem,
  });

  project(jsonSchema: JsonSchema, rootName = "arguments"): AgentPromptContractView {
    const root = resolveSchema(jsonSchema, jsonSchema);
    const properties = rootProperties(root, jsonSchema).map(({ name, schema, required }) =>
      this.projectProperty(name, schema, required, `${rootName}.${name}`, 1, jsonSchema),
    );
    return {
      tsHintLines: this.renderer.renderTsHintLines(rootName, properties),
      xmlPreview: this.renderer.renderXmlPreview(rootName, properties),
      properties: properties.map((property) => this.renderer.toPromptProperty(property)),
      jsonSchema,
    };
  }

  private projectProperty(
    name: string,
    schema: JsonSchema,
    required: boolean,
    propertyPath: string,
    depth: number,
    rootSchema: JsonSchema,
  ): ContractProjectionNode {
    const resolved = resolveSchema(schema, rootSchema);
    const typeText = schemaTypeText(schema, rootSchema);
    const comment = typeof schema.description === "string" ? schema.description : "";
    const xmlHint = typeof schema["x-senera-xml-hint"] === "string" ? schema["x-senera-xml-hint"] : "";

    if (isObjectSchema(resolved)) {
      const childRequired = stringSet(resolved.required);
      const children = schemaProperties(resolved).map(([childName, childSchema]) =>
        this.projectProperty(
          childName,
          childSchema,
          childRequired.has(childName),
          `${propertyPath}.${childName}`,
          depth + 1,
          rootSchema,
        ),
      );
      return contractNode({
        name,
        displayName: name,
        path: propertyPath,
        depth,
        kind: "object",
        typeText,
        required,
        comment,
        xmlHint,
        children,
      });
    }

    if (isArraySchema(resolved)) {
      const itemSchema = recordValue(resolved.items);
      const element = itemSchema
        ? this.projectProperty(
            this.protocol.items.arrayItem,
            itemSchema,
            true,
            `${propertyPath}.${this.protocol.items.arrayItem}`,
            depth + 1,
            rootSchema,
          )
        : undefined;
      return contractNode({
        name,
        displayName: name,
        path: propertyPath,
        depth,
        kind: "array",
        typeText,
        required,
        comment,
        xmlHint,
        children: [],
        element,
      });
    }

    return contractNode({
      name,
      displayName: name,
      path: propertyPath,
      depth,
      kind: "scalar",
      typeText,
      required,
      comment,
      xmlHint,
      children: [],
    });
  }
}

interface RootProperty {
  readonly name: string;
  readonly schema: JsonSchema;
  readonly required: boolean;
}

interface ObjectSchemaVariant {
  readonly properties: ReadonlyMap<string, JsonSchema>;
  readonly required: ReadonlySet<string>;
}

function rootProperties(root: JsonSchema, rootSchema: JsonSchema): RootProperty[] {
  const variants = objectSchemaVariants(root, rootSchema);
  const propertyNames = new Set<string>();
  for (const variant of variants) {
    for (const name of variant.properties.keys()) propertyNames.add(name);
  }

  return [...propertyNames].map((name) => {
    const candidates = variants.flatMap((variant) => {
      const schema = variant.properties.get(name);
      return schema ? [schema] : [];
    });
    return {
      name,
      schema: mergePropertySchemas(candidates),
      required: candidates.length === variants.length && variants.every((variant) => variant.required.has(name)),
    };
  });
}

function objectSchemaVariants(root: JsonSchema, rootSchema: JsonSchema): readonly ObjectSchemaVariant[] {
  const union = objectUnionBranches(root, rootSchema);
  if (!union) return [toObjectSchemaVariant(root, rootSchema)];

  const base = toObjectSchemaVariant(root, rootSchema);
  return union.map((branch) => mergeObjectSchemaVariants(base, toObjectSchemaVariant(branch, rootSchema)));
}

function objectUnionBranches(root: JsonSchema, rootSchema: JsonSchema): readonly JsonSchema[] | undefined {
  for (const keyword of ["oneOf", "anyOf"] as const) {
    const branches = arrayValue(root[keyword]);
    if (!branches?.length) continue;
    const objects = branches.flatMap((branch) => {
      const resolved = resolveSchema(recordValue(branch) ?? {}, rootSchema);
      return isObjectSchema(resolved) ? [resolved] : [];
    });
    if (objects.length === branches.length) return objects;
  }
  return undefined;
}

function toObjectSchemaVariant(schema: JsonSchema, rootSchema: JsonSchema): ObjectSchemaVariant {
  return {
    properties: new Map(schemaProperties(resolveSchema(schema, rootSchema))),
    required: stringSet(resolveSchema(schema, rootSchema).required),
  };
}

function mergeObjectSchemaVariants(base: ObjectSchemaVariant, branch: ObjectSchemaVariant): ObjectSchemaVariant {
  return {
    properties: new Map([...base.properties, ...branch.properties]),
    required: new Set([...base.required, ...branch.required]),
  };
}

function mergePropertySchemas(candidates: readonly JsonSchema[]): JsonSchema {
  if (candidates.length === 0) return {};
  const unique = uniqueSchemas(candidates);
  if (unique.length === 1) return unique[0]!;
  const descriptions = unique
    .map((schema) => schema.description)
    .filter((description): description is string => typeof description === "string");
  return {
    anyOf: unique,
    ...(descriptions.length > 0 ? { description: [...new Set(descriptions)].join(" ") } : {}),
  };
}

function uniqueSchemas(candidates: readonly JsonSchema[]): JsonSchema[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = JSON.stringify(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function contractNode(
  input: Omit<ContractProjectionNode, "elements"> & { element?: ContractProjectionNode },
): ContractProjectionNode {
  return { ...input, elements: input.element ? [input.element] : [] };
}

function schemaProperties(schema: JsonSchema): Array<[string, JsonSchema]> {
  const properties = recordValue(schema.properties);
  return properties
    ? Object.entries(properties).flatMap(([name, value]) => {
        const property = recordValue(value);
        return property ? [[name, property] as [string, JsonSchema]] : [];
      })
    : [];
}

function schemaTypeText(schema: JsonSchema, rootSchema: JsonSchema): string {
  const reference = typeof schema.$ref === "string" ? schema.$ref : undefined;
  if (reference) return decodeReferenceName(reference);
  const variants = arrayValue(schema.anyOf) ?? arrayValue(schema.oneOf);
  if (variants) {
    const types = variants.flatMap((variant) => {
      const candidate = recordValue(variant);
      return candidate ? [schemaTypeText(candidate, rootSchema)] : [];
    });
    return [...new Set(types)].join(" | ") || "unknown";
  }
  const values = arrayValue(schema.enum);
  if (values) return values.map(literalTypeText).join(" | ") || "unknown";
  if ("const" in schema) return literalTypeText(schema.const);

  const resolved = resolveSchema(schema, rootSchema);
  if (resolved !== schema) return schemaTypeText(resolved, rootSchema);
  const type = resolved.type;
  if (type === "integer") return "number";
  if (type === "array") {
    const items = recordValue(resolved.items);
    return `${items ? schemaTypeText(items, rootSchema) : "unknown"}[]`;
  }
  if (type === "object" || recordValue(resolved.properties)) return "object";
  if (typeof type === "string") return type;
  return "unknown";
}

function resolveSchema(schema: JsonSchema, rootSchema: JsonSchema): JsonSchema {
  const reference = typeof schema.$ref === "string" ? schema.$ref : undefined;
  if (!reference?.startsWith("#/")) return schema;
  let value: unknown = rootSchema;
  for (const segment of reference
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))) {
    value = recordValue(value)?.[segment];
  }
  const resolved = recordValue(value);
  if (!resolved) throw new Error(`Tool contract contains an unresolved local reference: ${reference}`);
  return { ...resolved, ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$ref")) };
}

function decodeReferenceName(reference: string): string {
  const tail = reference.split("/").at(-1) ?? "unknown";
  return tail.replaceAll("~1", "/").replaceAll("~0", "~");
}

function isObjectSchema(schema: JsonSchema): boolean {
  return schema.type === "object" || Boolean(recordValue(schema.properties));
}

function isArraySchema(schema: JsonSchema): boolean {
  return schema.type === "array";
}

function recordValue(value: unknown): JsonSchema | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonSchema) : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function stringSet(value: unknown): Set<string> {
  return new Set((Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string"));
}

function literalTypeText(value: unknown): string {
  return value === undefined ? "unknown" : JSON.stringify(value);
}
