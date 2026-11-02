import type { KeywordDefinition } from "ajv";
import { z } from "zod";
import {
  parseAgentJsonPointer,
  formatAgentJsonPointer,
  readAgentJsonPointer,
} from "../Core/AgentJsonPointerOperations.js";
import { isAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import { resolveAgentJsonSchemaPointer, type AgentJsonSchema } from "./AgentJsonSchemaPointer.js";

export const AgentToolModelOutputKeyword = "x-senera-model-output";

const ModelOutputPolicySchema = z
  .object({
    omit: z
      .array(z.string().refine(isPropertyPointer, "Expected a non-root JSON Pointer ending in a property name."))
      .min(1),
  })
  .strict();

// A keyword subschema inherits its validator's dialect. The policy uses the
// shared object/array/string vocabulary supported by draft-07 and 2020-12.
const { $schema: _dialect, ...ModelOutputPolicyMetaSchema } = z.toJSONSchema(ModelOutputPolicySchema, {
  target: "draft-7",
});

export const AgentToolModelOutputJsonSchemaKeyword: KeywordDefinition = {
  keyword: AgentToolModelOutputKeyword,
  metaSchema: ModelOutputPolicyMetaSchema,
  valid: true,
};

interface ProjectionNode {
  omit: boolean;
  readonly children: Map<string, ProjectionNode>;
}

interface ModelOutputPolicy {
  readonly root: ProjectionNode;
}

const policies = new WeakMap<AgentJsonSchema, ModelOutputPolicy>();

/** Compile and validate producer-owned presentation rules before a tool can be invoked. */
export function validateAgentToolModelOutput(schema: AgentJsonSchema): void {
  readPolicy(schema);
}

/**
 * A model view of an already validated result. The stored result is never
 * mutated, array positions remain stable for Artifact selectors, and no field
 * name carries a host-defined meaning. Schemas without a policy stay intact.
 */
export function projectAgentToolModelOutput(value: unknown, schema?: AgentJsonSchema): unknown {
  if (!schema) return value;
  const policy = readPolicy(schema);
  return policy ? project(value, [policy.root]) : value;
}

/** Describe the same fields as the model view without mutating the executable result contract. */
export function projectAgentToolModelOutputSchema(schema: AgentJsonSchema): AgentJsonSchema {
  const policy = readPolicy(schema);
  return policy ? projectSchema(schema, [policy.root], schema, new Set()) : schema;
}

function projectSchema(
  schema: AgentJsonSchema,
  nodes: readonly ProjectionNode[],
  root: AgentJsonSchema,
  ancestry: ReadonlySet<AgentJsonSchema>,
): AgentJsonSchema {
  if (nodes.length === 0 || ancestry.has(schema)) return schema;
  const nextAncestry = new Set(ancestry).add(schema);
  const result = { ...schema };
  // Inline only the reference at this path. Editing a shared definition would
  // hide fields in other branches that have no corresponding output policy.
  if (typeof schema.$ref === "string" && schema.$ref.startsWith("#")) {
    const reference = readAgentJsonPointer(root, schema.$ref.slice(1));
    if (isAgentUnknownRecord(reference.value)) {
      delete result.$ref;
      const branches = Array.isArray(result.allOf) ? result.allOf : [];
      result.allOf = [reference.value, ...branches];
    }
  }
  if (isAgentUnknownRecord(schema.properties)) {
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).flatMap(([name, child]) => {
        const children = matchingChildren(nodes, name);
        if (children.some((node) => node.omit)) {
          return [];
        }
        return [[name, isAgentUnknownRecord(child) ? projectSchema(child, children, root, new Set()) : child]];
      }),
    );
  }
  if (Array.isArray(schema.required))
    result.required = schema.required.filter(
      (name) => !matchingChildren(nodes, String(name)).some((node) => node.omit),
    );
  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    const branches = result[keyword];
    if (Array.isArray(branches))
      result[keyword] = branches.map((branch) =>
        isAgentUnknownRecord(branch) ? projectSchema(branch, nodes, root, nextAncestry) : branch,
      );
  }
  const wildcards = nodes.flatMap((node) => {
    const child = node.children.get("*");
    return child ? [child] : [];
  });
  for (const keyword of ["items", "prefixItems"] as const) {
    const items = schema[keyword];
    if (Array.isArray(items))
      result[keyword] = items.map((item, index) =>
        isAgentUnknownRecord(item)
          ? projectSchema(item, matchingChildren(nodes, String(index)), root, new Set())
          : item,
      );
    else if (isAgentUnknownRecord(items)) {
      const specificIndexes = new Set(
        nodes.flatMap((node) => [...node.children.keys()].filter((key) => /^(?:0|[1-9]\d*)$/u.test(key))),
      );
      const variants = [
        projectSchema(items, wildcards, root, new Set()),
        ...[...specificIndexes].map((index) => projectSchema(items, matchingChildren(nodes, index), root, new Set())),
      ];
      result[keyword] = variants.length === 1 ? variants[0] : { anyOf: variants };
    }
  }
  if (isAgentUnknownRecord(schema.additionalProperties))
    result.additionalProperties = projectSchema(schema.additionalProperties, wildcards, root, new Set());
  if (isAgentUnknownRecord(schema.patternProperties))
    result.patternProperties = Object.fromEntries(
      Object.entries(schema.patternProperties).map(([pattern, child]) => [
        pattern,
        isAgentUnknownRecord(child) ? projectSchema(child, wildcards, root, new Set()) : child,
      ]),
    );
  return result;
}

