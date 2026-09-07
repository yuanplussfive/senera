import { Liquid } from "liquidjs";
import { errorMessage } from "../Core/AgentErrors.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import type { ToolArtifactPolicyManifest } from "../Types/AgentToolContractTypes.js";

type TemplatePathSegment = string | number | TemplatePathSegment[];

type TemplateValueContract =
  | { readonly kind: "terminal" }
  | { readonly kind: "dynamic" }
  | {
      readonly kind: "object";
      readonly properties: ReadonlyMap<string, TemplateValueContract>;
      readonly additional?: TemplateValueContract;
    }
  | { readonly kind: "array"; readonly element: TemplateValueContract }
  | { readonly kind: "map"; readonly value: TemplateValueContract }
  | { readonly kind: "union"; readonly variants: readonly TemplateValueContract[] }
  | { readonly kind: "intersection"; readonly variants: readonly TemplateValueContract[] };

export interface ArtifactTemplateSchemaContext {
  readonly argumentsSchema?: unknown;
  readonly resultSchema?: unknown;
}

const Terminal: TemplateValueContract = { kind: "terminal" };
const Dynamic: TemplateValueContract = { kind: "dynamic" };
const TemplateParser = new Liquid({ strictFilters: true, strictVariables: false });

const EvidenceEntryContract = templateObject({
  evidenceUri: Terminal,
  kind: Terminal,
  locator: Terminal,
  display: Terminal,
  label: Terminal,
  source: Terminal,
  confidence: Terminal,
  slots: templateMap(Dynamic),
  modelSlots: templateMap(Dynamic),
  metadata: templateMap(Dynamic),
});

const WorkspaceFileContentContract = templateObject({
  state: Terminal,
  encoding: Terminal,
  byteLength: Terminal,
  lineCount: Terminal,
  artifactPath: Terminal,
  relativeArtifactPath: Terminal,
  reason: Terminal,
});

const WorkspaceFileContract = templateObject({
  path: Terminal,
  absolutePath: Terminal,
  exists: Terminal,
  kind: Terminal,
  size: Terminal,
  mtimeMs: Terminal,
  hash: Terminal,
  content: WorkspaceFileContentContract,
  target: Terminal,
});

const WorkspaceSnapshotContract = templateObject({
  files: templateArray(WorkspaceFileContract),
  capturedAt: Terminal,
  warnings: templateArray(Terminal),
});

const WorkspaceChangeContract = templateObject({
  path: Terminal,
  absolutePath: Terminal,
  status: Terminal,
  beforeKind: Terminal,
  afterKind: Terminal,
  beforeHash: Terminal,
  afterHash: Terminal,
  beforeSize: Terminal,
  afterSize: Terminal,
  patch: templateObject({ status: Terminal, reason: Terminal, path: Terminal, relativePath: Terminal }),
});

const WorkspaceContract = templateObject({
  before: WorkspaceSnapshotContract,
  after: WorkspaceSnapshotContract,
  changes: templateArray(WorkspaceChangeContract),
});

const ArtifactScopeBase = {
  toolName: Terminal,
  callId: Terminal,
  artifact: templateObject({
    artifactId: Terminal,
    artifactUri: Terminal,
    artifactPath: Terminal,
    relativePath: Terminal,
  }),
  evidence: templateArray(EvidenceEntryContract),
  evidenceByKind: templateMap(templateArray(EvidenceEntryContract)),
  projections: templateArray(
    templateObject({ kind: Terminal, count: Terminal, summary: Terminal, artifact: Terminal }),
  ),
  delta: templateArray(
    templateObject({
      kind: Terminal,
      key: Terminal,
      status: Terminal,
      summary: Terminal,
      metadata: templateMap(Dynamic),
    }),
  ),
  workspace: WorkspaceContract,
} as const;

const EvidenceProjectionScope = templateObject({
  kind: Terminal,
  count: Terminal,
  evidence: templateArray(EvidenceEntryContract),
});

export class AgentArtifactTemplatePreflightError extends AgentBaseError {
  constructor(
    readonly templatePath: string,
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`Artifact template preflight failed at ${templatePath}: ${reason}`, options);
  }
}

