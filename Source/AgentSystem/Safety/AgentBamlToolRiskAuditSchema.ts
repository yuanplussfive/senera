import { z } from "zod";
import {
  ToolRiskAuditDecision,
  ToolRiskLevel,
  type ToolRiskAudit as BamlToolRiskAudit,
} from "../BamlClient/baml_client/index.js";
import {
  parseNormalizedBamlOutput,
  safeParseNormalizedBamlOutput,
} from "../BamlClient/AgentBamlOutputNormalizer.js";
import { AgentActionPlannerValidationError } from "../ActionPlanner/AgentActionPlannerSchema.js";

const NonEmptyStringSchema = z.string().trim().min(1);
const StringListSchema = z.array(NonEmptyStringSchema).transform(uniqueTrimmed);

const ToolRiskAuditSchema = z
  .object({
    decision: z.enum(ToolRiskAuditDecision),
    riskLevel: z.enum(ToolRiskLevel),
    confidence: z.number().min(0).max(1),
    tripwire: z.boolean(),
    reason: NonEmptyStringSchema,
    matchedConcerns: StringListSchema,
    safeAlternative: z.string().trim().optional(),
  })
  .strict()
  .superRefine((audit, context) => {
    const tripwireRequired = audit.decision !== ToolRiskAuditDecision.Allow;
    if (audit.tripwire !== tripwireRequired) {
      context.addIssue({
        code: "custom",
        path: ["tripwire"],
        message: `decision=${audit.decision} 时 tripwire 应为 ${String(tripwireRequired)}。`,
      });
    }
    if (
      audit.decision === ToolRiskAuditDecision.Allow
      && [ToolRiskLevel.High, ToolRiskLevel.Critical].includes(audit.riskLevel)
      && audit.confidence < 0.85
    ) {
      context.addIssue({
        code: "custom",
        path: ["decision"],
        message: "高风险且低置信度的调用不能直接 Allow，应选择 Ask。",
      });
    }
  });

export function parseToolRiskAudit(audit: BamlToolRiskAudit): BamlToolRiskAudit {
  const parsed = safeParseNormalizedBamlOutput(ToolRiskAuditSchema, audit);
  if (!parsed.success) {
    throw new AgentActionPlannerValidationError(parsed.structuredIssues, parsed.normalized);
  }
  return parsed.data;
}

export function parseToolRiskAuditProfile(value: unknown) {
  return parseNormalizedBamlOutput(ToolRiskAuditProfileSchema, value);
}

const ToolRiskAuditProfileSchema = z.object({
  riskScale: z.array(z.object({
    level: NonEmptyStringSchema,
    meaning: NonEmptyStringSchema,
  }).strict()).min(1),
  decisionRubric: z.array(z.object({
    decision: NonEmptyStringSchema,
    when: StringListSchema,
  }).strict()).min(1),
  concernCatalog: z.array(z.object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
  }).strict()).min(1),
}).strict();

function uniqueTrimmed(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
