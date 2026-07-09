import { z } from "zod";
import {
  TurnContextMode,
  type ActionPlanInput,
  type TurnUnderstanding as BamlTurnUnderstanding,
} from "../BamlClient/baml_client/index.js";
import { parseNormalizedBamlOutput } from "../BamlClient/AgentBamlOutputNormalizer.js";
import {
  createAgentStructuredIssue,
  createAgentStructuredIssueList,
  formatAgentStructuredIssues,
  type AgentStructuredIssue,
} from "../Diagnostics/AgentStructuredIssue.js";

const NonEmptyStringSchema = z.string().trim().min(1);
const TrimmedStringSchema = z.string().trim();

const TurnUnderstandingSchema = z
  .object({
    rawUserTurn: z.string(),
    standaloneRequest: NonEmptyStringSchema,
    contextMode: z.enum(TurnContextMode),
    contextBasis: TrimmedStringSchema,
    missingContext: TrimmedStringSchema,
  })
  .strict();

export function parseTurnUnderstanding(
  understanding: BamlTurnUnderstanding,
  input: Pick<ActionPlanInput, "currentUserTurn">,
): BamlTurnUnderstanding {
  const parsed = parseNormalizedBamlOutput(TurnUnderstandingSchema, understanding);
  if (parsed.rawUserTurn !== input.currentUserTurn.content) {
    throw new AgentActionPlannerValidationError([
      createAgentStructuredIssue("必须和 plannerInput.currentUserTurn.content 完全一致。", ["rawUserTurn"]),
    ], parsed);
  }
  if (parsed.contextMode === TurnContextMode.None && (parsed.contextBasis || parsed.missingContext)) {
    throw new AgentActionPlannerValidationError([
      createAgentStructuredIssue("contextMode=None 时 contextBasis 和 missingContext 必须为空。", ["contextMode"]),
    ], parsed);
  }
  if (parsed.contextMode !== TurnContextMode.Insufficient && parsed.missingContext) {
    throw new AgentActionPlannerValidationError([
      createAgentStructuredIssue("只有 contextMode=Insufficient 时才允许 missingContext 非空。", ["missingContext"]),
    ], parsed);
  }
  if (parsed.contextMode !== TurnContextMode.None && !parsed.contextBasis) {
    throw new AgentActionPlannerValidationError([
      createAgentStructuredIssue("contextMode 不是 None 时必须提供具体 contextBasis。", ["contextBasis"]),
    ], parsed);
  }
  return parsed;
}

export class AgentActionPlannerValidationError extends Error {
  readonly issueDetails: AgentStructuredIssue[];
  readonly issues: string[];

  constructor(
    issues: readonly (string | AgentStructuredIssue)[],
    readonly invalidDecision: unknown,
  ) {
    const issueDetails = createAgentStructuredIssueList(issues);
    const messages = formatAgentStructuredIssues(issueDetails);
    super(messages.join("\n"));
    this.name = "AgentActionPlannerValidationError";
    this.issueDetails = issueDetails;
    this.issues = messages;
  }
}