export function assertArtifactPolicyTemplates(
  policy: ToolArtifactPolicyManifest | undefined,
  schemas: ArtifactTemplateSchemaContext = {},
): void {
  if (!policy) return;
  const artifactScope = templateObject({
    ...ArtifactScopeBase,
    arguments: jsonSchemaContract(schemas.argumentsSchema),
    result: jsonSchemaContract(schemas.resultSchema),
  });
  if (policy.Summary) {
    assertTemplate(policy.Summary.Template, "Summary.Template", artifactScope);
    assertTemplate(policy.Summary.ArtifactTemplate, "Summary.ArtifactTemplate", artifactScope);
  }
  for (const [index, evidence] of (policy.Evidence ?? []).entries()) {
    assertTemplate(
      evidence.Projection.SummaryTemplate,
      `Evidence[${index}].Projection.SummaryTemplate`,
      EvidenceProjectionScope,
    );
    assertTemplate(
      evidence.Projection.ArtifactTemplate,
      `Evidence[${index}].Projection.ArtifactTemplate`,
      EvidenceProjectionScope,
    );
  }
}

function assertTemplate(template: string, templatePath: string, scope: TemplateValueContract): void {
  try {
    const parsed = TemplateParser.parse(template);
    for (const segments of TemplateParser.globalVariableSegmentsSync(parsed) as TemplatePathSegment[][]) {
      assertTemplatePath(segments, scope, templatePath);
    }
  } catch (error) {
    if (error instanceof AgentArtifactTemplatePreflightError) throw error;
    throw new AgentArtifactTemplatePreflightError(templatePath, errorMessage(error), { cause: error });
  }
}

function assertTemplatePath(
  segments: readonly TemplatePathSegment[],
  scope: TemplateValueContract,
  templatePath: string,
): void {
  let contract = scope;
  for (const [index, segment] of segments.entries()) {
    const next = resolveTemplateMember(contract, segment);
    if (!next) {
      throw new AgentArtifactTemplatePreflightError(
        templatePath,
        `unknown template member ${formatVariablePath(segments.slice(0, index + 1))}.`,
      );
    }
    contract = next;
  }
}

function resolveTemplateMember(
  contract: TemplateValueContract,
  segment: TemplatePathSegment,
): TemplateValueContract | undefined {
  switch (contract.kind) {
    case "dynamic":
      return Dynamic;
    case "terminal":
      return undefined;
    case "object":
      return typeof segment === "string" ? (contract.properties.get(segment) ?? contract.additional) : undefined;
    case "map":
      return contract.value;
    case "array":
      return resolveArrayMember(contract.element, segment);
    case "union": {
      const candidates = contract.variants.flatMap((variant) => {
        const next = resolveTemplateMember(variant, segment);
        return next ? [next] : [];
      });
      return candidates.length > 0 ? templateUnion(candidates) : undefined;
    }
    case "intersection": {
      const candidates = contract.variants.map((variant) => resolveTemplateMember(variant, segment));
      return candidates.every((candidate) => candidate !== undefined)
        ? templateIntersection(candidates as TemplateValueContract[])
        : undefined;
    }
  }
}

function resolveArrayMember(
  element: TemplateValueContract,
  segment: TemplatePathSegment,
): TemplateValueContract | undefined {
  if (typeof segment === "number") return element;
  if (segment === "first" || segment === "last") return element;
  return segment === "size" ? Terminal : undefined;
}

function jsonSchemaContract(schema: unknown): TemplateValueContract {
  return schema === undefined ? Dynamic : buildJsonSchemaContract(schema, schema, new Set<unknown>());
}

function buildJsonSchemaContract(
  schema: unknown,
  root: unknown,
  activeReferences: ReadonlySet<unknown>,
): TemplateValueContract {
  if (schema === true) return Dynamic;
  if (schema === false) return Terminal;
  const document = asRecord(schema);
  if (!document) throw new Error("Artifact template schema must be a JSON Schema object or boolean.");
  if (activeReferences.has(schema)) return Dynamic;

  const reference = document.$ref;
  if (reference !== undefined) {
    if (typeof reference !== "string") throw new Error("Artifact template schema $ref must be a string.");
    const target = resolveLocalJsonReference(root, reference);
    return buildJsonSchemaContract(target, root, new Set([...activeReferences, schema]));
  }

  const active = new Set([...activeReferences, schema]);
  const direct = buildDirectJsonSchemaContract(document, root, active);
  const intersections = schemaCompositions(document, "allOf").map((entry) =>
    buildJsonSchemaContract(entry, root, active),
  );
  const alternatives = [...schemaCompositions(document, "anyOf"), ...schemaCompositions(document, "oneOf")].map(
    (entry) => buildJsonSchemaContract(entry, root, active),
  );
  const composed = intersections.length > 0 ? templateIntersection([direct ?? Dynamic, ...intersections]) : direct;
  if (alternatives.length > 0) return templateUnion([...(composed ? [composed] : []), ...alternatives]);
  return composed ?? Dynamic;
}

