import { z } from "zod";
import { isAgentJsonPointer } from "../Core/AgentJsonPointerOperations.js";
import { AgentExtensionNameSchema } from "../Extensions/AgentExtensionIdentity.js";
import { AgentExtensionLocalizedTextSchema } from "../Extensions/AgentExtensionLocalization.js";
import {
  AgentToolPresentationIconNames,
  type AgentToolPresentation,
  type AgentToolPresentationActivityV2,
  type AgentToolPresentationOverride,
} from "../Types/AgentToolPresentationTypes.js";

const JsonPointerPatternSchema = z.string().refine(isAgentJsonPointer, "Expected an RFC 6901 JSON Pointer pattern.");

const AgentToolPresentationGroupSchema = z
  .object({
    id: AgentExtensionNameSchema,
    title: AgentExtensionLocalizedTextSchema,
  })
  .strict();

const MeasureSources = ["argument", "result", "env"] as const;
const MeasureAggregates = ["first", "count", "sum", "max", "join"] as const;
const MeasureValueTypes = ["text", "path", "number", "boolean", "enum", "delta"] as const;
const NumericAggregates = new Set<string>(["sum", "max"]);
const NumericValueTypes = new Set<string>(["number", "delta"]);

/**
 * `env` exposes a closed key set. A contract may surface host facts such as
 * duration without gaining any arbitrary environment read.
 */
export const AgentToolPresentationEnvironmentPointers = ["/status", "/durationMs", "/toolName"] as const;

const TemplatePlaceholderPattern = /\{\{\s*([^{}]+?)\s*\}\}/gu;
/** A literal sign next to a placeholder would survive zero-omission as a stray character. */
const LiteralSignPattern = /[+\u2212]\s*\{\{|\}\}\s*[+\u2212]/u;

const AgentToolPresentationWhereSchema = z
  .object({
    field: z.string().trim().min(1),
    equals: z.union([z.string(), z.number(), z.boolean()]),
  })
  .strict();

const AgentToolPresentationMeasureSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .regex(/^[a-z][a-zA-Z0-9]*$/u),
    from: z.enum(MeasureSources),
    /** RFC 6901 pointer to a collection or scalar; `*` selects every entry. */
    pointer: JsonPointerPatternSchema,
    /** When the pointer selects a collection, read this field from each entry. */
    field: z.string().trim().min(1).optional(),
    /** Per-entry filter applied before aggregation. */
    where: AgentToolPresentationWhereSchema.optional(),
    aggregate: z.enum(MeasureAggregates).default("first"),
    type: z.enum(MeasureValueTypes).default("text"),
    /** Connector used when `aggregate` is `join`. */
    separator: z.string().optional(),
    unit: z.string().trim().min(1).optional(),
    precision: z.number().int().min(0).max(4).optional(),
    sign: z.enum(["always", "never", "positive-only", "negative-only"]).default("never"),
    /** A `delta` of 0 is omitted by default so "+0" / "−0" never reaches a label. */
    zero: z.enum(["omit", "show"]).default("omit"),
    /** Value text for `enum` / `boolean`; a missing entry falls back to the raw value. */
    labels: z.record(z.string(), AgentExtensionLocalizedTextSchema).optional(),
  })
  .strict();

const AgentToolPresentationVariantSchema = z
  .object({
    id: z.string().trim().min(1),
    /** Omit to declare the fallback variant, which must be the last entry. */
    when: z
      .object({
        measure: z.string().trim().min(1),
        equals: z.union([z.string(), z.number(), z.boolean()]),
      })
      .strict()
      .optional(),
    action: AgentExtensionLocalizedTextSchema.optional(),
    invocationName: AgentExtensionLocalizedTextSchema.optional(),
    argumentPath: JsonPointerPatternSchema.optional(),
    detailPaths: z.array(JsonPointerPatternSchema).max(16).optional(),
    /** A variant template takes precedence over `v2.title`. */
    title: z.string().trim().min(1).optional(),
  })
  .strict();

const AgentToolPresentationActivityV2Shape = z
  .object({
    measures: z.array(AgentToolPresentationMeasureSchema).max(16).default([]),
    variants: z.array(AgentToolPresentationVariantSchema).max(16).default([]),
    title: z.string().trim().min(1).optional(),
  })
  .strict();

export const AgentToolPresentationActivityV2Schema = AgentToolPresentationActivityV2Shape.superRefine(
  validateAgentToolPresentationActivityV2,
);

const AgentToolPresentationActivitySchema = z
  .object({
    action: AgentExtensionLocalizedTextSchema,
    invocationName: AgentExtensionLocalizedTextSchema.optional(),
    argumentPath: JsonPointerPatternSchema.optional(),
    detailPaths: z.array(JsonPointerPatternSchema).max(16).optional(),
    v2: AgentToolPresentationActivityV2Schema.optional(),
  })
  .strict();

const AgentToolPresentationPreviewRowSchema = z
  .object({
    pointer: JsonPointerPatternSchema,
    titlePath: JsonPointerPatternSchema,
    descriptionPath: JsonPointerPatternSchema.optional(),
    metaPath: JsonPointerPatternSchema.optional(),
  })
  .strict();

