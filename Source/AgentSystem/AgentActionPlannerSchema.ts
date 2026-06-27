import { z } from "zod";
import {
  EvidenceVerificationStatus,
  TaskEvidenceScope,
  TurnContextMode,
  type ActionPlanInput,
  type EvidenceVerification as BamlEvidenceVerification,
  type TaskFrame as BamlTaskFrame,
  type TurnUnderstanding as BamlTurnUnderstanding,
} from "./BamlClient/baml_client/index.js";
import { parseNormalizedBamlOutput } from "./AgentBamlOutputNormalizer.js";

const NonEmptyStringSchema = z.string().trim().min(1);
const TrimmedStringSchema = z.string().trim();
const StringListSchema = z.array(NonEmptyStringSchema).transform(uniqueTrimmed);

const TaskFrameSchema = z
  .object({
    taskType: NonEmptyStringSchema,
    answerGoal: NonEmptyStringSchema,
    intentTags: StringListSchema,
    taskTags: StringListSchema,
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
      scope: z.enum(TaskEvidenceScope),
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
      evidenceUris: StringListSchema,
      artifactUris: StringListSchema,
      reason: NonEmptyStringSchema,
      missingFacts: StringListSchema,
      unsupportedClaims: StringListSchema,
    }).strict()),
    summary: NonEmptyStringSchema,
  })
  .strict();

const TurnUnderstandingSchema = z
  .object({
    rawUserTurn: z.string(),
    standaloneRequest: NonEmptyStringSchema,
    contextMode: z.enum(TurnContextMode),
    contextBasis: TrimmedStringSchema,
    missingContext: TrimmedStringSchema,
  })
  .strict();

export function parseTaskFrame(
  taskFrame: BamlTaskFrame,
  input?: Pick<ActionPlanInput, "toolTagCatalog">,
): BamlTaskFrame {
  const parsed = parseNormalizedBamlOutput(TaskFrameSchema, taskFrame);
  if (input) {
    assertTaskTagsInCatalog(parsed, input.toolTagCatalog);
  }
  return parsed;
}

export function parseEvidenceVerification(
  verification: BamlEvidenceVerification,
): BamlEvidenceVerification {
  const parsed = parseNormalizedBamlOutput(EvidenceVerificationSchema, verification);
  return {
    ready: parsed.ready,
    requirements: parsed.requirements.map((requirement) => ({
      requirementId: requirement.requirementId,
      need: requirement.need,
      status: requirement.status,
      evidenceUris: requirement.evidenceUris,
      artifactUris: requirement.artifactUris,
      reason: requirement.reason,
      missingFacts: requirement.missingFacts,
      unsupportedClaims: requirement.unsupportedClaims,
    })),
    summary: parsed.summary,
  };
}

export function parseTurnUnderstanding(
  understanding: BamlTurnUnderstanding,
  input: Pick<ActionPlanInput, "currentUserTurn">,
): BamlTurnUnderstanding {
  const parsed = parseNormalizedBamlOutput(TurnUnderstandingSchema, understanding);
  if (parsed.rawUserTurn !== input.currentUserTurn.content) {
    throw new AgentActionPlannerValidationError([
      "rawUserTurn: 必须和 plannerInput.currentUserTurn.content 完全一致。",
    ], parsed);
  }
  if (parsed.contextMode === TurnContextMode.None && (parsed.contextBasis || parsed.missingContext)) {
    throw new AgentActionPlannerValidationError([
      "contextMode=None 时 contextBasis 和 missingContext 必须为空。",
    ], parsed);
  }
  if (parsed.contextMode !== TurnContextMode.Insufficient && parsed.missingContext) {
    throw new AgentActionPlannerValidationError([
      "只有 contextMode=Insufficient 时才允许 missingContext 非空。",
    ], parsed);
  }
  if (parsed.contextMode !== TurnContextMode.None && !parsed.contextBasis) {
    throw new AgentActionPlannerValidationError([
      "contextMode 不是 None 时必须提供具体 contextBasis。",
    ], parsed);
  }
  return parsed;
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

function assertTaskTagsInCatalog(
  taskFrame: BamlTaskFrame,
  toolTagCatalog: readonly string[],
): void {
  const allowed = new Set(toolTagCatalog.map((tag) => tag.trim()).filter(Boolean));
  const invalid = taskFrame.taskTags.filter((tag) => !allowed.has(tag));
  if (invalid.length === 0) {
    return;
  }

  throw new AgentActionPlannerValidationError(
    invalid.map((tag) => `taskTags: ${tag} 不在 plannerInput.toolTagCatalog 中。`),
    taskFrame,
  );
}
