import { z } from "zod";
import {
  AgentToolObservationPriorityTiers,
  AgentToolObservationProjectionModes,
  AgentToolObservationProjectionSchemaVersion,
  AgentToolObservationProjectionSources,
} from "../Types/AgentToolObservationProjectionTypes.js";

const JsonPointerSchema = z
  .string()
  .refine((value) => value === "" || (value.startsWith("/") && isValidJsonPointer(value)), {
    message: "Observation projection pointers must use RFC 6901 JSON Pointer syntax.",
  });

const StructuralLimitsSchema = z
  .object({
    maxDepth: z.number().int().min(0),
    maxArrayItems: z.number().int().min(0),
    maxObjectProperties: z.number().int().min(0),
    maxStringCharacters: z.number().int().min(0),
    maxTotalCharacters: z.number().int().min(0),
    maxNodes: z.number().int().min(1),
  })
  .strict();

const SourceRuleSchema = z
  .object({
    source: z.enum(AgentToolObservationProjectionSources),
    mode: z.enum(AgentToolObservationProjectionModes),
    priority: z.enum(AgentToolObservationPriorityTiers),
    pointer: JsonPointerSchema.optional(),
    maxTokens: z.number().int().min(1),
    limits: StructuralLimitsSchema,
  })
  .strict();

const ContinuationSchema = z
  .object({
    kind: z.enum(["session", "cursor", "offset", "artifact"]),
    handle: JsonPointerSchema,
    cursor: JsonPointerSchema.optional(),
    state: JsonPointerSchema.optional(),
    terminalStates: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const AgentToolObservationProjectionSchema = z
  .object({
    $schema: z.string().optional(),
    schemaVersion: z.literal(AgentToolObservationProjectionSchemaVersion),
    maxTokens: z.number().int().min(1),
    maxOmissions: z.number().int().min(0),
    artifactFallback: z
      .object({
        strategy: z.literal("reference"),
        requiredWhenTruncated: z.boolean(),
      })
      .strict(),
    continuation: ContinuationSchema.optional(),
    sources: z.array(SourceRuleSchema).min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const seen = new Set<string>();
    manifest.sources.forEach((rule, index) => {
      if (seen.has(rule.source)) {
        context.addIssue({
          code: "custom",
          path: ["sources", index, "source"],
          message: `Observation projection source must be unique: ${rule.source}.`,
        });
      }
      seen.add(rule.source);
      if (rule.mode === AgentToolObservationProjectionModes.ArtifactOnly && rule.pointer !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["sources", index, "pointer"],
          message: "artifactOnly sources cannot declare a JSON Pointer.",
        });
      }
    });
    if (
      manifest.continuation &&
      !manifest.sources.some((rule) => rule.source === AgentToolObservationProjectionSources.Continuation)
    ) {
      context.addIssue({
        code: "custom",
        path: ["continuation"],
        message: "A continuation contract requires a continuation source rule.",
      });
    }
  });

export type ParsedAgentToolObservationProjection = z.infer<typeof AgentToolObservationProjectionSchema>;

function isValidJsonPointer(pointer: string): boolean {
  for (let index = 0; index < pointer.length; index += 1) {
    if (pointer[index] !== "~") continue;
    const escaped = pointer[index + 1];
    if (escaped !== "0" && escaped !== "1") return false;
    index += 1;
  }
  return true;
}