const AgentToolPresentationPreviewMoreSchema = z
  .object({
    pointer: JsonPointerPatternSchema,
    countPath: JsonPointerPatternSchema.optional(),
    label: AgentExtensionLocalizedTextSchema,
  })
  .strict();

const AgentToolPresentationPreviewResultSchema = z
  .object({
    rows: z.array(AgentToolPresentationPreviewRowSchema).min(1).max(8),
    maxRows: z.number().int().positive().max(32).optional(),
    more: AgentToolPresentationPreviewMoreSchema.optional(),
  })
  .strict();

const AgentToolPresentationPreviewSchema = z
  .object({
    parameters: z
      .array(
        z
          .object({
            label: AgentExtensionLocalizedTextSchema,
            pointer: JsonPointerPatternSchema,
          })
          .strict(),
      )
      .max(16)
      .optional(),
    result: AgentToolPresentationPreviewResultSchema.optional(),
  })
  .strict();

export const AgentSystemToolPresentationSchema = z
  .object({
    category: AgentExtensionNameSchema,
    icon: z.enum(AgentToolPresentationIconNames),
    group: AgentToolPresentationGroupSchema,
    activity: AgentToolPresentationActivitySchema,
    preview: AgentToolPresentationPreviewSchema.optional(),
  })
  .strict();

export const AgentSystemToolPresentationOverrideSchema = z
  .object({
    category: AgentExtensionNameSchema.optional(),
    icon: z.enum(AgentToolPresentationIconNames).optional(),
    group: AgentToolPresentationGroupSchema.partial().optional(),
    activity: AgentToolPresentationActivitySchema.partial().optional(),
    preview: AgentToolPresentationPreviewSchema.optional(),
  })
  .strict();

/**
 * A domain supplies a complete presentation. Extension and Tool-level
 * declarations refine it explicitly, keeping filesystem location out of the
 * runtime decision while still making package ownership obvious on disk.
 */
export function resolveAgentSystemToolPresentation(
  domain: AgentToolPresentation,
  ...overrides: readonly (AgentToolPresentationOverride | undefined)[]
): AgentToolPresentation {
  // v2 is merged shallowly like every other activity field, so two tiers
  // declaring it would silently drop one contract's measures. Fail closed.
  const declaringTiers = overrides.filter((override) => override?.activity?.v2 !== undefined).length;
  if (declaringTiers > 1) {
    throw new Error("activity.v2 must be declared by exactly one tier (extension or tool).");
  }
  const merged = overrides.reduce<AgentToolPresentation>((current, override) => {
    if (!override) return current;
    return {
      category: override.category ?? current.category,
      icon: override.icon ?? current.icon,
      group: { ...current.group, ...override.group },
      activity: { ...current.activity, ...override.activity },
      ...((override.preview ?? current.preview) ? { preview: override.preview ?? current.preview } : {}),
    };
  }, domain);
  return AgentSystemToolPresentationSchema.parse(merged) as AgentToolPresentation;
}

/**
 * Collects every argument-side pointer a contract declares, so the step-trace
 * projection can keep them addressable instead of replacing oversized
 * arguments with an opaque blob. Order is stable and duplicates are removed.
 */
export function collectAgentToolPresentationArgumentPointers(
  presentation: AgentToolPresentation | undefined,
): readonly string[] {
  const activity = presentation?.activity;
  const pointers = [
    activity?.argumentPath,
    ...(activity?.detailPaths ?? []),
    ...(activity?.v2?.variants ?? []).flatMap((variant) => [variant.argumentPath, ...(variant.detailPaths ?? [])]),
    ...(activity?.v2?.measures ?? [])
      .filter((measure) => measure.from === "argument")
      .flatMap((measure) => measureArgumentPointers(measure)),
  ].filter((pointer): pointer is string => typeof pointer === "string" && pointer.length > 0);
  return [...new Set(pointers)];
}

/**
 * A `first`/`count` measure over an array reads a field off each matched entry,
 * and `where` reads a sibling field to filter. Both are `pointer`-relative, so
 * the projection must keep them addressable too — otherwise the very
 * aggregation the measure declares has nothing left to read.
 */
function measureArgumentPointers(measure: {
  readonly pointer: string;
  readonly field?: string;
  readonly where?: { readonly field: string };
}): string[] {
  const base = measure.pointer;
  const entryPrefix = base.endsWith("*") ? base : `${base.replace(/\/$/u, "")}/*`;
  const fields = [measure.field, measure.where?.field].filter(
    (field): field is string => typeof field === "string" && field.length > 0,
  );
  return [base, ...fields.map((field) => `${entryPrefix}/${field}`)];
}

/**
 * A `result` measure that reads `/facts` can only address facts the same
 * contract declares in its Evidence slots. Shared by contract validation and
 * the coverage gate so both report the identical message.
 */