function buildDirectJsonSchemaContract(
  schema: Record<string, unknown>,
  root: unknown,
  activeReferences: ReadonlySet<unknown>,
): TemplateValueContract | undefined {
  const types = schemaTypes(schema.type);
  const objectContract = objectJsonSchemaContract(schema, root, activeReferences);
  const arrayContract = arrayJsonSchemaContract(schema, root, activeReferences);
  const candidates = [
    ...(objectContract ? [objectContract] : []),
    ...(arrayContract ? [arrayContract] : []),
    ...(types.some((type) => type !== "object" && type !== "array") ? [Terminal] : []),
  ];
  return candidates.length > 0 ? templateUnion(candidates) : undefined;
}

function objectJsonSchemaContract(
  schema: Record<string, unknown>,
  root: unknown,
  activeReferences: ReadonlySet<unknown>,
): TemplateValueContract | undefined {
  const properties = asRecord(schema.properties);
  const types = schemaTypes(schema.type);
  if (!types.includes("object") && !properties && schema.additionalProperties === undefined) return undefined;
  const entries = Object.entries(properties ?? {}).map(
    ([name, value]) => [name, buildJsonSchemaContract(value, root, activeReferences)] as const,
  );
  const additional = schema.additionalProperties;
  return templateObject(
    Object.fromEntries(entries),
    additional === false
      ? undefined
      : additional === undefined || additional === true
        ? Dynamic
        : buildJsonSchemaContract(additional, root, activeReferences),
  );
}

function arrayJsonSchemaContract(
  schema: Record<string, unknown>,
  root: unknown,
  activeReferences: ReadonlySet<unknown>,
): TemplateValueContract | undefined {
  const types = schemaTypes(schema.type);
  if (!types.includes("array") && schema.items === undefined) return undefined;
  return templateArray(
    schema.items === undefined ? Dynamic : buildJsonSchemaContract(schema.items, root, activeReferences),
  );
}

function schemaTypes(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return [...value];
  return [];
}

function schemaCompositions(schema: Record<string, unknown>, key: "allOf" | "anyOf" | "oneOf"): unknown[] {
  const value = schema[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Artifact template schema ${key} must be an array.`);
  return value;
}

function resolveLocalJsonReference(root: unknown, reference: string): unknown {
  if (!reference.startsWith("#/"))
    throw new Error(`Artifact template schema does not support external reference ${reference}.`);
  return reference
    .slice(2)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<unknown>((value, segment) => {
      const record = asRecord(value);
      if (!record || !Object.hasOwn(record, segment)) {
        throw new Error(`Artifact template schema reference ${reference} could not be resolved.`);
      }
      return record[segment];
    }, root);
}

function templateObject(
  properties: Readonly<Record<string, TemplateValueContract>>,
  additional?: TemplateValueContract,
): TemplateValueContract {
  return { kind: "object", properties: new Map(Object.entries(properties)), ...(additional ? { additional } : {}) };
}

function templateArray(element: TemplateValueContract): TemplateValueContract {
  return { kind: "array", element };
}

function templateMap(value: TemplateValueContract): TemplateValueContract {
  return { kind: "map", value };
}

function templateUnion(variants: readonly TemplateValueContract[]): TemplateValueContract {
  return variants.length === 1 ? variants[0]! : { kind: "union", variants };
}

function templateIntersection(variants: readonly TemplateValueContract[]): TemplateValueContract {
  return variants.length === 1 ? variants[0]! : { kind: "intersection", variants };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function formatVariablePath(segments: readonly TemplatePathSegment[]): string {
  return segments.reduce<string>((path, segment) => {
    if (typeof segment === "number") return `${path}[${segment}]`;
    const part = Array.isArray(segment) ? `[${formatVariablePath(segment)}]` : segment;
    return path.length === 0 ? part : `${path}.${part}`;
  }, "");
}
