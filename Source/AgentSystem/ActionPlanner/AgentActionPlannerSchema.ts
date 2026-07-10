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
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

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
      createAgentStructuredIssue(agentErrorMessage("actionPlanner.rawUserTurnMustMatch"), ["rawUserTurn"]),
    ], parsed);
  }
  if (parsed.contextMode === TurnContextMode.None && (parsed.contextBasis || parsed.missingContext)) {
    throw new AgentActionPlannerValidationError([
      createAgentStructuredIssue(agentErrorMessage("actionPlanner.contextNoneMustHaveNoContextFields"), ["contextMode"]),
    ], parsed);
  }
  if (parsed.contextMode !== TurnContextMode.Insufficient && parsed.missingContext) {
    throw new AgentActionPlannerValidationError([
      createAgentStructuredIssue(agentErrorMessage("actionPlanner.missingContextOnlyForInsufficient"), ["missingContext"]),
    ], parsed);
  }
  if (parsed.contextMode !== TurnContextMode.None && !parsed.contextBasis) {
    throw new AgentActionPlannerValidationError([
      createAgentStructuredIssue(agentErrorMessage("actionPlanner.contextBasisRequired"), ["contextBasis"]),
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
