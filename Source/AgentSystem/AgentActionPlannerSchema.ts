import { z } from "zod";
import {
  EvidenceVerificationStatus,
  type EvidenceVerification as BamlEvidenceVerification,
  type TaskFrame as BamlTaskFrame,
} from "./BamlClient/baml_client/index.js";

const NonEmptyStringSchema = z.string().trim().min(1);
const TrimmedStringSchema = z.string().trim();
const StringListSchema = z.array(NonEmptyStringSchema).transform(uniqueTrimmed);

const TaskFrameSchema = z
  .object({
    taskType: NonEmptyStringSchema,
    answerGoal: NonEmptyStringSchema,
    intentTags: StringListSchema,
    targetRefs: z.array(z.object({
      kind: NonEmptyStringSchema,
      value: NonEmptyStringSchema,
      status: NonEmptyStringSchema,
    }).strict()),
    candidateTools: z.array(z.object({
      name: NonEmptyStringSchema,
      purpose: NonEmptyStringSchema,
      supports: StringListSchema,
    }).strict()),
    discoveryQueries: StringListSchema,
    requiredEffects: z.array(z.object({
      id: NonEmptyStringSchema,
      effect: NonEmptyStringSchema,
      target: TrimmedStringSchema,
      proof: NonEmptyStringSchema,
      reason: NonEmptyStringSchema,
    }).strict()),
    requiredEvidence: z.array(z.object({
      id: NonEmptyStringSchema,
      need: NonEmptyStringSchema,
      minimum: z.number().int().min(1),
      reason: NonEmptyStringSchema,
    }).strict()),
    userInputNeeds: z.array(z.object({
      question: NonEmptyStringSchema,
      reason: NonEmptyStringSchema,
    }).strict()),
    nextStepPurpose: NonEmptyStringSchema,
    completionCriteria: StringListSchema,
    notes: StringListSchema,
  })
  .strict()
  .superRefine((taskFrame, context) => {
    const ids = [
      ...taskFrame.requiredEffects.map((effect) => effect.id),
      ...taskFrame.requiredEvidence.map((need) => need.id),
    ];
    const seen = new Set<string>();
    ids.forEach((id, index) => {
      if (seen.has(id)) {
        context.addIssue({
          code: "custom",
          path: ["requirementIds", index],
          message: `任务合约 requirement id 重复：${id}`,
        });
      }
      seen.add(id);
    });
  });

const EvidenceVerificationSchema = z
  .object({
    ready: z.boolean(),
    requirements: z.array(z.object({
      requirementId: NonEmptyStringSchema,
      need: NonEmptyStringSchema,
      status: z.enum(EvidenceVerificationStatus),
      evidenceRefs: StringListSchema,
      artifactUris: StringListSchema,
      reason: NonEmptyStringSchema,
      missingFacts: StringListSchema,
      unsupportedClaims: StringListSchema,
    }).strict()),
    summary: NonEmptyStringSchema,
  })
  .strict();

export function parseTaskFrame(taskFrame: BamlTaskFrame): BamlTaskFrame {
  const parsed = TaskFrameSchema.parse(taskFrame);
  return parsed;
}

export function parseEvidenceVerification(
  verification: BamlEvidenceVerification,
): BamlEvidenceVerification {
  const parsed = EvidenceVerificationSchema.parse(verification);
  return {
    ready: parsed.ready,
    requirements: parsed.requirements.map((requirement) => ({
      requirementId: requirement.requirementId,
      need: requirement.need,
      status: requirement.status,
      evidenceRefs: requirement.evidenceRefs,
      artifactUris: requirement.artifactUris,
      reason: requirement.reason,
      missingFacts: requirement.missingFacts,
      unsupportedClaims: requirement.unsupportedClaims,
    })),
    summary: parsed.summary,
  };
}

export class AgentActionPlannerValidationError extends Error {
  constructor(
    readonly issues: string[],
    readonly invalidDecision: unknown,
  ) {
    super(issues.join("\n"));
    this.name = "AgentActionPlannerValidationError";
  }
}

function uniqueTrimmed(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