function readPolicy(schema: AgentJsonSchema): ModelOutputPolicy | undefined {
  const declaration = schema[AgentToolModelOutputKeyword];
  if (declaration === undefined) return undefined;
  const cached = policies.get(schema);
  if (cached) return cached;
  const { omit } = ModelOutputPolicySchema.parse(declaration);
  const root = projectionNode();
  for (const pointer of omit) {
    const tokens = parseAgentJsonPointer(pointer);
    if (resolveAgentJsonSchemaPointer(schema, pointer).length === 0) {
      throw new TypeError(`Model output property is not declared by its result schema: ${pointer}`);
    }
    const parents = resolveAgentJsonSchemaPointer(schema, formatAgentJsonPointer(tokens.slice(0, -1)));
    if (parents.some(isArrayContainer)) {
      throw new TypeError(`Model output rules cannot remove array entries: ${pointer}`);
    }
    let node = root;
    for (const token of tokens) {
      let child = node.children.get(token);
      if (!child) {
        child = projectionNode();
        node.children.set(token, child);
      }
      node = child;
    }
    node.omit = true;
  }
  const policy = { root };
  policies.set(schema, policy);
  return policy;
}

function project(value: unknown, nodes: readonly ProjectionNode[]): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const projected = value.map((entry, index) => {
      const children = matchingChildren(nodes, String(index));
      if (children.some((child) => child.omit)) throw new TypeError("Model output rules cannot remove array entries.");
      const result = children.length > 0 ? project(entry, children) : entry;
      changed ||= result !== entry;
      return result;
    });
    return changed ? projected : value;
  }
  if (!isAgentUnknownRecord(value)) return value;
  let changed = false;
  const entries = Object.entries(value).flatMap(([key, entry]) => {
    const children = matchingChildren(nodes, key);
    if (children.some((child) => child.omit)) {
      changed = true;
      return [];
    }
    const result = children.length > 0 ? project(entry, children) : entry;
    changed ||= result !== entry;
    return [[key, result] as const];
  });
  return changed ? Object.fromEntries(entries) : value;
}

function matchingChildren(nodes: readonly ProjectionNode[], key: string): ProjectionNode[] {
  return nodes.flatMap((node) => {
    const exact = node.children.get(key);
    const wildcard = node.children.get("*");
    return [...(exact ? [exact] : []), ...(wildcard && wildcard !== exact ? [wildcard] : [])];
  });
}

function projectionNode(): ProjectionNode {
  return { omit: false, children: new Map() };
}

function isArrayContainer(schema: AgentJsonSchema): boolean {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  return (
    types.includes("array") ||
    (schema.type === undefined && (schema.items !== undefined || schema.prefixItems !== undefined))
  );
}

function isPropertyPointer(value: string): boolean {
  try {
    const tokens = parseAgentJsonPointer(value);
    return tokens.length > 0 && tokens.at(-1) !== "*";
  } catch {
    return false;
  }
}