export function inspectAgentToolPresentationFactReferences(
  activity: AgentToolPresentationActivityV2 | undefined,
  declaredFacts: readonly string[],
): readonly string[] {
  const facts = new Set(declaredFacts);
  return (activity?.measures ?? [])
    .filter((measure) => measure.from === "result" && measure.pointer === "/facts" && measure.where !== undefined)
    .filter((measure) => !facts.has(String(measure.where!.equals)))
    .map(
      (measure) =>
        `Measure "${measure.id}" reads /facts where ${measure.where!.field} = "${String(measure.where!.equals)}", but the contract declares no such Evidence fact or slot.`,
    );
}

/**
 * Every rule below is decidable from the contract alone, so an illegal
 * declaration fails at registration instead of degrading at render time.
 */
function validateAgentToolPresentationActivityV2(
  activity: z.infer<typeof AgentToolPresentationActivityV2Shape>,
  context: z.RefinementCtx,
): void {
  const measureIds = new Set<string>();
  activity.measures.forEach((measure, index) => {
    if (measureIds.has(measure.id)) {
      context.addIssue({
        code: "custom",
        path: ["measures", index, "id"],
        message: `Measure id "${measure.id}" is declared more than once.`,
      });
      return;
    }
    measureIds.add(measure.id);
    validateMeasureContract(measure, index, context);
  });

  if (activity.title !== undefined) {
    validateTemplateReferences(activity.title, ["title"], measureIds, context);
  }

  let fallbackVariantIndex = -1;
  activity.variants.forEach((variant, index) => {
    if (variant.when === undefined) {
      if (fallbackVariantIndex >= 0) {
        context.addIssue({
          code: "custom",
          path: ["variants", index],
          message: "At most one variant may omit `when`.",
        });
      } else {
        fallbackVariantIndex = index;
      }
    } else if (!measureIds.has(variant.when.measure)) {
      context.addIssue({
        code: "custom",
        path: ["variants", index, "when", "measure"],
        message: `Variant references undeclared measure "${variant.when.measure}".`,
      });
    }
    if (variant.title !== undefined) {
      validateTemplateReferences(variant.title, ["variants", index, "title"], measureIds, context);
    }
  });

  // Variants are matched in array order, so a fallback placed anywhere but
  // last makes every variant after it unreachable.
  if (fallbackVariantIndex >= 0 && fallbackVariantIndex !== activity.variants.length - 1) {
    context.addIssue({
      code: "custom",
      path: ["variants", fallbackVariantIndex],
      message: "The variant without `when` must be the last entry; variants match in array order.",
    });
  }
}

function validateMeasureContract(
  measure: z.infer<typeof AgentToolPresentationMeasureSchema>,
  index: number,
  context: z.RefinementCtx,
): void {
  const path: (string | number)[] = ["measures", index];
  if (measure.from === "env") {
    if (!(AgentToolPresentationEnvironmentPointers as readonly string[]).includes(measure.pointer)) {
      context.addIssue({
        code: "custom",
        path: [...path, "pointer"],
        message: `env measures may only read ${AgentToolPresentationEnvironmentPointers.join(", ")}.`,
      });
    }
    if (measure.field !== undefined) {
      context.addIssue({
        code: "custom",
        path: [...path, "field"],
        message: "env measures are scalars and must not declare `field`.",
      });
    }
    if (measure.where !== undefined) {
      context.addIssue({
        code: "custom",
        path: [...path, "where"],
        message: "env measures are scalars and must not declare `where`.",
      });
    }
  }
  if (NumericAggregates.has(measure.aggregate) && !NumericValueTypes.has(measure.type)) {
    context.addIssue({
      code: "custom",
      path: [...path, "aggregate"],
      message: `aggregate "${measure.aggregate}" requires type "number" or "delta", received "${measure.type}".`,
    });
  }
  if (measure.aggregate === "join" && measure.separator === undefined) {
    context.addIssue({
      code: "custom",
      path: [...path, "separator"],
      message: 'aggregate "join" requires `separator`.',
    });
  }
  if (measure.where !== undefined && measure.field === undefined) {
    context.addIssue({
      code: "custom",
      path: [...path, "where"],
      message: "`where` filters collection entries and requires `field`.",
    });
  }
}

function validateTemplateReferences(
  template: string,
  path: (string | number)[],
  measureIds: ReadonlySet<string> | undefined,
  context: z.RefinementCtx,
): ReadonlySet<string> {
  const placeholders = new Set<string>();
  for (const match of template.matchAll(TemplatePlaceholderPattern)) {
    placeholders.add(match[1]!);
  }
  const residue = template.replace(TemplatePlaceholderPattern, "");
  if (residue.includes("{{") || residue.includes("}}")) {
    context.addIssue({
      code: "custom",
      path,
      message: "Template contains an unbalanced `{{ }}` placeholder.",
    });
  }
  if (LiteralSignPattern.test(template)) {
    context.addIssue({
      code: "custom",
      path,
      message:
        'Templates must not carry a literal "+"/"−" next to a placeholder; declare `sign` on the measure instead.',
    });
  }
  if (measureIds) {
    for (const placeholder of placeholders) {
      if (!measureIds.has(placeholder)) {
        context.addIssue({
          code: "custom",
          path,
          message: `Template references undeclared measure "${placeholder}".`,
        });
      }
    }
  }
  return placeholders;
}
